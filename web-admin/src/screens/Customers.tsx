/**
 * Клиенты: быстрый поиск (имя, телефон в любом формате, код клиента) и карточка
 * клиента — все его товары, суммы, оплаты, долг, что заказано / на складе / выдано.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import { I_BACK, I_BOX, I_USER, Svg } from "../design/icons";
import { PANEL, Page, PrimaryAction, SearchInput, THEAD } from "../design/table";
import {
  FieldLabel,
  HButton,
  LoadError,
  ModalError,
  ModalShell,
  ST,
  SkeletonRows,
  btnGhost,
  btnPrimary,
  inputStyle,
} from "../design/ui";
import { METHOD_OPTIONS, date, parseMoney, som, todayIso } from "../lib/cargo";
import { emit, useDebounced, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
const LIMIT = 50;

// --- Список ---------------------------------------------------------------------------

type Filter = "" | "debt" | "in_stock";

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

  const load = useCallback(() => {
    listCustomers({ q, filter, sort, limit: LIMIT, offset })
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить клиентов")));
  }, [q, filter, sort, offset]);
  useEffect(load, [load]);
  useEffect(() => setOffset(0), [q, filter, sort]);
  useRefresh(load);

  const s = data?.summary;
  const GRID = "minmax(230px,1.7fr) minmax(170px,1.1fr) 110px 110px 116px 118px 30px";
  // Заголовки таблицы: по некоторым можно сортировать.
  const HEAD: { label: string; sort?: CustomerSort; right?: boolean }[] = [
    { label: "Клиент", sort: "name" },
    { label: "Товары" },
    { label: "Сумма", sort: "sale", right: true },
    { label: "Оплачено", right: true },
    { label: "Долг", sort: "debt", right: true },
    { label: "Посл. заказ", sort: "recent" },
    { label: "" },
  ];

  return (
    <Page size="wide">
      {/* Плитки-фильтры: сразу видно, сколько должников и кого ждут на выдачу */}
      <div style={mix("display:grid;gap:10px;margin-bottom:14px", { gridTemplateColumns: "repeat(3,minmax(0,1fr))" })}>
        <FilterTile
          active={filter === ""}
          onClick={() => setFilter("")}
          label="Все клиенты"
          value={s ? String(s.total) : "…"}
          hint={s ? `${s.active} заказывали в этом месяце` : ""}
          tone="accent"
          compact={!isDesktop}
          icon={<Svg paths={I_USER} size={16} />}
        />
        <FilterTile
          active={filter === "debt"}
          onClick={() => setFilter(filter === "debt" ? "" : "debt")}
          label="С долгом"
          value={s ? String(s.debtors) : "…"}
          hint={s ? (s.debt > 0 ? `должны ${som(s.debt)}` : "долгов нет") : ""}
          tone="danger"
          compact={!isDesktop}
          icon={<span style={css(MONO + ";font-weight:700;font-size:14px")}>с</span>}
        />
        <FilterTile
          active={filter === "in_stock"}
          onClick={() => setFilter(filter === "in_stock" ? "" : "in_stock")}
          label="Ждут выдачи"
          value={s ? String(s.waiting) : "…"}
          hint={s ? (s.in_stock > 0 ? `${s.in_stock} ${plural(s.in_stock, "товар", "товара", "товаров")} на складе` : "на складе пусто") : ""}
          tone="green"
          compact={!isDesktop}
          icon={<Svg paths={I_BOX} size={16} />}
        />
      </div>

      <div style={css("display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px")}>
        <div style={css("flex:1 1 260px;min-width:0")}>
          <SearchInput value={query} onChange={setQuery} placeholder="Имя, телефон или код клиента…" width={420} />
        </div>
        {!isDesktop && (
          <Select<CustomerSort>
            value={sort}
            onChange={setSort}
            width={170}
            height={34}
            fontSize={12.5}
            ariaLabel="Сортировка"
            options={[
              { value: "recent", label: "Сначала недавние" },
              { value: "debt", label: "Больше долг" },
              { value: "sale", label: "Больше сумма" },
              { value: "name", label: "По имени" },
            ]}
          />
        )}
        {data && (q || filter) && (
          <span style={css("font-size:12px;color:var(--text-3);white-space:nowrap")}>
            найдено <b style={css(MONO + ";color:var(--text)")}>{data.total}</b>
          </span>
        )}
        <PrimaryAction onClick={() => setCreating(true)}>Новый клиент</PrimaryAction>
      </div>

      {error && <ModalError text={error} />}
      {!data && !error ? (
        <SkeletonRows rows={6} />
      ) : (
        data && (
          <>
            <div style={css(PANEL)}>
              {isDesktop && (
                <div style={mix(THEAD, { gridTemplateColumns: GRID })}>
                  {HEAD.map((h, i) => {
                    const on = h.sort && sort === h.sort;
                    const cell = mix("padding:10px 14px;display:flex;align-items:center;gap:4px;white-space:nowrap;border:none;background:transparent;font:inherit;letter-spacing:inherit;text-transform:inherit", {
                      justifyContent: h.right ? "flex-end" : "flex-start",
                      color: on ? "var(--text)" : "var(--text-3)",
                      cursor: h.sort ? "pointer" : "default",
                    });
                    return h.sort ? (
                      <HButton
                        key={i}
                        onClick={() => setSort(h.sort!)}
                        s={cell}
                        hover="color:var(--text)"
                        title="Сортировать"
                      >
                        {h.label}
                        <span style={mix("font-size:9px", { opacity: on ? 1 : 0.35 })}>{h.sort === "name" ? "▲" : "▼"}</span>
                      </HButton>
                    ) : (
                      <div key={i} style={cell}>
                        {h.label}
                      </div>
                    );
                  })}
                </div>
              )}
              {data.rows.length === 0 ? (
                <Empty
                  icon="customers"
                  title={q || filter ? "Никого не найдено" : "Клиентов пока нет"}
                  text={q || filter ? "Попробуйте другой запрос — телефон можно вводить в любом формате" : "Клиенты создаются сами при новом заказе или импорте Excel"}
                />
              ) : (
                data.rows.map((c) => (isDesktop ? <DesktopRow key={c.id} c={c} grid={GRID} onOpen={() => nav(`/customers/${c.id}`)} /> : <MobileRow key={c.id} c={c} onOpen={() => nav(`/customers/${c.id}`)} />))
              )}
            </div>
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

const TONES = {
  accent: { fg: "var(--accent)", tint: "var(--accent-tint)", border: "var(--accent)" },
  danger: { fg: "var(--danger)", tint: "var(--danger-tint)", border: "var(--danger-dot)" },
  green: { fg: "var(--green)", tint: "var(--green-tint)", border: "var(--green-dot)" },
} as const;

function FilterTile({
  active,
  onClick,
  label,
  value,
  hint,
  tone,
  icon,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: string;
  hint: string;
  tone: keyof typeof TONES;
  icon: ReactNode;
  compact?: boolean;
}) {
  const t = TONES[tone];
  return (
    <HButton
      onClick={onClick}
      s={mix(
        (compact ? "display:flex;align-items:center;gap:0;padding:9px 10px;min-width:0;" : "display:flex;align-items:center;gap:12px;padding:12px 14px;") + "border-radius:10px;background:var(--surface);cursor:pointer;text-align:left;transition:border-color .12s,box-shadow .12s",
        {
          border: `1px solid ${active ? t.border : "var(--border)"}`,
          boxShadow: active ? `0 0 0 3px ${t.tint}` : "none",
        }
      )}
      hover={active ? undefined : "border-color:var(--border-strong)"}
    >
      {!compact && (
        <span style={mix("width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:none", { background: t.tint, color: t.fg })}>
          {icon}
        </span>
      )}
      <span style={css("min-width:0;flex:1")}>
        <span style={css("display:block;font-size:11.5px;font-weight:500;color:var(--text-3)")}>{label}</span>
        <span style={mix("display:flex;align-items:baseline;min-width:0", { flexDirection: compact ? "column" : "row", gap: compact ? 0 : 8 })}>
          <span style={mix(MONO + ";font-weight:600", { fontSize: compact ? 18 : 21, color: compact && active ? t.fg : "var(--text)" })}>{value}</span>
          <span style={mix("color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%", { fontSize: compact ? 10.5 : 11.5 })}>{hint}</span>
        </span>
      </span>
    </HButton>
  );
}

/** Кружок с инициалами; цвет стабилен для одного и того же имени. */
const AVATAR_TONES = [
  ["var(--accent-tint)", "var(--accent-strong)"],
  ["var(--violet-tint)", "var(--violet)"],
  ["var(--amber-tint)", "var(--amber)"],
  ["var(--green-tint)", "var(--green)"],
  ["var(--danger-tint2)", "var(--danger-muted)"],
];
function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <span
      style={mix("display:flex;align-items:center;justify-content:center;border-radius:50%;flex:none;font-weight:600;letter-spacing:.02em", {
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: bg,
        color: fg,
      })}
    >
      {letters}
    </span>
  );
}

/** Полоска «заказано → на складе → выдано» и подпись с ненулевыми счётчиками. */
function ItemsBar({ c, compact }: { c: Pick<CustomerRow, "ordered" | "in_stock" | "issued">; compact?: boolean }) {
  const total = c.ordered + c.in_stock + c.issued;
  const parts = [
    { n: c.ordered, dot: ST.ordered.dot, label: "заказано" },
    { n: c.in_stock, dot: ST.in_stock.dot, label: "на складе" },
    { n: c.issued, dot: ST.issued.dot, label: "выдано" },
  ];
  if (!total) return <span style={css("font-size:11.5px;color:var(--text-5)")}>нет товаров</span>;
  return (
    <div style={css("min-width:0")} title={parts.map((p) => `${p.label}: ${p.n}`).join(" · ")}>
      <div style={mix("display:flex;gap:2px;height:5px;border-radius:3px;overflow:hidden;background:var(--border-2)", { width: compact ? "90px" : "100%" })}>
        {parts.map((p) => p.n > 0 && <span key={p.label} style={mix("height:100%", { flex: p.n, background: p.dot })} />)}
      </div>
      <div style={css("display:flex;gap:9px;margin-top:5px;font-size:11px;color:var(--text-3);white-space:nowrap;overflow:hidden")}>
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <span key={p.label} style={css("display:inline-flex;align-items:center;gap:4px")}>
              <span style={mix("width:6px;height:6px;border-radius:50%", { background: p.dot })} />
              <b style={css(MONO + ";font-weight:600;color:var(--text)")}>{p.n}</b>
              {!compact && p.label}
            </span>
          ))}
      </div>
    </div>
  );
}

function DebtPill({ debt }: { debt: number }) {
  if (debt <= 0) return <span style={css("color:var(--text-5)")}>—</span>;
  return (
    <span style={css("display:inline-block;padding:3px 8px;border-radius:6px;background:var(--danger-tint);color:var(--danger);font-weight:600;white-space:nowrap;" + MONO)}>
      {som(debt)}
    </span>
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

function DesktopRow({ c, grid, onOpen }: { c: CustomerRow; grid: string; onOpen: () => void }) {
  return (
    <div onClick={onOpen} className="row-click" style={mix("display:grid;align-items:center;border-bottom:1px solid var(--hover);font-size:12.5px;min-height:58px", { gridTemplateColumns: grid })}>
      <div style={css("padding:9px 14px;display:flex;align-items:center;gap:11px;min-width:0")}>
        <Avatar name={c.name} />
        <div style={css("min-width:0")}>
          <div style={css("display:flex;align-items:center;gap:7px;min-width:0")}>
            <span style={css("font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.name}</span>
            {c.code && <span style={css("flex:none;font-size:10.5px;padding:1px 6px;border-radius:5px;background:var(--hover);color:var(--text-3);" + MONO)}>{c.code}</span>}
          </div>
          <div style={css(MONO + ";font-size:11.5px;color:var(--text-3);margin-top:2px;white-space:nowrap")}>{c.phone || "без телефона"}</div>
        </div>
      </div>
      <div style={css("padding:9px 14px;min-width:0")}>
        <ItemsBar c={c} />
      </div>
      <div style={css("padding:9px 14px;text-align:right;font-weight:500;" + MONO)}>{c.sale ? som(c.sale) : "—"}</div>
      <div style={css("padding:9px 14px;text-align:right;color:var(--text-2);" + MONO)}>{c.paid ? som(c.paid) : "—"}</div>
      <div style={css("padding:9px 14px;text-align:right")}>
        <DebtPill debt={c.debt} />
      </div>
      <div style={css("padding:9px 14px;white-space:nowrap")}>
        {c.last_order_date ? (
          <>
            <div style={css("font-size:12.5px;color:var(--text)")}>{ago(c.last_order_date)}</div>
            <div style={css(MONO + ";font-size:11px;color:var(--text-4);margin-top:1px")}>{date(c.last_order_date)}</div>
          </>
        ) : (
          <span style={css("color:var(--text-5)")}>—</span>
        )}
      </div>
      <div style={css("padding-right:12px;color:var(--text-5);display:flex;justify-content:flex-end;font-size:16px")}>›</div>
    </div>
  );
}

function MobileRow({ c, onOpen }: { c: CustomerRow; onOpen: () => void }) {
  return (
    <div onClick={onOpen} className="row-click" style={css("display:flex;align-items:center;gap:11px;padding:11px 12px;border-bottom:1px solid var(--hover)")}>
      <Avatar name={c.name} size={36} />
      <div style={css("flex:1;min-width:0")}>
        <div style={css("display:flex;align-items:center;gap:6px")}>
          <span style={css("font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.name}</span>
          {c.code && <span style={css("flex:none;font-size:10px;padding:1px 5px;border-radius:5px;background:var(--hover);color:var(--text-3);" + MONO)}>{c.code}</span>}
        </div>
        <div style={css(MONO + ";font-size:11.5px;color:var(--text-3);margin:2px 0 5px")}>{c.phone || "без телефона"}</div>
        <ItemsBar c={c} compact />
      </div>
      <div style={css("text-align:right;flex:none;font-size:12.5px")}>
        <DebtPill debt={c.debt} />
        <div style={css("font-size:11px;color:var(--text-4);margin-top:5px")}>{ago(c.last_order_date)}</div>
      </div>
    </div>
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
      <div style={css(PANEL + ";padding:16px 18px;margin-bottom:12px")}>
        <div style={css("display:flex;flex-wrap:wrap;gap:14px 16px;align-items:center")}>
          <Avatar name={c.name} size={50} />
          <div style={css("min-width:0;flex:1 1 260px")}>
            <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
              <span style={css("font-size:20px;font-weight:700;letter-spacing:-.01em")}>{c.name}</span>
              {c.code && <span style={css("font-size:11px;padding:2px 7px;border-radius:6px;background:var(--hover);color:var(--text-2);" + MONO)}>код {c.code}</span>}
              {t.debt > 0 && <span style={css("font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;background:var(--danger-tint);color:var(--danger)")}>должен {som(t.debt)}</span>}
            </div>
            <div style={css("display:flex;gap:6px 14px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:12.5px;color:var(--text-3)")}>
              {c.phone ? (
                <HButton
                  onClick={() => navigator.clipboard?.writeText(c.phone).then(() => toast("success", "Телефон скопирован"))}
                  s={"border:none;background:transparent;padding:0;cursor:pointer;font-size:13px;color:var(--text);" + MONO}
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
      <div style={css("font-size:11.5px;font-weight:500;color:var(--text-3)")}>{label}</div>
      <div style={mix(MONO + ";font-size:22px;font-weight:600;margin-top:3px;white-space:nowrap", { color: color ?? "var(--text)" })}>
        <CountUp text={value} />
      </div>
      {bar !== undefined && (
        <div style={css("height:4px;border-radius:2px;background:var(--border-2);margin-top:8px;overflow:hidden")}>
          <div style={mix("height:100%;border-radius:2px;background:var(--green-dot);transition:width .3s", { width: bar + "%" })} />
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
