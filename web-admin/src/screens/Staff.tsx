/**
 * Сотрудники — «команда»: сверху полоса команды (аватары, сколько активны, фильтр, поиск,
 * «Новый сотрудник»), ниже карточки-пропуска: цвет ленты — роль, аватар с отметкой «в сети»,
 * сколько сделал (с полосой к лучшему в команде), когда был, включатель входа и «Изменить».
 * Справа — роли и права. Только администратор.
 */
import { useEffect, useMemo, useState } from "react";
import { apiError } from "../api/client";
import { createUser, listUsers, updateUser, type User } from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { Empty, Tabs } from "../components/cargo";
import CountUp from "../design/CountUp";
import { css, mix } from "../design/css";
import { I_CHECK, I_EYE, I_EYE_OFF, I_PLUS, I_SEARCH, Icon, Svg } from "../design/icons";
import { Page } from "../design/table";
import { FieldLabel, HButton, ModalError, ModalShell, btnGhost, btnPrimary, inputStyle } from "../design/ui";
import { date } from "../lib/cargo";

type Toast = (k: "success" | "error", t: string) => void;
type Filter = "all" | "active" | "off";

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";

const ROLE = {
  admin: { label: "Администратор", short: "админ", fg: "var(--violet)", bg: "var(--violet-tint)", dot: "var(--violet-dot)", band: "linear-gradient(120deg,#A78BFA,#7C3AED)" },
  staff: { label: "Сотрудник склада", short: "склад", fg: "var(--accent-strong)", bg: "var(--accent-tint)", dot: "var(--accent)", band: "linear-gradient(120deg,#6A8BFF,#3E63DD)" },
} as const;
const OFF_BAND = "linear-gradient(120deg,#CBD5E1,#94A3B8)";

/** «В сети» — действие было в последние 15 минут. */
const ONLINE_MIN = 15;

export default function Staff({ toast }: { isDesktop: boolean; toast: Toast }) {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<User[] | null>(null);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
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

  async function toggleActive(u: User) {
    try {
      await updateUser(u.id, { is_active: !u.is_active });
      await reload();
      toast("success", u.is_active ? `${u.login} отключён — войти больше не сможет` : `${u.login} снова может входить`);
    } catch (e) {
      toast("error", apiError(e));
    }
  }

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
      .filter((u) => (filter === "all" || (filter === "active" ? u.is_active : !u.is_active)) && (!q || u.login.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || (b.actions ?? 0) - (a.actions ?? 0));
  }, [list, filter, query]);

  return (
    <Page size="wide">
      {/* Команда */}
      <section className="sf-team sf-rise">
        <div style={css("display:flex;align-items:center;gap:16px;min-width:0;flex:1 1 320px")}>
          <span className="sf-stack">
            {list
              .filter((u) => u.is_active)
              .slice(0, 5)
              .map((u) => (
                <Avatar key={u.id} u={u} size={40} ring />
              ))}
            {!rows && <span className="sk" style={css("width:40px;height:40px;border-radius:50%")} />}
          </span>
          <span style={css("min-width:0")}>
            <span style={css("display:block;font-size:17px;font-weight:500;color:var(--text)")}>
              Команда · <CountUp text={String(stats.total)} /> {plural(stats.total, "человек", "человека", "человек")}
            </span>
            <span style={css("display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px;font-size:12.5px;color:var(--text-3)")}>
              <span style={css("display:inline-flex;align-items:center;gap:6px")}>
                <span className="sf-live" />
                сейчас в сети {stats.online}
              </span>
              <span style={css("display:inline-flex;align-items:center;gap:6px")}>
                <span style={mix("width:8px;height:8px;border-radius:50%", { background: ROLE.admin.dot })} />
                администраторов {stats.admins}
              </span>
              <span style={css("display:inline-flex;align-items:center;gap:6px")}>
                <span style={mix("width:8px;height:8px;border-radius:50%", { background: ROLE.staff.dot })} />
                на складе {stats.staff}
              </span>
              {stats.total - stats.active > 0 && (
                <span style={css("display:inline-flex;align-items:center;gap:6px")}>
                  <span style={css("width:8px;height:8px;border-radius:50%;background:var(--text-5)")} />
                  отключено {stats.total - stats.active}
                </span>
              )}
            </span>
          </span>
        </div>
        <HButton onClick={() => setEditing("new")} className="sf-new" s="" hover="">
          <Svg paths={I_PLUS} size={16} sw={2.4} />
          Новый сотрудник
        </HButton>
      </section>

      <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:16px 0 14px")}>
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          tabs={[
            { key: "all", label: "Все", count: stats.total },
            { key: "active", label: "Активные", count: stats.active, dot: "var(--green-dot)" },
            { key: "off", label: "Отключённые", count: stats.total - stats.active, dot: "var(--text-5)" },
          ]}
        />
        <span style={css("flex:1")} />
        <label className="sf-search">
          <span style={css("display:flex;color:var(--text-4)")}>
            <Svg paths={I_SEARCH} size={15} />
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя или логин…" aria-label="Найти сотрудника" />
        </label>
      </div>

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
              <Badge key={u.id} u={u} i={i} self={u.id === me?.id} best={best} onEdit={() => setEditing(u)} onToggle={() => toggleActive(u)} />
            ))}
            <HButton onClick={() => setEditing("new")} className="sf-add sf-rise" s={{ ["--i" as string]: shown.length }} hover="">
              <span style={css("width:52px;height:52px;border-radius:16px;display:grid;place-items:center;color:var(--accent);background:var(--accent-tint)")}>
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
    </Page>
  );
}

// --- Пропуск сотрудника -------------------------------------------------------------------------

const AVATAR_BG = [
  "linear-gradient(135deg,#5B7CFA,#8B5CF6)",
  "linear-gradient(135deg,#22C55E,#0EA5E9)",
  "linear-gradient(135deg,#F59E0B,#EF4444)",
  "linear-gradient(135deg,#EC4899,#8B5CF6)",
  "linear-gradient(135deg,#06B6D4,#3B82F6)",
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
        background: u.is_active ? AVATAR_BG[n % AVATAR_BG.length] : "linear-gradient(135deg,#CBD5E1,#94A3B8)",
        boxShadow: ring ? "0 0 0 3px var(--surface)" : undefined,
      })}
    >
      {initials(u)}
    </span>
  );
}

/** «только что», «15 мин назад», «3 ч назад», «вчера», «5 дн. назад», дата. */
function ago(iso: string | null | undefined): string {
  if (!iso) return "ещё ничего не делал";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  if (d === 1) return "вчера";
  if (d < 30) return `${d} дн. назад`;
  return date(iso.slice(0, 10));
}

function Badge({ u, i, self, best, onEdit, onToggle }: { u: User; i: number; self: boolean; best: { actions: number; scans: number; issues: number }; onEdit: () => void; onToggle: () => void }) {
  const r = ROLE[u.role];
  const online = isOnline(u);
  return (
    <section className={"sf-badge sf-rise" + (u.is_active ? "" : " off")} style={{ ["--i" as string]: i }}>
      <div className="sf-band" style={{ background: u.is_active ? r.band : OFF_BAND }}>
        <span className="sf-hole" />
      </div>
      <div className="sf-who">
        <span style={css("position:relative;display:flex")}>
          <Avatar u={u} size={64} ring />
          <span className={"sf-presence" + (online ? " on" : "")} title={online ? "сейчас в сети" : "не в сети"} />
        </span>
        <span style={css("display:flex;align-items:center;justify-content:center;gap:7px;flex-wrap:wrap;margin-top:10px")}>
          <span style={css("font-size:16px;font-weight:500;color:var(--text);text-align:center")}>{u.full_name || u.login}</span>
          {self && <span className="sf-me">это вы</span>}
        </span>
        <span style={css("display:block;margin-top:2px;font-size:12.5px;color:var(--text-3)")}>@{u.login}</span>
        <span
          className="sf-role"
          style={u.is_active ? { color: r.fg, background: r.bg } : { color: "var(--text-3)", background: "var(--hover)" }}
        >
          <span style={mix("width:7px;height:7px;border-radius:50%", { background: u.is_active ? r.dot : "var(--text-5)" })} />
          {u.is_active ? r.label : "Вход отключён"}
        </span>
        <span style={css(NUM + ";display:block;margin-top:8px;font-size:12px;color:var(--text-4);line-height:1.5")}>
          <span style={mix("", { color: online ? "var(--green)" : undefined })}>{online ? "в сети" : `был(а) ${ago(u.last_active_at)}`}</span>
          {u.created_at && <> · в команде с {date(u.created_at.slice(0, 10))}</>}
        </span>
      </div>

      <div className="sf-stats">
        <Stat label="Действий" value={u.actions ?? 0} best={best.actions} grad="linear-gradient(90deg,#8FA6FF,#3E63DD)" />
        <Stat label="Сканов" value={u.scans ?? 0} best={best.scans} grad="linear-gradient(90deg,#34D399,#16A34A)" />
        <Stat label="Выдач" value={u.issues ?? 0} best={best.issues} grad="linear-gradient(90deg,#FBBF24,#F97316)" />
      </div>

      <div className="sf-foot">
        <Switch on={u.is_active} disabled={self} onChange={onToggle} title={self ? "Нельзя отключить собственную учётную запись" : u.is_active ? "Отключить вход" : "Разрешить вход"} />
        <span style={mix("min-width:0;font-size:12.5px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: u.is_active ? "var(--green)" : "var(--text-4)" })}>
          {u.is_active ? "Может входить" : "Вход отключён"}
        </span>
        <HButton onClick={onEdit} className="sf-edit" s="" hover="">
          Изменить
        </HButton>
      </div>
    </section>
  );
}

function Stat({ label, value, best, grad }: { label: string; value: number; best: number; grad: string }) {
  return (
    <div className="sf-stat">
      <span style={css("display:block;font-size:11.5px;color:var(--text-4)")}>{label}</span>
      <span style={mix(NUM + ";display:block;margin-top:2px;font-size:18px;font-weight:500", { color: value ? "var(--text)" : "var(--text-5)" })}>
        <CountUp text={String(value)} />
      </span>
      <span style={css("display:block;height:4px;margin-top:6px;border-radius:999px;background:var(--hover);overflow:hidden")}>
        {value > 0 && <span className="bar-grow" style={mix("display:block;height:100%;border-radius:999px", { width: `${Math.max(6, Math.round((value / best) * 100))}%`, background: grad })} />}
      </span>
    </div>
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
        background: on ? "var(--green-dot)" : "var(--border-strong)",
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

const RIGHTS: { label: string; staff: boolean }[] = [
  { label: "Новый заказ, заказы, клиенты", staff: true },
  { label: "Приём товара сканером", staff: true },
  { label: "Выдача и приём оплаты", staff: true },
  { label: "Склад, партии, финансы", staff: true },
  { label: "Импорт Excel", staff: false },
  { label: "Удаление записей и отмена оплат", staff: false },
  { label: "Настройки: курс юаня", staff: false },
  { label: "Сотрудники и журнал действий", staff: false },
];

function RolesPanel() {
  return (
    <aside className="sf-roles sf-rise" style={{ ["--i" as string]: 2 }}>
      <div style={css("display:flex;align-items:center;gap:11px")}>
        <span style={css("width:36px;height:36px;border-radius:12px;flex:none;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#A78BFA,#6A8BFF)")}>
          <Icon name="staff" size={18} />
        </span>
        <span style={css("min-width:0")}>
          <span style={css("display:block;font-size:15px;font-weight:500;color:var(--text)")}>Роли и права</span>
          <span style={css("display:block;font-size:12.5px;color:var(--text-4)")}>кто что может в панели</span>
        </span>
      </div>
      <div className="sf-matrix">
        <span />
        {(["staff", "admin"] as const).map((k) => (
          <span key={k} className="sf-col-head" style={{ color: ROLE[k].fg, background: ROLE[k].bg }}>
            {ROLE[k].short}
          </span>
        ))}
        {RIGHTS.map((r) => (
          <Right key={r.label} label={r.label} staff={r.staff} />
        ))}
      </div>
      <div style={css("margin-top:14px;padding:11px 13px;border-radius:12px;background:var(--surface-2);border:1px dashed var(--border-2);font-size:12.5px;color:var(--text-3);line-height:1.5")}>
        Отключённый сотрудник не может войти, но всё, что он сделал, остаётся в журнале.
      </div>
    </aside>
  );
}

function Right({ label, staff }: { label: string; staff: boolean }) {
  const mark = (ok: boolean) => (
    <span className="sf-cell">
      {ok ? (
        <span style={css("width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:#fff;background:var(--green-dot)")}>
          <Svg paths={I_CHECK} size={12} sw={3} />
        </span>
      ) : (
        <span style={css("width:22px;height:22px;border-radius:50%;border:1.5px dashed var(--border-strong)")} />
      )}
    </span>
  );
  return (
    <>
      <span className="sf-cell sf-cell-label">{label}</span>
      {mark(staff)}
      {mark(true)}
    </>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
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
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    if (!user && !login.trim()) return setError("Укажите логин");
    if ((!user || password) && password.length < 6) return setError("Пароль — минимум 6 символов");
    try {
      if (user) {
        await updateUser(user.id, { full_name: fullName, role, ...(password ? { password } : {}) });
        onSaved(`Сотрудник ${user.login} сохранён`);
      } else {
        await createUser({ login: login.trim(), full_name: fullName, role, password });
        onSaved(`Сотрудник ${login.trim()} создан`);
      }
    } catch (e) {
      setError(apiError(e));
    }
  }

  return (
    <ModalShell
      title={user ? `Сотрудник ${user.login}` : "Новый сотрудник"}
      icon={<Icon name="staff" size={16} />}
      onClose={onClose}
      width={480}
      footer={
        <>
          <HButton onClick={onClose} s={btnGhost} hover="background:var(--hover)">
            Отмена
          </HButton>
          <HButton onClick={save} s={btnPrimary} hover="background:var(--accent-hover)">
            {user ? "Сохранить" : "Создать"}
          </HButton>
        </>
      }
    >
      <div style={css("padding:18px;display:flex;flex-direction:column;gap:14px")} onKeyDown={(e) => e.key === "Enter" && save()}>
        <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:12px")}>
          <label>
            <FieldLabel>Логин</FieldLabel>
            <input
              value={login}
              disabled={!!user}
              autoFocus={!user}
              autoCapitalize="off"
              spellCheck={false}
              placeholder="например, aibek"
              onChange={(e) => setLogin(e.target.value)}
              style={mix(inputStyle, user ? { opacity: 0.6 } : {})}
            />
          </label>
          <label>
            <FieldLabel>Имя</FieldLabel>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Айбек Асанов" style={css(inputStyle)} />
          </label>
        </div>

        <div>
          <FieldLabel>Роль</FieldLabel>
          <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px")}>
            {(["staff", "admin"] as const).map((k) => {
              const on = role === k;
              const r = ROLE[k];
              const locked = self && k === "staff";
              return (
                <button
                  key={k}
                  type="button"
                  disabled={locked}
                  title={locked ? "Нельзя снять с себя роль администратора" : undefined}
                  onClick={() => setRole(k)}
                  style={mix("text-align:left;padding:10px 12px;border-radius:10px;background:var(--surface);transition:border-color .12s,box-shadow .12s", {
                    border: `1px solid ${on ? r.dot : "var(--border-strong)"}`,
                    boxShadow: on ? `0 0 0 3px ${r.bg}` : "none",
                    cursor: locked ? "not-allowed" : "pointer",
                    opacity: locked ? 0.5 : 1,
                  })}
                >
                  <span style={css("display:flex;align-items:center;gap:7px;font-size:13px;font-weight:500")}>
                    <span style={mix("width:9px;height:9px;border-radius:50%", { background: on ? r.dot : "var(--text-5)" })} />
                    {r.label}
                  </span>
                  <span style={css("display:block;margin-top:3px;font-size:11.5px;color:var(--text-3)")}>
                    {k === "admin" ? "все права, сотрудники, импорт" : "заказы, приём, выдача, оплаты"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <label>
          <FieldLabel>
            Пароль {user && <span style={css("color:var(--text-5);font-weight:400")}>— оставьте пустым, чтобы не менять</span>}
          </FieldLabel>
          <div style={css("position:relative")}>
            <input
              type={showPw ? "text" : "password"}
              value={password}
              autoComplete="new-password"
              placeholder="минимум 6 символов"
              onChange={(e) => setPassword(e.target.value)}
              style={css(inputStyle + ";padding-right:40px")}
            />
            <HButton
              onClick={() => setShowPw(!showPw)}
              title={showPw ? "Скрыть пароль" : "Показать пароль"}
              s="position:absolute;right:4px;top:50%;transform:translateY(-50%);width:30px;height:28px;border:none;border-radius:6px;background:transparent;color:var(--text-4);cursor:pointer;display:flex;align-items:center;justify-content:center"
              hover="color:var(--text)"
            >
              <Svg paths={showPw ? I_EYE_OFF : I_EYE} size={16} />
            </HButton>
          </div>
        </label>
        <ModalError text={error} />
      </div>
    </ModalShell>
  );
}
