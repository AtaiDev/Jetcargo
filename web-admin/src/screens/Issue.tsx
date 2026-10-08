/**
 * Выдача товара клиенту.
 *
 * Раскладка «очередь слева»:
 *  - слева — очередь «Ждут выдачи» (клиенты с товаром на складе) и поиск по телефону, имени
 *    или коду товара (можно отсканировать); колонка не выше экрана, список прокручивается;
 *  - справа — выдача выбранному клиенту: товары со склада галочками, ниже — что ещё в пути,
 *    внизу чек: сколько выбрано, долг, приём оплаты и «Выдать»; пока клиент не выбран —
 *    подсказка и итоги выдач за сегодня;
 *  - ниже — история выдач за период.
 * Статус, дата, время и история пишутся сервером; финансы не меняются (кроме принятой оплаты).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
  type IssueRow,
  type Item,
} from "../api/domain";
import { Confirm, Empty, Pager, PeriodPicker, periodOf, type Period } from "../components/cargo";
import ItemModal from "../components/ItemModal";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_CHECK, I_CLOSE, I_MINUS, I_SEARCH, Icon, Svg } from "../design/icons";
import { Page, SearchInput } from "../design/table";
import { HButton, ModalError, ST, SkeletonRows } from "../design/ui";
import { date, parseMoney, shortDateTime, som, todayIso } from "../lib/cargo";
import { emit, useDebounced, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
type PathDef = [string, Record<string, unknown>][];

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const CODE = MONO + ";letter-spacing:.02em";
const CARD = "background:var(--surface);border:1px solid var(--border);border-radius:16px";
const TITLE = "font-size:15px;font-weight:500;letter-spacing:-.01em;color:var(--text)";

const I_CHEVRON: PathDef = [["path", { d: "m9 6 6 6-6 6" }]];

export default function Issue({ toast }: { isDesktop: boolean; toast: Toast }) {
  const [params, setParams] = useSearchParams();
  const customerId = Number(params.get("customer")) || null;
  const searchRef = useRef<HTMLInputElement>(null);

  const pick = (id: number | null) => {
    setParams(id ? { customer: String(id) } : {}, { replace: true });
    if (!id) searchRef.current?.focus();
  };

  return (
    <Page size="wide">
      <div className={"iss-grid" + (customerId ? " has-client" : "")}>
        <Queue selected={customerId} onPick={pick} inputRef={searchRef} />
        {customerId ? <IssuePanel key={customerId} customerId={customerId} toast={toast} onClose={() => pick(null)} /> : <Idle />}
      </div>
      <IssueHistory toast={toast} />
    </Page>
  );
}

// --- Очередь слева ---------------------------------------------------------------------------

type QueueEntry = Pick<CustomerBrief, "id" | "name" | "phone" | "in_stock" | "debt">;

/** Клиенты с товаром на складе (больше товаров — выше); поиск — по телефону, имени или коду товара. */
function Queue({ selected, onPick, inputRef }: { selected: number | null; onPick: (id: number) => void; inputRef: RefObject<HTMLInputElement> }) {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [found, setFound] = useState<CustomerBrief[] | null>(null);

  const load = useCallback(() => {
    listCustomers({ filter: "in_stock", limit: 200 })
      .then((r) => setRows([...r.rows].sort((a, b) => b.in_stock - a.in_stock)))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  useRefresh(load);

  useEffect(() => {
    if (q.length < 2) {
      setFound(null);
      return;
    }
    let alive = true;
    issueLookup(q)
      .then((r) => alive && setFound(r))
      .catch(() => alive && setFound([]));
    return () => {
      alive = false;
    };
  }, [q]);

  const choose = (id: number) => {
    onPick(id);
    setQuery("");
    setFound(null);
  };

  // Enter: если найден ровно один клиент с товаром на складе (или вообще один) — сразу открываем.
  function onEnter() {
    const withStock = (found ?? []).filter((c) => c.in_stock > 0);
    if (withStock.length === 1) choose(withStock[0].id);
    else if (found?.length === 1) choose(found[0].id);
  }

  const searching = q.length >= 2;
  const list: QueueEntry[] | null = searching ? found : rows;
  const total = (rows ?? []).reduce((s, r) => s + r.in_stock, 0);

  return (
    <aside className="iss-queue" style={css(CARD + ";overflow:hidden")}>
      <div style={css("flex:none;padding:16px 16px 12px;display:flex;flex-direction:column;gap:12px")}>
        <div>
          <div style={css(TITLE)}>Ждут выдачи</div>
          <div style={css(NUM + ";font-size:12px;color:var(--text-4);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
            {!rows
              ? "загружаем…"
              : rows.length
                ? `${rows.length} ${plural(rows.length, "клиент", "клиента", "клиентов")} · ${total} ${plural(total, "товар", "товара", "товаров")} на складе`
                : "на складе сейчас пусто"}
          </div>
        </div>
        <label className="iss-search">
          <span style={css("display:flex;flex:none;color:var(--text-4)")}>
            <Svg paths={I_SEARCH} size={16} />
          </span>
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEnter();
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Телефон, имя или код товара"
            aria-label="Найти клиента"
            style={css("flex:1;min-width:0;height:100%;border:none;outline:none;background:transparent;font-size:13.5px;color:var(--text);padding:0")}
          />
          {query && (
            <HButton
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              title="Очистить"
              s="width:28px;height:28px;flex:none;display:grid;place-items:center;border:none;border-radius:8px;background:transparent;color:var(--text-4);cursor:pointer"
              hover="background:var(--hover);color:var(--text-2)"
            >
              <Svg paths={I_CLOSE} size={14} />
            </HButton>
          )}
        </label>
      </div>

      <div className="thin-scroll" style={css("flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;border-top:1px solid var(--border-2)")}>
        {!list ? (
          <div style={css("padding:14px 16px")}>
            <SkeletonRows rows={4} />
          </div>
        ) : list.length === 0 ? (
          <div style={css("padding:32px 20px;text-align:center;font-size:12.5px;color:var(--text-4);line-height:1.5")}>
            {searching ? "Никого не нашли — проверьте номер, имя или код товара" : "На складе пусто — клиенты появятся здесь, как только их товары примут сканером"}
          </div>
        ) : (
          <>
            {searching && (
              <div style={css(NUM + ";flex:none;padding:9px 16px 7px;font-size:11px;color:var(--text-4);background:var(--surface-2);border-bottom:1px solid var(--border-2)")}>
                Найдено: {list.length}
              </div>
            )}
            <div style={css("flex:none")}>
              {list.map((c) => (
                <QueueRow key={c.id} c={c} active={c.id === selected} onClick={() => choose(c.id)} />
              ))}
            </div>
            <div className="iss-qfill">
              <span className="iss-qfill-msg" style={css("font-size:12px;color:var(--text-5);text-align:center;line-height:1.5")}>
                {searching ? "Esc — вернуться к очереди" : "клиент появляется здесь, когда его товар принимают на склад"}
              </span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function QueueRow({ c, active, onClick }: { c: QueueEntry; active: boolean; onClick: () => void }) {
  const none = c.in_stock === 0;
  return (
    <button onClick={onClick} className={"iss-qrow" + (active ? " on" : "")}>
      <Avatar name={c.name} size={34} />
      <span style={css("flex:1;min-width:0")}>
        <span style={css("display:block;font-size:13.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.name}</span>
        <span style={css(NUM + ";display:block;font-size:12px;color:var(--text-3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.phone || "без телефона"}</span>
      </span>
      <span style={css("flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px")}>
        <span
          title={none ? "на складе ничего нет" : "товаров на складе"}
          style={mix(NUM + ";display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 7px;border-radius:7px;font-size:12px;font-weight:500", {
            background: none ? "var(--hover)" : "var(--accent-tint)",
            color: none ? "var(--text-4)" : "var(--accent-strong)",
          })}
        >
          <Icon name="stock" size={12} />
          {c.in_stock}
        </span>
        <span style={mix(NUM + ";font-size:11.5px;white-space:nowrap", { color: c.debt > 0 ? "var(--danger)" : "var(--green)" })}>
          {c.debt > 0 ? `долг ${som(c.debt)}` : "без долга"}
        </span>
      </span>
    </button>
  );
}

// --- Справа, пока клиент не выбран -------------------------------------------------------------

/** Подсказка, как выдать, и итоги выдач за сегодня — чтобы место не пустовало. */
function Idle() {
  const [today, setToday] = useState<IssueList | null>(null);
  const load = useCallback(() => {
    const d = todayIso();
    listIssues({ since: dayStartIso(d), until: dayStartIso(d, 1), limit: 1 })
      .then(setToday)
      .catch(() => setToday(null));
  }, []);
  useEffect(load, [load]);
  useRefresh(load);
  const s = today?.summary;

  return (
    <section className="iss-panel iss-idle" style={css(CARD + ";overflow:hidden;min-height:440px")}>
      <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:40px 24px;text-align:center")}>
        <span style={css("width:64px;height:64px;border-radius:20px;display:grid;place-items:center;background:var(--accent-tint);color:var(--accent);margin-bottom:10px")}>
          <Icon name="issue" size={30} />
        </span>
        <div style={css("font-size:16px;font-weight:500;color:var(--text)")}>Выберите клиента в очереди</div>
        <div style={css("font-size:13px;color:var(--text-3);max-width:400px;line-height:1.5")}>
          или найдите по телефону, имени или коду товара — код можно отсканировать, откроется владелец товара
        </div>
        <div style={css("display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:16px")}>
          <Step n={1} text="выберите клиента" />
          <Step n={2} text="отметьте товары" />
          <Step n={3} text="примите оплату и выдайте" />
        </div>
      </div>
      <div className="iss-facts">
        <Fact label="Выдач сегодня" value={today ? String(today.total) : "—"} />
        <Fact label="Клиентов" value={s ? String(s.customers) : "—"} />
        <Fact label="Товаров" value={s ? String(s.items) : "—"} hint={s && s.qty !== s.items ? `${s.qty} шт` : undefined} />
        <Fact label="На сумму" value={s ? som(s.sale) : "—"} color={s && s.sale > 0 ? "var(--green)" : undefined} />
      </div>
    </section>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <span style={css("display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 12px 0 5px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border-2);font-size:12px;color:var(--text-2);white-space:nowrap")}>
      <span style={css(NUM + ";width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:var(--accent-tint);color:var(--accent-strong);font-size:11px;font-weight:600")}>{n}</span>
      {text}
    </span>
  );
}

// --- Выдача выбранному клиенту -----------------------------------------------------------------

function IssuePanel({ customerId, toast, onClose }: { customerId: number; toast: Toast; onClose: () => void }) {
  const nav = useNavigate();
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [payMode, setPayMode] = useState<PayMode>("full");
  const [partial, setPartial] = useState("");
  const partRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  /** Что выдали только что: пока клиент открыт, показываем итог. */
  const [done, setDone] = useState<{ count: number; paid: number; left: number } | null>(null);

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
  const ordered = useMemo(() => card?.items.filter((i) => i.status === "ordered") ?? [], [card]);
  const chosen = stock.filter((i) => selected.has(i.id));
  const sum = chosen.reduce((s, i) => s + i.sale, 0);
  const debt = chosen.reduce((s, i) => s + i.debt, 0);
  // Оплата при выдаче: весь долг, часть (сумму вводим) или ничего; больше долга сервер не примет.
  const parsed = parseMoney(partial);
  const badPay = payMode === "part" && parsed !== null && (Number.isNaN(parsed) || parsed > debt);
  const pay = payMode === "full" ? debt : payMode === "part" && !badPay ? (parsed ?? 0) : 0;
  const remaining = Math.max(0, debt - pay);

  // Сменился выбор товаров — снова «весь долг».
  useEffect(() => {
    setPayMode("full");
    setPartial("");
  }, [debt]);
  useEffect(() => {
    if (payMode === "part") partRef.current?.focus();
  }, [payMode]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function doIssue() {
    setError("");
    if (badPay) throw new Error("Некорректная сумма оплаты");
    const r = await issueItems({ customer_id: customerId, item_ids: chosen.map((i) => i.id), payment_amount: pay || undefined });
    toast("success", `Выдано товаров: ${r.items.length}${pay ? `, оплата ${som(pay)}` : ""}`);
    setDone({ count: r.items.length, paid: pay, left: remaining });
    setConfirm(false);
    setSelected(new Set());
    emit("cargo:changed");
  }

  function issue() {
    if (!chosen.length || busy || badPay) return;
    if (remaining > 0) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    doIssue()
      .catch((e) => setError(apiError(e)))
      .finally(() => setBusy(false));
  }

  if (!card) {
    return (
      <section className="iss-panel" style={css(CARD + ";padding:18px")}>
        {error ? <ModalError text={error} /> : <SkeletonRows rows={4} />}
      </section>
    );
  }

  const c = card.customer;
  const allOn = stock.length > 0 && chosen.length === stock.length;
  const someOn = chosen.length > 0 && !allOn;
  const after = !chosen.length
    ? { value: "—", color: "var(--text-4)" }
    : badPay
      ? { value: parsed !== null && parsed > debt ? "сумма больше долга" : "проверьте сумму", color: "var(--danger)" }
      : debt === 0
        ? { value: "всё оплачено", color: "var(--green)" }
        : remaining > 0
          ? { value: `останется долг ${som(remaining)}`, color: "var(--amber)" }
          : { value: "✓ долг закрыт", color: "var(--green)" };

  return (
    <section className="iss-panel" style={css(CARD + ";overflow:hidden")}>
      {/* Клиент: имя, под ним телефон; справа — что у клиента */}
      <div className="iss-chead" style={css("position:relative;flex:none;display:flex;align-items:center;gap:12px 18px;flex-wrap:wrap;padding:16px 18px;border-bottom:1px solid var(--border-2)")}>
        <span style={css("display:flex;align-items:center;gap:12px;flex:1 1 240px;min-width:0")}>
          <Avatar name={c.name} size={44} />
          <span style={css("min-width:0")}>
            <HButton
              onClick={() => nav(`/customers/${c.id}`)}
              title="Открыть карточку клиента"
              s="display:block;max-width:100%;border:none;background:transparent;padding:0;cursor:pointer;font:inherit;font-size:17px;font-weight:500;letter-spacing:-.01em;line-height:1.3;color:var(--text);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
              hover="color:var(--accent)"
            >
              {c.name}
            </HButton>
            <span style={css(NUM + ";display:block;font-size:13.5px;color:var(--text-2);margin-top:2px")}>{c.phone || "без телефона"}</span>
          </span>
        </span>
        <span className="iss-cstats">
          <CountChip label="на складе" value={stock.length} dot={ST.in_stock.dot} />
          <CountChip label="ждём" value={ordered.length} dot={ST.ordered.dot} />
          <span
            style={mix("display:inline-flex;align-items:baseline;gap:8px;height:34px;line-height:34px;padding:0 13px;border-radius:10px;white-space:nowrap", {
              background: card.totals.debt > 0 ? "var(--danger-tint)" : "var(--green-tint)",
              color: card.totals.debt > 0 ? "var(--danger)" : "var(--green)",
            })}
          >
            <span style={css("font-size:12px")}>{card.totals.debt > 0 ? "долг клиента" : "долгов нет"}</span>
            {card.totals.debt > 0 && <span style={css(NUM + ";font-size:15px;font-weight:500")}>{som(card.totals.debt)}</span>}
          </span>
        </span>
        <HButton
          className="iss-close"
          onClick={onClose}
          title="Закрыть и выбрать другого клиента"
          aria-label="Закрыть"
          s="width:34px;height:34px;flex:none;display:grid;place-items:center;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text-3);cursor:pointer"
          hover="border-color:var(--accent);color:var(--accent)"
        >
          <Svg paths={I_CLOSE} size={15} />
        </HButton>
      </div>

      {done && stock.length > 0 && (
        <div style={css("flex:none;display:flex;align-items:center;gap:10px;padding:10px 18px;background:var(--green-tint);color:var(--green);font-size:12.5px;border-bottom:1px solid var(--border-2)")}>
          <Svg paths={I_CHECK} size={15} sw={2.4} />
          <span style={css(NUM + ";flex:1;min-width:0")}>{doneText(done)}</span>
          <HButton onClick={() => setDone(null)} title="Скрыть" s="width:24px;height:24px;display:grid;place-items:center;border:none;border-radius:7px;background:transparent;color:inherit;cursor:pointer" hover="background:var(--surface)">
            <Svg paths={I_CLOSE} size={13} />
          </HButton>
        </div>
      )}

      {stock.length === 0 ? (
        <div style={css("flex:1;display:flex;flex-direction:column")}>
          {done ? (
            <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:40px 24px;text-align:center")}>
              <span style={css("width:64px;height:64px;border-radius:50%;display:grid;place-items:center;background:var(--green-dot);color:#fff;margin-bottom:10px;animation:pop .25s ease")}>
                <Svg paths={I_CHECK} size={30} sw={2.6} />
              </span>
              <div style={css("font-size:17px;font-weight:500;color:var(--text)")}>
                Выдано {done.count} {plural(done.count, "товар", "товара", "товаров")}
              </div>
              <div style={css(NUM + ";font-size:13px;color:var(--text-3)")}>
                {done.paid ? `оплата принята ${som(done.paid)}` : done.left ? "без оплаты" : "всё было оплачено заранее"}
                {done.left ? ` · остался долг ${som(done.left)}` : ""}
              </div>
              <div style={css("font-size:12.5px;color:var(--text-4);margin-top:8px")}>Выберите следующего клиента в очереди</div>
            </div>
          ) : (
            <Empty
              icon="issue"
              title="На складе у клиента ничего нет"
              text={ordered.length ? "Выдать можно после приёма на склад — что ещё в пути, видно ниже." : "Все товары клиента уже выданы."}
            />
          )}
          {/* После выдачи — только итог, без списка «в пути» */}
          {!done && ordered.length > 0 && <OnTheWay items={ordered} />}
        </div>
      ) : (
        <div className="thin-scroll" style={css("flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column")}>
          <div style={css("flex:none")}>
            <div className="iss-row iss-head">
              <span style={css("display:flex;justify-content:center")}>
                <HButton
                  onClick={() => setSelected(allOn ? new Set() : new Set(stock.map((i) => i.id)))}
                  title={allOn ? "Снять все" : "Выбрать все"}
                  aria-label={allOn ? "Снять все" : "Выбрать все"}
                  s="display:flex;border:none;background:transparent;padding:0;cursor:pointer"
                >
                  <Check on={allOn} half={someOn} />
                </HButton>
              </span>
              <span>Товар</span>
              <span className="iss-hide" style={css("text-align:center")}>
                Кол-во
              </span>
              <span style={css("text-align:right")}>Сумма</span>
              <span className="iss-hide">Оплата</span>
              <span className="iss-hide" />
            </div>
            {stock.map((it) => (
              <StockRow key={it.id} it={it} on={selected.has(it.id)} onToggle={() => toggle(it.id)} onOpen={() => setOpen(it.id)} />
            ))}
            {ordered.length > 0 && <OnTheWay items={ordered} />}
          </div>
          <PanelFill />
        </div>
      )}

      {/* Чек: слева — что выдаём и что будет с долгом, справа — оплата и кнопка */}
      {stock.length > 0 && (
        <div className="iss-foot">
          <div className="iss-receipt">
            <ReceiptRow label="К выдаче" value={`${chosen.length} из ${stock.length} ${plural(stock.length, "товара", "товаров", "товаров")}`} />
            <ReceiptRow label="Сумма" value={chosen.length ? som(sum) : "—"} />
            <ReceiptRow label="Долг по ним" value={debt > 0 ? som(debt) : "нет"} color={debt > 0 ? "var(--danger)" : "var(--text-3)"} />
            <ReceiptRow label="После выдачи" {...after} strong />
          </div>

          <div style={css("min-width:0;display:flex;flex-direction:column;gap:10px")}>
            {debt > 0 ? (
              <>
                <PaySeg
                  value={payMode}
                  onChange={(m) => {
                    setPayMode(m);
                    if (m === "part") setPartial("");
                  }}
                />
                {payMode === "part" ? (
                  <label className="iss-amount" style={badPay ? css("border-color:var(--danger);box-shadow:0 0 0 3px var(--danger-tint)") : undefined}>
                    <span style={css("font-size:12.5px;color:var(--text-3);white-space:nowrap")}>Принимаем</span>
                    <input
                      ref={partRef}
                      value={partial}
                      onChange={(e) => setPartial(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && issue()}
                      inputMode="decimal"
                      placeholder={`до ${som(debt)}`}
                      aria-label="Сколько принимаем"
                      style={css(NUM + ";flex:1;min-width:0;height:100%;border:none;outline:none;background:transparent;padding:0;text-align:right;font-size:17px;font-weight:500;color:var(--text)")}
                    />
                    <span style={css("font-size:13px;color:var(--text-4)")}>с</span>
                  </label>
                ) : (
                  <HButton
                    onClick={() => {
                      setPartial(payMode === "full" ? String(debt) : "");
                      setPayMode("part");
                    }}
                    title="Изменить сумму"
                    className="iss-amount"
                    s="width:100%;cursor:text;font:inherit;text-align:left"
                    hover="border-color:var(--accent)"
                  >
                    <span style={css("font-size:12.5px;color:var(--text-3);white-space:nowrap")}>{payMode === "full" ? "Принимаем весь долг" : "Оплату не принимаем"}</span>
                    <span style={mix(NUM + ";margin-left:auto;font-size:17px;font-weight:500;white-space:nowrap", { color: payMode === "full" ? "var(--green)" : "var(--text-4)" })}>
                      {som(pay)}
                    </span>
                  </HButton>
                )}
              </>
            ) : (
              <div
                style={mix("flex:1;min-height:88px;display:flex;align-items:center;justify-content:center;gap:10px;padding:12px 14px;border-radius:12px;font-size:13px;text-align:center;line-height:1.4", {
                  background: chosen.length ? "var(--green-tint)" : "var(--surface)",
                  color: chosen.length ? "var(--green)" : "var(--text-3)",
                  border: chosen.length ? "1px solid transparent" : "1px dashed var(--border-strong)",
                })}
              >
                {chosen.length ? <Svg paths={I_CHECK} size={16} sw={2.4} /> : null}
                {chosen.length ? "Оплата не нужна — всё выбранное уже оплачено" : "Отметьте товары, которые клиент забирает"}
              </div>
            )}

            {error && <ModalError text={error} />}
            <HButton
              disabled={!chosen.length || busy || badPay}
              onClick={issue}
              s={mix(
                "width:100%;height:48px;padding:0 18px;border-radius:12px;font-size:14.5px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;transition:filter .15s,background .15s",
                !chosen.length || badPay
                  ? { background: "var(--hover)", color: "var(--text-4)", border: "1px solid var(--border)", cursor: "not-allowed" }
                  : { background: remaining > 0 ? "var(--amber-dot)" : "var(--green-dot)", color: "#fff", border: "1px solid transparent", cursor: busy ? "wait" : "pointer" }
              )}
              hover={chosen.length && !badPay ? "filter:brightness(.95)" : undefined}
            >
              {chosen.length > 0 && !badPay && <Svg paths={I_CHECK} size={17} sw={2.4} />}
              {!chosen.length ? "Выберите товары" : remaining > 0 ? `Выдать с долгом · ${chosen.length}` : `Выдать ${chosen.length} ${plural(chosen.length, "товар", "товара", "товаров")}`}
            </HButton>
          </div>
        </div>
      )}

      {confirm && (
        <Confirm
          title="Выдать с долгом?"
          danger={false}
          confirmLabel="Выдать"
          text={
            <>
              После выдачи у клиента останется долг <b style={css(NUM + ";font-weight:600")}>{som(remaining)}</b> по выбранным товарам. Долг сохранится и будет виден в карточке клиента и в
              финансах.
            </>
          }
          onClose={() => setConfirm(false)}
          onConfirm={doIssue}
        />
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </section>
  );
}

function doneText(d: { count: number; paid: number; left: number }): string {
  return (
    `Выдано ${d.count} ${plural(d.count, "товар", "товара", "товаров")}` +
    (d.paid ? ` · оплата ${som(d.paid)}` : "") +
    (d.left ? ` · остался долг ${som(d.left)}` : "")
  );
}

/** Строка товара со склада: галочка, название с кодом, количество, сумма, оплата, карточка. */
function StockRow({ it, on, onToggle, onOpen }: { it: Item; on: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <div
      role="checkbox"
      aria-checked={on}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={"iss-row iss-item" + (on ? " on" : "")}
    >
      <span style={css("display:flex;justify-content:center")}>
        <Check on={on} />
      </span>
      <span style={css("min-width:0")}>
        <span style={css("display:block;font-size:13.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{it.name}</span>
        <span style={css("display:block;font-size:11.5px;color:var(--text-4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
          <span style={css(CODE + ";font-size:11px")}>{it.code || "без кода"}</span>
          {it.arrived_at ? <span className="iss-hide">{` · пришёл ${shortDateTime(it.arrived_at)}`}</span> : null}
          <span className="iss-sm">{` · ${it.qty} шт`}</span>
        </span>
      </span>
      <span className="iss-hide" style={css(NUM + ";text-align:center;color:var(--text-3)")}>
        {it.qty} шт
      </span>
      <span style={css("min-width:0;text-align:right")}>
        <span style={css(NUM + ";display:block;font-size:13.5px;font-weight:500;color:var(--text);white-space:nowrap")}>{som(it.sale)}</span>
        <div className="iss-sm" style={mix(NUM + ";font-size:11.5px;white-space:nowrap;margin-top:2px", { color: PAY[it.pay_status].fg })}>
          {it.debt > 0 ? `долг ${som(it.debt)}` : "оплачено"}
        </div>
      </span>
      <span className="iss-hide">
        <PayCell status={it.pay_status} sale={it.sale} debt={it.debt} />
      </span>
      <span className="iss-hide" style={css("display:flex;justify-content:flex-end")}>
        <HButton
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          title="Карточка товара"
          aria-label="Карточка товара"
          s="width:28px;height:28px;display:grid;place-items:center;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--text-4);cursor:pointer"
          hover="border-color:var(--border);background:var(--surface);color:var(--accent)"
        >
          <Svg paths={I_CHEVRON} size={14} sw={2.2} />
        </HButton>
      </span>
    </div>
  );
}

/** Под товарами со склада — что у клиента ещё в пути: выдать нельзя, но видно, чего ждать. */
function OnTheWay({ items }: { items: Item[] }) {
  const shown = items.slice(0, 6);
  return (
    <div style={css("border-top:1px solid var(--border-2);padding-bottom:6px")}>
      <div style={css("display:flex;align-items:center;gap:8px;padding:12px 18px 6px;font-size:12px;color:var(--text-3);flex-wrap:wrap")}>
        <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: ST.ordered.dot })} />
        <span style={css("font-weight:500;color:var(--text-2)")}>Ещё в пути · {items.length}</span>
        <span style={css("color:var(--text-4)")}>выдать можно после приёма на склад</span>
      </div>
      {shown.map((it) => (
        <div key={it.id} className="iss-row iss-way">
          <span />
          <span style={css("min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-3)")}>
            {it.name} <span style={css(CODE + ";font-size:11px;color:var(--text-4)")}>{it.code}</span>
          </span>
          <span className="iss-hide" style={css(NUM + ";text-align:center;color:var(--text-4)")}>
            {it.qty} шт
          </span>
          <span style={css(NUM + ";text-align:right;color:var(--text-3);white-space:nowrap")}>{som(it.sale)}</span>
          <span className="iss-hide" style={css(NUM + ";font-size:12px;color:var(--text-4);white-space:nowrap")}>
            заказан {date(it.order_date).slice(0, 5)}
          </span>
          <span className="iss-hide" />
        </div>
      ))}
      {items.length > shown.length && (
        <div style={css("padding:4px 18px 8px;font-size:12px;color:var(--text-4)")}>и ещё {items.length - shown.length} — в карточке клиента</div>
      )}
    </div>
  );
}

/** Пустое место под товарами: бледные строки и подсказка, чтобы панель не выглядела пустой. */
function PanelFill() {
  return (
    <div className="ghost-fill">
      <div className="ghost-rows" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="iss-row">
            <span className="sk" style={css("width:18px;height:18px;border-radius:6px;margin:0 auto")} />
            <span style={css("display:flex;flex-direction:column;gap:7px")}>
              <span className="sk" style={mix("height:8px", { width: `${[52, 66, 44, 58][i % 4]}%` })} />
              <span className="sk" style={css("width:34%;height:6px")} />
            </span>
            <span className="sk iss-hide" style={css("width:30px;height:8px;margin:0 auto")} />
            <span style={css("display:flex;justify-content:flex-end")}>
              <span className="sk" style={css("width:56px;height:8px")} />
            </span>
            <span className="iss-hide" style={css("display:flex;flex-direction:column;gap:7px")}>
              <span className="sk" style={css("width:64px;height:8px")} />
              <span className="sk" style={css("width:100%;max-width:96px;height:3px")} />
            </span>
            <span className="iss-hide" />
          </div>
        ))}
      </div>
      <div className="ghost-msg">
        <span style={css("width:34px;height:34px;border-radius:10px;flex:none;display:grid;place-items:center;background:var(--accent-tint);color:var(--accent)")}>
          <Svg paths={I_CHECK} size={16} sw={2.2} />
        </span>
        <span style={css("min-width:0")}>
          <span style={css("display:block;font-size:13px;font-weight:500;color:var(--text)")}>Это все товары клиента на складе</span>
          <span style={css("display:block;font-size:12px;color:var(--text-4);margin-top:2px")}>снимите галочку с того, что клиент сейчас не забирает</span>
        </span>
      </div>
    </div>
  );
}

/** Строка чека: подпись слева, значение справа; strong — итоговая строка. */
function ReceiptRow({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <div className="iss-rrow">
      <span style={mix("font-size:12.5px;white-space:nowrap", { color: strong ? "var(--text-2)" : "var(--text-3)" })}>{label}</span>
      <span style={mix(NUM + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: color ?? "var(--text)", fontSize: strong ? "15px" : "14px", fontWeight: strong ? 500 : 400 })}>
        {value}
      </span>
    </div>
  );
}

type PayMode = "full" | "part" | "none";

const PAY_MODES: { key: PayMode; label: string; color: string }[] = [
  { key: "full", label: "Весь долг", color: "var(--green)" },
  { key: "part", label: "Частично", color: "var(--amber)" },
  { key: "none", label: "Без оплаты", color: "var(--danger)" },
];

/** Сколько принимаем при выдаче — как «Оплата» в кассе нового заказа. */
function PaySeg({ value, onChange }: { value: PayMode; onChange: (m: PayMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Оплата при выдаче" style={css("display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:4px;border-radius:12px;border:1px solid var(--border-2);background:var(--surface)")}>
      {PAY_MODES.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.key)}
            style={mix(
              "height:34px;padding:0 6px;border-radius:9px;border:1px solid transparent;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .15s,color .15s,border-color .15s",
              {
                background: on ? `color-mix(in srgb, ${o.color} 10%, var(--surface))` : "transparent",
                borderColor: on ? `color-mix(in srgb, ${o.color} 45%, transparent)` : "transparent",
                color: on ? o.color : "var(--text-3)",
                fontWeight: 500,
              }
            )}
          >
            <span style={mix("width:6px;height:6px;border-radius:50%;flex:none", { background: on ? o.color : "var(--text-5)" })} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Галочка выбора: квадрат с галкой; half — выбрана часть (для «выбрать все»). */
function Check({ on, half }: { on: boolean; half?: boolean }) {
  const lit = on || half;
  return (
    <span
      style={mix("width:18px;height:18px;border-radius:6px;flex:none;display:grid;place-items:center;color:#fff;transition:background .12s,border-color .12s", {
        background: lit ? "var(--accent)" : "var(--surface)",
        border: `1.5px solid ${lit ? "var(--accent)" : "var(--border-strong)"}`,
      })}
    >
      {on ? <Svg paths={I_CHECK} size={12} sw={3} /> : half ? <Svg paths={I_MINUS} size={12} sw={3} /> : null}
    </span>
  );
}

/** Таблетка «число + подпись» в строке клиента. */
function CountChip({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <span style={css("display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border-2);white-space:nowrap")}>
      <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: dot })} />
      <span style={css("font-size:12px;color:var(--text-3)")}>{label}</span>
      <span style={mix(NUM + ";font-size:15px;font-weight:500", { color: value ? "var(--text)" : "var(--text-5)" })}>{value}</span>
    </span>
  );
}

const PAY = {
  paid: { fg: "var(--green)", dot: "var(--green-dot)" },
  partial: { fg: "var(--amber)", dot: "var(--amber-dot)" },
  unpaid: { fg: "var(--danger)", dot: "var(--danger-dot)" },
} as const;

/** Оплата товара: «оплачено» или «долг N с» и тонкая полоска оплаченной доли. */
function PayCell({ status, sale, debt }: { status: keyof typeof PAY; sale: number; debt: number }) {
  const t = PAY[status];
  const share = sale > 0 ? Math.max(0, Math.min(100, Math.round(((sale - debt) / sale) * 100))) : 0;
  return (
    <span style={css("display:flex;flex-direction:column;gap:4px;min-width:0")}>
      <span style={mix(NUM + ";display:flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap", { color: t.fg })}>
        {status === "paid" ? (
          <>
            <Svg paths={I_CHECK} size={12} sw={2.6} />
            оплачено
          </>
        ) : (
          <>долг {som(debt)}</>
        )}
      </span>
      <span style={css("height:3px;border-radius:2px;background:var(--border-2);overflow:hidden;width:100%;max-width:96px")}>
        <span style={mix("display:block;height:100%;border-radius:2px", { width: `${share}%`, background: t.dot })} />
      </span>
    </span>
  );
}

/** Итог одной цифрой: подпись мелкими заглавными, значение ровным шрифтом. */
function Fact({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div style={css("min-width:0;padding:12px 18px 13px;display:flex;flex-direction:column;gap:5px")}>
      <span style={css("font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{label}</span>
      <span style={css("display:flex;align-items:baseline;gap:6px;min-width:0")}>
        <span style={mix(NUM + ";font-size:18px;font-weight:500;line-height:1.2;white-space:nowrap", { color: color ?? "var(--text)" })}>
          <CountUp text={value} />
        </span>
        {hint && <span style={css(NUM + ";font-size:12px;color:var(--text-4);white-space:nowrap")}>{hint}</span>}
      </span>
    </div>
  );
}

/** Аватар-буква; цвет — от имени, как на «Приёме», чтобы у клиента он всегда был один и тот же. */
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

// --- История выдач: слева сводка периода, справа лента выдач по дням ------------------------------

/** Локальная полночь дня YYYY-MM-DD в ISO (UTC) — граница для сервера. */
function dayStartIso(d: string, addDays = 0): string {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + addDays);
  return x.toISOString();
}

const p2 = (n: number) => String(n).padStart(2, "0");
/** YYYY-MM-DD по местному времени. */
const localDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const WD_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

/** «5 октября» или «29 сентября — 5 октября» — подпись периода. */
function periodText(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  const one = (d: Date, year: boolean) => `${d.getDate()} ${MONTHS[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ""}`;
  if (from === to) return one(a, false);
  const years = a.getFullYear() !== b.getFullYear();
  return `${one(a, years)} — ${one(b, years)}`;
}

/** Заголовок дня: «Сегодня · 5 октября», «Вчера · …» или «3 октября · пятница». */
function dayTitle(day: string): { title: string; sub: string } {
  const d = new Date(`${day}T00:00:00`);
  const words = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (day === todayIso()) return { title: "Сегодня", sub: words };
  if (day === todayIso(-1)) return { title: "Вчера", sub: words };
  return { title: words, sub: WEEKDAYS[d.getDay()] };
}

type DayStat = { day: string; issues: number; items: number; sale: number };
type Bucket = { key: string; label: string; tip: string; issues: number; sale: number; now: boolean };

/** Столбики графика: по дням (до месяца), по неделям (до ~4 месяцев), дальше — по месяцам. */
function buckets(from: string, to: string, byDay: DayStat[]): { unit: "day" | "week" | "month"; list: Bucket[] } {
  const stat = new Map(byDay.map((d) => [d.day, d]));
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const unit = days <= 31 ? "day" : days <= 120 ? "week" : "month";
  const today = todayIso();
  const out = new Map<string, Bucket>();
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = localDay(d);
    let key: string, label: string, tip: string;
    if (unit === "day") {
      key = day;
      label = days <= 7 ? WD_SHORT[d.getDay()] : String(d.getDate());
      tip = `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}`;
    } else if (unit === "week") {
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const first = mon < start ? start : mon;
      key = localDay(mon);
      label = `${p2(first.getDate())}.${p2(first.getMonth() + 1)}`;
      tip = `неделя с ${first.getDate()} ${MONTHS[first.getMonth()]}`;
    } else {
      key = day.slice(0, 7);
      label = MONTHS_SHORT[d.getMonth()];
      tip = `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
    }
    const b = out.get(key) ?? { key, label, tip, issues: 0, sale: 0, now: false };
    const s = stat.get(day);
    if (s) {
      b.issues += s.issues;
      b.sale += s.sale;
    }
    if (day === today) b.now = true;
    out.set(key, b);
  }
  return { unit, list: [...out.values()] };
}

/**
 * График выдач за период: столбики на светлых дорожках, высота — сумма.
 * Над лучшим днём — его доля; при наведении — дата, сумма, доля от всего периода и число выдач.
 */
function HistoryChart({ period, byDay }: { period: Period; byDay: DayStat[] }) {
  const { unit, list } = useMemo(() => buckets(period.date_from, period.date_to, byDay), [period.date_from, period.date_to, byDay]);
  const total = list.reduce((a, b) => a + b.sale, 0);
  const max = Math.max(1, ...list.map((b) => b.sale));
  const best = list.reduce<Bucket | null>((a, b) => (b.sale > (a?.sale ?? 0) ? b : a), null);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  // Подписи: не больше ~7, последняя — всегда.
  const every = Math.max(1, Math.ceil(list.length / 7));
  const shown = (i: number) => (list.length - 1 - i) % every === 0;
  return (
    <div className="iss-chart">
      <div style={css("display:flex;align-items:baseline;gap:8px;margin-bottom:6px")}>
        <span style={css("font-size:12.5px;font-weight:500;color:var(--text)")}>Выдачи {unit === "day" ? "по дням" : unit === "week" ? "по неделям" : "по месяцам"}</span>
        <span style={css(NUM + ";margin-left:auto;font-size:11.5px;color:var(--text-4);white-space:nowrap")}>{total ? `всего ${som(total)}` : "выдач не было"}</span>
      </div>
      <div className="iss-cols">
        {list.map((b, i) => {
          const h = b.issues ? Math.max(7, Math.round((b.sale / max) * 100)) : 0;
          return (
            <div
              key={b.key}
              tabIndex={0}
              aria-label={`${b.tip}: ${b.issues ? `${b.issues} ${plural(b.issues, "выдача", "выдачи", "выдач")}, ${som(b.sale)}, ${pct(b.sale)}%` : "выдач не было"}`}
              className={"iss-col" + (b.now ? " now" : "") + (i < 2 ? " first" : i >= list.length - 2 ? " last" : "")}
            >
              {best && best.key === b.key && b.sale > 0 && (
                <span className="iss-col-top" style={{ bottom: `calc(${h}% + 5px)` }}>
                  {pct(b.sale)}%
                </span>
              )}
              {h > 0 && <span className="iss-col-fill" style={{ height: `${h}%` }} />}
              <span className="iss-tip">
                <span style={css("display:block;font-size:11px;color:rgba(255,255,255,.65)")}>{b.tip}</span>
                {b.issues ? (
                  <>
                    <span style={css(NUM + ";display:flex;align-items:center;gap:7px;margin-top:3px;font-size:14px;font-weight:600")}>
                      {som(b.sale)}
                      <span style={css("font-size:11px;font-weight:600;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.16)")}>{pct(b.sale)}% периода</span>
                    </span>
                    <span style={css(NUM + ";display:block;font-size:11px;color:rgba(255,255,255,.65);margin-top:1px")}>
                      {b.issues} {plural(b.issues, "выдача", "выдачи", "выдач")}
                    </span>
                  </>
                ) : (
                  <span style={css("display:block;margin-top:2px")}>выдач не было</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="iss-cols iss-xl">
        {list.map((b, i) => (
          <span key={b.key} style={mix(b.now ? "color:var(--accent-strong);font-weight:600" : "")}>
            {shown(i) ? b.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Цвета денег выданного: оплачено заранее, принято при выдаче, долг — одни и те же в кольце, полосе, строках и точках ленты. */
const MONEY = {
  before: "var(--accent)",
  now: "var(--green-dot)",
  debt: "var(--danger-dot)",
} as const;
/** Те же доли — градиентом для кольца и полосы. */
const MONEY_GRAD = {
  before: ["#6A8BFF", "#3E63DD"],
  now: ["#4ADE80", "#16A34A"],
  debt: ["#F87171", "#DC2626"],
} as const;

/**
 * Кольцо: из чего сложилась сумма выданного; в центре — сколько оплачено.
 * Каждая доля — точная дуга с прямыми концами и ровным промежутком 3px; маленькая доля
 * получает хотя бы 6° (за счёт самой большой), чтобы её было видно и она ни к чему не липла.
 */
const RING = { size: 116, r: 46, w: 12 };

function ringPoint(deg: number): string {
  const a = ((deg - 90) * Math.PI) / 180;
  const c = RING.size / 2;
  return `${(c + RING.r * Math.cos(a)).toFixed(3)} ${(c + RING.r * Math.sin(a)).toFixed(3)}`;
}

function ringArc(from: number, to: number): string {
  return `M ${ringPoint(from)} A ${RING.r} ${RING.r} 0 ${to - from > 180 ? 1 : 0} 1 ${ringPoint(to)}`;
}

function IssueRing({ before, now, debt }: { before: number; now: number; debt: number }) {
  const total = before + now + debt;
  const parts = (
    [
      { k: "before", v: before },
      { k: "now", v: now },
      { k: "debt", v: debt },
    ] as const
  ).filter((p) => p.v > 0);
  const gap = parts.length > 1 ? (3 / RING.r) * (180 / Math.PI) : 0;
  const minSpan = 6 + gap;
  // Доли в градусах; слишком маленькие дотягиваем до minSpan, разницу забираем у самой большой.
  const spans = parts.map((p) => (p.v / total) * 360);
  let extra = 0;
  spans.forEach((s, i) => {
    if (s < minSpan) {
      extra += minSpan - s;
      spans[i] = minSpan;
    }
  });
  if (extra > 0) spans[spans.indexOf(Math.max(...spans))] -= extra;
  let at = 0;
  const arcs = parts.map((p, i) => {
    const from = at + gap / 2;
    const to = at + spans[i] - gap / 2;
    at += spans[i];
    return { k: p.k, d: ringArc(from, to) };
  });
  const paid = total > 0 ? Math.round(((before + now) / total) * 100) : 0;
  const c = RING.size / 2;
  return (
    <div style={mix("position:relative;flex:none", { width: RING.size, height: RING.size })}>
      <svg width={RING.size} height={RING.size} viewBox={`0 0 ${RING.size} ${RING.size}`} shapeRendering="geometricPrecision" style={css("display:block")}>
        <defs>
          {(Object.keys(MONEY_GRAD) as (keyof typeof MONEY_GRAD)[]).map((k) => (
            <linearGradient key={k} id={`issRing-${k}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={RING.size} y2={RING.size}>
              <stop offset="0%" stopColor={MONEY_GRAD[k][0]} />
              <stop offset="100%" stopColor={MONEY_GRAD[k][1]} />
            </linearGradient>
          ))}
          <radialGradient id="issRing-inner" cx="50%" cy="35%" r="70%">
            <stop offset="0%" style={{ stopColor: "color-mix(in srgb, var(--accent) 10%, var(--surface))" }} />
            <stop offset="100%" style={{ stopColor: "var(--surface)" }} />
          </radialGradient>
        </defs>
        <circle cx={c} cy={c} r={RING.r - RING.w / 2 - 1} fill="url(#issRing-inner)" />
        <circle cx={c} cy={c} r={RING.r} fill="none" stroke="var(--border-2)" strokeWidth={RING.w} />
        {parts.length === 1 ? (
          <circle cx={c} cy={c} r={RING.r} fill="none" stroke={`url(#issRing-${parts[0].k})`} strokeWidth={RING.w} />
        ) : (
          arcs.map((a) => (
            <path key={a.k} className="ring-grow" d={a.d} fill="none" stroke={`url(#issRing-${a.k})`} strokeWidth={RING.w} strokeLinecap="butt" pathLength={100} strokeDasharray="100 100" />
          ))
        )}
      </svg>
      <div style={css("position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center")}>
        <span style={mix(NUM + ";font-size:25px;font-weight:600;letter-spacing:-.02em;line-height:1", { color: total > 0 ? "var(--text)" : "var(--text-4)" })}>
          {total > 0 ? <CountUp text={`${paid}%`} /> : "—"}
        </span>
        <span style={css("font-size:11px;color:var(--text-4);margin-top:3px")}>оплачено</span>
      </div>
    </div>
  );
}

/** Полоса долей: оплачено заранее / при выдаче / долг. */
function SplitBar({ parts }: { parts: { k: keyof typeof MONEY_GRAD; v: number }[] }) {
  const total = parts.reduce((a, p) => a + p.v, 0);
  return (
    <div className="iss-split bar-grow">
      {total > 0 &&
        parts
          .filter((p) => p.v > 0)
          .map((p) => (
            <span key={p.k} style={{ flex: `${p.v} 1 0`, minWidth: 6, background: `linear-gradient(90deg, ${MONEY_GRAD[p.k][0]}, ${MONEY_GRAD[p.k][1]})` }} />
          ))}
    </div>
  );
}

function MoneyLine({ dot, label, value, share }: { dot: string; label: string; value: number; share: number }) {
  return (
    <div style={css("display:grid;grid-template-columns:auto minmax(0,1fr) auto 44px;align-items:center;gap:8px;min-width:0")}>
      <span style={mix("width:8px;height:8px;border-radius:50%", { background: dot })} />
      <span style={css("font-size:12.5px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{label}</span>
      <b style={mix(NUM + ";font-size:13px;font-weight:500;white-space:nowrap", { color: value ? "var(--text)" : "var(--text-4)" })}>
        <CountUp text={som(value)} />
      </b>
      <span
        style={mix(NUM + ";justify-self:end;font-size:11px;font-weight:500;padding:2px 6px;border-radius:6px", {
          background: value ? `color-mix(in srgb, ${dot} 14%, transparent)` : "var(--hover)",
          color: value ? dot : "var(--text-4)",
        })}
      >
        {share}%
      </span>
    </div>
  );
}

const I_RECEIPT: PathDef = [
  ["path", { d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" }],
  ["path", { d: "M8 8h8" }],
  ["path", { d: "M8 12h8" }],
  ["path", { d: "M8 16h5" }],
];
const I_TROPHY: PathDef = [
  ["path", { d: "M8 21h8" }],
  ["path", { d: "M12 17v4" }],
  ["path", { d: "M7 4h10v5a5 5 0 0 1-10 0V4Z" }],
  ["path", { d: "M17 5h3v2a3 3 0 0 1-3 3" }],
  ["path", { d: "M7 5H4v2a3 3 0 0 0 3 3" }],
];

const TILE_GRAD = {
  violet: "linear-gradient(135deg,#A78BFA,#7C3AED)",
  accent: "linear-gradient(135deg,#6A8BFF,#3E63DD)",
  green: "linear-gradient(135deg,#34D399,#0EA5E9)",
  amber: "linear-gradient(135deg,#FBBF24,#F97316)",
} as const;

/** Плитка итога: яркий значок, подпись, число и пояснение. */
function SumTile({ icon, tone, label, value, sub }: { icon: ReactNode; tone: keyof typeof TILE_GRAD; label: string; value: string; sub: string }) {
  return (
    <div className="iss-tile">
      <div style={css("display:flex;align-items:center;gap:8px;min-width:0")}>
        <span style={mix("width:26px;height:26px;border-radius:8px;flex:none;display:grid;place-items:center;color:#fff;box-shadow:0 4px 10px -4px rgba(15,18,25,.35)", { background: TILE_GRAD[tone] })}>
          {icon}
        </span>
        <span style={css("font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{label}</span>
      </div>
      <div>
        <div style={mix(NUM + ";font-size:18px;font-weight:500;letter-spacing:-.01em;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: value === "—" ? "var(--text-5)" : "var(--text)" })}>
          <CountUp text={value} />
        </div>
        <div style={css("font-size:11px;color:var(--text-4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{sub}</div>
      </div>
    </div>
  );
}

const LIMIT = 20;

function IssueHistory({ toast }: { toast: Toast }) {
  const [period, setPeriod] = useState<Period>(() => periodOf("7"));
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<IssueList | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    listIssues({
      q,
      since: dayStartIso(period.date_from),
      until: dayStartIso(period.date_to, 1),
      limit: LIMIT,
      offset,
      tz: -new Date().getTimezoneOffset(),
    })
      .then(setData)
      .catch(() => setData({ rows: [], total: 0, summary: { items: 0, qty: 0, sale: 0, customers: 0 }, by_day: [] }));
  }, [q, period.date_from, period.date_to, offset]);
  useEffect(load, [load]);
  useEffect(() => setOffset(0), [q, period.date_from, period.date_to]);
  // Новая страница или период — лента снова с начала.
  // В фигурных скобках: свежий Chrome возвращает из scrollTo промис, а эффект должен вернуть ничего.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [offset, q, period.date_from, period.date_to]);
  useRefresh(load);

  const byDay = useMemo(() => data?.by_day ?? [], [data]);
  // Строки этой страницы — по дням; итоги дня берём с сервера (весь день, а не только эта страница).
  const groups = useMemo(() => {
    const g: { day: string; rows: IssueRow[] }[] = [];
    for (const r of data?.rows ?? []) {
      const day = localDay(new Date(r.issued_at));
      const last = g[g.length - 1];
      if (last && last.day === day) last.rows.push(r);
      else g.push({ day, rows: [r] });
    }
    return g;
  }, [data]);

  const s = data?.summary;
  const debt = s?.debt ?? 0;
  const now = s?.paid_now ?? 0;
  const before = s ? Math.max(0, s.sale - debt - now) : 0;
  const share = (v: number) => (s && s.sale ? Math.round((v / s.sale) * 100) : 0);
  const avg = s && data.total ? Math.round(s.sale / data.total) : 0;
  const best = byDay.reduce<DayStat | null>((a, d) => (d.sale > (a?.sale ?? 0) ? d : a), null);
  const bestDate = best ? new Date(`${best.day}T00:00:00`) : null;

  return (
    <section className="iss-hist" style={css(CARD + ";overflow:hidden")}>
      {/* Слева — сводка за период */}
      <aside className="iss-hist-side">
        <div style={css("display:flex;align-items:center;gap:11px;min-width:0")}>
          <span style={css("width:36px;height:36px;border-radius:11px;flex:none;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#6A8BFF,#7C3AED);box-shadow:0 8px 18px -8px rgba(62,99,221,.7)")}>
            <Icon name="issue" size={18} />
          </span>
          <div style={css("min-width:0")}>
            <div style={css(TITLE)}>История выдач</div>
            <div style={css("font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{periodText(period.date_from, period.date_to)}</div>
          </div>
        </div>

        <div className="iss-hero">
          <div style={css("position:relative;display:flex;align-items:center;gap:16px;min-width:0")}>
            <IssueRing before={before} now={now} debt={debt} />
            <div style={css("flex:1;min-width:0")}>
              <div style={css("font-size:12px;color:var(--text-3)")}>Выдано на сумму</div>
              <div style={css(NUM + ";font-size:27px;font-weight:500;letter-spacing:-.02em;line-height:1.15;margin-top:2px;white-space:nowrap")}>{s ? <CountUp text={som(s.sale)} /> : "—"}</div>
              <div style={css(NUM + ";font-size:11.5px;color:var(--text-4);margin-top:3px")}>
                {data ? `${data.total} ${plural(data.total, "выдача", "выдачи", "выдач")}${byDay.length ? ` за ${byDay.length} ${plural(byDay.length, "день", "дня", "дней")}` : ""}` : "…"}
              </div>
            </div>
          </div>
          <div style={css("position:relative;display:flex;flex-direction:column;gap:9px;margin-top:16px")}>
            <SplitBar
              parts={[
                { k: "before", v: before },
                { k: "now", v: now },
                { k: "debt", v: debt },
              ]}
            />
            <MoneyLine dot={MONEY.before} label="Оплачено заранее" value={before} share={share(before)} />
            <MoneyLine dot={MONEY.now} label="Принято при выдаче" value={now} share={share(now)} />
            <MoneyLine dot={MONEY.debt} label="Долг по выданным" value={debt} share={share(debt)} />
          </div>
        </div>

        <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:10px")}>
          <SumTile icon={<Icon name="customers" size={14} />} tone="violet" label="Клиентов" value={s ? String(s.customers) : "—"} sub="забрали товар" />
          <SumTile icon={<Icon name="stock" size={14} />} tone="accent" label="Товаров" value={s ? String(s.items) : "—"} sub={s ? `${s.qty} шт` : " "} />
          <SumTile icon={<Svg paths={I_RECEIPT} size={14} sw={2} />} tone="green" label="В среднем" value={avg ? som(avg) : "—"} sub="на одну выдачу" />
          <SumTile
            icon={<Svg paths={I_TROPHY} size={14} sw={2} />}
            tone="amber"
            label="Лучший день"
            value={best ? som(best.sale) : "—"}
            sub={bestDate ? `${bestDate.getDate()} ${MONTHS[bestDate.getMonth()]} · ${best!.issues} ${plural(best!.issues, "выдача", "выдачи", "выдач")}` : "выдач не было"}
          />
        </div>

        <HistoryChart period={period} byDay={byDay} />
      </aside>

      {/* Справа — фильтры и лента выдач: ровно по высоте сводки, остальное — прокруткой */}
      <div className="iss-hist-main">
        <div style={css("flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:14px 18px;border-bottom:1px solid var(--border-2)")}>
          <PeriodPicker value={period} onChange={setPeriod} />
          <span style={css("flex:1")} />
          <SearchInput value={query} onChange={setQuery} placeholder="Клиент или телефон…" width={220} />
        </div>

        <div ref={listRef} className="iss-hist-list thin-scroll">
          {!data ? (
            <div style={css("padding:16px 18px")}>
              <SkeletonRows rows={4} />
            </div>
          ) : data.rows.length === 0 ? (
            <Empty icon="issue" title={q ? "Ничего не найдено" : "За этот период выдач нет"} text="Выберите другой период или измените поиск" />
          ) : (
            <>
              {groups.map((g) => {
                const t = dayTitle(g.day);
                const stat = byDay.find((d) => d.day === g.day);
                const n = stat?.issues ?? g.rows.length;
                const sale = stat?.sale ?? g.rows.reduce((a, r) => a + r.items.reduce((x, i) => x + i.sale, 0), 0);
                return (
                  <div key={g.day}>
                    <div className="iss-tl-day">
                      <span style={css("font-size:13.5px;font-weight:500;color:var(--text)")}>{t.title}</span>
                      <span style={css("font-size:12px;color:var(--text-4)")}>{t.sub}</span>
                      <span style={css("flex:1;min-width:12px;border-bottom:1px solid var(--border-2);transform:translateY(-4px)")} />
                      <span style={css(NUM + ";font-size:12px;color:var(--text-3);white-space:nowrap")}>
                        {n} {plural(n, "выдача", "выдачи", "выдач")} · <span style={css("font-weight:500;color:var(--text-2)")}>{som(sale)}</span>
                      </span>
                    </div>
                    {g.rows.map((r, i) => (
                      <TimelineRow key={r.id} r={r} first={i === 0} last={i === g.rows.length - 1} onOpen={setOpen} />
                    ))}
                  </div>
                );
              })}
              <div style={css("padding:0 18px 22px")}>
                <Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />
              </div>
            </>
          )}
        </div>
      </div>
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </section>
  );
}

/**
 * Одна выдача в ленте: время, точка (цвет — как оплатили: заранее, при выдаче или в долг),
 * клиент и кто выдал, товары (первые четыре, остальное — по нажатию), сумма и оплата.
 */
function TimelineRow({ r, first, last, onOpen }: { r: IssueRow; first: boolean; last: boolean; onOpen: (id: number) => void }) {
  const [all, setAll] = useState(false);
  const sum = r.items.reduce((acc, i) => acc + i.sale, 0);
  const debt = r.items.reduce((acc, i) => acc + i.debt, 0);
  const paidNow = r.paid_now ?? 0;
  const tone = debt > 0 ? MONEY.debt : paidNow > 0 ? MONEY.now : MONEY.before;
  const shown = all ? r.items : r.items.slice(0, 4);
  const more = r.items.length - shown.length;
  return (
    <div className={"iss-tl" + (first ? " first" : "") + (last ? " last" : "")}>
      <span style={css(NUM + ";font-size:12.5px;color:var(--text-3);padding-top:1px")}>{hhmm(r.issued_at)}</span>
      <span className="iss-tl-dot">
        <i style={{ background: tone }} />
      </span>
      <div style={css("min-width:0")}>
        <div style={css("display:flex;align-items:baseline;gap:8px;min-width:0")}>
          <span style={css("font-size:13.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0")}>{r.customer_name}</span>
          <span style={css(NUM + ";font-size:12px;color:var(--text-3);white-space:nowrap")}>{r.customer_phone}</span>
          {r.user_login && (
            <span className="iss-hide" style={css("font-size:12px;color:var(--text-4);white-space:nowrap")}>
              · выдал {r.user_login}
            </span>
          )}
        </div>
        <div className="iss-hide" style={css("display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;min-width:0")}>
          {shown.map((i) => (
            <HButton
              key={i.id}
              onClick={() => onOpen(i.id)}
              title={i.code || undefined}
              s="max-width:100%;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border:1px solid var(--border-2);border-radius:7px;background:var(--surface-2);cursor:pointer;font:inherit;font-size:12px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
              hover="border-color:var(--accent);color:var(--accent-strong)"
            >
              {i.name}
              {i.qty > 1 && <span style={css(NUM + ";color:var(--text-4)")}>× {i.qty}</span>}
            </HButton>
          ))}
          {more > 0 && (
            <HButton
              onClick={() => setAll(true)}
              title={r.items
                .slice(4)
                .map((i) => i.name)
                .join(", ")}
              s="display:inline-flex;align-items:center;height:24px;padding:0 9px;border:1px dashed var(--border-strong);border-radius:7px;background:transparent;cursor:pointer;font:inherit;font-size:12px;color:var(--text-3);white-space:nowrap"
              hover="border-color:var(--accent);color:var(--accent-strong)"
            >
              ещё {more}
            </HButton>
          )}
        </div>
        <div className="iss-sm" style={css("font-size:12px;color:var(--text-2);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
          {r.items.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)).join(", ")}
        </div>
      </div>
      <div style={css("text-align:right;min-width:0")}>
        <div style={css(NUM + ";font-size:14px;font-weight:500;color:var(--text);white-space:nowrap")}>{som(sum)}</div>
        <div style={css(NUM + ";font-size:12px;white-space:nowrap;margin-top:2px")}>
          {debt > 0 ? (
            <span style={css("color:var(--danger)")}>долг {som(debt)}</span>
          ) : paidNow > 0 ? (
            <span style={css("color:var(--green)")}>принято {som(paidNow)}</span>
          ) : (
            <span style={css("color:var(--text-4)")}>оплачено заранее</span>
          )}
        </div>
      </div>
    </div>
  );
}
