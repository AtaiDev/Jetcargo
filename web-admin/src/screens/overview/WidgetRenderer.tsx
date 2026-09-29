/**
 * Универсальный рендерер блока дашборда.
 *
 * Блок приходит с сервера как спецификация + данные. Здесь только реестр типов
 * графика: тип есть в реестре — блок рисуется. Поэтому новый блок, который
 * ИИ-ассистент добавил в проде, появляется без единой правки фронтенда; править
 * этот файл нужно лишь ради нового ТИПА графика, а это редкость.
 */
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DashboardWidget, WidgetData, WidgetSeries } from "../../api/domain";
import {
  AXIS,
  ChartFrame,
  GRID,
  Legend,
  RbTooltip,
  colorOf,
  formatValue,
  shortNum,
  valueColor,
} from "../../design/charts";
import { MONO, css, money } from "../../design/css";

type Row = Record<string, string | number>;

export default function WidgetRenderer({ widget }: { widget: DashboardWidget }) {
  if (widget.error) return <Broken text={widget.error} />;
  if (!widget.data || widget.data.rows.length === 0) return <Empty />;

  switch (widget.chart) {
    case "kpi":
      return <Kpi widget={widget} />;
    case "donut":
      return <Donut widget={widget} />;
    case "hbar":
      return <HBar widget={widget} />;
    case "table":
      return <TableChart widget={widget} />;
    default:
      return <XYChart widget={widget} />;
  }
}

// --- служебное ---------------------------------------------------------------

function formats(data: WidgetData, series: WidgetSeries[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of series) {
    const m = data.measures.find((x) => x.key === s.measure);
    if (m) out[s.label || m.label] = m.format;
  }
  return out;
}

function seriesName(data: WidgetData, s: WidgetSeries): string {
  return s.label || data.measures.find((m) => m.key === s.measure)?.label || s.measure;
}

function Empty() {
  return (
    <div
      style={css(
        "display:flex;align-items:center;justify-content:center;height:200px;color:var(--text-4);font-size:12.5px"
      )}
    >
      За выбранный период данных нет
    </div>
  );
}

function Broken({ text }: { text: string }) {
  return (
    <div
      style={css(
        "padding:14px;border:1px dashed var(--danger-border);border-radius:8px;background:var(--danger-tint2);color:var(--danger);font-size:12px;line-height:1.5"
      )}
    >
      Блок не удалось построить: {text}
    </div>
  );
}

// --- KPI-плитки ---------------------------------------------------------------

function Kpi({ widget }: { widget: DashboardWidget }) {
  const data = widget.data!;
  const row = data.rows[0] ?? {};
  const prev = widget.previous;

  return (
    <div style={css("display:flex;flex-wrap:wrap;gap:12px")}>
      {data.measures.map((m, i) => {
        const value = Number(row[m.key] ?? 0);
        const before = prev ? Number(prev[m.key] ?? 0) : null;
        const color = colorOf(widget.series.find((s) => s.measure === m.key)?.color, i);
        return (
          <div
            key={m.key}
            style={css(
              "flex:1;min-width:170px;background:var(--surface-2);border:1px solid var(--border-2);border-radius:10px;padding:12px 14px"
            )}
          >
            <div
              style={css(
                "display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-3);margin-bottom:6px"
              )}
            >
              <span
                style={{
                  ...css("width:8px;height:8px;border-radius:2px;flex:none"),
                  background: color,
                }}
              />
              {m.label}
            </div>
            <div
              style={css(
                MONO + ";font-size:22px;font-weight:600;color:var(--text)"
              )}
            >
              {m.format === "money" ? money(value) : Math.round(value)}
              {m.format === "money" && (
                <span style={css("font-size:12px;color:var(--text-4);margin-left:4px")}>сом</span>
              )}
            </div>
            {before !== null && <Delta value={value} before={before} />}
          </div>
        );
      })}
    </div>
  );
}

function Delta({ value, before }: { value: number; before: number }) {
  if (!before) {
    return (
      <div style={css("font-size:11px;color:var(--text-4);margin-top:4px")}>
        нет данных за прошлый период
      </div>
    );
  }
  const pct = ((value - before) / Math.abs(before)) * 100;
  const up = pct >= 0;
  return (
    <div
      style={{
        ...css("font-size:11.5px;margin-top:4px;display:flex;align-items:center;gap:4px"),
        color: up ? "var(--green)" : "var(--danger)",
      }}
    >
      <span>{up ? "↑" : "↓"}</span>
      <span style={css(MONO + ";font-weight:600")}>
        {Math.abs(pct).toFixed(0)}%
      </span>
      <span style={css("color:var(--text-4)")}>к прошлому периоду</span>
    </div>
  );
}

// --- кольцо -------------------------------------------------------------------

function Donut({ widget }: { widget: DashboardWidget }) {
  const data = widget.data!;
  const dim = data.dimensions[0];
  const measure = data.measures[0];
  const mode = widget.series[0]?.color;

  const slices = data.rows.map((r, i) => ({
    name: String(r[`${dim.key}_label`] ?? r[dim.key]),
    value: Number(r[measure.key] ?? 0),
    color: valueColor(mode, String(r[dim.key]), i),
  }));
  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <div>
      <ChartFrame height={200}>
        {({ width, height, fs }) => (
          <PieChart width={width} height={height}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="86%"
              paddingAngle={2}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              content={
                <RbTooltip
                  fs={fs(12)}
                  formats={Object.fromEntries(slices.map((s) => [s.name, measure.format]))}
                />
              }
            />
          </PieChart>
        )}
      </ChartFrame>
      <div style={css("text-align:center;margin-top:-6px;font-size:11.5px;color:var(--text-3)")}>
        Всего:{" "}
        <span style={css(MONO + ";color:var(--text);font-weight:600")}>
          {formatValue(total, measure.format)}
        </span>
      </div>
      <Legend items={slices.map((s) => ({ label: s.name, color: s.color }))} />
    </div>
  );
}

// --- горизонтальные столбцы (топы) --------------------------------------------

function HBar({ widget }: { widget: DashboardWidget }) {
  const data = widget.data!;
  const dim = data.dimensions[0];
  const measure = data.measures[0];
  const color = colorOf(widget.series[0]?.color, 0);
  const max = Math.max(...data.rows.map((r) => Number(r[measure.key] ?? 0)), 1);

  // Свой рендер вместо графика: имена товаров читаются лучше текстом, чем осью.
  return (
    <div style={css("display:flex;flex-direction:column;gap:8px")}>
      {data.rows.map((r) => {
        const value = Number(r[measure.key] ?? 0);
        return (
          <div key={String(r[dim.key])}>
            <div
              style={css(
                "display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:3px"
              )}
            >
              <span style={css("color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                {String(r[`${dim.key}_label`] ?? r[dim.key])}
              </span>
              <span
                style={css(
                  MONO + ";font-weight:600;color:var(--text);flex:none"
                )}
              >
                {formatValue(value, measure.format)}
              </span>
            </div>
            <div style={css("height:6px;background:var(--muted-bg);border-radius:4px;overflow:hidden")}>
              <div
                style={{
                  ...css("height:100%;border-radius:4px"),
                  width: `${Math.max(2, (value / max) * 100)}%`,
                  background: color,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- таблица ------------------------------------------------------------------

function TableChart({ widget }: { widget: DashboardWidget }) {
  const data = widget.data!;
  return (
    <div style={css("overflow-x:auto")}>
      <table style={css("width:100%;border-collapse:collapse;font-size:12.5px")}>
        <thead>
          <tr>
            {data.dimensions.map((d) => (
              <th
                key={d.key}
                style={css(
                  "text-align:left;padding:7px 8px;border-bottom:1px solid var(--border);color:var(--text-3);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em"
                )}
              >
                {d.label}
              </th>
            ))}
            {data.measures.map((m) => (
              <th
                key={m.key}
                style={css(
                  "text-align:right;padding:7px 8px;border-bottom:1px solid var(--border);color:var(--text-3);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em"
                )}
              >
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>
              {data.dimensions.map((d) => (
                <td key={d.key} style={css("padding:7px 8px;border-bottom:1px solid var(--border-2)")}>
                  {String(r[`${d.key}_label`] ?? r[d.key])}
                </td>
              ))}
              {data.measures.map((m) => (
                <td
                  key={m.key}
                  style={css(
                    "padding:7px 8px;border-bottom:1px solid var(--border-2);text-align:right;" + MONO
                  )}
                >
                  {formatValue(Number(r[m.key] ?? 0), m.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- линии / области / столбцы -------------------------------------------------

function XYChart({ widget }: { widget: DashboardWidget }) {
  const data = widget.data!;
  const [xDim, splitDim] = data.dimensions;
  const stacked = widget.chart === "stacked_bar";

  // Два разреза: второй разворачиваем в серии (выдачи/возвраты рядом за один день).
  const { rows, series } = splitDim
    ? pivot(data, splitDim.key, data.measures[0].key)
    : {
        rows: data.rows as Row[],
        series: widget.series.map((s, i) => ({
          key: s.measure,
          name: seriesName(data, s),
          color: colorOf(s.color, i),
          type: s.type ?? (widget.chart === "combo" ? "bar" : chartToType(widget.chart)),
          axis: s.axis ?? "left",
        })),
      };

  const fmt = splitDim
    ? Object.fromEntries(series.map((s) => [s.name, data.measures[0].format]))
    : formats(data, widget.series);
  const useRightAxis = series.some((s) => s.axis === "right");

  // Целочисленные метрики (штуки, брони) не должны дробиться на оси: иначе
  // при максимуме 2 Recharts нарисует 0, 1, 1, 2, 2 — с повторами подписей.
  const formatOn = (axis: "left" | "right") => {
    const keys = series.filter((s) => s.axis === axis).map((s) => s.key);
    const ms = data.measures.filter(
      (m) => keys.includes(m.key) || splitDim !== undefined
    );
    return ms.every((m) => m.format === "int");
  };
  const leftInt = formatOn("left");
  const rightInt = formatOn("right");

  // Порядок отрисовки: столбцы вниз, линии и области поверх — иначе столбцы
  // «Броней» закрывают собой линию выручки, ради которой график и открывают.
  const drawOrder = [...series].sort(
    (a, b) => (a.type === "bar" ? 0 : 1) - (b.type === "bar" ? 0 : 1)
  );

  return (
    <div>
      <ChartFrame height={240}>
        {({ width, height, fs }) => (
          <ComposedChart
            width={width}
            height={height}
            data={rows}
            margin={{ top: 6, right: useRightAxis ? 4 : 8, bottom: 0, left: 0 }}
          >
            <defs>
              {series
                .filter((s) => s.type === "area")
                .map((s) => (
                  <linearGradient key={s.key} id={`g-${widget.id}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey={`${xDim.key}_label`}
              stroke={AXIS}
              tick={{ fontSize: fs(10.5), fill: AXIS }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={fs(14)}
            />
            <YAxis
              yAxisId="left"
              stroke={AXIS}
              tick={{ fontSize: fs(10.5), fill: AXIS }}
              tickLine={false}
              axisLine={false}
              width={fs(44)}
              allowDecimals={!leftInt}
              tickFormatter={shortNum}
            />
            {useRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke={AXIS}
                tick={{ fontSize: fs(10.5), fill: AXIS }}
                tickLine={false}
                axisLine={false}
                width={fs(30)}
                allowDecimals={!rightInt}
                tickFormatter={shortNum}
              />
            )}
            <Tooltip
              cursor={{ fill: "var(--hover)", opacity: 0.5 }}
              content={<RbTooltip fs={fs(12)} formats={fmt} />}
            />
            {drawOrder.map((s) => {
              // key передаём напрямую в JSX: внутри spread React его не видит.
              const common = {
                dataKey: s.key,
                name: s.name,
                yAxisId: s.axis,
                isAnimationActive: false as const,
              };
              if (s.type === "area") {
                return (
                  <Area
                    key={s.key}
                    {...common}
                    type="monotone"
                    stroke={s.color}
                    strokeWidth={2}
                    fill={`url(#g-${widget.id}-${s.key})`}
                  />
                );
              }
              if (s.type === "line") {
                return (
                  <Line
                    key={s.key}
                    {...common}
                    type="monotone"
                    stroke={s.color}
                    strokeWidth={2}
                    dot={false}
                  />
                );
              }
              return (
                <Bar
                  key={s.key}
                  {...common}
                  fill={s.color}
                  radius={[3, 3, 0, 0]}
                  stackId={stacked ? "s" : undefined}
                  maxBarSize={fs(28)}
                />
              );
            })}
          </ComposedChart>
        )}
      </ChartFrame>
      <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
    </div>
  );
}

function chartToType(chart: string): "bar" | "line" | "area" {
  if (chart === "line") return "line";
  if (chart === "area") return "area";
  return "bar";
}

/** Второй разрез → отдельные серии: строки схлопываем по X, значения раскладываем по колонкам. */
function pivot(data: WidgetData, splitKey: string, measureKey: string) {
  const xKey = data.dimensions[0].key;
  const byX = new Map<string, Row>();
  const names = new Map<string, string>();

  for (const r of data.rows) {
    const x = String(r[xKey]);
    const label = String(r[`${xKey}_label`] ?? x);
    const bucket = String(r[splitKey]);
    names.set(bucket, String(r[`${splitKey}_label`] ?? bucket));

    const row = byX.get(x) ?? { [xKey]: x, [`${xKey}_label`]: label };
    row[bucket] = Number(r[measureKey] ?? 0);
    byX.set(x, row);
  }

  const series = [...names.entries()].map(([key, name], i) => ({
    key,
    name,
    color: valueColor("by_value", key, i),
    type: "bar" as const,
    axis: "left" as const,
  }));
  // Пустые ячейки — нули, иначе столбец просто исчезнет вместо «ноль операций».
  const rows = [...byX.values()].map((r) => {
    for (const s of series) if (r[s.key] === undefined) r[s.key] = 0;
    return r;
  });
  return { rows, series };
}
