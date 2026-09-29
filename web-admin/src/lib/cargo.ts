/** Форматирование и справочники Cargo — одни на все экраны. */
import type { Item, ItemStatus, PayStatus, ScanResult } from "../api/domain";

export const STATUS_LABEL: Record<ItemStatus, string> = {
  ordered: "Заказан",
  in_stock: "На складе",
  issued: "Выдан",
};

export const PAY_LABEL: Record<PayStatus, string> = {
  unpaid: "Не оплачено",
  partial: "Частично",
  paid: "Оплачено",
};

export const SCAN_LABEL: Record<ScanResult, string> = {
  arrived: "Поступил на склад",
  already_in_stock: "Повторное сканирование",
  already_issued: "Уже выдан",
  not_found: "Код не найден",
};

export const SOURCE_LABEL: Record<string, string> = {
  create: "добавлен",
  manual: "вручную",
  scan: "сканер",
  issue: "выдача",
  import: "импорт",
};

export const METHOD_LABEL: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  import: "Из Excel",
  other: "Другое",
};
/** Способы оплаты для выпадающего списка (без служебного «Из Excel»). */
export const METHOD_OPTIONS = (["cash", "card", "transfer", "other"] as const).map((m) => ({ value: m as string, label: METHOD_LABEL[m] }));

/** 1 250 сом. Дробные — до копеек. */
export function som(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} с`;
}

/** Число без валюты: 1 250. */
export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD → 14.09.2026 */
export function date(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}.${m}.${y}`;
}

/** ISO-время → 14.09.2026 12:30 (местное время). */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** ISO-время → 14.09 12:30 — для плотных таблиц. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Сегодня в формате API. */
export function todayIso(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function monthStartIso(): string {
  return todayIso().slice(0, 8) + "01";
}

/** Разбор суммы из поля ввода: «1 250,5» → 1250.5; пусто → null. */
/** Первая буква заглавная: «часы» → «Часы». Остальное не трогаем. */
export const capFirst = (s: string) => s.replace(/^(\s*)(\p{L})/u, (_, sp: string, ch: string) => sp + ch.toUpperCase());
/** Коды товаров всегда заглавными. */
export const upper = (s: string) => s.toUpperCase();

/**
 * Меняет регистр прямо в поле ввода и возвращает новое значение для state.
 * Значение в DOM правим сами и возвращаем курсор на место — иначе React
 * увидит другую строку и перекинет курсор в конец при правке середины.
 */
export function cased(e: { target: HTMLInputElement }, fn: (s: string) => string): string {
  const el = e.target;
  const next = fn(el.value);
  if (next !== el.value) {
    const { selectionStart: a, selectionEnd: b } = el;
    el.value = next;
    if (a !== null && b !== null) el.setSelectionRange(a, b);
  }
  return next;
}

export function parseMoney(s: string): number | null {
  const t = s.replace(/[\s ]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/** Прибыль по товару: Сумма − Реальная цена (выкуп); null — реальная цена не указана. */
export const profitOf = (it: Pick<Item, "sale" | "cost">): number | null => (it.cost === null ? null : it.sale - it.cost);
