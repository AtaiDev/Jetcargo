/**
 * Раскладка графиков на обзоре (только админ): показать/скрыть и переставить.
 * Плитки показателей сверху не настраиваются — они видны всегда.
 */
import { useEffect, useState } from "react";

import { apiError } from "../../api/client";
import { listDashboardWidgets, patchDashboardWidget, type WidgetRow } from "../../api/domain";
import { css, mix } from "../../design/css";
import { I_SLIDERS, Svg } from "../../design/icons";
import { HButton, ModalError, ModalShell, btnGhost } from "../../design/ui";

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
      icon={<Svg paths={I_SLIDERS} size={15} sw={1.7} />}
      onClose={onClose}
      width={520}
      footer={
        <HButton onClick={onClose} s={btnGhost} hover="border-color:var(--accent)">
          Готово
        </HButton>
      }
    >
      <div style={css("padding:16px 18px;display:flex;flex-direction:column;gap:6px")}>
        {error && <ModalError text={error} />}
        {rows.map((w, i) => (
          <div
            key={w.id}
            style={css("display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2)")}
          >
            <label style={css("display:flex;align-items:center;gap:6px;cursor:pointer;flex:none;min-width:82px")}>
              <input
                type="checkbox"
                checked={w.is_visible}
                onChange={(e) => act(() => patchDashboardWidget(w.id, { is_visible: e.target.checked }))}
                style={css("width:15px;height:15px;accent-color:var(--accent);cursor:pointer")}
              />
              <span style={mix("font-size:11.5px;font-weight:500", { color: w.is_visible ? "var(--text-2)" : "var(--text-4)" })}>
                {w.is_visible ? "Показан" : "Скрыт"}
              </span>
            </label>
            <div style={css("flex:1;font-size:13px;font-weight:500")}>{w.title}</div>
            <HButton onClick={() => move(i, -1)} s={`${btnGhost};padding:3px 8px;font-size:13px;height:28px;${i === 0 ? "opacity:.35" : ""}`} hover="border-color:var(--accent)">
              ↑
            </HButton>
            <HButton
              onClick={() => move(i, 1)}
              s={`${btnGhost};padding:3px 8px;font-size:13px;height:28px;${i === rows.length - 1 ? "opacity:.35" : ""}`}
              hover="border-color:var(--accent)"
            >
              ↓
            </HButton>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
