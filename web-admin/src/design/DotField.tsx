/**
 * Монохромное «живое поле точек» на canvas — фон приложения и страницы входа.
 *
 * Ровная сетка бледных точек цвета текста темы:
 *  • у курсора точки расступаются линзой, крупнеют и темнеют — поле «чувствует» мышь;
 *  • по клику от курсора расходится кольцевая волна;
 *  • в покое по полю медленно проходит светлая диагональная полоса.
 * Курсор сглаживается (плавно догоняет), при уходе мыши линза гаснет. Вкладка скрыта — кадры
 * не рисуются; «Уменьшить движение» — статичная сетка без анимации.
 */
import { useEffect, useRef } from "react";

const GAP = 28; // шаг сетки, px
const R0 = 1.15; // радиус точки в покое
const LENS = 190; // радиус влияния курсора
const PUSH = 12; // насколько точки расступаются у курсора
const WAVE_W = 46; // ширина кольца волны от клика
const WAVE_SPEED = 0.85; // px за мс
const WAVE_LIFE = 1500; // мс

function readInk(el: HTMLElement): [number, number, number] {
  const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [20, 20, 20];
}

/** Поле занимает родителя целиком (position:absolute; inset:0 задаёт className). Цвет точек — CSS color. */
export default function DotField({ className, alpha }: { className?: string; alpha?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = box.current;
    const canvas = cv.current;
    const ctx = canvas?.getContext("2d");
    if (!host || !canvas || !ctx) return;

    const still = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dark = () => document.documentElement.getAttribute("data-theme") === "dark";
    let ink = readInk(host);
    let w = 0;
    let h = 0;
    let dpr = 1;

    // курсор: цель и сглаженное положение, сила линзы (0 — мышь ушла)
    const target = { x: -9999, y: -9999, on: 0 };
    const cur = { x: -9999, y: -9999, k: 0 };
    const waves: { x: number; y: number; t: number }[] = [];

    function draw(now: number) {
      ctx!.clearRect(0, 0, w, h);
      const [r, g, b] = ink;
      const base = alpha ?? (dark() ? 0.13 : 0.12);
      // сглаживание курсора
      cur.x += (target.x - cur.x) * 0.16;
      cur.y += (target.y - cur.y) * 0.16;
      cur.k += (target.on - cur.k) * 0.08;
      // живые волны
      for (let i = waves.length - 1; i >= 0; i--) if (now - waves[i].t > WAVE_LIFE) waves.splice(i, 1);

      const ox = (w % GAP) / 2;
      const oy = (h % GAP) / 2;
      const band = now * 0.00022; // светлая полоса: фаза
      // обычные точки — одним путём и одной заливкой; «особые» (линза, волна, полоса) — по одной
      const plain = new Path2D();
      for (let y = oy; y <= h; y += GAP) {
        for (let x = ox; x <= w; x += GAP) {
          let px = x;
          let py = y;
          let rad = R0;
          let a = base;

          // полоса: узкий «гребень» синуса по диагонали
          if (!still) {
            const s = Math.sin(x * 0.0021 + y * 0.0034 - band * 6.2832);
            const crest = s > 0.96 ? (s - 0.96) / 0.04 : 0;
            a += crest * 0.16;
            rad += crest * 0.5;
          }

          // линза у курсора
          if (cur.k > 0.01) {
            const dx = x - cur.x;
            const dy = y - cur.y;
            const d = Math.hypot(dx, dy);
            if (d < LENS) {
              const t = 1 - d / LENS;
              const e = t * t * (3 - 2 * t) * cur.k;
              const inv = d > 0.001 ? 1 / d : 0;
              px += dx * inv * e * PUSH;
              py += dy * inv * e * PUSH;
              rad += e * 2.1;
              a += e * 0.5;
            }
          }

          // кольца от кликов
          for (const wv of waves) {
            const age = now - wv.t;
            const ring = age * WAVE_SPEED;
            const dx = x - wv.x;
            const dy = y - wv.y;
            const d = Math.hypot(dx, dy);
            const off = Math.abs(d - ring);
            if (off < WAVE_W) {
              const f = (1 - off / WAVE_W) * (1 - age / WAVE_LIFE);
              const inv = d > 0.001 ? 1 / d : 0;
              px += dx * inv * f * 7;
              py += dy * inv * f * 7;
              rad += f * 1.8;
              a += f * 0.42;
            }
          }

          if (a === base && rad === R0) {
            plain.moveTo(px + R0, py);
            plain.arc(px, py, R0, 0, 6.2832);
            continue;
          }
          ctx!.fillStyle = `rgba(${r},${g},${b},${Math.min(0.85, a).toFixed(3)})`;
          ctx!.beginPath();
          ctx!.arc(px, py, rad, 0, 6.2832);
          ctx!.fill();
        }
      }
      ctx!.fillStyle = `rgba(${r},${g},${b},${base})`;
      ctx!.fill(plain);
    }

    const resize = () => {
      const r = host.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (still) draw(0);
    };

    // в покое (мышь ушла, волн нет) — ~30 кадров/с, при движении — каждый кадр
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      const idle = cur.k < 0.01 && target.on === 0 && waves.length === 0;
      if (!idle || t - last > 33) {
        draw(t);
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      target.x = e.clientX - r.left;
      target.y = e.clientY - r.top;
      target.on = 1;
      if (cur.x < -9000) {
        cur.x = target.x;
        cur.y = target.y;
      }
    };
    const onLeave = () => (target.on = 0);
    const onDown = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      waves.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() });
      if (waves.length > 4) waves.shift();
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !still) raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    // смена темы — новый цвет точек
    const mo = new MutationObserver(() => {
      ink = readInk(host);
      if (still) draw(0);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

    if (!still) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", onVis);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [alpha]);

  return (
    <div ref={box} className={className} aria-hidden>
      <canvas ref={cv} className="app-field-cv" />
    </div>
  );
}
