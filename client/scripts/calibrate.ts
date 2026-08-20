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
import {
  abilities,
  awards as awardsCfg,
  dataKeys,
  hallOfFame,
  leagues,
  positions,
  season as seasonCfg,
} from '../src/data/index.ts';
import {
  applyTierFloors,
  difficultyOf,
  summarizeCareer,
  type CareerSummary,
  type SeasonRecord,
} from '../src/engine/career.ts';
import type { BattingLine, PitchingLine } from '../src/engine/amateurStats.ts';
import { Game, type GameSetup } from '../src/engine/game.ts';
import { battingShares, proBaseline, responsibilityOf, winPct } from '../src/engine/metrics.ts';
import type { Abilities } from '../src/engine/rating.ts';
import { World } from '../src/engine/rng.ts';
import { playSeason } from '../src/engine/season.ts';

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

/**
 * 策略綁定的起始守位。
 *
 * **投手路線必須開投手。** 起始守位平常輪流換，避免整批樣本都是同一種球員；
 * 但投手策略若照樣輪，五分之四的樣本會是野手在猛練投球能力，量出來的分佈
 * 與「一個投手生涯長什麼樣」毫無關係。
 */
const POLICY_POSITION: Partial<Record<PolicyName, 'P'>> = { pitcher: 'P' };

type PolicyName = keyof typeof POLICIES;

interface CareerResult {
  readonly summary: CareerSummary;
  readonly potentialSum: number;
  readonly awardCodes: readonly string[];
  readonly reachedTop: boolean;
  /**
   * 生涯期間看過的最高 `sta`。
   *
   * 出賽率量出來上不去的時候，這個數字分辨兩種完全不同的病：**公式壓著**
   * （sta 早就到 70 的飽和點，卻還是打不滿）與**沒人練到那裡**（配點策略
   * 根本不把點投在體力上）。前者調 `stamina_factor`，後者調策略或點數成本，
   * 修錯邊會把已經對的旋鈕轉壞。
   */
  readonly peakSta: number;
}

/** 跑完一局，回傳結算結果。 */
function runCareer(setup: GameSetup, policy: PolicyName, overseas: boolean): CareerResult {
  // **起始守位是投手就一定投手側投點**，不管策略名字叫什麼。養成期依起始守位鎖側
  // 之後（見 ADR 0009），P 起點只加得動 `sta`，其餘全被擋下；照策略表投野手能力
  // 等於把點數丟進水裡，那一局跑不到職業。鎖側之前這個破洞是靜悄悄的——P 起點照
  // 樣練野手能力，畢業時被判成野手——所以報表上的「投手 35%」長年顯示 0.0%。
  const order = setup.startPosition === 'P' ? POLICIES.pitcher : POLICIES[policy];
  const game = new Game(setup).start();

  let guard = 0;
  let cursor = 0;
  let peakSta = 0;
  while (game.flow.prompt !== null && guard++ < 8000) {
    peakSta = Math.max(peakSta, game.state?.ability['sta'] ?? 0);
    const options = game.flow.prompt.options;
    const rotated = [...order.slice(cursor % order.length), ...order];
    // 高中畢業的路口：基準線走選秀，旅外模式則直接簽出去。**不能靠「取第一個
    // 選項」矇對**——選項順序改一次，整批樣本就換成另一種生涯。
    const crossroads = overseas
      ? (options.find((o) => o.id === 'path:MiLB') ?? options.find((o) => o.id === 'path:NPB'))
      : options.find((o) => o.id === 'path:draft');
    const route = overseas
      ? (options.find((o) => o.id === 'transfer:0') ??
        options.find((o) => o.id === 'posting:ask') ??
        options.find((o) => o.id === 'posting:0'))
      : (options.find((o) => o.id === 'transfer:stay') ??
        options.find((o) => o.id === 'posting:wait'));
    const pick =
      // **身體開口的那一年就掛靴。** 那條機率原本是強制引退，代理若一律硬撐，
      // 每個人都會打到年齡上限，生涯長度與門檻一起漂掉。這一條必須排在下面
      // 那條「一律續戰」之前。
      (options.some((o) => o.id === 'retire:push')
        ? options.find((o) => o.id === 'retire:quit')
        : undefined) ??
      // 其餘時候一律續戰——「合理但不極致」的玩家不會主動掛靴。
      options.find((o) => o.id === 'retire:stay') ??
      // 旅外與否是校準的第二個維度。
      //
      // **預設不旅外**：轉會會把樣本拆到六個聯盟，而每個聯盟的門檻與難度係數
      // 都不同，混在一起就量不出「一個中職生涯長什麼樣」。
      //
      // 打開 `CALIBRATE_OVERSEAS=1` 則反過來，有機會就走——那組樣本量的是
      // **難度係數有沒有把聯盟水準的差距吃掉**：同一套玩法在不同聯盟落地，
      // 評價分應該落在同一個帶上，落差就是係數沒調好。
      crossroads ??
      options.find((o) => o.id === 'sign:0') ??
      route ??
      // 交易：一般球員保持沉默，明星點頭同意。抱怨與否決都是「情緒」玩法，
      // 不屬於基準線。
      options.find((o) => o.id === 'trade:silent') ??
      options.find((o) => o.id === 'trade:accept') ??
      // 合約：一律長約。短約是賭下次身價，那是「極致」的玩法。
      options.find((o) => o.id === 'term:long') ??
      options.find((o) => o.id === 'term:short') ??
      // 合約到期先與母隊談，不跳市場。
      options.find((o) => o.id === 'fa:stay') ??
      options.find((o) => o.id === 'fa:crawl') ??
      // 國家隊徵召：一律報到。列管期內本來就沒有選項，期滿之後婉拒是「保養
      // 身體」的極致玩法，不屬於基準線。
      options.find((o) => o.id === 'intl:go') ??
      // 感情：一律走「穩定」那條路——告白、公開、求婚、拒絕誘惑、風波吞下去。
      // 基準線是一個認真經營關係的人，不是浪子；外遇與分手的分佈要另外量。
      options.find((o) => o.id === 'love:confess') ??
      options.find((o) => o.id === 'love:admit') ??
      options.find((o) => o.id === 'love:propose') ??
      options.find((o) => o.id === 'love:decline') ??
      options.find((o) => o.id === 'love:swallow') ??
      options.find((o) => o.id === 'love:bring') ??
      // 事件卡一律照常執行。**不能讓代理每張都選全力一搏**——那是第一個選項，
      // 照順序挑就會挑到它，而「一年賭三次」不是「認真玩但沒查攻略」的樣子。
      options.find((o) => o.id === 'event:normal') ??
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
    peakSta: Math.max(peakSta, state?.ability['sta'] ?? 0),
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
/** 一條門檻的建議值，或是「門檻救不回來」的診斷。 */
type Suggestion =
  | { readonly kind: 'ok'; readonly value: number }
  /**
   * 光是被獎項保底送上來的人就填爆了配額。門檻**無論訂多高都沒有用**——那些人
   * 不是靠分數進來的。這種時候要改的是獎項取得率或保底規則，不是門檻。
   */
  | { readonly kind: 'overflow'; readonly floored: number; readonly quota: number };

function suggestThresholds(results: readonly CareerResult[]): readonly Suggestion[] {
  // 累進目標：名人堂 2%、含明星 10%、含每日 35%、含替補 75%
  const cumulative = [0.02, 0.1, 0.35, 0.75];
  const total = results.length;
  const floorOf = (r: CareerResult) =>
    applyTierFloors(Number.MAX_SAFE_INTEGER, new Set(r.awardCodes));

  return cumulative.map((target, tier) => {
    // 被保底送進這一帶（或更高）的人，不管門檻訂多少都會在這裡。
    const floored = results.filter((r) => floorOf(r) <= tier).length;
    const quota = Math.round(target * total);
    if (quota - floored <= 0) return { kind: 'overflow', floored, quota };

    const rest = results
      .filter((r) => floorOf(r) > tier)
      .map((r) => r.summary.leagues[0]?.score ?? 0)
      .sort((a, b) => b - a);
    const value = Math.round(rest[Math.min(rest.length - 1, quota - floored - 1)] ?? 0);
    return { kind: 'ok', value };
  });
}

/**
 * 累積型獎項的門檻線 vs 實際的份額分佈。
 *
 * 取得率本身看不出線該往哪動。這條線是 `base × 場次比例 × (1 ± band)` 的**常數**，
 * 沒有對手在裡面——所以只要成績模型整體平移，取得率就會跟著跑掉，而報表要能
 * 當場指出「線落在分佈的哪個分位」，才知道要移多少。
 *
 * 靶：這類獎是「聯盟第一名」。一個聯盟一年一座，所以**線該落在單季分佈的極右端**。
 */
function reportAwardLines(results: readonly CareerResult[]): void {
  console.log('\n── 累積型獎項的線 vs 單季份額分佈');
  console.log('  ※ 這類獎是「聯盟第一名」，線該落在單季分佈的極右端（p99 附近）。');

  const specs = [
    {
      name: 'batter_of_year',
      base: awardsCfg.batter_of_year.base,
      band: awardsCfg.batter_of_year.band,
      // 只看打擊那一段，與 game.ts 交給獎項判定的 battingWinShares 同一個口徑。
      pick: (s: SeasonRecord) => (s.batting === null ? null : s.shares.batting.win),
    },
    {
      name: 'mvp',
      base: awardsCfg.mvp.base,
      band: awardsCfg.mvp.band,
      pick: (s: SeasonRecord) =>
        s.shares.batting.win + s.shares.pitching.win + s.shares.fielding.win,
    },
  ];

  for (const spec of specs) {
    // 線是按聯盟場次等比放大的，所以份額也換算回 162 場的尺才能放在一起比。
    const vals: number[] = [];
    for (const r of results) {
      for (const s of r.summary.seasons) {
        const v = spec.pick(s);
        if (v === null) continue;
        vals.push((v * 162) / gamesOf(s.level));
      }
    }
    if (vals.length === 0) continue;
    vals.sort((a, b) => a - b);

    const lo = spec.base * (1 - spec.band);
    const hi = spec.base * (1 + spec.band);
    const over = (line: number) => vals.filter((v) => v >= line).length / vals.length;
    console.log(
      `  ${spec.name.padEnd(16)} 線 ${lo.toFixed(1)}～${hi.toFixed(1)}（base ${spec.base}）` +
        `　單季份額 p50 ${quantile(vals, 0.5).toFixed(1)}` +
        `　p90 ${quantile(vals, 0.9).toFixed(1)}` +
        `　p99 ${quantile(vals, 0.99).toFixed(1)}` +
        `　max ${(vals.at(-1) ?? 0).toFixed(1)}`,
    );
    console.log(
      `  ${' '.repeat(16)} 跨過下緣的球季佔 ${(over(lo) * 100).toFixed(1)}%` +
        `　跨過上緣 ${(over(hi) * 100).toFixed(1)}%` +
        `　→ 落在 p${((1 - over(spec.base)) * 100).toFixed(1)}`,
    );
  }
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
  const suggested = suggestThresholds(withPro);
  console.log(
    `  考慮保底後   ${suggested
      .map((s) => (s.kind === 'ok' ? String(s.value) : '　—　'))
      .join(' / ')}`,
  );
  console.log(`  現行         ${hallOfFame.tier_thresholds.values.join(' / ')}`);
  console.log('  ※ 純分位數會系統性偏低——保底規則把人從下面推上來，因此實際落在該帶的');
  console.log('     人永遠比分位數多。要用的是「考慮保底後」那一組。');
  suggested.forEach((s, i) => {
    if (s.kind !== 'overflow') return;
    console.log(
      `  ※「${labels[i]}」以上算不出門檻：光保底就 ${s.floored} 人，` +
        `配額只有 ${s.quota} 人（超額 ${s.floored - s.quota}）。` +
        `\n     這一帶**調門檻沒有用**，那些人不是靠分數進來的。要改獎項取得率或保底規則。`,
    );
  });
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

  reportAwardLines(withPro);

  console.log('\n── 份額三分量佔比（靶：打擊 50%／投球 35%／守備 15%）');
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
    batting: 50,
    pitching: 35,
    fielding: 15,
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

  console.log('');
}


/**
 * 單季極值的對照表：**人類在一個球季裡做到過的最高值**，換算到 162 場。
 *
 * 存在的理由是分級門檻在調之前，得先確認量出來的成績像不像真的球員成績——
 * 門檻是把分佈切段，切錯段的前提是分佈本身可信。這張表是那把尺。
 *
 * `cap` 是設計上限（能力全滿、162 場時的產出），`record` 是人類實際紀錄。
 * cap 略高於 record 是刻意的：紀錄是被打破過的東西，天花板該留一點餘裕。
 */
const SEASON_CAPS = {
  batting: {
    pa: { cap: 780, record: 778, of: (b: BattingLine) => b.pa },
    hits: { cap: 280, record: 262, of: (b: BattingLine) => b.hits },
    double: { cap: 70, record: 67, of: (b: BattingLine) => b.double },
    triple: { cap: 40, record: 36, of: (b: BattingLine) => b.triple },
    hr: { cap: 80, record: 73, of: (b: BattingLine) => b.hr },
    rbi: { cap: 180, record: 191, of: (b: BattingLine) => b.rbi },
    runs: { cap: 160, record: 198, of: (b: BattingLine) => b.runs },
    bb: { cap: 160, record: 232, of: (b: BattingLine) => b.bb },
    ibb: { cap: 120, record: 120, of: (b: BattingLine) => b.ibb },
    so: { cap: 240, record: 223, of: (b: BattingLine) => b.so },
    sb: { cap: 80, record: 130, of: (b: BattingLine) => b.sb },
  },
  pitching: {
    // 出賽與先發是**互斥**的極值：96 場是後援的極限，36 場先發是輪值的極限，
    // 沒有人同時逼近兩者。因此這兩列超標與否要分開看，不能當成同一種球員。
    games: { cap: 96, record: 106, of: (p: PitchingLine) => p.games },
    starts: { cap: 36, record: 36, of: (p: PitchingLine) => p.starts },
    局數: { cap: 240, record: 376, of: (p: PitchingLine) => p.outs / 3 },
    wins: { cap: 26, record: 27, of: (p: PitchingLine) => p.wins },
    losses: { cap: 22, record: 29, of: (p: PitchingLine) => p.losses },
    saves: { cap: 70, record: 62, of: (p: PitchingLine) => p.saves },
    holds: { cap: 50, record: 41, of: (p: PitchingLine) => p.holds },
    so: { cap: 400, record: 383, of: (p: PitchingLine) => p.so },
    bb: { cap: 130, record: 208, of: (p: PitchingLine) => p.bb },
    hits: { cap: 260, record: 373, of: (p: PitchingLine) => p.hits },
  },
} as const;

/**
 * 自責分是**下限**型的上限：它的極致是小，不是大，所以不能跟上面那些一起量。
 *
 * 基準是 220 局 40 分（ERA 1.64）。要比較的是**同樣的投球量**下失了多少分，
 * 因此量的是率不是量——只看投滿 150 局以上的球季，低於那個投球量的 ERA 是
 * 後援投手的量綱，混進來會假性刷新紀錄。人類紀錄取 Gibson 1968 的 1.12。
 */
const ER_FLOOR = { innings: 220, er: 40, era: (40 / 220) * 9, record: 1.12 } as const;

/** 某層級的球季場次。用來把不同聯盟的成績換算到同一把尺上。 */
function gamesOf(level: string): number {
  return leagues.levels[level]?.games ?? 162;
}

/**
 * 成績現實性報表。
 *
 * 分級分佈是「把成績切段」的結果，因此在動門檻之前必須先確認成績本身可信。
 * 這一段量三件事：率定數據的**離散度**（真實棒球裡強打者與巧打者差很多，
 * 若模擬把所有人擠在同一帶，那分級就只是在切雜訊）、換算到 162 場的**單季
 * 極值**（對照人類紀錄），以及**出賽率與生涯長度**（累積型的評價分對這兩者
 * 極度敏感——每個人都打滿十五年的話，人人都是名人堂）。
 */
function reportRealism(results: readonly CareerResult[]): void {
  const seasons = results.flatMap((r) => r.summary.seasons);
  const bat = seasons.filter((s) => s.batting !== null && s.batting.pa >= 200);
  const pit = seasons.filter((s) => s.pitching !== null && s.pitching.outs >= 150);

  console.log('\n── 成績現實性');

  const row = (name: string, vals: readonly number[], digits: number, real: string): void => {
    if (vals.length === 0) return;
    const sorted = [...vals].sort((a, b) => a - b);
    const cells = [0.1, 0.5, 0.9, 0.99]
      .map((p) => quantile(sorted, p).toFixed(digits).padStart(8))
      .join('');
    console.log(`  ${name.padEnd(9)}${cells}${(sorted.at(-1) ?? 0).toFixed(digits).padStart(8)}   ${real}`);
  };

  if (bat.length > 0) {
    console.log(`\n  打者單季率定（PA≥200，${bat.length} 季）`);
    console.log(`  ${''.padEnd(9)}${['p10', 'p50', 'p90', 'p99', 'max'].map((h) => h.padStart(8)).join('')}   真實對照`);
    const per600 = (pick: (b: ProBattingLine) => number) =>
      bat.map((s) => (pick(s.batting!) / s.batting!.pa) * 600);
    row('AVG', bat.map((s) => s.batting!.avg), 3, 'p10 .230 p50 .265 p90 .310');
    row('OPS', bat.map((s) => s.batting!.obp + s.batting!.slg), 3, 'p10 .650 p50 .740 p90 .880');
    row('HR/600', per600((b) => b.hr), 1, 'p10 3 p50 15 p90 33 max 73');
    row('BB/600', per600((b) => b.bb), 1, 'p10 30 p50 50 p90 85');
    row('SO/600', per600((b) => b.so), 1, 'p10 60 p50 110 p90 170');
    row('2B/600', per600((b) => b.double), 1, 'p10 15 p50 26 p90 40');
    row('SB/600', per600((b) => b.sb), 1, 'p10 1 p50 6 p90 28');
  }

  // 換算到 162 場的單季極值。只取夠格的球季——出賽 20 場的成績乘上八倍不是
  // 預測，是雜訊放大。
  //
  // **打者與投手的「夠格」不是同一件事。** 打者看出賽數佔球季的比例；投手不能
  // 這樣看，先發一年只上場三十幾場，用出賽過半去篩會把先發全部濾掉、只留後援
  // ——`starts` 那一欄就會整排是 0，看起來像引擎不會產生先發投手。投手的投球量
  // 記在局數上，所以投手的門檻是局數。
  const project = <L>(
    lines: readonly { level: string; line: L; qualifies: (leagueGames: number) => boolean }[],
    spec: Readonly<Record<string, { cap: number; record: number; of: (l: L) => number }>>,
    title: string,
  ): void => {
    const full = lines.filter((x) => x.qualifies(gamesOf(x.level)));
    if (full.length === 0) return;
    console.log(`\n  ${title}（換算 162 場，出賽過半的 ${full.length} 季）`);
    console.log(`  ${''.padEnd(9)}${['模擬p99', '模擬max', '設計上限', '人類紀錄'].map((h) => h.padStart(10)).join('')}`);
    for (const [name, s] of Object.entries(spec)) {
      const vals = full.map((x) => s.of(x.line) * (162 / gamesOf(x.level))).sort((a, b) => a - b);
      const p99 = quantile(vals, 0.99);
      const max = vals.at(-1) ?? 0;
      const flag = max > s.cap ? '  ← 破設計上限' : '';
      console.log(
        `  ${name.padEnd(9)}${[p99, max, s.cap, s.record].map((v) => v.toFixed(0).padStart(10)).join('')}${flag}`,
      );
    }
  };

  project(
    bat.map((s) => ({
      level: s.level,
      line: s.batting!,
      qualifies: (g: number) => s.batting!.games >= g * 0.5,
    })),
    SEASON_CAPS.batting,
    '打者單季極值（門檻：出賽過半）',
  );
  project(
    pit.map((s) => ({
      level: s.level,
      line: s.pitching!,
      // 每場球季 0.6 局，162 場即 100 局。後援投手也過得了這條線。
      qualifies: (g: number) => s.pitching!.outs >= g * 0.6 * 3,
    })),
    SEASON_CAPS.pitching,
    '投手單季極值（門檻：每場球季 0.6 局）',
  );

  // 自責分是反向的：極致是小。單獨一列。
  const eras = pit
    .filter((s) => s.pitching!.outs >= 450)
    .map((s) => (s.pitching!.er * 27) / s.pitching!.outs)
    .sort((a, b) => a - b);
  if (eras.length > 0) {
    console.log(`\n  ERA 下限（投滿 150 局的 ${eras.length} 季）`);
    console.log(
      `    p01 ${quantile(eras, 0.01).toFixed(2)}　min ${(eras[0] ?? 0).toFixed(2)}　` +
        `設計下限 ${ER_FLOOR.era.toFixed(2)}（${ER_FLOOR.innings} 局 ${ER_FLOOR.er} 分）　` +
        `人類紀錄 ${ER_FLOOR.record.toFixed(2)}`,
    );
  }

  // 出賽率：累積型的評價分吃的是這個數字，而不是率定數據。
  //
  // **健康季與傷缺季一定要分開量。** 混在一起的中位數同時被兩件事壓低——體力
  // 曲線與傷病頻率——而這兩件事該用不同的旋鈕修。拿混合後的數字去調
  // `stamina_factor`，等於把傷病的帳算到體力頭上。
  const rateRow = (label: string, pool: typeof bat, note: string): void => {
    const rates = pool.map((s) => (s.batting!.games / gamesOf(s.level)) * 100).sort((a, b) => a - b);
    if (rates.length === 0) return;
    console.log(
      `    ${label.padEnd(6)}p10 ${quantile(rates, 0.1).toFixed(0)}%　` +
        `p50 ${quantile(rates, 0.5).toFixed(0)}%　p90 ${quantile(rates, 0.9).toFixed(0)}%　` +
        `max ${(rates.at(-1) ?? 0).toFixed(0)}%　${note}`,
    );
  };
  const healthy = bat.filter((s) => s.seasonFactor >= 1);
  const hurt = bat.filter((s) => s.seasonFactor < 1);
  // 注意母體：這裡沿用 PA≥200 的濾網，所以賽季提前報銷的大傷根本不在裡面，
  // 「傷缺」這一列其實只有小傷。要看傷病的完整殺傷力得看生涯長度，不是這裡。
  console.log(`\n  出賽率（佔球季場次，PA≥200）　其中傷缺季佔 ${pct(hurt.length, bat.length)}`);
  rateRow('健康', healthy, '真實先發球員 p50 約 90%　← stamina_factor 只該對這一列負責');
  rateRow('傷缺', hurt, '');
  rateRow('全體', bat, '');

  // 出賽率上不去的時候，**先看有沒有人練到飽和點再動曲線**。sta 70 之後 staF
  // 停在 1.0，若樣本連 70 都摸不到，那出賽率低是配點的帳，不是體力曲線的帳。
  const stas = results.map((r) => r.peakSta).sort((a, b) => a - b);
  // 飽和點從設定檔讀，不要抄成常數——這個數字調過一次了（70 → 65），寫死的話
  // 報表會繼續拿舊的門檻算佔比，然後說謊。
  const anchors = seasonCfg.playing_time.stamina_factor.anchors;
  const sat = anchors[anchors.length - 1]!.sta;
  console.log(
    `\n  生涯最高 sta（全樣本）　p50 ${quantile(stas, 0.5).toFixed(0)}　` +
      `p90 ${quantile(stas, 0.9).toFixed(0)}　max ${(stas.at(-1) ?? 0).toFixed(0)}　` +
      `　飽和點 ${sat}（之後改換免傷）　達標佔比 ${pct(stas.filter((s) => s >= sat).length, stas.length)}`,
  );

  // 生涯長度。**這一項對分級分佈的影響遠大於任何率定數據**——累積型的分數
  // 裡，年資本身就是分數。真實 MLB 約半數的登板者打不到三季。
  // 同一年可能有兩列（季中轉隊、升降級），所以數的是**不重複的年份**而不是列數。
  const proYears = results
    .filter((r) => r.summary.seasons.length > 0)
    .map((r) => new Set(r.summary.seasons.map((s) => s.year)).size)
    .sort((a, b) => a - b);
  if (proYears.length > 0) {
    console.log('\n  職業生涯年數（母體：有職業出賽紀錄）');
    console.log(
      `    p10 ${quantile(proYears, 0.1).toFixed(0)}　p50 ${quantile(proYears, 0.5).toFixed(0)}　` +
        `p90 ${quantile(proYears, 0.9).toFixed(0)}　max ${proYears.at(-1)}`,
    );
    for (const b of [3, 5, 10, 15, 20]) {
      const n = proYears.filter((x) => x >= b).length;
      const real = { 3: '~50%', 5: '~35%', 10: '~20%', 15: '~5%', 20: '~1%' }[b];
      console.log(`    ≥${String(b).padStart(2)} 季 ${pct(n, proYears.length).padStart(7)}　真實 MLB ${real}`);
    }
  }
}

/**
 * 跨聯盟的報表。
 *
 * 這是難度係數唯一量得出來的地方：**同一套玩法在不同聯盟落地，評價分應該落在
 * 同一個帶上**。日職生涯的中位數若系統性高於中職，那不是日職比較好混，是難度
 * 係數把水準差距補過頭了。
 *
 * 只在旅外模式跑——不旅外的樣本裡除了中職什麼都沒有。
 */
function reportLeagues(results: readonly CareerResult[]): void {
  const byOrg = new Map<
    string,
    { name: string; scores: number[]; perSeason: number[]; winPcts: number[]; seasons: number }
  >();
  for (const r of results) {
    for (const league of r.summary.leagues) {
      const row = byOrg.get(league.org) ?? {
        name: league.orgName,
        scores: [],
        perSeason: [],
        winPcts: [],
        seasons: 0,
      };
      row.scores.push(league.score);
      // **每季評價分才是難度係數的指標。** 生涯總分同時受年數影響，旅外的人在
      // 每個聯盟都只待幾年，總分當然低——那是生涯形狀的問題，不是係數的問題。
      if (league.seasons > 0) row.perSeason.push(league.score / league.seasons);
      // 份額勝率是**不受出賽量與年數影響**的水位計，用來分辨兩件常被混為一談
      // 的事：分數低是因為在那邊只是邊緣人（勝率低），還是因為難度係數沒有
      // 把聯盟水準的差距補回來（勝率相當、分數卻差一截）。
      row.winPcts.push(winPct(league.shares));
      row.seasons += league.seasons;
      byOrg.set(league.org, row);
    }
  }

  console.log('── 跨聯盟（旅外模式）');
  console.log('  同一套玩法在不同聯盟落地，中位數應該互相接近——那正是難度係數要做的事。');
  const rows = [...byOrg.entries()].sort((a, b) => b[1].scores.length - a[1].scores.length);
  for (const [org, row] of rows) {
    const sorted = [...row.scores].sort((a, b) => a - b);
    const per = [...row.perSeason].sort((a, b) => a - b);
    const wp = [...row.winPcts].sort((a, b) => a - b);
    console.log(
      `  ${row.name.padEnd(6)}（${org.padEnd(4)}）` +
        `生涯 ${String(sorted.length).padStart(4)} 段` +
        `　平均 ${(row.seasons / Math.max(1, sorted.length)).toFixed(1).padStart(4)} 季` +
        `　總分 p50 ${quantile(sorted, 0.5).toFixed(0).padStart(4)}` +
        `　每季 p25 ${quantile(per, 0.25).toFixed(1).padStart(5)}` +
        `　p50 ${quantile(per, 0.5).toFixed(1).padStart(5)}` +
        `　p90 ${quantile(per, 0.9).toFixed(1).padStart(5)}` +
        `　份額勝率 p50 ${quantile(wp, 0.5).toFixed(3)}`,
    );
  }
  console.log('  ※ 段數少的聯盟中位數噪音大，要看的是段數夠多的那幾個。');
  console.log('     要比的是「每季」那三欄——總分低多半只代表待得短。');
  console.log('     份額勝率相當、每季分數卻差一截，才是難度係數沒調好。');
  console.log('');
}

/** 全能力一律設成同一個數字的受試者。難度實驗要的是「同一個人」。 */
function uniformAbility(value: number): Abilities {
  const out: Record<string, number> = {};
  for (const key of dataKeys(abilities.abilities)) out[key] = value;
  return out as Abilities;
}

/**
 * 難度係數的實驗。
 *
 * 這是唯一乾淨的量法：**同一個能力值，在每個頂級聯盟各打一批球季**。生涯樣本
 * 量不出來，因為旅外的人在新聯盟一律是邊緣人（落地規則就是 `min + 4`），分數
 * 低是選擇效應而不是係數不準——那兩件事在生涯報表裡混在一起。
 *
 * 判準：能力相同的人在弱聯盟宰制力更強、原始份額更高，乘上難度係數之後**應該
 * 拉回同一條水平線**。剩下的落差就是指數沒調好。
 */
function reportDifficulty(): void {
  const SAMPLES = 400;

  console.log('── 難度係數（各聯盟各打一批球季）');
  console.log(`  每個聯盟 ${SAMPLES} 季。兩組受試者回答兩個不同的問題——`);
  console.log('    絕對能力組：同一個人到處打，量的是「同一個人在弱聯盟是不是更威」。');
  console.log('    相對能力組：每個聯盟都取比平均高 6 分的人，量的是**聯盟自我參照留下的虛胖**。');
  console.log('    後者若已經齊平，難度係數就不是在壓虛胖，而是在宣告「強聯盟的一季比較值錢」。');

  difficultyGroup('絕對能力組（全能力 58）', SAMPLES, true);
  difficultyGroup('相對能力組（各聯盟 par＋6）', SAMPLES, false);
  console.log('');
}

/** 難度實驗的一組樣本。`absolute` 為真時全聯盟共用同一個能力值。 */
function difficultyGroup(label: string, SAMPLES: number, absolute: boolean): void {
  console.log(`
  ${label}`);
  const rows: {
    level: string;
    name: string;
    par: number;
    games: number;
    raw: number;
    perGame: number;
    adjusted: number;
  }[] = [];
  for (const level of dataKeys(leagues.levels)) {
    const info = leagues.levels[level];
    if (info === undefined || info.top === undefined) continue;

    const overall = absolute ? 58 : info.par + 6;
    const ability = uniformAbility(overall);
    const world = new World(`difficulty-${level}`);
    let raw = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const line = playSeason(world, {
        level,
        ability,
        position: 'CF',
        overall,
        better: 'fielder',
        twoWay: false,
        standards: null,
      });
      if (line.batting === null) continue;
      // 看的是**勝利份額**，不是責任額——責任額只是出賽量的換算，每場一定
      // 相等，量它等於量行事曆。「弱聯盟虛胖」講的是勝利份額。
      //
      // 只取打擊一項：三個分段各有各的雜訊，混在一起看不出係數的走向。
      raw += battingShares(line.batting, proBaseline(level), null).win;
    }
    const mean = raw / SAMPLES;
    rows.push({
      level,
      name: info.name,
      par: info.par,
      games: info.games,
      raw: mean,
      // **每場才比得下去。** 份額本來就隨球季長度累積，大聯盟一季 162 場、
      // 澳職四十幾場，不除掉場次的話量到的是行事曆不是難度。
      perGame: (mean / info.games) * 100,
      adjusted: (mean / info.games) * 100 * difficultyOf(info.par),
    });
  }

  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(6)}（par ${String(r.par).padStart(2)}｜${String(r.games).padStart(3)} 場）` +
        `　每季 ${r.raw.toFixed(2).padStart(6)}` +
        `　每百場 ${r.perGame.toFixed(2).padStart(6)}` +
        `　×難度 ${r.adjusted.toFixed(2).padStart(6)}`,
    );
  }
  const ratio = (pick: (r: (typeof rows)[number]) => number): number => {
    const list = rows.map(pick);
    return Math.max(...list) / Math.max(0.001, Math.min(...list));
  };
  console.log(
    `  最大／最小比　修正前 ${ratio((r) => r.perGame).toFixed(2)}` +
      `　修正後 ${ratio((r) => r.adjusted).toFixed(2)}（越接近 1.00 越好）`,
  );
  // 掃一遍指數，找出把這一組壓得最平的值。這是「正式值由校準腳本決定」那句話
  // 真正兌現的地方。
  let bestExp = 0;
  let bestSpread = Number.POSITIVE_INFINITY;
  for (let e = 0; e <= 4.001; e += 0.05) {
    const adj = rows.map((r) => r.perGame * Math.pow(r.par / hallOfFame.difficulty.reference_par, e));
    const spread = Math.max(...adj) / Math.max(0.001, Math.min(...adj));
    if (spread < bestSpread) {
      bestSpread = spread;
      bestExp = e;
    }
  }
  console.log(
    `  現行 exponent = ${hallOfFame.difficulty.exponent}` +
      `　｜壓得最平的 exponent = ${bestExp.toFixed(2)}（比 ${bestSpread.toFixed(2)}）`,
  );
  console.log('  ※ 修正後比修正前更離散，就代表係數在反方向加碼。');
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
      const overseas = argOf('overseas', '') !== '';
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
              // 起始守位輪流換，避免整批樣本都是同一種球員——除非策略綁死了守位。
              //
              // **野手策略的輪替不能含 P。** 起始守位是 P 就會被上面那條強制換成投手
              // 配點（見 runCareer），因此舊的五格輪替讓 balanced／slugger／glove 三份
              // 樣本各有五分之一其實是投手。打者的成績分佈是拿八成打者混兩成投手量
              // 出來的，兩邊的量綱根本不同。投手有自己的一支策略，不必混進來。
              startPosition:
                POLICY_POSITION[policy] ?? (['SS', 'CF', 'C', '2B', '1B'] as const)[i % 5]!,
              throws: 'R',
              bats: 'R',
            },
            policy,
            overseas,
          ),
        );
      }
    report(results, policy, runs);
    reportRealism(results);
    if (overseas) reportLeagues(results);
    reportDifficulty();
  });
});
