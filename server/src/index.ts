/**
 * Backend Cargo-админки.
 *
 * Локально (по умолчанию) работает только на этом компьютере:
 *  - слушает 127.0.0.1 (из сети недоступен);
 *  - отклоняет запросы с чужим заголовком Host (защита от DNS-rebinding);
 *  - CORS разрешён только для адресов админки из CORS_ORIGINS.
 * В облачном режиме (PUBLIC_HOSTS) вместо localhost разрешены только эти домены,
 * соединение идёт через HTTPS-прокси хостинга.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import { CORS_ORIGINS, DB_FILE, HOST, IS_PUBLIC, PORT, PUBLIC_HOSTS } from "./config";
import { isTestDb, setup } from "./db";
import { requireAuth } from "./domain";
import { authRouter } from "./routes/auth";
import { batchesRouter } from "./routes/batches";
import { customersRouter } from "./routes/customers";
import { dashboardRouter } from "./routes/dashboard";
import { importsRouter } from "./routes/imports";
import { shipmentsRouter } from "./routes/shipments";
import { itemsRouter } from "./routes/items";
import { miscRouter } from "./routes/misc";
import { ordersRouter } from "./routes/orders";
import { warehouseRouter } from "./routes/warehouse";
import { HttpError } from "./util";

setup();

const app = express();
app.disable("x-powered-by");

// Проверка живости для хостинга и «будильника» — до проверки Host (хостинг стучится по внутреннему адресу).
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// За прокси хостинга: адрес клиента и протокол берём из X-Forwarded-*.
if (IS_PUBLIC) app.set("trust proxy", 1);

const ALLOWED_HOSTS = new Set(IS_PUBLIC ? PUBLIC_HOSTS : ["localhost", "127.0.0.1", "[::1]", "::1"]);
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.hostname.toLowerCase())) {
    res.status(403).json({ detail: IS_PUBLIC ? "Неизвестный адрес сервера" : "Доступ только с этого компьютера" });
    return;
  }
  if (IS_PUBLIC) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  const origin = req.headers.origin;
  if (origin) {
    if (!CORS_ORIGINS.includes(origin)) {
      res.status(403).json({ detail: "Источник запроса не разрешён" });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

const api = express.Router();
api.use(authRouter); // вход/refresh — без токена, остальное внутри защищено само
// Какая это база — панель показывает полосу «Тестовая среда» ещё до входа.
api.get("/env", (_req, res) => {
  res.json({ env: isTestDb() ? "test" : "prod" });
});
api.use(requireAuth);
api.use(dashboardRouter, customersRouter, itemsRouter, warehouseRouter, importsRouter, shipmentsRouter, batchesRouter, ordersRouter, miscRouter);
app.use("/api/v1", api);

app.use((_req, res) => {
  res.status(404).json({ detail: "Не найдено" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ detail: err.detail });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(413).json({ detail: err.code === "LIMIT_FILE_SIZE" ? "Файл слишком большой" : err.message });
    return;
  }
  const status = (err as { status?: number })?.status;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ detail: "Некорректный запрос" });
    return;
  }
  console.error(err);
  res.status(500).json({ detail: "Внутренняя ошибка сервера" });
});

app.listen(PORT, HOST, () => {
  console.log(`API: http://${HOST}:${PORT}/api/v1  (база: ${DB_FILE})`);
  console.log(isTestDb() ? "Среда: ТЕСТОВАЯ — вымышленные данные, рабочая база не затрагивается" : "Среда: рабочая база");
});
