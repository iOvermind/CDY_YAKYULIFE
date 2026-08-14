import { defineConfig } from 'vitest/config';

/**
 * 校準腳本專用的設定。
 *
 * 校準要跑幾百到幾千局，時間以分鐘計，因此**刻意不讓它被例行套件掃到**：
 * `scripts/calibrate.ts` 不叫 `.test.ts`，預設的 include 找不到它，只有這份
 * 設定會把它挑出來。
 *
 *     npm run calibrate -- --runs=2000
 */
export default defineConfig({
  test: {
    include: ['scripts/calibrate.ts'],
    // 報表就是這支腳本的產物。預設的 console 攔截會把它吞掉。
    disableConsoleIntercept: true,
    // 一局生涯要跑二十幾個球季，幾千局會很久。
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
