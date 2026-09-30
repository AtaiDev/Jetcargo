/** Глобальный поиск, настройки и журнал действий. */
import { Router } from "express";

import { all, run, type Param } from "../db";
import { items, normCode, requireAdmin } from "../domain";
import { badRequest, normText, num, optInt, phoneDigits, str } from "../util";
import { customerSearch } from "./customers";

export const miscRouter = Router();

/** Быстрый поиск для шапки: клиенты и товары по имени, телефону, коду, названию. */
miscRouter.get("/search", (req, res) => {
  const q = str(req.query.q, 100);
  if (q.length < 2) {
    res.json({ query: q, customers: [], items: [] });
    return;
  }
  const s = customerSearch(q);
  const customers = all(
    `SELECT c.id, c.name, c.phone, c.code,
            (SELECT COALESCE(SUM(v.debt), 0) FROM v_items v WHERE v.customer_id = c.id AND v.status <> 'issued') AS debt,
            (SELECT COUNT(*) FROM v_items v WHERE v.customer_id = c.id) AS items
       FROM customers c WHERE c.deleted_at IS NULL AND ${s.sql}
      ORDER BY c.name LIMIT 6`,
    ...s.params
  );
  const digits = phoneDigits(q);
  const found = items(
    `(code_norm LIKE ? OR norm(name) LIKE ?${digits.length >= 3 ? " OR customer_id IN (SELECT id FROM customers WHERE phone_digits LIKE ?)" : ""})`,
    [`%${normCode(q)}%`, `%${normText(q)}%`, ...(digits.length >= 3 ? [`%${digits}%`] : [])],
    "ORDER BY order_date DESC, id DESC LIMIT 8"
  );
  res.json({ query: q, customers, items: found });
});


// --- Настройки ---------------------------------------------------------------------

function settings() {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM app_settings");
  const v = (k: string) => rows.find((r) => r.key === k)?.value;
  return { cny_rate: Number(v("cny_rate") ?? 13) };
}

miscRouter.get("/settings", (_req, res) => {
  res.json(settings());
});

miscRouter.patch("/settings", (req, res) => {
  requireAdmin(req);
  const b = req.body ?? {};
  if (b.cny_rate !== undefined) {
    const rate = num(b.cny_rate, "Курс юаня");
    if (rate <= 0) throw badRequest("Курс юаня должен быть больше нуля");
    run("INSERT INTO app_settings (key, value) VALUES ('cny_rate', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", String(rate));
  }
  res.json(settings());
});

// --- Журнал действий -----------------------------------------------------------------

/** Раздел журнала — для фильтра и цвета записи. */
const AUDIT_CAT = `CASE
    WHEN a.action = 'scan' THEN 'receive'
    WHEN a.action = 'issue' THEN 'issue'
    WHEN a.action LIKE 'payment%' THEN 'payment'
    WHEN a.action LIKE 'import%' THEN 'import'
    WHEN a.action = 'delete' THEN 'delete'
    WHEN a.entity = 'batch' THEN 'batch'
    WHEN a.entity = 'customer' THEN 'customer'
    WHEN a.entity = 'user' THEN 'user'
    ELSE 'item' END`;

/**
 * Журнал действий. К записи сразу подставляются названия: товар и его клиент,
 * клиент, партия, сотрудник — чтобы запись читалась без номеров.
 * Фильтры: cat (раздел), user_id, since/until (ISO), q (поиск). Постранично.
 */
miscRouter.get("/audit", (req, res) => {
  requireAdmin(req);
  const limit = Math.min(optInt(req.query.limit) ?? 50, 200);
  const offset = Math.max(optInt(req.query.offset) ?? 0, 0);
  const from = `FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN order_items oi ON a.entity = 'item' AND oi.id = a.entity_id
     LEFT JOIN orders io ON io.id = oi.order_id
     LEFT JOIN customers ic ON ic.id = io.customer_id
     LEFT JOIN customers c ON a.entity = 'customer' AND c.id = a.entity_id
     LEFT JOIN batches b ON a.entity = 'batch' AND b.id = a.entity_id
     LEFT JOIN users tu ON a.entity = 'user' AND tu.id = a.entity_id
     LEFT JOIN orders o ON a.entity = 'order' AND o.id = a.entity_id
     LEFT JOIN customers oc ON oc.id = o.customer_id`;

  // Общие условия (без раздела) — по ним же считаются счётчики разделов. Скрытые записи не показываем.
  const w: string[] = ["a.deleted_at IS NULL"];
  const p: Param[] = [];
  const userId = optInt(req.query.user_id);
  if (userId) {
    w.push("a.user_id = ?");
    p.push(userId);
  }
  const since = str(req.query.since, 40);
  if (since) {
    w.push("a.created_at >= ?");
    p.push(since);
  }
  const until = str(req.query.until, 40);
  if (until) {
    w.push("a.created_at < ?");
    p.push(until);
  }
  const q = str(req.query.q, 100);
  if (q) {
    const t = `%${normText(q)}%`;
    w.push(`(norm(COALESCE(oi.name, '')) LIKE ? OR norm(COALESCE(ic.name, '')) LIKE ? OR norm(COALESCE(c.name, '')) LIKE ?
           OR norm(COALESCE(oc.name, '')) LIKE ? OR norm(COALESCE(b.name, '')) LIKE ? OR norm(COALESCE(a.old_value, '')) LIKE ?
           OR norm(COALESCE(a.new_value, '')) LIKE ? OR COALESCE(oi.code_norm, '') LIKE ?)`);
    p.push(t, t, t, t, t, t, t, `%${normCode(q)}%`);
  }
  const base = w.length ? `WHERE ${w.join(" AND ")}` : "";

  const counts = Object.fromEntries(
    all<{ cat: string; n: number }>(`SELECT ${AUDIT_CAT} AS cat, COUNT(*) AS n ${from} ${base} GROUP BY cat`, ...p).map((r) => [r.cat, r.n])
  );
  const cat = str(req.query.cat, 20);
  const where = cat ? `${base ? base + " AND" : "WHERE"} ${AUDIT_CAT} = ?` : base;
  const params = cat ? [...p, cat] : p;
  const total = cat ? (counts[cat] ?? 0) : Object.values(counts).reduce((s, n) => s + (n as number), 0);
  const rows = all(
    `SELECT a.id, a.user_id, u.login AS user_login, u.full_name AS user_name, a.action, a.entity, a.entity_id,
            a.old_value, a.new_value, a.created_at, ${AUDIT_CAT} AS cat,
            oi.name AS item_name, oi.code AS item_code, ic.id AS item_customer_id, ic.name AS item_customer,
            c.name AS customer_name, b.name AS batch_name, tu.login AS target_login,
            oc.id AS order_customer_id, oc.name AS order_customer
       ${from} ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );
  res.json({ rows, total, counts });
});
