/**
 * Настройки сервера из переменных окружения (файл server/.env, в git не попадает).
 *
 * По умолчанию сервер локальный: слушает только loopback-интерфейс, пускает запросы
 * только с localhost и только от админки на localhost.
 *
 * Облачный режим (например, Render) включается переменной PUBLIC_HOSTS — списком
 * публичных доменов сервера. Тогда сервер слушает все интерфейсы за HTTPS-прокси
 * хостинга и пускает только запросы на эти домены и только из CORS_ORIGINS.
 */
import path from "node:path";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Не задана переменная окружения ${name} (см. server/.env.example)`);
  return v;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Публичные домены сервера (облачный режим). Пусто — сервер доступен только с этого компьютера. */
// На Render домен сервиса приходит сам (RENDER_EXTERNAL_HOSTNAME).
export const PUBLIC_HOSTS = [process.env.PUBLIC_HOSTS || "", process.env.RENDER_EXTERNAL_HOSTNAME || ""]
  .join(",")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
export const IS_PUBLIC = PUBLIC_HOSTS.length > 0;

export const HOST = process.env.HOST?.trim() || (IS_PUBLIC ? "0.0.0.0" : "127.0.0.1");
if (!IS_PUBLIC && !LOOPBACK.has(HOST)) {
  throw new Error(`HOST=${HOST}: без PUBLIC_HOSTS сервер разрешено запускать только на localhost (127.0.0.1)`);
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
