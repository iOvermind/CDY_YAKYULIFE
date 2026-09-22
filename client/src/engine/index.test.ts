/**
 * 護欄：**伺服器只准從引擎的入口 import**（ADR 0049）。
 *
 * 這條線從前只寫在 DEVELOPER.md §5 裡，而伺服器跑的是
 * `node --experimental-strip-types`——沒有建置這一關，破掉的話要到執行期才知道。
 * 這支測試因此讀 `server/src` 的原始碼，把那條線變成會紅的東西。
 */

import { describe, expect, it } from 'vitest';

/** 伺服器允許依賴的三條線：引擎的入口、規則資料、HTTP 形狀。 */
const ALLOWED = ['client/src/engine/index.ts', 'client/src/data/index.ts', 'client/src/api/contract.ts'];

// 走 Vite 的 glob import 而不是 node:fs——client 這一側沒有 @types/node，而這支
// 測試要能跟著 `npm test` 一起跑，不該為了讀四支檔案給整個專案裝一份型別。
const sources = import.meta.glob('../../../server/src/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 抓出一支檔案裡所有 import／export ... from '…' 的來源路徑。 */
function sourcesOf(code: string): readonly string[] {
  return [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
}

describe('伺服器與引擎之間的那條線', () => {
  const files = Object.entries(sources);

  it('server/src 底下真的有東西可以檢查', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('對 client 的 import 只走那三條允許的線', () => {
    for (const [file, code] of files) {
      for (const src of sourcesOf(code)) {
        if (!src.includes('client/src')) continue;
        const normalised = src.replace(/^(\.\.\/)+/, '');
        expect(
          ALLOWED.includes(normalised),
          `${file} 直接 import 了 ${src}。伺服器只准走 ${ALLOWED.join('、')}——` +
            `要多用引擎的什麼東西，請加進 engine/index.ts（那是一份契約，不是 barrel）。`,
        ).toBe(true);
      }
    }
  });
});
