/**
 * Вход. По центру — стеклянная карточка входа с бегущим лучом по рамке; позади — тёмное
 * «северное сияние», сетка, мерцающие точки и живая карта маршрутов Китай → Кыргызстан.
 *
 * Логика прежняя: вход → обновить пользователя → вернуть на страницу, с которой увели на /login.
 * Удобства: предупреждение о Caps Lock, подсказка, если сервер долго просыпается (Render),
 * встряска карточки при ошибке, галочка и плавный переход при успехе.
 * Эффекты отключаются, если в системе включено «уменьшить движение».
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import { APP_NAME } from "../config";
import { apiError, apiStatus } from "../api/client";
import { I_EYE, I_EYE_OFF, Svg } from "../design/icons";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  // Куда вернуться после входа: адрес, с которого guard увёл на /login (deep-link),
  // иначе — на дашборд.
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
      window.setTimeout(() => navigate(from, { replace: true }), still ? 0 : 760);
    } catch (e) {
      // Нет ответа вообще — значит, сервер не запущен или нет связи, а не пароль неверный.
      const status = apiStatus(e);
      if (status === undefined) {
        fail(
          import.meta.env.DEV
            ? "Сервер недоступен: запустите backend (в папке server: npm run dev)"
            : "Сервер не отвечает. Проверьте интернет и попробуйте ещё раз"
        );
      } else if (status === 401) {
        fail("Неверный логин или пароль");
      } else {
        fail(apiError(e, "Не удалось войти"));
      }
    } finally {
      setBusy(false);
    }
  }

  // Лёгкий параллакс фона за курсором (через CSS-переменные, раз в кадр).
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
      const card = cardRef.current;
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${clientX - r.left}px`);
        card.style.setProperty("--my", `${clientY - r.top}px`);
      }
    });
  }

  const onPassKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);

  return (
    <div ref={rootRef} className="lg" data-done={done || undefined} data-still={still || undefined} onMouseMove={onMove}>
      <style>{STYLE}</style>

      {/* ---------- Фон ---------- */}
      <div className="lg-bg" aria-hidden="true">
        <span className="lg-blob lg-blob-a" />
        <span className="lg-blob lg-blob-b" />
        <span className="lg-blob lg-blob-c" />
        <span className="lg-grid" />
        <Stars />
        <span className="lg-comet lg-comet-a" />
        <span className="lg-comet lg-comet-b" />
        <span className="lg-comet lg-comet-c" />
        <RouteMap still={still} />
        <span className="lg-vignette" />
      </div>

      <div className="lg-layout">
        {/* ---------- Карточка входа по центру ---------- */}
        <main className="lg-main">
          <div className="lg-tilt">
          <form ref={cardRef} onSubmit={onSubmit} className="lg-card" noValidate>
            <div className="lg-card-body">
              <div className="lg-logo lg-in" style={{ animationDelay: "160ms" }}>
                <span className="lg-logo-glow" />
                <span className="lg-logo-shine" />
                <svg viewBox="0 0 94 92" aria-hidden="true">
                  <path pathLength={1} d="M26 0H94L75 22H8Z" />
                  <path pathLength={1} className="lg-logo-b" d="M61 31H74V81Q74 91 64 91H0L8 79H50Q56 79 56 73V36Z" />
                </svg>
              </div>

              <div className="lg-head lg-in" style={{ animationDelay: "230ms" }}>
                <h2>Вход в {APP_NAME}</h2>
                <p>Панель сотрудника карго</p>
              </div>

              <label className="lg-label lg-in" style={{ animationDelay: "300ms" }}>
                <span>Логин</span>
                <span className="lg-field">
                  <span className="lg-ico">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
                    </svg>
                  </span>
                  <input
                    value={loginValue}
                    onChange={(e) => setLoginValue(e.target.value)}
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Ваш логин"
                  />
                </span>
              </label>

              <label className="lg-label lg-in" style={{ animationDelay: "370ms" }}>
                <span>Пароль</span>
                <span className="lg-field">
                  <span className="lg-ico">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="10" width="16" height="11" rx="2.5" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                  </span>
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
                  <button
                    type="button"
                    className="lg-eye"
                    title={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    <Svg paths={showPassword ? I_EYE_OFF : I_EYE} size={18} sw={1.7} />
                  </button>
                </span>
                {caps && (
                  <span className="lg-caps">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 4 4 12h4v6h8v-6h4z" />
                    </svg>
                    Включён Caps Lock
                  </span>
                )}
              </label>

              {error && (
                <div className="lg-err" role="alert">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v5M12 16.5v.01" />
                  </svg>
                  {error}
                </div>
              )}

              <div className="lg-btn-wrap lg-in" style={{ animationDelay: "440ms" }}>
              <button type="submit" className="lg-btn" disabled={busy || done}>
                {done ? (
                  <svg className="lg-check" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
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
              {done && !still && (
                <span className="lg-burst" aria-hidden="true">
                  {SPARKS.map((sp, i) => (
                    <i key={i} style={sp} />
                  ))}
                </span>
              )}
              </div>

              {slow && !done && <div className="lg-slow">Сервер просыпается — первый вход может занять до минуты</div>}

              <div className="lg-note lg-in" style={{ animationDelay: "520ms" }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />
                </svg>
                Доступ только для сотрудников · соединение защищено
              </div>
            </div>
          </form>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---------- Карта маршрутов: Китай → Кыргызстан ---------- */

/**
 * Города — в долях ширины и высоты окна (fx, fy), с отступом от краёв: на любом экране
 * карта целиком внутри и не искажается. Кыргызстан слева, Китай справа, Урумчи и Кашгар —
 * над и под карточкой. lx/ly/anchor — где подпись относительно точки (подписи — только на широких экранах).
 */
type CityInfo = { fx: number; fy: number; name: string; sub?: string; home?: boolean; lx: number; ly: number; anchor: "start" | "middle" | "end" };
const CITIES = {
  bishkek: { fx: 0.15, fy: 0.37, name: "Бишкек", home: true, lx: -16, ly: 5, anchor: "end" },
  zharkyn: { fx: 0.24, fy: 0.62, name: "Жаркынбайево", sub: "Иссык-Куль", home: true, lx: -16, ly: 26, anchor: "end" },
  urumqi: { fx: 0.5, fy: 0.1, name: "Урумчи", lx: 0, ly: -18, anchor: "middle" },
  kashgar: { fx: 0.43, fy: 0.9, name: "Кашгар", lx: 14, ly: 5, anchor: "start" },
  yiwu: { fx: 0.85, fy: 0.33, name: "Иу", lx: 16, ly: 5, anchor: "start" },
  guangzhou: { fx: 0.79, fy: 0.7, name: "Гуанчжоу", lx: 16, ly: 5, anchor: "start" },
} satisfies Record<string, CityInfo>;
type City = keyof typeof CITIES;

/** Маршрут: откуда, куда, насколько дуга выгнута (доля высоты окна; минус — вниз), скорость. */
const ROUTES: { a: City; b: City; lift: number; dur: number; delay: number }[] = [
  { a: "guangzhou", b: "bishkek", lift: 0.32, dur: 7, delay: 0 },
  { a: "yiwu", b: "bishkek", lift: 0.24, dur: 7.6, delay: 1.6 },
  { a: "urumqi", b: "bishkek", lift: 0.08, dur: 4.8, delay: 0.7 },
  { a: "kashgar", b: "zharkyn", lift: 0.06, dur: 4.2, delay: 2.4 },
  { a: "guangzhou", b: "zharkyn", lift: -0.16, dur: 6.8, delay: 3.3 },
  { a: "yiwu", b: "zharkyn", lift: 0.12, dur: 7.2, delay: 4.6 },
];

function RouteMap({ still }: { still: boolean }) {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const { w, h } = size;
  const labels = w >= 760;
  const at = (k: City) => ({ x: CITIES[k].fx * w, y: CITIES[k].fy * h });
  const routes = ROUTES.map((r) => {
    const p = at(r.a);
    const q = at(r.b);
    return { ...r, d: `M${p.x} ${p.y} Q${(p.x + q.x) / 2} ${(p.y + q.y) / 2 - r.lift * h} ${q.x} ${q.y}` };
  });

  return (
    <div className="lg-map">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="lgRoute" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0" stopColor="#A78BFA" />
            <stop offset="1" stopColor="#6E8BFF" />
          </linearGradient>
          <radialGradient id="lgDot">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset=".35" stopColor="#C7D2FE" />
            <stop offset="1" stopColor="#6E8BFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {routes.map((r, i) => (
          <g key={i}>
            <path d={r.d} fill="none" stroke="url(#lgRoute)" strokeOpacity=".2" strokeWidth="1.6" />
            <path d={r.d} fill="none" stroke="url(#lgRoute)" strokeOpacity=".7" strokeWidth="1.6" strokeDasharray="4 12" className="lg-flow" />
            {!still && (
              <circle r="10" fill="url(#lgDot)" opacity="0">
                <animateMotion dur={`${r.dur}s`} begin={`${r.delay}s`} repeatCount="indefinite" path={r.d} />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.85;1" dur={`${r.dur}s`} begin={`${r.delay}s`} repeatCount="indefinite" />
              </circle>
            )}
          </g>
        ))}

        {(Object.keys(CITIES) as City[]).map((k, i) => {
          const c: CityInfo = CITIES[k];
          const { x, y } = at(k);
          const home = !!c.home;
          return (
            <g key={k} transform={`translate(${x} ${y})`}>
              {!still && (
                <circle r="6" fill="none" stroke={home ? "#8EA4FF" : "#B9A6FF"} strokeWidth="1.4">
                  <animate attributeName="r" values="6;24" dur="2.6s" begin={`${i * 0.45}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values=".7;0" dur="2.6s" begin={`${i * 0.45}s`} repeatCount="indefinite" />
                </circle>
              )}
              <circle r={home ? 6.5 : 4.5} fill={home ? "#FFFFFF" : "#C4B5FD"} />
              {home && <circle r="12" fill="none" stroke="#FFFFFF" strokeOpacity=".35" />}
              {labels && (
                <>
                  <text x={c.lx} y={c.ly} textAnchor={c.anchor} className={home ? "lg-city lg-city-home" : "lg-city"}>
                    {c.name}
                  </text>
                  {c.sub && (
                    <text x={c.lx} y={c.ly + 18} textAnchor={c.anchor} className="lg-city-sub">
                      {c.sub}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Искры при успешном входе: разлетаются от кнопки по кругу. */
const SPARK_COLORS = ["#FFFFFF", "#C7D2FE", "#A78BFA", "#7DD3FC"];
const SPARKS: CSSProperties[] = Array.from({ length: 16 }, (_, i) => ({
  ["--a" as string]: `${i * 22.5 + (i % 2) * 6}deg`,
  ["--d" as string]: `${130 + (i % 4) * 32}px`,
  ["--c" as string]: SPARK_COLORS[i % SPARK_COLORS.length],
  animationDelay: `${(i % 3) * 40}ms`,
}));

/** Мерцающие точки: положения псевдослучайные, но одинаковые при каждом открытии. */
function Stars() {
  const stars = useMemo(() => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 46 }, () => ({
      left: rnd() * 100,
      top: rnd() * 100,
      size: 1 + rnd() * 1.8,
      delay: rnd() * 6,
      dur: 3 + rnd() * 4,
    }));
  }, []);
  return (
    <>
      {stars.map((s, i) => (
        <span
          key={i}
          className="lg-star"
          style={{ left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s` }}
        />
      ))}
    </>
  );
}

/* Стили страницы — здесь, чтобы всё о входе лежало в одном файле. Тёмная фирменная сцена
   не зависит от темы панели. */
const STYLE = `
.lg{--px:0;--py:0;position:relative;min-height:100vh;overflow:hidden;background:#060913;color:#EEF1F8;
  font-family:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;isolation:isolate}
.lg *{box-sizing:border-box}
/* Локально сверху полоса «Тестовая среда» (26px) — страница не должна из-за неё прокручиваться. */
html.is-test .lg,html.is-test .lg-layout{min-height:calc(100vh - 26px)}

/* фон */
.lg-bg{position:absolute;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
.lg-blob{position:absolute;border-radius:50%;filter:blur(90px);opacity:.8;will-change:transform}
.lg-blob-a{width:620px;height:620px;left:-140px;top:-180px;background:radial-gradient(circle,#3E63DD,transparent 65%);
  transform:translate(calc(var(--px) * -26px),calc(var(--py) * -18px));animation:lgFloatA 22s ease-in-out infinite alternate}
.lg-blob-b{width:560px;height:560px;right:-120px;top:10%;background:radial-gradient(circle,#7C3AED,transparent 65%);opacity:.62;
  transform:translate(calc(var(--px) * 22px),calc(var(--py) * 16px));animation:lgFloatB 26s ease-in-out infinite alternate}
.lg-blob-c{width:520px;height:520px;left:28%;bottom:-260px;background:radial-gradient(circle,#0EA5E9,transparent 65%);opacity:.42;
  animation:lgFloatC 30s ease-in-out infinite alternate}
.lg-grid{position:absolute;inset:-2px;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);
  background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 80% 70% at 45% 40%,#000 30%,transparent 80%);mask-image:radial-gradient(ellipse 80% 70% at 45% 40%,#000 30%,transparent 80%);
  transform:translate(calc(var(--px) * 8px),calc(var(--py) * 8px))}
.lg-star{position:absolute;border-radius:50%;background:#fff;opacity:.15;animation:lgTwinkle 5s ease-in-out infinite}
/* падающие звёзды: изредка пролетают по небу сверху справа вниз влево */
.lg-comet{position:absolute;width:170px;height:1.5px;border-radius:2px;opacity:0;transform-origin:left center;
  background:linear-gradient(90deg,rgba(224,231,255,.95),rgba(167,139,250,.35) 40%,transparent);animation:lgComet 12s linear infinite}
.lg-comet::before{content:"";position:absolute;left:-3px;top:-2.5px;width:6px;height:6px;border-radius:50%;background:#fff;box-shadow:0 0 12px 3px rgba(199,210,254,.9)}
.lg-comet-a{top:14%;left:82%;animation-delay:2.5s}
.lg-comet-b{top:34%;left:96%;animation-delay:7s;animation-duration:15s}
.lg-comet-c{top:5%;left:58%;animation-delay:11s;animation-duration:17s}
.lg-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 120%,rgba(6,9,19,.9),transparent 60%),radial-gradient(ellipse at 50% 50%,transparent 55%,rgba(6,9,19,.55))}

/* раскладка: только карточка, по центру */
.lg-layout{position:relative;min-height:100vh;display:grid;place-items:center;padding:40px 16px}
.lg-main{position:relative;width:100%;max-width:440px;min-width:0;display:flex;align-items:center;justify-content:center}
/* медленно вращающееся сияние за карточкой */
.lg-main::before{content:"";position:absolute;width:620px;height:620px;max-width:150vw;max-height:150vw;border-radius:50%;pointer-events:none;
  background:conic-gradient(from 0deg,rgba(79,110,247,.6),rgba(139,92,246,.5),rgba(14,165,233,.38),rgba(236,72,153,.22),rgba(79,110,247,.6));
  filter:blur(80px);opacity:.5;animation:lgRot 20s linear infinite}
/* лёгкий 3D-наклон карточки за мышью (те же --px/--py, что у параллакса фона) */
.lg-tilt{position:relative;width:100%;display:flex;justify-content:center;transform:perspective(1400px) rotateX(calc(var(--py) * -3deg)) rotateY(calc(var(--px) * 4deg));transition:transform .4s cubic-bezier(.2,.8,.2,1)}

/* карта маршрутов — фоном на весь экран, проходит за стеклом карточки */
.lg-map{position:absolute;inset:0;opacity:.85;animation:lgFade 1.2s .3s ease both;
  transform:translate(calc(var(--px) * -10px),calc(var(--py) * -8px));
  -webkit-mask-image:radial-gradient(ellipse 95% 95% at 50% 50%,#000 70%,transparent 100%);mask-image:radial-gradient(ellipse 95% 95% at 50% 50%,#000 70%,transparent 100%)}
.lg-map svg{display:block;width:100%;height:100%;overflow:visible}
.lg-flow{animation:lgFlow 1.6s linear infinite}
.lg-city{font-size:15px;fill:rgba(238,241,248,.5);font-weight:500;letter-spacing:.01em}
.lg-city-home{fill:#FFFFFF;font-weight:600}
.lg-city-sub{font-size:12.5px;fill:rgba(238,241,248,.42);letter-spacing:.02em}

/* карточка */
.lg-card{position:relative;width:100%;max-width:420px;border-radius:22px;padding:1px;
  background:rgba(14,19,36,.62);backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%);
  box-shadow:0 40px 90px -30px rgba(0,0,0,.85),0 0 0 1px rgba(255,255,255,.07),inset 0 1px 0 rgba(255,255,255,.06);
  animation:lgCardIn .8s cubic-bezier(.2,.8,.2,1) both}
.lg-card::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(380px circle at var(--mx,50%) var(--my,0%),rgba(110,139,255,.16),transparent 45%)}
@property --lg-ang{syntax:'<angle>';inherits:false;initial-value:0deg}
.lg-card::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;
  background:conic-gradient(from var(--lg-ang),transparent 0deg,transparent 200deg,rgba(142,164,255,.95) 280deg,rgba(196,181,253,.95) 320deg,transparent 360deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);
  animation:lgSpin 6s linear infinite}
.lg-card-body{position:relative;z-index:1;display:flex;flex-direction:column;gap:16px;padding:34px 34px 26px}

.lg-logo{position:relative;width:60px;height:60px;border-radius:17px;display:grid;place-items:center;align-self:flex-start;
  background:linear-gradient(140deg,#4F6EF7,#7C5CF6);box-shadow:0 14px 34px -10px rgba(99,102,241,.9),inset 0 1px 0 rgba(255,255,255,.3)}
.lg-logo-glow{position:absolute;inset:-14px;border-radius:26px;background:radial-gradient(circle,rgba(110,139,255,.45),transparent 70%);z-index:-1;animation:lgPulse 3s ease-in-out infinite}
.lg-logo svg{position:relative;width:32px;height:31px;overflow:visible}
.lg-logo-shine{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none}
.lg-logo-shine::after{content:"";position:absolute;top:-30%;bottom:-30%;left:-70%;width:45%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.6),transparent);
  transform:skewX(-18deg);animation:lgLogoShine 5s 2.2s ease-in-out infinite}
.lg-logo path{fill:#fff;fill-opacity:0;stroke:#fff;stroke-width:3;stroke-linejoin:round;stroke-dasharray:1 1;stroke-dashoffset:1;animation:lgDraw 1.5s .35s cubic-bezier(.65,0,.35,1) forwards}
.lg-logo .lg-logo-b{animation-delay:.55s}

.lg-head h2{margin:2px 0 0;font-size:24px;font-weight:600;letter-spacing:-.02em;color:#fff}
.lg-head p{margin:5px 0 0;font-size:13.5px;color:rgba(238,241,248,.55)}

.lg-label{display:flex;flex-direction:column;gap:7px}
.lg-label>span:first-child{font-size:12.5px;font-weight:500;color:rgba(238,241,248,.72)}
.lg-field{position:relative;display:flex;align-items:center;height:50px;border-radius:13px;background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.1);transition:border-color .2s,box-shadow .25s,background .2s}
.lg-field:hover{border-color:rgba(255,255,255,.2)}
.lg-field:focus-within{border-color:#7B93FF;background:rgba(110,139,255,.08);box-shadow:0 0 0 4px rgba(110,139,255,.16),0 10px 28px -12px rgba(110,139,255,.75)}
.lg-ico{flex:none;width:46px;display:grid;place-items:center;color:rgba(238,241,248,.4);transition:color .2s}
.lg-field:focus-within .lg-ico{color:#A9B9FF}
.lg-field input{flex:1;min-width:0;height:100%;border:none!important;outline:none;background:transparent;color:#F4F6FB;font-size:15px;padding:0 14px 0 0;caret-color:#9DB0FF}
.lg-field input:focus{box-shadow:none!important}
.lg-field input::placeholder{color:rgba(238,241,248,.28)}
.lg-field input:-webkit-autofill{-webkit-text-fill-color:#F4F6FB;transition:background-color 600000s 0s,color 600000s 0s}
.lg-eye{flex:none;width:40px;height:40px;margin-right:5px;border:none;border-radius:10px;background:transparent;color:rgba(238,241,248,.45);cursor:pointer;display:grid;place-items:center;transition:background .15s,color .15s}
.lg-eye:hover{background:rgba(255,255,255,.07);color:#fff}
.lg-caps{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#FCD34D;animation:lgFade .2s ease}

.lg-err{display:flex;align-items:flex-start;gap:9px;padding:11px 13px;border-radius:12px;font-size:13px;line-height:1.45;
  color:#FECACA;background:rgba(239,68,68,.12);border:1px solid rgba(248,113,113,.3);animation:lgFade .2s ease}
.lg-err svg{flex:none;margin-top:1px;color:#F87171}

.lg-btn-wrap{position:relative;margin-top:4px}
.lg-btn{position:relative;overflow:hidden;width:100%;height:52px;border:none;border-radius:13px;color:#fff;font-family:inherit;font-size:15.5px;font-weight:600;line-height:1;
  letter-spacing:.01em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;
  background:linear-gradient(120deg,#4F6EF7 0%,#6366F1 45%,#8B5CF6 100%);background-size:160% 100%;
  box-shadow:0 14px 34px -14px rgba(99,102,241,.95),inset 0 1px 0 rgba(255,255,255,.22);
  transition:transform .15s ease,box-shadow .25s ease,background-position .5s ease}
.lg-btn:hover:not(:disabled){transform:translateY(-1px);background-position:100% 0;box-shadow:0 18px 40px -14px rgba(124,92,246,1),inset 0 1px 0 rgba(255,255,255,.28)}
.lg-btn:active:not(:disabled){transform:translateY(0) scale(.99)}
.lg-btn:disabled{cursor:default}
.lg-btn::before{content:"";position:absolute;top:0;bottom:0;left:-45%;width:35%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent);
  transform:skewX(-20deg);animation:lgSweep 3.4s ease-in-out infinite}
.lg-arrow{transition:transform .2s ease}
.lg-btn:hover .lg-arrow{transform:translateX(4px)}
.lg-spin{width:18px;height:18px;border-radius:50%;border:2.2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:lgRot .7s linear infinite}
.lg-check path{stroke-dasharray:24;stroke-dashoffset:24;animation:lgCheck .4s ease forwards}
.lg-burst{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:2}
.lg-burst::before{content:"";position:absolute;left:-40px;top:-40px;width:80px;height:80px;border-radius:50%;border:2px solid rgba(199,210,254,.85);
  box-shadow:0 0 24px rgba(142,164,255,.6);animation:lgRing .7s cubic-bezier(.2,.8,.2,1) forwards}
.lg-burst i{position:absolute;left:-4px;top:-4px;width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 14px 3px var(--c);
  transform:rotate(var(--a)) translateX(0);animation:lgBurst .8s cubic-bezier(.15,.75,.25,1) forwards}
.lg-slow{font-size:12.5px;line-height:1.45;color:rgba(238,241,248,.6);text-align:center;animation:lgFade .3s ease}
.lg-note{display:flex;align-items:center;justify-content:center;gap:7px;font-size:12px;color:rgba(238,241,248,.4);border-top:1px solid rgba(255,255,255,.06);margin-top:2px;padding-top:14px}

/* появление и уход */
.lg-in{animation:lgUp .75s cubic-bezier(.2,.8,.2,1) both}
.lg[data-done] .lg-card{animation:lgCardOut .45s .3s cubic-bezier(.4,0,.2,1) forwards}

@keyframes lgUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes lgFade{from{opacity:0}to{opacity:1}}
@keyframes lgCardIn{from{opacity:0;transform:translateY(22px) scale(.97)}to{opacity:1;transform:none}}
@keyframes lgCardOut{to{opacity:0;transform:translateY(-10px) scale(1.03);filter:blur(4px)}}
@keyframes lgSpin{to{--lg-ang:360deg}}
@keyframes lgDraw{0%{stroke-dashoffset:1;fill-opacity:0}65%{stroke-dashoffset:0;fill-opacity:0}100%{stroke-dashoffset:0;fill-opacity:1;stroke-width:0}}
@keyframes lgPulse{0%,100%{opacity:.55;transform:scale(.92)}50%{opacity:1;transform:scale(1.06)}}
@keyframes lgSweep{0%,55%{left:-45%}100%{left:130%}}
@keyframes lgRot{to{transform:rotate(360deg)}}
@keyframes lgCheck{to{stroke-dashoffset:0}}
@keyframes lgFlow{to{stroke-dashoffset:-32}}
@keyframes lgComet{0%{opacity:0;transform:rotate(-26deg) translateX(0)}1.5%{opacity:1}11%{opacity:0;transform:rotate(-26deg) translateX(-760px)}100%{opacity:0;transform:rotate(-26deg) translateX(-760px)}}
@keyframes lgLogoShine{0%,72%{left:-70%}100%{left:140%}}
@keyframes lgBurst{0%{opacity:1;transform:rotate(var(--a)) translateX(0) scale(1.2)}70%{opacity:1}100%{opacity:0;transform:rotate(var(--a)) translateX(var(--d)) scale(.5)}}
@keyframes lgRing{from{opacity:1;transform:scale(.2)}to{opacity:0;transform:scale(3.4)}}
@keyframes lgShineText{0%,100%{background-position:100% 0}50%{background-position:0 0}}
@keyframes lgTwinkle{0%,100%{opacity:.08}50%{opacity:.7}}
@keyframes lgFloatA{to{translate:120px 90px;scale:1.15}}
@keyframes lgFloatB{to{translate:-140px 110px;scale:.9}}
@keyframes lgFloatC{to{translate:-90px -120px;scale:1.2}}

/* адаптив */
@media (max-width:480px){.lg-card-body{padding:28px 22px 22px}.lg-head h2{font-size:22px}.lg-map{opacity:.6}.lg-main::before{width:420px;height:420px}}
@media (hover:none){.lg-tilt{transform:none}}

/* «Уменьшить движение»: всё стоит, кроме самых нужных подсказок */
.lg[data-still] *,.lg[data-still] *::before,.lg[data-still] *::after{animation:none!important;transition:none!important}
.lg[data-still] .lg-logo path{fill-opacity:1;stroke-dashoffset:0;stroke-width:0}
.lg[data-still] .lg-check path{stroke-dashoffset:0}
.lg[data-still] .lg-tilt{transform:none}
.lg[data-still] .lg-comet{display:none}
`;
