/**
 * Поиск клиента для нового заказа: имя или телефон в любом формате.
 *
 * Выпадающий список показывает все состояния, а не только удачу: идёт поиск
 * (скелетон / спиннер в поле), найдены клиенты (совпадение подсвечено), никого нет
 * (с кнопкой «Создать клиента» — имя или номер подставятся в форму нового клиента),
 * ошибка сети. Клавиатура: ↑/↓ выбор, Enter — выбрать или создать, Esc — закрыть.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { listCustomers, type CustomerRow } from "../api/domain";
import { MONO, css, mix } from "../design/css";
import { I_CLOSE, I_PLUS, I_SEARCH, Svg } from "../design/icons";
import { HButton } from "../design/ui";
import { capFirst, som } from "../lib/cargo";
import { useDebounced } from "../lib/events";
import { fullPhone, localDigits } from "./PhoneInput";

const LIMIT = 8;
const MIN = 2;

/** Цвет аватарки — по id, чтобы у клиента он всегда был один и тот же. */
const AVATARS = [
  ["var(--accent-tint)", "var(--accent-strong)"],
  ["var(--violet-tint)", "var(--violet)"],
  ["var(--green-tint)", "var(--green)"],
  ["var(--amber-tint)", "var(--amber)"],
] as const;

/** Для сравнения без учёта регистра и ё/е (длина строки не меняется). */
const fold = (s: string) => s.toLowerCase().replace(/ё/g, "е");
/** Цифры телефона из запроса — как на сервере: без ведущего 0. */
const queryDigits = (q: string) => q.replace(/\D/g, "").replace(/^0/, "");
/** Похоже на номер: только цифры и знаки номера, цифр не меньше шести. */
const looksLikePhone = (q: string) => /^[\d\s()+-]+$/.test(q) && q.replace(/\D/g, "").length >= 6;

const MARK = "background:color-mix(in srgb, var(--accent) 20%, transparent);color:inherit;border-radius:3px;padding:0 1px";

function markName(name: string, q: string): ReactNode {
  const i = fold(name).indexOf(fold(q));
  if (!q || i < 0) return name;
  return (
    <>
      {name.slice(0, i)}
      <mark style={css(MARK)}>{name.slice(i, i + q.length)}</mark>
      {name.slice(i + q.length)}
    </>
  );
}

/** Подсветить в «+996 505 586 217» цифры запроса, даже если он набран без пробелов. */
function markPhone(phone: string, q: string): ReactNode {
  const d = queryDigits(q);
  if (d.length < 3) return phone;
  const pos: number[] = [];
  for (let i = 0; i < phone.length; i++) if (/\d/.test(phone[i])) pos.push(i);
  const at = pos.map((p) => phone[p]).join("").indexOf(d);
  if (at < 0) return phone;
  const a = pos[at];
  const b = pos[at + d.length - 1] + 1;
  return (
    <>
      {phone.slice(0, a)}
      <mark style={css(MARK)}>{phone.slice(a, b)}</mark>
      {phone.slice(b)}
    </>
  );
}

export default function CustomerSearch({
  onPick,
  onCreate,
  autoFocus,
}: {
  onPick: (id: number) => void;
  /** Никого не нашли — подставить имя или номер в форму нового клиента. */
  onCreate: (prefill: { name?: string; phone?: string }) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 200);
  const [res, setRes] = useState<{ q: string; rows: CustomerRow[]; error?: boolean } | null>(null);
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.length < MIN) {
      setRes(null);
      return;
    }
    let alive = true;
    listCustomers({ q, limit: LIMIT })
      .then((r) => {
        if (!alive) return;
        setRes({ q, rows: r.rows });
        setActive(0);
      })
      .catch(() => alive && setRes({ q, rows: [], error: true }));
    return () => {
      alive = false;
    };
  }, [q]);

  // Клик мимо — список закрывается; фокус в поле снова его открывает.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open]);

  // Выбранная клавиатурой строка всегда видна.
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const typed = text.trim();
  const pending = typed.length >= MIN && res?.q !== typed;
  const rows = res?.rows ?? [];
  const show = open && typed.length >= MIN;
  const phone = looksLikePhone(typed);
  const notFound = !pending && !!res && !res.error && rows.length === 0;

  function pick(id: number) {
    onPick(id);
    setText("");
    setOpen(false);
  }
  function create() {
    onCreate(phone ? { phone: fullPhone(localDigits(typed)) } : { name: capFirst(typed) });
    setText("");
    setOpen(false);
  }
  function clear() {
    setText("");
    setRes(null);
    input.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (show) {
        e.preventDefault();
        setOpen(false);
      } else if (text) {
        e.preventDefault();
        clear();
      }
      return;
    }
    if (!show) {
      if (e.key === "ArrowDown" && typed.length >= MIN) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (pending) return;
      if (rows[active]) pick(rows[active].id);
      else if (notFound) create();
    }
  }

  return (
    <div ref={box} style={css("position:relative")}>
      <div
        className="cs-field"
        style={css(
          "display:flex;align-items:center;gap:10px;height:44px;padding:0 6px 0 13px;border:1px solid var(--border-strong);border-radius:10px;background:var(--surface);transition:border-color .12s,box-shadow .12s"
        )}
      >
        <span className="cs-ico" style={css("display:flex;flex:none;color:var(--text-4);transition:color .12s")}>
          <Svg paths={I_SEARCH} size={17} sw={2} />
        </span>
        <input
          ref={input}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Найти клиента: имя или телефон…"
          role="combobox"
          aria-expanded={show}
          aria-autocomplete="list"
          spellCheck={false}
          style={css("flex:1;min-width:0;height:100%;border:none;outline:none;background:transparent;font-size:14px;padding:0")}
        />
        {pending && (
          <span
            aria-label="Ищу…"
            style={css("width:15px;height:15px;flex:none;border-radius:50%;border:2px solid var(--border-strong);border-top-color:var(--accent);animation:spin .7s linear infinite")}
          />
        )}
        {text && (
          <HButton
            onClick={clear}
            aria-label="Очистить"
            title="Очистить (Esc)"
            s="width:30px;height:30px;flex:none;display:grid;place-items:center;padding:0;border:none;border-radius:7px;background:transparent;color:var(--text-4);cursor:pointer"
            hover="background:var(--hover);color:var(--text)"
          >
            <Svg paths={I_CLOSE} size={14} sw={2} />
          </HButton>
        )}
      </div>

      {show && (
        <div
          role="listbox"
          style={css(
            "position:absolute;top:calc(100% + 6px);left:0;right:0;z-index:30;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:0 16px 40px rgba(15,18,25,.16),0 2px 8px rgba(15,18,25,.06);overflow:hidden;animation:pop .14s ease"
          )}
        >
          {res?.error && !pending ? (
            <State icon={I_SEARCH} tone="danger" title="Не удалось выполнить поиск" text="Проверьте связь с сервером и попробуйте ещё раз." />
          ) : rows.length === 0 && pending ? (
            <Skeleton />
          ) : notFound ? (
            <State
              icon={I_SEARCH}
              title="Клиент не найден"
              text={
                <>
                  По запросу <b style={mix("color:var(--text);font-weight:600", phone ? MONO : "")}>«{typed}»</b> никого нет.
                  <br />
                  Проверьте {phone ? "номер" : "написание"} или добавьте нового клиента.
                </>
              }
              action={
                <HButton
                  onClick={create}
                  s="display:inline-flex;align-items:center;gap:7px;max-width:100%;height:36px;padding:0 14px;border:1px solid var(--accent-border);border-radius:9px;background:var(--accent-tint);color:var(--accent-strong);font-size:12.5px;font-weight:600;cursor:pointer"
                  hover="background:var(--accent);color:#fff;border-color:var(--accent)"
                >
                  <span style={css("display:flex;flex:none")}>
                    <Svg paths={I_PLUS} size={14} sw={2.4} />
                  </span>
                  <span style={css("overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                    {phone ? `Создать клиента с номером ${fullPhone(localDigits(typed))}` : `Создать клиента «${capFirst(typed)}»`}
                  </span>
                  <Kbd className="hide-sm">Enter</Kbd>
                </HButton>
              }
            />
          ) : (
            <>
              <div style={css("display:flex;align-items:center;gap:8px;padding:9px 14px 7px;font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-4)")}>
                Клиенты
                <span style={css("padding:1px 6px;border-radius:8px;background:var(--hover);color:var(--text-3);letter-spacing:0")}>
                  {rows.length}
                  {rows.length >= LIMIT ? "+" : ""}
                </span>
              </div>
              <div ref={list} style={mix("max-height:344px;overflow-y:auto;padding:0 6px 6px;transition:opacity .12s", { opacity: pending ? 0.55 : 1 })}>
                {rows.map((c, i) => (
                  <Row key={c.id} c={c} i={i} q={typed} active={i === active} onHover={() => setActive(i)} onPick={() => pick(c.id)} />
                ))}
              </div>
              <div
                className="hide-sm"
                style={css("display:flex;gap:14px;padding:8px 14px;border-top:1px solid var(--border-2);background:var(--surface-2);font-size:11px;color:var(--text-4)")}
              >
                <span>
                  <Kbd>↑</Kbd> <Kbd>↓</Kbd> выбор
                </span>
                <span>
                  <Kbd>Enter</Kbd> выбрать
                </span>
                <span>
                  <Kbd>Esc</Kbd> закрыть
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ c, i, q, active, onHover, onPick }: { c: CustomerRow; i: number; q: string; active: boolean; onHover: () => void; onPick: () => void }) {
  const [bg, fg] = AVATARS[c.id % AVATARS.length];
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-i={i}
      onPointerMove={() => !active && onHover()}
      onClick={onPick}
      style={mix(
        "display:flex;align-items:center;gap:11px;width:100%;padding:8px 10px;border:none;border-radius:9px;text-align:left;cursor:pointer;color:var(--text);transition:background .1s",
        { background: active ? "var(--hover)" : "transparent" }
      )}
    >
      <span style={mix("width:36px;height:36px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:14px;font-weight:700", { background: bg, color: fg })}>
        {c.name.trim().slice(0, 1).toUpperCase() || "?"}
      </span>
      <span style={css("flex:1;min-width:0")}>
        <span style={css("display:block;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{markName(c.name, q)}</span>
        <span style={css("display:block;margin-top:2px;font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
          {c.phone ? <span style={css(MONO)}>{markPhone(c.phone, q)}</span> : "без телефона"}
          {c.items > 0 && <> · {c.items} тов.</>}
        </span>
      </span>
      {c.debt > 0 ? (
        <Badge bg="var(--danger-tint)" fg="var(--danger)">
          долг {som(c.debt)}
        </Badge>
      ) : c.in_stock > 0 ? (
        <Badge bg="var(--green-tint)" fg="var(--green)">
          на складе {c.in_stock}
        </Badge>
      ) : null}
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={mix("flex:none;transition:opacity .1s,transform .1s", { color: "var(--text-4)", opacity: active ? 1 : 0, transform: active ? "none" : "translateX(-3px)" })}
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

function Badge({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return <span style={mix("flex:none;padding:3px 9px;border-radius:10px;font-size:11.5px;font-weight:600;white-space:nowrap", { background: bg, color: fg })}>{children}</span>;
}

function State({
  icon,
  title,
  text,
  action,
  tone,
}: {
  icon: Parameters<typeof Svg>[0]["paths"];
  title: string;
  text: ReactNode;
  action?: ReactNode;
  tone?: "danger";
}) {
  return (
    <div role="status" style={css("padding:22px 18px 18px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px")}>
      <span
        style={mix("width:46px;height:46px;border-radius:50%;display:grid;place-items:center;margin-bottom:4px;position:relative", {
          background: tone ? "var(--danger-tint)" : "var(--hover)",
          color: tone ? "var(--danger)" : "var(--text-3)",
        })}
      >
        <Svg paths={icon} size={20} sw={2} />
        {!tone && (
          <span
            style={css(
              "position:absolute;right:-2px;bottom:-2px;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;background:var(--surface);color:var(--text-4);box-shadow:0 0 0 1px var(--border)"
            )}
          >
            <Svg paths={I_CLOSE} size={10} sw={3} />
          </span>
        )}
      </span>
      <div style={css("font-size:14px;font-weight:700;color:var(--text)")}>{title}</div>
      <div style={css("font-size:12.5px;line-height:1.5;color:var(--text-3);max-width:380px")}>{text}</div>
      {action && <div style={css("margin-top:8px;max-width:100%")}>{action}</div>}
    </div>
  );
}

function Skeleton() {
  const bar = "border-radius:6px;background:linear-gradient(90deg,var(--hover) 0,var(--border-2) 50%,var(--hover) 100%);background-size:640px 100%;animation:shimmer 1.1s linear infinite";
  return (
    <div style={css("padding:10px 16px;display:flex;flex-direction:column;gap:14px")}>
      {[0.62, 0.48, 0.55].map((w, i) => (
        <div key={i} style={css("display:flex;align-items:center;gap:11px")}>
          <span style={css(bar + ";width:36px;height:36px;flex:none;border-radius:50%")} />
          <span style={css("flex:1;display:flex;flex-direction:column;gap:6px")}>
            <span style={mix("height:11px;" + bar, { width: `${w * 100}%` })} />
            <span style={mix("height:9px;" + bar, { width: `${w * 70}%` })} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={className}
      style={css(
        "display:inline-block;min-width:18px;padding:1px 5px;border-radius:5px;border:1px solid var(--border);border-bottom-width:2px;background:var(--surface);font-family:inherit;font-size:10.5px;font-weight:600;line-height:1.4;text-align:center;color:var(--text-3)"
      )}
    >
      {children}
    </kbd>
  );
}
