/**
 * Уведомления клиентам о поступлении товара — через WhatsApp.
 *
 *  - сверху: сколько клиентов ещё не уведомлены, сколько уведомлены и ждут, сколько взять за вес
 *    и адрес выдачи (он попадает в сообщение);
 *  - слева — клиенты с товаром на складе: сначала кого ещё не уведомили (дольше ждут — выше);
 *  - справа — уведомление выбранному клиенту: что пришло, вес посылки → сумма за вес (кг × $ за кг ×
 *    курс, до копеек), долг за товар и итог к оплате; ниже — готовое сообщение. «Отправить в WhatsApp»
 *    открывает чат с текстом и отмечает клиента уведомлённым. Сумму за вес возьмут на «Выдаче».
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { cancelNotify, listNotify, sendNotify, updateSettings, type Notice, type NotifyList, type NotifyRow } from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { Confirm } from "../components/cargo";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_CHECK, I_SEARCH, Icon, Svg } from "../design/icons";
import { Page } from "../design/table";
import { HButton, ModalError, ModalShell, btnPrimary, useModalClose } from "../design/ui";
import { dateTime, som } from "../lib/cargo";
import { emit, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
type Tab = "todo" | "sent" | "all";

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Вверх до целого сома: 100,01 → 101 (так же считает сервер). */
const ceilSom = (n: number) => Math.ceil(r2(n) - 1e-9);

const STATUS: Record<NotifyRow["status"], { label: string; fg: string; bg: string; dot: string }> = {
  new: { label: "не уведомлён", fg: "var(--amber)", bg: "var(--amber-tint)", dot: "var(--amber-dot)" },
  more: { label: "есть новые", fg: "var(--accent-strong)", bg: "var(--accent-tint)", dot: "var(--accent)" },
  sent: { label: "уведомлён", fg: "var(--green)", bg: "var(--green-tint)", dot: "var(--green-dot)" },
};

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
  const current = rows.find((r) => r.id === sel) ?? shown[0] ?? null;

  // Выбранный клиент пропал из списка (например, его товар выдали) — выбираем первого.
  useEffect(() => {
    if (sel !== null && !rows.some((r) => r.id === sel)) setSel(null);
  }, [rows, sel]);

  return (
    <Page size="wide">
      {/* Сводка */}
      <section className="nt-hero">
        <Stat tone="amber" icon={<Icon name="notify" size={18} />} label="Ждут уведомления" value={data ? String(todo.length) : null} sub={data ? `${plural(todo.length, "клиент", "клиента", "клиентов")} с товаром на складе` : ""} onClick={() => setTab("todo")} active={tab === "todo"} />
        <Stat tone="green" icon={<Svg paths={I_CHECK} size={17} sw={2.4} />} label="Уведомлены, ждём" value={data ? String(sent.length) : null} sub="ещё не забрали товар" onClick={() => setTab("sent")} active={tab === "sent"} />
        <Stat tone="violet" icon={<WeightIcon />} label="Возьмём за вес" value={data ? som(pendingWeight) : null} sub="по отправленным уведомлениям" />
        <Address value={data?.pickup_address ?? null} canEdit={isAdmin} toast={toast} onSaved={load} />
      </section>

      {error && (
        <div style={css("margin-bottom:12px")}>
          <ModalError text={error} />
        </div>
      )}

      <div className="nt-grid">
        {/* Клиенты */}
        <aside className="nt-list">
          <div className="nt-list-head">
            <div className="nt-tabs" role="tablist">
              {(
                [
                  ["todo", "Не уведомлены", todo.length],
                  ["sent", "Уведомлены", sent.length],
                  ["all", "Все", rows.length],
                ] as [Tab, string, number][]
              ).map(([k, label, n]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                  {label}
                  <span style={css(NUM + ";color:var(--text-4)")}>{data ? n : "…"}</span>
                </button>
              ))}
            </div>
            <label className="nt-search">
              <Svg paths={I_SEARCH} size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, телефон или код товара" aria-label="Поиск клиента" />
            </label>
          </div>
          <div className="nt-rows thin-scroll">
            {!data ? (
              Array.from({ length: 6 }, (_, i) => <GhostRow key={i} i={i} />)
            ) : shown.length === 0 ? (
              <div className="nt-empty">
                <span className="nt-empty-i">
                  <Svg paths={I_CHECK} size={20} sw={2.4} />
                </span>
                <span style={css("font-size:14px;font-weight:500;color:var(--text)")}>{q ? "Никого не нашли" : tab === "todo" ? "Все уведомлены" : tab === "sent" ? "Пока никого не уведомили" : "На складе нет товаров"}</span>
                <span style={css("font-size:12.5px;color:var(--text-4)")}>{q ? "Проверьте имя или телефон" : tab === "todo" ? "Новые появятся, когда товар примут на склад" : ""}</span>
              </div>
            ) : (
              <>
                {shown.map((r) => (
                  <ClientRow key={r.id} r={r} active={current?.id === r.id} onClick={() => setSel(r.id)} />
                ))}
                {shown.length < 6 && Array.from({ length: 6 - shown.length }, (_, i) => <GhostRow key={"g" + i} i={i} faded />)}
              </>
            )}
          </div>
        </aside>

        {/* Уведомление */}
        {current && data ? (
          <Composer key={current.id + ":" + current.notices.length} row={current} data={data} toast={toast} onChanged={load} />
        ) : (
          <section className="nt-comp nt-comp-empty">
            {!data ? (
              <div style={css("display:flex;flex-direction:column;gap:14px;padding:20px")} aria-hidden>
                <span className="sk" style={css("width:220px;height:16px")} />
                <span className="sk" style={css("height:110px;border-radius:14px")} />
                <span className="sk" style={css("height:70px;border-radius:14px")} />
                <span className="sk" style={css("height:220px;border-radius:14px")} />
              </div>
            ) : (
              <div className="nt-empty" style={css("flex:1")}>
                <span className="nt-empty-i">
                  <Icon name="notify" size={22} />
                </span>
                <span style={css("font-size:15px;font-weight:500;color:var(--text)")}>Выберите клиента слева</span>
                <span style={css("font-size:12.5px;color:var(--text-4)")}>введите вес посылки — сообщение для WhatsApp соберётся само</span>
              </div>
            )}
          </section>
        )}
      </div>
    </Page>
  );
}

// --- Сводка ---------------------------------------------------------------------------------------

const TONE = {
  amber: { bg: "var(--amber-tint)", fg: "var(--amber)", dot: "var(--amber-dot)" },
  green: { bg: "var(--green-tint)", fg: "var(--green)", dot: "var(--green-dot)" },
  violet: { bg: "var(--violet-tint)", fg: "var(--violet)", dot: "var(--violet-dot)" },
  sky: { bg: "var(--sky-tint)", fg: "var(--sky)", dot: "var(--sky-dot)" },
} as const;

function Stat({ tone, icon, label, value, sub, onClick, active }: { tone: keyof typeof TONE; icon: React.ReactNode; label: string; value: string | null; sub: string; onClick?: () => void; active?: boolean }) {
  const t = TONE[tone];
  const body = (
    <>
      <span className="nt-stat-i" style={{ background: t.bg, color: t.fg }}>
        {icon}
      </span>
      <span style={css("min-width:0")}>
        <span style={css("display:block;font-size:12.5px;color:var(--text-3)")}>{label}</span>
        <span style={css(NUM + ";display:block;margin-top:2px;font-size:22px;font-weight:500;line-height:1.15;color:var(--text);white-space:nowrap")}>
          {value === null ? <span className="sk" style={css("display:inline-block;width:60px;height:18px")} /> : <CountUp text={value} />}
        </span>
        <span style={css("display:block;margin-top:2px;font-size:12px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{sub}</span>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={"nt-stat click" + (active ? " on" : "")} style={{ ["--c" as string]: t.dot }} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="nt-stat">{body}</div>
  );
}

/** Адрес выдачи — пишется в каждом сообщении; меняет администратор. */
function Address({ value, canEdit, toast, onSaved }: { value: string | null; canEdit: boolean; toast: Toast; onSaved: () => void }) {
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
    <div className={"nt-stat nt-addr" + (value !== null && !value ? " need" : "")}>
      <span className="nt-stat-i" style={{ background: TONE.sky.bg, color: TONE.sky.fg }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      </span>
      <span style={css("min-width:0;flex:1")}>
        <span style={css("display:block;font-size:12.5px;color:var(--text-3)")}>Адрес выдачи · в сообщении</span>
        <span style={css("display:flex;align-items:center;gap:6px;margin-top:4px")}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dirty && save()}
            disabled={!canEdit || value === null}
            placeholder={canEdit ? "например, ул. Ленина 1" : "не указан"}
            aria-label="Адрес выдачи"
          />
          {canEdit && dirty && (
            <HButton onClick={save} disabled={busy} className="nt-save" s="" hover="">
              {busy ? "…" : "Сохранить"}
            </HButton>
          )}
        </span>
      </span>
    </div>
  );
}

// --- Список клиентов --------------------------------------------------------------------------------

const AVATAR_BG = [
  "linear-gradient(135deg,#5B7CFA,#8B5CF6)",
  "linear-gradient(135deg,#22C55E,#0EA5E9)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#EC4899,#8B5CF6)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
];

function Avatar({ name, size }: { name: string; size: number }) {
  const n = [...name].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const letters = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  return (
    <span style={mix("border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-weight:500", { width: size, height: size, fontSize: Math.round(size * 0.36), background: AVATAR_BG[n % AVATAR_BG.length] })}>
      {letters || "?"}
    </span>
  );
}

function ClientRow({ r, active, onClick }: { r: NotifyRow; active: boolean; onClick: () => void }) {
  const st = STATUS[r.status];
  const days = r.first_arrived ? Math.max(0, Math.floor((Date.now() - new Date(r.first_arrived).getTime()) / 86400000)) : 0;
  return (
    <button type="button" className={"nt-row" + (active ? " on" : "")} onClick={onClick} style={{ ["--c" as string]: st.dot }}>
      <Avatar name={r.name} size={40} />
      <span style={css("min-width:0;flex:1")}>
        <span style={css("display:block;font-size:14px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{r.name}</span>
        <span style={css(NUM + ";display:block;font-size:12.5px;color:var(--text-3)")}>{r.phone || "без телефона"}</span>
        <span style={css("display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:5px;font-size:12px;color:var(--text-4)")}>
          <span style={css(NUM)}>
            {r.items.length} {plural(r.items.length, "товар", "товара", "товаров")} · {som(r.stock_sale)}
          </span>
          <span>· на складе {days === 0 ? "с сегодня" : `${days} ${plural(days, "день", "дня", "дней")}`}</span>
        </span>
      </span>
      <span style={css("display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none")}>
        <span className="nt-badge" style={{ color: st.fg, background: st.bg }}>
          <span style={mix("width:6px;height:6px;border-radius:50%", { background: st.dot })} />
          {r.status === "more" ? `+${r.fresh} ${st.label}` : st.label}
        </span>
        {r.stock_debt > 0 && <span style={css(NUM + ";font-size:12px;color:var(--danger)")}>долг {som(r.stock_debt)}</span>}
      </span>
    </button>
  );
}

function GhostRow({ i, faded }: { i: number; faded?: boolean }) {
  return (
    <div className="nt-row ghost" style={faded ? { opacity: Math.max(0.15, 0.6 - i * 0.12) } : undefined} aria-hidden>
      <span className="sk" style={css("width:40px;height:40px;border-radius:50%;flex:none")} />
      <span style={css("flex:1;display:flex;flex-direction:column;gap:8px")}>
        <span className="sk" style={mix("height:10px", { width: `${[62, 48, 70, 55, 66, 44][i % 6]}%` })} />
        <span className="sk" style={css("width:38%;height:8px")} />
      </span>
      <span className="sk" style={css("width:70px;height:20px;border-radius:999px")} />
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
const msgSom = (n: number) => `${som(n).replace(/ с$/, "").replace(/ /g, " ")} сом`;

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
  const kg = p.kg ? fmtKg(p.kg).replace(/\u00a0/g, " ") : "";
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
  // Доллары — точно (2,996 $), иначе формула не сходится с суммой.
  const lastNotice = row.notices[0];

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
      /* буфер недоступен — текст виден ниже, можно выделить вручную */
    }
    void record("copy");
  }

  return (
    <section className="nt-comp">
      {/* Клиент */}
      <div className="nt-comp-head">
        <Avatar name={row.name} size={46} />
        <span style={css("min-width:0;flex:1")}>
          <HButton onClick={() => nav(`/customers/${row.id}`)} className="nt-name" s="" hover="" title="Открыть клиента">
            {row.name}
          </HButton>
          <span style={css(NUM + ";display:block;font-size:13px;color:var(--text-3)")}>{row.phone || "телефон не указан"}</span>
        </span>
        <span className="nt-badge big" style={{ color: STATUS[row.status].fg, background: STATUS[row.status].bg }}>
          <span style={mix("width:7px;height:7px;border-radius:50%", { background: STATUS[row.status].dot })} />
          {row.status === "more" ? `пришло ещё ${row.fresh}` : STATUS[row.status].label}
        </span>
      </div>

      <div className="nt-comp-body">
        <div className="nt-left">
          {/* Уже уведомлён: когда, сколько раз, вес и что будет дальше — одной карточкой */}
          {lastNotice && (
            <div className={"nt-status" + (canWeigh ? " more" : "")}>
              <div className="nt-status-head">
                <span className="nt-status-i">
                  <Svg paths={I_CHECK} size={16} sw={2.6} />
                </span>
                <span style={css("flex:1;min-width:0")}>
                  <span style={css("display:block;font-size:14px;font-weight:500;color:var(--text)")}>Клиент уведомлён</span>
                  <span style={css(NUM + ";display:block;font-size:12px;color:var(--text-3)")}>
                    {dateTime(lastNotice.sent_at)}
                    {row.notices.length > 1 ? ` · ${row.notices.length} ${plural(row.notices.length, "уведомление", "уведомления", "уведомлений")}` : ""}
                  </span>
                </span>
                <HButton onClick={() => setCancel(lastNotice)} className="nt-status-cancel" s="" hover="" title="Отменить последнее уведомление">
                  отменить
                </HButton>
              </div>
              {prevKg > 0 && (
                <div className="nt-status-money">
                  <span>
                    <span className="nt-status-k">Вес</span>
                    <b>{fmtKg(prevKg)} кг</b>
                  </span>
                  <span>
                    <span className="nt-status-k">За вес</span>
                    <b style={css("color:var(--violet)")}>{som(prevSom)}</b>
                  </span>
                  <span>
                    <span className="nt-status-k">Берём</span>
                    <b>при выдаче</b>
                  </span>
                </div>
              )}
              <div className="nt-status-hint">
                {canWeigh
                  ? `Пришло ещё ${row.fresh} ${plural(row.fresh, "товар", "товара", "товаров")} — введите вес новой посылки и отправьте ещё одно уведомление.`
                  : "Все товары уже в уведомлении. Можно напомнить клиенту — сумма к оплате не изменится."}
              </div>
            </div>
          )}

          {/* Что пришло */}
          <div className="nt-items">
            <div className="nt-sec-title">
              На складе · {row.items.length} {plural(row.items.length, "товар", "товара", "товаров")}
            </div>
            {row.items.map((i) => (
              <div key={i.id} className="nt-item">
                <span style={css("min-width:0")}>
                  <span style={css("display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text)")}>
                    <span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{i.name}</span>
                    {!i.notified && row.notices.length > 0 && <span className="nt-new">новый</span>}
                  </span>
                  <span style={css(MONO + ";display:block;font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{i.code || "без кода"}</span>
                </span>
                <span style={css(NUM + ";font-size:12.5px;color:var(--text-3);white-space:nowrap")}>{i.qty} шт</span>
                <span style={css("text-align:right;white-space:nowrap")}>
                  <span style={css(NUM + ";display:block;font-size:13px;color:var(--text)")}>{som(i.sale)}</span>
                  <span style={mix(NUM + ";display:block;font-size:11.5px", { color: i.debt > 0 ? "var(--danger)" : "var(--green)" })}>{i.debt > 0 ? `долг ${som(i.debt)}` : "оплачено"}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Вес */}
          {canWeigh && (
            <div className={"nt-weight" + (bad ? " bad" : kg ? " on" : "")}>
              <label className="nt-weight-in">
                <span className="nt-weight-i">
                  <WeightIcon />
                </span>
                <span style={css("font-size:13px;color:var(--text-3);white-space:nowrap")}>{row.notices.length ? "Вес новой посылки" : "Вес посылки"}</span>
                <input ref={weightRef} value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.,\s]/g, ""))} inputMode="decimal" placeholder="0,00" aria-label="Вес посылки, кг" aria-invalid={bad} autoFocus={window.innerWidth > 1000} />
                <span style={css("font-size:13px;color:var(--text-4)")}>кг</span>
              </label>
              <div className="nt-weight-calc">
                {bad ? (
                  <span style={css("color:var(--danger)")}>Введите вес числом, например 1,07</span>
                ) : kg ? (
                  <>
                    <span style={css(NUM)}>
                      {fmtKg(kg)} кг × {fmtNum(rateSom)} с{exactSom !== weightSom ? ` = ${som(exactSom)}` : ""}
                    </span>
                    <b style={css(NUM + ";margin-left:auto;font-weight:500;color:var(--text);white-space:nowrap")} title={exactSom !== weightSom ? "округляем вверх до целого сома" : undefined}>
                      {exactSom !== weightSom ? "→ " : "= "}
                      {som(weightSom)}
                    </b>
                  </>
                ) : (
                  <span>
                    {fmtNum(rateSom)} с за кг ({fmtNum(t.weight_rate_usd)} $ × {fmtNum(t.usd_rate)}) · без веса — уведомим только о долге
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Итог */}
          <div className="nt-sum">
            {weightTotal > 0 && <SumRow label={`Вес · ${fmtKg(kgTotal)} кг`} value={som(weightTotal)} color="var(--violet)" />}
            <SumRow label="Долг за товар" value={debt > 0 ? som(debt) : "нет"} color={debt > 0 ? "var(--danger)" : "var(--text-3)"} />
            <SumRow label="Итого к оплате" value={som(total)} color={total > 0 ? "var(--text)" : "var(--green)"} strong />
          </div>

          {/* Остаток колонки — бледные строки-заготовки и подсказка, что будет дальше */}
          <div className="nt-fill">
            <div className="nt-fill-rows" aria-hidden>
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className="nt-fill-row">
                  <span className="sk" style={css("width:28px;height:28px;border-radius:9px;flex:none")} />
                  <span style={css("flex:1;display:flex;flex-direction:column;gap:7px")}>
                    <span className="sk" style={mix("height:8px", { width: `${[58, 44, 66, 50, 62, 40][i % 6]}%` })} />
                    <span className="sk" style={mix("height:6px", { width: `${[30, 38, 26, 34][i % 4]}%` })} />
                  </span>
                  <span className="sk" style={css("width:48px;height:8px;flex:none")} />
                </span>
              ))}
            </div>
            <div className="nt-fill-msg">
              <span className="nt-fill-steps">
                <span className="nt-fill-step">
                  <b>1</b> Отправить
                </span>
                <span className="nt-fill-arrow">→</span>
                <span className="nt-fill-step">
                  <b>2</b> Клиент пришёл
                </span>
                <span className="nt-fill-arrow">→</span>
                <span className="nt-fill-step">
                  <b>3</b> «Выдача»
                </span>
              </span>
              <span style={css("display:block;margin-top:8px;font-size:12px;line-height:1.45;color:var(--text-4)")}>
                Клиент отметится уведомлённым — сумму за вес возьмут на «Выдаче»
              </span>
            </div>
          </div>
        </div>

        {/* Сообщение */}
        <div className="nt-right">
          <div className="nt-sec-title">Сообщение для WhatsApp</div>
          <div className="nt-chat">
            <div className="nt-bubble">
              {message}
              <span className="nt-bubble-time">
                {new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} ✓✓
              </span>
            </div>
            {/* Ниже — бледные пузыри-заготовки: здесь будет ответ клиента */}
            <div className="nt-ghost-chat" aria-hidden>
              {[
                [62, 1],
                [38, 1],
                [54, 0],
                [70, 1],
                [44, 0],
                [58, 1],
              ].map(([w, inc], i) => (
                <span key={i} className={"nt-ghost-bubble" + (inc ? " in" : "")} style={{ width: `${w}%` }}>
                  <span />
                  <span style={{ width: `${[70, 50, 84, 60, 40, 76][i]}%` }} />
                </span>
              ))}
            </div>
          </div>
          {error && <ModalError text={error} />}
          <div className="nt-actions">
            <HButton
              onClick={() => trySend("send")}
              disabled={!phone || bad || busy}
              className="nt-wa"
              s=""
              hover=""
              title={!phone ? "У клиента нет телефона" : IS_MOBILE || waMode === "web" ? "Откроется чат с готовым текстом" : "Текст скопируется, откроется чат — нажмите Ctrl+V и Enter"}
            >
              <WaIcon />
              {busy ? "Сохраняю…" : canWeigh ? "Отправить в WhatsApp" : "Напомнить в WhatsApp"}
            </HButton>
            <HButton onClick={() => trySend("copy")} disabled={bad || busy} className="nt-copy" s="" hover="" title="Скопировать текст и отметить уведомление">
              Скопировать и отметить
            </HButton>
          </div>
          {!IS_MOBILE && (
            <div className="nt-wamode">
              <span style={css("font-size:12px;color:var(--text-3);white-space:nowrap")}>Открывать в</span>
              <span className="nt-wamode-seg" role="radiogroup" aria-label="Как открывать WhatsApp">
                <button type="button" role="radio" aria-checked={waMode === "web"} className={waMode === "web" ? "on" : ""} onClick={() => setWaMode("web")}>
                  WhatsApp Web
                </button>
                <button type="button" role="radio" aria-checked={waMode === "app"} className={waMode === "app" ? "on" : ""} onClick={() => setWaMode("app")}>
                  Приложении
                </button>
              </span>
              <span className="nt-wamode-hint">
                {waMode === "web" ? "текст и иконки придут целыми" : "текст скопируется — в чате нажмите Ctrl+V и Enter (иконки сохранятся)"}
              </span>
            </div>
          )}
          {!phone && <div style={css("font-size:12px;color:var(--amber)")}>У клиента нет телефона — скопируйте текст и отправьте вручную.</div>}
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
            <div className="nt-noweight">
              <span className="nt-noweight-i">
                <WeightIcon />
              </span>
              <span style={css("min-width:0")}>
                <span style={css("display:block;font-size:14px;font-weight:500;color:var(--text)")}>За вес ничего не возьмём</span>
                <span style={css("display:block;margin-top:3px;font-size:12.5px;line-height:1.5;color:var(--text-3)")}>
                  В сообщении будет только долг за товар{debt > 0 ? ` — ${som(debt)}` : ""}, а на «Выдаче» сумма за вес не добавится. Взвесьте посылку и введите вес, чтобы клиент сразу знал, сколько платить.
                </span>
              </span>
            </div>
            <div className="mf-total">
              <span>Сейчас к оплате в сообщении</span>
              <b style={css("font-weight:500;color:var(--text);font-variant-numeric:tabular-nums")}>{som(total)}</b>
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

function SumRow({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <div className={"nt-sum-row" + (strong ? " strong" : "")}>
      <span>{label}</span>
      <span style={mix(NUM + ";white-space:nowrap", { color: color ?? "var(--text)" })}>{value}</span>
    </div>
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

function WeightIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6.5 8h11l2.3 12H4.2L6.5 8Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </svg>
  );
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

