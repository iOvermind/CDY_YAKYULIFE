/**
 * 開局閘門的逾時。
 *
 * 開局前要等兩個請求：「我是誰」（帶不帶天賦）與開局登記（這一局入不入帳）。
 * `fetch` 本身沒有逾時，API 卡住時開始按鈕會永遠按不下去，所以這兩個請求
 * 等到 `GATE_TIMEOUT_MS` 就放棄等（issue #59）。
 *
 * **只有這兩個**。結算如果被前端中斷，伺服器可能已經寫入、前端卻以為失敗，
 * 那是另一個問題，不能順手套上同一個逾時。
 */

import { ApiError, OFFLINE } from './contract.ts';

export const GATE_TIMEOUT_MS = 5000;

/**
 * 在 `ms` 內沒有結果就以「連不上」失敗。原本的請求不會被中斷——開局登記晚到
 * 的話，伺服器那邊就是一局沒打完的生涯，與玩家中途放棄一樣。
 */
export function withTimeout<T>(p: Promise<T>, ms: number = GATE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError(OFFLINE, '伺服器沒有回應。')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
