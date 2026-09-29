/**
 * Вход. В макете этого экрана нет — собран на токенах дизайн-системы
 * (те же цвета, шрифты и кнопки, что и в панели).
 */
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { useAuth } from "../auth/AuthContext";
import { APP_NAME } from "../config";
import { css } from "../design/css";
import { apiError, apiStatus } from "../api/client";
import { I_EYE, I_EYE_OFF, Svg } from "../design/icons";
import { LogoMark } from "../design/Logo";
import { HButton, ModalError, inputStyle } from "../design/ui";


export default function LoginPage() {
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Куда вернуться после входа: адрес, с которого guard увёл на /login (deep-link),
  // иначе — на дашборд.
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(loginValue, password);
      await refresh();
      navigate(from, { replace: true });
    } catch (e) {
      // Нет ответа вообще — значит, backend не запущен, а не пароль неверный.
      const status = apiStatus(e);
      if (status === undefined) {
        setError("Сервер недоступен: запустите backend (в папке server: npm run dev)");
      } else if (status === 401) {
        setError("Неверный логин или пароль");
      } else {
        setError(apiError(e, "Не удалось войти"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={css(
        "min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font-family:'IBM Plex Sans',system-ui,sans-serif;padding:20px"
      )}
    >
      <form
        onSubmit={onSubmit}
        style={css(
          "width:340px;max-width:100%;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,.06);display:flex;flex-direction:column;gap:14px"
        )}
      >
        <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:2px")}>
          <span style={css("display:flex;flex:none;color:var(--text)")}>
            <LogoMark size={32} />
          </span>
          <div>
            <div style={css("font-weight:600;font-size:15px;letter-spacing:-.01em")}>{APP_NAME}</div>
            <div style={css("font-size:11px;color:var(--text-3);margin-top:-1px")}>
              Панель сотрудника
            </div>
          </div>
        </div>

        <label>
          <span
            style={css(
              "display:block;font-size:11.5px;font-weight:500;color:var(--text-2);margin-bottom:5px"
            )}
          >
            Логин
          </span>
          <input
            value={loginValue}
            onChange={(e) => setLoginValue(e.target.value)}
            autoFocus
            style={css(inputStyle)}
          />
        </label>

        <label>
          <span
            style={css(
              "display:block;font-size:11.5px;font-weight:500;color:var(--text-2);margin-bottom:5px"
            )}
          >
            Пароль
          </span>
          <span style={css("position:relative;display:block")}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{ ...css(inputStyle), paddingRight: 40 }}
            />
            <HButton
              type="button"
              title={showPassword ? "Скрыть пароль" : "Показать пароль"}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              onClick={() => setShowPassword((v) => !v)}
              s="position:absolute;top:50%;right:6px;transform:translateY(-50%);width:28px;height:28px;border:none;background:transparent;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-3)"
              hover="background:var(--hover);color:var(--text-2)"
            >
              <Svg paths={showPassword ? I_EYE_OFF : I_EYE} size={17} sw={1.7} />
            </HButton>
          </span>
        </label>

        <ModalError text={error} />

        <HButton
          type="submit"
          disabled={busy}
          s="height:40px;background:var(--accent);color:#fff;border:none;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;margin-top:4px"
          hover="background:var(--accent-hover)"
        >
          {busy ? "Вход…" : "Войти"}
        </HButton>
      </form>
    </div>
  );
}
