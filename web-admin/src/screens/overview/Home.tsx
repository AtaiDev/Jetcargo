/**
 * Верх «Обзора» — новый дизайн: большой заголовок и «ждут выдачи», переключатель периода,
 * четыре карточки, шкала оплаты, сумма заказов по месяцам, работа склада по времени и товары
 * по этапам. Все числа считает сервер (dashboard.home) — здесь только рисуем и анимируем.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import type { HomeBoard, HomeMonth } from "../../api/domain";
import type { PeriodKey } from "../../components/cargo";
import CountUp from "../../design/CountUp";
import { css } from "../../design/css";
import { afterBoot } from "../../lib/boot";
import { som } from "../../lib/cargo";

// --- мелочи --------------------------------------------------------------------------------------

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MONTHS_FULL = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const SLOTS = [
  { long: "00:00 – 08:00", short: "0–8" },
  { long: "08:00 – 12:00", short: "8–12" },
  { long: "12:00 – 16:00", short: "12–16" },
  { long: "16:00 – 24:00", short: "16–24" },
];

const pctText = (n: number) => `${Math.abs(n).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
/** Коротко для осей: 60 000 → «60к», 1 250 000 → «1,3 млн». */
const short = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн` : n >= 1000 ? `${Math.round(n / 1000).toLocaleString("ru-RU")}к` : String(Math.round(n));
function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** После первой отрисовки — чтобы полосы, кольца и дуги плавно выросли от нуля. */
function useOn() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // После заставки и с паузой: шкалы и графики растут, когда их блок уже появляется.
    let t = 0;
    const off = afterBoot(() => {
      t = window.setTimeout(() => setOn(true), 450);
    });
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, []);
  return on;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Плавный переход массива чисел к новым значениям (кадрами, мягкое торможение в конце). */
function useTween(target: number[], ms = 750): number[] {
  const [cur, setCur] = useState(target);
  const curRef = useRef(target);
  const key = target.map((v) => v.toFixed(4)).join(",");
  useEffect(() => {
    const from = curRef.current;
    const to = target;
    if (from.length !== to.length || reducedMotion()) {
      curRef.current = to;
      setCur(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = to.map((x, i) => from[i] + (x - from[i]) * e);
      curRef.current = v;
      setCur(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cur;
}

/** Всегда n точек — чтобы линия перетекала, даже если у периодов разное число отрезков. */
function resample(vals: number[], n = 9): number[] {
  const src = vals.length === 0 ? [0, 0] : vals.length === 1 ? [0, vals[0]] : vals;
  return Array.from({ length: n }, (_, k) => {
    const t = (k * (src.length - 1)) / (n - 1);
    const i = Math.floor(t);
    const j = Math.min(i + 1, src.length - 1);
    return src[i] + (src[j] - src[i]) * (t - i);
  });
}

function Info({ text }: { text: string }) {
  return (
    <span className="ov-info" tabIndex={0} role="note" aria-label={text} title={text}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 11v5.5M12 7.6v.2" />
      </svg>
    </span>
  );
}

function Arrow() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** Изменение к прошлому периоду: ↑ зелёным, ↓ красным; unit — «%» или «пп» (процентные пункты). */
function Delta({ v, unit = "%" }: { v: number | null; unit?: "%" | "пп" }) {
  if (v === null || !Number.isFinite(v)) return null;
  const up = v >= 0;
  return (
    <span key={`${unit}${v}`} className={"ov-delta " + (up ? "up" : "down")}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={up ? undefined : { transform: "rotate(180deg)" }}>
        <path d="M12 19V5M6 11l6-6 6 6" />
      </svg>
      {unit === "%" ? pctText(v) : `${up ? "+" : "−"}${Math.abs(v)} пп`}
    </span>
  );
}

// --- шапка: заголовок и «ждут выдачи» --------------------------------------------------------------

export function HomeHead({ waiting, title = "Обзор" }: { waiting?: number | null; title?: string }) {
  const nav = useNavigate();
  return (
    <div className="ov-head">
      <h1 className="ov-title" aria-label={title}>
        {[...title].map((ch, i) => (
          <span key={i} className="ov-ch" style={{ animationDelay: `${i * 45}ms` }} aria-hidden>
            {ch}
          </span>
        ))}
      </h1>
      {waiting !== undefined && <button type="button" className="ov-live" onClick={() => nav("/issue")} title="Товары на складе — ждут, когда клиент заберёт">
        <span className="ov-live-dot" aria-hidden />
        <b>{waiting === null ? "…" : <CountUp text={String(waiting)} />}</b>
        <span className="ov-live-l">ждут выдачи</span>
      </button>}
    </div>
  );
}

// --- панель: период, «на дату», кнопки -----------------------------------------------------------

const SEG: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "7", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "year", label: "Год" },
];

/** Переключатель с «таблеткой», которая плавно переезжает под выбранную кнопку. */
function Seg<K extends string>({ items, value, onChange, small }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void; small?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const box = ref.current;
      const btn = box?.querySelector<HTMLButtonElement>(`button[data-k="${value}"]`);
      if (box && btn) setPill({ x: btn.offsetLeft, w: btn.offsetWidth });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [value, items.length]);
  return (
    <div ref={ref} className={"ov-seg" + (small ? " sm" : "")} role="tablist">
      {pill && <span className="ov-seg-pill" style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} aria-hidden />}
      {items.map((it) => (
        <button key={it.key} type="button" role="tab" data-k={it.key} aria-selected={it.key === value} className={it.key === value ? "on" : ""} onClick={() => onChange(it.key)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function HomeToolbar({
  periodKey,
  from,
  to,
  onPeriod,
  onExport,
}: {
  periodKey: PeriodKey;
  from: string;
  to: string;
  onPeriod: (k: PeriodKey) => void;
  onExport: () => void;
}) {
  const nav = useNavigate();
  const d = new Date(`${to}T00:00:00`);
  const f = new Date(`${from}T00:00:00`);
  const asOf =
    periodKey === "today"
      ? `Сегодня, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`
      : periodKey === "7"
        ? `Последние 7 дней, ${f.getDate()} ${MONTHS_GEN[f.getMonth()]} — ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`
        : periodKey === "year"
          ? `${d.getFullYear()} год, с начала года`
          : `${MONTHS_FULL[d.getMonth()][0].toUpperCase()}${MONTHS_FULL[d.getMonth()].slice(1)} ${d.getFullYear()}, с начала месяца`;
  const segKey = SEG.some((s) => s.key === periodKey) ? periodKey : "month";
  return (
    <div className="ov-bar">
      <Seg items={SEG} value={segKey} onChange={onPeriod} />
      <p className="ov-asof">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5V12l3 2" />
        </svg>
        <span key={asOf} className="ov-fade">
          {asOf}
        </span>
      </p>
      <div className="ov-bar-end">
        <button type="button" className="ov-btn" onClick={() => nav("/finance")}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
            <path d="M4 20h16M7 16v-5M12 16V7M17 16v-8" />
          </svg>
          Финансы
        </button>
        <button type="button" className="ov-btn dark" onClick={onExport}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          Экспорт
        </button>
      </div>
    </div>
  );
}

// --- карточки ------------------------------------------------------------------------------------

function Kpi({
  tone,
  label,
  info,
  value,
  delta,
  unit,
  meta,
  mini,
  link,
  to,
}: {
  tone: "ink" | "paper" | "stone" | "stone2";
  label: string;
  info: string;
  value: string;
  delta: number | null;
  unit?: "%" | "пп";
  meta: ReactNode;
  mini: ReactNode;
  link: string;
  to: string;
}) {
  const nav = useNavigate();
  return (
    <article className={"ov-kpi " + tone}>
      <h3 className="ov-kpi-label">
        {label} <Info text={info} />
      </h3>
      <div className="ov-kpi-row">
        <div style={css("min-width:0")}>
          <p className="ov-kpi-val">
            <CountUp text={value} />
          </p>
          <p className="ov-kpi-meta">
            <Delta v={delta} unit={unit} />
            <span className="ov-kpi-vs">{meta}</span>
          </p>
        </div>
        <div className="ov-kpi-mini" aria-hidden>
          {mini}
        </div>
      </div>
      <button type="button" className="ov-more" onClick={() => nav(to)}>
        {link} <Arrow />
      </button>
    </article>
  );
}

function MiniBars({ values, on }: { values: number[]; on: boolean }) {
  const max = Math.max(...values, 1);
  return (
    <span className="ov-mbars">
      {values.map((v, i) => (
        <span key={i} className="ov-mt">
          <span className="ov-mf" style={{ transform: `translateY(${on ? 100 - Math.max(8, (v / max) * 100) : 100}%)`, transitionDelay: `${i * 90}ms` }} />
        </span>
      ))}
    </span>
  );
}

function Spark({ values, on }: { values: number[]; on: boolean }) {
  // Высоты 0–1 в своём масштабе; при смене периода линия плавно перетекает в новую форму.
  const pts = resample(values);
  const lo = Math.min(...pts);
  const span = Math.max(...pts) - lo || 1;
  const ys = useTween(pts.map((v) => (v - lo) / span));
  const xy = ys.map((y, i) => [4 + (76 * i) / (ys.length - 1), 34 - y * 28] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = xy[xy.length - 1];
  return (
    <svg className="ov-spark" viewBox="0 0 84 40">
      <defs>
        <linearGradient id="ov-spark-g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L80 40 L4 40 Z`} fill="url(#ov-spark-g)" style={{ opacity: on ? 1 : 0, transition: "opacity .6s ease .5s" }} />
      <path d={line} pathLength={100} className="ov-spark-line" style={{ strokeDashoffset: on ? 0 : 100 }} />
      <circle cx={last[0]} cy={last[1]} r="3.2" className="ov-spark-dot" style={{ opacity: on ? 1 : 0 }} />
    </svg>
  );
}

function Ring({ pct, on }: { pct: number; on: boolean }) {
  return (
    <span className="ov-ring">
      <svg viewBox="0 0 44 44">
        <circle className="ov-ring-track" cx="22" cy="22" r="17" />
        <circle className="ov-ring-fill" cx="22" cy="22" r="17" pathLength={100} style={{ strokeDasharray: `${on ? pct : 0} 100` }} />
      </svg>
      <b>{pct}%</b>
    </span>
  );
}

function Eq({ values, on }: { values: number[]; on: boolean }) {
  const max = Math.max(...values, 1);
  return (
    <span className="ov-eq">
      {values.map((v, i) => (
        <span key={i} className={"ov-et" + (i === values.length - 1 ? " last" : "")}>
          <span className="ov-ef" style={{ transform: `translateY(${on ? 100 - Math.max(6, (v / max) * 100) : 100}%)`, transitionDelay: `${i * 45}ms` }} />
        </span>
      ))}
    </span>
  );
}

// --- шкала оплаты --------------------------------------------------------------------------------

function Gauge({ g, on }: { g: HomeBoard["gauge"]; on: boolean }) {
  const nav = useNavigate();
  const score = g.score ?? 0;
  const shown = on ? score : 0;
  // 31 риска по полукругу; каждая пятая — длиннее; горят до текущего значения.
  const ticks = Array.from({ length: 31 }, (_, i) => {
    const a = Math.PI - (Math.PI * i) / 30;
    const long = i % 5 === 0;
    const r1 = 104;
    const r2 = long ? 113 : 109;
    return { x1: 120 + r1 * Math.cos(a), y1: 125 - r1 * Math.sin(a), x2: 120 + r2 * Math.cos(a), y2: 125 - r2 * Math.sin(a), lit: (i / 30) * 100 <= shown };
  });
  const head = g.score === null ? "Заказов нет" : score >= 90 ? "Почти всё оплачено" : score >= 70 ? "Оплачено хорошо" : score >= 50 ? "Половина ещё в долг" : "Много долгов";
  const text =
    g.score === null
      ? "За этот период заказов нет — оплачивать нечего."
      : g.debt > 0
        ? `Оплачено ${som(Math.round(g.paid))} из ${som(Math.round(g.sale))}, не оплачено ${som(Math.round(g.debt))} — ${g.unpaid_items} ${plural(g.unpaid_items, "товар", "товара", "товаров")}.`
        : `Всё оплачено: ${som(Math.round(g.sale))}. Долгов за период нет.`;
  return (
    <section className="ov-card ink ov-gauge-card">
      <h2 className="ov-card-title">
        Оплата заказов <Info text="Сколько процентов суммы заказов периода уже оплачено (выданное считается оплаченным)." />
      </h2>
      <div className="ov-gauge">
        <svg viewBox="0 0 240 136" role="img" aria-label={`Оплачено ${score} из 100`}>
          <defs>
            <linearGradient id="ov-gauge-g" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="var(--ov-g1)" />
              <stop offset=".55" stopColor="var(--ov-g2)" />
              <stop offset="1" stopColor="var(--ov-g3)" />
            </linearGradient>
          </defs>
          <g className="ov-ticks">
            {ticks.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.lit ? "lit" : ""} style={{ transitionDelay: `${i * 22}ms` }} />
            ))}
          </g>
          <path className="ov-g-track" d="M30 125 A90 90 0 0 1 210 125" pathLength={100} />
          <path className="ov-g-arc" d="M30 125 A90 90 0 0 1 210 125" pathLength={100} style={{ strokeDasharray: `${shown} 100` }} />
          <g className="ov-g-knob" style={{ transform: `rotate(${(shown / 100) * 180}deg)` }}>
            <circle cx="30" cy="125" r="10" />
            <circle cx="30" cy="125" r="4" />
          </g>
        </svg>
        <div className="ov-gauge-c">
          <p>
            <b>{g.score === null ? "—" : <CountUp text={String(score)} />}</b>
            <Delta v={g.delta} unit="пп" />
          </p>
          <small>из 100 — оплачено</small>
        </div>
      </div>
      <div className="ov-note">
        <h3>{head}</h3>
        <p>{text}</p>
      </div>
      <button type="button" className="ov-more" onClick={() => nav("/finance")}>
        Кто должен <Arrow />
      </button>
    </section>
  );
}

// --- сумма заказов по месяцам --------------------------------------------------------------------

/** Красивый верх шкалы: 1, 1.5, 2, 3, 4, 5, 6, 8 × 10ⁿ — делится на 4 ровных шага. */
function niceMax(v: number) {
  if (v <= 0) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const k of [1, 1.2, 1.6, 2, 2.4, 3, 4, 4.8, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

function MonthChart({ y, on }: { y: HomeBoard["year"]; on: boolean }) {
  const [which, setWhich] = useState<"cur" | "prev">("cur");
  const data = which === "cur" ? y.current : y.previous;
  const yearNo = which === "cur" ? y.year : y.year - 1;
  const isFuture = (m: HomeMonth) => which === "cur" && m.month > y.this_month;
  const curIdx = which === "cur" ? Math.max(0, data.findIndex((m) => m.month === y.this_month)) : 11;
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => setPick(null), [which]);
  const sel = pick ?? curIdx;
  const done = data.filter((m) => !isFuture(m) && m.sale > 0);
  const avg = done.length ? done.reduce((a, m) => a + m.sale, 0) / done.length : 0;
  const total = data.filter((m) => !isFuture(m)).reduce((a, m) => a + m.sale, 0);
  const max = niceMax(Math.max(...data.map((m) => m.sale), avg, 1));
  const m = data[sel];
  const before = which === "cur" ? y.previous[sel] : null;
  const yoy = before && before.sale > 0 && !isFuture(m) ? ((m.sale - before.sale) / before.sale) * 100 : null;
  const plotRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // Подсказка — над столбиком, но всегда внутри графика (на телефоне не вылезает за край).
  const [tipX, setTipX] = useState<number | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const plot = plotRef.current;
      const tip = tipRef.current;
      if (!plot || !tip) return;
      const pl = parseFloat(getComputedStyle(plot).paddingLeft) || 0;
      const w = plot.clientWidth;
      const center = pl + ((w - pl) * (sel + 0.5)) / 12;
      const tw = tip.offsetWidth;
      setTipX(Math.max(0, Math.min(w - tw, center - tw / 2)));
    };
    place();
    const ro = new ResizeObserver(place);
    if (plotRef.current) ro.observe(plotRef.current);
    return () => ro.disconnect();
  }, [sel, which, data]);

  return (
    <section className="ov-card paper ov-chart-card">
      <header className="ov-card-head">
        <h2 className="ov-card-title">
          Сумма заказов <Info text="Сумма заказов по месяцам — по дате заказа. Будущие месяцы — пустые." />
        </h2>
        <span className="ov-chart-sum">
          {som(Math.round(total))} за {yearNo} год
        </span>
        <span style={css("margin-left:auto")}>
          <Seg
            small
            items={[
              { key: "prev", label: String(y.year - 1) },
              { key: "cur", label: String(y.year) },
            ]}
            value={which}
            onChange={setWhich}
          />
        </span>
      </header>
      <div className="ov-plot" ref={plotRef}>
        <div className="ov-grid" aria-hidden>
          {[1, 0.75, 0.5, 0.25, 0].map((k) => (
            <div key={k} className="ov-gl" style={{ bottom: `${k * 100}%` }}>
              <span>{short(max * k)}</span>
              <i />
            </div>
          ))}
        </div>
        {avg > 0 && (
          <div className="ov-avg" style={{ bottom: `calc(26px + (100% - 26px) * ${avg / max})`, opacity: on ? 1 : 0 }} aria-hidden>
            <span>ср. {short(avg)}</span>
          </div>
        )}
        <div className="ov-cols" onMouseLeave={() => setPick(null)}>
          {data.map((mm, i) => {
            const fut = isFuture(mm);
            const h = fut ? (avg / max) * 100 : (mm.sale / max) * 100;
            const active = i === sel;
            return (
              <button
                key={mm.month}
                type="button"
                className={"ov-col" + (active ? " on" : "") + (fut ? " fc" : "") + (which === "cur" && mm.month === y.this_month ? " now" : "")}
                onMouseEnter={() => setPick(i)}
                onFocus={() => setPick(i)}
                onClick={() => setPick(i)}
                aria-label={`${MONTHS_FULL[i]} ${yearNo}: ${fut ? "ещё не наступил" : som(Math.round(mm.sale))}`}
              >
                <span className="ov-col-track">
                  <span className="ov-col-fill" style={{ height: on ? `${Math.max(mm.sale > 0 || fut ? 4 : 0, h)}%` : "0%", transitionDelay: `${i * 40}ms` }}>
                    {active && !fut && mm.sale > 0 && <span className="ov-col-cap" />}
                  </span>
                </span>
                <span className="ov-col-x">{MONTHS[i]}</span>
              </button>
            );
          })}
        </div>
        {m && (
          <div ref={tipRef} className="ov-tip" style={{ left: tipX ?? 0, opacity: tipX === null ? 0 : 1, bottom: `calc(26px + (100% - 26px) * ${Math.min(0.9, (isFuture(m) ? avg / max : m.sale / max) + 0.05)})` }} aria-hidden>
            <p className="ov-tip-h">
              {MONTHS[sel]} {yearNo}
            </p>
            {isFuture(m) ? (
              <p className="ov-tip-empty">месяц ещё не наступил</p>
            ) : (
              <dl>
                <div>
                  <dt>Сумма заказов</dt>
                  <dd>{som(Math.round(m.sale))}</dd>
                </div>
                <div>
                  <dt>Заказов</dt>
                  <dd>{m.orders}</dd>
                </div>
                <div>
                  <dt>Прибыль</dt>
                  <dd>{som(Math.round(m.profit))}</dd>
                </div>
                {yoy !== null && (
                  <div>
                    <dt>к прошлому году</dt>
                    <dd className={yoy >= 0 ? "up" : "down"}>
                      {yoy >= 0 ? "+" : "−"}
                      {pctText(yoy)}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// --- работа склада по времени ---------------------------------------------------------------------

function Heat({ h, on }: { h: HomeBoard["heat"]; on: boolean }) {
  const [tip, setTip] = useState<{ r: number; c: number; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const vals = h.cells.flat().map((x) => x.arrived + x.issued);
  const max = Math.max(...vals, 0);
  const level = (v: number) => (v <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((v / max) * 4))));
  const t = tip ? h.cells[tip.r][tip.c] : null;
  return (
    <section className="ov-card paper ov-heat-card" ref={boxRef}>
      <header className="ov-card-head">
        <h2 className="ov-card-title">
          Работа склада по времени <Info text="Сколько товаров приняли и выдали — по дням недели и часам, за последние 4 недели." />
        </h2>
        <div className="ov-scale" aria-hidden>
          <span>0</span>
          {[0, 1, 2, 3, 4].map((k) => (
            <i key={k} style={{ background: `var(--ov-heat-${k})` }} />
          ))}
          <span>{max > 0 ? `${max}` : "—"}</span>
        </div>
      </header>
      <div className="ov-heat" onMouseLeave={() => setTip(null)}>
        <span />
        {DAYS.map((d) => (
          <span key={d} className="ov-heat-d">
            {d}
          </span>
        ))}
        {h.cells.map((row, r) => (
          <HeatRow key={r} r={r} row={row} level={level} on={on} onTip={(c, el) => {
            const box = boxRef.current?.getBoundingClientRect();
            const b = el.getBoundingClientRect();
            if (box) setTip({ r, c, x: b.left - box.left + b.width / 2, y: b.top - box.top });
          }} />
        ))}
      </div>
      {tip && t && (
        <div className="ov-htip" style={{ left: tip.x, top: tip.y }}>
          <b>
            {t.arrived + t.issued ? `${t.arrived} принято · ${t.issued} выдано` : "тишина — ничего не было"}
          </b>
          <span>
            {DAYS[tip.c]}, {SLOTS[tip.r].long}
          </span>
        </div>
      )}
    </section>
  );
}

function HeatRow({ r, row, level, on, onTip }: { r: number; row: { arrived: number; issued: number }[]; level: (v: number) => number; on: boolean; onTip: (c: number, el: HTMLElement) => void }) {
  return (
    <>
      <span className="ov-heat-p">
        <span className="long">{SLOTS[r].long}</span>
        <span className="short">{SLOTS[r].short}</span>
      </span>
      {row.map((x, c) => (
        <span
          key={c}
          className="ov-cell"
          tabIndex={0}
          onMouseEnter={(e) => onTip(c, e.currentTarget)}
          onFocus={(e) => onTip(c, e.currentTarget)}
          style={{ background: `var(--ov-heat-${level(x.arrived + x.issued)})`, transform: on ? "none" : "scale(.6)", opacity: on ? 1 : 0, transitionDelay: `${(r * 7 + c) * 14}ms` }}
        />
      ))}
    </>
  );
}

// --- товары по этапам (кольцо) --------------------------------------------------------------------

function Donut({ s, on }: { s: HomeBoard["stages"]; on: boolean }) {
  const segs = [
    { k: "issued", label: "Выданы", v: s.issued, c: "var(--ov-c1)" },
    { k: "in_stock", label: "На складе", v: s.in_stock, c: "var(--ov-c3)" },
    { k: "in_transit", label: "В пути", v: s.in_transit, c: "var(--ov-c4)" },
    { k: "ordered", label: "Заказаны", v: s.ordered, c: "var(--ov-c2)" },
  ];
  const total = Math.max(1, s.total);
  const biggest = segs.reduce((a, b) => (b.v > a.v ? b : a), segs[0]);
  const [hover, setHover] = useState<string | null>(null);
  const act = segs.find((x) => x.k === hover) ?? biggest;
  const GAP = s.total > 0 && segs.filter((x) => x.v > 0).length > 1 ? 1.2 : 0;
  // Волна по очереди — только при открытии; при смене периода сегменты едут все вместе.
  const first = useRef(true);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => (first.current = false), 1200);
    return () => clearTimeout(t);
  }, [on]);
  let start = 0;
  return (
    <section className="ov-card paper ov-donut-card">
      <h2 className="ov-card-title">
        Товары за период <Info text="Товары, заказанные за выбранный период, — на каком они этапе сейчас." />
      </h2>
      <div className="ov-donut-body">
        <div className="ov-donut-txt">
          <p className="ov-big">
            <CountUp text={String(s.total)} />
          </p>
          <p className="ov-kpi-meta">
            <span className="ov-kpi-vs">к прошлому периоду</span>
            <Delta v={s.delta} />
          </p>
          <ul className="ov-legend">
            {segs.map((x) => (
              <li key={x.k}>
                <button type="button" onMouseEnter={() => setHover(x.k)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(x.k)} onBlur={() => setHover(null)} className={hover && hover !== x.k ? "dim" : ""}>
                  <i style={{ background: x.c }} />
                  <span>{x.label}</span>
                  <b>
                    <CountUp text={String(x.v)} />
                  </b>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="ov-donut">
          <svg viewBox="0 0 160 160" role="img" aria-label="Товары по этапам">
            <circle className="ov-donut-track" cx="80" cy="80" r="62" />
            {segs.map((x, i) => {
              const len = (x.v / total) * 100;
              const from = start;
              start += len;
              const shown = x.v > 0 ? Math.max(0, len - GAP) : 0;
              return (
                <circle
                  key={x.k}
                  className={"ov-seg-c" + (hover && hover !== x.k ? " dim" : "")}
                  cx="80"
                  cy="80"
                  r="62"
                  pathLength={100}
                  style={{
                    stroke: x.c,
                    strokeDasharray: `${on ? shown : 0} 100`,
                    strokeDashoffset: -from,
                    transitionDelay: first.current ? `${i * 120}ms` : "0ms",
                  }}
                />
              );
            })}
          </svg>
          <div className="ov-donut-c">
            <b>
              <CountUp text={`${s.total > 0 ? Math.round((act.v / total) * 100) : 0}%`} duration={600} />
            </b>
            <small key={act.label} className="ov-fade">
              {act.label}
            </small>
          </div>
        </div>
      </div>
    </section>
  );
}

// --- «Требует внимания»: что сделать сейчас, одним длинным блоком ---------------------------------

function Ico({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

type Task = {
  key: string;
  label: string;
  icon: string;
  n: number;
  unit: string;
  sub: string;
  done: string;
  to: string;
  urgent?: boolean;
  /** Доля для полоски внизу, 0–1; нет — без полоски. */
  bar?: number;
  barLabel?: string;
};

function AttentionCard({ t, on }: { t: HomeBoard["todo"]; on: boolean }) {
  const nav = useNavigate();
  const tov = (n: number) => plural(n, "товар", "товара", "товаров");
  const tasks: Task[] = [
    {
      key: "notify",
      label: "Уведомить",
      icon: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20h4",
      n: t.notify.customers,
      unit: plural(t.notify.customers, "клиент", "клиента", "клиентов"),
      sub: `${t.notify.items} ${tov(t.notify.items)} ждут сообщения`,
      done: "все клиенты знают",
      to: "/notify",
      urgent: true,
    },
    {
      key: "ready",
      label: "К выдаче",
      icon: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
      n: t.ready.items,
      unit: tov(t.ready.items),
      sub: `оплачены · ${t.ready.customers} ${plural(t.ready.customers, "клиент", "клиента", "клиентов")}`,
      done: "оплаченных на складе нет",
      to: "/issue",
      bar: t.ready.total ? t.ready.items / t.ready.total : undefined,
      barLabel: t.ready.total ? `${t.ready.items} из ${t.ready.total} на складе` : undefined,
    },
    {
      key: "stale",
      label: "Залежались",
      icon: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
      n: t.stale.items,
      unit: tov(t.stale.items),
      sub: `дольше ${t.stale.days} дн · до ${t.stale.oldest_days} дн`,
      done: `всё забирают за ${t.stale.days} дн`,
      to: "/warehouse",
      urgent: true,
    },
    {
      key: "no_code",
      label: "Без кода",
      icon: "M4 6v12M8 6v12M12 6v12M16 6v12M20 6v12",
      n: t.no_code.items,
      unit: tov(t.no_code.items),
      sub: "сканер их не найдёт",
      done: "у всех товаров есть код",
      to: "/orders?status=no_code",
      urgent: true,
    },
    {
      key: "no_batch",
      label: "Без партии",
      icon: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
      n: t.no_batch.items,
      unit: tov(t.no_batch.items),
      sub: "вес и доставка не учтены",
      done: "все товары в партиях",
      to: "/batches",
    },
    {
      key: "no_cost",
      label: "Без выкупа",
      icon: "M12 2v20M17 6.5c0-1.9-2.2-3.5-5-3.5S7 4.6 7 6.5 9.2 10 12 10s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5",
      n: t.no_cost.items,
      unit: tov(t.no_cost.items),
      sub: "прибыль не считается",
      done: "выкуп указан везде",
      to: "/orders",
      bar: t.no_cost.total ? (t.no_cost.total - t.no_cost.items) / t.no_cost.total : undefined,
      barLabel: t.no_cost.total ? `выкуп указан у ${Math.round(((t.no_cost.total - t.no_cost.items) / t.no_cost.total) * 100)}%` : undefined,
    },
  ];
  const open = tasks.filter((x) => x.n > 0).length;
  return (
    <section className="ov-card ov-att">
      <header className="ov-att-head">
        <h2 className="ov-card-title">
          Требует внимания <Info text="Что сделать сейчас: кого уведомить, что выдать, что лежит долго и где не хватает данных. Нажмите на плитку — откроется нужный список." />
        </h2>
        <span className="ov-att-sub">сейчас, без учёта периода</span>
        <span className={"ov-att-status" + (open ? "" : " ok")}>
          <i aria-hidden />
          {open ? `${open} ${plural(open, "задача", "задачи", "задач")}` : "всё в порядке"}
        </span>
      </header>
      <div className="ov-att-grid">
        {tasks.map((x, i) => {
          const ok = x.n === 0;
          return (
            <button
              key={x.key}
              type="button"
              className={"ov-task" + (ok ? " ok" : x.urgent ? " hot" : "")}
              style={{ animationDelay: `${760 + i * 70}ms` }}
              onClick={() => nav(x.to)}
            >
              <span className="ov-task-top">
                <span className="ov-task-i">{ok ? <Ico d="M5 12.5l4.5 4.5L19 7.5" size={16} /> : <Ico d={x.icon} size={16} />}</span>
                <span className="ov-task-l">{x.label}</span>
                {!ok && x.urgent && <span className="ov-task-dot" aria-hidden />}
                <span className="ov-task-go" aria-hidden>
                  <Arrow />
                </span>
              </span>
              <span className="ov-task-n">
                <b>{ok ? "0" : <CountUp text={String(x.n)} />}</b>
                <small>{ok ? "" : x.unit}</small>
              </span>
              <span className="ov-task-s" title={ok ? x.done : x.sub}>
                {ok ? x.done : x.sub}
              </span>
              {x.bar !== undefined && (
                <span className="ov-task-bar" title={x.barLabel}>
                  <i style={{ width: on ? `${Math.round(x.bar * 100)}%` : 0, transitionDelay: `${700 + i * 70}ms` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// --- всё вместе ----------------------------------------------------------------------------------

export function HomeBoardView({ h }: { h: HomeBoard }) {
  const on = useOn();
  const ring = h.arrived.value ? Math.round((h.arrived.issued / h.arrived.value) * 100) : 0;
  // Подпись к изменению: в узкой карточке — короче (см. .ov-kpi в стилях).
  const vs = (
    <>
      <span className="ov-vs-long">к прошлому периоду</span>
      <span className="ov-vs-short">к прошлому</span>
    </>
  );
  const kpis = useMemo(
    () => [
      {
        tone: "ink" as const,
        label: "Сумма заказов",
        info: "Сколько заказали клиенты за период — по дате заказа.",
        value: som(Math.round(h.sales.value)),
        delta: h.sales.delta,
        meta: vs,
        mini: <MiniBars values={h.sales.bars} on={on} />,
        link: "Заказы",
        to: "/orders",
      },
      {
        tone: "paper" as const,
        label: "Прибыль",
        info: "Наценка на товары + вес при выдаче + вес в партиях − выкуп веса − доставка.",
        value: som(Math.round(h.profit.value)),
        delta: h.profit.delta,
        meta: vs,
        mini: <Spark values={h.profit.spark} on={on} />,
        link: "Финансы",
        to: "/finance",
      },
      {
        tone: "stone" as const,
        label: "Принято на склад",
        info: "Сколько товаров пришло на склад за период; кольцо — сколько из них уже выдано.",
        value: `${h.arrived.value} тов.`,
        delta: h.arrived.delta,
        meta: vs,
        mini: <Ring pct={ring} on={on} />,
        link: "Склад",
        to: "/warehouse",
      },
      {
        tone: "stone2" as const,
        label: "Долг клиентов",
        info: "Сколько клиенты должны сейчас — по всем невыданным товарам. Столбики — долг по неделям заказа.",
        value: som(Math.round(h.debt.value)),
        delta: null,
        meta: h.debt.customers ? `у ${h.debt.customers} ${plural(h.debt.customers, "клиента", "клиентов", "клиентов")}` : "долгов нет",
        mini: <Eq values={h.debt.weeks} on={on} />,
        link: "Должники",
        to: "/finance",
      },
    ],
    [h, on, ring]
  );
  return (
    <div className="ov-board">
      <section className="ov-kpis" aria-label="Главные цифры">
        {kpis.map((k) => (
          <Kpi key={k.label} {...k} />
        ))}
      </section>
      <div className="ov-row2">
        <Gauge g={h.gauge} on={on} />
        <MonthChart y={h.year} on={on} />
      </div>
      <div className="ov-row3">
        <Heat h={h.heat} on={on} />
        <Donut s={h.stages} on={on} />
      </div>
      {/* старый сервер (обновление прода) — без нижнего блока */}
      {h.todo ? <AttentionCard t={h.todo} on={on} /> : null}
    </div>
  );
}

/** Скелетон верха, пока данные грузятся — те же формы, без цифр. */
export function HomeSkeleton() {
  return (
    <div className="ov-board">
      <section className="ov-kpis">
        {["ink", "paper", "stone", "stone2"].map((t) => (
          <article key={t} className={"ov-kpi " + t}>
            <span className="sk" style={css("width:46%;height:11px;opacity:.6")} />
            <span className="sk" style={css("width:62%;height:24px;margin-top:16px;opacity:.6")} />
            <span className="sk" style={css("width:40%;height:10px;margin-top:12px;opacity:.6")} />
          </article>
        ))}
      </section>
      <div className="ov-row2">
        <section className="ov-card ink" style={css("min-height:330px")} />
        <section className="ov-card paper" style={css("min-height:330px")} />
      </div>
    </div>
  );
}

/** Экспорт главных цифр — CSV для Excel (разделитель «;», BOM — чтобы кириллица открылась). */
export function exportHome(h: HomeBoard, from: string, to: string) {
  const rows: (string | number)[][] = [
    ["Период", `${from} — ${to}`],
    ["Сумма заказов", Math.round(h.sales.value)],
    ["Прибыль", Math.round(h.profit.value)],
    ["Принято на склад, товаров", h.arrived.value],
    ["Из них выдано", h.arrived.issued],
    ["Долг клиентов сейчас", Math.round(h.debt.value)],
    ["Оплачено, % суммы заказов", h.gauge.score ?? ""],
    ["Ждут выдачи", h.waiting],
    [],
    ["Месяц", "Сумма заказов", "Заказов", "Товаров", "Прибыль"],
    ...[...h.year.previous, ...h.year.current].map((m) => [m.month, Math.round(m.sale), m.orders, m.items, Math.round(m.profit)]),
  ];
  const csv = "﻿" + rows.map((r) => r.map((x) => (typeof x === "string" && /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `jetcargo-obzor-${to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

