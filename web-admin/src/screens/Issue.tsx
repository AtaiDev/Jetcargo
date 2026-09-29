/**
 * Выдача товара клиенту.
 *
 * Найти клиента (телефон, имя, код товара — можно отсканировать) → отметить товары
 * со склада → при долге принять оплату → «Выдать». Статус, дата, время и история
 * пишутся сервером; финансы не меняются (кроме принятой оплаты).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import {
  getCustomer,
  issueItems,
  issueLookup,
  listCustomers,
  listIssues,
  type CustomerBrief,
  type CustomerCard,
  type CustomerRow,
  type IssueList,
} from "../api/domain";
import { Confirm, Empty, MoneyInput, Pager, PeriodPicker, periodOf, type Period } from "../components/cargo";
import ItemModal from "../components/ItemModal";
import { MONO, css, mix } from "../design/css";
import { I_SEARCH, Svg } from "../design/icons";
import { PANEL, Page, SearchInput, THEAD } from "../design/table";
import { HButton, ModalError, ST, SkeletonRows, btnGhost } from "../design/ui";
import { dateTime, parseMoney, shortDateTime, som } from "../lib/cargo";
import { emit, useDebounced, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;

export default function Issue({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const [params, setParams] = useSearchParams();
  const customerId = Number(params.get("customer")) || null;
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [found, setFound] = useState<CustomerBrief[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (id: number | null) => {
    setParams(id ? { customer: String(id) } : {}, { replace: true });
    if (id) {
      setQuery("");
      setFound(null);
    }
  };

  useEffect(() => {
    if (q.length < 2) {
      setFound(null);
      return;
    }
    let alive = true;
    issueLookup(q)
      .then((r) => {
        if (!alive) return;
        setFound(r);
      })
      .catch(() => alive && setFound([]));
    return () => {
      alive = false;
    };
  }, [q]);

  // Enter в поиске: если найден ровно один клиент с товаром на складе — сразу открываем его.
  function onEnter() {
    const withStock = (found ?? []).filter((c) => c.in_stock > 0);
    if (withStock.length === 1) pick(withStock[0].id);
    else if (found?.length === 1) pick(found[0].id);
  }

  return (
    <Page size="wide">
      <div style={css("position:relative;margin-bottom:14px")}>
        <span style={css("position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--text-4);display:flex")}>
          <Svg paths={I_SEARCH} size={18} />
        </span>
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter()}
          placeholder="Телефон, имя клиента или код товара (можно отсканировать)"
          style={css(
            "width:100%;height:48px;padding:0 14px 0 42px;border:1px solid var(--border-strong);border-radius:10px;background:var(--surface);font-size:15px;outline:none"
          )}
        />
        {found && (
          <div
            style={css(
              "position:absolute;top:52px;left:0;right:0;z-index:20;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.12);overflow:hidden"
            )}
          >
            {found.length === 0 ? (
              <div style={css("padding:14px;font-size:12.5px;color:var(--text-3)")}>Клиент не найден</div>
            ) : (
              found.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pick(c.id)}
                  className="row-click"
                  style={css(
                    "display:grid;grid-template-columns:1.4fr 1fr 110px 120px;gap:10px;width:100%;align-items:center;padding:10px 14px;border:none;border-bottom:1px solid var(--hover);background:transparent;text-align:left;font-size:13px"
                  )}
                >
                  <span style={css("font-weight:600")}>{c.name}</span>
                  <span style={css(MONO + ";color:var(--text-2)")}>{c.phone || "—"}</span>
                  <span style={mix("font-size:12px", { color: c.in_stock > 0 ? "var(--accent-strong)" : "var(--text-4)" })}>
                    на складе: <b style={css(MONO)}>{c.in_stock}</b>
                  </span>
                  <span style={mix(MONO + ";font-size:12px;text-align:right", { color: c.debt > 0 ? "var(--amber)" : "var(--text-4)" })}>
                    {c.debt > 0 ? `долг ${som(c.debt)}` : "без долга"}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {customerId ? (
        <IssuePanel key={customerId} customerId={customerId} isDesktop={isDesktop} toast={toast} onClose={() => { pick(null); inputRef.current?.focus(); }} />
      ) : (
        <Waiting isDesktop={isDesktop} onPick={pick} />
      )}

      <IssueHistory toast={toast} isDesktop={isDesktop} />
    </Page>
  );
}

function IssuePanel({
  customerId,
  isDesktop,
  toast,
  onClose,
}: {
  customerId: number;
  isDesktop: boolean;
  toast: Toast;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [payment, setPayment] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    getCustomer(customerId)
      .then((c) => {
        setCard(c);
        const stock = c.items.filter((i) => i.status === "in_stock").map((i) => i.id);
        setSelected((prev) => new Set(prev.size ? [...prev].filter((id) => stock.includes(id)) : stock));
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить клиента")));
  }, [customerId]);
  useEffect(load, [load]);
  useRefresh(load);

  const stock = useMemo(() => card?.items.filter((i) => i.status === "in_stock") ?? [], [card]);
  const chosen = stock.filter((i) => selected.has(i.id));
  const sum = chosen.reduce((s, i) => s + i.sale, 0);
  const debt = chosen.reduce((s, i) => s + i.debt, 0);
  const pay = parseMoney(payment) ?? 0;
  const remaining = Math.max(0, debt - (Number.isNaN(pay) ? 0 : pay));

  useEffect(() => setPayment(debt > 0 ? String(debt) : ""), [debt]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function doIssue() {
    setError("");
    if (Number.isNaN(pay)) throw new Error("Некорректная сумма оплаты");
    const r = await issueItems({ customer_id: customerId, item_ids: chosen.map((i) => i.id), payment_amount: pay || undefined });
    toast("success", `Выдано товаров: ${r.items.length}${pay ? `, оплата ${som(pay)}` : ""}`);
    setConfirm(false);
    setSelected(new Set());
    emit("cargo:changed");
  }

  if (!card) return error ? <ModalError text={error} /> : <SkeletonRows rows={3} />;
  const c = card.customer;
  const waiting = card.items.filter((i) => i.status === "ordered").length;
  const allOn = stock.length > 0 && chosen.length === stock.length;
  const GRID = isDesktop ? "36px minmax(0,1fr) 64px 110px 150px 110px 36px" : "32px minmax(0,1fr) auto";

  return (
    <div style={css(PANEL + ";margin-bottom:18px;overflow:visible")}>
      {/* Клиент */}
      <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:14px 16px;border-bottom:1px solid var(--border-2)")}>
        <span
          style={css(
            "width:44px;height:44px;border-radius:50%;background:var(--accent-tint);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;flex:none"
          )}
        >
          {c.name.trim().slice(0, 1).toUpperCase()}
        </span>
        <div style={css("min-width:150px;flex:1")}>
          <HButton
            onClick={() => nav(`/customers/${c.id}`)}
            s="border:none;background:transparent;padding:0;cursor:pointer;font-size:18px;font-weight:700;color:var(--text);text-align:left"
            hover="color:var(--accent)"
          >
            {c.name}
          </HButton>
          <div style={css(MONO + ";font-size:13px;color:var(--text-2);margin-top:1px")}>{c.phone || "без телефона"}</div>
        </div>
        <div style={css("display:flex;flex-wrap:wrap;gap:6px;align-items:center")}>
          <Pill tone="accent" label="на складе" value={String(stock.length)} />
          <Pill tone="muted" label="ожидается" value={String(waiting)} />
          <Pill tone={card.totals.debt > 0 ? "danger" : "green"} label={card.totals.debt > 0 ? "долг" : "долгов нет"} value={card.totals.debt > 0 ? som(card.totals.debt) : ""} />
        </div>
        <HButton onClick={onClose} s={btnGhost + ";height:32px;padding:0 12px;font-size:12.5px;color:var(--text-2)"} hover="border-color:var(--accent)">
          Другой клиент ✕
        </HButton>
      </div>

      {stock.length === 0 ? (
        <Empty icon="issue" title="На складе у клиента ничего нет" text={waiting ? `Ожидается товаров: ${waiting}. Выдать можно после приёма на склад.` : undefined} />
      ) : (
        <>
          {/* Товары на складе */}
          <div style={mix(THEAD, { gridTemplateColumns: GRID, alignItems: "center" })}>
            <label style={css("display:flex;justify-content:center;padding:9px 0;cursor:pointer")} title="Выбрать все">
              <input type="checkbox" checked={allOn} onChange={(e) => setSelected(e.target.checked ? new Set(stock.map((i) => i.id)) : new Set())} style={css(CHECK)} />
            </label>
            <div style={css("padding:9px 4px")}>{isDesktop ? "Товар" : `Выбрать все (${stock.length})`}</div>
            {isDesktop && <div style={css("padding:9px 4px;text-align:center")}>Кол-во</div>}
            {isDesktop && <div style={css("padding:9px 4px;text-align:right")}>Сумма</div>}
            {isDesktop && <div style={css("padding:9px 4px 9px 14px")}>Оплата</div>}
            {isDesktop && <div style={css("padding:9px 4px")}>Поступил</div>}
            {isDesktop && <div />}
          </div>
          {stock.map((it) => {
            const on = selected.has(it.id);
            return (
              <div
                key={it.id}
                onClick={() => toggle(it.id)}
                className="row-click"
                style={mix("display:grid;align-items:center;border-bottom:1px solid var(--hover);font-size:13px;min-height:54px", {
                  gridTemplateColumns: GRID,
                  background: on ? "var(--accent-tint2)" : "transparent",
                  boxShadow: on ? "inset 3px 0 0 var(--accent)" : "none",
                })}
              >
                <span style={css("display:flex;justify-content:center")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(it.id)} onClick={(e) => e.stopPropagation()} style={css(CHECK)} />
                </span>
                <div style={css("min-width:0;padding:8px 4px")}>
                  <div style={css("font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{it.name}</div>
                  <div style={css(MONO + ";font-size:11.5px;color:var(--text-4);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                    {it.code || "без кода"}
                    {!isDesktop && ` · ${it.qty} шт`}
                  </div>
                </div>
                {isDesktop && (
                  <span style={css("text-align:center;font-size:12.5px;color:var(--text-3)")}>
                    <b style={css(MONO + ";color:var(--text)")}>{it.qty}</b> шт
                  </span>
                )}
                {isDesktop && <span style={css(MONO + ";font-weight:700;text-align:right;padding-right:4px")}>{som(it.sale)}</span>}
                {isDesktop ? (
                  <span style={css("padding-left:14px")}>
                    <PayState item={it} />
                  </span>
                ) : (
                  <span style={css("text-align:right;padding-right:12px;display:flex;flex-direction:column;align-items:flex-end;gap:4px")}>
                    <b style={css(MONO)}>{som(it.sale)}</b>
                    <PayState item={it} compact />
                  </span>
                )}
                {isDesktop && <span style={css(MONO + ";font-size:12px;color:var(--text-3)")}>{shortDateTime(it.arrived_at)}</span>}
                {isDesktop && (
                  <HButton
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(it.id);
                    }}
                    title="Карточка товара"
                    s="width:28px;height:28px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--text-4);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center"
                    hover="border-color:var(--border);color:var(--accent)"
                  >
                    ›
                  </HButton>
                )}
              </div>
            );
          })}

          {/* Итог и выдача */}
          <div style={css("display:flex;flex-wrap:wrap;gap:12px 16px;align-items:stretch;padding:14px 16px;background:var(--surface-2);border-radius:0 0 10px 10px")}>
            <Sum label="Выбрано" value={`${chosen.length} из ${stock.length}`} sub={som(sum)} />
            <Sum
              label="Долг по выбранным"
              value={debt > 0 ? som(debt) : "нет"}
              sub={debt > 0 ? "нужно принять оплату" : "всё оплачено"}
              color={debt > 0 ? "var(--danger)" : "var(--green)"}
            />
            {debt > 0 && (
              <div style={css("display:flex;flex-direction:column;gap:5px;width:210px")}>
                <span style={css("font-size:11.5px;color:var(--text-3)")}>Принять оплату сейчас</span>
                <MoneyInput value={payment} onChange={setPayment} placeholder="0" />
                <span style={mix("font-size:11.5px", { color: remaining > 0 ? "var(--danger)" : "var(--green)" })}>
                  {remaining > 0 ? `останется долг ${som(remaining)}` : "✓ долг будет закрыт"}
                </span>
              </div>
            )}
            <div style={css("flex:1")} />
            <div style={mix("display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:200px", isDesktop ? {} : { width: "100%" })}>
              {error && <ModalError text={error} />}
              <HButton
                disabled={!chosen.length}
                onClick={() => (remaining > 0 ? setConfirm(true) : doIssue().catch((e) => setError(apiError(e))))}
                s={mix("height:46px;padding:0 24px;border:none;border-radius:10px;color:#fff;font-size:14.5px;font-weight:600;cursor:pointer", {
                  background: !chosen.length ? "var(--text-5)" : remaining > 0 ? "var(--amber-dot)" : "var(--green-dot)",
                  cursor: chosen.length ? "pointer" : "not-allowed",
                })}
                hover={chosen.length ? "filter:brightness(.95)" : undefined}
              >
                {!chosen.length ? "Выберите товары" : remaining > 0 ? `Выдать с долгом (${chosen.length})` : `✓ Выдать ${chosen.length} ${plural(chosen.length, "товар", "товара", "товаров")}`}
              </HButton>
            </div>
          </div>
        </>
      )}

      {confirm && (
        <Confirm
          title="Выдать с долгом?"
          danger={false}
          confirmLabel="Выдать"
          text={
            <>
              После выдачи у клиента останется долг <b style={css(MONO)}>{som(remaining)}</b> по выбранным товарам. Долг сохранится
              и будет виден в карточке клиента и в финансах.
            </>
          }
          onClose={() => setConfirm(false)}
          onConfirm={doIssue}
        />
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </div>
  );
}

const CHECK = "width:16px;height:16px;cursor:pointer;accent-color:var(--accent)";

const PILL = {
  accent: ["var(--accent-tint)", "var(--accent-strong)"],
  muted: ["var(--hover)", "var(--text-2)"],
  danger: ["var(--danger-tint)", "var(--danger)"],
  green: ["var(--green-tint)", "var(--green)"],
} as const;

function Pill({ tone, label, value }: { tone: keyof typeof PILL; label: string; value: string }) {
  const [bg, fg] = PILL[tone];
  return (
    <span style={mix("display:inline-flex;align-items:baseline;gap:5px;height:26px;line-height:26px;padding:0 10px;border-radius:8px;font-size:12px;white-space:nowrap", { background: bg, color: fg })}>
      {label}
      {value && <b style={css(MONO + ";font-size:12.5px")}>{value}</b>}
    </span>
  );
}

/** Оплата товара: заметный статус и долг под ним. */
function PayState({ item, compact }: { item: { pay_status: "paid" | "partial" | "unpaid"; debt: number; paid: number }; compact?: boolean }) {
  const t = { paid: ["✓", "Оплачено", ST.paid], partial: ["½", "Частично", ST.partial], unpaid: ["!", "Не оплачено", ST.unpaid] }[item.pay_status] as [string, string, (typeof ST)["paid"]];
  const [icon, label, st] = t;
  return (
    <span style={css("display:inline-flex;flex-direction:column;gap:3px;align-items:" + (compact ? "flex-end" : "flex-start"))}>
      <span style={mix("display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px 0 4px;border-radius:7px;font-size:12px;font-weight:700;white-space:nowrap", { background: st.bg, color: st.fg })}>
        <span style={mix("width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px", { background: st.dot })}>{icon}</span>
        {label}
      </span>
      {item.debt > 0 && <span style={css(MONO + ";font-size:11.5px;font-weight:600;color:var(--danger)")}>долг {som(item.debt)}</span>}
    </span>
  );
}

function Sum({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={css("display:flex;flex-direction:column;justify-content:center;gap:2px;padding:8px 14px;border-radius:10px;background:var(--surface);border:1px solid var(--border-2);min-width:150px")}>
      <span style={css("font-size:11.5px;color:var(--text-3)")}>{label}</span>
      <span style={mix(MONO + ";font-size:17px;font-weight:700;white-space:nowrap", { color: color ?? "var(--text)" })}>{value}</span>
      {sub && <span style={css("font-size:11.5px;color:var(--text-4);white-space:nowrap")}>{sub}</span>}
    </div>
  );
}

// --- Ждут выдачи: клиенты, у которых есть товары на складе ----------------------------------

function Waiting({ isDesktop, onPick }: { isDesktop: boolean; onPick: (id: number) => void }) {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const load = useCallback(() => {
    listCustomers({ filter: "in_stock", limit: 200 })
      .then((r) => setRows([...r.rows].sort((a, b) => b.in_stock - a.in_stock)))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  useRefresh(load);

  const total = (rows ?? []).reduce((s, r) => s + r.in_stock, 0);
  return (
    <section style={css(PANEL + ";margin-bottom:18px")}>
      <div style={css("display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)")}>
        <span style={css("font-size:14px;font-weight:700")}>Ждут выдачи</span>
        <span style={css("font-size:11.5px;color:var(--text-3);background:var(--hover);padding:2px 8px;border-radius:10px")}>
          {rows ? `${rows.length} ${plural(rows.length, "клиент", "клиента", "клиентов")} · ${total} ${plural(total, "товар", "товара", "товаров")}` : "…"}
        </span>
        <span style={css("flex:1")} />
        <span style={css("font-size:11.5px;color:var(--text-4)")}>нажмите на клиента, чтобы выдать</span>
      </div>
      {!rows ? (
        <div style={css("padding:14px")}>
          <SkeletonRows rows={2} />
        </div>
      ) : rows.length === 0 ? (
        <div style={css("padding:14px 16px;font-size:12.5px;color:var(--text-3)")}>
          На складе сейчас пусто — клиенты появятся здесь, как только их товары примут сканером.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(auto-fill, minmax(260px, 1fr))" : "1fr", gap: 10, padding: 12 }}>
          {rows.map((c) => (
            <HButton
              key={c.id}
              onClick={() => onPick(c.id)}
              s="text-align:left;display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface);cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease"
              hover="border-color:var(--accent);box-shadow:0 4px 14px rgba(15,18,25,.06)"
            >
              <span
                style={css(
                  "width:36px;height:36px;border-radius:50%;background:var(--accent-tint);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex:none"
                )}
              >
                {c.name.trim().slice(0, 1).toUpperCase()}
              </span>
              <span style={css("min-width:0;flex:1")}>
                <span style={css("display:block;font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.name}</span>
                <span style={css("display:block;" + MONO + ";font-size:11.5px;color:var(--text-3)")}>{c.phone || "—"}</span>
              </span>
              <span style={css("display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none")}>
                <span style={css("font-size:12px;font-weight:600;color:var(--accent-strong);white-space:nowrap")}>
                  {c.in_stock} {plural(c.in_stock, "товар", "товара", "товаров")}
                </span>
                {c.debt > 0 ? (
                  <span style={css(MONO + ";font-size:11px;color:var(--danger);white-space:nowrap")}>долг {som(c.debt)}</span>
                ) : (
                  <span style={css("font-size:11px;color:var(--green);white-space:nowrap")}>✓ оплачено</span>
                )}
              </span>
            </HButton>
          ))}
        </div>
      )}
    </section>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// --- История выдач: период, поиск, итоги ------------------------------------------------------

/** Локальная полночь дня YYYY-MM-DD в ISO (UTC) — граница для сервера. */
function dayStartIso(d: string, addDays = 0): string {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + addDays);
  return x.toISOString();
}

const LIMIT = 20;

function IssueHistory({ toast, isDesktop }: { toast: Toast; isDesktop: boolean }) {
  const [period, setPeriod] = useState<Period>(() => periodOf("7"));
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<IssueList | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    listIssues({
      q,
      since: dayStartIso(period.date_from),
      until: dayStartIso(period.date_to, 1),
      limit: LIMIT,
      offset,
    })
      .then(setData)
      .catch(() => setData({ rows: [], total: 0, summary: { items: 0, qty: 0, sale: 0, customers: 0 } }));
  }, [q, period.date_from, period.date_to, offset]);
  useEffect(load, [load]);
  useEffect(() => setOffset(0), [q, period.date_from, period.date_to]);
  useRefresh(load);

  const s = data?.summary;
  return (
    <section style={css(PANEL)}>
      <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)")}>
        <span style={css("font-size:14px;font-weight:700")}>История выдач</span>
        <span style={css("flex:1")} />
        <SearchInput value={query} onChange={setQuery} placeholder="Клиент или телефон…" width={220} />
      </div>
      <div style={css("padding:12px 16px;border-bottom:1px solid var(--border-2);display:flex;flex-direction:column;gap:12px")}>
        <PeriodPicker value={period} onChange={setPeriod} />
        {s && data && (
          <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px")}>
            <Stat label="Выдач" value={String(data.total)} />
            <Stat label="Клиентов" value={String(s.customers)} />
            <Stat label="Товаров" value={String(s.items)} hint={`${s.qty} шт`} />
            <Stat label="На сумму" value={som(s.sale)} strong />
          </div>
        )}
      </div>

      {!data ? (
        <div style={css("padding:14px")}>
          <SkeletonRows rows={3} />
        </div>
      ) : data.rows.length === 0 ? (
        <Empty icon="issue" title={q ? "Ничего не найдено" : "За этот период выдач нет"} text="Выберите другой период или измените поиск" />
      ) : (
        <>
          {data.rows.map((r) => {
            const sum = r.items.reduce((acc, i) => acc + i.sale, 0);
            return (
              <div
                key={r.id}
                style={mix("display:grid;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-2)", {
                  gridTemplateColumns: isDesktop ? "62px 36px minmax(160px,1fr) minmax(0,2fr) 110px" : "52px minmax(0,1fr) 90px",
                })}
              >
                <div style={css("text-align:center;line-height:1.25")}>
                  <div style={css(MONO + ";font-size:12.5px;font-weight:600")}>{dateTime(r.issued_at).slice(0, 5)}</div>
                  <div style={css(MONO + ";font-size:11px;color:var(--text-4)")}>{dateTime(r.issued_at).slice(11)}</div>
                </div>
                {isDesktop && (
                  <span
                    style={css(
                      "width:36px;height:36px;border-radius:50%;background:var(--green-tint);color:var(--green);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700"
                    )}
                  >
                    {r.customer_name.trim().slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div style={css("min-width:0")}>
                  <div style={css("font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{r.customer_name}</div>
                  <div style={css("font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                    <span style={css(MONO)}>{r.customer_phone}</span>
                    {r.user_login ? ` · выдал ${r.user_login}` : ""}
                  </div>
                  {!isDesktop && (
                    <div style={css("font-size:11.5px;color:var(--text-2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                      {r.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}
                    </div>
                  )}
                </div>
                {isDesktop && (
                  <div style={css("display:flex;flex-wrap:wrap;gap:6px;min-width:0")}>
                    {r.items.map((i) => (
                      <HButton
                        key={i.id}
                        onClick={() => setOpen(i.id)}
                        title={i.code || undefined}
                        s="font-size:12px;padding:4px 10px;border:1px solid var(--border);border-radius:14px;background:var(--surface-2);cursor:pointer;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                        hover="border-color:var(--accent)"
                      >
                        {i.name} <span style={css(MONO + ";color:var(--text-4)")}>× {i.qty}</span>
                      </HButton>
                    ))}
                  </div>
                )}
                <div style={css("text-align:right")}>
                  <div style={css(MONO + ";font-weight:700;font-size:13.5px;white-space:nowrap")}>{som(sum)}</div>
                  <div style={css("font-size:11px;color:var(--text-4)")}>
                    {r.items.length} {plural(r.items.length, "товар", "товара", "товаров")}
                  </div>
                </div>
              </div>
            );
          })}
          <div style={css("padding:0 16px 12px")}>
            <Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />
          </div>
        </>
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div style={css("background:var(--surface-2);border:1px solid var(--border-2);border-radius:10px;padding:9px 12px")}>
      <div style={css("font-size:11.5px;color:var(--text-3)")}>{label}</div>
      <div style={css("display:flex;align-items:baseline;gap:6px")}>
        <span style={mix(MONO + ";font-size:18px;font-weight:700", { color: strong ? "var(--green)" : "var(--text)" })}>{value}</span>
        {hint && <span style={css("font-size:11px;color:var(--text-4)")}>{hint}</span>}
      </div>
    </div>
  );
}
