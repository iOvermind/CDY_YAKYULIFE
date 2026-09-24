-- 清掉遊戲進度，**保留帳號**。手動跑，不會在啟動時自動執行——`schema.sql` 每次
-- 啟動都跑，把 DROP 放進那份檔等於每重開一次就清空一次。
--
--   psql "$DATABASE_URL" -f server/reset.sql
--   psql "$DATABASE_URL" -f server/schema.sql
--
-- 清掉的是成就、天賦、生涯與天梯；`users` 不動，玩家照原本的帳號密碼登入。
-- **AP 沒有自己的表**：它是「拿過的成就點數 − 花在天賦上的」即時算出來的，成就與
-- 天賦清掉之後自然歸零。
--
-- 順序是相依的反向：先掉子表。CASCADE 會一併帶走外鍵。

DROP TABLE IF EXISTS ladder_rows  CASCADE;
DROP TABLE IF EXISTS career_stats CASCADE;
DROP TABLE IF EXISTS careers      CASCADE;
DROP TABLE IF EXISTS talents      CASCADE;
DROP TABLE IF EXISTS achievements CASCADE;
