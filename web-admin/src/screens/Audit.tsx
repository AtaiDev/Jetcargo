/**
 * Журнал действий: кто, что и когда сделал — человеческими фразами, по дням.
 * Только администратор. Названия товаров, клиентов и партий подставляет сервер.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { listAudit, listUsers, type AuditCat, type AuditEntry, type User } from "../api/domain";
import { Empty, PeriodPicker, periodOf, type Period } from "../components/cargo";
import Select from "../components/Select";
import { css, mix } from "../design/css";
import { I_TRASH, Icon, Svg } from "../design/icons";
import { MONO, PANEL, Page, SearchInput, THEAD } from "../design/table";
import { HButton, ModalError, SkeletonRows, btnGhost } from "../design/ui";
import { STATUS_LABEL, date, som } from "../lib/cargo";
import { openItem, useDebounced } from "../lib/events";

const PAGE = 50;

// --- Разделы --------------------------------------------------------------------------------

const CATS: { key: AuditCat | ""; label: string; fg: string; bg: string; icon: ReactNode }[] = [
  { key: "", label: "Все", fg: "var(--text-2)", bg: "var(--hover)", icon: null },
  { key: "item", label: "Заказы и товары", fg: "var(--amber)", bg: "var(--amber-tint)", icon: <Icon name="orders" size={15} /> },
  { key: "receive", label: "Приём", fg: "var(--accent-strong)", bg: "var(--accent-tint)", icon: <Icon name="receive" size={15} /> },
  { key: "issue", label: "Выдача", fg: "var(--violet)", bg: "var(--violet-tint)", icon: <Icon name="issue" size={15} /> },
  { key: "payment", label: "Оплаты", fg: "var(--green)", bg: "var(--green-tint)", icon: <span style={css(MONO + ";font-weight:700;font-size:13px")}>с</span> },
  { key: "customer", label: "Клиенты", fg: "var(--text-2)", bg: "var(--hover)", icon: <Icon name="customers" size={15} /> },
  { key: "batch", label: "Партии", fg: "var(--text-2)", bg: "var(--hover)", icon: <Icon name="batches" size={15} /> },
  { key: "import", label: "Импорт", fg: "var(--text-2)", bg: "var(--hover)", icon: <Icon name="import" size={15} /> },
  { key: "user", label: "Сотрудники", fg: "var(--text-2)", bg: "var(--hover)", icon: <Icon name="staff" size={15} /> },
  { key: "delete", label: "Удаления", fg: "var(--danger)", bg: "var(--danger-tint)", icon: <Svg paths={I_TRASH} size={14} /> },
];
/** Короткие подписи разделов для колонки таблицы. */
const SHORT: Record<AuditCat, string> = {
  item: "Товары",
  receive: "Приём",
  issue: "Выдача",
  payment: "Оплата",
  customer: "Клиенты",
  batch: "Партии",
  import: "Импорт",
  user: "Сотрудники",
  delete: "Удаление",
};
/** Колонки: время · раздел · сотрудник · действие · объект · подробности. */
const GRID = "74px 128px 130px minmax(0,1.15fr) minmax(0,1.3fr) minmax(0,1.5fr)";

const CAT = Object.fromEntries(CATS.map((c) => [c.key, c])) as Record<AuditCat | "", (typeof CATS)[number]>;

// --- Экран ----------------------------------------------------------------------------------

export default function Audit({ isDesktop = true }: { isDesktop?: boolean }) {
  const [period, setPeriod] = useState<Period>(() => periodOf("month"));
  const [cat, setCat] = useState<AuditCat | "">("");
  const [userId, setUserId] = useState("");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);
  const [users, setUsers] = useState<User[]>([]);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<AuditCat, number>>>({});
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  const params = useMemo(
    () => ({
      cat,
      user_id: Number(userId) || undefined,
      q: q || undefined,
      since: new Date(`${period.date_from}T00:00:00`).toISOString(),
      until: nextDayIso(period.date_to),
      limit: PAGE,
    }),
    [cat, userId, q, period]
  );

  const load = useCallback(() => {
    setRows(null);
    listAudit({ ...params, offset: 0 })
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
        setCounts(r.counts);
        setError("");
      })
      .catch((e) => {
        setRows([]);
        setError(apiError(e, "Не удалось загрузить журнал"));
      });
  }, [params]);
  useEffect(load, [load]);

  async function more() {
    if (!rows) return;
    setLoadingMore(true);
    try {
      const r = await listAudit({ ...params, offset: rows.length });
      setRows([...rows, ...r.rows]);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const all = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
  const days = useMemo(() => groupByDay(rows ?? []), [rows]);

  return (
    <Page size="wide">
      {/* Фильтры */}
      <div style={css(PANEL + ";padding:12px 14px;margin-bottom:12px;display:flex;flex-direction:column;gap:12px")}>
        <div style={css("display:flex;flex-wrap:wrap;gap:10px;align-items:center")}>
          <PeriodPicker value={period} onChange={setPeriod} />
          <div style={css("flex:1")} />
          <Select
            value={userId}
            onChange={setUserId}
            width={190}
            height={34}
            fontSize={12.5}
            highlight={!!userId}
            ariaLabel="Сотрудник"
            options={[{ value: "", label: "Все сотрудники" }, ...users.map((u) => ({ value: String(u.id), label: u.full_name || u.login, hint: "@" + u.login }))]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Товар, клиент, код…" width={isDesktop ? 240 : 400} />
        </div>
        <div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
          {CATS.map((c) => {
            const n = c.key ? (counts[c.key] ?? 0) : all;
            if (c.key && !n && cat !== c.key) return null;
            const on = cat === c.key;
            return (
              <HButton
                key={c.key || "all"}
                onClick={() => setCat(c.key)}
                s={mix("display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:9px;font-size:12.5px;cursor:pointer;transition:all .12s", {
                  border: `1px solid ${on ? c.fg : "var(--border)"}`,
                  background: on ? c.bg : "var(--surface)",
                  color: on ? c.fg : "var(--text-2)",
                  fontWeight: on ? 600 : 500,
                })}
                hover={on ? undefined : "border-color:var(--border-strong)"}
              >
                {c.icon && <span style={mix("display:flex", { color: c.fg })}>{c.icon}</span>}
                {c.label}
                <span style={css(MONO + ";font-size:11px;opacity:.7")}>{n}</span>
              </HButton>
            );
          })}
        </div>
      </div>

      {error && <ModalError text={error} />}

      {/* Лента */}
      {!rows ? (
        <SkeletonRows rows={6} />
      ) : rows.length === 0 ? (
        <div style={css(PANEL)}>
          <Empty
            icon="audit"
            title="За этот период записей нет"
            text={q || cat || userId ? "Измените фильтры или период" : "Здесь появляются заказы, приёмы, выдачи, оплаты, импорты и удаления"}
          />
        </div>
      ) : (
        <div style={css(PANEL)}>
          {isDesktop && (
            <div style={mix(THEAD, { gridTemplateColumns: GRID })}>
              {["Время", "Раздел", "Сотрудник", "Действие", "Объект", "Подробности"].map((h) => (
                <div key={h} style={css("padding:9px 10px")}>
                  {h}
                </div>
              ))}
            </div>
          )}
          {days.map(([day, list]) => (
            <section key={day}>
              <div
                style={css(
                  "display:flex;align-items:center;gap:10px;padding:7px 16px;background:var(--accent-tint2);border-bottom:1px solid var(--border-2)"
                )}
              >
                <span style={css("width:6px;height:6px;border-radius:50%;background:var(--accent)")} />
                <span style={css("font-size:12.5px;font-weight:700;color:var(--accent-strong)")}>{dayTitle(day)}</span>
                <span style={css("font-size:11.5px;color:var(--text-4)")}>
                  {list.length} {plural(list.length, "запись", "записи", "записей")}
                </span>
              </div>
              {list.map((a) => (isDesktop ? <Row key={a.id} a={a} /> : <Entry key={a.id} a={a} />))}
            </section>
          ))}
          <div style={css("display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--border-2);font-size:12px;color:var(--text-3)")}>
            <span>
              Показано <b style={css(MONO + ";color:var(--text)")}>{rows.length}</b> из <b style={css(MONO + ";color:var(--text)")}>{total}</b>
            </span>
            <div style={css("flex:1")} />
            {rows.length < total && (
              <HButton onClick={more} disabled={loadingMore} s={btnGhost + ";height:32px;font-size:12.5px"} hover="border-color:var(--accent)">
                {loadingMore ? "Загрузка…" : `Показать ещё ${Math.min(PAGE, total - rows.length)}`}
              </HButton>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

// --- Запись -----------------------------------------------------------------------------------

/** Строка таблицы (компьютер): всё в одну строку, длинное обрезается с подсказкой. */
function Row({ a }: { a: AuditEntry }) {
  const nav = useNavigate();
  const c = CAT[a.cat] ?? CAT[""];
  const d = describe(a, nav);
  const who = a.user_name || a.user_login || "Система";
  const cell = "padding:7px 10px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  return (
    <div className="audit-row" style={mix("display:grid;align-items:center;min-height:42px;border-bottom:1px solid var(--hover);font-size:13px", { gridTemplateColumns: GRID })}>
      <span style={css(cell + ";" + MONO + ";font-size:12px;color:var(--text-3);padding-left:16px")}>{hhmm(a.created_at)}</span>
      <span style={css(cell)}>
        <span style={mix("display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 7px;border-radius:7px;font-size:12px;font-weight:600", { background: c.bg, color: c.fg })}>
          <span style={css("display:flex")}>{c.icon ?? <Icon name="audit" size={14} />}</span>
          {SHORT[a.cat] ?? a.cat}
        </span>
      </span>
      <span style={css(cell + ";display:flex;align-items:center;gap:7px")} title={a.user_login ? "@" + a.user_login : undefined}>
        <span style={css("width:22px;height:22px;border-radius:50%;background:var(--hover);color:var(--text-2);display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;flex:none")}>
          {who.slice(0, 1).toUpperCase()}
        </span>
        <span style={css("overflow:hidden;text-overflow:ellipsis;font-weight:500")}>{who}</span>
      </span>
      <span style={css(cell + ";color:var(--text-2)")} title={d.verb}>
        {d.verb}
      </span>
      <span style={css(cell)}>
        {d.obj ?? <span style={css("color:var(--text-5)")}>—</span>}
        {d.sub && <span style={css("color:var(--text-4)")}> · {d.sub}</span>}
      </span>
      <span style={css(cell + ";display:flex;gap:6px;padding-right:16px")}>{d.details ?? <span style={css("color:var(--text-5)")}>—</span>}</span>
    </div>
  );
}

/** Запись на телефоне: время, иконка раздела и фраза. */

function Entry({ a }: { a: AuditEntry }) {
  const nav = useNavigate();
  const c = CAT[a.cat] ?? CAT[""];
  const d = describe(a, nav);
  return (
    <div style={css("display:grid;grid-template-columns:46px 30px minmax(0,1fr);gap:12px;align-items:start;padding:8px 16px;border-bottom:1px solid var(--hover)")}>
      <span style={css(MONO + ";font-size:12px;color:var(--text-3);padding-top:6px")}>{hhmm(a.created_at)}</span>
      <span style={mix("width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center", { background: c.bg, color: c.fg })}>
        {c.icon ?? <Icon name="audit" size={15} />}
      </span>
      <div style={css("min-width:0;padding-top:3px")}>
        <div style={css("font-size:13.5px;line-height:1.5;color:var(--text-2)")}>
          <b style={css("color:var(--text);font-weight:600")}>{a.user_name || a.user_login || "Система"}</b> {d.verb}
          {d.obj && (
            <>
              {a.entity === "order" ? " — " : " "}
              {d.obj}
            </>
          )}
          {d.sub && <span style={css("color:var(--text-4)")}> · {d.sub}</span>}
        </div>
        {d.details && <div style={css("display:flex;flex-wrap:wrap;gap:6px;margin-top:5px")}>{d.details}</div>}
      </div>
    </div>
  );
}

/** Ссылка на объект записи (жирная, кликабельная, если объект ещё существует). */
function Obj({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  if (!onClick) return <b style={css("color:var(--text);font-weight:600")}>{children}</b>;
  return (
    <HButton onClick={onClick} s="border:none;background:transparent;padding:0;font:inherit;font-weight:600;color:var(--text);cursor:pointer;text-align:left" hover="color:var(--accent);text-decoration:underline">
      {children}
    </HButton>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: "danger" | "green" }) {
  return (
    <span
      style={mix("display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 9px;border-radius:7px;border:1px solid var(--border-2);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", {
        background: tone === "danger" ? "var(--danger-tint)" : tone === "green" ? "var(--green-tint)" : "var(--surface-2)",
        color: tone === "danger" ? "var(--danger)" : tone === "green" ? "var(--green)" : "var(--text-2)",
      })}
    >
      {children}
    </span>
  );
}

/** Изменение поля: «Код: — → YT07…». */
function Diff({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <Chip>
      <span style={css("color:var(--text-4)")}>{label}:</span>
      <span style={css("text-decoration:line-through;color:var(--text-4)")}>{from}</span>
      <span style={css("color:var(--text-4)")}>→</span>
      <b style={css("font-weight:600;color:var(--text)")}>{to}</b>
    </Chip>
  );
}

// --- Текст записи ---------------------------------------------------------------------------

type Described = { verb: string; obj?: ReactNode; sub?: string; details?: ReactNode };

const ITEM_FIELDS: Record<string, string> = {
  name: "Название",
  code: "Код",
  qty: "Кол-во",
  price: "Сумма",
  price_cny: "Цена ¥",
  real_price: "Реальная цена",
  cost: "Выкуп",
  split_with: "Разделить с",
  comment: "Комментарий",
  order_date: "Дата заказа",
  customer_id: "Клиент",
  status: "Статус",
  phone: "Телефон",
};
const BATCH_FIELDS: Record<string, string> = {
  name: "название",
  status: "статус",
  comment: "комментарий",
  buy_amount: "выкуп веса",
  buy_cur: "валюта выкупа",
  delivery_usd: "доставка",
  delivery_cur: "валюта доставки",
  client_amount: "вес клиентам",
  client_cur: "валюта веса",
  usd_rate: "курс $",
  weight_buy_kg: "вес выкупа",
  rate_buy_usd: "ставка выкупа",
  weight_client_kg: "вес клиентам, кг",
  rate_client_usd: "ставка клиентам",
};
const USER_FIELDS: Record<string, string> = { full_name: "имя", role: "роль", is_active: "доступ", password: "пароль" };

function parse(v: string | null): unknown {
  if (v === null || v === "") return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function fmt(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (["price", "real_price", "cost"].includes(key)) return som(Number(v));
  if (key === "price_cny") return `¥${v}`;
  if (key === "status") return STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? String(v);
  if (key === "order_date") return date(String(v));
  return String(v);
}

const n = (count: number, one = "товар", few = "товара", many = "товаров") => `${count} ${plural(count, one, few, many)}`;

function describe(a: AuditEntry, nav: (to: string) => void): Described {
  const oldV = parse(a.old_value);
  const newV = parse(a.new_value) as Record<string, unknown> | string | number | null;
  const obj = (newV && typeof newV === "object" ? newV : {}) as Record<string, unknown>;
  const ids = Array.isArray(obj.ids) ? obj.ids.length : Array.isArray(obj.items) ? obj.items.length : 0;
  const alive = a.action !== "delete";
  const item = a.item_name ? <Obj onClick={alive && a.entity_id ? () => openItem(a.entity_id!) : undefined}>{a.item_name}</Obj> : null;
  const itemSub = a.item_customer ?? undefined;
  const customer = (name: string | null, id: number | null) =>
    name ? <Obj onClick={alive && id ? () => nav(`/customers/${id}`) : undefined}>{name}</Obj> : null;
  const batch = a.batch_name ? <Obj onClick={alive && a.entity_id ? () => nav(`/batches/${a.entity_id}`) : undefined}>{a.batch_name}</Obj> : null;
  const fields = (map: Record<string, string>) =>
    String(newV ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((k) => <Chip key={k}>{map[k] ?? k}</Chip>);

  switch (a.action) {
    case "scan":
      return { verb: "принял на склад", obj: item, sub: itemSub, details: typeof newV === "string" ? <Chip><span style={css(MONO)}>{newV}</span></Chip> : undefined };

    case "issue":
      if (a.entity === "customer") return { verb: `выдал ${n(ids)} клиенту`, obj: customer(a.customer_name, a.entity_id) };
      return { verb: `выдал ${n(ids)}`, sub: "массово со склада" };

    case "status":
      if (a.entity_id)
        return {
          verb: "сменил статус",
          obj: item,
          sub: itemSub,
          details: <Diff label="Статус" from={fmt("status", oldV)} to={fmt("status", newV)} />,
        };
      return { verb: `перевёл ${n(ids)} в «${fmt("status", obj.status)}»` };

    case "payment": {
      if (a.entity === "customer") {
        const sum = Array.isArray(newV) ? (newV as { amount: number }[]).reduce((s, x) => s + (x.amount ?? 0), 0) : 0;
        return { verb: `принял оплату ${som(sum)} от клиента`, obj: customer(a.customer_name, a.entity_id), details: Array.isArray(newV) ? <Chip>распределено на {n(newV.length)}</Chip> : undefined };
      }
      if (a.entity_id) return { verb: `принял оплату ${som(Number(newV))} за`, obj: item, sub: itemSub };
      return { verb: `принял оплату ${som(Number(obj.amount))} за ${n(ids)}` };
    }
    case "payment_cancel":
      return { verb: `отменил оплату ${som(Number(oldV))} за`, obj: item, sub: itemSub };
    case "payment_fix":
      return {
        verb: "исправил оплаты из Excel",
        details: (
          <>
            {typeof oldV === "string" && <Chip>{oldV}</Chip>}
            {typeof obj.payments === "number" && <Chip>оплат: {obj.payments}</Chip>}
          </>
        ),
      };

    case "create":
      if (a.entity === "item") return { verb: "добавил товар", obj: item ?? <Obj>{String(newV ?? "")}</Obj>, sub: itemSub };
      if (a.entity === "order")
        return {
          verb: `создал заказ: ${n(Number(obj.items ?? 0))} на ${som(Number(obj.sum ?? 0))}`,
          obj: customer(a.order_customer, a.order_customer_id),
        };
      if (a.entity === "customer") return { verb: "добавил клиента", obj: customer(a.customer_name ?? String(newV ?? ""), a.entity_id) };
      if (a.entity === "batch") return { verb: "создал партию", obj: batch ?? <Obj>{String(newV ?? "")}</Obj> };
      if (a.entity === "user") return { verb: "добавил сотрудника", obj: <Obj>@{a.target_login ?? String(newV ?? "")}</Obj> };
      break;

    case "update":
      if (a.entity === "item") {
        const before = (oldV && typeof oldV === "object" ? oldV : {}) as Record<string, unknown>;
        const diffs = Object.keys(before)
          .filter((k) => k in obj && ITEM_FIELDS[k] && fmt(k, before[k]) !== fmt(k, obj[k]))
          .map((k) => <Diff key={k} label={ITEM_FIELDS[k]} from={fmt(k, before[k])} to={fmt(k, obj[k])} />);
        return { verb: "изменил товар", obj: item, sub: itemSub, details: diffs.length ? diffs : undefined };
      }
      if (a.entity === "customer") {
        const before = (oldV && typeof oldV === "object" ? oldV : {}) as Record<string, unknown>;
        const diffs = Object.keys(obj)
          .filter((k) => ITEM_FIELDS[k] && fmt(k, before[k]) !== fmt(k, obj[k]))
          .map((k) => <Diff key={k} label={ITEM_FIELDS[k] === "Название" ? "Имя" : ITEM_FIELDS[k]} from={fmt(k, before[k])} to={fmt(k, obj[k])} />);
        return { verb: "изменил клиента", obj: customer(a.customer_name, a.entity_id), details: diffs.length ? diffs : undefined };
      }
      if (a.entity === "batch") return { verb: "изменил партию", obj: batch ?? <Obj>{String(oldV ?? "")}</Obj>, details: fields(BATCH_FIELDS) };
      if (a.entity === "user") return { verb: "изменил сотрудника", obj: <Obj>@{a.target_login ?? "—"}</Obj>, details: fields(USER_FIELDS) };
      break;

    case "delete": {
      const what = { item: "товар", customer: "клиента", batch: "партию", user: "сотрудника" }[a.entity] ?? a.entity;
      return { verb: `удалил ${what}`, obj: <Obj>{String(oldV ?? a.item_name ?? a.customer_name ?? a.batch_name ?? "")}</Obj> };
    }

    case "batch_add":
      return { verb: `добавил ${n(ids)} в партию`, obj: batch };
    case "batch_remove":
      return { verb: `убрал ${n(ids)} из партии`, obj: batch };

    case "import":
      return {
        verb: "импортировал Excel",
        obj: <Obj>{String(obj.file ?? "")}</Obj>,
        details: (
          <>
            {Number(obj.new) > 0 && <Chip tone="green">новых: {String(obj.new)}</Chip>}
            {Number(obj.update) > 0 && <Chip>обновлено: {String(obj.update)}</Chip>}
            {Number(obj.duplicate) > 0 && <Chip>дублей: {String(obj.duplicate)}</Chip>}
            {Number(obj.error) > 0 && <Chip tone="danger">ошибок: {String(obj.error)}</Chip>}
          </>
        ),
      };
    case "import_undo":
      return { verb: `отменил импорт №${a.entity_id ?? ""}` };
  }
  return { verb: a.action, obj: <Obj>{a.entity}</Obj> };
}

// --- Даты -----------------------------------------------------------------------------------

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

function nextDayIso(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function groupByDay(rows: AuditEntry[]): [string, AuditEntry[]][] {
  const m = new Map<string, AuditEntry[]>();
  for (const r of rows) {
    const k = localDay(r.created_at);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return [...m.entries()];
}

function dayTitle(day: string): string {
  const today = localDay(new Date().toISOString());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const label = new Date(`${day}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
  if (day === today) return `Сегодня · ${label}`;
  if (day === localDay(y.toISOString())) return `Вчера · ${label}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function plural(count: number, one: string, few: string, many: string) {
  const a = count % 10;
  const b = count % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
