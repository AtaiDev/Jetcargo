/**
 * Журнал действий — лента событий: кто, что и когда сделал, человеческими фразами, по дням.
 *
 *  - слева панель фильтров: период, поиск, разделы (с числом и долей) и сотрудники;
 *  - справа лента по дням: время, цветная точка раздела на линии и фраза; одинаковые действия
 *    подряд (тот же сотрудник, то же действие с тем же объектом) сворачиваются в одну запись «×N».
 * Только администратор. Названия товаров, клиентов и партий подставляет сервер.
 */
import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { listAudit, listUsers, type AuditCat, type AuditEntry, type AuditPage, type User } from "../api/domain";
import { periodOf, type Period } from "../components/cargo";
import CountUp from "../design/CountUp";
import { css, mix } from "../design/css";
import { I_SEARCH, I_TRASH, Icon, Svg } from "../design/icons";
import { MONO, Page } from "../design/table";
import { HomeHead } from "./overview/Home";
import DatePicker from "../components/DatePicker";
import { HButton, ModalError } from "../design/ui";
import { STATUS_LABEL, date, som } from "../lib/cargo";
import { openItem, useDebounced } from "../lib/events";

const PAGE = 50;
const PERIOD_NAME: Record<string, string> = { today: "Сегодня", "7": "7 дней", month: "Этот месяц", "30": "30 дней", "90": "90 дней", year: "Год" };
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";

// --- Разделы --------------------------------------------------------------------------------

const CATS: { key: AuditCat | ""; label: string; fg: string; bg: string; dot: string; icon: ReactNode }[] = [
  { key: "", label: "Все действия", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-ink)", icon: <Icon name="audit" size={15} /> },
  { key: "item", label: "Заказы и товары", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-ink)", icon: <Icon name="orders" size={15} /> },
  { key: "receive", label: "Приём", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-ink)", icon: <Icon name="receive" size={15} /> },
  { key: "issue", label: "Выдача", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-ink)", icon: <Icon name="issue" size={15} /> },
  { key: "payment", label: "Оплаты", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-ink)", icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 6.5h18v11H3z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M6 9.5v.01 M18 14.5v.01" />
      </svg>
    ) },
  { key: "customer", label: "Клиенты", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-ink)", icon: <Icon name="customers" size={15} /> },
  { key: "batch", label: "Партии", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-ink)", icon: <Icon name="batches" size={15} /> },
  { key: "import", label: "Импорт", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-ink)", icon: <Icon name="import" size={15} /> },
  { key: "user", label: "Сотрудники", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-ink)", icon: <Icon name="staff" size={15} /> },
  { key: "delete", label: "Удаления", fg: "#9C3B2E", bg: "color-mix(in srgb,#9C3B2E 9%,var(--ov-paper))", dot: "#9C3B2E", icon: <Svg paths={I_TRASH} size={14} /> },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.key, c])) as Record<AuditCat | "", (typeof CATS)[number]>;

// --- Экран ----------------------------------------------------------------------------------

export default function Audit(_: { isDesktop?: boolean }) {
  // блок журнала — ровно до низа экрана: страница не листается, листаются лента и колонки
  const fitRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () => {
      const el = fitRef.current;
      if (!el) return;
      if (window.innerWidth < 1100) return void (el.style.height = "");
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = Math.max(520, window.innerHeight - top - 20) + "px";
    };
    fit();
    const t = setTimeout(fit, 400);
    window.addEventListener("resize", fit);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", fit);
    };
  }, []);
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
  const todayKey = new Date().toLocaleDateString("sv-SE");
  const todayN = summary?.by_day.find((d) => d.day === todayKey)?.n ?? 0;
  const [perOpen, setPerOpen] = useState(false);
  const perRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!perOpen) return;
    // клики в календаре (он рисуется порталом) не закрывают список
    const out = (e: MouseEvent) => !perRef.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".ovp") && setPerOpen(false);
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [perOpen]);

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
      <div className="ov au3">
        <div className="wx-head">
          <HomeHead title="Журнал" />
          <span className="ov-live au3-live" title="Записей в журнале за сегодня">
            <span className="ov-live-dot" aria-hidden />
            <b>
              <CountUp text={String(todayN)} />
            </b>
            <span className="ov-live-l">сегодня</span>
          </span>
        </div>
        <div className="au3-wrap" ref={fitRef}>
          <div className="au3-bar">
            <div className="au3-top">
              <span className="au3-pulse" aria-hidden />
              <span className={"au3-ic" + (cat === "delete" ? " del" : "")}>{head.icon}</span>
              <span className="au3-tt">
                <b>{head.label}</b>
                <small>
                  {rows ? `${total} ${plural(total, "запись", "записи", "записей")} за период${filtered ? " · по фильтру" : ""}` : "загружаем…"}
                  {filtered && (
                    <HButton onClick={reset} className="au-reset" s="" hover="">
                      сбросить
                    </HButton>
                  )}
                </small>
              </span>
              <label className="au-search au3-search">
              <span style={css("display:flex;color:var(--ov-mute)")}>
                <Svg paths={I_SEARCH} size={16} />
              </span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} placeholder="Поиск: товар, клиент, код…" aria-label="Поиск по журналу" />
            </label>
              <span className="au3-per" ref={perRef}>
              <button type="button" className={"au3-per-b" + (perOpen ? " on" : "")} onClick={() => setPerOpen(!perOpen)} aria-expanded={perOpen}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="cal-ic" aria-hidden>
                  <path d="M6 4.5h12A3 3 0 0 1 21 7.5V9H3V7.5a3 3 0 0 1 3-3z" fill="currentColor" stroke="none" opacity=".13" />
                  <rect x="3" y="4.5" width="18" height="16.5" rx="3" pathLength={1} />
                  <path d="M3 9h18" pathLength={1} />
                  <path d="M8 2.5v4M16 2.5v4" pathLength={1} />
                  <rect className="cal-d" x="13" y="13" width="4.5" height="4.5" rx="1.2" fill="currentColor" stroke="none" />
                </svg>
                {period.key === "custom" ? `${date(period.date_from)} — ${date(period.date_to)}` : (PERIOD_NAME[period.key] ?? "Период")}
                <svg className="ch" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {perOpen && (
                <span className="au3-per-pop" role="menu">
                  {(["today", "7", "month", "30", "90", "year"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="menuitemradio"
                      aria-checked={period.key === k}
                      className={"au3-po" + (period.key === k ? " on" : "")}
                      onClick={() => {
                        setPeriod(periodOf(k, period));
                        setPerOpen(false);
                      }}
                    >
                      {PERIOD_NAME[k]}
                      <i aria-hidden />
                    </button>
                  ))}
                  <span className={"au3-po-c" + (period.key === "custom" ? " on" : "")}>
                    <small>Свой период</small>
                    <span>
                      <DatePicker value={period.date_from} max={period.date_to} range={[period.date_from, period.date_to]} onChange={(v) => v && setPeriod({ ...period, key: "custom", date_from: v })} width="100%" height={34} fontSize={12.5} popClass="ovp" ariaLabel="С даты" />
                      <em>—</em>
                      <DatePicker value={period.date_to} min={period.date_from} range={[period.date_from, period.date_to]} onChange={(v) => v && setPeriod({ ...period, key: "custom", date_to: v })} width="100%" height={34} fontSize={12.5} popClass="ovp" ariaLabel="По дату" />
                    </span>
                  </span>
                </span>
              )}
            </span>
            </div>
          </div>
          <div className="au3-body">
            <section className="au3-feed">
              <div className="au-list au3-list">
              {error && (
                <div style={css("padding:12px 18px 0")}>
                  <ModalError text={error} />
                </div>
              )}

              {!rows ? (
                <GhostFill min={420} rowH={62} row={(i) => <GhostItem key={i} i={i} />} />
              ) : rows.length === 0 ? (
                <GhostFill
                  min={420}
                  rowH={62}
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
                    rowH={62}
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
            </section>
            <div className="au3-right">
              <div className="au3-cats2" role="tablist" aria-label="Разделы">
                <span className="au3-cats2-h">
                  Разделы
                  <em>{all}</em>
                </span>
                <div className="au3-cats2-g">
                  {CATS.map((c) => {
                    const count = c.key ? (counts[c.key] ?? 0) : all;
                    if (c.key && !count && cat !== c.key) return null;
                    return (
                      <button key={c.key || "all"} type="button" role="tab" aria-selected={cat === c.key} className={"au3-c" + (cat === c.key ? " on" : "") + (c.key === "delete" ? " del" : "")} onClick={() => setCat(c.key)}>
                        <i>{c.icon}</i>
                        <span>{c.label}</span>
                        <em>{count}</em>
                        {c.key && <u style={{ ["--w" as string]: `${Math.max(3, Math.round((count / Math.max(1, all)) * 100))}%` }} />}
                      </button>
                    );
                  })}
                </div>
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
          </div>
        </div>
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
    return { id: r.user_id === null ? "" : String(r.user_id), name: u?.full_name || u?.login || (r.user_id === null ? "Система" : `#${r.user_id}`), login: u?.login, role: u?.role, n: r.n };
  });
  const sumPeople = people.reduce((s, p) => s + p.n, 0);

  const maxH = Math.max(1, ...hours);
  return (
    <aside className={"au-side aa" + (stale ? " stale" : "")}>
      <section className="aa-sec">
        <div className="aa-h">
          <span>Активность</span>
          <em>≈ {avg < 10 ? avg.toFixed(1).replace(".", ",") : Math.round(avg)} в день</em>
        </div>
        <div className="aa-big">
          <b>
            <CountUp text={String(total)} />
          </b>
          <small>{plural(total, "запись", "записи", "записей")} за период</small>
        </div>
        {buckets.length > 0 && (
          <>
            <Bars height={92} data={buckets.map((b) => ({ n: b.n, strong: b.today }))} hov={dayHov} onHov={setDayHov} onPick={(i) => onRange(buckets[i].from, buckets[i].to)} />
            <div className="au-axis">
              <span>{buckets[0].label}</span>
              {buckets.length > 2 && <span>{buckets[Math.floor((buckets.length - 1) / 2)].label}</span>}
              <span>{buckets[buckets.length - 1].label}</span>
            </div>
          </>
        )}
        <div className="aa-note">
          {dayTip ? (
            <>
              <b>{dayTip.tip}</b> · нажмите, чтобы открыть
            </>
          ) : peak ? (
            <>
              Пик — <b>{peak.long}</b> · {peak.n} {plural(peak.n, "запись", "записи", "записей")}
            </>
          ) : (
            "За период действий нет"
          )}
        </div>
      </section>

      <section className="aa-sec">
        <div className="aa-h">
          <span>По часам</span>
          {total > 0 && <em>пик в {peakHour}:00</em>}
        </div>
        <div className="aa-heat" onMouseLeave={() => setHourHov(null)}>
          {hours.map((n, h) => (
            <i key={h} className={(n && h === peakHour ? "pk" : "") + (hourHov === h ? " hv" : "")} style={{ ["--a" as string]: n / maxH }} onMouseEnter={() => setHourHov(h)} />
          ))}
        </div>
        <div className="au-axis">
          <span>0:00</span>
          <span>6:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
        <div className="aa-note">
          {hourHov !== null ? (
            <>
              <b>
                {hourHov}:00–{hourHov + 1}:00
              </b>{" "}
              · {hours[hourHov]} {plural(hours[hourHov], "запись", "записи", "записей")}
            </>
          ) : total > 0 ? (
            <>
              Чаще всего — <b>с {peakHour}:00 до {peakHour + 1}:00</b>
            </>
          ) : (
            "—"
          )}
        </div>
      </section>

      <section className="aa-sec aa-team">
        <div className="aa-h">
          <span>Сотрудники</span>
          {userId ? (
            <HButton onClick={() => onUser("")} className="au-reset" s="" hover="">
              показать всех
            </HButton>
          ) : (
            <em>
              {people.length} {plural(people.length, "человек", "человека", "человек")}
            </em>
          )}
        </div>
        {people.length === 0 && <span className="aa-note">Нет действий</span>}
        {people.map((p, i) => {
          const on = !!p.id && userId === p.id;
          const pct = Math.round((p.n / Math.max(1, sumPeople)) * 100);
          return (
            <button key={p.id || "sys"} type="button" className={(i === 0 ? "aa-top" : "aa-row") + (on ? " on" : "")} disabled={!p.id} onClick={() => onUser(on ? "" : p.id)} title={p.login ? "@" + p.login : undefined}>
              <span className="aa-av">
                <Avatar name={p.name} size={i === 0 ? 50 : 30} />
                <b>{i + 1}</b>
              </span>
              <span className="aa-who">
                <b>{p.name}</b>
                <small>
                  {p.role ? (p.role === "admin" ? "администратор" : "склад") + " · " : ""}
                  {p.n} {plural(p.n, "действие", "действия", "действий")}
                </small>
              </span>
              <span className="aa-pc">
                <b>{pct}%</b>
                {i === 0 && <small>от всех</small>}
              </span>
            </button>
          );
        })}
        {people.length > 0 && (
          <div className="aa-share" aria-label="Доля действий">
            <span className="aa-share-h">Доля действий</span>
            <span className="aa-share-bar">
              {people.map((p, i) => (
                <i key={p.id || "sys"} style={{ flexGrow: p.n, ["--s" as string]: i }} title={`${p.name}: ${Math.round((p.n / Math.max(1, sumPeople)) * 100)}%`} />
              ))}
            </span>
          </div>
        )}
        <div className="aa-hint">
          <span className="aa-hint-av">
            {people.slice(0, 4).map((p) => (
              <Avatar key={p.id || "sys"} name={p.name} size={30} />
            ))}
          </span>
          <b>Лента по сотруднику</b>
          <small>Нажмите на человека — в ленте останутся только его действия. Нажмите на день в графике — лента покажет этот день.</small>
        </div>
      </section>
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


/** Заготовка записи ленты: время, значок на линии, что сделано и кто. */
function GhostItem(_: { i: number }) {
  // заготовка — как карточка записи: иконка · действие · раздел …пунктир… сотрудник · время · стрелка
  return (
    <div className="au-gi2">
      <span className="sk" style={css("width:36px;height:36px;border-radius:12px;flex:none")} />
      <span className="sk" style={css("width:130px;height:10px;flex:none")} />
      <span className="sk" style={css("width:84px;height:22px;border-radius:8px;flex:none")} />
      <span className="au-gi2-l" />
      <span className="sk" style={css("width:22px;height:22px;border-radius:50%;flex:none")} />
      <span className="sk" style={css("width:32px;height:9px;flex:none")} />
      <span style={css("width:44px;flex:none;display:flex;justify-content:flex-end")}>
        <span className="sk" style={css("width:34px;height:9px")} />
      </span>
      <span className="sk" style={css("width:30px;height:30px;border-radius:9px;flex:none")} />
    </div>
  );
}

/** Заготовка строки сотрудника: аватар, имя с числом и полоска доли. */
function GhostPerson(_: { i: number }) {
  // заготовка — как строка сотрудника: аватар, имя и число, процент, полоска доли
  return (
    <div className="au-gp2">
      <span className="sk" style={css("width:32px;height:32px;border-radius:50%;flex:none")} />
      <span style={css("flex:1;display:flex;flex-direction:column;gap:7px;min-width:0")}>
        <span className="sk" style={css("width:90px;height:9px")} />
        <span className="sk" style={css("width:64px;height:7px")} />
      </span>
      <span className="sk" style={css("width:30px;height:10px;flex:none")} />
    </div>
  );
}

/** Заготовка строки раздела: значок, название с полоской и число. */
// --- Запись ленты -----------------------------------------------------------------------------

/** Пауза, после которой однотипные действия уже не сворачиваются вместе. */
const BURST_MS = 15 * 60_000;

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

/**
 * Запись ленты в две строки: сверху — что сделано, ниже мелко — кто и подробности.
 * Свёрнутая группа — кнопкой «ещё N» у правого края.
 */

/** Заголовок карточки — только что сделано, без объекта: «Удалил товар», «Изменил сотрудника», «Создал заказ». */
const verbOnly = (v: string) => {
  let t = v.split(":")[0].replace(/\s*[—–-]\s*$/, "");
  t = t.replace(/№\s*\d+/g, ""); // «отменил импорт №12» → «отменил импорт»
  t = t.replace(/\s+в\s+«[^»]*»/, ""); // «перевёл товары в «Заказан»» → «перевёл товары» (статус — при раскрытии)
  t = t.replace(/(^|\s)(\d[\d\s,.]*)\s*(товар(?:а|ов)?)/g, (_m, sp: string, num: string, w: string) => sp + (num.trim() === "1" && w === "товар" ? "товар" : "товары")); // «2 товара» → «товары»
  t = t.replace(/\s+\d[\d\s,.]*\s*с(\s[\s\S]*)?$/, ""); // суммы и всё после: «оплату 480 с от клиента» → «оплату»
  t = t.replace(/\s+(клиенту|за|от клиента)$/, "").replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Свои иконки для похожих действий одного раздела — чтобы «Принял оплату», «Изменил оплату», «Отменил оплату» различались. */
const ACT_ICON: Record<string, string> = {
  payment: "M3 6.5h18v11H3z M12 9.5v5 M9.5 12h5",
  payment_set: "M3 6.5h18v11H3z M8.5 15.5v-2l4.5-4.5 2 2-4.5 4.5z",
  payment_cancel: "M3 6.5h18v11H3z M10 10l4 4 M14 10l-4 4",
  payment_fix: "M3 6.5h18v11H3z M8 12.5l2.5 2.5 5-5",
};
const actIcon = (action: string) =>
  ACT_ICON[action] ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ACT_ICON[action]} />
    </svg>
  ) : null;

/** Запись журнала — карточка: сначала главное (время, что сделано, раздел, кто, метки), по нажатию — все действия группы таблицей. */
function FeedItem({ group, first, last }: { group: AuditEntry[]; first: boolean; last: boolean }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const a = group[0];
  const c = CAT[a.cat] ?? CAT[""];
  const d = describe(a, nav);
  const who = a.user_name || a.user_login || "Система";
  const at = new Date(a.created_at);
  const n = group.length;
  return (
    <div className={"au-c2" + (open ? " open" : "") + (a.cat === "delete" ? " del" : "") + (first ? " first" : "") + (last ? " last" : "")}>
      <div
        className="au-c2-h"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={(e) => !(e.target as Element).closest("button") && setOpen(!open)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(!open))}
      >
        <span className="au-c2-time" title={at.toLocaleString("ru-RU")}>
          {hhmm(a.created_at)}
        </span>
        <span className="au-c2-ic">{actIcon(a.action) ?? c.icon}</span>
        <span className="au-c2-main">
          <span className="au-c2-t">{verbOnly(d.verb)}</span>
          <span className="au-c2-sub">
            <span>{c.label}</span>
            <i />
            <Avatar name={who} size={18} />
            <span>{who}</span>
          </span>
        </span>
        <span className="au-c2-d">{d.details}</span>
        <span className="au-c2-nn">{n > 1 && <em className="au-c2-n">×{n}</em>}</span>
        <span className="au-c2-ch" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </div>
      {open && <AuTable group={group} />}
    </div>
  );
}

/** Строка в раскрытой карточке: время, что сделано, подробности (каждая метка отдельно), кто. */
/** Подпись к объекту записи — чтобы подробности читались: «Товар: …», «Клиент: …», «Код: …». */
const OBJ_LABEL: Record<string, string> = { item: "Товар", customer: "Клиент", order: "Клиент", batch: "Партия", user: "Сотрудник", shipment: "Накладная", import: "Файл" };

/** Метки подробностей → пары «подпись: значение» (Chip с k, Diff «было → стало»), чтобы разложить их по колонкам. */
function pairsOf(node: ReactNode): { k: string; v: ReactNode; tone?: string }[] {
  const out: { k: string; v: ReactNode; tone?: string }[] = [];
  Children.forEach(node, (el) => {
    if (!isValidElement(el)) return;
    const p = el.props as { k?: string; tone?: string; children?: ReactNode; label?: string; from?: string; to?: string };
    if (el.type === Chip) out.push({ k: p.k ?? "Ещё", v: p.children, tone: p.tone });
    else if (el.type === Diff)
      out.push({
        k: p.label ?? "Изменение",
        v: (
          <>
            <s className="au-was">{p.from}</s> <span className="au-arr">→</span> <b>{p.to}</b>
          </>
        ),
      });
    else if (p.children) out.push(...pairsOf(p.children));
  });
  return out;
}

/** Раскрытая группа — таблица: «Время · Действие · <колонки по данным: Товар, Клиент, Код, Сумма, Товары, Изменения> · Кто». */
function AuTable({ group }: { group: AuditEntry[] }) {
  const nav = useNavigate();
  // действие о нескольких товарах — отдельной строкой на каждый товар (время, действие, клиент, товар, код, кто)
  const rows = group.flatMap((a) => {
    const d = describe(a, nav);
    const code = a.entity === "item" ? a.item_code : null;
    const base = {
      a,
      d,
      who: a.user_name || a.user_login || "Система",
      code,
      sum: d.verb.match(/\d[\d\s,.]*\s*с(?=\s|$)/)?.[0] ?? null,
      pairs: [...(/«([^»]*)»/.test(d.verb) && /^перевёл/.test(d.verb) ? [{ k: "Куда перевёл", v: d.verb.match(/«([^»]*)»/)?.[1] as ReactNode }] : []), ...(code && /^принял на склад/.test(d.verb) ? [] : pairsOf(d.details))],
      item: null as { id: number; name: string; code: string | null } | null,
      rk: String(a.id),
    };
    const list = a.items_info ?? [];
    return list.length ? list.map((it) => ({ ...base, item: it, code: it.code, rk: a.id + "-" + it.id })) : [base];
  });
  const a0 = group[0];
  const cols: { key: string; title: string; cell: (r: (typeof rows)[number]) => ReactNode }[] = [];
  if (rows.some((r) => r.d.obj)) cols.push({ key: "obj", title: OBJ_LABEL[a0.entity] ?? "Объект", cell: (r) => r.d.obj });
  if (rows.some((r) => r.d.sub)) cols.push({ key: "sub", title: a0.entity === "item" ? "Клиент" : "Ещё", cell: (r) => r.d.sub });
  // телефон клиента — везде, где есть клиент (сам клиент, владелец товара, заказчик)
  const phoneOf = (a: AuditEntry) => (a.entity === "customer" ? a.customer_phone : a.entity === "item" ? a.item_customer_phone : a.entity === "order" ? a.order_customer_phone : null) || null;
  if (rows.some((r) => phoneOf(r.a))) cols.push({ key: "phone", title: "Телефон", cell: (r) => phoneOf(r.a) && <span className="au-phone">{phoneOf(r.a)}</span> });
  if (rows.some((r) => r.item)) cols.push({ key: "inames", title: "Товар", cell: (r) => r.item?.name });
  // у товара ещё нет кода — на его месте скелетон, появится, когда код добавят
  if (rows.some((r) => r.code || r.item)) cols.push({ key: "code", title: "Код", cell: (r) => (r.code ? <code className="au-code">{r.code}</code> : r.item ? <span className="wt-skel au-skel" title="Код ещё не добавлен" /> : null) });
  if (rows.some((r) => r.sum)) cols.push({ key: "sum", title: "Сумма", cell: (r) => r.sum && <b className="au-sum">{r.sum}</b> });
  const keys: string[] = [];
  rows.forEach((r) => r.pairs.forEach((p) => !keys.includes(p.k) && keys.push(p.k)));
  keys.forEach((k) =>
    cols.push({
      key: "p:" + k,
      title: k,
      cell: (r) => {
        const ps = r.pairs.filter((p) => p.k === k);
        if (!ps.length) return null;
        return (
          <span className={"au-pv" + (ps.some((p) => p.tone === "danger") ? " danger" : "")}>
            {ps.map((p, i) => (
              <span key={i}>
                {i > 0 && ", "}
                {p.v}
              </span>
            ))}
          </span>
        );
      },
    })
  );
  const tpl = { gridTemplateColumns: `62px minmax(0,1fr) ${cols.map((c) => (c.key === "inames" ? "minmax(0,1.3fr)" : c.key === "code" ? "minmax(150px,1fr)" : c.key === "sum" ? "minmax(90px,.8fr)" : "minmax(0,1fr)")).join(" ")} max-content` };
  return (
    <div className="au-c2-scroll">
    <div className="au-c2-body" style={tpl}>
      <div className="au-c2-th">
        <span>Время</span>
        <span>Действие</span>
        {cols.map((c) => (
          <span key={c.key}>{c.title}</span>
        ))}
        <span>Кто</span>
      </div>
      {rows.map((r) => (
        <div key={r.rk} className="au-c2-r">
          <span className="au-c2-rt">{hhmm(r.a.created_at)}</span>
          <span className="au-c2-rp">{verbOnly(r.d.verb)}</span>
          {cols.map((c) => (
            <span key={c.key} className="au-c2-rc">
              {c.cell(r) || <span className="au-r-none">—</span>}
            </span>
          ))}
          <span className="au-c2-rw">
            <Avatar name={r.who} size={20} />
            <span>{r.who}</span>
          </span>
        </div>
      ))}
    </div>
    </div>
  );
}

const AVATAR_BG = ["linear-gradient(135deg,#3a3a37,#121212)", "linear-gradient(135deg,#55534d,#1d1d1b)", "linear-gradient(135deg,#6b6862,#2a2927)"];

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

function Chip({ children, tone }: { children: ReactNode; tone?: "danger" | "green"; k?: string }) {
  return (
    <span className={"au-chip" + (tone ? " " + tone : "")}>
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
      .map((k) => (
        <Chip key={k} k="Изменено">
          {map[k] ?? k}
        </Chip>
      ));

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
      // способ оплаты пишется в журнал с 12.11.2026; у старых записей его нет — на месте скелетон
      const method = typeof obj.method === "string" ? obj.method : null;
      const how = (
        <Chip k="Способ">{method ? (method === "transfer" ? "переводом" : method === "cash" ? "наличными" : method) : <span className="wt-skel au-skel" title="Для старых записей способ не сохранялся" />}</Chip>
      );
      if (a.entity === "customer") {
        const list = (Array.isArray(newV) ? newV : Array.isArray(obj.applied) ? obj.applied : []) as { amount: number }[];
        const sum = list.reduce((s, x) => s + (x.amount ?? 0), 0);
        return {
          verb: `принял оплату ${som(sum)} от клиента`,
          obj: customer(a.customer_name, a.entity_id),
          details: (
            <>
              {how}
              {list.length > 0 && <Chip k="Распределено">{n(list.length)}</Chip>}
            </>
          ),
        };
      }
      const amount = typeof newV === "number" ? newV : Number(obj.amount ?? 0);
      if (a.entity_id) return { verb: `принял оплату ${som(amount)} за`, obj: item, sub: itemSub, details: how };
      return { verb: `принял оплату ${som(amount)} за ${n(ids)}`, details: how };
    }
    // Код присвоен товару (на приёме — неизвестный код привязан к товару).
    case "assign_code":
      return { verb: "присвоил код", obj: item, sub: itemSub, details: typeof newV === "string" ? <Chip k="Новый код">{newV}</Chip> : undefined };
    // Оплата товара выставлена вручную: было → стало.
    case "payment_set":
      return { verb: "изменил оплату", obj: item, sub: itemSub, details: <Diff label="Оплачено" from={som(Number(oldV ?? 0))} to={som(Number(newV ?? 0))} /> };
    case "payment_cancel":
      return { verb: `отменил оплату ${som(Number(oldV))} за`, obj: item, sub: itemSub };
    case "payment_fix":
      return {
        verb: "исправил оплаты из Excel",
        details: (
          <>
            {typeof oldV === "string" && <Chip k="Файл">{oldV}</Chip>}
            {typeof obj.payments === "number" && <Chip k="Оплат">{obj.payments}</Chip>}
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
      return { verb: `удалил ${what}`, obj: <Obj>{String(oldV ?? a.item_name ?? a.customer_name ?? a.batch_name ?? "").replace(/\s*\([^)]*\)\s*$/, "")}</Obj> };
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
            {Number(obj.new) > 0 && <Chip tone="green" k="Новых">{String(obj.new)}</Chip>}
            {Number(obj.update) > 0 && <Chip k="Обновлено">{String(obj.update)}</Chip>}
            {Number(obj.duplicate) > 0 && <Chip k="Дублей">{String(obj.duplicate)}</Chip>}
            {Number(obj.error) > 0 && <Chip tone="danger" k="Ошибок">{String(obj.error)}</Chip>}
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
            <Chip k="В пути">{n(transit)}</Chip>
            {missing > 0 && <Chip k="Без товара">{missing}</Chip>}
          </>
        ),
      };
    }
    case "import_waybill_undo":
      return { verb: "скрыл накладную", obj: <Obj>{String(oldV ?? "")}</Obj> };

    // Уведомления клиентам (WhatsApp).
    case "notify": {
      const w = Number(obj.weight_som ?? 0);
      return {
        verb: "уведомил клиента",
        obj: customer(a.customer_name, a.entity_id),
        details: (
          <>
            {w > 0 && <Chip k="Вес">
                {String(obj.weight_kg ?? "").replace(".", ",")} кг · {som(w)}
              </Chip>}
            <Chip k="К оплате">{som(Number(obj.total ?? 0))}</Chip>
          </>
        ),
      };
    }
    case "notify_cancel":
      return { verb: "отменил уведомление клиенту", obj: customer(a.customer_name, a.entity_id) };
  }
  return { verb: "изменил запись", obj: item ?? undefined, sub: itemSub };
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
