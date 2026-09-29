/**
 * Партии: товар приходит партиями. По партии считается прибыль:
 *   ① выкуп веса   = сколько отдали за вес ($ или сом)          — расход
 *   ② доставка     = сколько отдали водителю за доставку ($ или сом) — расход
 *   ③ вес клиентам = общая сумма, которую взяли с клиентов за вес ($ или сом) — доход
 *   ④ наценка      = Σ (Сумма − Реальная цена) по товарам партии, сом — доход
 *   Прибыль партии = ③ + ④ − ① − ②  (всё в сомах, $ переводятся по курсу)
 */
import { Router } from "express";

import { all, get, run, tx, type Param } from "../db";
import { audit, itemOr404, items, requireAdmin, type ItemView } from "../domain";
import { badRequest, conflict, notFound, num, nowIso, optInt, str } from "../util";

export const batchesRouter = Router();

type Cur = "usd" | "som";

interface BatchRow {
  id: number;
  name: string;
  status: "open" | "closed";
  weight_buy_kg: number;
  rate_buy_usd: number;
  delivery_usd: number;
  weight_client_kg: number;
  rate_client_usd: number;
  usd_rate: number;
  buy_amount: number;
  buy_cur: Cur;
  delivery_cur: Cur;
  client_amount: number;
  client_cur: Cur;
  comment: string;
  created_at: string;
}

const COLS = "id, name, status, weight_buy_kg, rate_buy_usd, delivery_usd, weight_client_kg, rate_client_usd, usd_rate, buy_amount, buy_cur, delivery_cur, client_amount, client_cur, comment, created_at";

/** Расчёт партии по её параметрам и товарам. Все итоги — в сомах. */
export function calc(b: BatchRow, list: ItemView[]) {
  const toSom = (amount: number, cur: Cur) => (cur === "usd" ? amount * b.usd_rate : amount);
  const buySom = toSom(b.buy_amount, b.buy_cur);
  const deliverySom = toSom(b.delivery_usd, b.delivery_cur);
  const clientSom = toSom(b.client_amount, b.client_cur);
  const withCost = list.filter((i) => i.cost !== null);
  const markup = withCost.reduce((s, i) => s + i.sale - (i.cost ?? 0), 0);
  return {
    items: list.length,
    qty: list.reduce((s, i) => s + i.qty, 0),
    customers: new Set(list.map((i) => i.customer_id)).size,
    sale: list.reduce((s, i) => s + i.sale, 0),
    goods_cost: withCost.reduce((s, i) => s + (i.cost ?? 0), 0),
    with_cost: withCost.length,
    buy_som: Math.round(buySom),
    delivery_som: Math.round(deliverySom),
    client_som: Math.round(clientSom),
    markup_som: Math.round(markup),
    expenses_som: Math.round(buySom + deliverySom),
    income_som: Math.round(clientSom + markup),
    profit_som: Math.round(clientSom + markup - buySom - deliverySom),
    in_stock: list.filter((i) => i.status === "in_stock").length,
    issued: list.filter((i) => i.status === "issued").length,
  };
}

function batchOr404(id: number): BatchRow {
  const b = get<BatchRow>(`SELECT ${COLS} FROM batches WHERE id = ? AND deleted_at IS NULL`, id);
  if (!b) throw notFound("Партия");
  return b;
}

const batchItems = (id: number) => items("batch_id = ?", [id], "ORDER BY arrived_at DESC, id DESC");

batchesRouter.get("/batches", (_req, res) => {
  const rows = all<BatchRow>(`SELECT ${COLS} FROM batches WHERE deleted_at IS NULL ORDER BY id DESC`);
  res.json(rows.map((b) => ({ ...b, calc: calc(b, batchItems(b.id)) })));
});

batchesRouter.get("/batches/:id", (req, res) => {
  const b = batchOr404(Number(req.params.id));
  const list = batchItems(b.id);
  res.json({ batch: b, calc: calc(b, list), items: list });
});

batchesRouter.post("/batches", (req, res) => {
  const b = req.body ?? {};
  // Суммы по умолчанию в сомах; курс (для полей в $) — как в последней партии.
  const prev = get<BatchRow>(`SELECT ${COLS} FROM batches WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1`);
  const usd = Number(get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'usd_rate'")?.value ?? 87.5);
  const d = new Date();
  const name = str(b.name, 120) || `Партия от ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  const id = run(
    `INSERT INTO batches (name, usd_rate, buy_cur, delivery_cur, client_cur, created_by) VALUES (?, ?, 'som', 'som', 'som', ?)`,
    name, prev?.usd_rate ?? usd, req.user!.id
  );
  audit(req, "create", "batch", id, null, name);
  res.json(batchOr404(id));
});

const NUM_FIELDS = ["buy_amount", "delivery_usd", "client_amount", "usd_rate"] as const;
const CUR_FIELDS = ["buy_cur", "delivery_cur", "client_cur"] as const;

batchesRouter.patch("/batches/:id", (req, res) => {
  const id = Number(req.params.id);
  const old = batchOr404(id);
  const b = req.body ?? {};
  const sets: string[] = [];
  const p: Param[] = [];
  for (const f of NUM_FIELDS) {
    if (b[f] === undefined) continue;
    const v = num(String(b[f]).replace(",", "."), f);
    if (f === "usd_rate" && v <= 0) throw badRequest("Курс должен быть больше нуля");
    sets.push(`${f} = ?`);
    p.push(v);
  }
  for (const f of CUR_FIELDS) {
    if (b[f] === undefined) continue;
    if (!["usd", "som"].includes(b[f])) throw badRequest("Валюта: usd или som");
    sets.push(`${f} = ?`);
    p.push(b[f]);
  }
  if (b.name !== undefined) {
    const name = str(b.name, 120);
    if (!name) throw badRequest("Укажите название партии");
    sets.push("name = ?");
    p.push(name);
  }
  if (b.comment !== undefined) {
    sets.push("comment = ?");
    p.push(str(b.comment, 1000));
  }
  if (b.status !== undefined) {
    if (!["open", "closed"].includes(b.status)) throw badRequest("Статус: open или closed");
    sets.push("status = ?");
    p.push(b.status);
  }
  if (sets.length) run(`UPDATE batches SET ${sets.join(", ")} WHERE id = ?`, ...p, id);
  if (b.usd_rate !== undefined) {
    run("INSERT INTO app_settings (key, value) VALUES ('usd_rate', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", String(b.usd_rate));
  }
  audit(req, "update", "batch", id, old.name, Object.keys(b).join(", "));
  const nb = batchOr404(id);
  res.json({ batch: nb, calc: calc(nb, batchItems(id)) });
});

/** Удалить партию можно, только если в ней нет товаров (мягко). */
batchesRouter.delete("/batches/:id", (req, res) => {
  requireAdmin(req);
  const b = batchOr404(Number(req.params.id));
  if (batchItems(b.id).length) throw conflict("Сначала уберите товары из партии");
  run("UPDATE batches SET deleted_at = ? WHERE id = ?", nowIso(), b.id);
  audit(req, "delete", "batch", b.id, b.name, null);
  res.json({ ok: true });
});

/** Добавить товары в партию (товар может быть только в одной партии — перенос из другой). */
batchesRouter.post("/batches/:id/items", (req, res) => {
  const id = Number(req.params.id);
  batchOr404(id);
  const ids: number[] = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map(Number) : [];
  if (!ids.length) throw badRequest("Не выбраны товары");
  tx(() => {
    for (const itemId of ids) {
      itemOr404(itemId);
      run("UPDATE order_items SET batch_id = ?, updated_at = ? WHERE id = ?", id, nowIso(), itemId);
    }
  });
  audit(req, "batch_add", "batch", id, null, { items: ids });
  res.json({ added: ids.length });
});

batchesRouter.post("/batches/:id/items/remove", (req, res) => {
  const id = Number(req.params.id);
  batchOr404(id);
  const ids: number[] = Array.isArray(req.body?.item_ids) ? req.body.item_ids.map(Number) : [];
  if (!ids.length) throw badRequest("Не выбраны товары");
  tx(() => {
    for (const itemId of ids) run("UPDATE order_items SET batch_id = NULL, updated_at = ? WHERE id = ? AND batch_id = ?", nowIso(), itemId, id);
  });
  audit(req, "batch_remove", "batch", id, null, { items: ids });
  res.json({ removed: ids.length });
});

/**
 * Кандидаты в партию: принятые на склад (или уже выданные) товары без партии,
 * по дню поступления (since/until — локальные границы дня в ISO).
 */
batchesRouter.get("/batches-candidates", (req, res) => {
  const since = str(req.query.since, 40);
  const until = str(req.query.until, 40);
  const w = ["batch_id IS NULL", "arrived_at IS NOT NULL"];
  const p: Param[] = [];
  if (since) {
    w.push("arrived_at >= ?");
    p.push(since);
  }
  if (until) {
    w.push("arrived_at < ?");
    p.push(until);
  }
  const limit = Math.min(optInt(req.query.limit) ?? 300, 1000);
  res.json(items(w.join(" AND "), p, `ORDER BY arrived_at DESC, id DESC LIMIT ${limit}`));
});
