/**
 * «Бегущие» цифры: число досчитывается до значения за ~0,9 с, при смене — от прежнего значения.
 *
 * Принимает уже готовую строку («138 610 с», «+1 650 с», «24», «53%», «—») и анимирует число в её начале,
 * сохраняя знак и хвост («с», «тов.», «%»). Строки с несколькими числами («10 из 29») и с дробями
 * показываются как есть. При «уменьшить движение» — сразу итог.
 */
import { useEffect, useRef, useState } from "react";
import { afterBoot } from "../lib/boot";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** «-9 410 с», «+1 650 с» → знак, число с пробелами тысяч, хвост без цифр. */
const PARTS = /^([-+−]?)(\d[\d\s]*?)(\s*[^\d\s].*)?$/;

export default function CountUp({ text, duration = 900 }: { text: string; duration?: number }) {
  const m = PARTS.exec(text);
  const tail = m?.[3] ?? "";
  const animatable = !!m && !/\d/.test(tail);
  const plus = m?.[1] === "+";
  const target = animatable ? Number(m![2].replace(/\s/g, "")) * (m![1] && !plus ? -1 : 1) : 0;
  const start = animatable && !reduced() ? 0 : target;
  const [v, setV] = useState(start);
  const from = useRef(start);

  useEffect(() => {
    if (!animatable) return;
    if (reduced()) {
      setV(target);
      from.current = target;
      return;
    }
    let raf = 0;
    // При открытии сайта ждём, пока растворится заставка, — иначе счёт отыграет под ней.
    const cancelWait = afterBoot(() => {
      const a = from.current;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        // Быстро в начале, плавно к концу.
        const cur = a + (target - a) * (1 - Math.pow(1 - p, 3));
        setV(cur);
        from.current = cur;
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelWait();
      cancelAnimationFrame(raf);
    };
  }, [target, animatable, duration]);

  if (!animatable) return <>{text}</>;
  // «|| 0» — без «-0» на пути от отрицательного к нулю; плюс у прибыли остаётся и во время счёта.
  const n = Math.round(v) || 0;
  return <>{(plus && n > 0 ? "+" : "") + n.toLocaleString("ru-RU") + tail}</>;
}
