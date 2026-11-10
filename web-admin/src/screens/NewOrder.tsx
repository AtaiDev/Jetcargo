/**
 * Новый заказ — «касса».
 *
 * Слева: клиент одной полосой (поиск, недавние, новый клиент), строка быстрого ввода
 * (Enter — товар в список; можно вставить сразу несколько строк из Excel) и список товаров
 * карточками с правкой и удалением. Справа — «касса» (обычная карточка): сумма крупно, выкуп и прибыль,
 * когда оформлен, статус, оплата, комментарий и кнопка «Сохранить» (или Ctrl+Enter из любого поля).
 * Заказ сохраняется одной транзакцией: либо весь, либо ничего.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import { createOrder, getCustomer, getSettings, listCustomers, type CustomerCard, type CustomerRow, type Item } from "../api/domain";
import { MONO, css, mix } from "../design/css";
import { I_ARROW_RIGHT, I_BOX, I_CLOSE, I_PLUS, I_USER, Svg } from "../design/icons";
import { Page } from "../design/table";
import { HButton, ST } from "../design/ui";
import { cased, capFirst, parseMoney, som, todayIso, upper } from "../lib/cargo";
import { emit, useRefresh } from "../lib/events";
import PhoneInput from "../components/PhoneInput";
import CustomerSearch from "../components/CustomerSearch";
import DatePicker from "../components/DatePicker";
import TimePicker from "../components/TimePicker";
import SlideTabs from "../components/SlideTabs";
import CountUp from "../design/CountUp";
import { HomeHead } from "./overview/Home";

type Toast = (kind: "success" | "error", text: string) => void;

/** Последний сохранённый заказ — для карточки «Заказ сохранён» и окна с деталями. */
interface Saved {
  id: number;
  name: string;
  phone: string;
  isNew: boolean;
  items: Item[];
  sum: number;
  paid: number;
  cost: number | null;
  profit: number | null;
  status: "ordered" | "in_stock";
  date: string;
  time: string;
  comment: string;
}

interface Row {
  key: number;
  name: string;
  code: string;
  qty: string;
  price: string;
  real: string;
}
type Field = "name" | "code" | "qty" | "price" | "real";

let rowKey = 1;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** Числа обычным шрифтом с цифрами одной ширины — аккуратнее «печатной машинки». */
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const emptyRow = (code = ""): Row => ({ key: rowKey++, name: "", code, qty: "1", price: "", real: "" });

/** Только для локальной проверки: /new-order?demo=20 — список сразу заполнен тестовыми товарами.
 *  Работает лишь в dev-сборке (в прод не попадает), сохранить такой заказ нельзя. */
const DEMO_NAMES = ["Клавиатура", "Мышка", "Наушники", "Кроссовки", "Рюкзак", "Куртка", "Часы", "Чехол для телефона", "Футболка", "Зарядка"];
const demoCount = (): number => {
  if (!import.meta.env.DEV) return 0;
  const n = Number(new URLSearchParams(window.location.search).get("demo"));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 100) : 0;
};
const demoRows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    key: rowKey++,
    name: DEMO_NAMES[i % DEMO_NAMES.length] + (i >= DEMO_NAMES.length ? ` ${Math.floor(i / DEMO_NAMES.length) + 1}` : ""),
    code: i % 3 === 0 ? `JT86244500${32545 + i}` : "",
    qty: String(i % 5 === 0 ? 3 : 1),
    price: String(600 + ((i * 370) % 4400)),
    real: String(400 + ((i * 290) % 3000)),
  }));
const isBlank = (r: Row) => !r.name.trim() && !r.code.trim() && !r.price.trim() && !r.real.trim();
const money = (s: string) => {
  const n = parseMoney(s);
  return n === null || Number.isNaN(n) ? null : n;
};

/** Что не так со строкой товара — и в каком поле. */
function rowError(r: Row): { field: Field; text: string } | null {
  if (!r.name.trim()) return { field: "name", text: "впишите название товара" };
  const q = Number(r.qty);
  if (!Number.isInteger(q) || q <= 0) return { field: "qty", text: "количество — целое число больше нуля" };
  const p = parseMoney(r.price);
  if (p === null || Number.isNaN(p)) return { field: "price", text: "впишите сумму клиенту" };
  const c = parseMoney(r.real);
  if (c !== null && Number.isNaN(c)) return { field: "real", text: "выкуп — число" };
  return null;
}

export default function NewOrder({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const nav = useNavigate();
  const [params] = useSearchParams();

  // --- Клиент ---
  const [customer, setCustomer] = useState<CustomerCard | null>(null);
  const [newMode, setNewMode] = useState(false);
  const [added, setAdded] = useState(0);
  // список товаров: больше 10 — своя прокрутка; новый товар — плавно докрутить вниз
  const listRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(0);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneBox = useRef<HTMLDivElement>(null);

  const pickCustomer = useCallback((id: number) => {
    getCustomer(id)
      .then((c) => {
        setCustomer(c);
        setNewMode(false);
        setNewName("");
        setNewPhone("");
      })
      .catch(() => setCustomer(null));
  }, []);

  useEffect(() => {
    const id = Number(params.get("customer"));
    if (id) pickCustomer(id);
  }, [params, pickCustomer]);

  // Недавние клиенты — выбрать в один клик (обычно заказывают одни и те же).
  const [recent, setRecent] = useState<CustomerRow[]>([]);
  const loadRecent = useCallback(() => {
    listCustomers({ sort: "recent", limit: 8 })
      .then((r) => setRecent(r.rows.filter((c) => c.last_order_date)))
      .catch(() => setRecent([]));
  }, []);
  useEffect(loadRecent, [loadRecent]);
  useRefresh(loadRecent);

  const openNew = () => {
    setNewMode(true);
    setTimeout(() => nameRef.current?.focus(), 30);
  };
  /** Поиск никого не нашёл — переносим имя или номер в форму нового клиента и ставим курсор в пустое поле. */
  const prefillNew = (p: { name?: string; phone?: string }) => {
    setNewMode(true);
    if (p.name !== undefined) setNewName(p.name);
    if (p.phone !== undefined) setNewPhone(p.phone);
    setTimeout(() => (p.phone ? nameRef.current : phoneBox.current?.querySelector("input"))?.focus(), 30);
  };
  const cancelNew = () => {
    setNewMode(false);
    setNewName("");
    setNewPhone("");
  };

  // --- Товары: список и строка быстрого ввода ---
  const [demo] = useState(() => demoCount() > 0);
  const [rows, setRows] = useState<Row[]>(() => (demo ? demoRows(demoCount()) : []));
  useEffect(() => {
    const el = listRef.current;
    if (el && rows.length > prevCount.current && rows.length > 10) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    prevCount.current = rows.length;
  }, [rows.length]);
  const [draft, setDraft] = useState<Row>(() => emptyRow(params.get("code") ?? ""));
  const [draftErr, setDraftErr] = useState<{ field: Field; text: string } | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [editErr, setEditErr] = useState("");
  const draftRefs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const focusDraft = (f: Field = "name") => setTimeout(() => draftRefs.current[f]?.focus(), 20);
  const setD = (patch: Partial<Row>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDraftErr(null);
  };

  /** Enter в строке ввода: товар — в список, строка — пустая, курсор — снова в «Название». */
  const addDraft = () => {
    if (isBlank(draft)) return focusDraft("name");
    const err = rowError(draft);
    if (err) {
      setDraftErr(err);
      return focusDraft(err.field);
    }
    const r = { ...draft, key: rowKey++ };
    setRows((rs) => [...rs, r]);
    setFresh(r.key);
    setAdded((n) => n + 1);
    setDraft(emptyRow());
    setDraftErr(null);
    focusDraft("name");
  };
  const onDraftKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      addDraft();
    }
  };

  /** Вставка из Excel в «Название»: строка — товар; колонки через Tab: название · код · шт · сумма · выкуп. */
  const pasteRows = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\r/g, "").replace(/\n+$/, "");
    if (!/[\n\t]/.test(text)) return; // обычная вставка одного значения
    e.preventDefault();
    const parsed = text
      .split("\n")
      .map((line) => line.split("\t").map((c) => c.trim()))
      .filter((cols) => cols.some(Boolean))
      .map((cols) => ({
        ...emptyRow(),
        name: capFirst(cols[0] ?? ""),
        code: upper(cols[1] ?? ""),
        qty: /^\d+$/.test(cols[2] ?? "") ? cols[2] : "1",
        price: cols[3] ?? "",
        real: cols[4] ?? "",
      }));
    if (!parsed.length) return;
    setRows((rs) => [...rs, ...parsed]);
    setFresh(parsed[parsed.length - 1].key);
    toast("success", `Добавлено товаров: ${parsed.length}`);
  };

  const removeRow = (key: number) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    if (editing?.key === key) setEditing(null);
  };
  const startEdit = (r: Row) => {
    setEditing({ ...r });
    setEditErr("");
  };
  const saveEdit = () => {
    if (!editing) return;
    const err = rowError(editing);
    if (err) return setEditErr(err.text);
    setRows((rs) => rs.map((r) => (r.key === editing.key ? editing : r)));
    setEditing(null);
  };

  // --- Параметры заказа ---
  const [orderDate, setOrderDate] = useState(todayIso());
  // Время заказа: null — «сейчас» (часы идут сами), иначе указано вручную.
  const [time, setTime] = useState<string | null>(null);
  const [clock, setClock] = useState(() => hhmm(new Date()));
  useEffect(() => {
    const t = window.setInterval(() => setClock(hhmm(new Date())), 15_000);
    return () => window.clearInterval(t);
  }, []);
  const [status, setStatus] = useState<"ordered" | "in_stock">("ordered");
  // «Частично» — сразу курсор в сумму оплаты
  const paidRef = useRef<HTMLInputElement | null>(null);
  const [pay, setPay] = useState<"none" | "full" | "part">("none");
  useEffect(() => {
    if (pay === "part") window.setTimeout(() => paidRef.current?.focus(), 60);
  }, [pay]);
  const [paid, setPaid] = useState("");
  const [comment, setComment] = useState("");
  const [rate, setRate] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => setRate(s.cny_rate))
      .catch(() => setRate(null));
  }, []);

  const totals = useMemo(() => {
    let sale = 0;
    let cost = 0;
    let withCost = 0;
    let qty = 0;
    let profit = 0;
    for (const r of rows) {
      const p = money(r.price) ?? 0;
      const c = money(r.real);
      sale += p;
      qty += Number(r.qty) || 0;
      if (c !== null) {
        cost += c;
        withCost++;
        profit += p - c;
      }
    }
    const paidNum = pay === "full" ? sale : pay === "part" ? money(paid) ?? 0 : 0;
    return { sale, cost, withCost, qty, profit, paid: paidNum };
  }, [rows, pay, paid]);

  /** Товары к сохранению: список + то, что осталось в строке ввода (если там что-то вписано). */
  const toSave = () => (isBlank(draft) ? rows : [...rows, draft]);

  function validate(): string {
    if (!customer && !newName.trim() && !newPhone.trim()) return "Выберите клиента или впишите имя и телефон нового";
    if (!isBlank(draft)) {
      const err = rowError(draft);
      if (err) {
        setDraftErr(err);
        return `Строка ввода: ${err.text}`;
      }
    }
    const list = toSave();
    if (!list.length) return "Добавьте товар: впишите его в строку ввода и нажмите Enter";
    for (const [i, r] of list.entries()) {
      const err = rowError(r);
      if (err) return `Товар ${i + 1}: ${err.text}`;
    }
    const sale = list.reduce((s, r) => s + (money(r.price) ?? 0), 0);
    if (pay === "part") {
      const a = money(paid);
      if (a === null || a <= 0) return "Впишите, сколько оплатил клиент";
      if (a > sale) return "Оплата больше суммы заказа";
    }
    if (time !== null && new Date(`${orderDate}T${time}:00`).getTime() > Date.now() + 60_000) return "Время заказа ещё не наступило";
    return "";
  }

  async function save() {
    if (busy) return;
    if (demo) {
      setError("Это тестовые товары (?demo) — такой заказ не сохраняется. Откройте страницу без ?demo.");
      return;
    }
    const err = validate();
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      const list = toSave();
      const r = await createOrder({
        customer_id: customer?.customer.id,
        customer_name: customer ? undefined : newName.trim(),
        customer_phone: customer ? undefined : newPhone.trim(),
        order_date: orderDate,
        ordered_at: time !== null ? new Date(`${orderDate}T${time}:00`).toISOString() : undefined,
        status,
        comment,
        pay,
        paid_amount: pay === "part" ? money(paid) ?? 0 : undefined,
        items: list.map((row) => {
          const price = money(row.price) ?? 0;
          return {
            name: row.name.trim(),
            code: row.code.trim(),
            qty: Number(row.qty),
            price,
            real_price: money(row.real),
            price_cny: rate ? Math.round((price / rate) * 100) / 100 : null,
          };
        }),
      });
      const its = r.items;
      const withCost = its.filter((i) => i.cost !== null);
      setSaved({
        id: r.customer_id,
        name: customer?.customer.name ?? its[0]?.customer_name ?? newName,
        phone: customer?.customer.phone ?? its[0]?.customer_phone ?? "",
        isNew: !!r.customer_created,
        items: its,
        sum: its.reduce((a, i) => a + i.sale, 0),
        paid: its.reduce((a, i) => a + i.paid, 0),
        cost: withCost.length ? withCost.reduce((a, i) => a + (i.cost ?? 0), 0) : null,
        profit: withCost.length ? withCost.reduce((a, i) => a + i.sale - (i.cost ?? 0), 0) : null,
        status,
        date: orderDate,
        time: time ?? hhmm(new Date()),
        comment,
      });
      emit("cargo:changed");
      // Касса — заново, как при первом открытии: следующий заказ начинается с клиента.
      setCustomer(null);
      cancelNew();
      setRows([]);
      setDraft(emptyRow());
      setDraftErr(null);
      setEditing(null);
      setComment("");
      setOrderDate(todayIso());
      setStatus("ordered");
      setPay("none");
      setPaid("");
      setTime(null);
    } catch (e) {
      setError(apiError(e, "Не удалось сохранить заказ"));
    } finally {
      setBusy(false);
    }
  }

  // Ctrl+Enter (⌘+Enter) — сохранить из любого поля.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const debt = Math.max(0, totals.sale - totals.paid);
  const paidShare = totals.sale > 0 ? Math.min(100, Math.round((totals.paid / totals.sale) * 100)) : 0;
  const who = customer ? customer.customer.name : newName.trim() || newPhone.trim() ? newName.trim() || newPhone.trim() : "";
  const draftProfit = money(draft.price) !== null && money(draft.real) !== null ? (money(draft.price) ?? 0) - (money(draft.real) ?? 0) : null;

  const inCls = (f: Field, extra = "") => "no-in" + (extra ? " " + extra : "") + (draftErr?.field === f ? " bad" : "");
  const bumpQty = (d: number) => setD({ qty: String(Math.max(1, (parseInt(draft.qty, 10) || (d > 0 ? 0 : 1)) + d)) });
  const onQtyKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      bumpQty(e.key === "ArrowUp" ? 1 : -1);
      return;
    }
    onDraftKey(e);
  };
  const draftMarkup = draftProfit !== null && (money(draft.real) ?? 0) > 0 ? Math.round((draftProfit / (money(draft.real) ?? 1)) * 100) : null;

  return (
    <Page size="wide">
      <div className="ov no">
        {saved && details && (
          <OrderDetails
            saved={saved}
            onClose={() => setDetails(false)}
            onAgain={() => {
              pickCustomer(saved.id);
              setDetails(false);
              setSaved(null);
            }}
            onOpen={() => nav(`/customers/${saved.id}`)}
          />
        )}

        <div className="wx-head">
          <HomeHead title="Новый заказ" />
          {isDesktop && (
            <div className="wx-head-r">
              <span className="no-hint">
                <Kbd>Enter</Kbd> — товар в список · <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> — сохранить заказ
              </span>
            </div>
          )}
        </div>

        <div className="no-grid">
          <div className="no-main">
            {saved && (
              <SavedBanner
                saved={saved}
                onDetails={() => setDetails(true)}
                onAgain={() => {
                  pickCustomer(saved.id);
                  setSaved(null);
                }}
                onOpen={() => nav(`/customers/${saved.id}`)}
                onClose={() => setSaved(null)}
              />
            )}

            {/* --- 1. Клиент --- */}
            <section className="ov-card no-card">
              <div className={"no-ch" + (customer ? " picked" : !newMode ? " find" : "")}>
                {!customer && <span className={"no-step" + (who ? " done" : "")}>{who ? <Svg paths={[["path", { d: "M20 6 9 17l-5-5" }]]} size={12} sw={3} /> : "1"}</span>}
                {!customer && <b>Клиент</b>}
                {customer && (
                  <div className="no-row">
                    <span className="no-row-who">
                      <span className="no-row-av">
                        {initials(customer.customer.name)}
                        <i>
                          <Svg paths={[["path", { d: "M20 6 9 17l-5-5" }]]} size={10} sw={3.2} />
                        </i>
                      </span>
                      <span className="no-row-id">
                        <b>{customer.customer.name}</b>
                        <small>
                          {customer.customer.phone || "без телефона"}
                          {customer.customer.code && <code>{customer.customer.code}</code>}
                        </small>
                      </span>
                    </span>
                    <span className="no-row-st">
                      <small>Заказано</small>
                      <b>{customer.totals.ordered}</b>
                    </span>
                    <span className="no-row-st">
                      <small>На складе</small>
                      <b>{customer.totals.in_stock}</b>
                    </span>
                    <span className="no-row-st">
                      <small>Выдано</small>
                      <b>{customer.totals.issued}</b>
                    </span>
                    <span className={"no-row-st" + (customer.totals.debt > 0 ? " owe" : "")}>
                      <small>Долг</small>
                      <b>{customer.totals.debt > 0 ? som(customer.totals.debt) : "нет"}</b>
                    </span>
                    <button
                      type="button"
                      className="no-btn no-row-x"
                      onClick={() => {
                        setCustomer(null);
                        setSaved(null);
                      }}
                      title="Выбрать другого клиента"
                    >
                      <Svg paths={[["path", { d: "M4 7h13l-3-3M20 17H7l3 3" }]]} size={15} sw={2} />
                      <span>Другой клиент</span>
                    </button>
                  </div>
                )}
                {!customer && !newMode && (
                  <div className="no-search">
                    <CustomerSearch autoFocus onPick={pickCustomer} onCreate={prefillNew} />
                  </div>
                )}
                {!customer && !newMode && (
                  <button type="button" className="no-btn no-ch-btn" onClick={openNew}>
                    <Svg paths={I_USER_PLUS} size={15} sw={2} />
                    {isDesktop ? "Новый клиент" : "Новый"}
                  </button>
                )}
              </div>
              {customer ? null : newMode ? (
                <div className="no-new">
                  <div className="no-new-row">
                    <span className="no-av add">
                      <Svg paths={I_USER_PLUS} size={18} sw={1.9} />
                    </span>
                    <input ref={nameRef} className="no-in" value={newName} onChange={(e) => setNewName(cased(e, capFirst))} placeholder="Имя нового клиента" />
                    <div ref={phoneBox} className="no-phone">
                      <PhoneInput value={newPhone} onChange={setNewPhone} height={44} />
                    </div>
                    <button type="button" className="no-btn" onClick={cancelNew}>
                      Найти в базе
                    </button>
                  </div>
                  <small className="no-note">Новый клиент · если такой номер уже есть в базе, заказ добавится к этому клиенту</small>
                </div>
              ) : (
                recent.length > 0 && (
                  <div className="no-sts">
                    <div className="no-st lbl" aria-hidden="true">
                      <span className="no-st-av">
                        <Svg paths={[["circle", { cx: 12, cy: 12, r: 8.5 }], ["path", { d: "M12 7.5V12l3 2" }]]} size={17} sw={2} />
                      </span>
                      <b>Недавно</b>
                      <small>заказывали</small>
                    </div>
                    {recent.map((c) => (
                      <button key={c.id} type="button" className="no-st" onClick={() => pickCustomer(c.id)} title={c.phone || c.name}>
                        <span className="no-st-av">{initials(c.name)}</span>
                        <b>{c.name}</b>
                        <small>{agoShort(c.last_order_date)}</small>
                      </button>
                    ))}
                  </div>
                )
              )}
            </section>

            {/* --- 2. Добавить товар --- */}
            <section className="ov-card no-card no-add">
              <div className="no-ch">
                <span className={"no-step" + (rows.length ? " done" : "")}>{rows.length ? <Svg paths={[["path", { d: "M20 6 9 17l-5-5" }]]} size={12} sw={3} /> : "2"}</span>
                <b>Добавить товар</b>
                <span className="no-live-box">
                  {draftErr ? (
                    <span className="no-live err" key="err">
                      <Svg paths={[["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 7.5v5.5M12 16.5h.01" }]]} size={15} sw={2.2} />
                      {draftErr.text}
                    </span>
                  ) : draftProfit !== null ? (
                    <span className={"no-qres" + (draftProfit < 0 ? " neg" : "")} key="res">
                      <span className="no-qres-ic">
                        <Svg paths={[["path", { d: draftProfit < 0 ? "M7 7l10 10M17 9v8H9" : "M7 17 17 7M9 7h8v8" }]]} size={12} sw={2.6} />
                      </span>
                      прибыль с товара
                      <b>
                        {draftProfit > 0 ? "+" : ""}
                        {som(draftProfit)}
                      </b>
                      {draftMarkup !== null && (
                        <em>
                          наценка <b>{draftMarkup}%</b>
                        </em>
                      )}
                    </span>
                  ) : isDesktop ? (
                    <TipTicker />
                  ) : null}
                </span>
              </div>
              <div className="no-q3">
                <label className="no-fd n">
                  <span>Название</span>
                  <input
                    ref={(el) => {
                      draftRefs.current.name = el;
                    }}
                    className={inCls("name")}
                    value={draft.name}
                    onChange={(e) => setD({ name: cased(e, capFirst) })}
                    onKeyDown={onDraftKey}
                    onPaste={pasteRows}
                    placeholder="Например, кроссовки Nike"
                  />
                </label>
                <label className="no-fd c">
                  <span>Код / трек</span>
                  <input
                    ref={(el) => {
                      draftRefs.current.code = el;
                    }}
                    className={inCls("code", "mono")}
                    value={draft.code}
                    onChange={(e) => setD({ code: cased(e, upper) })}
                    onKeyDown={onDraftKey}
                    placeholder="необязательно"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                </label>
                <div className="no-fd q">
                  <span>Шт</span>
                  <div className={"no-qty3" + (draftErr?.field === "qty" ? " bad" : "")}>
                    <button type="button" tabIndex={-1} aria-label="Меньше" onClick={() => bumpQty(-1)}>
                      <Svg paths={[["path", { d: "M6 12h12" }]]} size={12} sw={2.6} />
                    </button>
                    <input
                      ref={(el) => {
                        draftRefs.current.qty = el;
                      }}
                      className={inCls("qty", "ctr")}
                      value={draft.qty}
                      onChange={(e) => setD({ qty: e.target.value })}
                      onKeyDown={onQtyKey}
                      inputMode="numeric"
                      aria-label="Количество"
                    />
                    <button type="button" tabIndex={-1} aria-label="Больше" onClick={() => bumpQty(1)}>
                      <Svg paths={I_PLUS} size={12} sw={2.6} />
                    </button>
                  </div>
                </div>
                <label className="no-fd p">
                  <span>Клиенту</span>
                  <MoneyCell
                    inputRef={(el) => {
                      draftRefs.current.price = el;
                    }}
                    value={draft.price}
                    onChange={(v) => setD({ price: v })}
                    onKeyDown={onDraftKey}
                    placeholder="0"
                    invalid={draftErr?.field === "price"}
                  />
                </label>
                <label className="no-fd r">
                  <span>Выкуп</span>
                  <MoneyCell
                    inputRef={(el) => {
                      draftRefs.current.real = el;
                    }}
                    value={draft.real}
                    onChange={(v) => setD({ real: v })}
                    onKeyDown={onDraftKey}
                    placeholder="0"
                    invalid={draftErr?.field === "real"}
                  />
                </label>
                <button type="button" className="no-addbtn" onClick={addDraft} title="Добавить в список (Enter)">
                  <Svg paths={I_PLUS} size={15} sw={2.4} />
                  Добавить
                  {added > 0 && (
                    <span className="no-addok" key={added}>
                      <Svg paths={[["path", { d: "M20 6 9 17l-5-5" }]]} size={15} sw={2.6} />
                      Добавлено
                    </span>
                  )}
                </button>
              </div>
            </section>

            {/* --- 3. Товары в заказе --- */}
            <section className="ov-card no-card no-items">
              <div className="no-ch">
                <span className="no-step">3</span>
                <b>Товары в заказе</b>
                {rows.length > 0 && (
                  <small className="no-ch-r">
                    {rows.length} {plural(rows.length, "позиция", "позиции", "позиций")} · {totals.qty} шт
                  </small>
                )}
              </div>
              {rows.length === 0 ? (
                <EmptyItems />
              ) : (
                <div ref={listRef} className={"no-list" + (rows.length > 10 ? " scroll" : "")}>
                  {rows.map((r, i) =>
                    editing?.key === r.key ? (
                      <EditRow
                        key={r.key}
                        row={editing}
                        index={i}
                        error={editErr}
                        onChange={(patch) => {
                          setEditing((e) => (e ? { ...e, ...patch } : e));
                          setEditErr("");
                        }}
                        onSave={saveEdit}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <ItemRow key={r.key} row={r} index={i} fresh={fresh === r.key} onEdit={() => startEdit(r)} onRemove={() => removeRow(r.key)} />
                    )
                  )}
                </div>
              )}
              {rows.length > 0 && (
                <div className="no-more">
                  <Svg paths={I_PLUS} size={15} sw={2.2} />
                  Добавьте ещё товар — строка выше и <Kbd>Enter</Kbd>
                </div>
              )}
            </section>
          </div>

          {/* ================= Справа: чек заказа ================= */}
          <aside className="no-rc">
            <div className="no-paper">
              <div className="no-rc-h">
                <span className="no-rc-ic">
                  <Svg paths={I_RECEIPT} size={16} sw={2} />
                </span>
                <span className="no-rc-ttl">
                  <b>Чек заказа</b>
                  <small>
                    {rows.length ? (
                      <>
                        <em key={rows.length}>{rows.length}</em> {plural(rows.length, "позиция", "позиции", "позиций")} · <em key={"q" + totals.qty}>{totals.qty}</em> шт
                      </>
                    ) : (
                      "пока пусто"
                    )}
                  </small>
                </span>
                <span className="no-rc-when">
                  <b>{time ?? clock}</b>
                  <small>{orderDate === todayIso() ? "сегодня" : dateRu(orderDate).slice(0, 5)}</small>
                </span>
              </div>

              <div className="no-rc-who">
                {who ? <Avatar name={who} size={30} /> : <span className="no-av empty" style={{ width: 30, height: 30 }} />}
                <span className={who ? "" : "mu"}>{who || "клиент не выбран"}</span>
                {!customer && who && <i className="no-newtag">новый</i>}
                {customer ? (
                  <small className="no-rc-ph">{customer.customer.phone || "без телефона"}</small>
                ) : newMode && who ? (
                  newPhone ? <small className="no-rc-ph">{newPhone}</small> : null
                ) : !who ? (
                  <button
                    type="button"
                    className="no-rc-pick"
                    onClick={() => {
                      const el = document.querySelector<HTMLInputElement>(".no-search input");
                      el?.scrollIntoView({ block: "center", behavior: "smooth" });
                      el?.focus({ preventScroll: true });
                    }}
                  >
                    <Svg paths={[["path", { d: "M12 19V5M5.5 11.5 12 5l6.5 6.5" }]]} size={13} sw={2.4} />
                    выбрать
                  </button>
                ) : null}
              </div>

              <div className="no-rc-sum">
                <small>Сумма заказа</small>
                <b>
                  <CountUp text={som(totals.sale)} duration={450} />
                </b>
                {!isBlank(draft) && <em>+ товар в строке ввода — Enter, чтобы добавить</em>}
                {(() => {
                  const st = totals.sale > 0 && debt <= 0.001 ? "full" : pay === "part" && totals.paid > 0 ? "part" : "none";
                  return <PayStamp st={st} label={st === "full" ? "Оплачен" : st === "part" ? "Частично" : "Не оплачен"} sub={st === "full" ? "полностью" : st === "part" ? `долг ${som(debt)}` : totals.sale > 0 ? "в долг" : "пока пусто"} />;
                })()}
              </div>

              {(() => {
                const ok = totals.withCost && totals.sale > 0;
                const share = ok ? Math.max(0, Math.min(100, Math.round((totals.cost / totals.sale) * 100))) : 0;
                const neg = totals.withCost && totals.profit < 0;
                return (
                  <div className="no-cps">
                    <div className="no-cp c">
                      <span className="no-cp-main">
                        <i className="ic">
                          <Svg paths={[["rect", { x: 2.5, y: 6, width: 19, height: 12, rx: 2.5 }], ["circle", { cx: 12, cy: 12, r: 2.6 }], ["path", { d: "M6 9.5h.01M18 14.5h.01" }]]} size={15} sw={2} />
                        </i>
                        <span>
                          <small>Выкуп</small>
                          <b>{totals.withCost ? som(totals.cost) : "—"}</b>
                        </span>
                      </span>
                      <span className="no-cp-stub">
                        <b>{ok ? share + "%" : "—"}</b>
                        <small>{ok ? "от суммы" : "впишите"}</small>
                      </span>
                    </div>
                    <div className={"no-cp p" + (neg ? " neg" : "")}>
                      <span className="no-cp-main">
                        <i className="ic">
                          <Svg paths={[["path", { d: neg ? "M4 8l5 5 4-4 7 7" : "M4 16l5-5 4 4 7-7" }], ["path", { d: neg ? "M15 16h5v-5" : "M15 8h5v5" }]]} size={15} sw={2} />
                        </i>
                        <span>
                          <small>Прибыль</small>
                          <b>{totals.withCost ? `${totals.profit > 0 ? "+" : ""}${som(totals.profit)}` : "—"}</b>
                        </span>
                      </span>
                      <span className="no-cp-stub">
                        <b>{totals.withCost && totals.cost > 0 ? Math.round((totals.profit / totals.cost) * 100) + "%" : "—"}</b>
                        <small>наценка</small>
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="no-rc-f">
                <div className="no-rf">
                  <span>Когда оформлен</span>
                  <div className="no-dt">
                    <DatePicker value={orderDate} onChange={setOrderDate} width="100%" height={40} words ariaLabel="Дата заказа" popClass="ovp" />
                    <TimePicker value={time ?? clock} auto={time === null} onChange={setTime} onNow={() => setTime(null)} width="100%" height={40} ariaLabel="Время заказа" popClass="ovp" />
                  </div>
                </div>
                <div className="no-rf">
                  <span>Оплата</span>
                  {pay === "part" ? (
                    <div className="no-pay-part">
                      <MoneyCell
                        inputRef={(el) => {
                          paidRef.current = el;
                        }}
                        value={paid}
                        onChange={setPaid}
                        placeholder="сколько оплатил"
                      />
                      <button type="button" className="no-pay-q" disabled={!totals.sale} onClick={() => setPaid(String(Math.round(totals.sale / 2)))} title="Половина суммы заказа">
                        50%
                      </button>
                      {totals.withCost && totals.cost > 0 && totals.cost < totals.sale && (
                        <button type="button" className="no-pay-q" onClick={() => setPaid(String(Math.round(totals.cost)))} title="Оплатил выкуп — остальное при выдаче">
                          = выкуп
                        </button>
                      )}
                      <button
                        type="button"
                        className="no-pay-x"
                        onClick={() => {
                          setPay("none");
                          setPaid("");
                        }}
                        title="Отменить частичную оплату"
                        aria-label="Отменить частичную оплату"
                      >
                        <Svg paths={I_CLOSE} size={14} sw={2.4} />
                      </button>
                    </div>
                  ) : (
                    <SlideTabs<"none" | "full" | "part">
                      value={pay}
                      onChange={setPay}
                      counts={false}
                      options={[
                        ["none", "Не оплачено"],
                        ["full", "Полностью"],
                        ["part", "Частично"],
                      ]}
                    />
                  )}
                  <div className="no-paybar">
                    <span>
                      <i style={{ width: `${paidShare}%` }} />
                    </span>
                    <small>
                      оплачено <b>{som(totals.paid)}</b>
                    </small>
                    <small>
                      долг <b className={debt > 0 ? "owe" : ""}>{som(debt)}</b>
                    </small>
                  </div>
                </div>
                <div className="no-rf">
                  <span>Комментарий</span>
                  <input className="no-in" value={comment} onChange={(e) => setComment(cased(e, capFirst))} placeholder="необязательно — например, «доставка до двери»" />
                </div>
              </div>

              {error && (
                <div role="alert" className="no-err">
                  {error}
                </div>
              )}
              <button type="button" className="no-save" disabled={busy} onClick={save} title="Сохранить заказ (Ctrl+Enter)">
                {busy ? (
                  "Сохраняю…"
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Сохранить заказ
                    {isDesktop && <kbd>Ctrl+Enter</kbd>}
                  </>
                )}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </Page>
  );
}

/** Состояние оплаты сохранённого заказа — подпись и цвета. */
function payState(s: Saved) {
  const debt = Math.max(0, s.sum - s.paid);
  if (debt <= 0.001) return { label: "оплачен", long: "Оплачен полностью", dot: ST.paid.dot, bg: ST.paid.bg, fg: ST.paid.fg };
  if (s.paid > 0) return { label: `долг ${som(debt)}`, long: `Оплачен частично · долг ${som(debt)}`, dot: ST.partial.dot, bg: ST.partial.bg, fg: ST.partial.fg };
  return { label: `долг ${som(debt)}`, long: "Не оплачен", dot: ST.unpaid.dot, bg: ST.unpaid.bg, fg: ST.unpaid.fg };
}

const dateRu = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** Плашка «Заказ сохранён»: кому, сколько, оплата, что в заказе — и дальше: детали, ещё заказ, клиент. */
function SavedBanner({ saved, onDetails, onAgain, onOpen, onClose }: { saved: Saved; onDetails: () => void; onAgain: () => void; onOpen: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [saved]);
  const pay = payState(saved);
  const debt = Math.max(0, saved.sum - saved.paid);
  const names = saved.items.map((i) => i.name);
  const preview = names.slice(0, 3).join(" · ") + (names.length > 3 ? ` и ещё ${names.length - 3}` : "");
  return (
    <div ref={ref} role="status" className="ov-card no-saved">
      <span className="no-saved-ic">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: "checkDraw .4s .15s ease forwards" }} />
        </svg>
      </span>
      <div className="no-saved-t">
        <b>
          Заказ сохранён
          {saved.isNew && (
            <i>
              <Svg paths={I_USER} size={11} sw={2.4} />
              новый клиент
            </i>
          )}
        </b>
        <small>
          <span>{saved.name}</span>
          {saved.phone && <span className="ph"> · {saved.phone}</span>}
        </small>
        <span className="no-saved-chips">
          <em>
            {saved.items.length} {plural(saved.items.length, "товар", "товара", "товаров")}
          </em>
          <em className="b">{som(saved.sum)}</em>
          <em className={debt > 0.001 ? "owe" : ""}>{pay.label}</em>
          <em>
            {saved.date === todayIso() ? "сегодня" : dateRu(saved.date)} · {saved.time}
          </em>
        </span>
        {preview && <span className="no-saved-pv">{preview}</span>}
      </div>
      <div className="no-saved-a">
        <button type="button" className="no-btn dark" onClick={onDetails}>
          <Svg paths={I_RECEIPT} size={14} sw={2} />
          Детали заказа
        </button>
        <button type="button" className="no-btn" onClick={onAgain} title="Новый заказ этому же клиенту">
          <Svg paths={I_PLUS} size={13} sw={2.2} />
          Ещё этому клиенту
        </button>
        <button type="button" className="no-btn ghost" onClick={onOpen}>
          Клиент
          <Svg paths={I_ARROW_RIGHT} size={13} sw={2.2} />
        </button>
      </div>
      <button type="button" className="no-saved-x" onClick={onClose} aria-label="Скрыть" title="Скрыть">
        <Svg paths={I_CLOSE} size={13} sw={2.2} />
      </button>
    </div>
  );
}

/** Детали сохранённого заказа — окно в виде чека: товары, итоги, оплата. */
function OrderDetails({ saved, onClose, onAgain, onOpen }: { saved: Saved; onClose: () => void; onAgain: () => void; onOpen: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const pay = payState(saved);
  const debt = Math.max(0, saved.sum - saved.paid);
  const st = saved.status === "in_stock" ? ST.in_stock : ST.ordered;
  const line = "display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:13px;padding:3px 0";

  return (
    <div className="md-overlay" style={css("z-index:80")} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="md-dialog thin-scroll" role="dialog" aria-modal="true" aria-label="Детали заказа" style={css("width:560px;overflow:auto")}>
        {/* Шапка-чек */}
        <div style={css("position:relative;padding:20px 22px 22px;color:#fff;background:radial-gradient(circle at 100% 0,rgba(255,255,255,.22),transparent 46%),linear-gradient(135deg,var(--accent),var(--violet-dot))")}>
          <div style={css("display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;opacity:.92;padding-right:38px")}>
            <Svg paths={I_RECEIPT} size={16} sw={2} />
            Детали заказа
            <span style={css("margin-left:auto;font-size:12px;opacity:.85")}>
              {dateRu(saved.date)} · {saved.time}
            </span>
          </div>
          <div style={css(NUM + ";font-size:34px;font-weight:700;letter-spacing:-.025em;line-height:1.2;margin-top:10px")}>{som(saved.sum)}</div>
          <div style={css("font-size:13px;opacity:.9;margin-top:2px")}>
            {saved.name}
            {saved.phone ? ` · ${saved.phone}` : ""}
          </div>
          <div style={css("display:flex;gap:6px;flex-wrap:wrap;margin-top:12px")}>
            <span style={css("display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:11.5px;font-weight:600;background:rgba(255,255,255,.18)")}>
              <span style={mix("width:6px;height:6px;border-radius:50%", { background: st.dot })} />
              {st.label}
            </span>
            <span style={css("display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:11.5px;font-weight:600;background:rgba(255,255,255,.18)")}>
              <span style={mix("width:6px;height:6px;border-radius:50%", { background: pay.dot })} />
              {pay.long}
            </span>
            {saved.isNew && <span style={css("display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:999px;font-size:11.5px;font-weight:600;background:rgba(255,255,255,.18)")}>новый клиент</span>}
          </div>
          <HButton
            onClick={onClose}
            aria-label="Закрыть"
            s="position:absolute;top:12px;right:12px;width:28px;height:28px;display:grid;place-items:center;padding:0;border:none;border-radius:8px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer"
            hover="background:rgba(255,255,255,.26)"
          >
            <Svg paths={I_CLOSE} size={14} sw={2.2} />
          </HButton>
        </div>

        {/* Товары */}
        <div style={css("padding:16px 22px 4px")}>
          <div style={css("font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-4);margin-bottom:6px")}>
            Товары · {saved.items.length}
          </div>
          {saved.items.map((it, i) => {
            const profit = it.cost !== null ? it.sale - it.cost : null;
            return (
              <div key={it.id} style={mix("display:flex;align-items:center;gap:12px;padding:10px 0", i > 0 && "border-top:1px dashed var(--border-2)")}>
                <span style={css("width:24px;height:24px;border-radius:7px;flex:none;display:grid;place-items:center;font-size:11px;font-weight:700;background:var(--surface-2);color:var(--text-3)")}>{i + 1}</span>
                <div style={css("flex:1;min-width:0")}>
                  <div style={css("font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{it.name}</div>
                  <div style={css("font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                    {it.code ? <span style={css(MONO)}>{it.code}</span> : "без кода"} · {it.qty} шт{it.cost !== null ? ` · выкуп ${som(it.cost)}` : ""}
                  </div>
                </div>
                <div style={css("text-align:right;flex:none")}>
                  <div style={css(NUM + ";font-size:14px;font-weight:700;color:var(--text)")}>{som(it.sale)}</div>
                  <div style={mix(NUM + ";font-size:11.5px;font-weight:600", { color: profit === null ? "var(--text-5)" : profit < 0 ? "var(--danger)" : "var(--green)" })}>
                    {profit === null ? "—" : `${profit > 0 ? "+" : ""}${som(profit)}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Итоги */}
        <div style={css("margin:8px 22px 0;padding:12px 14px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border-2)")}>
          <div style={css(line)}>
            <span style={css("color:var(--text-3)")}>Сумма заказа</span>
            <b style={css(NUM + ";font-size:15px")}>{som(saved.sum)}</b>
          </div>
          <div style={css(line)}>
            <span style={css("color:var(--text-3)")}>Выкуп</span>
            <span style={css(NUM)}>{saved.cost === null ? "—" : som(saved.cost)}</span>
          </div>
          <div style={css(line)}>
            <span style={css("color:var(--text-3)")}>Прибыль</span>
            <b style={mix(NUM, { color: saved.profit === null ? "var(--text-5)" : saved.profit < 0 ? "var(--danger)" : "var(--green)" })}>
              {saved.profit === null ? "—" : `${saved.profit > 0 ? "+" : ""}${som(saved.profit)}`}
            </b>
          </div>
          <div style={css("border-top:1px dashed var(--border);margin:6px 0")} />
          <div style={css(line)}>
            <span style={css("color:var(--text-3)")}>Оплачено</span>
            <b style={css(NUM + ";color:var(--green)")}>{som(saved.paid)}</b>
          </div>
          <div style={css(line)}>
            <span style={css("color:var(--text-3)")}>Долг</span>
            <b style={mix(NUM, { color: debt > 0 ? "var(--danger)" : "var(--text-3)" })}>{som(debt)}</b>
          </div>
        </div>
        {saved.comment && (
          <div style={css("margin:10px 22px 0;font-size:12.5px;color:var(--text-2)")}>
            <span style={css("color:var(--text-4)")}>Комментарий: </span>
            {saved.comment}
          </div>
        )}

        <div style={css("display:flex;gap:8px;flex-wrap:wrap;padding:16px 22px 20px")}>
          <HButton
            onClick={onAgain}
            s="flex:1;height:40px;padding:0 14px;border:none;border-radius:11px;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap"
            hover="background:var(--accent-hover)"
          >
            <Svg paths={I_PLUS} size={14} sw={2.2} />
            Ещё заказ этому клиенту
          </HButton>
          <HButton
            onClick={onOpen}
            s="flex:1;height:40px;padding:0 14px;border:1px solid var(--border-strong);border-radius:11px;background:var(--surface);color:var(--text);font-size:13px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap"
            hover="border-color:var(--accent);color:var(--accent-strong)"
          >
            Открыть клиента
            <Svg paths={I_ARROW_RIGHT} size={14} sw={2.2} />
          </HButton>
        </div>
      </div>
    </div>
  );
}

type PathDef = [string, Record<string, unknown>][];

const I_RECEIPT: PathDef = [
  ["path", { d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" }],
  ["path", { d: "M8 8h8" }],
  ["path", { d: "M8 12h8" }],
  ["path", { d: "M8 16h5" }],
];
const I_USER_PLUS: PathDef = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
  ["circle", { cx: 9, cy: 7, r: 4 }],
  ["path", { d: "M19 8v6" }],
  ["path", { d: "M22 11h-6" }],
];
const I_EDIT: PathDef = [
  ["path", { d: "M12 20h9" }],
  ["path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" }],
];
const I_TRASH: PathDef = [
  ["path", { d: "M3 6h18" }],
  ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
  ["path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" }],
];


function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

/** Кружок с инициалами (тёмный — для выбранного клиента). */
/** Когда клиент последний раз заказывал — коротко. */
function agoShort(d: string | null): string {
  if (!d) return "без заказов";
  const days = Math.round((new Date(todayIso()).getTime() - new Date(d.slice(0, 10)).getTime()) / 86400000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 7) return `${days} дн. назад`;
  if (days < 31) return `${Math.floor(days / 7)} нед. назад`;
  return `${Math.floor(days / 30)} мес. назад`;
}

function Avatar({ name, size, dark }: { name: string; size: number; dark?: boolean }) {
  return (
    <span className={"no-av" + (dark ? " dark" : "")} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {initials(name)}
    </span>
  );
}

/** Пустой список товаров: подсказка по центру. */
function EmptyItems() {
  return (
    <div className="no-empty">
      <span className="no-empty-ic">
        <Svg paths={I_BOX} size={22} sw={1.8} />
      </span>
      <b>Пока пусто — добавьте первый товар</b>
      <small>
        Впишите его в строку выше и нажмите <Kbd>Enter</Kbd> · можно вставить сразу список из Excel
      </small>
    </div>
  );
}

/** Подсказки по клавишам — сменяются по кругу в шапке «Добавить товар». */
const TIPS: ReactNode[] = [
  <>
    <Kbd>Enter</Kbd> — добавить товар в заказ
  </>,
  <>
    <Kbd>Ctrl</Kbd>+<Kbd>V</Kbd> — вставить строки из Excel
  </>,
  <>
    <Kbd>↑</Kbd>
    <Kbd>↓</Kbd> — количество в поле «Шт»
  </>,
  <>
    <Kbd>Tab</Kbd> — к следующему полю
  </>,
];

function TipTicker() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % TIPS.length), 3800);
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="no-live tip">
      <span className="no-tip-t" key={i}>
        {TIPS[i]}
      </span>
      <span className="no-tip-dots" aria-hidden="true">
        {TIPS.map((_, k) => (
          <i key={k} className={k === i ? "on" : undefined} />
        ))}
      </span>
    </span>
  );
}

/** «Печать» оплаты на чеке: при смене статуса старая печать исчезает, новая «ставится» с нажимом и чернильным следом. */
function PayStamp({ st, label, sub }: { st: "full" | "part" | "none"; label: string; sub: string }) {
  const seq = useRef(0);
  const [list, setList] = useState([{ id: 0, st, label, sub }]);
  useEffect(() => {
    setList((l) => {
      const last = l[l.length - 1];
      if (last.st === st) return last.label === label && last.sub === sub ? l : [...l.slice(0, -1), { ...last, label, sub }];
      seq.current += 1;
      return [last, { id: seq.current, st, label, sub }];
    });
  }, [st, label, sub]);
  useEffect(() => {
    if (list.length < 2) return;
    const t = window.setTimeout(() => setList((l) => l.slice(-1)), 420);
    return () => window.clearTimeout(t);
  }, [list]);
  return (
    <span className="no-stampbox" title="Оплата заказа">
      {list.map((x, i) => (
        <span key={x.id} className={"no-stamp " + x.st + (i < list.length - 1 ? " out" : " in")}>
          <b>{x.label}</b>
          <small>{x.sub}</small>
        </span>
      ))}
    </span>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="no-kbd">{children}</kbd>;
}

/** Товар в списке: номер, название, код · шт · выкуп, сумма и прибыль; правка и удаление. */
function ItemRow({ row, index, fresh, onEdit, onRemove }: { row: Row; index: number; fresh: boolean; onEdit: () => void; onRemove: () => void }) {
  const price = money(row.price);
  const real = money(row.real);
  const profit = price !== null && real !== null ? price - real : null;
  const bad = rowError(row);
  const [ask, setAsk] = useState(false);
  const [out, setOut] = useState(false);
  const remove = () => {
    if (out) return;
    setOut(true);
    window.setTimeout(onRemove, 300);
  };
  useEffect(() => {
    if (!ask) return;
    const t = window.setTimeout(() => setAsk(false), 4000);
    return () => window.clearTimeout(t);
  }, [ask]);
  return (
    <div className={"no-it" + (fresh ? " fresh" : "") + (out ? " out" : "")} onDoubleClick={onEdit}>
      <span className="no-it-name">
        <i>{index + 1}</i>
        <span>
          <b>{row.name || "без названия"}</b>
          {bad && <em className="err">{bad.text}</em>}
        </span>
      </span>
      <span className="no-it-tags">
        <span className={"no-it-code" + (row.code ? "" : " none")} title={row.code ? "Код / трек" : undefined}>
          {row.code ? (
            <>
              <i>
                <Svg paths={[["path", { d: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 7.5v9M12 7.5v9M16 7.5v9" }]]} size={12} sw={2} />
              </i>
              {row.code}
            </>
          ) : (
            <>
              <i>
                <Svg paths={[["path", { d: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8.5 15.5l7-7" }]]} size={12} sw={2} />
              </i>
              без кода
            </>
          )}
        </span>
        <span className="no-it-qty" title="Количество">
          {row.qty}
          <small>шт</small>
        </span>
      </span>
      <span className="no-it-flow" title="выкуп → цена клиенту">
        <small>{real === null ? "—" : som(real)}</small>
        <Svg paths={I_ARROW_RIGHT} size={12} sw={2.2} />
        <b>{price === null ? "—" : som(price)}</b>
      </span>
      <span className={"no-it-pf" + (profit === null ? " none" : profit < 0 ? " neg" : "")} title="прибыль · наценка">
        {profit === null ? "—" : `${profit > 0 ? "+" : ""}${som(profit)}`}
        {profit !== null && real !== null && real > 0 && <small>{Math.round((profit / real) * 100)}%</small>}
      </span>
      <span className="no-it-act" onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onEdit} title="Изменить" aria-label="Изменить">
          <Svg paths={I_EDIT} size={14} sw={2} />
        </button>
        {ask ? (
          <button type="button" className="del ok" onClick={remove} onBlur={() => setAsk(false)} autoFocus title="Нажмите ещё раз — удалить" aria-label="Подтвердить удаление">
            <Svg paths={[["path", { d: "M20 6 9 17l-5-5" }]]} size={14} sw={2.8} />
          </button>
        ) : (
          <button type="button" className="del" onClick={() => setAsk(true)} title="Убрать из заказа" aria-label="Убрать из заказа">
            <Svg paths={I_TRASH} size={14} sw={2} />
          </button>
        )}
      </span>
    </div>
  );
}

/** Правка товара прямо в списке: Enter — сохранить, Esc — отменить. */
function EditRow({
  row,
  index,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  row: Row;
  index: number;
  error: string;
  onChange: (patch: Partial<Row>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      onSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="no-ed">
      <div className="no-ed-g">
        <span className="no-it-n on">{index + 1}</span>
        <input autoFocus className="no-in n" value={row.name} onChange={(e) => onChange({ name: cased(e, capFirst) })} onKeyDown={keys} placeholder="Название" />
        <input className="no-in mono c" value={row.code} onChange={(e) => onChange({ code: cased(e, upper) })} onKeyDown={keys} placeholder="Код" />
        <input className="no-in ctr q" value={row.qty} onChange={(e) => onChange({ qty: e.target.value })} onKeyDown={keys} inputMode="numeric" aria-label="Количество" />
        <MoneyCell value={row.price} onChange={(v) => onChange({ price: v })} onKeyDown={keys} placeholder="клиенту" />
        <MoneyCell value={row.real} onChange={(v) => onChange({ real: v })} onKeyDown={keys} placeholder="выкуп" />
        <span className="no-ed-a">
          <button type="button" className="ok" onClick={onSave} title="Сохранить строку (Enter)" aria-label="Сохранить строку">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
          <button type="button" onClick={onCancel} title="Отменить правку (Esc)" aria-label="Отменить правку">
            <Svg paths={I_CLOSE} size={15} sw={2.2} />
          </button>
        </span>
      </div>
      {error && <em className="err">{error}</em>}
    </div>
  );
}

/** Поле суммы со знаком «с» справа. */
function MoneyCell({
  value,
  onChange,
  placeholder,
  onKeyDown,
  invalid,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  invalid?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  return (
    <span className="no-money">
      <input ref={inputRef} className={"no-in" + (invalid ? " bad" : "")} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} inputMode="decimal" placeholder={placeholder} />
      <i>с</i>
    </span>
  );
}
