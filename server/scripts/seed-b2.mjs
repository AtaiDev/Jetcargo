/**
 * Загрузить текущую локальную базу в Backblaze B2 как первоначальную для облака.
 *
 *   B2_KEY_ID=... B2_APP_KEY=... B2_BUCKET=... node scripts/seed-b2.mjs
 *
 * Берётся согласованный снимок (VACUUM INTO), локальная база не меняется.
 * Облачный сервер возьмёт этот файл только при самом первом старте, пока
 * копии Litestream ещё нет; дальше seed не используется.
 */
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SEED_NAME, authorize, env, upload } from "./b2.mjs";

const src = path.resolve(import.meta.dirname, "..", process.env.DATA_DIR || "data", "app.db");
const snap = path.join(tmpdir(), `jetcargo-seed-${Date.now()}.db`);

const db = new DatabaseSync(src, { readOnly: true });
// Тестовая база (локальная, вымышленные данные) в облако не попадает никогда: она заменила бы рабочие данные.
let isTest = false;
try {
  isTest = db.prepare("SELECT value FROM app_settings WHERE key = 'environment'").get()?.value === "test";
} catch {
  // нет таблицы настроек — не тестовая метка
}
if (isTest) {
  db.close();
  console.error(`✗ ${src} — ТЕСТОВАЯ база, в облако её загружать нельзя.`);
  process.exit(1);
}
db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
db.close();

const data = readFileSync(snap);
rmSync(snap);
const auth = await authorize();
await upload(auth, env("B2_BUCKET"), SEED_NAME, data);
console.log(`Загружено ${(data.length / 1024).toFixed(0)} КБ → ${env("B2_BUCKET")}/${SEED_NAME}`);
console.log(`B2_ENDPOINT для Render: ${auth.s3ApiUrl}`);
