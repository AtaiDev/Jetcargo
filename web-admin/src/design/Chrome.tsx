/**
 * Оболочка сайта (новый дизайн):
 *  - верхняя панель: знак и название, «таблетки»-вкладки основных разделов — чёрная плашка
 *    плавно переезжает под выбранную, справа — поиск, «Приём» и профиль;
 *  - слева — плавающая чёрная панель-«док»: поиск, новый заказ, настройки, админ-разделы, тема;
 *    подсказка с названием — при наведении. На телефоне док — плавающая полоса внизу,
 *    а вкладки прокручиваются вбок;
 *  - окно «Поиск» (кнопка или Ctrl+K) и меню профиля.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";

import GlobalSearch from "../components/GlobalSearch";
import { APP_NAME, APP_TAGLINE } from "../config";
import { Icon } from "./icons";
import { LogoMark } from "./Logo";
import { usePrefs } from "./prefs";

export interface ChromeTab {
  key: string;
  path: string;
  label: string;
  badge?: number | null;
}

export interface DockItem {
  key: string;
  path: string;
  label: string;
}

function Svg({ d, size = 18, sw = 1.9 }: { d: string; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const D_SEARCH = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2";
const D_PLUS = "M12 5v14M5 12h14";
const D_MOON = "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z";
const D_SUN = "M12 3v1.5M12 19.5V21M4.6 4.6l1.1 1.1M18.3 18.3l1.1 1.1M3 12h1.5M19.5 12H21M4.6 19.4l1.1-1.1M18.3 5.7l1.1-1.1M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z";
const D_SCAN = "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9v6M11 9v6M14 9v6M17 9v6";
const D_LOGOUT = "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9";
const D_GEAR =
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z";

// --- вкладки ---------------------------------------------------------------------------------------

/** «Таблетки» разделов: чёрная плашка плавно переезжает под выбранную; узко — прокрутка вбок. */
export function ChromeTabs({ tabs, active, onPick }: { tabs: ChromeTab[]; active: string; onPick: (t: ChromeTab) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  const known = tabs.some((t) => t.key === active);

  useLayoutEffect(() => {
    const place = () => {
      const el = track.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
      setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    place();
    const ro = new ResizeObserver(place);
    if (track.current) ro.observe(track.current);
    return () => ro.disconnect();
  }, [active, tabs.map((t) => `${t.key}:${t.badge ?? ""}`).join()]);

  // Первый раз плашка встаёт без анимации, дальше — переезжает.
  useEffect(() => {
    if (pill && !ready) requestAnimationFrame(() => setReady(true));
  }, [pill, ready]);

  // Выбранная вкладка всегда в поле зрения (узкий экран — прокрутка вбок).
  useEffect(() => {
    const box = track.current?.parentElement;
    const el = track.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    const left = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
    box.scrollTo({ left, behavior: ready ? "smooth" : "auto" });
  }, [active, ready]);

  return (
    <nav className="ch-tabs" aria-label="Разделы">
      <div className="ch-tabs-track" ref={track}>
        {pill && known && (
          <span className={"ch-tabs-pill" + (ready ? " ready" : "")} style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} aria-hidden />
        )}
        {tabs.map((t) => (
          <a
            key={t.key}
            href={t.path}
            data-tab={t.key}
            className={"ch-tab" + (t.key === active ? " on" : "")}
            aria-current={t.key === active ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              onPick(t);
            }}
          >
            {t.label}
            {t.badge ? <span className="ch-count">{t.badge > 99 ? "99+" : t.badge}</span> : null}
          </a>
        ))}
      </div>
    </nav>
  );
}

// --- верхняя панель --------------------------------------------------------------------------------

export function TopBar({
  tabs,
  active,
  onPick,
  user,
  isAdmin,
  isDesktop,
  onSearch,
  onLogout,
}: {
  tabs: ChromeTab[];
  active: string;
  onPick: (t: ChromeTab) => void;
  user: { name: string; initials: string };
  isAdmin: boolean;
  isDesktop: boolean;
  onSearch: () => void;
  onLogout: () => void;
}) {
  const nav = useNavigate();
  return (
    <header className="ch-top">
      <div className="ch-top-row">
        <a
          className="ch-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("/");
          }}
          aria-label={`${APP_NAME}: обзор`}
        >
          <span className="ch-brand-mark">
            <LogoMark size={20} />
          </span>
          <span className="ch-brand-txt">
            <b>{APP_NAME}</b>
            <small>{APP_TAGLINE}</small>
          </span>
        </a>
        {isDesktop && <ChromeTabs tabs={tabs} active={active} onPick={onPick} />}
        <div className="ch-tools">
          {isDesktop && (
            <button type="button" className="ch-ibtn" onClick={onSearch} aria-label="Поиск (Ctrl+K)" title="Поиск · Ctrl+K">
              <Svg d={D_SEARCH} />
            </button>
          )}
          {/* На «Приёме» кнопка прячется, но место держит — вкладки не сдвигаются */}
          <button
            type="button"
            className={"ch-cta" + (active === "receive" ? " gone" : "")}
            onClick={() => nav("/receive")}
            title="Приём товара сканером"
            tabIndex={active === "receive" ? -1 : undefined}
            aria-hidden={active === "receive" || undefined}
          >
            <Svg d={D_SCAN} size={17} />
            <span>Приём</span>
          </button>
          <UserMenu user={user} isAdmin={isAdmin} onLogout={onLogout} />
        </div>
      </div>
      {!isDesktop && <ChromeTabs tabs={tabs} active={active} onPick={onPick} />}
    </header>
  );
}

function UserMenu({ user, isAdmin, onLogout }: { user: { name: string; initials: string }; isAdmin: boolean; onLogout: () => void }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="ch-me-wrap" ref={box}>
      <button type="button" className={"ch-me" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)} aria-label={`Профиль: ${user.name}`} aria-expanded={open}>
        <span className="ch-av">{user.initials}</span>
      </button>
      {open && (
        <div className="ch-menu" role="menu">
          <div className="ch-menu-head">
            <span className="ch-av lg">{user.initials}</span>
            <span style={{ minWidth: 0 }}>
              <b>{user.name}</b>
              <small>{isAdmin ? "Администратор" : "Сотрудник"}</small>
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="ch-menu-item"
            onClick={() => {
              setOpen(false);
              nav("/settings");
            }}
          >
            <Svg d={D_GEAR} size={16} />
            Настройки
          </button>
          <button type="button" role="menuitem" className="ch-menu-item danger" onClick={onLogout}>
            <Svg d={D_LOGOUT} size={16} />
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}

// --- док -------------------------------------------------------------------------------------------

function DockBtn({ label, on, onClick, children }: { label: string; on?: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button type="button" className={"ch-dock-btn" + (on ? " on" : "")} onClick={onClick} aria-label={label} aria-current={on ? "page" : undefined}>
      {children}
      <span className="ch-tip">{label}</span>
    </button>
  );
}

export function Dock({ items, active, onSearch }: { items: DockItem[]; active: string; onSearch: () => void }) {
  const nav = useNavigate();
  const { theme, setTheme } = usePrefs();
  const dark = theme === "dark";
  const [spin, setSpin] = useState(0);
  const main = items.filter((i) => i.key === "new-order" || i.key === "settings");
  const admin = items.filter((i) => i.key !== "new-order" && i.key !== "settings");
  return (
    <nav className="ch-dock" aria-label="Инструменты">
      <DockBtn label="Поиск · Ctrl+K" onClick={onSearch}>
        <Svg d={D_SEARCH} />
      </DockBtn>
      <span className="ch-dock-sep" aria-hidden />
      {main.map((i) => (
        <DockBtn key={i.key} label={i.label} on={active === i.key} onClick={() => nav(i.path)}>
          {i.key === "new-order" ? <Svg d={D_PLUS} sw={2.1} /> : <Icon name={i.key} size={18} />}
        </DockBtn>
      ))}
      {admin.length > 0 && <span className="ch-dock-sep" aria-hidden />}
      {admin.map((i) => (
        <DockBtn key={i.key} label={i.label} on={active === i.key} onClick={() => nav(i.path)}>
          <Icon name={i.key} size={18} />
        </DockBtn>
      ))}
      <span className="ch-dock-sep" aria-hidden />
      <DockBtn
        label={dark ? "Светлая тема" : "Тёмная тема"}
        onClick={(e) => {
          const next = dark ? "light" : "dark";
          const apply = () => {
            document.documentElement.setAttribute("data-theme", next);
            flushSync(() => {
              setSpin((n) => n + 1);
              setTheme(next);
            });
          };
          // Новая тема расходится кругом от кнопки по всему экрану.
          const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
          if (!doc.startViewTransition || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return apply();
          const b = e.currentTarget.getBoundingClientRect();
          const x = b.left + b.width / 2;
          const y = b.top + b.height / 2;
          const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
          doc.startViewTransition(apply).ready.then(() => {
            document.documentElement.animate(
              { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
              { duration: 750, easing: "cubic-bezier(.65,0,.35,1)", pseudoElement: "::view-transition-new(root)" }
            );
          });
        }}
      >
        <span key={spin} className="ch-theme-ico">
          <Svg d={dark ? D_SUN : D_MOON} />
        </span>
      </DockBtn>
    </nav>
  );
}

// --- окно «Поиск» ----------------------------------------------------------------------------------

export function Finder({ onClose }: { onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(onClose, 160);
  };
  return (
    <div className={"ch-finder" + (leaving ? " out" : "")} onMouseDown={(e) => e.target === e.currentTarget && close()} role="dialog" aria-modal="true" aria-label="Поиск">
      <div className="ch-finder-box">
        <GlobalSearch finder onDone={close} />
      </div>
    </div>
  );
}
