/**
 * Первый старт в облаке: скачать первоначальную базу из B2 (её загружает seed-b2.mjs).
 * Вызывается из docker-entrypoint.sh, только если копии Litestream ещё нет.
 *   node scripts/restore-seed.mjs /data/app.db
 */
import { writeFileSync } from "node:fs";

import { SEED_NAME, authorize, download, env } from "./b2.mjs";

const target = process.argv[2];
const auth = await authorize();
const data = await download(auth, env("B2_BUCKET"), SEED_NAME);
if (!data) {
  console.log("Первичной базы в B2 нет");
  process.exit(1);
}
writeFileSync(target, data);
console.log(`Первичная база восстановлена: ${(data.length / 1024).toFixed(0)} КБ`);
