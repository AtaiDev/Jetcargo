/**
 * Склад: приём товара сканером, история сканирований и выдача клиенту.
 *
 * Сканирование никогда не перезаписывает прошлое: каждое — новая строка в scans.
 * Статус меняется только у товара «Заказан» → «На складе»; повторный скан лишь
 * фиксируется и подсказывает, что с товаром уже было.
 */
import { Router } from "express";

import { all, get, run, tx, type Param } from "../db";
import { audit, itemOr404, items, normCode, setStatus, totals, type ItemView } from "../domain";
import { badRequest, conflict, normText, nowIso, num, optInt, phoneDigits, str } from "../util";
import { customerOr404, customerSearch } from "./customers";

export const warehouseRouter = Router();

type ScanResult = "arrived" | "already_in_stock" | "already_issued" | "not_found";

/** Расстояние Левенштейна с ранним выходом, если уже больше max. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Коды, похожие на ненайденный: пропущенная/лишняя/перепутанная цифра (до 2 правок)
 * или один код целиком содержит другой. Самые близкие — первыми.
 */
function similarCodes(code: string): ItemView[] {
  if (code.length < 5) return [];
  const scored = all<{ code_norm: string }>("SELECT DISTINCT code_norm FROM v_items WHERE code_norm <> ''")
    .map((r) => {
      const c = r.code_norm;
      const d = c.includes(code) || code.includes(c) ? 0.5 : distance(code, c, 2);
      return { c, d };
    })
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  return scored.flatMap((x) => items("code_norm = ?", [x.c], "ORDER BY order_date DESC LIMIT 2")).slice(0, 5);
}

function scansOf(itemId: number) {
  return all<{ id: number; result: ScanResult; scanned_at: string; user_login: string | null }>(
    `SELECT s.id, s.result, s.scanned_at, u.login AS user_login
       FROM scans s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.order_item_id = ? AND s.deleted_at IS NULL ORDER BY s.scanned_at, s.id`,
    itemId
  );
}

function customerBrief(customerId: number) {
  const c = customerOr404(customerId);
  const t = totals(items("customer_id = ?", [customerId]));
  return { id: c.id, name: c.name, phone: c.phone, code: c.code, debt: t.debt, in_stock: t.in_stock, ordered: t.ordered };
}

/** Только поиск по коду: ничего не меняет и не пишет в историю сканов. */
warehouseRouter.get("/scan/lookup", (req, res) => {
  const raw = str(req.query.code, 200);
  const code = normCode(raw);
  if (!code) throw badRequest("Пустой код");
  const matches = items("code_norm = ?", [code], "ORDER BY order_date, id");
  res.json({
    code: raw,
    result: matches.length ? "lookup" : "not_found",
    items: matches.map((i) => ({ ...i, scans: scansOf(i.id) })),
    customer: matches.length ? customerBrief(matches[0].customer_id) : null,
    suggestions: matches.length ? [] : similarCodes(code),
  });
});

warehouseRouter.post("/scan", (req, res) => {
  const raw = str(req.body?.code, 200);
  // Партия, в которую идёт приём (необязательно). Закрытая партия не принимает товары.
  const batchId = optInt(req.body?.batch_id) ?? null;
  if (batchId && !get("SELECT id FROM batches WHERE id = ? AND deleted_at IS NULL AND status = 'open'", batchId)) {
    throw badRequest("Партия не найдена или закрыта");
  }
  const code = normCode(raw);
  if (!code) throw badRequest("Пустой код");
  const userId = req.user!.id;
  const at = nowIso();

  const out = tx(() => {
    const matches = items("code_norm = ?", [code], "ORDER BY order_date, id");
    if (!matches.length) {
      run("INSERT INTO scans (code, code_norm, result, user_id, scanned_at) VALUES (?, ?, 'not_found', ?, ?)", raw, code, userId, at);
      // Похожие коды — только подсказка, ничего не меняем автоматически.
      const suggestions = similarCodes(code);
      return { result: "not_found" as ScanResult, items: [] as ItemView[], suggestions };
    }
    const results: ScanResult[] = [];
    for (const it of matches) {
      let r: ScanResult;
      if (it.status === "ordered") {
        setStatus(it.id, "in_stock", "scan", userId, { at });
        if (batchId) run("UPDATE order_items SET batch_id = ? WHERE id = ?", batchId, it.id);
        r = "arrived";
      } else r = it.status === "in_stock" ? "already_in_stock" : "already_issued";
      run(
        "INSERT INTO scans (code, code_norm, result, order_item_id, user_id, scanned_at) VALUES (?, ?, ?, ?, ?, ?)",
        raw, code, r, it.id, userId, at
      );
      results.push(r);
    }
    const result: ScanResult = results.includes("arrived")
      ? "arrived"
      : results.includes("already_in_stock")
        ? "already_in_stock"
        : "already_issued";
    return { result, items: matches.map((m) => itemOr404(m.id)), suggestions: [] as ItemView[] };
  });

  if (out.result === "arrived") audit(req, "scan", "item", out.items[0].id, null, code);
  res.json({
    code: raw,
    result: out.result,
    items: out.items.map((i) => ({ ...i, scans: scansOf(i.id) })),
    customer: out.items.length ? customerBrief(out.items[0].customer_id) : null,
    suggestions: out.suggestions,
  });
});

warehouseRouter.get("/scans", (req, res) => {
  const limit = Math.min(optInt(req.query.limit) ?? 50, 500);
  const offset = Math.max(optInt(req.query.offset) ?? 0, 0);
  const w: string[] = ["s.deleted_at IS NULL"];
  const p: Param[] = [];
  const result = str(req.query.result);
  if (result) {
    w.push("s.result = ?");
    p.push(result);
  }
  const q = str(req.query.q, 100);
  if (q) {
    w.push("(s.code_norm LIKE ? OR norm(i.name) LIKE ? OR norm(c.name) LIKE ?)");
    p.push(`%${normCode(q)}%`, `%${normText(q)}%`, `%${normText(q)}%`);
  }
  // since — момент начала (ISO, UTC), например локальная полночь для «сегодня».
  const since = str(req.query.since, 40);
  if (since) {
    w.push("s.scanned_at >= ?");
    p.push(since);
  }
  // Сканы удалённых товаров (или их удалённых клиентов/заказов) не показываем:
  // v_items содержит только живые товары. Ненайденные коды (без товара) остаются.
  w.push("(s.order_item_id IS NULL OR v.id IS NOT NULL)");
  const where = `WHERE ${w.join(" AND ")}`;
  const from = `FROM scans s
     LEFT JOIN order_items i ON i.id = s.order_item_id
     LEFT JOIN orders o ON o.id = i.order_id
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN v_items v ON v.id = s.order_item_id
     LEFT JOIN users u ON u.id = s.user_id ${where}`;
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, ...p)!.n;
  const rows = all(
    `SELECT s.id, s.code, s.result, s.scanned_at, s.order_item_id, u.login AS user_login,
            i.name AS item_name, i.qty, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone,
            v.sale, v.debt, v.pay_status, v.status AS item_status, o.order_date,
            (SELECT COUNT(*) FROM scans s2 WHERE s2.order_item_id = s.order_item_id AND s2.id <= s.id AND s2.deleted_at IS NULL) AS scan_no
       ${from} ORDER BY s.scanned_at DESC, s.id DESC LIMIT ? OFFSET ?`,
    ...p, limit, offset
  );
  res.json({ rows, total });
});

// --- Выдача --------------------------------------------------------------------------

/** Поиск для выдачи: по имени, телефону, коду клиента или коду товара. */
warehouseRouter.get("/issue/lookup", (req, res) => {
  const q = str(req.query.q, 100);
  if (!q) {
    res.json([]);
    return;
  }
  const s = customerSearch(q);
  const code = normCode(q);
  const ids = all<{ id: number }>(
    `SELECT c.id FROM customers c WHERE c.deleted_at IS NULL AND (${s.sql}
        OR c.id IN (SELECT customer_id FROM v_items WHERE code_norm <> '' AND code_norm LIKE ?))
      LIMIT 20`,
    ...s.params, `%${code}%`
  );
  res.json(ids.map((r) => customerBrief(r.id)).sort((a, b) => b.in_stock - a.in_stock));
});

warehouseRouter.post("/issues", (req, res) => {
  const b = req.body ?? {};
  const customerId = Number(b.customer_id);
  customerOr404(customerId);
  const ids: number[] = Array.isArray(b.item_ids) ? b.item_ids.map(Number) : [];
  if (!ids.length) throw badRequest("Выберите товары для выдачи");
  let payment = num(b.payment_amount ?? 0, "Оплата при выдаче");

  const issueId = tx(() => {
    const list = ids.map((id) => itemOr404(id));
    for (const it of list) {
      if (it.customer_id !== customerId) throw conflict(`«${it.name}» принадлежит другому клиенту`);
      if (it.status !== "in_stock") throw conflict(`«${it.name}» не на складе — выдать нельзя`);
    }
    const debt = list.reduce((s, i) => s + i.debt, 0);
    if (payment > debt + 0.001) throw conflict(`Оплата больше долга по выбранным товарам (${debt})`);

    const at = nowIso();
    const issueId = run(
      "INSERT INTO issues (customer_id, issued_at, comment, user_id) VALUES (?, ?, ?, ?)",
      customerId, at, str(b.comment, 500), req.user!.id
    );
    for (const it of list) {
      if (payment > 0 && it.debt > 0) {
        const part = Math.min(it.debt, payment);
        run(
          "INSERT INTO payments (order_item_id, amount, method, paid_at, comment, user_id) VALUES (?, ?, ?, ?, 'при выдаче', ?)",
          it.id, part, str(b.method, 20) || "cash", at, req.user!.id
        );
        payment -= part;
      }
      setStatus(it.id, "issued", "issue", req.user!.id, { issueId, at });
    }
    return issueId;
  });
  audit(req, "issue", "customer", customerId, null, { issue_id: issueId, items: ids });
  res.json({ issue_id: issueId, items: items(`issue_id = ?`, [issueId]) });
});

warehouseRouter.get("/issues", (req, res) => {
  const limit = Math.min(optInt(req.query.limit) ?? 30, 200);
  const offset = Math.max(optInt(req.query.offset) ?? 0, 0);
  const q = str(req.query.q, 100);
  const p: Param[] = [];
  // Выдачи, у которых все товары удалены, не показываем (v_items — только живые товары).
  // Скрытые выдачи (deleted_at) тоже не показываем.
  let where = "c.deleted_at IS NULL AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM v_items vi WHERE vi.issue_id = s.id)";
  if (q) {
    const digits = phoneDigits(q);
    where += " AND (norm(c.name) LIKE ?" + (digits.length >= 3 ? " OR c.phone_digits LIKE ?" : "") + ")";
    p.push(`%${normText(q)}%`, ...(digits.length >= 3 ? [`%${digits}%`] : []));
  }
  // Период: since/until — границы в ISO (UTC), клиент передаёт свои локальные полночи.
  const since = str(req.query.since, 40);
  const until = str(req.query.until, 40);
  if (since) {
    where += " AND s.issued_at >= ?";
    p.push(since);
  }
  if (until) {
    where += " AND s.issued_at < ?";
    p.push(until);
  }
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM issues s JOIN customers c ON c.id = s.customer_id WHERE ${where}`, ...p)!.n;
  // Оплата, принятая прямо при выдаче: платёж «при выдаче» с тем же временем, что и выдача.
  const PAID_NOW = `p.deleted_at IS NULL AND p.comment = 'при выдаче' AND p.paid_at = s.issued_at`;
  // Итоги за весь отобранный период (не только текущая страница); debt — сколько по выданным товарам ещё не оплачено.
  const summary = get<{ items: number; qty: number; sale: number; customers: number; debt: number }>(
    `SELECT COUNT(v.id) AS items, COALESCE(SUM(v.qty), 0) AS qty, COALESCE(SUM(v.sale), 0) AS sale,
            COUNT(DISTINCT s.customer_id) AS customers, COALESCE(SUM(v.debt), 0) AS debt
       FROM issues s JOIN customers c ON c.id = s.customer_id JOIN v_items v ON v.issue_id = s.id
      WHERE ${where}`,
    ...p
  )!;
  const paidNow = get<{ paid: number }>(
    `SELECT COALESCE(SUM(p.amount), 0) AS paid
       FROM issues s JOIN customers c ON c.id = s.customer_id
       JOIN order_items i ON i.issue_id = s.id AND i.deleted_at IS NULL
       JOIN payments p ON p.order_item_id = i.id AND ${PAID_NOW}
      WHERE ${where}`,
    ...p
  )!.paid;
  // По дням — для графика и итогов дня. Дни считаем в часовом поясе клиента (tz — минуты к UTC).
  const tz = Math.max(-840, Math.min(840, optInt(req.query.tz) ?? 0));
  const byDay = all<{ day: string; issues: number; items: number; sale: number }>(
    `SELECT date(s.issued_at, ?) AS day, COUNT(DISTINCT s.id) AS issues, COUNT(v.id) AS items, COALESCE(SUM(v.sale), 0) AS sale
       FROM issues s JOIN customers c ON c.id = s.customer_id JOIN v_items v ON v.issue_id = s.id
      WHERE ${where} GROUP BY day ORDER BY day`,
    `${tz >= 0 ? "+" : ""}${tz} minutes`, ...p
  );
  const rows = all<{ id: number; customer_id: number; issued_at: string; comment: string; customer_name: string; customer_phone: string; user_login: string | null; paid_now: number }>(
    `SELECT s.id, s.customer_id, s.issued_at, s.comment, c.name AS customer_name, c.phone AS customer_phone, u.login AS user_login,
            (SELECT COALESCE(SUM(p.amount), 0) FROM order_items i JOIN payments p ON p.order_item_id = i.id AND ${PAID_NOW}
              WHERE i.issue_id = s.id AND i.deleted_at IS NULL) AS paid_now
       FROM issues s JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id
      WHERE ${where} ORDER BY s.issued_at DESC, s.id DESC LIMIT ? OFFSET ?`,
    ...p, limit, offset
  );
  res.json({
    rows: rows.map((r) => ({ ...r, items: items("issue_id = ?", [r.id], "ORDER BY id") })),
    total,
    summary: { ...summary, paid_now: paidNow },
    by_day: byDay,
  });
});
