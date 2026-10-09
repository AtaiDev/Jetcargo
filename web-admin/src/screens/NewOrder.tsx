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
import CountUp from "../design/CountUp";
import { I_ARROW_RIGHT, I_BOX, I_CLOSE, I_PLUS, I_USER, Svg } from "../design/icons";
import { Page } from "../design/table";
import { HButton, ST, inputStyle } from "../design/ui";
import { cased, capFirst, parseMoney, som, todayIso, upper } from "../lib/cargo";
import { emit, useRefresh } from "../lib/events";
import PhoneInput from "../components/PhoneInput";
import CustomerSearch from "../components/CustomerSearch";
import DatePicker from "../components/DatePicker";
import TimePicker from "../components/TimePicker";

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

/** Цвета кассы — из темы, как у остальных карточек. */
const K = {
  text: "var(--text)",
  mut: "var(--text-3)",
  dim: "var(--text-4)",
  line: "var(--border-2)",
  soft: "var(--surface-2)",
  border: "var(--border-strong)",
  green: "var(--green)",
  red: "var(--danger)",
  amber: "var(--amber)",
  blue: "var(--accent-strong)",
};
const CARD = "background:var(--surface);border:1px solid var(--border);border-radius:16px";

export default function NewOrder({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const nav = useNavigate();
  const [params] = useSearchParams();

  // --- Клиент ---
  const [customer, setCustomer] = useState<CustomerCard | null>(null);
  const [newMode, setNewMode] = useState(false);
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
    listCustomers({ sort: "recent", limit: 6 })
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
  const [rows, setRows] = useState<Row[]>([]);
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
  const [pay, setPay] = useState<"none" | "full" | "part">("none");
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

  // Поля строки ввода: подпись над полем, ошибка — красной рамкой.
  const QUICK = isDesktop ? "minmax(0,2fr) minmax(0,1.15fr) 62px 116px 116px auto" : "repeat(4,minmax(0,1fr))";
  const qInput = (f: Field, extra = "") =>
    mix(inputStyle + ";height:42px;border-radius:10px;font-size:13.5px;background:var(--surface);" + extra, draftErr?.field === f && "border-color:var(--danger)!important;box-shadow:0 0 0 3px var(--danger-tint)");
  const qCell = (col: string, children: ReactNode, label: string) => (
    <label style={mix("display:flex;flex-direction:column;gap:5px;min-width:0", !isDesktop && { gridColumn: col })}>
      <span style={css("font-size:11px;font-weight:600;color:var(--text-3)")}>{label}</span>
      {children}
    </label>
  );

  return (
    <Page size="wide">
      <div style={css("display:flex;flex-direction:column;gap:14px")}>
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

        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "minmax(0,1fr) 384px" : "minmax(0,1fr)", gap: 16, alignItems: "stretch" }}>
          {/* ================= Слева: клиент, ввод, список ================= */}
          <div style={css("display:flex;flex-direction:column;gap:14px;min-width:0")}>
            {saved && (
              <SavedBanner
                saved={saved}
                isDesktop={isDesktop}
                onDetails={() => setDetails(true)}
                onAgain={() => {
                  pickCustomer(saved.id);
                  setSaved(null);
                }}
                onOpen={() => nav(`/customers/${saved.id}`)}
                onClose={() => setSaved(null)}
              />
            )}
            {/* --- Клиент --- */}
            <section style={css(CARD + ";position:relative;padding:14px 16px;overflow:visible")}>
              {customer ? (
                <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
                  <Avatar name={customer.customer.name} size={46} />
                  <div style={css("flex:1;min-width:140px")}>
                    <div style={css("font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-4)")}>Клиент</div>
                    <div style={css("font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{customer.customer.name}</div>
                    <div style={css(MONO + ";font-size:12.5px;color:var(--text-3)")}>{customer.customer.phone || "без телефона"}</div>
                  </div>
                  <div style={css("display:flex;gap:6px;flex-wrap:wrap")}>
                    <Fact label="заказано" value={String(customer.totals.ordered)} dot={ST.ordered.dot} />
                    <Fact label="на складе" value={String(customer.totals.in_stock)} dot={ST.in_stock.dot} />
                    <Fact label="долг" value={som(customer.totals.debt)} dot={customer.totals.debt > 0 ? ST.unpaid.dot : ST.paid.dot} danger={customer.totals.debt > 0} />
                  </div>
                  <HButton
                    onClick={() => {
                      setCustomer(null);
                      setSaved(null);
                    }}
                    title="Выбрать другого клиента"
                    s={mix(
                      "width:36px;height:36px;display:grid;place-items:center;padding:0;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text-3);cursor:pointer",
                      !isDesktop && "position:absolute;top:12px;right:12px"
                    )}
                    hover="border-color:var(--danger);color:var(--danger);background:var(--danger-tint)"
                  >
                    <Svg paths={I_CLOSE} size={15} sw={2} />
                  </HButton>
                </div>
              ) : newMode ? (
                <div style={css("display:flex;flex-direction:column;gap:8px")}>
                  <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
                    <span style={css("width:46px;height:46px;border-radius:50%;flex:none;display:grid;place-items:center;border:1.5px dashed var(--accent);color:var(--accent);background:var(--accent-tint2)")}>
                      <Svg paths={I_USER_PLUS} size={20} sw={1.9} />
                    </span>
                    <div style={{ flex: 1, minWidth: 200, display: "grid", gridTemplateColumns: isDesktop ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)", gap: 10 }}>
                      <input
                        ref={nameRef}
                        value={newName}
                        onChange={(e) => setNewName(cased(e, capFirst))}
                        placeholder="Имя нового клиента"
                        style={css(inputStyle + ";height:42px;border-radius:10px;font-size:13.5px")}
                      />
                      <div ref={phoneBox}>
                        <PhoneInput value={newPhone} onChange={setNewPhone} height={42} />
                      </div>
                    </div>
                    <HButton
                      onClick={cancelNew}
                      s="height:42px;padding:0 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text-2);font-size:12.5px;cursor:pointer"
                      hover="border-color:var(--accent);color:var(--accent-strong)"
                    >
                      Найти в базе
                    </HButton>
                  </div>
                  <div style={css("font-size:11.5px;color:var(--text-4);padding-left:58px")}>
                    Новый клиент · если такой номер уже есть в базе, заказ добавится к этому клиенту
                  </div>
                </div>
              ) : (
                <div style={css("display:flex;flex-direction:column;gap:10px")}>
                  <div style={css("display:flex;gap:10px;align-items:center")}>
                    <div style={css("flex:1;min-width:0")}>
                      <CustomerSearch autoFocus onPick={pickCustomer} onCreate={prefillNew} />
                    </div>
                    <HButton
                      onClick={openNew}
                      s="height:44px;padding:0 14px;border:1px dashed var(--border-strong);border-radius:10px;background:transparent;color:var(--text-2);font-size:13px;font-weight:500;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;cursor:pointer;flex:none"
                      hover="border-color:var(--accent);color:var(--accent);background:var(--accent-tint2)"
                    >
                      <Svg paths={I_USER_PLUS} size={16} sw={1.9} />
                      {isDesktop ? "Новый клиент" : "Новый"}
                    </HButton>
                  </div>
                  {recent.length > 0 && (
                    <div style={css("display:flex;align-items:center;gap:6px;flex-wrap:wrap")}>
                      <span style={css("font-size:11.5px;color:var(--text-4);margin-right:2px")}>Недавние:</span>
                      {recent.map((c) => (
                        <HButton
                          key={c.id}
                          onClick={() => pickCustomer(c.id)}
                          title={c.debt > 0 ? `${c.phone || c.name} · долг ${som(c.debt)}` : c.phone || c.name}
                          s="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px 0 3px;border:1px solid var(--border);border-radius:999px;background:var(--surface);font-size:12px;color:var(--text);cursor:pointer;max-width:200px"
                          hover="border-color:var(--accent);background:var(--accent-tint2)"
                        >
                          <Avatar name={c.name} size={22} />
                          <span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.name}</span>
                          {c.debt > 0 && <span style={css("flex:none;width:6px;height:6px;border-radius:50%;background:var(--danger-dot)")} />}
                        </HButton>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* --- Строка быстрого ввода --- */}
            <section
              style={css(
                "position:relative;border-radius:16px;padding:14px 16px 12px;background:linear-gradient(135deg,var(--accent-tint) 0%,var(--surface) 55%);border:1px solid var(--accent-border);box-shadow:0 8px 24px color-mix(in srgb,var(--accent) 9%,transparent)"
              )}
            >
              <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap")}>
                <span style={css("width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--accent),var(--violet-dot));box-shadow:0 3px 8px color-mix(in srgb,var(--accent) 35%,transparent)")}>
                  <Svg paths={I_PLUS} size={15} sw={2.4} />
                </span>
                <span style={css("font-size:14.5px;font-weight:700")}>Добавить товар</span>
                {isDesktop && (
                  <span style={css("margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-4)")}>
                    <Kbd>Enter</Kbd> — в список · можно вставить строки из Excel
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: QUICK, gap: 8, alignItems: "end" }}>
                {qCell(
                  "1 / -1",
                  <input
                    ref={(el) => {
                      draftRefs.current.name = el;
                    }}
                    value={draft.name}
                    onChange={(e) => setD({ name: cased(e, capFirst) })}
                    onKeyDown={onDraftKey}
                    onPaste={pasteRows}
                    placeholder="Название товара"
                    style={qInput("name")}
                  />,
                  "Название"
                )}
                {qCell(
                  "1 / 4",
                  <input
                    ref={(el) => {
                      draftRefs.current.code = el;
                    }}
                    value={draft.code}
                    onChange={(e) => setD({ code: cased(e, upper) })}
                    onKeyDown={onDraftKey}
                    placeholder="Трек"
                    autoCapitalize="characters"
                    spellCheck={false}
                    style={qInput("code", MONO)}
                  />,
                  "Код / трек"
                )}
                {qCell(
                  "4 / 5",
                  <input
                    ref={(el) => {
                      draftRefs.current.qty = el;
                    }}
                    value={draft.qty}
                    onChange={(e) => setD({ qty: e.target.value })}
                    onKeyDown={onDraftKey}
                    inputMode="numeric"
                    style={qInput("qty", NUM + ";text-align:center;padding:0 6px")}
                  />,
                  "Шт"
                )}
                {qCell(
                  "1 / 3",
                  <MoneyCell
                    inputRef={(el) => {
                      draftRefs.current.price = el;
                    }}
                    value={draft.price}
                    onChange={(v) => setD({ price: v })}
                    onKeyDown={onDraftKey}
                    placeholder="0"
                    height={42}
                    invalid={draftErr?.field === "price"}
                  />,
                  "Клиенту"
                )}
                {qCell(
                  "3 / 5",
                  <MoneyCell
                    inputRef={(el) => {
                      draftRefs.current.real = el;
                    }}
                    value={draft.real}
                    onChange={(v) => setD({ real: v })}
                    onKeyDown={onDraftKey}
                    placeholder="0"
                    height={42}
                    invalid={draftErr?.field === "real"}
                  />,
                  "Выкуп"
                )}
                <HButton
                  onClick={addDraft}
                  title="Добавить в список (Enter)"
                  s={mix(
                    "height:42px;padding:0 16px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap;box-shadow:0 4px 12px color-mix(in srgb,var(--accent) 30%,transparent)",
                    !isDesktop && "grid-column:1 / -1"
                  )}
                  hover="background:var(--accent-hover)"
                >
                  <Svg paths={I_PLUS} size={14} sw={2.4} />
                  Добавить
                </HButton>
              </div>
              <div style={css("display:flex;align-items:center;gap:10px;min-height:18px;margin-top:8px;font-size:12px")}>
                {draftErr ? (
                  <span style={css("color:var(--danger);font-weight:500")}>⚠ {draftErr.text}</span>
                ) : draftProfit !== null ? (
                  <span style={mix("font-weight:600;" + NUM, { color: draftProfit < 0 ? "var(--danger)" : "var(--green)" })}>
                    прибыль с товара {draftProfit > 0 ? "+" : ""}
                    {som(draftProfit)}
                  </span>
                ) : (
                  <span style={css("color:var(--text-4)")}>Впишите название и сумму — Enter добавит товар в заказ</span>
                )}
              </div>
            </section>

            {/* --- Список товаров --- */}
            <section style={css(CARD + ";display:flex;flex-direction:column;flex:1;min-height:220px;overflow:hidden")}>
              <div style={css("display:flex;align-items:center;gap:10px;padding:14px 16px 12px")}>
                <span style={css("width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--accent-tint);color:var(--accent)")}>
                  <Svg paths={I_BOX} size={16} sw={1.9} />
                </span>
                <span style={css("font-size:15px;font-weight:700")}>Товары в заказе</span>
                {rows.length > 0 && (
                  <span style={css("font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border-2);color:var(--text-2);" + NUM)}>
                    {rows.length} {plural(rows.length, "позиция", "позиции", "позиций")} · {totals.qty} шт
                  </span>
                )}
              </div>

              {rows.length === 0 ? (
                <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px 16px 30px;text-align:center")}>
                  <span style={css("width:56px;height:56px;border-radius:18px;display:grid;place-items:center;background:var(--surface-2);border:1px dashed var(--border-strong);color:var(--text-4)")}>
                    <Svg paths={I_BOX} size={24} sw={1.6} />
                  </span>
                  <div style={css("font-size:14px;font-weight:600;color:var(--text-2)")}>Пока пусто</div>
                  <div style={css("font-size:12.5px;color:var(--text-4);max-width:360px;line-height:1.5")}>
                    Впишите товар в строку выше и нажмите <Kbd>Enter</Kbd> — он появится здесь. Можно вставить сразу весь список из Excel.
                  </div>
                </div>
              ) : (
                <div style={css("display:flex;flex-direction:column")}>
                  {rows.map((r, i) =>
                    editing?.key === r.key ? (
                      <EditRow
                        key={r.key}
                        row={editing}
                        index={i}
                        isDesktop={isDesktop}
                        error={editErr}
                        onChange={(patch) => {
                          setEditing((e) => (e ? { ...e, ...patch } : e));
                          setEditErr("");
                        }}
                        onSave={saveEdit}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <ItemRow key={r.key} row={r} index={i} compact={!isDesktop} fresh={fresh === r.key} onEdit={() => startEdit(r)} onRemove={() => removeRow(r.key)} />
                    )
                  )}
                </div>
              )}
            </section>
          </div>

          {/* ================= Справа: касса ================= */}
          <aside
            style={mix(
              CARD + ";position:relative;min-width:0;color:var(--text)",
              // На высоте экрана: середина прокручивается, «Сохранить» всегда видна внизу.
              isDesktop ? "align-self:start;position:sticky;top:16px;display:flex;flex-direction:column;max-height:calc(100vh - 112px)" : "display:flex;flex-direction:column"
            )}
          >
            <div style={css("position:relative;flex:none;padding:18px 20px 0")}>
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <Svg paths={I_RECEIPT} size={15} sw={2} />
                <span style={mix("font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase", { color: K.mut })}>Касса</span>
                <span style={mix("margin-left:auto;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;" + NUM, { background: K.soft, color: K.mut })}>
                  {rows.length} {plural(rows.length, "позиция", "позиции", "позиций")} · {totals.qty} шт
                </span>
              </div>
              <div style={css("display:flex;align-items:center;gap:9px;margin-top:14px;min-width:0")}>
                {who ? <Avatar name={who} size={28} /> : <span style={mix("width:28px;height:28px;border-radius:50%;flex:none;border:1.5px dashed", { borderColor: K.border })} />}
                <span style={mix("font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: who ? K.text : K.dim })}>
                  {who || "клиент не выбран"}
                </span>
                {!customer && who && <span style={mix("flex:none;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px", { background: "var(--accent-tint)", color: K.blue })}>новый</span>}
              </div>
              <div style={mix("font-size:12px;margin-top:14px", { color: K.mut })}>Сумма заказа</div>
              <div style={css("font-size:42px;font-weight:700;letter-spacing:-.03em;line-height:1.1;white-space:nowrap;" + NUM)}>
                <CountUp text={som(totals.sale)} duration={450} />
              </div>
              {!isBlank(draft) && (
                <div style={mix("font-size:11.5px;margin-top:4px", { color: K.amber })}>+ товар в строке ввода — Enter, чтобы добавить</div>
              )}
            </div>

            <div style={css("position:relative;flex:none;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:14px 20px 0")}>
              <DarkStat label="Выкуп" value={totals.withCost ? som(totals.cost) : "—"} sub={totals.withCost && totals.sale > 0 ? `${Math.round((totals.cost / totals.sale) * 100)}% от суммы` : "впишите выкуп"} />
              <DarkStat
                label="Прибыль"
                value={totals.withCost ? `${totals.profit > 0 ? "+" : ""}${som(totals.profit)}` : "—"}
                color={totals.withCost ? (totals.profit < 0 ? K.red : K.green) : undefined}
                badge={totals.withCost && totals.cost > 0 ? `${totals.profit >= 0 ? "+" : ""}${Math.round((totals.profit / totals.cost) * 100)}%` : undefined}
                sub={totals.withCost ? "наценка на выкуп" : "появится с выкупом"}
              />
            </div>

            <div className="thin-scroll" style={mix("position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding:16px 20px;margin-top:14px;border-top:1px solid", { borderColor: K.line })}>
              <DField label="Когда оформлен">
                <div style={css("display:grid;grid-template-columns:minmax(0,1fr) 118px;gap:8px")}>
                  <DatePicker value={orderDate} onChange={setOrderDate} width="100%" height={38} words ariaLabel="Дата заказа" />
                  <TimePicker value={time ?? clock} auto={time === null} onChange={setTime} onNow={() => setTime(null)} width="100%" height={38} ariaLabel="Время заказа" />
                </div>
              </DField>
              <DField label="Статус товаров">
                <DarkSeg
                  value={status}
                  onChange={setStatus}
                  options={[
                    { key: "ordered", label: "Заказан", color: K.amber },
                    { key: "in_stock", label: "Уже на складе", color: K.blue },
                  ]}
                />
              </DField>
              <DField label="Оплата">
                <DarkSeg
                  value={pay}
                  onChange={setPay}
                  options={[
                    { key: "none", label: "Не оплачено", color: K.red },
                    { key: "full", label: "Полностью", color: K.green },
                    { key: "part", label: "Частично", color: K.amber },
                  ]}
                />
                {pay === "part" && (
                  <div style={css("margin-top:8px")}>
                    <MoneyCell value={paid} onChange={setPaid} placeholder={totals.sale > 0 ? `сколько оплатил из ${totals.sale.toLocaleString("ru-RU")}` : "сколько оплатил"} height={38} />
                  </div>
                )}
                <div style={css("margin-top:10px")}>
                  <div style={mix("height:6px;border-radius:4px;overflow:hidden", { background: totals.sale > 0 ? "var(--danger-tint)" : K.soft })}>
                    <div style={mix("height:100%;border-radius:4px;transition:width .3s ease", { width: `${paidShare}%`, background: K.green })} />
                  </div>
                  <div style={mix("display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:12px;white-space:nowrap", { color: K.mut })}>
                    <span>
                      оплачено <b style={mix(NUM, { color: K.green })}>{som(totals.paid)}</b>
                    </span>
                    <span>
                      долг <b style={mix(NUM, { color: debt > 0 ? K.red : K.mut })}>{som(debt)}</b>
                    </span>
                  </div>
                </div>
              </DField>
              <DField label="Комментарий">
                <input
                  value={comment}
                  onChange={(e) => setComment(cased(e, capFirst))}
                  placeholder="необязательно — например, «доставка до двери»"
                  style={css(inputStyle + ";height:38px;border-radius:10px")}
                />
              </DField>
            </div>

            <div style={mix("position:relative;flex:none;display:flex;flex-direction:column;gap:10px;padding:14px 20px 18px;border-top:1px solid", { borderColor: K.line })}>
              {error && (
                <div role="alert" style={mix("padding:9px 12px;border-radius:10px;font-size:12.5px;line-height:1.4", { background: "var(--danger-tint)", border: "1px solid var(--danger-border)", color: "var(--danger)" })}>
                  {error}
                </div>
              )}
              <HButton
                disabled={busy}
                onClick={save}
                title="Сохранить заказ (Ctrl+Enter)"
                s="height:54px;width:100%;border:none;border-radius:14px;background:linear-gradient(135deg,#5B7CFA 0%,#7C5CF6 100%);color:#fff;font-size:15.5px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 12px 28px rgba(91,124,250,.45),inset 0 1px 0 rgba(255,255,255,.25);transition:transform .12s,box-shadow .12s,filter .12s"
                hover="filter:brightness(1.08);box-shadow:0 14px 34px rgba(91,124,250,.55),inset 0 1px 0 rgba(255,255,255,.25)"
              >
                {busy ? (
                  "Сохраняю…"
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Сохранить заказ
                    {isDesktop && <span style={css("font-size:11px;font-weight:600;padding:2px 7px;border-radius:6px;background:rgba(255,255,255,.18)")}>Ctrl+Enter</span>}
                  </>
                )}
              </HButton>
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

/**
 * Карточка «Заказ сохранён» над формой: кому, сколько, оплата, что в заказе —
 * и дальше: детали, ещё заказ этому клиенту или карточка клиента.
 */
function SavedBanner({
  saved,
  isDesktop,
  onDetails,
  onAgain,
  onOpen,
  onClose,
}: {
  saved: Saved;
  isDesktop: boolean;
  onDetails: () => void;
  onAgain: () => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [saved]);
  const pay = payState(saved);
  const names = saved.items.map((i) => i.name);
  const preview = names.slice(0, 3).join(" · ") + (names.length > 3 ? ` и ещё ${names.length - 3}` : "");
  const chip = "display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap";

  return (
    <div
      ref={ref}
      role="status"
      style={mix(
        "position:relative;overflow:hidden;display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px;padding:16px 18px;border-radius:16px;animation:slideUp .25s ease",
        {
          border: "1px solid color-mix(in srgb, var(--green-dot) 40%, var(--border))",
          background: "radial-gradient(circle at 0 50%, color-mix(in srgb, var(--green-dot) 16%, transparent), transparent 40%), var(--surface)",
          boxShadow: "0 10px 30px color-mix(in srgb, var(--green-dot) 12%, transparent)",
        }
      )}
    >
      {/* Галочка с пульсирующим кольцом */}
      <span className="saved-check" style={css("position:relative;width:48px;height:48px;border-radius:50%;flex:none;display:grid;place-items:center;background:linear-gradient(135deg,var(--green-dot),color-mix(in srgb,var(--green-dot) 70%,var(--accent)));color:#fff")}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" style={css("stroke-dasharray:24;stroke-dashoffset:24;animation:checkDraw .4s .15s ease forwards")} />
        </svg>
      </span>

      <div style={css("flex:1;min-width:220px")}>
        <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap")}>
          <span style={css("font-size:16px;font-weight:700;color:var(--text)")}>Заказ сохранён</span>
          {saved.isNew && (
            <span style={css(chip + ";height:22px;padding:0 8px;font-size:11px;background:var(--accent-tint);color:var(--accent-strong)")}>
              <Svg paths={I_USER} size={11} sw={2.4} />
              новый клиент
            </span>
          )}
        </div>
        <div style={css("font-size:13px;color:var(--text-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
          <b style={css("font-weight:600;color:var(--text)")}>{saved.name}</b>
          {saved.phone && <span style={css(MONO + ";font-size:12px;color:var(--text-4)")}> · {saved.phone}</span>}
        </div>
        <div style={css("display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:9px")}>
          <span style={css(chip + ";background:var(--surface-2);border:1px solid var(--border-2);color:var(--text-2)")}>
            <Svg paths={I_BOX} size={12} sw={2} />
            {saved.items.length} {plural(saved.items.length, "товар", "товара", "товаров")}
          </span>
          <span style={css(chip + ";background:var(--surface-2);border:1px solid var(--border-2);color:var(--text);" + NUM)}>{som(saved.sum)}</span>
          <span style={mix(chip, { background: pay.bg, color: pay.fg })}>
            <span style={mix("width:6px;height:6px;border-radius:50%", { background: pay.dot })} />
            {pay.label}
          </span>
          <span style={css(chip + ";background:var(--surface-2);border:1px solid var(--border-2);color:var(--text-3);font-weight:500")}>
            {saved.date === todayIso() ? "сегодня" : dateRu(saved.date)} · {saved.time}
          </span>
        </div>
        <div style={css("font-size:11.5px;color:var(--text-4);margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{preview}</div>
      </div>

      <div style={mix("display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto", !isDesktop && "width:100%")}>
        <HButton
          onClick={onDetails}
          s="height:36px;padding:0 14px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;box-shadow:0 4px 12px color-mix(in srgb,var(--accent) 30%,transparent)"
          hover="background:var(--accent-hover)"
        >
          <Svg paths={I_RECEIPT} size={14} sw={2} />
          Детали заказа
        </HButton>
        <HButton
          onClick={onAgain}
          title="Новый заказ этому же клиенту"
          s="height:36px;padding:0 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text-2);font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap"
          hover="border-color:var(--accent);color:var(--accent-strong)"
        >
          <Svg paths={I_PLUS} size={13} sw={2.2} />
          Ещё этому клиенту
        </HButton>
        <HButton
          onClick={onOpen}
          s="height:36px;padding:0 10px;border:none;border-radius:10px;background:transparent;color:var(--text-3);font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap"
          hover="color:var(--accent-strong);background:var(--accent-tint2)"
        >
          Клиент
          <Svg paths={I_ARROW_RIGHT} size={13} sw={2.2} />
        </HButton>
      </div>

      <HButton
        onClick={onClose}
        aria-label="Скрыть"
        title="Скрыть"
        s="position:absolute;top:8px;right:8px;width:26px;height:26px;display:grid;place-items:center;padding:0;border:none;border-radius:7px;background:transparent;color:var(--text-5);cursor:pointer"
        hover="background:var(--hover);color:var(--text)"
      >
        <Svg paths={I_CLOSE} size={13} sw={2} />
      </HButton>
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

/** Аватар-буква; цвет — от имени, чтобы у клиента он всегда был один и тот же. */
const AVATAR_BG = [
  "linear-gradient(135deg,#5B7CFA,#8B5CF6)",
  "linear-gradient(135deg,#22C55E,#0EA5E9)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#EC4899,#8B5CF6)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
];
function Avatar({ name, size }: { name: string; size: number }) {
  const n = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return (
    <span
      style={mix("border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-weight:700", {
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

/** Сводка по выбранному клиенту: заказано / на складе / долг. */
function Fact({ label, value, dot, danger }: { label: string; value: string; dot: string; danger?: boolean }) {
  return (
    <span
      style={mix("display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:999px;font-size:12px;white-space:nowrap", {
        background: danger ? "var(--danger-tint)" : "var(--surface-2)",
        border: `1px solid ${danger ? "var(--danger-border)" : "var(--border-2)"}`,
        color: danger ? "var(--danger)" : "var(--text-3)",
      })}
    >
      <span style={mix("width:6px;height:6px;border-radius:50%", { background: dot })} />
      {label}
      <b style={mix(NUM, { color: danger ? "var(--danger)" : "var(--text)" })}>{value}</b>
    </span>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span style={css(MONO + ";font-size:10.5px;padding:1px 6px;border-radius:5px;border:1px solid var(--border-strong);border-bottom-width:2px;background:var(--surface);color:var(--text-2)")}>
      {children}
    </span>
  );
}

/** Товар в списке: номер, название, код · шт · выкуп, сумма и прибыль; правка и удаление. */
function ItemRow({ row, index, compact, fresh, onEdit, onRemove }: { row: Row; index: number; compact: boolean; fresh: boolean; onEdit: () => void; onRemove: () => void }) {
  const price = money(row.price);
  const real = money(row.real);
  const profit = price !== null && real !== null ? price - real : null;
  const bad = rowError(row);
  return (
    <div className={"po-item" + (fresh ? " po-fresh" : "")} onDoubleClick={onEdit} style={css(`display:flex;align-items:center;gap:${compact ? 10 : 14}px;padding:11px ${compact ? 12 : 16}px;border-top:1px solid var(--border-2)`)}>
      <span style={css("width:30px;height:30px;border-radius:9px;flex:none;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--accent-tint);color:var(--accent-strong);" + NUM)}>
        {index + 1}
      </span>
      <div style={css("flex:1;min-width:0")}>
        <div style={css("font-size:14px;font-weight:600;color:var(--text);" + (compact ? "line-height:1.3" : "white-space:nowrap;overflow:hidden;text-overflow:ellipsis"))}>{row.name || "без названия"}</div>
        <div style={css("display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-4);margin-top:2px;white-space:nowrap;overflow:hidden")}>
          {row.code ? (
            <span style={css(MONO + ";font-size:11.5px;padding:0 6px;border-radius:5px;background:var(--surface-2);border:1px solid var(--border-2);color:var(--text-2)")}>{row.code}</span>
          ) : (
            <span>без кода</span>
          )}
          <span>·</span>
          <span style={css(NUM)}>{row.qty} шт</span>
          <span>·</span>
          <span style={css(NUM)}>выкуп {real === null ? "—" : som(real)}</span>
        </div>
        {bad && <div style={css("font-size:11.5px;color:var(--danger);margin-top:2px")}>⚠ {bad.text}</div>}
      </div>
      <div style={css("text-align:right;flex:none")}>
        <div style={css("font-size:15px;font-weight:700;color:var(--text);" + NUM)}>{price === null ? "—" : som(price)}</div>
        <div style={mix("font-size:12px;font-weight:600;" + NUM, { color: profit === null ? "var(--text-5)" : profit < 0 ? "var(--danger)" : "var(--green)" })}>
          {profit === null ? "прибыль —" : `${profit > 0 ? "+" : ""}${som(profit)}`}
        </div>
      </div>
      <div className="po-actions" style={css("display:flex;gap:4px;flex:none" + (compact ? ";flex-direction:column" : ""))}>
        <HButton
          onClick={onEdit}
          title="Изменить"
          s="width:32px;height:32px;display:grid;place-items:center;padding:0;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text-3);cursor:pointer"
          hover="border-color:var(--accent);color:var(--accent);background:var(--accent-tint2)"
        >
          <Svg paths={I_EDIT} size={14} sw={2} />
        </HButton>
        <HButton
          onClick={onRemove}
          title="Убрать из заказа"
          s="width:32px;height:32px;display:grid;place-items:center;padding:0;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text-3);cursor:pointer"
          hover="border-color:var(--danger);color:var(--danger);background:var(--danger-tint)"
        >
          <Svg paths={I_TRASH} size={14} sw={2} />
        </HButton>
      </div>
    </div>
  );
}

/** Правка товара прямо в списке: Enter — сохранить, Esc — отменить. */
function EditRow({
  row,
  index,
  isDesktop,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  row: Row;
  index: number;
  isDesktop: boolean;
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
  const field = inputStyle + ";height:38px;border-radius:9px";
  return (
    <div style={css("padding:12px 16px;border-top:1px solid var(--border-2);background:var(--accent-tint2)")}>
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "30px minmax(0,2fr) minmax(0,1.1fr) 58px 108px 108px auto" : "repeat(4,minmax(0,1fr))", gap: 8, alignItems: "center" }}>
        {isDesktop && (
          <span style={css("width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--accent);color:#fff;" + NUM)}>{index + 1}</span>
        )}
        <input autoFocus value={row.name} onChange={(e) => onChange({ name: cased(e, capFirst) })} onKeyDown={keys} placeholder="Название" style={mix(field, !isDesktop && "grid-column:1 / -1")} />
        <input value={row.code} onChange={(e) => onChange({ code: cased(e, upper) })} onKeyDown={keys} placeholder="Код" style={mix(field + ";" + MONO, !isDesktop && "grid-column:1 / 4")} />
        <input value={row.qty} onChange={(e) => onChange({ qty: e.target.value })} onKeyDown={keys} inputMode="numeric" aria-label="Количество" style={mix(field + ";text-align:center;padding:0 6px;" + NUM, !isDesktop && "grid-column:4 / 5")} />
        <MoneyCell value={row.price} onChange={(v) => onChange({ price: v })} onKeyDown={keys} placeholder="клиенту" height={38} style={isDesktop ? undefined : { gridColumn: "1 / 3" }} />
        <MoneyCell value={row.real} onChange={(v) => onChange({ real: v })} onKeyDown={keys} placeholder="выкуп" height={38} style={isDesktop ? undefined : { gridColumn: "3 / 5" }} />
        <div style={mix("display:flex;gap:6px", !isDesktop && "grid-column:1 / -1")}>
          <HButton
            onClick={onSave}
            title="Сохранить строку (Enter)"
            s={mix("height:38px;border:none;border-radius:9px;background:var(--accent);color:#fff;cursor:pointer;display:grid;place-items:center", isDesktop ? "width:38px;padding:0" : "flex:1")}
            hover="background:var(--accent-hover)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </HButton>
          <HButton
            onClick={onCancel}
            title="Отменить правку (Esc)"
            s={mix("height:38px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text-3);cursor:pointer;display:grid;place-items:center", isDesktop ? "width:38px;padding:0" : "flex:1")}
            hover="border-color:var(--danger);color:var(--danger)"
          >
            <Svg paths={I_CLOSE} size={15} sw={2.2} />
          </HButton>
        </div>
      </div>
      {error && <div style={css("font-size:12px;color:var(--danger);margin-top:6px")}>⚠ {error}</div>}
    </div>
  );
}

/** Поле кассы: подпись сверху. */
function DField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={mix("font-size:11.5px;font-weight:600;margin-bottom:7px", { color: K.mut })}>{label}</div>
      {children}
    </div>
  );
}

/** Плитка кассы: подпись, число, пояснение; значок — наценка в процентах. */
function DarkStat({ label, value, sub, color, badge }: { label: string; value: string; sub: string; color?: string; badge?: string }) {
  return (
    <div style={mix("min-width:0;padding:11px 12px;border-radius:12px;border:1px solid", { background: K.soft, borderColor: K.line })}>
      <div style={css("display:flex;align-items:center;gap:6px")}>
        <span style={mix("font-size:11.5px;font-weight:600", { color: K.mut })}>{label}</span>
        {badge && <span style={mix("margin-left:auto;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;" + NUM, { background: "var(--green-tint)", color: K.green })}>{badge}</span>}
      </div>
      <div style={mix("font-size:18px;font-weight:700;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" + NUM, { color: value === "—" ? K.dim : color ?? K.text })}>{value}</div>
      <div style={mix("font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: K.dim })}>{sub}</div>
    </div>
  );
}

/** Переключатель кассы: выбранный вариант подсвечен своим цветом. */
function DarkSeg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string; color: string }[] }) {
  return (
    <div
      style={mix("display:grid;gap:4px;padding:4px;border-radius:12px;border:1px solid", {
        gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))`,
        background: K.soft,
        borderColor: K.line,
      })}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            style={mix(
              "height:34px;padding:0 6px;border-radius:9px;border:1px solid transparent;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .15s,color .15s,border-color .15s",
              {
                background: on ? `color-mix(in srgb, ${o.color} 10%, var(--surface))` : "transparent",
                borderColor: on ? `color-mix(in srgb, ${o.color} 45%, transparent)` : "transparent",
                color: on ? o.color : K.mut,
                fontWeight: on ? 700 : 500,
              }
            )}
          >
            <span style={mix("width:6px;height:6px;border-radius:50%;flex:none", { background: on ? o.color : K.dim })} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function MoneyCell({
  value,
  onChange,
  placeholder,
  onKeyDown,
  height = 36,
  style,
  invalid,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  height?: number;
  style?: React.CSSProperties;
  invalid?: boolean;
  inputRef?: (el: HTMLInputElement | null) => void;
}) {
  return (
    <span style={mix("position:relative;display:block;min-width:0", style)}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        inputMode="decimal"
        placeholder={placeholder}
        style={mix(
          "padding:0 26px 0 11px;border:1px solid var(--border-strong);border-radius:10px;font-size:13.5px;outline:none;background:var(--surface);width:100%;" + NUM,
          { height },
          invalid && "border-color:var(--danger)!important;box-shadow:0 0 0 3px var(--danger-tint)"
        )}
      />
      <span style={mix("position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11.5px;pointer-events:none", { color: "var(--text-4)" })}>с</span>
    </span>
  );
}
