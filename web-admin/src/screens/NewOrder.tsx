/**
 * Новый заказ. Слева — одна карточка: клиент и товары таблицей. Справа — отдельный блок «Итог заказа»
 * (как чек): сумма, выкуп и прибыль, дата, статус и оплата маленькими переключателями, кнопка «Сохранить»
 * (или Ctrl+Enter). Колонки одной высоты, итог всегда на виду.
 *
 * Товары вводятся как в таблице: Enter в последнем поле строки добавляет новую
 * строку. Сумма — цена клиенту, Реальная цена — выкуп; прибыль видна сразу.
 * Заказ сохраняется одной транзакцией: либо весь, либо ничего.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import { createOrder, getCustomer, getSettings, listCustomers, type CustomerCard, type CustomerRow, type Item } from "../api/domain";
import { MONO, css, mix } from "../design/css";
import CountUp from "../design/CountUp";
import { I_ARROW_RIGHT, I_BOX, I_CLOSE, I_PLUS, I_USER, Svg } from "../design/icons";
import { PANEL, Page } from "../design/table";
import { HButton, ModalError, ST, btnPrimary, inputStyle } from "../design/ui";
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

let rowKey = 1;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** Числа обычным шрифтом с цифрами одной ширины — аккуратнее «печатной машинки». */
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const emptyRow = (code = ""): Row => ({ key: rowKey++, name: "", code, qty: "1", price: "", real: "" });
const isBlank = (r: Row) => !r.name.trim() && !r.code.trim() && !r.price.trim() && !r.real.trim();

export default function NewOrder({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const nav = useNavigate();
  const [params] = useSearchParams();

  // --- Клиент ---
  const [customer, setCustomer] = useState<CustomerCard | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneBox = useRef<HTMLDivElement>(null);

  const pickCustomer = useCallback((id: number) => {
    getCustomer(id)
      .then((c) => {
        setCustomer(c);
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

  /** Поиск никого не нашёл — переносим имя или номер в форму нового клиента и ставим курсор в пустое поле. */
  const prefillNew = (p: { name?: string; phone?: string }) => {
    if (p.name !== undefined) setNewName(p.name);
    if (p.phone !== undefined) setNewPhone(p.phone);
    setTimeout(() => (p.phone ? nameRef.current : phoneBox.current?.querySelector("input"))?.focus(), 20);
  };

  // --- Товары ---
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(params.get("code") ?? "")]);
  const nameRefs = useRef(new Map<number, HTMLInputElement>());
  const focusRow = (key: number) => setTimeout(() => nameRefs.current.get(key)?.focus(), 20);
  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const r = emptyRow();
    setRows((rs) => [...rs, r]);
    focusRow(r.key);
  };
  /** Вставка из Excel в «Название»: строка — товар; колонки через Tab: название · код · шт · сумма · выкуп. */
  const pasteRows = (key: number, e: React.ClipboardEvent<HTMLInputElement>) => {
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
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const keep = i >= 0 && !isBlank(rs[i]) ? 1 : 0; // пустую строку заменяем, заполненную — оставляем
      return [...rs.slice(0, i + keep), ...parsed, ...rs.slice(i + 1)];
    });
    toast("success", `Вставлено товаров: ${parsed.length}`);
  };
  const removeRow = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));

  // --- Параметры ---
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

  const filled = rows.filter((r) => !isBlank(r));
  const totals = useMemo(() => {
    let sale = 0;
    let cost = 0;
    let withCost = 0;
    let qty = 0;
    for (const r of filled) {
      const p = parseMoney(r.price);
      const c = parseMoney(r.real);
      sale += p && !Number.isNaN(p) ? p : 0;
      qty += Number(r.qty) || 0;
      if (c !== null && !Number.isNaN(c)) {
        cost += c;
        withCost++;
      }
    }
    const profit = filled.reduce((s, r) => {
      const p = parseMoney(r.price);
      const c = parseMoney(r.real);
      return c !== null && !Number.isNaN(c) && p !== null && !Number.isNaN(p) ? s + p - c : s;
    }, 0);
    const paidNum = pay === "full" ? sale : pay === "part" ? parseMoney(paid) ?? 0 : 0;
    return { sale, cost, withCost, qty, profit, paid: Number.isNaN(paidNum) ? 0 : paidNum };
  }, [filled, pay, paid]);

  function validate(): string {
    if (!customer && !newName.trim() && !newPhone.trim()) return "Выберите клиента или укажите имя и телефон нового";
    if (!filled.length) return "Добавьте хотя бы один товар";
    for (const [i, r] of filled.entries()) {
      const n = i + 1;
      if (!r.name.trim()) return `Строка ${n}: укажите название`;
      const q = Number(r.qty);
      if (!Number.isInteger(q) || q <= 0) return `Строка ${n}: количество — целое число больше нуля`;
      const p = parseMoney(r.price);
      if (p === null || Number.isNaN(p)) return `Строка ${n}: укажите сумму`;
      const c = parseMoney(r.real);
      if (c !== null && Number.isNaN(c)) return `Строка ${n}: реальная цена — число`;
    }
    if (pay === "part") {
      const a = parseMoney(paid);
      if (a === null || Number.isNaN(a) || a <= 0) return "Укажите сумму частичной оплаты";
      if (a > totals.sale) return "Оплата больше суммы заказа";
    }
    if (time !== null) {
      if (!/^\d{2}:\d{2}$/.test(time)) return "Укажите время заказа";
      if (new Date(`${orderDate}T${time}:00`).getTime() > Date.now() + 60_000) return "Время заказа ещё не наступило";
    }
    return "";
  }

  async function save() {
    const err = validate();
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      const r = await createOrder({
        customer_id: customer?.customer.id,
        customer_name: customer ? undefined : newName.trim(),
        customer_phone: customer ? undefined : newPhone.trim(),
        order_date: orderDate,
        ordered_at: time !== null ? new Date(`${orderDate}T${time}:00`).toISOString() : undefined,
        status,
        comment,
        pay,
        paid_amount: pay === "part" ? parseMoney(paid) ?? 0 : undefined,
        items: filled.map((row) => {
          const price = parseMoney(row.price) ?? 0;
          const real = parseMoney(row.real);
          return {
            name: row.name.trim(),
            code: row.code.trim(),
            qty: Number(row.qty),
            price,
            real_price: real === null || Number.isNaN(real) ? null : real,
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
      // Форма — заново, как при первом открытии: следующий заказ начинается с клиента.
      setCustomer(null);
      setNewName("");
      setNewPhone("");
      setRows([emptyRow()]);
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

  const cell = "height:36px;padding:0 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:13px;outline:none;background:var(--surface);width:100%;min-width:0";
  const GRID = isDesktop ? "20px minmax(0,1.7fr) minmax(0,1fr) 56px 98px 98px 84px 28px" : "repeat(4,minmax(0,1fr))";
  // На телефоне: «Товар N» и ✕ сверху, название во всю ширину, код + шт, клиенту + выкуп, прибыль.
  const at = (col: string, row?: number): CSSProperties | undefined => (isDesktop ? undefined : { gridColumn: col, gridRow: row });
  const debt = Math.max(0, totals.sale - totals.paid);
  const paidShare = totals.sale > 0 ? Math.min(100, Math.round((totals.paid / totals.sale) * 100)) : 0;
  const who = customer ? customer.customer.name : newName.trim() || newPhone.trim() ? `${newName.trim() || newPhone.trim()} · новый клиент` : "";

  return (
    <Page size="wide">
      <div style={css("display:flex;flex-direction:column;gap:14px")}>
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

        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "minmax(0,1fr) 372px" : "minmax(0,1fr)", gap: 16, alignItems: "stretch" }}>
          {/* ---------- Слева: клиент и товары — одна карточка ---------- */}
          <section style={css(PANEL + ";border-radius:16px;display:flex;flex-direction:column;overflow:visible;min-width:0")}>
            {/* Клиент */}
            <div style={css("padding:18px 20px")}>
              <SectionHead icon={I_USER} title="Клиент" hint={customer ? undefined : "найдите или впишите нового"} />
              {customer ? (
                <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
                  <span
                    style={css(
                      "width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--violet-dot));color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;flex:none"
                    )}
                  >
                    {customer.customer.name.trim().slice(0, 1).toUpperCase()}
                  </span>
                  <div style={css("min-width:120px;flex:1")}>
                    <div style={css("font-size:15.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{customer.customer.name}</div>
                    <div style={css(MONO + ";font-size:12.5px;color:var(--text-3)")}>{customer.customer.phone || "без телефона"}</div>
                  </div>
                  <div style={css("display:flex;gap:6px;flex-wrap:wrap")}>
                    <Chip label="заказано" value={String(customer.totals.ordered)} dot={ST.ordered.dot} />
                    <Chip label="на складе" value={String(customer.totals.in_stock)} dot={ST.in_stock.dot} />
                    <Chip label="долг" value={som(customer.totals.debt)} danger={customer.totals.debt > 0} />
                  </div>
                  <HButton
                    onClick={() => {
                      setCustomer(null);
                      setSaved(null);
                    }}
                    s="height:30px;padding:0 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text-2);font-size:12px;cursor:pointer"
                    hover="border-color:var(--accent);color:var(--accent-strong)"
                  >
                    Сменить
                  </HButton>
                </div>
              ) : (
                <div style={css("display:flex;flex-direction:column;gap:12px")}>
                  <CustomerSearch autoFocus onPick={pickCustomer} onCreate={prefillNew} />
                  <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "auto minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)", gap: 10, alignItems: "center" }}>
                    <span style={css("font-size:12px;color:var(--text-4);white-space:nowrap")}>или новый:</span>
                    <input ref={nameRef} value={newName} onChange={(e) => setNewName(cased(e, capFirst))} placeholder="Имя клиента" style={css(inputStyle)} />
                    <div ref={phoneBox}>
                      <PhoneInput value={newPhone} onChange={setNewPhone} />
                    </div>
                  </div>
                  {recent.length > 0 && (
                    <div style={css("display:flex;align-items:center;gap:6px;flex-wrap:wrap")}>
                      <span style={css("font-size:12px;color:var(--text-4);margin-right:2px")}>недавние:</span>
                      {recent.map((c) => (
                        <HButton
                          key={c.id}
                          onClick={() => pickCustomer(c.id)}
                          title={c.phone || c.name}
                          s="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px 0 3px;border:1px solid var(--border);border-radius:999px;background:var(--surface);font-size:12px;color:var(--text);cursor:pointer;max-width:200px"
                          hover="border-color:var(--accent);background:var(--accent-tint2)"
                        >
                          <span style={css("width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:10.5px;font-weight:700;background:var(--accent-tint);color:var(--accent-strong)")}>
                            {c.name.trim().slice(0, 1).toUpperCase()}
                          </span>
                          <span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.name}</span>
                          {c.debt > 0 && <span style={css("flex:none;width:6px;height:6px;border-radius:50%;background:var(--danger-dot)")} title={`долг ${som(c.debt)}`} />}
                        </HButton>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Товары */}
            <div style={css("padding:18px 20px 20px;border-top:1px solid var(--border-2);display:flex;flex-direction:column;flex:1;min-width:0")}>
              <SectionHead
                icon={I_BOX}
                title="Товары"
                hint={filled.length ? `${filled.length} ${plural(filled.length, "позиция", "позиции", "позиций")} · ${totals.qty} шт` : undefined}
              />
              {isDesktop && (
                <div
                  style={mix(
                    "display:grid;gap:8px;align-items:center;padding:0 0 8px;font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-4);white-space:nowrap",
                    { gridTemplateColumns: GRID }
                  )}
                >
                  <span />
                  <span>Название</span>
                  <span>Код / трек</span>
                  <span style={css("text-align:center")}>Шт</span>
                  <span>Клиенту</span>
                  <span>Выкуп</span>
                  <span style={css("text-align:right")}>Прибыль</span>
                  <span />
                </div>
              )}
              <div style={css("display:flex;flex-direction:column;gap:" + (isDesktop ? "6px" : "10px"))}>
                {rows.map((r, i) => {
                  const p = parseMoney(r.price);
                  const c = parseMoney(r.real);
                  const profit = p !== null && c !== null && !Number.isNaN(p) && !Number.isNaN(c) ? p - c : null;
                  const onEnter = (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      if (i === rows.length - 1) addRow();
                      else focusRow(rows[i + 1].key);
                    }
                  };
                  return (
                    <div
                      key={r.key}
                      style={mix(
                        "display:grid;gap:8px;align-items:center",
                        { gridTemplateColumns: GRID },
                        !isDesktop && "padding:12px;border:1px solid var(--border-2);border-radius:12px;background:var(--surface-2)"
                      )}
                    >
                      <span style={mix(isDesktop ? MONO + ";font-size:11.5px;color:var(--text-5);text-align:center" : "font-size:11px;font-weight:600;color:var(--text-4);text-transform:uppercase;letter-spacing:.05em", at("1 / 4", 1))}>
                        {isDesktop ? i + 1 : `Товар ${i + 1}`}
                      </span>
                      <input
                        ref={(el) => {
                          if (el) nameRefs.current.set(r.key, el);
                          else nameRefs.current.delete(r.key);
                        }}
                        value={r.name}
                        onChange={(e) => setRow(r.key, { name: cased(e, capFirst) })}
                        onPaste={(e) => pasteRows(r.key, e)}
                        placeholder="Название товара"
                        style={mix(cell, at("1 / -1"))}
                      />
                      <input value={r.code} onChange={(e) => setRow(r.key, { code: cased(e, upper) })} placeholder="Код" autoCapitalize="characters" spellCheck={false} style={mix(cell + ";" + MONO, at("1 / 4"))} />
                      <input value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} inputMode="numeric" aria-label="Количество" style={mix(cell + ";" + MONO + ";text-align:center;padding:0 4px", at("4 / 5"))} />
                      <MoneyCell value={r.price} onChange={(v) => setRow(r.key, { price: v })} placeholder={isDesktop ? "сумма" : "клиенту"} style={at("1 / 3")} />
                      <MoneyCell value={r.real} onChange={(v) => setRow(r.key, { real: v })} placeholder="выкуп" onKeyDown={onEnter} style={at("3 / 5")} />
                      <span
                        style={mix(MONO + ";font-size:13px;font-weight:600;white-space:nowrap", at("1 / -1"), {
                          textAlign: isDesktop ? "right" : "left",
                          color: profit === null ? "var(--text-5)" : profit < 0 ? "var(--danger)" : "var(--green)",
                        })}
                      >
                        {profit === null ? (isDesktop ? "—" : "прибыль —") : `${isDesktop ? "" : "прибыль "}${profit > 0 ? "+" : ""}${som(profit)}`}
                      </span>
                      <HButton
                        onClick={() => removeRow(r.key)}
                        title="Убрать строку"
                        s={mix("width:28px;height:28px;border:none;background:transparent;border-radius:7px;color:var(--text-5);cursor:pointer;display:flex;align-items:center;justify-content:center", at("4 / 5", 1), !isDesktop && "justify-self:end")}
                        hover="background:var(--danger-tint);color:var(--danger)"
                      >
                        <Svg paths={I_CLOSE} size={14} />
                      </HButton>
                    </div>
                  );
                })}
              </div>
              {totals.withCost > 0 && totals.withCost < filled.length && (
                <span style={css("font-size:11.5px;color:var(--text-4);margin-top:8px")}>прибыль по {totals.withCost} из {filled.length} — у остальных не указан выкуп</span>
              )}
              <HButton
                onClick={addRow}
                className="add-zone"
                s={mix(
                  "flex:1;width:100%;margin-top:12px;border:1.5px dashed var(--border-strong);border-radius:14px;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:16px;cursor:pointer;font:inherit;color:var(--text-3);text-align:center;transition:border-color .15s,background .15s",
                  { minHeight: isDesktop ? 112 : 92 }
                )}
                hover="border-color:var(--accent);background:var(--accent-tint2)"
              >
                <span className="add-zone-plus" style={css("width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:var(--accent-tint);color:var(--accent);transition:transform .15s ease")}>
                  <Svg paths={I_PLUS} size={18} sw={2.2} />
                </span>
                <span style={css("font-size:13.5px;font-weight:600;color:var(--text)")}>Добавить товар</span>
                {isDesktop && (
                  <span style={css("display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center;font-size:11.5px")}>
                    <Kbd>Enter</Kbd> в «выкупе» — следующая строка
                    <span style={css("color:var(--text-5)")}>·</span>
                    <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> — сохранить заказ
                  </span>
                )}
                <span style={css("font-size:11.5px;color:var(--text-4)")}>можно вставить сразу несколько строк из Excel в «Название»</span>
              </HButton>
              <div style={css("padding-top:16px")}>
                <Field label="Комментарий к заказу">
                  <input
                    value={comment}
                    onChange={(e) => setComment(cased(e, capFirst))}
                    placeholder="необязательно — например, «доставка до двери»"
                    style={css(inputStyle + ";height:38px")}
                  />
                </Field>
              </div>
            </div>
          </section>

          {/* ---------- Справа: итог заказа — отдельный блок ---------- */}
          <aside style={mix(PANEL + ";border-radius:16px;min-width:0;overflow:visible", isDesktop && "align-self:start;position:sticky;top:16px")}>
            <div>
              {/* Шапка: сумма заказа */}
              <div
                style={css(
                  "border-radius:15px 15px 0 0;padding:18px 20px 20px;color:#fff;background:radial-gradient(circle at 100% 0,rgba(255,255,255,.22),transparent 46%),linear-gradient(135deg,var(--accent),var(--violet-dot))"
                )}
              >
                <div style={css("display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;opacity:.92")}>
                  <Svg paths={I_RECEIPT} size={16} sw={2} />
                  Итог заказа
                  <span style={css("margin-left:auto;font-size:11.5px;font-weight:600;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.18)")}>
                    {filled.length} {plural(filled.length, "позиция", "позиции", "позиций")} · {totals.qty} шт
                  </span>
                </div>
                <div style={css(NUM + ";font-size:34px;font-weight:700;letter-spacing:-.025em;line-height:1.2;margin-top:10px;white-space:nowrap")}>
                  <CountUp text={som(totals.sale)} duration={500} />
                </div>
                <div style={css("font-size:12px;opacity:.85;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{who || "клиент не выбран"}</div>
              </div>

              <div style={css("padding:16px 20px 18px;display:flex;flex-direction:column;gap:14px")}>
                <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px")}>
                  <Metric
                    icon={I_BAG}
                    tone="violet"
                    label="Выкуп"
                    value={totals.withCost ? som(totals.cost) : "—"}
                    sub={totals.withCost && totals.sale > 0 ? `${Math.round((totals.cost / totals.sale) * 100)}% от суммы` : "впишите выкуп"}
                  />
                  <Metric
                    icon={I_TREND}
                    tone={totals.profit < 0 ? "danger" : "green"}
                    label="Прибыль"
                    value={totals.withCost ? `${totals.profit > 0 ? "+" : ""}${som(totals.profit)}` : "—"}
                    badge={totals.withCost && totals.cost > 0 ? `${totals.profit >= 0 ? "+" : ""}${Math.round((totals.profit / totals.cost) * 100)}%` : undefined}
                    sub={totals.withCost ? "наценка на выкуп" : "появится с выкупом"}
                  />
                </div>

                <Field label="Когда оформлен">
                  <div style={css("display:grid;grid-template-columns:minmax(0,1fr) 124px;gap:8px")}>
                    <DatePicker value={orderDate} onChange={setOrderDate} width="100%" height={38} words ariaLabel="Дата заказа" />
                    <TimePicker value={time ?? clock} auto={time === null} onChange={setTime} onNow={() => setTime(null)} width="100%" height={38} ariaLabel="Время заказа" />
                  </div>
                </Field>
                <Field label="Статус товаров">
                  <Pills
                    value={status}
                    onChange={setStatus}
                    options={[
                      { key: "ordered", label: "Заказан", dot: ST.ordered.dot, bg: ST.ordered.bg, fg: ST.ordered.fg },
                      { key: "in_stock", label: "Уже на складе", dot: ST.in_stock.dot, bg: ST.in_stock.bg, fg: ST.in_stock.fg },
                    ]}
                  />
                </Field>
                <Field label="Оплата">
                  <Pills
                    value={pay}
                    onChange={setPay}
                    options={[
                      { key: "none", label: "Не оплачено", dot: ST.unpaid.dot, bg: ST.unpaid.bg, fg: ST.unpaid.fg },
                      { key: "full", label: "Полностью", dot: ST.paid.dot, bg: ST.paid.bg, fg: ST.paid.fg },
                      { key: "part", label: "Частично", dot: ST.partial.dot, bg: ST.partial.bg, fg: ST.partial.fg },
                    ]}
                  />
                  {pay === "part" && (
                    <div style={css("margin-top:8px")}>
                      <MoneyCell value={paid} onChange={setPaid} placeholder={totals.sale > 0 ? `сколько оплатил из ${totals.sale.toLocaleString("ru-RU")}` : "сколько оплатил"} />
                    </div>
                  )}
                </Field>

                {/* Оплачено / долг — полосой */}
                <div>
                  <div style={css("height:6px;border-radius:4px;overflow:hidden;background:" + (totals.sale > 0 ? "var(--danger-tint)" : "var(--border-2)"))}>
                    <div style={mix("height:100%;border-radius:4px;background:var(--green-dot);transition:width .3s ease", { width: `${paidShare}%` })} />
                  </div>
                  <div style={css("display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:12px;white-space:nowrap")}>
                    <span style={css("color:var(--text-3)")}>
                      оплачено <b style={css(NUM + ";color:var(--green)")}>{som(totals.paid)}</b>
                    </span>
                    <span style={css("color:var(--text-3)")}>
                      долг <b style={mix(NUM, { color: debt > 0 ? "var(--danger)" : "var(--text-3)" })}>{som(debt)}</b>
                    </span>
                  </div>
                </div>

                <ModalError text={error} />
                <HButton
                  disabled={busy}
                  onClick={save}
                  title="Сохранить заказ (Ctrl+Enter)"
                  s={btnPrimary + ";height:46px;width:100%;border-radius:12px;font-size:14.5px;font-weight:600;box-shadow:0 6px 16px color-mix(in srgb,var(--accent) 32%,transparent)"}
                  hover="background:var(--accent-hover)"
                >
                  {busy ? "Сохраняю…" : "Сохранить заказ"}
                </HButton>
                {isDesktop && (
                  <div style={css("display:flex;align-items:center;justify-content:center;gap:6px;font-size:11.5px;color:var(--text-4);margin-top:-6px")}>
                    или <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> из любого поля
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Page>
  );
}

const I_RECEIPT: [string, Record<string, unknown>][] = [
  ["path", { d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" }],
  ["path", { d: "M8 8h8" }],
  ["path", { d: "M8 12h8" }],
  ["path", { d: "M8 16h5" }],
];

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Заголовок раздела: иконка в цветной подложке, название, подсказка. */
function SectionHead({ icon, title, hint, extra }: { icon: [string, Record<string, unknown>][]; title: string; hint?: string; extra?: ReactNode }) {
  return (
    <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:14px;min-width:0")}>
      <span style={css("width:30px;height:30px;border-radius:9px;flex:none;display:grid;place-items:center;background:var(--accent-tint);color:var(--accent)")}>
        <Svg paths={icon} size={16} sw={1.9} />
      </span>
      <span style={css("font-size:15px;font-weight:700")}>{title}</span>
      {hint && <span style={css("font-size:12px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{hint}</span>}
      <span style={css("flex:1")} />
      {extra}
    </div>
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
        "position:relative;overflow:hidden;display:flex;align-items:center;gap:16px;padding:16px 18px;border-radius:16px;animation:slideUp .25s ease",
        !isDesktop && "flex-wrap:wrap",
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

      <div style={mix("display:flex;align-items:center;gap:8px", !isDesktop && "width:100%;flex-wrap:wrap")}>
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
    <div
      onClick={onClose}
      style={css("position:fixed;inset:0;z-index:80;background:rgba(15,18,25,.42);display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow:auto;animation:fadeIn .15s ease")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Детали заказа"
        style={css("width:560px;max-width:100%;margin:auto 0;background:var(--surface);border-radius:18px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.28);animation:pop .2s ease")}
      >
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

function Field({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px")}>
        <span style={css("font-size:11.5px;font-weight:500;color:var(--text-3)")}>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

const I_BAG: [string, Record<string, unknown>][] = [
  ["path", { d: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" }],
  ["path", { d: "M3 6h18" }],
  ["path", { d: "M16 10a4 4 0 0 1-8 0" }],
];
const I_TREND: [string, Record<string, unknown>][] = [
  ["path", { d: "m22 7-8.5 8.5-5-5L2 17" }],
  ["path", { d: "M16 7h6v6" }],
];

/** Плитка итога: иконка, подпись, крупное число и пояснение под ним. */
function Metric({
  icon,
  tone,
  label,
  value,
  sub,
  badge,
}: {
  icon: [string, Record<string, unknown>][];
  tone: "violet" | "green" | "danger";
  label: string;
  value: string;
  sub: string;
  badge?: string;
}) {
  const [tint, fg] = { violet: ["var(--violet-tint)", "var(--violet)"], green: ["var(--green-tint)", "var(--green)"], danger: ["var(--danger-tint)", "var(--danger)"] }[tone];
  const empty = value === "—";
  return (
    <div style={css("min-width:0;padding:11px 12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border-2)")}>
      <div style={css("display:flex;align-items:center;gap:7px;min-width:0")}>
        <span style={mix("width:22px;height:22px;border-radius:7px;display:grid;place-items:center;flex:none", { background: tint, color: fg })}>
          <Svg paths={icon} size={13} sw={2} />
        </span>
        <span style={css("font-size:12px;font-weight:500;color:var(--text-2)")}>{label}</span>
        {badge && <span style={mix("margin-left:auto;font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:999px;" + NUM, { background: tint, color: fg })}>{badge}</span>}
      </div>
      <div
        style={mix(NUM + ";font-size:19px;font-weight:700;margin-top:8px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", {
          color: empty ? "var(--text-5)" : tone === "violet" ? "var(--text)" : fg,
        })}
      >
        {value}
      </div>
      <div style={css("font-size:11px;color:var(--text-4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{sub}</div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <span style={css(MONO + ";font-size:10.5px;padding:1px 6px;border-radius:5px;border:1px solid var(--border-strong);border-bottom-width:2px;background:var(--surface);color:var(--text-2)")}>
      {children}
    </span>
  );
}

/** Маленькие переключатели-«таблетки»: выбранный подсвечен своим цветом. */
function Pills<K extends string>({
  value,
  onChange,
  options,
}: {
  value: K;
  onChange: (k: K) => void;
  options: { key: K; label: string; dot: string; bg: string; fg: string }[];
}) {
  return (
    <div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={on}
            style={mix(
              "display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;font-size:12.5px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s,border-color .12s",
              {
                border: `1px solid ${on ? `color-mix(in srgb, ${o.dot} 45%, transparent)` : "var(--border)"}`,
                background: on ? o.bg : "var(--surface)",
                color: on ? o.fg : "var(--text-2)",
                fontWeight: on ? 600 : 500,
              }
            )}
          >
            <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: on ? o.dot : "var(--border-strong)" })} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ label, value, danger, dot }: { label: string; value: string; danger?: boolean; dot?: string }) {
  return (
    <span
      style={mix("display:inline-flex;gap:5px;align-items:center;font-size:11.5px;padding:4px 9px;border-radius:14px;white-space:nowrap", {
        background: danger ? "var(--danger-tint)" : "var(--hover)",
        color: danger ? "var(--danger)" : "var(--text-3)",
      })}
    >
      {dot && <span style={mix("width:6px;height:6px;border-radius:50%", { background: dot })} />}
      {label} <b style={mix(MONO, { color: danger ? "var(--danger)" : "var(--text)" })}>{value}</b>
    </span>
  );
}

function MoneyCell({
  value,
  onChange,
  placeholder,
  onKeyDown,
  height = 36,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  height?: number;
  style?: CSSProperties;
}) {
  return (
    <span style={mix("position:relative;display:block;min-width:0", style)}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        inputMode="decimal"
        placeholder={placeholder}
        style={mix(
          "padding:0 24px 0 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:13px;outline:none;background:var(--surface);width:100%;" + MONO,
          { height }
        )}
      />
      <span style={css("position:absolute;right:9px;top:50%;transform:translateY(-50%);font-size:11.5px;color:var(--text-4);pointer-events:none")}>с</span>
    </span>
  );
}
