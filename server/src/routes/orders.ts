/**
 * Новый заказ целиком: клиент + несколько товаров + статус + оплата — одной транзакцией.
 * Либо сохраняется весь заказ, либо ничего (при ошибке в любой строке).
 */
import { Router } from "express";

import { run, tx } from "../db";
import { audit, findOrCreateCustomer, findOrCreateOrder, itemOr404, itemStatus, items, normCode, setStatus } from "../domain";
import { badRequest, conflict, nowIso, num, optInt, parseDate, str, today } from "../util";
import { customerOr404 } from "./customers";

export const ordersRouter = Router();

interface Line {
  name: string;
  code: string;
  qty: number;
  price: number;
  real_price: number | null;
  price_cny: number | null;
  comment: string;
}

const money = (v: unknown, field: string): number | null =>
  v === null || v === undefined || v === "" ? null : num(String(v).replace(/\s/g, "").replace(",", "."), field);

ordersRouter.post("/orders", (req, res) => {
  const b = req.body ?? {};
  const raw: unknown[] = Array.isArray(b.items) ? b.items : [];
  if (!raw.length) throw badRequest("Добавьте хотя бы один товар");
  if (raw.length > 200) throw badRequest("Не больше 200 товаров в одном заказе");

  const lines: Line[] = raw.map((x, i) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const n = i + 1;
    const name = str(r.name, 300);
    if (!name) throw badRequest(`Строка ${n}: укажите название товара`);
    const qty = Number(r.qty ?? 1);
    if (!Number.isInteger(qty) || qty <= 0) throw badRequest(`Строка ${n}: количество — целое число больше нуля`);
    const price = money(r.price, `Строка ${n}: сумма`);
    if (price === null) throw badRequest(`Строка ${n}: укажите сумму`);
    return {
      name,
      code: str(r.code, 100),
      qty,
      price,
      real_price: money(r.real_price, `Строка ${n}: реальная цена`),
      price_cny: money(r.price_cny, `Строка ${n}: цена ¥`),
      comment: str(r.comment, 1000),
    };
  });

  const status = b.status ? itemStatus(b.status) : "ordered";
  if (status === "issued") throw badRequest("Новый заказ не может быть сразу выданным");
  const orderDate = b.order_date ? parseDate(b.order_date, "дата заказа") : today();
  const comment = str(b.comment, 1000);
  const pay: "none" | "full" | "part" = b.pay === "full" || b.pay === "part" ? b.pay : "none";
  const total = lines.reduce((s, l) => s + l.price, 0);
  let partial = pay === "part" ? (money(b.paid_amount, "Оплачено") ?? 0) : 0;
  if (partial > total + 0.001) throw conflict(`Оплата больше суммы заказа (${total})`);

  // Время оформления (необязательно): момент из браузера с учётом его часового пояса.
  // По нему записываются создание товаров, история статуса и оплата при оформлении.
  let at = nowIso();
  if (b.ordered_at !== undefined && b.ordered_at !== null && b.ordered_at !== "") {
    const t = Date.parse(String(b.ordered_at));
    if (!Number.isFinite(t)) throw badRequest("Некорректное время заказа");
    if (t > Date.now() + 5 * 60_000) throw badRequest("Время заказа ещё не наступило");
    at = new Date(t).toISOString();
  }

  const result = tx(() => {
    let customerId = optInt(b.customer_id);
    let customerCreated = false;
    if (customerId) customerOr404(customerId);
    else {
      const c = findOrCreateCustomer(str(b.customer_name, 200), str(b.customer_phone, 50));
      customerId = c.id;
      customerCreated = c.created;
    }
    const orderId = findOrCreateOrder(customerId, orderDate, req.user!.id);
    // Заказ создан раньше, чем записан, — время заказа берём более раннее.
    run("UPDATE orders SET created_at = ? WHERE id = ? AND created_at > ?", at, orderId, at);
    if (comment) run("UPDATE orders SET comment = CASE WHEN comment = '' THEN ? ELSE comment || ' · ' || ? END WHERE id = ?", comment, comment, orderId);

    const ids: number[] = [];
    for (const l of lines) {
      const id = run(
        `INSERT INTO order_items (order_id, name, code, code_norm, qty, price, price_cny, real_price, comment, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        orderId, l.name, l.code, normCode(l.code), l.qty, l.price, l.price_cny, l.real_price, l.comment, status, req.user!.id, at
      );
      setStatus(id, status, "create", req.user!.id, { at });
      ids.push(id);
      // Оплата: полностью — на каждую позицию; частично — по порядку строк, пока хватает суммы.
      const due = itemOr404(id).sale;
      const amount = pay === "full" ? due : pay === "part" ? Math.min(due, partial) : 0;
      if (amount > 0) {
        run("INSERT INTO payments (order_item_id, amount, paid_at, comment, user_id) VALUES (?, ?, ?, 'при оформлении заказа', ?)", id, amount, at, req.user!.id);
        if (pay === "part") partial -= amount;
      }
    }
    return { customerId, customerCreated, orderId, ids };
  });

  audit(req, "create", "order", result.orderId, null, { items: result.ids.length, sum: total });
  res.json({
    customer_id: result.customerId,
    customer_created: result.customerCreated,
    order_id: result.orderId,
    items: items(`id IN (${result.ids.map(() => "?").join(",")})`, result.ids, "ORDER BY id"),
  });
});
