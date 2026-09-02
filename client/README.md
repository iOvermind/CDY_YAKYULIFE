# client

《棒球人生模擬器》的前端與模擬引擎。`npm run build` 產出的靜態檔由 `server/` 那個
服務一起送出去（同源，所以 session 走 HttpOnly cookie）。部署見專案根目錄的
`./deploy.sh`、`compose.yaml` 與 [ADR 0038](../docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)。

底下是 `create-tauri-app` 留下的樣板說明。**Tauri 已轉 legacy、不再維護**，這一段
只在你要動 `src-tauri/` 時還有參考價值。

## （legacy）Tauri + React

This template should help get you started developing with Tauri and React in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
