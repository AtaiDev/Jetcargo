/**
 * Новый заказ: клиент → товары списком → статус и оплата → сохранить.
 *
 * Товары вводятся как в таблице: Enter в последнем поле строки добавляет новую
 * строку. Сумма — цена клиенту, Реальная цена — выкуп; прибыль видна сразу.
 * Заказ сохраняется одной транзакцией: либо весь, либо ничего.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import { createOrder, getCustomer, getSettings, listCustomers, type CustomerCard, type CustomerRow } from "../api/domain";
import { MONO, css, mix } from "../design/css";
import { I_CLOSE, I_PLUS, Icon, Svg } from "../design/icons";
import { PANEL, Page } from "../design/table";
import { HButton, ModalError, ST, btnGhost, btnPrimary, inputStyle } from "../design/ui";
import { cased, capFirst, parseMoney, som, todayIso, upper } from "../lib/cargo";
import { emit, useDebounced } from "../lib/events";
import PhoneInput from "../components/PhoneInput";

type Toast = (kind: "success" | "error", text: string) => void;

interface Row {
  key: number;
  name: string;
  code: string;
  qty: string;
  price: string;
  real: string;
}

let rowKey = 1;
const emptyRow = (code = ""): Row => ({ key: rowKey++, name: "", code, qty: "1", price: "", real: "" });
const isBlank = (r: Row) => !r.name.trim() && !r.code.trim() && !r.price.trim() && !r.real.trim();

export default function NewOrder({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const nav = useNavigate();
  const [params] = useSearchParams();

  // --- Клиент ---
  const [customer, setCustomer] = useState<CustomerCard | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 200);
  const [found, setFound] = useState<CustomerRow[]>([]);

  const pickCustomer = useCallback((id: number) => {
    getCustomer(id)
      .then((c) => {
        setCustomer(c);
        setSearch("");
        setFound([]);
      })
      .catch(() => setCustomer(null));
  }, []);

  useEffect(() => {
    const id = Number(params.get("customer"));
    if (id) pickCustomer(id);
  }, [params, pickCustomer]);

  useEffect(() => {
    if (customer || q.length < 2) {
      setFound([]);
      return;
    }
    let alive = true;
    listCustomers({ q, limit: 8 })
      .then((r) => alive && setFound(r.rows))
      .catch(() => alive && setFound([]));
    return () => {
      alive = false;
    };
  }, [q, customer]);

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
  const removeRow = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));

  // --- Параметры ---
  const [orderDate, setOrderDate] = useState(todayIso());
  const [status, setStatus] = useState<"ordered" | "in_stock">("ordered");
  const [pay, setPay] = useState<"none" | "full" | "part">("none");
  const [paid, setPaid] = useState("");
  const [comment, setComment] = useState("");
  const [rate, setRate] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ name: string; id: number; count: number; sum: number } | null>(null);

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
      const name = customer?.customer.name ?? r.items[0]?.customer_name ?? newName;
      setSaved({ name, id: r.customer_id, count: r.items.length, sum: totals.sale });
      toast("success", `Заказ сохранён: ${r.items.length} тов. — ${name}${r.customer_created ? " (новый клиент)" : ""}`);
      emit("cargo:changed");
      pickCustomer(r.customer_id); // обновить цифры клиента
      setRows([emptyRow()]);
      setComment("");
      setPay("none");
      setPaid("");
    } catch (e) {
      setError(apiError(e, "Не удалось сохранить заказ"));
    } finally {
      setBusy(false);
    }
  }

  const cell = "height:36px;padding:0 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:13px;outline:none;background:var(--surface);width:100%;min-width:0";
  const GRID = isDesktop ? "28px minmax(0,2fr) minmax(0,1.2fr) 70px 120px 120px 96px 30px" : "1fr";

  return (
    <Page size="wide">
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "minmax(0,1fr) 320px" : "1fr", gap: 16, alignItems: "start" }}>
        <div style={css("display:flex;flex-direction:column;gap:14px;min-width:0")}>
          {saved && (
            <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;background:var(--green-tint);border:1px solid var(--green-dot)")}>
              <span style={css("font-size:13px;font-weight:600;color:var(--green)")}>
                ✓ Заказ сохранён: {saved.count} тов. на {som(saved.sum)} — {saved.name}
              </span>
              <span style={css("flex:1")} />
              <HButton onClick={() => nav(`/customers/${saved.id}`)} s={btnGhost + ";height:32px;font-size:12.5px"} hover="border-color:var(--accent)">
                Открыть клиента
              </HButton>
              <HButton
                onClick={() => {
                  setSaved(null);
                  setCustomer(null);
                  setNewName("");
                  setNewPhone("");
                }}
                s={btnGhost + ";height:32px;font-size:12.5px"}
                hover="border-color:var(--accent)"
              >
                Другой клиент
              </HButton>
            </div>
          )}

          {/* 1. Клиент */}
          <Card n="1" title="Клиент">
            {customer ? (
              <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap")}>
                <span
                  style={css(
                    "width:42px;height:42px;border-radius:50%;background:var(--accent-tint);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;flex:none"
                  )}
                >
                  {customer.customer.name.trim().slice(0, 1).toUpperCase()}
                </span>
                <div style={css("min-width:0;flex:1")}>
                  <div style={css("font-size:16px;font-weight:700")}>{customer.customer.name}</div>
                  <div style={css(MONO + ";font-size:13px;color:var(--text-2)")}>{customer.customer.phone || "—"}</div>
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
                  s="border:none;background:transparent;color:var(--text-3);font-size:12.5px;cursor:pointer"
                  hover="color:var(--text)"
                >
                  сменить ✕
                </HButton>
              </div>
            ) : (
              <div style={css("display:flex;flex-direction:column;gap:12px")}>
                <div style={css("position:relative")}>
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Найти клиента: имя или телефон…"
                    style={css(inputStyle + ";height:42px;font-size:14px")}
                  />
                  {found.length > 0 && (
                    <div
                      style={css(
                        "position:absolute;top:46px;left:0;right:0;z-index:20;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.12);overflow:hidden"
                      )}
                    >
                      {found.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => pickCustomer(c.id)}
                          className="row-click"
                          style={css(
                            "display:grid;grid-template-columns:1fr auto auto;gap:12px;width:100%;align-items:center;padding:10px 14px;border:none;border-bottom:1px solid var(--hover);background:transparent;text-align:left;font-size:13px"
                          )}
                        >
                          <span style={css("font-weight:600")}>{c.name}</span>
                          <span style={css(MONO + ";color:var(--text-3);font-size:12px")}>{c.phone}</span>
                          <span style={mix(MONO + ";font-size:11.5px", { color: c.debt > 0 ? "var(--danger)" : "var(--text-4)" })}>
                            {c.debt > 0 ? `долг ${som(c.debt)}` : `${c.items} тов.`}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div style={css("display:flex;align-items:center;gap:10px;font-size:11.5px;color:var(--text-4)")}>
                  <span style={css("flex:1;height:1px;background:var(--border-2)")} />
                  или новый клиент
                  <span style={css("flex:1;height:1px;background:var(--border-2)")} />
                </div>
                <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:10px")}>
                  <input value={newName} onChange={(e) => setNewName(cased(e, capFirst))} placeholder="Имя" style={css(inputStyle)} />
                  <PhoneInput value={newPhone} onChange={setNewPhone} />
                </div>
                <div style={css("font-size:11.5px;color:var(--text-4)")}>
                  Если клиент с таким телефоном уже есть — заказ добавится к нему, дубля не будет.
                </div>
              </div>
            )}
          </Card>

          {/* 2. Товары */}
          <Card
            n="2"
            title="Товары"
            extra={<span style={css("font-size:11.5px;color:var(--text-4)")}>Enter в «Реальной цене» — новая строка</span>}
          >
            {isDesktop && (
              <div style={mix("display:grid;gap:8px;padding:0 0 6px;font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-4);white-space:nowrap", { gridTemplateColumns: GRID })}>
                <span>#</span>
                <span>Название</span>
                <span>Код товара</span>
                <span style={css("text-align:center")}>Кол-во</span>
                <span>Сумма</span>
                <span>Реальная цена</span>
                <span style={css("text-align:right")}>Прибыль</span>
                <span />
              </div>
            )}
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              {rows.map((r, i) => {
                const p = parseMoney(r.price);
                const c = parseMoney(r.real);
                const profit = p !== null && c !== null && !Number.isNaN(p) && !Number.isNaN(c) ? p - c : null;
                const onEnter = (e: React.KeyboardEvent) => {
                  if (e.key === "Enter") {
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
                      !isDesktop && "padding:10px;border:1px solid var(--border-2);border-radius:10px"
                    )}
                  >
                    {isDesktop && <span style={css(MONO + ";font-size:12px;color:var(--text-4);text-align:center")}>{i + 1}</span>}
                    <input
                      ref={(el) => {
                        if (el) nameRefs.current.set(r.key, el);
                        else nameRefs.current.delete(r.key);
                      }}
                      value={r.name}
                      onChange={(e) => setRow(r.key, { name: cased(e, capFirst) })}
                      placeholder="Название товара"
                      style={css(cell)}
                    />
                    <input value={r.code} onChange={(e) => setRow(r.key, { code: cased(e, upper) })} placeholder="Код товара" autoCapitalize="characters" spellCheck={false} style={css(cell + ";" + MONO)} />
                    <input value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} inputMode="numeric" style={css(cell + ";" + MONO + ";text-align:center")} />
                    <MoneyCell value={r.price} onChange={(v) => setRow(r.key, { price: v })} placeholder="клиенту" />
                    <MoneyCell value={r.real} onChange={(v) => setRow(r.key, { real: v })} placeholder="выкуп" onKeyDown={onEnter} />
                    <span
                      style={mix(MONO + ";font-size:13px;font-weight:600;white-space:nowrap", {
                        textAlign: isDesktop ? "right" : "left",
                        color: profit === null ? "var(--text-5)" : profit < 0 ? "var(--danger)" : "var(--green)",
                      })}
                    >
                      {profit === null ? "—" : `${profit > 0 ? "+" : ""}${som(profit)}`}
                    </span>
                    <HButton
                      onClick={() => removeRow(r.key)}
                      title="Убрать строку"
                      s="width:30px;height:30px;border:none;background:transparent;border-radius:7px;color:var(--text-4);cursor:pointer;display:flex;align-items:center;justify-content:center"
                      hover="background:var(--danger-tint);color:var(--danger)"
                    >
                      <Svg paths={I_CLOSE} size={15} />
                    </HButton>
                  </div>
                );
              })}
            </div>
            <HButton
              onClick={addRow}
              s="margin-top:10px;align-self:flex-start;height:34px;padding:0 12px;border:1px dashed var(--border-strong);border-radius:8px;background:transparent;color:var(--text-2);font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px"
              hover="border-color:var(--accent);color:var(--accent)"
            >
              <Svg paths={I_PLUS} size={14} sw={2} /> Добавить строку
            </HButton>
          </Card>

          {/* 3. Параметры */}
          <Card n="3" title="Статус и оплата">
            <div style={css("display:flex;flex-direction:column;gap:14px")}>
              {/* Ряд 1: дата · статус · оплата — одна высота, кнопки на всю ширину колонки */}
              <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "minmax(150px,0.8fr) minmax(0,1.2fr) minmax(0,1.6fr)" : "1fr", gap: 14 }}>
                <label>
                  <Label>Дата заказа</Label>
                  <input
                    type="date"
                    value={orderDate}
                    onChange={(e) => e.target.value && setOrderDate(e.target.value)}
                    style={css(inputStyle + ";height:40px;" + MONO)}
                  />
                </label>
                <div>
                  <Label>Статус</Label>
                  <Segmented
                    value={status}
                    onChange={setStatus}
                    options={[
                      { key: "ordered", label: "Заказан", dot: ST.ordered.dot, bg: ST.ordered.bg, fg: ST.ordered.fg },
                      { key: "in_stock", label: "На складе", dot: ST.in_stock.dot, bg: ST.in_stock.bg, fg: ST.in_stock.fg },
                    ]}
                  />
                </div>
                <div>
                  <Label>Оплата</Label>
                  <Segmented
                    value={pay}
                    onChange={setPay}
                    options={[
                      { key: "none", label: "Не оплачено", dot: ST.unpaid.dot, bg: ST.unpaid.bg, fg: ST.unpaid.fg },
                      { key: "full", label: "Полностью", dot: ST.paid.dot, bg: ST.paid.bg, fg: ST.paid.fg },
                      { key: "part", label: "Частично", dot: ST.partial.dot, bg: ST.partial.bg, fg: ST.partial.fg },
                    ]}
                  />
                </div>
              </div>

              {/* Ряд 2: сумма частичной оплаты (если нужна) · комментарий */}
              <div style={{ display: "grid", gridTemplateColumns: isDesktop && pay === "part" ? "minmax(150px,0.8fr) minmax(0,2.8fr)" : "1fr", gap: 14 }}>
                {pay === "part" && (
                  <label>
                    <Label>Сколько оплатил</Label>
                    <MoneyCell value={paid} onChange={setPaid} placeholder={totals.sale > 0 ? `из ${totals.sale.toLocaleString("ru-RU")}` : "сумма"} height={40} />
                  </label>
                )}
                <label>
                  <Label>Комментарий к заказу</Label>
                  <input
                    value={comment}
                    onChange={(e) => setComment(cased(e, capFirst))}
                    placeholder="необязательно — например, «доставка до двери»"
                    style={css(inputStyle + ";height:40px")}
                  />
                </label>
              </div>
            </div>
          </Card>
        </div>

        {/* Итог */}
        <div style={css(PANEL + ";padding:16px 18px;display:flex;flex-direction:column;gap:12px;position:sticky;top:0")}>
          <div style={css("display:flex;align-items:center;gap:8px")}>
            <span style={css("display:flex;color:var(--accent)")}>
              <Icon name="orders" size={17} />
            </span>
            <span style={css("font-size:14px;font-weight:700")}>Итог заказа</span>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:2px")}>
            <Line label="Товаров" value={`${filled.length} · ${totals.qty} шт`} />
            <Line label="Сумма (клиенту)" value={som(totals.sale)} bold />
            <Line label="Выкуп" value={totals.withCost ? som(totals.cost) : "—"} />
            <Line
              label="Прибыль"
              value={totals.withCost ? som(totals.profit) : "—"}
              color={totals.profit < 0 ? "var(--danger)" : "var(--green)"}
              bold
            />
            {totals.withCost > 0 && totals.withCost < filled.length && (
              <span style={css("font-size:11px;color:var(--text-4)")}>прибыль по {totals.withCost} из {filled.length} — у остальных нет реальной цены</span>
            )}
          </div>
          <div style={css("border-top:1px solid var(--border-2);padding-top:10px;display:flex;flex-direction:column;gap:2px")}>
            <Line label="Оплачено" value={som(totals.paid)} color="var(--green)" />
            <Line label="Долг после заказа" value={som(Math.max(0, totals.sale - totals.paid))} color={totals.sale - totals.paid > 0 ? "var(--danger)" : "var(--text-3)"} />
          </div>
          <ModalError text={error} />
          <HButton disabled={busy} onClick={save} s={btnPrimary + ";height:46px;font-size:14.5px;width:100%"} hover="background:var(--accent-hover)">
            {busy ? "Сохраняю…" : `Сохранить заказ${filled.length ? ` (${filled.length})` : ""}`}
          </HButton>
          <span style={css("font-size:11px;color:var(--text-4);text-align:center")}>
            {customer ? `Клиент: ${customer.customer.name}` : newName || newPhone ? `Новый клиент: ${newName || newPhone}` : "Клиент не выбран"}
          </span>
        </div>
      </div>
    </Page>
  );
}

function Card({ n, title, extra, children }: { n: string; title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section style={css(PANEL + ";padding:16px 18px;display:flex;flex-direction:column;overflow:visible")}>
      <div style={css("display:flex;align-items:center;gap:9px;margin-bottom:12px")}>
        <span
          style={css(
            "width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;flex:none"
          )}
        >
          {n}
        </span>
        <span style={css("font-size:14.5px;font-weight:700")}>{title}</span>
        <span style={css("flex:1")} />
        {extra}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span style={css("display:block;font-size:11.5px;font-weight:500;color:var(--text-2);margin-bottom:6px")}>{children}</span>;
}

/** Переключатель на всю ширину колонки: выбранный вариант подсвечен своим цветом. */
function Segmented<K extends string>({
  value,
  onChange,
  options,
}: {
  value: K;
  onChange: (k: K) => void;
  options: { key: K; label: string; dot: string; bg: string; fg: string }[];
}) {
  return (
    <div style={css("display:flex;gap:3px;height:40px;padding:3px;background:var(--border-2);border-radius:9px")}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            style={mix(
              "flex:1 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 8px;border:1px solid transparent;border-radius:7px;font-size:12.5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s,color .12s",
              {
                background: on ? o.bg : "transparent",
                color: on ? o.fg : "var(--text-2)",
                fontWeight: on ? 600 : 500,
                borderColor: on ? "color-mix(in srgb, " + o.dot + " 35%, transparent)" : "transparent",
              }
            )}
          >
            <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: on ? o.dot : "var(--text-5)" })} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Line({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={css("display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:13px;padding:3px 0")}>
      <span style={css("color:var(--text-3)")}>{label}</span>
      <span style={mix(MONO + ";white-space:nowrap", { color: color ?? "var(--text)", fontWeight: bold ? 700 : 500, fontSize: bold ? 15 : 13 })}>{value}</span>
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
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  height?: number;
}) {
  return (
    <span style={css("position:relative;display:block;min-width:0")}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        inputMode="decimal"
        placeholder={placeholder}
        style={mix(
          "padding:0 26px 0 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:13px;outline:none;background:var(--surface);width:100%;" + MONO,
          { height }
        )}
      />
      <span style={css("position:absolute;right:9px;top:50%;transform:translateY(-50%);font-size:11.5px;color:var(--text-4);pointer-events:none")}>с</span>
    </span>
  );
}
