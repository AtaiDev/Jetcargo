/** Журнал действий: кто, что и когда сделал. Только администратор. */
import { useEffect, useState } from "react";

import { listAudit, type AuditEntry } from "../api/domain";
import { Empty } from "../components/cargo";
import { css, mix } from "../design/css";
import { MONO, PANEL, Page, THEAD, Toolbar } from "../design/table";
import { HButton, chipStyle } from "../design/ui";
import { dateTime } from "../lib/cargo";

const GRID = "140px 110px 150px 150px 2fr";

const ACTIONS: Record<string, { label: string; color: string; bg: string }> = {
  create: { label: "Добавление", color: "var(--accent-strong)", bg: "var(--accent-tint)" },
  update: { label: "Изменение", color: "var(--text-2)", bg: "var(--muted-bg)" },
  status: { label: "Статус", color: "var(--violet)", bg: "var(--violet-tint)" },
  payment: { label: "Оплата", color: "var(--green)", bg: "var(--green-tint)" },
  payment_cancel: { label: "Отмена оплаты", color: "var(--danger)", bg: "var(--danger-tint)" },
  scan: { label: "Приём сканером", color: "var(--accent-strong)", bg: "var(--accent-tint)" },
  issue: { label: "Выдача", color: "var(--green)", bg: "var(--green-tint)" },
  import: { label: "Импорт", color: "var(--amber)", bg: "var(--amber-tint)" },
  import_undo: { label: "Отмена импорта", color: "var(--danger)", bg: "var(--danger-tint)" },
  payment_fix: { label: "Исправление оплат", color: "var(--amber)", bg: "var(--amber-tint)" },
  delete: { label: "Удаление", color: "var(--danger)", bg: "var(--danger-tint)" },
};

const ENTITIES: Record<string, string> = { item: "Товар", customer: "Клиент", import: "Импорт", user: "Сотрудник" };

export default function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState<"all" | string>("all");

  useEffect(() => {
    listAudit({ limit: 500 })
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  const visible = rows.filter((r) => action === "all" || r.action === action);

  return (
    <Page size="wide">
      <Toolbar
        left={
          <div style={css("display:flex;gap:6px;flex-wrap:wrap")}>
            {["all", ...Object.keys(ACTIONS)].map((k) => (
              <HButton key={k} onClick={() => setAction(k)} s={chipStyle(action === k)} hover="border-color:var(--border-strong)">
                {k === "all" ? "Все" : ACTIONS[k].label}
              </HButton>
            ))}
          </div>
        }
      />
      <div style={css(PANEL)}>
        <div style={mix(THEAD, { gridTemplateColumns: GRID })}>
          {["Когда", "Сотрудник", "Действие", "Объект", "Детали"].map((h) => (
            <div key={h} style={css("padding:9px 14px")}>
              {h}
            </div>
          ))}
        </div>
        {visible.length === 0 ? (
          <Empty icon="audit" title="Записей нет" text="Здесь фиксируются добавления, изменения, оплаты, приёмы, выдачи, импорты и удаления" />
        ) : (
          visible.map((r) => {
            const a = ACTIONS[r.action] ?? { label: r.action, color: "var(--text-2)", bg: "var(--muted-bg)" };
            return (
              <div key={r.id} style={mix("display:grid;border-bottom:1px solid var(--hover);align-items:center", { gridTemplateColumns: GRID })}>
                <div style={css("padding:9px 14px;" + MONO + ";font-size:11.5px;color:var(--text-3)")}>{dateTime(r.created_at)}</div>
                <div style={css("padding:9px 14px;font-size:12.5px;font-weight:500;" + MONO)}>{r.user_login ?? "—"}</div>
                <div style={css("padding:9px 14px")}>
                  <span style={mix("display:inline-flex;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:20px", { color: a.color, background: a.bg })}>
                    {a.label}
                  </span>
                </div>
                <div style={css("padding:9px 14px;font-size:12.5px;color:var(--text-2)")}>
                  {ENTITIES[r.entity] ?? r.entity}
                  {r.entity_id ? ` №${r.entity_id}` : ""}
                </div>
                <div
                  style={css("padding:9px 14px;font-size:11.5px;color:var(--text-3);" + MONO + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}
                  title={[r.old_value, r.new_value].filter(Boolean).join(" → ")}
                >
                  {r.old_value ? `${r.old_value} → ` : ""}
                  {r.new_value ?? "—"}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Page>
  );
}
