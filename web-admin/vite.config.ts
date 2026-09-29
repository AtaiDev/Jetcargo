import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Суб-путь, под которым отдаётся админка. Локально — /admin/; для GitHub Pages
// workflow задаёт VITE_BASE=/Jetcargo/. Роутер (main.tsx) берёт путь отсюда же
// через import.meta.env.BASE_URL, так что меняется он в одном месте.
const base = process.env.VITE_BASE?.trim() || "/admin/";

export default defineConfig({
  base: base.endsWith("/") ? base : base + "/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Только этот компьютер: из локальной сети панель недоступна.
    host: "localhost",
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: "localhost",
  },
});
