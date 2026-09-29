/**
 * Приём товара сканером.
 *
 * Сканер работает как клавиатура: «печатает» код и жмёт Enter. Поле всегда в фокусе.
 * Скан товара «Заказан» сразу ставит его «На складе» (это видно и в «Заказах»),
 * повторный скан только пишется в историю.
 *
 * Экран:
 *  - сверху — поле сканера и итоги дня (принято / повторных / не найдено / ещё ждём);
 *  - слева — карточка последнего скана: что за товар, чей, оплата, долг, история сканов;
 *  - справа — всё отсканированное сегодня: принятое сгруппировано по клиентам,
 *    отдельно повторы и ненайденные коды. Данные с сервера — не пропадают при перезагрузке.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { createBatch, listBatches, listItems, listScans, lookupCode, scanCode, type Batch, type ScanResponse, type ScanResult, type ScanRow } from "../api/domain";
import { Tabs } from "../components/cargo";
import ItemModal from "../components/ItemModal";
import Select from "../components/Select";
import { MONO, css, mix } from "../design/css";
import { I_SEARCH, Icon, Svg } from "../design/icons";
import { Page } from "../design/table";
import { HButton, ModalError, ST, StatusBadge, btnGhost, btnPrimary } from "../design/ui";
import { SCAN_LABEL, date, shortDateTime, som, todayIso } from "../lib/cargo";
import { emit, useRefresh } from "../lib/events";
import { scanSound, type ScanSound } from "../lib/sound";

type Toast = (kind: "success" | "error", text: string) => void;

const TONE: Record<ScanResult | "lookup", { bg: string; border: string; fg: string; title: string; icon: string }> = {
  arrived: { bg: "var(--accent-tint)", border: "var(--accent)", fg: "var(--accent-strong)", title: "Принят на склад", icon: "✓" },
  already_in_stock: { bg: "var(--amber-tint)", border: "var(--amber-dot)", fg: "var(--amber)", title: "Уже на складе", icon: "↻" },
  already_issued: { bg: "var(--muted-bg)", border: "var(--border-strong)", fg: "var(--text-2)", title: "Уже выдан клиенту", icon: "⇥" },
  not_found: { bg: "var(--danger-tint)", border: "var(--danger-dot)", fg: "var(--danger)", title: "Код не найден", icon: "?" },
  lookup: { bg: "var(--violet-tint)", border: "var(--violet-dot)", fg: "var(--violet)", title: "Найден — только просмотр", icon: "⌕" },
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
const MODES: { key: Mode; label: string; icon: ReactNode }[] = [
  { key: "batch", label: "В партию", icon: <Icon name="batches" size={15} /> },
  { key: "none", label: "Без партии", icon: <Icon name="receive" size={15} /> },
  { key: "search", label: "Поиск", icon: <Svg paths={I_SEARCH} size={15} /> },
];
const ACCEPT_TONE = { fg: "var(--accent-strong)", border: "var(--accent-border)", ring: "rgba(62,99,221,.14)", solid: "var(--accent)", tint: "var(--accent-tint2)" };
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
  const [batches, setBatches] = useState<Batch[]>([]);
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
  const batchName = sel === TODAY ? (todayBatch?.name ?? todayName) : batches.find((b) => b.id === batchId)?.name;
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

  const counts = useMemo(() => {
    const c = { arrived: 0, already_in_stock: 0, already_issued: 0, not_found: 0 } as Record<ScanResult, number>;
    for (const s of today) c[s.result]++;
    return c;
  }, [today]);

  return (
    <Page size="wide">
      {/* Поле сканера */}
      <div style={css("background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden")}>
        {/* Режим работы */}
        <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border-2);background:var(--surface-2)")}>
          <div className="scan-modes" style={css("display:inline-flex;gap:3px;padding:3px;border-radius:10px;background:var(--border-2)")}>
            {MODES.map((m) => {
              const on = mode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => pickMode(m.key)}
                  style={mix("display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 13px;border:none;border-radius:8px;font-size:12.5px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s", {
                    background: on ? "var(--surface)" : "transparent",
                    color: on ? MODE_TONE[m.key].fg : "var(--text-2)",
                    fontWeight: on ? 600 : 500,
                    boxShadow: on ? "0 1px 3px rgba(0,0,0,.1)" : "none",
                  })}
                >
                  <span style={css("display:flex")}>{m.icon}</span>
                  <span>
                    {m.label}
                    {m.key === "search" && <span className="hide-sm"> товара</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="hide-sm" style={css("flex:1")} />
          <HButton
            onClick={() => {
              setSound(!sound);
              if (!sound) scanSound("ok"); // образец звука
              refocus();
            }}
            title={sound ? "Выключить звук" : "Включить звук"}
            s={mix("display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:8px;font-size:12px;cursor:pointer;border:1px solid var(--border)", {
              background: "var(--surface)",
              color: sound ? "var(--text-2)" : "var(--text-4)",
            })}
            hover="border-color:var(--border-strong)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4V5Z" />
              {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m22 9-6 6M16 9l6 6" />}
            </svg>
            <span className="hide-sm">{sound ? "звук" : "без звука"}</span>
          </HButton>
        </div>

        {/* Поле ввода */}
        <div style={css("padding:16px;display:flex;flex-direction:column;gap:12px")}>
          <div style={css("display:flex;gap:10px;flex-wrap:wrap")}>
            <div
              className="scan-field"
              onClick={() => inputRef.current?.focus()}
              style={mix("flex:1 1 320px;min-width:0;display:flex;align-items:center;gap:12px;height:58px;padding:0 10px 0 16px;border-radius:12px;background:var(--surface);cursor:text;transition:border-color .15s", {
                border: `2px solid ${tone.border}`,
                ["--scan-ring" as string]: tone.ring,
              })}
            >
              <span style={mix("display:flex;flex:none", { color: tone.fg })}>
                {mode === "search" ? <Svg paths={I_SEARCH} size={22} /> : <Icon name="receive" size={24} />}
              </span>
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                onBlur={() => !open && setTimeout(() => document.activeElement === document.body && inputRef.current?.focus(), 200)}
                placeholder={mode === "search" ? "Код товара для поиска…" : "Сканируйте код…"}
                autoComplete="off"
                spellCheck={false}
                style={css("flex:1;min-width:0;height:100%;border:none;outline:none;background:transparent;font-size:20px;letter-spacing:.04em;box-shadow:none;" + MONO)}
              />
              {code ? (
                <HButton
                  onClick={() => {
                    setCode("");
                    refocus();
                  }}
                  title="Очистить"
                  s="width:30px;height:30px;border:none;border-radius:8px;background:var(--hover);color:var(--text-3);cursor:pointer;font-size:13px;flex:none"
                  hover="background:var(--border);color:var(--text)"
                >
                  ✕
                </HButton>
              ) : (
                <span style={css("flex:none;font-size:11px;color:var(--text-4);border:1px solid var(--border);border-bottom-width:2px;border-radius:6px;padding:2px 7px;" + MONO)}>Enter</span>
              )}
            </div>
            <HButton
              className="scan-btn"
              disabled={busy}
              onClick={submit}
              s={mix("height:58px;min-width:150px;padding:0 26px;border:none;border-radius:12px;color:#fff;font-size:15px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;flex:1 0 auto;max-width:220px", {
                background: tone.solid,
                opacity: busy ? 0.7 : 1,
              })}
              hover="filter:brightness(.94)"
            >
              {busy ? "…" : mode === "search" ? "Найти" : "Принять"}
            </HButton>
          </div>

          {/* Что происходит в этом режиме */}
          {mode === "batch" ? (
            <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px")}>
              <span style={css("display:inline-flex;align-items:center;gap:6px;color:var(--text-3)")}>
                <Icon name="batches" size={15} /> Партия
              </span>
              <Select
                value={sel}
                onChange={pickBatch}
                width={240}
                height={34}
                fontSize={12.5}
                highlight
                ariaLabel="Партия"
                menuMinWidth={300}
                options={[
                  { value: TODAY, label: todayBatch?.name ?? todayName, hint: todayBatch ? "сегодня" : "создастся при скане" },
                  ...batches.filter((b) => b.id !== todayBatch?.id).map((b) => ({ value: String(b.id), label: b.name })),
                ]}
              />
              {sel === TODAY && !todayBatch ? (
                <span style={css("display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:7px;background:var(--accent-tint2);color:var(--accent-strong);font-size:11.5px")}>
                  <span style={css("width:6px;height:6px;border-radius:50%;background:var(--accent)")} />
                  создастся при первом скане
                </span>
              ) : (
                batchId && (
                  <HButton onClick={() => nav(`/batches/${batchId}`)} s="border:none;background:transparent;padding:0 4px;color:var(--accent);font-size:12px;cursor:pointer" hover="color:var(--accent-hover)">
                    расчёт партии →
                  </HButton>
                )
              )}
              <div style={css("flex:1")} />
              <HButton
                onClick={async () => {
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
                }}
                s="height:30px;padding:0 11px;border:1px dashed var(--border-strong);border-radius:8px;background:transparent;color:var(--text-3);font-size:12px;cursor:pointer"
                hover="border-color:var(--accent);color:var(--accent)"
              >
                + ещё партия
              </HButton>
            </div>
          ) : (
            <div
              style={mix("display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:9px;font-size:12.5px;line-height:1.4", {
                background: tone.tint,
                color: tone.fg,
              })}
            >
              <span style={mix("width:6px;height:6px;border-radius:50%;flex:none", { background: tone.solid })} />
              {mode === "none"
                ? "Товар принимается на склад без партии — добавить в партию можно позже на странице «Партии»."
                : "Только просмотр: статус товара не меняется, в историю сканов ничего не записывается."}
            </div>
          )}
        </div>
      </div>

      {/* Итоги дня */}
      <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:12px")}>
        <DayStat label="Принято сегодня" value={counts.arrived} color="var(--accent-strong)" dot="var(--accent)" />
        <DayStat label="Повторных сканов" value={counts.already_in_stock + counts.already_issued} color="var(--amber)" dot="var(--amber-dot)" />
        <DayStat label="Не найдено" value={counts.not_found} color={counts.not_found ? "var(--danger)" : "var(--text)"} dot="var(--danger-dot)" />
        <DayStat
          label="Ещё ожидается"
          value={waiting ?? 0}
          color="var(--text)"
          dot="var(--amber-dot)"
          hint="товаров в статусе «Заказан»"
          onClick={() => nav("/orders?status=ordered")}
        />
      </div>

      {error && (
        <div style={css("margin-top:12px")}>
          <ModalError text={error} />
        </div>
      )}

      <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:14px;margin-top:14px;align-items:start")}>
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
        <TodayPanel rows={today} flashId={flashId} onOpen={setOpen} />
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

function DayStat({
  label,
  value,
  color,
  dot,
  hint,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  dot: string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <HButton
      onClick={onClick}
      title={hint}
      s={mix(
        "text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:11px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px",
        { cursor: onClick ? "pointer" : "default" }
      )}
      hover={onClick ? "border-color:var(--accent)" : ""}
    >
      <span style={css("display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-3)")}>
        <span style={mix("width:7px;height:7px;border-radius:50%", { background: dot })} />
        {label}
      </span>
      <span style={mix(MONO + ";font-size:20px;font-weight:700", { color })}>{value}</span>
    </HButton>
  );
}

// --- Последний скан ---------------------------------------------------------------------

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
  const box = "background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden";
  if (!last) {
    return (
      <div style={css(box + ";padding:40px 24px;text-align:center;color:var(--text-3)")}>
        <div style={css("width:56px;height:56px;border-radius:14px;background:var(--hover);color:var(--text-4);display:flex;align-items:center;justify-content:center;margin:0 auto 12px")}>
          <Icon name="receive" size={28} />
        </div>
        <div style={css("font-size:14px;font-weight:600;color:var(--text-2)")}>Отсканируйте код товара</div>
        <div style={css("font-size:12.5px;margin-top:4px;line-height:1.5")}>
          Здесь появится товар, клиент, оплата и долг. Товар «Заказан» сразу станет «На складе» — это видно и в «Заказах».
        </div>
      </div>
    );
  }
  const tone = TONE[last.result];
  const c = last.customer;
  return (
    <div key={at} style={css(box + ";animation:pop .2s ease")}>
      {/* Результат */}
      <div style={mix("display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border-2)", { background: tone.bg })}>
        <span
          style={mix("width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:#fff;flex:none", {
            background: tone.border,
          })}
        >
          {tone.icon}
        </span>
        <div style={css("min-width:0;flex:1")}>
          <div style={mix("font-size:16px;font-weight:700", { color: tone.fg })}>{tone.title}</div>
          <div style={css(MONO + ";font-size:12.5px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{last.code}</div>
        </div>
        <span style={css("display:flex;flex-direction:column;align-items:flex-end;gap:2px")}>
          <span style={css(MONO + ";font-size:12px;color:var(--text-3)")}>{hhmm(at)}</span>
          {last.result === "arrived" && batchName && <span style={css("font-size:11px;color:var(--accent-strong);white-space:nowrap")}>→ {batchName}</span>}
        </span>
      </div>

      {last.result === "not_found" ? (
        <div style={css("padding:16px;display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--text-2);line-height:1.55")}>
          <div>Такого кода нет ни у одного товара. Ничего не изменено{last.lookup ? "." : ", скан записан в историю."}</div>
          {last.suggestions.length > 0 && (
            <div>
              <div style={css("font-size:12px;font-weight:600;margin-bottom:6px")}>Похожие коды — возможно, опечатка:</div>
              <div style={css("display:flex;flex-direction:column;gap:6px")}>
                {last.suggestions.map((s) => (
                  <HButton
                    key={s.id}
                    onClick={() => onUseCode(s.code)}
                    s="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;text-align:left;padding:9px 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface-2);cursor:pointer;font-size:12.5px"
                    hover="border-color:var(--accent)"
                  >
                    <span style={css(MONO + ";font-weight:600")}>{s.code}</span>
                    <span style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                      {s.name} · <span style={css("color:var(--text-3)")}>{s.customer_name}</span>
                    </span>
                    <span style={css("font-size:11.5px;color:var(--accent)")}>подставить</span>
                  </HButton>
                ))}
              </div>
            </div>
          )}
          <div>
            <HButton onClick={() => nav(`/new-order?code=${encodeURIComponent(last.code)}`)} s={btnGhost} hover="border-color:var(--accent)">
              Добавить товар с этим кодом
            </HButton>
          </div>
        </div>
      ) : (
        <>
          {/* Клиент */}
          {c && (
            <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;padding:14px 16px;border-bottom:1px solid var(--border-2)")}>
              <span
                style={css(
                  "width:40px;height:40px;border-radius:50%;background:var(--accent-tint);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex:none"
                )}
              >
                {c.name.trim().slice(0, 1).toUpperCase()}
              </span>
              <div style={css("min-width:140px;flex:1")}>
                <HButton
                  onClick={() => nav(`/customers/${c.id}`)}
                  s="border:none;background:transparent;padding:0;cursor:pointer;font-size:17px;font-weight:700;color:var(--text);text-align:left"
                  hover="color:var(--accent)"
                >
                  {c.name}
                </HButton>
                <div style={css(MONO + ";font-size:13px;color:var(--text-2)")}>{c.phone || "—"}</div>
              </div>
              <div style={css("display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end")}>
                <Chip label="на складе" value={String(c.in_stock)} />
                <Chip label="ждём" value={String(c.ordered)} />
                <Chip label="долг" value={som(c.debt)} danger={c.debt > 0} />
              </div>
            </div>
          )}

          {/* Товары с этим кодом */}
          {last.items.map((it) => (
            <ScannedItem
              key={it.id}
              it={it}
              onOpen={() => onOpen(it.id)}
              onIssue={() => nav(`/issue?customer=${it.customer_id}`)}
            />
          ))}
        </>
      )}
    </div>
  );
}

/** Товар из скана: что это, статус, оплата крупно, история сканов и действия. */
function ScannedItem({ it, onOpen, onIssue }: { it: ScanResponse["items"][number]; onOpen: () => void; onIssue: () => void }) {
  const pay = PAY_TONE[it.pay_status];
  const paid = Math.min(it.paid, it.sale);
  const pct = it.sale > 0 ? Math.round((paid / it.sale) * 100) : 0;
  return (
    <div style={css("padding:16px;border-bottom:1px solid var(--border-2);display:flex;flex-direction:column;gap:14px")}>
      {/* Что за товар */}
      <div style={css("display:flex;align-items:flex-start;gap:12px")}>
        <div style={css("min-width:0;flex:1")}>
          <div style={css("font-size:17px;font-weight:700;line-height:1.3;overflow-wrap:anywhere")}>{it.name}</div>
          <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-top:4px;font-size:12.5px;color:var(--text-3)")}>
            <span style={css(MONO + ";color:var(--text-2)")}>{it.code || "без кода"}</span>
            <span style={css("width:3px;height:3px;border-radius:50%;background:var(--text-5)")} />
            <span>
              <b style={css(MONO + ";color:var(--text)")}>{it.qty}</b> шт
            </span>
            <span style={css("width:3px;height:3px;border-radius:50%;background:var(--text-5)")} />
            <span>заказ от {date(it.order_date)}</span>
          </div>
        </div>
        <span
          style={mix("display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:8px;font-size:13px;font-weight:700;white-space:nowrap;flex:none", {
            background: ST[it.status].bg,
            color: ST[it.status].fg,
          })}
        >
          <span style={mix("width:8px;height:8px;border-radius:50%", { background: ST[it.status].dot })} />
          {ST[it.status].label}
        </span>
      </div>

      {/* Оплата — главное, что нужно увидеть с одного взгляда */}
      <div style={mix("border-radius:12px;overflow:hidden", { border: `1px solid ${pay.border}` })}>
        <div style={mix("display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 14px", { background: pay.bg })}>
          <span
            style={mix("width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;flex:none", {
              background: pay.dot,
            })}
          >
            {pay.icon}
          </span>
          <span style={mix("font-size:15px;font-weight:700;flex:1;min-width:max-content", { color: pay.fg })}>{pay.title}</span>
          {it.debt > 0 && (
            <span style={mix(MONO + ";font-size:15px;font-weight:700;white-space:nowrap", { color: pay.fg })}>долг {som(it.debt)}</span>
          )}
        </div>
        <div style={css("display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:var(--surface)")}>
          <Money label="Сумма" value={som(it.sale)} />
          <Money label="Оплачено" value={paid > 0 ? som(paid) : "—"} color={paid > 0 ? "var(--green)" : "var(--text-4)"} divider />
          <Money label="Долг" value={it.debt > 0 ? som(it.debt) : "нет"} color={it.debt > 0 ? "var(--danger)" : "var(--text-4)"} divider />
        </div>
        {it.pay_status === "partial" && (
          <div style={css("height:4px;background:var(--border-2)")}>
            <div style={mix("height:100%;background:var(--green-dot)", { width: pct + "%" })} />
          </div>
        )}
      </div>

      {/* История сканов этого товара */}
      {it.scans.length > 0 && (
        <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:6px")}>
          <span style={css("font-size:11.5px;color:var(--text-4);margin-right:2px")}>Сканы:</span>
          {it.scans.map((sc, i) => {
            const lastOne = i === it.scans.length - 1;
            return (
              <span
                key={sc.id}
                style={mix("display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 9px;border-radius:14px;border-style:solid;border-width:1px;white-space:nowrap", {
                  borderColor: lastOne ? "var(--accent-border)" : "var(--border)",
                  background: lastOne ? "var(--accent-tint2)" : "var(--surface-2)",
                  color: lastOne ? "var(--accent-strong)" : "var(--text-3)",
                })}
              >
                <b style={css(MONO)}>№{i + 1}</b>
                <span style={css(MONO)}>{shortDateTime(sc.scanned_at)}</span>
                <span>{SCAN_LABEL[sc.result]}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Действия */}
      <div style={css("display:flex;gap:8px;flex-wrap:wrap")}>
        {it.status === "in_stock" && (
          <HButton onClick={onIssue} s={btnPrimary + ";height:36px"} hover="background:var(--accent-hover)">
            Выдать клиенту →
          </HButton>
        )}
        <HButton onClick={onOpen} s={btnGhost + ";height:36px"} hover="border-color:var(--accent)">
          {it.debt > 0 ? "Открыть и принять оплату" : "Карточка товара"}
        </HButton>
      </div>
    </div>
  );
}

const PAY_TONE: Record<"paid" | "partial" | "unpaid", { bg: string; fg: string; dot: string; border: string; icon: string; title: string }> = {
  paid: { bg: "var(--green-tint)", fg: "var(--green)", dot: "var(--green-dot)", border: "var(--green-tint)", icon: "✓", title: "Оплачено полностью" },
  partial: { bg: "var(--amber-tint)", fg: "var(--amber)", dot: "var(--amber-dot)", border: "var(--amber-tint)", icon: "½", title: "Оплачено частично" },
  unpaid: { bg: "var(--danger-tint)", fg: "var(--danger)", dot: "var(--danger-dot)", border: "var(--danger-border)", icon: "!", title: "Не оплачено" },
};

function Money({ label, value, color, divider }: { label: string; value: string; color?: string; divider?: boolean }) {
  return (
    <div style={mix("padding:10px 14px;min-width:0", divider ? { borderLeft: "1px solid var(--border-2)" } : {})}>
      <div style={css("font-size:11.5px;color:var(--text-3)")}>{label}</div>
      <div style={mix(MONO + ";font-size:16px;font-weight:700;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: color ?? "var(--text)" })}>
        {value}
      </div>
    </div>
  );
}

function Chip({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <span
      style={mix("display:inline-flex;gap:5px;align-items:baseline;font-size:11.5px;padding:4px 9px;border-radius:14px;white-space:nowrap", {
        background: danger ? "var(--danger-tint)" : "var(--hover)",
        color: danger ? "var(--danger)" : "var(--text-3)",
      })}
    >
      {label} <b style={mix(MONO, { color: danger ? "var(--danger)" : "var(--text)" })}>{value}</b>
    </span>
  );
}

// --- Отсканировано сегодня ----------------------------------------------------------------

type TodayTab = "arrived" | "repeat" | "not_found";

function TodayPanel({ rows, flashId, onOpen }: { rows: ScanRow[]; flashId: number | null; onOpen: (id: number) => void }) {
  const nav = useNavigate();
  const [tab, setTab] = useState<TodayTab>("arrived");
  const arrived = rows.filter((r) => r.result === "arrived");
  const repeat = rows.filter((r) => r.result === "already_in_stock" || r.result === "already_issued");
  const notFound = rows.filter((r) => r.result === "not_found");

  // Принятое — блоками по клиентам (порядок: у кого последний скан новее).
  const groups = useMemo(() => {
    const m = new Map<number, ScanRow[]>();
    for (const r of arrived) {
      const k = r.customer_id ?? 0;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.values()];
  }, [arrived]);

  const list = tab === "arrived" ? arrived : tab === "repeat" ? repeat : notFound;

  return (
    <div style={css("background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;max-height:640px")}>
      <div style={css("display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border)")}>
        <span style={css("font-size:14px;font-weight:700")}>Сегодня</span>
        <div style={css("flex:1")} />
        <Tabs<TodayTab>
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "arrived", label: "Принято", count: arrived.length, dot: "var(--accent)" },
            { key: "repeat", label: "Повторы", count: repeat.length, dot: "var(--amber-dot)" },
            { key: "not_found", label: "Не найдено", count: notFound.length, dot: "var(--danger-dot)" },
          ]}
        />
      </div>

      <div style={css("flex:1;min-height:0;overflow-y:auto")}>
        {list.length === 0 ? (
          <div style={css("padding:40px 20px;text-align:center;font-size:12.5px;color:var(--text-4)")}>
            {tab === "arrived" ? "Сегодня ещё ничего не принято" : tab === "repeat" ? "Повторных сканов нет" : "Ненайденных кодов нет"}
          </div>
        ) : tab === "arrived" ? (
          groups.map((g) => {
            const first = g[0];
            const debt = g.reduce((s, r) => s + (r.debt ?? 0), 0);
            return (
              <div key={`${first.customer_id}-${first.id}`} style={css("border-bottom:1px solid var(--border)")}>
                <div
                  onClick={() => first.customer_id && nav(`/customers/${first.customer_id}`)}
                  className="row-click"
                  style={css("display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--surface-2);font-size:12.5px")}
                >
                  <span
                    style={css(
                      "width:26px;height:26px;border-radius:50%;background:var(--accent-tint);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none"
                    )}
                  >
                    {(first.customer_name ?? "?").trim().slice(0, 1).toUpperCase()}
                  </span>
                  <span style={css("font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{first.customer_name}</span>
                  <span style={css(MONO + ";color:var(--text-3);white-space:nowrap")}>{first.customer_phone}</span>
                  <span style={css("flex:1")} />
                  <span style={css("color:var(--text-3);white-space:nowrap")}>{g.length} тов.</span>
                  {debt > 0 ? (
                    <span style={css("white-space:nowrap;color:var(--danger)")}>
                      долг <b style={css(MONO)}>{som(debt)}</b>
                    </span>
                  ) : (
                    <span style={css("white-space:nowrap;color:var(--green);font-weight:600")}>✓ оплачено</span>
                  )}
                </div>
                {g.map((r) => (
                  <ScanLine key={r.id} r={r} flash={flashId === r.order_item_id} onOpen={onOpen} />
                ))}
              </div>
            );
          })
        ) : (
          list.map((r) => <ScanLine key={r.id} r={r} flash={false} onOpen={onOpen} withCustomer />)
        )}
      </div>
    </div>
  );
}

function ScanLine({ r, flash, onOpen, withCustomer }: { r: ScanRow; flash: boolean; onOpen: (id: number) => void; withCustomer?: boolean }) {
  return (
    <div
      onClick={() => r.order_item_id && onOpen(r.order_item_id)}
      className={(r.order_item_id ? "row-click" : "") + (flash ? " scan-flash" : "")}
      style={css("display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 14px 9px 18px;border-top:1px solid var(--border-2);font-size:12.5px")}
    >
      <span style={css(MONO + ";font-size:11.5px;color:var(--text-3)")}>{hhmm(r.scanned_at)}</span>
      <div style={css("min-width:0")}>
        <div style={css("font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
          {r.item_name ?? <span style={css("color:var(--danger)")}>нет товара с таким кодом</span>}
          {r.qty ? <span style={css(MONO + ";color:var(--text-4);font-weight:400")}> × {r.qty}</span> : null}
        </div>
        <div style={css(MONO + ";font-size:11px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
          {r.code}
          {withCustomer && r.customer_name ? <span style={css("font-family:inherit")}> · {r.customer_name}</span> : null}
          {r.result !== "arrived" && r.result !== "not_found" ? ` · ${SCAN_LABEL[r.result].toLowerCase()} · скан №${r.scan_no}` : ""}
        </div>
      </div>
      <div style={css("display:flex;align-items:center;gap:8px")}>
        {r.sale !== null && <span style={css(MONO + ";font-weight:600;white-space:nowrap")}>{som(r.sale)}</span>}
        {r.pay_status && <StatusBadge status={r.pay_status} size="sm" />}
      </div>
    </div>
  );
}
