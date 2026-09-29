/**
 * Таблица товаров — одна на «Заказы», «Склад» и карточку клиента.
 *
 * Читаемость:
 *  - товары одного клиента за один день идут блоком: имя, телефон и дата показаны
 *    один раз, между клиентами — заметный разделитель;
 *  - заголовки в одну строку, числа выровнены вправо моноширинным шрифтом;
 *  - лишнее не показываем («без кода», долг при «Не оплачено» — он и так равен сумме).
 * Всё остальное — в карточке товара по клику на строку.
 */
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import type { Item } from "../api/domain";
import { MONO, css, mix } from "../design/css";
import { PANEL } from "../design/table";
import { StatusBadge } from "../design/ui";
import { profitOf, shortDateTime, som } from "../lib/cargo";
import { ItemStatusBadge } from "./cargo";

export type Column = "date" | "customer" | "item" | "qty" | "sale" | "profit" | "pay" | "status" | "arrived" | "issued";

const DEF: Record<Column, { label: string; width: string; align?: "right" | "center" }> = {
  date: { label: "Дата", width: "88px" },
  customer: { label: "Клиент", width: "minmax(150px, 1.2fr)" },
  item: { label: "Товар", width: "minmax(170px, 1.8fr)" },
  qty: { label: "Кол-во", width: "84px", align: "center" },
  sale: { label: "Сумма", width: "96px", align: "right" },
  profit: { label: "Прибыль", width: "100px", align: "right" },
  pay: { label: "Оплата", width: "124px" },
  status: { label: "Статус", width: "108px" },
  arrived: { label: "Поступил", width: "116px" },
  issued: { label: "Выдан", width: "116px" },
};

/** Дата коротко: 27.09 — если текущий год, иначе 27.09.25. */
function dayShort(d: string): string {
  const [y, m, day] = d.slice(0, 10).split("-");
  return y === String(new Date().getFullYear()) ? `${day}.${m}` : `${day}.${m}.${y.slice(2)}`;
}

/** Минимальная ширина таблицы: сумма минимумов колонок — меньше неё таблица прокручивается вбок, а не обрезается. */
function minWidth(widths: string[]): number {
  return widths.reduce((sum, w) => {
    const px = w.match(/^(\d+)px$/) ?? w.match(/^minmax\((\d+)px/);
    return sum + (px ? Number(px[1]) : 140);
  }, 0);
}

/** Галочка выбора: клик по ней не открывает карточку товара. */
function Check({ checked, partial, onChange, title }: { checked: boolean; partial?: boolean; onChange: (on: boolean) => void; title?: string }) {
  return (
    <span onClick={(e) => e.stopPropagation()} style={css("display:flex;align-items:center;justify-content:center")}>
      <input
        type="checkbox"
        title={title}
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = !!partial && !checked;
        }}
        onChange={(e) => onChange(e.target.checked)}
        style={css("width:16px;height:16px;accent-color:var(--accent);cursor:pointer;margin:0")}
      />
    </span>
  );
}

const sameGroup = (a: Item | undefined, b: Item) => !!a && a.customer_id === b.customer_id && a.order_date === b.order_date;

export default function ItemTable({
  rows,
  columns,
  onOpen,
  highlight,
  empty,
  isDesktop,
  footer,
  selected,
  onSelect,
}: {
  rows: Item[];
  columns: Column[];
  onOpen: (id: number) => void;
  highlight?: number | null;
  empty: ReactNode;
  isDesktop: boolean;
  footer?: ReactNode;
  /** Выбранные товары — для массовых действий. Без onSelect галочек нет. */
  selected?: Set<number>;
  onSelect?: (ids: number[], on: boolean) => void;
}) {
  if (!isDesktop)
    return <MobileList rows={rows} onOpen={onOpen} highlight={highlight} empty={empty} footer={footer} selected={selected} onSelect={onSelect} />;
  const selectable = !!onSelect && !!selected;
  const isSel = (id: number) => !!selected?.has(id);

  // Когда в таблице есть клиент и дата — группируем: заголовок клиента на всю ширину,
  // под ним только его товары (без повтора имени, телефона и даты).
  const grouped = columns.includes("customer") && columns.includes("date");
  const cols = grouped ? columns.filter((c) => c !== "customer" && c !== "date") : columns;
  const grid = (selectable ? "40px " : "") + cols.map((c) => DEF[c].width).join(" ");
  const minW = minWidth(cols.map((c) => DEF[c].width)) + (selectable ? 40 : 0);
  const allSel = selectable && rows.length > 0 && rows.every((r) => isSel(r.id));
  const someSel = selectable && rows.some((r) => isSel(r.id));
  // Отступ первой колонки данных: в группах — сдвиг под заголовком, с галочками — меньше слева.
  const firstPad = selectable ? "padding-left:6px" : grouped ? "padding-left:22px" : "";

  const groups: Item[][] = [];
  for (const it of rows) {
    const last = groups[groups.length - 1];
    if (grouped && last && sameGroup(last[0], it)) last.push(it);
    else groups.push([it]);
  }

  const itemRow = (it: Item, last: boolean) => (
    <div
      key={it.id}
      onClick={() => onOpen(it.id)}
      className={"row-click" + (highlight === it.id ? " scan-flash" : "")}
      style={mix("display:grid;align-items:center;font-size:13px;min-height:48px", {
        gridTemplateColumns: grid,
        borderBottom: last ? "none" : "1px solid var(--border-2)",
        background: isSel(it.id) ? "var(--accent-tint2)" : undefined,
      })}
    >
      {selectable && <Check checked={isSel(it.id)} onChange={(on) => onSelect!([it.id], on)} />}
      {cols.map((c, ci) => (
        <div key={c} style={mix("padding:8px 14px;min-width:0", { textAlign: DEF[c].align ?? "left" }, ci === 0 && firstPad)}>
          {renderCell(c, it, false)}
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div style={css(PANEL + ";overflow-x:auto")}>
       <div style={{ minWidth: minW }}>
        <div
          style={mix(
            "display:grid;background:var(--surface-2);border-bottom:1px solid var(--border);font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text-3)",
            { gridTemplateColumns: grid }
          )}
        >
          {selectable && (
            <Check
              checked={allSel}
              partial={someSel}
              title="Выбрать все на странице"
              onChange={(on) => onSelect!(rows.map((r) => r.id), on)}
            />
          )}
          {cols.map((c, ci) => (
            <div
              key={c}
              style={mix(
                "padding:10px 14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis",
                { textAlign: DEF[c].align ?? "left" },
                ci === 0 && firstPad
              )}
            >
              {DEF[c].label}
            </div>
          ))}
        </div>

        {rows.length === 0
          ? empty
          : grouped
            ? groups.map((g, gi) => (
                <div key={g[0].id} style={css(gi < groups.length - 1 ? "border-bottom:1px solid var(--border)" : "")}>
                  <GroupHeader
                    items={g}
                    check={
                      selectable ? (
                        <Check
                          checked={g.every((i) => isSel(i.id))}
                          partial={g.some((i) => isSel(i.id))}
                          title="Выбрать все товары клиента"
                          onChange={(on) => onSelect!(g.map((i) => i.id), on)}
                        />
                      ) : null
                    }
                  />
                  {g.map((it, i) => itemRow(it, i === g.length - 1))}
                </div>
              ))
            : rows.map((it, i) => itemRow(it, i === rows.length - 1))}
       </div>
      </div>
      {footer}
    </div>
  );
}

/** Заголовок блока: клиент, телефон, дата, число товаров — и итоги блока справа. */
function GroupHeader({ items, check }: { items: Item[]; check?: ReactNode }) {
  const nav = useNavigate();
  const first = items[0];
  const sale = items.reduce((s, i) => s + i.sale, 0);
  const debt = items.reduce((s, i) => s + i.debt, 0);
  const withCost = items.filter((i) => i.cost !== null);
  const profit = withCost.reduce((s, i) => s + i.sale - (i.cost ?? 0), 0);
  return (
    <div
      onClick={() => nav(`/customers/${first.customer_id}`)}
      className="row-click"
      title="Открыть карточку клиента"
      style={css(
        "display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:9px 14px;background:var(--surface-2);border-bottom:1px solid var(--border-2);font-size:12.5px"
      )}
    >
      {check && <span style={css("width:12px;display:flex;justify-content:center")}>{check}</span>}
      <span
        style={css(
          "width:26px;height:26px;border-radius:50%;background:var(--accent-tint);color:var(--accent-strong);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none"
        )}
      >
        {first.customer_name.trim().slice(0, 1).toUpperCase()}
      </span>
      <span style={css("font-weight:600;font-size:13.5px")}>{first.customer_name}</span>
      <span style={css(MONO + ";color:var(--text-2)")}>{first.customer_phone || "—"}</span>
      <span style={css("color:var(--text-4)")}>·</span>
      <span style={css(MONO + ";color:var(--text-3)")}>{dayShort(first.order_date)}</span>
      <span style={css("color:var(--text-3)")}>
        {items.length} {plural(items.length, "товар", "товара", "товаров")}
      </span>
      <span style={css("flex:1")} />
      <span style={css("color:var(--text-3);white-space:nowrap")}>
        сумма <b style={css(MONO + ";color:var(--text)")}>{som(sale)}</b>
      </span>
      {withCost.length > 0 && (
        <span style={css("color:var(--text-3);white-space:nowrap")}>
          прибыль <b style={mix(MONO, { color: profit < 0 ? "var(--danger)" : "var(--green)" })}>{som(profit)}</b>
        </span>
      )}
      <span style={css("white-space:nowrap")}>
        {debt > 0 ? (
          <span style={css("color:var(--text-3)")}>
            долг <b style={css(MONO + ";color:var(--danger)")}>{som(debt)}</b>
          </span>
        ) : (
          <span style={css("color:var(--green);font-weight:600")}>✓ оплачено</span>
        )}
      </span>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const muted = "color:var(--text-4)";
const one = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";

function renderCell(c: Column, it: Item, cont: boolean): ReactNode {
  switch (c) {
    case "date":
      return cont ? null : (
        <span style={css(MONO + ";font-size:12px;color:var(--text-2);white-space:nowrap")} title={it.order_date}>
          {dayShort(it.order_date)}
        </span>
      );
    case "customer":
      return cont ? null : (
        <div style={css("min-width:0")}>
          <div style={css("font-weight:600;" + one)}>{it.customer_name}</div>
          <div style={css(MONO + ";font-size:11.5px;color:var(--text-3);" + one)}>{it.customer_phone || "—"}</div>
        </div>
      );
    case "item":
      return (
        <div style={css("min-width:0")}>
          <div style={css(one)} title={it.name}>
            {it.name}
          </div>
          {it.code && (
            <div style={css(MONO + ";font-size:11px;" + muted + ";" + one)} title={it.code}>
              {it.code}
            </div>
          )}
        </div>
      );
    case "qty":
      return (
        <span style={css(MONO + ";white-space:nowrap")}>
          {it.qty} <span style={css("font-size:11px;" + muted)}>шт</span>
        </span>
      );
    case "sale":
      return <span style={css(MONO + ";font-weight:600;white-space:nowrap")}>{som(it.sale)}</span>;
    case "profit": {
      const p = profitOf(it);
      if (p === null) return <span style={css("font-size:11.5px;" + muted + ";white-space:nowrap")}>нет выкупа</span>;
      return (
        <div style={css("display:flex;flex-direction:column;align-items:flex-end;line-height:1.3")} title={`Выкуп ${som(it.cost)}`}>
          <span style={mix(MONO + ";font-weight:600;white-space:nowrap", { color: p < 0 ? "var(--danger)" : "var(--green)" })}>
            {p > 0 ? "+" : ""}
            {som(p)}
          </span>
          <span style={css(MONO + ";font-size:10.5px;" + muted + ";white-space:nowrap")}>из {som(it.cost)}</span>
        </div>
      );
    }
    case "pay":
      return (
        <div style={css("display:flex;flex-direction:column;align-items:flex-start;gap:2px")}>
          <StatusBadge status={it.pay_status} size="sm" />
          {it.pay_status === "partial" && (
            <span style={css(MONO + ";font-size:10.5px;color:var(--amber);white-space:nowrap")}>долг {som(it.debt)}</span>
          )}
        </div>
      );
    case "status": {
      // Принятое сегодня сканером — заметная подпись под статусом, чтобы сразу было видно.
      const arrivedToday =
        it.status === "in_stock" && it.arrived_at && new Date(it.arrived_at).toDateString() === new Date().toDateString();
      return (
        <div style={css("display:flex;flex-direction:column;align-items:flex-start;gap:2px")}>
          <ItemStatusBadge item={it} size="sm" />
          {arrivedToday && (
            <span style={css("font-size:10.5px;font-weight:600;color:var(--accent-strong);white-space:nowrap")}>
              принят {shortDateTime(it.arrived_at).slice(6)}
            </span>
          )}
        </div>
      );
    }
    case "arrived":
      return <span style={css(MONO + ";font-size:11.5px;color:var(--text-3);white-space:nowrap")}>{shortDateTime(it.arrived_at)}</span>;
    case "issued":
      return <span style={css(MONO + ";font-size:11.5px;color:var(--text-3);white-space:nowrap")}>{shortDateTime(it.issued_at)}</span>;
  }
}

// --- Мобильная версия: карточки, сгруппированные по клиенту и дате ------------------------------

function MobileList({
  rows,
  onOpen,
  highlight,
  empty,
  footer,
  selected,
  onSelect,
}: {
  rows: Item[];
  onOpen: (id: number) => void;
  highlight?: number | null;
  empty: ReactNode;
  footer?: ReactNode;
  selected?: Set<number>;
  onSelect?: (ids: number[], on: boolean) => void;
}) {
  if (rows.length === 0) return <div style={css(PANEL)}>{empty}</div>;
  const groups: Item[][] = [];
  for (const it of rows) {
    const last = groups[groups.length - 1];
    if (last && sameGroup(last[0], it)) last.push(it);
    else groups.push([it]);
  }
  return (
    <div style={css("display:flex;flex-direction:column;gap:10px")}>
      {groups.map((g) => (
        <div key={g[0].id} style={css(PANEL)}>
          <div style={css("display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:9px 13px;background:var(--surface-2);border-bottom:1px solid var(--border-2)")}>
            <div style={css("min-width:0")}>
              <span style={css("font-weight:600;font-size:13px")}>{g[0].customer_name}</span>{" "}
              <span style={css(MONO + ";font-size:11.5px;color:var(--text-3)")}>{g[0].customer_phone}</span>
            </div>
            <span style={css(MONO + ";font-size:11.5px;color:var(--text-3);white-space:nowrap")}>{dayShort(g[0].order_date)}</span>
          </div>
          {g.map((it) => {
            const p = profitOf(it);
            return (
              <div
                key={it.id}
                onClick={() => onOpen(it.id)}
                className={"row-click" + (highlight === it.id ? " scan-flash" : "")}
                style={css("padding:9px 13px;border-bottom:1px solid var(--border-2);display:flex;flex-direction:column;gap:5px")}
              >
                <div style={css("display:flex;justify-content:space-between;gap:8px;align-items:flex-start")}>
                  {onSelect && selected && (
                    <span style={css("padding-top:2px")}>
                      <Check checked={selected.has(it.id)} onChange={(on) => onSelect([it.id], on)} />
                    </span>
                  )}
                  <div style={css("min-width:0;flex:1")}>
                    <div style={css("font-size:13px;font-weight:500")}>{it.name}</div>
                    <div style={css(MONO + ";font-size:11px;" + muted)}>
                      {it.qty} шт{it.code ? ` · ${it.code}` : ""}
                    </div>
                  </div>
                  <div style={css("text-align:right")}>
                    <div style={css(MONO + ";font-weight:600;white-space:nowrap")}>{som(it.sale)}</div>
                    {p !== null && (
                      <div style={mix(MONO + ";font-size:11px;white-space:nowrap", { color: p < 0 ? "var(--danger)" : "var(--green)" })}>
                        {p > 0 ? "+" : ""}
                        {som(p)}
                      </div>
                    )}
                  </div>
                </div>
                <div style={css("display:flex;gap:6px;align-items:center")}>
                  <ItemStatusBadge item={it} size="sm" />
                  <StatusBadge status={it.pay_status} size="sm" />
                  {it.pay_status === "partial" && <span style={css(MONO + ";font-size:10.5px;color:var(--amber)")}>долг {som(it.debt)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {footer}
    </div>
  );
}
