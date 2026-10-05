/**
 * Полоса «Тестовая среда» поверх всего окна, если сервер работает на тестовой базе
 * (локальный запуск, server/scripts/seed-test.mjs). Так локальную панель не спутать с рабочей:
 * в ней вымышленные клиенты, и ничего отсюда в рабочие данные не попадает.
 * На рабочей базе ничего не показывает. Клики не перехватывает.
 */
import { useEffect, useState } from "react";
import { getEnvironment } from "../api/domain";

export default function TestBanner() {
  const [test, setTest] = useState(false);

  useEffect(() => {
    getEnvironment()
      .then((env) => setTest(env === "test"))
      .catch(() => setTest(false));
  }, []);

  useEffect(() => {
    if (!test) return;
    const root = document.documentElement;
    root.classList.add("is-test");
    // Вкладка тоже подписана — заметно даже среди открытых рядом окон.
    const sync = () => {
      if (!document.title.startsWith("ТЕСТ · ")) document.title = `ТЕСТ · ${document.title}`;
    };
    sync();
    const titleEl = document.querySelector("title");
    const mo = titleEl ? new MutationObserver(sync) : null;
    if (titleEl) mo!.observe(titleEl, { childList: true });
    return () => {
      root.classList.remove("is-test");
      mo?.disconnect();
    };
  }, [test]);

  if (!test) return null;
  return (
    <div className="test-bar" role="status">
      <b>ТЕСТ</b>
      <span>
        Тестовая среда<span className="test-bar-long"> · вымышленные данные, рабочая база не затрагивается</span>
      </span>
    </div>
  );
}
