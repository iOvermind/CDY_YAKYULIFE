-- 棒球人生模擬器：線上進度。見 ADR 0007。
--
-- 四張表就夠：誰、買了什麼、解鎖了什麼、打過哪些生涯。
-- 不用 Redis——這個規模 Postgres 一個人吃得下。

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  -- 大小寫不敏感的唯一：Overmind 與 overmind 是同一個人，不然註冊時的
  -- 「不能重複」形同虛設。
  account       TEXT NOT NULL,
  account_key   TEXT GENERATED ALWAYS AS (lower(account)) STORED UNIQUE,
  -- scrypt(密碼, salt)。**絕不存明文，也不用 SHA-256**——那個快到可以暴力破解。
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 已解鎖的成就。**同一項只給一次 AP**，因此這張表就是那個「只有一次」的依據。
CREATE TABLE IF NOT EXISTS achievements (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 成就 id 不含局內年份：每一局都從 2026 開始，年份跨局沒有鑑別力。
  achievement TEXT NOT NULL,
  -- 顯示用的名稱與分類。**成就是推導出來的，沒有一份靜態目錄**——不存下來的話，
  -- 前端拿到一串 id 就只能顯示 id。
  name        TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  points      INTEGER NOT NULL,
  -- **真實時間戳**，不是局內年份。由伺服器蓋章，不由客戶端提供。
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement)
);

-- 買下的天賦。可退款，因此這張表只記「現在擁有什麼」。
CREATE TABLE IF NOT EXISTS talents (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  talent  TEXT NOT NULL,
  level   INTEGER NOT NULL CHECK (level > 0),
  PRIMARY KEY (user_id, talent)
);

-- 每一局生涯。
CREATE TABLE IF NOT EXISTS careers (
  id           UUID PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- **開局時凍結的天賦組合。** 天賦可以退款，「現在擁有什麼」與「那一局帶著
  -- 什麼」是兩件事——驗證時用的是這一欄，不是 talents 表。
  talents      JSONB NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 完整的重播日誌（種子＋選擇序列）。存著它，日後任何時候都能重跑驗證。
  log          JSONB,
  -- 伺服器重跑的結果與客戶端回報是否一致。不一致仍以伺服器為準，但記一筆。
  verified     BOOLEAN,
  ap_gained    INTEGER,
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS careers_user_idx ON careers (user_id, started_at DESC);

-- 後補的欄位。`CREATE TABLE IF NOT EXISTS` 對已經存在的表什麼都不做，因此加欄位
-- 必須另外寫一行——這整份檔案每次啟動都會跑，所以每一行都得是冪等的。
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS name     TEXT NOT NULL DEFAULT '';
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';

-- `legend` / `mrteam` / `rainbow` 的名字要冠上聯盟或球隊（「中職 歷史級球星」），
-- 因此 id 改成 `trait:<id>:<名字>`。**`name` 是解鎖當下凍結寫進來的**，改程式碼
-- 動不到已經躺在這裡的舊列，成就櫃會一直顯示 `legend` 這種英文 id。
--
-- 舊 id 現在不可能再被寫入（`traitTile()` 一律帶名字），所以這行刪完就不會再有
-- 東西回來；下一局結算時會以新 id 重新解鎖，AP 照算，不會重複給。
DELETE FROM achievements WHERE achievement IN ('trait:legend', 'trait:mrteam', 'trait:rainbow');

-- 獎項成就的 id 從 `award:<code>` 改成 `award:<org>:<code>`（獎項要掛回各聯盟底下，
-- 「大聯盟 年度 MVP」與「中職 年度 MVP」是兩件事）。舊列的 id 只有一段，成就櫃
-- 認不出它屬於哪個聯盟，只能掉進「獎項」那格孤兒欄位裡。
--
-- 一樣是刪完不會再回來：`awardName()` 現在一律寫 org。下一局拿到同一個獎會以新 id
-- 重新解鎖。**注意 AP 是 SUM(points) 算出來的**，刪掉這幾列 `apEarned` 會跟著掉，
-- 已經花掉 AP 的帳號餘額可能暫時變負——本地開發資料庫可以接受，正式環境要先確認
-- 沒有這種 id 才跑。
DELETE FROM achievements
 WHERE achievement LIKE 'award:%'
   AND split_part(achievement, ':', 2) NOT IN ('CPBL', 'NPB', 'KBO', 'MLB', 'LMB', 'ABL');
