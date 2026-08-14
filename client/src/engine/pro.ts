/**
 * 職業生涯的推進：升降級、年齡曲線與引退。
 *
 * 判定一律看**能力相對該層級的 par／min**，不看單季成績。成績本身就是能力
 * 加噪音，用成績判定等於把同一份噪音算兩次——會讓運氣好的一季直接送人上
 * 一軍，運氣差的一季直接把人踢出去。
 *
 * 所有數字都在 `season.json`。抽取走 career 子序列（生涯層級的決定），
 * 老化走 growth 子序列（能力變動）。
 */

import { abilities, leagues, season as cfg } from '../data/index.ts';
import { standardOf, type LeagueStandards } from './league.ts';
import type { Abilities } from './rating.ts';
import type { World } from './rng.ts';

export type Movement = 'promote' | 'demote' | 'stay' | 'release';

export interface MovementResult {
  readonly movement: Movement;
  /** 移動後的層級；戰力外時為 null。 */
  readonly level: string | null;
  /** 給玩家看的一句話理由。 */
  readonly reason: string;
}

/** 這個體系的升遷路徑，由低到高。 */
export function pathOf(org: string): readonly string[] {
  const path = leagues.paths[org];
  if (path === undefined) throw new Error(`未知的體系：${org}`);
  return path;
}

/** 層級在路徑上的位置。 */
function indexOf(level: string): { org: string; path: readonly string[]; index: number } {
  const info = leagues.levels[level];
  if (info === undefined) throw new Error(`未知的聯盟層級：${level}`);
  const path = pathOf(info.org);
  return { org: info.org, path, index: path.indexOf(level) };
}

/** 依 d 值算出一個機率並套上下限。 */
function chanceOf(
  spec: { base: number; per_point: number; min: number; max: number },
  d: number,
): number {
  return Math.max(spec.min, Math.min(spec.max, spec.base + d * spec.per_point));
}

/**
 * 球季結束後的去留。
 *
 * 判定順序是升級 → 降級 → 戰力外。先問升級是刻意的：一個能力已經超過上一層
 * 級門檻的人，不該因為還在最低層級而被同一輪判定拉去問「要不要放掉他」。
 *
 * `yearsAtBottom` 是在最低層級連續待了幾季——戰力外需要寬限期，一個剛簽約的
 * 新人不該因為第一季達不到二軍標準就被釋出。
 */
export function evaluateMovement(
  world: World,
  options: {
    readonly level: string;
    readonly overall: number;
    readonly yearsAtBottom: number;
    /** 當年的聯盟水準。null 表示用基準值。 */
    readonly standards?: LeagueStandards | null;
  },
): MovementResult {
  const rng = world.stream('career');
  const { path, index } = indexOf(options.level);
  const mv = cfg.movement;
  const standards = options.standards ?? null;

  const above = index >= 0 && index < path.length - 1 ? path[index + 1] : undefined;
  if (above !== undefined) {
    const target = leagues.levels[above];
    if (target !== undefined) {
      // 門檻用當年的值：人才斷層的年份比較好擠上去，這正是浮動該有的效果。
      const targetMin = Math.round(standardOf(standards, above).min);
      const d = options.overall - (targetMin + mv.promote.margin);
      if (d >= 0 && rng.chance(chanceOf(mv.promote.chance, d))) {
        return {
          movement: 'promote',
          level: above,
          reason: `能力達到${target.name}的標準（綜合 ${options.overall}／門檻 ${targetMin}）`,
        };
      }
    }
  }

  const here = leagues.levels[options.level];
  if (here === undefined) throw new Error(`未知的聯盟層級：${options.level}`);
  const hereMin = Math.round(standardOf(standards, options.level).min);
  const shortfall = hereMin + mv.demote.margin - options.overall;

  if (shortfall > 0 && index > 0) {
    const below = path[index - 1];
    if (below !== undefined && rng.chance(chanceOf(mv.demote.chance, shortfall))) {
      return {
        movement: 'demote',
        level: below,
        reason: `跟不上${here.name}的水準（綜合 ${options.overall}／門檻 ${hereMin}）`,
      };
    }
  }

  // 已經在最低層級卻仍達不到標準，且撐過了寬限期，就是戰力外。
  if (index === 0 && options.overall < hereMin - mv.release.margin) {
    if (options.yearsAtBottom >= mv.release.grace_years) {
      return {
        movement: 'release',
        level: null,
        reason: `連續 ${options.yearsAtBottom} 季達不到${here.name}的最低標準`,
      };
    }
  }

  return { movement: 'stay', level: options.level, reason: '留在原層級' };
}

export interface AgingResult {
  readonly ability: Abilities;
  /** 每項能力的變動量，只列出非零的。 */
  readonly changes: ReadonlyMap<string, number>;
  readonly phase: 'growth' | 'peak' | 'decline';
}

/**
 * 一季的自然年齡變動。
 *
 * 巔峰之前緩升、巔峰之中持平、巔峰之後遞減，且衰退幅度隨年齡加速。
 *
 * 衰退不是等比落在每項能力上：速度、守備範圍與球速先掉，接觸與選球撐得比較
 * 久。這是真實的老化順序，也讓老將的生存策略（移防、改當接觸型打者）成立。
 */
export function applyAging(world: World, ability: Abilities, age: number): AgingResult {
  const rng = world.stream('growth');
  const a = cfg.aging;
  const changes = new Map<string, number>();
  const next: Record<string, number> = { ...ability };

  // 走訪順序必須固定，否則同一個種子會抽出不同結果。
  const keys = Object.keys(ability).sort();

  if (age < a.peak_start) {
    const points = rng.int(a.growth.points.min, a.growth.points.max);
    for (let i = 0; i < points; i++) {
      const key = keys[rng.int(0, keys.length - 1)];
      if (key === undefined) continue;
      next[key] = (next[key] ?? 0) + 1;
      changes.set(key, (changes.get(key) ?? 0) + 1);
    }
    return { ability: next as Abilities, changes, phase: 'growth' };
  }

  if (age <= a.peak_end) return { ability, changes, phase: 'peak' };

  const yearsPast = age - a.peak_end;
  const total = Math.min(a.decline.max, a.decline.base + yearsPast * a.decline.per_year_after_peak);
  const fast = new Set(a.decline.speed_first.fast);
  const slow = new Set(a.decline.speed_first.slow);

  for (const key of keys) {
    const mult = fast.has(key)
      ? a.decline.speed_first.fast_multiplier
      : slow.has(key)
        ? a.decline.speed_first.slow_multiplier
        : 1;
    // 期望值取整前先擲一次，讓 0.5 點的衰退表現為「一半的年份掉 1 點」而不是
    // 每年都掉或每年都不掉。
    const amount = total * mult;
    const whole = Math.floor(amount);
    const drop = whole + (rng.next() < amount - whole ? 1 : 0);
    if (drop <= 0) continue;
    // 下限是量表的底，不是 0。20 就是球探量表描述得了的最差，跌破它會產生
    // 沒有意義的數字——「比 20 更差」在球探報告上沒有對應的說法。
    const floored = Math.max(abilities.scale.hard_floor, (next[key] ?? 0) - drop);
    if (floored === (next[key] ?? 0)) continue;
    changes.set(key, floored - (next[key] ?? 0));
    next[key] = floored;
  }

  return { ability: next as Abilities, changes, phase: 'decline' };
}

/**
 * 是否引退。
 *
 * 年齡與能力雙軌：老了會退，被釋出又過了某個年紀也會退——年輕的落選者還有
 * 重新找球隊的餘地，三十幾歲的沒有。
 */
export function shouldRetire(
  world: World,
  options: { readonly age: number; readonly released: boolean },
): { readonly retire: boolean; readonly reason: string } {
  const r = cfg.retirement;

  if (options.age >= r.max_age) return { retire: true, reason: '年齡到了極限' };
  if (options.released && options.age >= r.released_forces_retirement_age) {
    return { retire: true, reason: '這個年紀被釋出，已經沒有球隊願意給機會' };
  }
  if (options.age < r.min_age) return { retire: false, reason: '' };

  const chance = Math.min(r.age_chance.max, r.age_chance.base + (options.age - r.min_age) * r.age_chance.per_year);
  if (world.stream('career').chance(chance)) {
    return { retire: true, reason: '身體告訴你，是時候了' };
  }
  return { retire: false, reason: '' };
}

/** 職業階段的季初訓練骰數。比養成期少——球季佔滿了時間。 */
export function proDiceCount(world: World, age: number): number {
  const p = cfg.pro_dice;
  let count = Number(world.stream('growth').weighted(p.count_weights));
  if (age >= cfg.aging.peak_start && age <= cfg.aging.peak_end) count += p.peak_bonus.delta;
  return Math.max(1, count);
}
