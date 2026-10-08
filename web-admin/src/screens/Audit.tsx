/**
 * Журнал действий — лента событий: кто, что и когда сделал, человеческими фразами, по дням.
 *
 *  - слева панель фильтров: период, поиск, разделы (с числом и долей) и сотрудники;
 *  - справа лента по дням: время, цветная точка раздела на линии и фраза; одинаковые действия
 *    подряд (тот же сотрудник, то же действие с тем же объектом) сворачиваются в одну запись «×N».
 * Только администратор. Названия товаров, клиентов и партий подставляет сервер.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { listAudit, listUsers, type AuditCat, type AuditEntry, type User } from "../api/domain";
import { Empty, PeriodPicker, periodOf, type Period } from "../components/cargo";
import { css, mix } from "../design/css";
import { I_SEARCH, I_TRASH, Icon, Svg } from "../design/icons";
import { MONO, Page } from "../design/table";
import { HButton, ModalError, SkeletonRows } from "../design/ui";
import { STATUS_LABEL, date, som } from "../lib/cargo";
import { openItem, useDebounced } from "../lib/events";

const PAGE = 50;
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";

// --- Разделы --------------------------------------------------------------------------------

const CATS: { key: AuditCat | ""; label: string; fg: string; bg: string; dot: string; icon: ReactNode }[] = [
  { key: "", label: "Все действия", fg: "var(--text-2)", bg: "var(--hover)", dot: "var(--text-4)", icon: <Icon name="audit" size={15} /> },
  { key: "item", label: "Заказы и товары", fg: "var(--amber)", bg: "var(--amber-tint)", dot: "var(--amber-dot)", icon: <Icon name="orders" size={15} /> },
  { key: "receive", label: "Приём", fg: "var(--accent-strong)", bg: "var(--accent-tint)", dot: "var(--accent)", icon: <Icon name="receive" size={15} /> },
  { key: "issue", label: "Выдача", fg: "var(--violet)", bg: "var(--violet-tint)", dot: "var(--violet-dot)", icon: <Icon name="issue" size={15} /> },
  { key: "payment", label: "Оплаты", fg: "var(--green)", bg: "var(--green-tint)", dot: "var(--green-dot)", icon: <span style={css("font-weight:600;font-size:13px;line-height:1")}>с</span> },
  { key: "customer", label: "Клиенты", fg: "#0E7490", bg: "color-mix(in srgb,#06B6D4 14%,var(--surface))", dot: "#06B6D4", icon: <Icon name="customers" size={15} /> },
  { key: "batch", label: "Партии", fg: "#4338CA", bg: "color-mix(in srgb,#6366F1 14%,var(--surface))", dot: "#6366F1", icon: <Icon name="batches" size={15} /> },
  { key: "import", label: "Импорт", fg: "#15803D", bg: "color-mix(in srgb,#22C55E 14%,var(--surface))", dot: "#22C55E", icon: <Icon name="import" size={15} /> },
  { key: "user", label: "Сотрудники", fg: "#BE185D", bg: "color-mix(in srgb,#EC4899 13%,var(--surface))", dot: "#EC4899", icon: <Icon name="staff" size={15} /> },
  { key: "delete", label: "Удаления", fg: "var(--danger)", bg: "var(--danger-tint)", dot: "var(--danger-dot)", icon: <Svg paths={I_TRASH} size={14} /> },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.key, c])) as Record<AuditCat | "", (typeof CATS)[number]>;

// --- Экран ----------------------------------------------------------------------------------

export default function Audit(_: { isDesktop?: boolean }) {
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

  const all = Object.values(counts).reduce((s, x) => s + (x ?? 0), 0);
  const maxCat = Math.max(1, ...Object.values(counts).map((x) => x ?? 0));
  const days = useMemo(() => groupByDay(rows ?? []).map(([d, list]) => [d, collapse(list)] as const), [rows]);
  const filtered = !!(cat || userId || q);

  return (
    <Page size="wide">
      <div className="au-layout">
        {/* Фильтры */}
        <aside className="au-rail">
          <div className="au-card">
            <div style={css("font-size:12px;color:var(--text-3);margin-bottom:10px")}>Период</div>
            <PeriodPicker value={period} onChange={setPeriod} />
            <label className="au-search">
              <span style={css("display:flex;color:var(--text-4)")}>
                <Svg paths={I_SEARCH} size={15} />
              </span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder="Товар, клиент, код…" aria-label="Поиск по журналу" />
            </label>
          </div>

          <div className="au-card au-cats-card">
            <div className="au-cats-title" style={css("display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px")}>
              <span style={css("font-size:12px;color:var(--text-3)")}>Разделы</span>
              {cat && (
                <HButton onClick={() => setCat("")} className="au-reset" s="" hover="">
                  сбросить
                </HButton>
              )}
            </div>
            <div className="au-cats">
              {CATS.map((c) => {
                const count = c.key ? (counts[c.key] ?? 0) : all;
                if (c.key && !count && cat !== c.key) return null;
                const on = cat === c.key;
                return (
                  <button key={c.key || "all"} type="button" className={"au-cat" + (on ? " on" : "")} onClick={() => setCat(c.key)} style={{ ["--c" as string]: c.dot }}>
                    <span style={mix("width:28px;height:28px;border-radius:9px;flex:none;display:grid;place-items:center", { background: c.bg, color: c.fg })}>{c.icon}</span>
                    <span style={css("flex:1;min-width:0")}>
                      <span style={css("display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.label}</span>
                      {c.key && (
                        <span className="au-cat-bar">
                          <span style={mix("display:block;height:100%;border-radius:999px", { width: `${Math.max(4, Math.round((count / maxCat) * 100))}%`, background: c.dot })} />
                        </span>
                      )}
                    </span>
                    <span style={css(NUM + ";font-size:12.5px;color:var(--text-3)")}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

        </aside>

        {/* Лента */}
        <section className="au-feed">
          <div className="au-feed-head">
            <span style={css("min-width:0;margin-right:auto")}>
              <span style={css("display:block;font-size:15px;font-weight:500;color:var(--text)")}>{cat ? CAT[cat].label : "Все действия"}</span>
              <span style={css(NUM + ";display:block;font-size:12.5px;color:var(--text-4)")}>
                {rows ? `${total} ${plural(total, "запись", "записи", "записей")} за период${filtered ? " по фильтру" : ""}` : "загружаем…"}
              </span>
            </span>
            {users.length > 1 && (
              <div className="au-who" role="group" aria-label="Сотрудник">
                <button type="button" className={"au-who-btn" + (userId ? "" : " on")} onClick={() => setUserId("")}>
                  Все
                </button>
                {users.map((u) => {
                  const on = userId === String(u.id);
                  const name = u.full_name || u.login;
                  return (
                    <button key={u.id} type="button" className={"au-who-btn" + (on ? " on" : "")} onClick={() => setUserId(on ? "" : String(u.id))} title={`${name} · @${u.login}`}>
                      <Avatar name={name} size={22} />
                      <span style={css("max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{name.split(/[\s(]/)[0]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <div style={css("padding:0 18px 12px")}>
              <ModalError text={error} />
            </div>
          )}

          {!rows ? (
            <div style={css("padding:16px 18px")}>
              <SkeletonRows rows={6} />
            </div>
          ) : rows.length === 0 ? (
            <Empty icon="audit" title="За этот период записей нет" text={filtered ? "Измените фильтры или период" : "Здесь появляются заказы, приёмы, выдачи, оплаты, импорты и удаления"} />
          ) : (
            <>
              {days.map(([day, groups]) => (
                <div key={day}>
                  <div className="au-day">
                    <span style={css("font-size:13.5px;font-weight:500;color:var(--text)")}>{dayTitle(day).title}</span>
                    <span style={css("font-size:12px;color:var(--text-4)")}>{dayTitle(day).sub}</span>
                    <span style={css("flex:1;min-width:12px;border-bottom:1px solid var(--border-2);transform:translateY(-4px)")} />
                    <span style={css(NUM + ";font-size:12px;color:var(--text-3);white-space:nowrap")}>
                      {groups.reduce((s, g) => s + g.length, 0)} {plural(groups.reduce((s, g) => s + g.length, 0), "запись", "записи", "записей")}
                    </span>
                  </div>
                  {groups.map((g, i) => (
                    <FeedItem key={g[0].id} group={g} first={i === 0} last={i === groups.length - 1} />
                  ))}
                </div>
              ))}
              <div className="au-more">
                <span style={css(NUM)}>
                  Показано {rows.length} из {total}
                </span>
                {rows.length < total && (
                  <HButton onClick={more} disabled={loadingMore} className="au-more-btn" s="" hover="">
                    {loadingMore ? "Загрузка…" : `Показать ещё ${Math.min(PAGE, total - rows.length)}`}
                  </HButton>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </Page>
  );
}

// --- Запись ленты -----------------------------------------------------------------------------

/** Пауза, после которой однотипные действия уже не сворачиваются вместе. */
const BURST_MS = 15 * 60_000;
/** Сколько строк раскрытой группы показывать сразу. */
const SUBS = 10;

/**
 * Однотипные действия подряд — одной записью: тот же сотрудник, то же действие с тем же видом
 * объекта, без перерыва дольше 15 минут. Например, «изменил сотрудника @kassa и ещё 6».
 */
function collapse(list: AuditEntry[]): AuditEntry[][] {
  const out: AuditEntry[][] = [];
  const key = (a: AuditEntry) => [a.user_id, a.action, a.entity].join("|");
  for (const a of list) {
    const g = out[out.length - 1];
    const prev = g?.[g.length - 1];
    if (prev && key(prev) === key(a) && Date.parse(prev.created_at) - Date.parse(a.created_at) <= BURST_MS) g.push(a);
    else out.push([a]);
  }
  return out;
}

/** Действие и объект записи — без имени сотрудника. */
function Phrase({ a, d }: { a: AuditEntry; d: Described }) {
  return (
    <>
      {d.verb}
      {d.obj && (
        <>
          {a.entity === "order" ? " — " : " "}
          {d.obj}
        </>
      )}
      {d.sub && <span style={css("color:var(--text-4)")}> · {d.sub}</span>}
    </>
  );
}

function FeedItem({ group, first, last }: { group: AuditEntry[]; first: boolean; last: boolean }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const a = group[0];
  const c = CAT[a.cat] ?? CAT[""];
  const d = describe(a, nav);
  const who = a.user_name || a.user_login || "Система";
  const times = group.map((x) => hhmm(x.created_at));
  const span = times[times.length - 1] === times[0] ? times[0] : `${times[times.length - 1]}–${times[0]}`;
  // Повтор одного и того же (тот же объект и данные) — показываем только время; разные объекты — списком.
  const same = group.every((x) => x.entity_id === a.entity_id && x.new_value === a.new_value);
  const rest = group.length - 1;
  return (
    <div className={"au-item" + (first ? " first" : "") + (last ? " last" : "")}>
      <span style={css(NUM + ";font-size:12.5px;color:var(--text-3);padding-top:6px;white-space:nowrap")}>{span}</span>
      <span className="au-node">
        <span style={mix("position:relative;z-index:1;width:30px;height:30px;border-radius:10px;display:grid;place-items:center;box-shadow:0 0 0 4px var(--surface)", { background: c.bg, color: c.fg })}>{c.icon}</span>
      </span>
      <div style={css("min-width:0;padding-top:4px")}>
        <div style={css("font-size:13.5px;line-height:1.55;color:var(--text-2)")}>
          <span style={css("display:inline-flex;vertical-align:middle;margin:-3px 6px 0 0")}>
            <Avatar name={who} size={20} />
          </span>
          <b style={css("font-weight:500;color:var(--text);margin-right:4px")} title={a.user_login ? "@" + a.user_login : undefined}>
            {who}
          </b>
          <Phrase a={a} d={d} />
          {rest > 0 && (
            <HButton onClick={() => setOpen((v) => !v)} className={"au-times" + (open ? " on" : "")} s="" hover="" aria-expanded={open}>
              {same ? `×${group.length}` : `и ещё ${rest}`}
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden style={css("margin-left:5px;transition:transform .2s")}>
                <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </HButton>
          )}
        </div>
        {d.details && <div style={css("display:flex;flex-wrap:wrap;gap:6px;margin-top:5px")}>{d.details}</div>}
        {open && rest > 0 &&
          (same ? (
            <div className="au-open" style={css("display:flex;flex-wrap:wrap;gap:5px;margin-top:8px")}>
              {times.map((t, i) => (
                <span key={i} className="au-time-chip">
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <div className="au-open au-subs">
              {group.slice(1, all ? undefined : SUBS + 1).map((x) => (
                <SubRow key={x.id} a={x} />
              ))}
              {!all && rest > SUBS && (
                <HButton onClick={() => setAll(true)} className="au-reset" s="align-self:flex-start;margin-top:4px" hover="">
                  показать все {rest}
                </HButton>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

/** Строка раскрытой группы: время, действие, объект и подробности. */
function SubRow({ a }: { a: AuditEntry }) {
  const nav = useNavigate();
  const d = describe(a, nav);
  return (
    <div className="au-sub">
      <span style={css(NUM + ";font-size:12px;color:var(--text-4);white-space:nowrap")}>{hhmm(a.created_at)}</span>
      <span style={css("min-width:0;font-size:13px;line-height:1.5;color:var(--text-2)")}>
        <Phrase a={a} d={d} />
        {d.details && <span style={css("display:inline-flex;flex-wrap:wrap;gap:6px;margin-left:8px;vertical-align:middle")}>{d.details}</span>}
      </span>
    </div>
  );
}

const AVATAR_BG = [
  "linear-gradient(135deg,#5B7CFA,#8B5CF6)",
  "linear-gradient(135deg,#22C55E,#0EA5E9)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#EC4899,#8B5CF6)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
];

/** Аватар-буква; цвет — от имени, как на других страницах. */
function Avatar({ name, size }: { name: string; size: number }) {
  const n = [...name].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return (
    <span
      style={mix("border-radius:50%;flex:none;display:inline-grid;place-items:center;color:#fff;font-weight:600", {
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: AVATAR_BG[n % AVATAR_BG.length],
      })}
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Ссылка на объект записи (жирная, кликабельная, если объект ещё существует). */
function Obj({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  if (!onClick) return <b style={css("color:var(--text);font-weight:500")}>{children}</b>;
  return (
    <HButton onClick={onClick} s="border:none;background:transparent;padding:0;font:inherit;font-weight:500;color:var(--text);cursor:pointer;text-align:left;transition:color .15s" hover="color:var(--accent)">
      {children}
    </HButton>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: "danger" | "green" }) {
  return (
    <span
      style={mix("display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--border-2);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", {
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
      <b style={css("font-weight:500;color:var(--text)")}>{to}</b>
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

/** «Сегодня · четверг, 8 октября», «Вчера · …» или «3 октября · пятница». */
function dayTitle(day: string): { title: string; sub: string } {
  const today = localDay(new Date().toISOString());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const d = new Date(`${day}T12:00:00`);
  const words = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const wd = d.toLocaleDateString("ru-RU", { weekday: "long" });
  if (day === today) return { title: "Сегодня", sub: `${wd}, ${words}` };
  if (day === localDay(y.toISOString())) return { title: "Вчера", sub: `${wd}, ${words}` };
  return { title: words, sub: wd };
}

function plural(count: number, one: string, few: string, many: string) {
  const a = count % 10;
  const b = count % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
