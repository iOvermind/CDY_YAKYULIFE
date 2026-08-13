/**
 * 養成期的大賽結算：高中、大學、業餘成棒。
 *
 * 移植自 index_legacy.html 的 amateurSeason()。
 * 本模組的抽取一律走 season 子序列——大賽是這個階段的賽季，成績結算歸屬於它。
 */

import {
  amateur,
  type AmateurStage,
  type SchoolStage,
  type SchoolTiers,
  type StageDefinition,
  type YouthTournament,
} from '../data/index.ts';
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

/** 球隊強度加成。國中與高中各有自己的隱藏分級表。 */
function stageTeamBonus(ctx: CupContext): number {
  if (ctx.schoolTier === undefined) return 0;
  const tiers = schoolTiersOf(ctx.stage);
  if (tiers === null) return 0;
  return tiers.tiers[String(ctx.schoolTier)]?.power_bonus ?? 0;
}

/** 取得該階段的學校分級表；沒有學校的階段回傳 null。 */
export function schoolTiersOf(stage: AmateurStage): SchoolTiers | null {
  if (stage === 'JHS') return amateur.junior_high;
  if (stage === 'HS') return amateur.high_school;
  return null;
}

/** 取得階段定義。 */
export function stageOf(stage: SchoolStage): StageDefinition {
  const def = amateur.stages[stage];
  if (def === undefined || Array.isArray(def) || typeof def === 'string') {
    throw new Error(`stages 缺少 ${stage} 的定義`);
  }
  return def as StageDefinition;
}

/** 這個階段的下一個階段；沒有就回傳 null（接下來進選秀）。 */
export function nextStageOf(stage: SchoolStage): SchoolStage | null {
  return (stageOf(stage).next as SchoolStage | undefined) ?? null;
}

// ------------------------------------------------------------------ 國際賽

export interface YouthCallUp {
  /** 是否入選。未達門檻就不會被徵召。 */
  readonly selected: boolean;
  readonly tournament: string;
  readonly rankIndex: number;
  readonly rank: string;
  readonly points: number;
}

/** 取得該階段的養成期國際賽設定；沒有就回傳 null。 */
export function youthTournamentOf(stage: AmateurStage): YouthTournament | null {
  const cfg = amateur.amateur_international[stage];
  if (cfg === undefined || cfg === null) return null;
  return cfg as YouthTournament;
}

/**
 * 打養成期的國際賽。
 *
 * 不是每個人都入選——綜合能力達門檻才會被徵召，因此入選本身就是一件值得
 * 高興的事。名次由整體興衰決定，個人能力只佔一小部分。
 */
export function playYouthTournament(
  world: World,
  stage: AmateurStage,
  overall: number,
): YouthCallUp | null {
  const cfg = youthTournamentOf(stage);
  if (cfg === null) return null;

  if (overall < cfg.call_up_threshold) {
    return { selected: false, tournament: cfg.name, rankIndex: -1, rank: '', points: 0 };
  }

  const rng = world.stream('season');
  const shared = amateur.amateur_international;
  const bonus = Math.min(
    shared.power_bonus.max,
    Math.max(0, Math.round((overall - shared.power_bonus.base_overall) * shared.power_bonus.factor)),
  );
  const roll = rng.int(0, 100) + bonus;

  let rankIndex = cfg.thresholds.length;
  for (let i = 0; i < cfg.thresholds.length; i++) {
    const t = cfg.thresholds[i];
    if (t !== undefined && roll >= t) {
      rankIndex = i;
      break;
    }
  }

  return {
    selected: true,
    tournament: cfg.name,
    rankIndex,
    rank: shared.ranks[rankIndex] ?? '',
    points: cfg.points[rankIndex] ?? 0,
  };
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
