/**
 * 本機開發用的入口：**跑在記憶體裡的假資料庫上**，不需要 Postgres。
 *
 *     cd client && npm run build
 *     cd server && STATIC_DIR=../client/dist npm run dev
 *
 * 用途是調整帳號、成就與天賦的介面——那些畫面需要一個會回 JSON 的 `/api`，
 * 而 Vite 的 dev server 沒有。**資料在重啟後全部消失**，這是刻意的：它是給人看
 * 版面的，不是給人存進度的。
 */

import { useDb } from './db.ts';
import { FakeDb } from './fakedb.ts';
import { register } from './routes.ts';

const db = new FakeDb();
useDb(db);

/**
 * 預先放一個有 AP 的帳號：`demo` / `demo1234`。
 *
 * 沒有它，天賦那一頁只看得到「買不起」的狀態——而買得起、買到一半、點滿這三種
 * 樣子才是需要看的。正式的部署跑的是 `index.ts`，不會經過這裡。
 */
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

console.warn('[dev] 使用記憶體假資料庫——重啟後所有帳號與進度都會消失。');
console.warn('[dev] 預設帳號 demo / demo1234，帶著 29 AP。');

await import('./index.ts');
