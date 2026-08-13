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

export interface BattingLine {
  readonly games: number;
  readonly pa: number;
  readonly ab: number;
  readonly hits: number;
  readonly hr: number;
  readonly rbi: number;
  readonly bb: number;
  readonly sb: number;
  /** 打擊率，安打除以打數。 */
  readonly avg: number;
}

export interface PitchingLine {
  readonly games: number;
  /** 局數，取到小數一位。 */
  readonly ip: number;
  readonly so: number;
  readonly bb: number;
  readonly er: number;
  readonly era: number;
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

  const onBase = hits + bb;
  const stealRate = Math.max(0, rateOf(cfg.steal_rate, ability, par) + noise());
  const attempts = Math.round(onBase * stealRate);
  const sb = Math.round(attempts * cfg.steal_success);

  return {
    games,
    pa,
    ab,
    hits,
    hr,
    rbi,
    bb,
    sb,
    avg: ab === 0 ? 0 : hits / ab,
  };
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

  return {
    games,
    ip,
    so: Math.round((ip * k9) / 9),
    bb: Math.round((ip * bb9) / 9),
    er: Math.round((ip * era) / 9),
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

/** 把兩段成績相加，用於年度與生涯累計。 */
export function addBatting(a: BattingLine | null, b: BattingLine | null): BattingLine | null {
  if (a === null) return b;
  if (b === null) return a;
  const ab = a.ab + b.ab;
  const hits = a.hits + b.hits;
  return {
    games: a.games + b.games,
    pa: a.pa + b.pa,
    ab,
    hits,
    hr: a.hr + b.hr,
    rbi: a.rbi + b.rbi,
    bb: a.bb + b.bb,
    sb: a.sb + b.sb,
    avg: ab === 0 ? 0 : hits / ab,
  };
}

export function addPitching(a: PitchingLine | null, b: PitchingLine | null): PitchingLine | null {
  if (a === null) return b;
  if (b === null) return a;
  const ip = Math.round((a.ip + b.ip) * 10) / 10;
  const er = a.er + b.er;
  return {
    games: a.games + b.games,
    ip,
    so: a.so + b.so,
    bb: a.bb + b.bb,
    er,
    era: ip === 0 ? 0 : (er * 9) / ip,
  };
}
