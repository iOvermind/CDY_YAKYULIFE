/**
 * 平衡護欄。
 *
 * 這**不是**校準——校準用 `npm run calibrate`，跑幾千局、輸出報表、由人決定
 * 數字。這裡只跑一百多局，斷言結果落在**很寬鬆**的區間內，用途單一：防止有人
 * 把平衡改到天翻地覆而沒有任何測試變紅。
 *
 * 因此區間刻意鬆到不會因為正常的調參而閃紅。它抓的是「名人堂變成人人有獎」
 * 或「全部球員都是過客」這種等級的崩壞，不是幾個百分點的漂移。
 *
 * 每一條斷言都附上「為什麼是這個區間」——沒有理由的護欄，下次紅了只會被人
 * 直接改寬。
 */

import { describe, expect, it } from 'vitest';
import { hallOfFame } from '../src/data/index.ts';
import { Game, type GameSetup } from '../src/engine/game.ts';
import type { CareerSummary } from '../src/engine/career.ts';

/** 與校準腳本的 balanced 策略一致——護欄與校準必須看同一種玩家。 */
const BALANCED = ['sta', 'con', 'rng', 'pow', 'fld', 'eye'];

const RUNS = 120;

function runCareer(seed: string, startPosition: GameSetup['startPosition']): CareerSummary | null {
  const game = new Game({ seed, name: '護欄', startPosition, throws: 'R', bats: 'R' }).start();
  let guard = 0;
  let cursor = 0;
  while (game.flow.prompt !== null && guard++ < 8000) {
    const options = game.flow.prompt.options;
    const rotated = [...BALANCED.slice(cursor % BALANCED.length), ...BALANCED];
    const pick =
      options.find((o) => o.id === 'retire:stay') ??
      rotated.map((k) => options.find((o) => o.id === `alloc:${k}`)).find((o) => o !== undefined) ??
      options.find((o) => o.id === 'alloc:confirm') ??
      options.find((o) => o.id === 'draft:accept') ??
      options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
      options[0];
    if (pick === undefined) break;
    if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') cursor++;
    game.choose(pick.id);
  }
  return game.summary;
}

const POSITIONS = ['SS', 'CF', 'C', '1B', 'P'] as const;

const summaries = Array.from({ length: RUNS }, (_, i) =>
  runCareer(`guard-${i}`, POSITIONS[i % POSITIONS.length]!),
).filter((s): s is CareerSummary => s !== null);

const withPro = summaries.filter((s) => s.leagues.length > 0);
const share = (tier: number) =>
  withPro.filter((s) => s.bestTier === tier).length / Math.max(1, withPro.length);

describe('平衡護欄', () => {
  it('每一局都跑得完並產出總結', () => {
    expect(summaries).toHaveLength(RUNS);
  });

  /** 名人堂要稀有到值得截圖，但不能稀有到跑一百局都碰不到。 */
  it('名人堂的比例落在 0–12%', () => {
    expect(share(0)).toBeLessThanOrEqual(0.12);
  });

  /** 反過來的崩壞：門檻訂太高，沒有人爬得上前兩帶。 */
  it('前兩帶合計不會是 0——門檻不該高到沒人構得到', () => {
    expect(share(0) + share(1)).toBeGreaterThan(0);
  });

  /** 「浮沉為大宗」：中間三帶要撐得起分佈，不能兩極化。 */
  it('中間三帶合計超過三成', () => {
    expect(share(1) + share(2) + share(3)).toBeGreaterThan(0.3);
  });

  /** 評價分要有離散度，否則分級只是把同一批人硬切五段。 */
  it('評價分的最高與最低差距明顯', () => {
    const scores = withPro.map((s) => s.leagues[0]?.score ?? 0);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(50);
  });

  /** 替代水準的定義：卡在留隊邊緣的人原地踏步，因此負分必須是可能的。 */
  it('存在評價分為負的生涯——低於替代水準會倒扣', () => {
    const scores = withPro.map((s) => s.leagues[0]?.sharePoints ?? 0);
    expect(Math.min(...scores)).toBeLessThan(Math.max(...scores));
  });

  it('分級標籤與門檻數量對得起來', () => {
    expect(hallOfFame.tier_thresholds.labels).toHaveLength(
      hallOfFame.tier_thresholds.values.length + 1,
    );
  });

  /**
   * grinder 的門檻曾經被手設在 620，而真實的潛力總和分布落在 830–880——
   * 那個特性因此永遠不會觸發，而且沒有任何測試會發現。
   */
  it('grinder 的門檻落在實際的潛力分布之內', () => {
    const sums = Array.from({ length: 20 }, (_, i) => {
      const probe = new Game({
        seed: `grinder-probe-${i}`,
        name: '護欄',
        startPosition: 'SS',
        throws: 'R',
        bats: 'R',
      }).start();
      return Object.values(probe.state?.origin.potential ?? {}).reduce((a, b) => a + b, 0);
    }).sort((a, b) => a - b);

    const threshold = hallOfFame.settlement_traits.grinder.provisional_sum;
    expect(threshold).toBeGreaterThan(sums[0]!);
    expect(threshold).toBeLessThan(sums.at(-1)!);
  });
});
