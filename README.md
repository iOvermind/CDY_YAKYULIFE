# 《棒球人生模擬器》 ⚾

> 《棒球人生模擬器》是文字版的棒球生涯模擬遊戲，從高中三大賽一路打到名人堂。本專案正在重寫架構，尚無可下載的正式版本。

---

## 這是什麼

一個網頁版的純文字棒球生涯模擬遊戲。玩家從高中起步，經歷選秀，在中華職棒、日本職棒或美國大聯盟打拚，並體驗傷病、感情、國際賽徵召、引退與名人堂等各種人生階段。

**主要功能**

- 多層級聯賽：完整模擬高中、大學、業餘成棒、中職、日職與大聯盟的升降級與合約交涉。
- 隱藏屬性系統：包含天才、鐵人等 27 種隱藏特質，靠探索與刻意經營觸發。
- 人生隨機事件：感情選擇、傷病危機、公關事件與國際賽徵召，球場外的每一個決定都會影響生涯走向。
- 細緻的數據運算：依照球探量表 (20-80) 進行能力養成，並根據不同守備位置與角色定位給予專屬評價。
- 種子碼系統：同種子＋同選擇＝同一段人生，可分享重現特定棒球人生。

---

## 取得與安裝

**目前沒有正式發佈版本。** 本專案正在重寫架構，首個正式版本為 `1.0.0`，將在重寫完成後發佈。在那之前不會有 Release 頁面與安裝檔。

想先看看遊戲長什麼樣，可以取用舊版的單檔實作預覽——它是完整可玩的，但**不再更新**，也不是本專案未來的樣子。

### 系統需求（舊版預覽）

| 項目 | 需求 |
| :--- | :--- |
| 作業系統 | 不限 |
| 瀏覽器 | 任何現代瀏覽器（Chrome、Firefox、Edge、Safari） |
| 其他 | 無 |

### 取得舊版預覽

將本專案 clone 回本機，或直接下載儲存庫中的 `index_legacy.html` 檔案即可。不需要安裝任何東西。

### 線上版（帳號、成就與天賦）

帳號、成就點數與天賦需要伺服器——**成就點數是跨局累積並換成永久強化的貨幣，它一旦可以偽造，整個系統就沒有意義**，因此伺服器會用同一份引擎重跑重播日誌來驗證每一段生涯。設計見 [ADR 0007](docs/adr/0007-online-accounts-and-server-verification.md)。

clone 完直接跑，不必先讀任何文件、也不必手動填金鑰：

```bash
./deploy.sh
```

它會檢查 Docker、產生 `.env`（密碼與 session 金鑰自動生成）、建好 `./data`，起
compose 並**等到 HTTP 真的回話**才結束。第一次要在容器裡裝依賴並建置前端，會跑
好幾分鐘，中途每半分鐘回報一次進度。

```bash
./deploy.sh              # 起服務；更新就 git pull 之後再跑一次
./deploy.sh logs         # 跟著看記錄
./deploy.sh down         # 停掉，資料留著
./deploy.sh reset-db     # 清空資料庫（會先問你一次）
```

程式碼是**掛載**進容器的，不建 image——所以更新是 `git pull && ./deploy.sh`，不必
重新 build。資料在 `./data/`，備份就是複製那個資料夾。資料表在第一次啟動時自動建好
（`server/schema.sql` 每次啟動都跑，每一行都是冪等的）；DROP 不放在那裡，否則每重開
一次就清空一次玩家的帳號與 AP，要打掉重來走 `./deploy.sh reset-db`。

**對外怎麼接由你決定**——cloudflared、nginx、直接開埠都行，對它們來說這裡就是一個
HTTP 服務。預設只綁 `127.0.0.1:8080`（tunnel 跑在同一台主機時這樣就夠，而綁 0.0.0.0
等於在公網上開一個沒有 TLS 的服務）；要改就動 `.env` 的 `APP_PORT` 與 `BIND_ADDR`。

另一種跑法是把程式碼建進 image：`server/compose.yaml` 是那一份，附一個 cloudflared
服務，適合「build 一次丟上去跑」。**兩份的資料不共用**——那一份用 Docker 具名 volume，
`./deploy.sh` 這一份用 `./data`。

只要 image、部署另外處理的話，用專案根目錄的 `./build-image.sh`（建出 `cdy_yakyulife:latest`，不啟動任何東西）。執行時需要 `DATABASE_URL` 與 `SESSION_SECRET`。

一個 image 同時服務前端與 `/api`，因此**前端與伺服器端的引擎永遠是同一份建置**；同源也讓 session 可以走 HttpOnly cookie。資料庫是 PostgreSQL，對外由 Cloudflare Tunnel 接上網域。

開局畫面右上角是登入與成就。未登入時成就鈕是反灰的——成就掛在帳號上，沒有帳號就沒有東西可看。

只調介面而不想架 Postgres 時，伺服器可以跑在一個 JSON 檔上（`server/.devdata.json`，重啟後資料還在）：

```bash
cd server && npm run dev        # http://localhost:8099，預設帳號 demo / demo1234
cd client && npm run dev        # 另一個終端機；/api 會自動轉給 8099
```

要清掉測試資料重來就跑 `npm run dev:fresh`。

不架伺服器也完全玩得起來——只是沒有帳號、成就不會累積、天賦不開放。

### 網頁版（GitHub Pages）

`npm run build` 產出的是一份純靜態網站，可以直接部署到 GitHub Pages。工作流在 `.github/workflows/pages.yml`，推到 `main` 就會建置並部署。

**但那是一個沒有帳號的版本**：Pages 只送靜態檔，沒有 `/api`，所以成就不會累積、天賦不開放、天梯是空的。完整的版本是上面那套 `docker compose`（見 [ADR 0038](docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)）——Pages 適合拿來給人試玩，不適合當正式部署。

首次啟用還要在 GitHub 網頁上做兩件事：

1. **儲存庫必須是公開的**（免費方案的 Pages 不支援私有儲存庫）
2. **Settings → Pages → Source 選「GitHub Actions」**

網址會是 `https://<帳號>.github.io/<儲存庫名>/`。資源路徑靠環境變數 `PAGES_BASE` 帶前綴——**自架服務與本機開發不要設它**，同源部署的資源就掛在根目錄，設了會讓它們指向不存在的子目錄。

```bash
# 本機模擬 Pages 的產物
PAGES_BASE=/CDY_YAKYULIFE/ npm run build
```

---

## 快速開始

以下步驟適用於上述的舊版預覽：

1. Clone 儲存庫或下載 `index_legacy.html`。
2. 在瀏覽器中開啟 `index_legacy.html`。
3. 輸入球員名稱並選擇投手或打者。
4. 開始你的棒球生涯。

---

## 常見問題

### 為什麼找不到下載連結或安裝檔？

因為還沒發佈過任何版本。本專案正在把原本的單一 HTML 檔案重寫成新架構，首個正式版本會是 `1.0.0`。在那之前，只能依上述步驟取用舊版預覽。

### 舊版預覽還會繼續更新嗎？

不會。`index_legacy.html` 保留下來只是為了讓你能試玩、以及作為新版本的對照基準，不再加入新功能。

---

## 鳴謝 (Credits)

本專案衍生自 [LeoGGcat/yakyulife](https://github.com/LeoGGcat/yakyulife)，感謝原作者的精彩創意與無私開源。

---

## 授權

本專案採用 GPL-3.0 授權，詳見 [LICENSE](LICENSE)。

---

## 開發者

想了解未來的開發計畫與待辦清單？請看 [ROADMAP.md](ROADMAP.md)。
想修改或自行建置？請看 [DEVELOPER.md](DEVELOPER.md)。
變更紀錄請看 [CHANGELOG.md](CHANGELOG.md)。
