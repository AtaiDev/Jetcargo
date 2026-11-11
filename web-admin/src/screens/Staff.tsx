/**
 * Сотрудники — «команда»: сверху полоса команды (аватары, сколько активны, фильтр, поиск,
 * «Новый сотрудник»), ниже карточки-пропуска: цвет ленты — роль, аватар с отметкой «в сети»,
 * сколько сделал (с полосой к лучшему в команде), когда был, включатель входа и «Изменить».
 * Справа — роли и права. Только администратор.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { apiError } from "../api/client";
import { createUser, listUsers, updateUser, type User } from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { Empty } from "../components/cargo";
import { HomeHead } from "./overview/Home";
import CountUp from "../design/CountUp";
import { css, mix } from "../design/css";
import { I_CLOSE, I_EYE, I_EYE_OFF, I_PLUS, I_SEARCH, Icon, Svg } from "../design/icons";
import { Page } from "../design/table";
import { HButton, ModalError } from "../design/ui";
import { date } from "../lib/cargo";

type Toast = (k: "success" | "error", t: string) => void;

// Монохром: роль различается оттенком, без цветных лент.
const ROLE = {
  admin: { label: "Администратор", short: "админ", fg: "var(--ov-ink-fg)", bg: "var(--ov-ink)", dot: "var(--ov-ink-fg)", band: "var(--ov-ink)" },
  staff: { label: "Сотрудник склада", short: "склад", fg: "var(--ov-text)", bg: "var(--ov-stone)", dot: "var(--ov-text)", band: "color-mix(in srgb,var(--ov-text) 12%,var(--ov-paper))" },
} as const;

/** «В сети» — действие было в последние 15 минут. */
const ONLINE_MIN = 15;

export default function Staff({ toast }: { isDesktop: boolean; toast: Toast }) {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<User[] | null>(null);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [query, setQuery] = useState("");

  const reload = () =>
    listUsers()
      .then(setRows)
      .catch((e) => {
        setRows([]);
        toast("error", apiError(e, "Не удалось загрузить сотрудников"));
      });
  useEffect(() => {
    reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const list = useMemo(() => rows ?? [], [rows]);
  const stats = {
    total: list.length,
    active: list.filter((u) => u.is_active).length,
    admins: list.filter((u) => u.role === "admin").length,
    staff: list.filter((u) => u.role === "staff").length,
    online: list.filter((u) => isOnline(u)).length,
  };
  // Лучшие в команде — для полосок «сколько сделал» в карточках.
  const best = {
    actions: Math.max(1, ...list.map((u) => u.actions ?? 0)),
    scans: Math.max(1, ...list.map((u) => u.scans ?? 0)),
    issues: Math.max(1, ...list.map((u) => u.issues ?? 0)),
  };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((u) => !q || u.login.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || (b.actions ?? 0) - (a.actions ?? 0));
  }, [list, query]);

  return (
    <Page size="wide">
      <div className="ov sf2">
      <div className="wx-head">
        <HomeHead title="Сотрудники" />
        <span className={"ov-live sf-online" + (stats.online ? "" : " idle")} title="Сотрудники, которые что-то делали за последние 15 минут">
          <span className="ov-live-dot" aria-hidden />
          <b>
            <CountUp text={String(stats.online)} />
          </b>
          <span className="ov-live-l">в сети</span>
        </span>
      </div>

      <section className="sf-team sf-rise">
        <div className="sf-row">
          <span className="sf-stack">
            {list
              .filter((u) => u.is_active)
              .slice(0, 5)
              .map((u) => (
                <Avatar key={u.id} u={u} size={42} ring />
              ))}
            {!rows && <span className="sk" style={css("width:42px;height:42px;border-radius:50%")} />}
          </span>
          <span className="sf-team-t">
            <b>
              Команда
              <span className="n">
                <CountUp text={String(stats.total)} />
              </span>
            </b>
            <span className="sf-sub">
              {stats.admins} {stats.admins === 1 ? "администратор" : "администратора"} · {stats.staff} на складе
              {stats.total - stats.active > 0 && <> · отключено {stats.total - stats.active}</>}
            </span>
          </span>
          <label className="sf-search">
            <span style={css("display:flex;color:var(--ov-mute)")}>
              <Svg paths={I_SEARCH} size={15} />
            </span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя или логин…" aria-label="Найти сотрудника" />
          </label>
        </div>
      </section>

      <div className="sf-grid">
        {!rows ? (
          <div className="sf-badges" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="sf-badge sf-ghost">
                <div className="sf-band" style={{ background: "var(--hover)" }} />
                <div className="sf-who">
                  <span className="sk" style={css("width:64px;height:64px;border-radius:50%;box-shadow:0 0 0 3px var(--surface)")} />
                  <span className="sk" style={css("width:140px;height:12px;margin-top:14px")} />
                  <span className="sk" style={css("width:80px;height:9px;margin-top:9px")} />
                  <span className="sk" style={css("width:120px;height:22px;margin-top:10px;border-radius:999px")} />
                </div>
                <div className="sf-stats" style={css("height:72px")} />
                <div className="sf-foot" style={css("height:58px")} />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div style={css("border-radius:20px;border:1px solid var(--border);background:var(--surface)")}>
            <Empty
              icon="staff"
              title={list.length ? "Никого не найдено" : "Сотрудников пока нет"}
              text={list.length ? "Измените фильтр или поиск" : "Добавьте сотрудника склада — он сможет принимать и выдавать товар"}
            />
          </div>
        ) : (
          <div className="sf-badges">
            {shown.map((u, i) => (
              <Badge key={u.id} u={u} i={i} best={best} onEdit={() => setEditing(u)} />
            ))}
            <HButton onClick={() => setEditing("new")} className="sf-add sf-rise" s={{ ["--i" as string]: shown.length }} hover="">
              <svg className="sf-dash" aria-hidden>
                <rect x="1" y="1" rx="19" />
              </svg>
              <span style={css("width:52px;height:52px;border-radius:16px;display:grid;place-items:center;color:var(--ov-ink-fg);background:var(--ov-ink)")}>
                <Svg paths={I_PLUS} size={22} sw={2.2} />
              </span>
              <span style={css("font-size:14px;font-weight:500;color:var(--text)")}>Добавить сотрудника</span>
              <span style={css("font-size:12.5px;color:var(--text-4);max-width:220px;line-height:1.45")}>логин, пароль и роль — войти сможет сразу</span>
            </HButton>
          </div>
        )}
        <RolesPanel />
      </div>

      {editing && (
        <StaffForm
          user={editing === "new" ? null : editing}
          self={editing !== "new" && editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            await reload();
            toast("success", msg);
          }}
        />
      )}
      </div>
    </Page>
  );
}

// --- Пропуск сотрудника -------------------------------------------------------------------------

const AVATAR_BG = [
  "linear-gradient(135deg,#3a3a37,#121212)",
  "linear-gradient(135deg,#55534d,#1d1d1b)",
  "linear-gradient(135deg,#2e2e2c,#0b0b0b)",
  "linear-gradient(135deg,#6b6862,#2a2927)",
];

/** Инициалы — только по словам из букв: «Азиз (склад, тест)» → «АС». */
function initials(u: User) {
  const words = (u.full_name || u.login)
    .split(/[\s(),.\-_]+/)
    .filter((w) => /^\p{L}/u.test(w));
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
}

function isOnline(u: User): boolean {
  if (!u.is_active || !u.last_active_at) return false;
  return Date.now() - new Date(u.last_active_at).getTime() < ONLINE_MIN * 60000;
}

function Avatar({ u, size, ring }: { u: User; size: number; ring?: boolean }) {
  const name = u.full_name || u.login;
  const n = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return (
    <span
      title={name}
      style={mix("border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-weight:600", {
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: u.is_active ? AVATAR_BG[n % AVATAR_BG.length] : "linear-gradient(135deg,#b9b6ae,#8d8a83)",
        boxShadow: ring ? "0 0 0 3px var(--surface)" : undefined,
      })}
    >
      {initials(u)}
    </span>
  );
}

// иконки показателей: действия, сканы, выдачи
const K_ICON = ["M3 12h4l2.5-6.5 5 13 2.5-6.5H21", "M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8 M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8 M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16 M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16 M8.5 9v6 M12 9v6 M15.5 9v6", "M20.5 8 12 3.5 3.5 8v8l8.5 4.5 8.5-4.5V8z M3.5 8 12 12.5 20.5 8 M12 12.5V20.5"];

/** Карточка сотрудника — как профиль: обложка (роль, когда был), аватар по центру, имя и логин, три числа, «Изменить» и вход. */
function Badge({ u, i, best, onEdit }: { u: User; i: number; best: { actions: number; scans: number; issues: number }; onEdit: () => void }) {
  const r = ROLE[u.role];
  const online = isOnline(u);
  // кольца: насколько близко к лучшему в команде по каждому показателю
  const rings: [string, number, number][] = [
    ["действий", u.actions ?? 0, best.actions],
    ["сканов", u.scans ?? 0, best.scans],
    ["выдач", u.issues ?? 0, best.issues],
  ];
  return (
    <section className={"sc2 sf-rise" + (u.role === "admin" ? " adm" : "") + (u.is_active ? "" : " off")} style={{ ["--i" as string]: i }}>
      <div className="sc2-cover">
        <span className="sc2-role">{u.is_active ? r.label : "Вход отключён"}</span>
        <button type="button" className="sc2-gear" onClick={onEdit} title="Настроить сотрудника" aria-label="Настроить сотрудника">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </div>
      <span className="sc2-av">
        <Avatar u={u} size={78} />
        {online && <span className="sc2-on" title="в сети" />}
      </span>
      <div className="sc2-id">
        <b title={u.full_name || u.login}>{u.full_name || u.login}</b>
        <small>
          @{u.login}
          {u.created_at && <> · с {date(u.created_at.slice(0, 10))}</>}
        </small>
      </div>
      <div className="sc2-k">
        {rings.map(([l, v], k) => (
          <span key={l} className={v ? "" : "z"} style={{ ["--k" as string]: k }}>
            <i>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={K_ICON[k]} pathLength={1} />
              </svg>
            </i>
            <b>
              <CountUp text={v.toLocaleString("ru-RU")} />
            </b>
            <small>{l}</small>
          </span>
        ))}
      </div>
      <span className="sc2-wave" aria-hidden />
    </section>
  );
}

function Switch({ on, disabled, onChange, title }: { on: boolean; disabled?: boolean; onChange: () => void; title: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={onChange}
      style={mix("position:relative;width:40px;height:24px;border:none;border-radius:12px;padding:0;transition:background .15s;flex:none", {
        background: on ? "var(--ov-ink)" : "color-mix(in srgb,var(--ov-text) 18%,var(--ov-paper))",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <span
        style={mix("position:absolute;top:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .15s", {
          left: on ? 19 : 3,
        })}
      />
    </button>
  );
}

// --- Роли и права ---------------------------------------------------------------------------

// права: иконка, подпись, доступно ли складу (админу — всё)
const RIGHTS: { label: string; staff: boolean; d: string }[] = [
  { label: "Заказы и клиенты", staff: true, d: "M6 6h15l-1.5 9h-12z M6 6 5 3H2 M9 20h.01 M18 20h.01" },
  { label: "Приём сканером", staff: true, d: "M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8 M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8 M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16 M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16 M8.5 9v6 M12 9v6 M15.5 9v6" },
  { label: "Выдача и оплата", staff: true, d: "M3 7h18v10H3z M3 11h18 M7 15h3" },
  { label: "Склад и финансы", staff: true, d: "M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8" },
  { label: "Импорт Excel", staff: false, d: "M14 3H6v18h12V7z M14 3v4h4 M9 13l3 3 3-3 M12 16v-5" },
  { label: "Удаление и отмены", staff: false, d: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6" },
  { label: "Курс юаня", staff: false, d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" },
  { label: "Сотрудники и журнал", staff: false, d: "M16 20a4 4 0 0 0-8 0 M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M21 19a3.5 3.5 0 0 0-4-3.4 M17 5.5a2.5 2.5 0 0 1 0 5 M3 19a3.5 3.5 0 0 1 4-3.4 M7 5.5a2.5 2.5 0 0 0 0 5" },
];

function RolesPanel() {
  const chip = (r: (typeof RIGHTS)[number]) => (
    <span key={r.label} className="rp2-chip">
      <i>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={r.d} />
        </svg>
      </i>
      <span>{r.label}</span>
    </span>
  );
  const staff = RIGHTS.filter((r) => r.staff);
  const admin = RIGHTS.filter((r) => !r.staff);
  return (
    <aside className="sf-roles rp rp2 sf-rise" style={{ ["--i" as string]: 2 }}>
      <div className="rp-head">
        <span className="rp-ic">
          <Icon name="staff" size={18} />
        </span>
        <span style={css("min-width:0")}>
          <b>Роли и права</b>
          <small>кто что может в панели</small>
        </span>
      </div>
      <section className="rp2-role">
        <header>
          <i>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8" />
            </svg>
          </i>
          <b>Сотрудник склада</b>
          <em>
            {staff.length} из {RIGHTS.length}
          </em>
        </header>
        <div className="rp2-chips">{staff.map(chip)}</div>
      </section>
      <section className="rp2-role adm">
        <header>
          <i>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z M9 12l2 2 4-4" />
            </svg>
          </i>
          <b>Администратор</b>
          <em>все права</em>
        </header>
        <div className="rp2-chips">
          <span className="rp2-chip all">
            <i>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 5v14 M5 12h14" />
              </svg>
            </i>
            <span>всё, что может сотрудник склада</span>
          </span>
          {admin.map(chip)}
        </div>
      </section>
      <div className="rp-note">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01" />
        </svg>
        <span>Отключённый сотрудник не может войти, но всё, что он сделал, остаётся в журнале.</span>
      </div>
    </aside>
  );
}

// --- Форма ----------------------------------------------------------------------------------


function StaffForm({
  user,
  self,
  onClose,
  onSaved,
}: {
  user: User | null;
  self: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [login, setLogin] = useState(user?.login ?? "");
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [role, setRole] = useState<"admin" | "staff">(user?.role ?? "staff");
  const [active, setActive] = useState(user?.is_active ?? true);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const strength = pwStrength(password);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  async function save() {
    setError("");
    if (!user && !login.trim()) return setError("Укажите логин");
    if ((!user || password) && password.length < 6) return setError("Пароль — минимум 6 символов");
    setBusy(true);
    try {
      if (user) {
        await updateUser(user.id, { full_name: fullName, role, ...(password ? { password } : {}), ...(!self && active !== user.is_active ? { is_active: active } : {}) });
        onSaved(`Сотрудник ${user.login} сохранён`);
      } else {
        await createUser({ login: login.trim(), full_name: fullName, role, password });
        onSaved(`Сотрудник ${login.trim()} создан`);
      }
    } catch (e) {
      setError(apiError(e));
      setBusy(false);
    }
  }

  const name = fullName.trim() || login.trim() || "Новый сотрудник";
  const letter = (name.match(/\p{L}/u)?.[0] ?? "?").toUpperCase();
  return createPortal(
    <div className="md-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="md-dialog ovp sm2" role="dialog" aria-modal="true" aria-label={user ? "Сотрудник" : "Новый сотрудник"} style={{ width: 520 }}>
        <div className={"sm2-cover" + (role === "admin" ? " adm" : "")}>
          <span className="sm2-av">
            {letter}
            <i>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={role === "admin" ? "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" : "M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8"} />
              </svg>
            </i>
          </span>
          <span className="sm2-who">
            <b>{name}</b>
            <small>{login.trim() ? "@" + login.trim() : "логин для входа"}</small>
          </span>
          <button type="button" className="sm2-x" onClick={onClose} aria-label="Закрыть">
            <Svg paths={I_CLOSE} size={14} sw={2.2} />
          </button>
        </div>
        <div className="sm2-body" onKeyDown={(e) => e.key === "Enter" && !busy && save()}>
          <div className="sm2-two">
            <label className="sm2-f">
              <span>Логин</span>
              <input value={login} disabled={!!user} autoFocus={!user} autoCapitalize="off" spellCheck={false} placeholder="например, aibek" onChange={(e) => setLogin(e.target.value)} />
            </label>
            <label className="sm2-f">
              <span>Имя</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Айбек Асанов" />
            </label>
          </div>

          <div className="sm2-f">
            <span>Роль</span>
            <div className="sm2-roles">
              {(["staff", "admin"] as const).map((k) => {
                const locked = self && k === "staff";
                return (
                  <button key={k} type="button" className={"sm2-role" + (role === k ? " on" : "")} disabled={locked} title={locked ? "Нельзя снять с себя роль администратора" : undefined} onClick={() => setRole(k)}>
                    <i>
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d={k === "admin" ? "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z M9 12l2 2 4-4" : "M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8"} />
                      </svg>
                    </i>
                    <span>
                      <b>{ROLE[k].label}</b>
                      <small>{k === "admin" ? "все права, сотрудники, импорт" : "заказы, приём, выдача, оплаты"}</small>
                    </span>
                    <em aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sm2-f">
            <span className="sm2-lh">
              Пароль {user && <small>— пусто, чтобы не менять</small>}
              <button
                type="button"
                className="sm2-gen"
                onClick={() => {
                  setPassword(makePassword());
                  setShowPw(true);
                }}
              >
                придумать
              </button>
            </span>
            <span className="sm2-pw">
              <input type={showPw ? "text" : "password"} value={password} autoComplete="new-password" placeholder="минимум 6 символов" onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPw(!showPw)} title={showPw ? "Скрыть пароль" : "Показать пароль"} aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}>
                <Svg paths={showPw ? I_EYE_OFF : I_EYE} size={16} />
              </button>
            </span>
            {password && (
              <span className="sf-pw" style={{ ["--c" as string]: strength.color }}>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={i < strength.score ? "on" : ""} />
                ))}
                <span style={css("margin-left:6px;font-size:11.5px;color:var(--ov-mute);white-space:nowrap")}>{strength.label}</span>
              </span>
            )}
          </div>

          {user && (
            <div className={"sm2-acc" + (active ? " on" : "")}>
              <i>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={active ? "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2" : "M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3"} />
                </svg>
              </i>
              <span>
                <b>Доступ к панели</b>
                <small>{self ? "свой вход отключить нельзя" : active ? "может входить и работать" : "войти не сможет, история останется"}</small>
              </span>
              <Switch on={active} disabled={self} onChange={() => setActive(!active)} title={active ? "Отключить вход" : "Разрешить вход"} />
            </div>
          )}
          <ModalError text={error} />
        </div>
        <div className="sm2-foot">
          <button type="button" className="sm2-cancel" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="sm2-save" onClick={save} disabled={busy}>
            {busy ? "Сохраняю…" : user ? "Сохранить" : "Создать сотрудника"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Надёжность пароля: длина и разнообразие символов. */
function pwStrength(p: string): { score: number; label: string; color: string } {
  if (p.length < 6) return { score: 1, label: "слишком короткий", color: "var(--danger-dot)" };
  const kinds = [/[a-zа-я]/, /[A-ZА-Я]/, /\d/, /[^\p{L}\d]/u].filter((r) => r.test(p)).length;
  const score = Math.min(4, (p.length >= 10 ? 2 : 1) + (kinds >= 3 ? 2 : kinds >= 2 ? 1 : 0));
  return [
    { score: 1, label: "слабый", color: "var(--danger-dot)" },
    { score: 2, label: "средний", color: "var(--amber-dot)" },
    { score: 3, label: "хороший", color: "var(--green-dot)" },
    { score: 4, label: "надёжный", color: "var(--green-dot)" },
  ][score - 1];
}

/** Случайный пароль без похожих символов (0/O, 1/l) — удобно продиктовать. */
function makePassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => abc[n % abc.length]).join("");
}
