-- 棒球人生模擬器：線上進度。見 ADR 0007 與 ADR 0038。
--
-- 五張表就夠：誰、買了什麼、解鎖了什麼、打過哪些生涯、那些生涯留下什麼數字。
-- 不用 Redis——這個規模 Postgres 一個人吃得下。
--
-- **這份檔每次啟動都會跑，因此每一行都必須是冪等的。** 它不會刪任何東西：要清庫
-- 重來時手動跑一次 `reset.sql`，那是一個刻意需要人動手的動作。

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
  -- 也含聯盟或球隊（`award:<org>:<code>`、`trait:<id>:<名字>`）——同一個獎在不同
  -- 聯盟是兩件事。
  achievement TEXT NOT NULL,
  -- 顯示用的名稱與分類。**成就是推導出來的，沒有一份靜態目錄**——不存下來的話，
  -- 前端拿到一串 id 就只能顯示 id。解鎖當下凍結寫入。
  name        TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  -- 解鎖當下的點數，**只是歷史**：餘額依現行規則重新定價（ADR 0053）。
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
  -- 伺服器重跑的結果與客戶端回報是否一致。**天梯只收 true 的那些**——規則資料
  -- 由伺服器送出，玩家改了自己那份，重跑必然對不上（ADR 0038）。
  verified     BOOLEAN,
  ap_gained    INTEGER,
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS careers_user_idx ON careers (user_id, started_at DESC);

-- 舊的天梯表。範圍從一個字串（`CPBL`、`CAREER`、`pos:SS`、`best:SS`）改成三欄的
-- 組合之後，**舊資料清掉重來**——跨版本重跑本來就被拒絕（ADR 0002），補不回新組合
-- 要的列。只丟天梯：帳號、AP、成就、天賦都不動。schema.sql 每次啟動都跑一次，第一
-- 次之後這一行就什麼都不做。
DROP TABLE IF EXISTS career_stats;

-- 天梯的原料：一段生涯在一個組合下的成績。見 ADR 0038 與 client/src/data/ladder.json。
--
-- **一列是一個組合**：聯盟（`org`，`*` 是跨聯盟）× 守位（`position`，`*` 是跨守位）
-- × 累計或單季（`kind`）。一段生涯只寫它實際打過的組合——打過中職與大聯盟、守過
-- 游擊與三壘的人，大概二三十列。畫面上的選單就在這些列上挑。
--
-- **只收頂級聯盟**——二軍的數字是在不同水準的對手身上打出來的，不進通算，也不該
-- 進榜。唯一的例外是薪水：某個聯盟的薪水問的是「那個體系的球團付了多少」。
--
-- 成績整條存成 JSONB 而不是攤成幾十個欄位：欄位清單住在 ladder.json，加一項不該
-- 需要動 schema。
--
-- **資格在寫入時就算好**（`qualified_batter` / `qualified_pitcher`）：率型數值的門檻
-- 要逐年累加各聯盟的球隊場次，那份逐年資料只有結算當下手上有。
CREATE TABLE IF NOT EXISTS ladder_rows (
  career_id         UUID NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org               TEXT NOT NULL,
  position          TEXT NOT NULL,
  kind              TEXT NOT NULL,
  seasons           INTEGER NOT NULL,
  batting           JSONB,
  pitching          JSONB,
  defense_runs      INTEGER NOT NULL DEFAULT 0,
  -- 勝利份額與敗戰份額。**整個球員的，不分投打**——他的份額本來就只有一份。
  win_shares        REAL NOT NULL DEFAULT 0,
  loss_shares       REAL NOT NULL DEFAULT 0,
  -- 評價分與薪水（萬元台幣）。兩者在每種組合下的意思不同，見 ladder.json。
  score             REAL NOT NULL DEFAULT 0,
  salary            BIGINT NOT NULL DEFAULT 0,
  qualified_batter  BOOLEAN NOT NULL DEFAULT FALSE,
  qualified_pitcher BOOLEAN NOT NULL DEFAULT FALSE,
  -- 結算當下的引擎版本。**規則改版後舊生涯留在榜上**，但標得出來是舊規則的產物
  -- ——跨版本不保證重現（ADR 0002），沒有「用新引擎重算」這條退路。
  engine_version    INTEGER NOT NULL,
  -- 顯示用：榜上要寫得出這是誰、哪一年的哪一段生涯。
  player_name       TEXT NOT NULL DEFAULT '',
  finished_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (career_id, org, position, kind)
);

-- WAR 與總冠軍數（2026-09-26，原本 ROADMAP 的「神獸殿堂」併進天梯）。**舊的列留著
-- NULL**：跨版本不能重跑（ADR 0002），補不出來；NULL 的列不上這兩張榜，其他榜照舊。
-- 單季榜的 rings 永遠是 NULL——一季最多一座，排出來只是一排 1。
ALTER TABLE ladder_rows ADD COLUMN IF NOT EXISTS war REAL;
ALTER TABLE ladder_rows ADD COLUMN IF NOT EXISTS rings INTEGER;

-- 查一格榜：全伺服器天梯查 (org, position, kind)，個人天梯再加 user_id。
CREATE INDEX IF NOT EXISTS ladder_rows_combo_idx ON ladder_rows (org, position, kind);
CREATE INDEX IF NOT EXISTS ladder_rows_user_idx  ON ladder_rows (user_id, org, position, kind);

-- 聯盟正名（2026-09-25）：中職→中華職棒、日職→日本職棒、韓職→韓國職棒、墨聯→墨西哥
-- 聯盟、澳職→澳洲聯盟、大聯盟→美國大聯盟。成就的名字是解鎖當下凍結寫入的，跟著改；
-- 名人堂入選、歷史級球星、七彩球衣這三種的 id 也含聯盟名，一併改掉——不改的話舊
-- 帳號下一次拿到同一件事會以新 id 再領一次 AP。舊名都在字串開頭，新名沒有一個以
-- 舊名開頭，所以重跑是冪等的。
UPDATE achievements SET name = regexp_replace(name, '^中職', '中華職棒') WHERE name ~ '^中職';
UPDATE achievements SET name = regexp_replace(name, '^日職', '日本職棒') WHERE name ~ '^日職';
UPDATE achievements SET name = regexp_replace(name, '^韓職', '韓國職棒') WHERE name ~ '^韓職';
UPDATE achievements SET name = regexp_replace(name, '^墨聯', '墨西哥聯盟') WHERE name ~ '^墨聯';
UPDATE achievements SET name = regexp_replace(name, '^澳職', '澳洲聯盟') WHERE name ~ '^澳職';
UPDATE achievements SET name = regexp_replace(name, '^大聯盟', '美國大聯盟') WHERE name ~ '^大聯盟';
UPDATE achievements SET achievement = regexp_replace(achievement, '^(hall:|trait:legend:|trait:rainbow:)中職', '\1中華職棒') WHERE achievement ~ '^(hall:|trait:legend:|trait:rainbow:)中職';
UPDATE achievements SET achievement = regexp_replace(achievement, '^(hall:|trait:legend:|trait:rainbow:)日職', '\1日本職棒') WHERE achievement ~ '^(hall:|trait:legend:|trait:rainbow:)日職';
UPDATE achievements SET achievement = regexp_replace(achievement, '^(hall:|trait:legend:|trait:rainbow:)韓職', '\1韓國職棒') WHERE achievement ~ '^(hall:|trait:legend:|trait:rainbow:)韓職';
UPDATE achievements SET achievement = regexp_replace(achievement, '^(hall:|trait:legend:|trait:rainbow:)墨聯', '\1墨西哥聯盟') WHERE achievement ~ '^(hall:|trait:legend:|trait:rainbow:)墨聯';
UPDATE achievements SET achievement = regexp_replace(achievement, '^(hall:|trait:legend:|trait:rainbow:)澳職', '\1澳洲聯盟') WHERE achievement ~ '^(hall:|trait:legend:|trait:rainbow:)澳職';
UPDATE achievements SET achievement = regexp_replace(achievement, '^(hall:|trait:legend:|trait:rainbow:)大聯盟', '\1美國大聯盟') WHERE achievement ~ '^(hall:|trait:legend:|trait:rainbow:)大聯盟';

-- 生涯分級改成每個聯盟一座、歸在特性底下（2026-09-25）：`tier:<org>:<n>`。舊的整段
-- 生涯一格（`tier:<n>`）刪掉——兩個帳號各一格 10 點，扣掉之後餘額不會變負。
DELETE FROM achievements WHERE achievement ~ '^tier:[0-9]+$';

-- 外觀（2026-09-27）：佈景主題與每一套各自的色相格數，整份存成 JSONB。**NULL 是還沒
-- 設定過**——客戶端登入時看到 NULL，就把那台裝置上的設定寫上來。
ALTER TABLE users ADD COLUMN IF NOT EXISTS appearance JSONB;

-- 養成期國際賽改成簡稱（2026-09-27）：名字太長，表格、榮譽標籤、成績圖都塞不下。成就的
-- id 與名稱都含賽事名（`intl:中華隊 <賽事>`、`中華隊 <賽事> <名次>`），**必須在
-- pruneAchievements 之前改掉**——不然舊名認不出來會被整列刪除、收回 AP。新名都不含
-- 舊名，重跑是冪等的。
UPDATE achievements SET achievement = replace(achievement, 'LLB 世界次青少棒錦標賽', 'LLB 次青少棒'), name = replace(name, 'LLB 世界次青少棒錦標賽', 'LLB 次青少棒') WHERE achievement LIKE '%LLB 世界次青少棒錦標賽%' OR name LIKE '%LLB 世界次青少棒錦標賽%';
UPDATE achievements SET achievement = replace(achievement, 'PONY 世界青少棒錦標賽', 'PONY 青少棒'), name = replace(name, 'PONY 世界青少棒錦標賽', 'PONY 青少棒') WHERE achievement LIKE '%PONY 世界青少棒錦標賽%' OR name LIKE '%PONY 世界青少棒錦標賽%';
UPDATE achievements SET achievement = replace(achievement, 'WBSC U-15 世界盃', 'U-15 世界盃'), name = replace(name, 'WBSC U-15 世界盃', 'U-15 世界盃') WHERE achievement LIKE '%WBSC U-15 世界盃%' OR name LIKE '%WBSC U-15 世界盃%';
UPDATE achievements SET achievement = replace(achievement, 'PONY 小馬級世界青棒錦標賽', 'PONY 青棒'), name = replace(name, 'PONY 小馬級世界青棒錦標賽', 'PONY 青棒') WHERE achievement LIKE '%PONY 小馬級世界青棒錦標賽%' OR name LIKE '%PONY 小馬級世界青棒錦標賽%';
UPDATE achievements SET achievement = replace(achievement, 'WBSC U-18 世界盃棒球賽', 'U-18 世界盃'), name = replace(name, 'WBSC U-18 世界盃棒球賽', 'U-18 世界盃') WHERE achievement LIKE '%WBSC U-18 世界盃棒球賽%' OR name LIKE '%WBSC U-18 世界盃棒球賽%';
UPDATE achievements SET achievement = replace(achievement, 'BFA 亞洲 U-18 青棒錦標賽', '亞洲 U-18'), name = replace(name, 'BFA 亞洲 U-18 青棒錦標賽', '亞洲 U-18') WHERE achievement LIKE '%BFA 亞洲 U-18 青棒錦標賽%' OR name LIKE '%BFA 亞洲 U-18 青棒錦標賽%';
UPDATE achievements SET achievement = replace(achievement, '世界大學運動會', '世大運'), name = replace(name, '世界大學運動會', '世大運') WHERE achievement LIKE '%世界大學運動會%' OR name LIKE '%世界大學運動會%';
UPDATE achievements SET achievement = replace(achievement, '國際大學菁英棒球賽', '大學菁英賽'), name = replace(name, '國際大學菁英棒球賽', '大學菁英賽') WHERE achievement LIKE '%國際大學菁英棒球賽%' OR name LIKE '%國際大學菁英棒球賽%';
UPDATE achievements SET achievement = replace(achievement, '哈連盃國際棒球邀請賽', '哈連盃'), name = replace(name, '哈連盃國際棒球邀請賽', '哈連盃') WHERE achievement LIKE '%哈連盃國際棒球邀請賽%' OR name LIKE '%哈連盃國際棒球邀請賽%';
