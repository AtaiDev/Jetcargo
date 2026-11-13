/**
 * Карточка товара: все данные, быстрая смена статуса, оплаты и история
 * (статусы + сканирования) в одном месте. Открывается из любого списка.
 *
 *  - сверху клиент и шкала статуса «Заказан → На складе → Выдан» с датами — клик меняет статус;
 *  - деньги плитками и полоской оплаты;
 *  - вкладки: данные (форма разделами, «Сохранить» — в подвале окна), оплаты, история.
 * Если у товара нет кода, курсор сразу стоит в поле кода — можно сканировать или печатать.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import {
  addItemPayment,
  cancelPayment,
  deleteItem,
  getItem,
  lookupCode,
  setItemPaid,
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
import { I_BOX, I_CHECK, Svg } from "../design/icons";
import {
  FieldLabel,
  HButton,
  ModalError,
  ModalShell,
  useModalClose,
  ST,
  btnPrimary,
  inputStyle,
  type ModalTone,
} from "../design/ui";
import {
  METHOD_LABEL,
  METHOD_OPTIONS,
  SCAN_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  date,
  dateTime,
  parseMoney,
  profitOf,
  som,
} from "../lib/cargo";
import { emit, useDebounced } from "../lib/events";
import { Confirm, MoneyInput } from "./cargo";
import DatePicker from "./DatePicker";
import Select from "./Select";

type Tab = "data" | "pay" | "history";
type Toast = (kind: "success" | "error", text: string) => void;

/** Шкала товара. «В пути» не ставится вручную — его даёт загруженная накладная из Китая. */
const STEPS: ItemStage[] = ["ordered", "in_transit", "in_stock", "issued"];
// иконки шагов статуса: заказан · в пути · на складе · выдан
const STEP_IC: Record<string, typeof I_CHECK> = {
  ordered: [
    ["circle", { cx: 8, cy: 20.5, r: 1.3 }],
    ["circle", { cx: 18, cy: 20.5, r: 1.3 }],
    [
      "path",
      {
        d: "M2.5 3h2.2l2.4 11.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 1.9-1.5L21.5 7H5.6",
      },
    ],
  ],
  in_transit: [
    [
      "path",
      {
        d: "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
      },
    ],
  ],
  in_stock: I_BOX,
  issued: [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: 9, cy: 7, r: 4 }],
    ["path", { d: "m16 11 2 2 4-4" }],
  ],
};
const TONE: Record<ItemStage, ModalTone> = {
  ordered: "amber",
  in_transit: "sky",
  in_stock: "accent",
  issued: "green",
};
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";

export default function ItemModal({
  id,
  onClose,
  toast,
}: {
  id: number;
  onClose: () => void;
  toast: Toast;
}) {
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [d, setD] = useState<ItemDetail | null>(null);
  // вкладки «Оплаты» и «История» скрыты — карточка показывает только данные
  const [tab] = useState<Tab>("data");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // телефон: удаление в два нажатия прямо в подвале (иконка → «Удалить?» → удалено)
  const [delArm, setDelArm] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const delT = useRef(0);
  useEffect(() => () => clearTimeout(delT.current), []);
  async function removeItem() {
    if (!it || delBusy) return;
    setDelBusy(true);
    try {
      await deleteItem(it.id);
      toast("success", "Товар удалён");
      emit("cargo:changed");
      onClose();
    } catch (e) {
      toast("error", apiError(e));
      setDelBusy(false);
      setDelArm(false);
    }
  }
  function onDelete() {
    if (!window.matchMedia("(max-width: 560px)").matches) return setConfirmDelete(true);
    clearTimeout(delT.current);
    if (delArm) return void removeItem();
    setDelArm(true);
    delT.current = window.setTimeout(() => setDelArm(false), 3500);
  }
  const [form, setForm] = useState({ dirty: false, busy: false });

  const load = useCallback(() => {
    getItem(id)
      .then(setD)
      .catch((e) => setError(apiError(e, "Не удалось загрузить товар")));
  }, [id]);
  useEffect(load, [load]);
  // окно показываем сразу с данными (одна анимация, без скачка высоты); заготовка — только если грузится дольше 450 мс
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 450);
    return () => clearTimeout(t);
  }, []);

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
  const paidPct =
    it && it.sale > 0
      ? Math.min(100, Math.round((it.paid / it.sale) * 100))
      : 0;
  // Когда товар впервые получил каждый статус — для подписей на шкале.
  const stage: ItemStage = it ? (it.stage ?? it.status) : "ordered";
  const reached = (s: ItemStage) =>
    s === "in_transit"
      ? (it?.transit_shipped_at ?? undefined)
      : d?.history.find((h) => h.to_status === s)?.changed_at;

  if (!it && !late && !error) return null;

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
            <HButton
              onClick={onDelete}
              disabled={delBusy}
              className={"itm-del" + (delArm ? " armed" : "")}
              s=""
              hover=""
            >
              <span className="itm-del-b" aria-hidden>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <g className="lid">
                    <path d="M3.5 6.5h17" />
                    <path d="M9 6.5V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
                  </g>
                  <path d="M5.5 6.5l1 12.6A2 2 0 0 0 8.5 21h7a2 2 0 0 0 2-1.9l1-12.6" />
                  <path d="M10 11v5.5M14 11v5.5" />
                </svg>
              </span>
              <span className="itm-del-t">{delBusy ? "Удаляю…" : delArm ? "Удалить?" : "Удалить"}</span>
            </HButton>
          )}
          {it && tab === "data" && (
            <HButton
              type="submit"
              form="itm-data"
              disabled={!form.dirty || form.busy}
              className={"itm-save" + (form.dirty ? " dirty" : "") + (form.busy ? " busy" : "") + (justSaved ? " saved" : "")}
              s=""
              hover=""
            >
              <span className="itm-save-ic" aria-hidden>
                {form.busy ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M21 12a9 9 0 1 1-6.2-8.6" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7.5" pathLength={1} />
                  </svg>
                )}
              </span>
              <span>{form.busy ? "Сохраняю…" : justSaved ? "Сохранено" : form.dirty ? "Сохранить изменения" : "Изменений нет"}</span>
            </HButton>
          )}
        </>
      }
    >
      {!it ? (
        <div className="itm-body itm-loading" style={css("padding:20px 18px")}>
          {error ? (
            <ModalError text={error} />
          ) : (
            <div
              style={css("display:flex;flex-direction:column;gap:14px")}
              aria-hidden
            >
              <div
                style={css(
                  "display:grid;grid-template-columns:1fr 1.4fr;gap:12px",
                )}
              >
                <span
                  className="sk"
                  style={css("height:78px;border-radius:14px")}
                />
                <span
                  className="sk"
                  style={css("height:78px;border-radius:14px")}
                />
              </div>
              <span
                className="sk"
                style={css("height:84px;border-radius:14px")}
              />
              <span
                className="sk"
                style={css("width:240px;height:34px;border-radius:10px")}
              />
              <span
                className="sk"
                style={css("height:180px;border-radius:14px")}
              />
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
                // На карточке клиента сразу показать, где этот товар в списке.
                nav(`/customers/${it.customer_id}`, {
                  state: { focus: it.id },
                });
              }}
              title="Открыть клиента"
            >
              <Avatar name={it.customer_name} />
              <span style={css("min-width:0;flex:1")}>
                <span
                  style={css(
                    "display:block;font-size:11.5px;color:var(--text-4)",
                  )}
                >
                  Клиент
                </span>
                <span
                  style={css(
                    "display:block;font-size:14px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
                  )}
                >
                  {it.customer_name}
                </span>
                <span
                  style={css(
                    NUM + ";display:block;font-size:12.5px;color:var(--text-3)",
                  )}
                >
                  {it.customer_phone || "телефон не указан"}
                </span>
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
                    className={
                      "itm-step" +
                      (done ? " done" : "") +
                      (i === cur ? " cur" : "") +
                      (auto ? " auto" : "")
                    }
                    style={{
                      ["--c" as string]: ST[s].dot,
                      ["--t" as string]: ST[s].bg,
                    }}
                    onClick={() => !auto && changeStatus(s as ItemStatus)}
                    title={
                      auto
                        ? it.transit_waybill
                          ? `Накладная ${it.transit_waybill}`
                          : "Ставится загрузкой накладной из Китая на странице «Импорт Excel»"
                        : i === cur
                          ? "Текущий статус"
                          : `Отметить: ${ST[s].label}`
                    }
                  >
                    <span className="itm-step-dot">
                      {!done && (
                        <svg
                          className="itm-step-fr"
                          viewBox="0 0 36 36"
                          aria-hidden
                        >
                          <rect
                            x=".75"
                            y=".75"
                            width="34.5"
                            height="34.5"
                            rx="11.25"
                            pathLength={120}
                          />
                        </svg>
                      )}
                      <Svg paths={STEP_IC[s]} size={15} sw={1.9} />
                      {done && i < cur && (
                        <i className="itm-step-ok">
                          <Svg paths={I_CHECK} size={8} sw={3.4} />
                        </i>
                      )}
                    </span>
                    <span className="itm-step-label">{ST[s].label}</span>
                    <span
                      className={
                        "itm-step-sub" +
                        (i === cur
                          ? " is-cur"
                          : !done && !auto
                            ? " is-todo"
                            : "")
                      }
                    >
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
          <div className="itm-money itm-mn2">
            <div className="mn-row4">
              <MoneyRow
                ic={MN_IC.sum}
                label="Сумма"
                value={som(it.sale)}
                tone="main"
              />
              <MoneyRow
                ic={MN_IC.paid}
                label="Оплачено"
                value={som(it.paid)}
                tone={it.paid > 0 ? "ok" : "mute"}
              />
              <MoneyRow
                ic={MN_IC.debt}
                label="Долг"
                value={it.debt > 0 ? som(it.debt) : "нет"}
                tone={it.debt > 0 ? "bad" : "mute"}
              />
              <MoneyRow
                ic={MN_IC.profit}
                label="Прибыль"
                value={profit === null ? "—" : som(profit)}
                tone={profit === null ? "mute" : profit < 0 ? "bad" : "ok"}
                hint={profit === null ? "укажите выкуп" : undefined}
              />
            </div>
            <PayStatus
              it={it}
              pct={paidPct}
              isAdmin={isAdmin}
              toast={toast}
              onChanged={changed}
            />
          </div>

          <ModalError text={error} />

          {/* Форма не размонтируется при смене вкладки — несохранённые правки не теряются */}
          <div hidden={tab !== "data"}>
            <DataForm
              d={d}
              onState={setForm}
              onSaved={() => {
                setJustSaved(true);
                flashSaved();
                changed();
              }}
            />
          </div>
          {tab === "pay" && (
            <Payments
              d={d}
              isAdmin={isAdmin}
              toast={toast}
              onChanged={changed}
            />
          )}
          {tab === "history" && <History d={d} />}
        </div>
      )}

      {confirmDelete && it && (
        <Confirm
          title="Удалить товар?"
          text={
            <>
              «{it.name}» клиента {it.customer_name} пропадёт из списков и
              отчётов. Запись и её история останутся в базе (мягкое удаление).
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

/** «Изменения сохранены» — плашка снизу экрана; отдельный элемент в body, поэтому видна и после закрытия окна. */
export function flashSaved(text = "Изменения сохранены") {
  document.querySelectorAll(".itm-flash").forEach((n) => n.remove());
  const el = document.createElement("div");
  el.className = "itm-flash";
  el.setAttribute("role", "status");
  el.innerHTML =
    '<span class="itm-flash-ic"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" pathLength="1"/></svg></span>' + text;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 2800);
}

// --- Оплата: быстрый переключатель ----------------------------------------------------------------

type PayKey = "unpaid" | "partial" | "paid";
// иконки панели оплаты: принять · отменить · частично
const PE_IC: Record<PayKey, typeof I_CHECK> = {
  paid: [
    ["rect", { x: 2.5, y: 6, width: 19, height: 12, rx: 2.5 }],
    ["circle", { cx: 12, cy: 12, r: 2.6 }],
    ["path", { d: "M6 9.5v.01M18 14.5v.01" }],
  ],
  unpaid: [
    ["path", { d: "M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" }],
    ["path", { d: "M3.5 3.5v5h5" }],
  ],
  partial: [
    ["path", { d: "M20.5 12A8.5 8.5 0 0 0 12 3.5V12z" }],
    ["path", { d: "M20.3 15.4A8.5 8.5 0 1 1 8.6 4.2" }],
  ],
};

const PAY_KEYS: { key: PayKey; label: string }[] = [
  { key: "unpaid", label: "Не оплачено" },
  { key: "partial", label: "Частично" },
  { key: "paid", label: "Оплачено" },
];

/**
 * Статус оплаты одним кликом: «Оплачено» — принять остаток, «Частично» — указать, сколько всего оплачено,
 * «Не оплачено» — отменить оплаты (администратор). Сервер пересчитывает сам (set-paid), отменённые оплаты
 * остаются в истории. Полоска показывает, какая часть суммы уже оплачена.
 */
function PayStatus({
  it,
  pct,
  isAdmin,
  toast,
  onChanged,
}: {
  it: ItemDetail["item"];
  pct: number;
  isAdmin: boolean;
  toast: Toast;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<PayKey | null>(null);
  // панель плавно сворачивается — пока идёт анимация, показываем последний выбранный вариант
  const lastMode = useRef<PayKey | null>(null);
  if (mode) lastMode.current = mode;
  const pm = mode ?? lastMode.current;
  // смена варианта при открытой панели: текущая уезжает в сторону, новая въезжает с другой
  // (вправо по шкале — уходит влево и новая справа; влево — наоборот)
  const [anim, setAnim] = useState("");
  const swapT = useRef(0);
  useEffect(() => () => clearTimeout(swapT.current), []);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cur: PayKey = it.pay_status;
  const nothing = it.sale <= 0;

  function open(k: PayKey) {
    setError("");
    clearTimeout(swapT.current);
    setAnim("");
    // повторный клик по выбранному варианту закрывает панель
    if (mode === k) {
      setMode(null);
      return;
    }
    if (k === cur && k !== "partial") {
      setMode(null);
      return;
    }
    clearTimeout(swapT.current);
    const amt =
      k === "partial"
        ? it.paid > 0 && it.paid < it.sale
          ? String(it.paid)
          : ""
        : "";
    if (mode && k !== mode) {
      const fwd =
        PAY_KEYS.findIndex((p) => p.key === k) >
        PAY_KEYS.findIndex((p) => p.key === mode);
      setAnim(fwd ? "out-l" : "out-r");
      swapT.current = window.setTimeout(() => {
        setMode(k);
        setAmount(amt);
        setAnim(fwd ? "in-r" : "in-l");
      }, 170);
      return;
    }
    setAnim("");
    setMode(k);
    setAmount(amt);
  }

  const target =
    pm === "paid" ? it.sale : pm === "unpaid" ? 0 : parseMoney(amount);
  useEffect(() => {
    if (mode === "partial")
      document.querySelector<HTMLInputElement>(".pe-in input")?.focus();
  }, [mode]);
  const bad =
    target === null ||
    Number.isNaN(target) ||
    target < 0 ||
    target > it.sale + 0.001;
  const diff =
    !bad && target !== null ? Math.round((target - it.paid) * 100) / 100 : 0;
  const needsAdmin = diff < -0.004 && !isAdmin;

  async function apply() {
    if (bad || target === null || busy) return;
    if (Math.abs(diff) < 0.005) {
      setMode(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setItemPaid(it.id, target, method);
      toast(
        "success",
        target >= it.sale
          ? "Отмечено оплаченным"
          : target <= 0
            ? "Оплаты отменены"
            : `Оплачено ${som(target)} из ${som(it.sale)}`,
      );
      setMode(null);
      onChanged();
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="itm-pay">
      <div className="itm-pay-top">
        <div className="itm-payseg" role="radiogroup" aria-label="Оплата">
          {PAY_KEYS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={cur === p.key}
              disabled={nothing}
              className={
                (cur === p.key ? "on " : "") +
                (mode === p.key ? "pick " : "") +
                p.key
              }
              onClick={() => open(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="itm-paybar">
          <span
            style={{
              width: `${pct}%`,
              background:
                cur === "paid" ? "var(--green-dot)" : "var(--amber-dot)",
            }}
          />
        </span>
        <span
          style={css(
            NUM + ";font-size:12.5px;color:var(--text-3);white-space:nowrap",
          )}
        >
          {pct}%
        </span>
      </div>

      {/* обёртка есть всегда — так первое раскрытие тоже анимируется (0fr → 1fr) */}
      <div className={"pe-wrap" + (mode ? " open" : "")} aria-hidden={!mode}>
        <div className="pe-clip">
          {pm && (
            <div
              key={pm}
              className={"itm-payedit " + pm + (anim ? " " + anim : "")}
            >
              <div className="pe-top">
                <span className="pe-ic">
                  <Svg paths={PE_IC[pm]} size={17} sw={1.8} />
                </span>
                <span className="pe-tt">
                  <b>
                    {pm === "paid" ? (
                      <>
                        Принять остаток <em>{som(it.debt)}</em>
                      </>
                    ) : pm === "unpaid" ? (
                      it.paid > 0 ? (
                        <>
                          Отменить оплаты <em>{som(it.paid)}</em>
                        </>
                      ) : (
                        "Оплат по товару нет"
                      )
                    ) : (
                      "Частичная оплата"
                    )}
                  </b>
                  <small className={bad && amount ? "err" : ""}>
                    {bad
                      ? amount
                        ? `от 0 до ${som(it.sale)}`
                        : `сколько оплачено всего из ${som(it.sale)}`
                      : needsAdmin
                        ? "Уменьшить оплату может только администратор"
                        : diff > 0
                          ? `примем ${som(diff)} · долг станет ${som(Math.max(0, it.sale - (target ?? 0)))}`
                          : diff < 0
                            ? `отменим ${som(-diff)} · долг станет ${som(it.sale - (target ?? 0))}`
                            : "без изменений"}
                  </small>
                </span>
              </div>
              <div className="pe-bot">
                {pm === "partial" && (
                  <label className="pe-in">
                    <input
                      value={amount}
                      onChange={(e) =>
                        setAmount(e.target.value.replace(/[^\d.,\s]/g, ""))
                      }
                      onKeyDown={(e) => e.key === "Enter" && apply()}
                      inputMode="decimal"
                      placeholder="0"
                      autoFocus
                      aria-label="Сколько всего оплачено"
                    />
                    <em>с</em>
                  </label>
                )}
                {diff > 0.004 && (
                  <span
                    className="pe-methods"
                    role="radiogroup"
                    aria-label="Способ оплаты"
                  >
                    {METHOD_OPTIONS.filter(
                      (m) => m.value === "cash" || m.value === "transfer",
                    ).map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        role="radio"
                        aria-checked={method === m.value}
                        className={method === m.value ? "on" : ""}
                        onClick={() => setMethod(m.value)}
                        title={m.label}
                      >
                        <svg
                          className="pe-m-ic"
                          width="17"
                          height="17"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          {m.value === "cash" ? (
                            <>
                              <rect
                                pathLength={1}
                                x="2.5"
                                y="8.5"
                                width="16.5"
                                height="10.5"
                                rx="2.2"
                              />
                              <path
                                pathLength={1}
                                d="M5.5 5.5h14a2 2 0 0 1 2 2v8"
                              />
                              <circle
                                pathLength={1}
                                cx="10.75"
                                cy="13.75"
                                r="2.3"
                              />
                              <path
                                pathLength={1}
                                d="M5.8 11.6v.01M15.7 15.9v.01"
                              />
                            </>
                          ) : (
                            <>
                              <path pathLength={1} d="M4 9h14l-3.5-3.5" />
                              <path pathLength={1} d="M20 15H6l3.5 3.5" />
                            </>
                          )}
                        </svg>
                        <span>{m.label}</span>
                      </button>
                    ))}
                  </span>
                )}
                {pm === "unpaid" && it.paid > 0 && (
                  <span className="pe-note">
                    останутся в истории с пометкой «отменена»
                  </span>
                )}
                <HButton
                  onClick={apply}
                  disabled={bad || busy || needsAdmin || Math.abs(diff) < 0.005}
                  className={"itm-payedit-go " + (diff < 0 ? "minus" : "")}
                  s=""
                  hover=""
                >
                  {busy
                    ? "Сохраняю…"
                    : diff < 0
                      ? <>Отменить<span className="pe-go-x"> оплату</span></>
                      : pm === "paid"
                        ? `Принять ${som(it.debt)}`
                        : "Сохранить"}
                </HButton>
              </div>
              {error && <ModalError text={error} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// иконки строк денег: оплачено · долг · прибыль
const MN_IC: Record<"sum" | "paid" | "debt" | "profit", typeof I_CHECK> = {
  sum: [
    [
      "path",
      {
        d: "M19 7V4.5A1.5 1.5 0 0 0 17.5 3H5a2 2 0 0 0 0 4h14.5A1.5 1.5 0 0 1 21 8.5V11h-3a2 2 0 0 0 0 4h3v2.5a1.5 1.5 0 0 1-1.5 1.5H5a2 2 0 0 1-2-2V5",
      },
    ],
  ],
  paid: [
    [
      "path",
      {
        d: "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z",
      },
    ],
    ["path", { d: "m9 12 2 2 4-4" }],
  ],
  debt: [
    ["path", { d: "M6 3h12M6 21h12" }],
    [
      "path",
      { d: "M7.5 3v3.2a2 2 0 0 0 .6 1.4L12 11.5l3.9-3.9a2 2 0 0 0 .6-1.4V3" },
    ],
    [
      "path",
      {
        d: "M16.5 21v-3.2a2 2 0 0 0-.6-1.4L12 12.5l-3.9 3.9a2 2 0 0 0-.6 1.4V21",
      },
    ],
  ],
  profit: [
    ["path", { d: "M3 17.5 9.5 11l4 4L21 7.5" }],
    ["path", { d: "M15.5 7.5H21V13" }],
  ],
};

function MoneyRow({
  ic,
  label,
  value,
  tone,
  hint,
  pct,
}: {
  ic: typeof I_CHECK;
  label: string;
  value: string;
  tone: "main" | "ok" | "bad" | "mute";
  hint?: string;
  pct?: number;
}) {
  return (
    <div className={"mn-c " + tone} title={hint}>
      <span className="mn-l">
        <span className="mn-i">
          <Svg paths={ic} size={15} sw={1.85} />
        </span>
        {label}
        {pct !== undefined && <em className="mn-pct">{pct}%</em>}
      </span>
      <b className="mn-v">
        <CountUp text={value} />
      </b>
      {pct !== undefined && (
        <span className="mn-bar">
          <i style={{ width: pct + "%" }} />
        </span>
      )}
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
    <span
      style={mix(
        "width:44px;height:44px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-size:15px;font-weight:500",
        { background: AVATAR_BG[n % AVATAR_BG.length] },
      )}
    >
      {letters || "?"}
    </span>
  );
}

// --- Данные ----------------------------------------------------------------------------

const str = (n: number | null) => (n === null ? "" : String(n));

/** Есть ли имя в списке «Разделить с» (через запятую), без учёта регистра. */
const hasName = (list: string, name: string) =>
  list
    .split(/[,;]/)
    .some((x) => x.trim().toLowerCase() === name.trim().toLowerCase());
/** Добавить имя в «Разделить с», если его там ещё нет. */
const addName = (list: string, name: string) =>
  hasName(list, name) ? list : list.trim() ? `${list.trim()}, ${name}` : name;

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function Section({ children }: { children: ReactNode }) {
  return <section className="itm-sec">{children}</section>;
}

function DataForm({
  d,
  onSaved,
  onState,
}: {
  d: ItemDetail;
  onSaved: () => void;
  onState: (s: { dirty: boolean; busy: boolean }) => void;
}) {
  const it = d.item;
  const closeModal = useModalClose();
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
  const set = (k: keyof typeof f) => (v: string) =>
    setF((x) => ({ ...x, [k]: v }));

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

  const otherClients = [
    ...new Map(
      others
        .filter((o) => o.customer_id !== it.customer_id)
        .map((o) => [o.customer_id, o.customer_name]),
    ).values(),
  ];
  const qtyNow = Number(f.qty) || 0;
  const totalQty = qtyNow + others.reduce((sum, o) => sum + o.qty, 0);
  const clients = 1 + otherClients.length;
  // У кого из «разделённых» ещё не отмечено «Разделить с» этим клиентом — отметим при сохранении.
  const toMark = others.filter(
    (o) =>
      o.customer_id !== it.customer_id &&
      hasName(f.split_with, o.customer_name) &&
      !hasName(o.split_with, it.customer_name),
  );
  const dirty = (Object.keys(f) as (keyof typeof f)[]).some(
    (k) => f[k] !== base[k],
  );

  useEffect(() => onState({ dirty, busy }), [dirty, busy, onState]);

  // Нет кода — курсор сразу в поле кода: можно сканировать или печатать без клика.
  useEffect(() => {
    if (!it.code) codeRef.current?.focus();
    // только при открытии карточки
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const real = parseMoney(f.real_price);
  const price = parseMoney(f.price);

  async function save() {
    setError("");
    const qty = Number(f.qty);
    if (!f.name.trim()) return setError("Укажите название");
    if (!Number.isInteger(qty) || qty <= 0)
      return setError("Количество — целое число больше нуля");
    for (const [k, v] of [
      ["Сумма", price],
      ["Цена ¥", parseMoney(f.price_cny)],
      ["Реальная цена", real],
    ] as const) {
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
        await Promise.all(
          toMark.map((o) =>
            updateItem(o.id, {
              split_with: addName(o.split_with, it.customer_name),
            }),
          ),
        );
      }
      setBase(f);
      setRecheck((n) => n + 1);
      onSaved();
      // после сохранения — короткая пауза (кнопка показывает «Сохранено»), затем окно плавно закрывается
      window.setTimeout(closeModal, 750);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  const input = (k: keyof typeof f, props: Record<string, unknown> = {}) => (
    <input
      value={f[k]}
      onChange={(e) => set(k)(e.target.value)}
      style={css(inputStyle)}
      {...props}
    />
  );

  return (
    <form
      id="itm-data"
      className="itm-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !busy) save();
      }}
      onKeyDown={(e) => {
        // Enter в любом поле (кроме комментария) — сохранить
        const t = e.target as HTMLElement;
        if (e.key === "Enter" && !e.shiftKey && t.tagName === "INPUT") {
          e.preventDefault();
          if (dirty && !busy) save();
        }
      }}
    >
      <Section>
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
                requestAnimationFrame(
                  () => pos !== null && el.setSelectionRange(pos, pos),
                );
              }}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="отсканируйте или введите"
              style={css(inputStyle + ";" + MONO)}
            />
          </label>
          <label>
            <FieldLabel>Кол-во</FieldLabel>
            {input("qty", {
              inputMode: "numeric",
              style: css(inputStyle + ";" + MONO),
            })}
          </label>
        </div>
        {others.length > 0 && (
          <div className={"itm-dupe" + (otherClients.length ? "" : " same")}>
            <div className="itm-dupe-head">
              <span className="itm-dupe-i">
                {otherClients.length ? "⇄" : "!"}
              </span>
              <span style={css("min-width:0")}>
                <span
                  style={css(
                    "display:block;font-size:13.5px;font-weight:500;color:var(--text)",
                  )}
                >
                  {otherClients.length
                    ? `Этот код уже есть у ${others.length === 1 ? "другого товара" : `${others.length} ${plural(others.length, "товара", "товаров", "товаров")}`}`
                    : "Такой код уже есть у этого же клиента"}
                </span>
                <span
                  style={css(
                    "display:block;margin-top:2px;font-size:12.5px;line-height:1.45;color:var(--text-3)",
                  )}
                >
                  {otherClients.length
                    ? "Одна посылка на несколько клиентов? Отметьте, с кем делите. На приёме все товары с этим кодом отметятся одним сканом."
                    : "Проверьте, не дубль ли это — на приёме оба товара отметятся одним сканом."}
                </span>
              </span>
            </div>

            <div className="itm-dupe-list">
              <div className="itm-dupe-row me">
                <span style={css("min-width:0")}>
                  <span
                    style={css(
                      "display:block;font-size:13px;color:var(--text)",
                    )}
                  >
                    Этот товар
                  </span>
                  <span
                    style={css(
                      "display:block;font-size:12px;color:var(--text-3)",
                    )}
                  >
                    {it.customer_name}
                  </span>
                </span>
                <span />
                <span className="itm-dupe-qty">{qtyNow} шт</span>
              </div>
              {others.map((o) => (
                <div key={o.id} className="itm-dupe-row">
                  <span style={css("min-width:0")}>
                    <span
                      style={css(
                        "display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
                      )}
                    >
                      {o.name}
                    </span>
                    <span
                      style={css(
                        "display:block;font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
                      )}
                    >
                      {o.customer_name}
                      {o.customer_id === it.customer_id
                        ? " · этот же клиент"
                        : ""}{" "}
                      · заказ от {date(o.order_date)}
                    </span>
                  </span>
                  <span
                    style={mix(
                      "display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap",
                      { color: ST[o.status].fg },
                    )}
                  >
                    <span
                      style={mix("width:7px;height:7px;border-radius:50%", {
                        background: ST[o.status].dot,
                      })}
                    />
                    {STATUS_LABEL[o.status]}
                  </span>
                  <span className="itm-dupe-qty">{o.qty} шт</span>
                </div>
              ))}
              <div className="itm-dupe-total">
                <span>Всего по коду</span>
                <b>
                  {totalQty} шт · {clients}{" "}
                  {plural(clients, "клиент", "клиента", "клиентов")}
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
                    <HButton
                      key={name}
                      type="button"
                      onClick={() =>
                        set("split_with")(addName(f.split_with, name))
                      }
                      className="itm-chip itm-split"
                      s=""
                      hover=""
                    >
                      Разделить с {name}
                    </HButton>
                  ),
                )}
              </div>
            )}
            {toMark.length > 0 && (
              <label className="itm-dupe-mark">
                <input
                  type="checkbox"
                  checked={markOthers}
                  onChange={(e) => setMarkOthers(e.target.checked)}
                />
                <span>
                  Отметить и у{" "}
                  {[...new Set(toMark.map((o) => o.customer_name))].join(", ")}{" "}
                  — «Разделить с {it.customer_name}»
                </span>
              </label>
            )}
          </div>
        )}
      </Section>

      <Section>
        <div className="itm-grid itm-grid-3">
          <label>
            <FieldLabel>Сумма клиенту</FieldLabel>
            <MoneyInput value={f.price} onChange={set("price")} />
          </label>
          <label>
            <FieldLabel>Выкуп (реальная цена)</FieldLabel>
            <MoneyInput
              value={f.real_price}
              onChange={set("real_price")}
              placeholder="за сколько купили"
            />
          </label>
          <label>
            <FieldLabel>Цена, ¥</FieldLabel>
            {input("price_cny", {
              inputMode: "decimal",
              style: css(inputStyle + ";" + MONO),
            })}
          </label>
        </div>
      </Section>

      <Section>
        <div className="itm-grid itm-grid-b">
          <label>
            <FieldLabel>Дата заказа</FieldLabel>
            <DatePicker
              value={f.order_date}
              onChange={(v) => v && set("order_date")(v)}
              words
              height={24}
              fontSize={15}
              popClass="ovp"
              ariaLabel="Дата заказа"
              width="100%"
              style={{ border: "none", background: "transparent", boxShadow: "none", paddingLeft: 0, paddingRight: 44, borderRadius: 0 }}
            />
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
            style={css(
              inputStyle +
                ";height:auto;padding:9px 12px;resize:vertical;line-height:1.45",
            )}
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
          <div
            style={css(
              "display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px",
            )}
          >
            <span
              style={css("font-size:13.5px;font-weight:500;color:var(--text)")}
            >
              Принять оплату
            </span>
            <span style={css(NUM + ";font-size:12.5px;color:var(--text-3)")}>
              долг{" "}
              <b style={css("font-weight:500;color:var(--amber)")}>
                {som(it.debt)}
              </b>
            </span>
          </div>
          <div
            style={css(
              "display:flex;gap:8px;align-items:center;flex-wrap:wrap",
            )}
          >
            <div style={css("flex:1;min-width:170px")}>
              <MoneyInput
                value={amount}
                onChange={setAmount}
                onEnter={pay}
                autoFocus
              />
            </div>
            <Select
              value={method}
              onChange={setMethod}
              width={150}
              ariaLabel="Способ оплаты"
              options={METHOD_OPTIONS}
            />
            <HButton
              onClick={pay}
              disabled={busy}
              s={btnPrimary}
              hover="background:var(--accent-hover)"
            >
              {busy ? "Принимаю…" : "Принять"}
            </HButton>
          </div>
          {String(it.debt) !== amount && (
            <HButton
              onClick={() => setAmount(String(it.debt))}
              className="itm-chip"
              s=""
              hover=""
            >
              весь долг · {som(it.debt)}
            </HButton>
          )}
        </div>
      ) : (
        <div className="itm-paid">
          <span
            style={css(
              "width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:var(--green-tint);color:var(--green)",
            )}
          >
            <Svg paths={I_CHECK} size={15} sw={2.4} />
          </span>
          {it.sale > 0
            ? "Товар оплачен полностью"
            : "Сумма не указана — оплачивать нечего"}
        </div>
      )}
      <ModalError text={error} />
      {d.payments.length === 0 ? (
        <div
          style={css(
            "padding:18px 4px;font-size:12.5px;color:var(--text-4);text-align:center",
          )}
        >
          Оплат пока не было
        </div>
      ) : (
        <div className="itm-list">
          {d.payments.map((p) => (
            <div
              key={p.id}
              className={"itm-payrow" + (p.deleted_at ? " off" : "")}
            >
              <span style={css(NUM + ";font-size:12px;color:var(--text-3)")}>
                {dateTime(p.paid_at)}
              </span>
              <span
                style={css("min-width:0;font-size:12.5px;color:var(--text-2)")}
              >
                {METHOD_LABEL[p.method] ?? p.method}
                {p.comment ? ` · ${p.comment}` : ""}
                {p.user_login ? (
                  <span style={css("color:var(--text-4)")}>
                    {" "}
                    · {p.user_login}
                  </span>
                ) : null}
              </span>
              <span
                style={css(
                  NUM +
                    ";font-size:13.5px;font-weight:500;text-align:right;color:var(--text)",
                )}
              >
                {som(p.amount)}
              </span>
              <span style={css("text-align:right")}>
                {p.deleted_at ? (
                  <span style={css("font-size:11.5px;color:var(--text-4)")}>
                    отменена
                  </span>
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
      title: h.from_status
        ? `${STATUS_LABEL[h.from_status]} → ${STATUS_LABEL[h.to_status]}`
        : STATUS_LABEL[h.to_status],
      meta: [SOURCE_LABEL[h.source] ?? h.source, h.user_login, h.comment]
        .filter(Boolean)
        .join(" · "),
    })),
    ...d.scans.map((s, i) => ({
      at: s.scanned_at,
      key: `s${s.id}`,
      dot: "var(--violet-dot)",
      title: `Сканирование №${i + 1}: ${SCAN_LABEL[s.result]}`,
      meta: [s.user_login].filter(Boolean).join(" · "),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (events.length === 0)
    return (
      <div
        style={css(
          "padding:18px 4px;font-size:12.5px;color:var(--text-4);text-align:center",
        )}
      >
        Событий пока нет
      </div>
    );
  return (
    <div className="itm-list" style={css("padding:6px 0")}>
      {events.map((e, i) => (
        <div key={e.key} className="itm-ev">
          <span className="itm-ev-node">
            <span
              style={mix(
                "width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 3px var(--surface)",
                { background: e.dot },
              )}
            />
            {i < events.length - 1 && <span className="itm-ev-line" />}
          </span>
          <span style={css("min-width:0;padding-bottom:12px")}>
            <span style={css("display:block;font-size:13px;color:var(--text)")}>
              {e.title}
            </span>
            {e.meta && (
              <span
                style={css(
                  "display:block;margin-top:1px;font-size:12px;color:var(--text-3)",
                )}
              >
                {e.meta}
              </span>
            )}
          </span>
          <span
            style={css(
              NUM + ";font-size:12px;color:var(--text-4);white-space:nowrap",
            )}
          >
            {dateTime(e.at)}
          </span>
        </div>
      ))}
    </div>
  );
}
