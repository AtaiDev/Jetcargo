/**
 * Товары (позиции заказов): список с фильтрами и пагинацией, быстрое добавление,
 * редактирование, смена статуса, оплаты и мягкое удаление.
 */
import { Router, type Request } from "express";

import { all, get, run, tx, type Param } from "../db";
import {
  audit,
  findOrCreateCustomer,
  findOrCreateOrder,
  itemOr404,
  itemStatus,
  items,
  normCode,
  openDebtSql,
  requireAdmin,
  setStatus,
  totals,
} from "../domain";
import { badRequest, conflict, normText, notFound, nowIso, num, optInt, parseDate, phoneDigits, str, today } from "../util";
import { customerOr404 } from "./customers";

export const itemsRouter = Router();

// --- Список -----------------------------------------------------------------------

/** Фильтры списка товаров из query — общие для «Заказов» и «Склада». */
function itemFilters(query: Request["query"], ignoreStatus = false): { where: string; params: Param[] } {
  const w: string[] = [];
  const p: Param[] = [];
  const status = ignoreStatus ? "" : str(query.status);
  if (status === "active") w.push("status IN ('ordered','in_stock')");
  else if (["ordered", "in_stock", "issued"].includes(status)) {
    w.push("status = ?");
    p.push(status);
  }
  switch (str(query.pay)) {
    case "paid":
      w.push("pay_status = 'paid'");
      break;
    case "unpaid":
      w.push("pay_status = 'unpaid'");
      break;
    case "partial":
      w.push("pay_status = 'partial'");
      break;
    case "debt": // настоящий долг — выданное считается оплаченным
      w.push(openDebtSql());
      break;
    case "ready": // на складе и полностью оплачен — можно выдавать
      w.push("status = 'in_stock' AND debt <= 0");
      break;
  }
  const customerId = optInt(query.customer_id);
  if (customerId) {
    w.push("customer_id = ?");
    p.push(customerId);
  }
  if (query.date_from) {
    w.push("order_date >= ?");
    p.push(parseDate(query.date_from, "date_from"));
  }
  if (query.date_to) {
    w.push("order_date <= ?");
    p.push(parseDate(query.date_to, "date_to"));
  }
  const q = str(query.q, 100);
  if (q) {
    const text = `%${normText(q)}%`;
    const code = `%${normCode(q)}%`;
    const digits = phoneDigits(q);
    const parts = ["norm(name) LIKE ?", "norm(customer_name) LIKE ?", "code_norm LIKE ?", "norm(COALESCE(customer_code,'')) LIKE ?"];
    p.push(text, text, code, text);
    if (digits.length >= 3) {
      parts.push("customer_id IN (SELECT id FROM customers WHERE phone_digits LIKE ?)");
      p.push(`%${digits}%`);
    }
    w.push(`(${parts.join(" OR ")})`);
  }
  return { where: w.length ? w.join(" AND ") : "1 = 1", params: p };
}

const SORTS: Record<string, string> = {
  // Товары одного клиента за день — подряд, чтобы таблица читалась блоками.
  date: "ORDER BY order_date DESC, customer_id DESC, id DESC",
  arrived: "ORDER BY arrived_at DESC, id DESC",
  issued: "ORDER BY issued_at DESC, id DESC",
  customer: "ORDER BY norm(customer_name), order_date DESC, id DESC",
};

itemsRouter.get("/items", (req, res) => {
  const { where, params } = itemFilters(req.query);
  const limit = Math.min(optInt(req.query.limit) ?? 50, 500);
  const offset = Math.max(optInt(req.query.offset) ?? 0, 0);
  const sort = SORTS[str(req.query.sort)] ?? SORTS.date;
  const all_ = items(where, params, sort);
  // Счётчики по статусам для вкладок — без учёта самого фильтра статуса.
  const noStatus = itemFilters(req.query, true);
  const counts = get<{ all: number; ordered: number; in_stock: number; issued: number }>(
    `SELECT COUNT(*) AS "all", COALESCE(SUM(status='ordered'),0) AS ordered,
            COALESCE(SUM(status='in_stock'),0) AS in_stock, COALESCE(SUM(status='issued'),0) AS issued
       FROM v_items WHERE ${noStatus.where}`,
    ...noStatus.params
  );
  res.json({ rows: all_.slice(offset, offset + limit), total: all_.length, totals: totals(all_), counts });
});

itemsRouter.get("/items/:id", (req, res) => {
  const item = itemOr404(Number(req.params.id));
  res.json({
    item,
    payments: all(
      `SELECT p.id, p.amount, p.method, p.paid_at, p.comment, p.deleted_at, u.login AS user_login
         FROM payments p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.order_item_id = ? ORDER BY p.paid_at, p.id`,
      item.id
    ),
    history: all(
      `SELECT h.id, h.from_status, h.to_status, h.source, h.comment, h.changed_at, u.login AS user_login
         FROM status_history h LEFT JOIN users u ON u.id = h.user_id
        WHERE h.order_item_id = ? ORDER BY h.changed_at, h.id`,
      item.id
    ),
    scans: all(
      `SELECT s.id, s.code, s.result, s.scanned_at, u.login AS user_login
         FROM scans s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.order_item_id = ? AND s.deleted_at IS NULL ORDER BY s.scanned_at, s.id`,
      item.id
    ),
  });
});

// --- Создание и изменение -----------------------------------------------------------------

function money(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  return num(String(v).replace(/\s/g, "").replace(",", "."), field);
}

function qtyOf(v: unknown): number {
  const n = Number(v ?? 1);
  if (!Number.isInteger(n) || n <= 0) throw badRequest("Количество: целое число больше нуля");
  return n;
}

/**
 * Быстрое добавление товара. Клиент ищется по телефону (или создаётся),
 * заказ — по клиенту и дате заказа.
 */
itemsRouter.post("/items", (req, res) => {
  const b = req.body ?? {};
  const name = str(b.name, 300);
  if (!name) throw badRequest("Укажите название товара");
  const price = money(b.price, "Сумма") ?? 0;
  const status = b.status ? itemStatus(b.status) : "ordered";
  const orderDate = b.order_date ? parseDate(b.order_date, "дата заказа") : today();
  const paid = money(b.paid_amount, "Оплачено") ?? 0;

  const result = tx(() => {
    let customerId = optInt(b.customer_id);
    let customerCreated = false;
    if (customerId) customerOr404(customerId);
    else {
      const c = findOrCreateCustomer(str(b.customer_name, 200), str(b.customer_phone, 50));
      customerId = c.id;
      customerCreated = c.created;
    }
    const orderId = findOrCreateOrder(customerId, orderDate, req.user!.id);
    const code = str(b.code, 100);
    const id = run(
      `INSERT INTO order_items (order_id, name, code, code_norm, qty, price, price_cny, real_price, cost, split_with, comment, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      orderId, name, code, normCode(code), qtyOf(b.qty), price, money(b.price_cny, "Цена ¥"),
      money(b.real_price, "Реальная цена"), money(b.cost, "Себестоимость"),
      str(b.split_with, 200), str(b.comment, 2000), status, req.user!.id
    );
    setStatus(id, status, "create", req.user!.id);
    if (paid > 0) {
      const sale = itemOr404(id).sale;
      if (paid > sale + 0.001) throw conflict("Оплата больше суммы товара");
      run("INSERT INTO payments (order_item_id, amount, user_id) VALUES (?, ?, ?)", id, paid, req.user!.id);
    }
    return { id, customerCreated };
  });
  audit(req, "create", "item", result.id, null, name);
  res.json({ item: itemOr404(result.id), customer_created: result.customerCreated });
});

itemsRouter.patch("/items/:id", (req, res) => {
  const id = Number(req.params.id);
  const old = itemOr404(id);
  const b = req.body ?? {};
  tx(() => {
    const name = b.name !== undefined ? str(b.name, 300) : old.name;
    if (!name) throw badRequest("Укажите название товара");
    const code = b.code !== undefined ? str(b.code, 100) : old.code;
    run(
      `UPDATE order_items SET name = ?, code = ?, code_norm = ?, qty = ?, price = ?, price_cny = ?, real_price = ?,
              split_with = ?, comment = ?, updated_at = ? WHERE id = ?`,
      name, code, normCode(code),
      b.qty !== undefined ? qtyOf(b.qty) : old.qty,
      b.price !== undefined ? (money(b.price, "Сумма") ?? 0) : old.price,
      b.price_cny !== undefined ? money(b.price_cny, "Цена ¥") : old.price_cny,
      b.real_price !== undefined ? money(b.real_price, "Реальная цена") : old.real_price,
      b.split_with !== undefined ? str(b.split_with, 200) : old.split_with,
      b.comment !== undefined ? str(b.comment, 2000) : old.comment,
      nowIso(), id
    );
    // Старое поле себестоимости меняется только явно (теперь выкуп — это реальная цена).
    if (b.cost !== undefined) run("UPDATE order_items SET cost = ? WHERE id = ?", money(b.cost, "Себестоимость"), id);
    // Смена даты заказа или клиента — перенос товара в нужный заказ.
    const newDate = b.order_date !== undefined ? parseDate(b.order_date, "дата заказа") : old.order_date;
    const newCustomer = b.customer_id !== undefined ? Number(b.customer_id) : old.customer_id;
    if (newDate !== old.order_date || newCustomer !== old.customer_id) {
      customerOr404(newCustomer);
      run("UPDATE order_items SET order_id = ? WHERE id = ?", findOrCreateOrder(newCustomer, newDate, req.user!.id), id);
    }
    if (b.status !== undefined) setStatus(id, itemStatus(b.status), "manual", req.user!.id);
  });
  const changed = Object.keys(b);
  audit(req, "update", "item", id, Object.fromEntries(changed.map((k) => [k, (old as unknown as Record<string, unknown>)[k]])), b);
  res.json(itemOr404(id));
});

// --- Массовые действия -----------------------------------------------------------------

function bulkIds(v: unknown): number[] {
  if (!Array.isArray(v) || !v.length) throw badRequest("Не выбраны товары");
  if (v.length > 1000) throw badRequest("За раз можно обработать не больше 1000 товаров");
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
}

/**
 * Смена статуса у многих товаров сразу.
 *  - «Выдан» — только товары «На складе»; оформляется как выдача (по одной на клиента),
 *    поэтому попадает в историю выдач. Остальные пропускаются с причиной.
 *  - «На складе» / «Заказан» — ручная смена с записью в историю статусов.
 * dry_run=true — ничего не меняет, только считает (для окна подтверждения).
 */
itemsRouter.post("/items-bulk/status", (req, res) => {
  const ids = bulkIds(req.body?.ids);
  const to = itemStatus(req.body?.status);
  const dryRun = !!req.body?.dry_run;
  const comment = str(req.body?.comment, 500);
  const list = ids.map((id) => items("id = ?", [id])[0]).filter(Boolean);

  const skipped: { id: number; name: string; reason: string }[] = [];
  const eligible = list.filter((it) => {
    if (it.status === to) skipped.push({ id: it.id, name: it.name, reason: "уже в этом статусе" });
    else if (to === "issued" && it.status !== "in_stock") skipped.push({ id: it.id, name: it.name, reason: "не на складе" });
    else return true;
    return false;
  });
  const debt = eligible.reduce((s, i) => s + i.debt, 0);
  const summary = { changed: eligible.length, skipped, debt, customers: new Set(eligible.map((i) => i.customer_id)).size };
  if (dryRun || !eligible.length) {
    res.json({ ...summary, dry_run: true });
    return;
  }

  const userId = req.user!.id;
  const issueIds: number[] = [];
  tx(() => {
    const at = nowIso();
    if (to === "issued") {
      const byCustomer = new Map<number, typeof eligible>();
      for (const it of eligible) byCustomer.set(it.customer_id, [...(byCustomer.get(it.customer_id) ?? []), it]);
      for (const [customerId, group] of byCustomer) {
        const issueId = run(
          "INSERT INTO issues (customer_id, issued_at, comment, user_id) VALUES (?, ?, ?, ?)",
          customerId, at, comment || "массовая выдача", userId
        );
        issueIds.push(issueId);
        for (const it of group) setStatus(it.id, "issued", "issue", userId, { issueId, at });
      }
    } else {
      for (const it of eligible) setStatus(it.id, to, "manual", userId, { comment: comment || "массовое изменение", at });
    }
  });
  audit(req, to === "issued" ? "issue" : "status", "item", null, `${eligible.length} товаров`, { status: to, ids: eligible.map((i) => i.id) });
  res.json({ ...summary, issue_ids: issueIds });
});

/** Отметить оплаченными: по каждому товару с долгом записывается оплата на остаток долга. */
itemsRouter.post("/items-bulk/pay", (req, res) => {
  const ids = bulkIds(req.body?.ids);
  const method = str(req.body?.method, 20) || "cash";
  const list = ids.map((id) => items("id = ?", [id])[0]).filter((it) => it && it.debt > 0);
  const amount = list.reduce((s, i) => s + i.debt, 0);
  if (req.body?.dry_run || !list.length) {
    res.json({ items: list.length, amount, dry_run: true });
    return;
  }
  const at = nowIso();
  tx(() => {
    for (const it of list) {
      run(
        "INSERT INTO payments (order_item_id, amount, method, paid_at, comment, user_id) VALUES (?, ?, ?, ?, 'массовая оплата', ?)",
        it.id, it.debt, method, at, req.user!.id
      );
    }
  });
  audit(req, "payment", "item", null, `${list.length} товаров`, { amount, ids: list.map((i) => i.id) });
  res.json({ items: list.length, amount });
});

itemsRouter.post("/items/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const old = itemOr404(id);
  const to = itemStatus(req.body?.status);
  if (old.status === to) throw conflict("Товар уже в этом статусе");
  tx(() => setStatus(id, to, "manual", req.user!.id, { comment: str(req.body?.comment, 500) }));
  audit(req, "status", "item", id, old.status, to);
  res.json(itemOr404(id));
});

/** Мягкое удаление: товар скрывается, история и оплаты остаются в базе. */
itemsRouter.delete("/items/:id", (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  const old = itemOr404(id);
  run("UPDATE order_items SET deleted_at = ? WHERE id = ?", nowIso(), id);
  audit(req, "delete", "item", id, `${old.name} (${old.customer_name})`, null);
  res.json({ ok: true });
});

// --- Оплаты -------------------------------------------------------------------------

itemsRouter.post("/items/:id/payments", (req, res) => {
  const id = Number(req.params.id);
  const item = itemOr404(id);
  const b = req.body ?? {};
  const amount = money(b.amount, "Сумма") ?? 0;
  if (amount <= 0) throw badRequest("Сумма оплаты должна быть больше нуля");
  if (amount > item.debt + 0.001) throw conflict(`Сумма больше долга по товару (${item.debt})`);
  const pid = run(
    "INSERT INTO payments (order_item_id, amount, method, comment, user_id) VALUES (?, ?, ?, ?, ?)",
    id, amount, str(b.method, 20) || "cash", str(b.comment, 500), req.user!.id
  );
  audit(req, "payment", "item", id, null, amount);
  res.json({ id: pid, item: itemOr404(id) });
});

/** Отмена ошибочной оплаты: запись остаётся в истории с пометкой. */
itemsRouter.delete("/payments/:id", (req, res) => {
  requireAdmin(req);
  const p = get<{ id: number; order_item_id: number; amount: number; deleted_at: string | null }>(
    "SELECT id, order_item_id, amount, deleted_at FROM payments WHERE id = ?",
    Number(req.params.id)
  );
  if (!p || p.deleted_at) throw notFound("Оплата");
  run("UPDATE payments SET deleted_at = ? WHERE id = ?", nowIso(), p.id);
  audit(req, "payment_cancel", "item", p.order_item_id, p.amount, null);
  res.json(itemOr404(p.order_item_id));
});
