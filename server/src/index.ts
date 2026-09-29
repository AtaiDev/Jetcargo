/**
 * Локальный backend Cargo-админки.
 *
 * Работает только на этом компьютере:
 *  - слушает 127.0.0.1 (из сети недоступен);
 *  - отклоняет запросы с чужим заголовком Host (защита от DNS-rebinding);
 *  - CORS разрешён только для адресов админки из CORS_ORIGINS.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import { CORS_ORIGINS, DB_FILE, HOST, PORT } from "./config";
import { setup } from "./db";
import { requireAuth } from "./domain";
import { authRouter } from "./routes/auth";
import { batchesRouter } from "./routes/batches";
import { customersRouter } from "./routes/customers";
import { dashboardRouter } from "./routes/dashboard";
import { importsRouter } from "./routes/imports";
import { itemsRouter } from "./routes/items";
import { miscRouter } from "./routes/misc";
import { ordersRouter } from "./routes/orders";
import { warehouseRouter } from "./routes/warehouse";
import { HttpError } from "./util";

setup();

const app = express();
app.disable("x-powered-by");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
app.use((req, res, next) => {
  if (!LOCAL_HOSTS.has(req.hostname)) {
    res.status(403).json({ detail: "Доступ только с этого компьютера" });
    return;
  }
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const api = express.Router();
api.use(authRouter); // вход/refresh — без токена, остальное внутри защищено само
api.use(requireAuth);
api.use(dashboardRouter, customersRouter, itemsRouter, warehouseRouter, importsRouter, batchesRouter, ordersRouter, miscRouter);
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
});
