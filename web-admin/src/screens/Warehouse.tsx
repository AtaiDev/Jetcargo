/**
 * Склад: где сейчас товар клиентов.
 *
 *  - сверху — три карточки: «На складе», «Ожидаются», «Выдано сегодня»; первые две переключают,
 *    что показано ниже. Счётчики — с сервера (готовы/с долгом не зависят от лимита строк);
 *  - под ними — быстрые фильтры этапа (готовы к выдаче, с долгом, лежат долго), поиск, «Полки/Список»;
 *  - товары — «полками» по клиентам: у каждой полки клиент, сколько дней лежит/ждём, товары, итог
 *    и «Выдать»; или списком — для массовых действий;
 *  - вкладка «История сканов» — лента сканов по дням.
 * Обновляется сам после сканирования/выдачи (в том числе из другой вкладки) и раз в 20 секунд.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import { listIssues, listItems, listScans, type IssueList, type Item, type ItemList, type Page as PageOf, type ScanResult, type ScanRow } from "../api/domain";
import { Empty } from "../components/cargo";
import BulkBar, { useSelection } from "../components/BulkBar";
import ItemModal from "../components/ItemModal";
import SlideTabs from "../components/SlideTabs";
import CountUp from "../design/CountUp";
import { I_CHECK, I_CLOCK, I_SEARCH, Icon, Svg } from "../design/icons";
import { Page } from "../design/table";
import { ModalError, SkeletonRows } from "../design/ui";
import { som, todayIso } from "../lib/cargo";
import { useDebounced, useRefresh } from "../lib/events";
import { HomeHead } from "./overview/Home";

type Toast = (kind: "success" | "error", text: string) => void;
type PathDef = [string, Record<string, unknown>][];
type Stage = "in_stock" | "ordered";
type Sub = "all" | "ready" | "debt" | "old" | "paid" | "transit" | "waiting";
type Kpi = { stock: ItemList; stockDebt: number; ordered: ItemList; issued: IssueList | null };

/** Сколько товаров этапа грузим разом: полки собираются из всех, а не из одной страницы. */
const ALL = 500;
/** С какого срока товар «лежит долго» на складе и «ждём долго» у заказанных. */
const OLD_STOCK = 7;
const OLD_ORDER = 14;

export default function Warehouse({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "scans" ? "scans" : "items";
  return (
    <Page size="wide">
      <div className="ov wx">
        <div className="wx-head">
          <HomeHead title="Склад" />
          <div className="wx-head-r">
            <SlideTabs<"items" | "scans">
              value={tab}
              onChange={(v) => setParams(v === "scans" ? { tab: "scans" } : {}, { replace: true })}
              options={[
                ["items", "Товары"],
                ["scans", "История сканов"],
              ]}
            />
          </div>
        </div>
        {tab === "items" ? <Items isDesktop={isDesktop} toast={toast} /> : <Scans toast={toast} />}
      </div>
    </Page>
  );
}

// --- Сроки ---------------------------------------------------------------------------------------

const DAY = 86400000;
/** Сколько полных дней прошло с даты (ISO-время или YYYY-MM-DD). */
function daysSince(d: string | null): number | null {
  if (!d) return null;
  const t = d.length <= 10 ? new Date(`${d}T00:00:00`).getTime() : new Date(d).getTime();
  return Math.max(0, Math.floor((Date.now() - t) / DAY));
}
/** Срок товара: на складе — с приёма, заказанного — с даты заказа. */
const ageOf = (it: Item) => (it.status === "in_stock" ? daysSince(it.arrived_at) : daysSince(it.order_date)) ?? 0;
const daysText = (n: number) => (n === 0 ? "сегодня" : `${n} ${plural(n, "день", "дня", "дней")}`);

// --- Товары --------------------------------------------------------------------------------------

type Pay = "" | "paid" | "debt";
type Ship = "" | "transit" | "waiting";
type Sort = "age" | "name" | "sum" | "debt";
const SORTS: [Sort, string][] = [
  ["age", "Дольше ждут"],
  ["name", "По имени"],
  ["sum", "Больше сумма"],
  ["debt", "Больше долг"],
];

/** Подходит ли товар под фильтры: оплата, отправка (у ожидаемых), «долго» (lim — дней). */
function fits(it: Item, pay: Pay, ship: Ship, old: boolean, lim: number): boolean {
  if (pay === "paid" && it.debt > 0) return false;
  if (pay === "debt" && it.debt <= 0) return false;
  if (ship === "transit" && it.stage !== "in_transit") return false;
  if (ship === "waiting" && it.stage === "in_transit") return false;
  return !old || ageOf(it) >= lim;
}

/** Ключ сортировки группы (полки клиента) или одного товара: больше — выше. */
function sortKey(g: Item[], sort: Sort): number {
  if (sort === "sum") return g.reduce((a, x) => a + x.sale, 0);
  if (sort === "debt") return g.reduce((a, x) => a + x.debt, 0);
  return Math.max(...g.map(ageOf));
}
function sortGroups(groups: Item[][], sort: Sort): Item[][] {
  if (sort === "name") return [...groups].sort((a, b) => a[0].customer_name.localeCompare(b[0].customer_name, "ru"));
  return [...groups].sort((a, b) => sortKey(b, sort) - sortKey(a, sort));
}

function Items({ toast }: { isDesktop: boolean; toast: Toast }) {
  const [stage, setStage] = useState<Stage>("in_stock");
  const [pay, setPay] = useState<Pay>("");
  const [ship, setShip] = useState<Ship>("");
  const [old, setOld] = useState(false);
  const [sort, setSort] = useState<Sort>("age");
  const [view, setView] = useState<"shelves" | "list">("shelves");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [data, setData] = useState<ItemList | null>(null);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const sel = useSelection(`${stage}|${pay}|${ship}|${old}|${q}|${view}`);

  // Табло — по всему складу, без поиска; «с долгом» считает сервер, а не первые ALL строк.
  const loadKpi = useCallback(() => {
    const start = new Date(`${todayIso()}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    Promise.all([
      listItems({ status: "in_stock", sort: "arrived", limit: ALL }),
      listItems({ status: "in_stock", pay: "debt", limit: 1 }),
      listItems({ status: "ordered", sort: "customer", limit: ALL }),
      listIssues({ since: start.toISOString(), until: end.toISOString(), limit: 1 }).catch(() => null),
    ])
      .then(([stock, debt, ordered, issued]) => setKpi({ stock, stockDebt: debt.total, ordered, issued }))
      .catch(() => undefined);
  }, []);
  const load = useCallback(() => {
    listItems({ status: stage, q, sort: "customer", limit: ALL })
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить склад")));
  }, [stage, q]);
  const loadAll = useCallback(() => {
    load();
    loadKpi();
  }, [load, loadKpi]);

  useEffect(load, [load]);
  useEffect(loadKpi, [loadKpi]);
  useRefresh(loadAll);
  useEffect(() => {
    const t = window.setInterval(loadAll, 20000);
    return () => window.clearInterval(t);
  }, [loadAll]);

  const lim = stage === "in_stock" ? OLD_STOCK : OLD_ORDER;
  const cnt = (p: Pay, o: boolean) => (data ? data.rows.filter((it) => fits(it, p, ship, o, lim)).length : undefined);
  const rows = useMemo(() => (data?.rows ?? []).filter((it) => fits(it, pay, ship, old, lim)), [data, pay, ship, old, lim]);

  // Полки: все товары клиента вместе, порядок — по выбранной сортировке.
  const shelves = useMemo(() => {
    const m = new Map<number, Item[]>();
    for (const it of rows) {
      const g = m.get(it.customer_id);
      if (g) g.push(it);
      else m.set(it.customer_id, [it]);
    }
    return sortGroups([...m.values()], sort);
  }, [rows, sort]);

  // Табло и фильтры связаны: клик по легенде табло ставит этап и нужный фильтр.
  const boardSub: Sub = ship || (pay === "debt" ? "debt" : pay === "paid" ? (stage === "in_stock" ? "ready" : "paid") : "all");
  const pick = (st: Stage, sb: Sub) => {
    setStage(st);
    setPay(sb === "debt" ? "debt" : sb === "ready" || sb === "paid" ? "paid" : "");
    setShip(sb === "transit" || sb === "waiting" ? sb : "");
    setOld(sb === "old");
  };

  return (
    <>
      <Board kpi={kpi} stage={stage} sub={boardSub} onPick={pick} />

      <div className="wx-bar">
        {ship && (
          <button type="button" className="wx-token" onClick={() => setShip("")} title="Убрать фильтр">
            {ship === "transit" ? "В пути" : "Не отправлены"}
            <Svg paths={[["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]]} size={11} sw={2.6} />
          </button>
        )}
        <SlideTabs<Pay>
          value={pay}
          onChange={setPay}
          options={[
            ["", "Все", cnt("", old)],
            ["paid", "Оплачены", cnt("paid", old), "ink"],
            ["debt", "С долгом", cnt("debt", old), "bad"],
          ]}
        />
        <button type="button" className={"wx-toggle" + (old ? " on" : "")} onClick={() => setOld(!old)} aria-pressed={old} title={stage === "in_stock" ? "Товары, которые лежат на складе дольше недели" : "Заказы, которые ждём дольше двух недель"}>
          <Svg paths={I_CLOCK as PathDef} size={14} sw={2.1} />
          {stage === "in_stock" ? `Лежат ${OLD_STOCK}+ дней` : `Ждём ${OLD_ORDER}+ дней`}
          <em>{cnt(pay, true) ?? "…"}</em>
        </button>
        <label className="rx-as-in od-search">
          <Svg paths={I_SEARCH} size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Клиент, телефон, код, товар" aria-label="Поиск" />
        </label>
        <SortPick value={sort} onChange={setSort} />
        <SlideTabs<"shelves" | "list">
          value={view}
          onChange={setView}
          options={[
            ["shelves", "Полки"],
            ["list", "Список"],
          ]}
        />
      </div>

      {error && <ModalError text={error} />}
      {!data && !error ? (
        <div className="wh-wall">
          {[0, 1, 2].map((c) => (
            <div key={c} className="wh-col">
              {[0, 1].map((k) => (
                <ShelfGhost key={k} n={[3, 2, 4][(c + k) % 3]} />
              ))}
            </div>
          ))}
        </div>
      ) : data && rows.length === 0 ? (
        <div className="wx-none">
          <div className="wh-wall wx-none-bg" aria-hidden>
            {[2, 3, 2].map((n, c) => (
              <div key={c} className="wh-col">
                <ShelfGhost n={n} still />
              </div>
            ))}
          </div>
          <div className="wx-none-c">
            <span className="wx-none-i">
              <Icon name="warehouse" size={20} />
            </span>
            <b>{q || pay || ship || old ? "Ничего не найдено" : stage === "in_stock" ? "На складе пусто" : "Ничего не ожидается"}</b>
            <small>
              {q || pay || ship || old
                ? "Под эти фильтры товаров нет — уберите фильтр или измените поиск"
                : stage === "in_stock"
                  ? "Товары попадают сюда, когда их код сканируют на «Приёме»"
                  : "Здесь появятся заказанные товары, которые ещё не пришли"}
            </small>
            {(q || pay || ship || old) && (
              <button
                type="button"
                className="wx-none-b"
                onClick={() => {
                  setQuery("");
                  setPay("");
                  setShip("");
                  setOld(false);
                }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        </div>
      ) : data && view === "shelves" ? (
        <ShelfWall shelves={shelves} old={lim} onOpen={setOpen} />
      ) : (
        data && (
          <List groups={shelves} inStock={stage === "in_stock"} selected={sel.selected} onSelect={sel.onSelect} onOpen={setOpen} />
        )
      )}
      {data && data.total > ALL && <div className="wx-note">Показаны первые {ALL} из {data.total} — уточните поиском.</div>}
      {data && view === "list" && <BulkBar items={rows} selected={sel.selected} onClear={sel.clear} toast={toast} />}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Сортировка полок: компактная кнопка с выпадающим списком. */
function SortPick({ value, onChange }: { value: Sort; onChange: (v: Sort) => void }) {
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
  return (
    <div ref={ref} className={"od-flt" + (open ? " open" : "")}>
      <button type="button" className="od-flt-b" onClick={() => setOpen(!open)} aria-expanded={open} title="Сортировка">
        <Svg paths={[["path", { d: "M7 4v16" }], ["path", { d: "m3 8 4-4 4 4" }], ["path", { d: "M17 20V4" }], ["path", { d: "m13 16 4 4 4-4" }]]} size={15} sw={1.9} />
        <span>{SORTS.find((x) => x[0] === value)?.[1]}</span>
        <Svg paths={[["path", { d: "m6 9 6 6 6-6" }]]} size={13} sw={2.2} />
      </button>
      {open && (
        <div className="od-flt-m wx-sort-m">
          <h6>Сначала</h6>
          <div className="od-flt-o col">
            {SORTS.map(([k, l]) => (
              <button key={k} type="button" className={k === value ? "on" : ""} onClick={() => (onChange(k), setOpen(false))}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Карточки сверху -----------------------------------------------------------------------------

/** Тонкая полоса из долей (пустые доли не рисуются). */
function Bar({ parts }: { parts: [number, string][] }) {
  return (
    <span className="wx-bar6">
      {parts.map(([v, c]) => (v > 0 ? <i key={c} className={c} style={{ flexGrow: v }} /> : null))}
    </span>
  );
}

const uniq = (rows: Item[]) => new Set(rows.map((r) => r.customer_id)).size;
const clients = (n: number) => `${n} ${plural(n, "клиент", "клиента", "клиентов")}`;

/**
 * Табло склада: «Ожидаются → На складе → Выдано сегодня» — три компактные секции.
 * Клик по секции — её товары ниже; клик по строке легенды — сразу с нужным фильтром.
 */
function Board({ kpi, stage, sub, onPick }: { kpi: Kpi | null; stage: Stage; sub: Sub; onPick: (s: Stage, sub: Sub) => void }) {
  const nav = useNavigate();
  const s = kpi?.stock;
  const o = kpi?.ordered;
  const iss = kpi?.issued;
  const sum = iss?.summary;
  const debtN = kpi?.stockDebt ?? 0;
  const readyN = s ? Math.max(0, s.total - debtN) : 0;
  const oldStock = s && s.rows.length ? Math.max(...s.rows.map(ageOf)) : null;
  const oldOrder = o && o.rows.length ? Math.max(...o.rows.map(ageOf)) : null;
  const transit = o ? Math.min(o.total, o.counts.in_transit ?? 0) : 0;
  const waiting = o ? o.total - transit : 0;
  const given = sum?.items ?? 0;
  const top = (icon: string, title: string, note: ReactNode, count: number | undefined, total: number | undefined, dark?: boolean) => (
    <span className="wx-m-top">
      <span className={"wx-k-i" + (dark ? " dark" : "")}>
        <Icon name={icon} size={15} />
      </span>
      <span className="wx-m-t">
        <b>{title}</b>
        <small>{note}</small>
      </span>
      <span className="wx-m-n">
        <b>{count === undefined ? "—" : <CountUp text={String(count)} />}</b>
        <small>{total === undefined ? "" : <CountUp text={som(total)} />}</small>
      </span>
    </span>
  );
  const leg = (st: Stage, sb: Sub, tone: string, n: number, text: string) => (
    <button
      type="button"
      className={stage === st && sub === sb ? "on" : ""}
      onClick={(e) => {
        e.stopPropagation();
        onPick(st, stage === st && sub === sb ? "all" : sb);
      }}
    >
      <i className={"wx-sq " + tone} />
      <b>{n}</b> {text}
    </button>
  );
  const seg = (st: Stage) => ({
    role: "button",
    tabIndex: 0,
    className: "wx-seg" + (stage === st ? " on" : ""),
    onClick: () => onPick(st, "all"),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(st, "all")),
  });
  const owe = (v: number | undefined) => (v && v > 0 ? <span className="wx-m-owe">долг {som(v)}</span> : <span className="wx-m-ok">долга нет</span>);
  return (
    <div className="wx-board">
      <div {...seg("ordered")}>
        {top("orders", "Ожидаются", o ? `${clients(uniq(o.rows))}${oldOrder ? ` · ждём до ${daysText(oldOrder)}` : ""}` : "…", o?.total, o?.totals.sale)}
        <Bar parts={[[transit, "i"], [waiting, "w"]]} />
        <span className="wx-m-l">
          {leg("ordered", "transit", "i", transit, "в пути")}
          {leg("ordered", "waiting", "w", waiting, "не отправлены")}
          {o && owe(o.totals.debt)}
        </span>
      </div>

      <div {...seg("in_stock")}>
        {top("warehouse", "На складе", s ? `${clients(uniq(s.rows))} · ${oldStock ? `лежит до ${daysText(oldStock)}` : "всё пришло сегодня"}` : "…", s?.total, s?.totals.sale)}
        <Bar parts={[[readyN, "a"], [debtN, "d"]]} />
        <span className="wx-m-l">
          {leg("in_stock", "ready", "a", readyN, "готовы")}
          {leg("in_stock", "debt", "d", debtN, "с долгом")}
          {s && owe(s.totals.debt)}
        </span>
      </div>

      <div className="wx-seg go" role="button" tabIndex={0} onClick={() => nav("/issue")} onKeyDown={(e) => e.key === "Enter" && nav("/issue")}>
        {top("issue", "Выдано сегодня", iss ? `${iss.total} ${plural(iss.total, "выдача", "выдачи", "выдач")} · ${clients(sum?.customers ?? 0)}` : kpi ? "ещё не выдавали" : "…", iss ? given : kpi ? 0 : undefined, iss ? sum?.sale : kpi ? 0 : undefined, true)}
        <Bar parts={[[given, "a"], [s?.total ?? 0, "r"]]} />
        <span className="wx-m-l">
          <span>
            наличными <b>{som(sum?.cash ?? 0)}</b>
          </span>
          <span>
            переводом <b>{som(sum?.transfer ?? 0)}</b>
          </span>
          {(sum?.credit ?? 0) > 0 && <span className="wx-m-owe">в долг {som(sum?.credit ?? 0)}</span>}
        </span>
      </div>

      <span className="wx-arrow" style={{ left: "calc((100% - 24px) / 3 + 6px)" }} aria-hidden>
        <Svg paths={[["path", { d: "m9 6 6 6-6 6" }]]} size={13} sw={2.4} />
      </span>
      <span className="wx-arrow" style={{ left: "calc((100% - 24px) * 2 / 3 + 18px)" }} aria-hidden>
        <Svg paths={[["path", { d: "m9 6 6 6-6 6" }]]} size={13} sw={2.4} />
      </span>
    </div>
  );
}

// --- Полки клиентов ------------------------------------------------------------------------------

const SHOW = 4;
/** Ширина полки и отступ между полками — те же, что в стилях .wh-wall. */
const SHELF_W = 310;
const GAP = 14;
/** Примерная высота полки: шапка, видимые товары, «ещё N», итог. */
const shelfHeight = (n: number) => 80 + Math.min(n, SHOW) * 58 + (n > SHOW ? 38 : 0) + 96;

/** Полки «волной»: каждая следующая — в самую короткую колонку; самые давние остаются сверху. */
function ShelfWall({ shelves, old, onOpen }: { shelves: Item[][]; old: number; onOpen: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setCols(Math.max(1, Math.floor((el.clientWidth + GAP) / (SHELF_W + GAP))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const columns = useMemo(() => {
    const list = Array.from({ length: cols }, () => ({ h: 0, items: [] as Item[][] }));
    for (const g of shelves) {
      const col = list.reduce((a, b) => (b.h < a.h ? b : a));
      col.items.push(g);
      col.h += shelfHeight(g.length) + GAP;
    }
    return list;
  }, [shelves, cols]);
  return (
    <div ref={ref} className="wh-wall">
      {columns.map((c, i) => (
        <div key={i} className="wh-col">
          {c.items.map((g, k) => (
            <Shelf key={g[0].customer_id} items={g} old={old} onOpen={onOpen} i={i + k * cols} />
          ))}
        </div>
      ))}
    </div>
  );
}

const I_BOX: PathDef = [
  ["path", { d: "M21 8 12 3 3 8v8l9 5 9-5V8Z" }],
  ["path", { d: "m3 8 9 5 9-5" }],
  ["path", { d: "M12 13v8" }],
];

const I_TRUCK: PathDef = [
  ["path", { d: "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" }],
  ["path", { d: "M15 18H9" }],
  ["path", { d: "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 9.38a1 1 0 0 0-.78-.38H14" }],
  ["circle", { cx: 17, cy: 18, r: 2 }],
  ["circle", { cx: 7, cy: 18, r: 2 }],
];
const dm = (x?: string | null) => {
  if (!x) return "";
  const d = new Date(x.length <= 10 ? `${x}T00:00:00` : x);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`;
};

/** Полка клиента — бирка: скошенные углы, люверс сверху, линия отрыва и корешок с оплатой. */
function Shelf({ items, old, onOpen, i }: { items: Item[]; old: number; onOpen: (id: number) => void; i: number }) {
  const nav = useNavigate();
  const [all, setAll] = useState(false);
  const first = items[0];
  const sale = items.reduce((s, x) => s + x.sale, 0);
  const debt = items.reduce((s, x) => s + x.debt, 0);
  const qty = items.reduce((s, x) => s + x.qty, 0);
  const age = Math.max(...items.map(ageOf));
  const inStock = first.status === "in_stock";
  const shown = all ? items : items.slice(0, SHOW);
  const tr = items.filter((x) => x.stage === "in_transit");
  const shipped = tr.map((x) => x.transit_shipped_at).filter(Boolean).sort()[0];
  const ordered = items.map((x) => x.order_date).sort()[0];
  const pay = (
    <span className="wx-pay r">
      <small>{sale <= 0 ? "оплата" : debt > 0 ? (debt < sale ? `к оплате · из ${som(sale)}` : "к оплате") : "оплачено"}</small>
      <b className={debt > 0 ? "owe" : ""}>
        {sale > 0 && debt <= 0 && <Svg paths={I_CHECK} size={14} sw={2.8} />}
        {sale <= 0 ? "по весу" : som(debt > 0 ? debt : sale)}
      </b>
    </span>
  );
  return (
    <div className="wx-tagw" style={{ animationDelay: `${Math.min(i, 9) * 35}ms` }}>
      <section className="wx-shelf">
        <span className="wx-hole" aria-hidden />
        <header className="wx-sh-h">
          <button type="button" className="wx-who" onClick={() => nav(`/customers/${first.customer_id}`)} title="Открыть карточку клиента">
            <span className="rx-av">{letters(first.customer_name)}</span>
            <span>
              <b>{first.customer_name}</b>
              <small>{first.customer_phone || "без телефона"}</small>
            </span>
          </button>
          <span className={"wx-age" + (age >= old * 2 ? " bad" : age >= old ? " warn" : "")} title={inStock ? "сколько лежит самый давний товар" : "сколько ждём самый давний заказ"}>
            <Svg paths={I_CLOCK as PathDef} size={12} sw={2.2} />
            {age === 0 ? "сегодня" : daysText(age)}
          </span>
        </header>

        <div className="wx-sh-b">
          {shown.map((it) => (
            <div key={it.id} className="wx-it" onClick={() => onOpen(it.id)} title="Открыть карточку товара">
              <span className="wx-it-i">
                <Svg paths={I_BOX} size={15} sw={1.8} />
              </span>
              <span className="wx-it-n">
                <b>{it.name}</b>
                <small>
                  <code>{it.code || "без кода"}</code>
                  {it.qty > 1 && <span>· {it.qty} шт</span>}
                </small>
              </span>
              <span className="wx-it-s">
                <b>{it.sale > 0 ? som(it.sale) : "по весу"}</b>
                {it.sale > 0 && it.debt > 0 && <small>{it.debt < it.sale ? `долг ${som(it.debt)}` : "не оплачено"}</small>}
              </span>
            </div>
          ))}
          {items.length > SHOW && (
            <button type="button" className="wx-more" onClick={() => setAll((v) => !v)}>
              {all ? "Свернуть" : `Ещё ${items.length - SHOW} ${plural(items.length - SHOW, "товар", "товара", "товаров")}`}
              <Svg paths={[["path", { d: all ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6" }]]} size={13} sw={2.2} />
            </button>
          )}
        </div>

        <div className="wx-perf" aria-hidden>
          <span>
            {items.length} {plural(items.length, "товар", "товара", "товаров")}
            {qty !== items.length ? ` · ${qty} шт` : ""}
          </span>
        </div>

        <footer className="wx-stub">
          {inStock ? (
            <>
              <button type="button" className="wx-ship go wx-give2" onClick={() => nav(`/issue?customer=${first.customer_id}`)} title="Выдать клиенту">
                <span className="wx-ship-i">
                  <Icon name="warehouse" size={16} />
                </span>
                <span>
                  <b>Выдать →</b>
                  <small>на складе с {dm(items.map((x) => x.arrived_at ?? "").filter(Boolean).sort()[0])}</small>
                </span>
              </button>
              {pay}
            </>
          ) : (
            <>
              <span className={"wx-ship" + (tr.length ? " go" : "")}>
                <span className="wx-ship-i">
                  <Svg paths={I_TRUCK} size={16} sw={1.8} />
                </span>
                <span>
                  <b>{tr.length === items.length ? "В пути" : tr.length ? `В пути ${tr.length} из ${items.length}` : "Не отправлены"}</b>
                  <small>{tr.length ? (shipped ? `отправлен ${dm(shipped)}` : "по накладной") : `заказ от ${dm(ordered)}`}</small>
                </span>
              </span>
              {pay}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

function ShelfGhost({ n, still }: { n: number; still?: boolean }) {
  return (
    <div className="wx-tagw ghost" aria-hidden>
      <section className={"wx-shelf ghost" + (still ? " still" : "")}>
        <span className="wx-hole" />
        <header className="wx-sh-h">
          <span className="sk" style={{ width: 40, height: 40, borderRadius: "50%" }} />
          <span style={{ flex: 1 }}>
            <span className="sk" style={{ width: "58%", height: 11 }} />
            <span className="sk" style={{ width: "40%", height: 9, marginTop: 7 }} />
          </span>
          <span className="sk" style={{ width: 64, height: 24, borderRadius: 9, alignSelf: "flex-start" }} />
        </header>
        <div className="wx-sh-b">
          {Array.from({ length: n }, (_, k) => (
            <div key={k} className="wx-it">
              <span className="sk" style={{ width: 34, height: 34, borderRadius: 11 }} />
              <span className="wx-it-n">
                <span className="sk" style={{ width: `${[72, 54, 64, 48][k % 4]}%`, height: 10 }} />
                <span className="sk" style={{ width: "38%", height: 8, marginTop: 7 }} />
              </span>
              <span className="sk" style={{ width: 48, height: 10 }} />
            </div>
          ))}
        </div>
        <div className="wx-perf">
          <span>
            <span className="sk" style={{ width: 70, height: 8, display: "inline-block" }} />
          </span>
        </div>
        <footer className="wx-stub">
          <span className="sk" style={{ width: 38, height: 38, borderRadius: 12 }} />
          <span style={{ flex: 1 }}>
            <span className="sk" style={{ width: "50%", height: 10 }} />
            <span className="sk" style={{ width: "34%", height: 8, marginTop: 7 }} />
          </span>
          <span className="sk" style={{ width: 70, height: 18 }} />
        </footer>
      </section>
    </div>
  );
}

// --- Список -------------------------------------------------------------------------------------

/** Галочка выбора; half — выбрана часть. Клик не открывает товар. */
function Tick({ on, half, onToggle, title }: { on: boolean; half?: boolean; onToggle: (on: boolean) => void; title?: string }) {
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
      {on ? <Svg paths={I_CHECK} size={12} sw={3} /> : half ? <Svg paths={[["path", { d: "M6 12h12" }]]} size={12} sw={3} /> : null}
    </span>
  );
}

const hm = (x: string) => {
  const d = new Date(x);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

const payOf = (sale: number, debt: number): [string, string] =>
  sale <= 0 ? ["", "По весу"] : debt <= 0 ? ["ok", "Оплачено"] : debt < sale ? ["warn", `Долг ${som(debt)}`] : ["bad", "Не оплачено"];

/** Строка товара списка; sub — внутри группы клиента (клиент не повторяется). */
function ListRow({ it, inStock, sub, on, onToggle, onOpen }: { it: Item; inStock: boolean; sub?: boolean; on: boolean; onToggle: (on: boolean) => void; onOpen: (id: number) => void }) {
  const pay = payOf(it.sale, it.debt);
  const age = ageOf(it);
  const tr = it.stage === "in_transit";
  return (
    <div className={"wx-lr" + (sub ? " sub" : "") + (on ? " on" : "")} onClick={() => onOpen(it.id)} title="Открыть карточку товара">
      <Tick on={on} onToggle={onToggle} />
      {sub ? (
        <span className="wx-lc rep" />
      ) : (
        <span className="wx-lc">
          <span className="rx-av">{letters(it.customer_name)}</span>
          <span>
            <b>{it.customer_name}</b>
            <small>{it.customer_phone || "без телефона"}</small>
          </span>
        </span>
      )}
      <span className="wx-li">
        <b>{it.name}</b>
        <small>{it.code || "без кода"}</small>
      </span>
      <span className="wx-lq">
        {it.qty} <small>шт</small>
      </span>
      <span className="wx-ls">{it.sale > 0 ? som(it.sale) : "—"}</span>
      <span>
        <span className={"od-pay " + pay[0]}>{pay[1]}</span>
      </span>
      {inStock ? (
        <span className="wx-ld">
          <b>{it.arrived_at ? `${dm(it.arrived_at)} · ${hm(it.arrived_at)}` : "—"}</b>
          <small className={age >= OLD_STOCK * 2 ? "bad" : age >= OLD_STOCK ? "warn" : ""}>{age === 0 ? "сегодня" : `лежит ${daysText(age)}`}</small>
        </span>
      ) : (
        <span className="wx-ld">
          <span className={"rx-pill-st " + (tr ? "info" : "warn")}>{tr ? "В пути" : "Заказан"}</span>
          <small className={age >= OLD_ORDER ? "warn" : ""}>{tr && it.transit_shipped_at ? `отправлен ${dm(it.transit_shipped_at)}` : `заказ от ${dm(it.order_date)}`}</small>
        </span>
      )}
    </div>
  );
}

/** Список: товары сгруппированы по клиенту — сводка строкой, по клику плавно раскрываются товары. */
function List({ groups, inStock, selected, onSelect, onOpen }: { groups: Item[][]; inStock: boolean; selected: Set<number>; onSelect: (ids: number[], on: boolean) => void; onOpen: (id: number) => void }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const ids = groups.flat().map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const someOn = ids.some((id) => selected.has(id));
  const flip = (cid: number) =>
    setOpen((p) => {
      const n = new Set(p);
      if (n.has(cid)) n.delete(cid);
      else n.add(cid);
      return n;
    });
  return (
    <div className="ov-card paper wx-tbl">
      <div className="wx-lh">
        <Tick on={allOn} half={someOn} onToggle={(on) => onSelect(ids, on)} title="Выбрать все" />
        <span>Клиент</span>
        <span>Товар</span>
        <span>Кол-во</span>
        <span>Сумма</span>
        <span>Оплата</span>
        <span>{inStock ? "Поступил" : "Статус"}</span>
      </div>
      {groups.map((g) => {
        const first = g[0];
        if (g.length === 1) {
          return (
            <div key={first.customer_id} className="wx-grp">
              <ListRow it={first} inStock={inStock} on={selected.has(first.id)} onToggle={(on) => onSelect([first.id], on)} onOpen={onOpen} />
            </div>
          );
        }
        const gid = g.map((x) => x.id);
        const gOn = gid.every((id) => selected.has(id));
        const gSome = gid.some((id) => selected.has(id));
        const isOpen = open.has(first.customer_id);
        const sale = g.reduce((a, x) => a + x.sale, 0);
        const debt = g.reduce((a, x) => a + x.debt, 0);
        const qty = g.reduce((a, x) => a + x.qty, 0);
        const pay = payOf(sale, debt);
        const age = Math.max(...g.map(ageOf));
        const firstIn = g.map((x) => x.arrived_at ?? "").filter(Boolean).sort()[0];
        const tr = g.filter((x) => x.stage === "in_transit").length;
        return (
          <div key={first.customer_id} className={"wx-grp" + (isOpen ? " open" : "")}>
            <div className={"wx-lr wx-gh" + (gOn ? " on" : "")} onClick={() => flip(first.customer_id)} aria-expanded={isOpen}>
              <Tick on={gOn} half={gSome} onToggle={(on) => onSelect(gid, on)} title="Выбрать товары клиента" />
              <span className="wx-lc">
                <span className="rx-av">{letters(first.customer_name)}</span>
                <span>
                  <b>{first.customer_name}</b>
                  <small>{first.customer_phone || "без телефона"}</small>
                </span>
              </span>
              <span className="wx-cnt">
                <span className="wx-cnt-i">
                  <Svg paths={I_BOX} size={15} sw={1.8} />
                </span>
                <span>
                  <b>
                    {g.length} {plural(g.length, "товар", "товара", "товаров")}
                  </b>
                  <small>
                    {isOpen ? "свернуть" : "показать все"}
                    <Svg paths={[["path", { d: "m6 9 6 6 6-6" }]]} size={12} sw={2.4} />
                  </small>
                </span>
              </span>
              <span className="wx-lq">
                {qty} <small>шт</small>
              </span>
              <span className="wx-ls">{sale > 0 ? som(sale) : "—"}</span>
              <span>
                <span className={"od-pay " + pay[0]}>{pay[1]}</span>
              </span>
              {inStock ? (
                <span className="wx-ld">
                  <b>{firstIn ? `с ${dm(firstIn)}` : "—"}</b>
                  <small className={age >= OLD_STOCK * 2 ? "bad" : age >= OLD_STOCK ? "warn" : ""}>{age === 0 ? "сегодня" : `лежит до ${daysText(age)}`}</small>
                </span>
              ) : (
                <span className="wx-ld mix">
                  {tr > 0 && <span className="rx-pill-st info">В пути {tr}</span>}
                  {g.length - tr > 0 && <span className="rx-pill-st warn">Заказан {g.length - tr}</span>}
                </span>
              )}
            </div>
            <div className="wx-acc">
              <div className="wx-acc-in">
                {g.map((it) => (
                  <ListRow key={it.id} it={it} inStock={inStock} sub on={selected.has(it.id)} onToggle={(on) => onSelect([it.id], on)} onOpen={onOpen} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- История сканирований ------------------------------------------------------------------------

const I_REPEAT: PathDef = [
  ["path", { d: "M3 12a9 9 0 0 1 15.5-6.2L21 8" }],
  ["path", { d: "M21 3v5h-5" }],
  ["path", { d: "M21 12a9 9 0 0 1-15.5 6.2L3 16" }],
  ["path", { d: "M3 21v-5h5" }],
];
const I_OUT: PathDef = [
  ["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }],
  ["path", { d: "m16 17 5-5-5-5" }],
  ["path", { d: "M21 12H9" }],
];
const I_ALERT: PathDef = [
  ["circle", { cx: 12, cy: 12, r: 9 }],
  ["path", { d: "M12 7.5v5.5" }],
  ["path", { d: "M12 16.5h.01" }],
];

const RESULT: Record<ScanResult, { label: string; short: string; icon: PathDef; tone: string }> = {
  arrived: { label: "Принят", short: "Приняты", icon: I_CHECK as PathDef, tone: "ok" },
  already_in_stock: { label: "Повтор", short: "Повторы", icon: I_REPEAT, tone: "warn" },
  already_issued: { label: "Уже выдан", short: "Уже выданы", icon: I_OUT, tone: "info" },
  not_found: { label: "Не найден", short: "Не найдены", icon: I_ALERT, tone: "bad" },
};

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const p2 = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
function dayTitle(day: string): { title: string; sub: string } {
  const d = new Date(`${day}T00:00:00`);
  const words = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (day === todayIso()) return { title: "Сегодня", sub: words };
  if (day === todayIso(-1)) return { title: "Вчера", sub: words };
  return { title: words, sub: WEEKDAYS[d.getDay()] };
}

const SCANS_LIMIT = 50;

function Scans({ toast }: { toast: Toast }) {
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [result, setResult] = useState<ScanResult | "">("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<PageOf<ScanRow> | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [openRuns, setOpenRuns] = useState<Set<number>>(new Set());
  // Телефон: дата дня держится шапкой при прокрутке; крестик — больше не закреплять.
  const [pin, setPin] = useState(true);
  const flipRun = (id: number) =>
    setOpenRuns((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const load = useCallback(() => {
    listScans({ q, result, limit: SCANS_LIMIT, offset })
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(apiError(e)));
  }, [q, result, offset]);
  useEffect(load, [load]);
  useEffect(() => setOffset(0), [q, result]);
  // Листаем — экран встаёт к началу ленты, а не к самому верху страницы.
  const top = useRef<HTMLDivElement>(null);
  const go = (o: number) => {
    setOffset(o);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useRefresh(load);

  const days = useMemo(() => {
    const g: { day: string; rows: ScanRow[] }[] = [];
    for (const s of data?.rows ?? []) {
      const day = localDay(new Date(s.scanned_at));
      const last = g[g.length - 1];
      if (last && last.day === day) last.rows.push(s);
      else g.push({ day, rows: [s] });
    }
    return g;
  }, [data]);

  return (
    <>
      <div className="od-tools wx-tools">
        <SlideTabs<ScanResult | "">
          value={result}
          onChange={setResult}
          counts={false}
          options={[["", "Все сканы"], ...(Object.keys(RESULT) as ScanResult[]).map((k): [ScanResult, string, undefined, string] => [k, RESULT[k].short, undefined, RESULT[k].tone])]}
        />
        <label className="rx-as-in od-search">
          <Svg paths={I_SEARCH} size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Код, товар, клиент" aria-label="Поиск" />
        </label>
      </div>

      {error && <ModalError text={error} />}
      {!data ? (
        <div className="ov-card paper wx-scans" style={{ padding: 16 }}>
          <SkeletonRows rows={6} />
        </div>
      ) : data.rows.length === 0 ? (
        <div className="ov-card paper wx-empty">
          <Empty icon="receive" title="Сканирований не найдено" text="Каждое сканирование сохраняется здесь навсегда — повторные не перезаписывают старые" />
        </div>
      ) : (
        <div className={"ov-card paper wx-scans" + (pin ? " pin" : "")} ref={top}>
          <div className="wx-sh">
            <span>Время</span>
            <span>Клиент</span>
            <span>Товар</span>
            <span>Результат</span>
            <span>Кто</span>
          </div>
          {days.map((g) => {
            const t = dayTitle(g.day);
            const by = (k: ScanResult) => g.rows.filter((x) => x.result === k).length;
            return (
              <div key={g.day} className="wx-sday">
                <div className="wx-day2">
                  <div className="wx-day2-in">
                  <span className="wx-cal">
                    <i>{MONTHS[new Date(`${g.day}T00:00:00`).getMonth()].slice(0, 3)}</i>
                    <b>{new Date(`${g.day}T00:00:00`).getDate()}</b>
                    <small>{t.title === "Сегодня" || t.title === "Вчера" ? t.title.toLowerCase() : t.sub}</small>
                  </span>
                  <span className="wx-day2-r">
                    <span className="wx-dbar">
                      {(Object.keys(RESULT) as ScanResult[]).filter((k) => by(k)).map((k) => (
                        <i key={k} className={RESULT[k].tone} style={{ flexGrow: by(k) }} />
                      ))}
                    </span>
                    <span className="wx-drow tot">
                      <span>Всего</span>
                      <b>{g.rows.length}</b>
                    </span>
                    {(Object.keys(RESULT) as ScanResult[]).filter((k) => by(k)).map((k) => (
                      <span key={k} className="wx-drow">
                        <span>
                          <i className={"od-dot " + RESULT[k].tone} />
                          {RESULT[k].short}
                        </span>
                        <b>{by(k)}</b>
                      </span>
                    ))}
                  </span>
                  <button type="button" className="wx-unpin" onClick={() => setPin(false)} aria-label="Не закреплять дату сверху" title="Не закреплять дату сверху">
                    <Svg paths={[["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]]} size={14} sw={2.4} />
                  </button>
                  </div>
                </div>
                <div className="wx-day-rows">
                {runs(g.rows).map((r) =>
                  r.length === 1 ? <ScanLine key={r[0].id} s={r[0]} onOpen={setOpen} /> : <ScanRun key={r[0].id} rows={r} open={openRuns.has(r[0].id)} onToggle={() => flipRun(r[0].id)} onOpen={setOpen} />
                )}
                </div>
              </div>
            );
          })}
          {data.total > SCANS_LIMIT && (
            <footer className="hx-foot od-foot wx-pager">
              <small>
                {offset + 1}–{Math.min(data.total, offset + SCANS_LIMIT)} из {data.total} {plural(data.total, "скана", "сканов", "сканов")}
              </small>
              <span className="hx-pages">
                <button type="button" onClick={() => go(Math.max(0, offset - SCANS_LIMIT))} disabled={offset === 0} aria-label="Назад">
                  ‹
                </button>
                <b>
                  {Math.floor(offset / SCANS_LIMIT) + 1} / {Math.ceil(data.total / SCANS_LIMIT)}
                </b>
                <button type="button" onClick={() => go(offset + SCANS_LIMIT)} disabled={offset + SCANS_LIMIT >= data.total} aria-label="Дальше">
                  ›
                </button>
              </span>
            </footer>
          )}
        </div>
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Подряд идущие сканы одного клиента — одной группой (без клиента — по одному). */
function runs(rows: ScanRow[]): ScanRow[][] {
  const out: ScanRow[][] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && r.customer_id && last[0].customer_id === r.customer_id) last.push(r);
    else out.push([r]);
  }
  return out;
}

function Who({ name, phone }: { name: string | null; phone: string | null }) {
  return name ? (
    <span className="wx-lc">
      <span className="rx-av">{letters(name)}</span>
      <span>
        <b>{name}</b>
        <small>{phone || "без телефона"}</small>
      </span>
    </span>
  ) : (
    <span className="wx-lc none">
      <small>клиента нет</small>
    </span>
  );
}

function ScanLine({ s, onOpen, sub }: { s: ScanRow; onOpen: (id: number) => void; sub?: boolean }) {
  const r = RESULT[s.result];
  return (
    <div onClick={() => s.order_item_id && onOpen(s.order_item_id)} className={"wx-sr t-" + r.tone + (sub ? " sub" : "") + (s.order_item_id ? " click" : "")}>
      <span className="wx-sr-t">{hm(s.scanned_at)}</span>
      {sub ? <span className="wx-lc rep" /> : <Who name={s.customer_name} phone={s.customer_phone} />}
      <span className="wx-li">
        {s.item_name ? (
          <b>
            {s.item_name}
            {s.qty && s.qty > 1 ? <em> × {s.qty}</em> : null}
          </b>
        ) : (
          <b className="miss">{s.code}</b>
        )}
        <small>{s.item_name ? `${s.code}${s.order_item_id && s.scan_no > 1 ? ` · скан №${s.scan_no}` : ""}` : "такого кода нет в заказах"}</small>
      </span>
      <span>
        <span className={"rx-pill-st " + r.tone}>{r.label}</span>
      </span>
      <span className="wx-sr-u">{s.user_login ?? "—"}</span>
    </div>
  );
}

/** Группа сканов клиента: сводка строкой, по клику плавно раскрываются сканы. */
function ScanRun({ rows, open, onToggle, onOpen }: { rows: ScanRow[]; open: boolean; onToggle: () => void; onOpen: (id: number) => void }) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const kinds = (Object.keys(RESULT) as ScanResult[]).map((k) => [k, rows.filter((x) => x.result === k).length] as const).filter(([, n]) => n > 0);
  const users = [...new Set(rows.map((x) => x.user_login ?? "—"))].join(", ");
  const t1 = hm(last.scanned_at);
  const t2 = hm(first.scanned_at);
  return (
    <div className={"wx-grp" + (open ? " open" : "")}>
      <div className="wx-sr wx-gh" onClick={onToggle} aria-expanded={open}>
        <span className="wx-sr-t">{t1 === t2 ? t2 : `${t1}–${t2}`}</span>
        <Who name={first.customer_name} phone={first.customer_phone} />
        <span className="wx-cnt">
          <span className="wx-cnt-i">
            <Svg paths={I_BOX} size={15} sw={1.8} />
          </span>
          <span>
            <b>
              {rows.length} {plural(rows.length, "скан", "скана", "сканов")}
            </b>
            <small>
              {open ? "свернуть" : "показать все"}
              <Svg paths={[["path", { d: "m6 9 6 6 6-6" }]]} size={12} sw={2.4} />
            </small>
          </span>
        </span>
        <span className="wx-sr-mix">
          {kinds.map(([k, n]) => (
            <span key={k} className={"rx-pill-st " + RESULT[k].tone}>
              {RESULT[k].label} {n}
            </span>
          ))}
        </span>
        <span className="wx-sr-u">{users}</span>
      </div>
      <div className="wx-acc">
        <div className="wx-acc-in">
          {rows.map((x) => (
            <ScanLine key={x.id} s={x} sub onOpen={onOpen} />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Мелочи --------------------------------------------------------------------------------------

const letters = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
