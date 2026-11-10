/**
 * Уведомления клиентам о поступлении товара — через WhatsApp.
 *
 *  - сверху: сколько клиентов ещё не уведомлены (и доля уведомлённых), кто уведомлён и ждёт,
 *    сколько возьмём за вес, долг за товар на складе и адрес выдачи (он попадает в сообщение);
 *  - слева — клиенты с товаром на складе: сначала кого ещё не уведомили (дольше ждут — выше);
 *  - справа — уведомление выбранному клиенту: что пришло, вес посылки → сумма за вес (кг × цена
 *    1 кг, вверх до целого сома), долг за товар и итог к оплате; рядом — готовое сообщение.
 *    «Отправить в WhatsApp» открывает чат с текстом и отмечает клиента уведомлённым.
 *    Сумму за вес возьмут на «Выдаче».
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { cancelNotify, listNotify, sendNotify, updateSettings, type Notice, type NotifyList, type NotifyRow } from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { Confirm } from "../components/cargo";
import CountUp from "../design/CountUp";
import { I_CHECK, I_SEARCH, Svg } from "../design/icons";
import { Page } from "../design/table";
import { HButton, ModalError, ModalShell, btnPrimary, useModalClose } from "../design/ui";
import { dateTime, som } from "../lib/cargo";
import { emit, useRefresh } from "../lib/events";
import { HomeHead } from "./overview/Home";

type Toast = (kind: "success" | "error", text: string) => void;
type Tab = "todo" | "sent" | "all";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Вверх до целого сома: 100,01 → 101 (так же считает сервер). */
const ceilSom = (n: number) => Math.ceil(r2(n) - 1e-9) || 0;
const pc = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Статус клиента — приглушённой точкой, как на «Приёме». */
const STATUS: Record<NotifyRow["status"], { label: string; dot: "warn" | "info" | "ok" }> = {
  new: { label: "Не уведомлён", dot: "warn" },
  more: { label: "Есть новые", dot: "info" },
  sent: { label: "Уведомлён", dot: "ok" },
};

const TABS: [Tab, string][] = [
  ["todo", "Ждут"],
  ["sent", "Уведомлены"],
  ["all", "Все"],
];

/** Значки сводки — линейные, в одном стиле. */
const I = {
  bell: ["M10.27 21a2 2 0 0 0 3.46 0", "M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"],
  sent: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z", "m9 12 2 2 4-4"],
  scale: ["m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z", "m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z", "M7 21h10", "M12 3v18", "M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"],
  wallet: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  pin: ["M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0", "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  pen: ["M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5Z", "m15 5 4 4"],
  bag: ["M6.5 8h11l2.3 12H4.2L6.5 8Z", "M9 8a3 3 0 0 1 6 0"],
};
function Ico({ d, size = 18 }: { d: string[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

export default function Notify({ toast }: { isDesktop?: boolean; toast: Toast }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [data, setData] = useState<NotifyList | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("todo");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<number | null>(null);

  const load = useCallback(() => {
    listNotify()
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить список")));
  }, []);
  useEffect(load, [load]);
  useRefresh(load);

  const rows = data?.rows ?? [];
  const todo = rows.filter((r) => r.status !== "sent");
  const sent = rows.filter((r) => r.status === "sent");
  const q = query.trim().toLowerCase().replace(/\s/g, "");
  const shown = (tab === "todo" ? todo : tab === "sent" ? sent : rows).filter(
    (r) => !q || r.name.toLowerCase().replace(/\s/g, "").includes(q) || r.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "~") || r.items.some((i) => i.code.toLowerCase().includes(q))
  );
  const pendingWeight = r2(rows.reduce((s, r) => s + r.notices.reduce((a, n) => a + n.weight_som, 0), 0));
  const stockDebt = rows.reduce((s, r) => s + r.stock_debt, 0);
  const stockSale = rows.reduce((s, r) => s + r.stock_sale, 0);
  const current = rows.find((r) => r.id === sel) ?? shown[0] ?? null;
  const share = pc(sent.length, rows.length);
  const tabIx = TABS.findIndex(([k]) => k === tab);
  const count = { todo: todo.length, sent: sent.length, all: rows.length };

  // Выбранный клиент пропал из списка (например, его товар выдали) — выбираем первого.
  useEffect(() => {
    if (sel !== null && !rows.some((r) => r.id === sel)) setSel(null);
  }, [rows, sel]);

  return (
    <Page size="wide">
      <div className="ov nf">
        <HomeHead title="Уведомления" />

        {/* ===== Сводка: кого уведомить, что возьмём, адрес ===== */}
        <section className="nf-top">
          <div className="nf-hero">
            <span className="nf-hero-i">
              <Ico d={I.bell} size={20} />
            </span>
            <span className="nf-hero-t">
              <small>Ждут уведомления</small>
              <b>{data ? <CountUp text={String(todo.length)} /> : "—"}</b>
              <em>{data ? `${plural(todo.length, "клиент", "клиента", "клиентов")} с товаром на складе` : "загружаю…"}</em>
            </span>
            <Ring pct={share} label="уведомлены" dark />
          </div>
          <Kpi icon={I.sent} label="Уведомлены, ждём" value={data && String(sent.length)} sub="ещё не забрали товар" ring={data ? share : undefined} onClick={() => setTab("sent")} />
          <Kpi icon={I.scale} label="Возьмём за вес" value={data && som(pendingWeight)} sub={data ? `${som(data.tariff.weight_rate_som)} за 1 кг · на «Выдаче»` : ""} />
          <Kpi icon={I.wallet} label="Долг за товар" value={data && som(stockDebt)} sub="на складе, не оплачено" ring={data ? pc(stockDebt, stockSale) : undefined} />
          <AddressCard value={data?.pickup_address ?? null} canEdit={isAdmin} toast={toast} onSaved={load} />
        </section>

        {error && <ModalError text={error} />}

        <div className="nf-grid">
          {/* ===== Клиенты ===== */}
          <aside className="ov-card paper nf-list">
            <div className="rx-modes-t" role="tablist" aria-label="Кого показать" style={{ "--i": tabIx } as CSSProperties}>
              <span className="rx-mt-thumb" aria-hidden />
              {TABS.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                  <b>{label}</b>
                  <span className="nf-tab-n">{data ? count[k] : "…"}</span>
                </button>
              ))}
            </div>
            <label className="rx-as-in">
              <Svg paths={I_SEARCH} size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, телефон или код товара" aria-label="Поиск клиента" />
            </label>
            <div className="nf-rows thin-scroll">
              {!data ? (
                <div className="nf-ghosts">{Array.from({ length: 7 }, (_, i) => <GhostRow key={i} i={i} />)}</div>
              ) : (
                <>
                  {shown.map((r, i) => (
                    <ClientRow key={r.id} r={r} i={i} active={current?.id === r.id} onClick={() => setSel(r.id)} />
                  ))}
                  {shown.length === 0 && (
                    <div className="nf-none">
                      <b>{q ? "Никого не нашли" : tab === "todo" ? "Все уведомлены" : tab === "sent" ? "Пока никого не уведомили" : "На складе нет товаров"}</b>
                      <small>{q ? "проверьте имя, телефон или код" : tab === "todo" ? "новые появятся, когда товар примут на склад" : ""}</small>
                    </div>
                  )}
                  {/* Заглушки только заполняют остаток — прокрутку не вызывают */}
                  <div className="nf-ghosts">{Array.from({ length: Math.max(0, 7 - shown.length) }, (_, i) => <GhostRow key={"g" + i} i={i} faded />)}</div>
                </>
              )}
            </div>
          </aside>

          {/* ===== Уведомление ===== */}
          {current && data ? (
            <Composer key={current.id + ":" + current.notices.length} row={current} data={data} toast={toast} onChanged={load} />
          ) : (
            <section className="ov-card paper nf-comp nf-comp-empty">
              {!data ? (
                <div className="nf-sk" aria-hidden>
                  <span className="sk" style={{ width: "40%", height: 18 }} />
                  <span className="sk" style={{ height: 120 }} />
                  <span className="sk" style={{ height: 64 }} />
                  <span className="sk" style={{ height: 180 }} />
                </div>
              ) : (
                <div className="nf-pick4">
                  <span className="nf-pick4-i">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5Z" />
                      <path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01" />
                    </svg>
                  </span>
                  <b>Выберите клиента слева</b>
                  <small>введите вес посылки — сообщение для WhatsApp соберётся само</small>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </Page>
  );
}

// --- Сводка ---------------------------------------------------------------------------------------

/** Кольцо доли: тонкое, с процентом внутри. */
/** Доля — «водой» в скруглённом окошке: уровень = процент, поверхность мягко колышется. */
function Ring({ pct, label, dark }: { pct: number; label: string; dark?: boolean }) {
  const y = (1 - Math.max(0, Math.min(100, pct)) / 100) * 46;
  return (
    <span className={"nf-wave" + (dark ? " dark" : "")} title={`${pct}% ${label}`}>
      <svg viewBox="0 0 64 52" preserveAspectRatio="none" aria-hidden>
        <g className="lvl" style={{ transform: `translateY(${y}px)` }}>
          <path className="w2" d="M0 6 Q8 1 16 6 T32 6 T48 6 T64 6 T80 6 T96 6 T112 6 T128 6 V70 H0Z" />
          <path className="w1" d="M0 6 Q8 1 16 6 T32 6 T48 6 T64 6 T80 6 T96 6 T112 6 T128 6 V70 H0Z" />
        </g>
      </svg>
      <b>{pct}%</b>
    </span>
  );
}

function Kpi({ icon, label, value, sub, ring, onClick }: { icon: string[]; label: string; value?: string | null; sub: string; ring?: number; onClick?: () => void }) {
  const body = (
    <>
      <span className="nf-k-i">
        <Ico d={icon} />
      </span>
      <span className="nf-k-t">
        <small>{label}</small>
        {value == null ? <span className="sk" style={{ width: "60%", height: 20, margin: "3px 0" }} /> : <b>{<CountUp text={value} />}</b>}
        <em>{sub}</em>
      </span>
      {ring !== undefined && <Ring pct={ring} label={label.toLowerCase()} />}
    </>
  );
  return onClick ? (
    <button type="button" className="nf-k link" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="nf-k">{body}</div>
  );
}

/** Адрес выдачи — пишется в каждом сообщении; меняет администратор. */
function AddressCard({ value, canEdit, toast, onSaved }: { value: string | null; canEdit: boolean; toast: Toast; onSaved: () => void }) {
  const [text, setText] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(value ?? ""), [value]);
  const dirty = value !== null && text.trim() !== value;

  async function save() {
    setBusy(true);
    try {
      await updateSettings({ pickup_address: text.trim() });
      toast("success", "Адрес выдачи сохранён");
      onSaved();
    } catch (e) {
      toast("error", apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className={"nf-k nf-addr" + (value !== null && !value ? " need" : "")}>
      <span className="nf-k-i">
        <Ico d={I.pin} />
      </span>
      <span className="nf-k-t">
        <small>Адрес выдачи · в сообщении</small>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && dirty && save()}
          disabled={!canEdit || value === null}
          placeholder={canEdit ? "например, ул. Ленина 1" : "не указан"}
          aria-label="Адрес выдачи"
        />
        <em>{dirty ? "Enter — сохранить" : "клиент увидит его в каждом сообщении"}</em>
      </span>
      {canEdit &&
        (dirty ? (
          <button type="button" className="nf-addr-save" onClick={save} disabled={busy}>
            {busy ? "…" : "Сохранить"}
          </button>
        ) : (
          <span className="nf-addr-pen" aria-hidden>
            <Ico d={I.pen} size={15} />
          </span>
        ))}
    </label>
  );
}

// --- Список клиентов --------------------------------------------------------------------------------

const letters = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

function ClientRow({ r, i, active, onClick }: { r: NotifyRow; i: number; active: boolean; onClick: () => void }) {
  const st = STATUS[r.status];
  const days = r.first_arrived ? Math.max(0, Math.floor((Date.now() - new Date(r.first_arrived).getTime()) / 86400000)) : 0;
  return (
    <button type="button" className={"nf-row" + (active ? " on" : "")} onClick={onClick} style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}>
      <span className="rx-av">{letters(r.name)}</span>
      <span className="nf-row-m">
        <b>{r.name}</b>
        <small>
          {r.items.length} {plural(r.items.length, "товар", "товара", "товаров")} · {days === 0 ? "с сегодня" : `${days} ${plural(days, "день", "дня", "дней")}`}
        </small>
      </span>
      <span className="nf-row-r">
        <span className={"rx-pill-st " + st.dot}>{r.status === "more" ? `+${r.fresh} новых` : st.label}</span>
        <small>{r.stock_debt > 0 ? `долг ${som(r.stock_debt)}` : "оплачено"}</small>
      </span>
    </button>
  );
}

function GhostRow({ i, faded }: { i: number; faded?: boolean }) {
  return (
    <div className="nf-row ghost" style={faded ? { opacity: Math.max(0.2, 0.75 - i * 0.12) } : undefined} aria-hidden>
      <span className="sk rx-sk-av" />
      <span className="nf-row-m">
        <span className="sk" style={{ width: `${[62, 48, 70, 55, 66, 44, 58][i % 7]}%`, height: 10 }} />
        <span className="sk" style={{ width: "38%", height: 8, marginTop: 7 }} />
      </span>
      <span className="sk" style={{ width: 74, height: 10 }} />
    </div>
  );
}

// --- Уведомление -------------------------------------------------------------------------------------

/** Вес из поля: «1,07», «1.07» → кг до 0,01; пусто — null; ошибка — NaN. */
function parseKg(v: string): number | null {
  const t = v.replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 10000) return NaN;
  return Math.round(n * 100) / 100;
}
const fmtKg = (kg: number) => kg.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
/** Сумма для сообщения: «1 230 сом», «246,40 сом» (обычные пробелы — WhatsApp не путает). */
const msgSom = (n: number) => `${som(n).replace(/ с$/, "").replace(/ /g, " ")} сом`;

/**
 * Как открывать WhatsApp. Приложение WhatsApp для Windows портит эмодзи в тексте из ссылки (они
 * становятся «�»), поэтому на компьютере по умолчанию — WhatsApp Web, где текст приходит целым.
 * «Приложение» — текст копируется в буфер, открывается чат; остаётся Ctrl+V и Enter.
 * На телефоне — обычная ссылка wa.me с готовым текстом (там всё работает).
 */
type WaMode = "web" | "app";
const IS_MOBILE = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const WA_KEY = "rb_wa_mode";
function readWaMode(): WaMode {
  try {
    return localStorage.getItem(WA_KEY) === "app" ? "app" : "web";
  } catch {
    return "web";
  }
}

/** Номер для wa.me: только цифры с кодом страны (0700… → 996700…). */
function waPhone(phone: string): string | null {
  let d = phone.replace(/\D/g, "");
  if (d.length === 9) d = "996" + d;
  else if (d.length === 10 && d.startsWith("0")) d = "996" + d.slice(1);
  return d.length >= 11 ? d : null;
}

/** «5 октября» — с какого дня товар лежит на складе (для напоминания). */
const dayWords = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

type MsgData = { name: string; address: string; count: number; kg: number; weightSom: number; debt: number; total: number; since: string | null };

/**
 * Текст для WhatsApp. Первое уведомление — «товар прибыл»: адрес, сколько товаров, вес, долг и итог.
 * Напоминание (все товары уже в уведомлении) — другой, мягкий текст: товар ждёт, просим забрать.
 * Количество штук не пишем — только сколько товаров, чтобы не путать клиента.
 */
function buildMessage(p: MsgData & { remind: boolean }): string {
  const first = p.name.trim().split(/\s+/)[0] || p.name.trim();
  const kg = p.kg ? fmtKg(p.kg).replace(/ /g, " ") : "";
  const lines = p.remind
    ? [
        `Здравствуйте, ${first}! 👋`,
        `Напоминаем: ваш товар уже ждёт вас на складе 📦`,
        `Пожалуйста, заберите его в удобное для вас время 🙏`,
        "",
        p.address ? `📍 Адрес выдачи: ${p.address}` : null,
        p.since ? `📅 На складе с ${dayWords(p.since)}` : null,
        `🛍 Товаров: ${p.count} шт`,
        p.kg ? `⚖️ Вес посылки: ${kg} кг` : null,
        p.kg ? `💵 Оплата за вес: ${msgSom(p.weightSom)}` : null,
        `🧾 Долг за товар: ${msgSom(p.debt)}`,
        "━━━━━━━━━━━━━━",
        p.total > 0 ? `💰 К оплате при получении: ${msgSom(p.total)}` : `✅ Всё оплачено — просто приходите`,
        "",
        "Будем рады вас видеть! 😊",
      ]
    : [
        `Здравствуйте, ${first}! 👋`,
        `Ваш товар прибыл и ждёт вас на складе 📦`,
        "",
        p.address ? `📍 Адрес выдачи: ${p.address}` : null,
        `🛍 Товаров: ${p.count} шт`,
        p.kg ? `⚖️ Вес посылки: ${kg} кг` : null,
        p.kg ? `💵 Оплата за вес: ${msgSom(p.weightSom)}` : null,
        `🧾 Долг за товар: ${msgSom(p.debt)}`,
        "━━━━━━━━━━━━━━",
        `💰 Итого к оплате: ${msgSom(p.total)}`,
        "",
        "Ждём вас! Спасибо, что выбираете нас 🙏",
      ];
  return lines.filter((l) => l !== null).join("\n");
}

function Composer({ row, data, toast, onChanged }: { row: NotifyRow; data: NotifyList; toast: Toast; onChanged: () => void }) {
  const nav = useNavigate();
  const [weight, setWeight] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancel, setCancel] = useState<Notice | null>(null);
  // Отправка без веса — сначала спросить: за вес тогда ничего не возьмём.
  const [noWeight, setNoWeight] = useState<null | "send" | "copy">(null);
  const [waMode, setWaModeState] = useState<WaMode>(readWaMode);
  const setWaMode = (m: WaMode) => {
    setWaModeState(m);
    try {
      localStorage.setItem(WA_KEY, m);
    } catch {
      /* не сохранится — режим действует до перезагрузки */
    }
  };
  const weightRef = useRef<HTMLInputElement>(null);
  const t = data.tariff;
  // Высота чата идёт за сообщением плавно: строки веса появляются — блок растёт без рывка.
  const chatIn = useRef<HTMLDivElement>(null);
  const [chatH, setChatH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = chatIn.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setChatH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Новый вес вводим, только когда есть товары без уведомления; иначе — напоминание без нового веса.
  const canWeigh = row.status !== "sent";

  // Цифры, набранные где угодно на странице (не в другом поле), сразу идут в «Вес посылки» — без клика.
  useEffect(() => {
    if (!canWeigh) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !/^[\d.,]$/.test(e.key)) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (document.querySelector(".md-overlay")) return;
      const input = weightRef.current;
      if (!input) return;
      e.preventDefault();
      input.focus();
      setWeight((w) => w + e.key);
      // Курсор — в конец, чтобы следующие цифры печатались после первой.
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canWeigh]);
  const kg = canWeigh ? parseKg(weight) : null;
  const bad = Number.isNaN(kg);
  // Вес × цена 1 кг в сомах (прайс, целым сомом) = точно; с клиента — вверх до целого сома.
  const rateSom = t.weight_rate_som;
  const exactSom = kg && !bad ? r2(kg * rateSom) : 0;
  const weightSom = kg && !bad ? ceilSom(exactSom) : 0;
  const prevKg = r2(row.notices.reduce((s, n) => s + (n.weight_kg ?? 0), 0));
  const prevSom = r2(row.notices.reduce((s, n) => s + n.weight_som, 0));
  const kgTotal = r2(prevKg + (kg && !bad ? kg : 0));
  const weightTotal = r2(prevSom + weightSom);
  const debt = row.stock_debt;
  const total = ceilSom(weightTotal + debt);
  const message = useMemo(
    () =>
      buildMessage({
        name: row.name,
        address: data.pickup_address,
        count: row.items.length,
        kg: kgTotal,
        weightSom: weightTotal,
        debt,
        total,
        since: row.first_arrived,
        remind: !canWeigh,
      }),
    [row, data.pickup_address, kgTotal, weightTotal, debt, total, canWeigh]
  );
  const phone = waPhone(row.phone);
  const lastNotice = row.notices[0];
  const st = STATUS[row.status];

  async function record(how: "wa" | "app" | "copy") {
    setError("");
    setBusy(true);
    try {
      await sendNotify({ customer_id: row.id, item_ids: row.items.map((i) => i.id), weight_kg: kg && !bad ? kg : undefined, weight_som: weightSom, message, phone: row.phone });
      toast(
        "success",
        how === "wa"
          ? `${row.name.split(/\s+/)[0]} — уведомление отмечено`
          : how === "app"
            ? "Текст с иконками скопирован — в WhatsApp нажмите Ctrl+V и Enter"
            : "Текст скопирован, уведомление отмечено"
      );
      emit("cargo:changed");
      onChanged();
    } catch (e) {
      setError(apiError(e, "Сообщение открыто, но отметка не сохранилась — нажмите «Скопировать и отметить»"));
    } finally {
      setBusy(false);
    }
  }

  /** Нет веса для новых товаров — сначала предупредить; иначе сразу отправить. */
  const needWeightCheck = canWeigh && !kg;
  function trySend(how: "send" | "copy") {
    if (bad || busy) return;
    if (needWeightCheck) {
      setNoWeight(how);
      return;
    }
    if (how === "send") sendWa();
    else void copy();
  }

  function sendWa() {
    if (!phone || bad || busy) return;
    const text = encodeURIComponent(message);
    // Окно — сразу по клику (иначе браузер заблокирует), отметка — следом.
    if (IS_MOBILE) {
      window.open(`https://wa.me/${phone}?text=${text}`, "_blank", "noopener");
      void record("wa");
    } else if (waMode === "web") {
      // Одна и та же вкладка WhatsApp Web — не плодим вкладки на каждого клиента.
      window.open(`https://web.whatsapp.com/send?phone=${phone}&text=${text}`, "jetcargo-wa");
      void record("wa");
    } else {
      // Приложение: текст — в буфер (эмодзи сохранятся), чат — без текста.
      void navigator.clipboard?.writeText(message).catch(() => undefined);
      window.location.href = `whatsapp://send?phone=${phone}`;
      void record("app");
    }
  }

  async function copy() {
    if (bad || busy) return;
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      /* буфер недоступен — текст виден рядом, можно выделить вручную */
    }
    void record("copy");
  }

  return (
    <section className="ov-card paper nf-comp">
      {/* Клиент */}
      <header className="nf-head">
        <span className="nf-head-av">{letters(row.name)}</span>
        <span className="nf-head-id">
          <button type="button" onClick={() => nav(`/customers/${row.id}`)} title="Открыть клиента">
            {row.name}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </button>
          <span>{row.phone || "телефон не указан"}</span>
        </span>
        <span className="nf-head-st">
          <span className={"rx-pill-st " + st.dot}>{row.status === "more" ? `Пришло ещё ${row.fresh}` : st.label}</span>
          <small>
            {row.items.length} {plural(row.items.length, "товар", "товара", "товаров")} на складе · {som(row.stock_sale)}
          </small>
        </span>
      </header>

      <div className="nf-body">
        <div className="nf-left">
          {/* Что пришло */}
          <div className="nf-sec">
            <h3>Товары на складе</h3>
            <div className="nf-items thin-scroll">
              {row.items.map((i) => (
                <div key={i.id} className="nf-item">
                  <span className="nf-item-n">
                    <b>
                      {i.name}
                      {!i.notified && row.notices.length > 0 && <em>новый</em>}
                    </b>
                    <small>{i.code || "без кода"}</small>
                  </span>
                  <span className="nf-item-q">{i.qty} шт</span>
                  <span className="nf-item-s">
                    <b>{i.sale > 0 ? som(i.sale) : "—"}</b>
                    <small>{i.sale <= 0 ? "только вес" : i.debt > 0 ? `долг ${som(i.debt)}` : "оплачено"}</small>
                  </span>
                </div>
              ))}
              <div className="nf-ghosts">
              {Array.from({ length: Math.max(0, 4 - row.items.length) }, (_, k) => (
                <div key={"g" + k} className="nf-item ghost" aria-hidden style={{ opacity: 0.8 - k * 0.2 }}>
                  <span className="nf-item-n">
                    <span className="sk" style={{ width: `${[56, 42, 64][k % 3]}%`, height: 9 }} />
                    <span className="sk" style={{ width: "34%", height: 7, marginTop: 6 }} />
                  </span>
                  <span className="sk" style={{ width: 26, height: 9, margin: "0 auto" }} />
                  <span className="sk" style={{ width: 60, height: 9, marginLeft: "auto" }} />
                </div>
              ))}
              </div>
            </div>
          </div>

          {/* Вес и итог — одной панелью внизу колонки */}
          <div className="nf-pay">
            {/* Уже уведомлён: когда, вес и сумма — на месте веса */}
            {lastNotice && (
              <div className="nf-sent">
                <span className="rx-mi">
                  <Svg paths={I_CHECK} size={15} sw={2.4} />
                </span>
                <span className="nf-weight-t">
                  <small>
                    Уведомлён {dateTime(lastNotice.sent_at)}
                    {row.notices.length > 1 ? ` · ${row.notices.length} ${plural(row.notices.length, "раз", "раза", "раз")}` : ""}
                  </small>
                  <span>
                    {prevKg > 0 ? `${fmtKg(prevKg)} кг · за вес ${som(prevSom)}` : "без веса"} · {canWeigh ? `пришло ещё ${row.fresh}` : "можно напомнить"}
                  </span>
                </span>
                <button type="button" className="nf-cancel" onClick={() => setCancel(lastNotice)} title="Отменить последнее уведомление">
                  Отменить
                </button>
              </div>
            )}
            {canWeigh && (
              <label className={"nf-weight" + (bad ? " bad" : kg ? " on" : "")}>
                <span className="rx-mi">
                  <WeightIcon />
                </span>
                <span className="nf-weight-t">
                  <small>{row.notices.length ? "Вес новой посылки" : "Вес посылки"}</small>
                  <span>
                    {bad
                      ? "введите вес числом, например 1,07"
                      : kg
                        ? `${fmtKg(kg)} кг × ${fmtNum(rateSom)} с${exactSom !== weightSom ? ` = ${som(exactSom)}, вверх до сома` : ""}`
                        : `${fmtNum(rateSom)} с за 1 кг · без веса — только долг`}
                  </span>
                </span>
                <span className="nf-weight-in">
                  <input ref={weightRef} value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.,\s]/g, ""))} inputMode="decimal" placeholder="0,00" aria-label="Вес посылки, кг" aria-invalid={bad} autoFocus={window.innerWidth > 1000} />
                  <small>кг</small>
                </span>
              </label>
            )}
            <div className="nf-pay-rows">
              <div className="nf-pay-r">
                <span>За вес{kgTotal ? ` · ${fmtKg(kgTotal)} кг` : ""}</span>
                <i />
                <b>{weightTotal > 0 ? som(weightTotal) : "—"}</b>
              </div>
              <div className="nf-pay-r">
                <span>Долг за товар</span>
                <i />
                <b>{debt > 0 ? som(debt) : "нет"}</b>
              </div>
            </div>
            <div className="nf-pay-total">
              <span>
                <b>Итого к оплате</b>
                <small>берём при выдаче</small>
              </span>
              <strong key={total}>{som(total)}</strong>
            </div>
          </div>
        </div>

        {/* Сообщение */}
        <div className="nf-right">
          <div className="nf-chat" style={chatH ? { height: chatH + 28 } : undefined}>
            <div ref={chatIn} className="nf-chat-in">
              <div className="nf-chat-day">сообщение клиенту</div>
              <div className="nf-bubble">
                {message}
                <span className="nf-bubble-time">{new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} ✓✓</span>
              </div>
            </div>
          </div>
          {error && <ModalError text={error} />}
          {!phone && <div className="nf-warn">У клиента нет телефона — скопируйте текст и отправьте вручную.</div>}
          <div className="nf-actions">
            <button
              type="button"
              className="nf-wa"
              onClick={() => trySend("send")}
              disabled={!phone || bad || busy}
              title={!phone ? "У клиента нет телефона" : IS_MOBILE || waMode === "web" ? "Откроется чат с готовым текстом" : "Текст скопируется, откроется чат — нажмите Ctrl+V и Enter"}
            >
              <WaIcon />
              {busy ? "Сохраняю…" : canWeigh ? "Отправить в WhatsApp" : "Напомнить в WhatsApp"}
            </button>
            <button type="button" className="nf-copy" onClick={() => trySend("copy")} disabled={bad || busy} title="Скопировать текст и отметить уведомление">
              Скопировать<span className="nf-more"> и отметить</span>
            </button>
          </div>
          {!IS_MOBILE && (
            <div className="nf-wamode">
              <span className="nf-wamode-seg" role="radiogroup" aria-label="Как открывать WhatsApp" style={{ "--i": waMode === "web" ? 0 : 1 } as CSSProperties}>
                <span className="nf-wamode-thumb" aria-hidden />
                <button type="button" role="radio" aria-checked={waMode === "web"} className={waMode === "web" ? "on" : ""} onClick={() => setWaMode("web")}>
                  WhatsApp Web
                </button>
                <button type="button" role="radio" aria-checked={waMode === "app"} className={waMode === "app" ? "on" : ""} onClick={() => setWaMode("app")}>
                  Приложение
                </button>
              </span>
              <small>{waMode === "web" ? "текст и иконки придут целыми" : "текст скопируется — в чате Ctrl+V и Enter"}</small>
            </div>
          )}
        </div>
      </div>

      {noWeight && (
        <ModalShell
          title="Вес посылки не указан"
          subtitle={`${row.name} · ${row.items.length} ${plural(row.items.length, "товар", "товара", "товаров")} на складе`}
          icon={<WeightIcon />}
          tone="amber"
          width={460}
          onClose={() => setNoWeight(null)}
          footer={
            <NoWeightFoot
              onSkip={() => {
                // Окно WhatsApp — прямо в этом клике, иначе браузер его заблокирует.
                if (noWeight === "send") sendWa();
                else void copy();
              }}
              onWeigh={() => weightRef.current?.focus()}
            />
          }
        >
          <div className="mf-body">
            <div className="nf-noweight">
              <b>За вес ничего не возьмём</b>
              <span>
                В сообщении будет только долг за товар{debt > 0 ? ` — ${som(debt)}` : ""}, а на «Выдаче» сумма за вес не добавится. Взвесьте посылку и введите вес, чтобы клиент сразу знал, сколько платить.
              </span>
            </div>
            <div className="mf-total">
              <span>Сейчас к оплате в сообщении</span>
              <b style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{som(total)}</b>
            </div>
          </div>
        </ModalShell>
      )}

      {cancel && (
        <Confirm
          title="Отменить уведомление?"
          text={
            <>
              Уведомление от {dateTime(cancel.sent_at)}
              {cancel.weight_som ? ` с весом ${fmtKg(cancel.weight_kg ?? 0)} кг на ${som(cancel.weight_som)}` : ""} будет отменено — эту сумму за вес на «Выдаче» не возьмут. Сообщение в WhatsApp
              останется у клиента.
            </>
          }
          confirmLabel="Отменить уведомление"
          onClose={() => setCancel(null)}
          onConfirm={async () => {
            await cancelNotify(cancel.id);
            toast("success", "Уведомление отменено");
            setCancel(null);
            emit("cargo:changed");
            onChanged();
          }}
        />
      )}
    </section>
  );
}

/** Кнопки окна «вес не указан»: закрывают окно плавно, как крестик. */
function NoWeightFoot({ onSkip, onWeigh }: { onSkip: () => void; onWeigh: () => void }) {
  const close = useModalClose();
  return (
    <>
      <HButton
        onClick={() => {
          onSkip();
          close();
        }}
        className="nt-skip"
        s=""
        hover=""
      >
        Отправить без веса
      </HButton>
      <HButton
        onClick={() => {
          close();
          setTimeout(onWeigh, 200);
        }}
        s={btnPrimary + ";min-width:150px"}
        hover="background:var(--accent-hover)"
      >
        Ввести вес
      </HButton>
    </>
  );
}

function WeightIcon(): ReactNode {
  return <Ico d={I.scale} size={16} />;
}

function WaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2a9.9 9.9 0 0 0-8.5 15.02L2 22l5.1-1.5A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3.03.9.9-2.95-.2-.31a8.2 8.2 0 1 1 6.83 3.69Zm4.5-6.14c-.25-.12-1.46-.72-1.69-.8-.23-.08-.39-.12-.55.12-.16.25-.63.8-.78.97-.14.16-.29.18-.53.06-.25-.12-1.04-.38-1.98-1.22a7.4 7.4 0 0 1-1.37-1.7c-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.31c-.23.25-.86.84-.86 2.05 0 1.2.88 2.37 1 2.53.12.16 1.73 2.64 4.2 3.7.58.25 1.04.4 1.4.52.59.19 1.12.16 1.55.1.47-.07 1.46-.6 1.66-1.18.2-.58.2-1.07.14-1.18-.06-.1-.22-.16-.47-.29Z" />
    </svg>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
