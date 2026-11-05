/**
 * Оболочка панели: верхняя панель с вкладками разделов, док слева (на телефоне — снизу),
 * окно поиска, тосты. Сами панели — design/Chrome.tsx.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  type Location as RouterLocation,
} from "react-router-dom";
import { listItems, listNotify } from "./api/domain";
import { useAuth } from "./auth/AuthContext";
import { APP_NAME } from "./config";
import { Dock, Finder, TopBar, type ChromeTab, type DockItem } from "./design/Chrome";
import FloatingBg from "./design/FloatingBg";
import { PrefsProvider } from "./design/prefs";
import { Toast } from "./design/ui";
import ItemModal from "./components/ItemModal";
import TestBanner from "./components/TestBanner";
import { on, onOpenItem } from "./lib/events";
import { useReveal } from "./lib/reveal";
import LoginPage from "./pages/LoginPage";
import Audit from "./screens/Audit";
import Customers, { CustomerDetail } from "./screens/Customers";
import Finance from "./screens/Finance";
import Import from "./screens/Import";
import Issue from "./screens/Issue";
import Notify from "./screens/Notify";
import Orders from "./screens/Orders";
import Overview from "./screens/overview";
import Batches from "./screens/Batches";
import NewOrder from "./screens/NewOrder";
import Receive from "./screens/Receive";
import Settings from "./screens/Settings";
import Staff from "./screens/Staff";
import Warehouse from "./screens/Warehouse";

// Вкладки сверху — порядок работы: принять → уведомить → выдать → заказы → склад → партии → клиенты → деньги.
const NAV_TABS: { key: string; path: string; label: string }[] = [
  { key: "overview", path: "/", label: "Обзор" },
  { key: "receive", path: "/receive", label: "Приём" },
  { key: "notify", path: "/notify", label: "Уведомления" },
  { key: "issue", path: "/issue", label: "Выдача" },
  { key: "orders", path: "/orders", label: "Заказы" },
  { key: "warehouse", path: "/warehouse", label: "Склад" },
  { key: "batches", path: "/batches", label: "Партии" },
  { key: "customers", path: "/customers", label: "Клиенты" },
  { key: "finance", path: "/finance", label: "Финансы" },
];

// Док слева (на телефоне — снизу): действия и разделы вне ежедневных вкладок.
const NAV_DOCK: DockItem[] = [
  { key: "new-order", path: "/new-order", label: "Новый заказ" },
  { key: "settings", path: "/settings", label: "Настройки" },
];

// Только администратору (сотрудник их не видит; на сервере данные и так закрыты).
const NAV_ADMIN: DockItem[] = [
  { key: "import", path: "/import", label: "Импорт Excel" },
  { key: "staff", path: "/staff", label: "Сотрудники" },
  { key: "audit", path: "/audit", label: "Журнал" },
];

const TITLES: Record<string, string> = {
  overview: "Обзор",
  "new-order": "Новый заказ",
  receive: "Приём товара",
  notify: "Уведомления",
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
  // Окно «Поиск»: кнопка в панели или Ctrl+K.
  const [finder, setFinder] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setFinder(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Сменилась страница — окно поиска закрываем.
  useEffect(() => setFinder(false), [loc.pathname]);
  // leaving — тост уезжает вниз перед тем, как исчезнуть.
  const [toast, setToast] = useState<{ id: number; kind: "success" | "error"; text: string; leaving: boolean } | null>(null);
  const toastTimers = useRef<number[]>([]);
  const [inStock, setInStock] = useState(0);
  const [toNotify, setToNotify] = useState(0);
  const [openItemId, setOpenItemId] = useState<number | null>(null);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Сколько товаров ждёт выдачи — бейдж у «Выдачи». Обновляется при любых изменениях.
  useEffect(() => {
    if (!user) return;
    const load = () => {
      listItems({ status: "in_stock", limit: 1 })
        .then((r) => setInStock(r.total))
        .catch(() => setInStock(0));
      // Сколько клиентов с товаром на складе ещё не уведомлены — бейдж у «Уведомлений».
      listNotify()
        .then((r) => setToNotify(r.rows.filter((x) => x.status !== "sent").length))
        .catch(() => setToNotify(0));
    };
    load();
    return on("cargo:changed", load);
  }, [user, loc.pathname]);

  // Карточка товара, открытая из глобального поиска, — поверх любого экрана.
  useEffect(() => onOpenItem(setOpenItemId), []);

  function showToast(kind: "success" | "error", text: string) {
    // Новый тост сменяет прежний; таймеры прежнего отменяем, иначе они закроют новый раньше времени.
    toastTimers.current.forEach((t) => window.clearTimeout(t));
    const id = Date.now();
    setToast({ id, kind, text, leaving: false });
    toastTimers.current = [
      window.setTimeout(() => setToast((t) => (t && t.id === id ? { ...t, leaving: true } : t)), 2600),
      window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 2900),
    ];
  }

  // Блоки страницы появляются плавно: на широком экране — все при открытии, на телефоне — ещё и по прокрутке.
  const mainRef = useRef<HTMLElement>(null);
  // Ширина полосы прокрутки страницы — чтобы верхняя панель и док стояли ровно по краям блоков.
  useLayoutEffect(() => {
    const m = mainRef.current;
    if (!m) return;
    const set = () => m.parentElement?.style.setProperty("--sbw", `${m.offsetWidth - m.clientWidth}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(m);
    return () => ro.disconnect();
  });
  useReveal(mainRef, `${!loading && !!user}|${loc.pathname}`, width < 860);

  // Пока проверяем вход, поверх страницы стоит заставка из index.html (src/lib/boot.ts).
  if (loading) return null;
  // Прямую ссылку (например /customers/12), открытую без входа, запоминаем —
  // после логина вернём на неё, а не на дашборд.
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;

  const isDesktop = width >= 860;
  const key = screenKey(loc);
  const isAdmin = user.role === "admin";

  document.title = TITLES[key] ? `${TITLES[key]} · ${APP_NAME}` : APP_NAME;
  const badgeOf = (k: string) => (k === "issue" ? inStock || null : k === "notify" ? toNotify || null : null);
  const tabs: ChromeTab[] = NAV_TABS.map((t) => ({ ...t, badge: badgeOf(t.key) }));
  const dock: DockItem[] = [...NAV_DOCK, ...(isAdmin ? NAV_ADMIN : [])];
  const me = {
    name: user.full_name || user.login,
    initials: (user.full_name || user.login)
      .split(" ")
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
  };

  return (
    <div className={"ch" + (isDesktop ? " desk" : " mob")}>
      {/* Фон за всеми блоками: свечение и печать Jetcargo случайно плавают по всей области, на месте при прокрутке */}
      <FloatingBg />
      <TopBar
        tabs={tabs}
        active={key}
        onPick={(t) => nav(t.path)}
        user={me}
        isAdmin={isAdmin}
        isDesktop={isDesktop}
        onSearch={() => setFinder(true)}
        onLogout={logout}
      />
      <Dock items={dock} active={key} onSearch={() => setFinder(true)} />

      {/* scrollbar-gutter: место под полосу прокрутки занято заранее — при подгрузке данных страница не сдвигается вбок. */}
      <main ref={mainRef} className="ch-main">
          <Routes>
            <Route path="/" element={<Overview isDesktop={isDesktop} isAdmin={isAdmin} />} />
            <Route path="/receive" element={<Receive toast={showToast} />} />
            <Route path="/notify" element={<Notify isDesktop={isDesktop} toast={showToast} />} />
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

      {finder && <Finder onClose={() => setFinder(false)} />}
      {toast && <Toast key={toast.id} kind={toast.kind} text={toast.text} leaving={toast.leaving} />}
    </div>
  );
}

