/**
 * Накладные из Китая: китайская сторона присылает Excel со списком отправленных кодов
 * (订单号 / «Номер заказа» = код товара), номером накладной (运单号), датой отправки (发货时间)
 * и номером коробки (箱子编号).
 *
 *  - превью (ничего не пишет): какие коды нашлись у заказанных товаров — они станут «В пути»,
 *    какие уже на складе или выданы, каких нет в заказах, какие повторяются в файле;
 *  - загрузка: накладная сохраняется со своими кодами; повторная загрузка той же накладной
 *    обновляет её (без дублей);
 *  - «В пути» не пишется в товары — это вычисляемый этап (см. миграцию 10 в db.ts): товар
 *    с кодом из накладной и статусом «Заказан». Скан на приёме переводит его «На склад» как обычно.
 *    Скрыли накладную — товары снова просто «Заказан». Код вписали позже — товар сам станет «В пути».
 */
import ExcelJS from "exceljs";
import { Router } from "express";
import multer from "multer";

import { all, get, run, tx } from "../db";
import { audit, items, normCode, requireAdmin, type ItemView } from "../domain";
import { badRequest, conflict, notFound, nowIso, str } from "../util";
import { cellText } from "./imports";

export const shipmentsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 }, defParamCharset: "utf8" });

// --- Чтение файла ---------------------------------------------------------------------------

type Col = "code" | "waybill" | "client" | "china_in" | "shipped" | "arrives" | "box" | "name";

/** Колонка по заголовку — китайский и русский варианты. */
function guessCol(header: string): Col | null {
  const h = header.toLowerCase();
  if (h.includes("运单号") || h.includes("накладн") || h.includes("waybill")) return "waybill";
  if (h.includes("订单号") || h.includes("номер заказа") || h.includes("tracking") || h.includes("трек")) return "code";
  if (h.includes("客户代码") || h.includes("код клиента")) return "client";
  if (h.includes("入库") || h.includes("поступлен")) return "china_in";
  if (h.includes("发货") || h.includes("отправлен")) return "shipped";
  if (h.includes("到达") || h.includes("прибыт")) return "arrives";
  if (h.includes("箱") || h.includes("короб")) return "box";
  if (h.includes("商品") || h.includes("название")) return "name";
  return null;
}

const ymd = (y: string | number, m: string | number, d: string | number) => {
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return Number.isNaN(new Date(`${s}T00:00:00`).getTime()) ? null : s;
};

/**
 * Дата из ячейки: «2026-09-30», «2026/9/30», «10/5/2026 12:00:00 AM» (китайские выгрузки пишут
 * месяц первым), «05.10.2026» (день первым). Ячейка-дата Excel приходит уже как YYYY-MM-DD.
 */
function parseDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return ymd(m[3], m[2], m[1]);
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    let [mo, d] = [Number(m[1]), Number(m[2])];
    if (mo > 12) [mo, d] = [d, mo]; // 30/9/2026 — значит, день первым
    return ymd(m[3], mo, d);
  }
  return null;
}

interface WRow {
  row: number;
  code: string;
  code_norm: string;
  waybill: string;
  shipped_at: string | null;
  arrives_at: string | null;
  china_in_at: string | null;
  box: string;
  client_code: string;
  name: string;
}

async function readWaybill(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw badRequest("Не удалось прочитать файл. Нужен формат .xlsx");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest("В файле нет листов");

  // Строка заголовков — первая из первых 10, где есть колонка с номером заказа (кодом).
  let headerRow = 0;
  let headers: string[] = [];
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const cells = Array.from({ length: Math.max(ws.columnCount, row.cellCount) }, (_, i) => cellText(row.getCell(i + 1).value).trim());
    if (cells.some((h) => guessCol(h) === "code")) {
      headerRow = r;
      headers = cells;
      break;
    }
  }
  if (!headerRow) throw badRequest("Не нашёл колонку «Номер заказа» (订单号) — это точно накладная?");
  const col: Partial<Record<Col, number>> = {};
  headers.forEach((h, i) => {
    const c = guessCol(h);
    if (c && col[c] === undefined) col[c] = i;
  });

  const rows: WRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const val = (c: Col) => (col[c] === undefined ? "" : cellText(row.getCell(col[c]! + 1).value).trim());
    const code = val("code");
    if (!code) continue;
    rows.push({
      row: r,
      code,
      code_norm: normCode(code),
      waybill: val("waybill"),
      shipped_at: parseDate(val("shipped")),
      arrives_at: parseDate(val("arrives")),
      china_in_at: parseDate(val("china_in")),
      box: val("box"),
      client_code: val("client"),
      name: val("name"),
    });
  }
  if (!rows.length) throw badRequest("В накладной нет ни одного номера заказа");
  return { sheet: ws.name, headers, rows };
}

// --- Разбор: что станет «В пути» -------------------------------------------------------------

type RowState = "transit" | "arrived" | "not_found" | "dup";
const brief = (i: ItemView) => ({ id: i.id, name: i.name, customer_id: i.customer_id, customer_name: i.customer_name, qty: i.qty, sale: i.sale, status: i.status, stage: i.stage });

/** Товары с этими кодами (по code_norm), только живые. */
function itemsByCodes(codes: string[]): Map<string, ItemView[]> {
  const out = new Map<string, ItemView[]>();
  for (let i = 0; i < codes.length; i += 500) {
    const part = codes.slice(i, i + 500);
    for (const it of items(`code_norm IN (${part.map(() => "?").join(",")})`, part, "ORDER BY order_date, id")) {
      const k = normCode(it.code);
      out.set(k, [...(out.get(k) ?? []), it]);
    }
  }
  return out;
}

function analyze(rows: WRow[], filename: string) {
  const found = itemsByCodes([...new Set(rows.map((r) => r.code_norm))]);
  const seen = new Set<string>();
  const out = rows.map((r) => {
    const matches = found.get(r.code_norm) ?? [];
    let state: RowState;
    if (seen.has(r.code_norm)) state = "dup";
    else if (!matches.length) state = "not_found";
    else if (matches.some((m) => m.status === "ordered")) state = "transit";
    else state = "arrived";
    seen.add(r.code_norm);
    return { ...r, state, matches: matches.map(brief) };
  });

  // Накладные в файле (обычно одна). Без номера — по имени файла.
  const groups = new Map<string, { waybill: string; shipped_at: string | null; arrives_at: string | null; codes: number }>();
  for (const r of out) {
    if (r.state === "dup") continue;
    const w = r.waybill || filename.replace(/\.xlsx$/i, "");
    const g = groups.get(w) ?? { waybill: w, shipped_at: r.shipped_at, arrives_at: r.arrives_at, codes: 0 };
    g.codes++;
    if (r.shipped_at && (!g.shipped_at || r.shipped_at > g.shipped_at)) g.shipped_at = r.shipped_at;
    if (r.arrives_at && !g.arrives_at) g.arrives_at = r.arrives_at;
    groups.set(w, g);
  }
  const waybills = [...groups.values()].map((g) => {
    const prev = get<{ id: number; created_at: string; updated_at: string }>(
      "SELECT id, created_at, updated_at FROM shipments WHERE waybill = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1",
      g.waybill
    );
    return { ...g, loaded: prev ? { id: prev.id, at: prev.updated_at } : null };
  });

  const transitItems = out.filter((r) => r.state === "transit").flatMap((r) => r.matches.filter((m) => m.status === "ordered"));
  const count = (s: RowState) => out.filter((r) => r.state === s).length;
  return {
    waybills,
    rows: out,
    counts: {
      rows: out.length,
      codes: seen.size,
      boxes: new Set(out.map((r) => r.box).filter(Boolean)).size,
      transit: count("transit"),
      transit_items: transitItems.length,
      transit_sum: transitItems.reduce((s, m) => s + m.sale, 0),
      customers: new Set(transitItems.map((m) => m.customer_id)).size,
      arrived: count("arrived"),
      not_found: count("not_found"),
      dup: count("dup"),
    },
  };
}

shipmentsRouter.post("/shipments/preview", upload.single("file"), async (req, res) => {
  requireAdmin(req);
  if (!req.file) throw badRequest("Выберите файл .xlsx");
  const { rows, sheet } = await readWaybill(req.file.buffer);
  res.json({ filename: req.file.originalname, sheet, ...analyze(rows, req.file.originalname) });
});

shipmentsRouter.post("/shipments", upload.single("file"), async (req, res) => {
  requireAdmin(req);
  if (!req.file) throw badRequest("Выберите файл .xlsx");
  const filename = req.file.originalname;
  const { rows } = await readWaybill(req.file.buffer);
  const a = analyze(rows, filename);
  const at = nowIso();
  const userId = req.user!.id;

  const saved = tx(() =>
    a.waybills.map((w) => {
      // Повторная загрузка той же накладной — обновляем её коды, а не создаём вторую.
      let id = w.loaded?.id ?? null;
      if (id) {
        run("UPDATE shipments SET shipped_at = ?, arrives_at = ?, filename = ?, updated_at = ? WHERE id = ?", w.shipped_at, w.arrives_at, filename, at, id);
        run("DELETE FROM shipment_codes WHERE shipment_id = ?", id);
      } else {
        id = run(
          "INSERT INTO shipments (waybill, shipped_at, arrives_at, filename, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          w.waybill, w.shipped_at, w.arrives_at, filename, userId, at, at
        );
      }
      for (const r of a.rows) {
        if (r.state === "dup" || (r.waybill || filename.replace(/\.xlsx$/i, "")) !== w.waybill) continue;
        run(
          "INSERT INTO shipment_codes (shipment_id, code, code_norm, box, client_code, china_in_at, row_no) VALUES (?, ?, ?, ?, ?, ?, ?)",
          id, r.code, r.code_norm, r.box, r.client_code, r.china_in_at, r.row
        );
      }
      return { id, waybill: w.waybill, updated: !!w.loaded };
    })
  );
  for (const s of saved) {
    audit(req, s.updated ? "import_waybill_update" : "import_waybill", "shipment", s.id, null, {
      waybill: s.waybill,
      codes: a.counts.codes,
      transit_items: a.counts.transit_items,
      not_found: a.counts.not_found,
    });
  }
  res.json({ shipments: saved, counts: a.counts });
});

// --- Список и подробности ----------------------------------------------------------------------

interface ShipmentRow {
  id: number;
  waybill: string;
  shipped_at: string | null;
  arrives_at: string | null;
  filename: string;
  created_at: string;
  updated_at: string;
  user_login: string | null;
}

/** Сводка по накладной: сколько кодов, сколько товаров в пути / на складе / выдано, сколько не найдено. */
function stats(codes: { code_norm: string }[], found: Map<string, ItemView[]>) {
  const list = codes.flatMap((c) => found.get(c.code_norm) ?? []);
  return {
    codes: codes.length,
    not_found: codes.filter((c) => !(found.get(c.code_norm) ?? []).length).length,
    items: list.length,
    in_transit: list.filter((i) => i.stage === "in_transit").length,
    in_stock: list.filter((i) => i.status === "in_stock").length,
    issued: list.filter((i) => i.status === "issued").length,
    // Ожидается, но код уже в более новой накладной — считаем «в пути» там.
    ordered: list.filter((i) => i.stage === "ordered").length,
    sum: list.reduce((s, i) => s + i.sale, 0),
    customers: new Set(list.map((i) => i.customer_id)).size,
  };
}

shipmentsRouter.get("/shipments", (_req, res) => {
  const ships = all<ShipmentRow>(
    `SELECT s.id, s.waybill, s.shipped_at, s.arrives_at, s.filename, s.created_at, s.updated_at, u.login AS user_login
       FROM shipments s LEFT JOIN users u ON u.id = s.created_by
      WHERE s.deleted_at IS NULL ORDER BY COALESCE(s.shipped_at, substr(s.created_at, 1, 10)) DESC, s.id DESC LIMIT 100`
  );
  const codes = ships.length
    ? all<{ shipment_id: number; code_norm: string }>(
        `SELECT shipment_id, code_norm FROM shipment_codes WHERE shipment_id IN (${ships.map(() => "?").join(",")})`,
        ...ships.map((s) => s.id)
      )
    : [];
  const found = itemsByCodes([...new Set(codes.map((c) => c.code_norm))]);
  res.json(ships.map((s) => ({ ...s, stats: stats(codes.filter((c) => c.shipment_id === s.id), found) })));
});

// --- Приём: какая партия из Китая идёт сейчас ------------------------------------------------------

/** Партии по порядку отправки. Один загруженный файл — одна партия, даже если накладных в нём несколько. */
function shipmentFiles(): ShipmentRow[][] {
  const ships = all<ShipmentRow>(
    `SELECT s.id, s.waybill, s.shipped_at, s.arrives_at, s.filename, s.created_at, s.updated_at, NULL AS user_login
       FROM shipments s WHERE s.deleted_at IS NULL ORDER BY COALESCE(s.shipped_at, substr(s.created_at, 1, 10)), s.id`
  );
  const files = new Map<string, ShipmentRow[]>();
  for (const s of ships) {
    const key = `${s.filename}|${s.updated_at}`;
    files.set(key, [...(files.get(key) ?? []), s]);
  }
  return [...files.values()];
}

/** Сводка партии: сколько отсканировано и осталось, неизвестные коды, оплата и долг. */
function fileSummary(file: ShipmentRow[]) {
  const codes = all<{ code_norm: string; box: string }>(
    `SELECT code_norm, box FROM shipment_codes WHERE shipment_id IN (${file.map(() => "?").join(",")})`,
    ...file.map((s) => s.id)
  );
  const norms = [...new Set(codes.map((c) => c.code_norm))];
  const found = itemsByCodes(norms);
  const list = norms.flatMap((c) => found.get(c) ?? []);
  const unknown = norms.filter((c) => !found.has(c));
  // Неизвестный код заказа не имеет, поэтому «отсканирован» видно только по истории сканов.
  const seen = unknown.length
    ? all<{ code_norm: string }>(
        `SELECT DISTINCT code_norm FROM scans WHERE result = 'not_found' AND deleted_at IS NULL AND code_norm IN (${unknown.map(() => "?").join(",")})`,
        ...unknown
      ).length
    : 0;
  // Считаем по кодам, как в файле: одна строка накладной — один код, даже если на нём два товара.
  const known = norms.map((c) => found.get(c) ?? []).filter((l) => l.length);
  const waiting = known.filter((l) => l.some((i) => i.status === "ordered")).length;
  const paid = known.filter((l) => l.every((i) => i.pay_status === "paid")).length;
  const unpaid = known.filter((l) => l.every((i) => i.pay_status === "unpaid")).length;
  return {
    id: file[0].id,
    waybill: file[0].waybill,
    waybills: file.length,
    shipped_at: file[0].shipped_at,
    arrives_at: file[0].arrives_at,
    filename: file[0].filename,
    total: norms.length,
    scanned: known.length - waiting + seen,
    remaining: waiting + unknown.length - seen,
    waiting,
    items: known.length,
    unknown: unknown.length,
    unknown_scanned: seen,
    paid_items: paid,
    partial_items: known.length - paid - unpaid,
    unpaid_items: unpaid,
    sum: list.reduce((s, i) => s + i.sale, 0),
    debt: list.reduce((s, i) => s + i.debt, 0),
    customers: new Set(list.map((i) => i.customer_id)).size,
    boxes: new Set(codes.map((c) => c.box).filter(Boolean)).size,
  };
}

/** Сводка по нескольким партиям сразу: их коды и товары складываются. */
function summaryOf(files: ShipmentRow[][]) {
  return { ...fileSummary(files.flat()), files: files.length, waybill_list: files.map((f) => f[0].waybill) };
}

/**
 * Какие партии показать на «Приёме».
 *  - Партии, товары которых сегодня принимали сканером, — все вместе: две партии пришли разом —
 *    коды, товары, оплата и долг складываются. Товар «свой заказ» (код привязали к клиенту
 *    на приёме) партию не включает: он мог пролежать без кода с прошлого раза.
 *  - Сегодня ничего не принимали — партия последнего кода, а если её товары уже приняты,
 *    следующая, где они ещё ждут приёма. Неизвестные коды дальше не держат.
 */
function currentFile(code: string, since: string) {
  const files = shipmentFiles();
  if (!files.length) return null;
  const at = (id: number) => files.findIndex((f) => f.some((s) => s.id === id));
  // Код может быть и в старой, и в новой накладной — считаем его в самой новой, как в v_items.
  const latest = `(SELECT MAX(sc.shipment_id) FROM shipment_codes sc
                     JOIN shipments s ON s.id = sc.shipment_id AND s.deleted_at IS NULL
                    WHERE sc.code_norm = x.code_norm)`;
  if (since) {
    const today = all<{ id: number | null }>(
      `SELECT DISTINCT ${latest} AS id FROM scans x
         JOIN order_items i ON i.id = x.order_item_id
        WHERE x.deleted_at IS NULL AND x.result = 'arrived' AND x.scanned_at >= ?
          AND i.comment NOT LIKE 'Клиент заказывал сам%'
          AND NOT EXISTS (SELECT 1 FROM status_history h WHERE h.order_item_id = x.order_item_id
                            AND h.to_status = 'ordered' AND h.source <> 'create' AND h.changed_at > x.scanned_at)`,
      since
    );
    const idx = [...new Set(today.map((r) => (r.id ? at(r.id) : -1)).filter((i) => i >= 0))].sort((a, b) => a - b);
    if (idx.length) return summaryOf(idx.map((i) => files[i]));
  }
  const byCode = code ? get<{ id: number | null }>(`SELECT ${latest} AS id FROM (SELECT ? AS code_norm) x`, code)?.id : null;
  if (byCode && at(byCode) >= 0) return summaryOf([files[at(byCode)]]);
  const last = get<{ id: number }>(
    `SELECT sc.shipment_id AS id FROM scans x
       JOIN shipment_codes sc ON sc.code_norm = x.code_norm
       JOIN shipments s ON s.id = sc.shipment_id AND s.deleted_at IS NULL
      WHERE x.deleted_at IS NULL ORDER BY x.id DESC, sc.shipment_id DESC LIMIT 1`
  );
  const from = last ? at(last.id) : 0;
  for (let i = from; i < files.length; i++) {
    if (fileSummary(files[i]).waiting > 0) return summaryOf([files[i]]);
  }
  return summaryOf([files[from]]);
}

shipmentsRouter.get("/shipments/current", (req, res) => {
  res.json(currentFile(normCode(str(req.query.code, 200)), str(req.query.since, 40)));
});

shipmentsRouter.get("/shipments/:id", (req, res) => {
  const s = get<ShipmentRow>(
    `SELECT s.id, s.waybill, s.shipped_at, s.arrives_at, s.filename, s.created_at, s.updated_at, u.login AS user_login
       FROM shipments s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ? AND s.deleted_at IS NULL`,
    Number(req.params.id)
  );
  if (!s) throw notFound("Накладная");
  const codes = all<{ code: string; code_norm: string; box: string; china_in_at: string | null; row_no: number | null }>(
    "SELECT code, code_norm, box, china_in_at, row_no FROM shipment_codes WHERE shipment_id = ? ORDER BY row_no, id",
    s.id
  );
  const found = itemsByCodes([...new Set(codes.map((c) => c.code_norm))]);
  res.json({
    ...s,
    stats: stats(codes, found),
    rows: codes.map((c) => ({ ...c, matches: (found.get(c.code_norm) ?? []).map(brief) })),
  });
});

/** Скрыть накладную (мягко): её товары снова просто «Заказан». Коды и история остаются в базе. */
shipmentsRouter.delete("/shipments/:id", (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  const s = get<{ id: number; waybill: string; deleted_at: string | null }>("SELECT id, waybill, deleted_at FROM shipments WHERE id = ?", id);
  if (!s) throw notFound("Накладная");
  if (s.deleted_at) throw conflict("Накладная уже скрыта");
  run("UPDATE shipments SET deleted_at = ? WHERE id = ?", nowIso(), id);
  audit(req, "import_waybill_undo", "shipment", id, s.waybill, null);
  res.json({ ok: true });
});

