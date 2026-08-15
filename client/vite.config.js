import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

/**
 * 資源的根路徑。
 *
 * 桌面版與本機開發都是從根目錄提供檔案，因此預設 '/'。GitHub Pages 的專案頁面
 * 掛在 `https://<帳號>.github.io/<repo>/` 底下，資源必須帶著那一層前綴，否則
 * 產物會去 `/assets/...` 找而整頁空白——**那是上 Pages 最常見的第一個坑**。
 *
 * 用環境變數而不是寫死：同一份設定要同時服務 `tauri build` 與網頁部署，寫死
 * 任何一邊都會弄壞另一邊。工作流會設 `PAGES_BASE=/CDY_YAKYULIFE/`。
 */
const base = process.env.PAGES_BASE ?? "/";

// https://vite.dev/config/
export default defineConfig(async () => ({
  base,
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    /**
     * 把 /api 轉給本機的伺服器。
     *
     * 沒有它，dev server 會把 /api/* 交給單頁應用的 fallback 回一份 index.html，
     * 前端就判定成「這個部署沒有帳號功能」，右上角的登入與成就整排反灰。
     *
     * 伺服器要自己另外開（`cd server && npm run dev`）。沒開也不會壞，只是照樣
     * 走離線那條路。
     */
    proxy: {
      "/api": {
        target: process.env.API_ORIGIN ?? "http://localhost:8099",
        changeOrigin: false,
      },
    },
  },
}));
