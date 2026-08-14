/**
 * 平衡校準腳本。
 *
 * 跑大量無人生涯，量出分級分佈、份額三分量的佔比、獎項取得率與潛力分佈，
 * 用來決定那些「暫定值」該設成多少。校準結果**人工**寫回 JSON——這支腳本
 * 只負責量，不負責改。
 *
 * 它**不是測試**：跑幾千局要好幾分鐘，不該進 `npm test` 的例行套件。因此
 * 檔名刻意不叫 `.test.ts`，預設的 vitest include 掃不到它。
 *
 *     npm run calibrate                                   # 預設 400 局、balanced 策略
 *     CALIBRATE_RUNS=2000 npm run calibrate               # bash
 *     $env:CALIBRATE_RUNS=2000; npm run calibrate         # PowerShell
 *     CALIBRATE_POLICY=slugger npm run calibrate
 *
 * 例行套件裡另有一組輕量護欄測試（`scripts/guardrail.test.ts`），跑幾百局並
 * 斷言分佈落在寬鬆區間內——防止有人把平衡改到天翻地覆而沒人發現。
 *
 * 為什麼用 vitest 跑：規則資料是 JSON import，需要 Vite 的處理管線。純 node
 * 跑不動，而為了一支腳本另外裝一個 TypeScript 執行器不划算。
 */

import { describe, it } from 'vitest';
import { hallOfFame, positions } from '../src/data/index.ts';
import { applyTierFloors, summarizeCareer, type CareerSummary } from '../src/engine/career.ts';
import { Game, type GameSetup } from '../src/engine/game.ts';
import { responsibilityOf } from '../src/engine/metrics.ts';

/**
 * 模擬玩家的策略。
 *
 * **校準必須挑一個策略並固定它**——分佈完全取決於玩家怎麼玩。全部亂選的話
 * 沒人進得了名人堂，最佳解玩法則人人都是名人堂。
 *
 * `balanced` 是校準的基準：接近一個認真玩但沒有查攻略的人——攻守輪流投點、
 * 事件卡照常、選秀不拒絕、被下放不引退。
 */
const POLICIES = {
  /** 攻守兼備，並且練體力（體力換出賽數，出賽數換累積數據）。 */
  balanced: ['sta', 'con', 'rng', 'pow', 'fld', 'eye'],
  /** 只練打擊。守備與出賽數都會吃虧。 */
  slugger: ['pow', 'con', 'eye', 'spd'],
  /** 只練守備。綜合能力上不去，通常卡在二軍。 */
  glove: ['rng', 'fld', 'arm', 'sta'],
  /** 投手路線。 */
  pitcher: ['sta', 'vel', 'ctl', 'swp', 'drp'],
} as const;

type PolicyName = keyof typeof POLICIES;

interface CareerResult {
  readonly summary: CareerSummary;
  readonly potentialSum: number;
  readonly awardCodes: readonly string[];
  readonly reachedTop: boolean;
}

/** 跑完一局，回傳結算結果。 */
function runCareer(setup: GameSetup, policy: PolicyName): CareerResult {
  const order = POLICIES[policy];
  const game = new Game(setup).start();

  let guard = 0;
  let cursor = 0;
  while (game.flow.prompt !== null && guard++ < 8000) {
    const options = game.flow.prompt.options;
    const rotated = [...order.slice(cursor % order.length), ...order];
    const pick =
      // 被下放或高齡時一律續戰——「合理但不極致」的玩家不會主動掛靴。
      options.find((o) => o.id === 'retire:stay') ??
      // **不旅外**。這是刻意的基準線：轉會會把樣本拆到六個聯盟，而每個聯盟的
      // 門檻與難度係數都不同，混在一起就量不出「一個中職生涯長什麼樣」。
      // 旅外的分佈要另外用專屬策略量。
      options.find((o) => o.id === 'transfer:stay') ??
      // 合約：一律長約。短約是賭下次身價，那是「極致」的玩法。
      options.find((o) => o.id === 'term:long') ??
      options.find((o) => o.id === 'term:short') ??
      // 合約到期先與母隊談，不跳市場。
      options.find((o) => o.id === 'fa:stay') ??
      options.find((o) => o.id === 'fa:crawl') ??
      // 被下放就接受；被釋出則接受最好的那條退路。
      options.find((o) => o.id === 'demote:accept') ??
      options.find((o) => o.id === 'fallback:0') ??
      rotated
        .map((key) => options.find((o) => o.id === `alloc:${key}`))
        .find((o) => o !== undefined) ??
      options.find((o) => o.id === 'alloc:confirm') ??
      options.find((o) => o.id === 'draft:accept') ??
      options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
      options[0];
    if (pick === undefined) break;
    if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') cursor++;
    game.choose(pick.id);
  }

  const state = game.state;
  const summary = game.summary ?? summarizeCareer([], []);

  return {
    summary,
    potentialSum: Object.values(state?.origin.potential ?? {}).reduce((a, b) => a + b, 0),
    awardCodes: (state?.awards ?? []).map((a) => a.code),
    reachedTop: summary.leagues.length > 0,
  };
}

/** 取分位數。 */
function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
}

/**
 * 算出能真正produce目標分佈的門檻。
 *
 * 純分位數不夠用：保底規則會把拿過獎的人從下面推上來，因此實際落在某一帶的
 * 人永遠比分位數多。作法是把「已經被保底送進這一帶或更高」的人先挑掉，剩下
 * 的人才用分數排序去填滿剩餘的名額。
 */
function suggestThresholds(results: readonly CareerResult[]): readonly number[] {
  // 累進目標：名人堂 2%、含明星 10%、含每日 35%、含替補 75%
  const cumulative = [0.02, 0.1, 0.35, 0.75];
  const total = results.length;

  return cumulative.map((target, tier) => {
    const floorOf = (r: CareerResult) =>
      applyTierFloors(Number.MAX_SAFE_INTEGER, new Set(r.awardCodes));

    // 被保底送進這一帶（或更高）的人，不管門檻訂多少都會在這裡。
    const free = results.filter((r) => floorOf(r) <= tier).length;
    const slots = Math.round(target * total) - free;
    if (slots <= 0) return Number.NaN;

    const rest = results
      .filter((r) => floorOf(r) > tier)
      .map((r) => r.summary.leagues[0]?.score ?? 0)
      .sort((a, b) => b - a);
    return Math.round(rest[Math.min(rest.length - 1, slots - 1)] ?? 0);
  });
}

/** 產出校準報表。 */
function report(results: readonly CareerResult[], policy: PolicyName, runs: number): void {
  const withPro = results.filter((r) => r.reachedTop);
  const labels = hallOfFame.tier_thresholds.labels;
  const tiers = new Array(labels.length).fill(0) as number[];
  for (const r of withPro) tiers[r.summary.bestTier] = (tiers[r.summary.bestTier] ?? 0) + 1;

  const scores = withPro
    .map((r) => r.summary.leagues[0]?.score ?? 0)
    .sort((a, b) => a - b);

  console.log(`\n═══ 校準報表 · 策略 ${policy} · ${runs} 局 ═══`);
  console.log(`進得了頂級聯盟：${withPro.length} / ${runs}（${pct(withPro.length, runs)}）`);

  console.log('\n── 分級分佈（母體：有職業出賽紀錄的生涯）');
  const TARGET = [2, 8, 25, 40, 25];
  labels.forEach((label, i) => {
    const actual = ((tiers[i] ?? 0) / Math.max(1, withPro.length)) * 100;
    const target = TARGET[i] ?? 0;
    const gap = actual - target;
    console.log(
      `  ${label.padEnd(4)} 目標 ${String(target).padStart(3)}%　實際 ${actual.toFixed(1).padStart(5)}%` +
        `　${gap > 0 ? '＋' : '−'}${Math.abs(gap).toFixed(1)}`,
    );
  });

  console.log('\n── 建議門檻');
  const naive = [0.98, 0.9, 0.65, 0.25].map((p) => Math.round(quantile(scores, p)));
  console.log(`  純分位數     ${naive.join(' / ')}`);
  console.log(`  考慮保底後   ${suggestThresholds(withPro).join(' / ')}`);
  console.log(`  現行         ${hallOfFame.tier_thresholds.values.join(' / ')}`);
  console.log('  ※ 純分位數會系統性偏低——保底規則把人從下面推上來，因此實際落在該帶的');
  console.log('     人永遠比分位數多。要用的是「考慮保底後」那一組。');
  console.log(
    `  評價分分位　p10 ${quantile(scores, 0.1).toFixed(0)}` +
      `　p50 ${quantile(scores, 0.5).toFixed(0)}` +
      `　p90 ${quantile(scores, 0.9).toFixed(0)}` +
      `　p99 ${quantile(scores, 0.99).toFixed(0)}`,
  );

  console.log('\n── 獎項取得率（每局至少拿過一次的比例）');
  const awardRuns = new Map<string, number>();
  const awardTotal = new Map<string, number>();
  for (const r of withPro) {
    for (const code of new Set(r.awardCodes)) awardRuns.set(code, (awardRuns.get(code) ?? 0) + 1);
    for (const code of r.awardCodes) awardTotal.set(code, (awardTotal.get(code) ?? 0) + 1);
  }
  for (const [code, count] of [...awardRuns].sort((a, b) => b[1] - a[1])) {
    const perCareer = (awardTotal.get(code) ?? 0) / Math.max(1, withPro.length);
    console.log(
      `  ${code.padEnd(18)} ${pct(count, withPro.length).padStart(6)}　平均每局 ${perCareer.toFixed(2)} 座`,
    );
  }
  console.log(
    '  ※ 獎項保底規則會直接決定分級分佈——拿過 MVP 或年度最佳投手就保到明星帶。',
  );
  console.log('     明星帶超標時要先看這裡，不是先調門檻。');

  console.log('\n── 份額三分量佔比（靶：打擊 52%／投球 32%／守備 16%）');
  const parts = { batting: 0, pitching: 0, fielding: 0 };
  for (const r of withPro) {
    for (const league of r.summary.leagues) {
      parts.batting += responsibilityOf(league.sharesByPart.batting);
      parts.pitching += responsibilityOf(league.sharesByPart.pitching);
      parts.fielding += responsibilityOf(league.sharesByPart.fielding);
    }
  }
  const partTotal = parts.batting + parts.pitching + parts.fielding;
  const TARGET_PARTS: Readonly<Record<string, number>> = {
    batting: 52,
    pitching: 32,
    fielding: 16,
  };
  const PART_LABEL: Readonly<Record<string, string>> = {
    batting: '打擊',
    pitching: '投球',
    fielding: '守備',
  };
  for (const key of ['batting', 'pitching', 'fielding'] as const) {
    const actual = (parts[key] / Math.max(1, partTotal)) * 100;
    console.log(
      `  ${PART_LABEL[key]}　目標 ${String(TARGET_PARTS[key]).padStart(2)}%` +
        `　實際 ${actual.toFixed(1).padStart(5)}%`,
    );
  }
  console.log(
    '  ※ 這個佔比隨玩法變動——純投手的樣本裡打擊當然是 0。校準守備係數時要用' +
      'balanced 策略的數字。',
  );

  console.log('\n── 初始潛力總和（grinder 的門檻依據）');
  const potentials = results.map((r) => r.potentialSum).sort((a, b) => a - b);
  const target = hallOfFame.settlement_traits.grinder.percentile;
  console.log(
    `  p10 ${quantile(potentials, 0.1).toFixed(0)}` +
      `　p25 ${quantile(potentials, 0.25).toFixed(0)}` +
      `　p50 ${quantile(potentials, 0.5).toFixed(0)}` +
      `　p90 ${quantile(potentials, 0.9).toFixed(0)}`,
  );
  console.log(
    `  目標分位 ${(target * 100).toFixed(0)}% → 建議 provisional_sum = ${quantile(potentials, target).toFixed(0)}` +
      `（現行 ${hallOfFame.settlement_traits.grinder.provisional_sum}）`,
  );

  console.log('\n── 守位分佈（守位門檻的校準依據）');
  console.log(`  守位門檻目前是暫定值，正式值要把各守位的守備分分布放在同一個分位數上。`);
  console.log(`  現行 margin = ${positions.defense_average.margin}`);

  console.log('\n※ 提醒：責任額目前只看場次、不看球隊戰績（0 勝的球隊照樣有勝利份額）。');
  console.log('   那條修正會改變整套公式的參照基準，屆時全部門檻與係數都要重跑一次。\n');
}

/**
 * 取參數。
 *
 * 走環境變數而不是命令列旗標——vitest 的 CLI 會拒絕它不認得的旗標，因此
 * `npm run calibrate -- --runs=2000` 會直接炸掉。
 */
function argOf(name: string, fallback: string): string {
  return process.env[`CALIBRATE_${name.toUpperCase()}`] ?? fallback;
}

describe('校準', () => {
  it('跑出報表', { timeout: 900_000 }, () => {
      const runs = Number(argOf('runs', '400'));
      const policy = argOf('policy', 'balanced') as PolicyName;
      if (POLICIES[policy] === undefined) {
        throw new Error(`未知的策略：${policy}（可用：${Object.keys(POLICIES).join('、')}）`);
      }

      const results: CareerResult[] = [];
      for (let i = 0; i < runs; i++) {
        results.push(
          runCareer(
            {
              seed: `calib-${policy}-${i}`,
              name: '校準員',
              // 起始守位輪流換，避免整批樣本都是同一種球員。
              startPosition: (['SS', 'CF', 'C', '1B', 'P'] as const)[i % 5]!,
              throws: 'R',
              bats: 'R',
            },
            policy,
          ),
        );
      }
    report(results, policy, runs);
  });
});
