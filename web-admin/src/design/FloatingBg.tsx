/**
 * Фон приложения за всеми блоками: мягкое свечение и печать Jetcargo.
 *
 * Оба плавают по всей рабочей области сами по себе: каждый раз — в случайную новую точку
 * (далеко от текущей), со случайным поворотом, размером и скоростью, так что траектория
 * не повторяется. Ход — Web Animations API, по отрезку за раз; координаты — в долях
 * области (cqw / cqh), поэтому при смене размера окна печать не вылетает за край.
 * «Уменьшить движение» в системе — стоят на месте.
 */
import { useEffect, useRef, type RefObject } from "react";

import { LogoSeal } from "./Logo";

type Drift = {
  /** Насколько центр может уйти от середины: ± доля ширины и высоты области, %. */
  x: number;
  y: number;
  /** Поворот, градусы (null — не крутить). */
  rot: [number, number] | null;
  scale: [number, number];
  /** Следующая точка — не ближе этого (в тех же %), чтобы реально переплывал экран. */
  minHop: number;
  /** Длительность отрезка: base + путь × perUnit, мс, и ещё случайно ±20%. */
  base: number;
  perUnit: number;
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function useDrift(ref: RefObject<HTMLElement | null>, o: Drift) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    type P = { x: number; y: number; r: number; s: number };
    const pick = (): P => ({ x: rnd(-o.x, o.x), y: rnd(-o.y, o.y), r: o.rot ? rnd(o.rot[0], o.rot[1]) : 0, s: rnd(o.scale[0], o.scale[1]) });
    const frame = (p: P): Keyframe => ({
      translate: `calc(-50% + ${p.x.toFixed(2)}cqw) calc(-50% + ${p.y.toFixed(2)}cqh)`,
      rotate: `${p.r.toFixed(1)}deg`,
      scale: p.s.toFixed(3),
    });

    // Старт — из середины, где стоит по стилям: без скачка.
    let cur: P = { x: 0, y: 0, r: o.rot ? -12 : 0, s: 1 };
    let anim: Animation | null = null;
    let alive = true;
    const step = () => {
      if (!alive) return;
      let next = pick();
      for (let i = 0; i < 8 && Math.hypot(next.x - cur.x, next.y - cur.y) < o.minHop; i++) next = pick();
      const dist = Math.hypot(next.x - cur.x, next.y - cur.y);
      const prev = anim;
      anim = el.animate([frame(cur), frame(next)], {
        duration: (o.base + dist * o.perUnit) * rnd(0.8, 1.2),
        easing: "cubic-bezier(.37,0,.63,1)",
        fill: "forwards",
      });
      prev?.cancel();
      cur = next;
      anim.onfinish = step;
    };
    step();
    return () => {
      alive = false;
      anim?.cancel();
    };
  }, [ref, o]);
}

const SEAL: Drift = { x: 40, y: 37, rot: [-38, 26], scale: [0.78, 1.14], minHop: 34, base: 7000, perUnit: 230 };
const AURA: Drift = { x: 34, y: 30, rot: null, scale: [0.85, 1.3], minHop: 26, base: 9000, perUnit: 300 };

export default function FloatingBg() {
  const aura = useRef<HTMLDivElement>(null);
  const seal = useRef<HTMLDivElement>(null);
  useDrift(aura, AURA);
  useDrift(seal, SEAL);
  return (
    <div className="app-bg" aria-hidden>
      <div ref={aura} className="app-aura" />
      <div ref={seal} className="app-seal">
        <LogoSeal />
      </div>
    </div>
  );
}
