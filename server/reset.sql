-- 清庫重來。**手動跑，不會在啟動時自動執行**——`schema.sql` 每次啟動都跑，把
-- DROP 放進那份檔等於每重開一次就清空一次玩家的帳號、成就與 AP。
--
--   psql "$DATABASE_URL" -f server/reset.sql
--   psql "$DATABASE_URL" -f server/schema.sql
--
-- 順序是相依的反向：先掉子表，再掉 users。CASCADE 會一併帶走外鍵。

DROP TABLE IF EXISTS career_stats CASCADE;
DROP TABLE IF EXISTS careers      CASCADE;
DROP TABLE IF EXISTS talents      CASCADE;
DROP TABLE IF EXISTS achievements CASCADE;
DROP TABLE IF EXISTS users        CASCADE;
