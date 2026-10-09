/**
 * Финансы — «касса и отчёт»:
 *  - тёмная карточка кассы: сколько денег поступило за период, график поступлений по дням
 *    и чем платили (наличные, карта, перевод);
 *  - два «разреза» суммы заказов: оплачено / долг и выкуп / прибыль — толстыми полосами;
 *  - помесячные столбики: высота — сумма заказов, зелёная часть — оплачено; под ними сводка;
 *  - должники лестницей и журнал поступлений по дням.
 *
 * Сумма заказов — «Сумма» по дате заказа. Поступления — по дате оплаты.
 * Прибыль = Сумма − Реальная цена (выкуп), только где реальная цена указана.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { getFinance, type Finance as FinanceData, type MonthRow } from "../api/domain";
import { Empty, PeriodPicker, periodOf, type Period } from "../components/cargo";
import ItemModal from "../components/ItemModal";
import CountUp from "../design/CountUp";
import { css, mix } from "../design/css";
import { Icon } from "../design/icons";
import { Page } from "../design/table";
import { ModalError, SkeletonRows } from "../design/ui";
import { METHOD_LABEL, som, todayIso } from "../lib/cargo";
import { useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const p2 = (n: number) => String(n).padStart(2, "0");
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/** «1 октября — 8 октября» / «8 октября». */
function periodText(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  const one = (d: Date, y: boolean) => `${d.getDate()} ${MONTHS[d.getMonth()]}${y ? ` ${d.getFullYear()}` : ""}`;
  if (from === to) return one(a, false);
  const y = a.getFullYear() !== b.getFullYear();
  return `${one(a, y)} — ${one(b, y)}`;
}

export default function Finance({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const [period, setPeriod] = useState<Period>(() => periodOf("month"));
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    getFinance({ date_from: period.date_from, date_to: period.date_to })
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить финансы")));
  }, [period.date_from, period.date_to]);
  useEffect(load, [load]);
  useRefresh(load);

  const t = data?.totals;

  return (
    <Page size="wide">
      <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px")}>
        <PeriodPicker value={period} onChange={setPeriod} />
        <span style={css("margin-left:auto;font-size:12.5px;color:var(--text-4)")}>{periodText(period.date_from, period.date_to)}</span>
      </div>
      {error && <ModalError text={error} />}
      {!data || !t ? (
        !error && (
          <div style={css("padding:18px;border-radius:20px;border:1px solid var(--border);background:var(--surface)")}>
            <SkeletonRows rows={6} />
          </div>
        )
      ) : (
        <div style={css("display:flex;flex-direction:column;gap:16px")}>
          <div className="fn-top">
            <CashCard data={data} />
            <div style={css("display:flex;flex-direction:column;gap:16px;min-width:0")}>
              <Split
                title="Сумма заказов за период"
                total={t.sale}
                hint={`${t.items} ${plural(t.items, "товар", "товара", "товаров")}`}
                parts={[
                  { label: "Оплачено", value: t.paid, grad: "linear-gradient(90deg,#34D399,#16A34A)", color: "var(--green)" },
                  { label: "Не оплачено", value: t.debt, grad: "linear-gradient(90deg,#FB7185,#E5484D)", color: "var(--danger)" },
                ]}
              />
              <Split
                title="Наценка на товары"
                total={t.with_cost ? t.cost + t.profit : 0}
                value={t.with_cost ? `${t.profit > 0 ? "+" : ""}${som(t.profit)}` : "—"}
                valueColor={t.with_cost ? (t.profit < 0 ? "var(--danger)" : "var(--green)") : undefined}
                hint={t.with_cost ? `${pct(t.profit, t.cost)}% к выкупу${t.with_cost < t.items ? ` · по ${t.with_cost} из ${t.items} с выкупом` : ""} · без веса и доставки` : "нет цен выкупа"}
                parts={[
                  { label: "Выкуп", value: t.cost, grad: "linear-gradient(90deg,#C4B5FD,#8B5CF6)", color: "var(--violet)" },
                  { label: "Наценка", value: t.profit, grad: "linear-gradient(90deg,#34D399,#0EA5E9)", color: t.profit < 0 ? "var(--danger)" : "var(--green)" },
                ]}
              />
              <DebtNote total={t.debts_total} count={data.debtors.length} />
            </div>
          </div>

          <MonthsCard months={data.months} />

          <div className="fn-lists">
            <Debtors list={data.debtors} />
            <Payments data={data} onOpen={setOpen} isDesktop={isDesktop} />
          </div>
        </div>
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </Page>
  );
}

// --- Касса --------------------------------------------------------------------------------------

const METHOD_TONE: Record<string, string> = { cash: "#34D399", card: "#7C9CFF", transfer: "#C4B5FD", import: "#FBBF24", other: "#94A3B8" };

/** Тёмная «карта кассы»: поступления за период, график по дням и способы оплаты. */
function CashCard({ data }: { data: FinanceData }) {
  const days = useMemo(() => {
    const raw = data.cash_in.by_day ?? [];
    const one = (d: { day: string; amount: number }) => ({ label: dayWords(d.day), sub: WEEKDAYS[new Date(`${d.day}T00:00:00`).getDay()], amount: d.amount });
    if (raw.length === 1) return [one(raw[0]), one(raw[0])];
    if (raw.length <= 62) return raw.map(one);
    const out: { label: string; sub: string; amount: number }[] = [];
    for (let i = 0; i < raw.length; i += 7) {
      const chunk = raw.slice(i, i + 7);
      out.push({ label: `неделя с ${dayWords(chunk[0].day)}`, sub: `${chunk.length} ${plural(chunk.length, "день", "дня", "дней")}`, amount: chunk.reduce((a, d) => a + d.amount, 0) });
    }
    return out;
  }, [data.cash_in.by_day]);
  const byDay = data.cash_in.by_day ?? [];
  const methods = data.cash_in.by_method ?? [];
  const max = Math.max(1, ...days.map((d) => d.amount));
  const best = byDay.reduce<{ day: string; amount: number } | null>((a, d) => (d.amount > (a?.amount ?? 0) ? d : a), null);
  const active = byDay.filter((d) => d.amount > 0).length;
  const avg = active ? Math.round(data.cash_in.amount / active) : 0;
  const empty = data.cash_in.amount <= 0;
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null && !empty ? days[hover] : null;
  const share = h && data.cash_in.amount > 0 ? pct(h.amount, data.cash_in.amount) : 0;

  // Плавная линия поступлений: точки на 100×40, сглаживание — через середины.
  const path = useMemo(() => {
    if (days.length < 2) return null;
    const pts = days.map((d, i) => [(i / (days.length - 1)) * 100, 38 - (d.amount / max) * 32] as const);
    let line = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      line += ` C ${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
    }
    return { line, area: `${line} L 100 40 L 0 40 Z`, pts };
  }, [days, max]);

  return (
    <section className="fn-cash">
      <div style={css("display:flex;align-items:center;gap:10px")}>
        <span style={css("width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:var(--fc-chip);color:var(--fc-icon)")}>
          <Icon name="finance" size={18} />
        </span>
        <span style={css("font-size:13px;color:var(--fc-mut)")}>Касса · поступило денег</span>
        <span style={css(NUM + ";margin-left:auto;font-size:12px;color:var(--fc-dim)")}>
          {data.cash_in.count} {plural(data.cash_in.count, "оплата", "оплаты", "оплат")}
        </span>
      </div>
      <div style={css(NUM + ";margin-top:14px;font-size:40px;font-weight:600;letter-spacing:-.03em;line-height:1;color:var(--fc-text);white-space:nowrap")}>
        <CountUp text={som(data.cash_in.amount)} />
      </div>
      {active ? (
        <div className="fn-cash-stats">
          <CashStat label="В среднем в день" value={som(avg)} sub="по дням с оплатами" />
          <CashStat label="Лучший день" value={best ? som(best.amount) : "—"} sub={best ? dayWords(best.day) : ""} />
          <CashStat label="Дней с оплатами" value={String(active)} tail={` из ${byDay.length}`} sub={`${pct(active, byDay.length)}% дней периода`} />
        </div>
      ) : (
        <div style={css("margin-top:8px;font-size:12.5px;color:var(--fc-dim)")}>за период оплат не было</div>
      )}

      {/* График поступлений по дням; без оплат — бледный «призрак» графика и подсказка по центру */}
      {empty ? (
        <div className="fn-spark fn-cash-empty">
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%" aria-hidden>
            <path d="M0 30 C 12 30 12 20 24 20 C 36 20 36 27 48 27 C 60 27 60 13 72 13 C 84 13 84 22 100 18" fill="none" className="fn-ghost-line" vectorEffect="non-scaling-stroke" />
            <path d="M0 38 L 100 38" fill="none" className="fn-ghost-base" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="fn-cash-msg">
            <span className="fn-cash-msg-icon">
              <Icon name="finance" size={18} />
            </span>
            <span style={css("min-width:0")}>
              <span style={css("display:block;font-size:13.5px;font-weight:500;color:var(--fc-text)")}>За этот период оплат не было</span>
              <span style={css("display:block;font-size:12px;color:var(--fc-dim);margin-top:2px")}>поступления появятся здесь, как только примут оплату</span>
            </span>
          </div>
        </div>
      ) : (
        <div className="fn-spark" onMouseLeave={() => setHover(null)}>
        {path && (
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" width="100%" height="100%" aria-hidden>
            <defs>
              <linearGradient id="fnCashArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--fc-area)", stopOpacity: 0.5 }} />
                <stop offset="100%" style={{ stopColor: "var(--fc-area)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <path d={path.area} fill="url(#fnCashArea)" />
            <path d={path.line} fill="none" style={{ stroke: "var(--fc-line)" }} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
        )}
        {path && hover !== null && h && (
          <>
            <span className="fn-guide" style={{ left: `${path.pts[hover][0]}%` }} />
            <span className="fn-spark-dot" style={{ left: `${path.pts[hover][0]}%`, top: `${(path.pts[hover][1] / 40) * 100}%` }} />
            <span
              className={"fn-tip" + (path.pts[hover][0] < 18 ? " left" : path.pts[hover][0] > 82 ? " right" : "") + (path.pts[hover][1] < 18 ? " below" : "")}
              style={{ left: `${path.pts[hover][0]}%`, top: `${(path.pts[hover][1] / 40) * 100}%` }}
            >
              <span style={css("display:flex;align-items:baseline;gap:6px;white-space:nowrap")}>
                <span style={css("font-size:12.5px;font-weight:500;color:var(--fc-tip-text)")}>{h.label}</span>
                <span style={css("font-size:11.5px;color:var(--fc-tip-dim)")}>{h.sub}</span>
              </span>
              <span style={css(NUM + ";display:block;margin-top:4px;font-size:18px;font-weight:600;letter-spacing:-.02em;color:var(--fc-tip-text);white-space:nowrap")}>{som(h.amount)}</span>
              <span style={css("display:flex;align-items:center;gap:8px;margin-top:6px")}>
                <span style={css("flex:1;min-width:70px;height:5px;border-radius:999px;background:var(--fc-tip-track);overflow:hidden")}>
                  <span style={mix("display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#6A8BFF,#34D399)", { width: `${Math.max(share, h.amount ? 3 : 0)}%` })} />
                </span>
                <span style={css(NUM + ";font-size:11.5px;color:var(--fc-tip-dim);white-space:nowrap")}>{h.amount ? `${share}% периода` : "оплат не было"}</span>
              </span>
            </span>
          </>
        )}
        <div className="fn-spark-hit">
          {days.map((_, i) => (
            <span key={i} onMouseEnter={() => setHover(i)} />
          ))}
        </div>
        </div>
      )}

      {/* Чем платили; без оплат — серые заготовки */}
      {methods.length === 0 && (
        <div style={css("margin-top:16px")} aria-hidden>
          <div className="fn-methods">
            <span style={{ flexGrow: 6, background: "var(--fc-track)" }} />
            <span style={{ flexGrow: 3, background: "var(--fc-track)" }} />
            <span style={{ flexGrow: 1, background: "var(--fc-track)" }} />
          </div>
          <div style={css("display:flex;gap:16px;margin-top:12px")}>
            {[84, 70, 58].map((w) => (
              <span key={w} className="fn-ghost-chip" style={{ width: w }} />
            ))}
          </div>
        </div>
      )}
      {methods.length > 0 && (
        <div style={css("margin-top:16px")}>
          <div className="fn-methods">
            {methods.map((m) => (
              <span key={m.method} style={{ flexGrow: m.amount, background: METHOD_TONE[m.method] ?? METHOD_TONE.other }} />
            ))}
          </div>
          <div style={css("display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px")}>
            {methods.map((m) => (
              <span key={m.method} style={css(NUM + ";display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--fc-mut);white-space:nowrap")}>
                <span style={mix("width:8px;height:8px;border-radius:3px", { background: METHOD_TONE[m.method] ?? METHOD_TONE.other })} />
                {METHOD_LABEL[m.method] ?? m.method}
                <b style={css("color:var(--fc-text);font-weight:500")}>
                  <CountUp text={som(m.amount)} />
                </b>
                <span style={css("color:var(--fc-faint)")}>
                  <CountUp text={`${pct(m.amount, data.cash_in.amount)}%`} />
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Плашка итога в карточке кассы: подпись, число и пояснение. */
function CashStat({ label, value, tail, sub }: { label: string; value: string; tail?: string; sub: string }) {
  return (
    <div className="fn-cash-stat">
      <span style={css("display:block;font-size:11.5px;color:var(--fc-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{label}</span>
      <span style={css(NUM + ";display:block;margin-top:3px;font-size:15px;font-weight:500;color:var(--fc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
        <CountUp text={value} />
        {tail}
      </span>
      <span style={css("display:block;margin-top:1px;font-size:11.5px;color:var(--fc-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{sub}</span>
    </div>
  );
}

function dayWords(day: string): string {
  if (day === todayIso()) return "сегодня";
  if (day === todayIso(-1)) return "вчера";
  const d = new Date(`${day}T00:00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// --- Разрезы суммы ------------------------------------------------------------------------------

/** Толстая полоса «из чего состоит сумма»: доли подписаны над полосой, числа — под ней. */
function Split({ title, total, value, valueColor, hint, parts }: { title: string; total: number; value?: string; valueColor?: string; hint: string; parts: { label: string; value: number; grad: string; color: string }[] }) {
  const sum = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  return (
    <section className="fn-split">
      <div style={css("display:flex;align-items:baseline;gap:10px;flex-wrap:wrap")}>
        <span style={css("font-size:13px;color:var(--text-2)")}>{title}</span>
        <span style={mix(NUM + ";margin-left:auto;font-size:22px;font-weight:500;letter-spacing:-.02em;white-space:nowrap", { color: valueColor ?? "var(--text)" })}>{value ?? (total ? <CountUp text={som(total)} /> : "—")}</span>
      </div>
      {sum <= 0 ? (
        <div className="fn-split-empty">за этот период данных нет</div>
      ) : (
      <div className="fn-split-bar">
        {sum > 0 ? (
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <span key={p.label} className="bar-grow" style={{ flexGrow: p.value, background: p.grad }}>
                {pct(p.value, sum) >= 12 && <b>{pct(p.value, sum)}%</b>}
              </span>
            ))
        ) : (
          <span style={{ flexGrow: 1, background: "var(--hover)" }} />
        )}
      </div>
      )}
      <div style={css("display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline")}>
        {parts.map((p) => (
          <span key={p.label} style={css("display:inline-flex;align-items:baseline;gap:7px;white-space:nowrap")}>
            <span style={mix("width:8px;height:8px;border-radius:3px;align-self:center", { background: p.grad })} />
            <span style={css("font-size:12.5px;color:var(--text-3)")}>{p.label}</span>
            <span style={mix(NUM + ";font-size:14px;font-weight:500", { color: p.value ? p.color : "var(--text-4)" })}>{som(p.value)}</span>
          </span>
        ))}
        <span style={css("margin-left:auto;font-size:12px;color:var(--text-4)")}>{hint}</span>
      </div>
    </section>
  );
}

function DebtNote({ total, count }: { total: number; count: number }) {
  return (
    <a href="#fn-debtors" className="fn-debt" onClick={(e) => { e.preventDefault(); document.getElementById("fn-debtors")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
      <span style={css("width:34px;height:34px;border-radius:11px;flex:none;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#FB7185,#DC2626)")}>!</span>
      <span style={css("min-width:0")}>
        <span style={css("display:block;font-size:12.5px;color:var(--text-3)")}>Долги клиентов — за всё время, по невыданным товарам</span>
        <span style={css(NUM + ";display:block;font-size:20px;font-weight:500;color:var(--danger);margin-top:1px")}>
          <CountUp text={som(total)} />
        </span>
      </span>
      <span style={css(NUM + ";margin-left:auto;font-size:12.5px;color:var(--text-3);white-space:nowrap")}>
        {count} {plural(count, "должник", "должника", "должников")} ↓
      </span>
    </a>
  );
}

// --- По месяцам ---------------------------------------------------------------------------------

/**
 * Месяцы плитками (старые слева, новые справа): сумма, столбик-размер к лучшему месяцу,
 * доля оплаты полосой и рост к прошлому месяцу. Под плитками — полоса выбранного месяца:
 * пять цифр и сравнение каждой с прошлым месяцем.
 */
function MonthsCard({ months }: { months: MonthRow[] }) {
  const first = months.findIndex((m) => m.items > 0);
  const list = first < 0 ? [] : months.slice(first);
  const max = Math.max(1, ...list.map((m) => m.sale));
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => setPick(null), [months]);
  const sel = list.find((m) => m.month === pick) ?? list[list.length - 1];
  const selPrev = sel ? list[list.indexOf(sel) - 1] ?? null : null;

  return (
    <section className="fn-months">
      <div style={css("display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:14px")}>
        <span style={css("font-size:15px;font-weight:500;color:var(--text)")}>По месяцам</span>
        <span style={css("font-size:12px;color:var(--text-4)")}>нажмите на месяц — ниже его цифры и сравнение с прошлым</span>
      </div>
      {list.length === 0 ? (
        <Empty icon="finance" title="Заказов пока нет" />
      ) : (
        <>
          <div className="fn-tiles">
            {list.map((m, i) => {
              const prev = i > 0 ? list[i - 1] : null;
              const paid = Math.min(m.paid, m.sale);
              const debt = Math.max(0, m.sale - paid);
              const mi = Number(m.month.slice(5, 7)) - 1;
              const on = sel === m;
              return (
                <button key={m.month} type="button" className={"fn-tile" + (on ? " on" : "")} onClick={() => setPick(m.month)} aria-pressed={on}>
                  <span style={css("display:flex;align-items:flex-start;gap:10px")}>
                    <span style={css("flex:1;min-width:0")}>
                      <span style={css("display:flex;align-items:baseline;gap:6px")}>
                        <span style={css("font-size:13.5px;font-weight:500;color:var(--text)")}>{MONTHS_NOM[mi]}</span>
                        <span style={css(NUM + ";font-size:11.5px;color:var(--text-4)")}>{m.month.slice(0, 4)}</span>
                      </span>
                      <span style={css(NUM + ";display:block;margin-top:6px;font-size:18px;font-weight:500;letter-spacing:-.02em;color:var(--text);white-space:nowrap")}>
                        <CountUp text={som(m.sale)} />
                      </span>
                    </span>
                    {/* Столбик: высота — сумма к лучшему месяцу, зелёное — оплачено */}
                    <span className="fn-tile-col" title={`${pct(m.sale, max)}% от лучшего месяца`}>
                      <span style={{ height: `${Math.max(6, pct(m.sale, max))}%` }}>
                        {debt > 0 && <i style={{ flexGrow: debt, background: "linear-gradient(180deg,#FB7185,#E5484D)" }} />}
                        {paid > 0 && <i style={{ flexGrow: paid, background: "linear-gradient(180deg,#34D399,#16A34A)" }} />}
                      </span>
                    </span>
                  </span>
                  <span className="fn-tile-bar">
                    {paid > 0 && <i style={{ flexGrow: paid, background: "linear-gradient(90deg,#34D399,#16A34A)" }} />}
                    {debt > 0 && <i style={{ flexGrow: debt, background: "linear-gradient(90deg,#FB7185,#E5484D)" }} />}
                  </span>
                  <span style={css("display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-top:8px;min-width:0")}>
                    <span style={css(NUM + ";font-size:12px;color:var(--text-3);white-space:nowrap")}>
                      оплачено{" "}
                      <b style={css("font-weight:500;color:var(--green)")}>
                        <CountUp text={`${pct(paid, m.sale)}%`} />
                      </b>
                    </span>
                    <Delta now={m.sale} before={prev?.sale ?? null} current={m.month === todayIso().slice(0, 7)} />
                  </span>
                </button>
              );
            })}
          </div>
          {sel && <MonthDetail m={sel} prev={selPrev} best={max} />}
        </>
      )}
    </section>
  );
}

/** Рост к прошлому месяцу: «↑ 28%», «↓ 12%»; у текущего месяца — «идёт», у первого — «первый». */
function Delta({ now, before, current, label, good = "up" }: { now: number; before: number | null; current?: boolean; label?: string; good?: "up" | "down" | "none" }) {
  if (current && !label) {
    const d = new Date();
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return <span className="fn-delta now">идёт · {d.getDate()}/{days}</span>;
  }
  if (before === null || before <= 0) return <span className="fn-delta">{label ? "нет данных" : "первый"}</span>;
  const p = Math.round(((now - before) / before) * 100);
  return (
    <span className={"fn-delta " + (good === "none" ? "" : (p >= 0) === (good === "up") ? "up" : "down")} title={label ? `к ${label}` : "к прошлому месяцу"}>
      {p >= 0 ? "↑" : "↓"} {Math.abs(p)}%{label ? ` к ${label}` : ""}
    </span>
  );
}

/** Месяц в дательном падеже — для «к сентябрю», «к маю». */
const MONTHS_DAT = ["январю", "февралю", "марту", "апрелю", "маю", "июню", "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю"];
/** И в творительном — для «сравнение с сентябрём». */
const MONTHS_INS = ["январём", "февралём", "мартом", "апрелем", "маем", "июнем", "июлем", "августом", "сентябрём", "октябрём", "ноябрём", "декабрём"];

/**
 * Полоса выбранного месяца: пять ячеек одной формы — подпись, число (бежит), полоса доли,
 * пояснение и сравнение с прошлым месяцем; строки у всех ячеек на одном уровне.
 */
function MonthDetail({ m, prev, best }: { m: MonthRow; prev: MonthRow | null; best: number }) {
  const mi = Number(m.month.slice(5, 7)) - 1;
  const current = m.month === todayIso().slice(0, 7);
  const vs = prev ? MONTHS_DAT[Number(prev.month.slice(5, 7)) - 1] : undefined;
  const paid = Math.min(m.paid, m.sale);
  const G = {
    accent: "linear-gradient(90deg,#8FA6FF,#3E63DD)",
    green: "linear-gradient(90deg,#34D399,#16A34A)",
    red: "linear-gradient(90deg,#FB7185,#E5484D)",
    violet: "linear-gradient(90deg,#C4B5FD,#8B5CF6)",
    teal: "linear-gradient(90deg,#34D399,#0EA5E9)",
  };
  const cells: { label: string; value: string; color?: string; share: number; grad: string; sub: string; now?: number; before?: number | null; good?: "up" | "down" | "none" }[] = [
    {
      label: "Сумма заказов",
      value: som(m.sale),
      share: pct(m.sale, best),
      grad: G.accent,
      sub: `${m.items} ${plural(m.items, "товар", "товара", "товаров")} · ${pct(m.sale, best)}% от лучшего`,
      now: m.sale,
      before: prev?.sale ?? null,
    },
    { label: "Оплачено", value: som(paid), color: "var(--green)", share: pct(paid, m.sale), grad: G.green, sub: `${pct(paid, m.sale)}% суммы`, now: paid, before: prev ? Math.min(prev.paid, prev.sale) : null },
    {
      label: "Не оплачено",
      value: som(m.debt),
      color: m.debt > 0 ? "var(--danger)" : "var(--text-4)",
      share: pct(m.debt, m.sale),
      grad: G.red,
      sub: m.debt > 0 ? `${pct(m.debt, m.sale)}% суммы` : "всё оплачено",
      now: m.debt,
      before: prev ? prev.debt : null,
      good: "down",
    },
    {
      label: "Выкуп",
      value: m.with_cost ? som(m.cost) : "—",
      share: m.with_cost ? pct(m.cost, m.sale) : 0,
      grad: G.violet,
      sub: m.with_cost ? `${pct(m.cost, m.sale)}% суммы` : "нет цен выкупа",
      now: m.with_cost ? m.cost : undefined,
      before: prev && prev.with_cost ? prev.cost : null,
      good: "none",
    },
    {
      label: "Наценка",
      value: m.with_cost ? `${m.profit > 0 ? "+" : ""}${som(m.profit)}` : "—",
      color: m.profit < 0 ? "var(--danger)" : "var(--green)",
      share: m.with_cost ? Math.max(0, pct(m.profit, m.sale)) : 0,
      grad: G.teal,
      sub: m.with_cost ? `наценка ${pct(m.profit, m.cost)}%${m.with_cost < m.items ? ` · по ${m.with_cost} из ${m.items}` : ""}` : "нет цен выкупа",
      now: m.with_cost ? m.profit : undefined,
      before: prev && prev.with_cost ? prev.profit : null,
    },
  ];
  return (
    <div className="fn-mdetail" key={m.month}>
      <div style={css("display:flex;align-items:baseline;gap:10px;flex-wrap:wrap")}>
        <span style={css("font-size:16px;font-weight:500;color:var(--text)")}>
          {MONTHS_NOM[mi]} {m.month.slice(0, 4)}
        </span>
        <span style={css("font-size:12.5px;color:var(--text-4)")}>
          {current ? "месяц ещё идёт — сравнение с прошлым неполное" : prev ? `сравнение с ${MONTHS_INS[Number(prev.month.slice(5, 7)) - 1]}` : "первый месяц с заказами"}
        </span>
      </div>
      <div className="fn-mcells">
        {cells.map((c) => (
          <div key={c.label} className="fn-mcell">
            <span style={css("font-size:12px;color:var(--text-3)")}>{c.label}</span>
            <span style={mix(NUM + ";font-size:20px;font-weight:500;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: c.value === "—" ? "var(--text-5)" : c.color ?? "var(--text)" })}>
              <CountUp text={c.value} />
            </span>
            <span className="fn-mcell-bar">
              {c.share > 0 && <span className="bar-grow" style={{ width: `${Math.max(3, Math.min(100, c.share))}%`, background: c.grad }} />}
            </span>
            <span style={css(NUM + ";font-size:12px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{c.sub}</span>
            <span style={css("display:flex;min-height:22px")}>
              {c.now !== undefined && vs ? (
                <Delta now={c.now} before={c.before ?? null} label={vs} good={c.good} />
              ) : (
                <span className="fn-delta">{vs ? "нет данных" : "первый месяц"}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Должники и поступления ---------------------------------------------------------------------

function Panel({ id, title, meta, total, totalColor, footer, children }: { id?: string; title: string; meta: string; total: string; totalColor: string; footer: string; children: ReactNode }) {
  return (
    <section id={id} className="fn-panel">
      <div style={css("display:flex;align-items:baseline;gap:10px;padding:16px 18px 12px")}>
        <span style={css("font-size:15px;font-weight:500;color:var(--text)")}>{title}</span>
        <span style={css(NUM + ";font-size:12.5px;color:var(--text-4)")}>{meta}</span>
        <span style={mix(NUM + ";margin-left:auto;font-size:18px;font-weight:500;white-space:nowrap", { color: totalColor })}>{total}</span>
      </div>
      <div className="thin-scroll" style={css("flex:1;min-height:0;overflow-y:auto;border-top:1px solid var(--border-2)")}>
        {children}
      </div>
      <div style={css("padding:9px 18px;border-top:1px solid var(--border-2);background:var(--surface-2);font-size:11.5px;color:var(--text-4)")}>{footer}</div>
    </section>
  );
}

function Debtors({ list }: { list: FinanceData["debtors"] }) {
  const nav = useNavigate();
  const max = list[0]?.debt || 1;
  const total = list.reduce((s, d) => s + d.debt, 0);
  return (
    <Panel id="fn-debtors" title="Должники" meta={`${list.length}`} total={som(total)} totalColor="var(--danger)" footer="долг по невыданным товарам · нажмите — карточка клиента">
      {list.length === 0 ? (
        <PanelEmpty tone="green" title="Долгов нет" text="все клиенты рассчитались за невыданные товары" />
      ) : (
        list.map((d, i) => {
          const days = Math.max(0, Math.round((new Date(todayIso()).getTime() - new Date(d.oldest.slice(0, 10)).getTime()) / 86400000));
          return (
            <div key={d.id} onClick={() => nav(`/customers/${d.id}`)} className="fn-debtor">
              <span className={"fn-place" + (i < 3 ? " top" : "")}>{i + 1}</span>
              <Avatar name={d.name} />
              <span style={css("min-width:0")}>
                <span style={css("display:block;font-size:13.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{d.name}</span>
                <span style={css(NUM + ";display:block;font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                  {d.items} {plural(d.items, "товар", "товара", "товаров")} · долг с {dayWords(d.oldest.slice(0, 10))}
                  {days >= 30 && <span style={css("color:var(--danger)")}> · {days} дн.</span>}
                </span>
              </span>
              <span style={css("min-width:0;text-align:right")}>
                <span style={css(NUM + ";display:block;font-size:14px;font-weight:500;color:var(--danger);white-space:nowrap")}>{som(d.debt)}</span>
                <span style={css("display:block;height:5px;border-radius:999px;background:var(--hover);margin-top:6px;overflow:hidden")}>
                  <span style={mix("display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#FB7185,#E5484D)", { width: `${Math.max(4, (d.debt / max) * 100)}%` })} />
                </span>
              </span>
            </div>
          );
        })
      )}
    </Panel>
  );
}

function Payments({ data, onOpen, isDesktop }: { data: FinanceData; onOpen: (id: number) => void; isDesktop: boolean }) {
  const groups = useMemo(() => {
    const g: { day: string; rows: FinanceData["payments"] }[] = [];
    for (const p of data.payments) {
      const d = new Date(p.paid_at);
      const day = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
      const last = g[g.length - 1];
      if (last && last.day === day) last.rows.push(p);
      else g.push({ day, rows: [p] });
    }
    return g;
  }, [data.payments]);
  return (
    <Panel
      title="Поступления"
      meta={`${data.cash_in.count}`}
      total={`${data.cash_in.amount ? "+" : ""}${som(data.cash_in.amount)}`}
      totalColor="var(--green)"
      footer={data.cash_in.count > data.payments.length ? `показаны последние ${data.payments.length} из ${data.cash_in.count} · нажмите — карточка товара` : "нажмите — карточка товара"}
    >
      {data.payments.length === 0 ? (
        <PanelEmpty tone="accent" title="Оплат за период нет" text="выберите период побольше — например, «30 дней»" />
      ) : (
        groups.map((g) => {
          const d = new Date(`${g.day}T00:00:00`);
          const sum = g.rows.reduce((a, p) => a + p.amount, 0);
          return (
            <div key={g.day}>
              <div className="fn-pay-day">
                <span style={css("font-size:12.5px;font-weight:500;color:var(--text-2)")}>{g.day === todayIso() ? "Сегодня" : g.day === todayIso(-1) ? "Вчера" : `${d.getDate()} ${MONTHS[d.getMonth()]}`}</span>
                <span style={css("font-size:11.5px;color:var(--text-4)")}>{WEEKDAYS[d.getDay()]}</span>
                <span style={css(NUM + ";margin-left:auto;font-size:12px;color:var(--green)")}>+{som(sum)}</span>
              </div>
              {g.rows.map((p) => {
                const at = new Date(p.paid_at);
                return (
                  <div key={p.id} onClick={() => onOpen(p.item_id)} className="fn-pay">
                    <span style={css(NUM + ";font-size:12.5px;color:var(--text-3)")}>
                      {p2(at.getHours())}:{p2(at.getMinutes())}
                    </span>
                    <span style={css("min-width:0")}>
                      <span style={css("display:block;font-size:13.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.customer_name}</span>
                      <span style={css("display:block;font-size:12px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                        {p.item_name}
                        {p.comment ? ` · ${p.comment}` : ""}
                      </span>
                    </span>
                    {isDesktop && (
                      <span className="fn-method" style={{ ["--m" as string]: METHOD_TONE[p.method] ?? METHOD_TONE.other }}>
                        {METHOD_LABEL[p.method] ?? p.method}
                      </span>
                    )}
                    <span style={css(NUM + ";font-size:14px;font-weight:500;color:var(--green);text-align:right;white-space:nowrap")}>+{som(p.amount)}</span>
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </Panel>
  );
}

/** Пустой список: бледные строки-заготовки (исчезают книзу) и подсказка по центру. */
function PanelEmpty({ tone, title, text }: { tone: "green" | "accent"; title: string; text: string }) {
  const grad = tone === "green" ? "linear-gradient(135deg,#34D399,#16A34A)" : "linear-gradient(135deg,#6A8BFF,#3E63DD)";
  return (
    <div className="fn-empty">
      <div className="fn-empty-rows" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="fn-empty-row">
            <span className="sk" style={{ width: 34, height: 34, borderRadius: "50%" }} />
            <span style={css("flex:1;display:flex;flex-direction:column;gap:8px")}>
              <span className="sk" style={{ width: `${[46, 60, 38, 54][i % 4]}%`, height: 9 }} />
              <span className="sk" style={{ width: `${[30, 24, 36, 28][i % 4]}%`, height: 7 }} />
            </span>
            <span className="sk" style={{ width: 64, height: 10 }} />
          </div>
        ))}
      </div>
      <div className="fn-empty-msg">
        <span style={mix("width:40px;height:40px;border-radius:13px;flex:none;display:grid;place-items:center;color:#fff;box-shadow:0 10px 20px -10px rgba(15,18,25,.45)", { background: grad })}>
          {tone === "green" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <Icon name="finance" size={19} />
          )}
        </span>
        <span style={css("min-width:0")}>
          <span style={css("display:block;font-size:14px;font-weight:500;color:var(--text)")}>{title}</span>
          <span style={css("display:block;font-size:12.5px;color:var(--text-3);margin-top:2px")}>{text}</span>
        </span>
      </div>
    </div>
  );
}

// --- Мелочи -------------------------------------------------------------------------------------

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const AVATAR_BG = [
  "linear-gradient(135deg,#5B7CFA,#8B5CF6)",
  "linear-gradient(135deg,#22C55E,#0EA5E9)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#EC4899,#8B5CF6)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
];

/** Аватар-буква; цвет — от имени, как на других страницах. */
function Avatar({ name }: { name: string }) {
  const n = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return (
    <span style={mix("width:34px;height:34px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-size:13.5px;font-weight:600", { background: AVATAR_BG[n % AVATAR_BG.length] })}>
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
