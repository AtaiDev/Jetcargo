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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { createBatch, listBatches, listItems, listScans, lookupCode, scanCode, type Batch, type BatchCalc, type ScanResponse, type ScanResult, type ScanRow } from "../api/domain";
import { Tabs } from "../components/cargo";
import ItemModal from "../components/ItemModal";
import Select from "../components/Select";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_CHECK, I_SEARCH, Icon, Svg } from "../design/icons";
import { Page } from "../design/table";
import { HButton, ModalError, ST } from "../design/ui";
import { date, shortDateTime, som, todayIso } from "../lib/cargo";
import { emit, useRefresh } from "../lib/events";
import { scanSound, type ScanSound } from "../lib/sound";

type Toast = (kind: "success" | "error", text: string) => void;
type PathDef = [string, Record<string, unknown>][];

/** Числа обычным шрифтом с цифрами одной ширины; коды — моноширинным, их удобно сверять. */
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const CODE = MONO + ";letter-spacing:.02em";
const CARD = "background:var(--surface);border:1px solid var(--border);border-radius:16px";

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

/** Какой звук на какой результат: принят — колокольчик, повтор — нейтральный, не найден — внимание. */
const SOUND_OF: Record<ScanResult | "lookup", ScanSound> = {
  lookup: "repeat",
  arrived: "ok",
  already_in_stock: "repeat",
  already_issued: "repeat",
  not_found: "error",
};

/** Режим работы сканера: приём в партию, приём без партии или только поиск. */
type Mode = "batch" | "none" | "search";
const MODES: { key: Mode; label: string; short: string; icon: ReactNode; hint: string }[] = [
  { key: "batch", label: "В партию", short: "В партию", icon: <Icon name="batches" size={15} />, hint: "товар встанет на склад и попадёт в партию" },
  { key: "none", label: "Без партии", short: "Без партии", icon: <Icon name="receive" size={15} />, hint: "товар встанет на склад без партии" },
  { key: "search", label: "Поиск товара", short: "Поиск", icon: <Svg paths={I_SEARCH} size={15} />, hint: "только посмотреть — статус не меняется" },
];
const ACCEPT_TONE = { fg: "var(--accent-strong)", border: "var(--accent-border)", ring: "rgba(62,99,221,.14)", solid: "var(--accent)", tint: "var(--accent-tint)" };
const MODE_TONE: Record<Mode, typeof ACCEPT_TONE> = {
  batch: ACCEPT_TONE,
  none: ACCEPT_TONE,
  search: { fg: "var(--violet)", border: "var(--violet-dot)", ring: "rgba(139,92,240,.16)", solid: "var(--violet-solid)", tint: "var(--violet-tint)" },
};

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

const hhmm = (iso: string) => shortDateTime(iso).slice(6);

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export default function Receive({ toast }: { toast: Toast }) {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState<ScanResponse | null>(null);
  const [lastAt, setLastAt] = useState<string>("");
  const [today, setToday] = useState<ScanRow[]>([]);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [sound, setSound] = useState(true);
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
  const tone = MODE_TONE[mode];
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
  const curBatch = sel === TODAY ? todayBatch : batches.find((b) => b.id === batchId);
  const batchName = sel === TODAY ? (todayBatch?.name ?? todayName) : curBatch?.name;
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
    listScans({ since: todayStartIso(), limit: 500 })
      .then((r) => setToday(r.rows))
      .catch(() => setToday([]));
    listItems({ status: "ordered", limit: 1 })
      .then((r) => setWaiting(r.total))
      .catch(() => setWaiting(null));
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
      setLast(res);
      setLastAt(new Date().toISOString());
      setFlashId(res.items[0]?.id ?? null);
      if (sound) scanSound(SOUND_OF[res.result]);
      if (res.result === "arrived") emit("cargo:changed");
      else if (mode !== "search") loadToday();
      setCode("");
    } catch (e) {
      setError(apiError(e, "Не удалось обработать код"));
      if (sound) scanSound("error");
    } finally {
      setBusy(false);
      refocus();
    }
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

  const counts = useMemo(() => {
    const c = { arrived: 0, already_in_stock: 0, already_issued: 0, not_found: 0 } as Record<ScanResult, number>;
    for (const s of today) c[s.result]++;
    return c;
  }, [today]);
  const modeInfo = MODES.find((m) => m.key === mode)!;

  return (
    <Page size="wide">
      <div className="rcv-grid">
        {/* ================= Пульт сканера (справа; на телефоне — сверху) ================= */}
        <aside className="rcv-pult" style={css(CARD + ";display:flex;flex-direction:column;min-width:0;overflow:hidden")}>
          <div style={css("padding:16px 18px;display:flex;flex-direction:column;gap:14px")}>
            {/* Шапка */}
            <div style={css("display:flex;align-items:center;gap:11px")}>
              <span style={mix("width:36px;height:36px;border-radius:11px;flex:none;display:grid;place-items:center;transition:background .15s,color .15s", { background: tone.tint, color: tone.fg })}>
                {mode === "search" ? <Svg paths={I_SEARCH} size={18} sw={2} /> : <Icon name="receive" size={19} />}
              </span>
              <div style={css("flex:1;min-width:0")}>
                <div style={css("font-size:15px;font-weight:500;letter-spacing:-.01em;color:var(--text)")}>Пульт сканера</div>
                <div style={css("font-size:12px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{modeInfo.hint}</div>
              </div>
              <HButton
                onClick={() => {
                  setSound(!sound);
                  if (!sound) scanSound("ok"); // образец звука
                  refocus();
                }}
                title={sound ? "Звук включён — выключить" : "Звук выключен — включить"}
                aria-label={sound ? "Выключить звук" : "Включить звук"}
                s={mix("width:34px;height:34px;flex:none;display:grid;place-items:center;padding:0;border-radius:10px;cursor:pointer;border:1px solid var(--border)", {
                  background: sound ? "var(--surface)" : "var(--surface-2)",
                  color: sound ? "var(--text-2)" : "var(--text-5)",
                })}
                hover="border-color:var(--accent);color:var(--accent)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                  {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m22 9-6 6M16 9l6 6" />}
                </svg>
              </HButton>
            </div>

            {/* Поле сканера: код принимается по Enter (сканер отправляет его сам) */}
            <div
              className="scan-field"
              onClick={() => inputRef.current?.focus()}
              style={mix("width:100%;min-width:0;display:flex;align-items:center;gap:10px;height:58px;padding:0 10px 0 16px;border-radius:14px;background:var(--surface);cursor:text;transition:border-color .15s,box-shadow .15s", {
                border: `2px solid ${tone.border}`,
                ["--scan-ring" as string]: tone.ring,
              })}
            >
              <span style={mix("display:flex;flex:none", { color: tone.fg })}>{mode === "search" ? <Svg paths={I_SEARCH} size={21} /> : <Icon name="receive" size={22} />}</span>
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                onBlur={() => !open && setTimeout(() => document.activeElement === document.body && inputRef.current?.focus(), 200)}
                placeholder={mode === "search" ? "Код для поиска…" : "Сканируйте код…"}
                autoComplete="off"
                spellCheck={false}
                aria-label="Код товара"
                style={css("flex:1;min-width:0;height:100%;border:none;outline:none;background:transparent;font-size:18px;box-shadow:none;" + CODE)}
              />
              {busy ? (
                <span title="Обработка…" style={mix("width:20px;height:20px;border-radius:50%;border:2px solid var(--border);animation:spin .7s linear infinite;flex:none;margin-right:6px", { borderTopColor: tone.solid })} />
              ) : code ? (
                <HButton
                  onClick={() => {
                    setCode("");
                    refocus();
                  }}
                  title="Очистить"
                  s="width:30px;height:30px;display:grid;place-items:center;padding:0;border:none;border-radius:9px;background:var(--hover);color:var(--text-3);cursor:pointer;flex:none"
                  hover="background:var(--border);color:var(--text)"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </HButton>
              ) : (
                <span style={css("flex:none;font-size:11px;color:var(--text-4);border:1px solid var(--border);border-bottom-width:2px;border-radius:6px;padding:2px 7px;" + MONO)}>Enter</span>
              )}
            </div>

            {/* Режим */}
            <Field label="Режим">
              <div style={css("display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:4px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border-2)")}>
                {MODES.map((m) => {
                  const on = mode === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => pickMode(m.key)}
                      aria-pressed={on}
                      title={m.hint}
                      style={mix(
                        "display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 6px;border-radius:9px;font-size:12.5px;cursor:pointer;white-space:nowrap;overflow:hidden;transition:background .12s,color .12s,border-color .12s",
                        {
                          border: `1px solid ${on ? "var(--border)" : "transparent"}`,
                          background: on ? "var(--surface)" : "transparent",
                          color: on ? MODE_TONE[m.key].fg : "var(--text-3)",
                          fontWeight: on ? 600 : 500,
                          boxShadow: on ? "0 1px 3px rgba(15,18,25,.08)" : "none",
                        }
                      )}
                    >
                      <span style={css("display:flex;flex:none")}>{m.icon}</span>
                      {m.short}
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* Куда идёт товар */}
            {mode === "batch" ? (
              <Field
                label="Партия"
                right={
                  <HButton onClick={newBatch} s="border:none;background:transparent;padding:0;color:var(--accent);font-size:12px;cursor:pointer" hover="color:var(--accent-hover)">
                    + новая
                  </HButton>
                }
              >
                <Select
                  value={sel}
                  onChange={pickBatch}
                  width="100%"
                  height={38}
                  fontSize={13}
                  highlight
                  ariaLabel="Партия"
                  menuMinWidth={300}
                  options={[
                    { value: TODAY, label: todayBatch?.name ?? todayName, hint: todayBatch ? "сегодня" : "создастся при скане" },
                    ...batches.filter((b) => b.id !== todayBatch?.id).map((b) => ({ value: String(b.id), label: b.name })),
                  ]}
                />
                <div style={css("margin-top:7px;font-size:12px;min-height:16px")}>
                  {sel === TODAY && !todayBatch ? (
                    <span style={css("display:inline-flex;align-items:center;gap:6px;color:var(--accent-strong)")}>
                      <span style={css("width:6px;height:6px;border-radius:50%;background:var(--accent)")} />
                      создастся при первом скане
                    </span>
                  ) : (
                    batchId && (
                      <HButton onClick={() => nav(`/batches/${batchId}`)} s="border:none;background:transparent;padding:0;color:var(--accent);font-size:12px;cursor:pointer" hover="color:var(--accent-hover)">
                        расчёт партии →
                      </HButton>
                    )
                  )}
                </div>
              </Field>
            ) : (
              <div style={mix("display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:10px;font-size:12.5px;line-height:1.45", { background: tone.tint, color: tone.fg })}>
                <span style={mix("width:6px;height:6px;border-radius:50%;flex:none;margin-top:6px", { background: tone.solid })} />
                {mode === "none" ? "Товар встанет на склад без партии — добавить в партию можно позже в «Партиях»." : "Только просмотр: статус не меняется, в историю ничего не пишется."}
              </div>
            )}
          </div>

          {/* Что уже в выбранной партии */}
          {mode === "batch" && (
            <div style={css("padding:0 18px 16px")}>
              <div style={css("border-radius:12px;border:1px solid var(--border-2);overflow:hidden")}>
                <div style={css("display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface-2);font-size:11.5px;font-weight:600;color:var(--text-3)")}>
                  <Icon name="batches" size={13} />
                  В этой партии сейчас
                </div>
                {curBatch ? (
                  <div style={css("display:grid;grid-template-columns:repeat(3,minmax(0,1fr))")}>
                    <BatchFact label="товаров" value={String(curBatch.calc.items)} />
                    <BatchFact label="клиентов" value={String(curBatch.calc.customers)} divider />
                    <BatchFact label="на сумму" value={som(curBatch.calc.sale)} divider />
                  </div>
                ) : (
                  <div style={css("padding:10px 12px;font-size:12px;color:var(--text-4)")}>пока пусто — первый принятый товар создаст партию</div>
                )}
              </div>
            </div>
          )}

          {/* Итоги дня: прогресс приёма и одна строка чисел */}
          <div style={css("border-top:1px solid var(--border-2);padding:14px 18px 16px")}>
            <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:8px")}>
              <span style={css("font-size:11.5px;font-weight:600;color:var(--text-3)")}>Итоги дня</span>
              {waiting !== null && (
                <span style={css("font-size:12px;color:var(--text-3);" + NUM)}>
                  принято <b style={css("font-weight:600;color:var(--text)")}>{counts.arrived}</b> из {counts.arrived + waiting}
                  <b style={css("font-weight:600;color:var(--green);margin-left:6px")}>{counts.arrived + waiting > 0 ? Math.round((counts.arrived / (counts.arrived + waiting)) * 100) : 0}%</b>
                </span>
              )}
            </div>
            {waiting !== null && (
              <div style={css("height:8px;border-radius:5px;background:var(--border-2);overflow:hidden;margin-top:8px")}>
                <div
                  style={mix("height:100%;border-radius:5px;background:linear-gradient(90deg,var(--green-dot),color-mix(in srgb,var(--green-dot) 70%,var(--accent)));transition:width .4s ease", {
                    width: `${counts.arrived + waiting > 0 ? Math.max(counts.arrived ? 2 : 0, (counts.arrived / (counts.arrived + waiting)) * 100) : 0}%`,
                  })}
                />
              </div>
            )}
            <div style={css("display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin-top:12px;border:1px solid var(--border-2);border-radius:12px;overflow:hidden")}>
              <DayNum dot="var(--green-dot)" label="принято" value={counts.arrived} />
              <DayNum dot="var(--amber-dot)" label="повторы" value={counts.already_in_stock + counts.already_issued} />
              <DayNum dot="var(--danger-dot)" label="не найдено" value={counts.not_found} alarm />
              <DayNum dot="var(--accent)" label="ждём →" value={waiting ?? 0} onClick={() => nav("/orders?status=ordered")} />
            </div>
          </div>
        </aside>

        {/* ================= Слева: результат скана и сканы за сегодня ================= */}
        <div className="rcv-main">
          {error && <ModalError text={error} />}
          <LastScan
            last={last}
            at={lastAt}
            batchName={batchName}
            onOpen={setOpen}
            onUseCode={(c) => {
              setCode(c);
              refocus();
            }}
          />
          <TodayTable rows={today} flashId={flashId} onOpen={setOpen} />
        </div>
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

function BatchFact({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  return (
    <div style={mix("padding:9px 12px;min-width:0", divider && "border-left:1px solid var(--border-2)")}>
      <div style={css(NUM + ";font-size:15px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{value}</div>
      <div style={css("font-size:11px;color:var(--text-4)")}>{label}</div>
    </div>
  );
}

function Field({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div style={css("display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:7px")}>
        <span style={css("font-size:11.5px;font-weight:600;color:var(--text-3)")}>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

const TINT = {
  green: ["var(--green-tint)", "var(--green)"],
  amber: ["var(--amber-tint)", "var(--amber)"],
  danger: ["var(--danger-tint)", "var(--danger)"],
  accent: ["var(--accent-tint)", "var(--accent)"],
  violet: ["var(--violet-tint)", "var(--violet)"],
  muted: ["var(--muted-bg)", "var(--text-3)"],
} as const;

/** Число итогов дня в общей строке: число крупно, под ним подпись с цветной точкой. */
function DayNum({ dot, label, value, alarm, onClick }: { dot: string; label: string; value: number; alarm?: boolean; onClick?: () => void }) {
  return (
    <HButton
      onClick={onClick}
      title={onClick ? "Товары «Заказан» — открыть в «Заказах»" : undefined}
      className="rcv-daynum"
      s={mix("display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 4px;border:none;background:var(--surface);font:inherit;color:inherit;min-width:0", {
        cursor: onClick ? "pointer" : "default",
      })}
      hover={onClick ? "background:var(--accent-tint2)" : ""}
    >
      <span style={mix(NUM + ";font-size:20px;font-weight:600;line-height:1.1", { color: !value ? "var(--text-5)" : alarm ? "var(--danger)" : "var(--text)" })}>
        <CountUp text={String(value)} />
      </span>
      <span style={css("display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-3);white-space:nowrap")}>
        <span style={mix("width:6px;height:6px;border-radius:50%;flex:none", { background: dot })} />
        {label}
      </span>
    </HButton>
  );
}

// --- Результат последнего скана -----------------------------------------------------------

const PAY = {
  paid: { label: "Оплачено полностью", short: "оплачено", dot: "var(--green-dot)", fg: "var(--green)", tint: "var(--green-tint)" },
  partial: { label: "Оплачено частично", short: "частично", dot: "var(--amber-dot)", fg: "var(--amber)", tint: "var(--amber-tint)" },
  unpaid: { label: "Не оплачено", short: "не оплачено", dot: "var(--danger-dot)", fg: "var(--danger)", tint: "var(--danger-tint)" },
} as const;


/** Результат скана одной карточкой: статус → товар → клиент и деньги одним блоком → действия. */
function LastScan({
  last,
  at,
  batchName,
  onOpen,
  onUseCode,
}: {
  last: ScanResponse | null;
  at: string;
  batchName?: string;
  onOpen: (id: number) => void;
  onUseCode: (code: string) => void;
}) {
  const nav = useNavigate();
  if (!last) {
    return (
      <section style={css(CARD + ";padding:22px 24px;display:flex;align-items:center;gap:18px;flex:none")}>
        <span style={css("width:58px;height:58px;border-radius:18px;flex:none;display:grid;place-items:center;background:var(--surface-2);border:1px dashed var(--border-strong);color:var(--text-4)")}>
          <Icon name="receive" size={26} />
        </span>
        <div style={css("min-width:0;flex:1")}>
          <div style={css("font-size:15px;font-weight:600;color:var(--text)")}>Готов к приёму — отсканируйте код</div>
          <div style={css("font-size:12.5px;color:var(--text-3);margin-top:3px;line-height:1.5")}>
            Здесь сразу появится товар, чей он, оплачен ли и какой долг. Товар «Заказан» станет «На складе».
          </div>
          <div style={css("display:flex;flex-wrap:wrap;gap:6px;margin-top:10px")}>
            <Tip dot="var(--green-dot)" text="принят — колокольчик" />
            <Tip dot="var(--amber-dot)" text="повтор — короткий сигнал" />
            <Tip dot="var(--danger-dot)" text="не найден — тревожный" />
          </div>
        </div>
      </section>
    );
  }

  const tone = TONE[last.result];
  const c = last.customer;
  const [first, ...rest] = last.items;

  return (
    <section key={at} style={css(CARD + ";overflow:hidden;animation:pop .2s ease;flex:none")}>
      {/* Статус скана */}
      <div style={mix("display:flex;align-items:center;gap:12px;padding:12px 18px", { background: tone.bg })}>
        <span style={mix("width:34px;height:34px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff", { background: tone.dot })}>
          <Svg paths={tone.icon} size={17} sw={2.6} />
        </span>
        <div style={css("flex:1;min-width:0")}>
          <span style={mix("font-size:15px;font-weight:600", { color: tone.fg })}>{tone.title}</span>
          <span style={css("font-size:12.5px;color:var(--text-3);margin-left:8px")} className="hide-sm">
            {tone.hint}
          </span>
        </div>
        {last.result === "arrived" && batchName && (
          <span className="hide-sm" style={css("display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;background:var(--surface);border:1px solid var(--border-2);font-size:12px;color:var(--text-2);white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis")}>
            <Icon name="batches" size={13} />
            {batchName}
          </span>
        )}
        <span style={css(NUM + ";font-size:13px;font-weight:600;color:var(--text-2);flex:none")}>{hhmm(at)}</span>
      </div>

      {last.result === "not_found" ? (
        <div style={css("padding:16px 18px;display:flex;flex-direction:column;gap:12px")}>
          <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap")}>
            <span style={css(CODE + ";font-size:15px;padding:4px 10px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border-2);color:var(--text)")}>{last.code}</span>
            <span style={css("font-size:12.5px;color:var(--text-3)")}>ничего не изменено — проверьте код на упаковке и отсканируйте ещё раз</span>
          </div>
          {last.suggestions.length > 0 && (
            <div>
              <div style={css("font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px")}>Похожие коды — возможно, опечатка:</div>
              <div style={css("display:flex;flex-direction:column;gap:6px")}>
                {last.suggestions.map((s) => (
                  <HButton
                    key={s.id}
                    onClick={() => onUseCode(s.code)}
                    s="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;text-align:left;padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);cursor:pointer;font:inherit;font-size:12.5px;color:inherit"
                    hover="border-color:var(--accent)"
                  >
                    <span style={css(CODE + ";font-weight:600")}>{s.code}</span>
                    <span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                      {s.name} · <span style={css("color:var(--text-3)")}>{s.customer_name}</span>
                    </span>
                    <span style={css("font-size:11.5px;color:var(--accent)")}>подставить</span>
                  </HButton>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : first ? (
        <div>
          {/* 1. Клиент: имя, под ним телефон; справа — что у клиента */}
          <div
            onClick={c ? () => nav(`/customers/${c.id}`) : undefined}
            className={c ? "row-click" : undefined}
            title={c ? "Открыть карточку клиента" : undefined}
            style={css("display:flex;align-items:center;gap:14px 20px;flex-wrap:wrap;padding:14px 20px")}
          >
            {c ? (
              <>
                <span style={css("display:flex;align-items:center;gap:12px;flex:1 1 240px;min-width:0")}>
                  <Avatar name={c.name} size={42} />
                  <span style={css("min-width:0")}>
                    <span style={css("display:block;font-size:16px;font-weight:500;color:var(--text);line-height:1.3;overflow-wrap:anywhere")}>{c.name}</span>
                    <span style={css(NUM + ";display:block;font-size:14px;color:var(--text-2);margin-top:2px;white-space:nowrap")}>{c.phone || "без телефона"}</span>
                  </span>
                </span>
                <span className="rcv-cstats">
                  <CountChip label="на складе" value={c.in_stock} dot={ST.in_stock.dot} />
                  <CountChip label="ждём" value={c.ordered} dot={ST.ordered.dot} />
                  <span
                    style={mix("display:inline-flex;align-items:baseline;gap:8px;height:34px;padding:0 13px;border-radius:10px;white-space:nowrap", {
                      background: c.debt > 0 ? "var(--danger-tint)" : "var(--green-tint)",
                      color: c.debt > 0 ? "var(--danger)" : "var(--green)",
                      lineHeight: "34px",
                    })}
                  >
                    <span style={css("font-size:12px")}>{c.debt > 0 ? "долг клиента" : "долгов нет"}</span>
                    {c.debt > 0 && <span style={css(NUM + ";font-size:15px;font-weight:500")}>{som(c.debt)}</span>}
                  </span>
                </span>
              </>
            ) : (
              <span style={css("font-size:13px;color:var(--text-4)")}>Клиент не найден</span>
            )}
          </div>

          {/* 2. Товар: что это и трек-код; справа — оплата или долг плашкой */}
          <div
            onClick={() => onOpen(first.id)}
            className="row-click"
            title="Открыть карточку товара"
            style={css("display:flex;align-items:center;gap:14px;padding:14px 20px;flex-wrap:wrap;border-top:1px solid var(--border-2)")}
          >
            <span style={css("width:44px;height:44px;border-radius:12px;flex:none;display:grid;place-items:center;background:var(--accent-tint);color:var(--accent)")}>
              <Icon name="stock" size={22} />
            </span>
            <div style={css("flex:1 1 220px;min-width:0")}>
              <div style={css("font-size:16px;font-weight:500;color:var(--text);line-height:1.3;overflow-wrap:anywhere")}>{first.name}</div>
              <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px")}>
                <span style={css(NUM + ";display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border-2);font-size:12px;color:var(--text-2)")}>
                  {first.qty} шт
                </span>
                <span style={css("display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px 0 7px;border-radius:6px;background:var(--surface-2);border:1px solid var(--border-2);min-width:0")}>
                  <span style={css("font-size:10.5px;color:var(--text-4);text-transform:uppercase;letter-spacing:.05em")}>трек</span>
                  <span style={css(CODE + ";font-size:12.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{first.code || "—"}</span>
                </span>
              </div>
            </div>
            <div
              style={mix("flex:none;margin-left:auto;display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:12px", {
                background: first.debt > 0 ? "var(--danger-tint)" : "var(--green-tint)",
                border: `1px solid ${first.debt > 0 ? "var(--danger-border)" : "color-mix(in srgb, var(--green-dot) 30%, transparent)"}`,
              })}
            >
              <span style={mix("width:28px;height:28px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff", { background: first.debt > 0 ? "var(--danger-dot)" : "var(--green-dot)" })}>
                {first.debt > 0 ? <b style={css("font-size:15px;line-height:1")}>!</b> : <Svg paths={I_CHECK} size={14} sw={2.8} />}
              </span>
              <span style={css("text-align:left")}>
                <span style={mix("display:block;font-size:11.5px", { color: first.debt > 0 ? "var(--danger)" : "var(--green)" })}>
                  {first.debt > 0 ? (first.paid > 0 ? "долг · оплачено частично" : "долг · не оплачено") : "оплачено полностью"}
                </span>
                <span style={mix(NUM + ";display:block;font-size:18px;font-weight:500;line-height:1.25;white-space:nowrap", { color: first.debt > 0 ? "var(--danger)" : "var(--green)" })}>
                  {som(first.debt > 0 ? first.debt : first.sale)}
                </span>
              </span>
            </div>
          </div>

          {/* 3. Подробности */}
          <div className="rcv-facts">
            <Fact label="Сумма товара" value={som(first.sale)} />
            <Fact label="Оплачено" value={som(Math.min(first.paid, first.sale))} color={first.paid > 0 ? "var(--green)" : "var(--text-3)"} />
            <Fact label="Статус" value={ST[first.status].label} text />
            <Fact label="Заказ от" value={date(first.order_date)} />
            <Fact label="Сканов" value={first.scans.length ? String(first.scans.length) : "—"} />
          </div>

          {/* Ещё товары с этим же кодом */}
          {rest.length > 0 && (
            <div style={css("border-top:1px solid var(--border-2)")}>
              <div style={css("padding:8px 20px 4px;font-size:11.5px;color:var(--text-4)")}>Ещё с этим кодом · {rest.length}</div>
              {rest.map((it) => (
                <div key={it.id} onClick={() => onOpen(it.id)} className="row-click" style={css("display:flex;align-items:center;gap:10px;padding:8px 20px;font-size:13px")}>
                  <span style={css("flex:1;min-width:0;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                    {it.name} <span style={css(NUM + ";color:var(--text-4)")}>{it.qty} шт</span>
                  </span>
                  <span style={mix(NUM + ";white-space:nowrap", { color: it.debt > 0 ? "var(--danger)" : "var(--green)" })}>{it.debt > 0 ? `долг ${som(it.debt)}` : "оплачено"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Подробность скана: подпись мелкими заглавными, значение ровным шрифтом.
 * text — значение словами (статус): буквы при той же жирности кажутся темнее цифр, поэтому тоньше.
 */
function Fact({ label, value, color, text }: { label: string; value: string; color?: string; text?: boolean }) {
  return (
    <div style={css("min-width:0;padding:11px 20px 12px;display:flex;flex-direction:column;gap:6px")}>
      <span style={css("font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{label}</span>
      <span
        style={mix(NUM + ";font-size:14.5px;line-height:24px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", {
          color: color ?? "var(--text)",
          fontWeight: text ? 400 : 500,
        })}
      >
        {value}
      </span>
    </div>
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

function Tip({ dot, text }: { dot: string; text: string }) {
  return (
    <span style={css("display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border-2);font-size:11.5px;color:var(--text-3)")}>
      <span style={mix("width:6px;height:6px;border-radius:50%", { background: dot })} />
      {text}
    </span>
  );
}

/** Аватар-буква; цвет — от имени, чтобы у клиента он всегда был один и тот же. */
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
      style={mix("border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-weight:700", {
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: AVATAR_BG[n % AVATAR_BG.length],
      })}
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

// --- Сканы за сегодня ---------------------------------------------------------------------

type TodayTab = "arrived" | "repeat" | "not_found";

const RESULT_ICON: Record<ScanResult, { icon: PathDef; tone: keyof typeof TINT }> = {
  arrived: { icon: I_CHECK, tone: "green" },
  already_in_stock: { icon: I_REPEAT, tone: "amber" },
  already_issued: { icon: I_OUT, tone: "muted" },
  not_found: { icon: I_ALERT, tone: "danger" },
};

/** Оплата в строке скана: «оплачено» или «долг N с» и тонкая полоска оплаченной доли. */
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

/** Все сканы за сегодня — таблицей; занимает оставшуюся высоту колонки, прокрутка внутри. */
function TodayTable({ rows, flashId, onOpen }: { rows: ScanRow[]; flashId: number | null; onOpen: (id: number) => void }) {
  const [tab, setTab] = useState<TodayTab>("arrived");
  const arrived = rows.filter((r) => r.result === "arrived");
  const repeat = rows.filter((r) => r.result === "already_in_stock" || r.result === "already_issued");
  const notFound = rows.filter((r) => r.result === "not_found");
  const list = tab === "arrived" ? arrived : tab === "repeat" ? repeat : notFound;
  const sum = arrived.reduce((s, r) => s + (r.sale ?? 0), 0);
  const clients = new Set(arrived.map((r) => r.customer_id)).size;

  return (
    <section className="rcv-table-card" style={css(CARD + ";overflow:hidden;display:flex;flex-direction:column")}>
      <div style={css("display:flex;align-items:center;gap:12px 16px;flex-wrap:wrap;padding:12px 18px")}>
        <div style={css("flex:1 1 220px;min-width:0")}>
          <div style={css("font-size:15px;font-weight:500;letter-spacing:-.01em;color:var(--text)")}>Сканы за сегодня</div>
          <div style={css("font-size:12px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" + NUM)}>
            {arrived.length
              ? `принято ${arrived.length} ${plural(arrived.length, "товар", "товара", "товаров")} · ${clients} ${plural(clients, "клиент", "клиента", "клиентов")} · на ${som(sum)}`
              : "сегодня ещё ничего не принято"}
          </div>
        </div>
        <Tabs<TodayTab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "arrived", label: "Принято", count: arrived.length, dot: "var(--green-dot)" },
            { key: "repeat", label: "Повторы", count: repeat.length, dot: "var(--amber-dot)" },
            { key: "not_found", label: "Не найдено", count: notFound.length, dot: "var(--danger-dot)" },
          ]}
        />
      </div>

      <div className="thin-scroll" style={css("flex:1;min-height:0;overflow:auto;border-top:1px solid var(--border-2);display:flex;flex-direction:column")}>
        {list.length > 0 && (
          <div style={css("flex:none")}>
            <div className="rcv-row rcv-head">
              <span />
              <span>Время</span>
              <span className="rcv-hide">Клиент</span>
              <span>Товар</span>
              <span style={css("text-align:right")}>Сумма</span>
              <span className="rcv-hide">Оплата</span>
            </div>
            {list.map((r) => {
              if (r.result === "not_found") return <NotFoundRow key={r.id} r={r} />;
              const ri = RESULT_ICON[r.result];
              const [tint, fg] = TINT[ri.tone];
              const payTone = r.pay_status ? PAY[r.pay_status] : null;
              return (
                <div
                  key={r.id}
                  onClick={() => r.order_item_id && onOpen(r.order_item_id)}
                  className={"rcv-row" + (r.order_item_id ? " row-click" : "") + (flashId !== null && flashId === r.order_item_id ? " scan-flash" : "")}
                >
                  <span style={mix("width:24px;height:24px;border-radius:7px;display:grid;place-items:center", { background: tint, color: fg })}>
                    <Svg paths={ri.icon} size={12} sw={2.4} />
                  </span>
                  <span style={css(NUM + ";color:var(--text-3)")}>{hhmm(r.scanned_at)}</span>
                  <span className="rcv-hide" style={css("display:flex;align-items:center;gap:8px;min-width:0")}>
                    {r.customer_name ? (
                      <>
                        <Avatar name={r.customer_name} size={22} />
                        <span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-2)")}>{r.customer_name}</span>
                      </>
                    ) : (
                      <span style={css("color:var(--text-5)")}>—</span>
                    )}
                  </span>
                  <span style={css("min-width:0")}>
                    <span style={css("display:block;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                      {r.item_name ?? <span style={css("color:var(--danger)")}>нет такого товара</span>}
                      {r.qty && r.qty > 1 ? <span style={css(NUM + ";color:var(--text-4);font-weight:400")}> × {r.qty}</span> : null}
                    </span>
                    <span style={css("display:block;font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                      <span style={css(CODE + ";font-size:11px")}>{r.code}</span>
                      {r.result === "already_in_stock" || r.result === "already_issued" ? ` · ${r.result === "already_issued" ? "уже выдан" : "уже на складе"} · скан №${r.scan_no}` : ""}
                    </span>
                  </span>
                  <span style={css(NUM + ";text-align:right;white-space:nowrap;color:var(--text);font-weight:500")}>{r.sale === null ? "—" : som(r.sale)}</span>
                  <span className="rcv-hide">
                    {payTone && r.pay_status && r.sale !== null ? (
                      <PayCell status={r.pay_status} sale={r.sale} debt={r.debt ?? 0} />
                    ) : (
                      <span style={css("color:var(--text-5)")}>—</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <TableFill tab={tab} empty={list.length === 0} />
      </div>
    </section>
  );
}

/** Строка «код не найден»: код на месте товара, а клиент, сумма и оплата — бледными заглушками вместо прочерков. */
function NotFoundRow({ r }: { r: ScanRow }) {
  return (
    <div className="rcv-row">
      <span style={css("width:24px;height:24px;border-radius:7px;display:grid;place-items:center;background:var(--danger-tint);color:var(--danger)")}>
        <Svg paths={I_ALERT} size={13} sw={2.4} />
      </span>
      <span style={css(NUM + ";color:var(--text-3)")}>{hhmm(r.scanned_at)}</span>
      <span className="rcv-hide" style={css("display:flex;align-items:center;gap:8px;min-width:0")}>
        <span className="sk sk-ring" style={css("width:22px;height:22px;border-radius:50%;flex:none")} />
        <span className="sk" style={css("width:55%;height:8px")} />
      </span>
      <span style={css("min-width:0")}>
        <span style={css(CODE + ";display:block;font-size:12.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{r.code}</span>
        <span style={css("display:block;font-size:11.5px;color:var(--danger);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>код не найден · ничего не изменено</span>
      </span>
      <span style={css("display:flex;justify-content:flex-end")}>
        <span className="sk" style={css("width:52px;height:8px")} />
      </span>
      <span className="rcv-hide" style={css("display:flex;flex-direction:column;gap:7px")}>
        <span className="sk" style={css("width:64px;height:8px")} />
        <span className="sk" style={css("width:100%;max-width:96px;height:3px")} />
      </span>
    </div>
  );
}

/** Что написать под строками на каждой вкладке: пока строки есть и когда их нет. */
const FILL: Record<TodayTab, { icon: PathDef; tone: keyof typeof TINT; title: string; hint: string; emptyTitle: string; emptyHint: string }> = {
  arrived: {
    icon: I_CHECK,
    tone: "accent",
    title: "Новые сканы появляются сверху",
    hint: "нажмите на строку — откроется карточка товара",
    emptyTitle: "Сегодня ещё ничего не принято",
    emptyHint: "отсканируйте код на пульте — товар появится здесь",
  },
  repeat: {
    icon: I_REPEAT,
    tone: "amber",
    title: "Повторный скан ничего не меняет",
    hint: "статус, деньги и партия товара остаются прежними",
    emptyTitle: "Повторных сканов нет",
    emptyHint: "каждый код сегодня отсканирован один раз",
  },
  not_found: {
    icon: I_ALERT,
    tone: "danger",
    title: "Проверьте коды на упаковке",
    hint: "возможно, опечатка или товара ещё нет в заказах",
    emptyTitle: "Ненайденных кодов нет",
    emptyHint: "все отсканированные коды нашлись в заказах",
  },
};

/** Пустое место под строками: бледные строки-заготовки и подсказка, чтобы таблица не выглядела пустой. */
function TableFill({ tab, empty }: { tab: TodayTab; empty: boolean }) {
  const f = FILL[tab];
  const ok = empty && tab !== "arrived"; // нет повторов или ненайденных — это хорошо
  const [tint, fg] = TINT[ok ? "green" : f.tone];
  return (
    <div className="ghost-fill" style={css(empty ? "min-height:220px" : "")}>
      <div className="ghost-rows" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="rcv-row">
            <span className="sk" style={css("width:24px;height:24px;border-radius:7px")} />
            <span className="sk" style={css("width:34px;height:8px")} />
            <span className="rcv-hide" style={css("display:flex;align-items:center;gap:8px")}>
              <span className="sk" style={css("width:22px;height:22px;border-radius:50%;flex:none")} />
              <span className="sk" style={mix("height:8px", { width: `${[62, 48, 70, 55][i % 4]}%` })} />
            </span>
            <span style={css("display:flex;flex-direction:column;gap:7px")}>
              <span className="sk" style={mix("height:8px", { width: `${[58, 72, 46, 64][i % 4]}%` })} />
              <span className="sk" style={css("width:38%;height:6px")} />
            </span>
            <span style={css("display:flex;justify-content:flex-end")}>
              <span className="sk" style={css("width:52px;height:8px")} />
            </span>
            <span className="rcv-hide" style={css("display:flex;flex-direction:column;gap:7px")}>
              <span className="sk" style={css("width:64px;height:8px")} />
              <span className="sk" style={css("width:100%;max-width:96px;height:3px")} />
            </span>
          </div>
        ))}
      </div>
      <div className="ghost-msg">
        <span style={mix("width:34px;height:34px;border-radius:10px;flex:none;display:grid;place-items:center", { background: tint, color: fg })}>
          <Svg paths={ok ? I_CHECK : f.icon} size={16} sw={2.2} />
        </span>
        <span style={css("min-width:0")}>
          <span style={css("display:block;font-size:13px;font-weight:600;color:var(--text)")}>{empty ? f.emptyTitle : f.title}</span>
          <span style={css("display:block;font-size:12px;color:var(--text-4);margin-top:2px")}>{empty ? f.emptyHint : f.hint}</span>
        </span>
      </div>
    </div>
  );
}
