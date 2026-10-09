/**
 * Карточка товара: все данные, быстрая смена статуса, оплаты и история
 * (статусы + сканирования) в одном месте. Открывается из любого списка.
 *
 *  - сверху клиент и шкала статуса «Заказан → На складе → Выдан» с датами — клик меняет статус;
 *  - деньги плитками и полоской оплаты;
 *  - вкладки: данные (форма разделами, «Сохранить» — в подвале окна), оплаты, история.
 * Если у товара нет кода, курсор сразу стоит в поле кода — можно сканировать или печатать.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import {
  addItemPayment,
  cancelPayment,
  deleteItem,
  getItem,
  lookupCode,
  setItemStatus,
  updateItem,
  type Item,
  type ItemDetail,
  type ItemStage,
  type ItemStatus,
} from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_BOX, I_CHECK, I_TRASH, Svg } from "../design/icons";
import { FieldLabel, HButton, ModalCancel, ModalError, ModalShell, ST, btnPrimary, inputStyle, type ModalTone } from "../design/ui";
import { METHOD_LABEL, METHOD_OPTIONS, SCAN_LABEL, SOURCE_LABEL, STATUS_LABEL, date, dateTime, parseMoney, profitOf, som } from "../lib/cargo";
import { emit, useDebounced } from "../lib/events";
import { Confirm, MoneyInput, Tabs } from "./cargo";
import Select from "./Select";

type Tab = "data" | "pay" | "history";
type Toast = (kind: "success" | "error", text: string) => void;

/** Шкала товара. «В пути» не ставится вручную — его даёт загруженная накладная из Китая. */
const STEPS: ItemStage[] = ["ordered", "in_transit", "in_stock", "issued"];
const TONE: Record<ItemStage, ModalTone> = { ordered: "amber", in_transit: "sky", in_stock: "accent", issued: "green" };
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";

export default function ItemModal({ id, onClose, toast }: { id: number; onClose: () => void; toast: Toast }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [d, setD] = useState<ItemDetail | null>(null);
  const [tab, setTab] = useState<Tab>("data");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({ dirty: false, busy: false });

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
  const profit = it ? profitOf(it) : null;
  const paidPct = it && it.sale > 0 ? Math.min(100, Math.round((it.paid / it.sale) * 100)) : 0;
  // Когда товар впервые получил каждый статус — для подписей на шкале.
  const stage: ItemStage = it ? (it.stage ?? it.status) : "ordered";
  const reached = (s: ItemStage) => (s === "in_transit" ? it?.transit_shipped_at ?? undefined : d?.history.find((h) => h.to_status === s)?.changed_at);

  return (
    <ModalShell
      title={it ? it.name : "Товар"}
      subtitle={
        it && (
          <>
            {it.code ? (
              <span className="itm-code">{it.code}</span>
            ) : (
              <span className="itm-code none">без кода</span>
            )}
            <span>заказ от {date(it.order_date)}</span>
            <span>·</span>
            <span>{it.qty} шт</span>
            {stage === "in_transit" && it.transit_waybill && (
              <span className="itm-code transit" title="Накладная из Китая">
                в пути · {it.transit_waybill}
              </span>
            )}
          </>
        )
      }
      icon={<Svg paths={I_BOX} size={18} />}
      tone={it ? TONE[stage] : "accent"}
      onClose={onClose}
      width={760}
      footer={
        <>
          {isAdmin && it && (
            <HButton onClick={() => setConfirmDelete(true)} className="itm-del" s="" hover="">
              <Svg paths={I_TRASH} size={14} /> Удалить
            </HButton>
          )}
          <ModalCancel />
          {it && tab === "data" && (
            <HButton type="submit" form="itm-data" disabled={!form.dirty || form.busy} s={btnPrimary + ";min-width:170px" + (form.dirty ? "" : ";opacity:.45;cursor:default")} hover="background:var(--accent-hover)">
              {form.busy ? "Сохраняю…" : form.dirty ? "Сохранить изменения" : "Изменений нет"}
            </HButton>
          )}
        </>
      }
    >
      {!it ? (
        <div style={css("padding:20px 18px")}>
          {error ? (
            <ModalError text={error} />
          ) : (
            <div style={css("display:flex;flex-direction:column;gap:14px")} aria-hidden>
              <div style={css("display:grid;grid-template-columns:1fr 1.4fr;gap:12px")}>
                <span className="sk" style={css("height:78px;border-radius:14px")} />
                <span className="sk" style={css("height:78px;border-radius:14px")} />
              </div>
              <span className="sk" style={css("height:84px;border-radius:14px")} />
              <span className="sk" style={css("width:240px;height:34px;border-radius:10px")} />
              <span className="sk" style={css("height:180px;border-radius:14px")} />
            </div>
          )}
        </div>
      ) : (
        <div className="itm-body">
          <div className="itm-top">
            {/* Клиент */}
            <HButton
              className="itm-cust"
              s=""
              hover=""
              onClick={() => {
                onClose();
                nav(`/customers/${it.customer_id}`);
              }}
              title="Открыть клиента"
            >
              <Avatar name={it.customer_name} />
              <span style={css("min-width:0;flex:1")}>
                <span style={css("display:block;font-size:11.5px;color:var(--text-4)")}>Клиент</span>
                <span style={css("display:block;font-size:14px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{it.customer_name}</span>
                <span style={css(NUM + ";display:block;font-size:12.5px;color:var(--text-3)")}>{it.customer_phone || "телефон не указан"}</span>
              </span>
              <span className="itm-go" aria-hidden>
                ›
              </span>
            </HButton>

            {/* Статус — шкала, клик по шагу меняет статус; история пишется сервером */}
            <div className="itm-steps" role="group" aria-label="Статус товара">
              {STEPS.map((s, i) => {
                const cur = STEPS.indexOf(stage);
                const done = i <= cur;
                const at = reached(s);
                // «В пути» отмечает накладная, а не кнопка.
                const auto = s === "in_transit";
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={auto}
                    className={"itm-step" + (done ? " done" : "") + (i === cur ? " cur" : "") + (auto ? " auto" : "")}
                    style={{ ["--c" as string]: ST[s].dot, ["--t" as string]: ST[s].bg }}
                    onClick={() => !auto && changeStatus(s as ItemStatus)}
                    title={auto ? (it.transit_waybill ? `Накладная ${it.transit_waybill}` : "Ставится загрузкой накладной из Китая на странице «Импорт Excel»") : i === cur ? "Текущий статус" : `Отметить: ${ST[s].label}`}
                  >
                    <span className="itm-step-dot">{done && i < cur ? <Svg paths={I_CHECK} size={13} sw={2.4} /> : i + 1}</span>
                    <span className="itm-step-label">{ST[s].label}</span>
                    <span className="itm-step-sub">
                      {auto
                        ? at
                          ? `отправлен ${date(at.slice(0, 10))}`
                          : done
                            ? "пройден"
                            : "по накладной"
                        : i === cur
                          ? at
                            ? `с ${date(at.slice(0, 10))}`
                            : "сейчас"
                          : done
                            ? at
                              ? date(at.slice(0, 10))
                              : "пройден"
                            : "отметить"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Деньги */}
          <div className="itm-money">
            <MoneyTile label="Сумма" value={som(it.sale)} />
            <MoneyTile label="Оплачено" value={som(it.paid)} color={it.paid > 0 ? "var(--green)" : undefined} />
            <MoneyTile label="Долг" value={it.debt > 0 ? som(it.debt) : "нет"} color={it.debt > 0 ? "var(--amber)" : "var(--text-4)"} />
            <MoneyTile
              label="Прибыль"
              value={profit === null ? "—" : som(profit)}
              color={profit === null ? "var(--text-4)" : profit < 0 ? "var(--danger)" : "var(--green)"}
              hint={profit === null ? "укажите выкуп" : undefined}
            />
            <div className="itm-pay">
              <span className="itm-paybar">
                <span style={{ width: `${paidPct}%`, background: it.pay_status === "paid" ? "var(--green-dot)" : "var(--amber-dot)" }} />
              </span>
              <span style={mix("display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap", { color: ST[it.pay_status].fg })}>
                <span style={mix("width:7px;height:7px;border-radius:50%", { background: ST[it.pay_status].dot })} />
                {ST[it.pay_status].label} · {paidPct}%
              </span>
            </div>
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

          {/* Форма не размонтируется при смене вкладки — несохранённые правки не теряются */}
          <div hidden={tab !== "data"}>
            <DataForm
              d={d}
              onState={setForm}
              onSaved={() => {
                toast("success", "Сохранено");
                changed();
              }}
            />
          </div>
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

function MoneyTile({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="itm-tile">
      <span style={css("display:block;font-size:12px;color:var(--text-3)")}>{label}</span>
      <span style={mix(NUM + ";display:block;margin-top:4px;font-size:18px;font-weight:500;line-height:1.2", { color: color ?? "var(--text)" })}>
        <CountUp text={value} />
      </span>
      {hint && <span style={css("display:block;margin-top:2px;font-size:11.5px;color:var(--text-4)")}>{hint}</span>}
    </div>
  );
}

const AVATAR_BG = [
  "linear-gradient(135deg,#5B7CFA,#8B5CF6)",
  "linear-gradient(135deg,#22C55E,#0EA5E9)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#EC4899,#8B5CF6)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
];

/** Аватар клиента — буквы имени, цвет от имени (как на других страницах). */
function Avatar({ name }: { name: string }) {
  const n = [...name].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const letters = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
  return (
    <span style={mix("width:44px;height:44px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-size:15px;font-weight:500", { background: AVATAR_BG[n % AVATAR_BG.length] })}>
      {letters || "?"}
    </span>
  );
}

// --- Данные ----------------------------------------------------------------------------

const str = (n: number | null) => (n === null ? "" : String(n));

/** Есть ли имя в списке «Разделить с» (через запятую), без учёта регистра. */
const hasName = (list: string, name: string) => list.split(/[,;]/).some((x) => x.trim().toLowerCase() === name.trim().toLowerCase());
/** Добавить имя в «Разделить с», если его там ещё нет. */
const addName = (list: string, name: string) => (hasName(list, name) ? list : list.trim() ? `${list.trim()}, ${name}` : name);

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="itm-sec">
      <div className="itm-sec-title">{title}</div>
      {children}
    </section>
  );
}

function DataForm({ d, onSaved, onState }: { d: ItemDetail; onSaved: () => void; onState: (s: { dirty: boolean; busy: boolean }) => void }) {
  const it = d.item;
  const initial = {
    name: it.name,
    code: it.code,
    qty: String(it.qty),
    price: str(it.price),
    price_cny: str(it.price_cny),
    real_price: str(it.real_price),
    order_date: it.order_date,
    split_with: it.split_with,
    comment: it.comment,
  };
  const [f, setF] = useState(initial);
  // С чем сравнивать, есть ли правки: после сохранения — сохранённые значения.
  const [base, setBase] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  // Тот же код у других товаров: одна посылка на нескольких клиентов или дубль. Проверяем по мере ввода
  // (только поиск — ничего не меняет).
  const codeQ = useDebounced(f.code.trim(), 350);
  const [others, setOthers] = useState<Item[]>([]);
  const [markOthers, setMarkOthers] = useState(true);
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    if (!codeQ) {
      setOthers([]);
      return;
    }
    let alive = true;
    lookupCode(codeQ)
      .then((r) => alive && setOthers(r.items.filter((x) => x.id !== it.id)))
      .catch(() => alive && setOthers([]));
    return () => {
      alive = false;
    };
  }, [codeQ, it.id, recheck]);

  const otherClients = [...new Map(others.filter((o) => o.customer_id !== it.customer_id).map((o) => [o.customer_id, o.customer_name])).values()];
  const qtyNow = Number(f.qty) || 0;
  const totalQty = qtyNow + others.reduce((sum, o) => sum + o.qty, 0);
  const clients = 1 + otherClients.length;
  // У кого из «разделённых» ещё не отмечено «Разделить с» этим клиентом — отметим при сохранении.
  const toMark = others.filter((o) => o.customer_id !== it.customer_id && hasName(f.split_with, o.customer_name) && !hasName(o.split_with, it.customer_name));
  const dirty = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== base[k]);

  useEffect(() => onState({ dirty, busy }), [dirty, busy, onState]);

  // Нет кода — курсор сразу в поле кода: можно сканировать или печатать без клика.
  useEffect(() => {
    if (!it.code) codeRef.current?.focus();
    // только при открытии карточки
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (markOthers && toMark.length) {
        await Promise.all(toMark.map((o) => updateItem(o.id, { split_with: addName(o.split_with, it.customer_name) })));
      }
      setBase(f);
      setRecheck((n) => n + 1);
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
  const noCode = !f.code.trim();

  return (
    <form
      id="itm-data"
      className="itm-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !busy) save();
      }}
    >
      <Section title="Товар">
        <div className="itm-grid itm-grid-a">
          <label>
            <FieldLabel>Название</FieldLabel>
            {input("name")}
          </label>
          <label>
            <FieldLabel>Код товара</FieldLabel>
            <input
              ref={codeRef}
              value={f.code}
              onChange={(e) => {
                const el = e.target;
                const pos = el.selectionStart;
                set("code")(el.value.toUpperCase());
                requestAnimationFrame(() => pos !== null && el.setSelectionRange(pos, pos));
              }}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="отсканируйте или введите"
              className={noCode ? "itm-need" : undefined}
              style={css(inputStyle + ";" + MONO)}
            />
          </label>
          <label>
            <FieldLabel>Кол-во</FieldLabel>
            {input("qty", { inputMode: "numeric", style: css(inputStyle + ";" + MONO) })}
          </label>
        </div>
        {noCode && <div className="itm-hint">Без кода товар не найдётся при сканировании на складе — курсор уже в поле, можно сканировать.</div>}
        {others.length > 0 && (
          <div className={"itm-dupe" + (otherClients.length ? "" : " same")}>
            <div className="itm-dupe-head">
              <span className="itm-dupe-i">{otherClients.length ? "⇄" : "!"}</span>
              <span style={css("min-width:0")}>
                <span style={css("display:block;font-size:13.5px;font-weight:500;color:var(--text)")}>
                  {otherClients.length
                    ? `Этот код уже есть у ${others.length === 1 ? "другого товара" : `${others.length} ${plural(others.length, "товара", "товаров", "товаров")}`}`
                    : "Такой код уже есть у этого же клиента"}
                </span>
                <span style={css("display:block;margin-top:2px;font-size:12.5px;line-height:1.45;color:var(--text-3)")}>
                  {otherClients.length
                    ? "Одна посылка на несколько клиентов? Отметьте, с кем делите. На приёме все товары с этим кодом отметятся одним сканом."
                    : "Проверьте, не дубль ли это — на приёме оба товара отметятся одним сканом."}
                </span>
              </span>
            </div>

            <div className="itm-dupe-list">
              <div className="itm-dupe-row me">
                <span style={css("min-width:0")}>
                  <span style={css("display:block;font-size:13px;color:var(--text)")}>Этот товар</span>
                  <span style={css("display:block;font-size:12px;color:var(--text-3)")}>{it.customer_name}</span>
                </span>
                <span />
                <span className="itm-dupe-qty">{qtyNow} шт</span>
              </div>
              {others.map((o) => (
                <div key={o.id} className="itm-dupe-row">
                  <span style={css("min-width:0")}>
                    <span style={css("display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{o.name}</span>
                    <span style={css("display:block;font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                      {o.customer_name}
                      {o.customer_id === it.customer_id ? " · этот же клиент" : ""} · заказ от {date(o.order_date)}
                    </span>
                  </span>
                  <span style={mix("display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap", { color: ST[o.status].fg })}>
                    <span style={mix("width:7px;height:7px;border-radius:50%", { background: ST[o.status].dot })} />
                    {STATUS_LABEL[o.status]}
                  </span>
                  <span className="itm-dupe-qty">{o.qty} шт</span>
                </div>
              ))}
              <div className="itm-dupe-total">
                <span>Всего по коду</span>
                <b>
                  {totalQty} шт · {clients} {plural(clients, "клиент", "клиента", "клиентов")}
                </b>
              </div>
            </div>

            {otherClients.length > 0 && (
              <div className="itm-dupe-actions">
                {otherClients.map((name) =>
                  hasName(f.split_with, name) ? (
                    <span key={name} className="itm-dupe-ok">
                      ✓ разделено с {name}
                    </span>
                  ) : (
                    <HButton key={name} type="button" onClick={() => set("split_with")(addName(f.split_with, name))} className="itm-chip itm-split" s="" hover="">
                      Разделить с {name}
                    </HButton>
                  )
                )}
              </div>
            )}
            {toMark.length > 0 && (
              <label className="itm-dupe-mark">
                <input type="checkbox" checked={markOthers} onChange={(e) => setMarkOthers(e.target.checked)} />
                <span>
                  Отметить и у {[...new Set(toMark.map((o) => o.customer_name))].join(", ")} — «Разделить с {it.customer_name}»
                </span>
              </label>
            )}
          </div>
        )}
      </Section>

      <Section title="Цена">
        <div className="itm-grid itm-grid-3">
          <label>
            <FieldLabel>Сумма клиенту</FieldLabel>
            <MoneyInput value={f.price} onChange={set("price")} />
          </label>
          <label>
            <FieldLabel>Выкуп (реальная цена)</FieldLabel>
            <MoneyInput value={f.real_price} onChange={set("real_price")} placeholder="за сколько купили" />
          </label>
          <label>
            <FieldLabel>Цена, ¥</FieldLabel>
            {input("price_cny", { inputMode: "decimal", style: css(inputStyle + ";" + MONO) })}
          </label>
        </div>
        <div className="itm-calc">
          <span>
            Клиент платит <b style={css(NUM + ";color:var(--text)")}>{som(saleNow)}</b>
          </span>
          {real === null || Number.isNaN(real) ? (
            <span style={css("color:var(--text-4)")}>укажите выкуп — посчитаем прибыль</span>
          ) : (
            <span>
              Прибыль <b style={mix(NUM, { color: saleNow - real < 0 ? "var(--danger)" : "var(--green)" })}>{som(saleNow - real)}</b>
            </span>
          )}
        </div>
      </Section>

      <Section title="Дополнительно">
        <div className="itm-grid itm-grid-b">
          <label>
            <FieldLabel>Дата заказа</FieldLabel>
            {input("order_date", { type: "date", style: css(inputStyle + ";" + MONO) })}
          </label>
          <label>
            <FieldLabel>Разделить с</FieldLabel>
            {input("split_with", { placeholder: "с кем делят заказ" })}
          </label>
        </div>
        <label style={css("display:block;margin-top:10px")}>
          <FieldLabel>Комментарий</FieldLabel>
          <textarea
            value={f.comment}
            onChange={(e) => set("comment")(e.target.value)}
            rows={2}
            placeholder="заметка для сотрудников"
            style={css(inputStyle + ";height:auto;padding:9px 12px;resize:vertical;line-height:1.45")}
          />
        </label>
      </Section>
      <ModalError text={error} />
    </form>
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
  const [busy, setBusy] = useState(false);

  async function pay() {
    setError("");
    const a = parseMoney(amount);
    if (!a || Number.isNaN(a)) return setError("Укажите сумму");
    setBusy(true);
    try {
      await addItemPayment(it.id, { amount: a, method });
      toast("success", `Оплата ${som(a)} принята`);
      setAmount("");
      onChanged();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={css("display:flex;flex-direction:column;gap:12px")}>
      {it.debt > 0 ? (
        <div className="itm-paybox">
          <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px")}>
            <span style={css("font-size:13.5px;font-weight:500;color:var(--text)")}>Принять оплату</span>
            <span style={css(NUM + ";font-size:12.5px;color:var(--text-3)")}>
              долг <b style={css("font-weight:500;color:var(--amber)")}>{som(it.debt)}</b>
            </span>
          </div>
          <div style={css("display:flex;gap:8px;align-items:center;flex-wrap:wrap")}>
            <div style={css("flex:1;min-width:170px")}>
              <MoneyInput value={amount} onChange={setAmount} onEnter={pay} autoFocus />
            </div>
            <Select value={method} onChange={setMethod} width={150} ariaLabel="Способ оплаты" options={METHOD_OPTIONS} />
            <HButton onClick={pay} disabled={busy} s={btnPrimary} hover="background:var(--accent-hover)">
              {busy ? "Принимаю…" : "Принять"}
            </HButton>
          </div>
          {String(it.debt) !== amount && (
            <HButton onClick={() => setAmount(String(it.debt))} className="itm-chip" s="" hover="">
              весь долг · {som(it.debt)}
            </HButton>
          )}
        </div>
      ) : (
        <div className="itm-paid">
          <span style={css("width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:var(--green-tint);color:var(--green)")}>
            <Svg paths={I_CHECK} size={15} sw={2.4} />
          </span>
          {it.sale > 0 ? "Товар оплачен полностью" : "Сумма не указана — оплачивать нечего"}
        </div>
      )}
      <ModalError text={error} />
      {d.payments.length === 0 ? (
        <div style={css("padding:18px 4px;font-size:12.5px;color:var(--text-4);text-align:center")}>Оплат пока не было</div>
      ) : (
        <div className="itm-list">
          {d.payments.map((p) => (
            <div key={p.id} className={"itm-payrow" + (p.deleted_at ? " off" : "")}>
              <span style={css(NUM + ";font-size:12px;color:var(--text-3)")}>{dateTime(p.paid_at)}</span>
              <span style={css("min-width:0;font-size:12.5px;color:var(--text-2)")}>
                {METHOD_LABEL[p.method] ?? p.method}
                {p.comment ? ` · ${p.comment}` : ""}
                {p.user_login ? <span style={css("color:var(--text-4)")}> · {p.user_login}</span> : null}
              </span>
              <span style={css(NUM + ";font-size:13.5px;font-weight:500;text-align:right;color:var(--text)")}>{som(p.amount)}</span>
              <span style={css("text-align:right")}>
                {p.deleted_at ? (
                  <span style={css("font-size:11.5px;color:var(--text-4)")}>отменена</span>
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
                      s="border:none;background:transparent;color:var(--text-4);font-size:12px;cursor:pointer"
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
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (events.length === 0) return <div style={css("padding:18px 4px;font-size:12.5px;color:var(--text-4);text-align:center")}>Событий пока нет</div>;
  return (
    <div className="itm-list" style={css("padding:6px 0")}>
      {events.map((e, i) => (
        <div key={e.key} className="itm-ev">
          <span className="itm-ev-node">
            <span style={mix("width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 3px var(--surface)", { background: e.dot })} />
            {i < events.length - 1 && <span className="itm-ev-line" />}
          </span>
          <span style={css("min-width:0;padding-bottom:12px")}>
            <span style={css("display:block;font-size:13px;color:var(--text)")}>{e.title}</span>
            {e.meta && <span style={css("display:block;margin-top:1px;font-size:12px;color:var(--text-3)")}>{e.meta}</span>}
          </span>
          <span style={css(NUM + ";font-size:12px;color:var(--text-4);white-space:nowrap")}>{dateTime(e.at)}</span>
        </div>
      ))}
    </div>
  );
}
