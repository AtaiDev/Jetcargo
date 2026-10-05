/**
 * Запуск всего проекта одной командой: `npm run dev` в корне.
 * Поднимает backend (server/) на ТЕСТОВОЙ базе и админку (web-admin/); Ctrl+C останавливает оба.
 * Рабочие данные (Render + B2) отсюда недоступны: база — только server/data-test,
 * админка ходит только на локальный сервер.
 * Если зависимости ещё не установлены — сначала ставит их.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const apps = [
  { name: "server", dir: path.join(root, "server") },
  { name: "web-admin", dir: path.join(root, "web-admin") },
];

if (!fs.existsSync(path.join(root, "server", ".env"))) {
  console.error("Нет server/.env — скопируйте server/.env.example в server/.env и заполните.");
  process.exit(1);
}

for (const app of apps) {
  if (!fs.existsSync(path.join(app.dir, "node_modules"))) {
    console.log(`[${app.name}] устанавливаю зависимости…`);
    const r = spawnSync("npm", ["install"], { cwd: app.dir, stdio: "inherit", shell: true });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

// Строго тестовая среда — независимо от того, что написано в .env-файлах:
// переменные процесса главнее --env-file (server) и .env (Vite).
const env = { ...process.env, NODE_ENV: "development", DATA_DIR: "data-test", VITE_API_URL: "http://127.0.0.1:8787/api/v1" };
delete env.RENDER;
delete env.PUBLIC_HOSTS;
delete env.RENDER_EXTERNAL_HOSTNAME;

// Тестовой базы ещё нет — создаём с вымышленными данными по всем разделам.
const seed = spawnSync(
  process.execPath,
  ["--env-file=.env", "--disable-warning=ExperimentalWarning", "scripts/seed-test.mjs"],
  { cwd: path.join(root, "server"), env, stdio: "inherit" }
);
if (seed.status !== 0) process.exit(seed.status ?? 1);

const children = apps.map((app) => {
  const child = spawn("npm", ["run", "dev"], { cwd: app.dir, env, stdio: "inherit", shell: true });
  child.on("exit", (code) => {
    console.log(`[${app.name}] остановлен (код ${code})`);
    for (const c of children) if (c !== child && c.exitCode === null) c.kill();
    process.exit(code ?? 0);
  });
  return child;
});

console.log("\nПанель: http://localhost:5173/admin/   API: http://127.0.0.1:8787/api/v1   (ТЕСТОВАЯ база)");
console.log("Пересоздать тестовые данные: остановите (Ctrl+C) и выполните npm run test-data\n");
