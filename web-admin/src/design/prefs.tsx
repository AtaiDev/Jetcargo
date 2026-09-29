/**
 * Настройки внешнего вида: тема и масштаб интерфейса.
 *
 * Поведение 1:1 из макета:
 *  - тема пишется в атрибут data-theme на <html> (токены в styles.css переключаются по нему);
 *  - масштаб — через style.zoom на <html> (85% / 100% / 115% / 130%);
 *  - обе настройки сохраняются в localStorage (ключи rb_theme и rb_scale) и подхватываются
 *    при следующем входе;
 *  - событие storage синхронизирует открытые вкладки.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";
export const SCALES = [0.85, 1, 1.15, 1.3] as const;

const THEME_KEY = "rb_theme";
const SCALE_KEY = "rb_scale";

interface Prefs {
  theme: Theme;
  scale: number;
  setTheme: (t: Theme) => void;
  setScale: (s: number) => void;
}

const Ctx = createContext<Prefs | undefined>(undefined);

function applyPrefs(theme: Theme, scale: number) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme || "light");
  // zoom, а не transform: сохраняет раскладку и попадание по элементам.
  (root.style as CSSStyleDeclaration & { zoom: string }).zoom = String(scale || 1);
}

function readTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) || "light";
  } catch {
    return "light";
  }
}

function readScale(): number {
  try {
    const v = parseFloat(localStorage.getItem(SCALE_KEY) || "");
    return v || 1;
  } catch {
    return 1;
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [scale, setScaleState] = useState<number>(readScale);

  // Применяем сразу на монтировании (и при внешнем изменении состояния).
  useEffect(() => {
    applyPrefs(theme, scale);
  }, [theme, scale]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* приватный режим — просто не сохраняем */
    }
  }, []);

  const setScale = useCallback((s: number) => {
    setScaleState(s);
    try {
      localStorage.setItem(SCALE_KEY, String(s));
    } catch {
      /* приватный режим — просто не сохраняем */
    }
  }, []);

  // Синхронизация между вкладками.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY && e.newValue) setThemeState(e.newValue as Theme);
      if (e.key === SCALE_KEY && e.newValue) setScaleState(parseFloat(e.newValue) || 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return <Ctx.Provider value={{ theme, scale, setTheme, setScale }}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrefs должен использоваться внутри PrefsProvider");
  return ctx;
}
