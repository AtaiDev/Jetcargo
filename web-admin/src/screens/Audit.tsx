/**
 * Журнал действий — лента событий: кто, что и когда сделал, человеческими фразами, по дням.
 *
 *  - слева панель фильтров: период, поиск, разделы (с числом и долей) и сотрудники;
 *  - справа лента по дням: время, цветная точка раздела на линии и фраза; одинаковые действия
 *    подряд (тот же сотрудник, то же действие с тем же объектом) сворачиваются в одну запись «×N».
 * Только администратор. Названия товаров, клиентов и партий подставляет сервер.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { listAudit, listUsers, type AuditCat, type AuditEntry, type AuditPage, type User } from "../api/domain";
import { PeriodPicker, periodOf, type Period } from "../components/cargo";
import CountUp from "../design/CountUp";
import { css, mix } from "../design/css";
import { I_SEARCH, I_TRASH, Icon, Svg } from "../design/icons";
import { MONO, Page } from "../design/table";
import { HButton, ModalError } from "../design/ui";
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
  // Сводки панели «Активность». При смене фильтра старые остаются (приглушённо), пока не придут новые.
  const [summary, setSummary] = useState<Summary | null>(null);

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
      tz: -new Date().getTimezoneOffset(),
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
        setSummary({ by_day: r.by_day ?? [], by_hour: r.by_hour ?? [], by_user: r.by_user ?? [] });
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
  const head = CAT[cat];

  function reset() {
    setCat("");
    setUserId("");
    setQuery("");
  }

  return (
    <Page size="wide">
      <div className="au-layout">
        {/* Фильтры */}
        <aside className="au-rail">
          <div className="au-card">
            <div style={css("font-size:12px;color:var(--text-3);margin-bottom:10px")}>Период</div>
            <PeriodPicker value={period} onChange={setPeriod} />
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

          <div className="au-card au-fill-card">
            <GhostFill rowH={46} row={(i) => <GhostCat key={i} i={i} />} title="Фильтр по разделу" text="Нажмите на раздел — в ленте останутся только его записи" icon={<Icon name="audit" size={16} />} />
          </div>
        </aside>

        {/* Лента и панель активности */}
        <section className="au-feed">
          <div className="au-feed-head">
            <span style={mix("width:38px;height:38px;border-radius:12px;flex:none;display:grid;place-items:center", { background: head.bg, color: head.fg })}>{head.icon}</span>
            <span style={css("min-width:0;margin-right:auto")}>
              <span style={css("display:block;font-size:15px;font-weight:500;color:var(--text)")}>{head.label}</span>
              <span style={css(NUM + ";display:block;font-size:12.5px;color:var(--text-4)")}>
                {rows ? `${total} ${plural(total, "запись", "записи", "записей")} за период${filtered ? " по фильтру" : ""}` : "загружаем…"}
              </span>
            </span>
            {filtered && (
              <HButton onClick={reset} className="au-reset" s="" hover="">
                Сбросить фильтры
              </HButton>
            )}
            <label className="au-search">
              <span style={css("display:flex;color:var(--text-4)")}>
                <Svg paths={I_SEARCH} size={15} />
              </span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder="Товар, клиент, код…" aria-label="Поиск по журналу" />
            </label>
          </div>

          <div className="au-body">
            <div className="au-list">
              {error && (
                <div style={css("padding:12px 18px 0")}>
                  <ModalError text={error} />
                </div>
              )}

              {!rows ? (
                <GhostFill min={420} rowH={64} row={(i) => <GhostItem key={i} i={i} />} />
              ) : rows.length === 0 ? (
                <GhostFill
                  min={420}
                  rowH={64}
                  row={(i) => <GhostItem key={i} i={i} />}
                  title="За этот период записей нет"
                  text={filtered ? "Измените фильтры или период" : "Здесь появляются заказы, приёмы, выдачи, оплаты, импорты и удаления"}
                  icon={<Icon name="audit" size={16} />}
                />
              ) : (
                <>
                  {days.map(([day, groups]) => {
                    const n = groups.reduce((s, g) => s + g.length, 0);
                    return (
                      <div key={day}>
                        <div className="au-day">
                          <span style={css("font-size:13.5px;font-weight:500;color:var(--text)")}>{dayTitle(day).title}</span>
                          <span style={css("font-size:12px;color:var(--text-4)")}>{dayTitle(day).sub}</span>
                          <span style={css("flex:1;min-width:12px;border-bottom:1px solid var(--border-2);transform:translateY(-4px)")} />
                          <span style={css(NUM + ";font-size:12px;color:var(--text-3);white-space:nowrap")}>
                            {n} {plural(n, "запись", "записи", "записей")}
                          </span>
                        </div>
                        {groups.map((g, i) => (
                          <FeedItem key={g[0].id} group={g} first={i === 0} last={i === groups.length - 1} />
                        ))}
                      </div>
                    );
                  })}
                  <GhostFill
                    rowH={64}
                    row={(i) => <GhostItem key={i} i={i} />}
                    title={rows.length < total ? `Ещё ${total - rows.length} ${plural(total - rows.length, "запись", "записи", "записей")} — ниже` : "Это все записи за период"}
                    text={rows.length < total ? "Нажмите «Показать ещё»" : "Другие — в другом периоде или разделе"}
                    icon={<Icon name="audit" size={16} />}
                  />
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
            </div>

            <Activity
              summary={summary}
              stale={!rows}
              period={period}
              users={users}
              userId={userId}
              onUser={setUserId}
              onRange={(from, to) => setPeriod({ key: "custom", date_from: from, date_to: to })}
            />
          </div>
        </section>
      </div>
    </Page>
  );
}

// --- Панель активности --------------------------------------------------------------------------

type Summary = Required<Pick<AuditPage, "by_day" | "by_hour" | "by_user">>;

/**
 * Правая часть ленты: сколько действий по дням (клик по столбику — открыть этот день), в какие часы
 * идёт работа и кто сколько сделал (клик — показать только его действия).
 */
function Activity({
  summary,
  stale,
  period,
  users,
  userId,
  onUser,
  onRange,
}: {
  summary: Summary | null;
  stale: boolean;
  period: Period;
  users: User[];
  userId: string;
  onUser: (id: string) => void;
  onRange: (from: string, to: string) => void;
}) {
  const [dayHov, setDayHov] = useState<number | null>(null);
  const [hourHov, setHourHov] = useState<number | null>(null);
  if (!summary)
    return (
      <aside className="au-side" aria-hidden>
        <div className="au-side-in">
          {[88, 56, 120].map((h, i) => (
            <div key={i} className="au-sec">
              <span className="sk" style={css("display:block;width:90px;height:10px")} />
              <span className="sk" style={mix("display:block;margin-top:14px;border-radius:10px", { height: h })} />
            </div>
          ))}
        </div>
        <GhostFill rowH={50} row={(i) => <GhostPerson key={i} i={i} />} />
      </aside>
    );

  const buckets = dayBuckets(period.date_from, period.date_to, summary.by_day);
  const total = buckets.reduce((s, b) => s + b.n, 0);
  const dayCount = buckets.reduce((s, b) => s + b.days, 0);
  const avg = dayCount ? total / dayCount : 0;
  const peak = buckets.reduce<Bucket | null>((m, b) => (b.n > (m?.n ?? 0) ? b : m), null);

  const hours = Array.from({ length: 24 }, (_, h) => summary.by_hour.find((x) => x.hour === h)?.n ?? 0);
  const peakHour = hours.indexOf(Math.max(...hours));

  const dayTip = dayHov !== null ? buckets[dayHov] : null;

  const people = summary.by_user.map((r) => {
    const u = users.find((x) => x.id === r.user_id);
    return { id: r.user_id === null ? "" : String(r.user_id), name: u?.full_name || u?.login || (r.user_id === null ? "Система" : `#${r.user_id}`), login: u?.login, n: r.n };
  });
  const maxPerson = Math.max(1, ...people.map((p) => p.n));
  const sumPeople = people.reduce((s, p) => s + p.n, 0);

  return (
    <aside className={"au-side" + (stale ? " stale" : "")}>
      <div className="au-side-in">
        <div className="au-sec">
          <div className="au-sec-title">Активность</div>
          <div style={css("display:flex;align-items:baseline;gap:7px;margin-top:6px")}>
            <span style={css(NUM + ";font-size:26px;font-weight:500;color:var(--text);line-height:1.1")}>
              <CountUp text={String(total)} />
            </span>
            <span style={css("font-size:12.5px;color:var(--text-3)")}>{plural(total, "запись", "записи", "записей")}</span>
            <span style={css(NUM + ";margin-left:auto;font-size:12px;color:var(--text-4);white-space:nowrap")}>≈ {avg < 10 ? avg.toFixed(1).replace(".", ",") : Math.round(avg)} в день</span>
          </div>
          {buckets.length > 0 && (
            <>
              <Bars height={84} data={buckets.map((b) => ({ n: b.n, strong: b.today }))} hov={dayHov} onHov={setDayHov} onPick={(i) => onRange(buckets[i].from, buckets[i].to)} />
              <div className="au-axis">
                <span>{buckets[0].label}</span>
                {buckets.length > 2 && <span>{buckets[Math.floor((buckets.length - 1) / 2)].label}</span>}
                <span>{buckets[buckets.length - 1].label}</span>
              </div>
            </>
          )}
          <div className="au-note">
            {dayTip ? (
              <>
                <b>{dayTip.tip}</b>
                <span style={css("color:var(--accent)")}> · открыть</span>
              </>
            ) : peak ? (
              <>
                Больше всего — <b>{peak.long}</b>: {peak.n} {plural(peak.n, "запись", "записи", "записей")}
              </>
            ) : (
              "За период действий нет"
            )}
          </div>
        </div>
  
        <div className="au-sec">
          <div className="au-sec-title">По часам</div>
          <Bars height={52} data={hours.map((n) => ({ n }))} hov={hourHov} onHov={setHourHov} />
          <div className="au-axis">
            <span>0:00</span>
            <span>6:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
          {total > 0 && (
            <div className="au-note">
              {hourHov !== null ? (
                <b>
                  {hourHov}:00–{hourHov + 1}:00 · {hours[hourHov]} {plural(hours[hourHov], "запись", "записи", "записей")}
                </b>
              ) : (
                <>
                  Чаще всего — <b>с {peakHour}:00 до {peakHour + 1}:00</b>
                </>
              )}
            </div>
          )}
        </div>
  
        <div className="au-sec">
          <div style={css("display:flex;align-items:baseline;justify-content:space-between")}>
            <span className="au-sec-title">Сотрудники</span>
            {userId && (
              <HButton onClick={() => onUser("")} className="au-reset" s="" hover="">
                все
              </HButton>
            )}
          </div>
          <div style={css("display:flex;flex-direction:column;gap:2px;margin-top:8px")}>
            {people.length === 0 && <span style={css("font-size:12.5px;color:var(--text-4)")}>Нет действий</span>}
            {people.map((p) => {
              const on = !!p.id && userId === p.id;
              return (
                <button key={p.id || "sys"} type="button" className={"au-person" + (on ? " on" : "")} disabled={!p.id} onClick={() => onUser(on ? "" : p.id)} title={p.login ? "@" + p.login : undefined}>
                  <Avatar name={p.name} size={26} />
                  <span style={css("min-width:0")}>
                    <span style={css("display:flex;align-items:baseline;gap:8px")}>
                      <span style={css("flex:1;min-width:0;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.name}</span>
                      <span style={css(NUM + ";font-size:12px;color:var(--text-3)")}>
                        {p.n}
                        <span style={css("color:var(--text-5)")}> · {Math.round((p.n / Math.max(1, sumPeople)) * 100)}%</span>
                      </span>
                    </span>
                    <span className="au-person-bar">
                      <span style={{ width: `${Math.max(3, (p.n / maxPerson) * 100)}%` }} />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <GhostFill rowH={50} row={(i) => <GhostPerson key={i} i={i} />} title="Нажмите на день или сотрудника" text="Лента покажет только их действия" icon={<Icon name="staff" size={16} />} />
    </aside>
  );
}

/** Столбики; высота — доля от максимума. Наведённый подсвечивается, его значение пишется под графиком. */
function Bars({ data, height, hov, onHov, onPick }: { data: { n: number; strong?: boolean }[]; height: number; hov: number | null; onHov: (i: number | null) => void; onPick?: (i: number) => void }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="au-bars" style={{ height, gap: data.length > 40 ? 1 : 3 }} onMouseLeave={() => onHov(null)}>
      {data.map((d, i) => (
        <button
          key={i}
          type="button"
          tabIndex={onPick ? 0 : -1}
          className={"au-bar" + (d.strong ? " strong" : "") + (hov === i ? " hov" : "") + (onPick ? " pick" : "")}
          onMouseEnter={() => onHov(i)}
          onFocus={() => onHov(i)}
          onBlur={() => onHov(null)}
          onClick={onPick ? () => onPick(i) : undefined}
          style={{ ["--i" as string]: i }}
        >
          <span className={d.n ? "" : "zero"} style={{ height: d.n ? `${Math.max(6, (d.n / max) * 100)}%` : 2 }} />
        </button>
      ))}
    </div>
  );
}

type Bucket = { from: string; to: string; days: number; n: number; label: string; long: string; tip: string; today: boolean };

/** Дни периода (до сегодня) с числом записей; длинный период — по неделям. */
function dayBuckets(from: string, to: string, byDay: { day: string; n: number }[]): Bucket[] {
  const map = new Map(byDay.map((d) => [d.day, d.n]));
  const today = localDay(new Date().toISOString());
  const end = to < today ? to : today;
  const list: string[] = [];
  for (const d = new Date(`${from}T12:00:00`); list.length < 400; d.setDate(d.getDate() + 1)) {
    const k = localDay(d.toISOString());
    if (k > end) break;
    list.push(k);
  }
  const short = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  const long = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const rec = (n: number) => `${n} ${plural(n, "запись", "записи", "записей")}`;
  if (list.length <= 62)
    return list.map((k) => {
      const n = map.get(k) ?? 0;
      const wd = new Date(`${k}T12:00:00`).toLocaleDateString("ru-RU", { weekday: "short" });
      return { from: k, to: k, days: 1, n, label: short(k), long: long(k), tip: `${wd}, ${short(k)} · ${rec(n)}`, today: k === today };
    });
  const out: Bucket[] = [];
  for (let i = 0; i < list.length; i += 7) {
    const part = list.slice(i, i + 7);
    const a = part[0];
    const b = part[part.length - 1];
    const n = part.reduce((s, k) => s + (map.get(k) ?? 0), 0);
    out.push({ from: a, to: b, days: part.length, n, label: short(a), long: `неделя с ${long(a)}`, tip: `${short(a)} – ${short(b)} · ${rec(n)}`, today: part.includes(today) });
  }
  return out;
}

// --- Заполнители пустого места -------------------------------------------------------------------

/**
 * Пустое место колонки — бледными строками-заготовками на всю высоту (сколько влезет) и подсказкой
 * по центру, как на других страницах. Высоту берёт у раскладки, сам её не раздвигает.
 */
function GhostFill({ rowH, row, title, text, icon, min }: { rowH: number; row: (i: number) => ReactNode; title?: string; text?: string; icon?: ReactNode; min?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="ghost-fill au-ghost" style={min ? { minHeight: min } : undefined}>
      <div className="ghost-rows" aria-hidden>
        {h > 0 && Array.from({ length: Math.ceil(h / rowH) }, (_, i) => row(i))}
      </div>
      {title && h >= 150 && (
        <div className="ghost-msg">
          {icon && <span style={css("width:34px;height:34px;border-radius:10px;flex:none;display:grid;place-items:center;background:var(--accent-tint);color:var(--accent-strong)")}>{icon}</span>}
          <span style={css("min-width:0")}>
            <span style={css("display:block;font-size:13px;font-weight:500;color:var(--text)")}>{title}</span>
            {text && <span style={css("display:block;margin-top:2px;font-size:12px;line-height:1.4;color:var(--text-3)")}>{text}</span>}
          </span>
        </div>
      )}
    </div>
  );
}

/** Ширины полосок — разные, чтобы заготовки не выглядели одинаковой решёткой. */
const GW = [62, 48, 70, 55, 66, 44];

/** Заготовка записи ленты: время, значок на линии, что сделано и кто. */
function GhostItem({ i }: { i: number }) {
  return (
    <div className="au-gi">
      <span className="sk" style={css("width:36px;height:8px;margin-top:8px")} />
      <span className="sk" style={css("width:30px;height:30px;border-radius:10px")} />
      <span style={css("display:flex;flex-direction:column;gap:10px;padding-top:5px")}>
        <span className="sk" style={mix("height:9px", { width: `${GW[i % 6]}%` })} />
        <span style={css("display:flex;align-items:center;gap:7px")}>
          <span className="sk" style={css("width:16px;height:16px;border-radius:50%;flex:none")} />
          <span className="sk" style={mix("height:7px", { width: `${GW[(i + 3) % 6] / 2}%` })} />
        </span>
      </span>
    </div>
  );
}

/** Заготовка строки сотрудника: аватар, имя с числом и полоска доли. */
function GhostPerson({ i }: { i: number }) {
  return (
    <div className="au-gp">
      <span className="sk" style={css("width:26px;height:26px;border-radius:50%")} />
      <span style={css("display:flex;flex-direction:column;gap:8px;min-width:0")}>
        <span style={css("display:flex;justify-content:space-between;gap:10px")}>
          <span className="sk" style={mix("height:8px", { width: `${GW[i % 6]}%` })} />
          <span className="sk" style={css("width:30px;height:8px")} />
        </span>
        <span className="sk" style={mix("height:3px", { width: `${GW[(i + 2) % 6] + 20}%` })} />
      </span>
    </div>
  );
}

/** Заготовка строки раздела: значок, название с полоской и число. */
function GhostCat({ i }: { i: number }) {
  return (
    <div className="au-gc">
      <span className="sk" style={css("width:28px;height:28px;border-radius:9px")} />
      <span style={css("display:flex;flex-direction:column;gap:8px;min-width:0")}>
        <span className="sk" style={mix("height:8px", { width: `${GW[(i + 1) % 6]}%` })} />
        <span className="sk" style={mix("height:3px", { width: `${GW[(i + 4) % 6] + 25}%` })} />
      </span>
      <span className="sk" style={css("width:18px;height:8px")} />
    </div>
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

/** Что сделано: действие с заглавной буквы и объект; уточнение (клиент товара и т. п.) — приглушённо. */
function Phrase({ a, d }: { a: AuditEntry; d: Described }) {
  return (
    <>
      {d.verb.charAt(0).toUpperCase() + d.verb.slice(1)}
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

/**
 * Запись ленты в две строки: сверху — что сделано, ниже мелко — кто и подробности.
 * Свёрнутая группа — кнопкой «ещё N» у правого края.
 */
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
    <div className={"au-item" + (first ? " first" : "") + (last ? " last" : "") + (open ? " open" : "")}>
      <span className="au-time" title={span}>
        {times[0]}
        {times[times.length - 1] !== times[0] && <small>с {times[times.length - 1]}</small>}
      </span>
      <span className="au-node">
        <span style={mix("position:relative;z-index:1;width:30px;height:30px;border-radius:10px;display:grid;place-items:center;box-shadow:0 0 0 4px var(--surface)", { background: c.bg, color: c.fg })}>{c.icon}</span>
      </span>
      <div className="au-main">
        <div className="au-title">
          <Phrase a={a} d={d} />
        </div>
        <div className="au-meta">
          <span className="au-by" title={a.user_login ? "@" + a.user_login : undefined}>
            <Avatar name={who} size={18} />
            {who}
          </span>
          <span className="au-meta-time">{span}</span>
          {d.details && <span className="au-details">{d.details}</span>}
        </div>
      </div>
      {rest > 0 && (
        <HButton onClick={() => setOpen((v) => !v)} className={"au-times" + (open ? " on" : "")} s="" hover="" aria-expanded={open} title={same ? "То же действие повторялось" : "Похожие действия подряд"}>
          {same ? `×${group.length}` : `ещё ${rest}`}
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden style={css("margin-left:6px;transition:transform .2s")}>
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </HButton>
      )}
      {open && (
        <div className="au-expand">
          {same ? (
            <div className="au-open" style={css("display:flex;flex-wrap:wrap;gap:5px;margin-top:10px")}>
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
          )}
        </div>
      )}
    </div>
  );
}

/** Строка раскрытой группы: время, что сделано и подробности. */
function SubRow({ a }: { a: AuditEntry }) {
  const nav = useNavigate();
  const d = describe(a, nav);
  return (
    <div className="au-sub">
      <span style={css(NUM + ";font-size:12px;color:var(--text-4);white-space:nowrap")}>{hhmm(a.created_at)}</span>
      <span className="au-sub-line">
        <span>
          <Phrase a={a} d={d} />
        </span>
        {d.details && <span className="au-details">{d.details}</span>}
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

    // Накладные из Китая: товары из них — «В пути».
    case "import_waybill":
    case "import_waybill_update": {
      const transit = Number(obj.transit_items ?? 0);
      const missing = Number(obj.not_found ?? 0);
      return {
        verb: a.action === "import_waybill" ? "загрузил накладную" : "обновил накладную",
        obj: <Obj onClick={() => nav("/import?mode=waybill")}>{String(obj.waybill ?? "")}</Obj>,
        details: (
          <>
            <Chip>в пути: {n(transit)}</Chip>
            {missing > 0 && <Chip>кодов без товара: {missing}</Chip>}
          </>
        ),
      };
    }
    case "import_waybill_undo":
      return { verb: "скрыл накладную", obj: <Obj>{String(oldV ?? "")}</Obj> };
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
