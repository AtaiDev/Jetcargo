/**
 * Приём товара сканером.
 *
 * Сканер работает как клавиатура: «печатает» код и жмёт Enter. Поле всегда в фокусе.
 * Скан товара «Заказан» сразу ставит его «На складе» (это видно и в «Заказах»),
 * повторный скан только пишется в историю.
 *
 * Экран — две колонки:
 *  - справа — «пульт сканера» (высота по содержимому): поле кода, режим, партия и что в ней,
 *    звук, итоги дня (прогресс приёма и строка чисел);
 *  - слева — результат последнего скана: строка статуса, затем товар с трек-кодом и долгом,
 *    клиент с телефоном и тихая строка подробностей (без кнопок: клик по товару или клиенту
 *    открывает карточку); под ним таблица сканов за сегодня: колонка не ниже пульта и растёт
 *    со сканами до высоты экрана, дальше прокрутка внутри таблицы.
 *  Данные с сервера — не пропадают при перезагрузке. На телефоне пульт — сверху.
 */
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { createBatch, currentShipment, listBatches, listScans, lookupCode, scanCode, assignCode, listCustomers, type CustomerRow, type Item, type Batch, type BatchCalc, type ReceivingShipment, type ScanResponse, type ScanResult, type ScanRow } from "../api/domain";
import { HomeHead } from "./overview/Home";
import ItemModal from "../components/ItemModal";
import CountUp from "../design/CountUp";
import { I_CHECK, I_SEARCH, Icon, Svg } from "../design/icons";
import { LogoMark } from "../design/Logo";
import { Page } from "../design/table";
import { ModalError } from "../design/ui";
import { som, todayIso } from "../lib/cargo";
import { emit, useDebounced, useRefresh } from "../lib/events";
import { scanSound, setSoundPrefs, useSoundPrefs, type ScanEvent } from "../lib/sound";

type Toast = (kind: "success" | "error", text: string) => void;
type PathDef = [string, Record<string, unknown>][];


const I_REPEAT: PathDef = [
  ["path", { d: "M3 12a9 9 0 0 1 15.5-6.2L21 8" }],
  ["path", { d: "M21 3v5h-5" }],
  ["path", { d: "M21 12a9 9 0 0 1-15.5 6.2L3 16" }],
  ["path", { d: "M3 21v-5h5" }],
];
const I_ALERT: PathDef = [
  ["circle", { cx: 12, cy: 12, r: 9 }],
  ["path", { d: "M12 7.5v5.5" }],
  ["path", { d: "M12 16.5h.01" }],
];
const I_OUT: PathDef = [
  ["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }],
  ["path", { d: "m16 17 5-5-5-5" }],
  ["path", { d: "M21 12H9" }],
];

const TONE: Record<ScanResult | "lookup", { bg: string; fg: string; dot: string; title: string; hint: string; icon: PathDef }> = {
  arrived: { bg: "var(--green-tint)", fg: "var(--green)", dot: "var(--green-dot)", title: "Принят на склад", hint: "статус: «На складе»", icon: I_CHECK },
  already_in_stock: { bg: "var(--amber-tint)", fg: "var(--amber)", dot: "var(--amber-dot)", title: "Уже на складе", hint: "повторный скан — ничего не изменено", icon: I_REPEAT },
  already_issued: { bg: "var(--muted-bg)", fg: "var(--text-2)", dot: "var(--text-4)", title: "Уже выдан клиенту", hint: "повторный скан — ничего не изменено", icon: I_OUT },
  not_found: { bg: "var(--danger-tint)", fg: "var(--danger)", dot: "var(--danger-dot)", title: "Код не найден", hint: "ни у одного товара нет такого кода", icon: I_ALERT },
  lookup: { bg: "var(--violet-tint)", fg: "var(--violet)", dot: "var(--violet-dot)", title: "Найден", hint: "только просмотр — ничего не изменено", icon: I_SEARCH },
};

/** Какое событие звучит на результат скана — сами звуки выбираются в «Настройках». */
const SOUND_OF: Record<ScanResult | "lookup", ScanEvent> = {
  lookup: "repeat",
  arrived: "arrived",
  already_in_stock: "repeat",
  already_issued: "issued",
  not_found: "not_found",
};

/** Режим работы сканера: приём в партию, приём без партии или только поиск. */
type Mode = "batch" | "none" | "search";
const MODES: { key: Mode; short: string; sub: string; icon: ReactNode }[] = [
  { key: "batch", short: "В партию", sub: "на склад и в партию", icon: <Icon name="batches" size={15} /> },
  { key: "none", short: "Без партии", sub: "только на склад", icon: <Icon name="receive" size={15} /> },
  { key: "search", short: "Поиск", sub: "только посмотреть", icon: <Svg paths={I_SEARCH} size={15} /> },
];

/** Значение «партия за сегодня» в выпадающем списке. */
const TODAY = "today";
/** «2026-09-30» → «Партия от 30.09.2026». */
const batchNameFor = (iso: string) => `Партия от ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
/** Локальная дата (YYYY-MM-DD) момента в ISO. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Локальная полночь в ISO — граница «сегодня» для истории сканов. */
function todayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}



export default function Receive({ toast }: { toast: Toast }) {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState<ScanResponse | null>(null);
  const [lastAt, setLastAt] = useState<string>("");
  const [today, setToday] = useState<ScanRow[]>([]);
  // Партия из Китая: undefined — ещё грузится, null — накладных нет. shipCode — последний код приёма.
  const [ship, setShip] = useState<ReceivingShipment | null | undefined>(undefined);
  const shipCode = useRef("");
  const [open, setOpen] = useState<number | null>(null);
  // Звук вкл/выкл — общий с «Настройками» и запоминается в этом браузере.
  const sound = useSoundPrefs().on;
  const [flashId, setFlashId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Партия, в которую идёт приём. По умолчанию — «Партия от <сегодня>»: если её ещё нет,
  // она создаётся при первом принятом скане. Ручной выбор помнится только до конца дня.
  const [batches, setBatches] = useState<(Batch & { calc: BatchCalc })[]>([]);
  const [sel, setSel] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cargo_batch_pick") ?? "null") as { day: string; value: string } | null;
      return saved && saved.day === todayIso() && saved.value ? saved.value : TODAY;
    } catch {
      return TODAY;
    }
  });
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cargo_receive_mode") ?? "null") as { day: string; mode: Mode } | null;
      return saved && saved.day === todayIso() ? saved.mode : "batch";
    } catch {
      return "batch";
    }
  });
  const pickMode = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem("cargo_receive_mode", JSON.stringify({ day: todayIso(), mode: m }));
    } catch {
      /* приватный режим */
    }
    refocus();
  };
  const pickBatch = (value: string) => {
    setSel(value);
    try {
      localStorage.setItem("cargo_batch_pick", JSON.stringify({ day: todayIso(), value }));
    } catch {
      /* приватный режим */
    }
    refocus();
  };
  const loadBatches = useCallback(() => {
    listBatches()
      .then((r) => {
        const open = r.filter((b) => b.status === "open");
        setBatches(open);
        // Выбранная вручную партия закрыта или удалена — возвращаемся к партии за сегодня.
        setSel((cur) => (cur !== TODAY && !open.some((b) => String(b.id) === cur) ? TODAY : cur));
      })
      .catch(() => setBatches([]));
  }, []);
  useEffect(loadBatches, [loadBatches]);
  const todayName = batchNameFor(todayIso());
  const todayBatch = batches.find((b) => b.name === todayName) ?? batches.find((b) => localDay(b.created_at) === todayIso());
  const batchId = sel === TODAY ? (todayBatch?.id ?? null) : Number(sel) || null;
  const creating = useRef<Promise<number> | null>(null);

  /** Id партии для скана; партию за сегодня создаём при первом скане (один раз). */
  async function batchForScan(): Promise<number | null> {
    if (mode !== "batch") return null;
    if (sel !== TODAY) return batchId;
    if (todayBatch) return todayBatch.id;
    if (!creating.current) {
      creating.current = createBatch(todayName)
        .then((b) => {
          toast("success", `Создана «${b.name}» — приём идёт в неё`);
          loadBatches();
          return b.id;
        })
        .finally(() => setTimeout(() => (creating.current = null), 3000));
    }
    return creating.current;
  }

  const refocus = () => setTimeout(() => inputRef.current?.focus(), 30);
  useEffect(() => {
    refocus();
  }, []);

  const loadToday = useCallback(() => {
    listScans({ since: todayStartIso(), active: 1, limit: 500 })
      .then((r) => setToday(r.rows))
      .catch(() => setToday([]));
    currentShipment(shipCode.current || undefined, todayStartIso())
      .then(setShip)
      .catch(() => {
        /* оставляем прошлые цифры */
      });
  }, []);
  useEffect(loadToday, [loadToday]);
  useRefresh(loadToday);

  async function submit() {
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = mode === "search" ? { ...(await lookupCode(c)), lookup: true } : await scanCode(c, await batchForScan());
      if (mode !== "search") shipCode.current = res.matched_code ?? c;
      setLast(res);
      setLastAt(new Date().toISOString());
      setFlashId(res.result === "arrived" ? (res.items[0]?.id ?? null) : null);
      scanSound(SOUND_OF[res.result]);
      if (res.result === "arrived") emit("cargo:changed");
      else if (mode !== "search") loadToday();
      setCode("");
    } catch (e) {
      setError(apiError(e, "Не удалось обработать код"));
      scanSound("not_found");
    } finally {
      setBusy(false);
      refocus();
    }
  }

  /** Неизвестный код — на выбранного клиента, сразу на склад и в текущую партию. */
  async function assign(customerId: number, name: string) {
    if (!last) return;
    const res = await assignCode(last.matched_code ?? last.code, customerId, name, await batchForScan());
    setLast(res);
    setLastAt(new Date().toISOString());
    setFlashId(res.items[0]?.id ?? null);
    scanSound("arrived");
    emit("cargo:changed");
    toast("success", "Товар принят на склад");
    refocus();
  }

  async function newBatch() {
    try {
      // Ещё одна партия за сегодня получает номер: «Партия от 30.09.2026 (2)».
      const same = batches.filter((b) => b.name.startsWith(todayName)).length;
      const b = await createBatch(same ? `${todayName} (${same + 1})` : todayName);
      loadBatches();
      pickBatch(same ? String(b.id) : TODAY);
      toast("success", `Создана «${b.name}» — приём идёт в неё`);
    } catch (e) {
      toast("error", apiError(e));
    }
  }

  const modeIx = MODES.findIndex((m) => m.key === mode);
  // Принят по коду без букв — свой цвет; повтор и «не найден» важнее и остаются своего цвета.
  // Общая посылка: один код — товары разных клиентов. Её надо разделить, поэтому свой цвет.
  const split = last ? new Set(last.items.map((i) => i.customer_id)).size : 0;
  const fx = !last ? "" : last.result === "arrived" && split > 1 ? "split" : last.result === "arrived" && last.matched_code ? "fix" : DOT[last.result];

  return (
    <Page size="wide">
      <div className="ov rx">
        <HomeHead title="Приём" />

        {/* ===== Партия из Китая ===== */}
        <ShipStrip ship={ship} onNotify={() => nav("/notify")} />

        <div className="rx-desk">
          {/* ===== Сканер ===== */}
          <section className="ov-card paper rx-sc">
            <header className="rx-sc-h">
              <h2 className="ov-card-title">Сканер</h2>
              <span className={"rx-ready" + (busy ? " busy" : "")}>{busy ? "обрабатываю…" : mode === "search" ? "только просмотр" : "готов к приёму"}</span>
              <button
                type="button"
                className={"rx-ibtn" + (sound ? "" : " off")}
                onClick={() => {
                  setSoundPrefs({ on: !sound });
                  if (!sound) scanSound("arrived");
                  refocus();
                }}
                title={sound ? "Звук включён — выключить" : "Звук выключен — включить"}
                aria-label={sound ? "Выключить звук" : "Включить звук"}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                  {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m22 9-6 6M16 9l6 6" />}
                </svg>
              </button>
            </header>

            {/* Видоискатель: поле кода внутри, лазер бежит, пока поле в фокусе */}
            <label className={"rx-vf" + (busy ? " busy" : "") + (fx ? " fx-" + fx : "")}>
              {/* Новый ключ на каждый скан: вспышка и углы запускаются заново, даже если статус тот же */}
              <Fragment key={lastAt}>
                <i className="rx-c tl" />
                <i className="rx-c tr" />
                <i className="rx-c bl" />
                <i className="rx-c br" />
                {last && <span className="rx-flash" aria-hidden />}
              </Fragment>
              <span className="rx-laser" aria-hidden />
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={mode === "search" ? "Код для просмотра" : "Сканируйте код"}
                aria-label="Код товара"
                autoComplete="off"
                spellCheck={false}
              />
              <small>{code ? "Enter — отправить" : split > 1 ? `общая посылка — разделить на ${split} ${plural(split, "клиента", "клиентов", "клиентов")}` : last?.matched_code ? `сканер прочитал без букв: ${last.matched_code}` : MODES[modeIx].sub}</small>
            </label>

            {error && <ModalError text={error} />}

            <div className="rx-modes-t" role="tablist" aria-label="Режим" style={{ "--i": modeIx } as CSSProperties}>
              <span className="rx-mt-thumb" aria-hidden />
              {MODES.map((m) => (
                <button key={m.key} type="button" role="tab" aria-selected={mode === m.key} className={mode === m.key ? "on" : ""} title={m.sub} onClick={() => pickMode(m.key)}>
                  {m.icon}
                  <b>{m.short}</b>
                </button>
              ))}
            </div>

            <BatchPicker
              value={sel}
              disabled={mode !== "batch"}
              options={[
                { value: TODAY, label: todayBatch ? todayBatch.name : todayName, hint: todayBatch ? `${todayBatch.calc.items} тов.` : "новая" },
                ...batches.filter((b) => b.id !== todayBatch?.id).map((b) => ({ value: String(b.id), label: b.name, hint: `${b.calc.items} тов.` })),
              ]}
              onPick={pickBatch}
              onClose={refocus}
              onNew={newBatch}
            />
          </section>

          {/* ===== Чек последнего скана ===== */}
          <Receipt
            last={last}
            at={lastAt}
            batches={batches}
            onOpen={setOpen}
            onUseCode={(c) => {
              setCode(c);
              refocus();
            }}
            onAssign={mode === "search" ? undefined : assign}
          />
        </div>

        {/* ===== Сканы за сегодня — таблицей ===== */}
        <Feed rows={today} flashId={flashId} onOpen={setOpen} onAll={() => nav("/warehouse?tab=scans")} />
      </div>

      {open !== null && (
        <ItemModal
          id={open}
          toast={toast}
          onClose={() => {
            setOpen(null);
            refocus();
          }}
        />
      )}
    </Page>
  );
}

// --- партия из Китая ------------------------------------------------------------------------------

const SHIP_I = {
  box: "M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
  card: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7ZM2 10h20M6 15h4",
  coins: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15 9.5c-.6-.9-1.7-1.5-3-1.5-1.7 0-3 1-3 2.2 0 2.8 6 1.5 6 4.3 0 1.2-1.3 2.2-3 2.2-1.3 0-2.4-.6-3-1.5M12 6.5v11",
};
const pc = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Ячейка партии: подпись, число и тонкая полоса доли. Подробности — во всплывающей подсказке. */
function ShipCell({
  label,
  value,
  unit,
  segs,
  hint,
  icon,
  side,
  dots,
  onClick,
}: {
  icon?: string;
  /** Короткая цифра справа от числа (доля, процент). */
  side?: string;
  /** Вместо полосы — точки по числу клиентов. */
  dots?: number;
  label: string;
  value?: string;
  unit?: string;
  segs?: { v: number; k: "a" | "b" | "c" }[];
  hint?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="rx-ship-h">
        <small>{label}</small>
        <span className="rx-ship-ic">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={onClick ? "M7 17 17 7M8 7h9v9" : icon} />
          </svg>
        </span>
      </span>
      <span className="rx-ship-v">
        {value === undefined ? (
          <span className="sk" style={{ width: "50%", height: 20 }} />
        ) : (
          <>
            <b>{value}</b>
            {unit && <span>{unit}</span>}
            {side && <em>{side}</em>}
          </>
        )}
      </span>
      {dots !== undefined ? (
        <span className="rx-ship-dots" aria-hidden>
          {Array.from({ length: Math.min(dots, 14) }, (_, i) => (
            <i key={i} style={{ animationDelay: `${i * 40}ms` }} />
          ))}
          {dots > 14 && <small>+{dots - 14}</small>}
        </span>
      ) : (
      <span className={"rx-ship-seg" + (segs ? "" : " none")}>
        {segs?.filter((s) => s.v > 0).map((s, i) => <i key={i} className={s.k} style={{ width: `${s.v}%` }} />)}
      </span>
      )}
    </>
  );
  return onClick ? (
    <button type="button" className="rx-ship-c link" onClick={onClick} title={hint}>
      {body}
    </button>
  ) : (
    <div className="rx-ship-c" title={hint}>
      {body}
    </div>
  );
}

/** Партия из Китая: один загруженный файл. Сколько уже отсканировано, что осталось, неизвестные и оплата. */
function ShipStrip({ ship, onNotify }: { ship: ReceivingShipment | null | undefined; onNotify: () => void }) {
  if (ship === null) {
    return (
      <section className="rx-ship empty">
        <div className="rx-ship-main">
          <div className="rx-ship-t">
            <b>Партия из Китая</b>
          </div>
          <div className="rx-ship-n">
            <b>Накладных пока нет</b>
          </div>
          <div className="rx-ship-t">
            <span>Загрузите файл из Китая в «Импорте» — здесь появится, сколько принято и сколько осталось.</span>
          </div>
        </div>
      </section>
    );
  }
  const s = ship;
  const pct = s && s.total ? Math.round((s.scanned / s.total) * 100) : 0;
  return (
    <section className="rx-ship">
      <div className="rx-ship-main">
        <div className="rx-ship-t">
          <b title={s ? s.waybill_list.map((w) => "№ " + w).join("\n") : undefined}>
            {!s ? "Партия …" : s.files > 1 ? `${s.files} партии вместе` : `Партия № ${s.waybill}${s.waybills > 1 ? ` +${s.waybills - 1}` : ""}`}
          </b>
          <span>{s?.files && s.files > 1 ? s.waybill_list.map((w) => "№ " + w.slice(-8)).join(" + ") : s?.shipped_at ? `отправлена ${s.shipped_at.split("-").reverse().join(".")}` : ""}</span>
        </div>
        <div className="rx-ship-n">
          <b>{s ? <CountUp text={String(s.scanned)} /> : "—"}</b>
          <span>из {s ? s.total : "—"} отсканировано</span>
          <em>{pct}%</em>
        </div>
        <span className="rx-ship-bar">
          <i style={{ width: `${pct}%` }} />
        </span>
      </div>
      <div className="rx-ship-cells">
        <ShipCell
          label="Осталось принять"
          icon={SHIP_I.box}
          side={s && `${pc(s.scanned, s.total)}%`}
          value={s && String(s.remaining)}
          unit={s && `/ ${s.total}`}
          segs={s ? [{ v: pc(s.scanned, s.total), k: "a" }] : []}
          hint={s && `принято ${s.scanned} из ${s.total}${s.boxes ? ` · коробок ${s.boxes}` : ""}`}
        />
        <ShipCell
          label="Неизвестные коды"
          icon={SHIP_I.help}
          side={s && s.unknown ? `скан ${s.unknown_scanned}` : undefined}
          value={s && String(s.unknown)}
          segs={s ? [{ v: pc(s.unknown_scanned, s.unknown), k: "a" }] : []}
          hint={s && (s.unknown ? `нет в заказах · отсканировано ${s.unknown_scanned} из ${s.unknown}` : "все коды есть в заказах")}
        />
        <ShipCell
          label="Оплачено"
          icon={SHIP_I.card}
          side={s && `${pc(s.paid_items, s.items)}%`}
          value={s && String(s.paid_items)}
          unit={s && `/ ${s.items}`}
          segs={
            s
              ? [
                  { v: pc(s.paid_items, s.items), k: "a" },
                  { v: pc(s.partial_items, s.items), k: "b" },
                ]
              : []
          }
          hint={s && `полностью ${s.paid_items} · частично ${s.partial_items} · без оплаты ${s.unpaid_items}`}
        />
        <ShipCell
          label="Долг"
          icon={SHIP_I.coins}
          side={s && s.sum ? `опл. ${pc(s.sum - s.debt, s.sum)}%` : undefined}
          value={s && som(s.debt)}
          segs={s ? [{ v: pc(s.sum - s.debt, s.sum), k: "a" }] : []}
          hint={s && `оплачено ${som(s.sum - s.debt)} из ${som(s.sum)}`}
        />
        <ShipCell label="Клиенты" value={s && String(s.customers)} side={s && "сообщить"} dots={s?.customers ?? 0} hint="Сообщить клиентам о приходе" onClick={s ? onNotify : undefined} />
      </div>
    </section>
  );
}

/** Пусто: три призрачные строки таблицы и подсказка поверх. */
function EmptyScans({ tab }: { tab: boolean }) {
  const W = [
    [62, 40, 70, 46],
    [48, 52, 54, 60],
    [56, 34, 64, 38],
  ];
  return (
    <div className="rx-ghost">
      {W.map((w, i) => (
        <div key={i} className="rx-tr rx-gr" aria-hidden style={{ opacity: 1 - i * 0.3, animationDelay: `${i * 60}ms` }}>
          <span className="sk" style={{ width: 38, height: 10 }} />
          <span className="rx-who">
            <span className="sk rx-sk-av" />
            <span className="rx-two" style={{ flex: 1 }}>
              <span className="sk" style={{ width: `${w[0]}%`, height: 10 }} />
              <span className="sk" style={{ width: `${w[1]}%`, height: 8, marginTop: 7 }} />
            </span>
          </span>
          <span className="rx-two">
            <span className="sk" style={{ width: `${w[2]}%`, height: 10 }} />
            <span className="sk" style={{ width: `${w[3]}%`, height: 8, marginTop: 7 }} />
          </span>
          <span className="sk" style={{ width: 22, height: 10, margin: "0 auto" }} />
          <span className="sk" style={{ width: 64, height: 10, margin: "0 auto" }} />
          <span className="sk" style={{ width: 72, height: 10, margin: "0 auto" }} />
          <span className="sk" style={{ width: 78, height: 10, margin: "0 auto" }} />
        </div>
      ))}
      <div className="rx-ghost-msg">
        <span className="rx-ghost-i">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M14 8v8M17 8v8" />
          </svg>
        </span>
        <span>
          <b>{tab ? "В этой вкладке пусто" : "Сегодня ещё ничего не сканировали"}</b>
          <small>{tab ? "сканы с этим статусом появятся здесь" : "наведите сканер на код — строка появится здесь"}</small>
        </span>
      </div>
    </div>
  );
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const initials = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? "?").slice(0, 2)) || "?").toUpperCase();
};

/** Статус — точкой и словом, без цветных рамок. */
const DOT: Record<ScanResult | "lookup", string> = {
  arrived: "ok",
  already_in_stock: "warn",
  already_issued: "info",
  not_found: "bad",
  lookup: "info",
};
const STATUS_SHORT: Record<ScanResult, string> = {
  arrived: "Принят",
  already_in_stock: "Повтор",
  already_issued: "Уже выдан",
  not_found: "Не найден",
};
const PAY_TEXT: Record<string, string> = { unpaid: "Не оплачено", partial: "Частично", paid: "Оплачено" };

// --- сканы за сегодня ------------------------------------------------------------------------------

type FeedTab = "all" | "arrived" | "repeat" | "not_found";
const inTab = (t: FeedTab, r: ScanRow) =>
  t === "all" || (t === "arrived" ? r.result === "arrived" : t === "repeat" ? r.result === "already_in_stock" || r.result === "already_issued" : r.result === "not_found");

function Feed({ rows, flashId, onOpen, onAll }: { rows: ScanRow[]; flashId: number | null; onOpen: (id: number) => void; onAll: () => void }) {
  const [tab, setTab] = useState<FeedTab>("all");
  const list = rows.filter((r) => inTab(tab, r));
  // Сканы одного клиента — одной строкой, раскрывается; без клиента (код не найден) — по одному.
  const groups: { key: string; rows: ScanRow[] }[] = [];
  const at = new Map<string, number>();
  for (const r of list) {
    const k = r.customer_id ? `c${r.customer_id}` : `s${r.id}`;
    if (at.has(k)) groups[at.get(k)!].rows.push(r);
    else {
      at.set(k, groups.length);
      groups.push({ key: k, rows: [r] });
    }
  }
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const tabs: { k: FeedTab; label: string }[] = [
    { k: "all", label: "Все" },
    { k: "arrived", label: "Приняты" },
    { k: "repeat", label: "Повторы" },
    { k: "not_found", label: "Не найдены" },
  ];
  return (
    <section className="rx-feed">
      <div className="rx-feed-bar">
        <div className="rx-tabs">
          {tabs.map((t) => (
            <button key={t.k} type="button" className={tab === t.k ? "on" : ""} onClick={() => setTab(t.k)}>
              {t.label}
              <span>{rows.filter((r) => inTab(t.k, r)).length}</span>
            </button>
          ))}
        </div>
        <button type="button" className="ov-btn sm" onClick={onAll}>
          Вся история сканов
        </button>
      </div>
      <div className="rx-table">
        <div className="rx-tr rx-th">
          <span>Время</span>
          <span>Клиент</span>
          <span>Товар</span>
          <span className="c">Кол-во</span>
          <span className="c">Сумма</span>
          <span className="c">Оплата</span>
          <span className="c">Статус</span>
        </div>
        {list.length === 0 ? (
          <EmptyScans tab={rows.length > 0} />
        ) : (
          groups.map((g, gi) =>
            g.rows.length === 1 ? (
              <ScanLine key={g.key} r={g.rows[0]} i={gi} fresh={flashId !== null && flashId === g.rows[0].order_item_id} onOpen={onOpen} />
            ) : (
              <ScanGroup key={g.key} rows={g.rows} i={gi} flashId={flashId} open={!!opened[g.key]} onToggle={() => setOpened((o) => ({ ...o, [g.key]: !o[g.key] }))} onOpen={onOpen} />
            )
          )
        )}
      </div>
    </section>
  );
}

function Who({ r }: { r: ScanRow }) {
  return (
    <span className="rx-who">
      {r.customer_name ? (
        <>
          <span className="rx-av">{initials(r.customer_name)}</span>
          <span className="rx-two">
            <b>{r.customer_name}</b>
            <small>{r.customer_phone}</small>
          </span>
        </>
      ) : (
        <>
          <span className="rx-av ghost">?</span>
          <span className="rx-two">
            <b className="rx-mute">Клиент не определён</b>
            <small>кода нет в заказах</small>
          </span>
        </>
      )}
    </span>
  );
}

/** Пустая ячейка у ненайденного кода — бледная полоска-скелетон вместо прочерка. */
const Ghost = ({ w }: { w: number }) => <span className="sk rx-gh" style={{ width: w }} />;

function ScanLine({ r, i, fresh, onOpen, sub }: { r: ScanRow; i: number; fresh: boolean; onOpen: (id: number) => void; sub?: boolean }) {
  return (
    <button
      type="button"
      className={"rx-tr" + (fresh ? " fresh" : "") + (sub ? " sub" : "")}
      style={sub ? undefined : { animationDelay: `${Math.min(i, 12) * 25}ms` }}
      onClick={() => r.order_item_id && onOpen(r.order_item_id)}
      disabled={!r.order_item_id}
    >
      <span className="rx-time">{hhmm(r.scanned_at)}</span>
      {sub ? (
        <span className="rx-rail" aria-hidden>
          <i>{i + 1}</i>
        </span>
      ) : (
        <Who r={r} />
      )}
      {sub ? (
        <span className="rx-subitem">
          <span className="rx-box" aria-hidden>
            <Icon name="products" size={15} />
          </span>
          <span className="rx-two">
            <b>{r.item_name ?? "Нет такого товара"}</b>
            <small>{r.code}</small>
          </span>
        </span>
      ) : (
        <span className="rx-two">
          <b>{r.item_name ?? "Нет такого товара"}</b>
          <small>{r.code}</small>
        </span>
      )}
      <span className="c">{r.qty ?? <Ghost w={18} />}</span>
      <span className="c rx-sum">{r.sale === null ? <Ghost w={56} /> : som(r.sale)}</span>
      <span className={"c rx-pay " + (r.pay_status ?? "")}>{r.pay_status ? PAY_TEXT[r.pay_status] : <Ghost w={72} />}</span>
      <span className="c">
        <span className={"rx-pill-st " + DOT[r.result]}>{STATUS_SHORT[r.result]}</span>
      </span>
    </button>
  );
}

const KIND_TEXT: Record<string, string> = { ok: "Принято", warn: "Повтор", info: "Выдан", bad: "Не найдено" };
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100;
  const b = n % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

/** Несколько сканов одного клиента: сводка строкой, по клику плавно раскрываются товары. */
function ScanGroup({ rows, i, flashId, open, onToggle, onOpen }: { rows: ScanRow[]; i: number; flashId: number | null; open: boolean; onToggle: () => void; onOpen: (id: number) => void }) {
  const first = rows[0];
  // Деньги и штуки — по разным товарам: повторный скан того же товара не удваивает сумму.
  const uniq = [...new Map(rows.filter((r) => r.order_item_id).map((r) => [r.order_item_id, r])).values()];
  const qty = uniq.reduce((a, r) => a + (r.qty ?? 0), 0);
  const sum = uniq.reduce((a, r) => a + (r.sale ?? 0), 0);
  const debt = uniq.reduce((a, r) => a + (r.debt ?? 0), 0);
  const by = (k: string) => rows.filter((r) => DOT[r.result] === k).length;
  const kinds = (["ok", "warn", "info", "bad"] as const).filter((k) => by(k));
  return (
    <div className={"rx-grp" + (open ? " open" : "")} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
      <button type="button" className={"rx-tr rx-grp-h" + (flashId !== null && flashId === first.order_item_id ? " fresh" : "")} onClick={onToggle} aria-expanded={open}>
        <span className="rx-time">{hhmm(first.scanned_at)}</span>
        <span className="rx-who">
          <span className="rx-av">{initials(first.customer_name ?? "?")}</span>
          <span className="rx-two">
            <b>{first.customer_name}</b>
            <small>{first.customer_phone}</small>
          </span>
        </span>
        <span className="rx-cnt">
          <span className="rx-box dark" aria-hidden>
            <Icon name="products" size={15} />
          </span>
          <span className="rx-two">
            <b>
              {uniq.length} {plural(uniq.length, "товар", "товара", "товаров")}
            </b>
            <small>{open ? "свернуть" : "показать все"}</small>
          </span>
        </span>
        <span className="c">{qty || "—"}</span>
        <span className="c rx-sum">{sum ? som(sum) : "—"}</span>
        <span className={"c rx-pay " + (debt > 0 ? "" : "paid")}>{debt > 0 ? `долг ${som(debt)}` : "Оплачено"}</span>
        <span className="c rx-mix">
          {kinds.map((k) => (
            <span key={k} className={"rx-pill-st " + k}>
              {KIND_TEXT[k]} {by(k)}
            </span>
          ))}
        </span>
      </button>
      <div className="rx-acc">
        <div className="rx-acc-in">
          {rows.map((r, j) => (
            <ScanLine key={r.id} r={r} i={j} sub fresh={flashId !== null && flashId === r.order_item_id} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </div>
  );
}

// --- партия приёма: свой выпадающий список --------------------------------------------------------------

function BatchPicker({
  value,
  options,
  disabled,
  onPick,
  onClose,
  onNew,
}: {
  value: string;
  options: { value: string; label: string; hint: string }[];
  disabled: boolean;
  onPick: (v: string) => void;
  onClose: () => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const picked = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open]);

  const pick = (i: number) => {
    setOpen(false);
    onPick(options[i].value);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    }
  };

  return (
    <div ref={root} className={"rx-bt" + (open ? " open" : "") + (disabled ? " off" : "")} onKeyDown={onKey}>
      <button
        type="button"
        className="rx-bt-t"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setActive(picked);
          setOpen((o) => !o);
        }}
      >
        <span className="rx-mi">
          <Icon name="batches" size={15} />
        </span>
        <span className="rx-bt-v">
          <small>Партия приёма</small>
          <b>{options[picked].label}</b>
        </span>
        <span className="rx-bt-chev" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      <button type="button" className="rx-bt-new" onClick={onNew} disabled={disabled} title="Новая партия" aria-label="Новая партия">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <div className="rx-bt-menu" role="listbox" aria-label="Партия">
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={i === picked}
            className={(i === active ? "act" : "") + (i === picked ? " on" : "")}
            style={{ animationDelay: `${Math.min(i, 8) * 22}ms` }}
            onPointerMove={() => active !== i && setActive(i)}
            onClick={() => pick(i)}
          >
            <span>{o.label}</span>
            <small>{o.hint}</small>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ visibility: i === picked ? "visible" : "hidden" }}>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// --- общая посылка: один код на нескольких клиентов ------------------------------------------------------

const ITEM_ST: Record<string, [string, string]> = { ordered: ["Заказан", "warn"], in_stock: ["На складе", "ok"], issued: ["Выдан", "info"] };

/** Кому что отдать из одной посылки: клиент, его товар, штуки, оплата и статус. */
function SharedList({ items, onOpen }: { items: ScanResponse["items"]; onOpen: (id: number) => void }) {
  const total = items.reduce((a, i) => a + i.qty, 0);
  return (
    <div className="rx-sh">
      <div className="rx-sh-tip">
        <span className="rx-sh-i" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
        </span>
        <span>
          <b>Разделите посылку</b>
          <small>{items.map((i) => `${i.customer_name} — ${i.qty} шт`).join(" · ")}</small>
        </span>
      </div>
      <div className="rx-sh-list">
        {items.map((i, k) => {
          const st = ITEM_ST[i.status] ?? ITEM_ST.ordered;
          return (
            <button key={i.id} type="button" className="rx-sh-r" style={{ animationDelay: `${80 + k * 40}ms` }} onClick={() => onOpen(i.id)} title="Открыть товар">
              <span className="rx-who">
                <span className="rx-av">{initials(i.customer_name)}</span>
                <span className="rx-two">
                  <b>{i.customer_name}</b>
                  <small>{i.customer_phone}</small>
                </span>
              </span>
              <span className="rx-two">
                <b>{i.name}</b>
                <small>заказ от {i.order_date.split("-").reverse().join(".")}</small>
              </span>
              <span className="rx-sh-q">
                <b>{i.qty} шт</b>
                <small>из {total}</small>
              </span>
              <span className="rx-sh-pay">{i.debt > 0 ? `долг ${som(i.debt)}` : "оплачено"}</span>
              <span className={"rx-pill-st " + st[1]}>{st[0]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- неизвестный код: чей это товар -----------------------------------------------------------------

/** Клиент заказывал сам, и кода нет в заказах: выбрать клиента — товар заведётся на него и примется. */
const GHOST_W = [62, 48, 54, 40];

function AssignBox({
  code,
  sugg,
  onUseCode,
  onAssign,
}: {
  code: string;
  sugg: Item[];
  onUseCode: (code: string) => void;
  onAssign?: (customerId: number, name: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  // Пока ничего не ввели — клиенты со своим кодом, самые активные (по последнему заказу).
  const canAssign = !!onAssign;
  const [top, setTop] = useState<CustomerRow[] | null>(null);
  const [pick, setPick] = useState<CustomerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!dq) {
      setRows(null);
      return;
    }
    let on = true;
    listCustomers({ q: dq, limit: 4 })
      .then((r) => on && setRows(r.rows))
      .catch(() => on && setRows([]));
    return () => {
      on = false;
    };
  }, [dq]);

  useEffect(() => {
    if (!canAssign) return;
    let on = true;
    // Только клиенты со своим кодом (014, 002…) — они заказывают сами; самые активные первыми.
    listCustomers({ sort: "recent", limit: 200 })
      .then((r) => on && setTop(r.rows.filter((c) => c.code).slice(0, 4)))
      .catch(() => on && setTop([]));
    return () => {
      on = false;
    };
  }, [canAssign]);

  async function go() {
    if (!pick || busy || !onAssign) return;
    setBusy(true);
    setErr("");
    try {
      await onAssign(pick.id, "");
    } catch (e) {
      setErr(apiError(e, "Не удалось принять"));
      setBusy(false);
    }
  }

  const card = (c: CustomerRow, i: number) => (
    <button
      key={c.id}
      type="button"
      className="rx-as-c"
      style={{ animationDelay: `${i * 35}ms` }}
      onClick={() => {
        setPick(c);
        setErr("");
      }}
    >
      <span className="rx-av">{initials(c.name)}</span>
      <span className="rx-two">
        <b>{c.name}</b>
        <small>{c.phone}</small>
      </span>
      {c.code && <em>№ {c.code}</em>}
    </button>
  );
  const chips = sugg.slice(0, 2).map((s) => (
    <button key={s.id} type="button" className="rx-as-chip" title={`${s.name} · ${s.customer_name}`} onClick={() => s.code && onUseCode(s.code)}>
      {s.code}
    </button>
  ));
  return (
    <div className="rx-as">
      <div className="rx-as-top">
        <b>{onAssign ? "Чей это товар?" : "Код не найден"}</b>
        <small>{onAssign ? "клиент заказывал сам — выберите его, и товар примется" : "проверьте код или добавьте его в заказ"}</small>
        {chips.length > 0 && (
          <span className="rx-as-chips">
            <small>похожие:</small>
            {chips}
          </span>
        )}
      </div>
      {!onAssign ? null : pick ? (
        <>
          <div className="rx-as-sel">
            <div className="rx-as-card">
              <span className="rx-av">{initials(pick.name)}</span>
              <span className="rx-as-id">
                <b>{pick.name}</b>
                <small>{pick.phone}</small>
              </span>
              {pick.code && <em>№ {pick.code}</em>}
              <button type="button" className="rx-as-x" onClick={() => setPick(null)} title="Выбрать другого клиента" aria-label="Другой клиент">
                ×
              </button>
            </div>
            <div className="rx-as-sum">
              <span>
                <small>Код</small>
                <b className="mono" title={code}>
                  {code}
                </b>
              </span>
              <span>
                <small>Цена</small>
                <b>только вес</b>
              </span>
              <span>
                <small>У клиента на складе</small>
                <b>{pick.in_stock} шт</b>
              </span>
              <span>
                <small>Долг клиента</small>
                <b>{pick.debt > 0 ? som(pick.debt) : "нет"}</b>
              </span>
            </div>
          </div>
          <button type="button" className="rx-as-go" disabled={busy} onClick={go} autoFocus>
            {busy ? "Принимаю…" : `Принять на склад — ${pick.name}`}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </>
      ) : (
        <>
          <label className="rx-as-in">
            <Svg paths={I_SEARCH} size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="№ клиента, имя или телефон" autoComplete="off" spellCheck={false} />
          </label>
          <div className="rx-as-list">
            {rows !== null && rows.length === 0 ? (
              <span className="rx-as-none">Никого не нашли — проверьте номер или имя</span>
            ) : (
              <>
                {(rows ?? top ?? []).map(card)}
                {/* Пустые места до четырёх — серыми заглушками */}
                {GHOST_W.slice((rows ?? top ?? []).length).map((w, i) => (
                  <span key={"g" + i} className="rx-as-c ghost" aria-hidden>
                    <span className="sk rx-sk-av" />
                    <span className="rx-two" style={{ flex: 1 }}>
                      <span className="sk" style={{ width: `${w}%`, height: 9 }} />
                      <span className="sk" style={{ width: `${w - 14}%`, height: 7, marginTop: 6 }} />
                    </span>
                  </span>
                ))}
              </>
            )}
          </div>
        </>
      )}
      {err && <small className="rx-as-err">{err}</small>}
    </div>
  );
}

// --- чек последнего скана -----------------------------------------------------------------------------

/** Штрихкод для вида чека: полосы считаются из кода (рисунок свой у каждого кода, сканером не читается). */
function Barcode({ code }: { code: string }) {
  const src = code || "JETCARGO";
  let h = 7;
  let x = 0;
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < 52; i++) {
    h = (h * 31 + src.charCodeAt(i % src.length)) >>> 0;
    const w = 1 + (h % 3);
    bars.push({ x, w });
    x += w + 1 + ((h >> 4) % 2);
  }
  return (
    <svg className="rx-code" viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y="0" width={b.w} height="40" />
      ))}
    </svg>
  );
}

/** Разделы чека: что принято, сколько платить и что ещё у этого клиента. */
const RC_SECTIONS = [
  { title: "Товар", rows: ["Количество", "Заказ от", "Партия"], ghost: [36, 74, 74] },
  { title: "Оплата", rows: ["Сумма", "Оплачено", "Статус"], ghost: [58, 52, 80] },
  { title: "Клиент", rows: ["Весь долг", "На складе", "Ждём ещё"], ghost: [62, 22, 22] },
];

function Receipt({
  last,
  at,
  batches,
  onOpen,
  onUseCode,
  onAssign,
}: {
  onAssign?: (customerId: number, name: string) => Promise<void>;
  last: ScanResponse | null;
  at: string;
  batches: Batch[];
  onOpen: (id: number) => void;
  onUseCode: (code: string) => void;
}) {
  const it = last?.items[0];
  const c = last?.customer;
  const found = !!(last?.lookup && it);
  const t = !last ? null : found ? TONE.lookup : TONE[last.result];
  const dot = !last ? "" : found ? "info" : DOT[last.result];
  const d = at ? new Date(at) : null;
  const code = it?.code || last?.matched_code || last?.code || "";
  const hint = last?.matched_code ? `сканер прочитал без букв: ${last.code}` : t?.hint;
  const name = c?.name ?? it?.customer_name;
  const batch = !it?.batch_id ? "без партии" : (batches.find((b) => b.id === it.batch_id)?.name.replace(/^Партия от /, "") ?? `№ ${it.batch_id}`);
  const pay = !it ? "" : it.debt <= 0 ? "оплачено" : it.paid > 0 ? "частично" : "не оплачено";
  const lines = it
    ? [`${it.qty} шт`, it.order_date.split("-").reverse().join("."), batch, som(it.sale), som(it.paid), pay, c ? som(c.debt) : "—", c ? c.in_stock : "—", c ? c.ordered : "—"]
    : null;
  // Один код — товары нескольких клиентов: показываем всех и итог по посылке.
  const owners = last ? [...new Map(last.items.map((i) => [i.customer_id, i.customer_name])).values()] : [];
  const shared = owners.length > 1;
  const all = last?.items ?? [];
  const sum = (k: "sale" | "paid" | "debt" | "qty") => all.reduce((a, i) => a + i[k], 0);
  const due = shared ? sum("debt") : it?.debt;
  const paidShare = shared ? (sum("sale") > 0 ? Math.min(100, Math.round((sum("paid") / sum("sale")) * 100)) : null) : it && it.sale > 0 ? Math.min(100, Math.round((it.paid / it.sale) * 100)) : null;
  return (
    <section className="rx-rc-wrap">
      <div key={at || "empty"} className={"rx-rc" + (last ? " printed" : "")}>
        <div className="rx-rc-main">
          {/* Главное — кто: имя и телефон читаются первыми */}
          <header className="rx-rc-who">
            {shared ? (
              <span className="rx-rc-avs" aria-hidden>
                {owners.slice(0, 3).map((n) => (
                  <i key={n}>{initials(n)}</i>
                ))}
              </span>
            ) : (
              <span className={"rx-rc-av" + (it ? "" : " ghost")}>{it ? initials(name ?? "?") : "?"}</span>
            )}
            <span className="rx-rc-id">
              {shared ? (
                <>
                  <b>Общая посылка</b>
                  <span>
                    {owners.length} {plural(owners.length, "клиент", "клиента", "клиентов")} · {sum("qty")} шт
                  </span>
                </>
              ) : !last ? (
                <>
                  <span className="sk" style={{ width: "48%", height: 18 }} />
                  <span className="sk" style={{ width: "32%", height: 12 }} />
                </>
              ) : it ? (
                <>
                  <b>{name ?? "Клиент не указан"}</b>
                  {c?.phone && <span>{c.phone}</span>}
                </>
              ) : (
                <>
                  <b className="mute">Клиент не определён</b>
                  <span className="mute">кода нет в заказах</span>
                </>
              )}
            </span>
            <span className={"rx-rc-st" + (last ? "" : " ghost")}>
              <span className={"rx-pill-st " + dot}>{t ? t.title : "Ждём скан"}</span>
              <small>{t ? hint : "здесь появится чек"}</small>
            </span>
          </header>

          <div className="rx-rc-body">
            {last && !it ? (
              <AssignBox code={last.matched_code ?? last.code} sugg={last.suggestions} onUseCode={onUseCode} onAssign={onAssign} />
            ) : shared ? (
              <SharedList items={all} onOpen={onOpen} />
            ) : (
              <>
                <div className="rx-rc-item">
                  {it ? (
                    <>
                      <b title={it.name}>{it.name}</b>
                      {last && last.items.length > 1 && <small>ещё {last.items.length - 1} с этим кодом</small>}
                      <i aria-hidden />
                      <button type="button" className="rx-rc-open" onClick={() => onOpen(it.id)}>
                        Открыть
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M7 17 17 7M8 7h9v9" />
                        </svg>
                      </button>
                    </>
                  ) : last ? (
                    <b>Проверьте код или добавьте его в заказ</b>
                  ) : (
                    <span className="sk" style={{ display: "block", width: "34%", height: 15 }} />
                  )}
                </div>
                <div className="rx-rc-secs">
                  {RC_SECTIONS.map((sec, s) => (
                    <div key={sec.title} className="rx-rc-sec">
                      <h3>{sec.title}</h3>
                      {sec.rows.map((label, r) => (
                        <div key={label} className="rx-rc-l" style={{ animationDelay: `${90 + (s * 3 + r) * 26}ms` }}>
                          <span>{label}</span>
                          {lines ? <b title={String(lines[s * 3 + r])}>{lines[s * 3 + r]}</b> : <span className="sk" style={{ width: sec.ghost[r], height: 10 }} />}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <aside className="rx-rc-stub">
          <div className="rx-rc-h">
            <span className="rx-rc-logo">
              <LogoMark size={16} />
            </span>
            <span className="rx-rc-brand">
              <b>Jetcargo</b>
              <small>чек приёма</small>
            </span>
            <span className="rx-rc-when">
              <b>{d ? hhmm(at) : "--:--"}</b>
              <small>{d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}` : "сегодня"}</small>
            </span>
          </div>
          <div className={"rx-rc-total" + (it ? "" : " ghost")}>
            <div className="rx-rc-due">
              <small>К оплате</small>
              {it ? <b>{som(due ?? 0)}</b> : last ? <b>—</b> : <i className="sk" style={{ display: "block", width: 92, height: 20, margin: "4px 0" }} />}
            </div>
            <div className="rx-rc-paid">
              <small>Оплачено</small>
              <span>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="3.2" aria-hidden>
                  <circle className="trk" cx="12" cy="12" r="9.5" />
                  {!!paidShare && <circle className="arc" cx="12" cy="12" r="9.5" pathLength={100} style={{ strokeDasharray: `${paidShare} 100` }} />}
                </svg>
                <b>{paidShare === null ? "—" : `${paidShare}%`}</b>
              </span>
            </div>
          </div>
          <div className={"rx-rc-bar" + (last ? "" : " ghost")}>
            <Barcode code={code} />
            <span>{code || "• • • • • • • • • •"}</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
