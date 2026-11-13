/**
 * Вход — в монохромном стиле панели. Слева тёмная «витрина» Jetcargo: живое поле точек
 * (реагирует на курсор, по клику — волна), плавающие значки карго с параллаксом, маршрут
 * Китай → Кыргызстан с бегущей посылкой. Справа — карточка входа: поля-плитки, кнопка с бликом.
 * На телефоне витрина сжимается в шапку над формой. Тема — как в панели (светлая / тёмная).
 *
 * Логика прежняя: вход → обновить пользователя → вернуть на страницу, с которой увели на /login.
 * Удобства: предупреждение о Caps Lock, подсказка, если сервер долго просыпается (Render),
 * встряска карточки при ошибке, галочка и плавный переход при успехе.
 * «Уменьшить движение» в системе — всё стоит.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import { APP_NAME } from "../config";
import { apiError, apiStatus } from "../api/client";
import DotField from "../design/DotField";
import { I_EYE, I_EYE_OFF, Svg } from "../design/icons";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const Line = ({ d, size = 18, sw = 1.8 }: { d: string; size?: number; sw?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

// заголовок по строкам и словам — слова «выезжают» по очереди
const TITLE = [
  ["Заказы,", "склад", "и выдача —"],
  ["в одном", "месте"],
];

export default function LoginPage() {
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [done, setDone] = useState(false);
  const [caps, setCaps] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLFormElement>(null);
  const still = useMemo(reducedMotion, []);
  // Куда вернуться после входа: адрес, с которого guard увёл на /login (deep-link), иначе — на дашборд.
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  useEffect(() => {
    const prev = document.title;
    document.title = `Вход · ${APP_NAME}`;
    return () => {
      document.title = prev;
    };
  }, []);

  // Бесплатный сервер может просыпаться до минуты — через 3,5 с ожидания объясняем, что происходит.
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), 3500);
    return () => window.clearTimeout(t);
  }, [busy]);

  function fail(text: string) {
    setError(text);
    // Встряска карточки — анимацией поверх, без перерисовки: фокус и введённое остаются.
    if (!still)
      cardRef.current?.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-8px)" },
          { transform: "translateX(7px)" },
          { transform: "translateX(-5px)" },
          { transform: "translateX(3px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 420, easing: "cubic-bezier(.36,.07,.19,.97)" }
      );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || done) return;
    if (!loginValue.trim() || !password) {
      fail("Введите логин и пароль");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await login(loginValue, password);
      await refresh();
      setDone(true);
      window.setTimeout(() => navigate(from, { replace: true }), still ? 0 : 820);
    } catch (e) {
      // Нет ответа вообще — значит, сервер не запущен или нет связи, а не пароль неверный.
      const status = apiStatus(e);
      if (status === undefined) {
        fail(import.meta.env.DEV ? "Сервер недоступен: запустите backend (в папке server: npm run dev)" : "Сервер не отвечает. Проверьте интернет и попробуйте ещё раз");
      } else if (status === 401) {
        fail("Неверный логин или пароль");
      } else {
        fail(apiError(e, "Не удалось войти"));
      }
    } finally {
      setBusy(false);
    }
  }

  // Параллакс значков витрины за курсором (CSS-переменные, раз в кадр).
  const frame = useRef(0);
  function onMove(e: MouseEvent) {
    if (still) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = rootRef.current;
      if (!el) return;
      el.style.setProperty("--px", ((clientX / window.innerWidth) * 2 - 1).toFixed(3));
      el.style.setProperty("--py", ((clientY / window.innerHeight) * 2 - 1).toFixed(3));
    });
  }

  const onPassKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div ref={rootRef} className="lg" data-done={done || undefined} data-still={still || undefined} onMouseMove={onMove}>
      <style>{STYLE}</style>
      <DotField className="lg-dots" />

      <div className="lg-shell">
        {/* ---------- Витрина ---------- */}
        <aside className="lg-hero" aria-hidden="true">
          <DotField className="lg-hero-dots" alpha={0.17} />
          <span className="lg-hero-glow" />
          <div className="lg-tech">
            <svg className="lg-orbits" viewBox="0 0 600 600">
              <circle cx="300" cy="300" r="140" className="o1" />
              <circle cx="300" cy="300" r="205" className="o2" />
              <circle cx="300" cy="300" r="270" className="o3" />
              <g className="sat s1">
                <circle cx="300" cy="160" r="3.2" />
              </g>
              <g className="sat s2">
                <circle cx="300" cy="95" r="2.6" />
                <circle cx="300" cy="505" r="1.8" />
              </g>
              <g className="sat s3">
                <circle cx="30" cy="300" r="2.2" />
              </g>
              <path d="M300 286v28M286 300h28" className="cross" />
            </svg>
            {[
              [16, 42],
              [58, 30],
              [70, 74],
              [30, 82],
            ].map(([x, y], i) => (
              <span key={i} className="lg-plus" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.9}s` }} />
            ))}
            <span className="lg-coord">
              <i />
              42.87° N · 74.57° E
            </span>
          </div>

          <div className="lg-brand lg-up" style={{ animationDelay: "80ms" }}>
            <span className="lg-mark">
              <svg viewBox="0 0 94 92">
                <path pathLength={1} d="M26 0H94L75 22H8Z" />
                <path pathLength={1} className="b" d="M61 31H74V81Q74 91 64 91H0L8 79H50Q56 79 56 73V36Z" />
              </svg>
            </span>
            <span className="lg-word">
              <b>{APP_NAME}</b>
              <small>Панель сотрудника</small>
            </span>
          </div>

          <div className="lg-pitch">
            <h1 aria-label="Заказы, склад и выдача — в одном месте">
              {TITLE.map((line, li) => (
                <span key={li} className="lg-tl">
                  {line.map((w, wi) => (
                    <Fragment key={wi}>
                      {wi > 0 && " "}
                      <span className="lg-w">
                        <span style={{ animationDelay: `${320 + (li * 3 + wi) * 90}ms` }}>{w}</span>
                      </span>
                    </Fragment>
                  ))}
                </span>
              ))}
            </h1>
            <p className="lg-sub">Приём по сканеру, накладные из Китая, оплаты и уведомления клиентам.</p>
          </div>

          <Clock />
        </aside>

        {/* ---------- Форма ---------- */}
        <main className="lg-main">
          <form ref={cardRef} onSubmit={onSubmit} className="lg-card" noValidate>
            <div className="lg-head lg-up" style={{ animationDelay: "160ms" }}>
              <h2>Вход</h2>
              <p>Введите логин и пароль сотрудника</p>
            </div>

            <label className="lg-tile lg-up" style={{ animationDelay: "240ms" }}>
              <span className="lg-ico">
                <Line d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-7 8-7s8 3 8 7" />
              </span>
              <span className="lg-in">
                <small>Логин</small>
                <input value={loginValue} onChange={(e) => setLoginValue(e.target.value)} autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Ваш логин" />
              </span>
            </label>

            <label className="lg-tile lg-up" style={{ animationDelay: "300ms" }}>
              <span className="lg-ico">
                <Line d="M6.5 10h11a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10zM8 10V7a4 4 0 0 1 8 0v3" />
              </span>
              <span className="lg-in">
                <small>Пароль</small>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onPassKey}
                  onKeyUp={onPassKey}
                  onBlur={() => setCaps(false)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </span>
              <button
                type="button"
                className="lg-eye"
                title={showPassword ? "Скрыть пароль" : "Показать пароль"}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                onClick={() => setShowPassword((v) => !v)}
              >
                <Svg paths={showPassword ? I_EYE_OFF : I_EYE} size={18} sw={1.7} />
              </button>
            </label>
            {caps && (
              <span className="lg-caps">
                <Line d="M12 4 4 12h4v6h8v-6h4z" size={14} sw={2} />
                Включён Caps Lock
              </span>
            )}

            {error && (
              <div className="lg-err" role="alert">
                <Line d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5M12 16.5v.01" size={16} sw={2} />
                {error}
              </div>
            )}

            <div className="lg-btn-wrap lg-up" style={{ animationDelay: "360ms" }}>
              <button type="submit" className="lg-btn" disabled={busy || done}>
                {done ? (
                  <>
                    <svg className="lg-check" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                    Готово
                  </>
                ) : busy ? (
                  <>
                    <span className="lg-spin" />
                    Входим…
                  </>
                ) : (
                  <>
                    Войти
                    <svg className="lg-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </>
                )}
              </button>
              {done && !still && <span className="lg-ring" aria-hidden="true" />}
            </div>

            {slow && !done && <div className="lg-slow">Сервер просыпается — первый вход может занять до минуты</div>}

            <div className="lg-note lg-up" style={{ animationDelay: "420ms" }}>
              <Line d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" size={14} sw={2} />
              Доступ только для сотрудников · соединение защищено
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}

/** Часы: время в Бишкеке и в Китае — пригодится, когда пишешь поставщику. Стрелки идут. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 10000);
    return () => window.clearInterval(t);
  }, []);
  const fmt = (tz: string) => new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(now);
  const day = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", timeZone: "Asia/Bishkek" }).format(now);
  return (
    <div className="lg-clock lg-up" style={{ animationDelay: "380ms" }}>
      <span className="lg-clock-t">
        <b>{fmt("Asia/Bishkek")}</b>
        <small>
          Бишкек · {day} · Китай {fmt("Asia/Shanghai")}
        </small>
      </span>
      <ClockFace />
    </div>
  );
}

/**
 * Циферблат: деления, сужающиеся стрелки с тенью, плавно бегущая секундная. Стрелки при появлении
 * «докручиваются» до текущего времени, дальше идут сами (CSS-вращение), без перерисовок React.
 */
function ClockFace() {
  // положение стрелок на момент открытия; дальше идут сами (CSS). Секундная — щелчками раз в секунду.
  const a = useMemo(() => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23", timeZone: "Asia/Bishkek" })
        .formatToParts(new Date())
        .map((x) => [x.type, x.value])
    );
    const h = Number(p.hour) % 12;
    const m = Number(p.minute);
    const s = Number(p.second);
    const frac = new Date().getMilliseconds() / 1000;
    return { h: h * 30 + m * 0.5 + s / 120, m: m * 6 + s * 0.1, s: s * 6, frac };
  }, []);
  const lag = { animationDelay: `-${a.frac.toFixed(3)}s` };
  return (
    <span className="lg-clock-ic">
      <svg viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="21.4" className="ring" />
        {Array.from({ length: 60 }, (_, i) => (
          <line key={i} x1="24" y1={i % 5 ? 4.6 : 4.2} x2="24" y2={i % 15 === 0 ? 8.6 : i % 5 ? 5.8 : 7.4} className={i % 15 === 0 ? "tk q" : i % 5 ? "tk m" : "tk h"} transform={`rotate(${i * 6} 24 24)`} />
        ))}
        <g transform={`rotate(${a.h} 24 24)`}>
          <g className="intro ih">
            <g className="run rh">
              <line x1="24" y1="26.2" x2="24" y2="14.6" className="hh" />
            </g>
          </g>
        </g>
        <g transform={`rotate(${a.m} 24 24)`}>
          <g className="intro im">
            <g className="run rm">
              <line x1="24" y1="26.6" x2="24" y2="9.4" className="mh" />
            </g>
          </g>
        </g>
        <g transform={`rotate(${a.s} 24 24)`}>
          <g className="intro is">
            <g className="step" style={lag}>
              <g className="tick" style={lag}>
                <line x1="24" y1="29.4" x2="24" y2="7" className="sh" />
                <circle cx="24" cy="29.4" r="1.1" className="sh-tail" />
              </g>
            </g>
          </g>
        </g>
        <circle cx="24" cy="24" r="2.1" className="cap" />
        <circle cx="24" cy="24" r=".85" className="cap-in" />
      </svg>
    </span>
  );
}

/* Стили страницы — здесь, чтобы всё о входе лежало в одном файле. Монохром, тема — как в панели. */
const STYLE = `
.lg{--px:0;--py:0;--ink:#141414;--ink-fg:#fff;--paper:#fff;--bg:#F4F4F2;--text:#141414;--mute:#77766F;--line:rgba(20,20,20,.08);
  position:relative;min-height:100vh;overflow:hidden;background:var(--bg);color:var(--text);isolation:isolate;
  font-family:"Onest","IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
:root[data-theme="dark"] .lg{--ink:#ECECE8;--ink-fg:#141414;--paper:#18181A;--bg:#0E0E10;--text:#ECECE8;--mute:#9B9A95;--line:rgba(255,255,255,.08)}
.lg *{box-sizing:border-box}
html.is-test .lg,html.is-test .lg-shell{min-height:calc(100vh - 26px)}

/* живое поле точек за всей страницей */
.lg-dots{position:absolute;inset:0;z-index:0;color:var(--text);pointer-events:none}
.lg .app-field-cv{position:absolute;left:0;top:0;display:block;pointer-events:none}

.lg-shell{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);min-height:100vh;padding:14px;gap:14px}

/* ---------- витрина ---------- */
.lg-hero{position:relative;isolation:isolate;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;gap:28px;padding:34px 38px;border-radius:30px;
  background:linear-gradient(160deg,color-mix(in srgb,var(--ink) 86%,var(--ink-fg)),var(--ink) 60%);color:var(--ink-fg);
  box-shadow:0 40px 80px -40px rgba(10,10,10,.6),inset 0 1px 0 rgba(255,255,255,.08);animation:lgHeroIn .9s cubic-bezier(.16,1,.3,1) both}
.lg-hero-dots{position:absolute;inset:0;z-index:-1;color:var(--ink-fg)}
.lg-hero-glow{position:absolute;z-index:-1;width:620px;height:620px;right:-220px;top:-240px;border-radius:50%;pointer-events:none;
  background:radial-gradient(closest-side,color-mix(in srgb,var(--ink-fg) 10%,transparent),transparent);animation:lgGlow 12s ease-in-out infinite alternate}
.lg-doodles{position:absolute;inset:0;z-index:-1;pointer-events:none}
.lg-doodles i{position:absolute;display:grid;place-items:center;color:color-mix(in srgb,var(--ink-fg) 16%,transparent);
  transform:translate(calc(var(--px) * var(--dx,14px)),calc(var(--py) * var(--dy,10px)));transition:transform .6s cubic-bezier(.2,.8,.2,1)}
.lg-doodles i svg{animation:lgBob 7s ease-in-out infinite}
.lg-doodles .d1{right:10%;top:20%;--dx:-26px;--dy:-18px}
.lg-doodles .d2{right:30%;top:44%;--dx:20px;--dy:14px}.lg-doodles .d2 svg{animation-delay:-2s;animation-duration:8s}
.lg-doodles .d3{right:8%;bottom:30%;--dx:-16px;--dy:12px}.lg-doodles .d3 svg{animation-delay:-4s;animation-duration:9s}
.lg-doodles .d4{left:52%;top:12%;--dx:12px;--dy:-10px}.lg-doodles .d4 svg{animation-delay:-1s}

.lg-brand{display:flex;align-items:center;gap:12px}
.lg-mark{position:relative;overflow:hidden;display:grid;place-items:center;width:48px;height:48px;border-radius:15px;background:var(--ink-fg);color:var(--ink);box-shadow:0 12px 24px -12px rgba(0,0,0,.7)}
.lg-mark::after{content:"";position:absolute;top:-30%;bottom:-30%;left:-70%;width:45%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.7),transparent);transform:skewX(-18deg);animation:lgShine 5s 2s ease-in-out infinite}
:root[data-theme="dark"] .lg-mark::after{background:linear-gradient(100deg,transparent,rgba(0,0,0,.25),transparent)}
.lg-mark svg{width:26px;height:25px;overflow:visible}
.lg-mark path{fill:currentColor;fill-opacity:0;stroke:currentColor;stroke-width:3.4;stroke-linejoin:round;stroke-dasharray:1 1;stroke-dashoffset:1;animation:lgDraw 1.4s .3s cubic-bezier(.65,0,.35,1) forwards}
.lg-mark .b{animation-delay:.5s}
.lg-word b{display:block;font-size:17px;font-weight:650;letter-spacing:-.015em}
.lg-word small{display:block;margin-top:1px;font-size:12px;color:color-mix(in srgb,var(--ink-fg) 55%,transparent)}

.lg-pitch h1{margin:0;max-width:640px;font-size:clamp(28px,3.2vw,44px);font-weight:600;line-height:1.08;letter-spacing:-.035em}
.lg-pitch p{margin:14px 0 0;max-width:430px;font-size:14.5px;line-height:1.55;color:color-mix(in srgb,var(--ink-fg) 62%,transparent)}

.lg-route{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;max-width:560px;padding:14px 18px;border-radius:20px;
  background:color-mix(in srgb,var(--ink-fg) 6%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink-fg) 10%,transparent);
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.lg-node{display:flex;flex-direction:column;gap:2px;min-width:0}
.lg-node.end{align-items:flex-end;text-align:right}
.lg-node b{font-size:14px;font-weight:600;letter-spacing:-.01em}
.lg-node small{font-size:11.5px;color:color-mix(in srgb,var(--ink-fg) 55%,transparent)}
.lg-path{display:block;width:100%;height:auto;overflow:visible}
.lg-path>path{fill:none;stroke:color-mix(in srgb,var(--ink-fg) 45%,transparent);stroke-width:1.6;stroke-linecap:round;stroke-dasharray:2 7;animation:lgFlow 1.2s linear infinite}
.lg-pkg circle{fill:var(--ink-fg);filter:drop-shadow(0 4px 8px rgba(0,0,0,.35))}
.lg-pkg path{fill:none;stroke:var(--ink);stroke-width:1.3;stroke-linejoin:round}

.lg-chips{display:flex;flex-wrap:wrap;gap:8px}
.lg-chips span{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 13px 0 11px;border-radius:999px;font-size:12.5px;font-weight:500;
  color:color-mix(in srgb,var(--ink-fg) 82%,transparent);background:color-mix(in srgb,var(--ink-fg) 7%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink-fg) 10%,transparent);
  transition:background .25s,color .25s}
.lg-chips span:hover{background:color-mix(in srgb,var(--ink-fg) 13%,transparent);color:var(--ink-fg)}

/* ---------- форма ---------- */
.lg-main{position:relative;display:grid;place-items:center;padding:24px 12px}
.lg-card{position:relative;width:100%;max-width:400px;display:flex;flex-direction:column;gap:10px;padding:34px 30px 22px;border-radius:28px;background:var(--paper);
  box-shadow:0 30px 70px -40px rgba(10,10,10,.45),0 0 0 1px var(--line);animation:lgCardIn .8s cubic-bezier(.16,1,.3,1) .05s both}
.lg-head{margin-bottom:10px}
.lg-head h2{margin:0;font-size:30px;font-weight:650;letter-spacing:-.03em;line-height:1.1}
.lg-head p{margin:7px 0 0;font-size:13.5px;color:var(--mute)}

.lg-tile{position:relative;display:flex;align-items:center;gap:12px;min-height:60px;padding:8px 8px 8px 12px;border-radius:16px;cursor:text;
  background:color-mix(in srgb,var(--text) 4.5%,var(--paper));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--text) 6%,transparent);
  transition:background .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s cubic-bezier(.2,.8,.2,1)}
.lg-tile:hover{background:color-mix(in srgb,var(--text) 6.5%,var(--paper))}
.lg-tile:focus-within{background:var(--paper);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--text) 10%,transparent),0 12px 26px -16px rgba(10,10,10,.4)}
.lg-ico{display:grid;place-items:center;flex:none;width:38px;height:38px;border-radius:12px;background:var(--paper);color:var(--mute);
  box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--text) 8%,transparent);transition:background .3s,color .3s,box-shadow .3s}
.lg-tile:focus-within .lg-ico{background:var(--ink);color:var(--ink-fg);box-shadow:0 8px 16px -8px rgba(10,10,10,.6)}
.lg-in{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lg-in small{font-size:11px;font-weight:500;color:color-mix(in srgb,var(--text) 50%,transparent);transition:color .25s}
.lg-tile:focus-within .lg-in small{color:var(--text)}
.lg-in input{width:100%;height:24px;padding:0;border:0!important;outline:0;background:transparent!important;box-shadow:none!important;
  font:inherit;font-size:15.5px;font-weight:500;letter-spacing:-.01em;color:var(--text);caret-color:var(--ink)}
.lg-in input::placeholder{font-weight:400;color:color-mix(in srgb,var(--text) 28%,transparent)}
.lg-in input:-webkit-autofill{-webkit-text-fill-color:var(--text);transition:background-color 600000s 0s,color 600000s 0s}
.lg-eye{display:grid;place-items:center;flex:none;width:38px;height:38px;border:0;border-radius:11px;background:transparent;color:var(--mute);cursor:pointer;transition:background .2s,color .2s}
.lg-eye:hover{background:color-mix(in srgb,var(--text) 6%,transparent);color:var(--text)}
.lg-caps{display:inline-flex;align-items:center;gap:6px;padding-left:4px;font-size:12px;font-weight:500;color:#9A6A12;animation:lgFade .2s ease}
:root[data-theme="dark"] .lg-caps{color:#E7B65A}
.lg-err{display:flex;align-items:flex-start;gap:9px;padding:11px 13px;border-radius:14px;font-size:13px;line-height:1.45;color:#9C3B2E;
  background:color-mix(in srgb,#9C3B2E 7%,var(--paper));box-shadow:inset 0 0 0 1px color-mix(in srgb,#9C3B2E 22%,transparent);animation:lgFade .2s ease}
:root[data-theme="dark"] .lg-err{color:#F0A196}
.lg-err svg{flex:none;margin-top:1px}

.lg-btn-wrap{position:relative;margin-top:8px}
.lg-btn{position:relative;overflow:hidden;isolation:isolate;width:100%;height:54px;border:0;border-radius:16px;font:inherit;font-size:15.5px;font-weight:600;letter-spacing:-.005em;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:10px;color:var(--ink-fg);background:linear-gradient(160deg,color-mix(in srgb,var(--ink) 80%,var(--ink-fg)),var(--ink) 65%);
  box-shadow:0 16px 30px -16px rgba(10,10,10,.8),inset 0 1px 0 rgba(255,255,255,.14);transition:filter .2s,box-shadow .25s}
.lg-btn::after{content:"";position:absolute;top:0;bottom:0;left:0;width:40%;z-index:-1;background:linear-gradient(100deg,transparent,rgba(255,255,255,.22),transparent);transform:translateX(-120%) skewX(-16deg)}
:root[data-theme="dark"] .lg-btn::after{background:linear-gradient(100deg,transparent,rgba(0,0,0,.14),transparent)}
.lg-btn:hover:not(:disabled)::after{transform:translateX(330%) skewX(-16deg);transition:transform .8s cubic-bezier(.4,0,.2,1)}
.lg-btn:hover:not(:disabled){filter:brightness(1.14);box-shadow:0 20px 34px -16px rgba(10,10,10,.85),inset 0 1px 0 rgba(255,255,255,.18)}
.lg-btn:active:not(:disabled){filter:brightness(.92)}
.lg-btn:disabled{cursor:default}
.lg-arrow{transition:transform .25s cubic-bezier(.3,1.4,.5,1)}
.lg-btn:hover .lg-arrow{transform:translateX(4px)}
.lg-spin{width:18px;height:18px;border-radius:50%;border:2.2px solid color-mix(in srgb,var(--ink-fg) 35%,transparent);border-top-color:var(--ink-fg);animation:lgRot .7s linear infinite}
.lg-check path{stroke-dasharray:24;stroke-dashoffset:24;animation:lgCheck .4s ease forwards}
.lg-ring{position:absolute;inset:0;border-radius:16px;pointer-events:none;box-shadow:0 0 0 0 color-mix(in srgb,var(--ink) 35%,transparent);animation:lgRing .8s cubic-bezier(.2,.8,.2,1) forwards}
.lg-slow{font-size:12.5px;line-height:1.45;color:var(--mute);text-align:center;animation:lgFade .3s ease}
.lg-note{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:10px;padding-top:14px;border-top:1px dashed var(--line);font-size:12px;color:var(--mute)}

/* появление и уход */
.lg-up{animation:lgUp .8s cubic-bezier(.16,1,.3,1) both}
.lg[data-done] .lg-card{animation:lgCardOut .5s .3s cubic-bezier(.4,0,.2,1) forwards}
.lg[data-done] .lg-hero{animation:lgHeroOut .55s .32s cubic-bezier(.4,0,.2,1) forwards}

@keyframes lgUp{from{opacity:0;transform:translateY(14px)}}
@keyframes lgFade{from{opacity:0}}
@keyframes lgHeroIn{from{opacity:0;transform:translateX(-24px) scale(.985)}}
@keyframes lgCardIn{from{opacity:0;transform:translateY(24px)}}
@keyframes lgCardOut{to{opacity:0;transform:translateY(-12px)}}
@keyframes lgHeroOut{to{opacity:0;transform:translateX(-18px)}}
@keyframes lgDraw{0%{stroke-dashoffset:1;fill-opacity:0}65%{stroke-dashoffset:0;fill-opacity:0}100%{stroke-dashoffset:0;fill-opacity:1;stroke-width:0}}
@keyframes lgShine{0%,72%{left:-70%}100%{left:140%}}
@keyframes lgGlow{to{transform:translate(-120px,90px) scale(1.15)}}
@keyframes lgBob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-10px) rotate(-4deg)}}
@keyframes lgFlow{to{stroke-dashoffset:-18}}
@keyframes lgRot{to{transform:rotate(360deg)}}
@keyframes lgCheck{to{stroke-dashoffset:0}}
@keyframes lgRing{to{box-shadow:0 0 0 16px transparent}}

/* адаптив: на узких экранах витрина — шапкой над формой */
@media (max-width:980px){
  .lg-shell{grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr;padding:10px;gap:4px}
  .lg-hero{gap:18px;padding:22px 22px 20px;border-radius:24px}
  .lg-pitch h1{font-size:26px}
  .lg-route,.lg-doodles .d3,.lg-doodles .d4{display:none}
}
@media (max-width:560px){
  .lg-hero{gap:14px;padding:18px}
  .lg-pitch p,.lg-chips{display:none}
  .lg-pitch h1{font-size:22px}
  .lg-mark{width:42px;height:42px;border-radius:13px}
  .lg-main{padding:10px 2px 18px;align-items:start}
  .lg-card{padding:24px 18px 16px;border-radius:24px}
  .lg-head h2{font-size:26px}
}
@media (hover:none){.lg-doodles i{transform:none}}

/* маршрут v2: без коробки — большая дуга с «кометой», узлы-кружки с пульсом, подписи под узлами, «в пути» на вершине */
.lg-route{position:relative;display:block;width:100%;max-width:600px;padding:0 0 44px;border-radius:0;background:none;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}
.lg-arc{display:block;width:100%;height:auto;overflow:visible;color:var(--ink-fg)}
.lg-arc-dash{fill:none;stroke:currentColor;stroke-opacity:.22;stroke-width:1.2;stroke-linecap:round;stroke-dasharray:.5 1.7;animation:lgFlow2 2.6s linear infinite}
@keyframes lgFlow2{to{stroke-dashoffset:-2.2}}
.lg-hub-bg{fill:color-mix(in srgb,var(--ink-fg) 12%,var(--ink));stroke:color-mix(in srgb,var(--ink-fg) 32%,transparent);stroke-width:1.2}
.lg-hub-ring{fill:none;stroke:currentColor;stroke-width:1.2}
.lg-hub-ic{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.lg-head-dot{fill:currentColor}
.lg-head-ic{fill:none;stroke:var(--ink);stroke-width:1.2;stroke-linejoin:round}
.lg-pin{position:absolute;bottom:0;display:flex;flex-direction:column;align-items:center;gap:2px;transform:translateX(-50%);text-align:center;white-space:nowrap}
.lg-pin.a{left:10%}.lg-pin.b{left:90%}
.lg-pin b{font-size:14px;font-weight:600;letter-spacing:-.01em}
.lg-pin small{font-size:11.5px;color:color-mix(in srgb,var(--ink-fg) 55%,transparent)}
.lg-apex{position:absolute;left:50%;top:calc((100% - 44px) * .227);transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 11px;border-radius:999px;
  font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--ink-fg);background:color-mix(in srgb,var(--ink-fg) 10%,var(--ink));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink-fg) 16%,transparent)}
.lg-apex i{width:6px;height:6px;border-radius:50%;background:var(--ink-fg)}
/* часы — внизу справа, зеркально логотипу */
.lg-clock{align-self:flex-end;display:flex;align-items:center;gap:12px;text-align:right}
.lg-clock-t b{display:block;font-size:17px;font-weight:650;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.lg-clock-t small{display:block;margin-top:1px;font-size:12px;color:color-mix(in srgb,var(--ink-fg) 55%,transparent);font-variant-numeric:tabular-nums}
.lg-clock-ic{display:grid;place-items:center;flex:none;width:48px;height:48px;border-radius:15px;background:var(--ink-fg);color:var(--ink);box-shadow:0 12px 24px -12px rgba(0,0,0,.7)}
.lg-clock-ic svg{width:32px;height:32px}
.lg-clock-ic .face{fill:none;stroke:currentColor;stroke-width:2}
.lg-clock-ic .hh{stroke:currentColor;stroke-width:2.6;stroke-linecap:round}
.lg-clock-ic .mm{stroke:currentColor;stroke-width:2;stroke-linecap:round}
.lg-clock-ic .ss{stroke:currentColor;stroke-opacity:.45;stroke-width:1;stroke-linecap:round;transform-box:view-box;transform-origin:20px 20px;animation:lgTick 60s steps(60) infinite}
.lg-clock-ic .pin{fill:currentColor}
@keyframes lgTick{to{transform:rotate(360deg)}}
@media (max-width:980px){.lg-clock{display:none}}

/* циферблат v2: стеклянная плитка, деления, сужающиеся стрелки с тенью, плавная секундная; при появлении стрелки докручиваются */
.lg-clock-ic{position:relative;overflow:hidden;width:52px!important;height:52px!important;border-radius:16px!important;
  background:radial-gradient(120% 120% at 30% 20%,var(--ink-fg),color-mix(in srgb,var(--ink-fg) 88%,var(--ink)))!important;
  box-shadow:0 14px 26px -12px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.6),inset 0 0 0 1px color-mix(in srgb,var(--ink) 8%,transparent)!important;animation:lgClockIn .7s cubic-bezier(.3,1.4,.5,1) .4s both}
.lg-clock-ic::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(150deg,rgba(255,255,255,.55),transparent 45%)}
:root[data-theme="dark"] .lg-clock-ic::after{background:linear-gradient(150deg,rgba(0,0,0,.18),transparent 45%)}
.lg-clock-ic svg{width:40px!important;height:40px!important;overflow:visible}
.lg-clock-ic .ring{fill:none;stroke:currentColor;stroke-opacity:.14;stroke-width:.9}
.lg-clock-ic .tk{stroke:currentColor;stroke-opacity:.35;stroke-width:.9;stroke-linecap:round}
.lg-clock-ic .tk.major{stroke-opacity:.9;stroke-width:1.5}
.lg-clock-ic .hands{filter:drop-shadow(0 .7px .6px rgba(0,0,0,.28))}
.lg-clock-ic .hh,.lg-clock-ic .mh{fill:currentColor}
.lg-clock-ic .sh{stroke:currentColor;stroke-opacity:.6;stroke-width:.65;stroke-linecap:round}
.lg-clock-ic .sh-tail{fill:currentColor;fill-opacity:.6}
.lg-clock-ic .cap{fill:currentColor}
.lg-clock-ic .cap-in{fill:var(--ink-fg)}
.lg-clock-ic .intro,.lg-clock-ic .run{transform-box:view-box;transform-origin:20px 20px}
.lg-clock-ic .ih{animation:lgHandIn 1.4s cubic-bezier(.2,.9,.2,1) .5s both}
.lg-clock-ic .im{animation:lgHandIn2 1.4s cubic-bezier(.2,.9,.2,1) .5s both}
.lg-clock-ic .is{animation:lgHandIn2 1.2s cubic-bezier(.2,.9,.2,1) .6s both}
.lg-clock-ic .rh{animation:lgRun 43200s linear infinite}
.lg-clock-ic .rm{animation:lgRun 3600s linear infinite}
.lg-clock-ic .rs{animation:lgRun 60s linear infinite}
@keyframes lgHandIn{from{transform:rotate(-180deg)}}
@keyframes lgHandIn2{from{transform:rotate(-360deg)}}
@keyframes lgRun{to{transform:rotate(360deg)}}
@keyframes lgClockIn{from{opacity:0;transform:scale(.6) rotate(-12deg)}}
.lg-clock{gap:14px!important}
.lg[data-still] .lg-clock-ic .run,.lg[data-still] .lg-clock-ic .intro{animation:none!important}

/* циферблат v3: крупнее и чётче — 60 делений (каждые 5 и четверти жирнее), тонкие стрелки без тени,
   секундная идёт щелчками: раз в секунду рывок с лёгким перелётом и остановка */
.lg-clock-ic{width:60px!important;height:60px!important;border-radius:18px!important;background:var(--ink-fg)!important;
  box-shadow:0 14px 28px -12px rgba(0,0,0,.75),inset 0 0 0 1px color-mix(in srgb,var(--ink) 6%,transparent)!important}
.lg-clock-ic::after{background:linear-gradient(160deg,rgba(255,255,255,.4),transparent 40%)!important}
:root[data-theme="dark"] .lg-clock-ic::after{background:none!important}
.lg-clock-ic svg{width:52px!important;height:52px!important}
.lg-clock-ic .ring{fill:none;stroke:currentColor;stroke-opacity:.1;stroke-width:.8}
.lg-clock-ic .tk{stroke:currentColor;stroke-linecap:round}
.lg-clock-ic .tk.m{stroke-opacity:.28;stroke-width:.55}
.lg-clock-ic .tk.h{stroke-opacity:.7;stroke-width:1}
.lg-clock-ic .tk.q{stroke-opacity:1;stroke-width:1.5}
.lg-clock-ic .hh{stroke:currentColor;stroke-width:1.9;stroke-linecap:round}
.lg-clock-ic .mh{stroke:currentColor;stroke-width:1.25;stroke-linecap:round}
.lg-clock-ic .sh{stroke:#B4483A;stroke-width:.6;stroke-linecap:round}
.lg-clock-ic .sh-tail{fill:#B4483A}
.lg-clock-ic .cap{fill:currentColor}
.lg-clock-ic .cap-in{fill:#B4483A}
.lg-clock-ic .hands{filter:none!important}
.lg-clock-ic .intro,.lg-clock-ic .run,.lg-clock-ic .step,.lg-clock-ic .tick{transform-box:view-box;transform-origin:24px 24px}
.lg-clock-ic .step{animation:lgRun 60s steps(60,end) infinite}
.lg-clock-ic .tick{animation:lgTickS 1s linear infinite}
@keyframes lgTickS{0%{transform:rotate(-6deg)}14%{transform:rotate(1.4deg)}22%{transform:rotate(-.6deg)}30%{transform:rotate(.2deg)}36%,100%{transform:rotate(0)}}
.lg[data-still] .lg-clock-ic .step,.lg[data-still] .lg-clock-ic .tick{animation:none!important}

/* заголовок: слова выезжают снизу из-под маски по очереди, подпись проявляется из размытия */
.lg-pitch h1{display:flex;flex-direction:column}
.lg-tl{display:block}
.lg-w{display:inline-block;overflow:hidden;vertical-align:top;padding:0 .02em .1em;margin-bottom:-.1em}
.lg-w+.lg-w{margin-left:0}
.lg-w>span{display:inline-block;transform:translateY(108%) rotate(4deg);transform-origin:0 100%;animation:lgWord 1s cubic-bezier(.16,1,.3,1) both}
@keyframes lgWord{to{transform:none}}
.lg-sub{animation:lgSub 1.1s cubic-bezier(.16,1,.3,1) .9s both}
@keyframes lgSub{from{opacity:0;transform:translateY(10px);filter:blur(6px)}}
/* фон витрины: орбиты со спутниками, кресты-метки, координаты — строгая «техническая» графика */
.lg-doodles{display:none!important}
.lg-tech{position:absolute;inset:0;z-index:-1;pointer-events:none;color:var(--ink-fg)}
.lg-orbits{position:absolute;right:-170px;top:-170px;width:620px;height:620px;overflow:visible;
  transform:translate(calc(var(--px) * -18px),calc(var(--py) * -14px));transition:transform .8s cubic-bezier(.2,.8,.2,1);animation:lgFade 1.6s .2s ease both}
.lg-orbits circle[class^="o"]{fill:none;stroke:currentColor;stroke-width:1}
.lg-orbits .o1{stroke-opacity:.12}
.lg-orbits .o2{stroke-opacity:.09;stroke-dasharray:2 7}
.lg-orbits .o3{stroke-opacity:.06}
.lg-orbits .sat{transform-box:view-box;transform-origin:300px 300px}
.lg-orbits .sat circle{fill:currentColor;fill-opacity:.55}
.lg-orbits .s1{animation:lgRot 38s linear infinite}
.lg-orbits .s2{animation:lgRot 64s linear infinite reverse}
.lg-orbits .s3{animation:lgRot 90s linear infinite}
.lg-orbits .cross{stroke:currentColor;stroke-opacity:.18;stroke-width:1}
.lg-plus{position:absolute;width:13px;height:13px;margin:-6px 0 0 -6px;opacity:.22;animation:lgPlus 6s ease-in-out infinite;
  background:linear-gradient(currentColor,currentColor) center/1px 100% no-repeat,linear-gradient(currentColor,currentColor) center/100% 1px no-repeat}
@keyframes lgPlus{0%,100%{opacity:.12}50%{opacity:.34}}
.lg-coord{position:absolute;left:38px;bottom:42px;display:inline-flex;align-items:center;gap:8px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.06em;
  color:color-mix(in srgb,var(--ink-fg) 42%,transparent);animation:lgFade 1.2s 1.2s ease both}
.lg-coord i{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1px currentColor;position:relative}
.lg-coord i::after{content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:currentColor}
@media (max-width:980px){.lg-orbits{width:420px;height:420px;right:-150px;top:-150px}.lg-coord,.lg-plus{display:none}}
.lg[data-still] .lg-w>span{transform:none}

/* телефон: экран на всю высоту — сверху тёмная витрина (логотип, орбиты, заголовок внизу),
   снизу белая «шторка» с формой заходит на витрину и тянется до низа экрана, без пустоты */
@media (max-width:760px){
  .lg-shell{display:flex!important;flex-direction:column;min-height:100dvh;padding:0!important;gap:0!important}
  html.is-test .lg-shell{min-height:calc(100dvh - 26px)}
  .lg-hero{flex:none;min-height:min(50dvh,440px);justify-content:flex-start!important;gap:16px!important;padding:calc(20px + env(safe-area-inset-top)) 22px 56px!important;border-radius:0 0 32px 32px!important;box-shadow:none!important;animation:lgFade .8s ease both!important}
  .lg-pitch{margin-top:auto!important}
  .lg-pitch h1{font-size:clamp(26px,7.6vw,32px)!important;line-height:1.08}
  .lg-sub,.lg-pitch p{display:block!important;margin-top:10px!important;font-size:13.5px!important;max-width:320px}
  .lg-mark{width:44px!important;height:44px!important;border-radius:14px!important}
  .lg-word b{font-size:16px}
  .lg-orbits{width:380px!important;height:380px!important;right:-140px!important;top:-150px!important}
  .lg-main{flex:1 1 auto;display:flex!important;align-items:stretch!important;justify-content:stretch;padding:0!important;margin-top:-32px;position:relative;z-index:2}
  .lg-card{flex:1;max-width:none!important;gap:10px;padding:30px 20px calc(18px + env(safe-area-inset-bottom))!important;border-radius:30px 30px 0 0!important;
    box-shadow:0 -14px 34px -22px rgba(10,10,10,.45),0 0 0 1px var(--line)!important;animation:lgSheet .8s cubic-bezier(.16,1,.3,1) .1s both!important}
  .lg-card::before{content:"";position:absolute;top:10px;left:50%;width:40px;height:4px;margin-left:-20px;border-radius:2px;background:color-mix(in srgb,var(--text) 12%,transparent)}
  .lg-head{margin-bottom:8px}
  .lg-head h2{font-size:27px!important}
  .lg-tile{min-height:58px}
  .lg-btn{height:54px}
  .lg-note{margin-top:auto!important;padding-top:16px;font-size:11.5px;text-align:center}
  .lg[data-done] .lg-card{animation:lgCardOut .5s .3s cubic-bezier(.4,0,.2,1) forwards!important}
}
@keyframes lgSheet{from{opacity:0;transform:translateY(60px)}}
@media (max-width:760px) and (max-height:640px){.lg-hero{min-height:220px}.lg-sub,.lg-pitch p{display:none!important}}

/* «Уменьшить движение»: всё стоит */
.lg[data-still] *,.lg[data-still] *::before,.lg[data-still] *::after{animation:none!important;transition:none!important}
.lg[data-still] .lg-mark path{fill-opacity:1;stroke-dashoffset:0;stroke-width:0}
.lg[data-still] .lg-check path{stroke-dashoffset:0}
`;
