/**
 * Партии: прибыль по каждой партии товара.
 *
 *   ① Выкуп веса   — сколько отдали за вес ($ или сом)      расход
 *   ② Доставка     — сколько отдали водителю ($ или сом)   расход
 *   ③ Вес клиентам — общая сумма за вес ($ или сом)          доход
 *   ④ Наценка      — Σ (Сумма − Реальная цена) по товарам   доход
 *   Прибыль партии = ③ + ④ − ① − ②  (в сомах, $ — по курсу)
 *
 * Раскладка: сверху лента партий «билетами» (прокрутка вбок, первая — «Новая партия»),
 * ниже выбранная партия: шапка, расчёт прибыли формулой в одну строку, товары по клиентам.
 * Товары попадают в партию при приёме сканером (выбрать партию на «Приёме товара»)
 * или добавляются здесь из принятых без партии.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { Confirm, Empty, Tabs } from "../components/cargo";
import DatePicker from "../components/DatePicker";
import ItemModal from "../components/ItemModal";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_CHECK, I_MINUS, I_PLUS, Icon, Svg } from "../design/icons";
import { Page } from "../design/table";
import { HButton, ModalError, ModalCancel, ModalShell, ST, SkeletonRows, btnGhost, btnPrimary } from "../design/ui";
import { num, profitOf, shortDateTime, som, todayIso } from "../lib/cargo";
import { emit, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
type BatchRow = Batch & { calc: BatchCalc };

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const CODE = MONO + ";letter-spacing:.02em";
const CARD = "background:var(--surface);border:1px solid var(--border);border-radius:18px";

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
      {error && <ModalError text={error} />}
      <TicketStrip list={list} selected={selected} onPick={(bid) => nav(`/batches/${bid}`)} onCreate={create} />
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
          <div style={css(CARD)}>
            <Empty icon="batches" title="Партий пока нет" text="Создайте партию и выберите её на «Приёме товара» — сканированные товары попадут в неё" />
          </div>
        )
      )}
    </Page>
  );
}

// --- Лента партий -------------------------------------------------------------------------------

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const dayWords = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

function TicketStrip({ list, selected, onPick, onCreate }: { list: BatchRow[] | null; selected: number | null; onPick: (id: number) => void; onCreate: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Выбранный билет — всегда в поле зрения.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(".bt-ticket.on");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, list]);
  return (
    <div ref={ref} className="bt-strip thin-scroll">
      <HButton onClick={onCreate} className="bt-new" s="" hover="">
        <span style={css("width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#6A8BFF,#3E63DD);box-shadow:0 8px 16px -8px rgba(62,99,221,.7)")}>
          <Svg paths={I_PLUS} size={17} sw={2.4} />
        </span>
        <span style={css("font-size:13px;font-weight:500;color:var(--text)")}>Новая партия</span>
        <span style={css("font-size:11.5px;color:var(--text-4);text-align:center;line-height:1.35")}>от сегодняшней даты</span>
      </HButton>
      {!list
        ? [0, 1, 2].map((i) => <div key={i} className="bt-ticket" style={css("opacity:.5")} />)
        : list.map((b) => {
            const on = b.id === selected;
            const open = b.status === "open";
            const p = b.calc.profit_som;
            return (
              <HButton key={b.id} onClick={() => onPick(b.id)} className={"bt-ticket" + (on ? " on" : "")} s="" hover="" aria-pressed={on}>
                <span style={css("display:flex;align-items:center;gap:7px;min-width:0")}>
                  <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: open ? "var(--green-dot)" : "var(--text-5)" })} />
                  <span style={css("font-size:11.5px;color:var(--text-4);white-space:nowrap")}>{open ? "принимает" : "закрыта"}</span>
                  <span style={css("margin-left:auto;font-size:11.5px;color:var(--text-4);white-space:nowrap")}>{dayWords(b.created_at)}</span>
                </span>
                <span style={css("display:block;margin-top:6px;font-size:13.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")} title={b.name}>
                  {b.name}
                </span>
                <span className="bt-cut" />
                <span style={css("display:flex;align-items:baseline;justify-content:space-between;gap:8px")}>
                  <span style={css(NUM + ";font-size:12px;color:var(--text-3);white-space:nowrap")}>
                    {b.calc.items} {plural(b.calc.items, "товар", "товара", "товаров")}
                  </span>
                  <span style={mix(NUM + ";font-size:17px;font-weight:500;white-space:nowrap", { color: p < 0 ? "var(--danger)" : p > 0 ? "var(--green)" : "var(--text-4)" })}>
                    <CountUp text={`${p > 0 ? "+" : ""}${som(p)}`} />
                  </span>
                </span>
              </HButton>
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
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    getBatch(id)
      .then((r) => {
        setBatch(r.batch);
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
    const client = toSom(numOf(draft.client_amount), batch.client_cur);
    const withCost = items.filter((i) => i.cost !== null);
    const markup = withCost.reduce((s, i) => s + i.sale - (i.cost ?? 0), 0);
    return {
      rate,
      buy,
      delivery,
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
  }, [draft, batch, items]);

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
  if (!batch || !draft || !live) {
    return (
      <div style={css(CARD + ";padding:18px")}>
        <SkeletonRows rows={5} />
      </div>
    );
  }

  /** Сумма в поле: сохраняется при уходе из поля или Enter; справа — переключатель $ / с. */
  const field = (k: NumField, label: string, cur?: CurField) => {
    const usd = cur ? batch[cur] === "usd" : false;
    return (
      <div className="bt-field">
        {usd && <span style={css("display:flex;align-items:center;padding-left:11px;color:var(--text-4);font-size:14px")}>$</span>}
        <input
          value={draft[k]}
          inputMode="decimal"
          placeholder="0"
          aria-label={label}
          onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
          onBlur={() => save(k)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          style={mix(NUM + ";flex:1;min-width:0;border:none;outline:none;background:transparent;font-size:16px;font-weight:500;color:var(--text);box-shadow:none", {
            padding: usd ? "0 8px 0 5px" : "0 8px 0 12px",
          })}
        />
        {cur ? (
          <span style={css("display:flex;gap:2px;padding:3px;background:var(--surface-2);border-left:1px solid var(--border-2)")}>
            {(["usd", "som"] as const).map((c) => {
              const on = batch[cur] === c;
              return (
                <button
                  key={c}
                  type="button"
                  title={c === "usd" ? "в долларах" : "в сомах"}
                  onClick={() => !on && patch({ [cur]: c } as BatchPatch)}
                  style={mix("width:28px;border:none;border-radius:7px;font-size:12.5px;font-weight:500;cursor:pointer", {
                    background: on ? "var(--surface)" : "transparent",
                    color: on ? "var(--text)" : "var(--text-4)",
                    boxShadow: on ? "0 1px 2px rgba(0,0,0,.1)" : "none",
                  })}
                >
                  {c === "usd" ? "$" : "с"}
                </button>
              );
            })}
          </span>
        ) : (
          <span style={css("display:flex;align-items:center;padding-right:11px;color:var(--text-4);font-size:12.5px")}>с</span>
        )}
      </div>
    );
  };

  const needRate = batch.buy_cur === "usd" || batch.delivery_cur === "usd" || batch.client_cur === "usd";
  const rateNote = (cur: CurField, value: number) => (batch[cur] === "usd" && value > 0 ? `по курсу ${num(live.rate)}` : "");
  const neg = live.profit < 0;
  const barMax = Math.max(live.income, live.expenses, 1);
  const allOn = items.length > 0 && items.every((i) => selected.has(i.id));

  return (
    <div style={css("display:flex;flex-direction:column;gap:16px;min-width:0")}>
      {/* Шапка накладной */}
      <section className="bt-head">
        <span className="bt-head-icon" style={css("width:46px;height:46px;border-radius:14px;flex:none;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#A78BFA,#6A8BFF);box-shadow:0 10px 22px -10px rgba(124,58,237,.7)")}>
          <Icon name="batches" size={22} />
        </span>
        <div style={css("flex:1 1 280px;min-width:0")}>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onBlur={() => save("name")}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="bt-name"
            title="Нажмите, чтобы переименовать"
            aria-label="Название партии"
          />
          <div style={css(NUM + ";display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:3px;font-size:12.5px;color:var(--text-3)")}>
            <span>создана {shortDateTime(batch.created_at)}</span>
            <span>
              {items.length} {plural(items.length, "товар", "товара", "товаров")} · {live.customers} {plural(live.customers, "клиент", "клиента", "клиентов")}
            </span>
            {items.length > 0 && (
              <span style={css("display:inline-flex;gap:12px")}>
                <span style={css("display:inline-flex;align-items:center;gap:5px")}>
                  <span style={mix("width:6px;height:6px;border-radius:50%", { background: ST.in_stock.dot })} />
                  на складе {live.inStock}
                </span>
                <span style={css("display:inline-flex;align-items:center;gap:5px")}>
                  <span style={mix("width:6px;height:6px;border-radius:50%", { background: ST.issued.dot })} />
                  выдано {live.issued}
                </span>
              </span>
            )}
          </div>
        </div>
        <Tabs<"open" | "closed">
          value={batch.status}
          onChange={(s) => s !== batch.status && setStatus(s)}
          tabs={[
            { key: "open", label: "Принимает товары", dot: "var(--green-dot)" },
            { key: "closed", label: "Закрыта", dot: "var(--text-4)" },
          ]}
        />
        {user?.role === "admin" && items.length === 0 && (
          <HButton onClick={() => setConfirmDelete(true)} s={btnGhost + ";height:34px;color:var(--danger);border-color:var(--danger-border)"} hover="background:var(--danger-tint)">
            Удалить
          </HButton>
        )}
      </section>

      {/* Формула прибыли */}
      <section className="bt-formula-card">
        <div style={css("display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:14px")}>
          <span style={css("font-size:15px;font-weight:500;color:var(--text)")}>Расчёт прибыли</span>
          <span style={css("font-size:12px;color:var(--text-4)")}>доходы минус расходы — впишите суммы, итог считается сразу</span>
          {needRate && (
            <span style={css("margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-3)")}>
              курс <span style={css("color:var(--text-4)")}>$1 =</span>
              <span style={css("width:104px")}>{field("usd_rate", "Курс доллара")}</span>
            </span>
          )}
        </div>
        <div className="bt-formula">
          <Term sign="+" tone="green" title="Вес клиентам" hint="с клиентов за вес" value={live.client} note={rateNote("client_cur", live.client)}>
            {field("client_amount", "Вес клиентам", "client_cur")}
          </Term>
          <Op>+</Op>
          <Term sign={live.markup < 0 ? "−" : "+"} tone="green" title="Наценка на товары" hint="сумма − реальная цена" value={live.markup} note={live.withCost < items.length ? `с выкупом ${live.withCost} из ${items.length}` : `${items.length} ${plural(items.length, "товар", "товара", "товаров")}`}>
            <div className="bt-calc">
              <span style={css(NUM + ";color:var(--text)")}>{som(live.sale)}</span>
              <span style={css("color:var(--text-4)")}>−</span>
              <span style={css(NUM + ";color:var(--text)")}>{som(live.goodsCost)}</span>
            </div>
          </Term>
          <Op>−</Op>
          <Term sign="−" tone="danger" title="Выкуп веса" hint="отдали за вес" value={live.buy} note={rateNote("buy_cur", live.buy)}>
            {field("buy_amount", "Выкуп веса", "buy_cur")}
          </Term>
          <Op>−</Op>
          <Term sign="−" tone="danger" title="Доставка" hint="отдали водителю" value={live.delivery} note={rateNote("delivery_cur", live.delivery)}>
            {field("delivery_usd", "Доставка", "delivery_cur")}
          </Term>
          <Op>=</Op>
          <div className={"bt-result" + (neg ? " neg" : "")}>
            <span style={css("font-size:12.5px;opacity:.85")}>{neg ? "Убыток партии" : "Прибыль партии"}</span>
            <span style={css(NUM + ";display:block;font-size:30px;font-weight:600;letter-spacing:-.02em;line-height:1.1;margin-top:6px;white-space:nowrap")}>
              <CountUp text={`${live.profit > 0 ? "+" : ""}${som(Math.round(live.profit))}`} />
            </span>
            <span style={css(NUM + ";display:block;font-size:12px;opacity:.8;margin-top:6px")}>
              {live.sale > 0 ? `${Math.round((live.profit / live.sale) * 100)}% от суммы товаров` : "доходы − расходы"}
            </span>
          </div>
        </div>

        {/* Доходы и расходы полосами */}
        <div className="bt-bars">
          <Bar label="Доходы" value={live.income} max={barMax} grad="linear-gradient(90deg,#34D399,#16A34A)" color="var(--green)" />
          <Bar label="Расходы" value={live.expenses} max={barMax} grad="linear-gradient(90deg,#FB7185,#DC2626)" color="var(--danger)" />
        </div>
      </section>

      {/* Товары партии */}
      <section style={css(CARD + ";overflow:hidden")}>
        <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:14px 18px;border-bottom:1px solid var(--border-2)")}>
          {items.length > 0 && <Check on={allOn} half={selected.size > 0} onToggle={(on) => toggle(items.map((i) => i.id), on)} title="Выбрать все" />}
          <div style={css("min-width:0")}>
            <div style={css("font-size:15px;font-weight:500;color:var(--text)")}>Товары партии</div>
            <div style={css(NUM + ";font-size:12px;color:var(--text-4)")}>
              {items.length} {plural(items.length, "товар", "товара", "товаров")} · {live.customers} {plural(live.customers, "клиент", "клиента", "клиентов")} · на {som(live.sale)}
            </div>
          </div>
          <span style={css("flex:1")} />
          {selected.size > 0 && (
            <HButton onClick={removeSelected} s={btnGhost + ";height:34px;font-size:12.5px"} hover="border-color:var(--danger-border);color:var(--danger)">
              Убрать из партии ({selected.size})
            </HButton>
          )}
          <HButton onClick={() => setAdding(true)} s={btnPrimary + ";height:34px;font-size:12.5px;display:inline-flex;align-items:center;gap:6px"} hover="background:var(--accent-hover)">
            <Svg paths={I_PLUS} size={14} sw={2.4} />
            Добавить принятые
          </HButton>
        </div>
        {items.length === 0 ? (
          <Empty
            icon="receive"
            title="В партии пока нет товаров"
            text="Выберите эту партию на «Приёме товара» и сканируйте — товары попадут сюда. Или добавьте уже принятые кнопкой выше."
          />
        ) : (
          groups.map((g) => <ClientBlock key={g[0].customer_id} items={g} selected={selected} onToggle={toggle} onOpen={setOpen} />)
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

const TERM = {
  green: { badge: "linear-gradient(135deg,#34D399,#16A34A)", fg: "var(--green)" },
  danger: { badge: "linear-gradient(135deg,#FB7185,#DC2626)", fg: "var(--danger)" },
} as const;

/** Слагаемое формулы: знак, название, поле (или расчёт) и сумма в сомах. */
function Term({ sign, tone, title, hint, value, note, children }: { sign: "+" | "−"; tone: keyof typeof TERM; title: string; hint: string; value: number; note?: string; children: ReactNode }) {
  const t = TERM[tone];
  return (
    <div className="bt-term">
      <div style={css("display:flex;align-items:center;gap:9px;min-width:0")}>
        <span style={mix("width:24px;height:24px;border-radius:8px;flex:none;display:grid;place-items:center;color:#fff;font-size:15px;font-weight:600;line-height:1", { background: t.badge })}>{sign}</span>
        <span style={css("min-width:0")}>
          <span style={css("display:block;font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{title}</span>
          <span style={css("display:block;font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{hint}</span>
        </span>
      </div>
      {children}
      <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:auto;min-width:0")}>
        <span style={css("font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{note}</span>
        <span style={mix(NUM + ";font-size:15px;font-weight:500;white-space:nowrap", { color: value ? t.fg : "var(--text-4)" })}>
          {value ? `${sign} ${som(Math.round(Math.abs(value)))}` : "—"}
        </span>
      </div>
    </div>
  );
}

function Op({ children }: { children: ReactNode }) {
  return (
    <span className="bt-op" aria-hidden>
      {children}
    </span>
  );
}

function Bar({ label, value, max, grad, color }: { label: string; value: number; max: number; grad: string; color: string }) {
  const w = value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div style={css("display:grid;grid-template-columns:70px minmax(0,1fr) 110px;align-items:center;gap:12px")}>
      <span style={css("font-size:12.5px;color:var(--text-3)")}>{label}</span>
      <span style={css("height:10px;border-radius:999px;background:var(--hover);overflow:hidden")}>
        <span className="bar-grow" style={mix("display:block;height:100%;border-radius:999px", { width: `${w}%`, background: grad })} />
      </span>
      <span style={mix(NUM + ";text-align:right;font-size:13.5px;font-weight:500;white-space:nowrap", { color: value ? color : "var(--text-4)" })}>{som(Math.round(value))}</span>
    </div>
  );
}

// --- Товары партии по клиентам -------------------------------------------------------------------

const STATUS_TEXT: Record<Item["status"], string> = { ordered: "Заказан", in_stock: "На складе", issued: "Выдан" };

function ClientBlock({ items, selected, onToggle, onOpen }: { items: Item[]; selected: Set<number>; onToggle: (ids: number[], on: boolean) => void; onOpen: (id: number) => void }) {
  const nav = useNavigate();
  const first = items[0];
  const sale = items.reduce((s, i) => s + i.sale, 0);
  const withCost = items.filter((i) => i.cost !== null);
  const markup = withCost.reduce((s, i) => s + i.sale - (i.cost ?? 0), 0);
  const allOn = items.every((i) => selected.has(i.id));
  const someOn = items.some((i) => selected.has(i.id));
  return (
    <div className="bt-client">
      <div className="bt-client-head">
        <Check on={allOn} half={someOn} onToggle={(on) => onToggle(items.map((i) => i.id), on)} title="Выбрать все товары клиента" />
        <HButton
          onClick={() => nav(`/customers/${first.customer_id}`)}
          title="Открыть карточку клиента"
          className="bt-client-link"
          s="display:flex;align-items:center;gap:10px;min-width:0;flex:1;border:none;background:transparent;padding:0;cursor:pointer;font:inherit;color:inherit;text-align:left"
          hover=""
        >
          <Avatar name={first.customer_name} size={32} />
          <span style={css("min-width:0")}>
            <span className="bt-client-name" style={css("display:block;font-size:13.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
              {first.customer_name}
            </span>
            <span style={css(NUM + ";display:block;font-size:12px;color:var(--text-3);white-space:nowrap")}>
              {first.customer_phone} · {items.length} {plural(items.length, "товар", "товара", "товаров")}
            </span>
          </span>
        </HButton>
        <span style={css("text-align:right;flex:none")}>
          <span style={css(NUM + ";display:block;font-size:14px;font-weight:500;color:var(--text);white-space:nowrap")}>{som(sale)}</span>
          <span style={mix(NUM + ";display:block;font-size:12px;white-space:nowrap", { color: withCost.length ? (markup < 0 ? "var(--danger)" : "var(--green)") : "var(--text-4)" })}>
            {withCost.length ? `${markup > 0 ? "+" : ""}${som(markup)} наценка` : "без выкупа"}
          </span>
        </span>
      </div>
      {items.map((it) => {
        const p = profitOf(it);
        const on = selected.has(it.id);
        return (
          <div key={it.id} onClick={() => onOpen(it.id)} className={"bt-row" + (on ? " on" : "")} title="Открыть карточку товара">
            <Check on={on} onToggle={(v) => onToggle([it.id], v)} />
            <span style={css("min-width:0")}>
              <span style={css("display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                {it.name}
                {it.qty > 1 && <span style={css(NUM + ";color:var(--text-4)")}> × {it.qty}</span>}
              </span>
              <span style={css(CODE + ";display:block;font-size:11px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{it.code || "без кода"}</span>
            </span>
            <span style={css(NUM + ";text-align:right;font-size:13px;color:var(--text);white-space:nowrap")}>{som(it.sale)}</span>
            <span className="bt-hide" style={css("text-align:right;min-width:0")}>
              {p === null ? (
                <span style={css("font-size:12px;color:var(--text-5)")}>нет выкупа</span>
              ) : (
                <>
                  <span style={mix(NUM + ";display:block;font-size:13px;white-space:nowrap", { color: p < 0 ? "var(--danger)" : "var(--green)" })}>
                    {p > 0 ? "+" : ""}
                    {som(p)}
                  </span>
                  <span style={css(NUM + ";display:block;font-size:11px;color:var(--text-4);white-space:nowrap")}>из {som(it.cost)}</span>
                </>
              )}
            </span>
            <span className="bt-hide" style={mix(NUM + ";display:flex;align-items:center;gap:6px;font-size:12.5px;white-space:nowrap", { color: it.debt > 0 ? "var(--danger)" : "var(--green)" })}>
              <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: it.debt > 0 ? "var(--danger-dot)" : "var(--green-dot)" })} />
              {it.debt > 0 ? `долг ${som(it.debt)}` : "оплачено"}
            </span>
            <span className="bt-hide" style={css("display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-2);white-space:nowrap")}>
              <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: ST[it.status].dot })} />
              {STATUS_TEXT[it.status]}
            </span>
          </div>
        );
      })}
    </div>
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
      subtitle={
        picked.size && rows ? (
          <span style={css(NUM)}>
            выбрано {picked.size} на {som(rows.filter((i) => picked.has(i.id)).reduce((s, i) => s + i.sale, 0))}
          </span>
        ) : (
          "Отметьте товары со склада, которых ещё нет в партиях"
        )
      }
      icon={<Icon name="batches" size={18} />}
      tone="violet"
      onClose={onClose}
      width={640}
      footer={
        <>
          <ModalCancel>Отмена</ModalCancel>
          <HButton disabled={!picked.size} onClick={add} s={btnPrimary + ";opacity:" + (picked.size ? 1 : 0.5)} hover="background:var(--accent-hover)">
            Добавить ({picked.size})
          </HButton>
        </>
      }
    >
      <div style={css("padding:16px 18px;display:flex;flex-direction:column;gap:12px")}>
        <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px")}>
          <span style={css("color:var(--text-3)")}>Принятые без партии за</span>
          <DatePicker value={day} disabled={allDays} onChange={setDay} height={32} fontSize={12.5} ariaLabel="День приёма" />
          <span style={css("display:flex;align-items:center;gap:7px;cursor:pointer;color:var(--text-2)")} onClick={() => setAllDays((v) => !v)}>
            <Check on={allDays} onToggle={setAllDays} /> за все дни
          </span>
        </div>
        <ModalError text={error} />
        {!rows ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <div style={css("display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 16px;border-radius:14px;border:1px dashed var(--border-strong);text-align:center")}>
            <span style={css("width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:var(--violet-tint);color:var(--violet)")}>
              <Icon name="batches" size={18} />
            </span>
            <span style={css("margin-top:4px;font-size:13.5px;font-weight:500;color:var(--text)")}>{allDays ? "Все принятые товары уже в партиях" : "За этот день нечего добавлять"}</span>
            <span style={css("font-size:12.5px;color:var(--text-3)")}>{allDays ? "Новые появятся после приёма на складе" : "Все товары, принятые в этот день, уже распределены по партиям"}</span>
            {!allDays && (
              <HButton onClick={() => setAllDays(true)} className="mf-chip" s="margin-top:6px" hover="">
                Показать за все дни
              </HButton>
            )}
          </div>
        ) : (
          <div className="thin-scroll" style={css("border:1px solid var(--border);border-radius:12px;overflow:hidden;max-height:380px;overflow-y:auto")}>
            <div style={css("display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface-2);border-bottom:1px solid var(--border-2);font-size:12px;color:var(--text-3)")}>
              <Check on={picked.size === rows.length} half={picked.size > 0} onToggle={(on) => pick(rows.map((i) => i.id), on)} />
              Выбрать все ({rows.length})
            </div>
            {rows.map((i) => (
              <div
                key={i.id}
                onClick={() => pick([i.id], !picked.has(i.id))}
                className="row-click"
                style={css("display:grid;grid-template-columns:18px minmax(0,1fr) auto 90px;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid var(--border-2);font-size:12.5px;cursor:pointer")}
              >
                <Check on={picked.has(i.id)} onToggle={(on) => pick([i.id], on)} />
                <span style={css("min-width:0")}>
                  <span style={css("display:block;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{i.name}</span>
                  <span style={css("display:block;font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                    {i.customer_name} · <span style={css(CODE + ";font-size:11px")}>{i.code || "без кода"}</span>
                  </span>
                </span>
                <span style={css(NUM + ";font-size:11.5px;color:var(--text-3);white-space:nowrap")}>{shortDateTime(i.arrived_at)}</span>
                <span style={css(NUM + ";font-weight:500;text-align:right;white-space:nowrap;color:var(--text)")}>{som(i.sale)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// --- Мелочи --------------------------------------------------------------------------------------

/** Галочка выбора: квадрат с галкой; half — выбрана часть. Клик не открывает карточку товара. */
function Check({ on, half, onToggle, title }: { on: boolean; half?: boolean; onToggle: (on: boolean) => void; title?: string }) {
  const lit = on || half;
  return (
    <span
      role="checkbox"
      aria-checked={on ? true : half ? "mixed" : false}
      tabIndex={0}
      title={title}
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
      style={mix("width:18px;height:18px;border-radius:6px;flex:none;display:grid;place-items:center;color:#fff;cursor:pointer;transition:background .12s,border-color .12s", {
        background: lit ? "var(--accent)" : "var(--surface)",
        border: `1.5px solid ${lit ? "var(--accent)" : "var(--border-strong)"}`,
      })}
    >
      {on ? <Svg paths={I_CHECK} size={12} sw={3} /> : half ? <Svg paths={I_MINUS} size={12} sw={3} /> : null}
    </span>
  );
}

/** Аватар-буква; цвет — от имени, как на других страницах. */
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
      style={mix("border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-weight:600", {
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: AVATAR_BG[n % AVATAR_BG.length],
      })}
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
