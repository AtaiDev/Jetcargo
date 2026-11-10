/**
 * Клиенты — «телефонная книга»: большой поиск (имя, телефон в любом формате, код клиента),
 * фильтры-пилюли с цифрами и справочник разделами — по алфавиту (с алфавитной полосой),
 * по давности заказа или рейтингом (должники, крупные); у каждого — полоса оплаты. Карточка клиента — все его товары,
 * суммы, оплаты, долг, что заказано / на складе / выдано.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

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
  type Item,
  type ItemStatus,
  type Page as PageOf,
} from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { Confirm, MoneyInput } from "../components/cargo";
import BulkBar, { useSelection } from "../components/BulkBar";
import ItemModal from "../components/ItemModal";
import PhoneInput from "../components/PhoneInput";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_BACK, I_CLOSE, I_PLUS, I_SEARCH, I_USER, Svg } from "../design/icons";
import { Page } from "../design/table";
import { FieldLabel, HButton, LoadError, ModalCancel, ModalError, ModalShell, btnPrimary, inputStyle } from "../design/ui";
import { METHOD_OPTIONS, date, num, parseMoney, profitOf, shortDateTime, som, todayIso } from "../lib/cargo";
import { emit, itemMatches, onFocusItem, useDebounced, useRefresh, useSearchHits } from "../lib/events";
import SlideTabs from "../components/SlideTabs";
import { HomeHead } from "./overview/Home";

type Toast = (kind: "success" | "error", text: string) => void;
type PathDef = [string, Record<string, unknown>][];
const LIMIT = 100;

// --- Список ---------------------------------------------------------------------------

type Filter = "" | "debt" | "in_stock";

const SORTS: [CustomerSort, string][] = [
  ["recent", "Недавние"],
  ["name", "А–Я"],
  ["debt", "Должники"],
  ["sale", "Крупные"],
];

const IC: Record<"users" | "wallet" | "box", PathDef> = {
  users: [["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }], ["circle", { cx: 9, cy: 7, r: 4 }], ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }], ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }]],
  wallet: [["path", { d: "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" }], ["path", { d: "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" }]],
  box: [["path", { d: "M21 8 12 3 3 8v8l9 5 9-5V8Z" }], ["path", { d: "m3 8 9 5 9-5" }], ["path", { d: "M12 13v8" }]],
};

const pc = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

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
  const listTop = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

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
  // Карточки плавно появляются, когда при прокрутке попадают в экран; соседние — волной.
  useEffect(() => {
    const root = gridRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cards = [...root.querySelectorAll<HTMLElement>(".cu6-c")];
    cards.forEach((el) => el.classList.add("rv"));
    const timers: number[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        let k = 0;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          const delay = Math.min(k++, 7) * 70;
          el.style.transitionDelay = `${delay}ms`;
          el.classList.add("in");
          io.unobserve(el);
          // Когда доехала — снимаем служебные классы, чтобы наведение работало как обычно.
          timers.push(window.setTimeout(() => {
            el.classList.remove("rv", "in");
            el.style.transitionDelay = "";
          }, delay + 700));
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -30px 0px" }
    );
    cards.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [data]);
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
  const pages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;
  const page = Math.floor(offset / LIMIT);
  // Листаем — экран встаёт к началу списка, а не к самому верху.
  const go = (o: number) => {
    setOffset(o);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Page size="wide">
      <div className="ov cu2">
        <div className="wx-head">
          <HomeHead title="Клиенты" />
          <div className="wx-head-r">
            <button type="button" className="od-new" onClick={() => setCreating(true)}>
              <Svg paths={I_PLUS} size={15} sw={2.2} />
              Новый клиент
            </button>
          </div>
        </div>

        {/* Сводка: одна полоса — «Все», «С долгом», «Ждут выдачи» — фильтры */}
        <div className="cu3-sum">
          <button type="button" className={"cu3-seg" + (filter === "" ? " on" : "")} onClick={() => setFilter("")} aria-pressed={filter === ""}>
            <i>
              <Svg paths={IC.users} size={16} sw={2} />
            </i>
            <span>
              <small>Все клиенты</small>
              <b>{s ? <CountUp text={String(s.total)} /> : "—"}</b>
              <em>в книге</em>
            </span>
            <AvatarStack names={data?.rows.map((r) => r.name) ?? []} total={s?.total ?? 0} />
          </button>
          <div className="cu3-seg info">
            <i>
              <Svg paths={[["path", { d: "m22 7-8.5 8.5-5-5L2 17" }], ["path", { d: "M16 7h6v6" }]]} size={16} sw={2} />
            </i>
            <span>
              <small>Активны</small>
              <b>{s ? <CountUp text={String(s.active)} /> : "—"}</b>
              <em>{s ? `${pc(s.active, s.total)}% заказывали в этом месяце` : "…"}</em>
            </span>
            <CalendarLeaf pct={s ? pc(s.active, s.total) : 0} />
          </div>
          <button type="button" className={"cu3-seg" + (filter === "debt" ? " on" : "")} onClick={() => setFilter(filter === "debt" ? "" : "debt")} aria-pressed={filter === "debt"}>
            <i>
              <Svg paths={IC.wallet} size={16} sw={2} />
            </i>
            <span>
              <small>С долгом</small>
              <b>{s ? <CountUp text={String(s.debtors)} /> : "—"}</b>
              <em>{s ? (s.debt > 0 ? `должны ${som(s.debt)}` : "долгов нет") : "…"}</em>
            </span>
            <Receipt has={!!s && s.debt > 0} />
          </button>
          <button type="button" className={"cu3-seg" + (filter === "in_stock" ? " on" : "")} onClick={() => setFilter(filter === "in_stock" ? "" : "in_stock")} aria-pressed={filter === "in_stock"}>
            <i>
              <Svg paths={IC.box} size={16} sw={2} />
            </i>
            <span>
              <small>Ждут выдачи</small>
              <b>{s ? <CountUp text={String(s.waiting)} /> : "—"}</b>
              <em>{s ? (s.in_stock > 0 ? `${s.in_stock} ${plural(s.in_stock, "товар", "товара", "товаров")} на складе` : "на складе пусто") : "…"}</em>
            </span>
            <Parcel n={s?.in_stock ?? 0} />
          </button>
        </div>

        {/* Поиск и сортировка */}
        <div className="cu2-tools cu3-tools" ref={listTop}>
          <label className="rx-as-in od-search cu2-search">
            <Svg paths={I_SEARCH} size={15} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder={isDesktop ? "Имя, телефон в любом формате или код клиента" : "Имя, телефон или код"}
              aria-label="Найти клиента"
              autoFocus={isDesktop}
            />
            {query && (
              <button
                type="button"
                className="cu2-x"
                title="Очистить"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                <Svg paths={I_CLOSE} size={13} sw={2.2} />
              </button>
            )}
          </label>
          <SlideTabs<CustomerSort> value={sort} onChange={setSort} options={SORTS} counts={false} />
          {data && <span className="cu3-count">{data.total} {plural(data.total, "клиент", "клиента", "клиентов")}</span>}
        </div>

        {error && <ModalError text={error} />}
        {!data && !error ? (
          <div className="cu6-grid" aria-hidden>
            {Array.from({ length: 8 }, (_, k) => (
              <div key={k} className="cu6-c ghost">
                <div className="cu6-band" />
                <span className="cu6-av sk" />
                <span className="sk" style={{ width: `${[56, 44, 62, 50][k % 4]}%`, height: 12, marginTop: 12 }} />
                <span className="sk" style={{ width: "40%", height: 9, marginTop: 8 }} />
                <span className="sk" style={{ width: "86%", height: 46, marginTop: 14, borderRadius: 14 }} />
              </div>
            ))}
          </div>
        ) : (
          data && (
            <div className="cu6">
              {data.rows.length === 0 ? (
                <div className="ov-card paper cu2-none">
                  <span className="cu2-none-i">
                    <Svg paths={IC.users} size={22} sw={1.8} />
                  </span>
                  <b>{q || filter ? "Никого не найдено" : "Клиентов пока нет"}</b>
                  <small>{q || filter ? "Попробуйте другой запрос — телефон можно вводить в любом формате" : "Клиенты создаются сами при новом заказе или импорте Excel"}</small>
                </div>
              ) : (
                <>
                  {shownSort === "name" && sections.length > 1 && (
                    <nav className="cu5-abc cu6-abc" aria-label="Алфавит">
                      {sections.map((x) => (
                        <button key={x.key} type="button" onClick={() => document.getElementById(`cu-sec-${x.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                          {x.key}
                        </button>
                      ))}
                    </nav>
                  )}
                  <div className="cu6-grid" ref={gridRef}>
                    {data.rows.map((c, i) => {
                      const sec = sectionOf(c, shownSort);
                      const first = !!sec && (i === 0 || sectionOf(data.rows[i - 1], shownSort) !== sec);
                      return (
                        <ProfileCard
                          key={c.id}
                          c={c}
                          anchor={first ? `cu-sec-${sec}` : undefined}
                          mark={ranked ? `#${offset + i + 1}` : first && shownSort === "name" ? sec : undefined}
                          onOpen={() => nav(`/customers/${c.id}`)}
                        />
                      );
                    })}
                  </div>
                  {data.total > LIMIT && (
                    <footer className="hx-foot od-foot cu2-pager">
                      <small>
                        {offset + 1}–{Math.min(data.total, offset + LIMIT)} из {data.total} {plural(data.total, "клиента", "клиентов", "клиентов")}
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
                </>
              )}
            </div>
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
      </div>
    </Page>
  );
}

/** Стопка кружков с инициалами последних клиентов и «+N». */
function AvatarStack({ names, total }: { names: string[]; total: number }) {
  const shown = names.slice(0, 4);
  return (
    <span className="cu7-vis cu7-ava" aria-hidden>
      {shown.map((n, k) => (
        <i key={k} style={{ animationDelay: `${k * 90}ms` }}>
          {letters(n)}
        </i>
      ))}
      {total > shown.length && (
        <i className="more" style={{ animationDelay: `${shown.length * 90}ms` }}>
          +{total - shown.length}
        </i>
      )}
    </span>
  );
}

const MON_ABBR = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Листок отрывного календаря: шапка с месяцем, закрашенные клетки — доля активных клиентов. */
function CalendarLeaf({ pct }: { pct: number }) {
  const N = 12;
  const lit = pct > 0 ? Math.max(1, Math.round((pct / 100) * N)) : 0;
  return (
    <span className="cu7-vis cu8-cal" aria-hidden title={`${pct}% клиентов заказывали в этом месяце`}>
      <svg viewBox="0 0 52 54">
        <rect className="paper" x="5" y="8" width="42" height="42" rx="6" />
        <path className="head" d="M5 14a6 6 0 0 1 6-6h30a6 6 0 0 1 6 6v6H5Z" />
        <text className="mon" x="26" y="17.6" textAnchor="middle">
          {MON_ABBR[new Date().getMonth()]}
        </text>
        <rect className="ring" x="14" y="4" width="3.4" height="9" rx="1.7" />
        <rect className="ring" x="34.6" y="4" width="3.4" height="9" rx="1.7" />
        {Array.from({ length: N }, (_, k) => (
          <rect
            key={k}
            className={"day" + (k < lit ? " on" : "")}
            x={10.5 + (k % 4) * 8.2}
            y={24.5 + Math.floor(k / 4) * 7.8}
            width="6"
            height="5.6"
            rx="1.6"
            style={{ animationDelay: `${300 + k * 40}ms` }}
          />
        ))}
      </svg>
    </span>
  );
}

/** Чек с зубчатым краем: строки и жирный итог; есть долг — итог тёмный. */
function Receipt({ has }: { has: boolean }) {
  return (
    <span className={"cu7-vis cu8-rc" + (has ? "" : " none")} aria-hidden>
      <svg viewBox="0 0 54 50">
        <path className="paper" d="M8 2H46a3 3 0 0 1 3 3V44L44.6 41 40.2 44 35.8 41 31.4 44 27 41 22.6 44 18.2 41 13.8 44 9.4 41 5 44V5a3 3 0 0 1 3-3Z" />
        <rect className="ln" x="11" y="9" width="20" height="3" rx="1.5" />
        <rect className="ln" x="11" y="16" width="27" height="3" rx="1.5" />
        <rect className="ln" x="11" y="23" width="16" height="3" rx="1.5" />
        <rect className="tot" x="11" y="31" width="32" height="4.5" rx="2.2" />
      </svg>
    </span>
  );
}

/** Объёмная коробка с лентой и наклейкой; в углу — сколько товаров ждёт выдачи. */
function Parcel({ n }: { n: number }) {
  return (
    <span className={"cu7-vis cu8-pc" + (n ? "" : " none")} aria-hidden>
      <svg viewBox="0 0 54 52">
        <ellipse className="sh" cx="27" cy="48" rx="21" ry="3.2" />
        <polygon className="l" points="7,16 27,26 27,46 7,36" />
        <polygon className="r" points="27,26 47,16 47,36 27,46" />
        <polygon className="t" points="27,6 47,16 27,26 7,16" />
        <polygon className="tape" points="14,19.5 34,9.5 40,12.5 20,22.5" />
        <polygon className="tape2" points="14,19.5 20,22.5 20,31 14,28" />
        <polygon className="lbl" points="32,30.5 41,26 41,32.5 32,37" />
        <path className="edge" d="M27 26V46M7 16l20 10 20-10" />
      </svg>
      {n > 0 && <em>{n}</em>}
    </span>
  );
}

/** Доля «водой» в скруглённом окошке (как на «Уведомлениях»): уровень = процент. */
function Wave({ pct, label, dark }: { pct: number; label: string; dark?: boolean }) {
  const y = (1 - Math.max(0, Math.min(100, pct)) / 100) * 46;
  return (
    <span className={"nf-wave cu2-wave" + (dark ? " dark" : "")} title={`${pct}% ${label}`}>
      <svg viewBox="0 0 64 52" preserveAspectRatio="none" aria-hidden>
        <g className="lvl" style={{ transform: `translateY(${y}px)` }}>
          <path className="w2" d="M0 6 Q8 1 16 6 T32 6 T48 6 T64 6 T80 6 T96 6 T112 6 T128 6 V70 H0Z" />
          <path className="w1" d="M0 6 Q8 1 16 6 T32 6 T48 6 T64 6 T80 6 T96 6 T112 6 T128 6 V70 H0Z" />
        </g>
      </svg>
      <b>{pct}%</b>
      <small>{label}</small>
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

const letters = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

/**
 * Карточка-профиль: полоса с узором (тёмная — если товар ждёт выдачи), круглый аватар на ней,
 * имя, телефон и код; плашка «Сумма · Товары · Долг»; полоска этапов и давность заказа; действия — в «⋯».
 */
function ProfileCard({ c, mark, anchor, onOpen }: { c: CustomerRow; mark?: string; anchor?: string; onOpen: () => void }) {
  const ready = c.in_stock > 0;
  const empty = !c.items && !c.sale;
  const stages = [
    { k: "o", n: c.ordered, label: "ждём" },
    { k: "s", n: c.in_stock, label: "на складе" },
    { k: "i", n: c.issued, label: "выдано" },
  ].filter((x) => x.n > 0);
  return (
    <div
      className={"cu6-c" + (ready ? " ready" : "")}
      id={anchor}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      role="button"
      tabIndex={0}
      title="Открыть карточку клиента"
    >
      <div className="cu6-band">
        <span className="cu6-tl">
          {mark && <em className="cu6-mark">{mark}</em>}
          {ready && <em className="cu6-go">к выдаче · {c.in_stock}</em>}
        </span>
        <CardMenu c={c} />
      </div>
      <span className="cu6-av">{letters(c.name)}</span>
      <div className="cu6-id">
        <b>{c.name}</b>
        <small>
          {c.phone || "без телефона"}
          {c.code && <code>{c.code}</code>}
        </small>
      </div>
      <div className="cu6-stats">
        <span>
          <b>{c.sale > 0 ? som(c.sale) : "—"}</b>
          <small>сумма</small>
        </span>
        <span>
          <b>{c.items || "—"}</b>
          <small>{plural(c.items, "товар", "товара", "товаров")}</small>
        </span>
        <span className={c.debt > 0 ? "owe" : ""}>
          <b>{c.debt > 0 ? som(c.debt) : "—"}</b>
          <small>долг</small>
        </span>
      </div>
      <div className="cu6-foot">
        {empty ? (
          <small className="cu6-none">пока без заказов · в книге с {date(c.created_at.slice(0, 10))}</small>
        ) : (
          <>
            <span className="cu6-bar" title={stages.map((x) => `${x.label} ${x.n}`).join(" · ")}>
              {stages.map((x) => (
                <i key={x.k} className={x.k} style={{ flexGrow: x.n }} />
              ))}
            </span>
            <span className="cu6-fl">
              <small>{c.last_order_date ? ago(c.last_order_date) : "заказов не было"}</small>
              <small>{c.in_stock > 0 ? `на складе ${c.in_stock}` : c.ordered > 0 ? `ждём ${c.ordered}` : "всё выдано"}</small>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** «⋯» на карточке: выдать (если есть на складе), новый заказ, открыть карточку. */
function CardMenu({ c }: { c: CustomerRow }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const go = (to: string) => {
    setOpen(false);
    nav(to);
  };
  return (
    <span className="cu4-more cu6-more" ref={box} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button type="button" className={"cu4-dots" + (open ? " on" : "")} onClick={() => setOpen(!open)} aria-label="Действия с клиентом" aria-expanded={open}>
        <Svg paths={[["circle", { cx: 5, cy: 12, r: 1.6 }], ["circle", { cx: 12, cy: 12, r: 1.6 }], ["circle", { cx: 19, cy: 12, r: 1.6 }]]} size={16} sw={2.2} />
      </button>
      {open && (
        <span className="cu4-menu" role="menu">
          {c.in_stock > 0 && (
            <button type="button" role="menuitem" className="main" onClick={() => go(`/issue?customer=${c.id}`)}>
              <Svg paths={[["path", { d: "M20 6 9 17l-5-5" }]]} size={14} sw={2.6} />
              Выдать товары
              <em>{c.in_stock}</em>
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => go(`/new-order?customer=${c.id}`)}>
            <Svg paths={I_PLUS} size={14} sw={2.4} />
            Новый заказ
          </button>
          <button type="button" role="menuitem" onClick={() => go(`/customers/${c.id}`)}>
            <Svg paths={I_USER} size={14} sw={2.2} />
            Открыть карточку
          </button>
        </span>
      )}
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

export function CustomerDetail({ toast }: { isDesktop: boolean; toast: Toast }) {
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

  // --- Найденное поиском в шапке: где эти товары в списке клиента ---
  const loc = useLocation();
  const hits = useSearchHits();
  const [focusId, setFocusId] = useState<number | null>(null);
  const [pulse, setPulse] = useState(0);
  const [hidden, setHidden] = useState("");
  const hitKey = `${id}|${hits.query}`;
  // Пока грузится другой клиент, в card ещё прошлый — его не трогаем.
  const cardOk = !!card && card.customer.id === Number(id);
  const found = useMemo(() => {
    // Ищем по всему списку клиента (сервер в выпадающем поиске отдаёт только первые 8 товаров).
    if (!card || !cardOk || hidden === hitKey || hits.query.length < 2) return [] as number[];
    return card.items.filter((i) => itemMatches(i, hits.query)).map((i) => i.id);
  }, [card, cardOk, hits, hidden, hitKey]);
  const foundSet = useMemo(() => new Set(found), [found]);
  const latest = useRef({ card, tab });
  latest.current = { card, tab };

  /** Показать товар: открыть вкладку, где он виден, прокрутить к строке; focus — ещё и выделить. */
  const reveal = useCallback((itemId: number, focus: boolean) => {
    const { card: cur, tab: curTab } = latest.current;
    const it = cur?.items.find((i) => i.id === itemId);
    if (!it) return false;
    if (curTab && it.status !== curTab) setTab("");
    if (focus) {
      setFocusId(itemId);
      setPulse((n) => n + 1);
    }
    window.setTimeout(() => document.querySelector(`[data-item="${itemId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
    return true;
  }, []);

  // Новый поиск нашёл товары этого клиента — сразу к первому (и вкладку, где их видно).
  const shownKey = useRef("");
  useEffect(() => {
    if (!card || !found.length || shownKey.current === hitKey) return;
    shownKey.current = hitKey;
    const items = card.items.filter((i) => foundSet.has(i.id));
    if (tab && !items.some((i) => i.status === tab)) setTab("");
    setFocusId(null);
    reveal(items[0].id, false);
  }, [card, found, foundSet, hitKey, tab, reveal]);

  // Клик по товару этого клиента в выпадающем поиске.
  useEffect(() => onFocusItem((itemId) => void reveal(itemId, true)), [reveal]);

  // Пришли из карточки товара («Клиент») — выделить этот товар.
  const stateFocus = (loc.state as { focus?: number } | null)?.focus ?? null;
  const focusedFromState = useRef<string>("");
  useEffect(() => {
    if (!card || !cardOk || !stateFocus || focusedFromState.current === loc.key) return;
    focusedFromState.current = loc.key;
    reveal(stateFocus, true);
  }, [card, cardOk, stateFocus, loc.key, reveal]);

  // Перешли к другому клиенту — прошлое выделение не тащим.
  useEffect(() => setFocusId(null), [id]);

  /** Стрелки «к следующему найденному» — по порядку в списке. */
  function stepFound(dir: 1 | -1) {
    if (!card) return;
    const order = card.items.filter((i) => foundSet.has(i.id) || i.id === focusId).map((i) => i.id);
    if (!order.length) return;
    const at = focusId !== null ? order.indexOf(focusId) : -1;
    const next = order[(at + dir + order.length) % order.length];
    reveal(next, true);
  }
  const foundCount = new Set([...found, ...(focusId !== null ? [focusId] : [])]).size;

  if (error && !card) return <LoadError text={error} onRetry={load} />;
  if (!card)
    return (
      <Page size="wide">
        <div className="ov cd" aria-hidden>
          <section className="ov-card paper cd-hero ghost">
            <span className="sk" style={{ width: 64, height: 64, borderRadius: "50%" }} />
            <span style={{ flex: 1 }}>
              <span className="sk" style={{ width: "30%", height: 18 }} />
              <span className="sk" style={{ width: "46%", height: 10, marginTop: 10 }} />
            </span>
          </section>
          <section className="ov-card paper cd-money ghost">
            {[0, 1, 2, 3].map((k) => (
              <div key={k} className="cd-m">
                <span className="sk" style={{ width: "40%", height: 9 }} />
                <span className="sk" style={{ width: "60%", height: 18, marginTop: 8 }} />
              </div>
            ))}
          </section>
        </div>
      </Page>
    );
  const c = card.customer;
  const t = card.totals;
  const rows = card.items.filter((i) => !tab || i.status === tab);
  const orders = new Set(card.items.map((i) => i.order_id)).size;
  const firstDate = card.items.reduce<string | null>((m, i) => (!m || i.order_date < m ? i.order_date : m), null);
  const paidPct = t.sale ? Math.min(100, Math.round((t.paid / t.sale) * 100)) : 0;

  const orderSums = (() => {
    const m = new Map<string, number>();
    for (const it of card.items) m.set(it.order_date.slice(0, 10), (m.get(it.order_date.slice(0, 10)) ?? 0) + it.sale);
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-14).map(([, v]) => v);
  })();
  const costSale = card.items.filter((i) => i.cost !== null).reduce((a, i) => a + (i.cost ?? 0), 0);
  // Товары по дням заказа — сверху новые.
  const groups = (() => {
    const m = new Map<string, Item[]>();
    for (const it of rows) {
      const k = it.order_date.slice(0, 10);
      const g = m.get(k);
      if (g) g.push(it);
      else m.set(k, [it]);
    }
    return [...m.entries()];
  })();
  const ids = rows.map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((x) => sel.selected.has(x));
  const someOn = ids.some((x) => sel.selected.has(x));

  return (
    <Page size="wide">
      <div className="ov cd">
        <button type="button" className="cd-back" onClick={() => nav("/customers")}>
          <Svg paths={I_BACK} size={14} /> Все клиенты
        </button>

        {/* Профиль: кто это, как связаться, как давно с нами — и действия */}
        <section className="ov-card paper cd-hero">
          <span className="cd-av">{letters(c.name)}</span>
          <div className="cd-id">
            <span className="cd-name">
              <b>{c.name}</b>
              {c.code && <code>код {c.code}</code>}
              {c.phone ? (
                <button type="button" className="cd-phone" onClick={() => navigator.clipboard?.writeText(c.phone).then(() => toast("success", "Телефон скопирован"))} title="Скопировать номер">
                  <Svg paths={CD_IC.phone} size={13} sw={2} />
                  {c.phone}
                </button>
              ) : (
                <span>телефон не указан</span>
              )}
            </span>
            <span className="cd-meta">
              {firstDate && (
                <span className="cd-chip" title="Первый заказ">
                  <Svg paths={[["rect", { x: 3, y: 4, width: 18, height: 18, rx: 2 }], ["path", { d: "M16 2v4M8 2v4M3 10h18" }]]} size={13} sw={2} />
                  с <b>{date(firstDate)}</b>
                </span>
              )}
              {orders > 0 && (
                <span className="cd-chip">
                  <Svg paths={[["path", { d: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" }], ["path", { d: "M3 6h18" }], ["path", { d: "M16 10a4 4 0 0 1-8 0" }]]} size={13} sw={2} />
                  <b>{orders}</b> {plural(orders, "заказ", "заказа", "заказов")}
                </span>
              )}
              {t.items > 0 && (
                <span className="cd-chip">
                  <Svg paths={CD_IC.box} size={13} sw={2} />
                  <b>{t.items}</b> {plural(t.items, "товар", "товара", "товаров")}
                </span>
              )}
            </span>
            {c.comment && <span className="cd-note">«{c.comment}»</span>}
          </div>
          <OrderTimeline items={card.items} />
          <div className="cd-actions">
            {t.debt > 0 && (
              <button type="button" className="cd-btn pay" onClick={() => setPaying(true)}>
                <Svg paths={CD_IC.cash} size={15} sw={1.9} />
                <span className="cd-lg">Принять оплату</span>
                <span className="cd-sm">Оплата</span>
              </button>
            )}
            {t.in_stock > 0 && (
              <button type="button" className="cd-btn" onClick={() => nav(`/issue?customer=${c.id}`)}>
                <Svg paths={[["path", { d: "M20 6 9 17l-5-5" }]]} size={14} sw={2.4} />
                Выдать · {t.in_stock}
              </button>
            )}
            <button type="button" className="cd-btn dark" onClick={() => nav(`/new-order?customer=${c.id}`)}>
              <Svg paths={I_PLUS} size={14} sw={2.4} />
              <span className="cd-lg">Новый заказ</span>
              <span className="cd-sm">Заказ</span>
            </button>
            <MoreMenu onEdit={() => setEditing(true)} onDelete={isAdmin ? () => setDeleting(true) : undefined} />
          </div>
        </section>

        {/* Деньги клиента одной строкой */}
        <section className="ov-card paper cd-money">
          <Metric label="Сумма заказов" icon={CD_IC.bag} value={som(t.sale)} sub={`${orders} ${plural(orders, "заказ", "заказа", "заказов")} · ${t.items} ${plural(t.items, "товар", "товара", "товаров")}`} side={<MiniBars values={orderSums} />} />
          <Metric label="Оплачено" icon={CD_IC.check} value={som(t.paid)} sub={t.sale ? `${paidPct}% от суммы` : "оплат пока нет"} side={t.sale ? <Wave pct={paidPct} label="оплачено" /> : undefined} />
          <Metric
            label="Долг"
            icon={CD_IC.cash}
            value={t.debt > 0 ? som(t.debt) : "нет"}
            tone={t.debt > 0 ? "owe" : "mute"}
            sub={t.debt > 0 ? `${t.unpaid_items} ${plural(t.unpaid_items, "товар", "товара", "товаров")} не оплачено` : "всё оплачено"}
            side={t.sale > 0 ? <DebtCap debt={t.debt} sale={t.sale} /> : undefined}
          />
          <Metric
            label="Прибыль"
            icon={CD_IC.trend}
            value={t.with_cost ? som(t.profit) : "—"}
            tone={t.with_cost && t.profit < 0 ? "owe" : t.with_cost ? "" : "mute"}
            sub={t.with_cost < t.items ? `по ${t.with_cost} из ${t.items} с ценой выкупа` : "сумма − цена выкупа"}
            side={t.with_cost && costSale > 0 ? <ProfitCols cost={costSale} profit={t.profit} /> : undefined}
          />
        </section>

        <div className="cd-tools">
          <SlideTabs<"" | ItemStatus>
            value={tab}
            onChange={setTab}
            options={[
              ["", "Все товары", t.items],
              ["ordered", "Заказаны", t.ordered, "warn"],
              ["in_stock", "На складе", t.in_stock, "ok"],
              ["issued", "Выданы", t.issued, "ink"],
            ]}
          />
          {foundCount > 0 && (
            <div className="cd-found" role="status">
              <Svg paths={I_SEARCH} size={13} />
              <span>
                {focusId !== null && foundCount > 1 ? (
                  <>
                    найдено <b>{[...card.items.filter((i) => foundSet.has(i.id) || i.id === focusId)].findIndex((i) => i.id === focusId) + 1}</b> из <b>{foundCount}</b>
                  </>
                ) : (
                  <>
                    найдено: <b>{foundCount}</b> {plural(foundCount, "товар", "товара", "товаров")}
                  </>
                )}
              </span>
              {foundCount > 1 ? (
                <>
                  <button type="button" onClick={() => stepFound(-1)} title="Предыдущий найденный">
                    <Svg paths={[["path", { d: "m18 15-6-6-6 6" }]]} size={14} sw={2.2} />
                  </button>
                  <button type="button" onClick={() => stepFound(1)} title="Следующий найденный">
                    <Svg paths={[["path", { d: "m6 9 6 6 6-6" }]]} size={14} sw={2.2} />
                  </button>
                </>
              ) : (
                <button type="button" className="wide" onClick={() => stepFound(1)} title="Показать в списке">
                  показать
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setFocusId(null);
                  setHidden(hitKey);
                }}
                title="Снять выделение"
              >
                <Svg paths={I_CLOSE} size={12} sw={2.4} />
              </button>
            </div>
          )}
        </div>

        <section className="ov-card paper cd-items">
          {rows.length === 0 ? (
            <div className="cu2-none">
              <span className="cu2-none-i">
                <Svg paths={CD_IC.box} size={22} sw={1.8} />
              </span>
              <b>Товаров нет</b>
              <small>Нажмите «Новый заказ» вверху</small>
            </div>
          ) : (
            <>
              <div className="cd-th">
                <Tick on={allOn} half={someOn} onToggle={(on) => sel.onSelect(ids, on)} title="Выбрать все" />
                <span>Товар</span>
                <span>Кол-во</span>
                <span>Сумма</span>
                <span>Прибыль</span>
                <span>Оплата</span>
                <span>Статус</span>
              </div>
              {groups.map(([day, list]) => (
                <div key={day} className="cd-grp">
                  <div className="cd-gh">
                    <b>{dayWords(day)}</b>
                    <small>
                      {list.length} {plural(list.length, "товар", "товара", "товаров")} · {som(list.reduce((a, x) => a + x.sale, 0))}
                    </small>
                  </div>
                  {list.map((it) => (
                    <DetailRow
                      key={`${it.id}:${focusId === it.id ? pulse : 0}`}
                      it={it}
                      on={sel.selected.has(it.id)}
                      onToggle={(on) => sel.onSelect([it.id], on)}
                      onOpen={setOpen}
                      found={foundSet.has(it.id)}
                      focus={focusId === it.id}
                    />
                  ))}
                </div>
              ))}
            </>
          )}
        </section>

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
      </div>
    </Page>
  );
}

const CD_IC: Record<"phone" | "cash" | "pen" | "trash" | "box" | "bag" | "check" | "trend", PathDef> = {
  bag: [["path", { d: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" }], ["path", { d: "M3 6h18" }], ["path", { d: "M16 10a4 4 0 0 1-8 0" }]],
  check: [["path", { d: "M22 11.1V12a10 10 0 1 1-5.9-9.1" }], ["path", { d: "m9 11 3 3L22 4" }]],
  trend: [["path", { d: "m22 7-8.5 8.5-5-5L2 17" }], ["path", { d: "M16 7h6v6" }]],
  phone: [["path", { d: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" }]],
  cash: [["rect", { x: 2, y: 6, width: 20, height: 12, rx: 2 }], ["circle", { cx: 12, cy: 12, r: 2.2 }], ["path", { d: "M6 12h.01M18 12h.01" }]],
  pen: [["path", { d: "M12 20h9" }], ["path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" }]],
  trash: [["path", { d: "M3 6h18" }], ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }], ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }]],
  box: [["path", { d: "M21 8 12 3 3 8v8l9 5 9-5V8Z" }], ["path", { d: "m3 8 9 5 9-5" }], ["path", { d: "M12 13v8" }]],
};
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const dayWords = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  return `${x.getDate()} ${MONTHS_GEN[x.getMonth()]}${x.getFullYear() !== new Date().getFullYear() ? ` ${x.getFullYear()}` : ""}`;
};
const STAGE_TEXT: Record<string, string> = { ordered: "Заказан", in_transit: "В пути", in_stock: "На складе", issued: "Выдан" };
const STAGE_DOT: Record<string, string> = { ordered: "warn", in_transit: "info", in_stock: "ok", issued: "" };

const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MON_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Заказы за год по месяцам: столбик — сколько товаров заказано в месяц; текущий месяц тёмный. */
function OrderTimeline({ items }: { items: Item[] }) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, k) => {
    const m = new Date(now.getFullYear(), now.getMonth() - 11 + k, 1);
    return { key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, label: MON_SHORT[m.getMonth()], full: `${MONTHS_NOM[m.getMonth()]} ${m.getFullYear()}`, n: 0, qty: 0, sale: 0, orders: new Set<number>() };
  });
  const at = new Map(months.map((m, k) => [m.key, k]));
  for (const it of items) {
    const k = at.get(it.order_date.slice(0, 7));
    if (k === undefined) continue;
    const m = months[k];
    m.n += 1;
    m.qty += it.qty;
    m.sale += it.sale;
    m.orders.add(it.order_id);
  }
  const max = Math.max(1, ...months.map((m) => m.n));
  const active = months.filter((m) => m.n > 0).length;
  return (
    <div className="cd-tl" aria-label="Заказы за год">
      <span className="cd-tl-h">
        <b>Заказы за год</b>
        <small>{active ? `${active} ${plural(active, "месяц", "месяца", "месяцев")} с заказами` : "заказов не было"}</small>
      </span>
      <div className="cd-tl-bars">
        {months.map((m, k) => (
          <span key={m.key} className={"cd-tl-col" + (k === 11 ? " now" : "")}>
            <i className={m.n ? "" : "zero"} style={{ height: m.n ? Math.round(6 + (m.n / max) * 32) : undefined, animationDelay: `${k * 45}ms` }} />
            <em>{m.label}</em>
            <span className={"cd-tl-tip" + (k < 2 ? " l" : k > 9 ? " r" : "")}>
              <b>{m.full}</b>
              {m.n ? (
                <>
                  <span>
                    <strong>{m.orders.size}</strong> {plural(m.orders.size, "заказ", "заказа", "заказов")} · <strong>{m.n}</strong> {plural(m.n, "товар", "товара", "товаров")}
                  </span>
                  <span>
                    <strong>{m.qty}</strong> шт · <strong>{som(m.sale)}</strong>
                  </span>
                </>
              ) : (
                <span>заказов не было</span>
              )}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** «⋯» — редкие действия с клиентом в выпадающем меню. */
function MoreMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete?: () => void }) {
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
    <div ref={ref} className="cd-more">
      <button type="button" className={"cd-ico" + (open ? " on" : "")} onClick={() => setOpen(!open)} title="Ещё" aria-expanded={open}>
        <Svg paths={[["circle", { cx: 5, cy: 12, r: 1.4 }], ["circle", { cx: 12, cy: 12, r: 1.4 }], ["circle", { cx: 19, cy: 12, r: 1.4 }]]} size={17} sw={2.2} />
      </button>
      {open && (
        <div className="cd-more-m" role="menu">
          <button type="button" role="menuitem" onClick={() => (setOpen(false), onEdit())}>
            <Svg paths={CD_IC.pen} size={15} sw={1.9} />
            Изменить клиента
          </button>
          {onDelete && (
            <button type="button" role="menuitem" className="danger" onClick={() => (setOpen(false), onDelete())}>
              <Svg paths={CD_IC.trash} size={15} sw={1.9} />
              Удалить клиента
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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
      {on ? <Svg paths={[["path", { d: "M20 6 9 17l-5-5" }]]} size={12} sw={3} /> : half ? <Svg paths={[["path", { d: "M6 12h12" }]]} size={12} sw={3} /> : null}
    </span>
  );
}

/** Строка товара клиента: найденное поиском — подсвечено, выбранное из поиска — с рамкой. */
function DetailRow({ it, on, onToggle, onOpen, found, focus }: { it: Item; on: boolean; onToggle: (on: boolean) => void; onOpen: (id: number) => void; found: boolean; focus: boolean }) {
  const st = it.stage ?? it.status;
  const p = profitOf(it);
  const self = (it.comment ?? "").startsWith("Клиент заказывал сам");
  const pay: [string, string] = it.debt <= 0 ? ["ok", "Оплачено"] : it.debt < it.sale ? ["warn", `Долг ${som(it.debt)}`] : ["bad", "Не оплачено"];
  const when =
    it.status === "issued" && it.issued_at
      ? `выдан ${shortDateTime(it.issued_at)}`
      : it.arrived_at
        ? `пришёл ${shortDateTime(it.arrived_at)}`
        : st === "in_transit" && it.transit_shipped_at
          ? `отправлен ${shortDateTime(it.transit_shipped_at).slice(0, 5)}`
          : "";
  return (
    <div data-item={it.id} className={"cd-r" + (on ? " on" : "") + (found ? " found" : "") + (focus ? " focus" : "")} onClick={() => onOpen(it.id)} title="Открыть карточку товара">
      <Tick on={on} onToggle={onToggle} />
      <span className="wx-li">
        <b>
          {it.name || "Название неизвестно"}
          {self && <em className="cd-self">свой заказ</em>}
        </b>
        <small>{it.code || "без кода"}</small>
      </span>
      <span className="wx-lq">
        {it.qty} <small>шт</small>
      </span>
      <span className="wx-ls">{it.sale > 0 ? som(it.sale) : "—"}</span>
      <span className="bx-mk">
        {p === null ? (
          <small>—</small>
        ) : (
          <>
            <b className={p < 0 ? "neg" : ""}>{`${p > 0 ? "+" : ""}${som(p)}`}</b>
            <small>из {som(it.cost)}</small>
          </>
        )}
      </span>
      <span>
        {it.sale <= 0 ? (
          <span className="cd-w">
            <b>{it.issue_weight_kg ? `${num(it.issue_weight_kg)} кг` : "по весу"}</b>
            <small>{it.issue_weight_kg ? "вес при выдаче" : "оплата за вес"}</small>
          </span>
        ) : (
          <span className={"od-pay " + pay[0]}>{pay[1]}</span>
        )}
      </span>
      <span className="cd-st">
        <span className={"rx-pill-st " + (STAGE_DOT[st] ?? "")}>{STAGE_TEXT[st] ?? st}</span>
        {when && <small>{when}</small>}
      </span>
    </div>
  );
}

/** Мини-график сумм по заказам (последние 14 дней заказа): столбики, последний — тёмный. */
function MiniBars({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 7;
  const gap = 3;
  const W = values.length * (w + gap) - gap;
  return (
    <svg className="cd-bars" width={W} height={44} viewBox={`0 0 ${W} 44`} aria-hidden>
      {values.map((v, k) => {
        const h = Math.max(3, (v / max) * 42);
        return <rect key={k} x={k * (w + gap)} y={44 - h} width={w} height={h} rx={2.5} className={k === values.length - 1 ? "last" : ""} style={{ animationDelay: `${k * 40}ms` }} />;
      })}
    </svg>
  );
}

/** Долг — «столбик» суммы заказов: снизу оплаченное (тёмное), сверху долг (красный); рядом доля долга. */
function DebtCap({ debt, sale }: { debt: number; sale: number }) {
  const p = sale > 0 ? Math.min(100, Math.round((Math.max(0, debt) / sale) * 100)) : 0;
  // 10 клеток по 10%: красные — доля долга (хотя бы одна, если долг есть).
  const red = debt > 0 ? Math.max(1, Math.round(p / 10)) : 0;
  return (
    <span className={"cd-cap" + (debt > 0 ? " owe" : "")} title={debt > 0 ? `${p}% суммы заказов не оплачено` : "всё оплачено"}>
      <span className="cd-waf">
        {Array.from({ length: 10 }, (_, k) => (
          <i key={k} className={k >= 10 - red ? "d" : ""} style={{ animationDelay: `${k * 35}ms` }} />
        ))}
      </span>
      <span className="cd-cap-l">
        <b>{debt > 0 ? `${p}%` : "0%"}</b>
        <small>{debt > 0 ? "в долг" : "долга"}</small>
      </span>
    </span>
  );
}

/** Прибыль — два столбика: цена выкупа и сумма; разница сверху — наценка в процентах. */
function ProfitCols({ cost, profit }: { cost: number; profit: number }) {
  const sale = cost + profit;
  const max = Math.max(cost, sale, 1);
  const pct = cost > 0 ? Math.round((profit / cost) * 100) : 0;
  return (
    <span className="cd-pc" title={`цена выкупа ${som(cost)} → сумма ${som(sale)}`}>
      <span className="cd-pc-cols">
        <i className="c" style={{ height: `${Math.max(8, (cost / max) * 100)}%` }} />
        <i className={"s" + (profit < 0 ? " neg" : "")} style={{ height: `${Math.max(8, (sale / max) * 100)}%` }} />
      </span>
      <span className="cd-cap-l">
        <b className={profit < 0 ? "neg" : ""}>{`${pct > 0 ? "+" : ""}${pct}%`}</b>
        <small>наценка</small>
      </span>
    </span>
  );
}

/** Ячейка денег клиента: иконка и подпись, крупная сумма, пояснение; справа — мини-график. */
function Metric({ label, value, sub, tone, icon, side }: { label: string; value: string; sub?: string; tone?: string; icon: PathDef; side?: ReactNode }) {
  return (
    <div className={"cd-m" + (tone ? ` ${tone}` : "")}>
      <span className="cd-m-t">
        <small>
          <i>
            <Svg paths={icon} size={13} sw={2} />
          </i>
          {label}
        </small>
        <b>
          <CountUp text={value} />
        </b>
        {sub && <em>{sub}</em>}
      </span>
      {side && <span className="cd-m-side">{side}</span>}
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
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setError("");
    if (!f.name.trim()) return setError("Укажите имя клиента");
    setBusy(true);
    try {
      onSaved(customer ? await updateCustomer(customer.id, f) : await createCustomer(f));
    } catch (e) {
      setError(apiError(e));
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={customer ? "Изменить клиента" : "Новый клиент"}
      subtitle={customer ? "Имя, телефон и заметки — видны во всех заказах клиента" : "Достаточно имени — остальное можно добавить позже"}
      icon={<Svg paths={I_USER} size={18} />}
      onClose={onClose}
      width={480}
      footer={
        <>
          <ModalCancel>Отмена</ModalCancel>
          <HButton onClick={save} disabled={busy} s={btnPrimary + ";min-width:130px"} hover="background:var(--accent-hover)">
            {busy ? "Сохраняю…" : customer ? "Сохранить" : "Создать клиента"}
          </HButton>
        </>
      }
    >
      <form
        className="mf-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) save();
        }}
      >
        {/* Как клиент будет выглядеть в списках — меняется по мере ввода */}
        <div className="mf-card">
          <Avatar name={f.name.trim() || "?"} size={44} />
          <span style={css("min-width:0")}>
            <span style={mix("display:block;font-size:14.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: f.name.trim() ? "var(--text)" : "var(--text-4)" })}>
              {f.name.trim() || "Имя клиента"}
            </span>
            <span style={css("display:block;font-size:12.5px;color:var(--text-3);font-variant-numeric:tabular-nums")}>
              {f.phone || "телефон не указан"}
              {f.code.trim() && <> · код {f.code.trim()}</>}
            </span>
          </span>
        </div>
        <label>
          <FieldLabel>Имя</FieldLabel>
          <input autoFocus value={f.name} onChange={set("name")} placeholder="например, Айгерим Садыкова" style={css(inputStyle)} />
        </label>
        <div className="mf-grid2">
          <label>
            <FieldLabel>Телефон</FieldLabel>
            <PhoneInput value={f.phone} onChange={(phone) => setF((x) => ({ ...x, phone }))} />
          </label>
          <label>
            <FieldLabel>Код клиента</FieldLabel>
            <input value={f.code} onChange={set("code")} placeholder="необязательно" style={css(inputStyle + ";" + MONO)} />
          </label>
        </div>
        <label>
          <FieldLabel>Комментарий</FieldLabel>
          <textarea value={f.comment} onChange={set("comment")} rows={2} placeholder="заметка: город, как связаться, особенности" style={css(inputStyle + ";height:auto;padding:9px 12px;resize:vertical;line-height:1.45")} />
        </label>
        <ModalError text={error} />
        <button type="submit" hidden />
      </form>
    </ModalShell>
  );
}

const PAY_METHODS = METHOD_OPTIONS;

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
  const [busy, setBusy] = useState(false);
  const a = parseMoney(amount);
  const valid = a !== null && !Number.isNaN(a) && a > 0;
  const left = valid ? debt - a : debt;
  // Сервер не принимает сумму больше долга — предупреждаем сразу.
  const over = valid && a > debt + 0.001;
  const half = Math.round(debt / 2);

  async function pay() {
    setError("");
    if (!valid) return setError("Укажите сумму");
    if (over) return setError(`Сумма больше долга (${som(debt)})`);
    setBusy(true);
    try {
      await payCustomer(customer.id, { amount: a, method });
      onPaid(a);
    } catch (e) {
      setError(apiError(e));
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Принять оплату"
      subtitle={
        <>
          <span style={css("color:var(--text-2)")}>{customer.name}</span>
          {customer.phone && <span style={css("font-variant-numeric:tabular-nums")}>{customer.phone}</span>}
        </>
      }
      icon={<span style={css("font-size:17px;font-weight:500")}>с</span>}
      tone="green"
      onClose={onClose}
      width={460}
      footer={
        <>
          <ModalCancel>Отмена</ModalCancel>
          <HButton onClick={pay} disabled={busy || !valid || over} s={btnPrimary + ";min-width:150px"} hover="background:var(--accent-hover)">
            {busy ? "Принимаю…" : valid ? `Принять ${som(a)}` : "Принять"}
          </HButton>
        </>
      }
    >
      <div className="mf-body">
        <div className="mf-card" style={css("justify-content:space-between")}>
          <span style={css("font-size:12.5px;color:var(--text-3)")}>Долг клиента</span>
          <span style={mix("font-size:20px;font-weight:500;font-variant-numeric:tabular-nums", { color: debt > 0 ? "var(--amber)" : "var(--green)" })}>{som(debt)}</span>
        </div>
        <label>
          <FieldLabel>Сумма оплаты</FieldLabel>
          <MoneyInput value={amount} onChange={setAmount} big autoFocus onEnter={pay} />
        </label>
        {debt > 0 && (
          <div className="mf-chips">
            <HButton onClick={() => setAmount(String(debt))} className={"mf-chip" + (a === debt ? " on" : "")} s="" hover="">
              весь долг · {som(debt)}
            </HButton>
            {half > 0 && half !== debt && (
              <HButton onClick={() => setAmount(String(half))} className={"mf-chip" + (a === half ? " on" : "")} s="" hover="">
                половина · {som(half)}
              </HButton>
            )}
          </div>
        )}
        <div>
          <FieldLabel>Способ оплаты</FieldLabel>
          <div className="mf-seg" role="radiogroup" aria-label="Способ оплаты">
            {PAY_METHODS.map((m) => (
              <button key={m.value} type="button" role="radio" aria-checked={method === m.value} className={method === m.value ? "on" : ""} onClick={() => setMethod(m.value)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mf-total">
          <span>{over ? "Больше долга на" : left > 0 ? "Останется долг" : "Долг будет закрыт"}</span>
          <b style={mix("font-weight:500;font-variant-numeric:tabular-nums", { color: over ? "var(--danger)" : left > 0 ? "var(--amber)" : "var(--green)" })}>{over || left > 0 ? som(Math.abs(left)) : "✓"}</b>
        </div>
        <div className="mf-hint" style={css("margin-top:-6px")}>
          Сумма распределится по неоплаченным товарам, начиная с самых старых.
        </div>
        <ModalError text={error} />
      </div>
    </ModalShell>
  );
}
