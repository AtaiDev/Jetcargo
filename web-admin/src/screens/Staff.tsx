/** Сотрудники: список, создание, смена роли, блокировка. Только администратор. */
import { useEffect, useState } from "react";
import { apiError } from "../api/client";
import { createUser, listUsers, updateUser, type User } from "../api/domain";
import Select from "../components/Select";
import { css, mix } from "../design/css";
import { Icon } from "../design/icons";
import { MONO, PANEL, Page, PrimaryAction, THEAD, TROW, Toolbar } from "../design/table";
import {
  FieldLabel,
  HButton,
  ModalError,
  ModalShell,
  btnGhost,
  btnPrimary,
  inputStyle,
} from "../design/ui";

const GRID = "60px 1.4fr 1.6fr 1.2fr 1fr 90px";

export default function Staff({
  toast,
}: {
  isDesktop: boolean;
  toast: (k: "success" | "error", t: string) => void;
}) {
  const [rows, setRows] = useState<User[]>([]);
  const [editing, setEditing] = useState<User | "new" | null>(null);

  const reload = () => listUsers().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    reload();
  }, []);

  async function toggleActive(u: User) {
    try {
      await updateUser(u.id, { is_active: !u.is_active });
      await reload();
      toast("success", u.is_active ? `${u.login} отключён` : `${u.login} включён`);
    } catch (e) {
      toast("error", apiError(e));
    }
  }

  return (
    <Page>
      <Toolbar
        actions={<PrimaryAction onClick={() => setEditing("new")}>Новый сотрудник</PrimaryAction>}
      />

      <div
        style={css(PANEL)}
      >
        <div
          style={mix(
            THEAD,
            { gridTemplateColumns: GRID }
          )}
        >
          <div style={css("padding:9px 14px")}>ID</div>
          <div style={css("padding:9px 14px")}>Логин</div>
          <div style={css("padding:9px 14px")}>ФИО</div>
          <div style={css("padding:9px 14px")}>Роль</div>
          <div style={css("padding:9px 14px")}>Статус</div>
          <div style={css("padding:9px 14px")} />
        </div>

        {rows.map((u) => (
          <div
            key={u.id}
            style={mix(TROW, {
              gridTemplateColumns: GRID,
            })}
          >
            <div style={css("padding:10px 14px;" + MONO + ";font-size:12.5px;color:var(--text-3)")}>
              {u.id}
            </div>
            <div style={css("padding:10px 14px;font-weight:600;font-size:13px;" + MONO)}>
              {u.login}
            </div>
            <div style={css("padding:10px 14px;font-size:12.5px;color:var(--text-2)")}>
              {u.full_name || "—"}
            </div>
            <div style={css("padding:10px 14px")}>
              <span
                style={mix(
                  "display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:20px",
                  u.role === "admin"
                    ? { color: "var(--violet)", background: "var(--violet-tint)" }
                    : { color: "var(--text-2)", background: "var(--muted-bg)" }
                )}
              >
                {u.role === "admin" ? "Администратор" : "Сотрудник"}
              </span>
            </div>
            <div style={css("padding:10px 14px")}>
              <HButton
                onClick={() => toggleActive(u)}
                s={mix(
                  "display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:20px;border:none;cursor:pointer",
                  u.is_active
                    ? { color: "var(--green)", background: "var(--green-tint)" }
                    : { color: "var(--muted-fg)", background: "var(--muted-bg2)" }
                )}
              >
                <span
                  style={mix("width:6px;height:6px;border-radius:50%", {
                    background: u.is_active ? "var(--green-dot)" : "var(--muted-dot)",
                  })}
                />
                {u.is_active ? "активен" : "отключён"}
              </HButton>
            </div>
            <div style={css("padding:7px 12px;display:flex;justify-content:flex-end")}>
              <HButton
                onClick={() => setEditing(u)}
                s="width:26px;height:26px;border:1px solid var(--border);background:var(--surface);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--text-2);font-size:12px"
                hover="border-color:var(--accent);color:var(--accent)"
              >
                ✎
              </HButton>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <StaffForm
          user={editing === "new" ? null : editing}
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

function StaffForm({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [login, setLogin] = useState(user?.login ?? "");
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [role, setRole] = useState(user?.role ?? "staff");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setError("");
    if (!user && (!login.trim() || password.length < 4))
      return setError("Укажите логин и пароль (минимум 4 символа)");
    try {
      if (user) {
        await updateUser(user.id, {
          full_name: fullName,
          role,
          ...(password ? { password } : {}),
        });
        onSaved(`Сотрудник ${user.login} сохранён`);
      } else {
        await createUser({ login, full_name: fullName, role, password });
        onSaved(`Сотрудник ${login} создан`);
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
      width={460}
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
      <div style={css("padding:18px;display:flex;flex-direction:column;gap:14px")}>
        <label>
          <FieldLabel>Логин</FieldLabel>
          <input
            value={login}
            disabled={!!user}
            onChange={(e) => setLogin(e.target.value)}
            style={mix(inputStyle + ";" + MONO, user ? { opacity: 0.6 } : {})}
          />
        </label>
        <label>
          <FieldLabel>ФИО</FieldLabel>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={css(inputStyle)}
          />
        </label>
        <label>
          <FieldLabel>Роль</FieldLabel>
          <Select<"admin" | "staff">
            value={role}
            onChange={setRole}
            ariaLabel="Роль"
            options={[
              { value: "staff", label: "Сотрудник склада", hint: "приём и выдача" },
              { value: "admin", label: "Администратор", hint: "все права" },
            ]}
          />
        </label>
        <label>
          <FieldLabel>
            Пароль{" "}
            {user && <span style={css("color:var(--text-5);font-weight:400")}>— оставьте пустым, чтобы не менять</span>}
          </FieldLabel>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={css(inputStyle)}
          />
        </label>
        <ModalError text={error} />
      </div>
    </ModalShell>
  );
}
