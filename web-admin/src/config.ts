/**
 * Настройки приложения в одном месте: бренд и адрес API.
 *
 * По умолчанию — локальный backend из папки server/ (127.0.0.1 — только этот компьютер).
 * Другой адрес задаётся в web-admin/.env: VITE_API_URL=...
 */

export const APP_NAME = "Jetcargo";
export const APP_TAGLINE = "Управление карго";

export const API_URL: string = (import.meta.env.VITE_API_URL ?? "").trim() || "http://127.0.0.1:8787/api/v1";
