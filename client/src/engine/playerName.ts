/**
 * 球員姓名的長度規則。
 *
 * **長度量的是顯示寬度，不是字數**：中文（全形）算 2、英數（半形）算 1。一格
 * 表格欄位撐多寬看的是字形佔多寬，算字數的話六個中文字和六個英文字母會被當成一樣
 * 長，實際上差了一倍。
 *
 * 兩道關卡：
 * - **輸入**：寬度最多 12（六個中文字、十二個英文字母）。
 * - **顯示**：超過 12 的截成寬度 8（四個中文字）再接「……」。新名字過不了輸入那
 *   一關，會被截的只有舊規則（最多十個字）取的名字——天梯資料庫裡還存著它們，
 *   伺服器照存不擋，所以這一關守在顯示端。
 */

export const NAME_MAX_WIDTH = 12;
const NAME_SHORT_WIDTH = 8;
const ELLIPSIS = '……';

/** 全形字元：CJK、注音、全形標點與符號，以及 BMP 以外的字（罕用漢字、emoji）。 */
const WIDE =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{10000}-\u{10FFFF}]/u;

function charWidth(ch: string): number {
  return WIDE.test(ch) ? 2 : 1;
}

/** 字串的顯示寬度。 */
export function nameWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

/** 從頭取字，直到再多一個字就超過 `max` 為止。 */
function takeWidth(s: string, max: number): string {
  let w = 0;
  let out = '';
  for (const ch of s) {
    w += charWidth(ch);
    if (w > max) break;
    out += ch;
  }
  return out;
}

/** 輸入框用：寬度超過上限的部分直接丟掉。 */
export function clampName(s: string): string {
  return takeWidth(s, NAME_MAX_WIDTH);
}

/** 顯示用：寬度 12 以內原樣，超過的截成四個中文字寬再接「……」。 */
export function displayName(s: string): string {
  return nameWidth(s) <= NAME_MAX_WIDTH ? s : takeWidth(s, NAME_SHORT_WIDTH) + ELLIPSIS;
}
