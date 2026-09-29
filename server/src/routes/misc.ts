/** Глобальный поиск, настройки и журнал действий. */
import { Router } from "express";

import { all, run } from "../db";
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

miscRouter.get("/audit", (req, res) => {
  requireAdmin(req);
  const action = str(req.query.action) || null;
  const limit = Math.min(optInt(req.query.limit) ?? 200, 1000);
  res.json(
    all(
      `SELECT a.*, u.login AS user_login FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE (? IS NULL OR a.action = ?) ORDER BY a.id DESC LIMIT ?`,
      action, action, limit
    )
  );
});
