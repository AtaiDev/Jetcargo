/**
 * Шина событий «данные изменились».
 *
 * Сканирование, выдача, оплата или правка товара шлют cargo:changed — открытые
 * экраны (склад, заказы, клиент, дашборд) перечитывают данные сами. Событие
 * доходит и до других вкладок браузера через BroadcastChannel: сканируете в одной
 * вкладке — склад обновляется в другой.
 */
import { useEffect, useRef, useState } from "react";

type Events = {
  "cargo:changed": void;
};

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("cargo") : null;

export function emit<K extends keyof Events>(name: K): void {
  window.dispatchEvent(new CustomEvent(name));
  channel?.postMessage(name);
}

export function on<K extends keyof Events>(name: K, handler: () => void): () => void {
  const onChannel = (e: MessageEvent) => e.data === name && handler();
  window.addEventListener(name, handler);
  channel?.addEventListener("message", onChannel);
  return () => {
    window.removeEventListener(name, handler);
    channel?.removeEventListener("message", onChannel);
  };
}

/** Перечитывать данные при изменениях и при возврате на вкладку. */
export function useRefresh(reload: () => void): void {
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => {
    const run = () => ref.current();
    const onVisible = () => document.visibilityState === "visible" && run();
    const off = on("cargo:changed", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

/** Значение с задержкой — для поиска по мере ввода (не дёргать API на каждую букву). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}


/** Открыть карточку товара поверх любого экрана (её показывает оболочка приложения). */
export function openItem(id: number): void {
  window.dispatchEvent(new CustomEvent<number>("cargo:open-item", { detail: id }));
}

export function onOpenItem(handler: (id: number) => void): () => void {
  const h = (e: Event) => handler((e as CustomEvent<number>).detail);
  window.addEventListener("cargo:open-item", h);
  return () => window.removeEventListener("cargo:open-item", h);
}
