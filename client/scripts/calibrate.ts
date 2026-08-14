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
import { abilities, dataKeys, hallOfFame, leagues, positions } from '../src/data/index.ts';
import {
  applyTierFloors,
  difficultyOf,
  summarizeCareer,
  type CareerSummary,
} from '../src/engine/career.ts';
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
}

/** 跑完一局，回傳結算結果。 */
function runCareer(setup: GameSetup, policy: PolicyName, overseas: boolean): CareerResult {
  const order = POLICIES[policy];
  const game = new Game(setup).start();

  let guard = 0;
  let cursor = 0;
  while (game.flow.prompt !== null && guard++ < 8000) {
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
              startPosition:
                POLICY_POSITION[policy] ?? (['SS', 'CF', 'C', '1B', 'P'] as const)[i % 5]!,
              throws: 'R',
              bats: 'R',
            },
            policy,
            overseas,
          ),
        );
      }
    report(results, policy, runs);
    if (overseas) reportLeagues(results);
    reportDifficulty();
  });
});
