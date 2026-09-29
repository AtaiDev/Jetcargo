/**
 * Настройки сервера из переменных окружения (файл server/.env, в git не попадает).
 *
 * Сервер намеренно локальный: слушает только loopback-интерфейс, пускает запросы
 * только с localhost и только от админки на localhost. Со старым проектом
 * Rentalbish ничего не связывает — своя база SQLite, свой порт, свой секрет.
 */
import path from "node:path";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Не задана переменная окружения ${name} (см. server/.env.example)`);
  return v;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export const HOST = process.env.HOST?.trim() || "127.0.0.1";
if (!LOOPBACK.has(HOST)) {
  throw new Error(`HOST=${HOST}: сервер разрешено запускать только на localhost (127.0.0.1)`);
}

export const PORT = Number(process.env.PORT || 8787);

export const JWT_SECRET = required("JWT_SECRET");
if (JWT_SECRET.length < 32) throw new Error("JWT_SECRET должен быть не короче 32 символов");

/** Откуда разрешены запросы из браузера (адрес dev-сервера админки). */
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Первый администратор создаётся при первом запуске, если в базе нет пользователей. */
export const ADMIN_LOGIN = process.env.ADMIN_LOGIN?.trim() || "";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
export const ADMIN_FULL_NAME = process.env.ADMIN_FULL_NAME?.trim() || "Администратор";

const ROOT = path.resolve(import.meta.dirname, "..");
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || "data");
export const DB_FILE = path.join(DATA_DIR, "app.db");
export const MEDIA_DIR = path.join(DATA_DIR, "media");

export const ACCESS_TTL = "60m";
export const REFRESH_TTL = "7d";
