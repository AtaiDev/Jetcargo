/**
 * Каркас раздела: обёртка, тулбар, плитка — и стили таблицы.
 *
 * Таблицы экраны собирают сами (у каждой своя сетка колонок), но берут отсюда общие
 * стили PANEL/THEAD/TROW/EMPTY_ICON — иначе, как было раньше, один и тот же стиль
 * карточки жил копиями в 14 файлах и потихоньку расходился.
 */
import type { ReactNode } from "react";
import { MONO, css, mix } from "./css";
import { I_PLUS, I_SEARCH, Svg } from "./icons";
import { HButton } from "./ui";

export { MONO };

// Стили, которые раньше были вписаны в каждый экран по 10–30 раз. Один источник —
// один вид: правку карточки или шапки таблицы больше не надо разносить по 14 файлам.
export const PANEL =
  "background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden";
export const THEAD =
  "display:grid;background:var(--surface-2);border-bottom:1px solid var(--border);font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-3);white-space:nowrap";
export const TROW = "display:grid;border-bottom:1px solid var(--hover);align-items:center";
export const EMPTY_ICON =
  "width:46px;height:46px;border-radius:12px;background:var(--hover);color:var(--text-5);display:flex;align-items:center;justify-content:center;margin:0 auto 12px";

/**
 * Обёртка раздела: отступы и анимация появления — одни на все экраны.
 * Ширина зависит от типа содержимого, а не от того, кто верстал экран.
 */
const PAGE_WIDTH = {
  list: "1180px", // таблицы и списки
  wide: "none", // дашборд — во всю ширину
  detail: "1000px", // карточка брони или клиента
  form: "760px", // настройки и узкие формы
} as const;

export function Page({
  children,
  size = "list",
}: {
  children: ReactNode;
  size?: keyof typeof PAGE_WIDTH;
}) {
  return (
    <div
      style={mix("padding:18px 22px;animation:fadeIn .2s ease", { maxWidth: PAGE_WIDTH[size] })}
    >
      {children}
    </div>
  );
}

/** Верхняя панель раздела: слева фильтры, справа поиск и действия. */
export function Toolbar({ left, search, actions }: { left?: ReactNode; search?: ReactNode; actions?: ReactNode }) {
  return (
    <div style={css("display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px")}>
      {left}
      <div style={css("flex:1")} />
      {search}
      {actions}
    </div>
  );
}

/** Поле поиска в стиле макета. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  width = 220,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  width?: number;
}) {
  return (
    <div style={mix("position:relative;max-width:100%", { width: width + "px" })}>
      <span
        style={css(
          "position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--text-4);display:flex"
        )}
      >
        <Svg paths={I_SEARCH} size={15} />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={css(
          "width:100%;height:34px;padding:0 10px 0 30px;border:1px solid var(--border-strong);border-radius:8px;background:var(--surface);font-size:12.5px;outline:none"
        )}
      />
    </div>
  );
}

/** Основная кнопка действия в тулбаре («Новый товар», «Завоз» и т.п.). */
export function PrimaryAction({
  onClick,
  children,
  icon,
}: {
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <HButton
      onClick={onClick}
      s="height:34px;padding:0 14px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:12.5px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px;flex:none"
      hover="background:var(--accent-hover)"
    >
      {icon ?? <Svg paths={I_PLUS} size={15} sw={2} />}
      {children}
    </HButton>
  );
}

/** Плитка-показатель: подпись сверху, крупное моно-число снизу. */
export function StatTile({
  label,
  value,
  color,
  grow,
}: {
  label: string;
  value: string;
  color?: string;
  grow?: boolean;
}) {
  return (
    <div
      style={mix(
        "background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px",
        grow ? { flex: 1, minWidth: "130px" } : {}
      )}
    >
      <div style={css("color:var(--text-3);font-size:11.5px;font-weight:500")}>{label}</div>
      <div style={mix(MONO + ";font-size:24px;font-weight:600;margin-top:4px", {
        color: color ?? "var(--text)",
      })}>
        {value}
      </div>
    </div>
  );
}
