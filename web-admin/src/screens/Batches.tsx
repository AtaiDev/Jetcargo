/**
 * Партии: прибыль по каждой партии товара.
 *
 *   ① Выкуп веса   — сколько отдали за вес ($ или сом)      расход
 *   ② Доставка     — сколько отдали водителю ($ или сом)   расход
 *   ③ Вес клиентам — общая сумма за вес ($ или сом)          доход
 *   ④ Наценка      — Σ (Сумма − Реальная цена) по товарам   доход
 *   Прибыль партии = ③ + ④ − ① − ②  (в сомах, $ — по курсу)
 *
 * Товары попадают в партию при приёме сканером (выбрать партию на «Приёме товара»)
 * или добавляются здесь из принятых без партии.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  type BatchCur,
  type BatchPatch,
  type Item,
} from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { Confirm, Empty } from "../components/cargo";
import DatePicker from "../components/DatePicker";
import ItemModal from "../components/ItemModal";
import ItemTable from "../components/ItemTable";
import { MONO, css, mix } from "../design/css";
import { Icon } from "../design/icons";
import { PANEL, Page, PrimaryAction } from "../design/table";
import { HButton, ModalError, ModalShell, SkeletonRows, btnGhost, btnPrimary } from "../design/ui";
import { date, num, shortDateTime, som, todayIso } from "../lib/cargo";
import { emit, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;


export default function Batches({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const nav = useNavigate();
  const { id } = useParams();
  const [list, setList] = useState<(Batch & { calc: BatchCalc })[] | null>(null);
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
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "250px minmax(0,1fr)" : "1fr", gap: 16, alignItems: "start" }}>
        {/* Список партий */}
        <div style={css("display:flex;flex-direction:column;gap:10px")}>
          <PrimaryAction onClick={create}>Новая партия</PrimaryAction>
          {!list ? (
            <SkeletonRows rows={3} />
          ) : list.length === 0 ? (
            <div style={css(PANEL)}>
              <Empty icon="batches" title="Партий пока нет" text="Создайте партию и выберите её на «Приёме товара» — сканированные товары попадут в неё" />
            </div>
          ) : (
            list.map((b) => {
              const active = b.id === selected;
              return (
                <HButton
                  key={b.id}
                  onClick={() => nav(`/batches/${b.id}`)}
                  s={mix(
                    "text-align:left;display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:12px;cursor:pointer;background:var(--surface);transition:border-color .15s ease",
                    { border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, boxShadow: active ? "0 0 0 3px var(--accent-tint)" : "none" }
                  )}
                  hover="border-color:var(--accent)"
                >
                  <div style={css("display:flex;align-items:center;gap:8px;width:100%")}>
                    <span style={css("font-weight:700;font-size:13.5px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{b.name}</span>
                    <StatusPill status={b.status} />
                  </div>
                  <div style={css("display:flex;justify-content:space-between;align-items:baseline;width:100%;font-size:12px;color:var(--text-3)")}>
                    <span>
                      {b.calc.items} тов. · {b.calc.customers} клиент.
                    </span>
                    <b style={mix(MONO + ";font-size:14px", { color: b.calc.profit_som < 0 ? "var(--danger)" : "var(--green)" })}>{som(b.calc.profit_som)}</b>
                  </div>
                  <div style={css("font-size:11px;color:var(--text-4)")}>создана {date(b.created_at.slice(0, 10))}</div>
                </HButton>
              );
            })
          )}
        </div>

        {/* Партия */}
        {selected ? (
          <BatchDetail key={selected} id={selected} isDesktop={isDesktop} toast={toast} onChanged={load} onDeleted={() => { load(); nav("/batches"); }} />
        ) : (
          list && list.length > 0 && null
        )}
      </div>
    </Page>
  );
}

function StatusPill({ status }: { status: "open" | "closed" }) {
  const open = status === "open";
  return (
    <span
      style={mix("font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:10px;white-space:nowrap", {
        background: open ? "var(--green-tint)" : "var(--muted-bg)",
        color: open ? "var(--green)" : "var(--text-3)",
      })}
    >
      {open ? "принимает" : "закрыта"}
    </span>
  );
}

// --- Карточка партии ------------------------------------------------------------------------

type Draft = Record<"name" | "buy_amount" | "delivery_usd" | "client_amount" | "usd_rate", string>;
type NumField = Exclude<keyof Draft, "name">;

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

function BatchDetail({
  id,
  isDesktop,
  toast,
  onChanged,
  onDeleted,
}: {
  id: number;
  isDesktop: boolean;
  toast: Toast;
  onChanged: () => void;
  onDeleted: () => void;
}) {
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
    const toSom = (n: number, cur: BatchCur) => (cur === "usd" ? n * rate : n);
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
      profit: client + markup - buy - delivery,
      withCost: withCost.length,
      sale: items.reduce((s, i) => s + i.sale, 0),
      goodsCost: withCost.reduce((s, i) => s + (i.cost ?? 0), 0),
      customers: new Set(items.map((i) => i.customer_id)).size,
    };
  }, [draft, batch, items]);

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
  if (!batch || !draft || !live) return <SkeletonRows rows={5} />;

  /** Числовое поле: сохраняется при уходе из поля или Enter. */
  const input = (k: NumField, opts: { prefix?: string; suffix?: string; right?: ReactNode; big?: boolean } = {}) => (
    <div className="batch-field" style={css("display:flex;align-items:stretch;height:40px;border:1px solid var(--border-strong);border-radius:9px;background:var(--surface);overflow:hidden;min-width:0")}>
      {opts.prefix && <span style={css("display:flex;align-items:center;padding-left:11px;color:var(--text-4);font-size:14px")}>{opts.prefix}</span>}
      <input
        value={draft[k]}
        inputMode="decimal"
        placeholder="0"
        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
        onBlur={() => save(k)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={mix("flex:1;min-width:0;border:none;outline:none;background:transparent;font-weight:600;" + MONO, {
          padding: opts.prefix ? "0 10px 0 5px" : "0 10px 0 11px",
          fontSize: opts.big ? 16 : 14.5,
          boxShadow: "none",
        })}
      />
      {opts.suffix && <span style={css("display:flex;align-items:center;padding-right:11px;color:var(--text-4);font-size:12.5px")}>{opts.suffix}</span>}
      {opts.right}
    </div>
  );

  /** Переключатель валюты внутри поля: $ | с. */
  const curSwitch = (field: "buy_cur" | "delivery_cur" | "client_cur") => (
    <div style={css("display:flex;gap:2px;padding:3px;background:var(--surface-2);border-left:1px solid var(--border-2)")}>
      {(["usd", "som"] as const).map((c) => {
        const on = batch[field] === c;
        return (
          <button
            key={c}
            type="button"
            title={c === "usd" ? "в долларах" : "в сомах"}
            onClick={() => !on && patch({ [field]: c } as BatchPatch)}
            style={mix("width:30px;border:none;border-radius:6px;font-size:12.5px;font-weight:600;cursor:pointer", {
              background: on ? "var(--surface)" : "transparent",
              color: on ? "var(--text)" : "var(--text-4)",
              boxShadow: on ? "0 1px 2px rgba(0,0,0,.1)" : "none",
            })}
          >
            {c === "usd" ? "$" : "с"}
          </button>
        );
      })}
    </div>
  );

  const buyUsd = batch.buy_cur === "usd";
  const delUsd = batch.delivery_cur === "usd";
  const cliUsd = batch.client_cur === "usd";
  // Курс нужен, только если хоть одна сумма в долларах.
  const needRate = buyUsd || delUsd || cliUsd;
  const neg = live.profit < 0;

  return (
    <div style={css("display:flex;flex-direction:column;gap:14px;min-width:0")}>
      {/* Шапка */}
      <div style={css(PANEL + ";padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px")}>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onBlur={() => save("name")}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="batch-name"
          style={css("flex:1;min-width:200px;font-size:18px;font-weight:700;border:1px solid transparent;border-radius:8px;padding:4px 8px;margin-left:-8px;background:transparent;outline:none")}
          title="Нажмите, чтобы переименовать"
        />
        <span style={css("font-size:12px;color:var(--text-3)")}>создана {shortDateTime(batch.created_at)}</span>
        <div style={css("display:inline-flex;gap:3px;background:var(--border-2);padding:3px;border-radius:9px")}>
          {(["open", "closed"] as const).map((s) => {
            const on = batch.status === s;
            return (
              <button
                key={s}
                onClick={() => !on && setStatus(s)}
                style={mix("height:28px;padding:0 11px;border:none;border-radius:7px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px", {
                  background: on ? "var(--surface)" : "transparent",
                  fontWeight: on ? 600 : 500,
                  color: on ? "var(--text)" : "var(--text-2)",
                  boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none",
                })}
              >
                <span style={mix("width:6px;height:6px;border-radius:50%", { background: on ? (s === "open" ? "var(--green-dot)" : "var(--text-4)") : "var(--text-5)" })} />
                {s === "open" ? "Принимает товары" : "Закрыта"}
              </button>
            );
          })}
        </div>
        {user?.role === "admin" && items.length === 0 && (
          <HButton onClick={() => setConfirmDelete(true)} s={btnGhost + ";height:32px;color:var(--danger);border-color:var(--danger-border)"} hover="background:var(--danger-tint)">
            Удалить
          </HButton>
        )}
      </div>

      {/* Расчёт: слева поля, справа итог */}
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "minmax(0,1fr) 340px" : "1fr", gap: 14, alignItems: "start" }}>
        <div style={css("display:flex;flex-direction:column;gap:14px;min-width:0")}>
          <Group title="Расходы" hint="что вы отдали" tone="danger">
            <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 12 }}>
              <Step n="1" title="Выкуп веса" hint="сколько отдали за вес" tone="danger" result={`− ${som(Math.round(live.buy))}`} note={buyUsd && live.buy > 0 ? `по курсу ${num(live.rate)}` : ""}>
                {input("buy_amount", { prefix: buyUsd ? "$" : undefined, suffix: buyUsd ? undefined : "с", right: curSwitch("buy_cur"), big: true })}
              </Step>
              <Step n="2" title="Доставка" hint="сколько отдали водителю" tone="danger" result={`− ${som(Math.round(live.delivery))}`} note={delUsd && live.delivery > 0 ? `по курсу ${num(live.rate)}` : ""}>
                {input("delivery_usd", { prefix: delUsd ? "$" : undefined, suffix: delUsd ? undefined : "с", right: curSwitch("delivery_cur"), big: true })}
              </Step>
            </div>
          </Group>

          <Group title="Доходы" hint="что заработали" tone="green">
            <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 12 }}>
              <Step
                n="3"
                title="Вес клиентам"
                hint="сколько взяли с клиентов за вес"
                tone="green"
                result={`+ ${som(Math.round(live.client))}`}
                note={cliUsd && live.client > 0 ? `по курсу ${num(live.rate)}` : ""}
              >
                {input("client_amount", { prefix: cliUsd ? "$" : undefined, suffix: cliUsd ? undefined : "с", right: curSwitch("client_cur"), big: true })}
              </Step>
              <Step
                n="4"
                title="Наценка на товары"
                hint="Сумма − Реальная цена"
                tone="green"
                result={`${live.markup < 0 ? "−" : "+"} ${som(Math.abs(live.markup))}`}
                note={live.withCost < items.length ? `реальная цена есть у ${live.withCost} из ${items.length}` : ""}
              >
                <div style={css("display:flex;align-items:center;gap:8px;height:40px;padding:0 12px;border-radius:9px;background:var(--surface-2);border:1px dashed var(--border);font-size:12.5px;color:var(--text-2);white-space:nowrap;overflow:hidden")}>
                  <span style={css(MONO + ";font-weight:600;color:var(--text)")}>{som(live.sale)}</span>
                  <span style={css("color:var(--text-4)")}>−</span>
                  <span style={css(MONO + ";font-weight:600;color:var(--text)")}>{som(live.goodsCost)}</span>
                  <span style={css("margin-left:auto;font-size:11.5px;color:var(--text-4)")}>{items.length} тов.</span>
                </div>
              </Step>
            </div>
          </Group>
        </div>

        {/* Итог партии */}
        <div style={mix(PANEL + ";display:flex;flex-direction:column", isDesktop ? { position: "sticky", top: 12 } : {})}>
          <div style={css("padding:14px 18px 6px;font-size:13.5px;font-weight:700")}>Итог партии</div>
          <div style={css("padding:0 18px")}>
            <Line n="3" label="Вес клиентам" value={live.client} sign="+" />
            <Line n="4" label="Наценка на товары" value={live.markup} sign={live.markup < 0 ? "−" : "+"} />
            <Line n="1" label="Выкуп веса" value={live.buy} sign="−" />
            <Line n="2" label="Доставка" value={live.delivery} sign="−" />
          </div>
          <div
            style={mix("margin:10px 12px 12px;padding:14px 16px;border-radius:10px", {
              background: neg ? "var(--danger-tint)" : "var(--green-tint)",
            })}
          >
            <div style={mix("font-size:12px;font-weight:600", { color: neg ? "var(--danger)" : "var(--green)" })}>{neg ? "Убыток партии" : "Прибыль партии"}</div>
            <div style={mix(MONO + ";font-size:28px;font-weight:700;line-height:1.2;margin-top:2px", { color: neg ? "var(--danger)" : "var(--green)" })}>
              {som(Math.round(live.profit))}
            </div>
            <div style={css("font-size:11px;color:var(--text-3);margin-top:3px")}>доходы − расходы</div>
          </div>
          {needRate && (
            <div style={css("display:flex;align-items:center;gap:10px;padding:10px 18px 14px;border-top:1px solid var(--border-2)")}>
              <span style={css("font-size:12px;color:var(--text-3);flex:1")}>Курс доллара</span>
              <span style={css("font-size:12px;color:var(--text-4)")}>$1 =</span>
              <div style={css("width:110px")}>{input("usd_rate", { suffix: "с" })}</div>
            </div>
          )}
        </div>
      </div>

      {/* Товары партии */}
      <section>
        <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:4px 2px 10px")}>
          <span style={css("font-size:14px;font-weight:700")}>Товары партии</span>
          <span style={css("font-size:11.5px;color:var(--text-3);background:var(--hover);padding:2px 8px;border-radius:10px")}>
            {items.length} тов. · {live.customers} клиент. · {som(live.sale)}
          </span>
          <span style={css("flex:1")} />
          {selected.size > 0 && (
            <HButton onClick={removeSelected} s={btnGhost + ";height:32px;font-size:12.5px"} hover="border-color:var(--danger-border);color:var(--danger)">
              Убрать из партии ({selected.size})
            </HButton>
          )}
          <HButton onClick={() => setAdding(true)} s={btnPrimary + ";height:32px;font-size:12.5px"} hover="background:var(--accent-hover)">
            + Добавить принятые
          </HButton>
        </div>
        <div>
          <ItemTable
            rows={items}
            isDesktop={isDesktop}
            columns={["customer", "item", "qty", "sale", "profit", "pay", "status"]}
            onOpen={setOpen}
            selected={selected}
            onSelect={(ids, on) =>
              setSelected((prev) => {
                const n = new Set(prev);
                for (const i of ids) {
                  if (on) n.add(i);
                  else n.delete(i);
                }
                return n;
              })
            }
            empty={
              <Empty
                icon="receive"
                title="В партии пока нет товаров"
                text="Выберите эту партию на «Приёме товара» и сканируйте — товары попадут сюда. Или добавьте уже принятые кнопкой выше."
              />
            }
          />
        </div>
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

const TONE = {
  danger: { dot: "var(--danger-dot)", fg: "var(--danger)", tint: "var(--danger-tint)" },
  green: { dot: "var(--green-dot)", fg: "var(--green)", tint: "var(--green-tint)" },
} as const;

/** Группа шагов: «Расходы» или «Доходы». */
function Group({ title, hint, tone, children }: { title: string; hint: string; tone: keyof typeof TONE; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <div>
      <div style={css("display:flex;align-items:center;gap:8px;margin:0 2px 8px")}>
        <span style={mix("font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase", { color: t.fg })}>{title}</span>
        <span style={css("font-size:11.5px;color:var(--text-4)")}>{hint}</span>
        <span style={css("flex:1;height:1px;background:var(--border-2)")} />
      </div>
      {children}
    </div>
  );
}

/** Шаг расчёта: номер, название, поле ввода и результат в сомах. */
function Step({
  n,
  title,
  hint,
  tone,
  result,
  note,
  children,
}: {
  n: string;
  title: string;
  hint: string;
  tone: keyof typeof TONE;
  result: string;
  note?: string;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div style={css(PANEL + ";padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0")}>
      <div style={css("display:flex;align-items:flex-start;gap:9px;min-width:0")}>
        <span style={mix("width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;flex:none;margin-top:1px", { background: t.tint, color: t.fg })}>
          {n}
        </span>
        <span style={css("min-width:0")}>
          <span style={css("display:block;font-size:13.5px;font-weight:700")}>{title}</span>
          <span style={css("display:block;font-size:11.5px;color:var(--text-4);margin-top:1px")}>{hint}</span>
        </span>
      </div>
      {children}
      <div style={css("margin-top:auto;display:flex;align-items:baseline;justify-content:space-between;gap:8px")}>
        <span style={css("font-size:11.5px;color:var(--text-4);line-height:1.35")}>{note}</span>
        <span style={mix(MONO + ";font-size:16px;font-weight:700;white-space:nowrap", { color: t.fg })}>{result}</span>
      </div>
    </div>
  );
}

/** Строка итога: ⊕/⊖ номер шага, название и сумма. */
function Line({ n, label, value, sign }: { n: string; label: string; value: number; sign: "+" | "−" }) {
  const t = TONE[sign === "+" ? "green" : "danger"];
  return (
    <div style={css("display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px dashed var(--border-2);font-size:13px")}>
      <span style={mix("width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex:none", { background: t.tint, color: t.fg })}>
        {n}
      </span>
      <span style={css("flex:1;color:var(--text-2)")}>{label}</span>
      <span style={mix(MONO + ";font-weight:600;white-space:nowrap", { color: value ? t.fg : "var(--text-4)" })}>
        {value ? `${sign} ${som(Math.round(Math.abs(value)))}` : "—"}
      </span>
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

  return (
    <ModalShell
      title="Добавить принятые товары"
      icon={<Icon name="batches" size={16} />}
      onClose={onClose}
      width={640}
      footer={
        <>
          <HButton onClick={onClose} s={btnGhost} hover="background:var(--hover)">
            Отмена
          </HButton>
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
          <label style={css("display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--text-2)")}>
            <input type="checkbox" checked={allDays} onChange={(e) => setAllDays(e.target.checked)} /> за все дни
          </label>
        </div>
        <ModalError text={error} />
        {!rows ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <div style={css("padding:20px;text-align:center;font-size:12.5px;color:var(--text-3)")}>Нет принятых товаров без партии за этот день</div>
        ) : (
          <div style={css("border:1px solid var(--border);border-radius:10px;overflow:hidden;max-height:380px;overflow-y:auto")}>
            <label style={css("display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--surface-2);border-bottom:1px solid var(--border-2);font-size:12px;color:var(--text-3);cursor:pointer")}>
              <input
                type="checkbox"
                checked={picked.size === rows.length}
                onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((i) => i.id)) : new Set())}
              />
              Выбрать все ({rows.length})
            </label>
            {rows.map((i) => (
              <label
                key={i.id}
                style={css("display:grid;grid-template-columns:20px minmax(0,1fr) auto 90px;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border-2);font-size:12.5px;cursor:pointer")}
              >
                <input
                  type="checkbox"
                  checked={picked.has(i.id)}
                  onChange={(e) =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (e.target.checked) n.add(i.id);
                      else n.delete(i.id);
                      return n;
                    })
                  }
                />
                <span style={css("min-width:0")}>
                  <span style={css("display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{i.name}</span>
                  <span style={css("display:block;font-size:11px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                    {i.customer_name} · <span style={css(MONO)}>{i.code || "без кода"}</span>
                  </span>
                </span>
                <span style={css(MONO + ";font-size:11px;color:var(--text-3);white-space:nowrap")}>{shortDateTime(i.arrived_at)}</span>
                <span style={css(MONO + ";font-weight:600;text-align:right;white-space:nowrap")}>{som(i.sale)}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
