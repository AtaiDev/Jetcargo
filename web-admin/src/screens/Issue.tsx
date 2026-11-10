/**
 * Выдача товара клиенту — «касса».
 *
 *  - сверху табло кассы: очередь, что выдали сегодня, сколько приняли наличными и переводом, сколько в долг;
 *  - слева — очередь выдачи: только уведомлённые клиенты, у которых на складе есть уведомлённый товар;
 *    поиск по имени, телефону или коду товара — неуведомлённых найдёт, но выдать не даст;
 *  - справа — касса выбранного клиента: уведомлённые товары галочками, вес из уведомления, долг за товар,
 *    как платит (наличные / перевод) и сколько (весь долг / часть / в долг) — и «Выдать»;
 *  - ниже — «Забрали в долг» (принять оплату) и история выдач на высоту экрана.
 * Выдача в долг сохраняет долг: он виден здесь, в карточке клиента и в финансах, пока клиент не оплатит.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import {
  getCustomer,
  issueItems,
  issueLookup,
  listCredit,
  listIssues,
  listNotify,
  payCustomer,
  type CreditRow,
  type CustomerBrief,
  type CustomerCard,
  type IssueList,
  type IssueRow,
  type Item,
  type NotifyRow,
} from "../api/domain";
import { Confirm, periodOf, type Period, type PeriodKey } from "../components/cargo";
import ItemModal from "../components/ItemModal";
import CountUp from "../design/CountUp";
import { css } from "../design/css";
import { I_SEARCH, Svg } from "../design/icons";
import { Page } from "../design/table";
import { ModalError } from "../design/ui";
import { parseMoney, som, todayIso } from "../lib/cargo";
import { emit, useDebounced, useRefresh } from "../lib/events";
import { HomeHead } from "./overview/Home";

type Toast = (kind: "success" | "error", text: string) => void;

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmtKg = (kg: number) => kg.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const letters = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

/** Значки кассы — линейные, в одном стиле. */
const I = {
  cash: ["M2 7h20v10H2z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M6 12h.01M18 12h.01"],
  card: ["M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Z", "M2 10h20", "M6 15h4"],
  bell: ["M10.27 21a2 2 0 0 0 3.46 0", "M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"],
  check: ["M20 6 9 17l-5-5"],
  close: ["M18 6 6 18", "M6 6l12 12"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  box: ["M21 8 12 3 3 8v8l9 5 9-5V8Z", "m3 8 9 5 9-5", "M12 13v8"],
};
function Ico({ d, size = 16, sw = 1.8 }: { d: string[]; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

/** Карточки клиентов, уже открытые или наведённые в очереди: касса открывается сразу, без пустой паузы. */
const cardCache = new Map<number, CustomerCard>();
function prefetch(id: number) {
  if (!cardCache.has(id)) getCustomer(id).then((c) => cardCache.set(id, c)).catch(() => undefined);
}

/** Сколько взять с уведомлённого клиента: вес по уведомлениям + долг за уведомлённый товар. */
function dueOf(r: NotifyRow) {
  const weight = r2(r.notices.reduce((s, n) => s + n.weight_som, 0));
  const kg = r2(r.notices.reduce((s, n) => s + (n.weight_kg ?? 0), 0));
  const items = r.items.filter((i) => i.notified);
  const debt = r2(items.reduce((s, i) => s + i.debt, 0));
  return { weight, kg, debt, total: r2(weight + debt), count: items.length };
}

export default function Issue({ toast }: { isDesktop: boolean; toast: Toast }) {
  const [params, setParams] = useSearchParams();
  const customerId = Number(params.get("customer")) || null;
  const [notify, setNotify] = useState<NotifyRow[] | null>(null);
  const [today, setToday] = useState<IssueList | null>(null);
  const [credit, setCredit] = useState<CreditRow[] | null>(null);

  const load = useCallback(() => {
    listNotify()
      .then((d) => setNotify(d.rows))
      .catch(() => setNotify([]));
    listIssues({ since: dayStartIso(todayIso()), limit: 6, tz: -new Date().getTimezoneOffset() })
      .then(setToday)
      .catch(() => setToday(null));
    listCredit()
      .then(setCredit)
      .catch(() => setCredit([]));
  }, []);
  useEffect(load, [load]);
  useRefresh(load);

  // В очереди — уведомлённые клиенты, у которых на складе есть уведомлённый товар.
  const queue = (notify ?? []).filter((r) => r.notices.length > 0 && dueOf(r).count > 0);
  const pick = (id: number | null) => {
    setParams(id ? { customer: String(id) } : {}, { replace: true });
    // На узком экране касса ниже очереди — плавно подвозим к ней.
    if (id && window.innerWidth <= 1180) setTimeout(() => document.querySelector(".is-k")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const s = today?.summary;
  const creditSum = r2((credit ?? []).reduce((a, r) => a + r.debt, 0));

  return (
    <Page size="wide">
      <div className="ov is">
        <HomeHead title="Выдача" />

        {/* ===== Сводка кассы ===== */}
        <section className="is-top">
          <TopCard
            icon={I.cash}
            label="Принято сегодня"
            value={today ? som(r2((s?.cash ?? 0) + (s?.transfer ?? 0))) : null}
            foot={
              today && (
                <>
                  <span className="is-tf-split">
                    <i style={{ flexGrow: s?.cash || (s?.transfer ? 0 : 1) }} />
                    <i className="t" style={{ flexGrow: s?.transfer ?? 0 }} />
                  </span>
                  <span className="is-tf-row">
                    <span className="is-tf-k">
                      <i />
                      нал <b>{som(s?.cash ?? 0)}</b>
                    </span>
                    <span className="is-tf-k t">
                      <i />
                      перевод <b>{som(s?.transfer ?? 0)}</b>
                    </span>
                  </span>
                </>
              )
            }
          />
          <TopCard
            icon={I.bell}
            label="Ждут выдачи"
            value={notify ? `${queue.length} ${plural(queue.length, "клиент", "клиента", "клиентов")}` : null}
            foot={
              notify && (
                <span className="is-tf-row">
                  <span className="is-tf-avs">
                    {queue.slice(0, 4).map((r) => (
                      <i key={r.id}>{letters(r.name)}</i>
                    ))}
                    {!queue.length && <em>очередь пуста</em>}
                  </span>
                  <span className="is-tf-r">
                    к оплате <b>{som(r2(queue.reduce((a, r) => a + dueOf(r).total, 0)))}</b>
                  </span>
                </span>
              )
            }
            onClick={queue.length ? () => pick(queue[0].id) : undefined}
          />
          <TopCard
            icon={I.check}
            label="Выдано сегодня"
            value={today ? `${s?.items ?? 0} ${plural(s?.items ?? 0, "товар", "товара", "товаров")}` : null}
            foot={
              today && (
                <span className="is-tf-row">
                  <span>
                    клиентов <b>{s?.customers ?? 0}</b>
                  </span>
                  <span className="is-tf-r">
                    на <b>{som(s?.sale ?? 0)}</b>
                  </span>
                </span>
              )
            }
          />
          <TopCard
            icon={I.clock}
            label="Забрали в долг"
            value={credit ? som(creditSum) : null}
            warn={creditSum > 0}
            foot={
              credit && (
                <span className="is-tf-row">
                  <span>{credit.length ? `${credit.length} ${plural(credit.length, "клиент", "клиента", "клиентов")} должны` : "никто не должен"}</span>
                  {credit.length > 0 && <span className="is-tf-r">смотреть ↓</span>}
                </span>
              )
            }
            onClick={credit?.length ? () => document.querySelector(".is-cr")?.scrollIntoView({ behavior: "smooth", block: "start" }) : undefined}
          />
        </section>

        <div className="is-grid">
          <Queue rows={notify ? queue : null} selected={customerId} onPick={pick} />
          {customerId ? (
            <Kassa key={customerId} customerId={customerId} row={(notify ?? []).find((r) => r.id === customerId) ?? null} loading={!notify} toast={toast} onClose={() => pick(null)} onNext={() => pick(queue.find((r) => r.id !== customerId)?.id ?? null)} />
          ) : (
            <KassaIdle waiting={queue.length} />
          )}
        </div>

        <CreditList rows={credit} toast={toast} onPaid={load} />
        <IssueHistory toast={toast} />
      </div>
    </Page>
  );
}

// --- Табло ------------------------------------------------------------------------------------

function TopCard({ icon, label, value, foot, warn, onClick }: { icon: string[]; label: string; value: string | null; foot: ReactNode; warn?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="is-tc-h">
        <span className="is-tc-i">
          <Ico d={icon} size={15} />
        </span>
        <small>{label}</small>
        {warn && <span className="is-tc-dot" />}
      </span>
      {value === null ? <span className="sk" style={{ width: "50%", height: 26, margin: "3px 0" }} /> : <b className="is-tc-v">{<CountUp text={value} />}</b>}
      <span className="is-tf">{foot || <span className="sk" style={{ width: "70%", height: 10 }} />}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="is-tc link" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="is-tc">{body}</div>
  );
}

// --- Очередь ----------------------------------------------------------------------------------

function Queue({ rows, selected, onPick }: { rows: NotifyRow[] | null; selected: number | null; onPick: (id: number) => void }) {
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [found, setFound] = useState<CustomerBrief[] | null>(null);

  useEffect(() => {
    if (q.length < 2) {
      setFound(null);
      return;
    }
    let alive = true;
    issueLookup(q)
      .then((r) => alive && setFound(r))
      .catch(() => alive && setFound([]));
    return () => {
      alive = false;
    };
  }, [q]);

  const ids = new Set((rows ?? []).map((r) => r.id));
  const shown = found ? (rows ?? []).filter((r) => found.some((f) => f.id === r.id)) : (rows ?? []);
  // Нашлись, но не уведомлены — выдать нельзя, пока не уведомили.
  const notReady = (found ?? []).filter((f) => !ids.has(f.id) && f.in_stock > 0);
  const choose = (id: number) => {
    onPick(id);
    setQuery("");
  };

  return (
    <aside className="ov-card paper is-q">
      <div className="is-q-h">
        <h2 className="ov-card-title">Очередь</h2>
        <span className="is-q-n">{rows ? rows.length : "…"}</span>
        <small>уведомлены, ждут выдачи</small>
      </div>
      <label className="rx-as-in">
        <Svg paths={I_SEARCH} size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && shown.length === 1 && choose(shown[0].id)}
          placeholder="Имя, телефон или код товара"
          aria-label="Поиск клиента"
          autoComplete="off"
        />
      </label>
      <div className="is-q-list thin-scroll">
        {!rows ? (
          <div className="nf-ghosts">{Array.from({ length: 6 }, (_, i) => <QGhost key={i} i={i} />)}</div>
        ) : (
          <>
            {shown.map((r, i) => (
              <QRow key={r.id} r={r} n={i + 1} active={selected === r.id} onClick={() => choose(r.id)} onHover={() => prefetch(r.id)} />
            ))}
            {notReady.map((c) => (
              <button key={c.id} type="button" className="is-qr off" onClick={() => nav("/notify")} title="Сначала уведомите клиента">
                <span className="is-qr-stub">
                  <Ico d={I.bell} size={15} />
                </span>
                <span className="is-qr-body">
                  <span className="is-qr-top">
                    <b>{c.name}</b>
                  </span>
                  <span className="is-qr-chips">
                    <i>не уведомлён</i>
                    <i>{c.in_stock} на складе</i>
                  </span>
                </span>
                <span className="is-qr-go">уведомить →</span>
              </button>
            ))}
            {shown.length === 0 && !notReady.length && (
              <div className="nf-none">
                <b>{found ? "Никого не нашли" : "Очередь пуста"}</b>
                <small>{found ? "проверьте имя, телефон или код" : "клиенты появятся после уведомления в WhatsApp"}</small>
              </div>
            )}
            <div className="nf-ghosts">{Array.from({ length: Math.max(0, 8 - shown.length - notReady.length) }, (_, i) => <QGhost key={i} i={i} faded />)}</div>
          </>
        )}
      </div>
    </aside>
  );
}

function QRow({ r, n, active, onClick, onHover }: { r: NotifyRow; n: number; active: boolean; onClick: () => void; onHover: () => void }) {
  const d = dueOf(r);
  const sent = r.notices.reduce((a, x) => (x.sent_at < a ? x.sent_at : a), r.notices[0]?.sent_at ?? "");
  const days = sent ? Math.max(0, Math.floor((Date.now() - new Date(sent).getTime()) / 86400000)) : 0;
  return (
    <button type="button" className={"is-qr" + (active ? " on" : "")} onClick={onClick} onPointerEnter={onHover} onFocus={onHover} style={{ animationDelay: `${Math.min(n, 10) * 25}ms` }}>
      <span className="is-qr-stub">
        <small>№</small>
        <b>{String(n).padStart(2, "0")}</b>
      </span>
      <span className="is-qr-body">
        <span className="is-qr-top">
          <b>{r.name}</b>
          {days > 0 && <em>ждёт {days} {plural(days, "день", "дня", "дней")}</em>}
        </span>
        <span className="is-qr-chips">
          <i>
            {d.count} {plural(d.count, "товар", "товара", "товаров")}
            {d.kg > 0 ? ` · ${fmtKg(d.kg)} кг` : ""}
          </i>
          {d.debt > 0 && <i className="debt">долг {som(d.debt)}</i>}
          {r.status === "more" && <i title="Пришли после уведомления — их сначала уведомят">+{r.fresh}</i>}
        </span>
      </span>
      <span className="is-qr-r">
        <b>{d.total > 0 ? som(d.total) : "0 с"}</b>
        <small>{d.total > 0 ? "к оплате" : "забрать"}</small>
      </span>
    </button>
  );
}

function QGhost({ i, faded }: { i: number; faded?: boolean }) {
  return (
    <div className="is-qr ghost" style={faded ? { opacity: Math.max(0.2, 0.75 - i * 0.14) } : undefined} aria-hidden>
      <span className="is-qr-stub" />
      <span className="is-qr-body">
        <span className="sk" style={{ width: `${[56, 44, 64, 50, 60, 42][i % 6]}%`, height: 10 }} />
        <span className="sk" style={{ width: "40%", height: 16, marginTop: 6, borderRadius: 999 }} />
      </span>
      <span className="sk" style={{ width: 56, height: 10, marginRight: 4 }} />
    </div>
  );
}

// --- Касса ------------------------------------------------------------------------------------

type PayMode = "full" | "part" | "none";
type Method = "cash" | "transfer";
type Done = { count: number; paid: number; left: number; kg: number; weightSom: number; method: Method };

function Kassa({ customerId, row, loading, toast, onClose, onNext }: { customerId: number; row: NotifyRow | null; loading: boolean; toast: Toast; onClose: () => void; onNext: () => void }) {
  const nav = useNavigate();
  const [card, setCard] = useState<CustomerCard | null>(() => cardCache.get(customerId) ?? null);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [payMode, setPayMode] = useState<PayMode>("full");
  const [method, setMethod] = useState<Method>("cash");
  const [partial, setPartial] = useState("");
  const partRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const load = useCallback(() => {
    getCustomer(customerId)
      .then((c) => {
        cardCache.set(customerId, c);
        setCard(c);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить клиента")));
  }, [customerId]);
  useEffect(load, [load]);
  useRefresh(load);

  // Выдаём только уведомлённое: новые товары сначала уведомляют (взвешивают).
  const notified = useMemo(() => new Set((row?.items ?? []).filter((i) => i.notified).map((i) => i.id)), [row]);
  const stock = useMemo(() => (card?.items ?? []).filter((i) => i.status === "in_stock" && notified.has(i.id)), [card, notified]);
  const hidden = (card?.items ?? []).filter((i) => i.status === "in_stock" && !notified.has(i.id)).length;
  // По умолчанию отмечено всё уведомлённое.
  useEffect(() => {
    setSelected((prev) => (prev ? new Set([...prev].filter((id) => stock.some((i) => i.id === id))) : stock.length ? new Set(stock.map((i) => i.id)) : prev));
  }, [stock]);
  const sel = selected ?? new Set<number>();
  const chosen = stock.filter((i) => sel.has(i.id));
  const sum = r2(chosen.reduce((s, i) => s + i.sale, 0));
  const debt = r2(chosen.reduce((s, i) => s + i.debt, 0));
  const parsed = parseMoney(partial);
  const badPay = payMode === "part" && parsed !== null && (Number.isNaN(parsed) || parsed > debt);
  const pay = payMode === "full" ? debt : payMode === "part" && !badPay ? (parsed ?? 0) : 0;
  const remaining = r2(Math.max(0, debt - pay));
  const kg = card?.pending_weight?.kg ?? 0;
  const weightSom = card?.pending_weight?.som ?? 0;
  /** Сколько взять сейчас: вес по уведомлению (всегда сразу) + оплата товара. */
  const takeNow = r2(weightSom + pay);

  useEffect(() => {
    setPayMode("full");
    setPartial("");
  }, [debt]);
  useEffect(() => {
    if (payMode === "part") partRef.current?.focus();
  }, [payMode]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s ?? []);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function doIssue() {
    setError("");
    const r = await issueItems({ customer_id: customerId, item_ids: chosen.map((i) => i.id), payment_amount: pay || undefined, weight_som: weightSom, method });
    toast("success", `Выдано товаров: ${r.items.length}${takeNow ? `, взято ${som(takeNow)}` : ""}${remaining ? `, в долг ${som(remaining)}` : ""}`);
    setDone({ count: r.items.length, paid: pay, left: remaining, kg, weightSom, method });
    setConfirm(false);
    setSelected(null);
    load();
    emit("cargo:changed");
  }

  function issue() {
    if (!chosen.length || busy || badPay) return;
    if (remaining > 0) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    doIssue()
      .catch((e) => setError(apiError(e)))
      .finally(() => setBusy(false));
  }

  if (!card || loading) {
    return <section className="ov-card paper is-k">{error ? <ModalError text={error} /> : <div className="nf-sk">{[40, 140, 120].map((h, i) => <span key={i} className="sk" style={{ height: h, width: i ? undefined : "40%" }} />)}</div>}</section>;
  }

  const c = card.customer;
  const allOn = stock.length > 0 && chosen.length === stock.length;
  // Когда ушло последнее уведомление — видно в шапке кассы.
  const last = row?.notices.reduce((a, n) => (n.sent_at > a ? n.sent_at : a), "") ?? "";
  const sentAt = last ? new Date(last).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " ·") : "";
  const status = !chosen.length ? "отметьте товары" : badPay ? "сумма больше долга" : remaining > 0 ? `в долг останется ${som(remaining)}` : debt > 0 || weightSom > 0 ? `${method === "transfer" ? "переводом" : "наличными"} · долг закрыт` : "всё оплачено заранее";
  return (
    <section className="ov-card paper is-k">
      <header className="is-kh">
        <span className="nf-head-av">{letters(c.name)}</span>
        <span className="nf-head-id">
          <button type="button" onClick={() => nav(`/customers/${c.id}`)} title="Открыть клиента">
            {c.name}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </button>
          <span>{c.phone || "без телефона"}</span>
        </span>
        {sentAt && (
          <span className="is-kh-chip" title="Когда ушло уведомление в WhatsApp">
            <Ico d={I.bell} size={13} />
            уведомлён {sentAt}
          </span>
        )}
        <button type="button" className="is-x" onClick={onClose} title="Закрыть" aria-label="Закрыть">
          <Ico d={I.close} size={15} sw={2} />
        </button>
      </header>

      {done && !stock.length ? (
        <div className="is-done">
          <span className="is-done-i">
            <Ico d={I.check} size={26} sw={2.4} />
          </span>
          <b>
            Выдано {done.count} {plural(done.count, "товар", "товара", "товаров")}
          </b>
          <small>
            {done.paid + done.weightSom > 0 ? `принято ${som(done.paid + done.weightSom)} · ${done.method === "transfer" ? "переводом" : "наличными"}` : "оплата не нужна"}
            {done.left ? ` · в долг ${som(done.left)}` : ""}
          </small>
          <button type="button" className="ov-btn sm dark" onClick={onNext}>
            Следующий в очереди
          </button>
        </div>
      ) : !row || !stock.length ? (
        <div className="is-done">
          <span className="is-done-i off">
            <Ico d={I.bell} size={22} />
          </span>
          <b>{hidden ? "Товар ещё не уведомлён" : "На складе у клиента ничего нет"}</b>
          <small>{hidden ? `${hidden} ${plural(hidden, "товар", "товара", "товаров")} на складе — сначала уведомите клиента и посчитайте вес` : "выдать можно только то, что принято на склад"}</small>
          {hidden > 0 && (
            <button type="button" className="ov-btn sm dark" onClick={() => nav("/notify")}>
              Перейти к уведомлению
            </button>
          )}
        </div>
      ) : (
        <div className="is-k2">
          {/* Что отдаём */}
          <div className="is-items">
            <div className="is-items-h">
              <button type="button" className={"is-check" + (allOn ? " on" : chosen.length ? " half" : "")} onClick={() => setSelected(allOn ? new Set() : new Set(stock.map((i) => i.id)))} aria-label={allOn ? "Снять все" : "Выбрать все"}>
                <Ico d={allOn ? I.check : ["M6 12h12"]} size={12} sw={3} />
              </button>
              <h3>Отдаём клиенту</h3>
              <small>
                {chosen.length} из {stock.length}
              </small>
            </div>
            <div className="is-items-list thin-scroll">
              {stock.map((it, i) => (
                <ItemLine key={it.id} i={i} it={it} on={sel.has(it.id)} onToggle={() => toggle(it.id)} onOpen={() => setOpen(it.id)} />
              ))}
              <div className="nf-ghosts">
                {Array.from({ length: Math.max(0, 6 - stock.length) }, (_, k) => (
                  <div key={k} className="is-il ghost" aria-hidden style={{ opacity: Math.max(0.2, 0.75 - k * 0.15) }}>
                    <span className="sk" style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <span className="is-il-n">
                      <span className="sk" style={{ width: `${[58, 44, 64, 50, 40, 56][k]}%`, height: 9 }} />
                      <span className="sk" style={{ width: "32%", height: 7, marginTop: 6 }} />
                    </span>
                    <span className="sk" style={{ width: 56, height: 9 }} />
                  </div>
                ))}
              </div>
            </div>
            {hidden > 0 && (
              <button type="button" className="is-hidden" onClick={() => nav("/notify")}>
                <Ico d={I.bell} size={14} />
                ещё {hidden} {plural(hidden, "товар", "товара", "товаров")} без уведомления — не выдаём
              </button>
            )}
          </div>

          {/* Чек к оплате */}
          <aside className="is-bill">
            <div className="is-bill-paper">
              <div className="is-bill-h">
                <b>Чек выдачи</b>
                <small>{chosen.length ? `${chosen.length} ${plural(chosen.length, "товар", "товара", "товаров")}` : "ничего не выбрано"}</small>
              </div>
              <div className="is-bill-rows">
                <div className="nf-pay-r">
                  <span>Сумма товаров</span>
                  <i />
                  <b>{chosen.length ? som(sum) : "—"}</b>
                </div>
                <div className="nf-pay-r">
                  <span>Долг за товар</span>
                  <i />
                  <b>{debt > 0 ? som(debt) : "нет"}</b>
                </div>
                <div className="nf-pay-r">
                  <span>{kg ? `Вес · ${fmtKg(kg)} кг` : "Вес"}</span>
                  <i />
                  <b>{weightSom > 0 ? som(weightSom) : "—"}</b>
                </div>
                {remaining > 0 && (
                  <div className="nf-pay-r credit">
                    <span>Остаётся в долг</span>
                    <i />
                    <b>{som(remaining)}</b>
                  </div>
                )}
              </div>
              <div className="is-bill-total">
                <span>
                  <small>Взять сейчас</small>
                  <em>{status}</em>
                </span>
                <b key={takeNow}>{som(chosen.length ? takeNow : 0)}</b>
              </div>
            </div>

            <div className="is-method" role="radiogroup" aria-label="Как платит">
              {(
                [
                  ["cash", "Наличные", I.cash],
                  ["transfer", "Перевод", I.card],
                ] as [Method, string, string[]][]
              ).map(([k, label, icon]) => (
                <button key={k} type="button" role="radio" aria-checked={method === k} className={method === k ? "on" : ""} onClick={() => setMethod(k)}>
                  <Ico d={icon} size={17} />
                  {label}
                </button>
              ))}
            </div>
            {debt > 0 && (
              <Seg
                value={payMode}
                onChange={(m) => {
                  setPayMode(m as PayMode);
                  if (m === "part") setPartial("");
                }}
                options={[
                  ["full", "Весь долг"],
                  ["part", "Часть"],
                  ["none", "В долг"],
                ]}
              />
            )}
            {debt > 0 && payMode === "part" && (
              <label className={"is-part" + (badPay ? " bad" : "")}>
                <span>Принимаем за товар</span>
                <input ref={partRef} value={partial} onChange={(e) => setPartial(e.target.value)} onKeyDown={(e) => e.key === "Enter" && issue()} inputMode="decimal" placeholder={`до ${som(debt)}`} aria-label="Сколько принимаем" />
                <small>с</small>
              </label>
            )}
            {error && <ModalError text={error} />}
            <button type="button" className={"is-go" + (remaining > 0 ? " credit" : "")} disabled={!chosen.length || busy || badPay} onClick={issue}>
              {busy ? "Выдаю…" : !chosen.length ? "Выберите товары" : remaining > 0 ? "Выдать в долг" : `Выдать ${chosen.length} ${plural(chosen.length, "товар", "товара", "товаров")}`}
              <Ico d={I.arrow} size={15} sw={2.2} />
            </button>
          </aside>
        </div>
      )}

      {confirm && (
        <Confirm
          title="Выдать в долг?"
          danger={false}
          confirmLabel="Выдать в долг"
          text={
            <>
              {takeNow > 0 && (
                <>
                  Сейчас берём <b style={css(NUM + ";font-weight:500")}>{som(takeNow)}</b> {method === "transfer" ? "переводом" : "наличными"}
                  {weightSom ? <> (вес {fmtKg(kg)} кг — {som(weightSom)})</> : null}.{" "}
                </>
              )}
              В долг остаётся <b style={css(NUM + ";font-weight:500")}>{som(remaining)}</b>. Клиент попадёт в «Забрали в долг» — долг виден в его карточке и в финансах, пока он не оплатит.
            </>
          }
          onClose={() => setConfirm(false)}
          onConfirm={doIssue}
        />
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ItemLine({ it, i, on, onToggle, onOpen }: { it: Item; i: number; on: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <div className={"is-il" + (on ? " on" : "")} style={{ animationDelay: `${60 + Math.min(i, 8) * 35}ms` }}>
      <button type="button" className={"is-check" + (on ? " on" : "")} onClick={onToggle} aria-label={on ? "Не выдавать" : "Выдать"}>
        {on && <Ico d={I.check} size={12} sw={3} />}
      </button>
      <button type="button" className="is-il-n" onClick={onOpen} title="Открыть товар">
        <b>{it.name}</b>
        <small>
          {it.code || "без кода"} · {it.qty} шт
        </small>
      </button>
      <span className="is-il-s">
        <b>{it.sale > 0 ? som(it.sale) : "—"}</b>
        <small>{it.sale <= 0 ? "только вес" : it.debt > 0 ? `долг ${som(it.debt)}` : "оплачено"}</small>
      </span>
    </div>
  );
}

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string, string[]?][] }) {
  const ix = Math.max(0, options.findIndex(([k]) => k === value));
  return (
    <div className="is-seg" role="radiogroup" style={{ "--i": ix, "--n": options.length } as CSSProperties}>
      <span className="is-seg-thumb" aria-hidden />
      {options.map(([k, label, icon]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          {icon && <Ico d={icon} size={14} />}
          {label}
        </button>
      ))}
    </div>
  );
}

// --- Пока клиент не выбран: касса свободна --------------------------------------------------------

function KassaIdle({ waiting }: { waiting: number }) {
  return (
    <section className="ov-card paper is-k is-idle">
      <div className="is-orb" aria-hidden>
        <i />
        <i />
        <i />
        <span className="is-orb-ring" />
        <span className="is-orb-core">
          <Ico d={I.box} size={26} />
        </span>
      </div>
      <b>Касса свободна</b>
      <small>{waiting ? `В очереди ${waiting} ${plural(waiting, "клиент", "клиента", "клиентов")} — выберите слева, откроется чек выдачи` : "Очередь пуста — клиенты появятся после уведомления в WhatsApp"}</small>
      <div className="is-steps">
        {["Клиент", "Товары", "Оплата", "Выдать"].map((t, i) => (
          <span key={t} style={{ animationDelay: `${i * 0.6}s` }}>
            <em>{i + 1}</em>
            {t}
          </span>
        ))}
      </div>
    </section>
  );
}

// --- Забрали в долг ---------------------------------------------------------------------------

function CreditList({ rows, toast, onPaid }: { rows: CreditRow[] | null; toast: Toast; onPaid: () => void }) {
  if (rows && !rows.length) return null;
  const total = r2((rows ?? []).reduce((a, r) => a + r.debt, 0));
  return (
    <section className="ov-card paper is-cr">
      <div className="is-cr-h">
        <span className="is-cr-i">
          <Ico d={I.clock} size={18} />
        </span>
        <span className="is-cr-t">
          <h2 className="ov-card-title">Забрали в долг</h2>
          <small>товар у клиента, оплата ещё не поступила — примите, когда клиент рассчитается</small>
        </span>
        {rows && (
          <span className="is-cr-sum">
            <small>
              {rows.length} {plural(rows.length, "клиент", "клиента", "клиентов")} должны
            </small>
            <b>{som(total)}</b>
          </span>
        )}
      </div>
      <div className="is-cr-list">
        {!rows ? Array.from({ length: 4 }, (_, i) => <DebtGhost key={i} i={i} />) : rows.map((r, i) => <DebtCard key={r.id} r={r} i={i} toast={toast} onPaid={onPaid} />)}
        {/* Пустые места ряда — бледными карточками */}
        {rows && Array.from({ length: (4 - (rows.length % 4)) % 4 }, (_, i) => <DebtGhost key={"g" + i} i={i} faded />)}
      </div>
    </section>
  );
}

function DebtGhost({ i, faded }: { i: number; faded?: boolean }) {
  return (
    <div className="is-dc ghost" aria-hidden style={faded ? { opacity: Math.max(0.25, 0.7 - i * 0.18) } : undefined}>
      <div className="is-dc-top">
        <span className="sk rx-sk-av" />
        <span className="is-dc-who">
          <span className="sk" style={{ width: `${[58, 46, 64][i % 3]}%`, height: 10 }} />
          <span className="sk" style={{ width: "44%", height: 8, marginTop: 6 }} />
        </span>
      </div>
      <div className="is-dc-mid">
        <span>
          <span className="sk" style={{ width: 34, height: 8 }} />
          <span className="sk" style={{ width: 90, height: 18, marginTop: 6 }} />
        </span>
      </div>
      <span className="sk" style={{ height: 38, borderRadius: 11 }} />
    </div>
  );
}

function DebtCard({ r, i, toast, onPaid }: { r: CreditRow; i: number; toast: Toast; onPaid: () => void }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(r.debt));
  const [method, setMethod] = useState<Method>("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const days = Math.max(0, Math.floor((Date.now() - new Date(r.since).getTime()) / 86400000));
  const d = new Date(r.since);
  const parsed = parseMoney(amount);
  const bad = parsed === null || Number.isNaN(parsed) || parsed <= 0 || parsed > r.debt + 0.001;
  const half = Math.ceil(r.debt / 2);

  async function pay() {
    if (bad || busy || parsed === null) return;
    setBusy(true);
    setError("");
    try {
      await payCustomer(r.id, { amount: parsed, item_ids: r.item_ids, method, comment: "долг после выдачи" });
      toast("success", `${r.name.split(/\s+/)[0]} — принято ${som(parsed)}${method === "transfer" ? " переводом" : " наличными"}`);
      emit("cargo:changed");
      onPaid();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={"is-dc" + (open ? " open" : "") + (days >= 7 ? " late" : "")} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
      <div className="is-dc-top">
        <span className="rx-av">{letters(r.name)}</span>
        <button type="button" className="is-dc-who" onClick={() => nav(`/customers/${r.id}`)} title="Открыть клиента">
          <b>{r.name}</b>
          <small>{r.phone}</small>
        </button>
        <span className="is-dc-age" title={`Забрал ${d.toLocaleDateString("ru-RU")}`}>
          {days === 0 ? "сегодня" : `${days} ${plural(days, "день", "дня", "дней")}`}
        </span>
      </div>

      <div className="is-dc-mid">
        <span>
          <small>Долг</small>
          <b>{som(r.debt)}</b>
        </span>
        <em>
          {r.items} {plural(r.items, "товар", "товара", "товаров")} · забрал {d.getDate()} {MON[d.getMonth()]}
        </em>
      </div>

      {!open ? (
        <button
          type="button"
          className="is-dc-go"
          onClick={() => {
            setOpen(true);
            setAmount(String(r.debt));
          }}
        >
          Принять оплату
          <Ico d={I.arrow} size={14} sw={2.2} />
        </button>
      ) : (
        <div className="is-dc-pay">
          <div className="is-method">
            {(
              [
                ["cash", "Наличные", I.cash],
                ["transfer", "Перевод", I.card],
              ] as [Method, string, string[]][]
            ).map(([k, label, icon]) => (
              <button key={k} type="button" className={method === k ? "on" : ""} onClick={() => setMethod(k)}>
                <Ico d={icon} size={15} />
                {label}
              </button>
            ))}
          </div>
          <label className={"is-part" + (bad && amount ? " bad" : "")}>
            <span>Сумма</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && pay()} inputMode="decimal" aria-label="Сумма оплаты" autoFocus />
            <small>с</small>
          </label>
          <div className="is-dc-quick">
            <button type="button" className={parsed === r.debt ? "on" : ""} onClick={() => setAmount(String(r.debt))}>
              весь долг
            </button>
            {r.debt >= 2 && (
              <button type="button" className={parsed === half ? "on" : ""} onClick={() => setAmount(String(half))}>
                половина
              </button>
            )}
          </div>
          {error && <ModalError text={error} />}
          <div className="is-dc-actions">
            <button type="button" className="is-dc-cancel" onClick={() => setOpen(false)}>
              Отмена
            </button>
            <button type="button" className="is-go" disabled={bad || busy} onClick={pay}>
              {busy ? "Сохраняю…" : `Принять ${parsed && !bad ? som(parsed) : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- История выдач -----------------------------------------------------------------------------

const PERIODS: [PeriodKey, string][] = [
  ["today", "Сегодня"],
  ["7", "7 дней"],
  ["month", "Месяц"],
  ["30", "30 дней"],
  ["90", "90 дней"],
  ["year", "Год"],
];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** Выдач на одной странице истории. */
const fit = 10;

type DayStat = { day: string; issues: number; items: number; sale: number };

/** Столбики по дням периода; длинный период — по неделям. */
function bars(from: string, to: string, byDay: DayStat[]): { key: string; label: string; date: string; sale: number; issues: number; items: number }[] {
  const map = new Map(byDay.map((d) => [d.day, d]));
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00`); localDay(d) <= to; d.setDate(d.getDate() + 1)) days.push(localDay(d));
  const step = days.length > 31 ? 7 : 1;
  const out = [];
  for (let i = 0; i < days.length; i += step) {
    const part = days.slice(i, i + step);
    const sale = part.reduce((a, k) => a + (map.get(k)?.sale ?? 0), 0);
    const issues = part.reduce((a, k) => a + (map.get(k)?.issues ?? 0), 0);
    const items = part.reduce((a, k) => a + (map.get(k)?.items ?? 0), 0);
    const d0 = new Date(`${part[0]}T00:00:00`);
    const d1 = new Date(`${part[part.length - 1]}T00:00:00`);
    out.push({
      key: part[0],
      label: step === 1 && days.length <= 7 ? WD[d0.getDay()] : "",
      date: step > 1 ? `${d0.getDate()} ${MON[d0.getMonth()]} — ${d1.getDate()} ${MON[d1.getMonth()]}` : `${d0.getDate()} ${MONTHS[d0.getMonth()]}, ${WD[d0.getDay()]}`,
      sale,
      issues,
      items,
    });
  }
  return out;
}

/** «сегодня», «вчера» или «4 ноя». */
function dayShort(iso: string): string {
  const day = localDay(new Date(iso));
  if (day === todayIso()) return "сегодня";
  if (day === todayIso(-1)) return "вчера";
  const d = new Date(iso);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

function IssueHistory({ toast }: { toast: Toast }) {
  const nav = useNavigate();
  const [period, setPeriod] = useState<Period>(() => periodOf("7"));
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<IssueList | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => {
    listIssues({ q, since: dayStartIso(period.date_from), until: dayStartIso(period.date_to, 1), limit: fit, offset: page * fit, tz: -new Date().getTimezoneOffset() })
      .then(setData)
      .catch(() => setData({ rows: [], total: 0, summary: { items: 0, qty: 0, sale: 0, customers: 0 }, by_day: [] }));
  }, [q, period.date_from, period.date_to, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(0), [q, period.date_from, period.date_to]);
  useRefresh(load);

  const s = data?.summary;
  const credit = s?.credit ?? 0;
  const now = s?.paid_now ?? 0;
  const before = s ? Math.max(0, r2(s.sale - credit - now)) : 0;
  const taken = r2((s?.cash ?? 0) + (s?.transfer ?? 0));
  const list = bars(period.date_from, period.date_to, data?.by_day ?? []);
  const max = Math.max(1, ...list.map((b) => b.sale));
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / fit));
  const rows = data?.rows ?? [];

  return (
    <section className="ov-card paper hx">
      <header className="hx-h">
        <span className="hx-title">
          <h2 className="ov-card-title">История выдач</h2>
          <small>{periodText(period.date_from, period.date_to)}</small>
        </span>
        <div className="ih-periods">
          {PERIODS.map(([k, label]) => (
            <button key={k} type="button" className={period.key === k ? "on" : ""} onClick={() => setPeriod(periodOf(k))}>
              {label}
            </button>
          ))}
        </div>
        <label className="rx-as-in hx-search">
          <Svg paths={I_SEARCH} size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Клиент или телефон" aria-label="Поиск по истории" />
        </label>
      </header>

      {/* Итоги периода и выдачи по дням */}
      <div className="hx-kpis">
        <div className="hx-k main">
          <small>Выдано на сумму</small>
          <b>{s ? <CountUp text={som(s.sale)} /> : "—"}</b>
          <em>{data ? `${total} ${plural(total, "выдача", "выдачи", "выдач")} · ${s?.customers ?? 0} ${plural(s?.customers ?? 0, "клиент", "клиента", "клиентов")} · ${s?.items ?? 0} ${plural(s?.items ?? 0, "товар", "товара", "товаров")}` : "загружаю…"}</em>
        </div>
        <div className="hx-k">
          <small>Принято при выдаче</small>
          <b>{som(taken)}</b>
          <span className="hx-split" title="наличные / перевод">
            <i style={{ flexGrow: s?.cash || (s?.transfer ? 0 : 1) }} />
            <i className="t" style={{ flexGrow: s?.transfer ?? 0 }} />
          </span>
          <em>
            нал {som(s?.cash ?? 0)} · пер {som(s?.transfer ?? 0)}
          </em>
        </div>
        <div className="hx-k">
          <small>Оплачено заранее</small>
          <b>{som(before)}</b>
          <em>{s && s.sale ? `${Math.round((before / s.sale) * 100)}% от выданного` : "—"}</em>
        </div>
        <div className="hx-k">
          <small>За вес</small>
          <b>{som(s?.weight_som ?? 0)}</b>
          <em>{s?.weight_kg ? `${fmtKg(s.weight_kg)} кг` : "без веса"}</em>
        </div>
        <div className={"hx-k" + (credit > 0 ? " credit" : "")}>
          <small>Отдали в долг</small>
          <b>{som(credit)}</b>
          <em>{credit > 0 ? "ждём оплату" : "долгов нет"}</em>
        </div>
        <div className="hx-bars" aria-label="Выдачи по дням">
          {list.map((b, i) => (
            <span key={b.key} className={"hx-bar" + (b.key === todayIso() ? " now" : "") + (i < 2 ? " l" : i > list.length - 3 ? " r" : "")}>
              <i style={{ height: `${b.sale ? Math.max(8, (b.sale / max) * 100) : 4}%` }} />
              {b.label && <small>{b.label}</small>}
              {/* Подсказка при наведении: день, сумма, сколько выдач и товаров, доля от лучшего дня */}
              <span className="hx-tip" role="tooltip">
                <small>{b.key === todayIso() ? "Сегодня" : b.date}</small>
                <b>{b.sale ? som(b.sale) : "выдач не было"}</b>
                {b.sale > 0 && (
                  <>
                    <em>
                      {b.issues} {plural(b.issues, "выдача", "выдачи", "выдач")} · {b.items} {plural(b.items, "товар", "товара", "товаров")}
                    </em>
                    <span className="hx-tip-bar">
                      <i style={{ width: `${Math.round((b.sale / max) * 100)}%` }} />
                    </span>
                  </>
                )}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Таблица выдач: ровно столько строк, сколько помещается */}
      <div className="hx-table">
        <div className="hx-tr hx-th">
          <span>Когда</span>
          <span>Клиент</span>
          <span>Товары</span>
          <span className="r">Вес</span>
          <span className="r">Сумма</span>
          <span>Оплата</span>
        </div>
        <div className="hx-body">
          {!data
            ? Array.from({ length: 6 }, (_, i) => <HxGhost key={i} i={i} />)
            : rows.map((r, i) => <HxRow key={r.id} r={r} i={i} onClient={() => nav(`/customers/${r.customer_id}`)} onItem={setOpen} />)}
          {data && !rows.length && (
            <>
              {Array.from({ length: 4 }, (_, i) => (
                <HxGhost key={i} i={i} faded />
              ))}
              <div className="rx-ghost-msg">
                <span className="rx-ghost-i">
                  <Svg paths={I_SEARCH} size={16} />
                </span>
                <span>
                  <b>{q ? "Ничего не нашли" : "Выдач за период нет"}</b>
                  <small>{q ? "проверьте имя или телефон" : "выберите другой период"}</small>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="hx-foot">
        <small>{total ? `${page * fit + 1}–${Math.min(total, (page + 1) * fit)} из ${total}` : "нет выдач"}</small>
        <span className="hx-pages">
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Назад">
            ‹
          </button>
          <b>
            {page + 1} / {pages}
          </b>
          <button type="button" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="Дальше">
            ›
          </button>
        </span>
      </footer>
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </section>
  );
}

function HxRow({ r, i, onClient, onItem }: { r: IssueRow; i: number; onClient: () => void; onItem: (id: number) => void }) {
  const sale = r2(r.items.reduce((a, x) => a + x.sale, 0));
  const paid = r2(r.paid_now ?? 0);
  const credit = r2(r.items.reduce((a, x) => a + ((x as Item & { issue_credit?: number | null }).issue_credit ? x.debt : 0), 0));
  const first = r.items[0];
  return (
    <div className={"hx-tr" + (credit > 0 ? " credit" : "")} style={{ animationDelay: `${i * 25}ms` }}>
      <span className="hx-when">
        <b>{hhmm(r.issued_at)}</b>
        <small>{dayShort(r.issued_at)}</small>
      </span>
      <button type="button" className="hx-who" onClick={onClient} title="Открыть клиента">
        <span className="rx-av">{letters(r.customer_name)}</span>
        <span>
          <b>{r.customer_name}</b>
          <small>
            {r.customer_phone}
            {r.user_login ? ` · ${r.user_login}` : ""}
          </small>
        </span>
      </button>
      <span className="hx-items">
        {first && (
          <button type="button" onClick={() => onItem(first.id)} title={r.items.map((x) => x.name).join(", ")}>
            {first.name}
            {first.qty > 1 ? ` × ${first.qty}` : ""}
          </button>
        )}
        {r.items.length > 1 && <em>+{r.items.length - 1}</em>}
      </span>
      <span className="hx-num r">
        {r.weight_kg ? (
          <>
            <b>{fmtKg(r.weight_kg)} кг</b>
            <small>+{som(r.weight_som ?? 0)}</small>
          </>
        ) : (
          <small>—</small>
        )}
      </span>
      <span className="hx-num r">
        <b>{som(sale)}</b>
        <small>
          {r.items.length} {plural(r.items.length, "товар", "товара", "товаров")}
        </small>
      </span>
      <span className={"rx-pill-st " + (credit > 0 ? "bad" : paid > 0 ? "ok" : "info")}>{credit > 0 ? `в долг ${som(credit)}` : paid > 0 ? `принято ${som(paid)}` : "оплачено заранее"}</span>
    </div>
  );
}

function HxGhost({ i, faded }: { i: number; faded?: boolean }) {
  return (
    <div className="hx-tr ghost" aria-hidden style={faded ? { opacity: Math.max(0.15, 0.8 - i * 0.1) } : undefined}>
      <span className="sk" style={{ width: 38, height: 10 }} />
      <span className="hx-who">
        <span className="sk rx-sk-av" />
        <span>
          <span className="sk" style={{ width: `${[60, 46, 70, 52, 64, 44, 56, 50][i % 8]}%`, height: 10 }} />
          <span className="sk" style={{ width: "40%", height: 8, marginTop: 6 }} />
        </span>
      </span>
      <span className="sk" style={{ width: "55%", height: 18, borderRadius: 999 }} />
      <span className="sk" style={{ width: 50, height: 10, marginLeft: "auto" }} />
      <span className="sk" style={{ width: 60, height: 10, marginLeft: "auto" }} />
      <span className="sk" style={{ width: 90, height: 10 }} />
    </div>
  );
}

// --- Мелочи ---------------------------------------------------------------------------------------

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

/** Локальная полночь дня (YYYY-MM-DD) в ISO; addDays — сдвиг. */
function dayStartIso(d: string, addDays = 0): string {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + addDays);
  return x.toISOString();
}

const p2 = (n: number) => String(n).padStart(2, "0");
/** YYYY-MM-DD по местному времени. */
const localDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

function periodText(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (from === to) return `${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]} — ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}
