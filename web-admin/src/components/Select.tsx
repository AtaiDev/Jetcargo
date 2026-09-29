/**
 * Выпадающий список в стиле админки — вместо браузерного <select>.
 *
 * Меню рисуется порталом в body с position:fixed, поэтому его не обрезают
 * панели с overflow:hidden и модалки; если снизу мало места — открывается вверх.
 * Клавиатура: ↑/↓, Home/End, Enter/Пробел, Esc, Tab, поиск по первым буквам.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { css, mix } from "../design/css";

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  /** Серая подпись справа (например, «24 строки»). */
  hint?: string;
  /** Цветная точка слева — для статусов. */
  dot?: string;
}

const MENU_MAX = 300;
const GAP = 4;

export default function Select<V extends string>({
  value,
  onChange,
  options,
  width = "100%",
  height = 36,
  fontSize = 13,
  invalid,
  highlight,
  placeholder = "Выберите…",
  ariaLabel,
  menuMinWidth = 180,
  style,
}: {
  value: V;
  onChange: (v: V) => void;
  options: SelectOption<V>[];
  width?: number | string;
  height?: number;
  fontSize?: number;
  /** Красная рамка — обязательное поле не заполнено. */
  invalid?: boolean;
  /** Акцентная рамка и цвет — выбрано что-то «включающее» (например, партия). */
  highlight?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  menuMinWidth?: number;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const place = useCallback(() => {
    const el = btn.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(Math.max(r.width, menuMinWidth), vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const below = vh - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const want = Math.min(MENU_MAX, options.length * 34 + 10);
    if (below >= want || below >= above) setPos({ left, top: r.bottom + GAP, width: w, maxHeight: Math.max(120, Math.min(MENU_MAX, below)) });
    else setPos({ left, bottom: vh - r.top + GAP, width: w, maxHeight: Math.min(MENU_MAX, above) });
  }, [menuMinWidth, options.length]);

  function show() {
    setActive(Math.max(0, selectedIndex));
    place();
    setOpen(true);
  }
  function close(focus = true) {
    setOpen(false);
    if (focus) btn.current?.focus();
  }
  function pick(i: number) {
    const o = options[i];
    if (!o) return;
    if (o.value !== value) onChange(o.value);
    close();
  }

  // Закрытие по клику снаружи; при прокрутке и ресайзе меню едет за кнопкой.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !menu.current?.contains(t)) close(false);
    };
    const move = (e: Event) => {
      if (menu.current && e.target instanceof Node && menu.current.contains(e.target)) return;
      place();
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", move, true);
      window.removeEventListener("resize", move);
    };
  }, [open, place]);

  // Активный пункт всегда в зоне видимости.
  useLayoutEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e: React.KeyboardEvent) {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => Math.min(last, a + 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        return;
      case "Home":
        e.preventDefault();
        setActive(0);
        return;
      case "End":
        e.preventDefault();
        setActive(last);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(active);
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // не закрывать модалку, в которой стоит список
        close();
        return;
      case "Tab":
        close(false);
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const t = typed.current;
      t.text = (now - t.at > 600 ? "" : t.text) + e.key.toLowerCase();
      t.at = now;
      const clean = (s: string) => s.toLowerCase().replace(/^[—\s-]+/, "");
      const found = options.findIndex((o) => clean(o.label).startsWith(t.text));
      if (found >= 0) setActive(found);
    }
  }

  const border = invalid ? "var(--danger-border)" : highlight ? "var(--accent)" : open ? "var(--accent)" : "var(--border-strong)";
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="sel-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        style={{
          ...mix(
            "display:inline-flex;align-items:center;gap:8px;padding:0 10px 0 11px;border-radius:8px;background:var(--surface);cursor:pointer;text-align:left;min-width:0;max-width:100%;transition:border-color .12s,box-shadow .12s",
            {
              width,
              height,
              fontSize,
              border: `1px solid ${border}`,
              boxShadow: open ? "0 0 0 3px rgba(62,99,221,.12)" : "none",
              color: highlight ? "var(--accent-strong)" : "var(--text)",
              fontWeight: highlight ? 600 : 400,
            }
          ),
          ...style,
        }}
      >
        {selected?.dot && <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: selected.dot })} />}
        <span
          style={mix("flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", {
            color: selected ? undefined : "var(--text-4)",
          })}
        >
          {selected ? selected.label : placeholder}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={mix("flex:none;transition:transform .15s", { color: "var(--text-4)", transform: open ? "rotate(180deg)" : "none" })}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            style={mix(
              "position:fixed;z-index:95;overflow-y:auto;padding:4px;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 32px rgba(15,18,25,.16),0 2px 6px rgba(15,18,25,.06);animation:pop .12s ease",
              { left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width, width: "max-content", maxWidth: window.innerWidth - pos.left - 8, maxHeight: pos.maxHeight }
            )}
          >
            {options.map((o, i) => {
              const on = o.value === value;
              return (
                <div
                  key={o.value}
                  data-i={i}
                  role="option"
                  aria-selected={on}
                  onPointerMove={() => active !== i && setActive(i)}
                  onClick={() => pick(i)}
                  style={mix("display:flex;align-items:center;gap:8px;min-height:32px;padding:6px 10px;border-radius:7px;cursor:pointer;font-size:13px;line-height:1.3", {
                    background: i === active ? "var(--hover)" : "transparent",
                    color: on ? "var(--accent-strong)" : "var(--text)",
                    fontWeight: on ? 600 : 400,
                  })}
                >
                  {o.dot && <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: o.dot })} />}
                  <span style={css("flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{o.label}</span>
                  {o.hint && <span style={css("flex:none;font-size:11.5px;color:var(--text-4);font-weight:400")}>{o.hint}</span>}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={mix("flex:none", { visibility: on ? "visible" : "hidden", color: "var(--accent)" })}
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
