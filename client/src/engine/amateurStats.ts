/**
 * 養成期的個人成績。
 *
 * 這是簡化版。`simulation_math.md` §3-4 的公式是為職業的百場球季寫的——先算
 * 上場時間再乘機率屬性，那需要足夠的樣本數才收斂。養成期一場大賽只有幾場球，
 * 套同一套公式會把隨機噪音放大到失真（單季 .800 或 .050 都跑得出來）。
 *
 * 因此這裡改用「能力高過對手平均多少」直接推出率，再乘上場次得到累積數。
 * 抽取一律走 season 子序列。
 */

import { amateur, type AmateurStage } from '../data/index.ts';
import type { Abilities } from './rating.ts';
// season.ts 對這個檔案只有型別依賴（`import type`），編譯後會被抹掉，因此這條
// 反向的實值 import 不會形成執行期的循環。定位的判定只該有一份。
import { pitcherRoleAt, type PitcherRole } from './season.ts';
import type { World } from './rng.ts';

/** 一條率的設定：與對手同水準時是 base，每高一點加 per_point。 */
interface RateSpec {
  readonly base: number;
  readonly per_point: number;
  readonly min: number;
  readonly max: number;
  readonly ability?: string;
}

/**
 * 打擊成績。欄位比照棒球記錄的標準打擊列，養成期與職業共用同一個型別——
 * 分成兩套會讓生涯累計在升上職業那一刻斷掉。
 */
export interface BattingLine {
  readonly games: number;
  /**
   * 先發出賽場次。
   *
   * **出賽不等於先發**——第七局才上去代打的那一場也算一場出賽，但他只站一次
   * 打擊區。打席因此由「先發場次 × 棒次 + 替補場次 × 替補打席率」組成，而不是
   * 「出賽場次 × 棒次」：後者會把一個整季代打的人算成四百打席。
   *
   * 養成期不分先發與替補（那裡的出賽本來就是整場），因此恆等於 `games`。
   */
  readonly starts: number;
  readonly pa: number;
  readonly ab: number;
  /** 得分。 */
  readonly runs: number;
  readonly hits: number;
  readonly double: number;
  readonly triple: number;
  readonly hr: number;
  readonly rbi: number;
  readonly bb: number;
  /** 故意四壞。 */
  readonly ibb: number;
  /** 三振。 */
  readonly so: number;
  readonly sb: number;
  /** 盜壘刺。 */
  readonly cs: number;
  /** 觸身球。上壘率算它，打數不算。 */
  readonly hbp: number;
  /**
   * 犧牲打（高飛與觸擊合計）。
   *
   * 兩者沒有分開記——分開只為了上壘率的分母（現實裡高飛犧牲算進分母、觸擊不算），
   * 而那個差距小到不值得多一個欄位與一顆旋鈕。這裡一律當觸擊處理：上壘率的分母是
   * `PA − SAC`。
   */
  readonly sac: number;
  /** 打擊率，安打除以打數。 */
  readonly avg: number;
  /** 上壘率。 */
  readonly obp: number;
  /** 長打率。 */
  readonly slg: number;
}

/** 投球成績。同樣是養成期與職業共用的標準投球列。 */
export interface PitchingLine {
  readonly games: number;
  /** 先發場次。養成期不分先發後援，一律 0。 */
  readonly starts: number;
  readonly wins: number;
  readonly losses: number;
  readonly saves: number;
  /**
   * 中繼成功。中繼投手的主數據，與救援成功並列。
   *
   * 養成期一律 0——單淘汰的比賽沒有中繼這個角色。
   */
  readonly holds: number;
  /**
   * 投球出局數。
   *
   * **棒球的原子單位是出局，不是局。** 存成小數會生出 29.5 這種不存在的
   * 局數——棒球只有 .0／.1／.2（0、1、2 人出局）。存出局數就不會有這個問題，
   * 而且加總是精確的整數運算。
   *
   * 局數與顯示都從它導出：`innings()` 給真實局數（用於防禦率等除法），
   * `fmtInnings()` 給棒球寫法（29.1 = 29 局又 1 人出局）。
   */
  readonly outs: number;
  /** 被安打。 */
  readonly hits: number;
  /** 被二壘打。養成期不模擬，一律 0。 */
  readonly double: number;
  /** 被三壘打。養成期不模擬，一律 0。 */
  readonly triple: number;
  /** 失分。 */
  readonly runs: number;
  readonly er: number;
  readonly bb: number;
  /** 觸身球。養成期不模擬，一律 0。 */
  readonly hbp: number;
  readonly so: number;
  /** 被全壘打。養成期不模擬，一律 0。 */
  readonly hr: number;
  readonly era: number;
}

/**
 * 被打出來的壘打數。自責分由它推導。
 *
 * 與 `slugging()` 的算法相同，只是主語換成投手——**投打兩側用同一把尺**是
 * 自責分改由事件推導的前提，各寫一份遲早會分岔。
 */
export function totalBasesAllowed(line: PitchingLine): number {
  const single = line.hits - line.double - line.triple - line.hr;
  return single + line.double * 2 + line.triple * 3 + line.hr * 4;
}

/** 長打率：壘打數除以打數。 */
export function slugging(line: BattingLine): number {
  if (line.ab === 0) return 0;
  const single = line.hits - line.double - line.triple - line.hr;
  return (single + line.double * 2 + line.triple * 3 + line.hr * 4) / line.ab;
}

/** 整體攻擊指數：上壘率加長打率。 */
export function ops(line: BattingLine): number {
  return line.obp + line.slg;
}

/**
 * 真實局數。
 *
 * 用於所有把局數當分母的計算——防禦率、WHIP、每九局。**這是真實的三分之一
 * 進位**，不是顯示用的 29.1：拿 29.1 去除會少算 0.2 局。
 */
export function innings(line: PitchingLine): number {
  return line.outs / 3;
}

/**
 * 局數的棒球寫法：29.1 表示 29 局又 1 人出局。
 *
 * 小數點後只會是 0、1、2——那不是小數，是出局數。
 */
export function fmtInnings(outs: number): string {
  const whole = Math.floor(Math.max(0, outs) / 3);
  return `${whole}.${Math.max(0, outs) % 3}`;
}

/**
 * 從累計成績取出一項累積數據，換算成**顯示單位**。
 *
 * 累積成就與生涯里程碑讀的是同一批數字（安打、勝投、中繼…），因此讀法只有這
 * 一份。兩邊各寫一個 `switch` 的話，遲早會有一邊漏掉新加的數據——中繼就是這樣
 * 漏掉的。
 *
 * 投手沒有打擊成績時回傳 `null`，不是 0——0 代表「上場打了但沒打出來」。
 * 欄位名打錯直接炸：靜靜回傳 null 的話，那一項就從成就櫃上無聲消失。
 */
export function statTotal(
  stat: string,
  side: 'batter' | 'pitcher',
  unit: number,
  batting: BattingLine | null,
  pitching: PitchingLine | null,
): number | null {
  const line = side === 'batter' ? batting : pitching;
  if (line === null) return null;
  const value = (line as unknown as Record<string, number | undefined>)[stat];
  if (typeof value !== 'number') throw new Error(`${side} 沒有 ${stat} 這項數據`);
  return value / unit;
}

/** 每局被上壘率：被安打加保送除以局數。 */
export function whip(line: PitchingLine): number {
  const ip = innings(line);
  return ip === 0 ? 0 : (line.hits + line.bb) / ip;
}

/** 每九局三振數。 */
export function kPerNine(line: PitchingLine): number {
  const ip = innings(line);
  return ip === 0 ? 0 : (line.so * 9) / ip;
}

/** 每九局保送數。 */
export function bbPerNine(line: PitchingLine): number {
  const ip = innings(line);
  return ip === 0 ? 0 : (line.bb * 9) / ip;
}

export interface AmateurLine {
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
}

/** 依能力算出一條率，並套用上下限。 */
function rateOf(spec: RateSpec, ability: Abilities, par: number): number {
  const value = spec.ability === undefined ? par : (ability[spec.ability] ?? par);
  const raw = spec.base + (value - par) * spec.per_point;
  return Math.max(spec.min, Math.min(spec.max, raw));
}

/**
 * 打出一段養成期的打擊成績。
 *
 * 每一項率各加一次噪音——同一個球員在不同大賽的手感本來就不同，這也讓「三場
 * 大賽三種名次」的張力延伸到數據上。
 */
export function battingLine(
  world: World,
  stage: AmateurStage,
  ability: Abilities,
  games: number,
): BattingLine {
  const rng = world.stream('season');
  const cfg = amateur.amateur_stats.batting;
  const par = amateur.cups[stage].par;
  const noise = () => cfg.noise.min + rng.next() * (cfg.noise.max - cfg.noise.min);

  const pa = Math.round(games * cfg.pa_per_game);
  const bbRate = Math.max(0, rateOf(cfg.walk_rate, ability, par) + noise());
  const bb = Math.round(pa * bbRate);
  const ab = Math.max(0, pa - bb);

  const hitRate = Math.max(0, rateOf(cfg.hit_rate, ability, par) + noise());
  const hits = Math.min(ab, Math.round(ab * hitRate));

  const hrRate = Math.max(0, rateOf(cfg.hr_rate, ability, par) + noise());
  const hr = Math.min(hits, Math.round(hits * hrRate));

  const rbi = Math.round(hits * cfg.rbi_per_hit + hr);

  const rest = hits - hr;
  const double = Math.min(rest, Math.round(rest * rateOf(cfg.double_rate, ability, par)));
  const triple = Math.min(rest - double, Math.round(rest * rateOf(cfg.triple_rate, ability, par)));

  const so = Math.min(ab - hits, Math.round(ab * Math.max(0, rateOf(cfg.strikeout_rate, ability, par))));

  const onBase = hits + bb;
  const stealRate = Math.max(0, rateOf(cfg.steal_rate, ability, par) + noise());
  const attempts = Math.round(onBase * stealRate);
  const sb = Math.round(attempts * cfg.steal_success);
  const runs = Math.round(onBase * rateOf(cfg.runs_per_time_on_base, ability, par));

  const line: BattingLine = {
    games,
    // 養成期不分先發與替補——那裡的出賽本來就是整場。
    starts: games,
    pa,
    ab,
    runs,
    hits,
    double,
    triple,
    hr,
    rbi,
    bb,
    ibb: 0,
    // 養成期不模擬觸身球與犧牲打。
    hbp: 0,
    sac: 0,
    so,
    sb,
    cs: Math.max(0, attempts - sb),
    avg: ab === 0 ? 0 : hits / ab,
    obp: pa === 0 ? 0 : onBase / pa,
    slg: 0,
  };
  return { ...line, slg: slugging(line) };
}

/**
 * 這個球員在這個階段的定位。**與職業同一套五個定位、同一條判定路徑**
 * （`pitcherRoleAt`）：體力撐得住就走先發那條路，撐不住就整組落到牛棚，牛棚
 * 內部再依球威由高到低比對。
 *
 * par 與體力門檻都用該階段賽事的 par。這裡原本另外有一張 `starter_min_stamina`
 * （26/38/44/48），但它跟 par（28/38/46/48）幾乎重疊——同一件事寫兩次，以後調
 * par 還得記得回頭改另一張，遲早分岔。門檻隨階段提高的道理仍然成立，只是那個
 * 道理本來就寫在 par 裡：球賽變長、對手變強。
 */
export function amateurRole(stage: AmateurStage, ability: Abilities): PitcherRole {
  const par = amateur.cups[stage].par;
  return pitcherRoleAt(ability, par, par);
}

/**
 * 投出一段養成期的投球成績。
 *
 * `teamWins` 是球隊在這段大賽裡贏了幾場——**單淘汰的勝敗直接由名次推導**，
 * 不另外擲骰：打進冠軍戰的球隊贏了四場輸了一場，冠軍則是五戰全勝。那才是
 * 單淘汰的樣子。傳 null 表示不計勝敗（例如國際賽另計）。
 */
export function pitchingLine(
  world: World,
  stage: AmateurStage,
  ability: Abilities,
  games: number,
  teamWins: number | null = null,
): PitchingLine {
  const rng = world.stream('season');
  const cfg = amateur.amateur_stats.pitching;
  const par = amateur.cups[stage].par;
  const noise = () => cfg.noise.min + rng.next() * (cfg.noise.max - cfg.noise.min);

  const role = amateurRole(stage, ability);
  const dec = cfg.decision;
  const ipPerGame = rateOf(cfg.innings_per_game, ability, par);

  // **先發不是場場先發。** 連續兩天的賽程沒有人能扛下球隊的每一場，五場的賽會
  // 大約先發三場；而一場先發最多投 `max_innings_per_start` 局——學生賽事有投球
  // 局數限制與隔日再戰的現實，職業那種完投不適用。這兩條沒有的話，一個體力
  // 60 的高中生會在一週內先發五場、每場六局多，那是不存在的賽程。
  const starts = role === 'SP' ? Math.max(1, Math.ceil(games * dec.starts_per_game.value)) : 0;
  const appearances = role === 'SP' ? Math.min(games, starts) : games;
  const outs =
    role === 'SP'
      ? Math.round(appearances * Math.min(ipPerGame, dec.max_innings_per_start.value) * 3)
      : // 後援投手不是每場都上，上了也投不久。
        Math.round(games * ipPerGame * cfg.role.reliever_innings_factor.value * 3);
  const ip = outs / 3;

  const k9 = Math.max(0, rateOf(cfg.k_per_nine, ability, par) + noise());
  const bb9 = Math.max(0, rateOf(cfg.bb_per_nine, ability, par) + noise());

  // 防禦率同時看控球與球威——只有球速的投手照樣會被打爆。
  const stuff = ((ability['vel'] ?? par) + (ability['ctl'] ?? par)) / 2;
  const era = Math.max(
    cfg.era.min,
    Math.min(cfg.era.max, cfg.era.base + (stuff - par) * cfg.era.per_point + noise()),
  );

  const h9 = Math.max(0, rateOf(cfg.hits_per_nine, ability, par) + noise());
  const er = Math.round((ip * era) / 9);

  // 單淘汰的勝敗：贏了幾場、輸了幾場全由名次決定，不擲骰。
  //
  // 先發的勝敗按**他先發了球隊的幾成場次**分配——先發場數現在是明確算出來的，
  // 那個比例本身就是答案，不必再另給一個固定係數。牛棚則各拿各的：終結者換
  // 救援成功、布局與中繼換中繼成功，長中繼兩樣都沒有——他上場多半是比分已經
  // 拉開的時候。
  const wonGames = teamWins ?? 0;
  const lostGames = teamWins === null ? 0 : Math.max(0, games - teamWins);
  const startShare = games === 0 ? 0 : starts / games;
  const wins = Math.round(wonGames * startShare);
  const losses = Math.round(lostGames * startShare);
  const saves = role === 'CP' ? Math.round(wonGames * dec.closer_save_share.value) : 0;
  const holds =
    role === 'SU'
      ? Math.round(wonGames * dec.setup_hold_share.value)
      : role === 'MR'
        ? Math.round(wonGames * dec.middle_hold_share.value)
        : 0;

  return {
    games: appearances,
    outs,
    starts,
    wins,
    losses,
    saves,
    holds,
    hits: Math.round((ip * h9) / 9),
    // 養成期不模擬長打與觸身球——一年只有幾場球，切出來的數字全是抖動。
    double: 0,
    triple: 0,
    runs: Math.round(er * cfg.runs_per_earned_run.value),
    er,
    // 養成期不模擬被全壘打。
    hr: 0,
    bb: Math.round((ip * bb9) / 9),
    hbp: 0,
    so: Math.round((ip * k9) / 9),
    era,
  };
}

/**
 * 打出這一季的養成期成績。
 *
 * **投打一律都記，不看能力偏向。** 國高中的球隊人數有限，投手排進打線、野手
 * 上場救火都是常態；能力弱的那一側自然會反映成難看的數據，那本身就是資訊。
 * 職業才需要分工——那邊角色是固定的，見 season.ts。
 */
export function playAmateurStats(
  world: World,
  stage: AmateurStage,
  ability: Abilities,
  games: number,
  teamWins: number | null = null,
): AmateurLine {
  if (games <= 0) return { batting: null, pitching: null };

  return {
    // 順序固定：投球先於打擊，否則同一個種子會因為走訪順序不同而產生不同結果。
    pitching: pitchingLine(world, stage, ability, games, teamWins),
    batting: battingLine(world, stage, ability, games),
  };
}

/**
 * 把兩段成績相加，用於年度與生涯累計。
 *
 * 累計數直接相加，**比率一律由累計數重算**——把兩季的打擊率平均起來會得到
 * 錯的數字，除非兩季的打數剛好一樣。
 */
export function addBatting(a: BattingLine | null, b: BattingLine | null): BattingLine | null {
  if (a === null) return b;
  if (b === null) return a;
  const merged = {
    games: a.games + b.games,
    pa: a.pa + b.pa,
    ab: a.ab + b.ab,
    runs: a.runs + b.runs,
    hits: a.hits + b.hits,
    double: a.double + b.double,
    triple: a.triple + b.triple,
    hr: a.hr + b.hr,
    rbi: a.rbi + b.rbi,
    bb: a.bb + b.bb,
    ibb: a.ibb + b.ibb,
    so: a.so + b.so,
    sb: a.sb + b.sb,
    cs: a.cs + b.cs,
    starts: a.starts + b.starts,
    hbp: a.hbp + b.hbp,
    sac: a.sac + b.sac,
  };
  const line: BattingLine = { ...merged, avg: 0, obp: 0, slg: 0 };
  return {
    ...merged,
    avg: merged.ab === 0 ? 0 : merged.hits / merged.ab,
    // 與 season.ts 同一條式子：觸身球算上壘，犧牲打不進分母。
    obp:
      merged.pa - merged.sac <= 0
        ? 0
        : (merged.hits + merged.bb + merged.ibb + merged.hbp) / (merged.pa - merged.sac),
    slg: slugging(line),
  };
}

export function addPitching(a: PitchingLine | null, b: PitchingLine | null): PitchingLine | null {
  if (a === null) return b;
  if (b === null) return a;
  const outs = a.outs + b.outs;
  const ip = outs / 3;
  const er = a.er + b.er;
  return {
    games: a.games + b.games,
    outs,
    starts: a.starts + b.starts,
    wins: a.wins + b.wins,
    losses: a.losses + b.losses,
    saves: a.saves + b.saves,
    holds: a.holds + b.holds,
    hits: a.hits + b.hits,
    double: a.double + b.double,
    triple: a.triple + b.triple,
    hr: a.hr + b.hr,
    runs: a.runs + b.runs,
    er,
    bb: a.bb + b.bb,
    hbp: a.hbp + b.hbp,
    so: a.so + b.so,
    era: ip === 0 ? 0 : (er * 9) / ip,
  };
}
