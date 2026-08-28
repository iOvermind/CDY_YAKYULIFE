/**
 * 本機開發用的入口：**跑在一個 JSON 檔上**，不需要 Postgres。
 *
 *     cd server && npm run dev          # 開在 8099，Vite 的 /api 代理指著它
 *     cd client && npm run dev          # 另一個終端機
 *
 * 用途是調整帳號、成就與天賦的介面——那些畫面需要一個會回 JSON 的 `/api`，
 * 而 Vite 的 dev server 沒有。資料存在 `server/.devdata.json`，**重啟後還在**：
 * 買了天賦、跑完一段生涯、拿到 AP，關掉再開要看得到同樣的狀態，否則每次都得
 * 從註冊開始，那個流程根本測不動。要重來就砍掉那個檔（`npm run dev:fresh`）。
 *
 * 連接埠預設 8099 是為了對上 `client/vite.config.js` 裡的代理設定。**這兩個數字
 * 對不起來的話，前端會判定成「這個部署沒有帳號功能」而整排反灰**，而且不會有
 * 任何錯誤訊息——它本來就要能在沒有伺服器的情況下正常玩。
 */

import { join } from 'node:path';
import { useDb } from './db.ts';
import { JsonDb } from './devdb.ts';
import { register } from './routes.ts';

process.env.PORT ??= '8099';
// 沒設 STATIC_DIR 就直接餵已經 build 好的前端；沒 build 過也不影響 `/api`。
process.env.STATIC_DIR ??= join(process.cwd(), '..', 'client', 'dist');

const file = process.env.DEV_DB ?? join(process.cwd(), '.devdata.json');
const db = new JsonDb(file);
useDb(db);

/**
 * 第一次跑時放一個有 AP 的帳號：`demo` / `demo1234`。
 *
 * 沒有它，天賦那一頁只看得到「買不起」的狀態——而買得起、買到一半、點滿這三種
 * 樣子才是需要看的。**已經有資料就不補**：否則每次重啟都會撞上已存在的帳號，
 * 而且會把你上一輪測到一半的狀態蓋掉。
 */
if (db.users.length === 0) {
  const demo = await register('demo', 'demo1234');
  for (const [id, name, category, points] of [
    ['tier:名將', '名將', '生涯分級', 12],
    ['award:mvp', '年度 MVP', '獎項', 8],
    ['milestone:cpbl:h:1000', '中職 1000 安', '累積里程碑', 5],
    ['trait:clutch', '關鍵時刻', '隱藏特性', 4],
  ] as const) {
    db.achievements.push({
      user_id: demo.id,
      achievement: id,
      name,
      category,
      points,
      unlocked_at: new Date(),
    });
  }
  db.save();
  console.warn('[dev] 已建立預設帳號 demo / demo1234，帶著 29 AP。');
}

console.warn(`[dev] 假資料庫：${file}（想重來就刪掉它，或跑 npm run dev:fresh）`);
console.warn(`[dev] http://localhost:${process.env.PORT}　靜態檔：${process.env.STATIC_DIR}`);

await import('./index.ts');
