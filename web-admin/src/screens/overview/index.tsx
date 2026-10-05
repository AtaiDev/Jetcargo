/**
 * Обзор — главная для руководителя: деньги, заказы, склад и клиенты за секунды.
 *
 * Все числа считает сервер из реальных данных. Прибыль = наценка на товары (Сумма − Реальная
 * цена, только где реальная цена указана) + по партиям: вес клиентам − выкуп веса − доставка.
 * Плитки кликабельны — ведут в нужный отфильтрованный список.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { apiError } from "../../api/client";
import { getDashboard, type Dashboard } from "../../api/domain";
import { PeriodPicker, periodOf, type Period } from "../../components/cargo";
import { css } from "../../design/css";
import { I_SLIDERS, Svg } from "../../design/icons";
import { PANEL, Page } from "../../design/table";
import { HButton, SkeletonRows } from "../../design/ui";
import { useRefresh } from "../../lib/events";
import Customize from "./Customize";
import Summary from "./Summary";
import WidgetRenderer from "./WidgetRenderer";

export default function Overview({ isDesktop, isAdmin }: { isDesktop: boolean; isAdmin: boolean }) {
  const [period, setPeriod] = useState<Period>(() => periodOf("month"));
  const [board, setBoard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [tuning, setTuning] = useState(false);

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


  return (
    <Page size="wide">
      <div style={css("display:flex;flex-direction:column;gap:16px")}>
        <div style={css("display:flex;flex-wrap:wrap;gap:8px;align-items:center")}>
          <PeriodPicker value={period} onChange={setPeriod} />
          {isAdmin && (
            <HButton
              onClick={() => setTuning(true)}
              s="margin-left:auto;display:flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text-2);border-radius:16px;font-size:12px;cursor:pointer"
              hover="border-color:var(--accent);color:var(--accent)"
            >
              <Svg paths={I_SLIDERS} size={13} sw={1.7} />
              Настроить графики
            </HButton>
          )}
        </div>

        {error && (
          <div style={css("padding:12px 14px;border:1px solid var(--danger-border);background:var(--danger-tint);color:var(--danger);border-radius:8px;font-size:12.5px")}>
            {error}
          </div>
        )}
        {!board && !error && <SkeletonRows rows={5} />}

        {board && (
          <>
            <Summary board={board} isDesktop={isDesktop} periodLabel={periodLabel(period)} />

            <Heading>Графики</Heading>
            <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "repeat(3, minmax(0, 1fr))" : "1fr", gap: 14 }}>
              {board.widgets.map((w) => (
                <section key={w.id} style={{ ...css(PANEL + ";border-radius:14px;min-width:0"), gridColumn: isDesktop ? `span ${Math.min(w.span, 3)}` : undefined }}>
                  <div style={css("padding:16px 18px 0;font-size:13.5px;font-weight:700;color:var(--text)")}>{w.title}</div>
                  <div style={css("padding:12px 18px 16px")}>
                    <WidgetRenderer widget={w} />
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
      {tuning && <Customize onClose={() => setTuning(false)} onChanged={load} />}
    </Page>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <div style={css("font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin:6px 2px -4px")}>
      {children}
    </div>
  );
}

/** Подпись периода для заголовка блока «Деньги». */
function periodLabel(p: Period): string {
  const d = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  return p.date_from === p.date_to ? d(p.date_from) : `${d(p.date_from)} — ${d(p.date_to)}`;
}
