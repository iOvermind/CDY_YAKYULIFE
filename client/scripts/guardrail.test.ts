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
import {
  abilities,
  dataKeys,
  hallOfFame,
  leagues as leaguesData,
  season as seasonCfg,
  teams as teamsData,
} from '../src/data/index.ts';
import { baselineOps, proBaseline } from '../src/engine/metrics.ts';
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
    // 與校準腳本的策略必須一致——護欄與校準要看同一種玩家。
    const pick =
      options.find((o) => o.id === 'retire:stay') ??
      options.find((o) => o.id === 'transfer:stay') ??
      options.find((o) => o.id === 'term:long') ??
      options.find((o) => o.id === 'term:short') ??
      options.find((o) => o.id === 'fa:stay') ??
      options.find((o) => o.id === 'fa:crawl') ??
      options.find((o) => o.id === 'demote:accept') ??
      options.find((o) => o.id === 'fallback:0') ??
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

/**
 * 聯盟的基準環境。
 *
 * 這幾條看的是「這個聯盟像不像棒球」——它們不隨玩法變動，因此可以定得比
 * 分佈那幾條緊得多。
 */
describe('聯盟基準環境', () => {
  const base = proBaseline('CPBL1');

  it('聯盟平均 OPS 落在 .700–.800', () => {
    expect(baselineOps(base)).toBeGreaterThanOrEqual(0.7);
    expect(baselineOps(base)).toBeLessThanOrEqual(0.8);
  });

  it('聯盟平均防禦率落在 3.5–4.5', () => {
    expect(base.era).toBeGreaterThanOrEqual(3.5);
    expect(base.era).toBeLessThanOrEqual(4.5);
  });

  /**
   * 封閉聯盟裡「全聯盟得分 = 全聯盟失分」。打線推導出來的每場得分，換算成
   * 自責分之後必須與設定的聯盟平均防禦率相當——否則分數會憑空生出或消失，
   * ERA+ 與投手的份額全部會偏。
   */
  it('打線產出的分數與聯盟平均防禦率對得起來', () => {
    const runsPerGame = base.runsCreatedPerPa * seasonCfg.advanced.shares.team_pa_per_game;
    const impliedEra = runsPerGame / seasonCfg.pitching.runs_per_earned_run.value;
    expect(Math.abs(impliedEra - base.era)).toBeLessThan(0.5);
  });

  it('聯盟平均打擊率落在合理範圍', () => {
    expect(base.avg).toBeGreaterThan(0.23);
    expect(base.avg).toBeLessThan(0.3);
  });
});

/**
 * 介面用的能力分組必須是引擎分組的重新分割——同樣的能力，不多不少。
 *
 * 兩份資料並存是刻意的（引擎看投手側／野手側，介面要把打擊與守備分開），
 * 但並存就會漂：加了新能力卻忘記讓它出現在介面上，玩家就永遠加不到那一項。
 */
describe('顯示分組與引擎分組一致', () => {
  const engine = abilities.ability_groups;
  const display = abilities.display_groups;

  const sorted = (keys: readonly string[]) => [...keys].sort();

  it('顯示分組涵蓋全部能力，不多不少', () => {
    const all = sorted([...engine.shared, ...engine.pitcher, ...engine.fielder]);
    const shown = sorted(display.order.flatMap((g) => display.members[g] ?? []));
    expect(shown).toEqual(all);
  });

  it('沒有能力被重複列在兩組裡', () => {
    const shown = display.order.flatMap((g) => display.members[g] ?? []);
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('投手側的顯示分組與引擎的投手組完全相同', () => {
    expect(sorted(display.members['pitching'] ?? [])).toEqual(sorted(engine.pitcher));
  });

  it('打擊與守備合起來就是引擎的野手組', () => {
    const fielderSide = [...(display.members['batting'] ?? []), ...(display.members['fielding'] ?? [])];
    expect(sorted(fielderSide)).toEqual(sorted(engine.fielder));
  });

  it('每一組都有名字', () => {
    for (const g of display.order) expect(display.names[g]).toBeTruthy();
  });
});

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

/**
 * 球隊清單以**體系代碼**為鍵，不是層級代碼。
 *
 * 曾經發生過：美職的清單誤寫成 `MLB`（層級代碼）而不是 `MiLB`（體系代碼），
 * 結果是美職一份轉會報價都發不出來——抽不到球隊就不會 push，**靜默失敗**，
 * 而且真的轉過去會讓 initLeague 直接炸掉。
 */
describe('球隊清單涵蓋所有體系', () => {
  it('每個體系都有球隊', () => {
    for (const org of dataKeys(leaguesData.paths)) {
      expect(teamsData.leagues[org], `${org} 沒有球隊清單`).toBeDefined();
      expect((teamsData.leagues[org] ?? []).length).toBeGreaterThan(0);
    }
  });

  it('沒有多餘的清單掛在層級代碼上', () => {
    const orgs = new Set(dataKeys(leaguesData.paths));
    for (const key of dataKeys(teamsData.leagues)) {
      expect(orgs.has(key), `${key} 不是體系代碼`).toBe(true);
    }
  });

  it('每個體系的球隊數足夠抽出多份報價', () => {
    for (const org of dataKeys(leaguesData.paths)) {
      expect((teamsData.leagues[org] ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });
});
