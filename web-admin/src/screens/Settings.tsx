/**
 * Настройки: курс юаня (админ), тема оформления и масштаб интерфейса.
 * Обе настройки сохраняются в localStorage и применяются сразу (см. design/prefs).
 */
import { useEffect, useState } from "react";

import { apiError } from "../api/client";
import { getSettings, updateSettings } from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { MONO, css, mix } from "../design/css";
import { ICONS, I_CHECK, Svg } from "../design/icons";
import { SCALES, usePrefs } from "../design/prefs";
import { HButton, btnPrimary, inputStyle, tabStyle } from "../design/ui";
import { Page } from "../design/table";

type Toast = (kind: "success" | "error", text: string) => void;

export default function Settings({ toast }: { toast: Toast }) {
  const { theme, scale, setTheme, setScale } = usePrefs();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <Page size="form">
      {/* ---- Курс юаня (только админ) ---- */}
      {isAdmin && <RateCard toast={toast} />}

      {/* ---- Тема ---- */}
      <section
        style={css(
          "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:16px"
        )}
      >
        <div style={css("font-size:14px;font-weight:600;margin-bottom:3px")}>Тема оформления</div>
        <div style={css("font-size:12.5px;color:var(--text-3);margin-bottom:16px")}>
          Настройка сохраняется в этом браузере
        </div>

        <div style={css("display:flex;gap:14px;flex-wrap:wrap")}>
          {/* Светлая */}
          <button
            onClick={() => setTheme("light")}
            style={mix(
              "flex:1;min-width:220px;text-align:left;background:var(--surface);border-radius:12px;padding:12px;cursor:pointer",
              { border: `2px solid ${theme === "light" ? "var(--accent)" : "var(--border)"}` }
            )}
          >
            <div
              style={css(
                "height:104px;border-radius:9px;overflow:hidden;border:1px solid #E7E9EC;display:flex;background:#F6F7F9"
              )}
            >
              <div
                style={css(
                  "width:40px;background:#fff;border-right:1px solid #ECEEF1;padding:9px 7px;display:flex;flex-direction:column;gap:6px"
                )}
              >
                <div style={css("width:18px;height:18px;border-radius:5px;background:#3E63DD")} />
                <div style={css("height:5px;background:#E4E7EC;border-radius:3px")} />
                <div style={css("height:5px;width:72%;background:#E4E7EC;border-radius:3px")} />
                <div style={css("height:5px;width:58%;background:#E4E7EC;border-radius:3px")} />
              </div>
              <div style={css("flex:1;padding:10px;display:flex;flex-direction:column;gap:7px")}>
                <div style={css("height:7px;width:46%;background:#CFD4DB;border-radius:3px")} />
                <div
                  style={css("height:24px;background:#fff;border:1px solid #EAEDF0;border-radius:6px")}
                />
                <div
                  style={css("height:24px;background:#fff;border:1px solid #EAEDF0;border-radius:6px")}
                />
              </div>
            </div>
            <div style={css("display:flex;align-items:center;gap:8px;margin-top:12px")}>
              <span style={{ display: "flex", color: "var(--amber-dot)" }}>
                <Svg paths={ICONS.sun} size={16} />
              </span>
              <span style={css("font-size:13.5px;font-weight:600;flex:1")}>Светлая</span>
              {theme === "light" && <Checked />}
            </div>
          </button>

          {/* Тёмная */}
          <button
            onClick={() => setTheme("dark")}
            style={mix(
              "flex:1;min-width:220px;text-align:left;background:var(--surface);border-radius:12px;padding:12px;cursor:pointer",
              { border: `2px solid ${theme === "dark" ? "var(--accent)" : "var(--border)"}` }
            )}
          >
            <div
              style={css(
                "height:104px;border-radius:9px;overflow:hidden;border:1px solid #2A303A;display:flex;background:#0F1116"
              )}
            >
              <div
                style={css(
                  "width:40px;background:#181B22;border-right:1px solid #23282F;padding:9px 7px;display:flex;flex-direction:column;gap:6px"
                )}
              >
                <div style={css("width:18px;height:18px;border-radius:5px;background:#6C8BFF")} />
                <div style={css("height:5px;background:#2E353F;border-radius:3px")} />
                <div style={css("height:5px;width:72%;background:#2E353F;border-radius:3px")} />
                <div style={css("height:5px;width:58%;background:#2E353F;border-radius:3px")} />
              </div>
              <div style={css("flex:1;padding:10px;display:flex;flex-direction:column;gap:7px")}>
                <div style={css("height:7px;width:46%;background:#3A424E;border-radius:3px")} />
                <div
                  style={css(
                    "height:24px;background:#181B22;border:1px solid #262C35;border-radius:6px"
                  )}
                />
                <div
                  style={css(
                    "height:24px;background:#181B22;border:1px solid #262C35;border-radius:6px"
                  )}
                />
              </div>
            </div>
            <div style={css("display:flex;align-items:center;gap:8px;margin-top:12px")}>
              <span style={{ display: "flex", color: "var(--violet-dot)" }}>
                <Svg paths={ICONS.moon} size={16} />
              </span>
              <span style={css("font-size:13.5px;font-weight:600;flex:1")}>Тёмная</span>
              {theme === "dark" && <Checked />}
            </div>
          </button>
        </div>
      </section>

      {/* ---- Масштаб ---- */}
      <section
        style={css(
          "background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px"
        )}
      >
        <div style={css("font-size:14px;font-weight:600;margin-bottom:3px")}>Масштаб интерфейса</div>
        <div style={css("font-size:12.5px;color:var(--text-3);margin-bottom:16px")}>
          Крупнее — удобнее с телефона у стеллажа; компактнее — больше данных на экране
        </div>

        <div
          style={css(
            "display:inline-flex;gap:4px;background:var(--muted-bg);padding:4px;border-radius:10px"
          )}
        >
          {SCALES.map((v) => (
            <button
              key={v}
              onClick={() => setScale(v)}
              style={tabStyle(Math.abs(scale - v) < 0.001)}
            >
              {Math.round(v * 100)}%
            </button>
          ))}
        </div>

        <div
          style={css(
            "margin-top:16px;padding:13px 16px;border:1px solid var(--border-2);border-radius:10px;background:var(--surface-2);display:flex;align-items:center;gap:14px;flex-wrap:wrap"
          )}
        >
          <span style={css("font-size:12.5px;color:var(--text-3)")}>Пример брони:</span>
          <span style={css(MONO + ";font-size:13.5px;color:var(--text-3)")}>№130</span>
          <span
            style={css(
              "display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--green);background:var(--green-tint);padding:3px 10px;border-radius:20px"
            )}
          >
            <span style={css("width:5px;height:5px;border-radius:50%;background:var(--green-dot)")} />
            Закрыта
          </span>
          <span style={css(MONO + ";font-size:13.5px;font-weight:600")}>
            К оплате 4 090 <span style={css("font-size:11px;color:var(--text-4)")}>сом</span>
          </span>
        </div>
      </section>
    </Page>
  );
}

/** Курс юаня: подсказка ¥ при добавлении товара. Меняет только администратор. */
function RateCard({ toast }: { toast: Toast }) {
  const [rate, setRate] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getSettings()
      .then((s) => setRate(String(s.cny_rate)))
      .catch((e) => setError(apiError(e)));
  }, []);

  async function save() {
    setError("");
    try {
      const s = await updateSettings({ cny_rate: Number(rate.replace(",", ".")) });
      setRate(String(s.cny_rate));
      toast("success", "Курс сохранён");
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <section style={css("background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:16px")}>
      <div style={css("font-size:14px;font-weight:600;margin-bottom:3px")}>Курс юаня</div>
      <div style={css("font-size:12.5px;color:var(--text-3);margin-bottom:12px")}>
        Сколько сом за 1 ¥. Используется, чтобы при добавлении товара показать и сохранить цену в юанях.
      </div>
      <div style={css("display:flex;gap:10px;align-items:center")}>
        <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" style={css(inputStyle + ";width:140px;" + MONO)} />
        <span style={css("font-size:12.5px;color:var(--text-3)")}>сом за ¥1</span>
        <HButton onClick={save} s={btnPrimary} hover="background:var(--accent-hover)">
          Сохранить
        </HButton>
      </div>
      {error && <div style={css("color:var(--danger);font-size:12px;margin-top:8px")}>{error}</div>}
    </section>
  );
}

function Checked() {
  return (
    <span
      style={css(
        "width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center"
      )}
    >
      <Svg paths={I_CHECK} size={12} sw={3} />
    </span>
  );
}
