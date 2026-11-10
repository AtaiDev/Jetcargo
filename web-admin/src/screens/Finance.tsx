/**
 * Финансы — аналитика в стиле «ov»:
 *  - период и сравнение с прошлым таким же периодом, выгрузка CSV;
 *  - пять показателей с мини-графиками; выбранный — крупным графиком «этот / прошлый период»;
 *  - оплата заказов (оплачено / долг), путь товаров, чем платили;
 *  - клиенты периода, должники и последние оплаты; когда платят — по дням недели и часам.
 *
 * Сумма заказов и наценка — по дате заказа; поступления — по дате оплаты.
 * Наценка = Сумма − Реальная цена, только где реальная цена указана.
 */
import { Fragment, useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { getFinance, getFinancePayments, type Finance as FinanceData, type FinancePayments, type PayGroup } from "../api/domain";
import ItemModal from "../components/ItemModal";
import SlideTabs from "../components/SlideTabs";
import CountUp from "../design/CountUp";
import { Page } from "../design/table";
import { ModalError } from "../design/ui";
import { METHOD_LABEL, som, todayIso } from "../lib/cargo";
import { useRefresh } from "../lib/events";
import { HomeHead } from "./overview/Home";

type Toast = (kind: "success" | "error", text: string) => void;
type PKey = "1" | "7" | "30" | "month" | "90" | "365";
type Metric = "cost" | "profit" | "wbuy" | "delivery" | "weight" | "net";
type Row = NonNullable<FinanceData["series"]>[number];
type Tab = "top" | "debt" | "pay";

const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WD_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const WD_JS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const p2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const dt = (day: string) => new Date(`${day}T00:00:00`);
const shift = (day: string, n: number) => {
  const d = dt(day);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
const daysIn = (a: string, b: string) => Math.round((dt(b).getTime() - dt(a).getTime()) / 86400000) + 1;
const dayShort = (day: string) => `${dt(day).getDate()} ${MON[dt(day).getMonth()]}`;
/** «8 окт — 6 ноя»; через Новый год — с годами; один день — с днём недели. */
const spanText = (a: string, b: string) =>
  a === b ? `${dayShort(a)}, ${WD_JS[dt(a).getDay()]}` : a.slice(0, 4) !== b.slice(0, 4) ? `${dayShort(a)} ${a.slice(0, 4)} — ${dayShort(b)} ${b.slice(0, 4)}` : `${dayShort(a)} — ${dayShort(b)}`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const int = (n: number) => Math.round(n).toLocaleString("ru-RU");

function rangeOf(k: PKey) {
  const t = todayIso();
  return k === "month" ? { from: `${t.slice(0, 7)}-01`, to: t } : { from: todayIso(-(Number(k) - 1)), to: t };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Короткая подпись оси: «15 тыс», «1,2 млн». */
function short(v: number, money: boolean): string {
  const a = Math.abs(v);
  const f = (x: number) => (Math.round(x * 10) / 10).toLocaleString("ru-RU");
  if (a >= 1e6) return `${f(v / 1e6)} млн`;
  if (a >= 1000) return `${f(v / 1000)} тыс`;
  return money ? `${int(v)}` : int(v);
}

/**
 * Цепочка прибыли слева направо. Выкуп товаров — оборот (деньги ушли на товар и вернутся с оплатой),
 * в прибыль не входит. Чистая прибыль = наценка + вес клиентам − выкуп веса − доставка.
 */
const METRICS: { key: Metric; op: string; label: string; title: string; basis: string; money: boolean; total: (d: FinanceData) => number; note: (d: FinanceData) => string }[] = [
  {
    key: "cost",
    op: "",
    label: "Выкуп товаров",
    title: "Выкуп товаров",
    basis: "по дате заказа · реальная цена товаров",
    money: true,
    total: (d) => d.money?.goods_cost ?? d.totals.cost,
    note: (d) => (d.totals.with_cost < d.totals.items ? `по ${d.totals.with_cost} из ${d.totals.items} с ценой выкупа` : `${d.totals.items} ${plural(d.totals.items, "товар", "товара", "товаров")}`),
  },
  {
    key: "profit",
    op: "+",
    label: "Наценка",
    title: "Наценка",
    basis: "по дате заказа · сумма − реальная цена",
    money: true,
    total: (d) => d.money?.markup ?? d.totals.profit,
    note: (d) => (d.totals.cost > 0 ? `${pct(d.totals.profit, d.totals.cost)}% к выкупу` : "нет цен выкупа"),
  },
  {
    key: "wbuy",
    op: "−",
    label: "Выкуп веса",
    title: "Выкуп веса (карго)",
    basis: "по дню прихода партии",
    money: true,
    total: (d) => d.money?.weight_buy ?? 0,
    note: (d) => (d.money?.batches ? `${d.money.batches} ${plural(d.money.batches, "партия", "партии", "партий")} · карго` : "партий не было"),
  },
  {
    key: "delivery",
    op: "−",
    label: "Доставка",
    title: "Доставка (дорога)",
    basis: "по дню прихода партии",
    money: true,
    total: (d) => d.money?.delivery ?? 0,
    note: () => "дорога · по партиям",
  },
  {
    key: "weight",
    op: "+",
    label: "Вес клиентам",
    title: "Вес клиентам",
    basis: "при выдаче — по дню выдачи, вписанный в партию — по дню прихода",
    money: true,
    total: (d) => d.money?.weight ?? 0,
    note: (d) =>
      d.money?.weight_pending ? `ещё ждём ${som(d.money.weight_pending)} при выдаче` : `${(d.money?.weight_kg ?? 0).toLocaleString("ru-RU")} кг · ${(d.money?.rate_usd ?? 0).toLocaleString("ru-RU")} $/кг`,
  },
  {
    key: "net",
    op: "=",
    label: "Чистая прибыль",
    title: "Чистая прибыль",
    basis: "наценка + вес клиентам − выкуп веса − доставка",
    money: true,
    total: (d) => d.money?.net ?? d.totals.profit,
    note: () => "наценка + вес − расходы",
  },
];
const fmt = (m: (typeof METRICS)[number], v: number) => (m.money ? som(Math.round(v)) : int(v));

function chunks(rows: Row[], size: number): Row[][] {
  const out: Row[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Значения показателя по группам дней; у среднего чека пустой день повторяет прошлый. */
function valuesOf(m: Metric, groups: Row[][]): number[] {
  const v = groups.map((g) => {
    return g.reduce((a, r) => a + r[m], 0);
  });
  return v.length === 1 ? [v[0], v[0]] : v;
}

/**
 * Плавная кривая через значения (монотонный сплайн, без выбросов за точки), разложенная
 * на одинаковое число отрезков — так форма плавно перетекает при смене периода или показателя.
 */
function curve(vals: number[], y: (v: number) => number, samples = 120, xsIn?: number[]): string {
  const n = vals.length;
  const xs = xsIn ?? vals.map((_, i) => (i / (n - 1)) * 100);
  const ys = vals.map(y);
  const tg = tangents(xs.map((x, i) => [x, ys[i]]));
  let d = "";
  let i = 0;
  for (let k = 0; k <= samples; k++) {
    const X = (k / samples) * 100;
    while (i < n - 2 && X > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i] || 1;
    const t = (X - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const Y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * tg[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * tg[i + 1];
    d += `${k ? "L" : "M"}${X.toFixed(2)} ${Y.toFixed(2)}`;
  }
  return d;
}

/** Первый кадр — линия на нуле, со следующего — настоящая: график плавно вырастает. */
function useGrow() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let b = 0;
    const a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setOn(true))));
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, []);
  return on;
}

const dStyle = (d: string) => ({ d: `path("${d}")` }) as CSSProperties;

/** Наклоны монотонного сплайна в точках. */
function tangents(pts: number[][]): number[] {
  const n = pts.length;
  const s: number[] = [];
  const t: number[] = [];
  for (let i = 0; i < n - 1; i++) s.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1));
  t[0] = s[0];
  t[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / s[i];
    const b = t[i + 1] / s[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * s[i];
      t[i + 1] = k * b * s[i];
    }
  }
  return t;
}

function nice(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

const ARROW = { up: "M12 19V5m-6 6 6-6 6 6", down: "M12 5v14m6-6-6 6-6-6" };

/**
 * Изменение к прошлому периоду: «↑ 4,7%». Если в прошлом был ноль или минус, или сейчас минус —
 * проценты врут (например «−509%»), поэтому показываем разницу в сомах: «↓ 31 051 с». Падение — контуром.
 */
function Delta({ now, before }: { now: number; before: number | null }) {
  if (before === null || (before === 0 && now === 0)) return null;
  const diff = now - before;
  const byPct = before > 0 && now >= 0;
  const a = Math.abs(byPct ? (diff / before) * 100 : 0);
  return (
    <span className={"fn2-d" + (diff < 0 ? " dn" : "")} title={byPct ? "к прошлому периоду" : "разница с прошлым периодом"}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={diff < 0 ? ARROW.down : ARROW.up} />
      </svg>
      {byPct ? `${a >= 100 ? int(a) : a.toFixed(1).replace(".", ",")}%` : som(Math.abs(Math.round(diff * 100) / 100))}
    </span>
  );
}

export default function Finance({ toast }: { isDesktop: boolean; toast: Toast }) {
  const [pk, setPk] = useState<PKey>("30");
  const [cmp, setCmp] = useState(true);
  const [metric, setMetric] = useState<Metric>("net");
  const [tab, setTab] = useState<Tab>("top");
  const [data, setData] = useState<FinanceData | null>(null);
  const [prevData, setPrevData] = useState<FinanceData | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  // Период считается заново при каждой отрисовке — после полуночи «сегодня» сдвинется само.
  const r = rangeOf(pk);
  const seq = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    const len = daysIn(r.from, r.to);
    // Ответ на старый запрос (период уже переключили) не показываем.
    const my = ++seq.current;
    Promise.all([getFinance({ date_from: r.from, date_to: r.to }), getFinance({ date_from: shift(r.from, -len), date_to: shift(r.from, -1) })])
      .then(([a, b]) => {
        if (my !== seq.current) return;
        setData(a);
        setPrevData(b);
        setError("");
      })
      .catch((e) => {
        if (my === seq.current) setError(apiError(e, "Не удалось загрузить финансы"));
      });
  }, [r.from, r.to]);
  useEffect(load, [load]);
  useRefresh(load);

  const prev = cmp ? prevData : null;
  const m = METRICS.find((x) => x.key === metric)!;
  const range = spanText(r.from, r.to);
  const today = data?.series?.find((x) => x.day === todayIso());

  const exportCsv = () => {
    if (!data?.series) return;
    const lines = [
      "Дата;Выкуп товаров;Наценка;Выкуп веса;Доставка;Вес клиентам;Чистая прибыль;Поступило;Сумма заказов;Товаров",
      ...data.series.map((x) => [x.day, x.cost, x.profit, x.wbuy, x.delivery, x.weight, x.net, x.cash, x.sale, x.items].join(";").replace(/./g, ",")),
    ];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `finance_${r.from}_${r.to}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const toDebtors = () => {
    setTab("debt");
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Page size="wide">
      <div className="ov fn2">
        <div className="wx-head">
          <HomeHead title="Финансы" />
          <div className="wx-head-r">
            {today && (
              <span className="ov-live fn2-live">
                <span className="ov-live-dot" aria-hidden />
                <em className="fn2-live-d">сегодня</em>
                <span className="fn2-live-v">
                  <b>+{som(today.cash)}</b>
                  <small>поступило</small>
                </span>
                <i className="fn2-live-sep" aria-hidden />
                <span className="fn2-live-v">
                  <b>
                    {today.net > 0 ? "+" : today.net < 0 ? "−" : ""}
                    {som(Math.abs(today.net))}
                  </b>
                  <small>прибыль</small>
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="fn2-bar">
          <SlideTabs<PKey>
            value={pk}
            onChange={setPk}
            counts={false}
            options={[
              ["1", "Сегодня"],
              ["7", "7 дней"],
              ["month", "Этот месяц"],
              ["30", "30 дней"],
              ["90", "90 дней"],
              ["365", "12 месяцев"],
            ]}
          />
          <span className="fn2-range">{range}</span>
          <button type="button" className={"fn2-sw" + (cmp ? " on" : "")} onClick={() => setCmp(!cmp)} aria-pressed={cmp}>
            <i />с прошлым периодом
          </button>
          <button type="button" className="fn2-btn" onClick={exportCsv} disabled={!data?.series}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
            </svg>
            Экспорт CSV
          </button>
        </div>

        {error && <ModalError text={error} />}
        {!data ? (
          !error && <Ghost />
        ) : (
          <>
            <div className="fn2-kpis">
              {METRICS.map((x, i) => (
                <Kpi key={x.key} m={x} data={data} prev={prev} on={x.key === metric} onClick={() => setMetric(x.key)} delay={i} />
              ))}
            </div>
            <div className="fn2-g1">
              <BigChart m={m} data={data} prev={prev} busy={data.period.date_from !== r.from || data.period.date_to !== r.to} />
              <div className="fn2-side">
                <PaySplit data={data} prev={prev} onDebtors={toDebtors} />
                <Methods data={data} />
              </div>
            </div>
            <div className="fn2-g2">
              <Funnel data={data} />
              <When data={data} />
            </div>
            <div className="fn2-g3" ref={tableRef}>
              <Table data={data} tab={tab} setTab={setTab} onOpen={setOpen} />
            </div>
          </>
        )}
      </div>
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </Page>
  );
}

// --- Показатели ----------------------------------------------------------------------------------

function Kpi({ m, data, prev, on, onClick, delay }: { m: (typeof METRICS)[number]; data: FinanceData; prev: FinanceData | null; on: boolean; onClick: () => void; delay: number }) {
  const rows = data.series ?? [];
  const vals = valuesOf(m.key, chunks(rows, rows.length > 31 ? Math.ceil(rows.length / 30) : 1));
  const v = m.total(data);
  const b = prev ? m.total(prev) : null;
  const delta = b !== null && (b !== 0 || v !== 0);
  return (
    <button type="button" className={"fn2-k" + (on ? " on" : "")} onClick={onClick} aria-pressed={on} title={m.note(data)} style={{ animationDelay: `${delay * 50}ms` }}>
      <small>
        {m.op && <i className="fn2-op">{m.op}</i>}
        {m.label}
      </small>
      <b>
        <CountUp text={fmt(m, v)} />
      </b>
      <span className="fn2-k-d">
        {delta ? (
          <>
            <Delta now={v} before={b} />
            <em className="vs">к прошлому</em>
          </>
        ) : (
          <em>{m.note(data)}</em>
        )}
      </span>
      <Spark values={vals} />
      <span className="fn2-k-go" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17 17 7M8 7h9v9" />
        </svg>
      </span>
    </button>
  );
}

/** Сглаживание для мини-графика (гауссово среднее соседей): без острых пиков, общий ход виден. */
function soften(v: number[]): number[] {
  if (v.length < 4) return v;
  const r = Math.max(1, Math.round(v.length / 30));
  return v.map((_, i) => {
    let s = 0;
    let w = 0;
    for (let k = -2 * r; k <= 2 * r; k++) {
      const j = i + k;
      if (j < 0 || j >= v.length) continue;
      const g = Math.exp(-(k * k) / (2 * r * r));
      s += v[j] * g;
      w += g;
    }
    return s / w;
  });
}

function Spark({ values }: { values: number[] }) {
  const id = "fs" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const sv = soften(values);
  const hi = Math.max(...sv);
  const lo = Math.min(0, ...sv);
  const rg = hi - lo || 1;
  const on = useGrow();
  const d = curve(sv, (v) => (on ? 29 - ((v - lo) / rg) * 25 : 29), 60);
  return (
    <svg className="fn2-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".16" />
          <stop offset=".85" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="g" fill={`url(#${id})`} style={dStyle(`${d} L100 32 L0 32 Z`)} />
      <path className="l" style={dStyle(d)} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// --- Крупный график ------------------------------------------------------------------------------

/** Слагаемые чистой прибыли: знак и откуда берётся сумма периода. */
const PARTS: { key: "profit" | "weight" | "wbuy" | "delivery"; label: string; sign: 1 | -1; c: string }[] = [
  { key: "profit", label: "Наценка", sign: 1, c: "c1" },
  { key: "weight", label: "Вес клиентам", sign: 1, c: "c2" },
  { key: "wbuy", label: "Выкуп веса", sign: -1, c: "c3" },
  { key: "delivery", label: "Доставка", sign: -1, c: "c4" },
];
const ST_IC = {
  up: "M7 17 17 7M8 7h9v9",
  down: "M7 7l10 10M17 8v9H8",
  avg: "M4 9c2.5-2.5 5-2.5 8 0s5.5 2.5 8 0M4 15c2.5-2.5 5-2.5 8 0s5.5 2.5 8 0",
  days: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  prev: "M3 12a9 9 0 1 0 2.6-6.4M3 4v4h4M12 8v4l3 2",
};
/** «+1 200 с», «−300 с», «0 с». */
const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + som(Math.abs(Math.round(v * 100) / 100));

function BigChart({ m, data, prev, busy }: { m: (typeof METRICS)[number]; data: FinanceData; prev: FinanceData | null; busy: boolean }) {
  const rows = data.series ?? [];
  const size = rows.length > 92 ? 7 : 1;
  const groups = chunks(rows, size);
  // Суммы по дням (за год — по неделям).
  const sumG = (g: Row[]) => g.reduce((a, r) => a + r[m.key], 0);
  const curAll = groups.length ? groups.map(sumG) : [0];
  const pGroups = prev?.series ? chunks(prev.series, size) : null;
  const pvAll = pGroups ? pGroups.map(sumG).slice(0, curAll.length) : null;
  // Пустое начало периода не показываем: график начинается чуть раньше первых сумм.
  const firstAt = curAll.findIndex((v, i) => v !== 0 || (pvAll?.[i] ?? 0) !== 0);
  const start = curAll.length > 10 && firstAt > curAll.length * 0.15 ? Math.max(0, firstAt - Math.max(1, Math.round(curAll.length * 0.04))) : 0;
  const G = groups.slice(start);
  const PG = pGroups ? pGroups.slice(start) : null;
  const raw = curAll.slice(start);
  const pRaw = pvAll ? pvAll.slice(start) : null;
  const cur = raw.length === 1 ? [raw[0], raw[0]] : raw;
  const pv = pRaw && pRaw.length ? (pRaw.length === 1 ? [pRaw[0], pRaw[0]] : pRaw) : null;
  const n = cur.length;
  const isNet = m.key === "net";
  const total = m.total(data);

  // «Горы»: суммы дней сглажены (соседние дни перетекают друг в друга), и самая высокая гора
  // растянута ровно до настоящего максимума дня — шкала не врёт, точные суммы — в подсказке.
  const sigma = Math.max(0.5, n / 60);
  const R = Math.ceil(sigma * 3);
  let wAll = 0;
  for (let k = -R; k <= R; k++) wAll += Math.exp(-(k * k) / (2 * sigma * sigma));
  // За краями периода — нули (а не «растягивание» соседей): крайние дни не завышаются.
  const blur = (v: number[]) =>
    v.map((_, i) => {
      let a = 0;
      for (let k = -R; k <= R; k++) {
        const j = i + k;
        if (j < 0 || j >= v.length) continue;
        a += v[j] * Math.exp(-(k * k) / (2 * sigma * sigma));
      }
      return a / wAll;
    });
  const peak = (v: number[]) => Math.max(0, ...v.map(Math.abs));
  const sm0 = blur(cur);
  const kk = peak(sm0) > 0 ? peak(cur) / peak(sm0) : 1;
  const sm = sm0.map((v) => v * kk);
  const pm = pv ? blur(pv).map((v) => v * kk) : null;

  // Шкала: ровные деления, ноль всегда на шкале; при минусе — ниже нуля.
  const all = [...sm, ...(pm ?? [])];
  const hi = Math.max(0, ...all);
  const lo = Math.min(0, ...all);
  const step = nice((hi - lo) / 4 || (m.money ? 250 : 1));
  const top = Math.max(step, Math.ceil(hi / step) * step);
  const bot = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = top; v >= bot - 1e-9; v -= step) ticks.push(v);
  const y = (v: number) => (1 - (v - bot) / (top - bot)) * 100;
  const x = (i: number) => (i / (n - 1)) * 100;
  const zeroY = y(0);
  const neg = bot < 0;

  // Первый кадр — всё на нуле, дальше горы плавно поднимаются и перетекают при смене периода.
  const on = useGrow();
  const yy = (v: number) => (on ? y(v) : zeroY);
  const line = curve(sm, yy, 320);
  const pline = pm ? curve(pm, yy, 320) : null;
  const area = `${line} L100 ${zeroY} L0 ${zeroY} Z`;

  // Метка над самой высокой горой: сумма и день.
  const iPk = peak(cur) > 0 ? cur.findIndex((v) => Math.abs(v) === peak(cur)) : -1;
  const pkDay = iPk >= 0 ? G[Math.min(iPk, G.length - 1)]?.[0]?.day : undefined;
  // Метка вершины ждёт, пока горы вырастут или перетекут, и появляется один раз — уже на своём месте.
  const pkSig = `${m.key}|${data.period.date_from}|${data.period.date_to}|${iPk}|${iPk >= 0 ? cur[iPk] : 0}|${iPk >= 0 ? Math.round(y(sm[iPk]) * 10) : 0}|${iPk >= 0 ? Math.round(x(iPk) * 10) : 0}`;
  // Строго: каждое переключение — новый номер; метка видна, только если для ЭТОГО номера линия
  // уже дорисовалась и сейчас не движется (быстрые переключения туда-обратно её не «оживят» раньше времени).
  const genRef = useRef({ sig: "", gen: 0 });
  if (genRef.current.sig !== pkSig) genRef.current = { sig: pkSig, gen: genRef.current.gen + 1 };
  const gen = genRef.current.gen;
  const [shownGen, setShownGen] = useState(-1);
  const [moving, setMoving] = useState(false);
  const pkShow = shownGen === gen && !moving;
  const curRef = useRef<SVGPathElement>(null);
  // Линия снова поехала (например, сменилась шкала) — метка сразу прячется.
  useEffect(() => {
    const el = curRef.current;
    if (!el) return;
    const run = (e: TransitionEvent) => e.propertyName === "d" && setMoving(true);
    const stop = (e: TransitionEvent) => e.propertyName === "d" && setMoving(false);
    el.addEventListener("transitionrun", run);
    el.addEventListener("transitionend", stop);
    el.addEventListener("transitioncancel", stop);
    return () => {
      el.removeEventListener("transitionrun", run);
      el.removeEventListener("transitionend", stop);
      el.removeEventListener("transitioncancel", stop);
    };
  }, []);
  // Показываем, только когда линия на экране реально совпала с конечной формой (сверка каждый кадр),
  // без таймеров — на любом компьютере метка появится ровно тогда, когда гора дорисована.
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let same = 0;
    const t0 = performance.now();
    const norm = (d: string) => d.replace(/s+/g, "");
    const tick = () => {
      const el = curRef.current;
      const target = el ? norm(el.style.getPropertyValue("d")) : "";
      const now = el ? norm(getComputedStyle(el).getPropertyValue("d")) : "";
      same = el && target && now === target ? same + 1 : 0;
      if (same >= 3 && performance.now() - t0 > 1000) {
        setMoving(false);
        setShownGen(gen);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [gen, on]);

  const L = Math.min(n, 7);
  const xl = Array.from({ length: L }, (_, k) => Math.round((k * (n - 1)) / Math.max(1, L - 1)));

  // Итоги по дням периода (не по неделям графика).
  const dayVals = rows.map((r) => r[m.key]);
  const nDays = rows.length;
  const sumDays = dayVals.reduce((a, v) => a + v, 0);
  const iMax = dayVals.length ? dayVals.indexOf(Math.max(...dayVals)) : -1;
  const iMin = dayVals.length ? dayVals.indexOf(Math.min(...dayVals)) : -1;
  const dayOf = (i: number) => (i >= 0 ? dayShort(rows[i].day) : "—");
  const plus = dayVals.filter((v) => v > 0).length;
  const fmtS = (v: number) => (isNet ? signed(v) : fmt(m, v));
  const prevRange = prev ? spanText(prev.period.date_from, prev.period.date_to) : "";
  type Stat = { ic: keyof typeof ST_IC; label: string; value: string; sub: string; strip?: boolean; extra?: string };
  const stats: Stat[] = isNet
    ? [
        { ic: "up", label: "Лучший день", value: iMax >= 0 ? signed(dayVals[iMax]) : "—", sub: dayOf(iMax) },
        { ic: "down", label: "Худший день", value: iMin >= 0 ? signed(dayVals[iMin]) : "—", sub: dayOf(iMin) },
        { ic: "avg", label: "В среднем в день", value: nDays ? signed(Math.round(sumDays / nDays)) : "—", sub: `за ${nDays} ${plural(nDays, "день", "дня", "дней")}` },
        { ic: "days", label: "Дней в плюсе", value: `${plus} из ${nDays}`, sub: "", strip: true, extra: `${pct(plus, nDays)}%` },
      ]
    : [];

  const box = useRef<HTMLDivElement>(null);
  const [hvRaw, setHv] = useState<number | null>(null);
  const hv = hvRaw === null ? null : Math.min(hvRaw, n - 1);
  // Подсказка не исчезает резко: уводим мышь — она плавно гаснет на месте.
  const [vis, setVis] = useState(false);
  const move = (e: { clientX: number }) => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - b.left) / b.width) * (n - 1))));
    window.clearTimeout(hideT.current);
    setHv(i);
    // Первое появление — со следующего кадра, чтобы подсказка проявилась плавно, а не вспыхнула.
    if (hvRaw === null) requestAnimationFrame(() => setVis(true));
    else setVis(true);
  };
  // Уводим мышь — подсказка плавно гаснет и только потом убирается совсем.
  const hideT = useRef(0);
  const leave = () => {
    setVis(false);
    window.clearTimeout(hideT.current);
    hideT.current = window.setTimeout(() => setHv(null), 280);
  };
  useEffect(() => () => window.clearTimeout(hideT.current), []);
  // Сменили показатель или период, а мышь не над графиком — скрытую подсказку убираем сразу,
  // чтобы она не мелькнула со старыми данными.
  const visRef = useRef(vis);
  visRef.current = vis;
  useEffect(() => {
    if (!visRef.current) setHv(null);
  }, [m.key, data.period.date_from, data.period.date_to]);
  const tipDay = (g: Row[][] | null, i: number) => {
    const d = g?.[Math.min(i, g.length - 1)]?.[0]?.day;
    if (!d) return "";
    return size > 1 ? `неделя с ${dayShort(d)}` : `${dayShort(d)}, ${WD_JS[dt(d).getDay()]}`;
  };
  const hg = hv !== null ? G[Math.min(hv, G.length - 1)] ?? [] : [];

  return (
    <section className="ov-card fn2-big">
      <div className="fn2-bh">
        <div className="fn2-bh-l">
          <span className="fn2-t">
            {m.title}
            <em>{size > 1 ? "по неделям" : "по дням"}</em>
            <span className="fn2-info" tabIndex={0} aria-label="Как считается">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 7.5h.01M11 11.5h1v6h1" />
              </svg>
              <span className="fn2-info-tip" role="tooltip">
                <span className="fn2-info-row">
                  <small>Как считается</small>
                  <span>{m.basis}</span>
                </span>
                {start > 0 && G[0]?.[0] && (
                  <span className="fn2-info-row">
                    <small>График</small>
                    <span>с {dayShort(G[0][0].day)} — раньше сумм не было</span>
                  </span>
                )}
              </span>
            </span>
          </span>
          <span className="fn2-big-v">
            <b className={total < 0 ? "neg" : ""}>
              <CountUp text={isNet ? signed(total) : fmt(m, total)} />
            </b>
            {prev && !(total === 0 && m.total(prev) === 0) && <Delta now={total} before={m.total(prev)} />}
          </span>
        </div>
        <div className="fn2-rng">
          <span className="fn2-rng-i">
            <i className="ln" />
            <span>
              <b>{spanText(data.period.date_from, data.period.date_to)}</b>
              <small>этот период</small>
            </span>
          </span>
          {pv && (
            <span className="fn2-rng-i p">
              <i className="ln dash" />
              <span>
                <b>{prevRange}</b>
                <small>прошлый период</small>
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="fn2-plot">
        <div className="fn2-y">
          {ticks.map((v) => (
            <span key={v} className={v === 0 && neg ? "z" : ""} style={{ top: `${y(v)}%` }}>
              {short(v, m.money)}
            </span>
          ))}
        </div>
        <div className="fn2-area" ref={box} onMouseMove={move} onMouseLeave={leave}>
          {ticks.map((v) => (
            <i key={v} className="fn2-grid" style={{ top: `${y(v)}%` }} />
          ))}
          {neg && <i className="fn2-zero" style={{ top: `${zeroY}%` }} />}
          <svg className="fn2-svg mtn" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="fn2Fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
                <stop offset=".55" stopColor="currentColor" stopOpacity=".07" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="fn2FillDn" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="currentColor" stopOpacity=".14" />
                <stop offset="1" stopColor="currentColor" stopOpacity=".02" />
              </linearGradient>
              <clipPath id="fn2Up">
                <rect className="clip" x="0" y="-20" width="100" style={{ height: zeroY + 20 }} />
              </clipPath>
              <clipPath id="fn2Dn">
                <rect className="clip" x="0" width="100" style={{ y: zeroY, height: 120 - zeroY } as CSSProperties} />
              </clipPath>
            </defs>
            <path className="fill" clipPath="url(#fn2Up)" fill="url(#fn2Fill)" style={dStyle(area)} />
            <path className="fill" clipPath="url(#fn2Dn)" fill="url(#fn2FillDn)" style={{ ...dStyle(area), opacity: neg ? 1 : 0 }} />
            <path className="prev" style={{ ...dStyle(pline ?? line), opacity: pline ? 1 : 0 }} vectorEffect="non-scaling-stroke" />
            <path className="glow" style={dStyle(line)} vectorEffect="non-scaling-stroke" />
            <path ref={curRef} className="cur" style={dStyle(line)} vectorEffect="non-scaling-stroke" />
          </svg>
          {iPk >= 0 && pkDay && pkShow && (
            <Fragment key={gen}>
              <i className={"fn2-pk-dot in" + (busy ? " busy" : "") + (vis && hv !== null ? " off" : "")} style={{ left: `${x(iPk)}%`, top: `${yy(sm[iPk])}%` }} />
              <span
                className={"fn2-pk in" + (busy ? " busy" : "") + (x(iPk) > 55 ? " l" : "") + (cur[iPk] < 0 ? " neg" : "") + (vis && hv !== null ? " off" : "")}
                style={{ left: `${x(iPk)}%`, top: `${yy(sm[iPk])}%` }}
              >
                <i className="fn2-pk-ic">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={cur[iPk] < 0 ? ARROW.down : ARROW.up} />
                  </svg>
                </i>
                <span>
                  <b>{fmtS(cur[iPk])}</b>
                  <small>
                    {isNet ? (cur[iPk] < 0 ? "худший день" : "лучший день") : size > 1 ? "лучшая неделя" : "пик"} · {size > 1 ? `с ${dayShort(pkDay)}` : dayShort(pkDay)}
                  </small>
                </span>
              </span>
            </Fragment>
          )}
          {hv !== null && (
            <>
              <i className={"fn2-cross" + (vis ? " on" : "")} style={{ left: `${x(hv)}%` }} />
              <i className={"fn2-dot" + (vis ? " on" : "")} style={{ left: `${x(hv)}%`, top: `${y(sm[hv])}%` }} />
              <span className={"fn2-tip" + (x(hv) > 62 ? " r" : "") + (vis ? " on" : "")} style={{ left: `${x(hv)}%` }}>
                <small>{tipDay(G, hv)}</small>
                <b>{fmtS(cur[hv])}</b>
                {isNet ? (
                  <span className="fn2-tip-parts">
                    {PARTS.map((p) => {
                      const v = hg.reduce((a, r) => a + r[p.key], 0);
                      return (
                        <span key={p.key} className={"fn2-tip-r" + (v ? "" : " z")}>
                          <i className={p.c} />
                          <span>{p.label}</span>
                          <span>{v ? signed(p.sign * v) : "—"}</span>
                        </span>
                      );
                    })}
                  </span>
                ) : (
                  total > 0 && (
                    <span className="fn2-tip-parts">
                      <span className="fn2-tip-r">
                        <i className="c1" />
                        <span>доля периода</span>
                        <span>{pct(cur[hv], total)}%</span>
                      </span>
                    </span>
                  )
                )}
                {pv && pv[hv] !== undefined && (
                  <span className="fn2-tip-p">
                    <span>
                      Прошлый · {tipDay(PG, hv)}
                      <b>{fmtS(pv[hv])}</b>
                    </span>
                    <em>
                      {cur[hv] - pv[hv] >= 0 ? "↑" : "↓"} {som(Math.abs(Math.round(cur[hv] - pv[hv])))}
                    </em>
                  </span>
                )}
              </span>
            </>
          )}
        </div>
        <div className="fn2-x">
          {xl.map((i, k) => (
            <span key={k} className={xl.length === 1 ? "" : k === 0 ? "f" : k === xl.length - 1 ? "e" : ""} style={{ left: xl.length === 1 ? "50%" : `${x(i)}%` }}>
              {dayShort(G[Math.min(i, G.length - 1)]?.[0]?.day ?? todayIso())}
            </span>
          ))}
        </div>
      </div>

      {stats.length > 0 && (
      <div className="fn2-st4">
        {stats.map((st) => (
          <div key={st.ic} className="fn2-st">
            <span className={"fn2-st-ic" + (st.ic === "up" ? " ink" : "")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={ST_IC[st.ic]} />
              </svg>
            </span>
            <span className="fn2-st-t">
              <small>{st.label}</small>
              <b>{st.value}</b>
              {st.strip ? (
                <span className="fn2-strip-r">
                  <span className="fn2-strip" title={`${st.extra ? st.extra + " · " : ""}${size > 1 ? "по неделям" : "по дням"}: тёмные — в плюсе, серые — в минусе`}>
                    {curAll.map((v, i) => (
                      <i key={i} className={v > 0 ? "p" : v < 0 ? "m" : ""} />
                    ))}
                  </span>
                </span>
              ) : (
                <em>{st.sub}</em>
              )}
            </span>
          </div>
        ))}
      </div>
      )}
    </section>
  );
}

// --- Оплата заказов ------------------------------------------------------------------------------

const PAY_IC = {
  badge: "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76ZM9 12l2 2 4-4",
  wallet: "M19 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6M3 8h16a2 2 0 0 1 2 2v2M14.5 18.5l2 2 4-4",
  hourglass: "M6 3h12M6 21h12M7.5 3v3.5a4.5 4.5 0 0 0 9 0V3M7.5 21v-3.5a4.5 4.5 0 0 1 9 0V21",
  check: "M20 6 9 17l-5-5",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  trend: "m22 7-8.5 8.5-5-5L2 17M16 7h6v6",
};
const PayIc = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/** Оплата заказов периода: доля оплаты крупно и полосой, две плитки (оплачено / долг), долги за всё время и вывод. */
function PaySplit({ data, prev, onDebtors }: { data: FinanceData; prev: FinanceData | null; onDebtors: () => void }) {
  const t = data.totals;
  // Долг хоть на сом — уже «1%», чтобы не показывать «100% оплачено» при живом долге.
  const debtOf = (x: FinanceData["totals"]) => (x.sale > 0 ? Math.max(x.debt > 0 ? 1 : 0, Math.round((x.debt / x.sale) * 100)) : 0);
  const debtPct = debtOf(t);
  const paidPct = t.sale > 0 ? 100 - debtPct : 0;
  const paidItems = t.items - t.unpaid_items;
  const prevPct = prev && prev.totals.sale > 0 ? 100 - debtOf(prev.totals) : null;
  const diff = prevPct === null ? null : paidPct - prevPct;
  const debtors = data.debtors_count ?? data.debtors.length;
  const note = !t.sale
    ? "За период заказов нет — оплаты по ним появятся здесь."
    : t.debt === 0 && (diff === null || diff === 0)
      ? "Все заказы периода оплачены — долгов нет."
    : diff === null
      ? `Не оплачено ${som(t.debt)} у ${t.unpaid_items} ${plural(t.unpaid_items, "товара", "товаров", "товаров")} этого периода.`
      : diff === 0
        ? `Доля оплаты такая же, как в прошлом периоде — ${paidPct}%.`
        : `Оплачено ${paidPct}% — на ${Math.abs(diff)} п.п. ${diff > 0 ? "больше" : "меньше"}, чем в прошлом периоде (${prevPct}%).`;
  const on = useGrow();
  return (
    <section className="ov-card fn2-pay">
      <div className="fn2-ch">
        <span className="fn2-t">Оплата заказов</span>
        <span className="fn2-chip">
          {som(t.sale)}
          <em>сумма заказов</em>
        </span>
      </div>

      <div className="fn2-pay-hero">
        <span className="fn2-pay-big">
          <b>
            <CountUp text={`${paidPct}%`} />
          </b>
          <small>оплачено</small>
        </span>
        <span className="fn2-pay-debt">
          <small>долг</small>
          <b>{t.sale ? `${debtPct}%` : "—"}</b>
        </span>
      </div>
      <div className="fn2-pay-bar" role="img" aria-label={`Оплачено ${paidPct}%, долг ${debtPct}%`}>
        {t.sale > 0 && <i style={{ width: on ? `${paidPct}%` : 0 }} />}
        {t.debt > 0 && <i className="d" style={{ width: on ? `${debtPct}%` : 0 }} />}
      </div>

      <div className="fn2-pay-tiles">
        <div className="fn2-pt2">
          <div className="fn2-pt2-h">
            <i>
              <PayIc d={PAY_IC.badge} size={17} />
            </i>
            <small>Оплачено</small>
          </div>
          <b>
            <CountUp text={som(t.paid)} />
          </b>
          <em>
            {paidItems} {plural(paidItems, "товар", "товара", "товаров")} без долга
          </em>
          {prev && !(t.paid === 0 && prev.totals.paid === 0) && (
            <span className="fn2-pt2-d">
              <Delta now={t.paid} before={prev.totals.paid} />
              <small>к прошлому</small>
            </span>
          )}
        </div>
        <div className="fn2-pt2 debt">
          <div className="fn2-pt2-h">
            <i>
              <PayIc d={PAY_IC.hourglass} size={16} />
            </i>
            <small>Не оплачено</small>
          </div>
          <b>
            <CountUp text={som(t.debt)} />
          </b>
          <em>{t.unpaid_items ? `${t.unpaid_items} ${plural(t.unpaid_items, "товар", "товара", "товаров")} с долгом` : "долгов нет"}</em>
          {prev && !(t.debt === 0 && prev.totals.debt === 0) && (
            <span className="fn2-pt2-d">
              <Delta now={t.debt} before={prev.totals.debt} />
              <small>к прошлому</small>
            </span>
          )}
        </div>
      </div>

      <button type="button" className="fn2-pay-all" onClick={onDebtors} title="Долг по невыданным товарам — открыть список должников">
        <span className="fn2-pay-all-ic">
          <PayIc d={PAY_IC.users} size={16} />
        </span>
        <span>
          <b>Долги за всё время</b>
          <small>
            {debtors} {plural(debtors, "должник", "должника", "должников")} · не выдано
          </small>
        </span>
        <b className="v">
          <CountUp text={som(t.debts_total)} />
        </b>
        <span className="go">
          <PayIc d={PAY_IC.arrow} size={13} />
        </span>
      </button>

      <p className="fn2-pay-note">
        <PayIc d={PAY_IC.trend} size={15} />
        <span>{note}</span>
      </p>
    </section>
  );
}

// --- Путь товаров -------------------------------------------------------------------------------

const STEP_IC = {
  cart: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20.5h.01M17 20.5h.01",
  truck: "M3 6h11v10H3zM14 9h4l3 3v4h-7M7 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  home: "M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10",
  done: "M21 12a9 9 0 1 1-9-9M21 4 12 13l-3-3",
};

/**
 * Путь товаров, заказанных за период: четыре шага по порядку (сколько дошло и где застряли)
 * и полоса «где товары сейчас».
 */
function Funnel({ data }: { data: FinanceData }) {
  const s = data.stages ?? { ordered: 0, in_transit: 0, in_stock: 0, issued: 0 };
  const total = s.ordered + s.in_transit + s.in_stock + s.issued;
  const on = useGrow();
  const word = (n: number) => `${n} ${plural(n, "товар", "товара", "товаров")}`;
  const steps: { ic: keyof typeof STEP_IC; label: string; n: number; sub: string }[] = [
    { ic: "cart", label: "Заказано", n: total, sub: "за период" },
    { ic: "truck", label: "Отправлено", n: total - s.ordered, sub: s.ordered ? `${s.ordered} ждут отправки` : "все отправлены" },
    { ic: "home", label: "На складе", n: s.in_stock + s.issued, sub: s.in_transit ? `${s.in_transit} ещё в пути` : "все прибыли" },
    { ic: "done", label: "Выдано", n: s.issued, sub: s.in_stock ? `${s.in_stock} ждут выдачи` : "все выданы" },
  ];
  const now: { k: string; label: string; n: number }[] = [
    { k: "o", label: "Ждут отправки", n: s.ordered },
    { k: "t", label: "В пути", n: s.in_transit },
    { k: "s", label: "На складе", n: s.in_stock },
    { k: "i", label: "Выдано", n: s.issued },
  ];
  return (
    <section className="ov-card fn2-way">
      <div className="fn2-ch">
        <span className="fn2-t">Путь товаров</span>
        <span className="fn2-chip">
          {word(total)}
          <em>заказано за период</em>
        </span>
      </div>

      <div className="fn2-way-in">
      <div className="fn2-steps">
        {steps.map((st, k) => (
          <Fragment key={st.ic}>
            {k > 0 && (
              <span className="fn2-step-arr" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </span>
            )}
            <div className={"fn2-step" + (k === steps.length - 1 ? " last" : "")}>
              <div className="fn2-step-h">
                <i>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={STEP_IC[st.ic]} />
                  </svg>
                </i>
                <small>{st.label}</small>
              </div>
              <div className="fn2-step-n">
                <b>
                  <CountUp text={int(st.n)} />
                </b>
                <em>{total ? `${pct(st.n, total)}%` : "—"}</em>
              </div>
              <span className="fn2-step-bar">
                <i style={{ width: on && total ? `${Math.max(st.n ? 2 : 0, (st.n / total) * 100)}%` : 0, transitionDelay: `${k * 90}ms` }} />
              </span>
              <span className="fn2-step-sub">{st.sub}</span>
            </div>
          </Fragment>
        ))}
      </div>

      <div className="fn2-now">
        <div className="fn2-now-h">
          <span>Где товары сейчас</span>
          <small>{total ? `${pct(s.issued, total)}% уже у клиентов` : "заказов нет"}</small>
        </div>
        <div className="fn2-now-bar">
          {total > 0 ? (
            now.map((x) => (x.n > 0 ? <i key={x.k} className={x.k} style={{ flexGrow: on ? x.n : 0.0001 }} title={`${x.label}: ${word(x.n)}`} /> : null))
          ) : (
            <i className="e" style={{ flexGrow: 1 }} />
          )}
        </div>
        <div className="fn2-now-l">
          {now.map((x) => (
            <span key={x.k} className={x.n ? "" : "z"}>
              <i className={x.k} />
              {x.label}
              <b>{int(x.n)}</b>
              <em>{total ? `${pct(x.n, total)}%` : ""}</em>
            </span>
          ))}
        </div>
      </div>
      </div>
    </section>
  );
}

// --- Чем платили --------------------------------------------------------------------------------

const METHOD_TONE: Record<string, string> = { cash: "var(--ov-ink)", transfer: "#8E8D87", card: "#5C5B56", import: "#B8B7B1", other: "#D3D2CC" };

/** Чем платили: кольцо долей (наведение — доля в центре), способы с полосками и средней оплатой. */
function Methods({ data }: { data: FinanceData }) {
  const ms = data.cash_in.by_method ?? [];
  const total = ms.reduce((a, x) => a + x.amount, 0);
  const count = ms.reduce((x, m) => x + m.count, 0);
  const [hv, setHv] = useState<string | null>(null);
  const on = useGrow();
  const R = 56;
  const C = 2 * Math.PI * R;
  const gap = ms.length > 1 ? 4 : 0;
  const h = hv ? ms.find((x) => x.method === hv) ?? null : null;
  const tone = (m: string) => METHOD_TONE[m] ?? METHOD_TONE.other;
  let off = 0;
  return (
    <section className="ov-card fn2-meth2">
      <div className="fn2-ch">
        <span className="fn2-t">Чем платили</span>
        <span className="fn2-chip">
          {som(total)}
          <em>поступило</em>
        </span>
      </div>
      <div className="fn2-meth2-in">
        <div className="fn2-donut2">
          <svg viewBox="0 0 140 140" aria-hidden>
            <circle cx="70" cy="70" r={R} className="trk" />
            {total > 0 &&
              ms.map((x) => {
                const len = (x.amount / total) * C;
                const el = (
                  <circle
                    key={x.method}
                    cx="70"
                    cy="70"
                    r={R}
                    className={"seg" + (hv === x.method ? " on" : hv ? " dim" : "")}
                    style={{ stroke: tone(x.method), strokeDasharray: `${on ? Math.max(0.6, len - gap) : 0} ${C}`, strokeDashoffset: -off }}
                    onMouseEnter={() => setHv(x.method)}
                    onMouseLeave={() => setHv(null)}
                  />
                );
                off += len;
                return el;
              })}
          </svg>
          <span className="fn2-donut2-c">
            {h ? (
              <>
                <b>{pct(h.amount, total)}%</b>
                <small>{METHOD_LABEL[h.method] ?? h.method}</small>
              </>
            ) : (
              <>
                <b>
                  <CountUp text={int(count)} />
                </b>
                <small>{plural(count, "оплата", "оплаты", "оплат")}</small>
              </>
            )}
          </span>
        </div>
        <div className="fn2-ml2">
          {ms.length === 0 ? (
            <p className="fn2-pay-note">
              <PayIc d={PAY_IC.clock} size={15} />
              <span>За период оплат не было — способы оплаты появятся здесь.</span>
            </p>
          ) : (
            ms.map((x) => (
              <div key={x.method} className={"fn2-ml2-r" + (hv === x.method ? " on" : hv ? " dim" : "")} onMouseEnter={() => setHv(x.method)} onMouseLeave={() => setHv(null)}>
                <div className="fn2-ml2-h">
                  <i style={{ background: tone(x.method) }} />
                  <b>{METHOD_LABEL[x.method] ?? x.method}</b>
                  <span className="v">{som(x.amount)}</span>
                  <em>{pct(x.amount, total)}%</em>
                </div>
                <span className="fn2-ml2-bar">
                  <i style={{ width: on ? `${total ? Math.max(1.5, (x.amount / total) * 100) : 0}%` : 0, background: tone(x.method) }} />
                </span>
                <small>
                  {x.count} {plural(x.count, "оплата", "оплаты", "оплат")}
                  {x.count > 1 ? ` · в среднем ${som(Math.round(x.amount / x.count))}` : ""}
                </small>
              </div>
            ))
          )}
        </div>
      </div>
      {count > 0 && (
        <div className="fn2-meth2-f">
          <span>В среднем за одну оплату</span>
          <b>{som(Math.round(total / count))}</b>
        </div>
      )}
    </section>
  );
}

// --- Клиенты, должники, оплаты -------------------------------------------------------------------

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

function Table({ data, tab, setTab, onOpen }: { data: FinanceData; tab: Tab; setTab: (t: Tab) => void; onOpen: (id: number) => void }) {
  const nav = useNavigate();
  const top = data.top_customers ?? [];
  const debt = data.debtors;
  const pay = data.payments;
  const max = Math.max(1, ...(tab === "top" ? top.map((x) => x.sale) : tab === "debt" ? debt.map((x) => x.debt) : pay.map((x) => x.amount)));
  const head = tab === "pay" ? ["Время", "Клиент и товар", "Способ", "Сумма"] : ["#", "Клиент", "Товаров", tab === "debt" ? "Долг" : "Сумма"];
  const empty = (tab === "top" ? top : tab === "debt" ? debt : pay).length === 0;
  return (
    <section className="ov-card fn2-tbl">
      <div className="fn2-ch">
        <span className="fn2-t">{tab === "top" ? "Клиенты периода" : tab === "debt" ? "Должники" : "Оплаты"}</span>
        <SlideTabs<Tab>
          value={tab}
          onChange={setTab}
          options={[
            ["top", "По сумме", top.length],
            ["debt", "Должники", data.debtors_count ?? debt.length],
            ["pay", "Оплаты", data.cash_in.count],
          ]}
        />
        <button type="button" className="fn2-link" onClick={() => nav("/customers")}>
          Все клиенты
        </button>
      </div>
      {tab === "pay" ? (
        <PayGroups from={data.period.date_from} to={data.period.date_to} onOpen={onOpen} />
      ) : (
      <>
      <div className="fn2-tr fn2-th">
        {head.map((h, k) => (
          <span key={k}>{h}</span>
        ))}
        <span />
      </div>
      <div className="fn2-tb thin-scroll">
        {empty ? (
          <p className="fn2-note fn2-tempty">{tab === "top" ? "За период заказов нет." : tab === "debt" ? "Долгов нет — все рассчитались." : "За период оплат не было."}</p>
        ) : tab === "top" ? (
          top.map((c, k) => (
            <button type="button" key={c.id} className="fn2-tr" onClick={() => nav(`/customers/${c.id}`)}>
              <span className="fn2-rk">{k + 1}</span>
              <Who name={c.name} sub={c.debt > 0 ? `долг ${som(c.debt)}` : c.code ? `код ${c.code}` : "без долга"} />
              <span className="fn2-c">{c.items}</span>
              <b className="fn2-c">{som(c.sale)}</b>
              <Bar v={c.sale} max={max} first={k === 0} />
            </button>
          ))
        ) : tab === "debt" ? (
          debt.map((d, k) => {
            const days = Math.max(0, Math.round((dt(todayIso()).getTime() - dt(d.oldest.slice(0, 10)).getTime()) / 86400000));
            return (
              <button type="button" key={d.id} className="fn2-tr" onClick={() => nav(`/customers/${d.id}`)}>
                <span className="fn2-rk">{k + 1}</span>
                <Who name={d.name} sub={`долг с ${dayShort(d.oldest.slice(0, 10))} · ${days} дн.`} />
                <span className="fn2-c">{d.items}</span>
                <b className="fn2-c">{som(d.debt)}</b>
                <Bar v={d.debt} max={max} first={k === 0} />
              </button>
            );
          })
        ) : (
          pay.map((p, k) => {
            const at = new Date(p.paid_at);
            return (
              <button type="button" key={p.id} className="fn2-tr" onClick={() => p.item_id && onOpen(p.item_id)} style={p.item_id ? undefined : { cursor: "default" }}>
                <span className="fn2-rk tm">
                  {p2(at.getHours())}:{p2(at.getMinutes())}
                  <small>{dayShort(isoOf(at))}</small>
                </span>
                <Who name={p.customer_name} sub={p.item_name + (p.comment ? ` · ${p.comment}` : "")} />
                <span className="fn2-c">{METHOD_LABEL[p.method] ?? p.method}</span>
                <b className="fn2-c">+{som(p.amount)}</b>
                <Bar v={p.amount} max={max} first={k === 0} />
              </button>
            );
          })
        )}
      </div>
      {tab === "debt" && (data.debtors_count ?? 0) > debt.length && <p className="fn2-more">показаны {debt.length} с самым большим долгом из {data.debtors_count}</p>}
      </>
      )}
    </section>
  );
}

const KIND: Record<PayGroup["kind"], string> = { issue: "Выдача", bulk: "Оплата нескольких товаров", order: "Оплата при заказе", import: "Загружено из Excel", pay: "Оплата" };
const hm = (iso: string) => {
  const d = new Date(iso);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/** Оплаты по посещениям: один клиент — одна карточка (товары + вес за раз), раскрывается; внизу — страницы. */
function PayGroups({ from, to, onOpen }: { from: string; to: string; onOpen: (id: number) => void }) {
  const PER = 8;
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<FinancePayments | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setPage(1), [from, to]);
  useEffect(() => {
    let alive = true;
    getFinancePayments({ date_from: from, date_to: to, page, per: PER })
      .then((d) => {
        if (!alive) return;
        setRes(d);
        // Все посещения закрыты — нужное раскрывают сами.
        setOpened(new Set());
      })
      .catch(() => alive && setRes(null));
    return () => {
      alive = false;
    };
  }, [from, to, page]);
  const pages = res ? Math.max(1, Math.ceil(res.total_groups / PER)) : 1;
  const go = (p: number) => {
    setPage(p);
    box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const toggle = (k: string) =>
    setOpened((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const word = (n: number) => `${n} ${plural(n, "товар", "товара", "товаров")}`;
  const kg = (v: number) => `${v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} кг`;

  // Пока грузится — заготовка той же высоты, что и список: страница не «прыгает».
  if (!res)
    return (
      <div className="fn2-pgs" aria-hidden>
        <div className="fn2-pg-th">
          <span>Время</span>
          <span>Клиент и что оплатил</span>
          <span>Способ</span>
          <span>Сумма</span>
          <span />
        </div>
        {Array.from({ length: PER }, (_, k) => (
          <div key={k} className="fn2-pg fn2-pg-ghost">
            <span className="sk" style={{ width: 40, height: 12 }} />
            <span className="sk" style={{ width: 34, height: 34, borderRadius: 11 }} />
            <span className="sk" style={{ width: `${[34, 26, 40, 30][k % 4]}%`, height: 11 }} />
            <span className="sk" style={{ width: 90, height: 14, marginLeft: "auto" }} />
          </div>
        ))}
        <div className="hx-foot od-foot fn2-pg-foot">
          <span className="sk" style={{ width: 220, height: 10 }} />
        </div>
      </div>
    );
  if (!res.groups.length) return <p className="fn2-note fn2-tempty">За период оплат не было.</p>;
  return (
    <div className="fn2-pgs" ref={box}>
      <div className="fn2-pg-th">
        <span>Время</span>
        <span>Клиент и что оплатил</span>
        <span>Способ</span>
        <span>Сумма</span>
        <span />
      </div>
      {res.groups.map((g) => {
        const on = opened.has(g.key);
        const d = new Date(g.at);
        const what = [g.items.length ? word(g.items.length) : "", g.weight ? `вес ${kg(g.weight.kg)}` : ""].filter(Boolean).join(" + ");
        return (
          <div key={g.key} className={"fn2-pg" + (on ? " on" : "")}>
            <button type="button" className="fn2-pg-h" onClick={() => toggle(g.key)} aria-expanded={on}>
              <span className="fn2-pg-time">
                <b>{hm(g.at)}</b>
                <small>{dayShort(isoOf(d))}</small>
              </span>
              <Who name={g.customer_name} sub={`${KIND[g.kind]} · ${what}`} />
              <span className="fn2-pg-m">{g.methods.map((m) => METHOD_LABEL[m.method] ?? m.method).join(" + ")}</span>
              <span className="fn2-pg-sum">
                {g.with_cost > 0 && g.markup !== 0 && (
                  <span className="fn2-pg-mkp" title="Наценка с этого посещения">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d={PAY_IC.trend} />
                    </svg>
                    {g.markup > 0 ? "+" : "−"}
                    {som(Math.abs(g.markup))}
                  </span>
                )}
                <b>+{som(g.total)}</b>
              </span>
              <i className="fn2-pg-chev" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </i>
            </button>
            {on && (
              <div className="fn2-pg-b2">
                <div className="fn2-pg-t">
                  <div className="fn2-pg-tr th">
                    <span>Товар</span>
                    <span>Кол-во</span>
                    <span>Сумма</span>
                    <span>Выкуп</span>
                    <span>Наценка</span>
                    <span>Оплачено</span>
                  </div>
                  {g.items.map((it) => (
                    <button type="button" key={it.payment_id} className="fn2-pg-tr" onClick={() => onOpen(it.item_id)} title="Открыть товар">
                      <span className="fn2-pg-who">
                        <i>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8" />
                          </svg>
                        </i>
                        <span>
                          <b>{it.name}</b>
                          <small>{it.code ? `код ${it.code}` : "без кода"}</small>
                        </span>
                      </span>
                      <span className="c">{it.qty} шт</span>
                      <span className="c">{som(it.sale)}</span>
                      <span className="c mu">{it.cost !== null ? som(it.cost) : "—"}</span>
                      <span className="c">
                        {it.markup !== null && it.markup !== 0 ? (
                          <em className="fn2-pg-mk2">
                            {it.markup > 0 ? "+" : "−"}
                            {som(Math.abs(it.markup))}
                          </em>
                        ) : (
                          <span className="mu">—</span>
                        )}
                      </span>
                      <b className="c">{som(it.amount)}</b>
                    </button>
                  ))}
                  {g.weight && (
                    <div className="fn2-pg-tr w">
                      <span className="fn2-pg-who">
                        <i>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M12 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6.5 9h11l2.5 11H4L6.5 9Z" />
                          </svg>
                        </i>
                        <span>
                          <b>Вес</b>
                          <small>по вашей цене за кг</small>
                        </span>
                      </span>
                      <span className="c">{kg(g.weight.kg)}</span>
                      <span className="c mu">{g.weight.kg > 0 ? `${som(Math.round(g.weight.som / g.weight.kg))}/кг` : "—"}</span>
                      <span className="c mu">—</span>
                      <span className="c mu">—</span>
                      <b className="c">{som(g.weight.som)}</b>
                    </div>
                  )}
                </div>
                {g.methods.length > 1 && (
                  <p className="fn2-pg-split">
                    Оплата:
                    {g.methods.map((m, k) => (
                      <span key={m.method}>
                        {k > 0 && " + "}
                        {METHOD_LABEL[m.method] ?? m.method} <b>{som(m.amount)}</b>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <footer className="hx-foot od-foot fn2-pg-foot">
        <small>
          {(page - 1) * PER + 1}–{Math.min(res.total_groups, page * PER)} из {res.total_groups} посещений · {res.total_payments} {plural(res.total_payments, "оплата", "оплаты", "оплат")} · {som(res.amount)}
        </small>
        {pages > 1 && (
          <span className="hx-pages">
            <button type="button" onClick={() => go(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Назад">
              ‹
            </button>
            <b>
              {page} / {pages}
            </b>
            <button type="button" onClick={() => go(Math.min(pages, page + 1))} disabled={page >= pages} aria-label="Дальше">
              ›
            </button>
          </span>
        )}
      </footer>
    </div>
  );
}

function Who({ name, sub }: { name: string; sub: string }) {
  return (
    <span className="fn2-who">
      <i>{initials(name)}</i>
      <span>
        <b>{name}</b>
        <small>{sub}</small>
      </span>
    </span>
  );
}

function Bar({ v, max, first }: { v: number; max: number; first: boolean }) {
  return (
    <span className="fn2-tbar">
      <i className={first ? "on" : ""} style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
    </span>
  );
}

// --- Когда платят -------------------------------------------------------------------------------

/** Когда платят: вывод крупно, столбики-капсулы с долями, плитки (будни/выходные/тише всего или части суток). */
function When({ data }: { data: FinanceData }) {
  const [mode, setMode] = useState<"wd" | "hr">("wd");
  const on = useGrow();
  const vals = mode === "wd" ? data.by_weekday ?? Array<number>(7).fill(0) : data.by_hour ?? Array<number>(24).fill(0);
  const total = vals.reduce((x, v) => x + v, 0);
  const mx = Math.max(0, ...vals);
  const best = total > 0 ? vals.indexOf(mx) : -1;
  const nameOf = (i: number) => (mode === "wd" ? WD_FULL[i] : `${p2(i)}:00–${p2((i + 1) % 24)}:00`);
  const WD_ON = ["в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье"];

  return (
    <section className="ov-card fn2-when2">
      <div className="fn2-ch">
        <span className="fn2-t">Когда платят</span>
        <SlideTabs<"wd" | "hr">
          value={mode}
          onChange={setMode}
          counts={false}
          options={[
            ["wd", "Дни недели"],
            ["hr", "Часы"],
          ]}
        />
      </div>

      <p className="fn2-wk-ins2">
        <i>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={mode === "wd" ? "M8 2.5v3.5M16 2.5v3.5M3.5 10h17M5.5 4.5h13a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2Z" : "M12 7.5V12l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z"} />
          </svg>
        </i>
        {best < 0 ? (
          <span>За период оплат не было</span>
        ) : (
          <span>
            <b>{mode === "wd" ? `Чаще всего ${WD_ON[best]}` : `Чаще всего с ${p2(best)}:00 до ${p2((best + 1) % 24)}:00`}</b> · {som(mx)} · {pct(mx, total)}%
          </span>
        )}
      </p>

      <div className={"fn2-wk" + (mode === "hr" ? " hr" : "")} key={mode}>
        {vals.map((v, i) => {
          const h = mx > 0 ? (v / mx) * 100 : 0;
          return (
            <div key={i} className={"fn2-wk-col" + (i === best ? " best" : "")}>
              {mode === "wd" && <span className="fn2-wk-pct">{total ? `${pct(v, total)}%` : ""}</span>}
              <div className="fn2-wk-trk">
                <i style={{ height: on ? `${v > 0 ? Math.max(4, h) : 0}%` : 0, animationDelay: `${i * (mode === "wd" ? 45 : 14)}ms` }} />
                <span className="fn2-wk-tip">
                  <b>{som(v)}</b>
                  <small>
                    {nameOf(i)} · {pct(v, total)}%
                  </small>
                </span>
              </div>
              <em>{mode === "hr" ? (i % 3 ? "" : String(i)) : WD[i]}</em>
            </div>
          );
        })}
      </div>
      {mode === "hr" && (
        <div className="fn2-wk-day" aria-hidden>
          <span>ночь</span>
          <span>утро</span>
          <span>день</span>
          <span>вечер</span>
        </div>
      )}

    </section>
  );
}

// --- Заготовка на время загрузки ----------------------------------------------------------------

function Ghost() {
  return (
    <div className="fn2-ghost" aria-hidden>
      <div className="fn2-kpis">
        {[0, 1, 2, 3, 4].map((k) => (
          <div key={k} className="fn2-k">
            <span className="sk" style={{ width: "46%", height: 9 }} />
            <span className="sk" style={{ width: "62%", height: 22, marginTop: 10 }} />
            <span className="sk" style={{ width: "100%", height: 30, marginTop: 14 }} />
          </div>
        ))}
      </div>
      <div className="fn2-g1">
        <div className="ov-card">
          <span className="sk" style={{ width: "24%", height: 10 }} />
          <span className="sk" style={{ width: "100%", height: 300, marginTop: 18, borderRadius: 14 }} />
        </div>
        <div className="ov-card">
          <span className="sk" style={{ width: "40%", height: 10 }} />
          <span className="sk" style={{ width: "100%", height: 10, marginTop: 30 }} />
          <span className="sk" style={{ width: "80%", height: 10, marginTop: 30 }} />
          <span className="sk" style={{ width: "70%", height: 10, marginTop: 20 }} />
        </div>
      </div>
    </div>
  );
}
