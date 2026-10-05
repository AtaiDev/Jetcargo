/**
 * Заставка при открытии сайта (разметка и стили — в index.html).
 *
 * Видна с первого кадра, ещё до загрузки JS, и держится, пока приложение не узнает,
 * вошёл ли пользователь (на бесплатном Render сервер может просыпаться до минуты).
 * Потом плавно растворяется и удаляется из DOM.
 */

/** Не убирать раньше: иначе знак не успеет прорисоваться и заставка просто мигнёт. */
const MIN_VISIBLE_MS = 1100;
const FADE_MS = 450;

const waiting: (() => void)[] = [];

/**
 * Вызвать fn, когда заставка начнёт растворяться (сразу — если её уже нет).
 * Нужно анимациям первого экрана, например «бегущим» цифрам: иначе они отыграют под заставкой.
 * Возвращает отмену.
 */
export function afterBoot(fn: () => void): () => void {
  const el = document.getElementById("boot");
  if (!el || el.dataset.state === "done") {
    fn();
    return () => undefined;
  }
  waiting.push(fn);
  return () => {
    const i = waiting.indexOf(fn);
    if (i >= 0) waiting.splice(i, 1);
  };
}

export function hideBoot() {
  const el = document.getElementById("boot");
  if (!el || el.dataset.state) return;
  el.dataset.state = "closing";
  // performance.now() считается от начала загрузки страницы.
  window.setTimeout(() => {
    el.dataset.state = "done";
    for (const fn of waiting.splice(0)) fn();
    window.setTimeout(() => {
      el.remove();
      document.documentElement.removeAttribute("data-boot");
    }, FADE_MS + 50);
  }, Math.max(0, MIN_VISIBLE_MS - performance.now()));
}
