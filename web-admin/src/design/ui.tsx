/** Примитивы дизайна: кнопка с ховером, статусы, модалка, тост, скелетон. */
import type { CSSProperties, ReactNode } from "react";
import { MONO, css, hoverClass, mix } from "./css";
import { I_ALERT, I_CHECK, I_CLOSE, Svg } from "./icons";

/** Свой класс элемента + класс ховера. */
const joinClass = (a: string | undefined, b: string) => [a, b].filter(Boolean).join(" ") || undefined;

/** Кнопка со стилем и style-hover из макета. Ховер — CSS-правилом, стиль не мигает. */
export function HButton({
  s,
  hover,
  children,
  className,
  ...rest
}: {
  s: string | CSSProperties;
  hover?: string;
  children?: ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "style">) {
  const base = typeof s === "string" ? css(s) : s;
  return (
    <button {...rest} style={base} className={joinClass(className, hoverClass(hover))}>
      {children}
    </button>
  );
}

/** Div со style-hover. */
export function HDiv({
  s,
  hover,
  children,
  className,
  ...rest
}: {
  s: string | CSSProperties;
  hover?: string;
  children?: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "style">) {
  const base = typeof s === "string" ? css(s) : s;
  return (
    <div {...rest} style={base} className={joinClass(className, hoverClass(hover))}>
      {children}
    </div>
  );
}

// ---- Статусы товара и оплаты (ненавязчивые тона из токенов темы) ----
export type StatusKey = "ordered" | "in_stock" | "issued" | "paid" | "partial" | "unpaid";

export const ST: Record<StatusKey, { label: string; bg: string; fg: string; dot: string }> = {
  ordered: { label: "Заказан", bg: "var(--amber-tint)", fg: "var(--amber)", dot: "var(--amber-dot)" },
  in_stock: { label: "На складе", bg: "var(--accent-tint)", fg: "var(--accent-strong)", dot: "var(--accent)" },
  issued: { label: "Выдан", bg: "var(--green-tint)", fg: "var(--green)", dot: "var(--green-dot)" },
  paid: { label: "Оплачено", bg: "var(--green-tint)", fg: "var(--green)", dot: "var(--green-dot)" },
  partial: { label: "Частично", bg: "var(--amber-tint)", fg: "var(--amber)", dot: "var(--amber-dot)" },
  unpaid: { label: "Не оплачено", bg: "var(--danger-tint)", fg: "var(--danger)", dot: "var(--danger-dot)" },
};

/** Бейдж статуса товара или оплаты. dot=false — без точки (для тесных мест). */
export function StatusBadge({
  status,
  size = "md",
  dot = true,
  label,
}: {
  status: StatusKey;
  size?: "sm" | "md";
  dot?: boolean;
  label?: string;
}) {
  const st = ST[status] ?? ST.ordered;
  const sm = size === "sm";
  return (
    <span
      style={mix(
        `display:inline-flex;align-items:center;gap:${sm ? 5 : 6}px;font-size:${
          sm ? 10.5 : 11.5
        }px;font-weight:600;padding:${sm ? "2px 7px" : "3px 9px"};border-radius:20px;white-space:nowrap;flex:none`,
        { background: st.bg, color: st.fg }
      )}
    >
      {dot && (
        <span
          style={mix("width:5px;height:5px;border-radius:50%;flex:none", { background: st.dot })}
        />
      )}
      {label ?? st.label}
    </span>
  );
}

// ---- Чипы и табы ----
export function chipStyle(active: boolean): CSSProperties {
  return css(
    `height:32px;padding:0 13px;border-radius:8px;border:1px solid ${
      active ? "var(--accent)" : "var(--border)"
    };background:${active ? "var(--accent-tint)" : "var(--surface)"};color:${
      active ? "var(--accent-strong)" : "var(--text-2)"
    };font-size:12.5px;font-weight:${active ? 600 : 500};cursor:pointer`
  );
}

export function tabStyle(active: boolean): CSSProperties {
  return css(
    `height:28px;padding:0 11px;border-radius:7px;border:none;background:${
      active ? "var(--surface)" : "transparent"
    };color:${active ? "var(--text)" : "var(--text-2)"};font-size:12px;font-weight:${
      active ? 600 : 500
    };cursor:pointer;box-shadow:${active ? "0 1px 2px rgba(0,0,0,.08)" : "none"}`
  );
}

// ---- Модальное окно (структура 1:1 из макета) ----

export function ModalShell({
  title,
  icon,
  tone = "accent",
  onClose,
  children,
  footer,
  width = 440,
}: {
  title: string;
  icon: ReactNode;
  tone?: "accent" | "danger";
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  width?: number;
}) {
  const badge =
    tone === "danger"
      ? "width:30px;height:30px;border-radius:8px;background:var(--danger-tint);color:var(--danger);display:flex;align-items:center;justify-content:center"
      : "width:30px;height:30px;border-radius:8px;background:var(--accent-tint);color:var(--accent);display:flex;align-items:center;justify-content:center";
  return (
    <div
      onClick={onClose}
      style={css(
        "position:fixed;inset:0;background:rgba(15,18,25,.36);z-index:70;display:flex;align-items:flex-start;justify-content:center;padding:28px 18px;overflow:auto;animation:fadeIn .15s ease"
      )}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={mix(
          "background:var(--surface);border-radius:12px;max-width:100%;box-shadow:0 16px 48px rgba(0,0,0,.2);animation:pop .2s ease;margin:auto 0",
          { width: width + "px" }
        )}
      >
        <div
          style={css(
            "display:flex;align-items:center;gap:9px;padding:16px 18px;border-bottom:1px solid var(--border-2)"
          )}
        >
          <span style={css(badge)}>{icon}</span>
          <h3 style={css("margin:0;font-size:15px;font-weight:600;flex:1")}>{title}</h3>
          <HButton
            onClick={onClose}
            s="width:30px;height:30px;border:none;background:transparent;border-radius:6px;cursor:pointer;color:var(--text-3);display:flex;align-items:center;justify-content:center"
            hover="background:var(--hover)"
          >
            <Svg paths={I_CLOSE} size={17} sw={1.8} />
          </HButton>
        </div>
        {children}
        <div
          style={css(
            "display:flex;gap:9px;justify-content:flex-end;padding:14px 18px;border-top:1px solid var(--border-2)"
          )}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

/**
 * Ошибка загрузки экрана. Раньше её просто глушили (`catch(() => setX(null))`),
 * и на 404 экран навсегда застывал в состоянии «Загрузка…».
 */
export function LoadError({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div style={css("padding:22px;display:flex;flex-direction:column;gap:10px;align-items:flex-start")}>
      <ModalError text={text} />
      {onRetry && (
        <HButton onClick={onRetry} s={btnGhost} hover="border-color:var(--accent)">
          Повторить
        </HButton>
      )}
    </div>
  );
}

/** Единая надпись «грузим» — вместо трёх разных инлайн-вариантов. */
export function Loading() {
  return <div style={css("padding:22px;color:var(--text-3)")}>Загрузка…</div>;
}

export function ModalError({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div
      style={css(
        "background:var(--danger-tint);border:1px solid var(--danger-border);color:var(--danger);padding:9px 12px;border-radius:8px;font-size:12px;display:flex;gap:7px;align-items:flex-start"
      )}
    >
      <span style={css("flex:none;margin-top:1px;display:flex")}>
        <Svg paths={I_ALERT} size={15} sw={2} />
      </span>
      <span>{text}</span>
    </div>
  );
}

/** Подпись поля формы модалки. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span
      style={css(
        "display:block;font-size:11.5px;font-weight:500;color:var(--text-2);margin-bottom:5px"
      )}
    >
      {children}
    </span>
  );
}

export const inputStyle =
  "width:100%;height:36px;padding:0 12px;border:1px solid var(--border-strong);border-radius:8px;font-size:13px;outline:none;background:var(--surface)";
export const inputNumStyle =
  "width:100%;height:36px;padding:0 12px;border:1px solid var(--border-strong);border-radius:8px;font-size:14px;outline:none;background:var(--surface);" +
  MONO;
export const selectStyle =
  "width:100%;height:36px;padding:0 10px;border:1px solid var(--border-strong);border-radius:8px;background:var(--surface);font-size:13px;outline:none;cursor:pointer";

export const btnGhost =
  "height:36px;padding:0 16px;background:var(--surface);color:var(--text);border:1px solid var(--border-strong);border-radius:8px;font-size:13px;font-weight:500;cursor:pointer";
export const btnPrimary =
  "height:36px;padding:0 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer";
export const btnDanger =
  "height:36px;padding:0 18px;background:var(--danger-solid);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer";

// ---- Тост ----
/** Всплывающее сообщение снизу по центру: плавно выезжает снизу и уезжает вниз (leaving). */
export function Toast({ kind, text, leaving }: { kind: "success" | "error"; text: string; leaving?: boolean }) {
  const isError = kind === "error";
  return (
    <div
      role="status"
      className={"toast" + (leaving ? " out" : "")}
      style={css(
        "position:fixed;left:50%;bottom:24px;z-index:60;display:flex;align-items:center;gap:9px;padding:11px 16px;border-radius:12px;background:var(--toast-bg);color:#fff;font-size:13px;font-weight:500;box-shadow:0 12px 32px rgba(0,0,0,.3);max-width:calc(100vw - 32px)"
      )}
    >
      <span style={{ display: "flex", color: isError ? "var(--toast-danger)" : "var(--toast-ok)" }}>
        {isError ? <Svg paths={I_ALERT} size={16} sw={2} /> : <Svg paths={I_CHECK} size={16} sw={2.4} />}
      </span>
      {text}
    </div>
  );
}

// ---- Скелетон загрузки ----
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div style={css("display:flex;flex-direction:column;gap:8px")}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={css(
            "height:44px;border-radius:8px;background:linear-gradient(90deg,var(--surface-2) 0px,var(--hover) 160px,var(--surface-2) 320px);background-size:640px 100%;animation:shimmer 1.1s infinite linear"
          )}
        />
      ))}
    </div>
  );
}
