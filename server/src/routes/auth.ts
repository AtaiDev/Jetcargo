/** Вход, обновление токена, текущий пользователь и управление сотрудниками. */
import { Router } from "express";

import { all, get, run } from "../db";
import { audit, requireAdmin, requireAuth, userById } from "../domain";
import { hashPassword, issueTokens, readToken, verifyPassword } from "../security";
import { HttpError, badRequest, conflict, normText, notFound, str } from "../util";

export const authRouter = Router();

// Защита от подбора: не больше 10 неудачных попыток за 15 минут на логин.
const failures = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60 * 1000;

authRouter.post("/auth/login", (req, res) => {
  const login = str(req.body?.username, 100);
  const password = String(req.body?.password ?? "");
  const key = login.toLowerCase();
  const f = failures.get(key);
  if (f && f.count >= 10 && f.until > Date.now()) {
    throw new HttpError(429, "Слишком много попыток входа, попробуйте через 15 минут");
  }

  const u = get<{ id: number; password_hash: string; is_active: number }>(
    "SELECT id, password_hash, is_active FROM users WHERE login = ?",
    login
  );
  if (!u || !u.is_active || !verifyPassword(password, u.password_hash)) {
    const cur = f && f.until > Date.now() ? f : { count: 0, until: Date.now() + WINDOW_MS };
    failures.set(key, { count: cur.count + 1, until: cur.until });
    throw new HttpError(401, "Неверный логин или пароль");
  }
  failures.delete(key);
  res.json(issueTokens(u.id));
});

authRouter.post("/auth/refresh", (req, res) => {
  const id = readToken(String(req.body?.refresh_token ?? ""), "refresh");
  const user = id !== null ? userById(id) : undefined;
  if (!user?.is_active) throw new HttpError(401, "Сессия истекла, войдите заново");
  res.json(issueTokens(user.id));
});

authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});

// --- Сотрудники (только администратор) ----------------------------------------

const USER_COLS = "id, login, full_name, role, is_active";
const toUser = (u: Record<string, unknown>) => ({ ...u, is_active: !!u.is_active });

function role(v: unknown): "admin" | "staff" {
  if (v !== "admin" && v !== "staff") throw badRequest("Роль должна быть admin или staff");
  return v;
}

function password(v: unknown): string {
  const p = String(v ?? "");
  if (p.length < 6) throw badRequest("Пароль должен быть не короче 6 символов");
  return p;
}

authRouter.get("/users", requireAuth, (req, res) => {
  requireAdmin(req);
  res.json(all(`SELECT ${USER_COLS} FROM users ORDER BY id`).map(toUser));
});

authRouter.post("/users", requireAuth, (req, res) => {
  requireAdmin(req);
  const b = req.body ?? {};
  const login = str(b.login, 100);
  if (!/^[\p{L}\d._-]{2,100}$/u.test(login)) throw badRequest("Логин: от 2 символов, буквы, цифры, . _ -");
  const taken = all<{ login: string }>("SELECT login FROM users").some((u) => normText(u.login) === normText(login));
  if (taken) throw conflict("Такой логин уже есть");
  const id = run(
    "INSERT INTO users (login, full_name, role, is_active, password_hash) VALUES (?, ?, ?, ?, ?)",
    login, str(b.full_name, 200), role(b.role ?? "staff"), b.is_active === false ? 0 : 1, hashPassword(password(b.password))
  );
  audit(req, "create", "user", id, null, login);
  res.json(toUser(get(`SELECT ${USER_COLS} FROM users WHERE id = ?`, id)!));
});

authRouter.patch("/users/:id", requireAuth, (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  const u = userById(id);
  if (!u) throw notFound("Пользователь");
  const b = req.body ?? {};
  const self = id === req.user!.id;
  if (self && b.is_active === false) throw conflict("Нельзя отключить собственную учётную запись");
  if (self && b.role !== undefined && b.role !== "admin") throw conflict("Нельзя снять с себя роль администратора");

  const changes: string[] = [];
  if (b.full_name !== undefined) {
    run("UPDATE users SET full_name = ? WHERE id = ?", str(b.full_name, 200), id);
    changes.push("full_name");
  }
  if (b.role !== undefined) {
    run("UPDATE users SET role = ? WHERE id = ?", role(b.role), id);
    changes.push("role");
  }
  if (b.is_active !== undefined) {
    run("UPDATE users SET is_active = ? WHERE id = ?", b.is_active ? 1 : 0, id);
    changes.push("is_active");
  }
  if (b.password) {
    run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password(b.password)), id);
    changes.push("password");
  }
  audit(req, "update", "user", id, null, changes.join(", "));
  res.json(userById(id));
});
