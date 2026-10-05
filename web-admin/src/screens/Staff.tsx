/** Сотрудники: список, создание, смена роли, блокировка. Только администратор. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiError } from "../api/client";
import { createUser, listUsers, updateUser, type User } from "../api/domain";
import { useAuth } from "../auth/AuthContext";
import { Empty } from "../components/cargo";
import CountUp from "../design/CountUp";
import { css, mix } from "../design/css";
import { I_EYE, I_EYE_OFF, Icon, Svg } from "../design/icons";
import { MONO, PANEL, Page, PrimaryAction, SearchInput } from "../design/table";
import { FieldLabel, HButton, ModalError, ModalShell, SkeletonRows, btnGhost, btnPrimary, inputStyle } from "../design/ui";
import { date } from "../lib/cargo";

type Toast = (k: "success" | "error", t: string) => void;
type Filter = "all" | "active" | "off";

const ROLE = {
  admin: { label: "Администратор", fg: "var(--violet)", bg: "var(--violet-tint)", dot: "var(--violet-dot)" },
  staff: { label: "Сотрудник склада", fg: "var(--accent-strong)", bg: "var(--accent-tint)", dot: "var(--accent)" },
} as const;

export default function Staff({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
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
  }, []);

  async function toggleActive(u: User) {
    try {
      await updateUser(u.id, { is_active: !u.is_active });
      await reload();
      toast("success", u.is_active ? `${u.login} отключён — войти больше не сможет` : `${u.login} снова может входить`);
    } catch (e) {
      toast("error", apiError(e));
    }
  }

  const list = rows ?? [];
  const stats = {
    total: list.length,
    active: list.filter((u) => u.is_active).length,
    admins: list.filter((u) => u.role === "admin").length,
    staff: list.filter((u) => u.role === "staff").length,
  };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter(
      (u) =>
        (filter === "all" || (filter === "active" ? u.is_active : !u.is_active)) &&
        (!q || u.login.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q))
    );
  }, [list, filter, query]);

  return (
    <Page size="wide">
      {/* Итоги */}
      <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;margin-bottom:14px")}>
        <Tile icon={<Icon name="staff" size={17} />} tone={["var(--hover)", "var(--text-2)"]} label="Всего сотрудников" value={stats.total} />
        <Tile icon={<Dot color="var(--green-dot)" />} tone={["var(--green-tint)", "var(--green)"]} label="Активны" value={stats.active} hint={stats.total - stats.active ? `отключено ${stats.total - stats.active}` : "все могут входить"} />
        <Tile icon={<Dot color={ROLE.admin.dot} />} tone={[ROLE.admin.bg, ROLE.admin.fg]} label="Администраторы" value={stats.admins} hint="все права" />
        <Tile icon={<Dot color={ROLE.staff.dot} />} tone={[ROLE.staff.bg, ROLE.staff.fg]} label="Сотрудники склада" value={stats.staff} hint="приём и выдача" />
      </div>

      {/* Панель */}
      <div style={css("display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px")}>
        <div style={css("display:inline-flex;gap:3px;padding:3px;border-radius:9px;background:var(--border-2)")}>
          {(
            [
              ["all", "Все", stats.total],
              ["active", "Активные", stats.active],
              ["off", "Отключённые", stats.total - stats.active],
            ] as const
          ).map(([k, l, n]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                style={mix("height:30px;padding:0 12px;border:none;border-radius:7px;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:6px", {
                  background: on ? "var(--surface)" : "transparent",
                  color: on ? "var(--text)" : "var(--text-2)",
                  fontWeight: on ? 600 : 500,
                  boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none",
                })}
              >
                {l}
                <span style={css(MONO + ";font-size:11px;color:var(--text-4)")}>{n}</span>
              </button>
            );
          })}
        </div>
        <div style={css("flex:1")} />
        <SearchInput value={query} onChange={setQuery} placeholder="Логин или имя…" width={240} />
        <PrimaryAction onClick={() => setEditing("new")}>Новый сотрудник</PrimaryAction>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "minmax(0,1fr) 320px" : "1fr", gap: 14, alignItems: "start" }}>
        {/* Карточки */}
        {!rows ? (
          <SkeletonRows rows={3} />
        ) : shown.length === 0 ? (
          <div style={css(PANEL)}>
            <Empty
              icon="staff"
              title={list.length ? "Никого не найдено" : "Сотрудников пока нет"}
              text={list.length ? "Измените фильтр или поиск" : "Добавьте сотрудника склада — он сможет принимать и выдавать товар"}
            />
          </div>
        ) : (
          <div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px")}>
            {shown.map((u) => (
              <UserCard key={u.id} u={u} self={u.id === me?.id} onEdit={() => setEditing(u)} onToggle={() => toggleActive(u)} />
            ))}
          </div>
        )}

        {/* Роли и права */}
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

// --- Плитки и карточки --------------------------------------------------------------------

function Dot({ color }: { color: string }) {
  return <span style={mix("width:9px;height:9px;border-radius:50%", { background: color })} />;
}

function Tile({ icon, tone, label, value, hint }: { icon: ReactNode; tone: [string, string]; label: string; value: number; hint?: string }) {
  return (
    <div style={css(PANEL + ";display:flex;align-items:center;gap:12px;padding:12px 14px")}>
      <span style={mix("width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none", { background: tone[0], color: tone[1] })}>{icon}</span>
      <div style={css("min-width:0")}>
        <div style={css("font-size:11.5px;font-weight:500;color:var(--text-3)")}>{label}</div>
        <div style={css("display:flex;align-items:baseline;gap:8px")}>
          <span style={css(MONO + ";font-size:21px;font-weight:600")}>
            <CountUp text={String(value)} />
          </span>
          {hint && <span style={css("font-size:11.5px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{hint}</span>}
        </div>
      </div>
    </div>
  );
}

function initials(u: User) {
  const src = (u.full_name || u.login).trim();
  return src.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
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

function UserCard({ u, self, onEdit, onToggle }: { u: User; self: boolean; onEdit: () => void; onToggle: () => void }) {
  const r = ROLE[u.role];
  return (
    <div style={mix(PANEL + ";display:flex;flex-direction:column;transition:opacity .15s", { opacity: u.is_active ? 1 : 0.72 })}>
      {/* Кто */}
      <div style={css("display:flex;align-items:center;gap:12px;padding:14px 16px")}>
        <span
          style={mix("width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex:none", {
            background: u.is_active ? r.bg : "var(--muted-bg)",
            color: u.is_active ? r.fg : "var(--text-4)",
          })}
        >
          {initials(u)}
        </span>
        <div style={css("min-width:0;flex:1")}>
          <div style={css("display:flex;align-items:center;gap:6px;min-width:0")}>
            <span style={css("font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{u.full_name || u.login}</span>
            {self && <span style={css("flex:none;font-size:10.5px;font-weight:600;padding:1px 7px;border-radius:6px;background:var(--accent-tint);color:var(--accent-strong)")}>это вы</span>}
          </div>
          <div style={css(MONO + ";font-size:12px;color:var(--text-3);margin-top:1px")}>@{u.login}</div>
        </div>
        <span style={mix("flex:none;font-size:11px;font-weight:600;padding:3px 9px;border-radius:7px;white-space:nowrap", { background: r.bg, color: r.fg })}>
          {r.label}
        </span>
      </div>

      {/* Сколько сделал */}
      <div style={css("display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--border-2);border-bottom:1px solid var(--border-2)")}>
        <Metric label="Действий" value={u.actions ?? 0} />
        <Metric label="Сканов" value={u.scans ?? 0} divider />
        <Metric label="Выдач" value={u.issues ?? 0} divider />
      </div>

      <div style={css("display:flex;flex-direction:column;gap:4px;padding:10px 16px;font-size:12px;color:var(--text-3)")}>
        <span>
          Активность: <b style={css("font-weight:600;color:var(--text-2)")}>{ago(u.last_active_at)}</b>
        </span>
        {u.created_at && <span>В системе с {date(u.created_at.slice(0, 10))}</span>}
      </div>

      {/* Действия */}
      <div style={css("margin-top:auto;display:flex;align-items:center;gap:10px;padding:10px 16px 14px")}>
        <Switch on={u.is_active} disabled={self} onChange={onToggle} title={self ? "Нельзя отключить собственную учётную запись" : u.is_active ? "Отключить вход" : "Разрешить вход"} />
        <span style={mix("font-size:12.5px;font-weight:600", { color: u.is_active ? "var(--green)" : "var(--text-4)" })}>{u.is_active ? "Активен" : "Отключён"}</span>
        <div style={css("flex:1")} />
        <HButton onClick={onEdit} s={btnGhost + ";height:32px;padding:0 14px;font-size:12.5px"} hover="border-color:var(--accent);color:var(--accent)">
          Изменить
        </HButton>
      </div>
    </div>
  );
}

function Metric({ label, value, divider }: { label: string; value: number; divider?: boolean }) {
  return (
    <div style={mix("padding:9px 16px", divider ? { borderLeft: "1px solid var(--border-2)" } : {})}>
      <div style={css("font-size:11px;color:var(--text-4)")}>{label}</div>
      <div style={mix(MONO + ";font-size:16px;font-weight:600", { color: value ? "var(--text)" : "var(--text-5)" })}>
        <CountUp text={String(value)} />
      </div>
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
      style={mix("position:relative;width:38px;height:22px;border:none;border-radius:11px;padding:0;transition:background .15s;flex:none", {
        background: on ? "var(--green-dot)" : "var(--border-strong)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      })}
    >
      <span
        style={mix("position:absolute;top:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s", {
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
  { label: "Настройки: курсы валют, блоки обзора", staff: false },
  { label: "Сотрудники и журнал действий", staff: false },
];

function RolesPanel() {
  return (
    <div style={css(PANEL + ";padding:16px")}>
      <div style={css("font-size:14px;font-weight:700;margin-bottom:12px")}>Роли и права</div>
      <div style={css("display:grid;grid-template-columns:minmax(0,1fr) 44px 44px;gap:0;font-size:12.5px")}>
        <span />
        <span title={ROLE.staff.label} style={mix("text-align:center;font-size:10.5px;font-weight:700", { color: ROLE.staff.fg })}>
          склад
        </span>
        <span title={ROLE.admin.label} style={mix("text-align:center;font-size:10.5px;font-weight:700", { color: ROLE.admin.fg })}>
          админ
        </span>
        {RIGHTS.map((r) => (
          <Right key={r.label} label={r.label} staff={r.staff} />
        ))}
      </div>
      <div style={css("margin-top:14px;padding:10px 12px;border-radius:9px;background:var(--surface-2);font-size:12px;color:var(--text-3);line-height:1.5")}>
        Отключённый сотрудник не может войти, но всё, что он сделал, остаётся в журнале.
      </div>
    </div>
  );
}

function Right({ label, staff }: { label: string; staff: boolean }) {
  const mark = (ok: boolean) => (
    <span style={css("display:flex;justify-content:center;align-items:center;border-top:1px solid var(--border-2);padding:8px 0")}>
      <span
        style={mix("width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700", {
          background: ok ? "var(--green-tint)" : "var(--hover)",
          color: ok ? "var(--green)" : "var(--text-5)",
        })}
      >
        {ok ? "✓" : "—"}
      </span>
    </span>
  );
  return (
    <>
      <span style={css("border-top:1px solid var(--border-2);padding:8px 0;color:var(--text-2)")}>{label}</span>
      {mark(staff)}
      {mark(true)}
    </>
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
              style={mix(inputStyle + ";" + MONO, user ? { opacity: 0.6 } : {})}
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
                  <span style={css("display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600")}>
                    <Dot color={on ? r.dot : "var(--text-5)"} />
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
