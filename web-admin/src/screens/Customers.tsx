/**
 * Клиенты — «телефонная книга»: большой поиск (имя, телефон в любом формате, код клиента),
 * фильтры-пилюли с цифрами и справочник разделами — по алфавиту (с алфавитной полосой),
 * по давности заказа или рейтингом (должники, крупные); у каждого — полоса оплаты. Карточка клиента — все его товары,
 * суммы, оплаты, долг, что заказано / на складе / выдано.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiError } from "../api/client";
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  payCustomer,
  updateCustomer,
  type Customer,
  type CustomerCard,
  type CustomerRow,
  type CustomerSort,
  type CustomersSummary,
  type ItemStatus,
  type Page as PageOf,
} from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { Confirm, Empty, MoneyInput, Pager, Tabs } from "../components/cargo";
import BulkBar, { useSelection } from "../components/BulkBar";
import ItemModal from "../components/ItemModal";
import ItemTable from "../components/ItemTable";
import PhoneInput from "../components/PhoneInput";
import Select from "../components/Select";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_BACK, I_CLOSE, I_PLUS, I_SEARCH, I_USER, Icon, Svg } from "../design/icons";
import { PANEL, Page } from "../design/table";
import { FieldLabel, HButton, LoadError, ModalError, ModalShell, ST, SkeletonRows, btnGhost, btnPrimary, inputStyle } from "../design/ui";
import { METHOD_OPTIONS, date, parseMoney, som, todayIso } from "../lib/cargo";
import { emit, useDebounced, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
const LIMIT = 100;
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";

// --- Список ---------------------------------------------------------------------------

type Filter = "" | "debt" | "in_stock";

const SORTS: { key: CustomerSort; label: string }[] = [
  { key: "recent", label: "Недавние" },
  { key: "name", label: "А–Я" },
  { key: "debt", label: "Должники" },
  { key: "sale", label: "Крупные" },
];

/** Раздел справочника: буква — по алфавиту, давность — для недавних, без разделов — для рейтингов. */
function sectionOf(c: CustomerRow, sort: CustomerSort): string {
  if (sort === "name") {
    const ch = c.name.trim().charAt(0).toUpperCase();
    return /\p{L}/u.test(ch) ? ch : "#";
  }
  if (sort === "recent") {
    if (!c.last_order_date) return "Без заказов";
    const days = Math.round((new Date(todayIso()).getTime() - new Date(c.last_order_date.slice(0, 10)).getTime()) / 86400000);
    if (days <= 0) return "Сегодня";
    if (days < 7) return "На этой неделе";
    if (days < 31) return "В этом месяце";
    return "Раньше";
  }
  return "";
}

export default function Customers({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [filter, setFilter] = useState<Filter>("");
  const [sort, setSort] = useState<CustomerSort>("recent");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<(PageOf<CustomerRow> & { summary: CustomersSummary }) | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  /** По какой сортировке пришли текущие строки — разделы строим по ней, а не по только что нажатой. */
  const [shownSort, setShownSort] = useState<CustomerSort>(sort);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    listCustomers({ q, filter, sort, limit: LIMIT, offset })
      .then((d) => {
        setData(d);
        setShownSort(sort);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить клиентов")));
  }, [q, filter, sort, offset]);
  useEffect(load, [load]);
  useEffect(() => setOffset(0), [q, filter, sort]);
  useRefresh(load);

  const sections = useMemo(() => {
    const out: { key: string; rows: CustomerRow[] }[] = [];
    for (const c of data?.rows ?? []) {
      const k = sectionOf(c, shownSort);
      const last = out[out.length - 1];
      if (last && last.key === k) last.rows.push(c);
      else out.push({ key: k, rows: [c] });
    }
    return out;
  }, [data, shownSort]);
  const ranked = shownSort === "debt" || shownSort === "sale";
  const s = data?.summary;

  return (
    <Page size="wide">
      {/* Поиск и фильтры */}
      <section className="cu-hero">
        <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
          <label className="cu-search">
            <span style={css("display:flex;color:var(--accent)")}>
              <Svg paths={I_SEARCH} size={20} sw={2} />
            </span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder={isDesktop ? "Найти клиента — имя, телефон в любом формате или код" : "Имя, телефон или код"}
              aria-label="Найти клиента"
              autoFocus={isDesktop}
            />
            {query ? (
              <HButton
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                title="Очистить"
                s="width:30px;height:30px;flex:none;display:grid;place-items:center;border:none;border-radius:9px;background:transparent;color:var(--text-4);cursor:pointer"
                hover="background:var(--hover);color:var(--text-2)"
              >
                <Svg paths={I_CLOSE} size={15} />
              </HButton>
            ) : (
              data && <span style={css(NUM + ";flex:none;font-size:12.5px;color:var(--text-4);white-space:nowrap")}>{s?.total ?? data.total} в книге</span>
            )}
          </label>
          <HButton onClick={() => setCreating(true)} className="cu-new" s="" hover="">
            <Svg paths={I_PLUS} size={16} sw={2.4} />
            Новый клиент
          </HButton>
        </div>
        <div style={css("display:flex;flex-wrap:wrap;gap:8px;margin-top:14px")}>
          <Pill active={filter === ""} onClick={() => setFilter("")} dot="var(--accent)" label="Все" value={s ? String(s.total) : "…"} hint={s ? `${s.active} заказывали в этом месяце` : ""} />
          <Pill
            active={filter === "debt"}
            onClick={() => setFilter(filter === "debt" ? "" : "debt")}
            dot="var(--danger-dot)"
            label="С долгом"
            value={s ? String(s.debtors) : "…"}
            hint={s ? (s.debt > 0 ? `должны ${som(s.debt)}` : "долгов нет") : ""}
            tone="var(--danger)"
          />
          <Pill
            active={filter === "in_stock"}
            onClick={() => setFilter(filter === "in_stock" ? "" : "in_stock")}
            dot={ST.in_stock.dot}
            label="Ждут выдачи"
            value={s ? String(s.waiting) : "…"}
            hint={s ? (s.in_stock > 0 ? `${s.in_stock} ${plural(s.in_stock, "товар", "товара", "товаров")} на складе` : "на складе пусто") : ""}
          />
        </div>
      </section>

      {/* Сортировка */}
      <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:18px 2px 10px")}>
        <span style={css("font-size:15px;font-weight:500;color:var(--text)")}>{filter === "debt" ? "Должники" : filter === "in_stock" ? "Ждут выдачи" : q ? "Найдено" : "Все клиенты"}</span>
        {data && <span style={css(NUM + ";font-size:12.5px;color:var(--text-4)")}>{data.total}</span>}
        <span style={css("flex:1")} />
        <Tabs<CustomerSort> value={sort} onChange={setSort} tabs={SORTS} />
      </div>

      {error && <ModalError text={error} />}
      {!data && !error ? (
        <div className="cu-book" style={css("padding:16px")}>
          <SkeletonRows rows={6} />
        </div>
      ) : (
        data && (
          <>
            {data.rows.length === 0 ? (
              <div className="cu-book">
                <Empty
                  icon="customers"
                  title={q || filter ? "Никого не найдено" : "Клиентов пока нет"}
                  text={q || filter ? "Попробуйте другой запрос — телефон можно вводить в любом формате" : "Клиенты создаются сами при новом заказе или импорте Excel"}
                />
              </div>
            ) : (
              <div style={css("display:flex;gap:10px;align-items:flex-start")}>
                <div className="cu-book" style={css("flex:1;min-width:0")}>
                  {sections.map((sec, si) => (
                    <div key={sec.key || si} id={sec.key ? `cu-sec-${sec.key}` : undefined}>
                      {sec.key && (
                        <div className={"cu-sec" + (shownSort === "name" ? " letter" : "")}>
                          <span>{sec.key}</span>
                          <span style={css(NUM + ";font-size:12px;font-weight:400;color:var(--text-4)")}>{sec.rows.length}</span>
                        </div>
                      )}
                      {sec.rows.map((c) => (
                        <ContactRow
                          key={c.id}
                          c={c}
                          rank={ranked ? offset + data.rows.indexOf(c) + 1 : null}
                          onOpen={() => nav(`/customers/${c.id}`)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                {shownSort === "name" && isDesktop && sections.length > 1 && <AlphaRail letters={sections.map((x) => x.key)} />}
              </div>
            )}
            <Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />
          </>
        )
      )}
      {creating && (
        <CustomerForm
          customer={null}
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false);
            toast("success", `Клиент «${c.name}» создан`);
            nav(`/customers/${c.id}`);
          }}
        />
      )}
    </Page>
  );
}

/** Пилюля-фильтр: цветная точка, подпись, число и пояснение. */
function Pill({ active, onClick, dot, label, value, hint, tone }: { active: boolean; onClick: () => void; dot: string; label: string; value: string; hint: string; tone?: string }) {
  return (
    <HButton onClick={onClick} className={"cu-pill" + (active ? " on" : "")} s="" hover="" aria-pressed={active}>
      <span style={mix("width:8px;height:8px;border-radius:50%;flex:none", { background: dot })} />
      <span style={css("color:var(--text-2)")}>{label}</span>
      <span style={mix(NUM + ";font-size:15px;font-weight:500", { color: tone ?? "var(--text)" })}>
        <CountUp text={value} />
      </span>
      {hint && <span className="cu-pill-hint">{hint}</span>}
    </HButton>
  );
}

/** Алфавитная полоса справа: буквы разделов, клик — к разделу. */
function AlphaRail({ letters }: { letters: string[] }) {
  return (
    <nav className="cu-rail" aria-label="Алфавит">
      {letters.map((l) => (
        <button key={l} type="button" onClick={() => document.getElementById(`cu-sec-${l}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          {l}
        </button>
      ))}
    </nav>
  );
}

/** «сегодня», «вчера», «5 дн. назад», «3 нед. назад», «2 мес. назад». */
function ago(d: string | null): string {
  if (!d) return "";
  const days = Math.round((new Date(todayIso()).getTime() - new Date(d.slice(0, 10)).getTime()) / 86400000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн. назад`;
  if (days < 31) return `${Math.floor(days / 7)} нед. назад`;
  if (days < 365) return `${Math.floor(days / 30)} мес. назад`;
  return "больше года назад";
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

/** Строка справочника: аватар, имя и телефон, товары по этапам, деньги с полосой оплаты, последний заказ, быстрые действия. */
function ContactRow({ c, rank, onOpen }: { c: CustomerRow; rank: number | null; onOpen: () => void }) {
  const nav = useNavigate();
  const stages = [
    { n: c.ordered, dot: ST.ordered.dot, label: "ждём" },
    { n: c.in_stock, dot: ST.in_stock.dot, label: "на складе" },
    { n: c.issued, dot: ST.issued.dot, label: "выдано" },
  ].filter((x) => x.n > 0);
  const empty = !stages.length && !c.sale;
  const newOrder = (e: React.MouseEvent) => {
    e.stopPropagation();
    nav(`/new-order?customer=${c.id}`);
  };
  return (
    <div onClick={onOpen} className="cu-row" title="Открыть карточку клиента">
      <span style={css("position:relative;display:flex")}>
        <Avatar name={c.name} size={42} />
        {c.in_stock > 0 && <span className="cu-badge" title={`на складе ${c.in_stock}`}>{c.in_stock}</span>}
      </span>
      <span style={css("min-width:0")}>
        <span style={css("display:flex;align-items:center;gap:8px;min-width:0")}>
          {rank !== null && <span className="cu-rank">#{rank}</span>}
          <span className="cu-name">{c.name}</span>
          {c.code && <span style={css(MONO + ";flex:none;font-size:10.5px;padding:1px 6px;border-radius:6px;background:var(--hover);color:var(--text-3)")}>{c.code}</span>}
        </span>
        <span style={css(NUM + ";display:block;font-size:12.5px;color:var(--text-3);margin-top:2px;white-space:nowrap")}>{c.phone || "без телефона"}</span>
      </span>

      {empty ? (
        // Без заказов: вместо прочерков — спокойная плашка и кнопка первого заказа.
        <span className="cu-empty">
          <span className="cu-empty-ghost" aria-hidden>
            <i style={{ width: 54 }} />
            <i style={{ width: 38 }} />
          </span>
          <span style={css("min-width:0")}>
            <span style={css("display:block;font-size:12.5px;color:var(--text-2)")}>Пока без заказов</span>
            <span style={css(NUM + ";display:block;font-size:11.5px;color:var(--text-4);margin-top:1px")}>в книге с {date(c.created_at.slice(0, 10))}</span>
          </span>
          <HButton onClick={newOrder} title="Оформить первый заказ" className="cu-act cu-first" s="" hover="">
            <Svg paths={I_PLUS} size={13} sw={2.4} />
            Первый заказ
          </HButton>
        </span>
      ) : (
        <>
          <span className="cu-hide" style={css("display:flex;flex-wrap:wrap;gap:4px 12px;min-width:0;font-size:12.5px;color:var(--text-3)")}>
            {stages.map((x) => (
              <span key={x.label} style={css("display:inline-flex;align-items:center;gap:6px;white-space:nowrap")}>
                <span style={mix("width:7px;height:7px;border-radius:50%", { background: x.dot })} />
                <b style={css(NUM + ";font-weight:500;color:var(--text)")}>{x.n}</b> {x.label}
              </span>
            ))}
          </span>
          <Money sale={c.sale} debt={c.debt} />
          <span className="cu-hide" style={css("min-width:0;white-space:nowrap")}>
            {c.last_order_date ? (
              <>
                <span style={css("display:block;font-size:12.5px;color:var(--text-2)")}>{ago(c.last_order_date)}</span>
                <span style={css(NUM + ";display:block;font-size:11.5px;color:var(--text-4);margin-top:1px")}>{date(c.last_order_date)}</span>
              </>
            ) : (
              <span style={css("font-size:12.5px;color:var(--text-4)")}>—</span>
            )}
          </span>
          <span className="cu-actions cu-hide">
            {c.in_stock > 0 && (
              <HButton
                onClick={(e) => {
                  e.stopPropagation();
                  nav(`/issue?customer=${c.id}`);
                }}
                title="Выдать товары"
                className="cu-act green"
                s=""
                hover=""
              >
                <Icon name="issue" size={14} />
                Выдать
              </HButton>
            )}
            <HButton onClick={newOrder} title="Новый заказ" className="cu-act" s="" hover="">
              <Svg paths={I_PLUS} size={13} sw={2.4} />
              Заказ
            </HButton>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Деньги клиента ровной колонкой: сверху сумма заказов и состояние (долг или «оплачено»),
 * под ними полоса — зелёная часть оплачена, красная — долг. Процент — в подсказке.
 */
function Money({ sale, debt }: { sale: number; debt: number }) {
  const paid = Math.max(0, sale - debt);
  const pct = sale > 0 ? Math.round((paid / sale) * 100) : 0;
  return (
    <span className="cu-money" title={sale ? `оплачено ${pct}% · ${som(paid)} из ${som(sale)}` : undefined}>
      <span style={css("display:flex;align-items:baseline;justify-content:space-between;gap:10px")}>
        <span style={mix(NUM + ";font-size:12px;white-space:nowrap", { color: debt > 0 ? "var(--danger)" : "var(--green)" })}>{debt > 0 ? `долг ${som(debt)}` : "✓ оплачено"}</span>
        <span style={css(NUM + ";font-size:14px;font-weight:500;color:var(--text);white-space:nowrap")}>{som(sale)}</span>
      </span>
      <span className="cu-bar">
        {paid > 0 && <i style={{ flexGrow: paid, background: "linear-gradient(90deg,#34D399,#16A34A)" }} />}
        {debt > 0 && <i style={{ flexGrow: debt, background: "linear-gradient(90deg,#FB7185,#E5484D)" }} />}
      </span>
    </span>
  );
}

/** Аватар-буква; цвет — от имени, как на других страницах. */
const AVATAR_BG = [
  "linear-gradient(135deg,#5B7CFA,#8B5CF6)",
  "linear-gradient(135deg,#22C55E,#0EA5E9)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#EC4899,#8B5CF6)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
];

function Avatar({ name, size = 34 }: { name: string; size?: number }) {
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

// --- Карточка клиента -----------------------------------------------------------------------

export function CustomerDetail({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"" | ItemStatus>("");
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sel = useSelection(`${id}|${tab}`);

  const load = useCallback(() => {
    getCustomer(Number(id))
      .then((c) => {
        setCard(c);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Клиент не найден")));
  }, [id]);
  useEffect(load, [load]);
  useRefresh(load);

  if (error && !card) return <LoadError text={error} onRetry={load} />;
  if (!card) return <Page size="wide"><SkeletonRows rows={5} /></Page>;
  const c = card.customer;
  const t = card.totals;
  const rows = card.items.filter((i) => !tab || i.status === tab);
  const orders = new Set(card.items.map((i) => i.order_id)).size;
  const firstDate = card.items.reduce<string | null>((m, i) => (!m || i.order_date < m ? i.order_date : m), null);
  const paidPct = t.sale ? Math.min(100, Math.round((t.paid / t.sale) * 100)) : 0;

  return (
    <Page size="wide">
      <HButton onClick={() => nav("/customers")} s="display:flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--text-3);font-size:12.5px;cursor:pointer;padding:0;margin-bottom:10px" hover="color:var(--text)">
        <Svg paths={I_BACK} size={14} /> Все клиенты
      </HButton>

      {/* Шапка: кто это, как связаться, как давно с нами — и действия */}
      <div className="cu-card-head" style={css("margin-bottom:12px")}>
        <div style={css("display:flex;flex-wrap:wrap;gap:14px 16px;align-items:center")}>
          <Avatar name={c.name} size={56} />
          <div style={css("min-width:0;flex:1 1 260px")}>
            <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
              <span style={css("font-size:21px;font-weight:500;letter-spacing:-.01em")}>{c.name}</span>
              {c.code && <span style={css("font-size:11px;padding:2px 7px;border-radius:6px;background:var(--hover);color:var(--text-2);" + MONO)}>код {c.code}</span>}
              {t.debt > 0 && <span style={css(NUM + ";font-size:12px;font-weight:500;padding:3px 9px;border-radius:999px;background:var(--danger-tint);color:var(--danger)")}>должен {som(t.debt)}</span>}
            </div>
            <div style={css("display:flex;gap:6px 14px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:12.5px;color:var(--text-3)")}>
              {c.phone ? (
                <HButton
                  onClick={() => navigator.clipboard?.writeText(c.phone).then(() => toast("success", "Телефон скопирован"))}
                  s={"border:none;background:transparent;padding:0;cursor:pointer;font-size:14px;color:var(--text);" + NUM}
                  hover="color:var(--accent)"
                  title="Скопировать"
                >
                  {c.phone}
                </HButton>
              ) : (
                <span>телефон не указан</span>
              )}
              {firstDate && <span>клиент с {date(firstDate)}</span>}
              {orders > 0 && (
                <span>
                  {orders} {plural(orders, "заказ", "заказа", "заказов")} · {t.items} {plural(t.items, "товар", "товара", "товаров")}
                </span>
              )}
              {c.comment && <span style={css("color:var(--text-2);font-style:italic")}>«{c.comment}»</span>}
            </div>
          </div>
          <div style={css("display:flex;gap:8px;flex-wrap:wrap;align-items:center")}>
            {t.debt > 0 && (
              <HButton onClick={() => setPaying(true)} s={btnPrimary} hover="background:var(--accent-hover)">
                Принять оплату
              </HButton>
            )}
            {t.in_stock > 0 && (
              <HButton onClick={() => nav(`/issue?customer=${c.id}`)} s={btnGhost + ";color:var(--green);border-color:var(--green-dot)"} hover="background:var(--green-tint)">
                Выдать ({t.in_stock})
              </HButton>
            )}
            <HButton onClick={() => nav(`/new-order?customer=${c.id}`)} s={t.debt > 0 ? btnGhost : btnPrimary} hover={t.debt > 0 ? "border-color:var(--accent)" : "background:var(--accent-hover)"}>
              + Новый заказ
            </HButton>
            <HButton onClick={() => setEditing(true)} s={btnGhost + ";padding:0 12px"} hover="border-color:var(--accent)">
              Изменить
            </HButton>
            {isAdmin && (
              <HButton onClick={() => setDeleting(true)} s={btnGhost + ";padding:0 12px;color:var(--danger);border-color:var(--danger-border)"} hover="background:var(--danger-tint)">
                Удалить
              </HButton>
            )}
          </div>
        </div>
      </div>

      {/* Деньги одной панелью: сколько заказал, сколько оплатил, сколько должен и что заработали */}
      <div style={mix(PANEL + ";display:grid;margin-bottom:14px", { gridTemplateColumns: isDesktop ? "repeat(4,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))" })}>
        <Metric label="Сумма заказов" value={som(t.sale)} sub={`${t.items} ${plural(t.items, "товар", "товара", "товаров")}`} />
        <Metric label="Оплачено" value={som(t.paid)} color="var(--green)" sub={t.sale ? `${paidPct}% от суммы` : ""} bar={paidPct} bl />
        <Metric
          label="Долг"
          value={t.debt > 0 ? som(t.debt) : "нет"}
          color={t.debt > 0 ? "var(--danger)" : "var(--text-4)"}
          sub={t.debt > 0 ? `${t.unpaid_items} ${plural(t.unpaid_items, "товар", "товара", "товаров")} не оплачено` : "всё оплачено"}
          bl={isDesktop}
          bt={!isDesktop}
        />
        <Metric
          label="Прибыль"
          value={t.with_cost ? som(t.profit) : "—"}
          color={t.profit < 0 ? "var(--danger)" : "var(--green)"}
          sub={t.with_cost < t.items ? `по ${t.with_cost} из ${t.items} — где есть реальная цена` : "Сумма − реальная цена"}
          bl
          bt={!isDesktop}
        />
      </div>

      <div style={css("margin-bottom:10px")}>
        <Tabs<"" | ItemStatus>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "", label: "Все товары", count: t.items },
            { key: "ordered", label: "Заказаны", count: t.ordered, dot: ST.ordered.dot },
            { key: "in_stock", label: "На складе", count: t.in_stock, dot: ST.in_stock.dot },
            { key: "issued", label: "Выданы", count: t.issued, dot: ST.issued.dot },
          ]}
        />
      </div>
      <ItemTable
        rows={rows}
        isDesktop={isDesktop}
        columns={["date", "item", "qty", "sale", "profit", "pay", "status", "arrived", "issued"]}
        onOpen={setOpen}
        selected={sel.selected}
        onSelect={sel.onSelect}
        empty={<Empty icon="orders" title="Товаров нет" text="Нажмите «+ Новый заказ» вверху" />}
      />

      <BulkBar items={rows} selected={sel.selected} onClear={sel.clear} toast={toast} />
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
      {editing && (
        <CustomerForm
          customer={c}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast("success", "Клиент сохранён");
            load();
            emit("cargo:changed");
          }}
        />
      )}
      {paying && (
        <PayModal
          customer={c}
          debt={t.debt}
          onClose={() => setPaying(false)}
          onPaid={(amount) => {
            setPaying(false);
            toast("success", `Оплата ${som(amount)} принята`);
            emit("cargo:changed");
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Удалить клиента?"
          text={
            <>
              «{c.name}» и все его товары ({t.items}) пропадут из списков и отчётов. Записи останутся в базе (мягкое удаление).
            </>
          }
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await deleteCustomer(c.id);
            toast("success", "Клиент удалён");
            emit("cargo:changed");
            nav("/customers");
          }}
        />
      )}
    </Page>
  );
}

/** Ячейка денежной панели карточки; bl / bt — разделитель слева / сверху. */
function Metric({ label, value, color, sub, bar, bl, bt }: { label: string; value: string; color?: string; sub?: string; bar?: number; bl?: boolean; bt?: boolean }) {
  return (
    <div style={mix("padding:14px 18px;min-width:0", { borderLeft: bl ? "1px solid var(--border-2)" : undefined, borderTop: bt ? "1px solid var(--border-2)" : undefined })}>
      <div style={css("font-size:12px;color:var(--text-3)")}>{label}</div>
      <div style={mix(NUM + ";font-size:23px;font-weight:500;letter-spacing:-.02em;margin-top:4px;white-space:nowrap", { color: color ?? "var(--text)" })}>
        <CountUp text={value} />
      </div>
      {bar !== undefined && (
        <div style={css("height:6px;border-radius:999px;background:var(--danger-tint);margin-top:9px;overflow:hidden")}>
          <div className="bar-grow" style={mix("height:100%;border-radius:999px;background:linear-gradient(90deg,#34D399,#16A34A)", { width: bar + "%" })} />
        </div>
      )}
      {sub && <div style={css("font-size:11.5px;color:var(--text-4);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{sub}</div>}
    </div>
  );
}

function CustomerForm({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const [f, setF] = useState({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    code: customer?.code ?? "",
    comment: customer?.comment ?? "",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setError("");
    if (!f.name.trim()) return setError("Укажите имя");
    try {
      onSaved(customer ? await updateCustomer(customer.id, f) : await createCustomer(f));
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <ModalShell
      title={customer ? "Изменить клиента" : "Новый клиент"}
      icon={<Svg paths={I_USER} size={16} />}
      onClose={onClose}
      width={440}
      footer={
        <>
          <HButton onClick={onClose} s={btnGhost} hover="background:var(--hover)">
            Отмена
          </HButton>
          <HButton onClick={save} s={btnPrimary} hover="background:var(--accent-hover)">
            Сохранить
          </HButton>
        </>
      }
    >
      <div style={css("padding:18px;display:flex;flex-direction:column;gap:12px")} onKeyDown={(e) => e.key === "Enter" && save()}>
        <label>
          <FieldLabel>Имя</FieldLabel>
          <input autoFocus value={f.name} onChange={set("name")} style={css(inputStyle)} />
        </label>
        <label>
          <FieldLabel>Телефон</FieldLabel>
          <PhoneInput value={f.phone} onChange={(phone) => setF((x) => ({ ...x, phone }))} />
        </label>
        <label>
          <FieldLabel>Код клиента (необязательно)</FieldLabel>
          <input value={f.code} onChange={set("code")} style={css(inputStyle + ";" + MONO)} />
        </label>
        <label>
          <FieldLabel>Комментарий</FieldLabel>
          <input value={f.comment} onChange={set("comment")} style={css(inputStyle)} />
        </label>
        <ModalError text={error} />
      </div>
    </ModalShell>
  );
}

/** Оплата одной суммой: сервер распределит её по неоплаченным товарам, начиная со старых. */
function PayModal({
  customer,
  debt,
  onClose,
  onPaid,
}: {
  customer: Customer;
  debt: number;
  onClose: () => void;
  onPaid: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(String(debt));
  const [method, setMethod] = useState("cash");
  const [error, setError] = useState("");

  async function pay() {
    setError("");
    const a = parseMoney(amount);
    if (!a || Number.isNaN(a)) return setError("Укажите сумму");
    try {
      await payCustomer(customer.id, { amount: a, method });
      onPaid(a);
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <ModalShell
      title={`Оплата — ${customer.name}`}
      icon={<span style={css(MONO + ";font-weight:700")}>с</span>}
      onClose={onClose}
      width={420}
      footer={
        <>
          <HButton onClick={onClose} s={btnGhost} hover="background:var(--hover)">
            Отмена
          </HButton>
          <HButton onClick={pay} s={btnPrimary} hover="background:var(--accent-hover)">
            Принять
          </HButton>
        </>
      }
    >
      <div style={css("padding:18px;display:flex;flex-direction:column;gap:12px")}>
        <div style={css("font-size:12.5px;color:var(--text-2)")}>
          Долг клиента: <b style={css(MONO + ";color:var(--danger)")}>{som(debt)}</b>. Сумма распределится по неоплаченным товарам, начиная с самых
          старых.
        </div>
        <MoneyInput value={amount} onChange={setAmount} big autoFocus onEnter={pay} />
        <Select value={method} onChange={setMethod} ariaLabel="Способ оплаты" options={METHOD_OPTIONS} />
        <ModalError text={error} />
      </div>
    </ModalShell>
  );
}
