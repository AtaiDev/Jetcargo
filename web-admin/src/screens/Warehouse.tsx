/**
 * Склад: где сейчас товар клиентов.
 *
 *  - сверху — поток товара: «Ожидаются» → «На складе» → «Выдано сегодня»; первые два этапа
 *    переключают, что показано ниже;
 *  - под потоком — быстрые фильтры этапа (готовы к выдаче, с долгом, лежат долго) и поиск;
 *  - товары — «полками» по клиентам: у каждой полки этикетка (клиент, сколько дней лежит/ждём),
 *    товары, итог и «Выдать»; или списком — для массовых действий;
 *  - вкладка «История сканирований» — лента сканов по дням.
 * Обновляется сам после сканирования/выдачи (в том числе из другой вкладки) и раз в 20 секунд.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import { listIssues, listItems, listScans, type IssueList, type Item, type ItemList, type Page as PageOf, type ScanResult, type ScanRow } from "../api/domain";
import { Empty, Pager, Tabs } from "../components/cargo";
import BulkBar, { useSelection } from "../components/BulkBar";
import ItemModal from "../components/ItemModal";
import ItemTable from "../components/ItemTable";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_CHECK, I_CLOCK, Icon, Svg } from "../design/icons";
import { Page, PrimaryAction, SearchInput } from "../design/table";
import { HButton, ModalError, ST, SkeletonRows } from "../design/ui";
import { som, todayIso } from "../lib/cargo";
import { useDebounced, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
type PathDef = [string, Record<string, unknown>][];
type Stage = "in_stock" | "ordered";
type Sub = "all" | "ready" | "debt" | "old" | "paid" | "transit" | "waiting";

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const CODE = MONO + ";letter-spacing:.02em";
const CARD = "background:var(--surface);border:1px solid var(--border);border-radius:16px";
/** Сколько товаров этапа грузим разом: полки собираются из всех, а не из одной страницы. */
const ALL = 500;
/** С какого срока товар «лежит долго» на складе и «ждём долго» у заказанных. */
const OLD_STOCK = 7;
const OLD_ORDER = 14;

export default function Warehouse({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "scans" ? "scans" : "items";
  const nav = useNavigate();
  return (
    <Page size="wide">
      <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px")}>
        <Tabs<"items" | "scans">
          value={tab}
          onChange={(v) => setParams(v === "scans" ? { tab: "scans" } : {}, { replace: true })}
          tabs={[
            { key: "items", label: "Товары" },
            { key: "scans", label: "История сканирований" },
          ]}
        />
        <span style={css("flex:1")} />
        <PrimaryAction onClick={() => nav("/receive")} icon={<Icon name="receive" size={15} />}>
          Принять товар
        </PrimaryAction>
      </div>
      {tab === "items" ? <Items isDesktop={isDesktop} toast={toast} /> : <Scans toast={toast} />}
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

/** Подходит ли товар под быстрый фильтр этапа. */
function matches(sub: Sub, it: Item, old: number): boolean {
  if (sub === "ready" || sub === "paid") return it.debt <= 0;
  if (sub === "debt") return it.debt > 0;
  if (sub === "old") return ageOf(it) >= old;
  // «В пути» — из загруженной накладной; «Ещё не отправлены» — остальные ожидаемые.
  if (sub === "transit") return it.stage === "in_transit";
  if (sub === "waiting") return it.stage !== "in_transit";
  return true;
}

// --- Товары --------------------------------------------------------------------------------------

function Items({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const [stage, setStage] = useState<Stage>("in_stock");
  const [sub, setSub] = useState<Sub>("all");
  const [view, setView] = useState<"shelves" | "list">("shelves");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [data, setData] = useState<ItemList | null>(null);
  const [flow, setFlow] = useState<{ ordered: ItemList; stock: ItemList; issued: IssueList | null } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const sel = useSelection(`${stage}|${sub}|${q}|${view}`);

  // Поток — по всему складу, без поиска; список этапа — с поиском.
  const loadFlow = useCallback(() => {
    const d = todayIso();
    const start = new Date(`${d}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    Promise.all([
      listItems({ status: "ordered", limit: 1 }),
      listItems({ status: "in_stock", sort: "arrived", limit: ALL }),
      listIssues({ since: start.toISOString(), until: end.toISOString(), limit: 1 }).catch(() => null),
    ])
      .then(([ordered, stock, issued]) => setFlow({ ordered, stock, issued }))
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
    loadFlow();
  }, [load, loadFlow]);

  useEffect(load, [load]);
  useEffect(loadFlow, [loadFlow]);
  useEffect(() => setSub("all"), [stage]);
  useRefresh(loadAll);
  useEffect(() => {
    const t = window.setInterval(loadAll, 20000);
    return () => window.clearInterval(t);
  }, [loadAll]);

  const old = stage === "in_stock" ? OLD_STOCK : OLD_ORDER;
  const rows = useMemo(() => (data?.rows ?? []).filter((it) => matches(sub, it, old)), [data, sub, old]);
  const count = (k: Sub) => (data?.rows ?? []).filter((it) => matches(k, it, old)).length;
  const subs: { key: Sub; label: string; dot?: string }[] =
    stage === "in_stock"
      ? [
          { key: "all", label: "Все на складе" },
          { key: "ready", label: "Готовы к выдаче", dot: "var(--green-dot)" },
          { key: "debt", label: "С долгом", dot: "var(--danger-dot)" },
          { key: "old", label: `Лежат ${OLD_STOCK}+ дней`, dot: "var(--amber-dot)" },
        ]
      : [
          { key: "all", label: "Все ожидаемые" },
          { key: "transit", label: "В пути", dot: "var(--sky-dot)" },
          { key: "waiting", label: "Ещё не отправлены", dot: "var(--amber-dot)" },
          { key: "paid", label: "Оплачены заранее", dot: "var(--green-dot)" },
          { key: "debt", label: "С долгом", dot: "var(--danger-dot)" },
          { key: "old", label: `Ждём ${OLD_ORDER}+ дней`, dot: "var(--amber-dot)" },
        ];

  // Полки: товары подряд по клиенту (сервер сортирует по имени клиента).
  const shelves = useMemo(() => {
    const g: Item[][] = [];
    for (const it of rows) {
      const last = g[g.length - 1];
      if (last && last[0].customer_id === it.customer_id) last.push(it);
      else g.push([it]);
    }
    // Сверху — у кого дольше всего лежит (ждём).
    return g.sort((a, b) => Math.max(...b.map(ageOf)) - Math.max(...a.map(ageOf)));
  }, [rows]);

  return (
    <>
      <Flow flow={flow} stage={stage} onStage={setStage} />

      <div className="wh-bar">
        <div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
          {subs.map((s) => (
            <HButton key={s.key} onClick={() => setSub(s.key)} className={"wh-chip" + (sub === s.key ? " on" : "")} s="" hover="">
              {s.dot && <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: s.dot })} />}
              {s.label}
              <span style={css(NUM + ";color:var(--text-4);font-size:11.5px")}>{data ? count(s.key) : "…"}</span>
            </HButton>
          ))}
        </div>
        <span style={css("flex:1")} />
        <span className="wh-search">
          <SearchInput value={query} onChange={setQuery} placeholder="Клиент, телефон, код, товар…" width={240} />
        </span>
        <Tabs<"shelves" | "list">
          value={view}
          onChange={setView}
          tabs={[
            { key: "shelves", label: "Полки" },
            { key: "list", label: "Список" },
          ]}
        />
      </div>

      {error && <ModalError text={error} />}
      {!data && !error ? (
        <div style={css(CARD + ";padding:16px")}>
          <SkeletonRows rows={5} />
        </div>
      ) : data && rows.length === 0 ? (
        <div style={css(CARD)}>
          <Empty
            icon="warehouse"
            title={q || sub !== "all" ? "Ничего не найдено" : stage === "in_stock" ? "На складе пусто" : "Ничего не ожидается"}
            text={stage === "in_stock" ? "Товары попадают на склад, когда их код сканируют в разделе «Приём товара»" : "Здесь появятся заказанные товары, которые ещё не пришли"}
          />
        </div>
      ) : data && view === "shelves" ? (
        <ShelfWall shelves={shelves} old={old} onOpen={setOpen} />
      ) : (
        data && (
          <ItemTable
            rows={rows}
            isDesktop={isDesktop}
            columns={stage === "in_stock" ? ["customer", "item", "qty", "sale", "pay", "status", "arrived"] : ["date", "customer", "item", "qty", "sale", "pay", "status"]}
            onOpen={setOpen}
            selected={sel.selected}
            onSelect={sel.onSelect}
            empty={null}
          />
        )
      )}
      {data && data.total > ALL && (
        <div style={css("margin-top:10px;font-size:12px;color:var(--text-4)")}>
          Показаны первые {ALL} из {data.total} — уточните поиском.
        </div>
      )}
      {data && view === "list" && <BulkBar items={rows} selected={sel.selected} onClear={sel.clear} toast={toast} />}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </>
  );
}

// --- Поток товара --------------------------------------------------------------------------------

const GRAD = {
  amber: "linear-gradient(135deg,#FBBF24,#F97316)",
  accent: "linear-gradient(135deg,#6A8BFF,#3E63DD)",
  green: "linear-gradient(135deg,#34D399,#16A34A)",
} as const;

function Flow({ flow, stage, onStage }: { flow: { ordered: ItemList; stock: ItemList; issued: IssueList | null } | null; stage: Stage; onStage: (s: Stage) => void }) {
  const nav = useNavigate();
  const stock = flow?.stock;
  const ready = stock ? stock.rows.filter((i) => i.debt <= 0) : [];
  const debt = stock ? stock.rows.filter((i) => i.debt > 0) : [];
  const oldest = stock && stock.rows.length ? Math.max(...stock.rows.map(ageOf)) : null;
  const iss = flow?.issued;
  return (
    <div className="wh-flow">
      <FlowStage
        tone="amber"
        icon={<Icon name="orders" size={17} />}
        label="Ожидаются"
        count={flow ? flow.ordered.total : null}
        sum={flow ? flow.ordered.totals.sale : null}
        active={stage === "ordered"}
        onClick={() => onStage("ordered")}
      >
        {flow ? (
          <span style={css("display:flex;flex-wrap:wrap;gap:4px 12px")}>
            {(flow.ordered.counts.in_transit ?? 0) > 0 && (
              <span style={css("white-space:nowrap")}>
                <span style={css("color:var(--sky)")}>{flow.ordered.counts.in_transit}</span> в пути
              </span>
            )}
            <span style={css("white-space:nowrap")}>
              {flow.ordered.totals.debt > 0 ? (
                <>
                  долг <b style={css("font-weight:500;color:var(--danger)")}>{som(flow.ordered.totals.debt)}</b>
                </>
              ) : (
                "всё оплачено"
              )}
            </span>
          </span>
        ) : (
          " "
        )}
      </FlowStage>
      <span className="wh-arrow" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </span>
      <FlowStage
        tone="accent"
        icon={<Icon name="warehouse" size={17} />}
        label="На складе"
        count={stock ? stock.total : null}
        sum={stock ? stock.totals.sale : null}
        active={stage === "in_stock"}
        onClick={() => onStage("in_stock")}
      >
        {stock ? (
          <span style={css("display:flex;flex-wrap:wrap;gap:4px 12px")}>
            <span style={css("white-space:nowrap")}>
              <span style={css("color:var(--green)")}>✓ {ready.length}</span> готовы
            </span>
            <span style={css("white-space:nowrap")}>
              <span style={css("color:var(--danger)")}>{debt.length}</span> с долгом
            </span>
            {oldest !== null && <span style={css("white-space:nowrap")}>дольше всех — {daysText(oldest)}</span>}
          </span>
        ) : (
          " "
        )}
      </FlowStage>
      <span className="wh-arrow" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </span>
      <FlowStage
        tone="green"
        icon={<Icon name="issue" size={17} />}
        label="Выдано сегодня"
        count={iss ? iss.summary.items : flow ? 0 : null}
        sum={iss ? iss.summary.sale : flow ? 0 : null}
        onClick={() => nav("/issue")}
        link
      >
        {iss ? (iss.total ? `${iss.total} ${plural(iss.total, "выдача", "выдачи", "выдач")} · ${iss.summary.customers} ${plural(iss.summary.customers, "клиент", "клиента", "клиентов")}` : "сегодня ещё не выдавали") : " "}
      </FlowStage>
    </div>
  );
}

function FlowStage({
  tone,
  icon,
  label,
  count,
  sum,
  active,
  link,
  onClick,
  children,
}: {
  tone: keyof typeof GRAD;
  icon: ReactNode;
  label: string;
  count: number | null;
  sum: number | null;
  active?: boolean;
  link?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <HButton onClick={onClick} className={"wh-stage" + (active ? " on" : "")} s="" hover="" aria-pressed={link ? undefined : active}>
      <span style={css("display:flex;align-items:center;gap:10px;min-width:0")}>
        <span style={mix("width:34px;height:34px;border-radius:11px;flex:none;display:grid;place-items:center;color:#fff;box-shadow:0 8px 16px -8px rgba(15,18,25,.45)", { background: GRAD[tone] })}>{icon}</span>
        <span style={css("font-size:13px;font-weight:500;color:var(--text-2)")}>{label}</span>
        {link && <span style={css("margin-left:auto;font-size:12px;color:var(--accent)")}>к выдаче →</span>}
        {active && <span className="wh-stage-tag">показано ниже</span>}
      </span>
      <span style={css("display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:12px")}>
        <span style={css(NUM + ";font-size:28px;font-weight:500;letter-spacing:-.02em;line-height:1;color:var(--text)")}>{count === null ? "—" : <CountUp text={String(count)} />}</span>
        <span style={css("font-size:12.5px;color:var(--text-3)")}>{count === null ? "" : plural(count, "товар", "товара", "товаров")}</span>
        <span style={css(NUM + ";margin-left:auto;font-size:14px;font-weight:500;color:var(--text-2);white-space:nowrap")}>{sum === null ? "" : <CountUp text={som(sum)} />}</span>
      </span>
      <span className="wh-stage-sub" style={css("display:block;margin-top:8px;font-size:12px;color:var(--text-4);min-height:16px")}>{children}</span>
    </HButton>
  );
}

// --- Полка клиента -------------------------------------------------------------------------------

const SHOW = 4;

/** Ширина полки и отступ между полками — те же, что в стилях .wh-wall. */
const SHELF_W = 310;
const GAP = 14;
/** Примерная высота полки: этикетка, видимые товары, «ещё N», итог. */
const shelfHeight = (n: number) => 64 + Math.min(n, SHOW) * 58 + (n > SHOW ? 30 : 0) + 8 + 64;

/**
 * Полки «волной»: колонки по ширине экрана, каждая следующая полка — в самую короткую колонку.
 * Так полки разной высоты стоят вплотную с одинаковым отступом, а самые давние остаются сверху.
 */
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
          {c.items.map((g) => (
            <Shelf key={g[0].customer_id} items={g} old={old} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Shelf({ items, old, onOpen }: { items: Item[]; old: number; onOpen: (id: number) => void }) {
  const nav = useNavigate();
  const [all, setAll] = useState(false);
  const first = items[0];
  const sale = items.reduce((s, i) => s + i.sale, 0);
  const debt = items.reduce((s, i) => s + i.debt, 0);
  const qty = items.reduce((s, i) => s + i.qty, 0);
  const age = Math.max(...items.map(ageOf));
  const inStock = first.status === "in_stock";
  const state = debt > 0 ? "debt" : "ready";
  const ageTone = age >= old * 2 ? "var(--danger)" : age >= old ? "var(--amber)" : "var(--text-3)";
  const shown = all ? items : items.slice(0, SHOW);
  return (
    <section className={"wh-shelf " + state}>
      {/* Этикетка */}
      <div className="wh-label">
        <HButton
          onClick={() => nav(`/customers/${first.customer_id}`)}
          title="Открыть карточку клиента"
          className="wh-client"
          s="display:flex;align-items:center;gap:10px;min-width:0;flex:1;border:none;background:transparent;padding:0;cursor:pointer;font:inherit;color:inherit;text-align:left"
          hover=""
        >
          <Avatar name={first.customer_name} size={36} />
          <span style={css("min-width:0")}>
            <span className="wh-name" style={css("display:block;font-size:14px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
              {first.customer_name}
            </span>
            <span style={css(NUM + ";display:block;font-size:12px;color:var(--text-3);white-space:nowrap")}>{first.customer_phone || "без телефона"}</span>
          </span>
        </HButton>
        <span title={inStock ? "сколько лежит самый давний товар" : "сколько ждём самый давний заказ"} style={mix(NUM + ";flex:none;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:999px;background:var(--surface);border:1px solid var(--border-2);font-size:12px;white-space:nowrap", { color: ageTone })}>
          <Svg paths={I_CLOCK as PathDef} size={13} sw={2} />
          {inStock ? (age === 0 ? "пришёл сегодня" : `лежит ${daysText(age)}`) : age === 0 ? "заказан сегодня" : `ждём ${daysText(age)}`}
        </span>
      </div>

      {/* Товары */}
      <div style={css("flex:1;padding:4px 0")}>
        {shown.map((it) => (
          <div key={it.id} onClick={() => onOpen(it.id)} className="wh-item" title="Открыть карточку товара">
            <span style={mix("width:7px;height:7px;border-radius:50%;flex:none;margin-top:6px", { background: it.debt > 0 ? "var(--danger-dot)" : "var(--green-dot)" })} />
            <span style={css("flex:1;min-width:0")}>
              <span style={css("display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                {it.name}
                {it.qty > 1 && <span style={css(NUM + ";color:var(--text-4)")}> × {it.qty}</span>}
              </span>
              <span style={css("display:block;font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                <span style={css(CODE + ";font-size:11px")}>{it.code || "без кода"}</span>
              </span>
            </span>
            <span style={css("text-align:right;flex:none")}>
              <span style={css(NUM + ";display:block;font-size:13px;color:var(--text);white-space:nowrap")}>{som(it.sale)}</span>
              <span style={mix(NUM + ";display:block;font-size:11px;white-space:nowrap", { color: it.debt > 0 ? "var(--danger)" : "var(--green)" })}>{it.debt > 0 ? `долг ${som(it.debt)}` : "оплачено"}</span>
            </span>
          </div>
        ))}
        {items.length > SHOW && (
          <HButton onClick={() => setAll((v) => !v)} className="wh-more" s="" hover="">
            {all ? "свернуть" : `ещё ${items.length - SHOW} ${plural(items.length - SHOW, "товар", "товара", "товаров")}`}
          </HButton>
        )}
      </div>

      {/* Итог полки */}
      <div className="wh-foot">
        <span style={css("min-width:0")}>
          <span style={css(NUM + ";display:block;font-size:15px;font-weight:500;color:var(--text);white-space:nowrap")}>{som(sale)}</span>
          <span style={mix(NUM + ";display:block;font-size:12px;white-space:nowrap", { color: debt > 0 ? "var(--danger)" : "var(--green)" })}>
            {debt > 0 ? `долг ${som(debt)}` : "✓ всё оплачено"} · <span style={css("color:var(--text-4)")}>{items.length} {plural(items.length, "товар", "товара", "товаров")}{qty !== items.length ? `, ${qty} шт` : ""}</span>
          </span>
        </span>
        {inStock ? (
          <HButton onClick={() => nav(`/issue?customer=${first.customer_id}`)} className={"wh-issue" + (debt > 0 ? " owe" : "")} s="" hover="">
            <Svg paths={I_CHECK} size={14} sw={2.4} />
            Выдать
          </HButton>
        ) : (
          // Ожидаемые: сколько уже в пути по накладной из Китая, а сколько ещё не отправлено.
          (() => {
            const transit = items.filter((i) => i.stage === "in_transit").length;
            const k = transit === items.length ? "in_transit" : "ordered";
            return (
              <span style={mix("display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap", { color: ST[k].fg })}>
                <span style={mix("width:7px;height:7px;border-radius:50%", { background: ST[k].dot })} />
                {transit === items.length ? "в пути" : transit ? `в пути ${transit} из ${items.length}` : "ещё не отправлены"}
              </span>
            );
          })()
        )}
      </div>
    </section>
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

const RESULT: Record<ScanResult, { label: string; short: string; icon: PathDef; tint: string; fg: string; dot: string }> = {
  arrived: { label: "Принят на склад", short: "Приняты", icon: I_CHECK as PathDef, tint: "var(--green-tint)", fg: "var(--green)", dot: "var(--green-dot)" },
  already_in_stock: { label: "Повторный скан — уже на складе", short: "Повторы", icon: I_REPEAT, tint: "var(--amber-tint)", fg: "var(--amber)", dot: "var(--amber-dot)" },
  already_issued: { label: "Уже выдан клиенту", short: "Уже выданы", icon: I_OUT, tint: "var(--muted-bg)", fg: "var(--text-2)", dot: "var(--text-4)" },
  not_found: { label: "Код не найден", short: "Не найдены", icon: I_ALERT, tint: "var(--danger-tint)", fg: "var(--danger)", dot: "var(--danger-dot)" },
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
      <div className="wh-bar">
        <div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
          <HButton onClick={() => setResult("")} className={"wh-chip" + (result === "" ? " on" : "")} s="" hover="">
            Все сканы
          </HButton>
          {(Object.keys(RESULT) as ScanResult[]).map((k) => (
            <HButton key={k} onClick={() => setResult(k)} className={"wh-chip" + (result === k ? " on" : "")} s="" hover="">
              <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: RESULT[k].dot })} />
              {RESULT[k].short}
            </HButton>
          ))}
        </div>
        <span style={css("flex:1")} />
        <span className="wh-search">
          <SearchInput value={query} onChange={setQuery} placeholder="Код, товар, клиент…" width={240} />
        </span>
      </div>

      {error && <ModalError text={error} />}
      {!data ? (
        <div style={css(CARD + ";padding:16px")}>
          <SkeletonRows rows={6} />
        </div>
      ) : data.rows.length === 0 ? (
        <div style={css(CARD)}>
          <Empty icon="receive" title="Сканирований не найдено" text="Каждое сканирование сохраняется здесь навсегда — повторные не перезаписывают старые" />
        </div>
      ) : (
        <div style={css(CARD + ";overflow:hidden")}>
          {days.map((g, gi) => {
            const t = dayTitle(g.day);
            const arrived = g.rows.filter((s) => s.result === "arrived").length;
            return (
              <div key={g.day}>
                <div className="wh-day" style={gi === 0 ? css("border-top:none") : undefined}>
                  <span style={css("font-size:13.5px;font-weight:500;color:var(--text)")}>{t.title}</span>
                  <span style={css("font-size:12px;color:var(--text-4)")}>{t.sub}</span>
                  <span style={css(NUM + ";margin-left:auto;font-size:12px;color:var(--text-3);white-space:nowrap")}>
                    {g.rows.length} {plural(g.rows.length, "скан", "скана", "сканов")}
                    {arrived ? <> · <span style={css("color:var(--green)")}>принято {arrived}</span></> : null}
                  </span>
                </div>
                {g.rows.map((s) => (
                  <ScanLine key={s.id} s={s} onOpen={setOpen} />
                ))}
              </div>
            );
          })}
          <div style={css("padding:0 18px 12px")}>
            <Pager total={data.total} offset={offset} limit={SCANS_LIMIT} onChange={setOffset} />
          </div>
        </div>
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </>
  );
}

function ScanLine({ s, onOpen }: { s: ScanRow; onOpen: (id: number) => void }) {
  const r = RESULT[s.result];
  const d = new Date(s.scanned_at);
  return (
    <div onClick={() => s.order_item_id && onOpen(s.order_item_id)} className={"wh-scan" + (s.order_item_id ? " click" : "")}>
      <span style={mix("width:28px;height:28px;border-radius:9px;display:grid;place-items:center", { background: r.tint, color: r.fg })}>
        <Svg paths={r.icon} size={14} sw={2.3} />
      </span>
      <span style={css(NUM + ";font-size:12.5px;color:var(--text-3)")}>
        {p2(d.getHours())}:{p2(d.getMinutes())}
      </span>
      <span style={css("min-width:0")}>
        <span style={css("display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
          {s.item_name ?? <span style={css("color:var(--danger)")}>нет такого товара</span>}
          {s.qty && s.qty > 1 ? <span style={css(NUM + ";color:var(--text-4)")}> × {s.qty}</span> : null}
        </span>
        <span style={css("display:block;font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
          <span style={css(CODE + ";font-size:11px")}>{s.code}</span>
          {s.order_item_id && s.scan_no > 1 ? ` · скан №${s.scan_no}` : ""}
        </span>
      </span>
      <span className="wh-hide" style={css("display:flex;align-items:center;gap:9px;min-width:0")}>
        {s.customer_name ? (
          <>
            <Avatar name={s.customer_name} size={24} />
            <span style={css("min-width:0")}>
              <span style={css("display:block;font-size:12.5px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{s.customer_name}</span>
              {s.customer_phone && <span style={css(NUM + ";display:block;font-size:11.5px;color:var(--text-4)")}>{s.customer_phone}</span>}
            </span>
          </>
        ) : (
          <span style={css("font-size:12px;color:var(--text-5)")}>—</span>
        )}
      </span>
      <span className="wh-hide" style={mix("font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: r.fg })}>{r.label}</span>
      <span className="wh-hide" style={css("font-size:12px;color:var(--text-4);white-space:nowrap;text-align:right")}>{s.user_login ?? "—"}</span>
    </div>
  );
}

// --- Мелочи --------------------------------------------------------------------------------------

/** Аватар-буква; цвет — от имени, как на «Приёме», «Выдаче» и в «Заказах». */
const AVATAR_BG = [
  "linear-gradient(135deg,#5B7CFA,#8B5CF6)",
  "linear-gradient(135deg,#22C55E,#0EA5E9)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#EC4899,#8B5CF6)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
];

function Avatar({ name, size }: { name: string; size: number }) {
  const n = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return (
    <span
      style={mix("border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-weight:600", {
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: AVATAR_BG[n % AVATAR_BG.length],
      })}
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
