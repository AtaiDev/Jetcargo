/**
 * Локальная база SQLite (встроенный модуль node:sqlite — без отдельного сервера БД).
 * Файл базы: server/data/app.db.
 *
 * Схема меняется только миграциями (MIGRATIONS ниже, номер хранится в PRAGMA user_version).
 * Миграции только добавляют таблицы/колонки: существующие данные не удаляются и не
 * перезаписываются. Таблицы прежнего проекта (locations, bookings, clients и т.п.)
 * не трогаются — новые таблицы названы иначе, чтобы не пересекаться с ними.
 */
import fs from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { ADMIN_FULL_NAME, ADMIN_LOGIN, ADMIN_PASSWORD, DATA_DIR, DB_FILE, IS_PROD } from "./config";
import { hashPassword } from "./security";
import { normText } from "./util";

/**
 * Локальный запуск — только тестовая база. Проверяем до того, как открыть файл на запись:
 * базу с клиентами без метки «тест» (например, копию рабочей) не трогаем вовсе — ни миграций, ни WAL.
 * Пустую базу setup() пометит тестовой сам.
 */
function guardLocal() {
  if (IS_PROD || !fs.existsSync(DB_FILE)) return;
  const ro = new DatabaseSync(DB_FILE, { readOnly: true });
  let test = false;
  let rows = 0;
  try {
    test = (ro.prepare("SELECT value FROM app_settings WHERE key = 'environment'").get()?.value ?? "") === "test";
  } catch {
    // таблицы ещё нет — пустая база
  }
  try {
    rows = Number(ro.prepare("SELECT COUNT(*) AS n FROM customers").get()?.n ?? 0);
  } catch {
    // таблицы ещё нет — пустая база
  }
  ro.close();
  if (!test && rows > 0) {
    throw new Error(
      `${DB_FILE} — не тестовая база (клиентов: ${rows}). Локально сервер работает только с тестовыми данными.\n` +
        "Запускайте из корня проекта: npm run dev (тестовая база создастся сама), пересоздать её — npm run test-data."
    );
  }
}

guardLocal();
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");

// Поиск без учёта регистра и ё/е — встроенный LOWER() в SQLite кириллицу не понижает.
db.function("norm", { deterministic: true }, (v) => (v === null || v === undefined ? "" : normText(String(v))));

export type Param = SQLInputValue;

export function all<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): number {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

/** Выполнить функцию в транзакции: либо все изменения, либо ни одного. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

/** Миграции по порядку. Уже применённые не повторяются. Только добавление — без DROP/DELETE. */
const MIGRATIONS: string[] = [
  // 1. Общие таблицы: пользователи и журнал действий.
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    login TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('admin','staff')),
    is_active INTEGER NOT NULL DEFAULT 1,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at);
  `,
  // 2. Cargo: клиенты → заказы → товары → оплаты / статусы / сканирования / выдачи / импорты.
  `
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    code TEXT,                               -- код клиента (необязательный, задаётся вручную)
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',          -- как показываем: +996 700 123 456
    phone_digits TEXT NOT NULL DEFAULT '',   -- только цифры, для поиска и сопоставления
    comment TEXT NOT NULL DEFAULT '',
    import_id INTEGER,                       -- каким импортом создан (для отката импорта)
    created_at TEXT NOT NULL DEFAULT ${NOW},
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_customers_phone ON customers(phone_digits);

  CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    sheet TEXT NOT NULL DEFAULT '',
    rows_total INTEGER NOT NULL DEFAULT 0,
    created_items INTEGER NOT NULL DEFAULT 0,
    updated_items INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT ${NOW},
    undone_at TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    order_date TEXT NOT NULL,                -- YYYY-MM-DD
    comment TEXT NOT NULL DEFAULT '',
    import_id INTEGER REFERENCES imports(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT ${NOW},
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_orders_customer ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS ix_orders_date ON orders(order_date);

  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    issued_at TEXT NOT NULL DEFAULT ${NOW},
    comment TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',           -- код товара / трек-номер (как ввели)
    code_norm TEXT NOT NULL DEFAULT '',      -- для поиска и сканера: без пробелов, в верхнем регистре
    qty INTEGER NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,           -- сумма из исходных данных, сом (за всё количество)
    price_cny REAL,                          -- то же в юанях, если известно
    real_price REAL,                         -- реальная цена для клиента, сом; NULL → берём price
    cost REAL,                               -- себестоимость, сом; NULL → неизвестна
    split_with TEXT NOT NULL DEFAULT '',     -- «Разделить с» из таблицы
    comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','in_stock','issued')),
    arrived_at TEXT,
    issued_at TEXT,
    issue_id INTEGER REFERENCES issues(id),
    import_id INTEGER REFERENCES imports(id),
    import_row INTEGER,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW},
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS ix_items_code ON order_items(code_norm);
  CREATE INDEX IF NOT EXISTS ix_items_status ON order_items(status);

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    order_item_id INTEGER NOT NULL REFERENCES order_items(id),
    amount REAL NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL DEFAULT 'cash',
    paid_at TEXT NOT NULL DEFAULT ${NOW},
    comment TEXT NOT NULL DEFAULT '',
    import_id INTEGER REFERENCES imports(id),
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT ${NOW},
    deleted_at TEXT                          -- отменённая оплата остаётся в истории
  );
  CREATE INDEX IF NOT EXISTS ix_payments_item ON payments(order_item_id);

  CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY,
    order_item_id INTEGER NOT NULL REFERENCES order_items(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    source TEXT NOT NULL,                    -- create | manual | scan | issue | import
    comment TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id),
    changed_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS ix_status_item ON status_history(order_item_id);

  -- Каждое сканирование — отдельная запись, ничего не перезаписывается.
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    code_norm TEXT NOT NULL,
    result TEXT NOT NULL,                    -- arrived | already_in_stock | already_issued | not_found
    order_item_id INTEGER REFERENCES order_items(id),
    user_id INTEGER REFERENCES users(id),
    scanned_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS ix_scans_item ON scans(order_item_id);
  CREATE INDEX IF NOT EXISTS ix_scans_at ON scans(scanned_at);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cargo_widgets (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    title TEXT NOT NULL,
    chart TEXT NOT NULL,
    span INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    is_visible INTEGER NOT NULL DEFAULT 1,
    is_builtin INTEGER NOT NULL DEFAULT 1
  );

  -- Товар со всеми расчётами: продажа, оплачено, долг, статус оплаты.
  CREATE VIEW IF NOT EXISTS v_items AS
  SELECT i.*, o.order_date, o.customer_id,
         c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
         COALESCE(i.real_price, i.price) AS sale,
         COALESCE(p.paid, 0) AS paid,
         MAX(COALESCE(i.real_price, i.price) - COALESCE(p.paid, 0), 0) AS debt,
         CASE WHEN COALESCE(p.paid, 0) <= 0 AND COALESCE(i.real_price, i.price) > 0 THEN 'unpaid'
              WHEN COALESCE(p.paid, 0) < COALESCE(i.real_price, i.price) THEN 'partial'
              ELSE 'paid' END AS pay_status
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN (SELECT order_item_id, SUM(amount) AS paid FROM payments
                WHERE deleted_at IS NULL GROUP BY order_item_id) p ON p.order_item_id = i.id
   WHERE i.deleted_at IS NULL AND o.deleted_at IS NULL AND c.deleted_at IS NULL;
  `,
  // 3. Новая логика цены (уточнение владельца):
  //    Сумма (price) — цена для клиента, это выручка, от неё считаются оплата и долг;
  //    Реальная цена (real_price) — за сколько товар выкуплен на маркетплейсе (себестоимость);
  //    прибыль = Сумма − Реальная цена. Поле cost больше не вводится, но если оно было
  //    заполнено раньше, а реальной цены нет — используется как выкуп.
  //    Пересоздаётся только представление (VIEW) — данных в таблицах это не касается.
  `
  DROP VIEW IF EXISTS v_items;
  CREATE VIEW v_items AS
  SELECT i.id, i.order_id, i.name, i.code, i.code_norm, i.qty, i.price, i.price_cny, i.real_price,
         COALESCE(i.real_price, i.cost) AS cost,
         i.split_with, i.comment, i.status, i.arrived_at, i.issued_at, i.issue_id, i.import_id, i.import_row,
         i.created_by, i.created_at, i.updated_at,
         o.order_date, o.customer_id,
         c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
         i.price AS sale,
         COALESCE(p.paid, 0) AS paid,
         MAX(i.price - COALESCE(p.paid, 0), 0) AS debt,
         CASE WHEN COALESCE(p.paid, 0) <= 0 AND i.price > 0 THEN 'unpaid'
              WHEN COALESCE(p.paid, 0) < i.price THEN 'partial'
              ELSE 'paid' END AS pay_status
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN (SELECT order_item_id, SUM(amount) AS paid FROM payments
                WHERE deleted_at IS NULL GROUP BY order_item_id) p ON p.order_item_id = i.id
   WHERE i.deleted_at IS NULL AND o.deleted_at IS NULL AND c.deleted_at IS NULL;
  `,
  // 4. Подпись «Выручка» → «Сумма заказов» в заголовках графиков (только если заголовок не меняли).
  `
  UPDATE cargo_widgets SET title = 'Сумма заказов и товары по дням' WHERE key = 'revenue_by_day' AND title = 'Выручка и товары по дням';
  UPDATE cargo_widgets SET title = 'Сумма заказов и прибыль по месяцам' WHERE key = 'revenue_by_month' AND title = 'Выручка и прибыль по месяцам';
  `,
  // 5. Партии: товар приходит партиями; у партии — вес, ставки в $, доставка и курс.
  //    Товар привязывается к партии (batch_id). Только добавление — существующие данные не меняются.
  `
  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    weight_buy_kg REAL NOT NULL DEFAULT 0,      -- ① вес, за который платили
    rate_buy_usd REAL NOT NULL DEFAULT 1.8,     -- ① $ за кг (выкуп веса)
    delivery_usd REAL NOT NULL DEFAULT 0,       -- ② доставка, $
    weight_client_kg REAL NOT NULL DEFAULT 0,   -- ③ вес, который считаете клиентам
    rate_client_usd REAL NOT NULL DEFAULT 2.8,  -- ③ $ за кг клиентам
    usd_rate REAL NOT NULL DEFAULT 87.5,        -- курс: сом за 1 $
    comment TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT ${NOW},
    deleted_at TEXT
  );
  ALTER TABLE order_items ADD COLUMN batch_id INTEGER REFERENCES batches(id);
  CREATE INDEX IF NOT EXISTS ix_items_batch ON order_items(batch_id);
  INSERT OR IGNORE INTO app_settings (key, value) VALUES ('usd_rate', '87.5');

  DROP VIEW IF EXISTS v_items;
  CREATE VIEW v_items AS
  SELECT i.id, i.order_id, i.name, i.code, i.code_norm, i.qty, i.price, i.price_cny, i.real_price,
         COALESCE(i.real_price, i.cost) AS cost,
         i.split_with, i.comment, i.status, i.arrived_at, i.issued_at, i.issue_id, i.import_id, i.import_row,
         i.batch_id, i.created_by, i.created_at, i.updated_at,
         o.order_date, o.customer_id,
         c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
         i.price AS sale,
         COALESCE(p.paid, 0) AS paid,
         MAX(i.price - COALESCE(p.paid, 0), 0) AS debt,
         CASE WHEN COALESCE(p.paid, 0) <= 0 AND i.price > 0 THEN 'unpaid'
              WHEN COALESCE(p.paid, 0) < i.price THEN 'partial'
              ELSE 'paid' END AS pay_status
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN (SELECT order_item_id, SUM(amount) AS paid FROM payments
                WHERE deleted_at IS NULL GROUP BY order_item_id) p ON p.order_item_id = i.id
   WHERE i.deleted_at IS NULL AND o.deleted_at IS NULL AND c.deleted_at IS NULL;
  `,
  // 6. Партии: ① «Выкуп веса» и ② «Доставка» — просто суммы, которые отдали, в $ или сомах.
  //    Раньше ① считался как вес × $/кг; в поле «вес» вводили именно отданную сумму —
  //    переносим её в buy_amount. Старые колонки не трогаем (только добавление).
  `
  ALTER TABLE batches ADD COLUMN buy_amount REAL NOT NULL DEFAULT 0;
  ALTER TABLE batches ADD COLUMN buy_cur TEXT NOT NULL DEFAULT 'usd' CHECK (buy_cur IN ('usd','som'));
  ALTER TABLE batches ADD COLUMN delivery_cur TEXT NOT NULL DEFAULT 'usd' CHECK (delivery_cur IN ('usd','som'));
  UPDATE batches SET buy_amount = weight_buy_kg;
  `,
  // 7. ③ «Вес клиентам» — тоже просто общая сумма (сом или $), а не вес × ставка.
  //    Сканы можно скрыть (мягко: deleted_at), например тестовые. Только добавление колонок.
  `
  ALTER TABLE batches ADD COLUMN client_amount REAL NOT NULL DEFAULT 0;
  ALTER TABLE batches ADD COLUMN client_cur TEXT NOT NULL DEFAULT 'som' CHECK (client_cur IN ('usd','som'));
  ALTER TABLE scans ADD COLUMN deleted_at TEXT;
  `,
  // 8. Выдачи можно скрыть из истории (мягко: deleted_at). Товары при этом не меняются.
  `
  ALTER TABLE issues ADD COLUMN deleted_at TEXT;
  `,
  // 9. Записи журнала можно скрыть (мягко: deleted_at) — например, очистить после тестов.
  `
  ALTER TABLE audit_log ADD COLUMN deleted_at TEXT;
  `,
  // 10. Накладные из Китая: какие коды (трек-номера) отправлены, когда и в какой коробке.
  //     «В пути» — не новый статус, а этап, который вычисляется: заказанный товар, чей код есть
  //     в загруженной (не скрытой) накладной. Только новые таблицы и пересоздание VIEW —
  //     существующие данные не меняются; скрыли накладную — товары снова просто «Заказан».
  `
  CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY,
    waybill TEXT NOT NULL,                   -- номер накладной (运单号)
    shipped_at TEXT,                         -- дата отправки из Китая (发货时间), YYYY-MM-DD
    arrives_at TEXT,                         -- дата прибытия (到达时间), если указана
    filename TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW},
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_shipments_waybill ON shipments(waybill);

  CREATE TABLE IF NOT EXISTS shipment_codes (
    id INTEGER PRIMARY KEY,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id),
    code TEXT NOT NULL,                      -- номер заказа (订单号) как в файле
    code_norm TEXT NOT NULL,                 -- для сопоставления с кодом товара
    box TEXT NOT NULL DEFAULT '',            -- номер коробки (箱子编号)
    client_code TEXT NOT NULL DEFAULT '',    -- код клиента у китайцев (客户代码)
    china_in_at TEXT,                        -- поступил на склад в Китае (入库时间)
    row_no INTEGER
  );
  CREATE INDEX IF NOT EXISTS ix_shipment_codes_code ON shipment_codes(code_norm);
  CREATE INDEX IF NOT EXISTS ix_shipment_codes_ship ON shipment_codes(shipment_id);

  DROP VIEW IF EXISTS v_items;
  CREATE VIEW v_items AS
  SELECT i.id, i.order_id, i.name, i.code, i.code_norm, i.qty, i.price, i.price_cny, i.real_price,
         COALESCE(i.real_price, i.cost) AS cost,
         i.split_with, i.comment, i.status, i.arrived_at, i.issued_at, i.issue_id, i.import_id, i.import_row,
         i.batch_id, i.created_by, i.created_at, i.updated_at,
         o.order_date, o.customer_id,
         c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
         i.price AS sale,
         COALESCE(p.paid, 0) AS paid,
         MAX(i.price - COALESCE(p.paid, 0), 0) AS debt,
         CASE WHEN COALESCE(p.paid, 0) <= 0 AND i.price > 0 THEN 'unpaid'
              WHEN COALESCE(p.paid, 0) < i.price THEN 'partial'
              ELSE 'paid' END AS pay_status,
         ts.id AS transit_id, ts.waybill AS transit_waybill, ts.shipped_at AS transit_shipped_at,
         CASE WHEN i.status = 'ordered' AND ts.id IS NOT NULL THEN 'in_transit' ELSE i.status END AS stage
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN (SELECT order_item_id, SUM(amount) AS paid FROM payments
                WHERE deleted_at IS NULL GROUP BY order_item_id) p ON p.order_item_id = i.id
    LEFT JOIN (SELECT sc.code_norm, MAX(sc.shipment_id) AS sid FROM shipment_codes sc
                 JOIN shipments s ON s.id = sc.shipment_id AND s.deleted_at IS NULL
                GROUP BY sc.code_norm) t ON t.code_norm = i.code_norm AND i.code_norm <> ''
    LEFT JOIN shipments ts ON ts.id = t.sid
   WHERE i.deleted_at IS NULL AND o.deleted_at IS NULL AND c.deleted_at IS NULL;
  `,
];

function migrate() {
  const current = Number(get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(() => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
    console.log(`Миграция ${v + 1} применена`);
  }
}

// --- Первичное заполнение (только настройки и администратор — бизнес-данных нет) ----

/** Блоки аналитики дашборда (данные считает routes/dashboard.ts). */
const WIDGETS: [string, string, string, number, number][] = [
  ["revenue_by_day", "Сумма заказов и товары по дням", "combo", 2, 10],
  ["pay_split", "Оплачено / не оплачено", "donut", 1, 20],
  ["revenue_by_month", "Сумма заказов и прибыль по месяцам", "bar", 2, 30],
  ["status_split", "Товары по статусам", "donut", 1, 40],
  ["items_by_day", "Поступления и выдачи по дням", "bar", 2, 50],
  ["top_debtors", "Самые большие долги", "hbar", 1, 60],
];

export function setup(): void {
  migrate();
  for (const [key, title, chart, span, position] of WIDGETS) {
    run(
      "INSERT OR IGNORE INTO cargo_widgets (key, title, chart, span, position) VALUES (?, ?, ?, ?, ?)",
      key, title, chart, span, position
    );
  }
  run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('cny_rate', '13')");
  // Локальная база — всегда тестовая (guardLocal уже не пустил сюда базу с чужими данными).
  // Метку видит панель (полоса «Тестовая среда»), а seed-b2.mjs не пустит такую базу в облако.
  if (!IS_PROD) run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('environment', 'test')");

  const users = get<{ n: number }>("SELECT COUNT(*) AS n FROM users")!.n;
  if (users === 0) {
    if (!ADMIN_LOGIN || ADMIN_PASSWORD.length < 6) {
      throw new Error("В базе нет пользователей: задайте ADMIN_LOGIN и ADMIN_PASSWORD (от 6 символов) в server/.env");
    }
    run(
      "INSERT INTO users (login, full_name, role, password_hash) VALUES (?, ?, 'admin', ?)",
      ADMIN_LOGIN, ADMIN_FULL_NAME, hashPassword(ADMIN_PASSWORD)
    );
    console.log(`Создан администратор «${ADMIN_LOGIN}»`);
  }
}

/** Тестовая ли база (метку ставит setup() при локальном запуске; через API её не поменять). */
export function isTestDb(): boolean {
  return get<{ value: string }>("SELECT value FROM app_settings WHERE key = 'environment'")?.value === "test";
}
