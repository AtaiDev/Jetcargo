/**
 * Поле даты в стиле админки — вместо браузерного <input type="date">.
 *
 * Браузерный календарь не слушается темы (в тёмной теме его иконка оставалась чёрной),
 * и выпадашку у него не оформить — поэтому и поле, и календарь свои.
 * Календарь рисуется порталом в body с position:fixed (как меню в Select), поэтому его
 * не обрезают модалки; если снизу мало места — открывается вверх.
 * Фокус всё время остаётся на поле. Клавиатура: ←/→ день, ↑/↓ неделя, PgUp/PgDn месяц
 * (с Shift — год), Home/End начало/конец недели, Enter/Пробел выбрать, Esc закрыть.
 * Значение — строка YYYY-MM-DD, как у <input type="date">.
 */
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { css, mix, MONO } from "../design/css";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «Сегодня, 4 октября» · «Вчера, 3 октября» · «Пт, 2 октября» · «Пн, 5 мая 2025» — год, только если не текущий. */
function inWords(d: Date): string {
  const now = new Date();
  const k = key(d);
  const day = `${d.getDate()} ${MONTHS_OF[d.getMonth()]}`;
  if (k === key(now)) return `Сегодня, ${day}`;
  if (k === key(addDays(now, -1))) return `Вчера, ${day}`;
  if (k === key(addDays(now, 1))) return `Завтра, ${day}`;
  return `${WEEKDAYS[weekday(d)]}, ${day}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}

const GAP = 6;
const POP_W = 284;
const POP_H = 360; // примерная высота календаря — чтобы решить, открывать вниз или вверх

const pad = (n: number) => String(n).padStart(2, "0");
/** Дата → YYYY-MM-DD по местному времени (toISOString сдвинул бы дату по UTC). */
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const weekday = (d: Date) => (d.getDay() + 6) % 7; // 0 = понедельник

function fromKey(s: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** ±N месяцев без перескока: 31 января + 1 месяц → 28/29 февраля, а не 3 марта. */
function addMonths(d: Date, n: number): Date {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
}

type Anim = "" | "next" | "prev" | "zoom";
const ANIM: Record<Anim, string> = { "": "none", next: "dpNext .18s ease", prev: "dpPrev .18s ease", zoom: "dpZoom .16s ease" };

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  range,
  disabled,
  width,
  height = 36,
  fontSize = 13,
  placeholder = "Выберите дату",
  ariaLabel,
  style,
  words,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Границы выбора (YYYY-MM-DD), как у <input type="date">. */
  min?: string;
  max?: string;
  /** Подсветить период в календаре — для пары «с — по». */
  range?: [string, string];
  disabled?: boolean;
  width?: number | string;
  height?: number;
  fontSize?: number;
  placeholder?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  /** Дата словами («Сегодня, 4 октября») обычным шрифтом — для одиночного поля в форме. */
  words?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"days" | "months">("days");
  const [cursor, setCursor] = useState<Date>(() => fromKey(value) ?? new Date());
  const [anim, setAnim] = useState<Anim>("");
  const [kbd, setKbd] = useState(false); // рамку курсора показываем только при работе с клавиатуры
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();

  const selected = fromKey(value);
  const today = key(new Date());
  const allowed = (k: string) => (!min || k >= min) && (!max || k <= max);

  const place = useCallback(() => {
    const el = btn.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - POP_W - 8));
    const below = vh - r.bottom - GAP - 8;
    if (below >= POP_H || below >= r.top) setPos({ left, top: r.bottom + GAP });
    else setPos({ left, bottom: vh - r.top + GAP });
  }, []);

  function show() {
    if (disabled) return;
    setCursor(fromKey(value) ?? new Date());
    setMode("days");
    setAnim("");
    setKbd(false);
    place();
    setOpen(true);
  }
  function close(focus = true) {
    setOpen(false);
    if (focus) btn.current?.focus();
  }
  function pick(d: Date) {
    const k = key(d);
    if (!allowed(k)) return;
    if (k !== value) onChange(k);
    close();
  }
  /** Сдвинуть курсор; при смене месяца (в режиме месяцев — года) сетка въезжает сбоку. */
  function moveTo(next: Date, viaKbd: boolean) {
    const years = next.getFullYear() - cursor.getFullYear();
    const diff = mode === "days" ? years * 12 + next.getMonth() - cursor.getMonth() : years;
    if (diff) setAnim(diff > 0 ? "next" : "prev");
    setCursor(next);
    setKbd(viaKbd);
  }
  function switchMode(m: "days" | "months") {
    setMode(m);
    setAnim("zoom");
  }

  // Закрытие по клику снаружи; при прокрутке и ресайзе календарь едет за полем.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) close(false);
    };
    const move = () => place();
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
    };
  }, [open, place]);

  // Поле выключили (например, «за все дни») — календарь закрываем.
  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const go = (d: Date) => {
      e.preventDefault();
      moveTo(d, true);
    };
    const months = mode === "months";
    switch (e.key) {
      case "ArrowLeft":
        return go(months ? addMonths(cursor, -1) : addDays(cursor, -1));
      case "ArrowRight":
        return go(months ? addMonths(cursor, 1) : addDays(cursor, 1));
      case "ArrowUp":
        return go(months ? addMonths(cursor, -3) : addDays(cursor, -7));
      case "ArrowDown":
        return go(months ? addMonths(cursor, 3) : addDays(cursor, 7));
      case "PageUp":
        return go(addMonths(cursor, months || e.shiftKey ? -12 : -1));
      case "PageDown":
        return go(addMonths(cursor, months || e.shiftKey ? 12 : 1));
      case "Home":
        return go(months ? new Date(cursor.getFullYear(), 0, 1) : addDays(cursor, -weekday(cursor)));
      case "End":
        return go(months ? new Date(cursor.getFullYear(), 11, 1) : addDays(cursor, 6 - weekday(cursor)));
      case "Enter":
      case " ":
        e.preventDefault();
        if (months) switchMode("days");
        else pick(cursor);
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // не закрывать модалку, в которой стоит поле
        if (months) switchMode("days");
        else close();
        return;
      case "Tab":
        close(false);
        return;
    }
  }

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const iconBox = Math.min(24, height - 10);
  const label = selected ? (words ? inWords(selected) : `${pad(selected.getDate())}.${pad(selected.getMonth() + 1)}.${selected.getFullYear()}`) : placeholder;

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="dp-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        style={{
          ...mix(
            "display:inline-flex;align-items:center;gap:9px;padding-right:12px;border-radius:8px;background:var(--surface);color:var(--text);text-align:left;min-width:0;max-width:100%;transition:border-color .12s,box-shadow .12s,background .12s",
            {
              width,
              height,
              fontSize,
              paddingLeft: (height - iconBox) / 2 - 1,
              border: `1px solid ${open ? "var(--accent)" : "var(--border-strong)"}`,
              boxShadow: open ? "0 0 0 3px rgba(62,99,221,.12)" : "none",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }
          ),
          ...style,
        }}
      >
        <span
          className="dp-ico"
          style={mix("flex:none;display:grid;place-items:center;border-radius:6px;background:var(--accent-tint);color:var(--accent);transition:background .12s,color .12s", {
            width: iconBox,
            height: iconBox,
          })}
        >
          <CalendarIcon size={Math.round(iconBox * 0.64)} />
        </span>
        <span
          style={mix("flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", words ? "font-weight:500" : "letter-spacing:.2px;" + MONO, {
            color: selected ? undefined : "var(--text-4)",
          })}
        >
          {label}
        </span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="dialog"
            aria-label="Выбор даты"
            // Клики внутри календаря не забирают фокус у поля — клавиатура продолжает работать.
            onMouseDown={(e) => e.preventDefault()}
            style={mix(
              "position:fixed;z-index:95;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 44px rgba(15,18,25,.2),0 3px 10px rgba(15,18,25,.08);animation:pop .14s ease;user-select:none",
              { left: pos.left, top: pos.top, bottom: pos.bottom, width: POP_W }
            )}
          >
            {/* Шапка: месяц и год (клик — выбор месяца), стрелки */}
            <div style={css("display:flex;align-items:center;gap:2px;margin-bottom:8px")}>
              <button
                type="button"
                tabIndex={-1}
                className="dp-btn"
                onClick={() => switchMode(mode === "days" ? "months" : "days")}
                style={css(
                  "display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 8px 0 9px;border:none;border-radius:8px;background:transparent;color:var(--text);font-size:14px;font-weight:600;cursor:pointer"
                )}
              >
                {mode === "days" ? `${MONTHS[m]} ${y}` : y}
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={mix("transition:transform .15s", { color: "var(--text-4)", transform: mode === "months" ? "rotate(180deg)" : "none" })}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              <span style={css("flex:1")} />
              <NavButton dir={-1} label={mode === "days" ? "Предыдущий месяц" : "Предыдущий год"} onClick={() => moveTo(addMonths(cursor, mode === "days" ? -1 : -12), false)} />
              <NavButton dir={1} label={mode === "days" ? "Следующий месяц" : "Следующий год"} onClick={() => moveTo(addMonths(cursor, mode === "days" ? 1 : 12), false)} />
            </div>

            <div style={css("height:246px;overflow:hidden")}>
              {mode === "days" ? (
                <div key={`d${y}-${m}`} style={mix({ animation: ANIM[anim] })}>
                  <div style={css("display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px")}>
                    {WEEKDAYS.map((w, i) => (
                      <div
                        key={w}
                        style={mix("height:24px;display:grid;place-items:center;font-size:11px;font-weight:600;letter-spacing:.3px", {
                          color: i >= 5 ? "var(--text-5)" : "var(--text-4)",
                        })}
                      >
                        {w}
                      </div>
                    ))}
                  </div>
                  <DayGrid
                    year={y}
                    month={m}
                    value={value}
                    cursor={kbd ? key(cursor) : ""}
                    today={today}
                    range={range}
                    allowed={allowed}
                    onPick={pick}
                    onHover={() => kbd && setKbd(false)}
                  />
                </div>
              ) : (
                <div key={`m${y}`} style={mix("display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,1fr);gap:6px;height:100%", { animation: ANIM[anim] })}>
                  {MONTHS_SHORT.map((name, i) => {
                    const on = !!selected && selected.getFullYear() === y && selected.getMonth() === i;
                    const now = today.slice(0, 7) === `${y}-${pad(i + 1)}`;
                    const ok = (!min || key(new Date(y, i + 1, 0)) >= min) && (!max || key(new Date(y, i, 1)) <= max); // месяц пересекается с [min, max]
                    const focused = kbd && m === i;
                    return (
                      <button
                        key={name}
                        type="button"
                        tabIndex={-1}
                        className="dp-btn"
                        disabled={!ok}
                        aria-selected={on}
                        onPointerMove={() => kbd && setKbd(false)}
                        onClick={() => {
                          setCursor(addMonths(cursor, i - m));
                          switchMode("days");
                        }}
                        style={mix("border:none;border-radius:10px;font-size:13px;cursor:pointer", {
                          background: on ? "var(--accent)" : "transparent",
                          color: on ? "#fff" : now ? "var(--accent-strong)" : "var(--text)",
                          fontWeight: on || now ? 600 : 500,
                          boxShadow: on ? "0 2px 8px rgba(62,99,221,.35)" : focused ? "inset 0 0 0 1.5px var(--accent)" : "none",
                          opacity: ok ? 1 : 0.35,
                          cursor: ok ? "pointer" : "not-allowed",
                        })}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Быстрый выбор и выбранная дата словами */}
            <div style={css("display:flex;align-items:center;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-2)")}>
              <Chip label="Сегодня" disabled={!allowed(today)} onClick={() => pick(new Date())} />
              <Chip label="Вчера" disabled={!allowed(key(addDays(new Date(), -1)))} onClick={() => pick(addDays(new Date(), -1))} />
              <span style={css("flex:1;text-align:right;font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                {selected ? selected.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" }) : ""}
              </span>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/** Сетка 6×7 — высота календаря не прыгает от месяца к месяцу. */
function DayGrid({
  year,
  month,
  value,
  cursor,
  today,
  range,
  allowed,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  value: string;
  cursor: string;
  today: string;
  range?: [string, string];
  allowed: (k: string) => boolean;
  onPick: (d: Date) => void;
  onHover: () => void;
}) {
  const first = new Date(year, month, 1);
  const start = addDays(first, -weekday(first));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div role="grid" style={css("display:grid;grid-template-columns:repeat(7,1fr);gap:2px")}>
      {days.map((d) => {
        const k = key(d);
        const on = k === value;
        const inMonth = d.getMonth() === month;
        const isToday = k === today;
        const ok = allowed(k);
        const inRange = !!range && k >= range[0] && k <= range[1];
        return (
          <button
            key={k}
            type="button"
            tabIndex={-1}
            role="gridcell"
            className="dp-btn"
            disabled={!ok}
            aria-selected={on}
            aria-current={isToday ? "date" : undefined}
            aria-label={d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            onPointerMove={onHover}
            onClick={() => onPick(d)}
            style={mix("position:relative;height:34px;padding:0;border:none;border-radius:9px;font-size:12.5px", MONO, {
              background: on ? "var(--accent)" : inRange ? "var(--accent-tint)" : "transparent",
              color: on ? "#fff" : !inMonth ? "var(--text-5)" : isToday ? "var(--accent-strong)" : inRange ? "var(--accent-strong)" : "var(--text)",
              fontWeight: on || isToday ? 600 : 400,
              boxShadow: on ? "0 2px 8px rgba(62,99,221,.35)" : k === cursor ? "inset 0 0 0 1.5px var(--accent)" : "none",
              opacity: ok ? 1 : 0.35,
              cursor: ok ? "pointer" : "not-allowed",
              textDecoration: ok ? "none" : "line-through",
            })}
          >
            {d.getDate()}
            {isToday && (
              <span
                style={mix("position:absolute;left:50%;bottom:4px;width:4px;height:4px;margin-left:-2px;border-radius:50%", {
                  background: on ? "#fff" : "var(--accent)",
                })}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function NavButton({ dir, label, onClick }: { dir: -1 | 1; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="dp-btn"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={css("width:32px;height:32px;display:grid;place-items:center;padding:0;border:none;border-radius:8px;background:transparent;color:var(--text-2);cursor:pointer")}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir < 0 ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
      </svg>
    </button>
  );
}

function Chip({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="dp-chip"
      disabled={disabled}
      onClick={onClick}
      style={mix(
        "height:28px;padding:0 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--text-2);font-size:12px;font-weight:500;transition:border-color .12s,color .12s",
        { opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" }
      )}
    >
      {label}
    </button>
  );
}

function CalendarIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16.5" rx="3.5" />
      <path d="M3 9.5h18" />
      <path d="M8 2.5v4M16 2.5v4" />
      <rect x="13" y="13" width="4.5" height="4.5" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
