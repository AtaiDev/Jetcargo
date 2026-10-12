/**
 * Партии: товар приходит партиями. По партии считается прибыль:
 *   ① выкуп веса   = сколько отдали за вес ($ или сом)          — расход
 *   ② доставка     = сколько отдали водителю за доставку ($ или сом) — расход
 *   ③ вес клиентам = сумма за вес из «Уведомлений» по товарам партии (считается сама)
 *                    + то, что вписали вручную ($ или сом) — доход
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

/** До копеек: $ × курс бывает дробным. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Вес клиентам по одной партии: сколько за вес выставили клиентам по её товарам. */
export interface BatchWeight {
  som: number;
  kg: number;
  /** Уже взяли на «Выдаче». */
  issued_som: number;
  /** Сообщили клиенту, но он ещё не забрал — возьмут на «Выдаче». */
  pending_som: number;
  /** По клиентам: customer_id → сом и кг. */
  customers: Record<number, { som: number; kg: number }>;
}

const idList = (s: string): number[] => {
  try {
    return (JSON.parse(s) as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
};

/**
 * Вес клиентам по партиям — сам, из того, что ввели в «Уведомлениях» (и из старых выдач,
 * где вес вписывали прямо на «Выдаче»). Партия → сом, кг, сколько уже взяли и сколько ждёт.
 *
 *  - Уведомление: вес — за посылку из товаров, о которых этим уведомлением сообщили впервые
 *    (в повторное «пришло ещё» экран кладёт все товары на складе, а вес — только за новую посылку).
 *    Напоминание без веса ничего не добавляет. Отменённые уведомления не считаются.
 *  - Выдача: вес сверх уведомлений (до уведомлений его вписывали на «Выдаче») — за выданные товары.
 *  - Товары из разных партий — сумма делится по штукам, до копеек; остаток копеек — последней доле,
 *    так что по партиям сходится ровно с тем, что выставили клиенту.
 *  - Товары без партии в партии не попадают; удалённые клиенты и товары — как везде, не считаются.
 */
export function weightByBatch(): Map<number, BatchWeight> {
  const info = new Map(
    all<{ id: number; batch_id: number | null; qty: number; issue_id: number | null }>("SELECT id, batch_id, qty, issue_id FROM v_items").map((r) => [r.id, r])
  );
  const out = new Map<number, BatchWeight>();
  const add = (batchId: number, customerId: number, som: number, kg: number, issued: boolean) => {
    const w = out.get(batchId) ?? { som: 0, kg: 0, issued_som: 0, pending_som: 0, customers: {} };
    w.som = r2(w.som + som);
    w.kg = r2(w.kg + kg);
    if (issued) w.issued_som = r2(w.issued_som + som);
    else w.pending_som = r2(w.pending_som + som);
    const c = w.customers[customerId] ?? { som: 0, kg: 0 };
    w.customers[customerId] = { som: r2(c.som + som), kg: r2(c.kg + kg) };
    out.set(batchId, w);
  };
  /** Разложить сумму и кг по партиям товаров — пропорционально штукам. */
  const spread = (ids: number[], customerId: number, som: number, kg: number, issued: boolean) => {
    const byBatch = new Map<number, number>(); // партия (0 — без партии) → штук
    for (const id of ids) {
      const it = info.get(id);
      if (it) byBatch.set(it.batch_id ?? 0, (byBatch.get(it.batch_id ?? 0) ?? 0) + Math.max(1, it.qty));
    }
    const total = [...byBatch.values()].reduce((a, q) => a + q, 0);
    if (!total || (som <= 0 && kg <= 0)) return;
    const parts = [...byBatch.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    let restSom = som;
    let restKg = kg;
    parts.forEach(([batchId, q], i) => {
      const last = i === parts.length - 1;
      const s = last ? r2(restSom) : r2((som * q) / total);
      const k = last ? r2(restKg) : r2((kg * q) / total);
      restSom -= s;
      restKg -= k;
      if (batchId) add(batchId, customerId, s, k, issued);
    });
  };

  // Уведомления по порядку отправки: что каждое сообщило впервые.
  const notices = all<{ id: number; customer_id: number; item_ids: string; weight_som: number; weight_kg: number | null; issue_id: number | null }>(
    `SELECT n.id, n.customer_id, n.item_ids, n.weight_som, n.weight_kg, n.issue_id
       FROM notifications n JOIN customers c ON c.id = n.customer_id AND c.deleted_at IS NULL
      WHERE n.deleted_at IS NULL ORDER BY n.customer_id, n.sent_at, n.id`
  );
  const told = new Map<number, Set<number>>();
  const noticeSomByIssue = new Map<number, number>();
  for (const n of notices) {
    const ids = idList(n.item_ids);
    const seen = told.get(n.customer_id) ?? new Set<number>();
    const fresh = ids.filter((id) => !seen.has(id));
    for (const id of ids) seen.add(id);
    told.set(n.customer_id, seen);
    if (n.weight_som > 0) spread(fresh.length ? fresh : ids, n.customer_id, n.weight_som, n.weight_kg ?? 0, n.issue_id !== null);
    if (n.issue_id) noticeSomByIssue.set(n.issue_id, r2((noticeSomByIssue.get(n.issue_id) ?? 0) + n.weight_som));
  }

  // Выдачи: вес, вписанный прямо на «Выдаче», без уведомления.
  const issueItems = new Map<number, number[]>();
  for (const it of info.values()) if (it.issue_id) issueItems.set(it.issue_id, [...(issueItems.get(it.issue_id) ?? []), it.id]);
  const issues = all<{ id: number; customer_id: number; weight_som: number; weight_kg: number }>(
    `SELECT s.id, s.customer_id, s.weight_som, COALESCE(s.weight_kg, 0) AS weight_kg
       FROM issues s JOIN customers c ON c.id = s.customer_id AND c.deleted_at IS NULL
      WHERE s.deleted_at IS NULL AND s.weight_som > 0`
  );
  for (const s of issues) {
    const fromNotices = noticeSomByIssue.get(s.id) ?? 0;
    const extra = r2(s.weight_som - fromNotices);
    if (extra <= 0.005) continue;
    const kg = fromNotices > 0 ? r2((s.weight_kg * extra) / s.weight_som) : s.weight_kg;
    spread(issueItems.get(s.id) ?? [], s.customer_id, extra, kg, true);
  }
  return out;
}

/** Расчёт партии по её параметрам, товарам и весу из уведомлений. Все итоги — в сомах. */
export function calc(b: BatchRow, list: ItemView[], w?: BatchWeight) {
  const toSom = (amount: number, cur: Cur) => (cur === "usd" ? amount * b.usd_rate : amount);
  const buySom = toSom(b.buy_amount, b.buy_cur);
  const deliverySom = toSom(b.delivery_usd, b.delivery_cur);
  // Вес клиентам = из «Уведомлений» (сам) + вписанное вручную (то, что в уведомлениях не вводили).
  const autoSom = w?.som ?? 0;
  const manualSom = toSom(b.client_amount, b.client_cur);
  const clientSom = autoSom + manualSom;
  const withCost = list.filter((i) => i.cost !== null);
  const markup = withCost.reduce((s, i) => s + i.sale - (i.cost ?? 0), 0);
  return {
    items: list.length,
    qty: list.reduce((s, i) => s + i.qty, 0),
    customers: new Set(list.map((i) => i.customer_id)).size,
    sale: list.reduce((s, i) => s + i.sale, 0),
    goods_cost: withCost.reduce((s, i) => s + (i.cost ?? 0), 0),
    with_cost: withCost.length,
    buy_som: r2(buySom),
    delivery_som: r2(deliverySom),
    client_som: r2(clientSom),
    client_auto_som: r2(autoSom),
    client_auto_kg: w?.kg ?? 0,
    client_auto_issued_som: w?.issued_som ?? 0,
    client_auto_pending_som: w?.pending_som ?? 0,
    client_manual_som: r2(manualSom),
    /** Вес по клиентам партии (из уведомлений): customer_id → сом и кг. */
    client_weights: w?.customers ?? {},
    markup_som: r2(markup),
    expenses_som: r2(buySom + deliverySom),
    income_som: r2(clientSom + markup),
    profit_som: r2(clientSom + markup - buySom - deliverySom),
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

/**
 * Все партии с расчётом, новые сверху. Товары — из уже загруженного списка (для обзора).
 * last_arrival — когда пришёл последний товар партии (null — товаров ещё нет).
 */
export function batchesWithCalc(list: ItemView[]) {
  const weights = weightByBatch();
  return all<BatchRow>(`SELECT ${COLS} FROM batches WHERE deleted_at IS NULL ORDER BY id DESC`).map((b) => {
    const mine = list.filter((i) => i.batch_id === b.id);
    const arrivals = mine.map((i) => i.arrived_at).filter((d): d is string => !!d);
    return {
      batch: b,
      calc: calc(b, mine, weights.get(b.id)),
      last_arrival: arrivals.length ? arrivals.reduce((a, d) => (d > a ? d : a)) : null,
    };
  });
}

batchesRouter.get("/batches", (_req, res) => {
  const rows = all<BatchRow>(`SELECT ${COLS} FROM batches WHERE deleted_at IS NULL ORDER BY id DESC`);
  const weights = weightByBatch();
  res.json(rows.map((b) => ({ ...b, calc: calc(b, batchItems(b.id), weights.get(b.id)) })));
});

batchesRouter.get("/batches/:id", (req, res) => {
  const b = batchOr404(Number(req.params.id));
  const list = batchItems(b.id);
  res.json({ batch: b, calc: calc(b, list, weightByBatch().get(b.id)), items: list });
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
  audit(req, "update", "batch", id, old.name, Object.keys(b).join(", "));
  const nb = batchOr404(id);
  res.json({ batch: nb, calc: calc(nb, batchItems(id), weightByBatch().get(id)) });
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
