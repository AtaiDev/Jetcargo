/**
 * Контракт API Cargo-админки: типы ответов и вызовы. Реализация — server/src/routes.
 * Экраны ходят в сеть только через этот файл.
 */
import { api } from "./client";

// --- Базовые типы -----------------------------------------------------------------

export type ItemStatus = "ordered" | "in_stock" | "issued";
export type PayStatus = "unpaid" | "partial" | "paid";

export interface Item {
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
  /** Сумма — цена для клиента, сом (за всё количество). По ней считаются оплата и долг. */
  price: number;
  price_cny: number | null;
  /** Реальная цена — за сколько товар выкуплен на маркетплейсе, сом; null — не указана. */
  real_price: number | null;
  /** Выкуп для расчёта прибыли (= реальная цена); null — прибыль не считается. */
  cost: number | null;
  /** Продажа = Сумма (price). Прибыль = sale − cost. */
  sale: number;
  paid: number;
  debt: number;
  pay_status: PayStatus;
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

export interface Totals {
  items: number;
  qty: number;
  sale: number;
  paid: number;
  debt: number;
  cost: number;
  profit: number;
  with_cost: number;
  ordered: number;
  in_stock: number;
  issued: number;
  unpaid_items: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

// --- Товары -----------------------------------------------------------------------

export interface ItemQuery {
  status?: ItemStatus | "active" | "";
  pay?: "paid" | "unpaid" | "partial" | "debt" | "ready" | "";
  q?: string;
  customer_id?: number;
  date_from?: string;
  date_to?: string;
  sort?: "date" | "arrived" | "issued" | "customer";
  limit?: number;
  offset?: number;
}

export interface ItemList extends Page<Item> {
  totals: Totals;
  counts: { all: number; ordered: number; in_stock: number; issued: number };
}

export const listItems = (params: ItemQuery) => api.get<ItemList>("/items", { params }).then((r) => r.data);

export interface Payment {
  id: number;
  amount: number;
  method: string;
  paid_at: string;
  comment: string;
  deleted_at: string | null;
  user_login: string | null;
}
export interface StatusChange {
  id: number;
  from_status: ItemStatus | null;
  to_status: ItemStatus;
  source: "create" | "manual" | "scan" | "issue" | "import";
  comment: string;
  changed_at: string;
  user_login: string | null;
}
export interface ScanEntry {
  id: number;
  code?: string;
  result: ScanResult;
  scanned_at: string;
  user_login: string | null;
}
export interface ItemDetail {
  item: Item;
  payments: Payment[];
  history: StatusChange[];
  scans: ScanEntry[];
}

export const getItem = (id: number) => api.get<ItemDetail>(`/items/${id}`).then((r) => r.data);

export interface NewItem {
  customer_id?: number;
  customer_name?: string;
  customer_phone?: string;
  order_date?: string;
  name: string;
  code?: string;
  qty: number;
  price: number;
  price_cny?: number | null;
  real_price?: number | null;
  cost?: number | null;
  split_with?: string;
  comment?: string;
  status?: ItemStatus;
  paid_amount?: number;
}

export interface NewOrder {
  customer_id?: number;
  customer_name?: string;
  customer_phone?: string;
  order_date?: string;
  /** Момент оформления (ISO); не задан — «сейчас». */
  ordered_at?: string;
  status?: "ordered" | "in_stock";
  comment?: string;
  pay?: "none" | "full" | "part";
  paid_amount?: number;
  items: { name: string; code?: string; qty: number; price: number; real_price?: number | null; price_cny?: number | null }[];
}
export const createOrder = (body: NewOrder) =>
  api
    .post<{ customer_id: number; customer_created: boolean; order_id: number; items: Item[] }>("/orders", body)
    .then((r) => r.data);

export const createItem = (body: NewItem) =>
  api.post<{ item: Item; customer_created: boolean }>("/items", body).then((r) => r.data);

export type ItemPatch = Partial<
  Pick<Item, "name" | "code" | "qty" | "price" | "price_cny" | "real_price" | "cost" | "split_with" | "comment" | "order_date" | "customer_id" | "status">
>;
export const updateItem = (id: number, body: ItemPatch) => api.patch<Item>(`/items/${id}`, body).then((r) => r.data);
export const setItemStatus = (id: number, status: ItemStatus, comment = "") =>
  api.post<Item>(`/items/${id}/status`, { status, comment }).then((r) => r.data);
export const deleteItem = (id: number) => api.delete(`/items/${id}`).then(() => undefined);
export const addItemPayment = (id: number, body: { amount: number; method?: string; comment?: string }) =>
  api.post<{ id: number; item: Item }>(`/items/${id}/payments`, body).then((r) => r.data);
export const cancelPayment = (id: number) => api.delete<Item>(`/payments/${id}`).then((r) => r.data);

// --- Массовые действия ---
export interface BulkStatusResult {
  changed: number;
  skipped: { id: number; name: string; reason: string }[];
  debt: number;
  customers: number;
  dry_run?: boolean;
  issue_ids?: number[];
}
export const bulkStatus = (ids: number[], status: ItemStatus, dry_run = false) =>
  api.post<BulkStatusResult>("/items-bulk/status", { ids, status, dry_run }).then((r) => r.data);
export const bulkPay = (ids: number[], dry_run = false) =>
  api.post<{ items: number; amount: number; dry_run?: boolean }>("/items-bulk/pay", { ids, dry_run }).then((r) => r.data);

// --- Клиенты ----------------------------------------------------------------------

export interface Customer {
  id: number;
  code: string | null;
  name: string;
  phone: string;
  comment: string;
  created_at: string;
}
export interface CustomerRow extends Customer {
  items: number;
  sale: number;
  paid: number;
  debt: number;
  ordered: number;
  in_stock: number;
  issued: number;
  last_order_date: string | null;
}
export interface CustomerCard {
  customer: Customer;
  totals: Totals;
  items: Item[];
}

export interface CustomersSummary {
  total: number;
  /** Клиентов с открытым долгом и сумма этих долгов. */
  debtors: number;
  debt: number;
  /** Клиентов, у которых есть товар на складе, и сколько там товаров. */
  waiting: number;
  in_stock: number;
  /** Заказывали в этом месяце. */
  active: number;
}
export type CustomerSort = "recent" | "debt" | "sale" | "name";
export const listCustomers = (params: {
  q?: string;
  filter?: "debt" | "in_stock" | "";
  sort?: CustomerSort;
  limit?: number;
  offset?: number;
}) => api.get<Page<CustomerRow> & { summary: CustomersSummary }>("/customers", { params }).then((r) => r.data);
export const getCustomer = (id: number) => api.get<CustomerCard>(`/customers/${id}`).then((r) => r.data);
export const createCustomer = (body: Partial<Customer>) => api.post<Customer>("/customers", body).then((r) => r.data);
export const updateCustomer = (id: number, body: Partial<Customer>) =>
  api.patch<Customer>(`/customers/${id}`, body).then((r) => r.data);
export const deleteCustomer = (id: number) => api.delete(`/customers/${id}`).then(() => undefined);
export const payCustomer = (id: number, body: { amount: number; item_ids?: number[]; method?: string; comment?: string }) =>
  api.post<{ applied: { item_id: number; amount: number }[] }>(`/customers/${id}/payments`, body).then((r) => r.data);

// --- Склад: сканирование и выдача ---------------------------------------------------

export type ScanResult = "arrived" | "already_in_stock" | "already_issued" | "not_found";

export interface CustomerBrief {
  id: number;
  name: string;
  phone: string;
  code: string | null;
  debt: number;
  in_stock: number;
  ordered: number;
}

export interface ScanResponse {
  code: string;
  /** lookup — режим «только поиск»: товар найден, ничего не изменено. */
  result: ScanResult | "lookup";
  items: (Item & { scans: ScanEntry[] })[];
  customer: CustomerBrief | null;
  suggestions: Item[];
  /** Ставит клиент: ответ получен в режиме «только поиск». */
  lookup?: boolean;
}

export const scanCode = (code: string, batchId?: number | null) =>
  api.post<ScanResponse>("/scan", { code, batch_id: batchId ?? undefined }).then((r) => r.data);
/** Найти товар по коду без приёма: статус не меняется, скан не записывается. */
export const lookupCode = (code: string) => api.get<ScanResponse>("/scan/lookup", { params: { code } }).then((r) => r.data);

// --- Партии -----------------------------------------------------------------------

export type BatchCur = "usd" | "som";
export interface Batch {
  id: number;
  name: string;
  status: "open" | "closed";
  /** ① Выкуп веса — сколько отдали за вес, в buy_cur. */
  buy_amount: number;
  buy_cur: BatchCur;
  /** ② Доставка — сколько отдали водителю, в delivery_cur (имя поля историческое). */
  delivery_usd: number;
  delivery_cur: BatchCur;
  /** ③ Вес клиентам — общая сумма, которую взяли с клиентов за вес, в client_cur. */
  client_amount: number;
  client_cur: BatchCur;
  /** Устаревшие поля (вес × ставка) — больше не используются в расчёте. */
  weight_client_kg: number;
  rate_client_usd: number;
  usd_rate: number;
  comment: string;
  created_at: string;
}
export interface BatchCalc {
  items: number;
  qty: number;
  customers: number;
  sale: number;
  goods_cost: number;
  with_cost: number;
  buy_som: number;
  delivery_som: number;
  client_som: number;
  markup_som: number;
  expenses_som: number;
  income_som: number;
  /** ③ + ④ − ① − ②, сом. */
  profit_som: number;
  in_stock: number;
  issued: number;
}
export type BatchPatch = Partial<Omit<Batch, "id" | "created_at">>;

export const listBatches = () => api.get<(Batch & { calc: BatchCalc })[]>("/batches").then((r) => r.data);
export const getBatch = (id: number) => api.get<{ batch: Batch; calc: BatchCalc; items: Item[] }>(`/batches/${id}`).then((r) => r.data);
export const createBatch = (name?: string) => api.post<Batch>("/batches", { name }).then((r) => r.data);
export const updateBatch = (id: number, body: BatchPatch) =>
  api.patch<{ batch: Batch; calc: BatchCalc }>(`/batches/${id}`, body).then((r) => r.data);
export const deleteBatch = (id: number) => api.delete(`/batches/${id}`).then(() => undefined);
export const addToBatch = (id: number, item_ids: number[]) => api.post(`/batches/${id}/items`, { item_ids }).then(() => undefined);
export const removeFromBatch = (id: number, item_ids: number[]) =>
  api.post(`/batches/${id}/items/remove`, { item_ids }).then(() => undefined);
export const batchCandidates = (params: { since?: string; until?: string }) =>
  api.get<Item[]>("/batches-candidates", { params }).then((r) => r.data);

export interface ScanRow {
  id: number;
  code: string;
  result: ScanResult;
  scanned_at: string;
  order_item_id: number | null;
  user_login: string | null;
  item_name: string | null;
  qty: number | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  scan_no: number;
  sale: number | null;
  debt: number | null;
  pay_status: PayStatus | null;
  item_status: ItemStatus | null;
  order_date: string | null;
}
export const listScans = (params: { q?: string; result?: string; since?: string; limit?: number; offset?: number }) =>
  api.get<Page<ScanRow>>("/scans", { params }).then((r) => r.data);

export const issueLookup = (q: string) => api.get<CustomerBrief[]>("/issue/lookup", { params: { q } }).then((r) => r.data);
export const issueItems = (body: { customer_id: number; item_ids: number[]; payment_amount?: number; comment?: string }) =>
  api.post<{ issue_id: number; items: Item[] }>("/issues", body).then((r) => r.data);

export interface IssueRow {
  id: number;
  customer_id: number;
  issued_at: string;
  comment: string;
  customer_name: string;
  customer_phone: string;
  user_login: string | null;
  /** Сколько оплаты принято прямо при выдаче (старый сервер не присылает). */
  paid_now?: number;
  items: Item[];
}
export interface IssueList extends Page<IssueRow> {
  /** debt — сколько по выданным товарам ещё не оплачено; paid_now — принято при выдаче. */
  summary: { items: number; qty: number; sale: number; customers: number; debt?: number; paid_now?: number };
  /** Выдачи по дням (день — в часовом поясе из tz). */
  by_day?: { day: string; issues: number; items: number; sale: number }[];
}
export const listIssues = (params: { q?: string; since?: string; until?: string; limit?: number; offset?: number; tz?: number }) =>
  api.get<IssueList>("/issues", { params }).then((r) => r.data);

// --- Дашборд и финансы ------------------------------------------------------------

export type ChartType = "kpi" | "line" | "area" | "bar" | "combo" | "stacked_bar" | "hbar" | "donut" | "table";

export interface WidgetSeries {
  measure: string;
  label: string | null;
  color: string | null;
  type: "bar" | "line" | "area" | null;
  axis: "left" | "right" | null;
}
export interface WidgetData {
  dataset: string;
  dimensions: { key: string; label: string; kind: "date" | "category" }[];
  measures: { key: string; label: string; format: "int" | "money" }[];
  rows: Record<string, string | number>[];
}
export interface DashboardWidget {
  id: number;
  key: string | null;
  title: string;
  chart: ChartType;
  span: number;
  is_builtin: boolean;
  series: WidgetSeries[];
  data: WidgetData | null;
  previous?: Record<string, number>;
  error: string | null;
}

/** Прибыль за период: наценка на товары + вес клиентам − выкуп веса − доставка (партии периода). */
export interface ProfitSummary {
  goods: number;
  goods_items: number;
  items: number;
  batches: number;
  client: number;
  buy: number;
  delivery: number;
  total: number;
  /** То же за такой же период перед выбранным; null — сравнивать не с чем. */
  previous: number | null;
}

export interface BatchProfitRow {
  id: number;
  name: string;
  status: "open" | "closed";
  created_at: string;
  /** Когда пришёл последний товар партии; по этому дню партия попадает в период. */
  last_arrival: string | null;
  items: number;
  customers: number;
  client: number;
  markup: number;
  buy: number;
  delivery: number;
  income: number;
  expenses: number;
  profit: number;
}

export interface Dashboard {
  period: { date_from: string; date_to: string };
  profit: ProfitSummary;
  /** Общая прибыль за всё время: все товары и все партии. since — дата первого заказа. */
  profit_all: Omit<ProfitSummary, "previous"> & { since: string | null };
  /** Поступило денег за период (по дате оплаты). */
  cash_in: number;
  /** Партии за всё время: прибыль каждой (новые сверху, до 30) и всех вместе. */
  batches: { count: number; open: number; profit: number; income: number; expenses: number; rows: BatchProfitRow[] };
  finance: {
    today: number;
    week: number;
    month: number;
    period: number;
    paid: number;
    unpaid: number;
    debts_total: number;
    cost: number;
    profit: number;
    with_cost: number;
    items_period: number;
  };
  orders: {
    items_total: number;
    items_period: number;
    orders_period: number;
    new_today: number;
    ordered: number;
    in_stock: number;
    ready: number;
    issued_period: number;
    unpaid_items: number;
  };
  customers: { total: number; new_period: number; with_debt: number; debt: number };
  /** Этапы товара «сейчас»: заказано → на складе → выдано. */
  stages: {
    ordered: Totals;
    in_stock: Totals & { ready: number };
    issued: Totals & { period: number };
  };
  widgets: DashboardWidget[];
}

export const getDashboard = (params: { date_from?: string; date_to?: string }) =>
  api.get<Dashboard>("/dashboard", { params }).then((r) => r.data);

export interface WidgetRow {
  id: number;
  key: string | null;
  title: string;
  chart: ChartType;
  position: number;
  is_visible: boolean;
  is_builtin: boolean;
}
export const listDashboardWidgets = () => api.get<WidgetRow[]>("/dashboard/widgets").then((r) => r.data);
export const patchDashboardWidget = (id: number, body: { position?: number; is_visible?: boolean }) =>
  api.patch<WidgetRow>(`/dashboard/widgets/${id}`, body).then((r) => r.data);

export interface MonthRow {
  month: string;
  month_label: string;
  sale: number;
  paid: number;
  debt: number;
  cost: number;
  profit: number;
  with_cost: number;
  items: number;
}
export interface Finance {
  period: { date_from: string; date_to: string };
  totals: Totals & { debts_total: number };
  /** by_method и by_day — у нового сервера (старый их не присылает). */
  cash_in: { amount: number; count: number; by_method?: { method: string; amount: number; count: number }[]; by_day?: { day: string; amount: number }[] };
  months: MonthRow[];
  debtors: { id: number; name: string; phone: string; debt: number; items: number; oldest: string }[];
  payments: {
    id: number;
    amount: number;
    method: string;
    paid_at: string;
    comment: string;
    item_id: number;
    item_name: string;
    customer_id: number;
    customer_name: string;
    user_login: string | null;
  }[];
}
export const getFinance = (params: { date_from?: string; date_to?: string }) =>
  api.get<Finance>("/finance", { params }).then((r) => r.data);

// --- Импорт Excel -----------------------------------------------------------------

export type ImportField =
  | "customer_name" | "customer_phone" | "name" | "code" | "qty" | "price" | "price_cny"
  | "real_price" | "cost" | "status" | "payment" | "paid_amount" | "order_date" | "split_with" | "comment";

export interface ImportRow {
  row: number;
  action: "new" | "update" | "duplicate" | "error";
  values: {
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
    payment: PayStatus;
    paid_amount: number | null;
    order_date: string;
    split_with: string;
    comment: string;
  } | null;
  errors: string[];
  warnings: string[];
  match_item_id: number | null;
  changes: { field: string; from: unknown; to: unknown }[];
  new_customer: boolean;
}

export interface ImportPreview {
  filename: string;
  sheets: { name: string; rows: number }[];
  sheet: string;
  header_row: number;
  headers: string[];
  mapping: Partial<Record<ImportField, number | null>>;
  default_status: ItemStatus;
  fields: { key: ImportField; label: string; required: boolean }[];
  rows: ImportRow[];
  counts: { total: number; new: number; update: number; duplicate: number; error: number; warnings: number; new_customers: number; empty_rows: number };
  missing_required: string[];
}

export interface ImportOptions {
  sheet?: string;
  mapping?: Partial<Record<ImportField, number | null>>;
  default_status?: ItemStatus;
  on_duplicate?: "skip" | "update";
}

function importForm(file: File, o: ImportOptions) {
  const f = new FormData();
  f.append("file", file);
  if (o.sheet) f.append("sheet", o.sheet);
  if (o.mapping) f.append("mapping", JSON.stringify(o.mapping));
  if (o.default_status) f.append("default_status", o.default_status);
  if (o.on_duplicate) f.append("on_duplicate", o.on_duplicate);
  return f;
}

export const previewImport = (file: File, o: ImportOptions) =>
  api.post<ImportPreview>("/import/preview", importForm(file, o)).then((r) => r.data);
export const commitImport = (file: File, o: ImportOptions) =>
  api.post<{ import_id: number; counts: ImportPreview["counts"] }>("/import/commit", importForm(file, o)).then((r) => r.data);

export interface ImportBatch {
  id: number;
  filename: string;
  sheet: string;
  rows_total: number;
  created_items: number;
  updated_items: number;
  skipped: number;
  errors: number;
  created_at: string;
  undone_at: string | null;
  user_login: string | null;
  alive_items: number;
}
export const listImports = () => api.get<ImportBatch[]>("/imports").then((r) => r.data);
export const undoImport = (id: number) => api.post(`/imports/${id}/undo`).then(() => undefined);

// --- Поиск, настройки, сотрудники, журнал -------------------------------------------

export interface SearchResults {
  query: string;
  customers: { id: number; name: string; phone: string; code: string | null; debt: number; items: number }[];
  items: Item[];
}
export const globalSearch = (q: string) => api.get<SearchResults>("/search", { params: { q } }).then((r) => r.data);

export interface Settings {
  cny_rate: number;
}
export const getSettings = () => api.get<Settings>("/settings").then((r) => r.data);
export const updateSettings = (body: Partial<Settings>) => api.patch<Settings>("/settings", body).then((r) => r.data);

/** Какая база у сервера: тестовая (локально) или рабочая. Без входа. */
export const getEnvironment = () => api.get<{ env: "test" | "prod" }>("/env").then((r) => r.data.env);

export interface User {
  id: number;
  login: string;
  full_name: string;
  role: "admin" | "staff";
  is_active: boolean;
  /** Только в списке сотрудников. */
  created_at?: string;
  last_active_at?: string | null;
  actions?: number;
  scans?: number;
  issues?: number;
}
export const listUsers = () => api.get<User[]>("/users").then((r) => r.data);
export const createUser = (body: { login: string; full_name?: string; role: string; password: string; is_active?: boolean }) =>
  api.post<User>("/users", body).then((r) => r.data);
export const updateUser = (id: number, body: { full_name?: string; role?: string; is_active?: boolean; password?: string }) =>
  api.patch<User>(`/users/${id}`, body).then((r) => r.data);

/** Раздел журнала (считает сервер). */
export type AuditCat = "item" | "receive" | "issue" | "payment" | "customer" | "batch" | "import" | "user" | "delete";
export interface AuditEntry {
  id: number;
  user_id: number | null;
  user_login: string | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  cat: AuditCat;
  /** Подставленные названия — чтобы запись читалась без номеров. */
  item_name: string | null;
  item_code: string | null;
  item_customer_id: number | null;
  item_customer: string | null;
  customer_name: string | null;
  batch_name: string | null;
  target_login: string | null;
  order_customer_id: number | null;
  order_customer: string | null;
}
export interface AuditPage {
  rows: AuditEntry[];
  total: number;
  counts: Partial<Record<AuditCat, number>>;
}
export const listAudit = (params: { cat?: AuditCat | ""; user_id?: number; since?: string; until?: string; q?: string; limit?: number; offset?: number }) =>
  api.get<AuditPage>("/audit", { params }).then((r) => r.data);
