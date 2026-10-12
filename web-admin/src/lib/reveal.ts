/**
 * Плавные появления по всему сайту.
 *
 *  1. Открытие страницы. Широкий экран: блоки по очереди (сверху вниз, слева направо)
 *     проявляются и мягко всплывают. Телефон: так же — видимые сразу, остальные — когда до них
 *     долистали. Блок — карточка (у неё есть фон, рамка или тень); прозрачные обёртки (сетки,
 *     колонки) не анимируем, а заходим внутрь — к их карточкам.
 *  2. Новое на странице (загрузились данные, появилось поле, пришла строка) — проявляется.
 *  3. Замена данных после клика или ввода (вкладка, фильтр, период, поиск): строки списка
 *     мягко проявляются заново по очереди — даже те, что остались на месте.
 *
 * Анимация — Web Animations API: атрибуты, которыми управляет React, не трогаем. Ставим её до
 * первой отрисовки (useLayoutEffect и MutationObserver срабатывают раньше, чем браузер рисует
 * кадр), иначе блок на миг показывается целиком и «дёргается». Окна, выпадающие списки и
 * подсказки (fixed / absolute) не трогаем — у них свои анимации.
 * «Уменьшить движение» в системе — ничего не анимируем.
 */
import { useLayoutEffect, type RefObject } from "react";

import { afterBoot } from "./boot";

const EASE = "cubic-bezier(.2,.75,.25,1)";
const ID = "reveal";

/** Открытие страницы. */
const FRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(18px) scale(.985)" },
  { opacity: 1, transform: "none" },
];
const TIMING: KeyframeAnimationOptions = { duration: 640, easing: EASE, fill: "backwards", id: ID };
/** Блок пришёл позже, на смену заглушке: мягче — не из пустоты, чтобы место не «мигало». */
const FRAMES_LATE: Keyframe[] = [
  { opacity: 0.3, transform: "translateY(8px)" },
  { opacity: 1, transform: "none" },
];
const TIMING_LATE: KeyframeAnimationOptions = { duration: 460, easing: EASE, fill: "backwards", id: ID };
/** Новое на странице. */
const FRAMES_ADD: Keyframe[] = [
  { opacity: 0, transform: "translateY(8px)" },
  { opacity: 1, transform: "none" },
];
const TIMING_ADD: KeyframeAnimationOptions = { duration: 380, easing: EASE, fill: "backwards", id: ID };
/** Данные заменились (вкладка, фильтр): строки проявляются заново. */
const FRAMES_SWAP: Keyframe[] = [
  { opacity: 0.2, transform: "translateY(6px)" },
  { opacity: 1, transform: "none" },
];
const TIMING_SWAP: KeyframeAnimationOptions = { duration: 340, easing: EASE, fill: "backwards", id: ID };

const STEP_MS = 60;
const MAX_DELAY_MS = 520;
const MAX_BLOCKS = 60;
/** Сколько после открытия страницы новые блоки появляются «по-блочному» (данные грузятся не сразу). */
const LATE_MS = 6000;
/** Сколько после клика или ввода замену данных считаем ответом на действие (сеть бывает медленной). */
const ARM_MS = 1800;
/** Сколько строк за раз анимируем — остальные просто на месте. */
const MAX_ROWS = 30;

const WRAP_TAGS = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "FORM"]);
/** Окна и всплывающее: их появление и исчезновение — не «замена данных». */
const FLOATING = ".md-overlay,[role=dialog],[role=listbox],[role=menu],[role=tooltip],[data-no-reveal]";

/** Прозрачная обёртка без рамки и тени, внутри которой есть крупные блоки — заходим внутрь. */
function isWrapper(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  if (!WRAP_TAGS.has(el.tagName) || el.children.length === 0) return false;
  if (cs.overflowY === "auto" || cs.overflowY === "scroll") return false;
  const clearBg = (cs.backgroundColor === "transparent" || cs.backgroundColor === "rgba(0, 0, 0, 0)") && cs.backgroundImage === "none";
  const noBorder = !parseFloat(cs.borderTopWidth) && !parseFloat(cs.borderBottomWidth) && !parseFloat(cs.borderLeftWidth);
  if (!clearBg || !noBorder || cs.boxShadow !== "none") return false;
  // Ряд мелочи (кнопки периода, чипы) — одним блоком, а не по кнопке.
  return Array.from(el.children).some((c) => (c as HTMLElement).offsetHeight >= 64);
}

function collect(root: Element, out: HTMLElement[], depth = 0) {
  for (const node of Array.from(root.children)) {
    if (out.length >= MAX_BLOCKS) return;
    const el = node as HTMLElement;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.position === "fixed" || cs.position === "absolute") continue;
    if (depth < 5 && isWrapper(el, cs)) collect(el, out, depth + 1);
    else if (el.offsetHeight > 0) out.push(el);
  }
}

/** Внутри всплывающего (окно, список, подсказка) или сам такой — не трогаем. */
function floating(el: HTMLElement, root: HTMLElement): boolean {
  if (el.closest(FLOATING)) return true;
  for (let p: HTMLElement | null = el, i = 0; p && p !== root && i < 7; p = p.parentElement, i++) {
    const pos = getComputedStyle(p).position;
    if (pos === "fixed" || pos === "absolute") return true;
  }
  return false;
}

const isOverlayNode = (n: Node) => n instanceof HTMLElement && (n.matches(FLOATING) || n.classList.contains("md-overlay"));

/**
 * Включить плавные появления для содержимого `ref` (прокручиваемая область страницы).
 * routeKey — смена страницы; scrollReveal — показывать нижние блоки по прокрутке (телефон).
 */
export function useReveal(ref: RefObject<HTMLElement | null>, routeKey: string, scrollReveal: boolean): void {
  useLayoutEffect(() => {
    const main = ref.current;
    if (!main || typeof main.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const openedAt = performance.now();
    const seen = new WeakSet<Element>();
    const live = new Map<Element, Animation>();
    /** Что сейчас анимируем: внутри них и вокруг них второй раз не трогаем. */
    const moving = new Set<Element>();
    const track = (el: Element, a: Animation) => {
      moving.add(el);
      const done = () => moving.delete(el);
      a.finished.then(done, done);
    };
    // До конца заставки всё стоит на первом кадре — иначе отыграет под ней.
    let booted = false;
    const waiting: Animation[] = [];
    const start = (a: Animation) => (booted ? a.play() : waiting.push(a));

    const io = scrollReveal
      ? new IntersectionObserver(
          (entries) => {
            let k = 0;
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              io!.unobserve(e.target);
              const a = live.get(e.target);
              if (!a) continue;
              a.effect?.updateTiming({ delay: Math.min(k++ * STEP_MS, MAX_DELAY_MS) });
              start(a);
            }
          },
          { root: main, rootMargin: "0px 0px -6% 0px", threshold: 0.04 }
        )
      : null;

    /** Блоки страницы, ещё не показанные: по очереди сверху вниз. */
    function run(late: boolean) {
      const blocks: HTMLElement[] = [];
      collect(main!, blocks);
      const fresh = blocks.filter((b) => !seen.has(b));
      if (!fresh.length) return;
      const box = main!.getBoundingClientRect();
      const placed = fresh
        .map((b) => ({ b, r: b.getBoundingClientRect() }))
        .sort((x, y) => Math.round(x.r.top - y.r.top) || x.r.left - y.r.left);
      let i = 0;
      for (const { b, r } of placed) {
        seen.add(b);
        const inView = r.top < box.bottom && r.bottom > box.top;
        const a = late ? b.animate(FRAMES_LATE, TIMING_LATE) : b.animate(FRAMES, TIMING);
        a.pause();
        live.set(b, a);
        track(b, a);
        a.finished.then(() => live.delete(b)).catch(() => undefined);
        if (!io || inView) {
          a.effect?.updateTiming({ delay: Math.min(i++ * (late ? STEP_MS / 2 : STEP_MS), MAX_DELAY_MS) });
          start(a);
        } else io.observe(b);
      }
    }

    run(false);
    const offBoot = afterBoot(() => {
      booted = true;
      for (const a of waiting.splice(0)) a.play();
    });

    // Клик или ввод — следующие замены данных считаем ответом на действие.
    let armedUntil = 0;
    const arm = () => (armedUntil = performance.now() + ARM_MS);
    document.addEventListener("pointerdown", arm, true);
    document.addEventListener("input", arm, true);
    document.addEventListener("keydown", arm, true);

    const busy = (el: Element) => {
      for (const m of moving) if (m === el || m.contains(el) || el.contains(m)) return true;
      return false;
    };

    // Сразу, без задержки — до отрисовки кадра. Смена текста (бегущие цифры) сюда не попадает.
    const mo = new MutationObserver((records) => {
      const removed = new Map<HTMLElement, number>();
      const addedTo = new Map<HTMLElement, number>();
      const added: HTMLElement[] = [];
      for (const r of records) {
        if (!(r.target instanceof HTMLElement)) continue;
        r.removedNodes.forEach((n) => {
          if (n.nodeType === 1 && !isOverlayNode(n)) removed.set(r.target as HTMLElement, (removed.get(r.target as HTMLElement) ?? 0) + 1);
        });
        r.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement) || isOverlayNode(n)) return;
          added.push(n);
          addedTo.set(r.target as HTMLElement, (addedTo.get(r.target as HTMLElement) ?? 0) + 1);
        });
      }
      if (!removed.size && !added.length) return;

      // 1. Первые секунды после открытия — новые карточки «по-блочному».
      if (added.length && performance.now() - openedAt < LATE_MS) run(true);

      const box = main.getBoundingClientRect();
      const visible = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.height >= 16 && r.bottom > box.top && r.top < box.bottom;
      };

      // 2. Замена данных после действия: список заново, строки по очереди.
      const swapped: HTMLElement[] = [];
      if (performance.now() < armedUntil) {
        const targets = [...removed.keys()].filter((t) => {
          const out = removed.get(t) ?? 0;
          const inn = addedTo.get(t) ?? 0;
          return t.isConnected && (out >= 2 || (out >= 1 && inn >= 1));
        });
        for (const t of targets) {
          if (targets.some((o) => o !== t && o.contains(t))) continue;
          if (t.offsetHeight < 40 || floating(t, main) || busy(t)) continue;
          // Крупные группы (день, клиент) — по их строкам: тогда список проявляется каскадом.
          const rows: HTMLElement[] = [];
          for (const c of Array.from(t.children)) {
            if (!(c instanceof HTMLElement)) continue;
            if (c.children.length >= 3 && c.offsetHeight > 220) rows.push(...(Array.from(c.children) as HTMLElement[]));
            else rows.push(c);
          }
          let i = 0;
          for (const c of rows) {
            if (i >= MAX_ROWS) break;
            if (!(c instanceof HTMLElement) || !visible(c) || busy(c)) continue;
            const a = c.animate(FRAMES_SWAP, { ...TIMING_SWAP, delay: Math.min(i++ * 18, 260) });
            track(c, a);
          }
          swapped.push(t);
        }
      }

      // 3. Просто новое — проявляется.
      let k = 0;
      for (const el of added) {
        if (k >= MAX_ROWS) break;
        if (!el.isConnected || swapped.some((t) => t.contains(el)) || busy(el)) continue;
        if (!visible(el) || floating(el, main)) continue;
        const a = el.animate(FRAMES_ADD, { ...TIMING_ADD, delay: Math.min(k++ * 18, 260) });
        track(el, a);
      }
    });
    mo.observe(main, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io?.disconnect();
      offBoot();
      document.removeEventListener("pointerdown", arm, true);
      document.removeEventListener("input", arm, true);
      document.removeEventListener("keydown", arm, true);
      for (const a of live.values()) a.cancel();
      live.clear();
      moving.clear();
    };
  }, [ref, routeKey, scrollReveal]);
}
