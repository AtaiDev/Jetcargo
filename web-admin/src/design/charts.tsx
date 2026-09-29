/**
 * Обвязка Recharts под дизайн-систему: палитра, оси, тултип — и масштаб.
 *
 * ЗАЧЕМ ChartFrame. Масштаб интерфейса сделан через `zoom` на <html> (см. prefs.tsx).
 * Recharts берёт систему координат из незумленной ширины контейнера, а позицию курсора
 * считает как clientX − getBoundingClientRect().left, то есть уже в зумленных координатах.
 * При масштабе ≠ 100% они расходятся ровно в `scale` раз, и тултип показывает не тот день,
 * над которым курсор.
 *
 * Лечим один раз здесь: внутри рамки ставим `zoom: 1/scale`. Зумы перемножаются, и внутри
 * графика получается ровно 1 — координаты снова сходятся. Чтобы график при этом визуально
 * занимал ту же площадь, задаём ему размеры, умноженные на scale, а кегль подписей осей
 * поднимаем тем же множителем — иначе на 130% они выглядели бы мелкими.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { MONO, css, money } from "./css";
import { usePrefs } from "./prefs";
import { ST, type StatusKey } from "./ui";

/** Токены палитры — те же, что у бейджей и кнопок, поэтому тема работает даром. */
export const PALETTE: Record<string, string> = {
  accent: "var(--accent)",
  amber: "var(--amber-dot)",
  green: "var(--green-dot)",
  violet: "var(--violet-dot)",
  danger: "var(--danger-dot)",
};

/** Порядок цветов, когда автор спеки его не задал. */
const FALLBACK = ["accent", "violet", "green", "amber", "danger"];

export const AXIS = "var(--text-4)";
export const GRID = "var(--border-2)";

export function colorOf(name: string | null | undefined, index = 0): string {
  if (name && PALETTE[name]) return PALETTE[name];
  return PALETTE[FALLBACK[index % FALLBACK.length]];
}

/**
 * Цвет для сектора/столбца по значению разреза.
 * Для статусов товара и оплаты берём палитру бейджей.
 */
export function valueColor(mode: string | null | undefined, value: string, index: number): string {
  // Статусы товара/оплаты красим цветами бейджей — график и таблица говорят одним языком.
  if ((mode === "by_status" || mode === "by_value") && (ST as Record<string, { dot: string }>)[value]) {
    return ST[value as StatusKey].dot;
  }
  if (mode && PALETTE[mode]) return PALETTE[mode];
  return PALETTE[FALLBACK[index % FALLBACK.length]];
}

export function formatValue(v: number, format: string): string {
  return format === "money" ? `${money(v)} сом` : String(Math.round(v));
}

interface FrameProps {
  height?: number;
  children: (size: { width: number; height: number; fs: (n: number) => number }) => ReactNode;
}

export function ChartFrame({ height = 240, children }: FrameProps) {
  const { scale } = usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Внутри рамки зум погашен, поэтому размеры и кегль поднимаем на scale вручную.
  const inner: CSSProperties = {
    zoom: 1 / scale,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  } as CSSProperties;

  return (
    <div ref={ref} style={{ width: "100%", height }}>
      {width > 0 && (
        <div style={inner}>
          {children({
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            fs: (n: number) => Math.round(n * scale),
          })}
        </div>
      )}
    </div>
  );
}

interface TipEntry {
  name?: string;
  value?: number;
  color?: string;
  payload?: Record<string, unknown>;
}

/** Тултип в стиле панелей: та же рамка, тот же шрифт чисел. */
export function RbTooltip({
  active,
  label,
  payload,
  formats,
  fs = 12,
}: {
  active?: boolean;
  label?: string;
  payload?: TipEntry[];
  formats?: Record<string, string>;
  fs?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        ...css(
          "background:var(--surface);border:1px solid var(--border);border-radius:8px;" +
            "box-shadow:0 8px 24px rgba(0,0,0,.14);padding:8px 10px;min-width:120px"
        ),
        fontSize: fs,
      }}
    >
      {label !== undefined && (
        <div style={{ ...css("color:var(--text-3);margin-bottom:5px"), fontSize: fs - 1 }}>
          {label}
        </div>
      )}
      {payload.map((e, i) => (
        <div
          key={i}
          style={css(
            "display:flex;align-items:center;justify-content:space-between;gap:12px;padding:1px 0"
          )}
        >
          <span style={css("display:flex;align-items:center;gap:6px;color:var(--text-2)")}>
            <span
              style={{
                ...css("width:8px;height:8px;border-radius:2px;flex:none"),
                background: e.color,
              }}
            />
            {e.name}
          </span>
          <span
            style={{
              ...css(MONO + ";font-weight:600;color:var(--text)"),
            }}
          >
            {formatValue(Number(e.value ?? 0), formats?.[String(e.name)] ?? "int")}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Компактная подпись осей: 12 500 → «12,5к». Иначе ось съедает половину графика. */
export function shortNum(v: number): string {
  const n = Math.abs(v);
  if (n >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".0", "")}м`;
  if (n >= 1_000) return `${(v / 1_000).toFixed(1).replace(".0", "")}к`;
  return String(Math.round(v));
}

export function Legend({
  items,
}: {
  items: { label: string; color: string }[];
}) {
  return (
    <div style={css("display:flex;flex-wrap:wrap;gap:12px;padding:6px 2px 0")}>
      {items.map((it) => (
        <span
          key={it.label}
          style={css("display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-3)")}
        >
          <span
            style={{
              ...css("width:9px;height:9px;border-radius:2px;flex:none"),
              background: it.color,
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
