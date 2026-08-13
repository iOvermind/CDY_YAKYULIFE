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
  /** 實際出賽場次。名次越好打得越多。 */
  readonly games: number;
}

export interface CupSeason {
  readonly results: readonly CupResult[];
  /** 這一季大賽的能力點總和。 */
  readonly points: number;
  /** 名次夠好、值得計入成就的大賽。四強以下只給點數，不留紀錄。 */
  readonly honors: readonly { readonly cup: string; readonly rank: string }[];
  /** 拿下冠軍的大賽，用於判定國際賽資格。 */
  readonly championships: readonly string[];
  /** 這一季大賽的總出賽場次。 */
  readonly games: number;
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
  // 綜合能力的額外點數整季只加一次——每場都加會隨賽事數量膨脹。
  const seasonBonus = Math.floor(overall / cfg.points_bonus.overall_divisor);
  const lastRank = cfg.ranks.length - 1;

  const results: CupResult[] = [];
  const championships: string[] = [];
  const honors: { cup: string; rank: string }[] = [];
  const honorRanks = new Set(cfg.honor_ranks.values);
  let total = 0;
  let totalGames = 0;

  for (const cup of stage.names) {
    const power = overall + teamBonus + rng.int(stage.power_noise.min, stage.power_noise.max);
    const rankIndex = rankFor(power, stage.thresholds, lastRank);
    const points = cfg.points[rankIndex] ?? 0;
    const games = cfg.games_by_rank.values[rankIndex] ?? 1;

    results.push({
      cup,
      rankIndex,
      rank: cfg.ranks[rankIndex] ?? '',
      points,
      power,
      games,
    });
    total += points;
    totalGames += games;
    if (rankIndex === 0) championships.push(cup);
    const rankName = cfg.ranks[rankIndex] ?? '';
    if (honorRanks.has(rankName)) honors.push({ cup, rank: rankName });
  }

  return { results, points: total + seasonBonus, honors, championships, games: totalGames };
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
  /** 國際賽代碼。 */
  readonly code: string;
  readonly tournament: string;
  readonly rankIndex: number;
  readonly rank: string;
  readonly points: number;
  readonly games: number;
}

/**
 * 這一季打得到哪些國際賽。
 *
 * 判定方式只有一種：贏下掛著代表權的國內大賽。國中層級這是真實的直通制；
 * 高中的 U-18 與亞青現實上是遴選國家隊，但打好國內盃賽本來就是入選的主要
 * 依據，因此用同一套機制，敘事上一律寫成「入選國家隊」。
 */
export function qualifiedTournaments(
  stage: AmateurStage,
  season: CupSeason,
): readonly string[] {
  const all = amateur.amateur_international.tournaments;
  const qualifies = amateur.cups[stage].qualifies ?? {};
  const out: string[] = [];
  for (const cup of season.championships) {
    const code = qualifies[cup];
    if (code !== undefined && all[code] !== undefined) out.push(code);
  }
  return out;
}

/** 這個階段的國內大賽各自連著哪一項國際賽，用於介面說明。 */
export function qualificationMap(stage: AmateurStage): Readonly<Record<string, YouthTournament>> {
  const all = amateur.amateur_international.tournaments;
  const qualifies = amateur.cups[stage].qualifies ?? {};
  const out: Record<string, YouthTournament> = {};
  for (const [cup, code] of Object.entries(qualifies)) {
    const cfg = all[code];
    if (cfg !== undefined) out[cup] = cfg;
  }
  return out;
}

/**
 * 打一場養成期的國際賽。
 *
 * 名次由整體興衰決定，個人能力只佔一小部分——國家隊的成績不是一個人的事。
 */
export function playYouthTournament(world: World, code: string, overall: number): YouthCallUp {
  const shared = amateur.amateur_international;
  const cfg = shared.tournaments[code];
  if (cfg === undefined) throw new Error(`未知的國際賽代碼：${code}`);

  const rng = world.stream('season');
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
    code,
    tournament: cfg.name,
    rankIndex,
    rank: shared.ranks[rankIndex] ?? '',
    points: shared.points[rankIndex] ?? 0,
    games: cfg.games_by_rank[rankIndex] ?? 0,
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
