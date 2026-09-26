import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(async () => ({
  // 資源掛在根目錄。同源部署（前端與 API 是同一個服務）沒有子路徑前綴的問題，
  // 而需要前綴的那個場景——GitHub Pages 的專案頁面——已經隨桌面端一起移到
  // `legacy` 分支上了。
  base: "/",
  plugins: [react()],

  /**
   * 元件的樣式是 CSS Modules（`*.module.css`），在 JSX 裡寫成 `styles.tagRow`。
   * 只有主題 token 與引擎寫進 HTML 的 class 留在全域（`src/ui/global.css`，見
   * ADR 0055）。
   */
  css: { modules: { localsConvention: "camelCaseOnly" } },

  server: {
    /**
     * **連接埠固定為 1420，被佔用時直接失敗。**
     *
     * 原本是 Tauri 的 `devUrl` 寫死指向它，那一半已經不在了；現在留著的理由是
     * 底下的 `/api` 代理——Vite 安靜換一個埠的話代理設定就對不上，而那個症狀
     * 看起來像「登入壞掉」而不是「開發伺服器換埠了」。
     */
    port: 1420,
    strictPort: true,

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
