/**
 * Общая логика Cargo: пользователь запроса, аудит, телефоны, клиенты, заказы,
 * товары и история статусов. Формы ответов совпадают с web-admin/src/api/domain.ts.
 */
import type { NextFunction, Request, Response } from "express";

import { all, get, run, type Param } from "./db";
import { readToken } from "./security";
import { HttpError, badRequest, notFound, nowIso } from "./util";

// --- Пользователь запроса --------------------------------------------------------

export interface AuthUser {
  id: number;
  login: string;
  full_name: string;
  role: "admin" | "staff";
  is_active: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export function userById(id: number): AuthUser | undefined {
  const u = get<{ id: number; login: string; full_name: string; role: "admin" | "staff"; is_active: number }>(
    "SELECT id, login, full_name, role, is_active FROM users WHERE id = ?",
    id
  );
  return u && { ...u, is_active: !!u.is_active };
}

/** Требует валидный access-токен активного пользователя. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const id = token ? readToken(token, "access") : null;
  const user = id !== null ? userById(id) : undefined;
  if (!user || !user.is_active) throw new HttpError(401, "Не авторизован");
  req.user = user;
  next();
}

export function requireAdmin(req: Request) {
  if (req.user?.role !== "admin") throw new HttpError(403, "Недостаточно прав");
}

export function audit(
  req: Request,
  action: string,
  entity: string,
  entityId: number | null,
  oldValue: unknown = null,
  newValue: unknown = null
) {
  const s = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));
  run(
    "INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)",
    req.user?.id ?? null, action, entity, entityId, s(oldValue), s(newValue)
  );
}

// --- Телефоны и коды --------------------------------------------------------------

/**
 * Каноничные цифры номера: «0700 123 456», «700123456» и «+996 700 123 456» —
 * это один и тот же номер 996700123456. Чужие форматы оставляем как есть.
 */
export function canonPhone(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("996")) return d;
  if (d.length === 10 && d.startsWith("0")) return "996" + d.slice(1);
  if (d.length === 9) return "996" + d;
  return d;
}

/** Номер для показа: +996 700 123 456. */
export function formatPhone(raw: string): string {
  const d = canonPhone(raw);
  if (d.length === 12 && d.startsWith("996")) {
    return `+996 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  }
  return String(raw ?? "").trim();
}

/** Код товара для сканера: без пробелов и в верхнем регистре. */
export const normCode = (code: string) => String(code ?? "").replace(/\s+/g, "").toUpperCase();

// --- Статусы ---------------------------------------------------------------------

export type ItemStatus = "ordered" | "in_stock" | "issued";
export const ITEM_STATUSES: ItemStatus[] = ["ordered", "in_stock", "issued"];

export function itemStatus(v: unknown): ItemStatus {
  if (!ITEM_STATUSES.includes(v as ItemStatus)) throw badRequest("Статус: ordered, in_stock или issued");
  return v as ItemStatus;
}

/** Сменить статус товара и записать переход в историю. Даты поступления/выдачи ставятся сами. */
export function setStatus(
  itemId: number,
  to: ItemStatus,
  source: "create" | "manual" | "scan" | "issue" | "import",
  userId: number | null,
  opts: { comment?: string; issueId?: number | null; at?: string; initial?: boolean } = {}
) {
  const item = get<{ status: ItemStatus; arrived_at: string | null }>(
    "SELECT status, arrived_at FROM order_items WHERE id = ?",
    itemId
  );
  if (!item) throw notFound("Товар");
  const at = opts.at ?? nowIso();
  const initial = source === "create" || !!opts.initial;
  if (item.status === to && !initial) return;

  const arrived = to === "ordered" ? null : (item.arrived_at ?? at);
  const issued = to === "issued" ? at : null;
  run(
    "UPDATE order_items SET status = ?, arrived_at = ?, issued_at = ?, issue_id = ?, updated_at = ? WHERE id = ?",
    to, arrived, issued, to === "issued" ? (opts.issueId ?? null) : null, nowIso(), itemId
  );
  run(
    "INSERT INTO status_history (order_item_id, from_status, to_status, source, comment, user_id, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    itemId, initial ? null : item.status, to, source, opts.comment ?? "", userId, at
  );
}

// --- Клиенты и заказы ----------------------------------------------------------------

/** Найти клиента по номеру (или по имени, если номера нет) либо создать нового. */
export function findOrCreateCustomer(name: string, phone: string, importId: number | null = null): { id: number; created: boolean } {
  const digits = canonPhone(phone);
  if (digits) {
    const found = get<{ id: number }>(
      "SELECT id FROM customers WHERE phone_digits = ? AND deleted_at IS NULL ORDER BY id LIMIT 1",
      digits
    );
    if (found) return { id: found.id, created: false };
  } else {
    const found = get<{ id: number }>(
      "SELECT id FROM customers WHERE phone_digits = '' AND norm(name) = norm(?) AND deleted_at IS NULL ORDER BY id LIMIT 1",
      name
    );
    if (found) return { id: found.id, created: false };
  }
  if (!name.trim()) throw badRequest("Укажите имя клиента");
  const id = run(
    "INSERT INTO customers (name, phone, phone_digits, import_id) VALUES (?, ?, ?, ?)",
    name.trim(), formatPhone(phone), digits, importId
  );
  return { id, created: true };
}

/** Заказ = клиент + дата заказа. Товары одного клиента за один день попадают в один заказ. */
export function findOrCreateOrder(customerId: number, orderDate: string, userId: number | null, importId: number | null = null): number {
  const found = get<{ id: number }>(
    "SELECT id FROM orders WHERE customer_id = ? AND order_date = ? AND deleted_at IS NULL ORDER BY id LIMIT 1",
    customerId, orderDate
  );
  if (found) return found.id;
  return run(
    "INSERT INTO orders (customer_id, order_date, import_id, created_by) VALUES (?, ?, ?, ?)",
    customerId, orderDate, importId, userId
  );
}

// --- Товары -------------------------------------------------------------------------

export interface ItemView {
  id: number;
  order_id: number;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  customer_code: string | null;
  order_date: string;
  name: string;
  code: string;
  qty: number;
  price: number;
  price_cny: number | null;
  real_price: number | null;
  cost: number | null;
  sale: number;
  paid: number;
  debt: number;
  pay_status: "unpaid" | "partial" | "paid";
  split_with: string;
  comment: string;
  status: ItemStatus;
  arrived_at: string | null;
  issued_at: string | null;
  issue_id: number | null;
  import_id: number | null;
  batch_id: number | null;
  created_at: string;
  updated_at: string;
}

const ITEM_COLS = `id, order_id, customer_id, customer_name, customer_phone, customer_code, order_date,
  name, code, qty, price, price_cny, real_price, cost, sale, paid, debt, pay_status, split_with, comment,
  status, arrived_at, issued_at, issue_id, import_id, batch_id, created_at, updated_at`;

export function items(where = "1 = 1", params: Param[] = [], tail = "ORDER BY order_date DESC, id DESC"): ItemView[] {
  return all<ItemView>(`SELECT ${ITEM_COLS} FROM v_items WHERE ${where} ${tail}`, ...params);
}

export function itemOr404(id: number): ItemView {
  const it = items("id = ?", [id])[0];
  if (!it) throw notFound("Товар");
  return it;
}

/**
 * Настоящий долг по товару. Правило владельца: без оплаты товар не выдаётся, значит
 * у выданного товара долга нет (даже если оплата не записана — например, из Excel).
 * Записи об оплатах не меняются — меняется только то, что считаем долгом.
 */
export const openDebt = (i: Pick<ItemView, "status" | "debt">) => (i.status === "issued" ? 0 : i.debt);

/** SQL-условие «товар с настоящим долгом» для v_items (алиас можно передать). */
export const openDebtSql = (alias = "") => `(${alias}debt > 0 AND ${alias}status <> 'issued')`;

/** Суммы по набору товаров — одна формула для клиента, склада, дашборда и финансов. */
export function totals(list: ItemView[]) {
  const withCost = list.filter((i) => i.cost !== null);
  const debt = list.reduce((s, i) => s + openDebt(i), 0);
  const sale = list.reduce((s, i) => s + i.sale, 0);
  return {
    items: list.length,
    qty: list.reduce((s, i) => s + i.qty, 0),
    sale,
    // Выданный считается оплаченным: оплачено = сумма − настоящий долг.
    paid: sale - debt,
    debt,
    cost: withCost.reduce((s, i) => s + (i.cost ?? 0), 0),
    profit: withCost.reduce((s, i) => s + i.sale - (i.cost ?? 0), 0),
    with_cost: withCost.length,
    ordered: list.filter((i) => i.status === "ordered").length,
    in_stock: list.filter((i) => i.status === "in_stock").length,
    issued: list.filter((i) => i.status === "issued").length,
    unpaid_items: list.filter((i) => openDebt(i) > 0).length,
  };
}
