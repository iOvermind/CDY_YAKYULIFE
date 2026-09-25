# 棒球生涯模擬器 (YaKyoLife) 開發者文件

> 這份文件給**要修改這個專案的人**。使用說明請看 [README.md](README.md)。

---

## 1. 技術棧與系統需求

新架構（`client/`）：

| 項目 | 版本 | 用途 |
| :--- | :--- | :--- |
| Node.js | 20 以上（開發機為 25.8.1） | 執行 Vite 與測試 |
| TypeScript | 7.0 | 引擎與介面的實作語言 |
| React | 19.1 | 介面框架 |
| Vite | 7.0 | 開發伺服器與打包 |
| Vitest | 4.1 | 測試 |
| Docker | 最新 | 自架服務（app + Postgres + tunnel） |
| Git | 最新 | 版本控制 |

舊版預覽（`index_legacy.html`）：任何支援 ES6+ 的現代瀏覽器，無其他需求。

**作業系統限制**：不受限。發行模型是單一自架服務（[ADR 0038](docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)），沒有需要特定平台工具鏈的建置步驟。

> **桌面端（Tauri）在 `legacy` 分支上，`main` 不再追蹤。** `client/src-tauri/`、
> GitHub Pages 的部署工作流與相關設定都留在那條分支，`main` 上已經沒有它們。
> 需要回頭看的話 `git switch legacy`。

---

## 2. 環境建置

從一台乾淨的機器開始：

1. 取得原始碼
   ```bash
   git clone git@github.com:iOvermind/CDY_YAKYULIFE.git
   ```
   完成後應看到專案資料夾與檔案下載完成。

2. 安裝相依套件
   ```bash
   npm run install:client
   ```
   完成後應看到 `client/node_modules/` 產生。

3. 確認環境可用
   ```bash
   npm run typecheck
   npm test
   ```
   兩者都應無錯誤結束，測試顯示全數通過。

> 實際的專案在 `client/`，但**根目錄有一個只做指令轉發的 `package.json`**，所以上面的指令在根目錄或 `client/` 底下執行都可以。根目錄那份刻意不帶 `version` 欄位，以免出現第二個版本號來源（見 §7）。

舊版預覽不需要以上任何步驟：直接用瀏覽器開啟根目錄的 `index_legacy.html` 即可。

---

## 3. 日常開發

指令在**根目錄或 `client/` 底下都可以執行**——根目錄的 `package.json` 會轉發到 `client/`。

| 指令 | 作用 |
| :--- | :--- |
| `npm run dev` | 啟動開發伺服器（<http://localhost:1420>），改檔即時反映 |
| `npm test` | 跑完整測試一次 |
| `npm run test:watch` | 測試監看模式，改檔自動重跑 |
| `npm run typecheck` | 型別檢查，不產出檔案 |
| `npm run build` | 打包網頁版到 `client/dist/` |

> PowerShell 5.1 沒有 `&&`，要切目錄再執行請分兩行，或用 `;` 串接：
> ```powershell
> cd client
> npm run dev
> ```

### 測試帳號、成就與天賦（不需要 Postgres）

這些功能要有一個會回 JSON 的 `/api`，Vite 的 dev server 沒有。開兩個終端機：

```bash
cd server && npm run dev     # 8099，資料存在 server/.devdata.json
cd client && npm run dev     # 1420，/api 會轉給 8099
```

預設帳號 `demo` / `demo1234`，帶著 29 AP——買得起、買到一半、點滿三種狀態才看得完。
資料**重啟後還在**；要從乾淨的狀態重來就 `npm run dev:fresh`。

底層是 `src/fakedb.ts`：**它不是 SQL 引擎**，是一張「看到這句就做這件事」的對照表。
路由多打一條沒對應的 SQL 時它會直接丟錯，而不是靜靜回空陣列。

> 伺服器沒開也不會壞，只是右上角的登入與成就整排反灰——離線是被支援的狀態。
> 但**兩邊的連接埠必須對得起來**（`vite.config.js` 的代理 ↔ `server/src/dev.ts`），
> 對不上的表現跟「沒開伺服器」一模一樣，不會有任何錯誤訊息。

**連接埠固定為 1420**：`vite.config.js` 設了 `strictPort: true`。留著的理由是**被佔用時要直接失敗而不是安靜換一個**——換了埠之後 `/api` 的代理設定就對不上，而那個症狀看起來像「登入壞掉」而不是「開發伺服器換埠了」。

**除錯**：瀏覽器開發者工具（F12）。

**改動亂數相關程式碼時**：引擎的隨機必須完全確定（見 [ADR 0002](docs/adr/0002-deterministic-rng-and-replay-log.md)）。任何影響遊戲結果的地方**禁止**呼叫原生 `Math.random()`，一律經過 `src/engine/rng.ts`。改完務必跑 `npm test` —— 確定性與子序列獨立性都有測試守著。

**寫任何平衡數字時**：一律放進 `src/data/` 的 JSON，**禁止**寫死在 TypeScript 裡。規則編輯器（ROADMAP 階段一.七）只改得到 JSON，留在程式碼裡的常數使用者永遠調不到。判準是「改了會不會影響遊戲平衡」——會就進 JSON；純技術常數（陣列索引、字串前綴）不在此列。

**卡片內文裡放變數時**：一律先經過 `esc()`。卡片是用 `innerHTML` 渲染的（高光標記需要），而球員姓名是自由輸入的文字。

---

## 4. 目錄結構

```text
CDY_YAKYULIFE/
├─ docs/            
│  ├─ rules/        通用規範（本專案遵循的文件規範）
│  ├─ design/       數值設計：公式總表與模擬數學模型
│  ├─ adr/          架構決策紀錄
│  └─ agents/       AI 代理設定
├─ client/          新架構實作（React + Vite）
│  ├─ src/
│  │  ├─ data/      規則資料（JSON）與型別化的載入層
│  │  └─ engine/    模擬引擎；測試與被測檔案同層並列
├─ server/          帳號、成就與重跑驗證；Postgres schema 與 Dockerfile
├─ deploy.sh        建出 image（不啟動任何東西）
├─ reset-db.sh      清空資料庫並重建結構（會先問一次）
├─ compose.yaml     部署描述（app + Postgres + cloudflared）
├─ .env.example     compose 需要的環境變數範本
├─ index_legacy.html 舊版遊戲本體（HTML + CSS + JS 全部內嵌，唯讀保留）
├─ WIKI.md          玩家攻略（數值表由 client/scripts/wiki.mjs 從 json 產生）
├─ CONTEXT.md       領域術語表
├─ github.bat       Git 快速推拉腳本
├─ CHANGELOG.md     變更紀錄
├─ README.md        專案說明
├─ DEVELOPER.md     開發者文件
├─ INTERFACE.md     介面相關說明
├─ CLAUDE.md        Claude 助手設定檔
└─ LICENSE          授權條款
```

---

## 5. 架構與關鍵設計決策

### 模組職責

| 模組 | 職責 | 依賴 |
| :--- | :--- | :--- |
| `index_legacy.html` | 舊版實作：包含畫面結構、樣式設計與所有遊戲邏輯 | 無外部依賴 |
| `client/src/data/` | 規則資料與載入層。10 個 JSON 加上型別定義 | 無 |
| `client/src/engine/` | 模擬引擎。`rng.ts` 是確定性亂數層，其餘領域模組各自宣告使用哪一條子序列。**需要玩家回答的領域寫成步驟機**（`loveYear.ts` 是第一個，見 [ADR 0050](docs/adr/0050-domains-that-ask-the-player-are-step-machines.md)）：規則 `yield` 出一步，`game.ts` 負責把它講出來 | `data/` |
| `client/src/*.tsx` | React 介面 | `engine/`、`data/` |
| `client/src/*.ts`（`src/` 下、不在 `engine/` 裡的） | 介面側的純邏輯：成就櫃的版面（`cabinet.ts`）、生涯卡的圖（`careerImage.ts`）。**不是引擎**——它們回答「畫面怎麼排」，不回答「這一生值多少」 | `engine/`、`data/` |
| `server/src/` | 帳號、成就結算與重跑驗證。**直接 import client 的引擎原始碼**，所以兩邊永遠是同一份規則——但只准走三條線：`engine/index.ts`（引擎的入口契約，見 [ADR 0049](docs/adr/0049-the-engine-entry-is-the-servers-contract.md)）、`data/index.ts`、`api/contract.ts`，有護欄測試盯著 | `client/src/engine/index.ts`、`client/src/data/`、`client/src/api/` |

依賴方向是單向的：介面依賴引擎，引擎依賴資料，資料不依賴任何東西。**伺服器只認引擎的入口**——`engine/index.ts` 是一份契約而不是 barrel，要多用引擎的什麼東西就得在那裡寫一行（ADR 0049）。**引擎不得反向依賴介面**——伺服器端要能不經 UI 重跑一整段生涯來驗證成績（見 ADR 0002）。

### 關鍵決策

#### [ADR 0038: 一個自架服務，天梯信任的是重跑而不是連線](docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)

- **決定**：發行模型改成**單一自架服務**（`docker compose`：app + Postgres + tunnel），玩家連網址就玩。桌面端（Tauri）轉 legacy、不再維護，本機存檔（SQLite／IndexedDB）一併取消。
- **決定**：**自選種子是合法玩法**——種子不改變任何一條計算，那段生涯仍然得由玩家親手打完。天梯的信任基礎因此是「伺服器重跑得出同一段生涯」，不是「全程連線」。
- **影響**：取代 ADR 0001 的第 1 點與第 3 點；資料解耦那一條（第 2 點）保留。

#### [ADR 0001: 系統架構重構為 Tauri + React，並採用兩棲防護機制](docs/adr/0001-tauri-react-architecture.md)

> **部分已被 [ADR 0038](docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md) 取代**：Tauri 桌面端與兩棲防護機制都不再成立。資料解耦那一條仍然有效。

- **決定**：放棄單一 HTML 檔案架構，採用 **Tauri + React (Vite)** 進行全端重建。
- **理由**：為了支援跨局成就點數、歷史生涯比較、以及未來的線上功能。引入本地資料庫 (SQLite) 用於離線儲存，並透過 Token 簽章機制防範基礎修改器作弊。**後兩者都已作廢**（ADR 0038）：離線儲存從來沒落地，Token 也不存在——伺服器直接重跑日誌自己算。
- **代價**：開發流程需引入 Node.js 與 Rust 工具鏈，且需要維護前後端分離的狀態同步。

> **注意**：舊版的單一檔案實作以 `index_legacy.html` 保留於 `main`，作為新架構的遊戲邏輯對照基準，**唯讀、不再修改**。保留方式見 §8。

---

## 6. 測試

```bash
cd client
npm test          # 跑一次
npm run test:watch # 監看模式
```

測試用 Vitest，檔案與被測程式碼同層並列（`rng.ts` 旁邊是 `rng.test.ts`），不另設 `tests/` 目錄——搬動模組時測試會跟著走。

**分類**

| 類型 | 內容 |
| :--- | :--- |
| 單元 | 各領域函式的輸入輸出 |
| 確定性 | 同種子產生同結果、子序列彼此獨立。這類測試守的是 ADR 0002 的架構約束，不是某個函式的行為 |
| 分佈 | 用數千個種子取樣，檢查機率落在設定的區間內。隨機系統無法逐值斷言，只能驗證分佈 |

**目前沒有測試會被略過。** 未來若有測試因缺少外部檔案而略過，必須在此說明略過條件、檔案該放哪、以及如何辨識「略過」與「失敗」。

**分佈測試的容許區間是刻意的驗收線**，不是隨手填的數字。例如二刀流出現率被釘在 1%–15%：掉出這個區間代表潛力階梯的重疊被改動了，二刀流會變得氾濫或絕跡。調整這類區間前先確認你真的要改變平衡。

---

## 7. 建置與部署

**建置**

```bash
cd client
npm run build        # → client/dist/
```

舊版的 `index_legacy.html` 不需建置，開啟即可執行。

**部署**（見 [ADR 0038](docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)）

建 image 與跑容器是分開的兩步——「重啟一下」不該變成「順手換了一個版本」。

```bash
./deploy.sh                   # 產生 .env（若無）、建出 cdy_yakyulife:latest。不啟動任何東西
docker compose up -d          # 或在 Dockhand 之類的管理介面上部署這個專案
docker compose logs -f app
docker compose down           # 停掉，資料留著
./reset-db.sh                 # 清空資料庫（會先問一次）
```

根目錄的 `compose.yaml` 是**純描述式的**三個服務：`app`（image 版，前端已建進去）、`db`、`cloudflared`。沒有啟動時安裝依賴、沒有啟動時建置前端，所以起停與看記錄都可以交給容器管理介面。更新是 `git pull && ./deploy.sh`，然後讓 app 換上新 image。

環境變數在 `.env`（範本 `.env.example`）；`TUNNEL_TOKEN` 要自己去 Cloudflare Zero Trust 拿，通道的 service 填 `http://app:8080`。compose 裡沒有必填檢查，值填在 `.env`、管理介面的環境變數欄或直接寫死在 compose 裡都行。**只有秘密走環境變數**：資料庫路徑是寫死在 compose 裡的絕對路徑（`/home/overmind/docker/CDY_YAKYULIFE/data/pg`），因為相對路徑是相對於 compose 檔案所在的目錄，管理介面把它複製到別處跑時會指錯地方（見 [ADR 0040](docs/adr/0040-the-data-path-is-not-a-secret.md)）。清庫是 `./reset-db.sh`（問過一次才動手，`-y` 跳過詢問），**不可復原**。

**產物**

目前無正式發佈。首個**正式**版本為 `1.0.0`；在那之前走 `0.y.z` 開發階段（`VERSION_RULES.md`
§4.3），第一刀切在 `0.1.0`（2026-09-06）——那不是「發佈」，是為了讓遊戲裡的「更新」
分頁有版本界線可以顯示，否則玩家永遠只看到一塊 `[Unreleased]`。

**每做完一批就要收一版**：照 `CHANGELOG_RULES.md` §4.2 把 `## [Unreleased]` 改成
`## [<版本號>] - <日期>`、在上面新開一個空的 `[Unreleased]`，並同步 `client/package.json`
的 `version`。忘了收版不會有任何錯誤訊息，只會讓那一頁停在上一版。

建置**中間產物**（不對外發佈）：

| 產物 | 用途 |
| :--- | :--- |
| `client/dist/` | 前端的靜態檔。伺服器用 `STATIC_DIR` 指向它，同一個服務同時送前端與 `/api` |

發佈時的產物形式將於首次發佈前在此明列，依 `docs/rules/RELEASE_RULES.md` §2.2 的形式標記（網頁版用 `Web`）。

### 版本號

**單一來源**：`client/package.json` 的 `version`

| 位置 | 欄位 | 方式 |
| :--- | :--- | :--- |
| `client/package.json` | `version` | 手動（單一來源） |
| ~~`package.json`（根目錄）~~ | — | **刻意不帶 `version`**。它只是指令轉發，不是第二個版本號來源 |
| `CHANGELOG.md` | 版本標題 | 手動 |
| `client/src/data/changelog.json` | — | **自動**。由 `client/scripts/changelog.mjs` 從 `CHANGELOG.md` 產生（predev／prebuild／pretest 帶著跑），遊戲的「更新」分頁讀它。**禁止手改**，測試會比對它與 `CHANGELOG.md` 是否一致 |

`index_legacy.html` 不帶版本號——它是唯讀保留的舊實作，不隨版本遞增（見 §8）。

---

## 8. 分支、commit 與 PR 慣例

- **主分支**：`main`
- **開分支**：個人單獨開發專案，主要於 `main` 分支上工作。利用 `github.bat` 輔助快速的本機與遠端同步。
- **commit 訊息**：自由格式。可手動輸入；若未輸入，則由 `github.bat` 自動產生時間戳記。
- **PR 慣例**：無 PR 流程，直接推送至主分支。

### 舊實作的保留

舊版的單一 HTML 實作目前**與新架構共存於 `main`**，檔名為 `index_legacy.html`。

| 保留形式 | 內容 | 保留原因 | 解除條件 |
| :--- | :--- | :--- | :--- |
| `main` 上的 `index_legacy.html` | 舊版單一 HTML 檔案實作 | 它是唯一一份完整可運作的遊戲邏輯，作為新架構的參考來源與正確性對照基準 | 新架構的行為經對照確認等價，且確認不再需要單檔版本時 |

規則：

- **禁止修改 `index_legacy.html`**。它是對照基準，改了就失去比對意義；任何修正只落在新架構。
- 它不接受新功能，也不隨版本號遞增。
- 未來若要將它從 `main` 移除，屆時再依 `docs/rules/DEVELOPER_RULES.md` §4.3 建立 `legacy/single-html` 分支保留，**禁止**直接刪除。

> 目前兩者共存於 `main`，尚未觸發 `DEVELOPER_RULES.md` §4.3 的分支保留條件（該條的觸發條件是「舊實作無法與新實作共存於主分支」）。

---

## 9. 安全與敏感資料

### 9.1 機密不進版控

| 項目 | 排除方式 | 本機該放哪 |
| :--- | :--- | :--- |
| 目前無 | 無 | 無 |

（註：雖然 `github.bat` 內含 SSH 金鑰路徑 `%USERPROFILE%\.ssh\id_ed25519`，但其使用了本機變數，非機密本身，且專案為純前端執行，沒有伺服器或 API 密鑰。）

### 9.2 權限最小化

| 要求的權限 | 為什麼需要 |
| :--- | :--- |
| 無 | 專案在客戶端瀏覽器上執行，無須要求任何特殊系統權限。 |

**刻意不要的權限**：不要求存取本地檔案系統或後端連線，以確保安全性與簡單性。

### 9.3 依賴來源與鎖檔

- 鎖檔：`client/package-lock.json` 與 `server/package-lock.json`**皆已納入版本控制**——部署時 `npm ci` 讀的就是它們。
- 安裝指令：新架構的相依安裝指令將於環境建置步驟定案後於 §2 補寫；安裝時應使用會遵守鎖檔的指令（`npm ci`），不使用 `npm install`。
- 舊版的 `index_legacy.html` 無任何第三方相依，不從外部載入資源。

### 9.4 破壞性操作的保護

| 操作 | 影響的資料 | 可回復機制 |
| :--- | :--- | :--- |
| 目前無 | 無 | 無 |

---

## 10. 已知陷阱

#### PowerShell 5.1 下 `cd client && npm run dev` 是語法錯誤

- **症狀**：`語彙基元 '&&' 不是這個版本中的有效陳述式分隔符號` 之類的 ParserError
- **原因**：管線串接運算子 `&&` 與 `||` 是 PowerShell 7 才加入的，5.1 沒有。
- **處置**：分兩行寫，或用 `;` 串接（但 `;` 是無條件執行，前一個失敗仍會執行下一個）。

#### 佈景主題切換後字體沒變，看起來跟原版不一樣

- **症狀**：切到「電子看板」或「報紙版面」，顏色變了但字體還是系統預設，整體質感與原版不符
- **原因**：`legacy.css` 的主題 b 指定 `DotGothic16`、主題 c 指定 `Noto Serif TC`，這些字體從 Google Fonts 載入。`client/index.html` 少了那兩行 `<link>`，或是離線狀態下載不到，字體就會 fallback。
- **處置**：確認 `client/index.html` 的 `fonts.googleapis.com` 兩行還在。**玩家連不到 Google Fonts 時必然 fallback**（防火牆、離線、擋第三方網域），要讓那些情況也正確就必須把字體檔內嵌進產物。

#### `Cannot find module @rollup/rollup-win32-x64-msvc`（或 `@esbuild/...`）

- **症狀**：Windows 端跑 `npm run dev` 炸在 `rollup/dist/native.js`，訊息叫你刪掉 `package-lock.json` 與 `node_modules` 重裝。**照做只會讓另一邊壞掉**。
- **原因**：專案在 `D:\Dev\CDY_YAKYULIFE`，WSL 從 `/mnt/d/...` 看到的是同一個目錄，`client/node_modules` 因此是**共用的一份**。但 rollup、esbuild 與 TypeScript 7（Go 實作）都是原生二進位，npm 只會安裝「執行 `npm i` 當下那個平台」的 optional dependency，兩邊互相覆蓋。從 WSL 跑過測試，Windows 端就找不到 `win32-x64-msvc`，反之亦然；`npm run typecheck` 則是 `Unable to resolve @typescript/typescript-linux-x64`。
- **處置**：不用手動處理。`client/scripts/native-platform.mjs` 掛在 `predev` / `prebuild` / `pretest` / `pretest:watch` / `pretypecheck` / `precalibrate`，會偵測平台不符並自動重裝（約 5 秒）。平台正確時開銷約 30ms。
- **注意**：**繞過 npm scripts 直接跑 `npx vite` / `npx vitest` 不會觸發偵測**，換邊後請走 `npm run dev` / `npm test`。
- **手動修**：`cd client && npm i --os=win32 --cpu=x64`（WSL 端用 `--os=linux`）。這個指令只換原生套件，**不會改動 `package-lock.json`**——lock 本來就列出所有平台，只是安裝時二選一。

#### 開發伺服器啟動失敗，說連接埠被佔用

- **症狀**：`Port 1420 is already in use` 而且 Vite 直接結束，不會自動換一個連接埠
- **原因**：`vite.config.js` 設了 `strictPort: true`。這是刻意的——安靜換埠之後 `/api` 的代理就對不上，症狀會長得像「登入壞掉」而不是「換埠了」。
- **處置**：關掉佔用 1420 的行程（通常是另一個還開著的 `npm run dev`），不要改設定去換連接埠。

---

## 相關文件

- 使用說明：[README.md](README.md)
- 變更紀錄：[CHANGELOG.md](CHANGELOG.md)
