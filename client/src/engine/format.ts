/**
 * 成績的顯示慣例。**判斷不在這裡**——這裡只決定「同一個數字怎麼寫給人看」。
 *
 * 與 `version.ts` 同一個理由獨立成檔：畫面需要的是兩行格式化，不該為此 import
 * 整個 `Game`。
 */

/** 打擊率的棒球慣例寫法：去掉個位數的 0，例如 .333。 */
export function fmtAvg(avg: number): string {
  return avg.toFixed(3).replace(/^0/, '');
}
