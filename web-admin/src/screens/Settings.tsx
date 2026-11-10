/**
 * Настройки — во всю ширину:
 *  - сверху карточка профиля: кто вошёл, роль, на какой базе работает панель, «Выйти»;
 *  - слева «Оформление»: тема (светлая / тёмная — живые мини-превью) и масштаб интерфейса плитками;
 *  - справа курс юаня с быстрым пересчётом (меняет только администратор);
 *  - вес при выдаче: цена за кг в $ и курс доллара (меняет администратор);
 *  - звуки приёма: у каждого события скана свои 15 звуков, громкость, вкл/выкл (в этом браузере);
 *  - ниже — быстрые клавиши.
 * Тема и масштаб сохраняются в localStorage и применяются сразу (см. design/prefs).
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { apiError } from "../api/client";
import { getEnvironment, getSettings, updateSettings } from "../api/domain";
import { useAuth } from "../auth/AuthContext";

import { ICONS, I_CHECK, Icon, Svg } from "../design/icons";
import { SCALES, usePrefs, type Theme } from "../design/prefs";
import { SCAN_EVENTS, SOUND_SETS, isDefaultSounds, previewSound, resetSoundPrefs, setSoundPrefs, soundLabel, useSoundPrefs, type Note, type ScanEvent } from "../lib/sound";
import { Page } from "../design/table";

type Toast = (kind: "success" | "error", text: string) => void;


export default function Settings({ toast }: { toast: Toast }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <Page size="wide">
      <div className="ov s2">
        <div className="s2-grid">
          <Profile />
          <Appearance />
          <RatesCard toast={toast} canEdit={isAdmin} />
        </div>
        <SoundsCard />
        <Hotkeys />
      </div>
    </Page>
  );
}

// --- Профиль ------------------------------------------------------------------------------------

function Profile() {
  const { user, logout } = useAuth();
  const [env, setEnv] = useState<"test" | "prod" | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    getEnvironment()
      .then(setEnv)
      .catch(() => setEnv(null));
  }, []);
  if (!user) return null;
  const name = user.full_name || user.login;
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  const admin = user.role === "admin";
  const h = now.getHours();
  const hello = h >= 5 && h < 12 ? "Доброе утро" : h >= 12 && h < 18 ? "Добрый день" : h >= 18 && h < 23 ? "Добрый вечер" : "Доброй ночи";
  const day = now.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" });
  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return (
    <section className="ov-card s2-me">
      <span className="s2-me-cover" aria-hidden />
      <div className="s2-me-body">
        <div className="s2-me-top">
          <span className="s2-me-av">
            {initials}
            <i />
          </span>
          <em className={"s2-me-role" + (admin ? " adm" : "")}>{admin ? "Администратор" : "Сотрудник"}</em>
        </div>
        <div className="s2-me-name">
          <b>{name}</b>
          <small>
            {hello} · {day.charAt(0).toUpperCase() + day.slice(1)}, {time}
          </small>
        </div>
        <div className="s2-me-rows">
          <span>
            <i>
              <Svg paths={[["circle", { cx: 12, cy: 8, r: 4 }], ["path", { d: "M4.5 20.5a7.5 7.5 0 0 1 15 0" }]]} size={14} sw={2} />
            </i>
            <small>Логин</small>
            <b className="m">{user.login}</b>
          </span>
          <span title={admin ? "Все разделы и настройки" : "Курс юаня и тариф меняет администратор"}>
            <i>
              <Svg paths={[["path", { d: "M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z" }], ["path", { d: "m9 12 2 2 4-4" }]]} size={14} sw={2} />
            </i>
            <small>Доступ</small>
            <b>{admin ? "полный" : "частичный"}</b>
          </span>
          <span title={env === "test" ? "Локальная панель на тестовой базе" : env === "prod" ? "Рабочая база" : undefined}>
            <i>
              <Svg paths={[["ellipse", { cx: 12, cy: 6, rx: 7, ry: 3 }], ["path", { d: "M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" }], ["path", { d: "M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" }]]} size={14} sw={2} />
            </i>
            <small>База</small>
            <b>
              <i className={"s2-me-db " + (env ?? "")} />
              {env === "test" ? "Тестовая" : env === "prod" ? "Рабочая" : "—"}
            </b>
          </span>
        </div>
        <button type="button" className="s2-out" onClick={logout}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="m16 17 5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
          Выйти из панели
        </button>
      </div>
    </section>
  );
}

// --- Оформление ---------------------------------------------------------------------------------

function Appearance() {
  const { theme, scale, setTheme, setScale } = usePrefs();
  const SCALE_HINT = ["компактно", "обычно", "крупнее", "у стеллажа"];
  return (
    <section className="ov-card s2-card">
      <CardHead icon={<Svg paths={ICONS.sun} size={15} />} title="Оформление" hint="В этом браузере · применяется сразу" />
      <div className="s2-lbl">Тема</div>
      <div className="s2-themes">
        {(["light", "dark"] as Theme[]).map((t) => {
          const on = theme === t;
          return (
            <button key={t} type="button" onClick={() => setTheme(t)} className={"s2-theme " + t + (on ? " on" : "")} aria-pressed={on}>
              <span className="s2-th-pv" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="s2-th-t">
                <b>{t === "light" ? "Светлая" : "Тёмная"}</b>
                <small>{t === "light" ? "днём" : "вечером"}</small>
              </span>
              <span className="s2-ck">{on && <Svg paths={I_CHECK} size={10} sw={3.2} />}</span>
            </button>
          );
        })}
      </div>
      <div className="s2-lbl">Масштаб</div>
      <div className="s2-scales">
        {SCALES.map((v, i) => {
          const on = Math.abs(scale - v) < 0.001;
          return (
            <button key={v} type="button" onClick={() => setScale(v)} className={"s2-scale" + (on ? " on" : "")} aria-pressed={on} title={SCALE_HINT[i] ?? ""}>
              <b style={{ fontSize: Math.round(12 * v) + 1 }}>Аа</b>
              <small>{Math.round(v * 100)}%</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CardHead({ icon, title, hint, right }: { icon: ReactNode; title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="s2-h">
      <span className="s2-h-ic">{icon}</span>
      <span className="s2-h-t">
        <b>{title}</b>
        {hint && <small>{hint}</small>}
      </span>
      {right}
    </div>
  );
}

// --- Звуки приёма -------------------------------------------------------------------------------

const EV_ICON: Record<ScanEvent, ReactNode> = {
  arrived: <Svg paths={I_CHECK} size={13} sw={2.6} />,
  repeat: <span className="s2-ev-g">↻</span>,
  issued: <Icon name="issue" size={13} />,
  not_found: <span className="s2-ev-g">!</span>,
};

function Bars({ notes }: { notes: Note[] }) {
  if (!notes.length)
    return (
      <svg className="s2-mute" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
        <path d="m16 9 5 6M21 9l-5 6" />
      </svg>
    );
  const N = 7;
  const end = Math.max(...notes.map((m) => m.at + m.len), 0.3);
  const fr = notes.flatMap((m) => (m.to ? [m.freq, m.to] : [m.freq]));
  const lo = Math.log(Math.min(...fr));
  const hi = Math.log(Math.max(...fr));
  const pitch = (x: number) => (hi - lo < 0.01 ? 0.6 : (Math.log(x) - lo) / (hi - lo));
  return (
    <span className="s2-bars" aria-hidden>
      {Array.from({ length: N }, (_, k) => {
        const t = ((k + 0.5) / N) * end;
        const m = notes.filter((n) => t >= n.at && t <= n.at + n.len).pop();
        const p = m ? Math.min(1, (t - m.at) / Math.max(0.01, m.len)) : 0;
        const fq = m ? (m.to ? m.freq + (m.to - m.freq) * p : m.freq) : 0;
        // высота: тон внутри мелодии + затухание ноты — получается живой «рисунок» звука
        const h = m ? 18 + (32 + pitch(fq) * 50) * (1 - 0.5 * p) : 14;
        return <i key={k} style={{ height: `${Math.round(h)}%`, ["--k" as string]: k }} className={m ? undefined : "z"} />;
      })}
    </span>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
      <path d="M3 1.8v8.4L10 6 3 1.8Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Звуки «Приёма товара»: у каждого события скана — свой набор из 15 звуков по смыслу,
 * громкость и вкл/выкл. Хранится в этом браузере: звук нужен на компьютере со сканером (lib/sound).
 */
function SoundsCard() {
  const p = useSoundPrefs();
  const [ev, setEv] = useState<ScanEvent>("arrived");
  const [playing, setPlaying] = useState<ScanEvent | null>(null);
  const [tilePlay, setTilePlay] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const tileTimer = useRef(0);
  function play(id: string, e: ScanEvent = ev) {
    previewSound(e, id);
    setTilePlay(id);
    window.clearTimeout(tileTimer.current);
    tileTimer.current = window.setTimeout(() => setTilePlay(null), 900);
  }
  const set = SOUND_SETS[ev];
  const evInfo = SCAN_EVENTS.find((e) => e.key === ev)!;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Все четыре звука подряд — как будет звучать приём.
  function playAll() {
    timers.current.forEach(clearTimeout);
    timers.current = SCAN_EVENTS.map((e, i) =>
      window.setTimeout(() => {
        setPlaying(e.key);
        previewSound(e.key, p.map[e.key]);
      }, i * 900)
    );
    timers.current.push(window.setTimeout(() => setPlaying(null), SCAN_EVENTS.length * 900));
  }

  return (
    <section className="ov-card s2-card s2-snd">
      <CardHead
        icon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5Z" />
            <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
          </svg>
        }
        title="Звуки приёма"
        hint="При скане на «Приёме товара» · на этом устройстве"
        right={
          <span className="s2-snd-ctl">
            <button type="button" className={"s2-all" + (playing ? " on" : "")} onClick={playAll} disabled={!p.on}>
              <PlayIcon />
              {playing ? "Звучит…" : "Прослушать все"}
            </button>
            <label className="s2-vol">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={p.volume}
                disabled={!p.on}
                onChange={(e) => setSoundPrefs({ volume: Number(e.target.value) })}
                onPointerUp={() => previewSound(ev, p.map[ev])}
                onKeyUp={() => previewSound(ev, p.map[ev])}
                style={{ ["--v" as string]: `${p.volume}%` }}
                aria-label="Громкость"
              />
              <span>{p.volume}%</span>
            </label>
            <button type="button" className={"s2-sw" + (p.on ? " on" : "")} onClick={() => setSoundPrefs({ on: !p.on })} role="switch" aria-checked={p.on} title={p.on ? "Выключить звук приёма" : "Включить звук приёма"}>
              <i />
            </button>
          </span>
        }
      />

      <div className={"s2-snd-body" + (p.on ? "" : " off")}>
        <div className="s2-evs" role="tablist" aria-label="Событие скана">
          {SCAN_EVENTS.map((e) => (
            <div
              key={e.key}
              role="tab"
              tabIndex={0}
              aria-selected={e.key === ev}
              title={e.hint}
              className={"s2-ev" + (e.key === ev ? " on" : "") + (playing === e.key ? " playing" : "")}
              onClick={() => setEv(e.key)}
              onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), setEv(e.key))}
            >
              <span className="s2-ev-i">{EV_ICON[e.key]}</span>
              <span className="s2-ev-t">
                <b>{e.label}</b>
                <small>♪ {soundLabel(e.key, p.map[e.key])}</small>
              </span>
              <button
                type="button"
                className="s2-play"
                title="Прослушать"
                aria-label={`Прослушать звук «${e.label}»`}
                onClick={(m) => {
                  m.stopPropagation();
                  previewSound(e.key, p.map[e.key]);
                }}
              >
                <PlayIcon />
              </button>
            </div>
          ))}
        </div>

        <div className="s2-snd-pick">
          <span className="s2-snd-cap">
            <span>
              Звук для «{evInfo.label}» <em>{evInfo.hint}</em>
            </span>
            {!isDefaultSounds(p) && (
              <button type="button" className="s2-reset" onClick={resetSoundPrefs} title="Вернуть звуки по умолчанию для всех событий">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                По умолчанию
              </button>
            )}
          </span>
          <div className="s2-tiles" key={ev}>
            {set.map((x, i) => {
              const on = x.id === p.map[ev];
              return (
                <button
                  key={x.id}
                  type="button"
                  title={x.hint}
                  className={"s2-tile" + (on ? " on" : "") + (tilePlay === x.id ? " play" : "")}
                  style={{ ["--i" as string]: i }}
                  onClick={() => {
                    setSoundPrefs({ map: { [ev]: x.id } as Record<ScanEvent, string> });
                    play(x.id);
                  }}
                  aria-pressed={on}
                >
                  <span className="s2-tile-w">
                    <Bars notes={x.notes} />
                  </span>
                  <b>{x.label}</b>
                  <span className="s2-tile-ck" aria-hidden>
                    {on && <Svg paths={I_CHECK} size={9} sw={3.4} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// --- Курсы и тарифы ---------------------------------------------------------------------------

/**
 * Курс юаня (подсказка ¥ при добавлении товара) и тариф за вес ($ за кг × курс доллара — сумма на «Выдаче»)
 * в одной карточке: три поля, одна кнопка «Сохранить», ниже пересчёт — юани или вес (переключатель).
 * Меняет только администратор; уже сделанные выдачи не пересчитываются (тариф хранится в выдаче).
 */
function RatesCard({ toast, canEdit }: { toast: Toast; canEdit: boolean }) {
  const [rate, setRate] = useState("");
  const [perKg, setPerKg] = useState("");
  const [usd, setUsd] = useState("");
  const [saved, setSaved] = useState<{ cny: number; kg: number; usd: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // быстрый расчёт вместо таблиц: сумма в юанях или вес → сколько сом
  const [calc, setCalc] = useState<"cny" | "kg">("cny");
  const [amtCny, setAmtCny] = useState("100");
  const [amtKg, setAmtKg] = useState("1");

  useEffect(() => {
    getSettings()
      .then((st) => {
        const kg = st.weight_rate_usd ?? 2.8;
        const us = st.usd_rate ?? 87.5;
        setRate(String(st.cny_rate));
        setPerKg(String(kg));
        setUsd(String(us));
        setSaved({ cny: st.cny_rate, kg, usd: us });
      })
      .catch((e) => setError(apiError(e)));
  }, []);

  const num = (v: string) => Number(v.replace(",", ".").replace(/\s/g, ""));
  const c = num(rate);
  const k = num(perKg);
  const u = num(usd);
  const okC = Number.isFinite(c) && c > 0;
  const okW = Number.isFinite(k) && k > 0 && Number.isFinite(u) && u > 0;
  const dirty = saved !== null && (c !== saved.cny || k !== saved.kg || u !== saved.usd);
  // Цена 1 кг для клиента — как на сервере: $ × курс, вверх до целого сома.
  const exactKg = okW ? Math.round(k * u * 100) / 100 : 0;
  const rateSom = okW ? Math.ceil(exactKg - 1e-9) : 0;

  async function save() {
    if (!okC) return setError("Курс юаня должен быть больше нуля");
    if (!okW) return setError("Цена за кг и курс доллара должны быть больше нуля");
    setError("");
    setBusy(true);
    try {
      const st = await updateSettings({ cny_rate: c, weight_rate_usd: k, usd_rate: u });
      setRate(String(st.cny_rate));
      setPerKg(String(st.weight_rate_usd));
      setUsd(String(st.usd_rate));
      setSaved({ cny: st.cny_rate, kg: st.weight_rate_usd, usd: st.usd_rate });
      toast("success", "Курсы сохранены");
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  const input = (value: string, set: (v: string) => void, aria: string) => (
    <input value={value} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canEdit && dirty && save()} inputMode="decimal" disabled={!canEdit} aria-label={aria} />
  );
  const amt = num(calc === "cny" ? amtCny : amtKg);
  const okAmt = Number.isFinite(amt) && amt > 0;
  const result = !okAmt ? null : calc === "cny" ? (okC ? Math.round(amt * c * 100) / 100 : null) : okW ? Math.ceil(Math.round(amt * rateSom * 100) / 100 - 1e-9) : null;

  return (
    <section className="ov-card s2-card s2-rx">
      <CardHead
        icon={<b className="s2-yen">¥</b>}
        title="Курсы и тарифы"
        hint="Юань — при добавлении товара · вес — на «Выдаче»"
        right={
          canEdit ? (
            <button type="button" onClick={save} disabled={!dirty || busy} className={"s2-save" + (dirty ? " on" : "")}>
              {busy ? "…" : dirty ? "Сохранить" : "Сохранено"}
            </button>
          ) : undefined
        }
      />
      <div className="s2-rx-rows">
        <label className="s2-rx-row">
          <span className="s2-rx-b">¥</span>
          <span className="s2-rx-t">
            <b>Юань</b>
            <small>цена товара в юанях</small>
          </span>
          <span className="s2-rx-in">
            <em>¥1 =</em>
            {input(rate, setRate, "Курс юаня, сом")}
            <em>с</em>
          </span>
        </label>
        <label className="s2-rx-row">
          <span className="s2-rx-b">$</span>
          <span className="s2-rx-t">
            <b>Доллар</b>
            <small>для тарифа за вес</small>
          </span>
          <span className="s2-rx-in">
            <em>$1 =</em>
            {input(usd, setUsd, "Курс доллара, сом")}
            <em>с</em>
          </span>
        </label>
        <label className="s2-rx-row" title="Цена за кг и сумма за вес округляются вверх до целого сома. Новый тариф — для следующих уведомлений.">
          <span className="s2-rx-b">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6.5 8h11l2.3 12H4.2L6.5 8Z" />
              <path d="M9 8a3 3 0 0 1 6 0" />
            </svg>
          </span>
          <span className="s2-rx-t">
            <b>Тариф за вес</b>
            <small>{okW ? `клиенту ${rateSom} с за кг` : "укажите цену"}</small>
          </span>
          <span className="s2-rx-in">
            <em>1 кг =</em>
            {input(perKg, setPerKg, "Цена за килограмм, долларов")}
            <em>$</em>
          </span>
        </label>
      </div>
      {error && <div className="s2-err">{error}</div>}
      {!canEdit && <div className="s2-note">Изменить курсы и тариф может только администратор.</div>}
      <div className="s2-rx-calc">
        <span className="s2-rx-calc-l">Посчитать</span>
        <span className="s2-rx-seg" role="tablist" aria-label="Что посчитать">
          <button type="button" role="tab" aria-selected={calc === "cny"} className={calc === "cny" ? "on" : undefined} onClick={() => setCalc("cny")}>
            ¥
          </button>
          <button type="button" role="tab" aria-selected={calc === "kg"} className={calc === "kg" ? "on" : undefined} onClick={() => setCalc("kg")}>
            кг
          </button>
        </span>
        <input
          className="s2-rx-amt"
          value={calc === "cny" ? amtCny : amtKg}
          onChange={(e) => (calc === "cny" ? setAmtCny : setAmtKg)(e.target.value)}
          inputMode="decimal"
          aria-label={calc === "cny" ? "Сумма в юанях" : "Вес, кг"}
        />
        <span className="s2-rx-eq">=</span>
        <b className="s2-rx-res" key={String(result) + calc}>
          {result === null ? "—" : `${result.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} с`}
        </b>
      </div>
    </section>
  );
}

// --- Быстрые клавиши ----------------------------------------------------------------------------

function Hotkeys() {
  const rows: { keys: ReactNode[]; title: string; text: string }[] = [
    { keys: ["Ctrl", "K"], title: "Поиск", text: "клиент, товар или код — из любого раздела" },
    { keys: ["↑", "↓", "Enter"], title: "Выбрать и открыть", text: "стрелками по найденному, Enter — открыть" },
    { keys: ["Esc"], title: "Закрыть", text: "поиск, окно или выпадающий список" },
    {
      keys: [
        <>
          <Icon name="receive" size={12} />
          сканер
        </>,
      ],
      title: "Приём товара",
      text: "просто сканируйте — код примется сам",
    },
  ];
  return (
    <section className="ov-card s2-card s2-keys">
      <CardHead icon={<Icon name="settings" size={14} />} title="Быстрые клавиши" hint="Чтобы работать быстрее с клавиатуры" />
      <div className="s2-keys-g">
        {rows.map((r) => (
          <span key={r.title} className="s2-kt">
            <span className="s2-kt-k">
              {r.keys.map((k, n) => (
                <Fragment key={n}>
                  {n > 0 && r.keys.length === 2 && <i>+</i>}
                  <kbd>{k}</kbd>
                </Fragment>
              ))}
            </span>
            <b>{r.title}</b>
            <small>{r.text}</small>
          </span>
        ))}
      </div>
    </section>
  );
}
