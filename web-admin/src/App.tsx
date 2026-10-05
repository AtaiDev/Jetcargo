/**
 * Оболочка панели: сайдбар (десктоп), выдвижное меню (мобайл), шапка, тосты.
 * Разметка и стили 1:1 из исходного макета админки.
 */
import { useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type Location as RouterLocation,
} from "react-router-dom";
import { listItems } from "./api/domain";
import { useAuth } from "./auth/AuthContext";
import { APP_NAME, APP_TAGLINE } from "./config";
import { MONO, css, mix } from "./design/css";
import { I_CLOSE, Icon, Svg } from "./design/icons";
import { LogoMark } from "./design/Logo";
import { PrefsProvider } from "./design/prefs";
import { HButton, Toast } from "./design/ui";
import GlobalSearch from "./components/GlobalSearch";
import ItemModal from "./components/ItemModal";
import TestBanner from "./components/TestBanner";
import { on, onOpenItem } from "./lib/events";
import LoginPage from "./pages/LoginPage";
import Audit from "./screens/Audit";
import Customers, { CustomerDetail } from "./screens/Customers";
import Finance from "./screens/Finance";
import Import from "./screens/Import";
import Issue from "./screens/Issue";
import Orders from "./screens/Orders";
import Overview from "./screens/overview";
import Batches from "./screens/Batches";
import NewOrder from "./screens/NewOrder";
import Receive from "./screens/Receive";
import Settings from "./screens/Settings";
import Staff from "./screens/Staff";
import Warehouse from "./screens/Warehouse";

const I_LOGOUT: [string, Record<string, unknown>][] = [
  ["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }],
  ["polyline", { points: "16 17 21 12 16 7" }],
  ["line", { x1: 21, y1: 12, x2: 9, y2: 12 }],
];
const I_MENU: [string, Record<string, unknown>][] = [
  ["path", { d: "M4 6h16" }],
  ["path", { d: "M4 12h16" }],
  ["path", { d: "M4 18h16" }],
];
const I_LOCK: [string, Record<string, unknown>][] = [
  ["rect", { x: 3, y: 11, width: 18, height: 11, rx: 2 }],
  ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }],
];

interface NavItem {
  key: string;
  path: string;
  label: string;
  admin?: boolean;
}

// Порядок меню — порядок работы: принять → выдать → заказы → склад → клиенты → деньги.
const NAV_MAIN: NavItem[] = [
  { key: "overview", path: "/", label: "Обзор" },
  { key: "new-order", path: "/new-order", label: "Новый заказ" },
  { key: "receive", path: "/receive", label: "Приём товара" },
  { key: "issue", path: "/issue", label: "Выдача" },
  { key: "orders", path: "/orders", label: "Заказы" },
  { key: "warehouse", path: "/warehouse", label: "Склад" },
  { key: "batches", path: "/batches", label: "Партии" },
  { key: "customers", path: "/customers", label: "Клиенты" },
  { key: "finance", path: "/finance", label: "Финансы" },
  { key: "settings", path: "/settings", label: "Настройки" },
];

const NAV_ADMIN: NavItem[] = [
  { key: "import", path: "/import", label: "Импорт Excel", admin: true },
  { key: "staff", path: "/staff", label: "Сотрудники", admin: true },
  { key: "audit", path: "/audit", label: "Журнал", admin: true },
];

const TITLES: Record<string, string> = {
  overview: "Обзор",
  "new-order": "Новый заказ",
  receive: "Приём товара",
  issue: "Выдача",
  orders: "Заказы",
  warehouse: "Склад",
  batches: "Партии",
  customers: "Клиенты",
  finance: "Финансы",
  import: "Импорт Excel",
  staff: "Сотрудники",
  audit: "Журнал действий",
  settings: "Настройки",
};

const SUBTITLES: Record<string, string> = {
  overview: "Деньги, заказы, склад и клиенты",
  "new-order": "Клиент, товары, статус и оплата — одним заказом",
  receive: "Сканируйте код — товар встанет на склад",
  issue: "Найдите клиента и выдайте товары со склада",
  orders: "Все товары клиентов, оплаты и статусы",
  warehouse: "Ожидаемые и принятые товары, история сканирований",
  batches: "Прибыль по партиям: вес, доставка, наценка",
  customers: "Поиск клиента, его товары, оплаты и долг",
  finance: "Сумма заказов, оплаты, долги и прибыль",
  import: "Загрузка таблицы с превью и проверкой",
  staff: "Учётные записи и роли",
  audit: "Кто, что и когда сделал",
  settings: "Курс юаня, тема и масштаб",
};

function screenKey(loc: RouterLocation): string {
  const p = loc.pathname;
  if (p === "/") return "overview";
  const seg = p.split("/")[1] ?? "";
  return seg || "overview";
}

export default function App() {
  return (
    <PrefsProvider>
      <TestBanner />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<Shell />} />
      </Routes>
    </PrefsProvider>
  );
}

function Shell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [width, setWidth] = useState(() => window.innerWidth);
  const [navOpen, setNavOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [inStock, setInStock] = useState(0);
  const [openItemId, setOpenItemId] = useState<number | null>(null);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Сколько товаров ждёт выдачи — бейдж у «Выдачи». Обновляется при любых изменениях.
  useEffect(() => {
    if (!user) return;
    const load = () =>
      listItems({ status: "in_stock", limit: 1 })
        .then((r) => setInStock(r.total))
        .catch(() => setInStock(0));
    load();
    return on("cargo:changed", load);
  }, [user, loc.pathname]);

  // Карточка товара, открытая из глобального поиска, — поверх любого экрана.
  useEffect(() => onOpenItem(setOpenItemId), []);

  function showToast(kind: "success" | "error", text: string) {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 2800);
  }

  // Пока проверяем вход, поверх страницы стоит заставка из index.html (src/lib/boot.ts).
  if (loading) return null;
  // Прямую ссылку (например /customers/12), открытую без входа, запоминаем —
  // после логина вернём на неё, а не на дашборд.
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;

  const isDesktop = width >= 860;
  const key = screenKey(loc);
  const isAdmin = user.role === "admin";

  const badgeOf = (k: string) => (k === "issue" ? inStock || null : null);

  const navStyle = (active: boolean) =>
    mix(
      "display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;margin-bottom:2px;border-radius:7px;border:1px solid transparent;font:inherit;font-size:13px;cursor:pointer",
      {
        background: active ? "var(--accent-tint)" : "transparent",
        color: active ? "var(--accent-strong)" : "var(--text-2)",
        fontWeight: active ? 600 : 500,
      }
    );

  const NavButton = ({ item, locked }: { item: NavItem; locked?: boolean }) => {
    const active = key === item.key;
    const badge = badgeOf(item.key);
    return (
      <HButton
        onClick={() => {
          // Замок был декоративным: кнопка всё равно навигировала, и сотрудник
          // попадал на админ-экран (данные потом отдавали 403). Теперь не пускаем.
          if (locked) {
            setToast({ kind: "error", text: "Раздел доступен только администратору" });
            return;
          }
          nav(item.path);
          setNavOpen(false);
        }}
        s={navStyle(active)}
        hover="background:var(--hover)"
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            flex: "none",
            color: active ? "var(--accent)" : "var(--text-3)",
          }}
        >
          <Icon name={item.key} />
        </span>
        <span style={css("flex:1;text-align:left")}>{item.label}</span>
        {badge && (
          <span
            style={css(
              "flex:none;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent);color:#fff;font-size:10.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;" + MONO
            )}
          >
            {badge}
          </span>
        )}
        {locked && (
          <span style={{ display: "flex", flex: "none", color: "var(--text-5)" }}>
            <Svg paths={I_LOCK} size={12} sw={2} />
          </span>
        )}
      </HButton>
    );
  };

  const NavContent = () => (
    <>
      {NAV_MAIN.map((n) => (
        <NavButton key={n.key} item={n} />
      ))}
      <div
        style={css(
          "margin:14px 8px 6px;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text-4)"
        )}
      >
        Администрирование
      </div>
      {NAV_ADMIN.map((n) => (
        <NavButton key={n.key} item={n} locked={!isAdmin} />
      ))}
    </>
  );

  const initials = (user.full_name || user.login)
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      style={css(
        "height:100%;min-height:100%;display:flex;position:relative;overflow:hidden;background:var(--bg);color:var(--text);font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:13px;line-height:1.45"
      )}
    >
      {/* ---------- Сайдбар (десктоп) ---------- */}
      {isDesktop && (
        <aside
          style={css(
            "width:236px;flex:none;height:100%;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column"
          )}
        >
          <div
            style={css(
              "height:56px;flex:none;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid var(--border-2)"
            )}
          >
            <span style={css("display:flex;flex:none;color:var(--text)")}>
              <LogoMark size={28} />
            </span>
            <div style={css("min-width:0")}>
              <div style={css("font-weight:600;font-size:14px;letter-spacing:-.01em")}>
                {APP_NAME}
              </div>
              <div style={css("font-size:10.5px;color:var(--text-3);margin-top:-1px")}>
                {APP_TAGLINE}
              </div>
            </div>
          </div>

          <nav style={css("flex:1;min-height:0;overflow:auto;padding:12px 12px 0")}>
            <NavContent />
          </nav>

          <div
            style={css(
              "flex:none;border-top:1px solid var(--border-2);padding:10px 12px;display:flex;align-items:center;gap:10px"
            )}
          >
            <div
              style={css(
                "width:30px;height:30px;border-radius:50%;background:var(--muted-bg);color:var(--text-2);display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:600;flex:none"
              )}
            >
              {initials}
            </div>
            <div style={css("flex:1;min-width:0")}>
              <div
                style={css(
                  "font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                )}
              >
                {user.full_name || user.login}
              </div>
              <div style={css("font-size:10.5px;color:var(--text-3)")}>
                {isAdmin ? "Администратор" : "Сотрудник"}
              </div>
            </div>
            <HButton
              title="Выход"
              onClick={logout}
              s="width:28px;height:28px;border:none;background:transparent;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-3)"
              hover="background:var(--hover);color:var(--text-2)"
            >
              <Svg paths={I_LOGOUT} size={16} sw={1.7} />
            </HButton>
          </div>
        </aside>
      )}

      {/* ---------- Контентная колонка ---------- */}
      <div
        style={css(
          "flex:1;min-width:0;height:100%;display:flex;flex-direction:column;overflow:hidden"
        )}
      >
        {!isDesktop ? (
          <header
            style={css(
              "height:54px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;background:var(--surface);border-bottom:1px solid var(--border)"
            )}
          >
            <HButton
              onClick={() => setNavOpen(true)}
              s="width:34px;height:34px;border:1px solid var(--border);background:var(--surface);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-2);flex:none"
            >
              <Svg paths={I_MENU} size={18} />
            </HButton>
            <div style={css("flex:1;font-weight:600;font-size:15px")}>{TITLES[key] ?? ""}</div>
            <div
              style={css(
                "width:30px;height:30px;border-radius:50%;background:var(--muted-bg);color:var(--text-2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex:none"
              )}
            >
              {initials}
            </div>
          </header>
        ) : (
          <header
            style={css(
              "height:56px;flex:none;display:flex;align-items:center;gap:16px;padding:0 22px;background:var(--surface);border-bottom:1px solid var(--border)"
            )}
          >
            <div style={css("min-width:0")}>
              <div style={css("font-weight:600;font-size:16px;letter-spacing:-.01em")}>
                {TITLES[key] ?? ""}
              </div>
              <div style={css("font-size:11px;color:var(--text-3);margin-top:-1px")}>
                {SUBTITLES[key] ?? ""}
              </div>
            </div>
            <div style={css("flex:1")} />
            <GlobalSearch />
            {key !== "receive" && (
              <HButton
                onClick={() => nav("/receive")}
                title="Приём товара сканером"
                s="height:34px;padding:0 12px;border:1px solid var(--accent-border);background:var(--accent-tint);border-radius:8px;display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--accent-strong);font-size:12.5px;font-weight:600;flex:none"
                hover="border-color:var(--accent)"
              >
                <Icon name="receive" size={16} />
                Приём
              </HButton>
            )}
          </header>
        )}

        <main style={css("flex:1;min-height:0;overflow:auto;position:relative")}>
          <Routes>
            <Route path="/" element={<Overview isDesktop={isDesktop} isAdmin={isAdmin} />} />
            <Route path="/receive" element={<Receive toast={showToast} />} />
            <Route path="/issue" element={<Issue isDesktop={isDesktop} toast={showToast} />} />
            <Route path="/orders" element={<Orders isDesktop={isDesktop} toast={showToast} />} />
            <Route path="/new-order" element={<NewOrder isDesktop={isDesktop} toast={showToast} />} />
            <Route path="/warehouse" element={<Warehouse isDesktop={isDesktop} toast={showToast} />} />
            <Route path="/batches" element={<Batches isDesktop={isDesktop} toast={showToast} />} />
            <Route path="/batches/:id" element={<Batches isDesktop={isDesktop} toast={showToast} />} />
            <Route path="/customers" element={<Customers isDesktop={isDesktop} toast={showToast} />} />
            <Route path="/customers/:id" element={<CustomerDetail isDesktop={isDesktop} toast={showToast} />} />
            <Route path="/finance" element={<Finance isDesktop={isDesktop} toast={showToast} />} />
            <Route path="/settings" element={<Settings toast={showToast} />} />
            {/* Админ-разделы: прямой заход по URL сотрудником уводим на обзор
                (данные и так защищены на сервере, но экран показывать незачем). */}
            <Route path="/import" element={isAdmin ? <Import toast={showToast} /> : <Navigate to="/" replace />} />
            <Route
              path="/staff"
              element={isAdmin ? <Staff isDesktop={isDesktop} toast={showToast} /> : <Navigate to="/" replace />}
            />
            <Route path="/audit" element={isAdmin ? <Audit isDesktop={isDesktop} /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          {openItemId !== null && <ItemModal id={openItemId} toast={showToast} onClose={() => setOpenItemId(null)} />}
        </main>
      </div>

      {/* ---------- Мобильное меню ---------- */}
      {navOpen && !isDesktop && (
        <div
          onClick={() => setNavOpen(false)}
          style={css(
            "position:absolute;inset:0;background:rgba(15,18,25,.4);z-index:80;display:flex;animation:fadeIn .12s ease"
          )}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            style={css(
              "width:250px;height:100%;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;animation:slideRight .16s ease"
            )}
          >
            <div
              style={css(
                "height:54px;flex:none;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid var(--border-2)"
              )}
            >
              <span style={css("display:flex;flex:none;color:var(--text)")}>
                <LogoMark size={26} />
              </span>
              <div style={css("flex:1;font-weight:600;font-size:14px")}>
                {APP_NAME}
              </div>
              <HButton
                onClick={() => setNavOpen(false)}
                s="width:30px;height:30px;border:none;background:transparent;border-radius:6px;cursor:pointer;color:var(--text-3);display:flex;align-items:center;justify-content:center"
              >
                <Svg paths={I_CLOSE} size={17} />
              </HButton>
            </div>
            <nav style={css("flex:1;min-height:0;overflow:auto;padding:12px 12px 0")}>
              <NavContent />
            </nav>
            <div
              style={css(
                "flex:none;border-top:1px solid var(--border-2);padding:10px 12px;display:flex;align-items:center;gap:10px"
              )}
            >
              <div
                style={css(
                  "width:30px;height:30px;border-radius:50%;background:var(--muted-bg);color:var(--text-2);display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:600;flex:none"
                )}
              >
                {initials}
              </div>
              <div style={css("flex:1;min-width:0")}>
                <div style={css("font-size:12.5px;font-weight:600")}>
                  {user.full_name || user.login}
                </div>
                <div style={css("font-size:10.5px;color:var(--text-3)")}>
                  {isAdmin ? "Администратор" : "Сотрудник"}
                </div>
              </div>
              <HButton
                title="Выход"
                onClick={logout}
                s="width:28px;height:28px;border:none;background:transparent;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-3)"
              >
                <Svg paths={I_LOGOUT} size={16} sw={1.7} />
              </HButton>
            </div>
          </aside>
        </div>
      )}

      {toast && <Toast kind={toast.kind} text={toast.text} />}
    </div>
  );
}

