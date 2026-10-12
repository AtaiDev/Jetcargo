/**
 * Уведомления клиентам о поступлении товара (WhatsApp).
 *
 *  - список клиентов с товаром на складе: что лежит, на какую сумму, сколько не оплачено и
 *    уведомлён ли клиент (и нет ли новых товаров после уведомления);
 *  - уведомление: вес посылки × цена за кг × курс (до копеек) + долг за товар на складе = к оплате.
 *    Сообщение формирует экран и открывает WhatsApp; сервер запоминает, что, когда и на какую
 *    сумму отправлено. Сумма за вес берётся потом на «Выдаче» (см. pendingNotices) — не теряется;
 *  - ошибочное уведомление можно отменить, пока по нему не было выдачи.
 */
import { Router } from "express";

import { all, get, run } from "../db";
import { audit, items, pendingNotices, type ItemView } from "../domain";
import { badRequest, conflict, notFound, nowIso, num, str } from "../util";
import { customerOr404 } from "./customers";
import { settings, weightCharge } from "./misc";

export const notifyRouter = Router();

interface NoticeRow {
  id: number;
  customer_id: number;
  item_ids: string;
  items_count: number;
  goods_sum: number;
  goods_debt: number;
  weight_kg: number | null;
  weight_som: number;
  total: number;
  sent_at: string;
  issue_id: number | null;
  user_login: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Вверх до целого сома: 100,01 → 101. Сначала до копеек — чтобы 700,0000001 не стало 701. */
export const ceilSom = (n: number) => Math.ceil(r2(n) - 1e-9);
const idsOf = (n: NoticeRow): number[] => {
  try {
    return (JSON.parse(n.item_ids) as unknown[]).map(Number).filter(Number.isFinite);
  } catch {
    return [];
  }
};

const NOTICE_COLS = `n.id, n.customer_id, n.item_ids, n.items_count, n.goods_sum, n.goods_debt, n.weight_kg, n.weight_som,
  n.total, n.sent_at, n.issue_id, u.login AS user_login`;

/** Клиенты с товаром на складе и их уведомления (ещё не выданные). */
notifyRouter.get("/notify", (_req, res) => {
  const stock = items("status = 'in_stock'", [], "ORDER BY customer_id, arrived_at, id");
  const byCustomer = new Map<number, ItemView[]>();
  for (const it of stock) byCustomer.set(it.customer_id, [...(byCustomer.get(it.customer_id) ?? []), it]);

  const notices = all<NoticeRow>(
    `SELECT ${NOTICE_COLS} FROM notifications n LEFT JOIN users u ON u.id = n.user_id
      WHERE n.deleted_at IS NULL AND n.issue_id IS NULL ORDER BY n.sent_at DESC, n.id DESC`
  );

  const rows = [...byCustomer.entries()].map(([customerId, list]) => {
    const first = list[0];
    const mine = notices.filter((n) => n.customer_id === customerId);
    const covered = new Set(mine.flatMap(idsOf));
    const fresh = list.filter((i) => !covered.has(i.id));
    return {
      id: customerId,
      name: first.customer_name,
      phone: first.customer_phone,
      items: list.map((i) => ({ id: i.id, name: i.name, code: i.code, qty: i.qty, sale: i.sale, debt: i.debt, arrived_at: i.arrived_at, notified: covered.has(i.id) })),
      stock_sale: r2(list.reduce((s, i) => s + i.sale, 0)),
      stock_debt: r2(list.reduce((s, i) => s + i.debt, 0)),
      first_arrived: list.reduce<string | null>((a, i) => (i.arrived_at && (!a || i.arrived_at < a) ? i.arrived_at : a), null),
      notices: mine.map((n) => ({ ...n, item_ids: idsOf(n) })),
      fresh: fresh.length,
      // new — ещё не уведомлён; more — уведомлён, но потом пришли новые товары; sent — всё сообщено.
      status: !mine.length ? "new" : fresh.length ? "more" : "sent",
    };
  });
  // Сначала — кого ещё не уведомили (дольше всех ждут — выше), потом остальные.
  const rank = { new: 0, more: 1, sent: 2 } as const;
  rows.sort((a, b) => rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank] || (a.first_arrived ?? "").localeCompare(b.first_arrived ?? ""));
  const s = settings();
  res.json({ rows, tariff: { weight_rate_usd: s.weight_rate_usd, usd_rate: s.usd_rate, weight_rate_som: s.weight_rate_som }, pickup_address: s.pickup_address });
});

/**
 * Записать отправленное уведомление. Сумму за вес считает сервер по текущему тарифу и сверяет
 * с той, что была в сообщении; товары — только те, что сейчас на складе у этого клиента.
 */
notifyRouter.post("/notify", (req, res) => {
  const b = req.body ?? {};
  const customerId = Number(b.customer_id);
  customerOr404(customerId);
  const ids: number[] = Array.isArray(b.item_ids) ? [...new Set((b.item_ids as unknown[]).map(Number))].filter((n) => Number.isInteger(n) && n > 0) : [];
  if (!ids.length) throw badRequest("Нет товаров для уведомления");
  const list = items(`customer_id = ? AND status = 'in_stock' AND id IN (${ids.map(() => "?").join(",")})`, [customerId, ...ids]);
  if (list.length !== ids.length) throw conflict("Часть товаров уже не на складе — обновите страницу");

  const kg = b.weight_kg === undefined || b.weight_kg === null || b.weight_kg === "" ? 0 : Math.round(num(b.weight_kg, "Вес") * 100) / 100;
  if (kg > 10000) throw badRequest("Слишком большой вес");
  const t = settings();
  // Вес × цена 1 кг в сомах (прайс, целым сомом), вверх до сома: 3,42 × 247 = 844,74 → 845.
  // Именно эту сумму возьмут на «Выдаче».
  const weightSom = weightCharge(kg, t.weight_rate_som);
  if (b.weight_som !== undefined && Math.abs(Number(b.weight_som) - weightSom) > 0.005) {
    throw conflict(`Тариф за вес изменился — сейчас ${String(kg).replace(".", ",")} кг = ${String(weightSom).replace(".", ",")} с. Обновите страницу`);
  }
  const goodsSum = r2(list.reduce((s, i) => s + i.sale, 0));
  const goodsDebt = r2(list.reduce((s, i) => s + i.debt, 0));
  const total = ceilSom(weightSom + goodsDebt);

  const id = run(
    `INSERT INTO notifications (customer_id, item_ids, items_count, goods_sum, goods_debt, weight_kg, weight_rate_usd, weight_usd_rate,
                                weight_som, total, message, phone, sent_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    customerId, JSON.stringify(ids), list.length, goodsSum, goodsDebt, kg || null, kg ? t.weight_rate_usd : null, kg ? t.usd_rate : null,
    weightSom, total, str(b.message, 4000), str(b.phone, 50), nowIso(), req.user!.id
  );
  audit(req, "notify", "customer", customerId, null, { notice_id: id, items: list.length, weight_kg: kg, weight_som: weightSom, total });
  res.json({ id, weight_som: weightSom, goods_debt: goodsDebt, total });
});

/** Отменить ошибочное уведомление — пока по нему не выдали товар. */
notifyRouter.delete("/notify/:id", (req, res) => {
  const n = get<{ id: number; customer_id: number; issue_id: number | null; deleted_at: string | null; weight_som: number }>(
    "SELECT id, customer_id, issue_id, deleted_at, weight_som FROM notifications WHERE id = ?",
    Number(req.params.id)
  );
  if (!n || n.deleted_at) throw notFound("Уведомление");
  if (n.issue_id) throw conflict("По этому уведомлению уже выдали товар — отменить нельзя");
  run("UPDATE notifications SET deleted_at = ? WHERE id = ?", nowIso(), n.id);
  audit(req, "notify_cancel", "customer", n.customer_id, { notice_id: n.id, weight_som: n.weight_som }, null);
  res.json({ ok: true });
});

/** Вес по уведомлениям клиента, который ещё не взяли (для «Выдачи»). */
notifyRouter.get("/notify/pending/:customerId", (req, res) => {
  res.json(pendingNotices(Number(req.params.customerId)));
});
