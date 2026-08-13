# 棒球生涯模擬器 (YaKyoLife) 開發者文件

> 這份文件給**要修改這個專案的人**。使用說明請看 [README.md](README.md)。

---

## 1. 技術棧與系統需求

| 項目 | 版本 | 用途 |
| :--- | :--- | :--- |
| HTML5 / CSS3 / JavaScript | 最新 | 遊戲本體實作，全部內嵌於單一檔案 |
| Git | 最新 | 版本控制 |
| 現代瀏覽器 | 支援 ES6+ | 執行遊戲與除錯 |
| 文字編輯器 | 任意 | 程式碼修改 |

**作業系統限制**：無。遊戲完全在客戶端瀏覽器執行，開發環境不受限。

---

## 2. 環境建置

從一台乾淨的機器開始：

1. 取得原始碼
   ```bash
   git clone git@github.com:iOvermind/CDY_YAKYULIFE.git
   ```
   完成後應看到專案資料夾與檔案下載完成。

2. 啟動專案
   直接使用瀏覽器開啟專案目錄下的 `index_legacy.html` 檔案即可。不需要安裝任何套件（如 npm install），無須任何編譯步驟。

> 本章節描述的是舊版單檔實作的環境。新架構（`client/`，見 §5）需要 Node.js 與 Rust 工具鏈，其環境建置步驟將於新架構可執行後補寫。

---

## 3. 日常開發

**啟動**

直接於瀏覽器開啟 `index_legacy.html`。

**修改後如何反映**：需重新整理瀏覽器（Refresh）以載入最新修改。專案未設置熱更新（Hot Reload）。

**除錯**：使用瀏覽器的開發者工具（F12）。遊戲執行時的輸出與錯誤訊息皆可透過 Console 進行檢視。

---

## 4. 目錄結構

```text
CDY_YAKYULIFE/
├─ docs/            
│  ├─ rules/        通用規範（本專案遵循的文件規範）
│  └─ agents/       AI 代理設定
├─ client/          新架構實作（Tauri + React，開發中）
│  ├─ src/          React 前端原始碼
│  └─ src-tauri/    Tauri 桌面端封裝與 Rust 端
├─ index_legacy.html 舊版遊戲本體（HTML + CSS + JS 全部內嵌，唯讀保留）
├─ WIKI.md          遊戲設計文件與完整數值表
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
| `client/` | 新架構實作：Tauri + React，開發中 | Node.js、Rust |

### 關鍵決策

#### [ADR 0001: 系統架構重構為 Tauri + React，並採用兩棲防護機制](docs/adr/0001-tauri-react-architecture.md)

- **決定**：放棄單一 HTML 檔案架構，採用 **Tauri + React (Vite)** 進行全端重建。
- **理由**：為了支援跨局成就點數、歷史生涯比較、以及未來的線上功能。引入本地資料庫 (SQLite) 用於離線儲存，並透過 Token 簽章機制防範基礎修改器作弊。
- **代價**：開發流程需引入 Node.js 與 Rust 工具鏈，且需要維護前後端分離的狀態同步。

> **注意**：舊版的單一檔案實作以 `index_legacy.html` 保留於 `main`，作為新架構的遊戲邏輯對照基準，**唯讀、不再修改**。保留方式見 §8。

---

## 6. 測試

目前無。

---

## 7. 建置與產物

**建置**

舊版的 `index_legacy.html` 不需建置，開啟即可執行。新架構的建置流程目前尚在開發中，未定案。

**產物**

目前無。本專案尚未發佈任何版本，首個正式版本為 `1.0.0`。發佈的產物形式將於新架構可執行後在此明列（依 `docs/rules/RELEASE_RULES.md` §2.2 的形式標記）。

### 版本號

**單一來源**：`client/package.json` 的 `version`

| 位置 | 欄位 | 方式 |
| :--- | :--- | :--- |
| `client/package.json` | `version` | 手動（單一來源） |
| `client/src-tauri/tauri.conf.json` | `version` | 手動 |
| `client/src-tauri/Cargo.toml` | `package.version` | 手動 |
| `CHANGELOG.md` | 版本標題 | 手動 |

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

- 鎖檔：`client/package-lock.json` 與 `client/src-tauri/Cargo.lock`，兩者**皆已納入版本控制**。
- 安裝指令：新架構的相依安裝指令將於環境建置步驟定案後於 §2 補寫；安裝時應使用會遵守鎖檔的指令（`npm ci`），不使用 `npm install`。
- 舊版的 `index_legacy.html` 無任何第三方相依，不從外部載入資源。

### 9.4 破壞性操作的保護

| 操作 | 影響的資料 | 可回復機制 |
| :--- | :--- | :--- |
| 目前無 | 無 | 無 |

---

## 10. 已知陷阱

目前無。

---

## 相關文件

- 使用說明：[README.md](README.md)
- 變更紀錄：[CHANGELOG.md](CHANGELOG.md)
