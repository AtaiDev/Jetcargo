import axios from "axios";

import { API_URL } from "../config";

export const api = axios.create({ baseURL: API_URL });

/** Достать человекочитаемую ошибку из ответа API (detail) с запасным текстом. */
export function apiError(e: unknown, fallback = "Ошибка"): string {
  const resp = (e as { response?: { status?: number; data?: { detail?: string } } })?.response;
  if (resp?.status === 403) return "Недостаточно прав";
  return resp?.data?.detail ?? fallback;
}

/** HTTP-статус ответа, если он есть. */
export function apiStatus(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status;
}

const ACCESS_KEY = "rb_access";
const REFRESH_KEY = "rb_refresh";

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

// Подставляем access-токен в каждый запрос.
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Тихое обновление сессии: когда access-токен протух, сервер отвечает 401.
// Раньше это роняло запрос (в т.ч. /auth/me) и светило красной ошибкой в консоли,
// а сессия рвалась. Теперь один раз пробуем обменять refresh-токен на новый access
// и повторяем исходный запрос. Один общий promise на обновление — чтобы параллельные
// 401 не устроили гонку.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const rt = getRefreshToken();
  if (!rt) return null;
  try {
    // Зацикливания нет: интерцептор ответа не повторяет /auth/refresh.
    const { data } = await api.post("/auth/refresh", { refresh_token: rt });
    setTokens(data.access_token, data.refresh_token);
    return data.access_token as string;
  } catch {
    clearTokens();
    return null;
  }
}

// Протух ли JWT по полю exp (без проверки подписи — только чтобы не слать заведомо
// мёртвый токен и не ловить 401 в консоль на загрузке).
function isExpired(token: string): boolean {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload));
    return typeof exp === "number" && exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

/**
 * Вернуть живой access-токен, обновив его заранее, если он протух.
 *
 * Так `/auth/me` и прочие запросы на загрузке не уходят с мёртвым токеном из
 * прошлой сессии — иначе 401 краснел бы в консоли, хоть сессия и восстанавливалась.
 */
export async function ensureAccessToken(): Promise<string | null> {
  const token = getAccessToken();
  if (token && !isExpired(token)) return token;
  return refreshAccessToken();
}

api.interceptors.response.use(
  (resp) => resp,
  async (error) => {
    const config = error.config as (typeof error.config & { _retried?: boolean }) | undefined;
    const url = config?.url ?? "";
    const is401 = error.response?.status === 401;
    const authCall = url.includes("/auth/refresh") || url.includes("/auth/login");
    if (is401 && config && !config._retried && !authCall && getRefreshToken()) {
      config._retried = true;
      if (!refreshing) {
        refreshing = refreshAccessToken().finally(() => {
          refreshing = null;
        });
      }
      const token = await refreshing;
      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
        return api(config);
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Скачать защищённый файл (Excel и т.п.).
 *
 * Простой <a href> сюда не годится: наши эндпоинты авторизуются Bearer-токеном из
 * localStorage, а браузер при переходе по ссылке его не шлёт — сервер отвечает 401
 * и файл не качается. Поэтому тянем через axios (интерцептор добавит токен),
 * получаем blob и отдаём его на скачивание сами.
 */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const resp = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(resp.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
