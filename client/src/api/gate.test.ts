import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOffline } from './contract.ts';
import { GATE_TIMEOUT_MS, withTimeout } from './gate.ts';

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('時間內回來就照原樣交出', async () => {
    await expect(withTimeout(Promise.resolve(7))).resolves.toBe(7);
  });

  it('原本的失敗照原樣傳出去', async () => {
    const boom = new Error('boom');
    await expect(withTimeout(Promise.reject(boom))).rejects.toBe(boom);
  });

  /** API 卡住時開始按鈕不能永遠按不下去（issue #59）。 */
  it('卡住的請求在逾時後以「連不上」失敗', async () => {
    const stuck = withTimeout(new Promise<never>(() => undefined));
    const caught = stuck.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(GATE_TIMEOUT_MS);
    expect(isOffline(await caught)).toBe(true);
  });
});
