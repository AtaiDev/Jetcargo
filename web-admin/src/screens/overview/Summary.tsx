/**
 * Сводка «Обзора» по полочкам:
 *  0. Общая прибыль за всё время — все товары и все партии, старые и новые, без фильтра периода.
 *  1. Прибыль за период — итог и из чего он сложился (водопад): наценка на товары + вес клиентам
 *     − выкуп веса − доставка; рядом — деньги за период (заказы, оплаты, поступления, долги).
 *  2. Прибыль по партиям — компактной таблицей (видно 3 последние, остальные прокруткой) и все вместе.
 *  3. Товары по этапам сейчас — Заказано → На складе → Выдано.
 *  4. Клиенты.
 * Карточки кликабельны — ведут в нужный раздел.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import type { BatchProfitRow, Dashboard, ProfitSummary, Totals } from "../../api/domain";
import { shortNum } from "../../design/charts";
import CountUp from "../../design/CountUp";
import { MONO, css, mix } from "../../design/css";
import { Svg } from "../../design/icons";
import { HButton, ST } from "../../design/ui";
import { som } from "../../lib/cargo";

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** «+22 700 с» / «−9 410 с»: знак всегда виден — так читается вклад в прибыль. */
const signed = (n: number) => (n < 0 ? `−${som(Math.abs(n))}` : `+${som(n)}`);

const CARD = "background:var(--surface);border:1px solid var(--border);border-radius:14px";
const CAPTION = "font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)";

function Heading({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div style={css("display:flex;align-items:baseline;gap:10px;margin:0 2px 10px")}>
      <span style={css(CAPTION)}>{children}</span>
      {hint && <span style={css("font-size:11.5px;color:var(--text-4)")}>{hint}</span>}
    </div>
  );
}

export default function Summary({ board, isDesktop, periodLabel }: { board: Dashboard; isDesktop: boolean; periodLabel: string }) {
  const nav = useNavigate();
  const c = board.customers;
  const st = board.stages;

  return (
    <div style={css("display:flex;flex-direction:column;gap:22px")}>
      {/* Блоки прибыли и партий — только если сервер их уже отдаёт (во время обновления
          прода фронтенд может оказаться новее сервера на пару минут). */}
      {/* 0. Общая прибыль за всё время */}
      {board.profit_all && <AllTimeCard a={board.profit_all} isDesktop={isDesktop} />}

      {/* 1. Прибыль и деньги за период */}
      <div style={{ display: "grid", gridTemplateColumns: isDesktop && board.profit ? "minmax(0,1.65fr) minmax(0,1fr)" : "minmax(0,1fr)", gap: 14 }}>
        {board.profit && <ProfitCard p={board.profit} periodLabel={periodLabel} isDesktop={isDesktop} />}
        <MoneyCard board={board} periodLabel={periodLabel} />
      </div>

      {/* 2. Партии */}
      {board.batches && <BatchesCard b={board.batches} isDesktop={isDesktop} />}

      {/* 3. Товары по этапам */}
      <section>
        <Heading hint="сейчас, за всё время">Товары по этапам</Heading>
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 28px 1fr 28px 1fr" : "1fr", gap: isDesktop ? 0 : 12, alignItems: "stretch" }}>
          <Stage title="Заказано" subtitle="ждём на склад" color={ST.ordered.dot} t={st.ordered} onClick={() => nav("/orders?status=ordered")} />
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

      {/* 4. Клиенты */}
      <section>
        <Heading>Клиенты</Heading>
        <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(3, minmax(0,1fr))" : "minmax(0,1fr)", gap: 12 }}>
          <ClientTile
            icon={I_USERS}
            tone="accent"
            label="Всего клиентов"
            value={c.total}
            badge={c.new_period ? `+${c.new_period} за период` : undefined}
            bar={pct(c.total - c.with_debt, c.total)}
            note={`без долга ${c.total - c.with_debt} · с долгом ${c.with_debt}`}
            onClick={() => nav("/customers")}
          />
          <ClientTile
            icon={I_WALLET}
            tone="danger"
            label="С долгом"
            value={c.with_debt}
            badge={c.total ? `${pct(c.with_debt, c.total)}% клиентов` : undefined}
            bar={pct(c.with_debt, c.total)}
            note={c.with_debt ? `долг ${som(c.debt)} · в среднем ${som(Math.round(c.debt / c.with_debt))}` : "долгов нет"}
            onClick={() => nav("/finance")}
          />
          <ClientTile
            icon={I_USER_PLUS}
            tone="green"
            label="Новых за период"
            value={c.new_period}
            badge={c.total ? `${pct(c.new_period, c.total)}% базы` : undefined}
            bar={pct(c.new_period, c.total)}
            note="новые карточки клиентов за выбранные даты"
            onClick={() => nav("/customers")}
          />
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

// --- 0. Общая прибыль за всё время ---------------------------------------------------------

function AllTimeCard({ a, isDesktop }: { a: Dashboard["profit_all"]; isDesktop: boolean }) {
  const neg = a.total < 0;
  const since = a.since ? `${a.since.slice(8, 10)}.${a.since.slice(5, 7)}.${a.since.slice(0, 4)}` : null;
  // Наценка считается только по товарам с реальной ценой (выкупом) — показываем, по скольким.
  const parts: { label: string; value: number; sub?: string }[] = [
    { label: "Наценка на товары", value: a.goods, sub: a.goods_items < a.items ? `по ${a.goods_items} из ${a.items} — у остальных нет выкупа` : undefined },
    { label: "Вес клиентам", value: a.client },
    { label: "Выкуп веса", value: -a.buy },
    { label: "Доставка", value: -a.delivery },
  ];

  return (
    <section
      style={{
        ...css("border:1px solid var(--accent-border);border-radius:16px;padding:20px 22px;display:grid;gap:18px;align-items:center"),
        background: "linear-gradient(115deg,var(--accent-tint) 0%,var(--surface) 52%,var(--violet-tint) 100%)",
        gridTemplateColumns: isDesktop ? "minmax(0,1fr) minmax(0,1.55fr)" : "minmax(0,1fr)",
      }}
    >
      <div style={css("min-width:0")}>
        <div style={css(CAPTION + ";color:var(--accent-strong)")}>Общая прибыль за всё время</div>
        <div
          style={mix(MONO + ";font-size:40px;font-weight:700;letter-spacing:-.02em;line-height:1.15;margin-top:6px;white-space:nowrap", {
            color: neg ? "var(--danger)" : "var(--green)",
          })}
        >
          <CountUp text={som(a.total)} duration={1200} />
        </div>
        <div style={css("font-size:12px;color:var(--text-3);margin-top:4px;line-height:1.45")}>
          {since ? `с первого заказа ${since} по сегодня · ` : ""}
          {a.items} {plural(a.items, "товар", "товара", "товаров")} · {a.batches} {plural(a.batches, "партия", "партии", "партий")}
          <br />
          новые заказы и партии добавляются сюда сразу
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(4,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))", gap: 8 }}>
        {parts.map((p) => (
          <div key={p.label} style={css("background:color-mix(in srgb,var(--surface) 82%,transparent);border:1px solid var(--border-2);border-radius:12px;padding:11px 13px;min-width:0")}>
            <div style={css("font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.label}</div>
            <div
              style={mix(MONO + ";font-size:16px;font-weight:700;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", {
                color: p.value === 0 ? "var(--text-4)" : p.value > 0 ? "var(--green)" : "var(--danger)",
              })}
            >
              {p.value < 0 ? "−" : p.value > 0 ? "+" : ""}
              <CountUp text={som(Math.abs(p.value))} />
            </div>
            {p.sub && <div style={css("margin-top:2px;font-size:11px;line-height:1.35;color:var(--text-4)")}>{p.sub}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

// --- 1. Прибыль за период ---------------------------------------------------------------

function ProfitCard({ p, periodLabel, isDesktop }: { p: ProfitSummary; periodLabel: string; isDesktop: boolean }) {
  const neg = p.total < 0;
  const notes = [
    p.goods_items < p.items ? `наценка — по ${p.goods_items} из ${p.items} товаров с реальной ценой` : null,
    p.batches
      ? `партий в периоде: ${p.batches} (партия считается по дню прихода её последнего товара)`
      : "в периоде не приходили товары ни одной партии — вес, выкуп и доставка не учтены",
  ].filter(Boolean);

  return (
    <section style={css(CARD + ";padding:18px 20px 16px;display:flex;flex-direction:column;min-width:0")}>
      <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap")}>
        <span style={css(CAPTION)}>Прибыль за период</span>
        <span style={css("font-size:11.5px;color:var(--text-4)")}>{periodLabel}</span>
        <span style={css("margin-left:auto")}>
          <Delta now={p.total} before={p.previous} />
        </span>
      </div>
      <div
        style={mix(MONO + ";font-size:36px;font-weight:700;letter-spacing:-.02em;line-height:1.15;margin-top:8px;white-space:nowrap", {
          color: neg ? "var(--danger)" : "var(--green)",
        })}
      >
        <CountUp text={som(p.total)} />
      </div>
      <div style={css("font-size:12px;color:var(--text-3);margin-top:2px")}>наценка на товары + вес клиентам − выкуп веса − доставка</div>

      <Waterfall
        compact={!isDesktop}
        steps={[
          { label: "Наценка", hint: "на товары", value: p.goods },
          { label: "Вес", hint: "клиентам", value: p.client },
          { label: "Выкуп", hint: "веса", value: -p.buy },
          { label: "Доставка", hint: "водителю", value: -p.delivery },
        ]}
        total={p.total}
      />

      <div style={css("font-size:11.5px;color:var(--text-4);margin-top:10px;line-height:1.45")}>{notes.join(" · ")}</div>
    </section>
  );
}

/** Сравнение с таким же периодом перед выбранным: процент — если там была прибыль, иначе разница в сомах. */
function Delta({ now, before }: { now: number; before: number | null }) {
  if (before === null) return null;
  const diff = now - before;
  const up = diff >= 0;
  const text = before > 0 ? `${Math.abs(Math.round((diff / before) * 100))}%` : som(Math.abs(diff));
  return (
    <span
      title={`Прошлый период: ${som(before)}`}
      style={mix("display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap", {
        background: up ? "var(--green-tint)" : "var(--danger-tint)",
        color: up ? "var(--green)" : "var(--danger)",
      })}
    >
      {up ? "↑" : "↓"} {text}
      <span style={css("font-weight:500;opacity:.8")}>к прошлому периоду</span>
    </span>
  );
}

/**
 * Водопад: каждый столбик начинается там, где закончился предыдущий, — видно, что прибавило
 * прибыль, а что съело. Последний столбик — итог от нуля.
 */
function Waterfall({ steps, total, compact }: { steps: { label: string; hint: string; value: number }[]; total: number; compact: boolean }) {
  const H = compact ? 130 : 156;
  let cum = 0;
  const bars = steps.map((s) => {
    const from = cum;
    cum += s.value;
    return { ...s, from, to: cum, kind: s.value >= 0 ? ("plus" as const) : ("minus" as const) };
  });
  const all = [...bars, { label: "Прибыль", hint: "итого", value: total, from: 0, to: total, kind: "total" as const }];
  const lo = Math.min(0, ...all.flatMap((b) => [b.from, b.to]));
  let hi = Math.max(0, ...all.flatMap((b) => [b.from, b.to]));
  if (hi === lo) hi = lo + 1;
  const y = (v: number) => ((hi - v) / (hi - lo)) * H;
  const fmt = (n: number) => (compact ? `${n < 0 ? "−" : "+"}${shortNum(Math.abs(n))}` : signed(n));

  const FILL = {
    plus: "linear-gradient(180deg,var(--green-dot),color-mix(in srgb,var(--green-dot) 62%,transparent))",
    minus: "linear-gradient(180deg,color-mix(in srgb,var(--danger-dot) 62%,transparent),var(--danger-dot))",
    total: total < 0 ? "linear-gradient(180deg,var(--danger-dot),var(--danger))" : "linear-gradient(180deg,var(--accent),var(--violet-dot))",
  };

  return (
    <div style={css("margin-top:16px")}>
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${all.length}, minmax(0,1fr))`, paddingTop: 22 }}>
        {/* нулевая линия */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 22 + y(0), borderTop: "1px solid var(--border)" }} />
        {all.map((b, i) => {
          const top = y(Math.max(b.from, b.to));
          const h = Math.max(2, Math.abs(b.to - b.from) * (H / (hi - lo)));
          const zero = b.value === 0;
          return (
            <div key={b.label} style={{ position: "relative", height: H }}>
              <div
                style={mix(MONO + ";position:absolute;left:0;right:0;text-align:center;font-weight:700;white-space:nowrap", {
                  top: top - 19,
                  fontSize: compact ? 10.5 : 12,
                  color: zero ? "var(--text-5)" : b.kind === "minus" ? "var(--danger)" : b.kind === "plus" ? "var(--green)" : total < 0 ? "var(--danger)" : "var(--accent-strong)",
                })}
              >
                {b.kind === "total" ? compact ? fmt(b.value).replace("+", "") : <CountUp text={som(b.value)} /> : zero ? "0" : fmt(b.value)}
              </div>
              <div
                className="wf-bar"
                style={{
                  position: "absolute",
                  left: compact ? "16%" : "22%",
                  right: compact ? "16%" : "22%",
                  top,
                  height: h,
                  borderRadius: 7,
                  background: zero ? "var(--border-2)" : FILL[b.kind],
                  boxShadow: b.kind === "total" && !zero ? "0 6px 18px color-mix(in srgb,var(--accent) 28%,transparent)" : undefined,
                  transformOrigin: b.kind === "minus" ? "top" : "bottom",
                  animationDelay: `${i * 90}ms`,
                }}
              />
              {/* связка до следующего столбика */}
              {i < all.length - 1 && (
                <div
                  style={{
                    position: "absolute",
                    left: compact ? "84%" : "78%",
                    width: compact ? "32%" : "44%",
                    top: y(b.to),
                    borderTop: "1px dashed var(--border-strong)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${all.length}, minmax(0,1fr))`, marginTop: 8 }}>
        {all.map((b) => (
          <div key={b.label} style={css("text-align:center;min-width:0")}>
            <div style={mix("font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: b.kind === "total" ? "var(--text)" : "var(--text-2)" })}>
              {b.label}
            </div>
            <div style={css("font-size:11px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{b.hint}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- 1б. Деньги за период ----------------------------------------------------------------

/** Числа обычным шрифтом с цифрами одной ширины. */
const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";

const I_CASH_IN: PathDef[] = [
  ["path", { d: "M12 3v11" }],
  ["path", { d: "m7 9 5 5 5-5" }],
  ["path", { d: "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" }],
];
const I_BAG: PathDef[] = [
  ["path", { d: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" }],
  ["path", { d: "M3 6h18" }],
  ["path", { d: "M16 10a4 4 0 0 1-8 0" }],
];
const I_RECEIPT: PathDef[] = [
  ["path", { d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" }],
  ["path", { d: "M8 8h8" }],
  ["path", { d: "M8 12h8" }],
  ["path", { d: "M8 16h5" }],
];
const I_ALERT: PathDef[] = [
  ["circle", { cx: 12, cy: 12, r: 9 }],
  ["path", { d: "M12 7.5v5" }],
  ["path", { d: "M12 16.2h.01" }],
];

/**
 * Деньги за период: сумма заказов крупно и кольцо «сколько из неё оплачено»,
 * под ними — четыре плитки с иконками: поступило, выкуп, средний заказ, долги клиентов.
 */
function MoneyCard({ board, periodLabel }: { board: Dashboard; periodLabel: string }) {
  const nav = useNavigate();
  const f = board.finance;
  const o = board.orders;
  const paidShare = pct(f.paid, f.period);
  const avg = o.orders_period ? Math.round(f.period / o.orders_period) : null;
  const costShare = f.with_cost && f.period ? pct(f.cost, f.period) : null;

  return (
    <section style={css(CARD + ";padding:18px 20px;display:flex;flex-direction:column;justify-content:space-between;gap:16px;min-width:0")}>
      {/* Шапка */}
      <div style={css("display:flex;align-items:center;gap:10px;min-width:0")}>
        <span style={css("width:32px;height:32px;border-radius:10px;flex:none;display:grid;place-items:center;background:var(--accent-tint);color:var(--accent)")}>
          <Svg paths={I_WALLET} size={17} sw={1.9} />
        </span>
        <div style={css("min-width:0")}>
          <div style={css("font-size:14px;font-weight:700;color:var(--text)")}>Деньги за период</div>
          <div style={css("font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{periodLabel}</div>
        </div>
      </div>

      {/* Сумма заказов и кольцо оплаты */}
      <div style={css("display:flex;align-items:center;gap:18px;min-width:0")}>
        <PaidRing share={paidShare} empty={f.period <= 0} />
        <div style={css("flex:1;min-width:0")}>
          <div style={css("font-size:12px;color:var(--text-3)")}>Сумма заказов</div>
          <div style={css(NUM + ";font-size:30px;font-weight:500;letter-spacing:-.02em;line-height:1.15;white-space:nowrap")}>
            <CountUp text={som(f.period)} />
          </div>
          <div style={css("font-size:11.5px;color:var(--text-4);margin-top:1px")}>
            {o.items_period} {plural(o.items_period, "товар", "товара", "товаров")} · {o.orders_period} {plural(o.orders_period, "заказ", "заказа", "заказов")}
          </div>
          <div style={css("display:flex;flex-direction:column;gap:4px;margin-top:10px")}>
            <Legend dot="var(--green-dot)" label="Оплачено" value={som(f.paid)} color="var(--green)" />
            <Legend dot="var(--danger-dot)" label="Не оплачено" value={som(f.unpaid)} color={f.unpaid > 0 ? "var(--danger)" : "var(--text-3)"} />
          </div>
        </div>
      </div>

      {/* Плитки */}
      <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px")}>
        <MoneyTile icon={I_CASH_IN} tone="green" label="Поступило денег" value={board.cash_in === undefined ? "—" : som(board.cash_in)} sub="оплаты за период" />
        <MoneyTile icon={I_BAG} tone="violet" label="Выкуп товаров" value={f.with_cost ? som(f.cost) : "—"} sub={costShare === null ? "реальная цена не указана" : `${costShare}% от суммы заказов`} />
        <MoneyTile icon={I_RECEIPT} tone="accent" label="Средний заказ" value={avg === null ? "—" : som(avg)} sub="сумма на один заказ" />
        <MoneyTile
          icon={I_ALERT}
          tone="danger"
          label="Долги клиентов"
          value={som(f.debts_total)}
          sub="все невыданные товары"
          strong={f.debts_total > 0}
          onClick={() => nav("/finance")}
        />
      </div>
    </section>
  );
}

/** Кольцо: доля оплаченного от суммы заказов, процент — в центре. */
function PaidRing({ share, empty }: { share: number; empty: boolean }) {
  const r = 38;
  return (
    <div style={css("position:relative;width:96px;height:96px;flex:none")}>
      <svg width="96" height="96" viewBox="0 0 96 96" style={css("transform:rotate(-90deg)")}>
        <defs>
          <linearGradient id="paidRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--green-dot)" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--green-dot) 65%, var(--accent))" />
          </linearGradient>
        </defs>
        <circle cx="48" cy="48" r={r} fill="none" stroke={empty ? "var(--border-2)" : "var(--danger-tint)"} strokeWidth="10" />
        {!empty && share > 0 && (
          <circle
            className="ring-grow"
            cx="48"
            cy="48"
            r={r}
            fill="none"
            stroke="url(#paidRing)"
            strokeWidth="10"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${Math.max(share, 2)} 100`}
          />
        )}
      </svg>
      <div style={css("position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center")}>
        <span style={mix(NUM + ";font-size:19px;font-weight:600;line-height:1", { color: empty ? "var(--text-4)" : "var(--text)" })}>{empty ? "—" : `${share}%`}</span>
        <span style={css("font-size:10.5px;color:var(--text-4);margin-top:2px")}>оплачено</span>
      </div>
    </div>
  );
}

function Legend({ dot, label, value, color }: { dot: string; label: string; value: string; color: string }) {
  return (
    <div style={css("display:flex;align-items:center;gap:7px;font-size:12px;min-width:0")}>
      <span style={mix("width:8px;height:8px;border-radius:50%;flex:none", { background: dot })} />
      <span style={css("color:var(--text-3)")}>{label}</span>
      <span style={css("flex:1;border-bottom:1px dotted var(--border);margin:0 2px;transform:translateY(-3px);min-width:12px")} />
      <b style={mix(NUM + ";font-weight:500;white-space:nowrap", { color })}>
        <CountUp text={value} />
      </b>
    </div>
  );
}

const MONEY_TONE = {
  green: ["var(--green-tint)", "var(--green)"],
  violet: ["var(--violet-tint)", "var(--violet)"],
  accent: ["var(--accent-tint)", "var(--accent)"],
  danger: ["var(--danger-tint)", "var(--danger)"],
} as const;

/** Плитка денег: иконка в цветной подложке, подпись, число и пояснение. */
function MoneyTile({
  icon,
  tone,
  label,
  value,
  sub,
  strong,
  onClick,
}: {
  icon: PathDef[];
  tone: keyof typeof MONEY_TONE;
  label: string;
  value: string;
  sub: string;
  strong?: boolean;
  onClick?: () => void;
}) {
  const [tint, fg] = MONEY_TONE[tone];
  return (
    <HButton
      onClick={onClick}
      className={onClick ? "money-tile" : undefined}
      s={mix(
        "position:relative;text-align:left;border-radius:12px;padding:11px 12px;min-width:0;display:flex;flex-direction:column;gap:7px;font:inherit;color:inherit;transition:border-color .15s,box-shadow .15s,transform .15s",
        {
          background: strong ? `color-mix(in srgb, ${tint} 70%, var(--surface))` : "var(--surface-2)",
          border: `1px solid ${strong ? "var(--danger-border)" : "var(--border-2)"}`,
          cursor: onClick ? "pointer" : "default",
        }
      )}
      hover={onClick ? `border-color:${fg};box-shadow:0 6px 16px rgba(15,18,25,.07);transform:translateY(-1px)` : ""}
    >
      <div style={css("display:flex;align-items:center;gap:7px;min-width:0")}>
        <span style={mix("width:22px;height:22px;border-radius:7px;flex:none;display:grid;place-items:center", { background: tint, color: fg })}>
          <Svg paths={icon} size={13} sw={2} />
        </span>
        <span style={css("font-size:11.5px;font-weight:500;color:var(--text-2);line-height:1.25;min-width:0")}>{label}</span>
        {onClick && (
          <span className="money-tile-arrow" style={mix("margin-left:auto;flex:none;display:flex;transition:transform .15s", { color: fg })}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </span>
        )}
      </div>
      <div>
        <div style={mix(NUM + ";font-size:17px;font-weight:500;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: value === "—" ? "var(--text-5)" : strong ? fg : "var(--text)" })}>
          <CountUp text={value} />
        </div>
        <div style={css("font-size:11px;color:var(--text-4);margin-top:1px;line-height:1.35")}>{sub}</div>
      </div>
    </HButton>
  );
}

// --- 2. Прибыль по партиям ----------------------------------------------------------------

const I_LAYERS: PathDef[] = [
  ["path", { d: "m12 2 9 5-9 5-9-5 9-5Z" }],
  ["path", { d: "m3 12 9 5 9-5" }],
  ["path", { d: "m3 17 9 5 9-5" }],
];

/** Минимальная высота строки партии. */
const BATCH_ROW = 58;
/** Сколько партий видно сразу; остальные — прокруткой внутри блока. */
const BATCH_VISIBLE = 3;

/**
 * Прибыль по партиям за всё время — компактной таблицей: партия, доходы (вес + наценка),
 * расходы (выкуп + доставка), прибыль и маржа. Видно последние 3 партии, остальные — прокруткой.
 */
function BatchesCard({ b, isDesktop }: { b: Dashboard["batches"]; isDesktop: boolean }) {
  const nav = useNavigate();
  const neg = b.profit < 0;
  const link = "border:none;background:transparent;padding:0;color:var(--accent);font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap";
  const cols = isDesktop ? "minmax(0,1.7fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)" : "repeat(3,minmax(0,1fr))";
  // Высота окна списка — ровно по низ третьей партии (строки на телефоне выше, чем на компьютере).
  const listRef = useRef<HTMLDivElement>(null);
  const [listH, setListH] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const last = el.children[BATCH_VISIBLE - 1] as HTMLElement | undefined;
      setListH(el.children.length > BATCH_VISIBLE && last ? last.offsetTop + last.offsetHeight : undefined);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [b.rows.length, isDesktop]);

  return (
    <section style={css(CARD + ";overflow:hidden")}>
      {/* Шапка: название и итог всех партий одной строкой */}
      <div style={css("display:flex;align-items:center;gap:12px 24px;flex-wrap:wrap;padding:14px 20px")}>
        <div style={css("display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 220px")}>
          <span style={css("width:30px;height:30px;border-radius:9px;flex:none;display:grid;place-items:center;background:var(--surface-2);border:1px solid var(--border-2);color:var(--text-3)")}>
            <Svg paths={I_LAYERS} size={15} sw={1.9} />
          </span>
          <div style={css("min-width:0")}>
            <div style={css("font-size:14px;font-weight:700;color:var(--text)")}>Прибыль по партиям</div>
            <div style={css("font-size:11.5px;color:var(--text-4)")}>
              за всё время{b.count > 0 && ` · ${b.count} ${plural(b.count, "партия", "партии", "партий")}`}
            </div>
          </div>
        </div>
        {b.count > 0 && (
          <div style={css("display:flex;align-items:center;gap:20px;flex-wrap:wrap")}>
            <Total label="Доходы" value={som(b.income)} />
            <Total label="Расходы" value={som(b.expenses)} />
            <Total label={neg ? "Убыток" : "Прибыль"} value={som(b.profit)} color={neg ? "var(--danger)" : "var(--green)"} strong />
          </div>
        )}
      </div>

      {b.count === 0 ? (
        <div style={css("padding:0 20px 16px;font-size:12.5px;color:var(--text-3)")}>
          Партий пока нет — создайте партию в разделе{" "}
          <HButton onClick={() => nav("/batches")} s={link} hover="color:var(--accent-hover)">
            «Партии»
          </HButton>
          .
        </div>
      ) : (
        <>
          {/* Заголовки колонок */}
          <div
            style={mix(
              "display:grid;gap:16px;padding:7px 20px;border-top:1px solid var(--border-2);border-bottom:1px solid var(--border-2);background:var(--surface-2);font-size:11px;color:var(--text-4);white-space:nowrap",
              { gridTemplateColumns: cols }
            )}
          >
            {isDesktop && <span>Партия</span>}
            <span style={css("text-align:right")}>
              Доходы{isDesktop && <span style={css("color:var(--text-5)")}> · вес + наценка</span>}
            </span>
            <span style={css("text-align:right")}>
              Расходы{isDesktop && <span style={css("color:var(--text-5)")}> · выкуп + доставка</span>}
            </span>
            <span style={css("text-align:right")}>Прибыль</span>
          </div>

          {/* Партии: видно 3, остальные — прокруткой внутри блока */}
          <div ref={listRef} className="thin-scroll" style={mix("position:relative;overflow-y:auto", { maxHeight: listH })}>
            {b.rows.map((r, i) => (
              <BatchRow key={r.id} r={r} cols={cols} isDesktop={isDesktop} first={i === 0} onClick={() => nav(`/batches/${r.id}`)} />
            ))}
          </div>

          <div style={css("display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 20px;border-top:1px solid var(--border-2);font-size:11.5px;color:var(--text-4)")}>
            <span>{b.rows.length > BATCH_VISIBLE ? `ещё ${b.rows.length - BATCH_VISIBLE} — прокрутите список` : "нажмите на партию — откроется её расчёт"}</span>
            <HButton onClick={() => nav("/batches")} s={link} hover="color:var(--accent-hover)">
              Все партии →
            </HButton>
          </div>
        </>
      )}
    </section>
  );
}

function Total({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <div style={css("text-align:right")}>
      <div style={css("font-size:11px;color:var(--text-4)")}>{label}</div>
      <div style={mix(NUM + ";white-space:nowrap", { fontSize: strong ? 17 : 14.5, fontWeight: strong ? 600 : 500, color: color ?? "var(--text)" })}>
        <CountUp text={value} />
      </div>
    </div>
  );
}

/** «27.09 — 04.10»: от создания партии до последнего прихода; по нему партия попадает в период. */
function arrivals(r: BatchProfitRow): string {
  // Местный день, а не день по UTC: приход в 2 часа ночи по Бишкеку — это уже новый день.
  const short = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  return r.last_arrival ? `${short(r.created_at)} — ${short(r.last_arrival)}` : `создана ${short(r.created_at)}`;
}

function BatchRow({ r, cols, isDesktop, first, onClick }: { r: BatchProfitRow; cols: string; isDesktop: boolean; first: boolean; onClick: () => void }) {
  const neg = r.profit < 0;
  const open = r.status === "open";
  const margin = r.income > 0 ? Math.round((r.profit / r.income) * 100) : null;
  const plain = (n: number) => som(n).replace(/\s*с$/, "");
  const num = (main: string, sub: string, title: string, color?: string) => (
    <div title={title} style={css("text-align:right;min-width:0")}>
      <div style={mix(NUM + ";font-size:13.5px;font-weight:500;white-space:nowrap", { color: color ?? "var(--text)" })}>{main}</div>
      <div style={css(NUM + ";font-size:11px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{sub}</div>
    </div>
  );

  return (
    <HButton
      onClick={onClick}
      s={mix(
        "display:grid;align-items:center;width:100%;text-align:left;border:none;background:transparent;padding:10px 20px;cursor:pointer;font:inherit;color:inherit",
        { gridTemplateColumns: cols, gap: isDesktop ? 16 : "8px 12px", minHeight: BATCH_ROW },
        !first && "border-top:1px solid var(--border-2)"
      )}
      hover="background:var(--surface-2)"
    >
      <div style={mix("min-width:0", !isDesktop && "grid-column:1 / -1")}>
        <div style={css("font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{r.name}</div>
        <div style={css("display:flex;align-items:center;gap:6px;margin-top:2px;font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden")}>
          <span style={mix("width:6px;height:6px;border-radius:50%;flex:none", { background: open ? "var(--green-dot)" : "var(--text-5)" })} />
          <span style={css("overflow:hidden;text-overflow:ellipsis;" + NUM)}>
            {open ? "принимает" : "закрыта"} · {r.items} тов. · {arrivals(r)}
          </span>
        </div>
      </div>
      {num(som(r.income), `${plain(r.client)} + ${plain(r.markup)}`, `Вес клиентам ${som(r.client)} + наценка ${som(r.markup)}`)}
      {num(som(r.expenses), `${plain(r.buy)} + ${plain(r.delivery)}`, `Выкуп веса ${som(r.buy)} + доставка ${som(r.delivery)}`)}
      <div style={css("text-align:right;min-width:0")}>
        <div style={mix(NUM + ";font-size:14px;font-weight:600;white-space:nowrap", { color: neg ? "var(--danger)" : "var(--green)" })}>
          <CountUp text={som(r.profit)} />
        </div>
        <div style={css(NUM + ";font-size:11px;color:var(--text-4);white-space:nowrap")}>{margin === null ? "—" : `маржа ${margin}%`}</div>
      </div>
    </HButton>
  );
}

// --- 3. Этапы и 4. Клиенты -----------------------------------------------------------------

const card =
  "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease";

/** Строка «подпись …… значение» внутри карточки. */
function Line({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div style={css("display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12.5px;padding:3px 0")}>
      <span style={css("color:var(--text-3)")}>{label}</span>
      <span style={mix(MONO + ";white-space:nowrap", { color: color ?? "var(--text)", fontWeight: bold ? 600 : 500 })}>
        <CountUp text={value} />
      </span>
    </div>
  );
}

// Иконки клиентов (контур 24×24, как остальные в design/icons).
type PathDef = [string, Record<string, unknown>];
const I_USERS: PathDef[] = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
  ["circle", { cx: 9, cy: 7, r: 4 }],
  ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
  ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }],
];
const I_WALLET: PathDef[] = [
  ["path", { d: "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" }],
  ["path", { d: "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" }],
];
const I_USER_PLUS: PathDef[] = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
  ["circle", { cx: 9, cy: 7, r: 4 }],
  ["path", { d: "M19 8v6" }],
  ["path", { d: "M22 11h-6" }],
];

const TONE = {
  accent: { tint: "var(--accent-tint)", fg: "var(--accent)", value: "var(--text)", bar: "linear-gradient(90deg,var(--accent),var(--violet-dot))" },
  danger: { tint: "var(--danger-tint)", fg: "var(--danger)", value: "var(--danger)", bar: "linear-gradient(90deg,var(--danger-dot),color-mix(in srgb,var(--danger-dot) 60%,var(--amber-dot)))" },
  green: { tint: "var(--green-tint)", fg: "var(--green)", value: "var(--green)", bar: "linear-gradient(90deg,var(--green-dot),color-mix(in srgb,var(--green-dot) 60%,var(--accent)))" },
};

/**
 * Плитка клиентов: иконка в цветной подложке, крупное число, бейдж с долей,
 * полоса этой доли и короткое пояснение. Большая бледная иконка — фоном в углу.
 */
function ClientTile({
  icon,
  tone,
  label,
  value,
  badge,
  bar,
  note,
  onClick,
}: {
  icon: PathDef[];
  tone: keyof typeof TONE;
  label: string;
  value: number;
  badge?: string;
  bar: number;
  note: string;
  onClick: () => void;
}) {
  const t = TONE[tone];
  return (
    <HButton
      onClick={onClick}
      s={mix(
        "position:relative;overflow:hidden;text-align:left;cursor:pointer;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;font:inherit;color:inherit;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease"
      )}
      hover={`border-color:${t.fg};box-shadow:0 10px 26px rgba(15,18,25,.08);transform:translateY(-2px)`}
    >
      {/* фоновая иконка */}
      <span style={mix("position:absolute;right:-14px;bottom:-18px;opacity:.07;pointer-events:none;display:flex", { color: t.fg })} aria-hidden>
        <Svg paths={icon} size={104} sw={1.5} />
      </span>

      <div style={css("display:flex;align-items:center;gap:12px;width:100%")}>
        <span style={mix("width:42px;height:42px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center", { background: t.tint, color: t.fg })}>
          <Svg paths={icon} size={21} sw={1.8} />
        </span>
        <div style={css("flex:1;min-width:0")}>
          <div style={css("font-size:12.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{label}</div>
          <div style={mix(MONO + ";font-size:26px;font-weight:700;line-height:1.15", { color: value ? t.value : "var(--text)" })}>
            <CountUp text={String(value)} />
          </div>
        </div>
        {badge && (
          <span style={mix("align-self:flex-start;flex:none;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap", { background: t.tint, color: t.fg })}>
            {badge}
          </span>
        )}
      </div>

      <div style={css("width:100%;position:relative")}>
        <div style={css("height:6px;border-radius:4px;background:var(--border-2);overflow:hidden")}>
          <div className="bar-grow" style={mix("height:100%;border-radius:4px", { width: `${Math.min(100, Math.max(bar ? 3 : 0, bar))}%`, background: t.bar })} />
        </div>
        <div style={css("font-size:11.5px;color:var(--text-4);margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{note}</div>
      </div>
    </HButton>
  );
}

function Stage({ title, subtitle, color, t, extra, onClick }: { title: string; subtitle: string; color: string; t: Totals; extra?: ReactNode; onClick: () => void }) {
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
          <div style={css(MONO + ";font-size:26px;font-weight:700;line-height:1")}>
            <CountUp text={String(t.items)} />
          </div>
          <div style={css("font-size:11px;color:var(--text-4);margin-top:3px")}>товаров · {t.qty} шт</div>
        </div>
      </div>
      <div style={css("border-top:1px solid var(--border-2);padding-top:8px;width:100%")}>
        <Line label="Сумма" value={som(t.sale)} bold />
        <Line label="Выкуп" value={t.with_cost ? som(t.cost) : "—"} />
        <Line label="Наценка" value={t.with_cost ? som(t.profit) : "—"} color={t.profit < 0 ? "var(--danger)" : "var(--green)"} bold />
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
