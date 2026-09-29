import { api, setTokens } from "./client";

export interface CurrentUser {
  id: number;
  login: string;
  full_name: string;
  role: "admin" | "staff";
  is_active: boolean;
}

// Логин через OAuth2 password flow (form-urlencoded: username/password).
export async function login(login_: string, password: string): Promise<void> {
  const form = new URLSearchParams();
  form.append("username", login_);
  form.append("password", password);
  const { data } = await api.post("/auth/login", form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  setTokens(data.access_token, data.refresh_token);
}

export async function fetchMe(): Promise<CurrentUser> {
  const { data } = await api.get<CurrentUser>("/auth/me");
  return data;
}
