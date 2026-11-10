/**
 * Заказы: все товары клиентов карточками заказов.
 *
 *  - сверху — путь товара цепочкой этапов (Заказаны → В пути → На складе → Выданы, отдельно «Без кода»):
 *    сколько на каждом, клик — фильтр; рядом деньги по фильтру: сумма, оплачено, долг, прибыль;
 *  - ниже — поиск, оплата и даты кнопками, «Новый заказ»;
 *  - заказ = товары одного клиента за один день: слева отрывной листок с датой, клиент, этапы,
 *    сумма с кольцом оплаты; внутри — строки товаров (кол-во, сумма, оплата, прибыль, этап).
 * Клик по товару — его карточка; галочки — массовые действия; клик по клиенту — карточка клиента.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import { listItems, type Item, type ItemList, type ItemQuery, type ItemStage, type Totals } from "../api/domain";
import BulkBar, { useSelection } from "../components/BulkBar";
import ItemModal from "../components/ItemModal";
import CountUp from "../design/CountUp";
import { I_SEARCH, Svg } from "../design/icons";
import { Page } from "../design/table";
import { ModalError } from "../design/ui";
import { monthStartIso, profitOf, shortDateTime, som, todayIso } from "../lib/cargo";
import { useDebounced, useRefresh } from "../lib/events";
import { HomeHead } from "./overview/Home";
import Tabs from "../components/SlideTabs";

type Toast = (kind: "success" | "error", text: string) => void;
/** "" — по умолчанию всё, кроме выданных; "all" — вместе с выданными. */
type StatusTab = "" | "all" | "ordered" | "in_transit" | "in_stock" | "issued" | "no_code";
type PayFilter = "" | "unpaid" | "partial" | "paid" | "debt";
type DateFilter = "" | "today" | "7" | "month";

const LIMIT = 30;
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const STAGE_TEXT: Record<ItemStage, string> = { ordered: "Заказан", in_transit: "В пути", in_stock: "На складе", issued: "Выдан" };
/** Этап — приглушённой точкой, как по всему сайту. */
const STAGE_DOT: Record<ItemStage, string> = { ordered: "warn", in_transit: "info", in_stock: "ok", issued: "" };
const stageOf = (i: Item): ItemStage => i.stage ?? i.status;
const r2 = (n: number) => Math.round(n * 100) / 100;
const letters = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

const I = {
  ordered: ["M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z", "M3 6h18", "M16 10a4 4 0 0 1-8 0"],
  transit: ["M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2", "M15 18H9", "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 9.38a1 1 0 0 0-.78-.38H14", "M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  stock: ["M21 8 12 3 3 8v8l9 5 9-5V8Z", "m3 8 9 5 9-5", "M12 13v8"],
  issued: ["M20 6 9 17l-5-5"],
  nocode: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "m8 8 8 8", "m16 8-8 8"],
  all: ["M3 6h18", "M3 12h18", "M3 18h18"],
  plus: ["M12 5v14", "M5 12h14"],
  check: ["M20 6 9 17l-5-5"],
  minus: ["M6 12h12"],
};
function Ico({ d, size = 16, sw = 1.8 }: { d: string[]; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

export default function Orders({ toast }: { isDesktop: boolean; toast: Toast }) {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "") as StatusTab;
  const pay = (params.get("pay") ?? "") as PayFilter;
  const [dateF, setDateF] = useState<DateFilter>("");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const q = useDebounced(query.trim(), 250);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ItemList | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const nav = useNavigate();
  const sel = useSelection(`${status}|${pay}|${q}|${dateF}|${offset}`);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
    setOffset(0);
  };

  const load = useCallback(() => {
    const p: ItemQuery = { status: status === "" ? "active" : status === "all" ? "" : status === "ordered" ? "not_shipped" : status, pay, q, limit: LIMIT, offset };
    if (dateF === "today") p.date_from = todayIso();
    if (dateF === "7") p.date_from = todayIso(-6);
    if (dateF === "month") p.date_from = monthStartIso();
    listItems(p)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить заказы")));
  }, [status, pay, q, dateF, offset]);
  useEffect(load, [load]);
  useEffect(() => setOffset(0), [q, dateF]);
  // Листаем страницы — экран встаёт к первому заказу, а не к самому верху.
  const listTop = useRef<HTMLElement>(null);
  const go = (o: number) => {
    setOffset(o);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useRefresh(load);

  // Заказ — товары одного клиента за один день (строки приходят по дате, клиенты подряд).
  const orders = useMemo(() => {
    const g: Item[][] = [];
    for (const it of data?.rows ?? []) {
      const last = g[g.length - 1];
      if (last && last[0].customer_id === it.customer_id && last[0].order_date === it.order_date) last.push(it);
      else g.push([it]);
    }
    return g;
  }, [data]);

  const filtered = !!(q || status || pay || dateF);
  const c = data?.counts;
  const pages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;
  const page = Math.floor(offset / LIMIT);

  return (
    <Page size="wide">
      <div className="ov od">
        <HomeHead title="Заказы" />

        {/* ===== Путь товара: этапы цепочкой ===== */}
        <Flow counts={c} cur={status} onPick={(v) => setParam("status", v)} />


        {/* ===== Поиск и фильтры ===== */}
        <div className="od-tools">
          <Tabs
            value={status}
            onChange={(v) => setParam("status", v)}
            options={[
              ["all", "Все", c?.all],
              ["ordered", "Заказаны", c ? (c.not_shipped ?? c.ordered) : undefined, "warn"],
              ["in_transit", "В пути", c?.in_transit, "info"],
              ["in_stock", "На складе", c?.in_stock, "ok"],
              ["issued", "Выданы", c?.issued, "ink"],
              ["", "Не выданы", c ? c.all - c.issued : undefined],
            ]}
          />
          <label className="rx-as-in od-search">
            <Svg paths={I_SEARCH} size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, телефон, код" aria-label="Поиск" />
          </label>
          <Filters pay={pay} date={dateF} onPay={(v) => setParam("pay", v)} onDate={setDateF} />
          <button type="button" className="od-new" onClick={() => nav("/new-order")}>
            <Ico d={I.plus} size={15} sw={2.2} />
            Новый заказ
          </button>
        </div>

        {error && <ModalError text={error} />}

        {/* ===== Коротко о деньгах ===== */}
        <Money t={data?.totals ?? null} filtered={filtered} debtOn={pay === "debt"} onDebt={() => setParam("pay", pay === "debt" ? "" : "debt")} />

        {status === "no_code" && data && orders.length > 0 && (
          <div className="od-note">
            <span className="rx-mi">
              <Ico d={I.nocode} size={15} />
            </span>
            <span>
              <b>
                {data.total} {plural(data.total, "товар", "товара", "товаров")} без кода
              </b>
              <small>их не найти сканером на приёме — откройте товар, курсор сразу встанет в поле кода</small>
            </span>
          </div>
        )}

        {/* ===== Заказы ===== */}
        <section className="od-list" ref={listTop}>
          {orders.length > 0 && data && (
            <div className="od-list-h">
              <Check on={orders.every((g) => g.every((i) => sel.selected.has(i.id)))} half={data.rows.some((i) => sel.selected.has(i.id))} onToggle={(on) => sel.onSelect(data.rows.map((i) => i.id), on)} title="Выбрать все на странице" />
              <span>
                {orders.length} {plural(orders.length, "заказ", "заказа", "заказов")} · {data.rows.length} {plural(data.rows.length, "товар", "товара", "товаров")} на странице
              </span>
              <small>отметьте товары — внизу появятся действия</small>
            </div>
          )}
          {!data && !error
            ? Array.from({ length: 4 }, (_, i) => <OrderGhost key={i} i={i} />)
            : orders.map((g, i) => <OrderCard key={`${g[0].customer_id}-${g[0].order_date}-${g[0].id}`} items={g} i={i} selected={sel.selected} onSelect={sel.onSelect} onOpen={setOpen} />)}
          {data && !orders.length && (
            <div className="od-empty">
              {Array.from({ length: 3 }, (_, i) => (
                <OrderGhost key={i} i={i} faded />
              ))}
              <div className="rx-ghost-msg">
                <span className="rx-ghost-i">
                  <Ico d={status === "no_code" ? I.check : I.ordered} size={17} />
                </span>
                <span>
                  <b>{status === "no_code" && !filtered ? "У всех товаров есть код" : filtered ? "Ничего не найдено" : "Заказов пока нет"}</b>
                  <small>{status === "no_code" && !filtered ? "сканер на приёме найдёт каждый товар" : filtered ? "измените фильтры или поиск" : "нажмите «Новый заказ» или загрузите Excel в «Импорте»"}</small>
                </span>
              </div>
            </div>
          )}
        </section>

        {data && data.total > LIMIT && (
          <footer className="hx-foot od-foot">
            <small>
              {offset + 1}–{Math.min(data.total, offset + LIMIT)} из {data.total} товаров
            </small>
            <span className="hx-pages">
              <button type="button" onClick={() => go(Math.max(0, offset - LIMIT))} disabled={page === 0} aria-label="Назад">
                ‹
              </button>
              <b>
                {page + 1} / {pages}
              </b>
              <button type="button" onClick={() => go(offset + LIMIT)} disabled={page >= pages - 1} aria-label="Дальше">
                ›
              </button>
            </span>
          </footer>
        )}
      </div>

      {data && <BulkBar items={data.rows} selected={sel.selected} onClear={sel.clear} toast={toast} />}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </Page>
  );
}

// --- Путь товара ------------------------------------------------------------------------------

const FLOW: { k: StatusTab; label: string; icon: string[]; tone: string }[] = [
  { k: "ordered", label: "Заказаны", icon: I.ordered, tone: "a" },
  { k: "in_transit", label: "В пути", icon: I.transit, tone: "b" },
  { k: "in_stock", label: "На складе", icon: I.stock, tone: "c" },
  { k: "issued", label: "Выданы", icon: I.issued, tone: "d" },
];
/** Один рейс, мс: погрузка у «Заказаны» → таможня → выгрузка на складе → к выдаче. */
const RIDE = 26000;
/** Где машинка встаёт задом к станции (px от центра кружка): кузов у кружка, кабина видна. */
const GAP = 52;
/** Насколько проезжает дальше, чтобы сдать назад к станции (px). */
const BACK = 8;

/** Грузовик с фургоном: строгий, без детских деталей. Смотрит вправо, поворачивается по дороге. */
function Truck() {
  return (
    <svg className="of-svg" width="36" height="21" viewBox="0 0 48 28" aria-hidden>
      <rect className="of-box" x="1" y="3" width="29" height="16" rx="2.6" />
      <rect className="of-door" x="-6" y="3.5" width="7" height="15" rx="1.2" />
      <path className="of-rib" d="M8 6v10M15 6v10M22 6v10" />
      <rect className="of-stripe" x="1" y="14" width="29" height="2" />
      <path className="of-cab" d="M31 7h8.2a2.4 2.4 0 0 1 2 1.1l4.4 6.7c.3.4.4.9.4 1.4V20a1 1 0 0 1-1 1H31Z" />
      <path className="of-win" d="M33.4 9.4h5.4l3.2 5H33.4Z" />
      <circle className="of-lamp" cx="45.4" cy="17.6" r="1" />
      <rect className="of-chassis" x="2" y="19" width="43" height="2.4" rx="1.2" />
      {[8, 17, 38].map((cx) => (
        <g key={cx} className="of-wheel" style={{ transformOrigin: `${cx}px 22.5px` }}>
          <circle cx={cx} cy="22.5" r="3.7" />
          <circle className="of-hub" cx={cx} cy="22.5" r="1.3" />
          <path d={`M${cx} 19.6v1.4M${cx} 24v1.4`} />
        </g>
      ))}
    </svg>
  );
}

/** Путь товара: «Все» слева, четыре станции на дороге волнами, «Без кода» справа. Клик — фильтр. */
function Flow({ counts, cur, onPick }: { counts?: ItemList["counts"]; cur: StatusTab; onPick: (v: StatusTab) => void }) {
  const n: Record<string, number | undefined> = {
    ordered: counts ? (counts.not_shipped ?? counts.ordered) : undefined,
    in_transit: counts?.in_transit,
    in_stock: counts?.in_stock,
    issued: counts?.issued,
  };
  const sum = FLOW.reduce((a, x) => a + (n[x.k] ?? 0), 0);
  const pick = (k: StatusTab) => onPick(cur === k && k ? "" : k);
  const noCode = counts?.no_code ?? 0;
  const steps = useRef<HTMLDivElement>(null);
  const road = useRef<SVGPathElement>(null);
  const truck = useRef<HTMLSpanElement>(null);
  const cargo = useRef<HTMLSpanElement>(null);
  const bag = useRef<HTMLSpanElement>(null);
  const [geo, setGeo] = useState<{ d: string; w: number; h: number } | null>(null);

  // Дорога: от станции к станции волной (вверх, вниз, вверх), у станций — ровно.
  useLayoutEffect(() => {
    const box = steps.current;
    if (!box) return;
    const measure = () => {
      const b = box.getBoundingClientRect();
      const c = [...box.querySelectorAll<HTMLElement>(".of-node")].map((nd) => {
        const r = nd.getBoundingClientRect();
        return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 };
      });
      if (c.length < 4) return;
      const y = c[0].y;
      const A = 11;
      // У станций дорога прямая (там машинка стоит ровно), между ними — волна.
      const F = 54;
      let d = `M 0 ${y} L ${c[0].x + F} ${y}`;
      for (let i = 0; i < 3; i++) {
        const x0 = c[i].x + F;
        const x1 = c[i + 1].x - F;
        const k = (x1 - x0) * 0.22;
        const xm = (x0 + x1) / 2;
        const ym = y + (i % 2 ? A : -A);
        d += ` C ${x0 + k} ${y}, ${xm - k} ${ym}, ${xm} ${ym} C ${xm + k} ${ym}, ${x1 - k} ${y}, ${x1} ${y}`;
        d += ` L ${i < 2 ? c[i + 1].x + F : b.width} ${y}`;
      }
      setGeo({ d, w: b.width, h: b.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Рейс машинки по дороге: где стоять — ищем по длине пути; груз летит со станции в фургон и из фургона на склад.
  useLayoutEffect(() => {
    const p = road.current;
    const el = truck.current;
    const bx = cargo.current;
    const bg = bag.current;
    const box = steps.current;
    if (!geo || !p || !el || !bx || !bg || !box || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const total = p.getTotalLength();
    const nodes = [...box.querySelectorAll<HTMLElement>(".of-node")].map((nd) => {
      const r = nd.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      return { x: r.left - b.left + r.width / 2, y: r.top - b.top + r.height / 2 };
    });
    // Длина пути до точки с нужным x (дорога идёт слева направо).
    const at = (x: number) => {
      let lo = 0;
      let hi = total;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (p.getPointAtLength(mid).x < x) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const stop = nodes.map((nd) => at(nd.x + GAP));
    const pt = (l: number) => p.getPointAtLength(Math.max(0, Math.min(total, l)));
    // Положение и наклон машинки в точке пути: колёса на полотне, поворот по касательной.
    const pose = (l: number, o: number, op = 1): Keyframe => {
      const a = pt(l - 1.5);
      const b = pt(l + 1.5);
      const c = pt(l);
      const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      return { offset: o, transform: `translate(${c.x - 18}px, ${c.y - 15.5}px) rotate(${deg}deg)`, opacity: op };
    };
    const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const kf: Keyframe[] = [];
    const drive = (t0: number, t1: number, l0: number, l1: number, fade?: "in" | "out") => {
      for (let k = 0; k <= 40; k++) {
        const q = k / 40;
        const op = fade === "in" ? Math.min(1, q * 3) : fade === "out" ? Math.min(1, (1 - q) * 3) : 1;
        kf.push(pose(l0 + (l1 - l0) * ease(q), t0 + (t1 - t0) * q, op));
      }
    };
    // Подъезд: проезжает станцию, останавливается и сдаёт задом к кружку.
    const arrive = (t0: number, t1: number, from: number, to: number, fade?: "in") => {
      drive(t0, t1 - 0.03, from, to + BACK, fade);
      drive(t1 - 0.03, t1, to + BACK, to);
    };
    arrive(0, 0.13, 0, stop[0], "in");
    arrive(0.18, 0.35, stop[0], stop[1]);
    arrive(0.39, 0.56, stop[1], stop[2]);
    arrive(0.66, 0.83, stop[2], stop[3]);
    drive(0.88, 0.97, stop[3], total, "out");
    kf.push({ ...pose(total, 1), opacity: 0 });
    const t = Number(el.getAnimations()[0]?.currentTime ?? 0) % RIDE;
    for (const a of [...el.getAnimations(), ...bx.getAnimations(), ...bg.getAnimations()]) a.cancel();
    const ride = el.animate(
      kf.filter((x, n, arr) => n === 0 || (x.offset as number) > (arr[n - 1].offset as number)),
      { duration: RIDE, iterations: Infinity }
    );
    // Посылка: дугой со станции в фургон (погрузка) и из фургона на склад (выгрузка).
    const tr = (x: number, y: number, sc = 1) => `translate(${x - 5}px, ${y - 5}px) scale(${sc})`;
    const arc = (t0: number, t1: number, from: { x: number; y: number }, to: { x: number; y: number }): Keyframe[] => {
      const mx = (from.x + to.x) / 2;
      const my = Math.min(from.y, to.y) - 13;
      const eo = "cubic-bezier(.33,.0,.2,1)";
      return [
        { offset: t0, transform: tr(from.x, from.y, 0.4), opacity: 0 },
        { offset: t0 + (t1 - t0) * 0.15, transform: tr(from.x, from.y - 8, 1), opacity: 1, easing: eo },
        { offset: t0 + (t1 - t0) * 0.55, transform: tr(mx, my, 1.08), opacity: 1, easing: eo },
        { offset: t0 + (t1 - t0) * 0.92, transform: tr(to.x, to.y, 0.8), opacity: 1 },
        { offset: t1, transform: tr(to.x, to.y, 0.4), opacity: 0 },
      ];
    };
    const a0 = pt(stop[0]);
    const a2 = pt(stop[2]);
    const a3 = pt(stop[3]);
    // Задняя дверь открыта: груз входит в кузов и выходит из него.
    const rear = (q: DOMPoint) => ({ x: q.x - 15, y: q.y - 7 });
    const fly = bx.animate(
      [
        { offset: 0, transform: tr(nodes[0].x, nodes[0].y, 0.4), opacity: 0 },
        ...arc(0.14, 0.17, nodes[0], rear(a0)),
        ...arc(0.575, 0.635, rear(a2), nodes[2]),
        { offset: 1, transform: tr(nodes[2].x, nodes[2].y, 0.4), opacity: 0 },
      ],
      { duration: RIDE, iterations: Infinity }
    );
    // Выдача: маленький пакетик из кузова к «Выданы».
    const give = bg.animate(
      [{ offset: 0, transform: tr(a3.x, a3.y, 0.4), opacity: 0 }, ...arc(0.842, 0.872, rear(a3), nodes[3]), { offset: 1, transform: tr(nodes[3].x, nodes[3].y, 0.4), opacity: 0 }],
      { duration: RIDE, iterations: Infinity }
    );
    ride.currentTime = t;
    give.currentTime = t;
    fly.currentTime = t;
    // Вспышки станций — по тем же часам.
    for (const a of box.getAnimations({ subtree: true })) if (a instanceof CSSAnimation && /^of(Ping|Door)/.test(a.animationName)) a.currentTime = t;
  }, [geo]);

  return (
    <section className="of">
      <button type="button" className={"of-all" + (cur === "all" ? " on" : "")} onClick={() => onPick(cur === "all" ? "" : "all")} title={cur === "all" ? "Вернуть: всё, кроме выданных" : "Показать все товары, вместе с выданными"}>
        <small>Все товары</small>
        <b>{counts ? <CountUp text={String(counts.all)} /> : "…"}</b>
        <em>{cur ? "× сбросить фильтр" : "весь путь товара →"}</em>
      </button>

      <div className="of-track">
        <div ref={steps} className="of-steps">
          {geo && (
            <svg className="of-road" width={geo.w} height={geo.h} aria-hidden>
              <path className="of-road-e" d={geo.d} />
              <path ref={road} className="of-road-b" d={geo.d} />
              <path className="of-road-m" d={geo.d} />
            </svg>
          )}
          <span ref={truck} className="of-truck" aria-hidden>
            <Truck />
          </span>
          <span ref={cargo} className="of-cargo" aria-hidden />
          <span ref={bag} className="of-cargo bag" aria-hidden />
          {FLOW.map((x, i) => {
            const v = n[x.k];
            const pctv = v !== undefined && sum ? Math.round((v / sum) * 100) : 0;
            return (
              <Fragment key={x.k}>
                {i > 0 && <span className="of-conn" aria-hidden />}
                <button type="button" className={"of-step " + x.tone + (cur === x.k ? " on" : "")} onClick={() => pick(x.k)} style={{ animationDelay: `${i * 60}ms` }}>
                  <span className="of-node">
                    <Ico d={x.icon} size={16} />
                  </span>
                  <span className="of-t">
                    <small>{x.label}</small>
                    <span className="of-n">
                      <b>{v === undefined ? "…" : <CountUp text={String(v)} />}</b>
                      <em>{pctv}%</em>
                    </span>
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
        <div className="of-bar" aria-hidden>
          {FLOW.map((x) => {
            const v = n[x.k] ?? 0;
            return v > 0 ? <i key={x.k} className={x.tone + (cur === x.k ? " on" : "")} style={{ flexGrow: v }} onClick={() => pick(x.k)} /> : null;
          })}
        </div>
      </div>

      <button type="button" className={"of-all nc" + (cur === "no_code" ? " on" : "") + (noCode ? " warn" : "")} onClick={() => pick("no_code")} title={noCode ? "Показать товары без кода" : "У всех товаров есть код"}>
        <small>Без кода</small>
        <b>{counts ? noCode : "…"}</b>
        <em>{cur === "no_code" ? "× сбросить фильтр" : noCode ? "сканер их не найдёт →" : "у всех товаров есть код"}</em>
      </button>
    </section>
  );
}

// --- Деньги -----------------------------------------------------------------------------------

/** Коротко о деньгах по фильтру — одной строкой; подробно всё на «Финансах». */
function Money({ t, filtered, debtOn, onDebt }: { t: Totals | null; filtered: boolean; debtOn: boolean; onDebt: () => void }) {
  const nav = useNavigate();
  const share = t && t.sale > 0 ? Math.min(100, Math.round((Math.min(t.paid, t.sale) / t.sale) * 100)) : 0;
  return (
    <section className="os">
      <span className="os-c">
        <small>{filtered ? "По фильтру" : "Все заказы"}</small>
        <b>{t ? <CountUp text={som(t.sale)} /> : "—"}</b>
      </span>
      <span className="os-pay">
        <span className="os-bar" title={`Оплачено ${share}%`}>
          <i style={{ width: `${share}%` }} />
        </span>
        <small>
          оплачено <b>{t ? som(t.paid) : "—"}</b> · {share}%
        </small>
      </span>
      <button type="button" className={"os-debt" + (debtOn ? " on" : "")} onClick={onDebt} disabled={!t || (!t.debt && !debtOn)}>
        <i />
        долг <b>{t ? som(t.debt) : "—"}</b>
        {t && (t.debt > 0 || debtOn) && <em>{debtOn ? "×" : "→"}</em>}
      </button>
      <button type="button" className="os-fin" onClick={() => nav("/finance")} title="Прибыль, оплаты и долги подробно">
        Финансы
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7 17 17 7M8 7h9v9" />
        </svg>
      </button>
    </section>
  );
}

const PAYS: [PayFilter, string][] = [
  ["", "Любая"],
  ["unpaid", "Не оплачено"],
  ["partial", "Частично"],
  ["paid", "Оплачено"],
  ["debt", "С долгом"],
];
const DATES: [DateFilter, string][] = [
  ["", "Всё время"],
  ["today", "Сегодня"],
  ["7", "7 дней"],
  ["month", "Месяц"],
];

/** Одна кнопка «Фильтр»: внутри оплата и период. Выбранное пишется на кнопке, ✕ сбрасывает всё. */
function Filters({ pay, date, onPay, onDate }: { pay: PayFilter; date: DateFilter; onPay: (v: PayFilter) => void; onDate: (v: DateFilter) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const on = [pay && PAYS.find((o) => o[0] === pay)?.[1], date && DATES.find((o) => o[0] === date)?.[1]].filter(Boolean);
  const group = <V extends string>(title: string, opts: [V, string][], v: V, set: (x: V) => void) => (
    <>
      <h6>{title}</h6>
      <div className="od-flt-o">
        {opts.map(([k, l]) => (
          <button key={k} type="button" className={v === k ? "on" : ""} onClick={() => set(k)}>
            {l}
          </button>
        ))}
      </div>
    </>
  );
  return (
    <div ref={ref} className={"od-flt" + (open ? " open" : "") + (on.length ? " set" : "")}>
      <button type="button" className="od-flt-b" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Ico d={["M4 5h16l-6 7.5V18l-4 2v-7.5Z"]} size={15} sw={1.9} />
        <span>{on.length ? on.join(" · ") : "Фильтр"}</span>
        {on.length ? (
          <span className="od-flt-x" role="button" aria-label="Сбросить фильтр" onClick={(e) => (e.stopPropagation(), onPay(""), onDate(""), setOpen(false))}>
            <Ico d={["M18 6 6 18", "m6 6 12 12"]} size={11} sw={2.6} />
          </span>
        ) : (
          <Ico d={["m6 9 6 6 6-6"]} size={13} sw={2.2} />
        )}
      </button>
      {open && (
        <div className="od-flt-m">
          {group("Оплата", PAYS, pay, onPay)}
          {group("Период", DATES, date, onDate)}
        </div>
      )}
    </div>
  );
}

// --- Карточка заказа --------------------------------------------------------------------------

function OrderCard({ items, i, selected, onSelect, onOpen }: { items: Item[]; i: number; selected: Set<number>; onSelect: (ids: number[], on: boolean) => void; onOpen: (id: number) => void }) {
  const nav = useNavigate();
  const first = items[0];
  const sale = r2(items.reduce((s, x) => s + x.sale, 0));
  const debt = r2(items.reduce((s, x) => s + x.debt, 0));
  const paid = Math.max(0, r2(sale - debt));
  const qty = items.reduce((s, x) => s + x.qty, 0);
  const withCost = items.filter((x) => x.cost !== null);
  const profit = r2(withCost.reduce((s, x) => s + x.sale - (x.cost ?? 0), 0));
  const ps = sale <= 0 ? "w" : debt <= 0 ? "ok" : paid > 0 ? "part" : "no";
  const share = sale > 0 ? Math.round((paid / sale) * 100) : 100;
  const stages = (["ordered", "in_transit", "in_stock", "issued"] as const).map((s) => [s, items.filter((x) => stageOf(x) === s).length] as const).filter(([, n]) => n > 0);
  const allOn = items.every((x) => selected.has(x.id));
  const someOn = items.some((x) => selected.has(x.id));
  const d = new Date(`${first.order_date.slice(0, 10)}T00:00:00`);
  const day = first.order_date.slice(0, 10);
  const rel = day === todayIso() ? "сегодня" : day === todayIso(-1) ? "вчера" : WD[d.getDay()];

  return (
    <article className={"od-card" + (someOn ? " sel" : "")} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
      {/* Отрывной листок с датой */}
      <div className="od-date" title={`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`}>
        <div className="od-date-in">
          <small>{MON[d.getMonth()]}</small>
          <b>{d.getDate()}</b>
          <em>{rel}</em>
        </div>
      </div>
      <div className="od-main">
        <header className="od-head">
          <Check on={allOn} half={someOn} onToggle={(on) => onSelect(items.map((x) => x.id), on)} title="Выбрать все товары заказа" />
          <button type="button" className="od-who" onClick={() => nav(`/customers/${first.customer_id}`)} title="Открыть клиента">
            <span className="rx-av">{letters(first.customer_name)}</span>
            <span>
              <b>{first.customer_name}</b>
              <small>{first.customer_phone}</small>
            </span>
          </button>
          <span className="od-stages">
            {stages.map(([s, n]) => (
              <span key={s} className={"rx-pill-st " + STAGE_DOT[s]}>
                {STAGE_TEXT[s].toLowerCase()} {n}
              </span>
            ))}
          </span>
          {/* Оплата заказа: значок + сумма + понятная подпись */}
          <span className={"od-sum " + ps} title={sale > 0 ? `оплачено ${som(paid)} из ${som(sale)}` : undefined}>
            <small>
              {ps === "ok" && <Ico d={I.check} size={12} sw={3} />}
              {ps === "w" ? "По весу" : ps === "ok" ? "Оплачено" : ps === "no" ? "Не оплачено" : `Долг ${som(debt)}`}
            </small>
            <b>{som(sale)}</b>
            {ps === "part" && <i style={{ "--p": share } as CSSProperties} />}
          </span>
        </header>

        <div className="od-items">
          <div className="od-cols" aria-hidden>
            <span />
            <span>Товар</span>
            <span>Кол-во</span>
            <span>Сумма</span>
            <span>Прибыль</span>
            <span>Оплата</span>
            <span>Статус</span>
          </div>
          {items.map((it) => (
            <ItemRow key={it.id} it={it} on={selected.has(it.id)} onToggle={(on) => onSelect([it.id], on)} onOpen={() => onOpen(it.id)} />
          ))}
        </div>

        <footer className="od-foot-l">
          <span>
            <small>Товаров</small>
            <b>
              {items.length}
              {qty !== items.length ? ` · ${qty} шт` : ""}
            </b>
          </span>
          <span>
            <small>Прибыль</small>
            <b className={withCost.length && profit < 0 ? "neg" : ""}>{withCost.length ? `${profit > 0 ? "+" : ""}${som(profit)}` : "нет цены выкупа"}</b>
          </span>
        </footer>
      </div>
    </article>
  );
}

function ItemRow({ it, on, onToggle, onOpen }: { it: Item; on: boolean; onToggle: (on: boolean) => void; onOpen: () => void }) {
  const p = profitOf(it);
  const st = stageOf(it);
  const dm = (x?: string | null) => (x ? shortDateTime(x).slice(0, 5) : "");
  const note =
    st === "ordered"
      ? dm(it.order_date)
      : st === "in_transit"
        ? it.transit_shipped_at
          ? `отправлен ${dm(it.transit_shipped_at)}`
          : ""
        : st === "in_stock"
          ? it.arrived_at
            ? `прибыл ${shortDateTime(it.arrived_at)}`
            : ""
          : it.issued_at
            ? shortDateTime(it.issued_at)
            : "";
  const pay: [string, string] = it.sale <= 0 ? ["", "по весу"] : it.pay_status === "paid" ? ["ok", "Оплачено"] : it.pay_status === "partial" ? ["warn", "Частично"] : ["bad", "Не оплачено"];
  return (
    <div onClick={onOpen} className={"od-row" + (on ? " on" : "")} title="Открыть карточку товара">
      <Check on={on} onToggle={onToggle} />
      <span className="od-row-n">
        <b>{it.name}</b>
        <small>{it.code ? it.code : <em>без кода</em>}</small>
      </span>
      <span className="od-row-q">{it.qty} шт</span>
      <span className="od-row-s">
        <b>{it.sale > 0 ? som(it.sale) : "—"}</b>
      </span>
      <span className="od-row-p">{p === null ? <small>—</small> : <b className={p < 0 ? "neg" : "pos"}>{`${p > 0 ? "+" : ""}${som(p)}`}</b>}</span>
      <span className="od-row-pay">
        <span className={"od-pay " + pay[0]}>{pay[1]}</span>
      </span>
      <span className="od-row-st">
        <span className={"rx-pill-st " + STAGE_DOT[st]}>{STAGE_TEXT[st]}</span>
        {note && <small>{note}</small>}
      </span>
    </div>
  );
}
function OrderGhost({ i, faded }: { i: number; faded?: boolean }) {
  return (
    <article className="od-card ghost" aria-hidden style={faded ? { opacity: Math.max(0.2, 0.7 - i * 0.2) } : undefined}>
      <div className="od-date">
        <span className="sk" style={{ width: 24, height: 8 }} />
        <span className="sk" style={{ width: 30, height: 22, marginTop: 4 }} />
      </div>
      <div className="od-main">
        <header className="od-head">
          <span className="sk rx-sk-av" />
          <span style={{ flex: 1 }}>
            <span className="sk" style={{ width: `${[30, 22, 36, 26][i % 4]}%`, height: 10 }} />
            <span className="sk" style={{ width: "16%", height: 8, marginTop: 6 }} />
          </span>
          <span className="sk" style={{ width: 90, height: 14 }} />
        </header>
        {[0, 1].map((k) => (
          <div key={k} className="od-row ghost">
            <span className="sk" style={{ width: 18, height: 18, borderRadius: 6 }} />
            <span className="od-row-n">
              <span className="sk" style={{ width: `${[48, 36][k]}%`, height: 9 }} />
              <span className="sk" style={{ width: "24%", height: 7, marginTop: 6 }} />
            </span>
            <span className="sk" style={{ width: 70, height: 9, marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    </article>
  );
}

// --- Мелочи -------------------------------------------------------------------------------------

/** Галочка выбора; half — выбрана часть. Клик не открывает карточку товара. */
function Check({ on, half, onToggle, title }: { on: boolean; half?: boolean; onToggle: (on: boolean) => void; title?: string }) {
  return (
    <span
      role="checkbox"
      aria-checked={on ? true : half ? "mixed" : false}
      tabIndex={0}
      title={title}
      className={"od-check" + (on || half ? " on" : "")}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!on);
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          onToggle(!on);
        }
      }}
    >
      {on ? <Ico d={I.check} size={12} sw={3} /> : half ? <Ico d={I.minus} size={12} sw={3} /> : null}
    </span>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
