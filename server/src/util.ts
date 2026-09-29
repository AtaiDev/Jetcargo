/** Общие помощники: ошибки API, даты, разбор параметров, поиск. */

/** Ошибка с HTTP-статусом. Админка показывает пользователю поле detail. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public detail: string
  ) {
    super(detail);
  }
}

export const notFound = (what = "Объект") => new HttpError(404, `${what} не найден`);
export const badRequest = (detail: string) => new HttpError(422, detail);
export const conflict = (detail: string) => new HttpError(409, detail);

/** Дата в локальном часовом поясе машины: YYYY-MM-DD. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const today = () => isoDate(new Date());
export const nowIso = () => new Date().toISOString();

/** Локальный день для отметки времени в ISO (UTC). */
export const localDay = (iso: string) => isoDate(new Date(iso));

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Суток аренды между датами, минимум 1. */
export function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

export function dayList(from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseDate(v: unknown, field: string): string {
  const s = String(v ?? "");
  if (!DATE_RE.test(s) || Number.isNaN(new Date(s).getTime())) throw badRequest(`Некорректная дата: ${field}`);
  return s;
}

export function optInt(v: unknown): number | undefined {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? undefined : Math.trunc(n);
}

export function num(v: unknown, field: string, { min = 0 } = {}): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < min) throw badRequest(`Некорректное значение: ${field}`);
  return n;
}

export function posInt(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field}: нужно целое число больше нуля`);
  return n;
}

export function str(v: unknown, max = 500): string {
  return String(v ?? "").trim().slice(0, max);
}

// --- Поиск: те же правила, что в админке (src/lib/search.ts) -----------------

export const normText = (s: string) => s.toLowerCase().replace(/ё/g, "е");

export function phoneDigits(s: string): string {
  const d = s.replace(/\D/g, "");
  return d.startsWith("0") ? d.slice(1) : d;
}

export const matchText = (hay: string, q: string) => normText(hay).includes(normText(q));

export function matchPhone(phone: string, q: string): boolean {
  const d = phoneDigits(q);
  return d.length > 0 && phoneDigits(phone).includes(d);
}

export function matchNumber(id: number, q: string): boolean {
  const d = q.replace(/\D/g, "");
  return d.length > 0 && String(id).includes(d);
}
