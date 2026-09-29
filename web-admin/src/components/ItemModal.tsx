/**
 * Карточка товара: все данные, быстрая смена статуса, оплаты и история
 * (статусы + сканирования) в одном месте. Открывается из любого списка.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import {
  addItemPayment,
  cancelPayment,
  deleteItem,
  getItem,
  setItemStatus,
  updateItem,
  type ItemDetail,
  type ItemStatus,
} from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { MONO, css, mix } from "../design/css";
import { I_BOX, I_TRASH, Svg } from "../design/icons";
import { FieldLabel, HButton, ModalError, ModalShell, StatusBadge, ST, btnGhost, btnPrimary, inputStyle } from "../design/ui";
import { METHOD_LABEL, METHOD_OPTIONS, SCAN_LABEL, SOURCE_LABEL, STATUS_LABEL, date, dateTime, parseMoney, profitOf, som } from "../lib/cargo";
import { emit } from "../lib/events";
import { Confirm, MoneyInput, Tabs } from "./cargo";
import Select from "./Select";

type Tab = "data" | "pay" | "history";
type Toast = (kind: "success" | "error", text: string) => void;

const STATUSES: ItemStatus[] = ["ordered", "in_stock", "issued"];

export default function ItemModal({ id, onClose, toast }: { id: number; onClose: () => void; toast: Toast }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [d, setD] = useState<ItemDetail | null>(null);
  const [tab, setTab] = useState<Tab>("data");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    getItem(id)
      .then(setD)
      .catch((e) => setError(apiError(e, "Не удалось загрузить товар")));
  }, [id]);
  useEffect(load, [load]);

  const changed = () => {
    load();
    emit("cargo:changed");
  };

  async function changeStatus(s: ItemStatus) {
    if (!d || d.item.status === s) return;
    setError("");
    try {
      await setItemStatus(id, s);
      toast("success", `Статус: ${STATUS_LABEL[s]}`);
      changed();
    } catch (e) {
      setError(apiError(e));
    }
  }

  const it = d?.item;
  return (
    <ModalShell
      title={it ? it.name : "Товар"}
      icon={<Svg paths={I_BOX} size={16} />}
      onClose={onClose}
      width={720}
      footer={
        <>
          {isAdmin && it && (
            <HButton
              onClick={() => setConfirmDelete(true)}
              s="margin-right:auto;height:36px;padding:0 12px;border:1px solid var(--danger-border);background:transparent;color:var(--danger);border-radius:8px;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px"
              hover="background:var(--danger-tint)"
            >
              <Svg paths={I_TRASH} size={14} /> Удалить
            </HButton>
          )}
          <HButton onClick={onClose} s={btnGhost} hover="background:var(--hover)">
            Закрыть
          </HButton>
        </>
      }
    >
      {!it ? (
        <div style={css("padding:22px")}>{error ? <ModalError text={error} /> : <span style={css("color:var(--text-3)")}>Загрузка…</span>}</div>
      ) : (
        <div style={css("padding:16px 18px;display:flex;flex-direction:column;gap:14px")}>
          {/* Кто и что — главное сверху */}
          <div style={css("display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;font-size:12.5px")}>
            <HButton
              onClick={() => {
                onClose();
                nav(`/customers/${it.customer_id}`);
              }}
              s="border:none;background:transparent;padding:0;cursor:pointer;font-weight:600;font-size:13.5px;color:var(--text)"
              hover="color:var(--accent)"
            >
              {it.customer_name}
            </HButton>
            <span style={css(MONO + ";color:var(--text-2)")}>{it.customer_phone || "—"}</span>
            {it.code && (
              <span style={css(MONO + ";color:var(--text-2);background:var(--hover);padding:2px 7px;border-radius:5px")}>{it.code}</span>
            )}
            <span style={css("color:var(--text-3)")}>заказ от {date(it.order_date)}</span>
          </div>

          {/* Статус — переключается одним кликом, история пишется сервером */}
          <div style={css("display:flex;flex-wrap:wrap;gap:10px;align-items:center")}>
            <div style={css("display:inline-flex;gap:3px;background:var(--border-2);padding:3px;border-radius:9px")}>
              {STATUSES.map((s) => {
                const active = it.status === s;
                return (
                  <button
                    key={s}
                    onClick={() => changeStatus(s)}
                    style={mix(
                      "height:30px;padding:0 12px;border:none;border-radius:7px;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px",
                      {
                        background: active ? ST[s].bg : "transparent",
                        color: active ? ST[s].fg : "var(--text-2)",
                        fontWeight: active ? 600 : 500,
                      }
                    )}
                  >
                    <span style={mix("width:6px;height:6px;border-radius:50%", { background: ST[s].dot })} />
                    {STATUS_LABEL[s]}
                  </button>
                );
              })}
            </div>
            <StatusBadge status={it.pay_status} />
            <div style={css("flex:1")} />
            <Figure label="Сумма" value={som(it.sale)} />
            <Figure label="Оплачено" value={som(it.paid)} />
            <Figure label="Долг" value={som(it.debt)} color={it.debt > 0 ? "var(--amber)" : undefined} />
            <Figure
              label="Прибыль"
              value={profitOf(it) === null ? "—" : som(profitOf(it))}
              color={profitOf(it) === null ? "var(--text-4)" : (profitOf(it) ?? 0) < 0 ? "var(--danger)" : "var(--green)"}
            />
          </div>

          <ModalError text={error} />

          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { key: "data", label: "Данные" },
              { key: "pay", label: "Оплаты", count: d.payments.filter((p) => !p.deleted_at).length },
              { key: "history", label: "История", count: d.history.length + d.scans.length },
            ]}
          />

          {tab === "data" && <DataForm d={d} onSaved={() => { toast("success", "Сохранено"); changed(); }} />}
          {tab === "pay" && <Payments d={d} isAdmin={isAdmin} toast={toast} onChanged={changed} />}
          {tab === "history" && <History d={d} />}
        </div>
      )}

      {confirmDelete && it && (
        <Confirm
          title="Удалить товар?"
          text={
            <>
              «{it.name}» клиента {it.customer_name} пропадёт из списков и отчётов. Запись и её история останутся в базе
              (мягкое удаление).
            </>
          }
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteItem(it.id);
            toast("success", "Товар удалён");
            emit("cargo:changed");
            onClose();
          }}
        />
      )}
    </ModalShell>
  );
}

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={css("text-align:right")}>
      <div style={css("font-size:10.5px;color:var(--text-4);text-transform:uppercase;letter-spacing:.04em")}>{label}</div>
      <div style={mix(MONO + ";font-size:14px;font-weight:600", { color: color ?? "var(--text)" })}>{value}</div>
    </div>
  );
}

// --- Данные ----------------------------------------------------------------------------

const str = (n: number | null) => (n === null ? "" : String(n));

function DataForm({ d, onSaved }: { d: ItemDetail; onSaved: () => void }) {
  const it = d.item;
  const [f, setF] = useState({
    name: it.name,
    code: it.code,
    qty: String(it.qty),
    price: str(it.price),
    price_cny: str(it.price_cny),
    real_price: str(it.real_price),
    order_date: it.order_date,
    split_with: it.split_with,
    comment: it.comment,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const real = parseMoney(f.real_price);
  const price = parseMoney(f.price);
  const saleNow = price ?? 0;

  async function save() {
    setError("");
    const qty = Number(f.qty);
    if (!f.name.trim()) return setError("Укажите название");
    if (!Number.isInteger(qty) || qty <= 0) return setError("Количество — целое число больше нуля");
    for (const [k, v] of [["Сумма", price], ["Цена ¥", parseMoney(f.price_cny)], ["Реальная цена", real]] as const) {
      if (Number.isNaN(v)) return setError(`${k}: некорректное число`);
    }
    setBusy(true);
    try {
      await updateItem(it.id, {
        name: f.name.trim(),
        code: f.code.trim(),
        qty,
        price: price ?? 0,
        price_cny: parseMoney(f.price_cny),
        real_price: real,
        order_date: f.order_date,
        split_with: f.split_with,
        comment: f.comment,
      });
      onSaved();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  const input = (k: keyof typeof f, props: Record<string, unknown> = {}) => (
    <input value={f[k]} onChange={(e) => set(k)(e.target.value)} style={css(inputStyle)} {...props} />
  );

  return (
    <div style={css("display:flex;flex-direction:column;gap:12px")}>
      <div style={css("display:grid;grid-template-columns:2fr 1fr 90px;gap:10px")}>
        <label>
          <FieldLabel>Название товара</FieldLabel>
          {input("name")}
        </label>
        <label>
          <FieldLabel>Код товара</FieldLabel>
          {input("code", { style: css(inputStyle + ";" + MONO) })}
        </label>
        <label>
          <FieldLabel>Кол-во</FieldLabel>
          {input("qty", { inputMode: "numeric", style: css(inputStyle + ";" + MONO) })}
        </label>
      </div>
      <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px")}>
        <label>
          <FieldLabel>Сумма (цена клиенту)</FieldLabel>
          <MoneyInput value={f.price} onChange={set("price")} />
        </label>
        <label>
          <FieldLabel>Реальная цена (выкуп)</FieldLabel>
          <MoneyInput value={f.real_price} onChange={set("real_price")} placeholder="за сколько купили" />
        </label>
        <label>
          <FieldLabel>Цена, ¥</FieldLabel>
          {input("price_cny", { inputMode: "decimal", style: css(inputStyle + ";" + MONO) })}
        </label>
      </div>
      <div style={css("font-size:12px;color:var(--text-3);display:flex;gap:16px;flex-wrap:wrap")}>
        <span>
          Клиент платит: <b style={css(MONO + ";color:var(--text)")}>{som(saleNow)}</b>
        </span>
        <span>
          Прибыль:{" "}
          {real === null || Number.isNaN(real) ? (
            <b style={css("color:var(--text-4);font-weight:500")}>укажите реальную цену</b>
          ) : (
            <b style={mix(MONO, { color: saleNow - real < 0 ? "var(--danger)" : "var(--green)" })}>{som(saleNow - real)}</b>
          )}
        </span>
      </div>
      <div style={css("display:grid;grid-template-columns:160px 1fr;gap:10px")}>
        <label>
          <FieldLabel>Дата заказа</FieldLabel>
          {input("order_date", { type: "date", style: css(inputStyle + ";" + MONO) })}
        </label>
        <label>
          <FieldLabel>Разделить с</FieldLabel>
          {input("split_with")}
        </label>
      </div>
      <label>
        <FieldLabel>Комментарий</FieldLabel>
        <textarea
          value={f.comment}
          onChange={(e) => set("comment")(e.target.value)}
          rows={2}
          style={css(inputStyle + ";height:auto;padding:8px 12px;resize:vertical")}
        />
      </label>
      <ModalError text={error} />
      <div style={css("display:flex;justify-content:flex-end")}>
        <HButton disabled={busy} onClick={save} s={btnPrimary} hover="background:var(--accent-hover)">
          {busy ? "Сохраняю…" : "Сохранить изменения"}
        </HButton>
      </div>
    </div>
  );
}

// --- Оплаты ----------------------------------------------------------------------------

function Payments({
  d,
  isAdmin,
  toast,
  onChanged,
}: {
  d: ItemDetail;
  isAdmin: boolean;
  toast: Toast;
  onChanged: () => void;
}) {
  const it = d.item;
  const [amount, setAmount] = useState(it.debt > 0 ? String(it.debt) : "");
  const [method, setMethod] = useState("cash");
  const [error, setError] = useState("");

  async function pay() {
    setError("");
    const a = parseMoney(amount);
    if (!a || Number.isNaN(a)) return setError("Укажите сумму");
    try {
      await addItemPayment(it.id, { amount: a, method });
      toast("success", `Оплата ${som(a)} принята`);
      setAmount("");
      onChanged();
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <div style={css("display:flex;flex-direction:column;gap:12px")}>
      {it.debt > 0 && (
        <div style={css("display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap")}>
          <label style={css("flex:1;min-width:160px")}>
            <FieldLabel>Принять оплату (долг {som(it.debt)})</FieldLabel>
            <MoneyInput value={amount} onChange={setAmount} onEnter={pay} />
          </label>
          <Select value={method} onChange={setMethod} width={150} ariaLabel="Способ оплаты" options={METHOD_OPTIONS} />
          <HButton onClick={pay} s={btnPrimary} hover="background:var(--accent-hover)">
            Принять
          </HButton>
        </div>
      )}
      <ModalError text={error} />
      {d.payments.length === 0 ? (
        <div style={css("font-size:12.5px;color:var(--text-3);padding:8px 0")}>Оплат пока нет</div>
      ) : (
        <div style={css("border:1px solid var(--border);border-radius:8px;overflow:hidden")}>
          {d.payments.map((p) => (
            <div
              key={p.id}
              style={mix(
                "display:grid;grid-template-columns:140px 1fr 110px 90px;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border-2);font-size:12.5px",
                p.deleted_at ? { opacity: 0.5, textDecoration: "line-through" } : {}
              )}
            >
              <span style={css(MONO + ";color:var(--text-3)")}>{dateTime(p.paid_at)}</span>
              <span style={css("color:var(--text-2)")}>
                {METHOD_LABEL[p.method] ?? p.method}
                {p.comment ? ` · ${p.comment}` : ""}
                {p.user_login ? ` · ${p.user_login}` : ""}
              </span>
              <span style={css(MONO + ";font-weight:600;text-align:right")}>{som(p.amount)}</span>
              <span style={css("text-align:right")}>
                {p.deleted_at ? (
                  <span style={css("font-size:11px;color:var(--text-4)")}>отменена</span>
                ) : (
                  isAdmin && (
                    <HButton
                      onClick={async () => {
                        try {
                          await cancelPayment(p.id);
                          toast("success", "Оплата отменена");
                          onChanged();
                        } catch (e) {
                          setError(apiError(e));
                        }
                      }}
                      s="border:none;background:transparent;color:var(--text-4);font-size:11.5px;cursor:pointer"
                      hover="color:var(--danger)"
                    >
                      отменить
                    </HButton>
                  )
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- История: статусы и сканирования одной лентой --------------------------------------------

function History({ d }: { d: ItemDetail }) {
  const events = [
    ...d.history.map((h) => ({
      at: h.changed_at,
      key: `h${h.id}`,
      dot: ST[h.to_status].dot,
      title: h.from_status ? `${STATUS_LABEL[h.from_status]} → ${STATUS_LABEL[h.to_status]}` : STATUS_LABEL[h.to_status],
      meta: [SOURCE_LABEL[h.source] ?? h.source, h.user_login, h.comment].filter(Boolean).join(" · "),
    })),
    ...d.scans.map((s, i) => ({
      at: s.scanned_at,
      key: `s${s.id}`,
      dot: "var(--violet-dot)",
      title: `Сканирование №${i + 1}: ${SCAN_LABEL[s.result]}`,
      meta: [s.user_login].filter(Boolean).join(" · "),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div style={css("display:flex;flex-direction:column")}>
      {events.map((e, i) => (
        <div key={e.key} style={css("display:grid;grid-template-columns:130px 18px 1fr;gap:8px;align-items:start")}>
          <span style={css(MONO + ";font-size:11.5px;color:var(--text-3);padding-top:1px")}>{dateTime(e.at)}</span>
          <span style={css("display:flex;flex-direction:column;align-items:center;height:100%")}>
            <span style={mix("width:9px;height:9px;border-radius:50%;margin-top:4px;flex:none", { background: e.dot })} />
            {i < events.length - 1 && <span style={css("width:1px;flex:1;background:var(--border);min-height:22px")} />}
          </span>
          <span style={css("padding-bottom:12px")}>
            <div style={css("font-size:12.5px;font-weight:500")}>{e.title}</div>
            {e.meta && <div style={css("font-size:11.5px;color:var(--text-3)")}>{e.meta}</div>}
          </span>
        </div>
      ))}
    </div>
  );
}
