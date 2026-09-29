/**
 * Сводка «Обзора» по полочкам:
 *  1. Деньги за период — сумма заказов (с полосой «оплачено / долг»), выкуп, прибыль, долги.
 *  2. Товары по этапам сейчас — Заказано → На складе → Выдано: сколько, сумма, выкуп, прибыль, оплата.
 *  3. Клиенты.
 * Карточки кликабельны — ведут в нужный отфильтрованный список.
 */
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import type { Dashboard, Totals } from "../../api/domain";
import { MONO, css, mix } from "../../design/css";
import { HButton, ST } from "../../design/ui";
import { som } from "../../lib/cargo";

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function Heading({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div style={css("display:flex;align-items:baseline;gap:10px;margin:0 2px 10px")}>
      <span style={css("font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)")}>{children}</span>
      {hint && <span style={css("font-size:11.5px;color:var(--text-4)")}>{hint}</span>}
    </div>
  );
}

/** Строка «подпись …… значение» внутри карточки. */
function Line({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={css("display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12.5px;padding:3px 0")}>
      <span style={css("color:var(--text-3)")}>{label}</span>
      <span style={mix(MONO + ";white-space:nowrap", { color: color ?? "var(--text)", fontWeight: bold ? 600 : 500 })}>{value}</span>
    </div>
  );
}

const card =
  "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease";

export default function Summary({ board, isDesktop, periodLabel }: { board: Dashboard; isDesktop: boolean; periodLabel: string }) {
  const nav = useNavigate();
  const f = board.finance;
  const o = board.orders;
  const c = board.customers;
  const st = board.stages;
  const markup = f.with_cost && f.cost > 0 ? pct(f.profit, f.cost) : null;
  const costNote = f.items_period ? (f.with_cost < f.items_period ? `по ${f.with_cost} из ${f.items_period} товаров` : null) : null;

  return (
    <div style={css("display:flex;flex-direction:column;gap:22px")}>
      {/* 1. Деньги */}
      <section>
        <Heading hint={periodLabel}>Деньги за период</Heading>
        <MoneyPanel
          isDesktop={isDesktop}
          columns={[
            {
              label: "Сумма заказов",
              dot: "var(--accent)",
              value: som(f.period),
              note: `${o.items_period} ${plural(o.items_period, "товар", "товара", "товаров")} · ${o.orders_period} ${plural(o.orders_period, "заказ", "заказа", "заказов")}`,
              bar: { share: pct(f.paid, f.period), color: "var(--green-dot)", track: "var(--danger-tint)" },
              legend: (
                <>
                  <span style={css("color:var(--green)")}>
                    оплачено <b style={css(MONO)}>{som(f.paid)}</b>
                  </span>
                  <span style={css("color:var(--danger)")}>
                    долг <b style={css(MONO)}>{som(f.unpaid)}</b>
                  </span>
                </>
              ),
            },
            {
              label: "Выкуп",
              dot: "var(--text-4)",
              value: f.with_cost ? som(f.cost) : "—",
              note: costNote ?? "потрачено на маркетплейсе",
              bar: { share: pct(f.cost, f.period), color: "var(--text-4)" },
              legend: <span style={css("color:var(--text-3)")}>{pct(f.cost, f.period)}% от суммы заказов</span>,
            },
            {
              label: "Прибыль",
              dot: "var(--green-dot)",
              value: f.with_cost ? som(f.profit) : "—",
              valueColor: f.profit < 0 ? "var(--danger)" : "var(--green)",
              badge: markup !== null ? `+${markup}% наценка` : undefined,
              note: costNote ?? "сумма заказов − выкуп",
              bar: { share: pct(Math.max(0, f.profit), f.period), color: "var(--green-dot)" },
              legend: <span style={css("color:var(--text-3)")}>{pct(Math.max(0, f.profit), f.period)}% от суммы заказов</span>,
            },
            {
              label: "Долги клиентов",
              dot: "var(--danger-dot)",
              value: som(f.debts_total),
              valueColor: f.debts_total > 0 ? "var(--danger)" : "var(--text)",
              note: f.debts_total > 0 ? `${c.with_debt} ${plural(c.with_debt, "клиент", "клиента", "клиентов")} · невыданные товары` : "долгов нет",
              bar: { share: pct(f.debts_total, f.debts_total + f.paid), color: "var(--danger-dot)" },
              legend: (
                <HButton
                  onClick={() => nav("/finance")}
                  s="border:none;background:transparent;padding:0;color:var(--accent);font-size:11.5px;cursor:pointer"
                  hover="color:var(--accent-hover)"
                >
                  к должникам →
                </HButton>
              ),
            },
          ]}
        />
      </section>

      {/* 2. Товары по этапам */}
      <section>
        <Heading hint="сейчас, за всё время">Товары по этапам</Heading>
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 28px 1fr 28px 1fr" : "1fr", gap: isDesktop ? 0 : 12, alignItems: "stretch" }}>
          <Stage
            title="Заказано"
            subtitle="ждём на склад"
            color={ST.ordered.dot}
            t={st.ordered}
            onClick={() => nav("/orders?status=ordered")}
          />
          {isDesktop && <Arrow />}
          <Stage
            title="На складе"
            subtitle="можно выдавать"
            color={ST.in_stock.dot}
            t={st.in_stock}
            extra={
              <Line
                label="Готовы к выдаче (оплачены)"
                value={`${st.in_stock.ready} из ${st.in_stock.items}`}
                color={st.in_stock.ready ? "var(--green)" : "var(--text-3)"}
                bold
              />
            }
            onClick={() => nav("/warehouse")}
          />
          {isDesktop && <Arrow />}
          <Stage
            title="Выдано"
            subtitle="у клиентов"
            color={ST.issued.dot}
            t={st.issued}
            extra={<Line label="Выдано за период" value={`${st.issued.period} тов.`} bold />}
            onClick={() => nav("/orders?status=issued")}
          />
        </div>
      </section>

      {/* 3. Клиенты */}
      <section>
        <Heading>Клиенты</Heading>
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(3, 1fr)" : "1fr", gap: 12 }}>
          <BigFigure label="Всего клиентов" value={String(c.total)} note="в базе" onClick={() => nav("/customers")} />
          <BigFigure
            label="С долгом"
            value={String(c.with_debt)}
            color={c.with_debt ? "var(--danger)" : undefined}
            note={`долг ${som(c.debt)}`}
            onClick={() => nav("/customers")}
          />
          <BigFigure label="Добавлено за период" value={String(c.new_period)} note="новые карточки клиентов в системе" />
        </div>
      </section>
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

interface MoneyColumn {
  label: string;
  dot: string;
  value: string;
  valueColor?: string;
  badge?: string;
  note: string;
  bar: { share: number; color: string; track?: string };
  legend: ReactNode;
}

/**
 * Деньги одной панелью: колонки одинаковой структуры (подпись → число → пояснение → полоска),
 * разделены тонкими линиями — одинаковая высота, без пустых мест.
 */
function MoneyPanel({ columns, isDesktop }: { columns: MoneyColumn[]; isDesktop: boolean }) {
  return (
    <div style={css("background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden")}>
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1.25fr 1fr 1fr 1fr" : "1fr" }}>
        {columns.map((col, i) => (
          <div
            key={col.label}
            style={mix(
              "padding:16px 20px;display:flex;flex-direction:column;gap:6px;min-width:0",
              i > 0 ? (isDesktop ? "border-left:1px solid var(--border-2)" : "border-top:1px solid var(--border-2)") : ""
            )}
          >
            <div style={css("display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text-3);height:20px")}>
              <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: col.dot })} />
              {col.label}
              {col.badge && (
                <span style={css("margin-left:auto;font-size:10.5px;font-weight:600;color:var(--green);background:var(--green-tint);padding:2px 7px;border-radius:10px;white-space:nowrap")}>
                  {col.badge}
                </span>
              )}
            </div>
            <div style={mix(MONO + ";font-size:24px;font-weight:700;letter-spacing:-.01em;white-space:nowrap", { color: col.valueColor ?? "var(--text)" })}>
              {col.value}
            </div>
            <div style={css("font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{col.note}</div>
            <div style={css("margin-top:auto;padding-top:8px")}>
              <div style={mix("height:6px;border-radius:4px;overflow:hidden", { background: col.bar.track ?? "var(--border-2)" })}>
                <div
                  style={mix("height:100%;border-radius:4px;transition:width .5s ease", {
                    width: `${Math.min(100, Math.max(0, col.bar.share))}%`,
                    background: col.bar.color,
                  })}
                />
              </div>
              <div style={css("display:flex;justify-content:space-between;gap:8px;font-size:11.5px;margin-top:6px;white-space:nowrap")}>{col.legend}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BigFigure({
  label,
  value,
  note,
  color,
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <HButton
      onClick={onClick}
      s={mix(card + ";text-align:left;display:flex;flex-direction:column;gap:4px;justify-content:flex-start", { cursor: onClick ? "pointer" : "default" })}
      hover={onClick ? "border-color:var(--accent)" : ""}
    >
      <span style={css("font-size:12px;color:var(--text-3)")}>{label}</span>
      <span style={mix(MONO + ";font-size:22px;font-weight:700", { color: color ?? "var(--text)" })}>{value}</span>
      {note && <span style={css("font-size:11.5px;color:var(--text-4);line-height:1.4")}>{note}</span>}
    </HButton>
  );
}

function Stage({
  title,
  subtitle,
  color,
  t,
  extra,
  onClick,
}: {
  title: string;
  subtitle: string;
  color: string;
  t: Totals;
  extra?: ReactNode;
  onClick: () => void;
}) {
  return (
    <HButton
      onClick={onClick}
      s={mix(card + ";text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:10px;border-top-width:3px", { borderTopColor: color })}
      hover="box-shadow:0 8px 22px rgba(15,18,25,.08);transform:translateY(-2px)"
    >
      <div style={css("display:flex;justify-content:space-between;align-items:flex-start;gap:10px;width:100%")}>
        <div>
          <div style={css("font-size:14px;font-weight:700")}>{title}</div>
          <div style={css("font-size:11.5px;color:var(--text-4)")}>{subtitle}</div>
        </div>
        <div style={css("text-align:right")}>
          <div style={css(MONO + ";font-size:26px;font-weight:700;line-height:1")}>{t.items}</div>
          <div style={css("font-size:11px;color:var(--text-4);margin-top:3px")}>товаров · {t.qty} шт</div>
        </div>
      </div>
      <div style={css("border-top:1px solid var(--border-2);padding-top:8px;width:100%")}>
        <Line label="Сумма" value={som(t.sale)} bold />
        <Line label="Выкуп" value={t.with_cost ? som(t.cost) : "—"} />
        <Line label="Прибыль" value={t.with_cost ? som(t.profit) : "—"} color={t.profit < 0 ? "var(--danger)" : "var(--green)"} bold />
      </div>
      <div style={css("border-top:1px solid var(--border-2);padding-top:8px;width:100%")}>
        <Line label="Оплачено" value={som(t.paid)} color="var(--green)" />
        <Line label="Долг" value={som(t.debt)} color={t.debt > 0 ? "var(--danger)" : "var(--text-3)"} bold={t.debt > 0} />
        {extra}
      </div>
    </HButton>
  );
}

function Arrow() {
  return (
    <div style={css("display:flex;align-items:center;justify-content:center;color:var(--text-5);font-size:18px")} aria-hidden>
      →
    </div>
  );
}
