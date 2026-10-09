/**
 * Раскладка графиков на обзоре (только админ): показать/скрыть и переставить.
 * Плитки показателей сверху не настраиваются — они видны всегда.
 */
import { useEffect, useState } from "react";

import { apiError } from "../../api/client";
import { listDashboardWidgets, patchDashboardWidget, type WidgetRow } from "../../api/domain";
import { css, mix } from "../../design/css";
import { I_SLIDERS, Svg } from "../../design/icons";
import { ModalCancel, ModalError, ModalShell } from "../../design/ui";

export default function Customize({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<WidgetRow[]>([]);
  const [error, setError] = useState("");

  const load = () =>
    listDashboardWidgets()
      .then(setRows)
      .catch((e) => setError(apiError(e, "Не удалось загрузить список графиков")));

  useEffect(() => {
    load();
  }, []);

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(apiError(e, "Не удалось изменить"));
    }
  }

  // Перестановка — обменом позиций с соседом.
  async function move(index: number, dir: -1 | 1) {
    const a = rows[index];
    const b = rows[index + dir];
    if (!a || !b) return;
    await act(async () => {
      await patchDashboardWidget(a.id, { position: b.position });
      await patchDashboardWidget(b.id, { position: a.position });
    });
  }

  return (
    <ModalShell
      title="Графики на обзоре"
      subtitle={rows.length ? `показано ${rows.filter((w) => w.is_visible).length} из ${rows.length} · порядок — стрелками` : "Какие графики показывать и в каком порядке"}
      icon={<Svg paths={I_SLIDERS} size={17} sw={1.7} />}
      onClose={onClose}
      width={520}
      footer={<ModalCancel>Готово</ModalCancel>}
    >
      <div style={css("padding:16px 18px;display:flex;flex-direction:column;gap:8px")}>
        {error && <ModalError text={error} />}
        {rows.length === 0 &&
          !error &&
          [0, 1, 2, 3].map((i) => <span key={i} className="sk" style={css("height:52px;border-radius:12px")} />)}
        {rows.map((w, i) => (
          <div key={w.id} className={"cz-row" + (w.is_visible ? "" : " off")}>
            <span className="cz-n">{i + 1}</span>
            <span style={css("flex:1;min-width:0")}>
              <span style={css("display:block;font-size:13.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{w.title}</span>
              <span style={mix("display:block;font-size:12px", { color: w.is_visible ? "var(--green)" : "var(--text-4)" })}>{w.is_visible ? "показан на обзоре" : "скрыт"}</span>
            </span>
            <button type="button" className="cz-arrow" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Выше">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="M3.5 8.5 7 5l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="cz-arrow" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Ниже">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="M3.5 5.5 7 9l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={w.is_visible}
              aria-label={w.is_visible ? "Скрыть график" : "Показать график"}
              className={"cz-sw" + (w.is_visible ? " on" : "")}
              onClick={() => act(() => patchDashboardWidget(w.id, { is_visible: !w.is_visible }))}
            >
              <span />
            </button>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
