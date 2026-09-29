import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Админка отдаётся под суб-путём /admin (base влияет и на dev-сервер, поэтому
// в main.tsx у BrowserRouter стоит basename="/admin"). Меняете путь — меняйте в обоих местах.
export default defineConfig({
  base: "/admin/",
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
