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
  /** 局數，取到小數一位。 */
  readonly ip: number;
  /** 被安打。 */
  readonly hits: number;
  /** 失分。 */
  readonly runs: number;
  readonly er: number;
  readonly bb: number;
  readonly so: number;
  readonly era: number;
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

/** 每局被上壘率：被安打加保送除以局數。 */
export function whip(line: PitchingLine): number {
  return line.ip === 0 ? 0 : (line.hits + line.bb) / line.ip;
}

/** 每九局三振數。 */
export function kPerNine(line: PitchingLine): number {
  return line.ip === 0 ? 0 : (line.so * 9) / line.ip;
}

/** 每九局保送數。 */
export function bbPerNine(line: PitchingLine): number {
  return line.ip === 0 ? 0 : (line.bb * 9) / line.ip;
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
    so,
    sb,
    cs: Math.max(0, attempts - sb),
    avg: ab === 0 ? 0 : hits / ab,
    obp: pa === 0 ? 0 : onBase / pa,
    slg: 0,
  };
  return { ...line, slg: slugging(line) };
}

/** 投出一段養成期的投球成績。 */
export function pitchingLine(
  world: World,
  stage: AmateurStage,
  ability: Abilities,
  games: number,
): PitchingLine {
  const rng = world.stream('season');
  const cfg = amateur.amateur_stats.pitching;
  const par = amateur.cups[stage].par;
  const noise = () => cfg.noise.min + rng.next() * (cfg.noise.max - cfg.noise.min);

  const ipPerGame = rateOf(cfg.innings_per_game, ability, par);
  const ip = Math.round(games * ipPerGame * 10) / 10;

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

  return {
    games,
    // 養成期不分先發後援——一支國高中球隊的投手什麼時候上場都有可能。
    starts: 0,
    wins: 0,
    losses: 0,
    saves: 0,
    ip,
    hits: Math.round((ip * h9) / 9),
    runs: Math.round(er * cfg.runs_per_earned_run.value),
    er,
    bb: Math.round((ip * bb9) / 9),
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
): AmateurLine {
  if (games <= 0) return { batting: null, pitching: null };

  return {
    // 順序固定：投球先於打擊，否則同一個種子會因為走訪順序不同而產生不同結果。
    pitching: pitchingLine(world, stage, ability, games),
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
  };
  const line: BattingLine = { ...merged, avg: 0, obp: 0, slg: 0 };
  return {
    ...merged,
    avg: merged.ab === 0 ? 0 : merged.hits / merged.ab,
    obp: merged.pa === 0 ? 0 : (merged.hits + merged.bb + merged.ibb) / merged.pa,
    slg: slugging(line),
  };
}

export function addPitching(a: PitchingLine | null, b: PitchingLine | null): PitchingLine | null {
  if (a === null) return b;
  if (b === null) return a;
  const ip = Math.round((a.ip + b.ip) * 10) / 10;
  const er = a.er + b.er;
  return {
    games: a.games + b.games,
    starts: a.starts + b.starts,
    wins: a.wins + b.wins,
    losses: a.losses + b.losses,
    saves: a.saves + b.saves,
    ip,
    hits: a.hits + b.hits,
    runs: a.runs + b.runs,
    er,
    bb: a.bb + b.bb,
    so: a.so + b.so,
    era: ip === 0 ? 0 : (er * 9) / ip,
  };
}
