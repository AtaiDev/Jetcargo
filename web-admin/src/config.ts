/**
 * Настройки приложения в одном месте: бренд и адрес API.
 *
 * По умолчанию — локальный backend из папки server/ (127.0.0.1 — только этот компьютер).
 * Другой адрес задаётся в web-admin/.env: VITE_API_URL=...
 */

export const APP_NAME = "Jetcargo";
export const APP_TAGLINE = "Управление карго";

const LOCAL_API = "http://127.0.0.1:8787/api/v1";
const CONFIGURED = (import.meta.env.VITE_API_URL ?? "").trim() || LOCAL_API;

const isLocal = (url: string) => {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * Локальная разработка (npm run dev) — строго свой сервер на тестовой базе: рабочий сервер
 * отсюда недоступен, даже если в web-admin/.env по ошибке указан его адрес.
 */
export const API_URL: string = import.meta.env.DEV && !isLocal(CONFIGURED) ? LOCAL_API : CONFIGURED;
if (API_URL !== CONFIGURED) {
  console.warn(`VITE_API_URL=${CONFIGURED} не используется: локальная панель работает только с локальным тестовым сервером.`);
}
