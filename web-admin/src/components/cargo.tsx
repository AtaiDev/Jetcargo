/**
 * Мелкие общие компоненты Cargo: бейджи, деньги, пагинация, вкладки, период,
 * пустое состояние, подтверждение. Всё на токенах дизайн-системы.
 */
import { useState, type ReactNode } from "react";

import type { Item } from "../api/domain";
import { MONO, css, mix } from "../design/css";
import { I_ALERT, Icon, Svg } from "../design/icons";
import { EMPTY_ICON } from "../design/table";
import DatePicker from "./DatePicker";
import { HButton, ModalError, ModalCancel, ModalShell, StatusBadge, btnDanger, btnPrimary, inputStyle } from "../design/ui";
import { monthStartIso, profitOf, som, todayIso } from "../lib/cargo";

// --- Статус и оплата -------------------------------------------------------------------

export function ItemStatusBadge({ item, size = "md" }: { item: Pick<Item, "status" | "stage">; size?: "sm" | "md" }) {
  return <StatusBadge status={item.stage ?? item.status} size={size} />;
}

/** Оплата: бейдж + долг под ним, если есть. */
export function PayCell({ item, compact }: { item: Pick<Item, "pay_status" | "debt">; compact?: boolean }) {
  return (
    <div style={css("display:flex;flex-direction:column;gap:2px;align-items:flex-start")}>
      <StatusBadge status={item.pay_status} size="sm" />
      {item.debt > 0 && !compact && (
        <span style={css(MONO + ";font-size:11px;color:var(--amber);font-weight:600")}>долг {som(item.debt)}</span>
      )}
    </div>
  );
}

/** Сумма — цена для клиента (по ней считаются оплата и долг). */
export function SaleCell({ item }: { item: Pick<Item, "sale"> }) {
  return <span style={css(MONO + ";font-size:12.5px;font-weight:600;white-space:nowrap")}>{som(item.sale)}</span>;
}

/** Прибыль = Сумма − Реальная цена (выкуп). Под ней — сам выкуп. Без реальной цены — прочерк. */
export function ProfitCell({ item }: { item: Pick<Item, "sale" | "cost"> }) {
  const p = profitOf(item);
  if (p === null) {
    return (
      <span style={css("font-size:11px;color:var(--text-4);white-space:nowrap")} title="Укажите реальную цену в карточке товара">
        нет выкупа
      </span>
    );
  }
  return (
    <div style={css("display:flex;flex-direction:column;align-items:flex-end")}>
      <span style={mix(MONO + ";font-size:12.5px;font-weight:600;white-space:nowrap", { color: p < 0 ? "var(--danger)" : "var(--green)" })}>
        {p > 0 ? "+" : ""}
        {som(p)}
      </span>
      <span style={css(MONO + ";font-size:10.5px;color:var(--text-4);white-space:nowrap")} title="Реальная цена (выкуп)">
        выкуп {som(item.cost)}
      </span>
    </div>
  );
}

// --- Пагинация -----------------------------------------------------------------------

export function Pager({
  total,
  offset,
  limit,
  onChange,
}: {
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const to = Math.min(offset + limit, total);
  const btn = (disabled: boolean) =>
    `height:30px;padding:0 12px;border:1px solid var(--border);background:var(--surface);border-radius:7px;font-size:12px;cursor:${disabled ? "default" : "pointer"};opacity:${disabled ? 0.4 : 1}`;
  return (
    <div style={css("display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 4px 0;font-size:12px;color:var(--text-3)")}>
      <span style={css(MONO)}>
        {offset + 1}–{to} из {total}
      </span>
      <HButton disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} s={btn(offset === 0)} hover="border-color:var(--accent)">
        ← Назад
      </HButton>
      <HButton disabled={to >= total} onClick={() => onChange(offset + limit)} s={btn(to >= total)} hover="border-color:var(--accent)">
        Вперёд →
      </HButton>
    </div>
  );
}

// --- Вкладки с счётчиками --------------------------------------------------------------

export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: K; label: string; count?: number; dot?: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div style={css("display:inline-flex;gap:3px;flex-wrap:wrap;background:var(--border-2);padding:3px;border-radius:9px")}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={mix(
              "height:28px;padding:0 11px;border-radius:7px;border:none;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px",
              {
                background: active ? "var(--surface)" : "transparent",
                color: active ? "var(--text)" : "var(--text-2)",
                fontWeight: 500,
                boxShadow: active ? "0 1px 2px rgba(0,0,0,.08)" : "none",
              }
            )}
          >
            {t.dot && <span style={mix("width:6px;height:6px;border-radius:50%", { background: t.dot })} />}
            {t.label}
            {t.count !== undefined && <span style={css(MONO + ";font-size:11px;color:var(--text-4)")}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// --- Период ---------------------------------------------------------------------------

export type PeriodKey = "today" | "7" | "30" | "month" | "90" | "year" | "custom";
export interface Period {
  key: PeriodKey;
  date_from: string;
  date_to: string;
}

export function periodOf(key: PeriodKey, custom?: { date_from: string; date_to: string }): Period {
  const t = todayIso();
  switch (key) {
    case "today":
      return { key, date_from: t, date_to: t };
    case "7":
      return { key, date_from: todayIso(-6), date_to: t };
    case "30":
      return { key, date_from: todayIso(-29), date_to: t };
    case "90":
      return { key, date_from: todayIso(-89), date_to: t };
    case "year":
      return { key, date_from: `${t.slice(0, 4)}-01-01`, date_to: t };
    case "custom":
      return { key, date_from: custom?.date_from ?? monthStartIso(), date_to: custom?.date_to ?? t };
    case "month":
    default:
      return { key: "month", date_from: monthStartIso(), date_to: t };
  }
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "7", label: "7 дней" },
  { key: "month", label: "Этот месяц" },
  { key: "30", label: "30 дней" },
  { key: "90", label: "90 дней" },
  { key: "year", label: "Год" },
  { key: "custom", label: "Период…" },
];

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const range: [string, string] = [value.date_from, value.date_to];
  return (
    <div style={css("display:flex;flex-wrap:wrap;gap:6px;align-items:center")}>
      {PERIODS.map((p) => {
        const active = value.key === p.key;
        return (
          <HButton
            key={p.key}
            onClick={() => onChange(periodOf(p.key, value))}
            s={`height:30px;padding:0 11px;border-radius:16px;font-size:12px;cursor:pointer;border:1px solid ${active ? "var(--accent)" : "var(--border)"};background:${active ? "var(--accent-tint)" : "var(--surface)"};color:${active ? "var(--accent-strong)" : "var(--text-2)"};font-weight:${active ? 600 : 500}`}
            hover="border-color:var(--accent)"
          >
            {p.label}
          </HButton>
        );
      })}
      {value.key === "custom" && (
        <span style={css("display:flex;gap:6px;align-items:center")}>
          <DatePicker value={value.date_from} max={value.date_to} range={range} onChange={(d) => onChange({ ...value, date_from: d })} height={30} fontSize={12} ariaLabel="Начало периода" />
          <span style={css("color:var(--text-4)")}>—</span>
          <DatePicker value={value.date_to} min={value.date_from} range={range} onChange={(d) => onChange({ ...value, date_to: d })} height={30} fontSize={12} ariaLabel="Конец периода" />
        </span>
      )}
    </div>
  );
}

// --- Пустое состояние -----------------------------------------------------------------

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div style={css("padding:46px 20px;text-align:center;color:var(--text-3)")}>
      <div style={css(EMPTY_ICON)}>
        <Icon name={icon} size={24} />
      </div>
      <div style={css("font-size:13.5px;font-weight:500;color:var(--text-2)")}>{title}</div>
      {text && <div style={css("font-size:12px;margin-top:3px;max-width:420px;margin-left:auto;margin-right:auto;line-height:1.5")}>{text}</div>}
      {action && <div style={css("margin-top:14px;display:flex;justify-content:center")}>{action}</div>}
    </div>
  );
}

// --- Подтверждение опасного действия ------------------------------------------------------

export function Confirm({
  title,
  text,
  confirmLabel = "Удалить",
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  text: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <ModalShell
      title={title}
      tone={danger ? "danger" : "accent"}
      icon={<Svg paths={I_ALERT} size={16} sw={2} />}
      onClose={onClose}
      width={420}
      footer={
        <>
          <ModalCancel>Отмена</ModalCancel>
          <HButton
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onConfirm();
              } catch (e) {
                setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Не удалось выполнить");
                setBusy(false);
              }
            }}
            s={danger ? btnDanger : btnPrimary}
            hover={danger ? "background:var(--danger-solid-hover)" : "background:var(--accent-hover)"}
          >
            {busy ? "Секунду…" : confirmLabel}
          </HButton>
        </>
      }
    >
      <div style={css("padding:18px 20px;display:flex;flex-direction:column;gap:12px;font-size:13.5px;line-height:1.6;color:var(--text-2)")}>
        <div>{text}</div>
        <ModalError text={error} />
      </div>
    </ModalShell>
  );
}

/** Поле ввода суммы с моноширинным шрифтом и подсказкой «с». */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter,
  big,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  big?: boolean;
}) {
  return (
    <div style={css("position:relative")}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        inputMode="decimal"
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={mix(inputStyle + ";" + MONO + ";padding-right:30px", big ? "height:48px;font-size:22px;font-weight:600" : "")}
      />
      <span style={css("position:absolute;right:11px;top:50%;transform:translateY(-50%);color:var(--text-4);font-size:12px;pointer-events:none")}>
        сом
      </span>
    </div>
  );
}
