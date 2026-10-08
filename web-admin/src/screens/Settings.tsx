/**
 * Настройки — во всю ширину:
 *  - сверху карточка профиля: кто вошёл, роль, на какой базе работает панель, «Выйти»;
 *  - слева «Оформление»: тема (светлая / тёмная — живые мини-превью) и масштаб интерфейса плитками;
 *  - справа курс юаня с быстрым пересчётом (меняет только администратор), ниже — быстрые клавиши.
 * Тема и масштаб сохраняются в localStorage и применяются сразу (см. design/prefs).
 */
import { useEffect, useState, type ReactNode } from "react";

import { apiError } from "../api/client";
import { getEnvironment, getSettings, updateSettings } from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { css, mix } from "../design/css";
import { ICONS, I_CHECK, Icon, Svg } from "../design/icons";
import { SCALES, usePrefs, type Theme } from "../design/prefs";
import { HButton } from "../design/ui";
import { Page } from "../design/table";

type Toast = (kind: "success" | "error", text: string) => void;

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";

export default function Settings({ toast }: { toast: Toast }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <Page size="wide">
      <Profile />
      <div className="st-grid">
        <Appearance />
        <RateCard toast={toast} canEdit={isAdmin} />
      </div>
      <Hotkeys />
    </Page>
  );
}

// --- Профиль ------------------------------------------------------------------------------------

function Profile() {
  const { user, logout } = useAuth();
  const [env, setEnv] = useState<"test" | "prod" | null>(null);
  useEffect(() => {
    getEnvironment()
      .then(setEnv)
      .catch(() => setEnv(null));
  }, []);
  if (!user) return null;
  const name = user.full_name || user.login;
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  const admin = user.role === "admin";
  return (
    <section className="st-hero">
      <span style={css("width:60px;height:60px;border-radius:20px;flex:none;display:grid;place-items:center;color:#fff;font-size:22px;font-weight:600;background:linear-gradient(135deg,#6A8BFF,#8B5CF6);box-shadow:0 14px 28px -14px rgba(106,139,255,.8)")}>
        {initials}
      </span>
      <div style={css("flex:1 1 240px;min-width:0")}>
        <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap")}>
          <span style={css("font-size:20px;font-weight:500;letter-spacing:-.01em;color:var(--text)")}>{name}</span>
          <span className={"st-role" + (admin ? " admin" : "")}>{admin ? "Администратор" : "Сотрудник"}</span>
        </div>
        <div style={css("margin-top:4px;font-size:13px;color:var(--text-3)")}>
          вход как <b style={css("font-weight:500;color:var(--text-2)")}>{user.login}</b> · {admin ? "доступны все разделы и настройки" : "курс юаня меняет администратор"}
        </div>
      </div>
      {env && (
        <span className={"st-env " + env} title={env === "test" ? "Локальная панель на тестовой базе" : "Рабочая база"}>
          <span className="st-env-dot" />
          {env === "test" ? "Тестовая база" : "Рабочая база"}
        </span>
      )}
      <HButton onClick={logout} className="st-logout" s="" hover="">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="m16 17 5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
        Выйти
      </HButton>
    </section>
  );
}

// --- Оформление ---------------------------------------------------------------------------------

/** Цвета мини-превью — свои у каждой темы, не зависят от текущей. */
const PREVIEW: Record<Theme, { bg: string; side: string; line: string; card: string; border: string; text: string; accent: string; green: string }> = {
  light: { bg: "#F6F7F9", side: "#FFFFFF", line: "#E4E7EC", card: "#FFFFFF", border: "#E7E9EC", text: "#CFD4DB", accent: "#3E63DD", green: "#35A46A" },
  dark: { bg: "#0F1116", side: "#181B22", line: "#2E353F", card: "#181B22", border: "#2A303A", text: "#3A424E", accent: "#6C8BFF", green: "#47C07E" },
};

function Appearance() {
  const { theme, scale, setTheme, setScale } = usePrefs();
  const SCALE_HINT = ["компактно", "обычно", "крупнее", "у стеллажа"];
  return (
    <section className="st-card">
      <CardHead icon={<Svg paths={ICONS.sun} size={17} />} grad="linear-gradient(135deg,#FBBF24,#F97316)" title="Оформление" hint="Сохраняется в этом браузере и применяется сразу" />

      <div style={css("font-size:12.5px;font-weight:500;color:var(--text-2);margin:18px 0 10px")}>Тема</div>
      <div className="st-themes">
        {(["light", "dark"] as const).map((t) => {
          const p = PREVIEW[t];
          const on = theme === t;
          return (
            <button key={t} type="button" onClick={() => setTheme(t)} className={"st-theme" + (on ? " on" : "")} aria-pressed={on}>
              <span style={mix("display:flex;height:150px;border-radius:12px;overflow:hidden", { background: p.bg, border: `1px solid ${p.border}` })}>
                <span style={mix("width:54px;flex:none;padding:12px 9px;display:flex;flex-direction:column;gap:7px", { background: p.side, borderRight: `1px solid ${p.border}` })}>
                  <span style={mix("width:22px;height:22px;border-radius:7px", { background: p.accent })} />
                  {[100, 74, 86, 60].map((w, i) => (
                    <span key={i} style={mix("height:6px;border-radius:3px", { width: `${w}%`, background: i === 0 ? p.accent : p.line, opacity: i === 0 ? 0.55 : 1 })} />
                  ))}
                </span>
                <span style={css("flex:1;min-width:0;padding:12px;display:flex;flex-direction:column;gap:8px")}>
                  <span style={mix("height:8px;width:40%;border-radius:3px", { background: p.text })} />
                  <span style={css("display:grid;grid-template-columns:1fr 1fr;gap:7px")}>
                    {[p.accent, p.green].map((c, i) => (
                      <span key={i} style={mix("height:38px;border-radius:8px;padding:7px;display:flex;flex-direction:column;justify-content:space-between", { background: p.card, border: `1px solid ${p.border}` })}>
                        <span style={mix("height:5px;width:50%;border-radius:3px", { background: p.line })} />
                        <span style={mix("height:7px;width:70%;border-radius:3px", { background: c })} />
                      </span>
                    ))}
                  </span>
                  <span style={mix("flex:1;border-radius:8px;display:flex;align-items:flex-end;gap:4px;padding:7px", { background: p.card, border: `1px solid ${p.border}` })}>
                    {[40, 65, 50, 85, 60, 95].map((h, i) => (
                      <span key={i} style={mix("flex:1;border-radius:3px 3px 1px 1px", { height: `${h}%`, background: p.accent, opacity: 0.35 + i * 0.1 })} />
                    ))}
                  </span>
                </span>
              </span>
              <span style={css("display:flex;align-items:center;gap:9px;margin-top:12px")}>
                <span style={mix("display:flex", { color: t === "light" ? "var(--amber-dot)" : "var(--violet-dot)" })}>
                  <Svg paths={t === "light" ? ICONS.sun : ICONS.moon} size={17} />
                </span>
                <span style={css("flex:1;min-width:0")}>
                  <span style={css("display:block;font-size:14px;font-weight:500;color:var(--text)")}>{t === "light" ? "Светлая" : "Тёмная"}</span>
                  <span className="st-theme-hint" style={css("display:block;font-size:12px;color:var(--text-4)")}>{t === "light" ? "днём и в светлом помещении" : "вечером, меньше устают глаза"}</span>
                </span>
                {on ? (
                  <span style={css("width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;background:var(--accent)")}>
                    <Svg paths={I_CHECK} size={12} sw={3} />
                  </span>
                ) : (
                  <span style={css("width:22px;height:22px;border-radius:50%;flex:none;border:1.5px solid var(--border-strong)")} />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div style={css("display:flex;align-items:baseline;gap:10px;margin:24px 0 10px;flex-wrap:wrap")}>
        <span style={css("font-size:12.5px;font-weight:500;color:var(--text-2)")}>Масштаб интерфейса</span>
        <span style={css("font-size:12px;color:var(--text-4)")}>крупнее — удобнее с телефона у стеллажа, компактнее — больше данных на экране</span>
      </div>
      <div className="st-scales">
        {SCALES.map((v, i) => {
          const on = Math.abs(scale - v) < 0.001;
          return (
            <button key={v} type="button" onClick={() => setScale(v)} className={"st-scale" + (on ? " on" : "")} aria-pressed={on}>
              <span style={mix("display:block;font-weight:500;line-height:1;color:var(--text)", { fontSize: Math.round(18 * v) })}>Аа</span>
              <span style={css(NUM + ";display:block;margin-top:10px;font-size:14px;font-weight:500;color:var(--text)")}>{Math.round(v * 100)}%</span>
              <span style={css("display:block;font-size:12px;color:var(--text-4)")}>{SCALE_HINT[i] ?? ""}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CardHead({ icon, grad, title, hint }: { icon: ReactNode; grad: string; title: string; hint: string }) {
  return (
    <div style={css("display:flex;align-items:center;gap:12px")}>
      <span style={mix("width:38px;height:38px;border-radius:12px;flex:none;display:grid;place-items:center;color:#fff;box-shadow:0 10px 20px -12px rgba(15,18,25,.5)", { background: grad })}>{icon}</span>
      <span style={css("min-width:0")}>
        <span style={css("display:block;font-size:15px;font-weight:500;color:var(--text)")}>{title}</span>
        <span style={css("display:block;font-size:12.5px;color:var(--text-4)")}>{hint}</span>
      </span>
    </div>
  );
}

// --- Курс юаня ----------------------------------------------------------------------------------

/** Курс юаня: подсказка ¥ при добавлении товара. Меняет только администратор; ниже — быстрый пересчёт. */
function RateCard({ toast, canEdit }: { toast: Toast; canEdit: boolean }) {
  const [rate, setRate] = useState("");
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setRate(String(s.cny_rate));
        setSaved(s.cny_rate);
      })
      .catch((e) => setError(apiError(e)));
  }, []);

  const value = Number(rate.replace(",", ".").replace(/\s/g, ""));
  const valid = Number.isFinite(value) && value > 0;
  const dirty = valid && saved !== null && value !== saved;

  async function save() {
    if (!valid) return setError("Укажите курс больше нуля");
    setError("");
    setBusy(true);
    try {
      const s = await updateSettings({ cny_rate: value });
      setRate(String(s.cny_rate));
      setSaved(s.cny_rate);
      toast("success", "Курс сохранён");
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  const fmt = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} с`;

  return (
    <section className="st-card st-rate-card">
      <CardHead
        icon={<span style={css("font-size:17px;font-weight:600;line-height:1")}>¥</span>}
        grad="linear-gradient(135deg,#FB7185,#DC2626)"
        title="Курс юаня"
        hint="Чтобы при добавлении товара показать и сохранить цену в юанях"
      />
      <div className="st-rate">
        <span style={css("font-size:15px;color:var(--text-3);white-space:nowrap")}>¥1 =</span>
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canEdit && save()}
          inputMode="decimal"
          disabled={!canEdit}
          aria-label="Курс юаня"
          style={css(NUM + ";flex:1;min-width:0;height:100%;border:none;outline:none;background:transparent;font-size:24px;font-weight:500;color:var(--text);padding:0")}
        />
        <span style={css("font-size:15px;color:var(--text-4)")}>сом</span>
        {canEdit && (
          <HButton onClick={save} disabled={!dirty || busy} className={"st-save" + (dirty ? " on" : "")} s="" hover="">
            {busy ? "…" : dirty ? "Сохранить" : "Сохранено"}
          </HButton>
        )}
      </div>
      {error && <div style={css("color:var(--danger);font-size:12.5px;margin-top:8px")}>{error}</div>}
      {!canEdit && <div style={css("font-size:12.5px;color:var(--text-4);margin-top:8px")}>Изменить курс может только администратор.</div>}

      <div style={css("font-size:12.5px;font-weight:500;color:var(--text-2);margin:18px 0 10px")}>Быстрый пересчёт</div>
      <div className="st-conv">
        {[1, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map((y) => (
          <div key={y} className="st-conv-cell">
            <span style={css(NUM + ";display:block;font-size:12.5px;color:var(--text-3)")}>¥{y.toLocaleString("ru-RU")}</span>
            <span style={css(NUM + ";display:block;margin-top:3px;font-size:15px;font-weight:500;color:var(--text);white-space:nowrap")}>{valid ? fmt(y * value) : "—"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Быстрые клавиши ----------------------------------------------------------------------------

function Hotkeys() {
  const rows: { keys: string[]; text: string }[] = [
    { keys: ["Ctrl", "K"], text: "найти клиента, товар или код из любого раздела" },
    { keys: ["Enter"], text: "в поиске — открыть найденное" },
    { keys: ["Esc"], text: "закрыть поиск или выпадающий список" },
  ];
  return (
    <section className="st-card">
      <CardHead icon={<Icon name="settings" size={18} />} grad="linear-gradient(135deg,#34D399,#0EA5E9)" title="Быстрые клавиши" hint="Чтобы работать быстрее с клавиатуры" />
      <div className="st-keys">
        {rows.map((r) => (
          <div key={r.text} className="st-key-row">
            <span style={css("display:flex;gap:5px;flex:none")}>
              {r.keys.map((k) => (
                <kbd key={k} className="st-kbd">
                  {k}
                </kbd>
              ))}
            </span>
            <span style={css("font-size:13px;color:var(--text-2)")}>{r.text}</span>
          </div>
        ))}
        <div className="st-key-row">
          <span style={css("display:flex;flex:none")}>
            <span className="st-kbd" style={css("display:inline-flex;align-items:center;gap:5px")}>
              <Icon name="receive" size={13} />
              сканер
            </span>
          </span>
          <span style={css("font-size:13px;color:var(--text-2)")}>на «Приёме товара» просто сканируйте — код вводится и принимается сам</span>
        </div>
      </div>
    </section>
  );
}
