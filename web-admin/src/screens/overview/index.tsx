/**
 * Обзор — главная для руководителя: деньги, заказы, склад и клиенты за секунды.
 *
 * Заголовок и «ждут выдачи», период, четыре карточки, шкала оплаты, сумма заказов по месяцам,
 * работа склада по времени, товары по этапам (Home.tsx). Все числа считает сервер из реальных
 * данных (dashboard.home).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { apiError } from "../../api/client";
import { getDashboard, type Dashboard } from "../../api/domain";
import { periodOf, type Period } from "../../components/cargo";
import { css } from "../../design/css";
import { Page } from "../../design/table";
import { useRefresh } from "../../lib/events";
import { HomeBoardView, HomeHead, HomeSkeleton, HomeToolbar, exportHome } from "./Home";

export default function Overview(_: { isDesktop: boolean; isAdmin: boolean }) {
  const [period, setPeriod] = useState<Period>(() => periodOf("month"));
  const [board, setBoard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getDashboard({ date_from: period.date_from, date_to: period.date_to })
      .then((b) => {
        setBoard(b);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить показатели")));
  }, [period.date_from, period.date_to]);
  useEffect(load, [load]);
  useRefresh(load);

  // Страница — ровно по высоте экрана: нижний ряд забирает оставшееся место (на широком экране).
  const ovRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const ov = ovRef.current;
    const main = ov?.closest("main");
    if (!ov || !main) return;
    const fit = () => {
      if (window.innerWidth < 1180) {
        ov.style.minHeight = "";
        return;
      }
      // offsetTop, а не getBoundingClientRect: анимация появления сдвигает блоки transform-ом.
      let top = 0;
      for (let el: HTMLElement | null = ov; el && el !== main; el = el.offsetParent as HTMLElement | null) top += el.offsetTop;
      ov.style.minHeight = `${Math.max(0, main.clientHeight - top - 18)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(main);
    return () => ro.disconnect();
  }, []);

  return (
    <Page size="wide">
      {/* data-no-reveal: при смене периода цифры меняются на месте — общая анимация появления их не трогает */}
      <div className="ov" ref={ovRef} data-no-reveal>
        <HomeHead waiting={board?.home?.waiting ?? null} />
        <HomeToolbar
          periodKey={period.key}
          from={period.date_from}
          to={period.date_to}
          onPeriod={(k) => setPeriod(periodOf(k))}
          onExport={() => board?.home && exportHome(board.home, period.date_from, period.date_to)}
        />

        {error && (
          <div style={css("padding:12px 14px;border:1px solid var(--danger-border);background:var(--danger-tint);color:var(--danger);border-radius:14px;font-size:12.5px")}>
            {error}
          </div>
        )}

        {/* Пока грузится — скелетон тех же форм; старый сервер без home — пусто, без ошибки */}
        {!board ? !error && <HomeSkeleton /> : board.home ? <HomeBoardView h={board.home} /> : null}
      </div>
    </Page>
  );
}
