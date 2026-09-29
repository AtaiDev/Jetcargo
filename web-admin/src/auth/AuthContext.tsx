import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { clearTokens, ensureAccessToken } from "../api/client";
import { fetchMe, type CurrentUser } from "../api/auth";

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    // Заранее обновляем протухший токен — иначе /auth/me уйдёт с мёртвым и 401
    // покраснеет в консоли.
    if (!(await ensureAccessToken())) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await fetchMe());
    } catch {
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    clearTokens();
    setUser(null);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, refresh, logout }}>{children}</AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
