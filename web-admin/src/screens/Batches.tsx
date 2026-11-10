/**
 * Партии: прибыль по каждой партии товара.
 *
 *   ① Выкуп веса   — сколько отдали за вес ($ или сом)      расход
 *   ② Доставка     — сколько отдали водителю ($ или сом)   расход
 *   ③ Вес клиентам — из «Уведомлений» (сам) + вручную         доход
 *   ④ Наценка      — Σ (Сумма − Реальная цена) по товарам   доход
 *   Прибыль партии = ③ + ④ − ① − ②  (в сомах, $ — по курсу)
 *
 * Раскладка: заголовок с «Новой партией», лента партий «билетами» (прокрутка вбок),
 * ниже выбранная партия: шапка, расчёт прибыли формулой в одну строку, товары по клиентам.
 * Товары попадают в партию при приёме сканером (выбрать партию на «Приёме товара»)
 * или добавляются здесь из принятых без партии.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiError } from "../api/client";
import {
  addToBatch,
  batchCandidates,
  createBatch,
  deleteBatch,
  getBatch,
  listBatches,
  removeFromBatch,
  updateBatch,
  type Batch,
  type BatchCalc,
  type BatchPatch,
  type Item,
} from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { Confirm } from "../components/cargo";
import DatePicker from "../components/DatePicker";
import ItemModal from "../components/ItemModal";
import SlideTabs from "../components/SlideTabs";
import CountUp from "../design/CountUp";
import { I_CHECK, I_MINUS, I_PLUS, Icon, Svg } from "../design/icons";
import { Page } from "../design/table";
import { ModalCancel, ModalError, ModalShell } from "../design/ui";
import { num, profitOf, shortDateTime, som, todayIso } from "../lib/cargo";
import { emit, useRefresh } from "../lib/events";
import { HomeHead } from "./overview/Home";

type Toast = (kind: "success" | "error", text: string) => void;
type BatchRow = Batch & { calc: BatchCalc };

export default function Batches({ toast }: { isDesktop: boolean; toast: Toast }) {
  const nav = useNavigate();
  const { id } = useParams();
  const [list, setList] = useState<BatchRow[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listBatches()
      .then((r) => {
        setList(r);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить партии")));
  }, []);
  useEffect(load, [load]);
  useRefresh(load);

  const selected = Number(id) || list?.[0]?.id || null;

  async function create() {
    try {
      const b = await createBatch();
      toast("success", `Создана «${b.name}»`);
      load();
      nav(`/batches/${b.id}`);
    } catch (e) {
      toast("error", apiError(e));
    }
  }

  return (
    <Page size="wide">
      <div className="ov bx">
        <div className="wx-head">
          <HomeHead title="Партии" />
          <div className="wx-head-r">
            <button type="button" className="od-new" onClick={create}>
              <Svg paths={I_PLUS} size={15} sw={2.2} />
              Новая партия
            </button>
          </div>
        </div>
        {error && <ModalError text={error} />}
        <TicketStrip list={list} selected={selected} onPick={(bid) => nav(`/batches/${bid}`)} />
        {selected ? (
          <BatchDetail
            key={selected}
            id={selected}
            toast={toast}
            onChanged={load}
            onDeleted={() => {
              load();
              nav("/batches");
            }}
          />
        ) : (
          list &&
          list.length === 0 && (
            <div className="ov-card paper bx-empty">
              <span className="bx-empty-i">
                <Icon name="batches" size={20} />
              </span>
              <b>Партий пока нет</b>
              <small>Создайте партию и выберите её на «Приёме товара» — сканированные товары попадут в неё</small>
            </div>
          )
        )}
      </div>
    </Page>
  );
}

// --- Лента партий -------------------------------------------------------------------------------

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const dayWords = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

function TicketStrip({ list, selected, onPick }: { list: BatchRow[] | null; selected: number | null; onPick: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Выбранный билет — всегда в поле зрения.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(".bx-tk.on");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, list]);
  return (
    <div ref={ref} className="bx-strip thin-scroll">
      {!list
        ? [0, 1, 2, 3].map((i) => <div key={i} className="bx-tk ghost" />)
        : list.map((b, i) => {
            const on = b.id === selected;
            const open = b.status === "open";
            const p = b.calc.profit_som;
            return (
              <button key={b.id} type="button" onClick={() => onPick(b.id)} className={"bx-tk" + (on ? " on" : "")} aria-pressed={on} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                <span className="bx-tk-top">
                  <i className={"od-dot " + (open ? "ok" : "")} />
                  {open ? "принимает" : "закрыта"}
                  <em>{dayWords(b.created_at)}</em>
                </span>
                <b className="bx-tk-name" title={b.name}>
                  {b.name}
                </b>
                <span className="bx-tk-cut" />
                <span className="bx-tk-bot">
                  <small>
                    {b.calc.items} {plural(b.calc.items, "товар", "товара", "товаров")}
                  </small>
                  <strong className={p < 0 ? "neg" : p > 0 ? "" : "zero"}>
                    <CountUp text={`${p > 0 ? "+" : ""}${som(p)}`} />
                  </strong>
                </span>
              </button>
            );
          })}
    </div>
  );
}

// --- Партия ---------------------------------------------------------------------------------------

type Draft = Record<"name" | "buy_amount" | "delivery_usd" | "client_amount" | "usd_rate", string>;
type NumField = Exclude<keyof Draft, "name">;
type CurField = "buy_cur" | "delivery_cur" | "client_cur";

const toDraft = (b: Batch): Draft => ({
  name: b.name,
  buy_amount: String(b.buy_amount || ""),
  delivery_usd: String(b.delivery_usd || ""),
  client_amount: String(b.client_amount || ""),
  usd_rate: String(b.usd_rate),
});

const numOf = (s: string) => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

function BatchDetail({ id, toast, onChanged, onDeleted }: { id: number; toast: Toast; onChanged: () => void; onDeleted: () => void }) {
  const { user } = useAuth();
  const [batch, setBatch] = useState<Batch | null>(null);
  // Расчёт сервера — нужен вес клиентам из «Уведомлений» (его считает сервер).
  const [calcSrv, setCalcSrv] = useState<BatchCalc | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  // «+ вручную» у веса клиентам — маленькое окошко под суммой из «Уведомлений».
  const [manualOpen, setManualOpen] = useState(false);
  const manualRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!manualOpen) return;
    const onDown = (e: MouseEvent) => manualRef.current && !manualRef.current.contains(e.target as Node) && setManualOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setManualOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [manualOpen]);

  const load = useCallback(() => {
    getBatch(id)
      .then((r) => {
        setBatch(r.batch);
        setCalcSrv(r.calc);
        setItems(r.items);
        setDraft((d) => d ?? toDraft(r.batch));
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить партию")));
  }, [id]);
  useEffect(load, [load]);
  useRefresh(load);

  // Живой расчёт по черновику полей — итог меняется сразу при вводе. Всё в сомах.
  const live = useMemo(() => {
    if (!draft || !batch) return null;
    const rate = numOf(draft.usd_rate);
    const toSom = (n: number, cur: Batch["buy_cur"]) => (cur === "usd" ? n * rate : n);
    const buy = toSom(numOf(draft.buy_amount), batch.buy_cur);
    const delivery = toSom(numOf(draft.delivery_usd), batch.delivery_cur);
    // Вес клиентам = из «Уведомлений» (сам) + вписанное вручную.
    const auto = calcSrv?.client_auto_som ?? 0;
    const manual = toSom(numOf(draft.client_amount), batch.client_cur);
    const client = auto + manual;
    const withCost = items.filter((i) => i.cost !== null);
    const markup = withCost.reduce((s, i) => s + i.sale - (i.cost ?? 0), 0);
    return {
      rate,
      buy,
      delivery,
      auto,
      manual,
      client,
      markup,
      income: client + markup,
      expenses: buy + delivery,
      profit: client + markup - buy - delivery,
      withCost: withCost.length,
      sale: items.reduce((s, i) => s + i.sale, 0),
      goodsCost: withCost.reduce((s, i) => s + (i.cost ?? 0), 0),
      customers: new Set(items.map((i) => i.customer_id)).size,
      inStock: items.filter((i) => i.status === "in_stock").length,
      issued: items.filter((i) => i.status === "issued").length,
    };
  }, [draft, batch, calcSrv, items]);

  // Товары по клиентам — в порядке первого появления.
  const groups = useMemo(() => {
    const m = new Map<number, Item[]>();
    for (const it of items) {
      const g = m.get(it.customer_id);
      if (g) g.push(it);
      else m.set(it.customer_id, [it]);
    }
    return [...m.values()];
  }, [items]);

  async function patch(body: BatchPatch) {
    if (!batch) return;
    try {
      const r = await updateBatch(batch.id, body);
      setBatch(r.batch);
      setCalcSrv(r.calc);
      onChanged();
    } catch (e) {
      toast("error", apiError(e));
    }
  }

  function save(field: keyof Draft) {
    if (!draft || !batch) return;
    if (field === "name") {
      const name = draft.name.trim();
      if (name && name !== batch.name) void patch({ name });
      return;
    }
    const value = numOf(draft[field]);
    if (value !== batch[field]) void patch({ [field]: value } as BatchPatch);
  }

  async function setStatus(status: "open" | "closed") {
    await patch({ status });
    toast("success", status === "open" ? "Партия снова принимает товары" : "Партия закрыта");
  }

  const toggle = (ids: number[], on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      for (const i of ids) {
        if (on) n.add(i);
        else n.delete(i);
      }
      return n;
    });

  async function removeSelected() {
    if (!batch || !selected.size) return;
    try {
      await removeFromBatch(batch.id, [...selected]);
      toast("success", `Убрано из партии: ${selected.size}`);
      setSelected(new Set());
      load();
      onChanged();
    } catch (e) {
      toast("error", apiError(e));
    }
  }

  if (error && !batch) return <ModalError text={error} />;
  if (!batch || !draft || !live) return <DetailGhost />;

  /** Сумма в поле: сохраняется при уходе из поля или Enter; справа — переключатель $ / с. */
  const field = (k: NumField, label: string, cur?: CurField, placeholder = "0") => {
    const usd = cur ? batch[cur] === "usd" : false;
    return (
      <div className="bx-field">
        {usd && <span className="bx-field-pre">$</span>}
        <input
          value={draft[k]}
          inputMode="decimal"
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
          onBlur={() => save(k)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {cur ? (
          <span className="bx-cur">
            {(["usd", "som"] as const).map((c) => (
              <button key={c} type="button" className={batch[cur] === c ? "on" : ""} title={c === "usd" ? "в долларах" : "в сомах"} onClick={() => batch[cur] !== c && patch({ [cur]: c } as BatchPatch)}>
                {c === "usd" ? "$" : "с"}
              </button>
            ))}
          </span>
        ) : (
          <span className="bx-field-post">с</span>
        )}
      </div>
    );
  };

  const needRate = batch.buy_cur === "usd" || batch.delivery_cur === "usd" || batch.client_cur === "usd";
  const rateNote = (cur: CurField, value: number) => (batch[cur] === "usd" && value > 0 ? `по курсу ${num(live.rate)}` : "");
  // Под весом клиентам: сколько кг из «Уведомлений» и сколько ещё ждёт выдачи.
  const weightNote = !calcSrv
    ? ""
    : live.auto > 0
      ? `${num(calcSrv.client_auto_kg)} кг · ${calcSrv.client_auto_pending_som > 0 ? `ждёт выдачи ${som(calcSrv.client_auto_pending_som)}` : "всё взято"}`
      : "из «Уведомлений» пока нет";
  const neg = live.profit < 0;
  const barMax = Math.max(live.income, live.expenses, 1);
  const allOn = items.length > 0 && items.every((i) => selected.has(i.id));

  return (
    <div className="bx-detail">
      {/* Шапка партии */}
      <section className="ov-card paper bx-head">
        <span className="bx-head-i">
          <Icon name="batches" size={22} />
        </span>
        <div className="bx-head-t">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onBlur={() => save("name")}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="bx-name"
            title="Нажмите, чтобы переименовать"
            aria-label="Название партии"
          />
          <span className="bx-meta">
            <span>создана {shortDateTime(batch.created_at)}</span>
            <span>
              <b>{items.length}</b> {plural(items.length, "товар", "товара", "товаров")} · <b>{live.customers}</b> {plural(live.customers, "клиент", "клиента", "клиентов")}
            </span>
            {items.length > 0 && (
              <>
                <span>
                  <i className="od-dot ok" />
                  на складе <b>{live.inStock}</b>
                </span>
                <span>
                  <i className="od-dot ink" />
                  выдано <b>{live.issued}</b>
                </span>
              </>
            )}
          </span>
        </div>
        <SlideTabs<"open" | "closed">
          value={batch.status}
          onChange={(s) => s !== batch.status && setStatus(s)}
          options={[
            ["open", "Принимает товары"],
            ["closed", "Закрыта"],
          ]}
        />
        {user?.role === "admin" && items.length === 0 && (
          <button type="button" className="bx-del" onClick={() => setConfirmDelete(true)}>
            Удалить
          </button>
        )}
      </section>

      {/* Формула прибыли */}
      <section className="ov-card paper bx-calc">
        <div className="bx-calc-h">
          <b>Расчёт прибыли</b>
          <small>доходы минус расходы — впишите суммы, итог считается сразу</small>
          {needRate && (
            <span className="bx-rate" data-no-reveal>
              курс <em>$1 =</em>
              <span className="bx-rate-f">{field("usd_rate", "Курс доллара")}</span>
            </span>
          )}
        </div>
        <div className="bx-f2">
          <Term icon={IC.weight} sign="+" title="Вес клиентам" hint="из «Уведомлений» + вручную" value={live.client} note={weightNote}>
            <div ref={manualRef} className="bx-wrap">
              <div className={"bx-wfield" + (live.auto > 0 ? " on" : "")} title="Сумма за вес из «Уведомлений» по товарам этой партии — считается сама">
                <span className="bx-wval">{calcSrv ? som(live.auto) : "…"}</span>
                <button
                  type="button"
                  onClick={() => setManualOpen((o) => !o)}
                  className={"bx-manual" + (live.manual > 0 ? " set" : "") + (live.manual > 0 && live.auto > 0 ? " warn" : "") + (manualOpen ? " open" : "")}
                  title={
                    live.manual > 0
                      ? `Вписано вручную: ${som(Math.round(live.manual))}${live.auto > 0 ? " — есть и вес из «Уведомлений», проверьте, не задвоено ли" : ""}`
                      : "Добавить вес вручную — то, чего нет в «Уведомлениях»"
                  }
                >
                  {live.manual > 0 ? (
                    <>
                      <Svg paths={[["path", { d: "M12 20h9" }], ["path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" }]]} size={12} sw={2.2} />
                      {Math.round(live.manual).toLocaleString("ru-RU")}
                    </>
                  ) : (
                    <>
                      <Svg paths={I_PLUS} size={11} sw={2.4} />
                      вручную
                    </>
                  )}
                </button>
              </div>
              {manualOpen && (
                <div className="bx-pop" data-no-reveal>
                  <b>Вес клиентам вручную</b>
                  <small>Только то, чего нет в «Уведомлениях» — например, вес, взятый до них. Иначе задвоится.</small>
                  <span className="bx-pop-r">
                    {field("client_amount", "Вес клиентам вручную", "client_cur")}
                    <button type="button" className="bx-btn" onClick={() => setManualOpen(false)}>
                      Готово
                    </button>
                  </span>
                  {live.manual > 0 && (
                    <button
                      type="button"
                      className="bx-pop-x"
                      onClick={() => {
                        setDraft({ ...draft, client_amount: "" });
                        void patch({ client_amount: 0 });
                        setManualOpen(false);
                      }}
                    >
                      Убрать вписанное вручную
                    </button>
                  )}
                </div>
              )}
            </div>
          </Term>
          <Term
            icon={IC.tag}
            op="+"
            sign={live.markup < 0 ? "−" : "+"}
            title="Наценка на товары"
            hint="сумма − реальная цена"
            value={live.markup}
            note={live.withCost < items.length ? `выкуп указан у ${live.withCost} из ${items.length}` : `${items.length} ${plural(items.length, "товар", "товара", "товаров")}`}
          >
            <div className="bx-calcline">
              <b>{som(live.sale)}</b>
              <em>−</em>
              <b>{som(live.goodsCost)}</b>
            </div>
          </Term>
          <Term icon={IC.cash} op="−" sign="−" title="Выкуп веса" hint="отдали за вес" value={live.buy} note={rateNote("buy_cur", live.buy)}>
            {field("buy_amount", "Выкуп веса", "buy_cur")}
          </Term>
          <Term icon={IC.truck} op="−" sign="−" title="Доставка" hint="отдали водителю" value={live.delivery} note={rateNote("delivery_cur", live.delivery)}>
            {field("delivery_usd", "Доставка", "delivery_cur")}
          </Term>
          <div className={"bx-result bx-r2" + (neg ? " neg" : "")}>
            <span className="bx-opb">
              <Svg paths={[["path", { d: "M5 9h14" }], ["path", { d: "M5 15h14" }]]} size={11} sw={2.6} />
            </span>
            <small>{neg ? "Убыток партии" : "Прибыль партии"}</small>
            <b>
              <CountUp text={`${live.profit > 0 ? "+" : ""}${som(Math.round(live.profit))}`} />
            </b>
            <em>{live.sale > 0 ? `${Math.round((live.profit / live.sale) * 100)}% от суммы товаров` : "доходы − расходы"}</em>
            <Mountain pts={[0, live.client, live.income, live.income - live.buy, live.profit]} />
            <div className="bx-rbars">
              <Bar label="Доходы" value={live.income} max={barMax} tone="p" />
              <Bar label="Расходы" value={live.expenses} max={barMax} tone="m" />
            </div>
          </div>
        </div>
      </section>

      {/* Товары партии */}
      <section className="ov-card paper bx-items">
        <div className="bx-items-h">
          {items.length > 0 && <Check on={allOn} half={selected.size > 0} onToggle={(on) => toggle(items.map((i) => i.id), on)} title="Выбрать все" />}
          <span className="bx-items-t">
            <b>Товары партии</b>
            <small>
              {items.length} {plural(items.length, "товар", "товара", "товаров")} · {live.customers} {plural(live.customers, "клиент", "клиента", "клиентов")} · на {som(live.sale)}
            </small>
          </span>
          {selected.size > 0 && (
            <button type="button" className="bx-btn ghost danger" onClick={removeSelected}>
              Убрать из партии ({selected.size})
            </button>
          )}
          <button type="button" className="bx-btn" onClick={() => setAdding(true)}>
            <Svg paths={I_PLUS} size={14} sw={2.4} />
            Добавить принятые
          </button>
        </div>
        {items.length === 0 ? (
          <div className="bx-none">
            <span className="bx-empty-i">
              <Icon name="receive" size={20} />
            </span>
            <b>В партии пока нет товаров</b>
            <small>Выберите эту партию на «Приёме товара» и сканируйте — товары попадут сюда. Или добавьте уже принятые кнопкой выше.</small>
          </div>
        ) : (
          <div className="bx-cards">
            {groups.map((g) => (
              <ClientBlock key={g[0].customer_id} items={g} weight={calcSrv?.client_weights[g[0].customer_id]} selected={selected} onToggle={toggle} onOpen={setOpen} />
            ))}
          </div>
        )}
      </section>

      {adding && (
        <AddItems
          batchId={batch.id}
          onClose={() => setAdding(false)}
          onAdded={(n) => {
            setAdding(false);
            toast("success", `Добавлено в партию: ${n}`);
            load();
            onChanged();
            emit("cargo:changed");
          }}
        />
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
      {confirmDelete && (
        <Confirm
          title="Удалить партию?"
          text={<>Партия «{batch.name}» пустая — её можно удалить.</>}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await deleteBatch(batch.id);
            toast("success", "Партия удалена");
            onDeleted();
          }}
        />
      )}
    </div>
  );
}

function DetailGhost() {
  return (
    <div className="bx-detail" aria-hidden>
      <section className="ov-card paper bx-head ghost">
        <span className="sk" style={{ width: 48, height: 48, borderRadius: 15 }} />
        <span style={{ flex: 1 }}>
          <span className="sk" style={{ width: "34%", height: 16 }} />
          <span className="sk" style={{ width: "52%", height: 10, marginTop: 10 }} />
        </span>
      </section>
      <section className="ov-card paper bx-calc ghost">
        <span className="sk" style={{ width: 160, height: 12 }} />
        <span className="bx-ghost-row">
          {[0, 1, 2, 3, 4].map((k) => (
            <span key={k} className="sk" style={{ flex: 1, height: 120, borderRadius: 16 }} />
          ))}
        </span>
      </section>
    </div>
  );
}

/** Слагаемое: знак и название, сумма справа; ниже поле (или расчёт) и пояснение. op — знак между карточками. */
type PathDef = [string, Record<string, unknown>][];
const IC: Record<"weight" | "tag" | "cash" | "truck", PathDef> = {
  weight: [["path", { d: "M12 3v18" }], ["path", { d: "M5 7h14" }], ["path", { d: "m5 7-3 7a4 4 0 0 0 6 0Z" }], ["path", { d: "m19 7-3 7a4 4 0 0 0 6 0Z" }], ["path", { d: "M8 21h8" }]],
  tag: [["path", { d: "M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z" }], ["circle", { cx: 7.5, cy: 7.5, r: 1.5 }]],
  cash: [["rect", { x: 2, y: 6, width: 20, height: 12, rx: 2 }], ["circle", { cx: 12, cy: 12, r: 2.2 }], ["path", { d: "M6 12h.01M18 12h.01" }]],
  truck: [["path", { d: "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" }], ["path", { d: "M15 18H9" }], ["path", { d: "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 9.38a1 1 0 0 0-.78-.38H14" }], ["circle", { cx: 17, cy: 18, r: 2 }], ["circle", { cx: 7, cy: 18, r: 2 }]],
};

function Term({ icon, op, sign, title, hint, value, note, children }: { icon: PathDef; op?: string; sign: "+" | "−"; title: string; hint: string; value: number; note?: string; children: ReactNode }) {
  const t = sign === "+" ? "p" : "m";
  return (
    <div className="bx-t2">
      {op && (
        <span className="bx-opb">
          <Svg paths={op === "+" ? I_PLUS : I_MINUS} size={11} sw={2.6} />
        </span>
      )}
      <div className="bx-t2-h">
        <span className={"bx-sign " + t}>
          <Svg paths={sign === "+" ? I_PLUS : I_MINUS} size={13} sw={2.6} />
        </span>
        <b title={hint}>{title}</b>
        <em className={value ? t : ""}>{value ? `${sign} ${som(Math.round(Math.abs(value)))}` : "—"}</em>
      </div>
      {children}
      <span className="bx-t2-n">
        <Svg paths={icon} size={13} sw={1.9} />
        {note || hint}
      </span>
    </div>
  );
}

/** Плавная линия через точки (Catmull-Rom → кривые Безье). */
const smooth = (p: [number, number][]) =>
  p.reduce((acc, [x, y], i, a) => {
    if (i === 0) return `M ${x} ${y}`;
    const [x0, y0] = a[i - 2] ?? a[i - 1];
    const [x1, y1] = a[i - 1];
    const [x3, y3] = a[i + 1] ?? [x, y];
    return `${acc} C ${x1 + (x - x0) / 6} ${y1 + (y - y0) / 6} ${x - (x3 - x1) / 6} ${y - (y3 - y1) / 6} ${x} ${y}`;
  }, "");

/**
 * «Гора» прибыли: путь от нуля — вверх на доходы (вес, наценка), вниз на расходы (выкуп, доставка),
 * в конце — прибыль. При открытии плавно вырастает, при вводе сумм — растёт или опускается на глазах.
 */
function Mountain({ pts }: { pts: number[] }) {
  const W = 132;
  const H = 70;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 150);
    return () => window.clearTimeout(t);
  }, []);
  const max = Math.max(1, ...pts.map((v) => Math.abs(v)));
  const xy = pts.map((v, k): [number, number] => [5 + (k / (pts.length - 1)) * (W - 10), ready ? H - 5 - (Math.max(0, v) / max) * (H - 14) : H - 5]);
  const line = smooth(xy);
  const area = `${line} L ${W - 5} ${H} L 5 ${H} Z`;
  const [ex, ey] = xy[xy.length - 1];
  return (
    <svg className="bx-mtn" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <defs>
        <linearGradient id="bxMtn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".38" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="a" fill="url(#bxMtn)" style={{ d: `path("${area}")` } as CSSProperties} />
      <path className="l" pathLength={1} style={{ d: `path("${line}")` } as CSSProperties} />
      <circle className="dot" r="4" style={{ cx: ex, cy: ey } as CSSProperties} />
    </svg>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: "p" | "m" }) {
  const w = value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="bx-bar">
      <span>{label}</span>
      <span className="bx-bar-t">
        <i className={"bar-grow " + tone} style={{ width: `${w}%` }} />
      </span>
      <b className={value ? tone : ""}>{som(Math.round(value))}</b>
    </div>
  );
}

// --- Товары партии по клиентам -------------------------------------------------------------------

const STAGE_TEXT: Record<string, string> = { ordered: "Заказан", in_transit: "В пути", in_stock: "На складе", issued: "Выдан" };
const STAGE_DOT: Record<string, string> = { ordered: "warn", in_transit: "info", in_stock: "ok", issued: "" };

/** Клиент партии — карточкой как в «Заказах»: слева листок с весом посылки, справа товары. */
function ClientBlock({
  items,
  weight,
  selected,
  onToggle,
  onOpen,
}: {
  items: Item[];
  /** Вес клиента по этой партии из «Уведомлений». */
  weight?: { som: number; kg: number };
  selected: Set<number>;
  onToggle: (ids: number[], on: boolean) => void;
  onOpen: (id: number) => void;
}) {
  const nav = useNavigate();
  const first = items[0];
  const sale = items.reduce((s, i) => s + i.sale, 0);
  const debt = items.reduce((s, i) => s + i.debt, 0);
  const qty = items.reduce((s, i) => s + i.qty, 0);
  const withCost = items.filter((i) => i.cost !== null);
  const markup = withCost.reduce((s, i) => s + i.sale - (i.cost ?? 0), 0);
  const allOn = items.every((i) => selected.has(i.id));
  const someOn = items.some((i) => selected.has(i.id));
  const ps = sale <= 0 ? "w" : debt <= 0 ? "ok" : debt < sale ? "part" : "no";
  const stages = [...items.reduce((m, i) => m.set(i.stage ?? i.status, (m.get(i.stage ?? i.status) ?? 0) + 1), new Map<string, number>())];
  const hasW = !!weight && weight.som > 0;
  return (
    <article className={"od-card bx-card" + (someOn ? " sel" : "")}>
      {/* Листок с весом посылки клиента по этой партии */}
      <div className={"od-date bx-w" + (hasW ? "" : " none")} title="Вес посылки из «Уведомлений» по товарам этой партии">
        <div className="od-date-in">
          <small>вес</small>
          <b>{hasW ? num(weight.kg) : "—"}</b>
          <em>{hasW ? "кг" : "нет"}</em>
          {hasW && <i>{som(weight.som)}</i>}
        </div>
      </div>
      <div className="od-main">
        <header className="od-head">
          <Check on={allOn} half={someOn} onToggle={(on) => onToggle(items.map((i) => i.id), on)} title="Выбрать все товары клиента" />
          <button type="button" className="od-who" onClick={() => nav(`/customers/${first.customer_id}`)} title="Открыть клиента">
            <span className="rx-av">{letters(first.customer_name)}</span>
            <span>
              <b>{first.customer_name}</b>
              <small>{first.customer_phone}</small>
            </span>
          </button>
          <span className="od-stages">
            {stages.map(([k, n]) => (
              <span key={k} className={"rx-pill-st " + (STAGE_DOT[k] ?? "")}>
                {(STAGE_TEXT[k] ?? k).toLowerCase()} {n}
              </span>
            ))}
          </span>
          <span className={"od-sum " + ps}>
            <small>
              {ps === "ok" && <Svg paths={I_CHECK} size={12} sw={3} />}
              {ps === "w" ? "По весу" : ps === "ok" ? "Оплачено" : ps === "no" ? "Не оплачено" : `Долг ${som(debt)}`}
            </small>
            <b>{sale > 0 ? som(sale) : "—"}</b>
          </span>
        </header>
        <div className="od-items">
          <div className="od-cols" aria-hidden>
            <span />
            <span>Товар</span>
            <span>Кол-во</span>
            <span>Сумма</span>
            <span>Наценка</span>
            <span>Оплата</span>
            <span>Статус</span>
          </div>
          {items.map((it) => {
            const p = profitOf(it);
            const on = selected.has(it.id);
            const st = it.stage ?? it.status;
            const pay: [string, string] = it.sale <= 0 ? ["", "По весу"] : it.debt <= 0 ? ["ok", "Оплачено"] : it.debt < it.sale ? ["warn", "Частично"] : ["bad", "Не оплачено"];
            return (
              <div key={it.id} onClick={() => onOpen(it.id)} className={"od-row" + (on ? " on" : "")} title="Открыть карточку товара">
                <Check on={on} onToggle={(v) => onToggle([it.id], v)} />
                <span className="od-row-n">
                  <b>{it.name}</b>
                  <small>{it.code ? it.code : <em>без кода</em>}</small>
                </span>
                <span className="od-row-q">{it.qty} шт</span>
                <span className="od-row-s">
                  <b>{it.sale > 0 ? som(it.sale) : "—"}</b>
                </span>
                <span className="od-row-p">{p === null ? <small>—</small> : <b className={p < 0 ? "neg" : "pos"}>{`${p > 0 ? "+" : ""}${som(p)}`}</b>}</span>
                <span className="od-row-pay">
                  <span className={"od-pay " + pay[0]}>{pay[1]}</span>
                </span>
                <span className="od-row-st">
                  <span className={"rx-pill-st " + (STAGE_DOT[st] ?? "")}>{STAGE_TEXT[st] ?? st}</span>
                </span>
              </div>
            );
          })}
        </div>
        <footer className="od-foot-l">
          <span>
            <small>Товаров</small>
            <b>
              {items.length}
              {qty !== items.length ? ` · ${qty} шт` : ""}
            </b>
          </span>
          <span>
            <small>Наценка</small>
            <b className={withCost.length && markup < 0 ? "neg" : ""}>{withCost.length ? `${markup > 0 ? "+" : ""}${som(markup)}` : "нет выкупа"}</b>
          </span>
        </footer>
      </div>
    </article>
  );
}

// --- Добавить принятые без партии --------------------------------------------------------------

function dayIso(d: string, add = 0) {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + add);
  return x.toISOString();
}

function AddItems({ batchId, onClose, onAdded }: { batchId: number; onClose: () => void; onAdded: (n: number) => void }) {
  const [day, setDay] = useState(todayIso());
  const [allDays, setAllDays] = useState(false);
  const [rows, setRows] = useState<Item[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    setRows(null);
    batchCandidates(allDays ? {} : { since: dayIso(day), until: dayIso(day, 1) })
      .then((r) => {
        setRows(r);
        setPicked(new Set(r.map((i) => i.id)));
      })
      .catch((e) => setError(apiError(e)));
  }, [day, allDays]);

  async function add() {
    setError("");
    try {
      await addToBatch(batchId, [...picked]);
      onAdded(picked.size);
    } catch (e) {
      setError(apiError(e));
    }
  }

  const pick = (ids: number[], on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      for (const i of ids) {
        if (on) n.add(i);
        else n.delete(i);
      }
      return n;
    });

  return (
    <ModalShell
      title="Добавить принятые товары"
      subtitle={picked.size && rows ? `выбрано ${picked.size} на ${som(rows.filter((i) => picked.has(i.id)).reduce((s, i) => s + i.sale, 0))}` : "Отметьте товары со склада, которых ещё нет в партиях"}
      icon={<Icon name="batches" size={18} />}
      tone="violet"
      onClose={onClose}
      width={640}
      footer={
        <>
          <ModalCancel>Отмена</ModalCancel>
          <span className="ov" style={{ display: "contents" }}>
            <button type="button" className="bx-btn" disabled={!picked.size} onClick={add}>
              Добавить ({picked.size})
            </button>
          </span>
        </>
      }
    >
      <div className="ov bx-add">
        <div className="bx-add-h">
          <span>Принятые без партии за</span>
          <DatePicker value={day} disabled={allDays} onChange={setDay} height={32} fontSize={12.5} ariaLabel="День приёма" />
          <span className="bx-add-all" onClick={() => setAllDays((v) => !v)}>
            <Check on={allDays} onToggle={setAllDays} /> за все дни
          </span>
        </div>
        <ModalError text={error} />
        {!rows ? (
          <div className="bx-add-list">
            {[0, 1, 2].map((k) => (
              <div key={k} className="bx-add-row">
                <span className="sk" style={{ width: 18, height: 18, borderRadius: 6 }} />
                <span className="sk" style={{ width: `${[60, 44, 52][k]}%`, height: 10 }} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="bx-none small">
            <span className="bx-empty-i">
              <Icon name="batches" size={18} />
            </span>
            <b>{allDays ? "Все принятые товары уже в партиях" : "За этот день нечего добавлять"}</b>
            <small>{allDays ? "Новые появятся после приёма на складе" : "Все товары, принятые в этот день, уже распределены по партиям"}</small>
            {!allDays && (
              <button type="button" className="bx-btn ghost" onClick={() => setAllDays(true)}>
                Показать за все дни
              </button>
            )}
          </div>
        ) : (
          <div className="bx-add-list thin-scroll">
            <div className="bx-add-row head">
              <Check on={picked.size === rows.length} half={picked.size > 0} onToggle={(on) => pick(rows.map((i) => i.id), on)} />
              Выбрать все ({rows.length})
            </div>
            {rows.map((i) => (
              <div key={i.id} onClick={() => pick([i.id], !picked.has(i.id))} className={"bx-add-row" + (picked.has(i.id) ? " on" : "")}>
                <Check on={picked.has(i.id)} onToggle={(on) => pick([i.id], on)} />
                <span className="wx-li">
                  <b>{i.name}</b>
                  <small>
                    {i.customer_name} · {i.code || "без кода"}
                  </small>
                </span>
                <span className="bx-add-d">{shortDateTime(i.arrived_at)}</span>
                <b className="bx-add-s">{som(i.sale)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// --- Мелочи --------------------------------------------------------------------------------------

/** Галочка выбора; half — выбрана часть. Клик не открывает карточку товара. */
function Check({ on, half, onToggle, title }: { on: boolean; half?: boolean; onToggle: (on: boolean) => void; title?: string }) {
  return (
    <span
      role="checkbox"
      aria-checked={on ? true : half ? "mixed" : false}
      tabIndex={0}
      title={title}
      className={"od-check" + (on || half ? " on" : "")}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!on);
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          onToggle(!on);
        }
      }}
    >
      {on ? <Svg paths={I_CHECK} size={12} sw={3} /> : half ? <Svg paths={I_MINUS} size={12} sw={3} /> : null}
    </span>
  );
}

const letters = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
