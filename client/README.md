# client

《棒球人生模擬器》的前端與模擬引擎。`npm run build` 產出的靜態檔由 `server/` 那個
服務一起送出去（同源，所以 session 走 HttpOnly cookie）。部署見專案根目錄的
`./deploy.sh`、`compose.yaml` 與 [ADR 0038](../docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)。

開發指令與目錄說明見專案根目錄的 `DEVELOPER.md`。
