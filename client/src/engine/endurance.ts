/**
 * 耐力：身體被磨掉的存量（issue #17–#23，ADR 0051）。
 *
 * **與體力是兩件事。** 體力是練得動的能力，決定出賽與局數；耐力練不動，只會被
 * 球季消耗、每季自然恢復一點。野手與投手各一池，二刀流兩池分開算：投手那一池
 * 耗盡是 TJ 的問題，野手那一池耗盡是手套的問題。
 *
 * 這一支只放規則——消耗、恢復、狀態、衰退量、七傷拳的受傷機率。什麼時候問玩家、
 * 卡片怎麼寫，是 `game.ts` 的事。
 */

import { season as seasonCfg, type EnduranceTier } from '../data/index.ts';
import type { World } from './rng.ts';

const cfg = seasonCfg.endurance;

/** 一池耐力。 */
export interface EndurancePool {
  /** 上限。開局擲一次，天賦與特性乘在上面。 */
  readonly max: number;
  /** 現在的存量，0 到 max。 */
  readonly value: number;
  /** 連續耗盡了幾季。耗盡的衰退隨它加重，回到 0 以上就歸零。 */
  readonly emptySeasons: number;
}

/**
 * 開局擲兩池的上限。
 *
 * 兩池各擲各的：同一個人手臂耐操、膝蓋不一定。〈橡膠人〉乘在兩池上，
 * 〈橡膠果實〉只乘投手那一池。
 */
export function rollEndurance(
  world: World,
  rubber: boolean,
): { readonly fielder: EndurancePool; readonly pitcher: EndurancePool } {
  const rng = world.stream('health');
  const roll = (): number => rng.int(cfg.start.min, cfg.start.max) * cfg.max_multiplier;
  const fielder = roll();
  const pitcher = roll() * (rubber ? cfg.rubber.pitcher_max : 1);
  return {
    fielder: { max: fielder, value: fielder, emptySeasons: 0 },
    pitcher: { max: pitcher, value: pitcher, emptySeasons: 0 },
  };
}

/** 這一季的消耗係數。同樣的工作量，有的年份扛得住，有的年份就是特別傷。 */
export function wearCoefficient(world: World): number {
  const rng = world.stream('health');
  return cfg.coefficient.min + rng.next() * (cfg.coefficient.max - cfg.coefficient.min);
}

/** 野手一季的消耗：守位的滿季消耗 × 出賽比例 × 係數 × 〈配速大師〉。指定打擊是 0。 */
export function fielderWear(position: string, games: number, leagueGames: number, coefficient: number): number {
  const full = cfg.fielder.per_full_season[position] ?? 0;
  if (leagueGames <= 0) return 0;
  return full * (games / leagueGames) * coefficient * cfg.cost_multiplier;
}

/** 投手一季的消耗：局數 × 每局消耗 × 係數 × 〈配速大師〉。 */
export function pitcherWear(outs: number, coefficient: number): number {
  return (outs / 3) * cfg.pitcher.per_inning * coefficient * cfg.cost_multiplier;
}

/**
 * 一季結束：扣掉消耗、加回自然恢復，夾在 0 與上限之間。
 *
 * 恢復是**每季都有**的：指定打擊與出賽極少的投手因此是純恢復。耗盡的季數在這裡
 * 算——結算之後仍是 0 就多記一季，回到 0 以上就歸零。
 */
export function settleSeason(pool: EndurancePool, wear: number, recovery: number): EndurancePool {
  const value = Math.max(0, Math.min(pool.max, pool.value - wear + recovery));
  return { ...pool, value, emptySeasons: value <= 0 ? pool.emptySeasons + 1 : 0 };
}

/** 野手與投手的自然恢復量。 */
export const RECOVERY = { fielder: cfg.fielder.recovery, pitcher: cfg.pitcher.recovery } as const;

/** 這一池現在的狀態。 */
export function tierOf(pool: EndurancePool): EnduranceTier {
  if (pool.value <= 0) return 'empty';
  const ratio = pool.value / pool.max;
  for (const t of cfg.tiers) {
    if (t.above !== null && ratio > t.above) return t.id;
  }
  return 'strained';
}

/** 狀態的中文。 */
export function tierName(tier: EnduranceTier): string {
  return cfg.tiers.find((t) => t.id === tier)?.name ?? tier;
}

/** 狀態由好到壞的序號：充沛 0、疲勞 1、透支 2、耗盡 3。 */
export function tierRank(tier: EnduranceTier): number {
  return cfg.tiers.findIndex((t) => t.id === tier);
}

/**
 * 耗盡之後這一季每項能力扣多少（期望值）。
 *
 * 與年齡衰退同一個形狀、量約七成：第一季 0.7，每多一季 +0.25，最多 4。`seasons` 是
 * 連續耗盡的季數，從 1 起算。
 */
export function declineAmount(seasons: number): number {
  if (seasons <= 0) return 0;
  const d = cfg.decline;
  return Math.min(d.max, d.base + (seasons - 1) * d.per_season);
}

/** 耗盡時會衰退的能力：野手是守備三項（配球永不衰退），投手是投球能力。 */
export function declineKeys(side: 'fielder' | 'pitcher'): readonly string[] {
  return side === 'fielder' ? cfg.decline.fielder_keys : cfg.decline.pitcher_keys;
}

/**
 * 七傷拳累加的受傷機率（百分點）：撐了幾季 × 每季的量，〈橡膠果實〉減半。
 *
 * 這一段在 95% 的夾子**之外**、天賦乘算**之前**（見 `injuryChance` 的 `wear`）。
 */
export function sevenFistsRisk(seasons: number, rubber: boolean): number {
  const step = cfg.seven_fists.per_season * (rubber ? cfg.seven_fists.rubber_multiplier : 1);
  return Math.max(0, seasons) * step;
}

/** 開完 TJ 的隔季，投手耐力回到上限的這個比例。 */
export function afterSurgery(pool: EndurancePool): EndurancePool {
  return { ...pool, value: pool.max * cfg.tj.restore, emptySeasons: 0 };
}

/** 直接扣或補一池的存量（事件卡）。`percent` 是上限的百分比，負的是扣。 */
export function adjust(pool: EndurancePool, percent: number): EndurancePool {
  const value = Math.max(0, Math.min(pool.max, pool.value + (pool.max * percent) / 100));
  return { ...pool, value };
}

/** 事件卡 `tj_countdown` 一點扣投手耐力上限的幾 %。 */
export const TJ_COUNTDOWN_PERCENT = cfg.events.tj_countdown_percent;
