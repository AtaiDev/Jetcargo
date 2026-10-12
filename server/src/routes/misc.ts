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

/**
 * Цена 1 кг в сомах — прайс для клиента: $ за кг × курс, вверх до целого сома (2,8 $ × 88 = 246,40 → 247).
 * Сумма за вес = вес × эта цена, вверх до целого сома (3,42 × 247 = 844,74 → 845) — клиент может
 * проверить на калькуляторе. Одна формула для сервера и экрана.
 */
export const weightRateSom = (rateUsd: number, usdRate: number) => Math.ceil(Math.round(rateUsd * usdRate * 100) / 100 - 1e-9);
export const weightCharge = (kg: number, rateSom: number) => (kg > 0 ? Math.ceil(Math.round(kg * rateSom * 100) / 100 - 1e-9) : 0);

export function settings() {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM app_settings");
  const v = (k: string) => rows.find((r) => r.key === k)?.value;
  const weightRateUsd = Number(v("weight_rate_usd") ?? 2.8);
  const usdRate = Number(v("usd_rate") ?? 87.5);
  return {
    cny_rate: Number(v("cny_rate") ?? 13),
    // Вес посылки: $ за кг и курс доллара (сом за 1 $; он же — курс по умолчанию для новых партий).
    weight_rate_usd: weightRateUsd,
    usd_rate: usdRate,
    // Цена 1 кг для клиента, целым сомом (см. weightRateSom).
    weight_rate_som: weightRateSom(weightRateUsd, usdRate),
    // Где забирать товар — пишется в уведомлении клиенту.
    pickup_address: v("pickup_address") ?? "",
  };
}

const setSetting = (key: string, value: number) =>
  run("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, String(value));

miscRouter.get("/settings", (_req, res) => {
  res.json(settings());
});

miscRouter.patch("/settings", (req, res) => {
  requireAdmin(req);
  const b = req.body ?? {};
  if (b.cny_rate !== undefined) {
    const rate = num(b.cny_rate, "Курс юаня");
    if (rate <= 0) throw badRequest("Курс юаня должен быть больше нуля");
    setSetting("cny_rate", rate);
  }
  if (b.weight_rate_usd !== undefined) {
    const rate = num(b.weight_rate_usd, "Цена за кг");
    if (rate <= 0 || rate > 1000) throw badRequest("Цена за кг — больше нуля");
    setSetting("weight_rate_usd", rate);
  }
  if (b.pickup_address !== undefined) {
    run("INSERT INTO app_settings (key, value) VALUES ('pickup_address', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", str(b.pickup_address, 200));
  }
  if (b.usd_rate !== undefined) {
    const rate = num(b.usd_rate, "Курс доллара");
    if (rate <= 0 || rate > 100000) throw badRequest("Курс доллара должен быть больше нуля");
    setSetting("usd_rate", rate);
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
  // Фильтр по сотруднику добавляется последним: сводка «по сотрудникам» считается без него.
  const w: string[] = ["a.deleted_at IS NULL"];
  const p: Param[] = [];
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
  const cat = str(req.query.cat, 20);
  // Без сотрудника, но с разделом — для сводки «кто сколько сделал».
  const byUserWhere = `WHERE ${[...w, ...(cat ? [`${AUDIT_CAT} = ?`] : [])].join(" AND ")}`;
  const byUserParams = cat ? [...p, cat] : [...p];
  const userId = optInt(req.query.user_id);
  if (userId) {
    w.push("a.user_id = ?");
    p.push(userId);
  }
  const base = `WHERE ${w.join(" AND ")}`;

  const counts = Object.fromEntries(
    all<{ cat: string; n: number }>(`SELECT ${AUDIT_CAT} AS cat, COUNT(*) AS n ${from} ${base} GROUP BY cat`, ...p).map((r) => [r.cat, r.n])
  );
  const where = cat ? `${base} AND ${AUDIT_CAT} = ?` : base;
  const params = cat ? [...p, cat] : p;
  const total = cat ? (counts[cat] ?? 0) : Object.values(counts).reduce((s, n) => s + (n as number), 0);

  // Сводки для боковой панели — только на первой странице. Дни и часы — в поясе клиента (tz — минуты к UTC).
  let summary = {};
  if (offset === 0) {
    const tz = Math.max(-840, Math.min(840, optInt(req.query.tz) ?? 0));
    const shift = `${tz >= 0 ? "+" : ""}${tz} minutes`;
    summary = {
      by_day: all<{ day: string; n: number }>(`SELECT date(a.created_at, ?) AS day, COUNT(*) AS n ${from} ${where} GROUP BY day ORDER BY day`, shift, ...params),
      by_hour: all<{ hour: number; n: number }>(
        `SELECT CAST(strftime('%H', a.created_at, ?) AS INTEGER) AS hour, COUNT(*) AS n ${from} ${where} GROUP BY hour ORDER BY hour`,
        shift, ...params
      ),
      by_user: all<{ user_id: number | null; n: number }>(`SELECT a.user_id, COUNT(*) AS n ${from} ${byUserWhere} GROUP BY a.user_id ORDER BY n DESC`, ...byUserParams),
    };
  }
  const rows = all(
    `SELECT a.id, a.user_id, u.login AS user_login, u.full_name AS user_name, a.action, a.entity, a.entity_id,
            a.old_value, a.new_value, a.created_at, ${AUDIT_CAT} AS cat,
            oi.name AS item_name, oi.code AS item_code, ic.id AS item_customer_id, ic.name AS item_customer,
            c.name AS customer_name, b.name AS batch_name, tu.login AS target_login,
            oc.id AS order_customer_id, oc.name AS order_customer
       ${from} ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );
  res.json({ rows, total, counts, ...summary });
});
