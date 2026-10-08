/**
 * Заказы: все товары клиентов карточками заказов.
 *
 *  - сверху — итоги по выбранным фильтрам: сумма, оплачено (с полосой), долг, прибыль;
 *  - ниже — вкладки по статусу, оплата, даты, поиск и «Новый заказ»;
 *  - заказ = товары одного клиента за один день: карточка с клиентом, датой, полосой оплаты
 *    и итогами, внутри строки товаров (кол-во, сумма, прибыль, оплата, статус).
 * Клик по товару — его карточка; галочки — массовые действия; клик по клиенту — карточка клиента.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import { listItems, type Item, type ItemList, type ItemQuery, type Totals } from "../api/domain";
import { Empty, Pager, Tabs } from "../components/cargo";
import BulkBar, { useSelection } from "../components/BulkBar";
import ItemModal from "../components/ItemModal";
import Select from "../components/Select";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_CHECK, I_MINUS, Svg } from "../design/icons";
import { Page, PrimaryAction, SearchInput } from "../design/table";
import { HButton, ModalError, ST, SkeletonRows } from "../design/ui";
import { monthStartIso, profitOf, shortDateTime, som, todayIso } from "../lib/cargo";
import { useDebounced, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
type StatusTab = "" | "ordered" | "in_stock" | "issued";
type PayFilter = "" | "unpaid" | "partial" | "paid" | "debt";
type DateFilter = "" | "today" | "7" | "month";
type PathDef = [string, Record<string, unknown>][];

const LIMIT = 50;
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const CODE = MONO + ";letter-spacing:.02em";
const CARD = "background:var(--surface);border:1px solid var(--border);border-radius:16px";

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
    const p: ItemQuery = { status, pay, q, limit: LIMIT, offset };
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

  return (
    <Page size="wide">
      <Kpis t={data?.totals ?? null} filtered={filtered} debtOn={pay === "debt"} onDebt={() => setParam("pay", pay === "debt" ? "" : "debt")} />

      {/* Фильтры */}
      <div className="ord-filters">
        <Tabs<StatusTab>
          value={status}
          onChange={(v) => setParam("status", v)}
          tabs={[
            { key: "", label: "Все", count: data?.counts.all },
            { key: "ordered", label: "Заказаны", count: data?.counts.ordered, dot: ST.ordered.dot },
            { key: "in_stock", label: "На складе", count: data?.counts.in_stock, dot: ST.in_stock.dot },
            { key: "issued", label: "Выданы", count: data?.counts.issued, dot: ST.issued.dot },
          ]}
        />
        <div className="ord-tools">
          <span className="ord-f-search">
            <SearchInput value={query} onChange={setQuery} placeholder="Имя, телефон, код, товар…" width={250} />
          </span>
          <span className="ord-f-sel" style={css("width:150px")}>
            <Select
              value={pay}
              onChange={(v) => setParam("pay", v)}
              width="100%"
              height={34}
              fontSize={12.5}
              highlight={!!pay}
              ariaLabel="Оплата"
              options={[
                { value: "", label: "Любая оплата" },
                { value: "unpaid", label: "Не оплачено", dot: ST.unpaid.dot },
                { value: "partial", label: "Частично", dot: ST.partial.dot },
                { value: "paid", label: "Оплачено", dot: ST.paid.dot },
                { value: "debt", label: "С долгом", dot: "var(--danger-dot)" },
              ]}
            />
          </span>
          <span className="ord-f-sel" style={css("width:132px")}>
            <Select<DateFilter>
              value={dateF}
              onChange={setDateF}
              width="100%"
              height={34}
              fontSize={12.5}
              highlight={!!dateF}
              ariaLabel="Дата"
              options={[
                { value: "", label: "Все даты" },
                { value: "today", label: "Сегодня" },
                { value: "7", label: "7 дней" },
                { value: "month", label: "Этот месяц" },
              ]}
            />
          </span>
          <span className="ord-f-new">
            <PrimaryAction onClick={() => nav("/new-order")}>Новый заказ</PrimaryAction>
          </span>
        </div>
      </div>

      {error && <ModalError text={error} />}
      {!data && !error ? (
        <div style={css(CARD + ";padding:16px")}>
          <SkeletonRows rows={6} />
        </div>
      ) : data && orders.length === 0 ? (
        <div style={css(CARD)}>
          <Empty
            icon="orders"
            title={filtered ? "Ничего не найдено" : "Заказов пока нет"}
            text={filtered ? "Измените фильтры или поиск" : "Нажмите «Новый заказ» или загрузите Excel в разделе «Импорт»"}
          />
        </div>
      ) : (
        data && (
          <>
            {orders.length > 0 && (
              <div style={css("display:flex;align-items:center;gap:10px;margin:0 2px 8px;font-size:12px;color:var(--text-4)")}>
                <Check
                  on={orders.every((g) => g.every((i) => sel.selected.has(i.id)))}
                  half={data.rows.some((i) => sel.selected.has(i.id))}
                  onToggle={(on) => sel.onSelect(data.rows.map((i) => i.id), on)}
                  title="Выбрать все на странице"
                />
                <span style={css(NUM)}>
                  {orders.length} {plural(orders.length, "заказ", "заказа", "заказов")} на странице · {data.rows.length} {plural(data.rows.length, "товар", "товара", "товаров")}
                </span>
              </div>
            )}
            <div style={css("display:flex;flex-direction:column;gap:12px")}>
              {orders.map((g) => (
                <OrderCard key={`${g[0].customer_id}-${g[0].order_date}-${g[0].id}`} items={g} selected={sel.selected} onSelect={sel.onSelect} onOpen={setOpen} />
              ))}
            </div>
            <Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />
          </>
        )
      )}

      {data && <BulkBar items={data.rows} selected={sel.selected} onClear={sel.clear} toast={toast} />}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </Page>
  );
}

// --- Итоги сверху -------------------------------------------------------------------------------

const I_RECEIPT: PathDef = [
  ["path", { d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" }],
  ["path", { d: "M8 8h8" }],
  ["path", { d: "M8 12h8" }],
  ["path", { d: "M8 16h5" }],
];
const I_WALLET: PathDef = [
  ["path", { d: "M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2" }],
  ["path", { d: "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" }],
];
const I_ALERT: PathDef = [
  ["circle", { cx: 12, cy: 12, r: 9 }],
  ["path", { d: "M12 7.5v5.5" }],
  ["path", { d: "M12 16.5h.01" }],
];
const I_TREND: PathDef = [
  ["path", { d: "m3 17 6-6 4 4 8-8" }],
  ["path", { d: "M15 7h6v6" }],
];

const KPI_GRAD = {
  accent: "linear-gradient(135deg,#6A8BFF,#3E63DD)",
  green: "linear-gradient(135deg,#34D399,#16A34A)",
  danger: "linear-gradient(135deg,#FB7185,#DC2626)",
  violet: "linear-gradient(135deg,#A78BFA,#7C3AED)",
} as const;

function Kpis({ t, filtered, debtOn, onDebt }: { t: Totals | null; filtered: boolean; debtOn: boolean; onDebt: () => void }) {
  const paidShare = t && t.sale > 0 ? Math.round((Math.min(t.paid, t.sale) / t.sale) * 100) : 0;
  const markup = t && t.with_cost && t.cost > 0 ? Math.round((t.profit / t.cost) * 100) : null;
  return (
    <div className="ord-kpis">
      <Kpi icon={I_RECEIPT} tone="accent" label={filtered ? "Сумма по фильтру" : "Сумма заказов"} value={t ? som(t.sale) : "—"}>
        {t ? `${t.items} ${plural(t.items, "товар", "товара", "товаров")} · ${t.qty} шт` : " "}
      </Kpi>
      <Kpi icon={I_WALLET} tone="green" label="Оплачено" value={t ? som(t.paid) : "—"}>
        <span style={css("display:flex;align-items:center;gap:8px")}>
          <span style={css("flex:1;height:6px;border-radius:999px;background:var(--danger-tint);overflow:hidden")}>
            <span className="bar-grow" style={mix("display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#34D399,#16A34A)", { width: `${paidShare}%` })} />
          </span>
          <span style={css(NUM + ";color:var(--green);font-weight:500")}>{paidShare}%</span>
        </span>
      </Kpi>
      <Kpi
        icon={I_ALERT}
        tone="danger"
        label="Долг клиентов"
        value={t ? som(t.debt) : "—"}
        valueColor={t && t.debt > 0 ? "var(--danger)" : undefined}
        onClick={t && (t.debt > 0 || debtOn) ? onDebt : undefined}
        active={debtOn}
      >
        {t ? (t.debt > 0 ? (debtOn ? "показаны только с долгом · снять" : "показать товары с долгом →") : "долгов нет") : " "}
      </Kpi>
      <Kpi icon={I_TREND} tone="violet" label="Прибыль" value={t && t.with_cost ? `${t.profit > 0 ? "+" : ""}${som(t.profit)}` : "—"} valueColor={t && t.with_cost ? (t.profit < 0 ? "var(--danger)" : "var(--green)") : undefined}>
        {!t || !t.with_cost
          ? "нет реальных цен выкупа"
          : t.with_cost < t.items
            ? `по ${t.with_cost} из ${t.items} — у остальных нет выкупа`
            : markup !== null
              ? `наценка ${markup}% к выкупу ${som(t.cost)}`
              : " "}
      </Kpi>
    </div>
  );
}

function Kpi({
  icon,
  tone,
  label,
  value,
  valueColor,
  children,
  onClick,
  active,
}: {
  icon: PathDef;
  tone: keyof typeof KPI_GRAD;
  label: string;
  value: string;
  valueColor?: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <span style={css("display:flex;align-items:center;gap:9px;min-width:0")}>
        <span style={mix("width:30px;height:30px;border-radius:9px;flex:none;display:grid;place-items:center;color:#fff;box-shadow:0 6px 14px -6px rgba(15,18,25,.4)", { background: KPI_GRAD[tone] })}>
          <Svg paths={icon} size={15} sw={2} />
        </span>
        <span style={css("font-size:12.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{label}</span>
      </span>
      <span style={mix(NUM + ";display:block;font-size:24px;font-weight:500;letter-spacing:-.02em;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: valueColor ?? "var(--text)" })}>
        <CountUp text={value} />
      </span>
      <span className="ord-kpi-sub" style={css("display:block;font-size:12px;color:var(--text-4);min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{children}</span>
    </>
  );
  return onClick ? (
    <HButton onClick={onClick} className={"ord-kpi ord-kpi-btn" + (active ? " on" : "")} s="text-align:left;font:inherit;color:inherit;cursor:pointer" hover="">
      {body}
    </HButton>
  ) : (
    <div className="ord-kpi">{body}</div>
  );
}

// --- Карточка заказа ----------------------------------------------------------------------------

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

/** «Сегодня», «Вчера» или «4 октября, суббота» (+ год, если не текущий). */
function orderDay(d: string): string {
  const day = d.slice(0, 10);
  if (day === todayIso()) return "Сегодня";
  if (day === todayIso(-1)) return "Вчера";
  const x = new Date(`${day}T00:00:00`);
  const year = x.getFullYear() !== new Date().getFullYear() ? ` ${x.getFullYear()}` : "";
  return `${x.getDate()} ${MONTHS[x.getMonth()]}${year}, ${WEEKDAYS[x.getDay()]}`;
}

const STATUS_TEXT: Record<Item["status"], string> = { ordered: "Заказан", in_stock: "На складе", issued: "Выдан" };

function OrderCard({
  items,
  selected,
  onSelect,
  onOpen,
}: {
  items: Item[];
  selected: Set<number>;
  onSelect: (ids: number[], on: boolean) => void;
  onOpen: (id: number) => void;
}) {
  const nav = useNavigate();
  const first = items[0];
  const sale = items.reduce((s, i) => s + i.sale, 0);
  const debt = items.reduce((s, i) => s + i.debt, 0);
  const paid = Math.max(0, sale - debt);
  const qty = items.reduce((s, i) => s + i.qty, 0);
  const withCost = items.filter((i) => i.cost !== null);
  const profit = withCost.reduce((s, i) => s + i.sale - (i.cost ?? 0), 0);
  const share = sale > 0 ? Math.round((paid / sale) * 100) : 100;
  const tone = debt <= 0 ? "var(--green-dot)" : paid > 0 ? "var(--amber-dot)" : "var(--danger-dot)";
  const counts = (["ordered", "in_stock", "issued"] as const).map((s) => [s, items.filter((i) => i.status === s).length] as const).filter(([, n]) => n > 0);
  const allOn = items.every((i) => selected.has(i.id));
  const someOn = items.some((i) => selected.has(i.id));

  return (
    <section className="ord-card" style={{ ["--ord-tone" as string]: tone }}>
      {/* Шапка: клиент и дата — слева, оплата и сумма — справа */}
      <div className="ord-head">
        <Check on={allOn} half={someOn} onToggle={(on) => onSelect(items.map((i) => i.id), on)} title="Выбрать все товары заказа" />
        <HButton
          onClick={() => nav(`/customers/${first.customer_id}`)}
          title="Открыть карточку клиента"
          s="display:flex;align-items:center;gap:12px;min-width:0;flex:1 1 260px;border:none;background:transparent;padding:0;cursor:pointer;font:inherit;color:inherit;text-align:left"
          hover=""
          className="ord-client"
        >
          <Avatar name={first.customer_name} size={40} />
          <span style={css("min-width:0")}>
            <span style={css("display:flex;align-items:baseline;gap:8px;min-width:0")}>
              <span className="ord-name" style={css("font-size:14.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                {first.customer_name}
              </span>
              <span style={css(NUM + ";font-size:12.5px;color:var(--text-3);white-space:nowrap")}>{first.customer_phone}</span>
            </span>
            <span style={css("display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;margin-top:3px;font-size:12px;color:var(--text-4)")}>
              <span style={css("color:var(--text-2)")}>{orderDay(first.order_date)}</span>
              <span style={css(NUM)}>
                {items.length} {plural(items.length, "товар", "товара", "товаров")}
                {qty !== items.length ? ` · ${qty} шт` : ""}
              </span>
              {counts.map(([s, n]) => (
                <span key={s} style={css("display:inline-flex;align-items:center;gap:5px;white-space:nowrap")}>
                  <span style={mix("width:6px;height:6px;border-radius:50%", { background: ST[s].dot })} />
                  {STATUS_TEXT[s].toLowerCase()} {n}
                </span>
              ))}
            </span>
          </span>
        </HButton>

        <span className="ord-pay">
          <span style={css("display:flex;justify-content:space-between;gap:10px;font-size:12px;white-space:nowrap")}>
            <span style={mix(NUM, { color: debt > 0 ? (paid > 0 ? "var(--amber)" : "var(--danger)") : "var(--green)" })}>
              {debt > 0 ? `долг ${som(debt)}` : "✓ оплачено"}
            </span>
            <span style={css(NUM + ";color:var(--text-4)")}>{share}%</span>
          </span>
          <span style={css("display:block;height:6px;border-radius:999px;background:var(--danger-tint);overflow:hidden;margin-top:6px")}>
            <span style={mix("display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#34D399,#16A34A)", { width: `${share}%` })} />
          </span>
        </span>

        <span className="ord-sum">
          <span style={css(NUM + ";display:block;font-size:17px;font-weight:500;color:var(--text);white-space:nowrap")}>{som(sale)}</span>
          <span style={mix(NUM + ";display:block;font-size:12px;white-space:nowrap;margin-top:1px", { color: withCost.length ? (profit < 0 ? "var(--danger)" : "var(--green)") : "var(--text-4)" })}>
            {withCost.length ? `${profit > 0 ? "+" : ""}${som(profit)} прибыль` : "без выкупа"}
          </span>
        </span>
      </div>

      {/* Товары */}
      {items.map((it) => (
        <ItemRow key={it.id} it={it} on={selected.has(it.id)} onToggle={(on) => onSelect([it.id], on)} onOpen={() => onOpen(it.id)} />
      ))}
    </section>
  );
}

function ItemRow({ it, on, onToggle, onOpen }: { it: Item; on: boolean; onToggle: (on: boolean) => void; onOpen: () => void }) {
  const p = profitOf(it);
  const arrivedToday = it.status === "in_stock" && it.arrived_at && new Date(it.arrived_at).toDateString() === new Date().toDateString();
  const payTone = it.pay_status === "paid" ? "var(--green)" : it.pay_status === "partial" ? "var(--amber)" : "var(--danger)";
  const payDot = it.pay_status === "paid" ? ST.paid.dot : it.pay_status === "partial" ? ST.partial.dot : ST.unpaid.dot;
  return (
    <div onClick={onOpen} className={"ord-row" + (on ? " on" : "")} title="Открыть карточку товара">
      <Check on={on} onToggle={onToggle} />
      <span style={css("min-width:0")}>
        <span style={css("display:block;font-size:13.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{it.name}</span>
        <span style={css("display:block;font-size:11.5px;color:var(--text-4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
          {it.code ? <span style={css(CODE + ";font-size:11px")}>{it.code}</span> : "без кода"}
          <span className="ord-sm">{` · ${it.qty} шт`}</span>
        </span>
      </span>
      <span className="ord-hide" style={css(NUM + ";text-align:center;font-size:12.5px;color:var(--text-3)")}>
        {it.qty} шт
      </span>
      <span style={css("text-align:right;min-width:0")}>
        <span style={css(NUM + ";display:block;font-size:13.5px;font-weight:500;color:var(--text);white-space:nowrap")}>{som(it.sale)}</span>
        <div className="ord-sm" style={mix(NUM + ";font-size:11.5px;white-space:nowrap;margin-top:1px", { color: payTone })}>
          {it.pay_status === "paid" ? "оплачено" : `долг ${som(it.debt)}`}
        </div>
      </span>
      <span className="ord-hide" style={css("text-align:right;min-width:0")}>
        {p === null ? (
          <span style={css("font-size:12px;color:var(--text-5)")}>нет выкупа</span>
        ) : (
          <>
            <span style={mix(NUM + ";display:block;font-size:13px;font-weight:500;white-space:nowrap", { color: p < 0 ? "var(--danger)" : "var(--green)" })}>
              {p > 0 ? "+" : ""}
              {som(p)}
            </span>
            <span style={css(NUM + ";display:block;font-size:11px;color:var(--text-4);white-space:nowrap")}>из {som(it.cost)}</span>
          </>
        )}
      </span>
      <span className="ord-hide" style={css("min-width:0")}>
        <span style={mix(NUM + ";display:flex;align-items:center;gap:6px;font-size:12.5px;white-space:nowrap", { color: payTone })}>
          <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: payDot })} />
          {it.pay_status === "paid" ? "оплачено" : it.pay_status === "partial" ? "частично" : "не оплачено"}
        </span>
        {it.pay_status === "partial" && <span style={css(NUM + ";display:block;font-size:11px;color:var(--text-4);margin:2px 0 0 13px;white-space:nowrap")}>долг {som(it.debt)}</span>}
      </span>
      <span className="ord-hide" style={css("min-width:0")}>
        <span style={css("display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2);white-space:nowrap")}>
          <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: ST[it.status].dot })} />
          {STATUS_TEXT[it.status]}
        </span>
        {arrivedToday ? (
          <span style={css(NUM + ";display:block;font-size:11px;color:var(--accent-strong);margin:2px 0 0 13px;white-space:nowrap")}>принят сегодня {shortDateTime(it.arrived_at).slice(6)}</span>
        ) : it.status === "issued" && it.issued_at ? (
          <span style={css(NUM + ";display:block;font-size:11px;color:var(--text-4);margin:2px 0 0 13px;white-space:nowrap")}>{shortDateTime(it.issued_at)}</span>
        ) : null}
      </span>
    </div>
  );
}

// --- Мелочи -------------------------------------------------------------------------------------

/** Галочка выбора: квадрат с галкой; half — выбрана часть. Клик не открывает карточку товара. */
function Check({ on, half, onToggle, title }: { on: boolean; half?: boolean; onToggle: (on: boolean) => void; title?: string }) {
  const lit = on || half;
  return (
    <span
      role="checkbox"
      aria-checked={on ? true : half ? "mixed" : false}
      tabIndex={0}
      title={title}
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
      style={mix("width:18px;height:18px;border-radius:6px;flex:none;display:grid;place-items:center;color:#fff;cursor:pointer;transition:background .12s,border-color .12s", {
        background: lit ? "var(--accent)" : "var(--surface)",
        border: `1.5px solid ${lit ? "var(--accent)" : "var(--border-strong)"}`,
      })}
    >
      {on ? <Svg paths={I_CHECK} size={12} sw={3} /> : half ? <Svg paths={I_MINUS} size={12} sw={3} /> : null}
    </span>
  );
}

/** Аватар-буква; цвет — от имени, как на «Приёме» и «Выдаче». */
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
