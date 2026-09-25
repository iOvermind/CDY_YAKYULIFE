/**
 * 引擎的入口：**伺服器唯一被支援的 surface**。
 *
 * 這不是一個「把底下全部 re-export 出來」的 barrel。它是一份契約——伺服器只准
 * 從這裡 import，所以「我有沒有弄壞伺服器」這個問題等於「我有沒有改這個檔案」
 * （見 [ADR 0049](../../../docs/adr/0049-the-engine-entry-is-the-servers-contract.md)）。
 *
 * 從前伺服器點名六條內部路徑（`engine/game.ts`、`engine/achievements.ts`、
 * `engine/ladder.ts`、`engine/hall.ts`、`engine/overlay.ts`），於是引擎內部的
 * 任何重整都可能在**執行期**才炸在伺服器上：它跑的是 `--experimental-strip-types`，
 * 沒有建置這一關，而 client 的建置又不會去讀伺服器。
 *
 * **加東西進來要有意識**：每多一個 export，就多一件伺服器可以依賴、日後不能隨手
 * 改的事。引擎自己的模組之間照舊直接 import，不必繞這裡；`data/index.ts` 與
 * `api/contract.ts` 是另外兩條允許的線（資料與 HTTP 形狀，見 DEVELOPER.md §5）。
 */

// ---- 重跑一段生涯並結算：伺服器的主線（ADR 0007、0038）
export { Game, NO_PROGRESS, type CareerProgress, type CareerScore, type ReplayLog } from './game.ts';

// ---- 天梯的範圍代碼。伺服器要用它們排範圍清單與查榜
export {
  ALL,
  isPitcherRole,
  LADDER_POSITIONS,
  type LadderKey,
  type LadderKind,
  type LadderRow,
} from './ladder.ts';

// ---- 成就的現行定價。AP 是依現行規則動態算的，不是解鎖當下凍結的（ADR 0053）
export { improvedRanks, priceOwned, type OwnedAchievement } from './achievements.ts';

// ---- 天賦的價錢與層數上限。AP 的帳由伺服器算，因此它需要這兩個（ADR 0007）
export { costOf, maxLevelOf } from './overlay.ts';

// ---- 管理腳本 unlock-all.sh：一個帳號拿得到的全部成就。走正式的結算路徑，不另寫清單
export { unlockEverything } from './unlockAll.ts';
