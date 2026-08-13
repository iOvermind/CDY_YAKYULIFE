/**
 * 養成期的大賽結算：高中、大學、業餘成棒。
 *
 * 移植自 index_legacy.html 的 amateurSeason()。
 * 本模組的抽取一律走 season 子序列——大賽是這個階段的賽季，成績結算歸屬於它。
 */

import { amateur, type AmateurStage } from '../data/index.ts';
import type { Abilities } from './rating.ts';
import { rate } from './rating.ts';
import type { World } from './rng.ts';

export interface CupResult {
  /** 大賽名稱。 */
  readonly cup: string;
  /** 名次索引，0 為冠軍。 */
  readonly rankIndex: number;
  /** 名次的顯示名稱。 */
  readonly rank: string;
  /** 這場大賽獲得的能力點。 */
  readonly points: number;
  /** 這場大賽的實力值，含分級加成與臨場波動。除錯用。 */
  readonly power: number;
}

export interface CupSeason {
  readonly results: readonly CupResult[];
  /** 這一季大賽的能力點總和。 */
  readonly points: number;
  /** 拿下冠軍的大賽，用於榮譽紀錄。 */
  readonly championships: readonly string[];
}

export interface CupContext {
  readonly stage: AmateurStage;
  readonly ability: Abilities;
  /** 用於評價的守位。 */
  readonly position: string;
  readonly traits: ReadonlySet<string>;
  /** 高中的隱藏強度分級；其他階段不適用。 */
  readonly schoolTier?: number;
}

/**
 * 打完這一季的所有大賽。
 *
 * 每場大賽各自擲一次臨場波動——棒球是短期賽制，同一個球員在三場大賽可以打出
 * 三種名次，這正是養成期的張力來源。
 */
export function playCups(world: World, ctx: CupContext): CupSeason {
  const rng = world.stream('season');
  const cfg = amateur.cups;
  const stage = cfg[ctx.stage];
  const overall = rate(ctx.ability, { position: ctx.position, traits: ctx.traits }).overall;
  const teamBonus = stageTeamBonus(ctx);
  const pointsBonus = Math.floor(overall / cfg.points_bonus.overall_divisor);
  const lastRank = cfg.ranks.length - 1;

  const results: CupResult[] = [];
  const championships: string[] = [];
  let total = 0;

  for (const cup of stage.names) {
    const power = overall + teamBonus + rng.int(cfg.power_noise.min, cfg.power_noise.max);
    const rankIndex = rankFor(power, stage.thresholds, lastRank);
    const points = (cfg.points[rankIndex] ?? 0) + pointsBonus;

    results.push({
      cup,
      rankIndex,
      rank: cfg.ranks[rankIndex] ?? '',
      points,
      power,
    });
    total += points;
    if (rankIndex === 0) championships.push(cup);
  }

  return { results, points: total, championships };
}

/** 依實力值取名次索引。門檻由高到低，取第一個達標者；都不到則為最後一名次。 */
function rankFor(power: number, thresholds: readonly number[], lastRank: number): number {
  for (let i = 0; i < thresholds.length; i++) {
    const t = thresholds[i];
    if (t !== undefined && power >= t) return i;
  }
  return lastRank;
}

/** 球隊強度加成。目前只有高中有隱藏分級。 */
function stageTeamBonus(ctx: CupContext): number {
  if (ctx.stage !== 'HS' || ctx.schoolTier === undefined) return 0;
  return amateur.high_school.tiers[String(ctx.schoolTier)]?.power_bonus ?? 0;
}

/**
 * 判斷這一季是否觸發學院派——大學階段拿下任一大賽冠軍即解鎖。
 *
 * 這是目前唯一在資料層描述完整的養成期特性觸發；其餘特性的條件仍在
 * traits.json 標為 rules_complete: false。
 */
export function academyUnlocked(stage: AmateurStage, season: CupSeason): boolean {
  const trigger = amateur.cups.academy_trigger;
  if (stage !== trigger.stage) return false;
  return season.results.some((r) => r.rank === trigger.rank);
}
