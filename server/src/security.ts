/** Пароли (scrypt с солью) и JWT-токены (HS256). */
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import { ACCESS_TTL, JWT_SECRET, REFRESH_TTL } from "./config";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

type TokenType = "access" | "refresh";

export function issueTokens(userId: number) {
  const sign = (typ: TokenType, expiresIn: string) =>
    jwt.sign({ typ }, JWT_SECRET, {
      subject: String(userId),
      expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
      algorithm: "HS256",
    });
  return {
    access_token: sign("access", ACCESS_TTL),
    refresh_token: sign("refresh", REFRESH_TTL),
    token_type: "bearer",
  };
}

/** id пользователя из токена нужного типа, либо null (подпись/срок/тип не те). */
export function readToken(token: string, typ: TokenType): number | null {
  try {
    const p = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    return p.typ === typ && p.sub ? Number(p.sub) : null;
  } catch {
    return null;
  }
}
