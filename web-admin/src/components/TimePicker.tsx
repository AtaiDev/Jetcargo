/**
 * Поле времени в стиле админки — пара к DatePicker вместо браузерного <input type="time">.
 *
 * Поле выглядит как поле даты (иконка в цветной подложке), выпадашка — тем же порталом с
 * position:fixed: две колонки «часы» и «минуты» (минуты шагом 5, выбранная — всегда в списке),
 * быстрые кнопки «Сейчас» и «−1 час». Если снизу мало места — открывается вверх.
 * Клавиатура: ↑/↓ — минута ±5 (с Shift — час), Enter/Esc — закрыть.
 * Значение — строка HH:MM. auto — время идёт само («сейчас»): в поле горит «живая» зелёная точка.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { css, mix } from "../design/css";

const GAP = 6;
const POP_W = 236;
const POP_H = 330;
const NUM = "font-variant-numeric:tabular-nums";

const pad = (n: number) => String(n).padStart(2, "0");
const parse = (v: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  return m ? { h: Math.min(23, +m[1]), m: Math.min(59, +m[2]) } : { h: 12, m: 0 };
};
const fmt = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

export default function TimePicker({
  value,
  onChange,
  auto,
  onNow,
  width,
  height = 36,
  fontSize = 13,
  ariaLabel = "Время",
}: {
  value: string;
  onChange: (v: string) => void;
  /** Время идёт само («сейчас») — в поле так и подписано. */
  auto?: boolean;
  /** Вернуть «сейчас». */
  onNow?: () => void;
  width?: number | string;
  height?: number;
  fontSize?: number;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const hoursRef = useRef<HTMLDivElement>(null);
  const minsRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const { h, m } = parse(value);

  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);
  if (!minutes.includes(m)) minutes.push(m);
  minutes.sort((a, b) => a - b);

  const place = useCallback(() => {
    const el = btn.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.right - POP_W, vw - POP_W - 8));
    const below = vh - r.bottom - GAP - 8;
    if (below >= POP_H || below >= r.top) setPos({ left, top: r.bottom + GAP });
    else setPos({ left, bottom: vh - r.top + GAP });
  }, []);

  function show() {
    place();
    setOpen(true);
  }
  function close(focus = true) {
    setOpen(false);
    if (focus) btn.current?.focus();
  }
  const set = (nh: number, nm: number) => onChange(fmt((nh + 24) % 24, (nm + 60) % 60));

  // Выбранные час и минута — по центру своих колонок.
  useLayoutEffect(() => {
    if (!open) return;
    for (const box of [hoursRef.current, minsRef.current]) {
      const on = box?.querySelector<HTMLElement>("[aria-selected='true']");
      if (box && on) box.scrollTop = on.offsetTop - box.clientHeight / 2 + on.clientHeight / 2;
    }
  }, [open, h, m]);

  // Закрытие по клику снаружи; при прокрутке и ресайзе выпадашка едет за полем.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) close(false);
    };
    const move = (e: Event) => {
      if (pop.current?.contains(e.target as Node)) return; // прокрутка колонок — не повод двигать окно
      place();
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const d = e.key === "ArrowUp" ? 1 : -1;
      if (e.shiftKey) set(h + d, m);
      else {
        const total = (h * 60 + Math.round(m / 5) * 5 + d * 5 + 1440) % 1440;
        set(Math.floor(total / 60), total % 60);
      }
    } else if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") close(false);
  }

  const iconBox = Math.min(24, height - 10);
  const cell = (on: boolean) =>
    mix("display:flex;align-items:center;justify-content:center;height:30px;margin:1px 0;border:none;border-radius:8px;font-size:13px;cursor:pointer;width:100%;" + NUM, {
      background: on ? "var(--accent)" : "transparent",
      color: on ? "#fff" : "var(--text)",
      fontWeight: on ? 700 : 500,
      boxShadow: on ? "0 2px 8px rgba(62,99,221,.35)" : "none",
    });

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="dp-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        style={mix(
          "display:inline-flex;align-items:center;gap:8px;padding-right:10px;border-radius:8px;background:var(--surface);color:var(--text);text-align:left;min-width:0;max-width:100%;cursor:pointer;transition:border-color .12s,box-shadow .12s,background .12s",
          {
            width,
            height,
            fontSize,
            paddingLeft: (height - iconBox) / 2 - 1,
            border: `1px solid ${open ? "var(--accent)" : "var(--border-strong)"}`,
            boxShadow: open ? "0 0 0 3px rgba(62,99,221,.12)" : "none",
          }
        )}
      >
        <span
          className="dp-ico"
          style={mix("flex:none;display:grid;place-items:center;border-radius:6px;background:var(--accent-tint);color:var(--accent);transition:background .12s,color .12s", {
            width: iconBox,
            height: iconBox,
          })}
        >
          <ClockIcon size={Math.round(iconBox * 0.64)} />
        </span>
        <span style={css("font-weight:600;white-space:nowrap;" + NUM)}>{value}</span>
        {/* Время идёт само — «живая» зелёная точка вместо надписи */}
        {auto && <span className="tp-live" title="Сейчас — время идёт само" aria-label="сейчас" />}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="dialog"
            aria-label="Выбор времени"
            onMouseDown={(e) => e.preventDefault()}
            style={mix(
              "position:fixed;z-index:95;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 44px rgba(15,18,25,.2),0 3px 10px rgba(15,18,25,.08);animation:pop .14s ease;user-select:none",
              { left: pos.left, top: pos.top, bottom: pos.bottom, width: POP_W }
            )}
          >
            {/* Шапка: выбранное время крупно */}
            <div style={css("display:flex;align-items:baseline;justify-content:space-between;padding:2px 4px 10px")}>
              <span style={css("font-size:12px;font-weight:600;color:var(--text-3)")}>Время</span>
              <span style={css("font-size:22px;font-weight:700;letter-spacing:-.02em;color:var(--text);" + NUM)}>
                {pad(h)}
                <span style={css("color:var(--text-4);margin:0 1px")}>:</span>
                {pad(m)}
              </span>
            </div>

            <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px")}>
              {[
                { title: "часы", ref: hoursRef, items: Array.from({ length: 24 }, (_, i) => i), cur: h, pick: (v: number) => set(v, m) },
                { title: "минуты", ref: minsRef, items: minutes, cur: m, pick: (v: number) => set(h, v) },
              ].map((col) => (
                <div key={col.title}>
                  <div style={css("font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-4);text-align:center;margin-bottom:4px")}>{col.title}</div>
                  <div
                    ref={col.ref}
                    className="tp-col"
                    style={css("height:196px;overflow-y:auto;padding:2px 4px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border-2);scroll-behavior:smooth")}
                  >
                    {col.items.map((v) => {
                      const on = v === col.cur;
                      return (
                        <button key={v} type="button" tabIndex={-1} className="dp-btn" aria-selected={on} onClick={() => col.pick(v)} style={cell(on)}>
                          {pad(v)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div style={css("display:flex;align-items:center;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-2)")}>
              {onNow && <Chip label="Сейчас" onClick={() => onNow()} />}
              <Chip label="−1 час" onClick={() => set(h - 1, m)} />
              <span style={css("flex:1")} />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => close()}
                style={css("height:28px;padding:0 12px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:12px;font-weight:600;cursor:pointer")}
              >
                Готово
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function Chip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="dp-chip"
      onClick={onClick}
      style={css("height:28px;padding:0 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--text-2);font-size:12px;font-weight:500;cursor:pointer;transition:border-color .12s,color .12s")}
    >
      {label}
    </button>
  );
}

function ClockIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
