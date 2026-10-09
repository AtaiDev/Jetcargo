/**
 * Импорт Excel в два шага: превью (ничего не пишет) → импорт (пишет ровно то, что было в превью).
 *
 * Безопасность данных:
 *  - существующие товары по умолчанию НЕ меняются: совпавшие строки пропускаются как дубликаты;
 *    обновление включается только явно (on_duplicate=update) и показывает, что изменится;
 *  - ничего не удаляется; импорт можно откатить — созданные им записи скрываются (мягко).
 */
import ExcelJS from "exceljs";
import { Router, type Request } from "express";
import multer from "multer";

import { all, get, run, tx } from "../db";
import {
  audit,
  canonPhone,
  findOrCreateCustomer,
  findOrCreateOrder,
  items,
  normCode,
  requireAdmin,
  setStatus,
  type ItemStatus,
  type ItemView,
} from "../domain";
import { badRequest, conflict, isoDate, normText, notFound, nowIso, str } from "../util";

export const importsRouter = Router();

// --- Поля системы и автосопоставление колонок ------------------------------------------

export const FIELDS = [
  { key: "customer_name", label: "Имя клиента", required: true },
  { key: "customer_phone", label: "Телефон", required: false },
  { key: "name", label: "Название товара", required: true },
  { key: "code", label: "Код товара", required: false },
  { key: "qty", label: "Количество", required: false },
  { key: "price", label: "Сумма (цена клиенту), сом", required: false },
  { key: "price_cny", label: "Цена, ¥", required: false },
  { key: "real_price", label: "Реальная цена (выкуп), сом", required: false },
  { key: "status", label: "Статус", required: false },
  { key: "payment", label: "Оплата (статус)", required: false },
  { key: "paid_amount", label: "Оплачено, сом", required: false },
  { key: "order_date", label: "Дата заказа", required: false },
  { key: "split_with", label: "Разделить с", required: false },
  { key: "comment", label: "Комментарий", required: false },
] as const;
type FieldKey = (typeof FIELDS)[number]["key"];
type Mapping = Partial<Record<FieldKey, number | null>>;

/** Угадать поле по заголовку. Порядок проверок важен: «Код товара» ≠ «Название товара». */
function guessField(header: string): FieldKey | null {
  const h = normText(header);
  if (!h) return null;
  // Реальная цена = выкуп на маркетплейсе = себестоимость.
  if (h.includes("реальн") || h.includes("себестоим") || h.includes("выкуп") || h.includes("закуп")) return "real_price";
  if (h.includes("¥") || h.includes("юан") || h.includes("cny")) return "price_cny";
  if (h.includes("код")) return h.includes("клиент") ? null : "code";
  if (h.includes("телефон") || h.startsWith("тел")) return "customer_phone";
  if (h.includes("имя") || h.includes("клиент") || h.includes("фио")) return "customer_name";
  if (h.includes("назван") || h.includes("товар")) return "name";
  if (h.includes("кол")) return "qty";
  if (h.includes("оплачено сум") || h.includes("сумма оплат")) return "paid_amount";
  if (h.includes("сумм")) return "price";
  if (h.includes("статус")) return "status";
  if (h.includes("оплат")) return "payment";
  if (h.includes("дата")) return "order_date";
  if (h.includes("раздел")) return "split_with";
  if (h.includes("коммент") || h.includes("примеч")) return "comment";
  return null;
}

// --- Чтение ячеек --------------------------------------------------------------------

export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoDate(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === "object") {
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("hyperlink" in v) return String((v as { hyperlink: string }).hyperlink);
    return "";
  }
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
}

function parseNumber(s: string): number | null | "bad" {
  const t = s.replace(/[\s ]/g, "").replace(/[сc]$|сом$|¥$/i, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
}

function parseDate(s: string): string | null | "bad" {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return Number.isNaN(new Date(d).getTime()) ? "bad" : d;
  }
  return "bad";
}

function parseStatus(s: string): ItemStatus | null | "bad" {
  const t = normText(s);
  if (!t) return null;
  if (t.includes("выдан")) return "issued";
  if (t.includes("склад")) return "in_stock";
  if (t.includes("заказ")) return "ordered";
  return "bad";
}

function parsePayment(s: string): "paid" | "unpaid" | "partial" | null | "bad" {
  const t = normText(s);
  if (!t) return null;
  if (t.includes("не оплач") || t.includes("неоплач")) return "unpaid";
  if (t.includes("частич")) return "partial";
  if (t.includes("оплач")) return "paid";
  return "bad";
}

function statusBySheet(sheet: string): ItemStatus {
  const t = normText(sheet);
  if (t.includes("выдан")) return "issued";
  if (t.includes("склад")) return "in_stock";
  return "ordered";
}

// --- Анализ файла --------------------------------------------------------------------

interface Options {
  sheet?: string;
  mapping?: Mapping;
  default_status?: ItemStatus;
  on_duplicate: "skip" | "update";
}

interface Parsed {
  customer_name: string;
  customer_phone: string;
  name: string;
  code: string;
  qty: number;
  price: number;
  price_cny: number | null;
  real_price: number | null;
  cost: number | null;
  status: ItemStatus;
  payment: "paid" | "unpaid" | "partial";
  paid_amount: number | null;
  order_date: string;
  split_with: string;
  comment: string;
}

export interface AnalyzedRow {
  row: number;
  action: "new" | "update" | "duplicate" | "error";
  values: Parsed | null;
  errors: string[];
  warnings: string[];
  match_item_id: number | null;
  changes: { field: string; from: unknown; to: unknown }[];
  new_customer: boolean;
}

/** Клиент платит «Сумму»; реальная цена — только выкуп (для прибыли). */
const sale = (p: Parsed) => p.price;

/** Ключ совпадения строки с товаром: код + название, а без кода — клиент + название + дата + сумма. */
function rowKey(p: { code: string; name: string; phone: string; customer: string; date: string; price: number }) {
  const code = normCode(p.code);
  if (code) return `c|${code}|${normText(p.name)}`;
  return `n|${canonPhone(p.phone) || normText(p.customer)}|${normText(p.name)}|${p.date}|${p.price}`;
}

async function analyze(buffer: Buffer, opts: Options) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest("Не удалось прочитать файл. Нужен формат .xlsx (в Google Таблицах: Файл → Скачать → Microsoft Excel)");
  }
  const sheets = wb.worksheets.map((w) => ({ name: w.name, rows: Math.max(w.actualRowCount - 1, 0) }));
  if (!sheets.length) throw badRequest("В файле нет листов");
  const ws = (opts.sheet && wb.getWorksheet(opts.sheet)) || wb.worksheets[0];

  // Строка заголовков — первая из первых 10, где не меньше трёх текстовых ячеек.
  let headerRow = 1;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const texts = (ws.getRow(r).values as ExcelJS.CellValue[]).filter((v) => typeof v === "string" && v.trim()).length;
    if (texts >= 3) {
      headerRow = r;
      break;
    }
  }
  const hr = ws.getRow(headerRow);
  const colCount = Math.max(ws.columnCount, hr.cellCount);
  const headers = Array.from({ length: colCount }, (_, i) => cellText(hr.getCell(i + 1).value).trim());

  let mapping: Mapping = {};
  if (opts.mapping && Object.keys(opts.mapping).length) mapping = opts.mapping;
  else {
    headers.forEach((h, i) => {
      const f = guessField(h);
      if (f && mapping[f] === undefined) mapping[f] = i;
    });
  }
  const defaultStatus = opts.default_status ?? statusBySheet(ws.name);

  // Сколько раз каждый ключ уже есть в базе — повторный импорт того же файла даёт дубликаты.
  const existing = new Map<string, ItemView[]>();
  for (const it of items("1 = 1", [], "ORDER BY id")) {
    const k = rowKey({ code: it.code, name: it.name, phone: it.customer_phone, customer: it.customer_name, date: it.order_date, price: it.price });
    existing.set(k, [...(existing.get(k) ?? []), it]);
  }
  const used = new Map<string, number>();
  const knownPhones = new Set(all<{ phone_digits: string }>("SELECT phone_digits FROM customers WHERE deleted_at IS NULL").map((c) => c.phone_digits));
  const newPhones = new Set<string>();

  const rows: AnalyzedRow[] = [];
  let emptyRows = 0;
  const get_ = (r: ExcelJS.Row, f: FieldKey) => {
    const idx = mapping[f];
    return idx === null || idx === undefined ? "" : cellText(r.getCell(idx + 1).value).trim();
  };

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw = FIELDS.map((f) => get_(row, f.key));
    if (raw.every((v) => !v)) {
      emptyRows++;
      continue;
    }
    const errors: string[] = [];
    const warnings: string[] = [];
    const numOf = (f: FieldKey, label: string) => {
      const v = parseNumber(get_(row, f));
      if (v === "bad") {
        errors.push(`${label}: не число «${get_(row, f)}»`);
        return null;
      }
      return v;
    };

    const customer_name = get_(row, "customer_name");
    const customer_phone = get_(row, "customer_phone");
    const name = get_(row, "name");
    if (!customer_name && !customer_phone) errors.push("нет имени и телефона клиента");
    if (!name) errors.push("нет названия товара");
    if (customer_phone && canonPhone(customer_phone).length < 9) warnings.push(`подозрительный телефон «${customer_phone}»`);

    const qtyRaw = numOf("qty", "Количество");
    const qty = qtyRaw === null ? 1 : Math.round(qtyRaw);
    if (qtyRaw !== null && (qty <= 0 || qtyRaw !== qty)) errors.push(`Количество: нужно целое больше нуля «${get_(row, "qty")}»`);
    const price = numOf("price", "Сумма") ?? 0;
    const price_cny = numOf("price_cny", "Цена ¥");
    const real_price = numOf("real_price", "Реальная цена");
    const paid_amount = numOf("paid_amount", "Оплачено");
    if (!price) warnings.push("нет суммы — товар будет с нулевой ценой");
    if (real_price === null) warnings.push("нет реальной цены — прибыль по товару не посчитается, можно указать позже");

    const st = parseStatus(get_(row, "status"));
    if (st === "bad") warnings.push(`статус «${get_(row, "status")}» не распознан — поставлен «по умолчанию»`);
    const status = st && st !== "bad" ? st : defaultStatus;

    let pay = parsePayment(get_(row, "payment"));
    if (pay === "bad") {
      warnings.push(`оплата «${get_(row, "payment")}» не распознана — считаю «Не оплачено»`);
      pay = null;
    }
    if (pay === "partial" && paid_amount === null) warnings.push("«Частично оплачено» без суммы — оплата не записывается");

    const d = parseDate(get_(row, "order_date"));
    if (d === "bad") errors.push(`Дата заказа: не распознана «${get_(row, "order_date")}»`);
    const order_date = d && d !== "bad" ? d : isoDate(new Date());
    if (d === null) warnings.push("нет даты заказа — поставлена сегодняшняя");

    const values: Parsed = {
      customer_name: customer_name || customer_phone,
      customer_phone,
      name,
      code: get_(row, "code"),
      qty,
      price,
      price_cny,
      real_price,
      cost: null,
      status,
      payment: (pay ?? "unpaid") as Parsed["payment"],
      paid_amount,
      order_date,
      split_with: get_(row, "split_with"),
      comment: get_(row, "comment"),
    };
    if (paid_amount !== null && paid_amount > sale(values) + 0.001) errors.push("оплачено больше суммы товара");

    const out: AnalyzedRow = { row: r, action: "new", values, errors, warnings, match_item_id: null, changes: [], new_customer: false };
    if (errors.length) {
      out.action = "error";
      rows.push(out);
      continue;
    }

    const key = rowKey({ code: values.code, name, phone: customer_phone, customer: values.customer_name, date: order_date, price });
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    const match = existing.get(key)?.[n];
    if (match) {
      out.match_item_id = match.id;
      const target = desired(values);
      const changes = diff(match, target);
      out.changes = changes;
      out.action = opts.on_duplicate === "update" && changes.length ? "update" : "duplicate";
    } else {
      const digits = canonPhone(customer_phone);
      if (digits && !knownPhones.has(digits)) {
        out.new_customer = !newPhones.has(digits);
        newPhones.add(digits);
      }
    }
    rows.push(out);
  }

  const count = (a: AnalyzedRow["action"]) => rows.filter((r) => r.action === a).length;
  return {
    sheets,
    sheet: ws.name,
    header_row: headerRow,
    headers,
    mapping,
    default_status: defaultStatus,
    fields: FIELDS,
    rows,
    counts: {
      total: rows.length,
      new: count("new"),
      update: count("update"),
      duplicate: count("duplicate"),
      error: count("error"),
      warnings: rows.filter((r) => r.warnings.length).length,
      new_customers: newPhones.size,
      empty_rows: emptyRows,
    },
  };
}

/** Какие значения должны получиться у товара из строки файла. */
function desired(p: Parsed) {
  return {
    qty: p.qty,
    price: p.price,
    price_cny: p.price_cny,
    real_price: p.real_price,
    status: p.status,
    paid_target: p.paid_amount ?? (p.payment === "paid" ? sale(p) : null),
  };
}

const FIELD_LABEL: Record<string, string> = {
  qty: "Количество", price: "Сумма", price_cny: "Цена ¥", real_price: "Реальная цена", status: "Статус", paid: "Оплачено",
};

/** Что изменится у существующего товара. Пустые значения из файла не затирают данные в системе. */
function diff(it: ItemView, t: ReturnType<typeof desired>) {
  const out: { field: string; from: unknown; to: unknown }[] = [];
  const cmp = (field: keyof typeof t & keyof ItemView) => {
    const to = t[field];
    if (to === null || to === undefined) return;
    if (it[field] !== to) out.push({ field: FIELD_LABEL[field], from: it[field], to });
  };
  cmp("qty");
  cmp("price");
  cmp("price_cny");
  cmp("real_price");
  cmp("status");
  if (t.paid_target !== null && t.paid_target > it.paid + 0.001) out.push({ field: FIELD_LABEL.paid, from: it.paid, to: t.paid_target });
  return out;
}

// --- Маршруты ------------------------------------------------------------------------

// defParamCharset: браузер шлёт имя файла в UTF-8; по умолчанию multer читает его как latin1,
// и «Заказы.xlsx» в истории импортов превращалось в «ÐÐ°ÐºÐ°Ð·Ñ.xlsx».
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 }, defParamCharset: "utf8" });

function optionsOf(req: Request): Options {
  const b = req.body ?? {};
  let mapping: Mapping | undefined;
  if (b.mapping) {
    try {
      mapping = JSON.parse(b.mapping);
    } catch {
      throw badRequest("Некорректное сопоставление колонок");
    }
  }
  const ds = str(b.default_status);
  return {
    sheet: str(b.sheet, 100) || undefined,
    mapping,
    default_status: ["ordered", "in_stock", "issued"].includes(ds) ? (ds as ItemStatus) : undefined,
    on_duplicate: b.on_duplicate === "update" ? "update" : "skip",
  };
}

importsRouter.post("/import/preview", upload.single("file"), async (req, res) => {
  requireAdmin(req);
  if (!req.file) throw badRequest("Выберите файл .xlsx");
  const result = await analyze(req.file.buffer, optionsOf(req));
  const missing = FIELDS.filter((f) => f.required && (result.mapping[f.key] === undefined || result.mapping[f.key] === null));
  res.json({ ...result, filename: req.file.originalname, missing_required: missing.map((f) => f.label) });
});

importsRouter.post("/import/commit", upload.single("file"), async (req, res) => {
  requireAdmin(req);
  if (!req.file) throw badRequest("Выберите файл .xlsx");
  const opts = optionsOf(req);
  const a = await analyze(req.file.buffer, opts);
  if (!a.counts.new && !a.counts.update) throw conflict("Нечего импортировать: все строки — дубликаты или с ошибками");
  const userId = req.user!.id;
  const filename = req.file.originalname;

  const importId = tx(() => {
    const importId = run(
      "INSERT INTO imports (filename, sheet, rows_total, created_items, updated_items, skipped, errors, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      filename, a.sheet, a.counts.total, a.counts.new, a.counts.update, a.counts.duplicate, a.counts.error, userId
    );
    const note = `импорт «${filename}», строка`;
    for (const r of a.rows) {
      const v = r.values!;
      if (r.action === "new") {
        const c = findOrCreateCustomer(v.customer_name, v.customer_phone, importId);
        const orderId = findOrCreateOrder(c.id, v.order_date, userId, importId);
        const id = run(
          `INSERT INTO order_items (order_id, name, code, code_norm, qty, price, price_cny, real_price, cost, split_with, comment,
                                    status, import_id, import_row, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          orderId, v.name, v.code, normCode(v.code), v.qty, v.price, v.price_cny, v.real_price, v.cost, v.split_with, v.comment,
          v.status, importId, r.row, userId
        );
        setStatus(id, v.status, "import", userId, { initial: true, comment: `${note} ${r.row}` });
        const paid = v.paid_amount ?? (v.payment === "paid" ? sale(v) : 0);
        if (paid > 0) {
          // Дата оплаты неизвестна — ставим дату заказа, это ближе к правде, чем день импорта.
          run(
            "INSERT INTO payments (order_item_id, amount, method, paid_at, comment, import_id, user_id) VALUES (?, ?, 'import', ?, ?, ?, ?)",
            id, paid, `${v.order_date}T12:00:00.000Z`, `${note} ${r.row}`, importId, userId
          );
        }
      } else if (r.action === "update" && r.match_item_id) {
        const t = desired(v);
        const it = items("id = ?", [r.match_item_id])[0];
        if (!it) continue;
        run(
          `UPDATE order_items SET qty = ?, price = ?, price_cny = COALESCE(?, price_cny), real_price = COALESCE(?, real_price),
                  updated_at = ? WHERE id = ?`,
          t.qty, t.price, t.price_cny, t.real_price, nowIso(), it.id
        );
        if (t.status !== it.status) setStatus(it.id, t.status, "import", userId, { comment: `${note} ${r.row}` });
        const after = items("id = ?", [it.id])[0];
        if (t.paid_target !== null && after && t.paid_target > after.paid + 0.001) {
          // Как у новых товаров: дата оплаты неизвестна — ставим дату заказа, а не день импорта,
          // чтобы старые деньги не попадали в «Поступило сегодня».
          run(
            "INSERT INTO payments (order_item_id, amount, method, paid_at, comment, import_id, user_id) VALUES (?, ?, 'import', ?, ?, ?, ?)",
            it.id, Math.min(t.paid_target, after.sale) - after.paid, `${it.order_date}T12:00:00.000Z`, `${note} ${r.row}`, importId, userId
          );
        }
      }
    }
    return importId;
  });
  audit(req, "import", "import", importId, null, { file: filename, ...a.counts });
  res.json({ import_id: importId, counts: a.counts });
});

importsRouter.get("/imports", (req, res) => {
  requireAdmin(req);
  res.json(
    all(
      `SELECT m.*, u.login AS user_login,
              (SELECT COUNT(*) FROM order_items i WHERE i.import_id = m.id AND i.deleted_at IS NULL) AS alive_items
         FROM imports m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.id DESC LIMIT 50`
    )
  );
});

/**
 * Откат импорта: скрывает (мягко) созданные им товары, заказы, клиентов без других товаров
 * и оплаты из этого импорта. Изменения существующих товаров в режиме «обновлять» не откатываются.
 */
importsRouter.post("/imports/:id/undo", (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  const imp = get<{ id: number; undone_at: string | null }>("SELECT id, undone_at FROM imports WHERE id = ?", id);
  if (!imp) throw notFound("Импорт");
  if (imp.undone_at) throw conflict("Импорт уже отменён");
  const at = nowIso();
  tx(() => {
    run("UPDATE payments SET deleted_at = ? WHERE import_id = ? AND deleted_at IS NULL", at, id);
    run("UPDATE order_items SET deleted_at = ? WHERE import_id = ? AND deleted_at IS NULL", at, id);
    run(
      `UPDATE orders SET deleted_at = ? WHERE import_id = ? AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = orders.id AND i.deleted_at IS NULL)`,
      at, id
    );
    run(
      `UPDATE customers SET deleted_at = ? WHERE import_id = ? AND deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = customers.id AND o.deleted_at IS NULL)`,
      at, id
    );
    run("UPDATE imports SET undone_at = ? WHERE id = ?", at, id);
  });
  audit(req, "import_undo", "import", id, null, null);
  res.json({ ok: true });
});
