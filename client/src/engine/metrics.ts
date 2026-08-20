/**
 * 進階指標：ERA+、OPS+、Win Shares。
 *
 * 三者都要跟「聯盟平均」比，因此核心是 `baseline()`——它用各項率的 base 值
 * （定義上就是「與聯盟同水準時的值」）組出一條聯盟平均的成績列。**基準線是
 * 算出來的，不是另外抄一份數字**，否則調整率的設定時基準線會偷偷失準。
 *
 * 這裡不抽任何亂數，全部是純函數。
 */

import { amateur, season as cfg } from '../data/index.ts';
import { innings, type BattingLine, type PitchingLine } from './amateurStats.ts';
import { standardOf, type LeagueStandards } from './league.ts';
import { levelOf } from './season.ts';

/** 聯盟平均：一名平均球員的打擊率、上壘率、長打率與防禦率。 */
export interface Baseline {
  /** 打擊率。年度獎項的門檻要跟它比，因此基準線必須帶著它。 */
  readonly avg: number;
  readonly obp: number;
  readonly slg: number;
  readonly era: number;
  /** 每個打席創造的分數，用於 Win Shares 的替代水準。 */
  readonly runsCreatedPerPa: number;
}

/**
 * 基本得分創造（Runs Created）。
 *
 * `RC = 上壘次數 × 壘打數 ÷ (打數 + 保送)`——Bill James 最早的那個版本。
 * 用最基本的形式是刻意的：它只需要我們已經有的欄位，而且看得懂。
 */
export function runsCreated(line: BattingLine): number {
  const onBase = line.hits + line.bb + line.ibb;
  const single = line.hits - line.double - line.triple - line.hr;
  const totalBases = single + line.double * 2 + line.triple * 3 + line.hr * 4;
  const denominator = line.ab + line.bb + line.ibb;
  return denominator === 0 ? 0 : (onBase * totalBases) / denominator;
}

/**
 * 職業聯盟的平均水準。
 *
 * **刻意與層級無關。** 聯盟平均是自我參照的——3A 與大聯盟的聯盟打擊率都在
 * .260 上下，不因難度而異。難度的差別落在球員的 d 值上（弱聯盟 d 大、成績
 * 漂亮），因此跨聯盟比較要靠難度係數修正，不能靠移動基準線。見 ADR 0003。
 */
export function proBaseline(level: string): Baseline {
  return proBaselineAt(level, 0);
}

/**
 * 能力比聯盟平均高 `d` 點的球員，打出來的成績長什麼樣。
 *
 * 用來推導**替代水準的勝率**：把 d 設成「當年 min 減當年 par」，算出的基準線
 * 就是一個剛好卡在降級線上的球員。生涯評價分的零點定在那裡（ADR 0003）。
 */
export function proBaselineAt(level: string, d: number): Baseline {
  const line = proLineAt(d, 600);
  return build(
    line.pa,
    line.ab,
    line.bb,
    line.hits,
    line.double,
    line.triple,
    line.hr,
    rateAt(cfg.pitching.era, d),
    levelOf(level).name,
  );
}

/**
 * 能力比聯盟平均高 `d` 點的球員，在給定打席數下的成績單。
 *
 * `proBaselineAt` 只回傳率，因為它的用途是「跟聯盟平均比」。但累積型的獎項與
 * 勝利份額問的是**總量**，那需要打席數，而打席數本身就是能力的函數——排得越
 * 前面站得越多次。所以這裡把整條成績單交出去，率型的那支反過來用它。
 *
 * 打點、盜壘、得分、三振也在裡面。`playSeason` 算這四項時沒有另外的機制——
 * 打點是安打與全壘打的線性組合，盜壘是上壘數乘企圖率再乘成功率，全都是同一
 * 組率吃同一個 d。既然那邊算得出來，這邊就算得出來，只是少了亂數而已。
 */
export function proLineAt(d: number, pa: number): BattingLine {
  const b = cfg.batting;
  const bb = pa * rateAt(b.walk_rate, d);
  const ab = pa - bb;
  const hits = ab * rateAt(b.hit_rate, d);
  const hr = ab * rateAt(b.hr_rate, d);
  const rest = hits - hr;
  const double = rest * rateAt(b.extra_base.double_rate, d);
  const triple = rest * rateAt(b.extra_base.triple_rate, d);

  const rbi = hits * b.rbi_per_hit + hr * b.rbi_per_hr_extra;
  const onBase = hits + bb;
  const sb = onBase * rateAt(b.steal.attempt_rate, d) * rateAt(b.steal.success_rate, d);
  const runs = onBase * rateAt(b.runs_per_time_on_base, d);
  const so = ab * rateAt(b.strikeout_rate, d);

  return {
    pa,
    ab,
    bb,
    ibb: 0,
    hits,
    double,
    triple,
    hr,
    rbi,
    sb,
    runs,
    so,
  } as unknown as BattingLine;
}

/**
 * 野手的總份額，由打擊份額反推。
 *
 * 野手拿打擊與守備兩本帳，投球那本是 0。三本帳的責任額比例是固定的，所以
 * 「打擊份額 ÷ 打擊佔比 × (打擊 + 守備)」就是一個守備中庸的野手該有的總數。
 * MVP 的門檻線要的是總份額，而我們只推導得出打擊那本，缺口靠這裡補。
 */
export function positionPlayerShares(battingWin: number): number {
  const s = cfg.advanced.shares.split;
  return (battingWin * (s.batting + s.fielding)) / s.batting;
}

/** 能力比聯盟平均高 `d` 點的球員，一季站幾次打擊區。 */
export function proPaAt(d: number, leagueGames: number): number {
  const s = cfg.playing_time.pa_per_game;
  const per = Math.max(s.min, Math.min(s.max, s.at_par + d * s.per_point));
  return per * leagueGames;
}

/** 一條率在 d 值下的值，套上該率自己的上下限。 */
function rateAt(
  spec: { base: number; per_point: number; min: number; max: number },
  d: number,
): number {
  return Math.max(spec.min, Math.min(spec.max, spec.base + d * spec.per_point));
}

/** 養成期的平均水準。門檻與職業不同，因此基準線也不同。 */
export function amateurBaseline(): Baseline {
  const b = amateur.amateur_stats.batting;
  const pa = 600;
  const bb = pa * b.walk_rate.base;
  const ab = pa - bb;
  const hits = ab * b.hit_rate.base;
  const hr = hits * b.hr_rate.base;
  const rest = hits - hr;
  const double = rest * b.double_rate.base;
  const triple = rest * b.triple_rate.base;
  return build(pa, ab, bb, hits, double, triple, hr, amateur.amateur_stats.pitching.era.base, '');
}

function build(
  pa: number,
  ab: number,
  bb: number,
  hits: number,
  double: number,
  triple: number,
  hr: number,
  era: number,
  _label: string,
): Baseline {
  const single = hits - double - triple - hr;
  const totalBases = single + double * 2 + triple * 3 + hr * 4;
  const line = {
    hits,
    bb,
    ibb: 0,
    double,
    triple,
    hr,
    ab,
  } as unknown as BattingLine;
  return {
    avg: ab === 0 ? 0 : hits / ab,
    obp: pa === 0 ? 0 : (hits + bb) / pa,
    slg: ab === 0 ? 0 : totalBases / ab,
    era,
    runsCreatedPerPa: pa === 0 ? 0 : runsCreated(line) / pa,
  };
}

/**
 * ERA+：相對聯盟平均的防禦率，100 是聯盟平均，越高越好。
 *
 * 沒有投球局數就沒有意義，回傳 null 而不是 0——0 會被誤讀成「差到極點」。
 */
export function eraPlus(line: PitchingLine, base: Baseline): number | null {
  if (line.outs === 0 || line.era === 0) return null;
  return Math.round((base.era / line.era) * 100);
}

/**
 * OPS+：相對聯盟平均的攻擊表現，100 是聯盟平均。
 *
 * `100 × (OBP/lgOBP + SLG/lgSLG − 1)`。上壘與長打各自相對聯盟再相加，而不是
 * 直接把 OPS 相除——兩者的離散程度不同，直接相除會低估上壘型打者。
 */
export function opsPlus(line: BattingLine, base: Baseline): number | null {
  if (line.pa === 0 || base.obp === 0 || base.slg === 0) return null;
  return Math.round((line.obp / base.obp + line.slg / base.slg - 1) * 100);
}

/**
 * 一段表現的雙帳紀錄：勝利份額與敗戰份額。
 *
 * 兩者相加即**責任額**——這名球員佔用了球隊多少出場機會。表現差不會產生負的
 * 勝利份額，而是產生大量的敗戰份額；這與投手的勝敗紀錄是同一個概念，只是推廣
 * 到所有貢獻上。見 ADR 0003。
 */
export interface Shares {
  readonly win: number;
  readonly loss: number;
}

/** 責任額，也就是勝利份額與敗戰份額的總和。 */
export function responsibilityOf(shares: Shares): number {
  return shares.win + shares.loss;
}

/** 聯盟平均的 OPS。獎項門檻與護欄都要看它。 */
export function baselineOps(base: Baseline): number {
  return base.obp + base.slg;
}

/** 這段表現的勝率。責任額為 0 時回傳 .500——沒有樣本就沒有意見。 */
export function winPct(shares: Shares): number {
  const total = responsibilityOf(shares);
  return total === 0 ? 0.5 : shares.win / total;
}

/** 把責任額與勝率拆成雙帳。 */
export function splitShares(responsibility: number, pct: number): Shares {
  const safe = Math.max(0, responsibility);
  return { win: safe * pct, loss: safe * (1 - pct) };
}

/**
 * 相對表現轉勝率，畢氏公式。
 *
 * `r` 是球員相對聯盟平均的表現比（得分創造率、防禦率倒數、守備分比），
 * `win% = r^n / (r^n + 1)`。r = 1 時剛好 .500——與聯盟同水準的人是五成勝率。
 *
 * 三個分段（打擊、投球、守備）共用這一條映射，行為才會一致。
 */
export function pythagoreanWinPct(ratio: number): number {
  const s = cfg.advanced.shares;
  if (!Number.isFinite(ratio) || ratio <= 0) return s.win_pct_clamp.min;
  const r = Math.pow(ratio, s.pythagorean_exponent);
  return clamp(r / (r + 1), s.win_pct_clamp.min, s.win_pct_clamp.max);
}

/**
 * 把個人勝率錨在球隊戰績上。
 *
 * 真實的 Win Shares 裡，一支球隊能發出的勝利份額總額是「勝場 × 3」——**0 勝
 * 的球隊沒有任何勝利份額可分**，隊上再強的球員也拿不到。用場次推導責任額卻
 * 不看戰績，等於讓爛隊憑空生出勝利。
 *
 * 作法是平移而非相乘：一個表現剛好等於聯盟平均的球員，勝率就是他球隊的勝率；
 * 比平均好多少，就在球隊勝率之上加多少。因此
 *
 * - 平均球員 × .500 的球隊 → .500
 * - 平均球員 × 0 勝的球隊 → 0（一份勝利份額都沒有）
 * - 比平均好 .15 的球員 × 0 勝的球隊 → .15（他確實比隊友強，但份額很少）
 *
 * `team_coupling` 是耦合強度：1.0 完全照 James，0 則完全不看球隊。這是 Win
 * Shares 最常被批評的性質——生在爛隊會被連累——但那也正是這套系統的定義。
 *
 * `teamWinRate` 為 null 時不做調整（養成期沒有球隊戰績可言）。
 */
export function teamAdjustedWinPct(individual: number, teamWinRate: number | null): number {
  const s = cfg.advanced.shares;
  if (teamWinRate === null) return individual;
  const shifted = individual + (teamWinRate - 0.5) * s.team_coupling;
  // 下限是 0 而不是 win_pct_clamp.min：0 勝的球隊就該是 0，那不是極端值的
  // 夾擠，是這套系統的定義。
  return clamp(shifted, 0, 1);
}

/**
 * 打擊的責任額：每個打席分到多少份。
 *
 * 由球隊的總份額推導，因此聯盟場次會自然約掉：一支球隊整季 `場次 × 3` 份，
 * 其中 50% 屬於進攻，除以球隊整季的打席數，就是每個打席的份額。**打得越多，
 * 兩本帳都累積越多**——這正是「佔著位置打不好」會顯形的機制。
 */
export function battingResponsibility(pa: number): number {
  const s = cfg.advanced.shares;
  return (pa * s.per_game * s.split.batting) / s.team_pa_per_game;
}

/**
 * 投球的責任額：每一局分到多少份，再乘上該角色的**高槓桿加權**。
 *
 * 加權是 James 特別為後援設計的：終結者專挑領先或平手的關鍵局面，同樣一局的
 * 價值遠高於敗戰處理。**局數少不代表貢獻小**——沒有這一層，六十幾局的頂尖
 * 終結者永遠只值先發的三分之一，而那不是 Win Shares 的意思。
 */
export function pitchingResponsibility(ip: number, role: string = 'SP'): number {
  const s = cfg.advanced.shares;
  const leverage = s.leverage[role] ?? 1;
  return (ip * s.per_game * s.split.pitching * leverage) / s.team_ip_per_game;
}

/**
 * 守備的責任額。
 *
 * `(守位責任占比 / 100) × 聯盟場次 × 每場份數 × 守備占比 × 出賽比重`
 *
 * 守位占比取自 `positions.json`，八個守位相加為 100——那是**野手純守備池**
 * 內部的分配。投手自己的守備不在這張表裡，它含在投球那 35% 之中（James 的
 * 防守端拆分是「投手 70 ／ 野手 30」）。
 */
export function fieldingResponsibilityShares(options: {
  readonly positionShare: number;
  readonly leagueGames: number;
  readonly gamesShare: number;
}): number {
  const s = cfg.advanced.shares;
  return (
    (options.positionShare / 100) *
    options.leagueGames *
    s.per_game *
    s.split.fielding *
    options.gamesShare
  );
}

/**
 * 打擊的雙帳。相對聯盟平均的得分創造率決定勝率，再錨到球隊戰績上。
 *
 * `teamWinRate` 為 null 時不做球隊調整。
 */
export function battingShares(
  line: BattingLine,
  base: Baseline,
  teamWinRate: number | null = null,
): Shares {
  if (line.pa === 0 || base.runsCreatedPerPa === 0) return { win: 0, loss: 0 };
  const ratio = runsCreated(line) / line.pa / base.runsCreatedPerPa;
  return splitShares(
    battingResponsibility(line.pa),
    teamAdjustedWinPct(pythagoreanWinPct(ratio), teamWinRate),
  );
}

/** 投球的雙帳。防禦率越低勝率越高，因此比值取倒數。 */
export function pitchingShares(
  line: PitchingLine,
  base: Baseline,
  teamWinRate: number | null = null,
  role: string = 'SP',
): Shares {
  if (line.outs === 0 || base.era === 0) return { win: 0, loss: 0 };
  // 防禦率 0 是完美，不是無限差——直接除會炸開，改用一個極小值代替。
  const era = line.era <= 0 ? 0.01 : line.era;
  return splitShares(
    pitchingResponsibility(innings(line), role),
    teamAdjustedWinPct(pythagoreanWinPct(base.era / era), teamWinRate),
  );
}

/**
 * 守備的雙帳。
 *
 * 勝率由**守備分相對該守位平均**決定，不是相對聯盟的一般水準——各守位的守備分
 * 量級本來就不同，用同一條線比會讓門檻高的守位天生虛胖。守位之間的價值差則由
 * 責任額承擔。
 */
export function fieldingShares(options: {
  readonly defenseScore: number;
  readonly positionAverage: number;
  readonly positionShare: number;
  readonly leagueGames: number;
  readonly gamesShare: number;
  readonly teamWinRate?: number | null;
}): Shares {
  if (options.positionAverage <= 0 || options.positionShare <= 0) return { win: 0, loss: 0 };
  const responsibility = fieldingResponsibilityShares(options);
  return splitShares(
    responsibility,
    teamAdjustedWinPct(
      pythagoreanWinPct(options.defenseScore / options.positionAverage),
      options.teamWinRate ?? null,
    ),
  );
}

/**
 * 替代水準球員的勝率。
 *
 * 替代水準就是 `leagues.json` 的 `min`——跌破就降級或戰力外的那條線。把它與
 * 當年 par 的差代進成績模型，算出那種球員打出來的成績，再換成勝率。
 *
 * 這是生涯評價分零點的來源：**卡在留隊邊緣的球員，生涯評價分原地踏步。**
 */
export function replacementWinPct(
  side: 'batting' | 'pitching',
  level: string,
  standards: LeagueStandards | null = null,
): number {
  const now = standardOf(standards, level);
  const d = now.min - now.par;
  const base = proBaselineAt(level, 0);
  const replacement = proBaselineAt(level, d);
  if (side === 'batting') {
    if (base.runsCreatedPerPa === 0) return 0.5;
    return pythagoreanWinPct(replacement.runsCreatedPerPa / base.runsCreatedPerPa);
  }
  if (replacement.era === 0) return 0.5;
  return pythagoreanWinPct(base.era / replacement.era);
}

/**
 * 敗戰份額的扣分係數 `k`。
 *
 * `評價分 = 勝利份額 − k × 敗戰份額`，而 `k` **不是自由參數**——它唯一的作用是
 * 決定「哪個水準的球員生涯評價分不動」。分數為零的點滿足 `p₀ = k/(1+k)`，
 * 因此 `k = p₀/(1−p₀)`，其中 `p₀` 是替代水準球員的勝率。
 *
 * 逐層級、逐年計算：`min` 與 `par` 的差距本身會擺盪，所以人才斷層的年份與
 * 競爭白熱的年份，那條零線的位置不一樣。
 */
export function lossPenalty(
  side: 'batting' | 'pitching',
  level: string,
  standards: LeagueStandards | null = null,
): number {
  const p0 = replacementWinPct(side, level, standards);
  if (p0 >= 1) return Number.POSITIVE_INFINITY;
  return p0 / (1 - p0);
}

/**
 * 守備側替代水準的勝率。
 *
 * 守備的替代水準是**守得動這個位置的最低標準**，也就是該守位的門檻；平均線
 * 則是門檻加上 margin。兩者的比值就是替代水準球員的相對表現。
 *
 * 與打擊、投球用的是同一個概念——「剛好還留得住的人」——只是那條線在守備上
 * 由守位門檻定義，而不是由聯盟的 min 定義。
 */
export function fieldingReplacementWinPct(threshold: number, average: number): number {
  if (average <= 0) return 0.5;
  return pythagoreanWinPct(threshold / average);
}

/** 把幾筆雙帳加總。 */
export function sumShares(...list: readonly Shares[]): Shares {
  let win = 0;
  let loss = 0;
  for (const s of list) {
    win += s.win;
    loss += s.loss;
  }
  return { win, loss };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
