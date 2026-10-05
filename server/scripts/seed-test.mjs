/**
 * Тестовая база для локальной панели: вымышленные клиенты, заказы, приём, выдачи, оплаты,
 * партии, сотрудники, журнал и файл для проверки импорта — в каждом разделе есть что потрогать.
 * Локальная панель (npm run dev) работает только с ней: рабочие данные живут в облаке и сюда не попадают.
 *
 *   npm run test-data                                       (в корне) — пересоздать тестовую базу
 *   node --env-file=.env scripts/seed-test.mjs              создать, если её ещё нет (так делает npm run dev)
 *   node --env-file=.env scripts/seed-test.mjs --reset      пересоздать заново
 *
 * База — всегда server/data-test/app.db. Локальный сервер помечает её тестовой
 * (app_settings.environment = test): панель показывает полосу «Тестовая среда»,
 * а seed-b2.mjs откажется загружать такую базу в облако. Базу без этой метки и с клиентами
 * скрипт не трогает. Телефоны клиентов — +996 000 …: таких номеров не существует.
 * Вход — логин и пароль из server/.env (ADMIN_LOGIN / ADMIN_PASSWORD).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import ExcelJS from "exceljs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "data-test");
const FILE = path.join(DIR, "app.db");
const PORT = 8790;
const API = `http://127.0.0.1:${PORT}/api/v1`;
const reset = process.argv.includes("--reset");

/** Пароль тестовых сотрудников (только в тестовой базе на этом компьютере). */
const STAFF_PASSWORD = "test12345";

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const LOGIN = process.env.ADMIN_LOGIN?.trim();
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!LOGIN || !PASSWORD) fail("Нужны ADMIN_LOGIN и ADMIN_PASSWORD в server/.env — с ними вы войдёте в тестовую панель");

// --- Что уже лежит в папке -------------------------------------------------------------

if (existsSync(FILE)) {
  const db = new DatabaseSync(FILE, { readOnly: true });
  let test = false;
  let customers = 0;
  try {
    test = db.prepare("SELECT value FROM app_settings WHERE key = 'environment'").get()?.value === "test";
  } catch {
    // пустой файл — можно пересоздать
  }
  try {
    customers = Number(db.prepare("SELECT COUNT(*) AS n FROM customers").get()?.n ?? 0);
  } catch {
    // таблиц ещё нет
  }
  db.close();
  if (!test && customers > 0) fail(`${FILE}: это не тестовая база (клиентов: ${customers}) — не трогаю`);
  if (test && customers > 0 && !reset) {
    console.log(`Тестовая база на месте: ${FILE}`);
    process.exit(0);
  }
  try {
    for (const f of [FILE, `${FILE}-wal`, `${FILE}-shm`]) rmSync(f, { force: true });
  } catch {
    fail("Тестовая база занята — остановите npm run dev (Ctrl+C) и повторите");
  }
}
mkdirSync(DIR, { recursive: true });
console.log("Создаю тестовую базу с вымышленными данными…");

// --- Временный сервер на тестовой базе: данные идут через API, со всеми расчётами ----------

const env = {
  ...process.env,
  NODE_ENV: "development",
  DATA_DIR: DIR,
  PORT: String(PORT),
  HOST: "127.0.0.1",
  PUBLIC_HOSTS: "",
  RENDER_EXTERNAL_HOSTNAME: "",
};
delete env.RENDER;
const server = spawn(process.execPath, ["--import", "tsx", "--disable-warning=ExperimentalWarning", "src/index.ts"], {
  cwd: ROOT,
  env,
  stdio: ["ignore", "ignore", "pipe"],
});
let serverErr = "";
server.stderr.on("data", (d) => (serverErr += d));
const exited = new Promise((r) => server.on("exit", r));
const stop = async () => {
  if (server.exitCode === null) server.kill();
  await exited;
};

try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`сервер не запустился:\n${serverErr}`);
    if (await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok, () => false)) break;
    if (i > 120) throw new Error(`сервер не ответил за 30 секунд (порт ${PORT} занят?)`);
    await new Promise((r) => setTimeout(r, 250));
  }
  const mode = await fetch(`${API}/env`).then((r) => r.json());
  if (mode.env !== "test") throw new Error("сервер не пометил базу как тестовую — останавливаюсь");

  const s = await fill();
  await stop();
  spreadDates();
  await writeImportSample();
  console.log(`✓ Тестовая база готова: ${FILE}`);
  console.log(`  клиентов ${s.customers}, товаров ${s.items}: ждут приёма ${s.ordered}, на складе ${s.inStock}, выдано ${s.issued}; выдач ${s.issues}, партий 3`);
  console.log(`  вход: логин и пароль из server/.env (${LOGIN}); сотрудники sklad и kassa — пароль ${STAFF_PASSWORD}`);
  console.log("  приём сканером: коды TEST001 … TEST010 ждут приёма, TEST050 — два товара одним кодом,");
  console.log("                  TEST100 уже на складе, TEST200 уже выдан, TEST999 — такого кода нет");
  console.log(`  импорт Excel: ${path.join(DIR, "Тестовый импорт.xlsx")}`);
} catch (e) {
  await stop();
  fail(e instanceof Error ? e.message : String(e));
}

// --- Данные ------------------------------------------------------------------------------

async function fill() {
  let seed = 20261004;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const round10 = (n) => Math.round(n / 10) * 10;

  const call = async (token, method, p, body) => {
    const r = await fetch(API + p, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${j.detail ?? ""}`);
    return j;
  };
  const login = async (username, password) => {
    const r = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const j = await r.json().catch(() => ({}));
    const token = j.access_token ?? j.access;
    if (!r.ok || !token) throw new Error(`не удалось войти как «${username}» (${r.status} ${j.detail ?? ""})`);
    return token;
  };

  const admin = await login(LOGIN, PASSWORD);
  const A = (method, p, body) => call(admin, method, p, body);

  // Сотрудники: склад принимает, касса выдаёт — в журнале видно, кто что сделал.
  await A("POST", "/users", { login: "sklad", full_name: "Азиз (склад, тест)", role: "staff", password: STAFF_PASSWORD });
  await A("POST", "/users", { login: "kassa", full_name: "Айжан (касса, тест)", role: "staff", password: STAFF_PASSWORD });
  await A("POST", "/users", { login: "stazher", full_name: "Стажёр (отключён, тест)", role: "staff", password: STAFF_PASSWORD, is_active: false });
  const sklad = await login("sklad", STAFF_PASSWORD);
  const kassa = await login("kassa", STAFF_PASSWORD);
  const S = (method, p, body) => call(sklad, method, p, body);
  const K = (method, p, body) => call(kassa, method, p, body);

  await A("PATCH", "/settings", { cny_rate: 12.6 });

  const NAMES = [
    "Айгерим Токтосунова", "Нурлан Абдыкадыров", "Жылдыз Асанова", "Бакыт Мамытов", "Айпери Садыкова",
    "Эрмек Жумабеков", "Алина Ким", "Мирлан Осмонов", "Нургуль Бекешова", "Азамат Турсунов",
    "Канышай Эсенова", "Тимур Исаков", "Гульнара Шаршеева", "Дастан Керимбеков", "Медина Абдраимова",
    "Улан Сыдыков", "Салтанат Орозбекова", "Бекзат Алиев", "Элина Жээнбекова", "Адилет Касымов",
    "Чолпон Бакирова", "Руслан Ибраимов",
  ];
  const GOODS = [
    ["Кроссовки беговые", 3200, 5400], ["Худи оверсайз", 1400, 2600], ["Наушники TWS", 900, 2100],
    ["Чехол для телефона", 350, 700], ["Рюкзак городской", 1500, 2900], ["Платье летнее", 1300, 2500],
    ["Умные часы", 2400, 4800], ["Термокружка 500 мл", 450, 950], ["Кардиган вязаный", 1600, 2800],
    ["Конструктор детский", 1100, 2300], ["Сумка кожаная", 2600, 4600], ["Джинсы прямые", 1500, 2700],
    ["Ночник-проектор", 700, 1400], ["Органайзер для косметики", 500, 1100], ["Пауэрбанк 20000 мАч", 1200, 2200],
    ["Кепка бейсбольная", 400, 900], ["Солнцезащитные очки", 600, 1300], ["Коврик для йоги", 800, 1600],
    ["Постельное бельё евро", 2200, 3900], ["Пуховик зимний", 4200, 6900], ["Игровая мышь", 1000, 2000],
  ];
  const NOTES = ["цвет чёрный", "размер 42", "размер M", "белый, без логотипа", "подарочная упаковка", "проверить комплектность"];
  // Коды с приставкой TEST — их не спутать с настоящими трек-номерами.
  const code = () => `TEST${pick(["YT", "SF", "JT", "ZTO", "YD"])}${int(10000000, 99999999)}`;
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return local(d);
  };
  const line = (fixedCode) => {
    const [g, lo, hi] = pick(GOODS);
    const price = round10(int(lo, hi));
    const known = rnd() < 0.85; // у части товаров реальная цена (выкуп) неизвестна — прибыль «—»
    const real = known ? round10(price * (0.55 + rnd() * 0.2)) : null;
    return {
      name: g,
      code: fixedCode ?? code(),
      qty: rnd() < 0.8 ? 1 : 2,
      price,
      real_price: real,
      price_cny: real && rnd() < 0.4 ? Math.round(real / 12.6) : null,
      comment: rnd() < 0.15 ? pick(NOTES) : "",
    };
  };

  // Клиенты: у части — код клиента и комментарий (поиск по коду), у одного нет телефона,
  // один — совсем новый, без заказов.
  const customers = [];
  for (const [n, name] of NAMES.entries()) {
    const phone = n === 11 ? "" : `+996 000 ${100 + n} ${String(int(100, 999))}`;
    if (n < 8) {
      const c = await A("POST", "/customers", {
        name,
        phone,
        code: `JC-${101 + n}`,
        comment: n === 0 ? "Постоянный клиент, берёт оптом" : n === 3 ? "Предупреждать о приходе заранее" : "",
      });
      customers.push({ id: c.id, name, phone });
    } else customers.push({ id: null, name, phone });
  }
  await A("POST", "/customers", { name: "Новый клиент (без заказов)", phone: "+996 000 999 001", code: "JC-200" });

  // Заказы: у каждого клиента 1–5 заказов за последние 4 месяца, свежие — чаще.
  const all = [];
  const order = async (c, age, lines, pay = undefined) => {
    const total = lines.reduce((s, l) => s + l.price, 0);
    const p = rnd();
    const mode = pay ?? (p < 0.4 ? "full" : p < 0.65 ? "part" : "none");
    const r = await (rnd() < 0.7 ? A : S)("POST", "/orders", {
      ...(c.id ? { customer_id: c.id } : { customer_name: c.name, customer_phone: c.phone }),
      order_date: daysAgo(age),
      status: "ordered",
      pay: mode,
      paid_amount: mode === "part" ? round10(total * (0.3 + rnd() * 0.4)) : undefined,
      comment: rnd() < 0.1 ? "заказ через WhatsApp" : "",
      items: lines,
    });
    c.id = r.customer_id;
    const out = r.items.map((it) => ({ id: it.id, code: it.code, customer_id: c.id, age }));
    all.push(...out);
    return out;
  };
  for (const c of customers) {
    for (let o = 0, orders = int(1, 5); o < orders; o++) {
      const age = Math.floor(Math.pow(rnd(), 1.5) * 120);
      await order(c, age, Array.from({ length: int(1, 4) }, () => line()));
    }
  }

  // Коды для ручной проверки приёма — короткие, их удобно набрать.
  const expect = [];
  for (let i = 1; i <= 10; i++) {
    const [it] = await order(customers[(i * 3) % customers.length], int(0, 5), [line(`TEST${String(i).padStart(3, "0")}`)]);
    expect.push(it.id);
  }
  const twin = customers[4];
  await order(twin, 2, [
    { ...line("TEST050"), name: "Комплект штор, часть 1" },
    { ...line("TEST050"), name: "Комплект штор, часть 2" },
  ], "none");
  const [t100] = await order(customers[1], 9, [{ ...line("TEST100"), name: "Электрочайник" }], "full");
  const [t200] = await order(customers[2], 30, [{ ...line("TEST200"), name: "Фен для волос" }], "full");

  // Партии: старая (закроется), текущая и новая.
  const b1 = await A("POST", "/batches", { name: "Партия №1 · Гуанчжоу (тест)" });
  const b2 = await A("POST", "/batches", { name: "Партия №2 · Иу (тест)" });
  const b3 = await A("POST", "/batches", { name: "Партия №3 · Урумчи (тест)" });

  // Приём: старые заказы приходят почти все, свежие — реже. Часть принятого — без партии
  // (их видно в «Добавить товары в партию»).
  const fixed = new Set([...expect, t100.id, t200.id]);
  const arrived = [];
  for (const it of all) {
    if (fixed.has(it.id) || it.code === "TEST050") continue;
    const chance = it.age > 20 ? 0.95 : it.age > 8 ? 0.7 : it.age > 3 ? 0.35 : 0.1;
    if (rnd() >= chance) continue;
    const batch = it.age > 45 ? b1.id : it.age > 15 ? b2.id : it.age > 5 && rnd() < 0.7 ? b3.id : undefined;
    await (rnd() < 0.75 ? S : A)("POST", "/scan", { code: it.code, ...(batch ? { batch_id: batch } : {}) });
    arrived.push(it);
  }
  await S("POST", "/scan", { code: "TEST100", batch_id: b3.id });
  await S("POST", "/scan", { code: "TEST200", batch_id: b2.id });
  arrived.push({ ...t100 }, { ...t200 });
  // Ошибочные и повторные сканы — для истории склада.
  for (const c of ["TEST0000000", "TESTSF123", "TESTYT0000"]) await S("POST", "/scan", { code: c });
  for (const it of arrived.slice(0, 4)) await S("POST", "/scan", { code: it.code });

  // Суммы партий: выкуп веса, доставка, вес клиентам (в $ и сомах).
  await A("PATCH", `/batches/${b1.id}`, { usd_rate: 87.3, buy_cur: "usd", buy_amount: 420, delivery_cur: "som", delivery_usd: 18500, client_cur: "som", client_amount: 61000, comment: "Тестовая партия: пришла полностью" });
  await A("PATCH", `/batches/${b2.id}`, { buy_cur: "usd", buy_amount: 310, delivery_cur: "usd", delivery_usd: 150, client_cur: "som", client_amount: 42500 });
  await A("PATCH", `/batches/${b3.id}`, { buy_cur: "som", buy_amount: 16800 });
  await A("PATCH", `/batches/${b1.id}`, { status: "closed" });

  // Предоплаты и оплаты долга отдельными платежами (наличные, карта, перевод).
  const items = async (cid) => (await A("GET", `/items?customer_id=${cid}&limit=500`)).rows;
  let paidOnce = null;
  for (const c of customers.filter((_, i) => i % 3 === 0)) {
    for (const it of (await items(c.id)).filter((x) => x.debt > 0 && x.status !== "issued").slice(0, 2)) {
      const amount = rnd() < 0.5 ? it.debt : round10(it.debt / 2);
      if (amount <= 0) continue;
      const p = await K("POST", `/items/${it.id}/payments`, { amount, method: pick(["cash", "card", "transfer"]), comment: rnd() < 0.3 ? "предоплата" : "" });
      paidOnce ??= p.id;
    }
  }
  // Одна оплата отменена — в истории оплат она остаётся с пометкой.
  if (paidOnce) await A("DELETE", `/payments/${paidOnce}`);
  // Оплата долга одной суммой — распределяется по товарам клиента.
  for (const c of customers.filter((_, i) => i % 5 === 1)) {
    const debt = (await items(c.id)).filter((x) => x.status !== "issued").reduce((s, x) => s + x.debt, 0);
    if (debt >= 200) await K("POST", `/customers/${c.id}/payments`, { amount: round10(debt * 0.6), method: "transfer", comment: "оплата долга (тест)" });
  }

  // Выдача: большую часть давно пришедшего выдаём; часть — с неполной оплатой или в долг.
  const groups = new Map();
  for (const it of arrived) {
    if (it.id === t100.id) continue;
    if (it.id !== t200.id && !(it.age > 12 && rnd() < 0.8)) continue;
    const key = `${it.customer_id}|${it.age > 50 ? "old" : "new"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it.id);
  }
  let issues = 0;
  for (const [key, ids] of groups) {
    const cid = Number(key.split("|")[0]);
    const rows = (await items(cid)).filter((r) => ids.includes(r.id));
    const debt = rows.reduce((s, r) => s + r.debt, 0);
    const p = rnd();
    const payment = p < 0.7 ? debt : p < 0.9 ? round10(debt * 0.5) : 0;
    await (rnd() < 0.8 ? K : A)("POST", "/issues", { customer_id: cid, item_ids: ids, payment_amount: Math.min(payment, debt), method: pick(["cash", "cash", "card", "transfer"]) });
    issues++;
  }
  await S("POST", "/scan", { code: "TEST200" }); // повторный скан уже выданного

  // Правки товара — для истории изменений и журнала.
  const some = (await items(customers[0].id))[0];
  if (some) await A("PATCH", `/items/${some.id}`, { comment: "клиент просил упаковать отдельно" });
  const del = (await items(customers[5].id)).find((x) => x.status === "ordered");
  if (del) await A("DELETE", `/items/${del.id}`);

  // Импорт из Excel (уже выполненный — его видно в истории импортов и можно отменить).
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Заказы");
  ws.addRow(["Дата заказа", "Имя клиента", "Телефон", "Название товара", "Код товара", "Количество", "Сумма", "Реальная цена", "Статус", "Оплата"]);
  const imp = [
    ["Самат Жапаров", "+996 000 301 111", "Плед флисовый", 1200, 760],
    ["Самат Жапаров", "+996 000 301 111", "Подушка ортопедическая", 1500, 980],
    ["Айсулуу Токтогулова", "+996 000 302 222", "Набор кистей для макияжа", 800, 450],
    ["Айсулуу Токтогулова", "+996 000 302 222", "Зеркало с подсветкой", 1700, 1050],
    ["Бектур Асылбеков", "+996 000 303 333", "Автомобильный держатель", 600, 330],
  ];
  for (const [i, [name, phone, goods, price, real]] of imp.entries()) {
    ws.addRow([daysAgo(35 - i), name, phone, goods, `TESTIMP${1000 + i}`, 1, price, real, "Заказан", i % 2 ? "Оплачено" : "Не оплачено"]);
  }
  const form = new FormData();
  form.append("file", new Blob([await wb.xlsx.writeBuffer()]), "Импорт прошлого месяца (тест).xlsx");
  const r = await fetch(`${API}/import/commit`, { method: "POST", headers: { Authorization: `Bearer ${admin}` }, body: form });
  if (!r.ok) throw new Error(`импорт: ${r.status} ${(await r.json().catch(() => ({}))).detail ?? ""}`);

  const counts = (await A("GET", "/items?limit=1")).counts;
  return {
    customers: NAMES.length + 1 + 3,
    items: counts.all,
    ordered: counts.ordered,
    inStock: counts.in_stock,
    issued: counts.issued,
    issues,
  };
}

/** Всё создано «сейчас» — разносим даты по дням, как в жизни: заказ → приход через 6–14 дней → выдача. */
function spreadDates() {
  const db = new DatabaseSync(FILE);
  let seed = 77;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const now = new Date();
  const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const plus = (day, n) => {
    const x = new Date(`${day}T12:00:00`);
    x.setDate(x.getDate() + n);
    return local(x);
  };
  const at = (day, h0, h1) => {
    const d = new Date(`${day}T00:00:00`);
    d.setHours(int(h0, h1), int(0, 59), int(0, 59));
    return d > now ? new Date(now.getTime() - int(5, 90) * 60000) : d;
  };
  const between = (a, b) => new Date(a.getTime() + rnd() * Math.max(0, b.getTime() - a.getTime()));
  // Случайный момент, но в рабочие часы (9–19), если такой есть в промежутке.
  const workBetween = (a, b) => {
    let t = between(a, b);
    for (let i = 0; i < 8; i++) {
      t = between(a, b);
      const w = new Date(t);
      w.setHours(int(9, 19), int(0, 59), int(0, 59));
      if (w >= a && w <= b) return w;
    }
    return t;
  };
  const iso = (d) => d.toISOString();

  const items = db
    .prepare("SELECT i.id, i.arrived_at, i.issued_at, i.issue_id, o.order_date, o.id AS order_id FROM order_items i JOIN orders o ON o.id = i.order_id")
    .all();
  const upd = db.prepare("UPDATE order_items SET created_at = ?, updated_at = ?, arrived_at = ?, issued_at = ? WHERE id = ?");
  const hist = db.prepare("UPDATE status_history SET changed_at = ? WHERE order_item_id = ? AND to_status = ?");
  const firstScan = db.prepare("UPDATE scans SET scanned_at = ? WHERE id = (SELECT MIN(id) FROM scans WHERE order_item_id = ?)");
  const laterScans = db.prepare("SELECT id FROM scans WHERE order_item_id = ? AND id > (SELECT MIN(id) FROM scans WHERE order_item_id = ?)");
  const setScan = db.prepare("UPDATE scans SET scanned_at = ? WHERE id = ?");
  const payOrder = db.prepare("UPDATE payments SET paid_at = ?, created_at = ? WHERE order_item_id = ? AND comment = 'при оформлении заказа'");
  const LUMP = "оплата долга (тест)";
  const payLater = db.prepare(
    `SELECT id FROM payments WHERE order_item_id = ? AND comment NOT IN ('при оформлении заказа', 'при выдаче', '${LUMP}') AND method <> 'import'`
  );
  const setPay = db.prepare("UPDATE payments SET paid_at = ?, created_at = ? WHERE id = ?");
  const orderAt = db.prepare("UPDATE orders SET created_at = ? WHERE id = ? AND created_at > ?");
  const issueAt = new Map();
  const itemTimes = new Map();

  db.exec("BEGIN");
  for (const it of items) {
    const created = at(it.order_date, 9, 20);
    let arrived = null;
    let issued = null;
    if (it.arrived_at) {
      let day = plus(it.order_date, int(6, 14));
      if (day > local(now)) day = local(now);
      arrived = at(day, 9, 17);
      if (arrived < created) arrived = new Date(Math.min(created.getTime() + 3600000, now.getTime() - 120000));
    }
    if (it.issued_at && arrived) {
      let day = plus(local(arrived), int(1, 6));
      if (day > local(now)) day = local(now);
      issued = at(day, 11, 19);
      if (issued <= arrived) issued = new Date(Math.min(arrived.getTime() + 2 * 3600000, now.getTime() - 60000));
      const prev = issueAt.get(it.issue_id);
      if (!prev || issued > prev) issueAt.set(it.issue_id, issued);
    }
    itemTimes.set(it.id, { created, arrived, issued });
    upd.run(iso(created), iso(issued ?? arrived ?? created), arrived && iso(arrived), issued && iso(issued), it.id);
    hist.run(iso(created), it.id, "ordered");
    if (arrived) {
      hist.run(iso(arrived), it.id, "in_stock");
      firstScan.run(iso(arrived), it.id);
      // Повторные сканы — позже прихода (или выдачи).
      for (const s of laterScans.all(it.id, it.id)) setScan.run(iso(workBetween(issued ?? arrived, now)), s.id);
    }
    payOrder.run(iso(created), iso(created), it.id);
    // Отдельные оплаты — между заказом и выдачей (или сегодняшним днём).
    for (const p of payLater.all(it.id)) {
      const t = iso(workBetween(created, issued ?? now));
      setPay.run(t, t, p.id);
    }
    orderAt.run(iso(created), it.order_id, iso(created));
  }
  // Выдача целиком — по последнему товару в ней: все её товары и оплаты в один момент.
  for (const [id, d] of issueAt) {
    const t = iso(d);
    db.prepare("UPDATE issues SET issued_at = ? WHERE id = ?").run(t, id);
    db.prepare("UPDATE order_items SET issued_at = ?, updated_at = ? WHERE issue_id = ?").run(t, t, id);
    db.prepare(
      "UPDATE status_history SET changed_at = ? WHERE to_status = 'issued' AND order_item_id IN (SELECT id FROM order_items WHERE issue_id = ?)"
    ).run(t, id);
    db.prepare(
      "UPDATE payments SET paid_at = ?, created_at = ? WHERE comment = 'при выдаче' AND order_item_id IN (SELECT id FROM order_items WHERE issue_id = ?)"
    ).run(t, t, id);
  }
  // Оплата долга одной суммой — один момент на всю сумму: после последнего заказа, до первой выдачи.
  const lumps = db
    .prepare(`SELECT o.customer_id AS cid, p.id, p.order_item_id AS item FROM payments p JOIN order_items i ON i.id = p.order_item_id
               JOIN orders o ON o.id = i.order_id WHERE p.comment = ?`)
    .all(LUMP);
  for (const cid of new Set(lumps.map((l) => l.cid))) {
    const mine = lumps.filter((l) => l.cid === cid);
    const lo = new Date(Math.max(...mine.map((l) => itemTimes.get(l.item).created.getTime())));
    let hi = new Date(Math.min(...mine.map((l) => (itemTimes.get(l.item).issued ?? now).getTime())));
    if (hi < lo) hi = lo;
    const t = iso(workBetween(lo, hi));
    for (const l of mine) setPay.run(t, t, l.id);
  }
  // Ненайденные коды — в последние дни.
  for (const s of db.prepare("SELECT id FROM scans WHERE order_item_id IS NULL").all()) {
    setScan.run(iso(at(local(new Date(now.getTime() - int(0, 6) * 86400000)), 9, 18)), s.id);
  }

  db.exec("UPDATE customers SET created_at = COALESCE((SELECT MIN(o.created_at) FROM orders o WHERE o.customer_id = customers.id), created_at)");
  db.exec("UPDATE batches SET created_at = (SELECT COALESCE(MIN(i.arrived_at), batches.created_at) FROM order_items i WHERE i.batch_id = batches.id)");
  const start = new Date(now.getTime() - 125 * 86400000).toISOString();
  db.prepare("UPDATE users SET created_at = ?").run(start);
  db.prepare("UPDATE imports SET created_at = COALESCE((SELECT MIN(o.created_at) FROM orders o WHERE o.import_id = imports.id), created_at)").run();

  // Журнал действий — в те же моменты, что и сами действия.
  const audit = db.prepare("SELECT id, action, entity, entity_id, new_value FROM audit_log").all();
  const setAudit = db.prepare("UPDATE audit_log SET created_at = ? WHERE id = ?");
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  for (const a of audit) {
    let t = null;
    if (a.entity === "order" && a.action === "create") t = one("SELECT created_at AS t FROM orders WHERE id = ?", a.entity_id)?.t;
    else if (a.action === "scan") t = one("SELECT arrived_at AS t FROM order_items WHERE id = ?", a.entity_id)?.t;
    else if (a.action === "issue") {
      try {
        t = one("SELECT issued_at AS t FROM issues WHERE id = ?", JSON.parse(a.new_value).issue_id)?.t;
      } catch {
        t = null;
      }
    } else if (a.action === "payment" && a.entity === "item") {
      t = one("SELECT MAX(paid_at) AS t FROM payments WHERE order_item_id = ? AND comment NOT IN ('при выдаче', 'при оформлении заказа')", a.entity_id)?.t;
    } else if (a.action === "payment" && a.entity === "customer") {
      t = one(
        `SELECT MAX(p.paid_at) AS t FROM payments p JOIN order_items i ON i.id = p.order_item_id JOIN orders o ON o.id = i.order_id
          WHERE o.customer_id = ? AND p.comment = ?`,
        a.entity_id, LUMP
      )?.t;
    } else if (a.entity === "batch" && a.action === "create") t = one("SELECT created_at AS t FROM batches WHERE id = ?", a.entity_id)?.t;
    else if (a.entity === "import") t = one("SELECT created_at AS t FROM imports WHERE id = ?", a.entity_id)?.t;
    else if (a.entity === "user" || (a.entity === "customer" && a.action === "create")) t = start;
    if (t) setAudit.run(t, a.id);
  }
  // Журнал показывается по порядку записей — перенумеровываем по времени, как было бы в жизни.
  const COLS = "user_id, action, entity, entity_id, old_value, new_value, created_at, deleted_at";
  db.exec(`CREATE TEMP TABLE audit_sorted AS SELECT ${COLS} FROM audit_log ORDER BY created_at, id`);
  db.exec("DELETE FROM audit_log");
  db.exec(`INSERT INTO audit_log (${COLS}) SELECT ${COLS} FROM audit_sorted ORDER BY rowid`);
  db.exec("DROP TABLE audit_sorted");
  db.exec("COMMIT");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}

/** Файл для проверки импорта: новые клиенты, существующий клиент, дубликат и строка с ошибкой. */
async function writeImportSample() {
  const db = new DatabaseSync(FILE, { readOnly: true });
  const known = db
    .prepare("SELECT c.name, c.phone FROM customers c WHERE c.phone <> '' AND c.import_id IS NULL AND c.deleted_at IS NULL ORDER BY c.id LIMIT 1")
    .get();
  const dup = db.prepare("SELECT name, code FROM order_items WHERE code = 'TEST100'").get();
  db.close();
  const d = (n) => {
    const x = new Date();
    x.setDate(x.getDate() - n);
    return `${String(x.getDate()).padStart(2, "0")}.${String(x.getMonth() + 1).padStart(2, "0")}.${x.getFullYear()}`;
  };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Заказы");
  ws.columns = [
    { header: "Дата заказа", width: 13 }, { header: "Имя клиента", width: 24 }, { header: "Телефон", width: 18 },
    { header: "Название товара", width: 28 }, { header: "Код товара", width: 16 }, { header: "Количество", width: 11 },
    { header: "Сумма", width: 10 }, { header: "Реальная цена", width: 14 }, { header: "Статус", width: 12 },
    { header: "Оплата", width: 14 }, { header: "Комментарий", width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  const rows = [
    [d(3), "Жаныл Мырзаева", "+996 000 401 111", "Увлажнитель воздуха", "TESTNEW001", 1, 2300, 1400, "Заказан", "Не оплачено", "новый клиент"],
    [d(3), "Жаныл Мырзаева", "+996 000 401 111", "Аромадиффузор", "TESTNEW002", 1, 900, 520, "Заказан", "Оплачено", "новый клиент, второй товар"],
    [d(2), "Нурбек Сатаров", "+996 000 402 222", "Велосипедный фонарь", "TESTNEW003", 2, 1100, 600, "На складе", "Частично", ""],
    [d(1), known?.name ?? "Айгерим Токтосунова", known?.phone ?? "", "Шарф кашемировый", "TESTNEW004", 1, 1900, 1150, "Заказан", "Не оплачено", "существующий клиент — найдётся по телефону"],
    [d(9), "Айгерим Токтосунова", "+996 000 100 000", dup?.name ?? "Электрочайник", "TEST100", 1, 2000, 1200, "На складе", "Оплачено", "дубликат — уже есть в базе, будет пропущен"],
    [d(1), "", "", "Ланчбокс", "TESTNEW005", 1, 650, 380, "Заказан", "Не оплачено", "ошибка: нет ни имени, ни телефона клиента"],
    [d(1), "", "+996 000 403 333", "Сушилка для обуви", "TESTNEW007", 1, 1300, 760, "Заказан", "Не оплачено", "без имени — клиентом станет номер телефона"],
    [d(1), "Каныкей Абылова", "+996 000 404 444", "Плюшевый медведь", "TESTNEW006", 1, "много", "", "Заказан", "", "ошибка: сумма не число"],
  ];
  for (const r of rows) ws.addRow(r);
  await wb.xlsx.writeFile(path.join(DIR, "Тестовый импорт.xlsx"));
}
