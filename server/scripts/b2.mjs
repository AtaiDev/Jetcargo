/**
 * Минимальный клиент нативного API Backblaze B2 (без зависимостей):
 * вход, загрузка и скачивание одного файла. Нужен для первичной базы —
 * дальше копии базы ведёт Litestream.
 */
import { createHash } from "node:crypto";

export const SEED_NAME = "jetcargo/seed/app.db";

export function env(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Не задана переменная ${name}`);
  return v;
}

export async function authorize() {
  const basic = Buffer.from(`${env("B2_KEY_ID")}:${env("B2_APP_KEY")}`).toString("base64");
  const r = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", { headers: { Authorization: `Basic ${basic}` } });
  if (!r.ok) throw new Error(`B2: вход не удался (${r.status}) — проверьте keyID и applicationKey`);
  const j = await r.json();
  const s = j.apiInfo.storageApi;
  return { accountId: j.accountId, token: j.authorizationToken, apiUrl: s.apiUrl, downloadUrl: s.downloadUrl, s3ApiUrl: s.s3ApiUrl };
}

async function call(auth, method, body) {
  const r = await fetch(`${auth.apiUrl}/b2api/v3/${method}`, { method: "POST", headers: { Authorization: auth.token }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`B2 ${method}: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function upload(auth, bucketName, fileName, data) {
  const { buckets } = await call(auth, "b2_list_buckets", { accountId: auth.accountId, bucketName });
  if (!buckets?.length) throw new Error(`B2: бакет ${bucketName} не найден`);
  const up = await call(auth, "b2_get_upload_url", { bucketId: buckets[0].bucketId });
  const r = await fetch(up.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: up.authorizationToken,
      "X-Bz-File-Name": encodeURIComponent(fileName),
      "Content-Type": "application/octet-stream",
      "X-Bz-Content-Sha1": createHash("sha1").update(data).digest("hex"),
    },
    body: data,
  });
  if (!r.ok) throw new Error(`B2: загрузка не удалась (${r.status}) ${await r.text()}`);
}

/** Скачать файл; null — если его нет. */
export async function download(auth, bucketName, fileName) {
  const r = await fetch(`${auth.downloadUrl}/file/${bucketName}/${fileName}`, { headers: { Authorization: auth.token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`B2: скачивание не удалось (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}
