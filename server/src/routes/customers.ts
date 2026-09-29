/** Клиенты: поиск, карточка со всеми товарами и суммами, оплата долга, мягкое удаление. */
import { Router } from "express";

import { all, get, run, tx, type Param } from "../db";
import { audit, canonPhone, formatPhone, items, openDebtSql, requireAdmin, totals } from "../domain";
import { badRequest, conflict, normText, notFound, nowIso, num, optInt, phoneDigits, str } from "../util";

export const customersRouter = Router();

export interface CustomerRow {
  id: number;
  code: string | null;
  name: string;
  phone: string;
  comment: string;
  created_at: string;
}

const COLS = "id, code, name, phone, comment, created_at";

export function customerOr404(id: number): CustomerRow {
  const c = get<CustomerRow>(`SELECT ${COLS} FROM customers WHERE id = ? AND deleted_at IS NULL`, id);
  if (!c) throw notFound("Клиент");
  return c;
}

/** Условие поиска клиента: имя, телефон (любой формат), код клиента. Алиас таблицы — c. */
export function customerSearch(q: string): { sql: string; params: Param[] } {
  const text = normText(q.trim());
  const digits = phoneDigits(q);
  const parts = ["norm(c.name) LIKE ?", "norm(COALESCE(c.code,'')) LIKE ?"];
  const params: Param[] = [`%${text}%`, `%${text}%`];
  if (digits.length >= 3) {
    parts.push("c.phone_digits LIKE ?");
    params.push(`%${digits}%`);
  }
  return { sql: `(${parts.join(" OR ")})`, params };
}

/** Сортировки списка — только из белого списка, ввод пользователя в SQL не попадает. */
const SORTS: Record<string, string> = {
  recent: "(last_order_date IS NULL), last_order_date DESC, c.id DESC",
  debt: "debt DESC, last_order_date DESC, c.id DESC",
  sale: "sale DESC, c.id DESC",
  name: "norm(c.name), c.id",
};

/** Сводка по всем клиентам (без поиска и фильтра) — счётчики на плитках-фильтрах. */
function customersSummary() {
  return get<{ total: number; debtors: number; debt: number; waiting: number; in_stock: number; active: number }>(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(debt > 0), 0) AS debtors, COALESCE(SUM(debt), 0) AS debt,
           COALESCE(SUM(in_stock > 0), 0) AS waiting, COALESCE(SUM(in_stock), 0) AS in_stock,
           COALESCE(SUM(last_order_date >= date('now', 'localtime', 'start of month')), 0) AS active
      FROM (SELECT COALESCE(SUM(CASE WHEN v.status = 'issued' THEN 0 ELSE v.debt END), 0) AS debt,
                   COALESCE(SUM(v.status = 'in_stock'), 0) AS in_stock,
                   MAX(v.order_date) AS last_order_date
              FROM customers c LEFT JOIN v_items v ON v.customer_id = c.id
             WHERE c.deleted_at IS NULL
             GROUP BY c.id)`)!;
}

customersRouter.get("/customers", (req, res) => {
  const q = str(req.query.q, 100);
  const filter = str(req.query.filter); // debt | in_stock
  const limit = Math.min(optInt(req.query.limit) ?? 50, 200);
  const offset = Math.max(optInt(req.query.offset) ?? 0, 0);

  const where: string[] = ["c.deleted_at IS NULL"];
  const params: Param[] = [];
  if (q) {
    const s = customerSearch(q);
    where.push(s.sql);
    params.push(...s.params);
  }
  // Выражение, а не псевдоним: иначе SQLite берёт одноимённый столбец v_items.debt (долг с выданными).
  const having =
    filter === "debt"
      ? "HAVING SUM(CASE WHEN v.status = 'issued' THEN 0 ELSE v.debt END) > 0"
      : filter === "in_stock"
        ? "HAVING SUM(v.status = 'in_stock') > 0"
        : "";

  const base = `
    SELECT c.id, c.code, c.name, c.phone, c.comment, c.created_at,
           COUNT(v.id) AS items, COALESCE(SUM(v.sale), 0) AS sale,
           COALESCE(SUM(CASE WHEN v.status = 'issued' THEN v.sale ELSE MIN(v.paid, v.sale) END), 0) AS paid,
           COALESCE(SUM(CASE WHEN v.status = 'issued' THEN 0 ELSE v.debt END), 0) AS debt,
           COALESCE(SUM(v.status = 'ordered'), 0) AS ordered,
           COALESCE(SUM(v.status = 'in_stock'), 0) AS in_stock,
           COALESCE(SUM(v.status = 'issued'), 0) AS issued,
           MAX(v.order_date) AS last_order_date
      FROM customers c LEFT JOIN v_items v ON v.customer_id = c.id
     WHERE ${where.join(" AND ")}
     GROUP BY c.id ${having}`;
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM (${base})`, ...params)!.n;
  const order = SORTS[str(req.query.sort)] ?? SORTS.recent;
  const rows = all(`${base} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ rows, total, summary: customersSummary() });
});

customersRouter.get("/customers/:id", (req, res) => {
  const customer = customerOr404(Number(req.params.id));
  const list = items("customer_id = ?", [customer.id]);
  res.json({ customer, totals: totals(list), items: list });
});

function uniqueCheck(phone: string, code: string, exceptId = 0) {
  const digits = canonPhone(phone);
  if (digits && get("SELECT id FROM customers WHERE phone_digits = ? AND id <> ? AND deleted_at IS NULL", digits, exceptId)) {
    throw conflict("Клиент с таким телефоном уже есть");
  }
  if (code) {
    const taken = all<{ id: number; code: string }>("SELECT id, code FROM customers WHERE code IS NOT NULL AND deleted_at IS NULL")
      .some((c) => c.id !== exceptId && normText(c.code) === normText(code));
    if (taken) throw conflict("Такой код клиента уже занят");
  }
}

customersRouter.post("/customers", (req, res) => {
  const b = req.body ?? {};
  const name = str(b.name, 200);
  if (!name) throw badRequest("Укажите имя клиента");
  const phone = str(b.phone, 50);
  const code = str(b.code, 50);
  uniqueCheck(phone, code);
  const id = run(
    "INSERT INTO customers (code, name, phone, phone_digits, comment) VALUES (?, ?, ?, ?, ?)",
    code || null, name, formatPhone(phone), canonPhone(phone), str(b.comment, 2000)
  );
  audit(req, "create", "customer", id, null, name);
  res.json(customerOr404(id));
});

customersRouter.patch("/customers/:id", (req, res) => {
  const id = Number(req.params.id);
  const old = customerOr404(id);
  const b = req.body ?? {};
  const name = b.name !== undefined ? str(b.name, 200) : old.name;
  if (!name) throw badRequest("Укажите имя клиента");
  const phone = b.phone !== undefined ? str(b.phone, 50) : old.phone;
  const code = b.code !== undefined ? str(b.code, 50) : (old.code ?? "");
  uniqueCheck(phone, code, id);
  run(
    "UPDATE customers SET code = ?, name = ?, phone = ?, phone_digits = ?, comment = ? WHERE id = ?",
    code || null, name, formatPhone(phone), canonPhone(phone),
    b.comment !== undefined ? str(b.comment, 2000) : old.comment, id
  );
  audit(req, "update", "customer", id, { name: old.name, phone: old.phone, code: old.code }, { name, phone, code });
  res.json(customerOr404(id));
});

/**
 * Удаление мягкое: клиент и его товары скрываются, но остаются в базе вместе с историей.
 */
customersRouter.delete("/customers/:id", (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  const c = customerOr404(id);
  const at = nowIso();
  tx(() => {
    run("UPDATE order_items SET deleted_at = ? WHERE deleted_at IS NULL AND order_id IN (SELECT id FROM orders WHERE customer_id = ?)", at, id);
    run("UPDATE orders SET deleted_at = ? WHERE deleted_at IS NULL AND customer_id = ?", at, id);
    run("UPDATE customers SET deleted_at = ? WHERE id = ?", at, id);
  });
  audit(req, "delete", "customer", id, c.name, null);
  res.json({ ok: true });
});

/**
 * Оплата от клиента одной суммой: распределяется по его неоплаченным товарам,
 * начиная с самых старых. Переплата не принимается — чтобы не было «лишних» денег.
 */
customersRouter.post("/customers/:id/payments", (req, res) => {
  const id = Number(req.params.id);
  customerOr404(id);
  const b = req.body ?? {};
  let amount = num(b.amount, "Сумма");
  if (amount <= 0) throw badRequest("Сумма оплаты должна быть больше нуля");
  const ids = Array.isArray(b.item_ids) ? b.item_ids.map(Number) : null;
  // Оплата клиента распределяется только по настоящим долгам (выданное считается оплаченным).
  const unpaid = items(`customer_id = ? AND ${openDebtSql()}`, [id], "ORDER BY order_date, id").filter(
    (i) => !ids || ids.includes(i.id)
  );
  const debt = unpaid.reduce((s, i) => s + i.debt, 0);
  if (amount > debt + 0.001) throw conflict(`Сумма больше долга (${debt})`);

  const method = str(b.method, 20) || "cash";
  const comment = str(b.comment, 500);
  const paidAt = nowIso();
  const applied: { item_id: number; amount: number }[] = [];
  tx(() => {
    for (const it of unpaid) {
      if (amount <= 0) break;
      const part = Math.min(it.debt, amount);
      run(
        "INSERT INTO payments (order_item_id, amount, method, paid_at, comment, user_id) VALUES (?, ?, ?, ?, ?, ?)",
        it.id, part, method, paidAt, comment, req.user!.id
      );
      applied.push({ item_id: it.id, amount: part });
      amount -= part;
    }
  });
  audit(req, "payment", "customer", id, null, applied);
  res.json({ applied });
});
