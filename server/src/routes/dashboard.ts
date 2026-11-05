/**
 * Дашборд и финансы. Все цифры — из базы, ничего не подставляется.
 *
 * Правила расчёта (одни на весь проект):
 *  - сумма заказов = «Сумма» (цена для клиента); относится к дате заказа;
 *  - оплачено = сумма неотменённых оплат (не больше продажи), долг = продажа − оплачено;
 *  - выкуп (себестоимость) = «Реальная цена» — за сколько товар куплен на маркетплейсе;
 *    прибыль = Сумма − Реальная цена, только по товарам, где реальная цена указана —
 *    поэтому рядом всегда отдаём with_cost (сколько товаров учтено);
 *  - партия: вес клиентам − выкуп веса − доставка относятся к дню, когда пришёл её последний товар
 *    (идущая партия — к сегодняшним приходам; партия без товаров — к дню создания);
 *    общая прибыль = наценка на товары + вес при выдаче + (вес клиентам − выкуп веса − доставка).
 *    Наценку партии отдельно не прибавляем — это та же наценка её товаров;
 *  - вес при выдаче: кг × $ за кг × курс, оплачивается сразу — доход и поступление в день выдачи.
 */
import { Router } from "express";

import { all, get, run } from "../db";
import { items, openDebt, openDebtSql, requireAdmin, totals, type ItemView } from "../domain";
import { addDays, conflict, dayList, localDay, notFound, parseDate, today } from "../util";
import { batchesWithCalc } from "./batches";

export const dashboardRouter = Router();

const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
/** До копеек: суммы с весом и курсом бывают дробными (246,40 с). */
const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

function monthStart(d: string) {
  return `${d.slice(0, 7)}-01`;
}

function lastMonths(n: number, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${monthStart(to)}T00:00:00`);
  for (let i = 0; i < n; i++) {
    out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function period(q: Record<string, unknown>) {
  const to = q.date_to ? parseDate(q.date_to, "date_to") : today();
  const from = q.date_from ? parseDate(q.date_from, "date_from") : monthStart(to);
  if (from > to) throw conflict("Начало периода позже конца");
  return { from, to };
}

const inRange = (list: ItemView[], from: string, to: string) => list.filter((i) => i.order_date >= from && i.order_date <= to);
const sum = (list: ItemView[]) => list.reduce((s, i) => s + i.sale, 0);

function byMonth(list: ItemView[], months: string[]) {
  return months.map((m) => {
    const t = totals(list.filter((i) => i.order_date.startsWith(m)));
    return { month: m, month_label: monthLabel(m), sale: t.sale, paid: t.paid, debt: t.debt, cost: t.cost, profit: t.profit, with_cost: t.with_cost, items: t.items };
  });
}

const s = (measure: string, color: string | null, extra: Record<string, unknown> = {}) => ({
  measure, label: null, color, type: null, axis: null, ...extra,
});

const STATUS_LABEL: Record<string, string> = { ordered: "Заказан", in_stock: "На складе", issued: "Выдан" };

type BatchCalc = ReturnType<typeof batchesWithCalc>[number];

/** День партии: приход последнего товара, а пока товаров нет — день создания. */
const batchDay = (b: BatchCalc) => localDay(b.last_arrival ?? b.batch.created_at);

/**
 * Деньги партий периода (сом): вес, вписанный в партиях вручную, выкуп веса, доставка.
 * Вес из «Уведомлений» здесь не берём — он уже в «Вес при выдаче» (в день выдачи), иначе задвоится.
 */
function batchMoney(bs: BatchCalc[], from: string, to: string) {
  const inPeriod = bs.filter((b) => {
    const d = batchDay(b);
    return d >= from && d <= to;
  });
  const sumOf = (k: "client_manual_som" | "buy_som" | "delivery_som") => r2(inPeriod.reduce((a, b) => a + b.calc[k], 0));
  return { count: inPeriod.length, client: sumOf("client_manual_som"), buy: sumOf("buy_som"), delivery: sumOf("delivery_som") };
}

/** Вес, взятый при выдаче (кг и сомы), по дням выдачи; у удалённых клиентов не считаем. */
function issueWeights() {
  return all<{ issued_at: string; kg: number; som: number; method: string }>(
    `SELECT s.issued_at, COALESCE(s.weight_kg, 0) AS kg, s.weight_som AS som, s.weight_method AS method
       FROM issues s JOIN customers c ON c.id = s.customer_id
      WHERE c.deleted_at IS NULL AND s.deleted_at IS NULL AND s.weight_som > 0`
  );
}
type IssueWeight = ReturnType<typeof issueWeights>[number];
const weightIn = (ws: IssueWeight[], from: string, to: string) => {
  const list = ws.filter((w) => localDay(w.issued_at) >= from && localDay(w.issued_at) <= to);
  return { som: r2(list.reduce((a, w) => a + w.som, 0)), kg: Math.round(list.reduce((a, w) => a + w.kg, 0) * 100) / 100, count: list.length };
};

/** Общая прибыль за период: наценка (по дате заказа) + вес при выдаче + вес − выкуп веса − доставка (по партиям периода). */
function profitFor(list: ItemView[], bs: BatchCalc[], ws: IssueWeight[], from: string, to: string) {
  const t = totals(inRange(list, from, to));
  const b = batchMoney(bs, from, to);
  const w = weightIn(ws, from, to);
  return {
    goods: r2(t.profit),
    goods_items: t.with_cost,
    items: t.items,
    batches: b.count,
    client: b.client,
    buy: b.buy,
    delivery: b.delivery,
    issue_weight: w.som,
    issue_weight_kg: w.kg,
    total: r2(t.profit + w.som + b.client - b.buy - b.delivery),
  };
}

/** Изменение в % к прошлому: null — сравнивать не с чем (в прошлом ноль или минус). */
const pctChange = (now: number, before: number) => (before > 0 ? r2(((now - before) / before) * 100) : null);
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Главный экран «Обзор» (верх страницы): карточки, шкала оплаты, суммы по месяцам,
 * работа склада по времени и товары по этапам. Те же правила расчёта, что и везде.
 */
function homeBoard(list: ItemView[], bs: BatchCalc[], ws: IssueWeight[], from: string, to: string) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);
  const prev2From = addDays(from, -2 * days);
  const prev2To = addDays(from, -days - 1);
  const cur = totals(inRange(list, from, to));
  const prev = totals(inRange(list, prevFrom, prevTo));
  const prev2 = totals(inRange(list, prev2From, prev2To));

  // 1. Сумма заказов: этот период и два прошлых таких же — столбиками.
  const sales = { value: r2(cur.sale), delta: pctChange(cur.sale, prev.sale), bars: [prev2.sale, prev.sale, cur.sale].map(r2) };

  // 2. Прибыль: итог периода и как она шла — до 8 отрезков периода.
  const profitNow = profitFor(list, bs, ws, from, to).total;
  const profitPrev = profitFor(list, bs, ws, prevFrom, prevTo).total;
  const dl = dayList(from, to);
  const parts = Math.max(1, Math.min(8, dl.length));
  const spark = Array.from({ length: parts }, (_, k) => {
    const a = dl[Math.floor((k * dl.length) / parts)];
    const b = dl[Math.floor(((k + 1) * dl.length) / parts) - 1];
    return profitFor(list, bs, ws, a, b).total;
  });
  const profit = { value: profitNow, delta: pctChange(profitNow, profitPrev), spark };

  // 3. Принято на склад за период (по дню прихода); кольцо — сколько из них уже выдано.
  const arrivedIn = (a: string, b: string) => list.filter((i) => i.arrived_at && localDay(i.arrived_at) >= a && localDay(i.arrived_at) <= b);
  const arr = arrivedIn(from, to);
  const arrPrev = arrivedIn(prevFrom, prevTo);
  const arrived = {
    value: arr.length,
    qty: arr.reduce((a, i) => a + i.qty, 0),
    delta: pctChange(arr.length, arrPrev.length),
    issued: arr.filter((i) => i.status === "issued").length,
  };

  // 4. Долг клиентов сейчас; столбики — долг по неделям заказа, последние 10 недель.
  const t = today();
  const debtItems = list.filter((i) => openDebt(i) > 0);
  const debtWeeks = Array.from({ length: 10 }, (_, k) => {
    const end = addDays(t, -7 * (9 - k));
    const start = addDays(end, -6);
    return r2(debtItems.filter((i) => i.order_date >= start && i.order_date <= end).reduce((a, i) => a + openDebt(i), 0));
  });
  const debt = {
    value: r2(debtItems.reduce((a, i) => a + openDebt(i), 0)),
    customers: new Set(debtItems.map((i) => i.customer_id)).size,
    items: debtItems.length,
    weeks: debtWeeks,
  };

  // Шкала: сколько процентов суммы заказов периода уже оплачено (выданное — оплачено).
  const paidPct = cur.sale > 0 ? (cur.paid / cur.sale) * 100 : null;
  const prevPaidPct = prev.sale > 0 ? (prev.paid / prev.sale) * 100 : null;
  const gauge = {
    score: paidPct === null ? null : Math.round(paidPct),
    delta: paidPct !== null && prevPaidPct !== null ? Math.round(paidPct - prevPaidPct) : null,
    sale: r2(cur.sale),
    paid: r2(cur.paid),
    debt: r2(cur.debt),
    unpaid_items: cur.unpaid_items,
  };

  // Сумма заказов по месяцам: год, где конец периода, и прошлый год.
  const year = Number(to.slice(0, 4));
  const months = (y: number) =>
    Array.from({ length: 12 }, (_, m) => {
      const ym = `${y}-${pad2(m + 1)}`;
      const inM = list.filter((i) => i.order_date.startsWith(ym));
      const tm = totals(inM);
      return {
        month: ym,
        sale: r2(tm.sale),
        orders: new Set(inM.map((i) => i.order_id)).size,
        items: tm.items,
        profit: profitFor(list, bs, ws, `${ym}-01`, `${ym}-31`).total,
      };
    });

  // Работа склада по времени — последние 4 недели: принято (по приходу) и выдано (по выдаче).
  // Время — местное (на проде часовой пояс Бишкека); слоты как на макете: 0–8, 8–12, 12–16, 16–24.
  const since = addDays(t, -27);
  const slotOf = (h: number) => (h < 8 ? 0 : h < 12 ? 1 : h < 16 ? 2 : 3);
  const heat = Array.from({ length: 4 }, () => Array.from({ length: 7 }, () => ({ arrived: 0, issued: 0 })));
  const put = (iso: string | null, k: "arrived" | "issued") => {
    if (!iso || localDay(iso) < since || localDay(iso) > t) return;
    const d = new Date(iso);
    heat[slotOf(d.getHours())][(d.getDay() + 6) % 7][k]++;
  };
  for (const i of list) {
    put(i.arrived_at, "arrived");
    put(i.issued_at, "issued");
  }

  // Товары периода по этапам — для кольца.
  const inP = inRange(list, from, to);
  const stages = {
    total: inP.length,
    delta: pctChange(inP.length, inRange(list, prevFrom, prevTo).length),
    ordered: inP.filter((i) => i.stage === "ordered").length,
    in_transit: inP.filter((i) => i.stage === "in_transit").length,
    in_stock: inP.filter((i) => i.stage === "in_stock").length,
    issued: inP.filter((i) => i.stage === "issued").length,
  };

  // «Требует внимания» — что сделать сейчас (не зависит от периода).
  const stock = list.filter((i) => i.status === "in_stock");
  // Уведомлено = все товары клиента на складе есть в действующих уведомлениях (как на «Уведомлениях»).
  const told = new Map<number, Set<number>>();
  for (const n of all<{ customer_id: number; item_ids: string }>(
    "SELECT customer_id, item_ids FROM notifications WHERE deleted_at IS NULL AND issue_id IS NULL"
  )) {
    let ids: number[] = [];
    try {
      ids = (JSON.parse(n.item_ids) as unknown[]).map(Number);
    } catch {
      /* битая запись — как будто товаров нет */
    }
    const set = told.get(n.customer_id) ?? new Set<number>();
    ids.forEach((id) => set.add(id));
    told.set(n.customer_id, set);
  }
  const notTold = stock.filter((i) => !told.get(i.customer_id)?.has(i.id));
  const ready = stock.filter((i) => openDebt(i) <= 0);
  const staleDays = 14;
  const staleFrom = addDays(t, -staleDays);
  const stale = stock.filter((i) => i.arrived_at && localDay(i.arrived_at) < staleFrom);
  const oldest = stale.reduce<string | null>((a, i) => (!a || (i.arrived_at as string) < a ? (i.arrived_at as string) : a), null);
  const noBatch = list.filter((i) => i.status !== "ordered" && !i.batch_id);
  const noCost = list.filter((i) => i.cost === null);
  const noCode = list.filter((i) => i.status !== "issued" && !(i.code ?? "").trim());
  const cust = (l: ItemView[]) => new Set(l.map((i) => i.customer_id)).size;
  const todo = {
    notify: { items: notTold.length, customers: cust(notTold) },
    ready: { items: ready.length, customers: cust(ready), total: stock.length },
    stale: { items: stale.length, customers: cust(stale), days: staleDays, oldest_days: oldest ? Math.round((Date.parse(t) - Date.parse(localDay(oldest))) / 86400000) : 0 },
    no_batch: { items: noBatch.length, sale: r2(noBatch.reduce((a, i) => a + i.sale, 0)) },
    no_cost: { items: noCost.length, sale: r2(noCost.reduce((a, i) => a + i.sale, 0)), total: list.length },
    no_code: { items: noCode.length, customers: cust(noCode) },
  };

  return {
    sales,
    profit,
    arrived,
    debt,
    todo,
    gauge,
    year: { year, current: months(year), previous: months(year - 1), this_month: t.slice(0, 7) },
    heat: { since, cells: heat },
    stages,
    waiting: list.filter((i) => i.status === "in_stock").length,
  };
}

/** Поступило денег за период — по дате оплаты, без отменённых; плюс вес, оплаченный при выдаче. */
function cashIn(from: string, to: string) {
  return [
    ...all<{ amount: number; paid_at: string; method: string }>(
      `SELECT p.amount, p.paid_at, p.method FROM payments p
         JOIN v_items v ON v.id = p.order_item_id WHERE p.deleted_at IS NULL`
    ),
    ...issueWeights().map((w) => ({ amount: w.som, paid_at: w.issued_at, method: w.method })),
  ].filter((p) => localDay(p.paid_at) >= from && localDay(p.paid_at) <= to);
}

function widget(key: string, list: ItemView[], from: string, to: string, bs: BatchCalc[], ws: IssueWeight[]) {
  const inPeriod = inRange(list, from, to);
  const days = dayList(from, to);
  switch (key) {
    case "revenue_by_day":
      return {
        data: {
          dataset: "items",
          dimensions: [{ key: "day", label: "День", kind: "date" }],
          measures: [
            { key: "sale", label: "Сумма заказов", format: "money" },
            { key: "items", label: "Товаров", format: "int" },
          ],
          rows: inPeriod.length
            ? days.map((d) => {
                const l = inPeriod.filter((i) => i.order_date === d);
                return { day: d, day_label: ddmm(d), sale: sum(l), items: l.length };
              })
            : [],
        },
        series: [
          s("sale", "accent", { label: "Сумма заказов", type: "area", axis: "left" }),
          s("items", "violet", { label: "Товаров", type: "line", axis: "right" }),
        ],
      };
    case "pay_split": {
      const t = totals(inPeriod);
      const rows = [
        { pay: "paid", pay_label: "Оплачено", amount: t.paid },
        { pay: "unpaid", pay_label: "Не оплачено", amount: t.debt },
      ].filter((r) => r.amount > 0);
      return {
        data: { dataset: "items", dimensions: [{ key: "pay", label: "Оплата", kind: "category" }], measures: [{ key: "amount", label: "Сумма", format: "money" }], rows },
        series: [s("amount", "by_status")],
      };
    }
    case "revenue_by_month": {
      // Прибыль месяца — общая, как в блоке «Прибыль»: наценка на товары + партии месяца.
      const rows = byMonth(list, lastMonths(12, to))
        .map((r) => {
          const b = batchMoney(bs, `${r.month}-01`, `${r.month}-31`);
          const w = weightIn(ws, `${r.month}-01`, `${r.month}-31`);
          return { ...r, profit: r2(r.profit + w.som + b.client - b.buy - b.delivery) };
        })
        .filter((r, i, a) => r.items > 0 || a.slice(0, i).some((x) => x.items > 0));
      return {
        data: {
          dataset: "items",
          dimensions: [{ key: "month", label: "Месяц", kind: "category" }],
          measures: [
            { key: "sale", label: "Сумма заказов", format: "money" },
            { key: "profit", label: "Прибыль (наценка + вес + партии)", format: "money" },
          ],
          rows,
        },
        series: [
          s("sale", "accent", { label: "Сумма заказов", type: "bar" }),
          s("profit", "green", { label: "Прибыль", type: "bar" }),
        ],
      };
    }
    case "status_split": {
      const t = totals(list);
      const rows = (["ordered", "in_stock", "issued"] as const)
        .map((k) => ({ status: k, status_label: STATUS_LABEL[k], count: t[k] }))
        .filter((r) => r.count > 0);
      return {
        data: { dataset: "items", dimensions: [{ key: "status", label: "Статус", kind: "category" }], measures: [{ key: "count", label: "Товаров", format: "int" }], rows },
        series: [s("count", "by_status")],
      };
    }
    case "items_by_day": {
      const arrived = list.filter((i) => i.arrived_at && localDay(i.arrived_at) >= from && localDay(i.arrived_at) <= to);
      const issued = list.filter((i) => i.issued_at && localDay(i.issued_at) >= from && localDay(i.issued_at) <= to);
      const any = arrived.length + issued.length > 0;
      return {
        data: {
          dataset: "items",
          dimensions: [{ key: "day", label: "День", kind: "date" }, { key: "kind", label: "Операция", kind: "category" }],
          measures: [{ key: "count", label: "Товаров", format: "int" }],
          rows: any
            ? days.flatMap((d) => [
                { day: d, day_label: ddmm(d), kind: "in_stock", kind_label: "Поступило", count: arrived.filter((i) => localDay(i.arrived_at!) === d).length },
                { day: d, day_label: ddmm(d), kind: "issued", kind_label: "Выдано", count: issued.filter((i) => localDay(i.issued_at!) === d).length },
              ])
            : [],
        },
        series: [s("count", "by_status")],
      };
    }
    case "top_debtors":
    default: {
      // Реальные долги — только по невыданным товарам (заказан / на складе).
      // Выданные товары владелец считает закрытыми, поэтому в этот график они не входят.
      const debts = new Map<number, { name: string; debt: number }>();
      for (const i of list) {
        if (openDebt(i) <= 0) continue;
        const d = debts.get(i.customer_id) ?? { name: i.customer_name, debt: 0 };
        d.debt += i.debt;
        debts.set(i.customer_id, d);
      }
      return {
        data: {
          dataset: "customers",
          dimensions: [{ key: "customer", label: "Клиент", kind: "category" }],
          measures: [{ key: "debt", label: "Долг (не выдано)", format: "money" }],
          rows: [...debts]
            .sort((a, b) => b[1].debt - a[1].debt)
            .slice(0, 8)
            .map(([id, d]) => ({ customer: id, customer_label: d.name, debt: d.debt })),
        },
        series: [s("debt", "danger", { label: "Долг" })],
      };
    }
  }
}

interface WidgetRow {
  id: number;
  key: string;
  title: string;
  chart: string;
  span: number;
  position: number;
  is_visible: number;
  is_builtin: number;
}

dashboardRouter.get("/dashboard", (req, res) => {
  const { from, to } = period(req.query);
  const list = items();
  const t = today();
  const inPeriod = inRange(list, from, to);
  const pt = totals(inPeriod);
  const all_ = totals(list);

  const customers = get<{ total: number; new_period: number }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(substr(created_at, 1, 10) BETWEEN ? AND ?), 0) AS new_period
       FROM customers WHERE deleted_at IS NULL`,
    from, to
  )!;
  const withDebt = new Set(list.filter((i) => openDebt(i) > 0).map((i) => i.customer_id)).size;

  // Прибыль: за период и за такой же период перед ним (для сравнения).
  const bs = batchesWithCalc(list);
  const ws = issueWeights();
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);
  const prev = profitFor(list, bs, ws, prevFrom, prevTo);

  const widgets = all<WidgetRow>("SELECT * FROM cargo_widgets WHERE is_visible = 1 ORDER BY position, id").map((w) => {
    try {
      return { id: w.id, key: w.key, title: w.title, chart: w.chart, span: w.span, is_builtin: !!w.is_builtin, error: null, ...widget(w.key, list, from, to, bs, ws) };
    } catch (e) {
      return { id: w.id, key: w.key, title: w.title, chart: w.chart, span: w.span, is_builtin: !!w.is_builtin, series: [], data: null, error: String(e) };
    }
  });

  res.json({
    period: { date_from: from, date_to: to },
    // Верх «Обзора»: карточки, шкала, месяцы, работа склада по времени, этапы.
    home: homeBoard(list, bs, ws, from, to),
    profit: {
      ...profitFor(list, bs, ws, from, to),
      // Сравнивать не с чем, если в прошлом периоде не было ни товаров, ни партий, ни веса.
      previous: prev.items || prev.batches || prev.issue_weight ? prev.total : null,
    },
    // Общая прибыль за всё время — все товары и все партии, без фильтра периода.
    profit_all: (() => {
      const t = totals(list);
      // Вес из партий — только вписанный вручную: вес из «Уведомлений» уже в issue_weight.
      const sumOf = (k: "client_manual_som" | "buy_som" | "delivery_som") => r2(bs.reduce((a, b) => a + b.calc[k], 0));
      const client = sumOf("client_manual_som");
      const buy = sumOf("buy_som");
      const delivery = sumOf("delivery_som");
      const w = weightIn(ws, "0000-01-01", "9999-12-31");
      return {
        issue_weight: w.som,
        issue_weight_kg: w.kg,
        goods: r2(t.profit),
        goods_items: t.with_cost,
        items: t.items,
        batches: bs.length,
        client,
        buy,
        delivery,
        total: r2(t.profit + w.som + client - buy - delivery),
        since: list.reduce<string | null>((a, i) => (a === null || i.order_date < a ? i.order_date : a), null),
      };
    })(),
    cash_in: cashIn(from, to).reduce((a, p) => a + p.amount, 0),
    // Партии за всё время: прибыль каждой (до 30 последних) и всех вместе.
    batches: {
      count: bs.length,
      open: bs.filter((b) => b.batch.status === "open").length,
      profit: bs.reduce((a, b) => a + b.calc.profit_som, 0),
      income: bs.reduce((a, b) => a + b.calc.income_som, 0),
      expenses: bs.reduce((a, b) => a + b.calc.expenses_som, 0),
      // Новые сверху; на обзоре видно 3, остальные — прокруткой внутри блока.
      rows: bs.slice(0, 30).map(({ batch: b, calc: c, last_arrival }) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        created_at: b.created_at,
        last_arrival,
        items: c.items,
        customers: c.customers,
        client: c.client_som,
        client_auto: c.client_auto_som,
        client_manual: c.client_manual_som,
        markup: c.markup_som,
        buy: c.buy_som,
        delivery: c.delivery_som,
        income: c.income_som,
        expenses: c.expenses_som,
        profit: c.profit_som,
      })),
    },
    finance: {
      today: sum(inRange(list, t, t)),
      week: sum(inRange(list, addDays(t, -6), t)),
      month: sum(inRange(list, monthStart(t), t)),
      period: pt.sale,
      paid: pt.paid,
      unpaid: pt.debt,
      debts_total: all_.debt,
      cost: pt.cost,
      profit: pt.profit,
      with_cost: pt.with_cost,
      items_period: pt.items,
    },
    orders: {
      items_total: all_.items,
      items_period: pt.items,
      orders_period: new Set(inPeriod.map((i) => i.order_id)).size,
      new_today: list.filter((i) => localDay(i.created_at) === t).length,
      ordered: all_.ordered,
      in_stock: all_.in_stock,
      ready: list.filter((i) => i.status === "in_stock" && i.debt <= 0).length,
      issued_period: list.filter((i) => i.issued_at && localDay(i.issued_at) >= from && localDay(i.issued_at) <= to).length,
      unpaid_items: all_.unpaid_items,
    },
    customers: {
      total: customers.total,
      new_period: customers.new_period,
      with_debt: withDebt,
      debt: all_.debt,
    },
    // Этапы товара «сейчас» (без фильтра периода): сколько, на какую сумму, выкуп, прибыль, оплата.
    stages: {
      ordered: totals(list.filter((i) => i.status === "ordered")),
      in_stock: {
        ...totals(list.filter((i) => i.status === "in_stock")),
        ready: list.filter((i) => i.status === "in_stock" && i.debt <= 0).length,
      },
      issued: {
        ...totals(list.filter((i) => i.status === "issued")),
        period: list.filter((i) => i.issued_at && localDay(i.issued_at) >= from && localDay(i.issued_at) <= to).length,
      },
    },
    widgets,
  });
});

dashboardRouter.get("/finance", (req, res) => {
  const { from, to } = period(req.query);
  const list = items();
  const pt = totals(inRange(list, from, to));
  const cash = cashIn(from, to);

  const debtors = all(
    `SELECT customer_id AS id, customer_name AS name, customer_phone AS phone,
            SUM(debt) AS debt, COUNT(*) AS items, MIN(order_date) AS oldest
       FROM v_items WHERE ${openDebtSql()} GROUP BY customer_id ORDER BY debt DESC LIMIT 50`
  );
  // Последние оплаты периода — период фильтруется в самой выборке (раньше брались 300 последних
  // за всё время и уже потом период, и для старых периодов список выходил пустым).
  const since = new Date(`${from}T00:00:00`).toISOString();
  const until = new Date(`${addDays(to, 1)}T00:00:00`).toISOString();
  const payments = all(
    `SELECT * FROM (
       SELECT p.id, p.amount, p.method, p.paid_at, p.comment, v.id AS item_id, v.name AS item_name,
              v.customer_id, v.customer_name, u.login AS user_login
         FROM payments p JOIN v_items v ON v.id = p.order_item_id LEFT JOIN users u ON u.id = p.user_id
        WHERE p.deleted_at IS NULL AND p.paid_at >= ? AND p.paid_at < ?
       UNION ALL
       -- Вес, оплаченный при выдаче: id отрицательный, товара нет.
       SELECT -s.id, s.weight_som, s.weight_method, s.issued_at, 'вес при выдаче', NULL,
              'Вес ' || REPLACE(printf('%.2f', COALESCE(s.weight_kg, 0)), '.', ',') || ' кг',
              c.id, c.name, u.login
         FROM issues s JOIN customers c ON c.id = s.customer_id AND c.deleted_at IS NULL LEFT JOIN users u ON u.id = s.user_id
        WHERE s.weight_som > 0 AND s.issued_at >= ? AND s.issued_at < ?
     ) ORDER BY paid_at DESC, id DESC LIMIT 50`,
    since, until, since, until
  );
  // Дни для графика поступлений: с первой оплаты периода (не раньше), не больше 400 последних дней.
  const firstPay = cash.reduce<string | null>((a, p) => (a === null || localDay(p.paid_at) < a ? localDay(p.paid_at) : a), null);
  const dayFrom = [from, firstPay ?? to, addDays(to, -399)].reduce((a, b) => (b > a ? b : a));

  res.json({
    period: { date_from: from, date_to: to },
    totals: { ...pt, debts_total: totals(list).debt },
    cash_in: {
      amount: cash.reduce((a, p) => a + p.amount, 0),
      count: cash.length,
      // Чем платили и по дням — для разбивки способов оплаты и графика поступлений.
      by_method: Object.values(
        cash.reduce<Record<string, { method: string; amount: number; count: number }>>((acc, p) => {
          const m = (acc[p.method] ??= { method: p.method, amount: 0, count: 0 });
          m.amount += p.amount;
          m.count += 1;
          return acc;
        }, {})
      ).sort((a, b) => b.amount - a.amount),
      by_day: dayList(dayFrom, to).map((day) => ({ day, amount: cash.filter((p) => localDay(p.paid_at) === day).reduce((a, p) => a + p.amount, 0) })),
    },
    months: byMonth(list, lastMonths(12, to)),
    debtors,
    payments,
  });
});

// --- Настройка блоков дашборда (скрыть/переставить) ----------------------------------

const toRow = (w: WidgetRow) => ({
  id: w.id, key: w.key, title: w.title, chart: w.chart, position: w.position,
  is_visible: !!w.is_visible, is_builtin: !!w.is_builtin,
});

dashboardRouter.get("/dashboard/widgets", (_req, res) => {
  res.json(all<WidgetRow>("SELECT * FROM cargo_widgets ORDER BY position, id").map(toRow));
});

dashboardRouter.patch("/dashboard/widgets/:id", (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  const w = get<WidgetRow>("SELECT * FROM cargo_widgets WHERE id = ?", id);
  if (!w) throw notFound("Блок");
  const b = req.body ?? {};
  run(
    "UPDATE cargo_widgets SET position = ?, is_visible = ? WHERE id = ?",
    b.position !== undefined ? Number(b.position) : w.position,
    b.is_visible !== undefined ? (b.is_visible ? 1 : 0) : w.is_visible,
    id
  );
  res.json(toRow(get<WidgetRow>("SELECT * FROM cargo_widgets WHERE id = ?", id)!));
});
