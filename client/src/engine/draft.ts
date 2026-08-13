/**
 * 中華職棒選秀。
 *
 * 移植自 index_legacy.html 的 runDraft()。
 * 本模組的抽取一律走 career 子序列——選秀是生涯事件，不是賽季模擬。
 */

import { amateur, teams } from '../data/index.ts';
import type { Rating } from './rating.ts';
import type { World } from './rng.ts';

export interface DraftResult {
  /** 球團評價：綜合能力 + 年齡加權 + 臨場波動。 */
  readonly score: number;
  /** 指名輪次；0 代表落榜。 */
  readonly round: number;
  /** 是否落榜。 */
  readonly undrafted: boolean;
  /** 簽約金（萬）。落榜為 0。 */
  readonly bonus: number;
  /** 起始層級。落榜為 null。 */
  readonly level: string | null;
  /** 指名球隊。落榜為 null。 */
  readonly team: string | null;
}

/**
 * 跑一次選秀。
 *
 * 年齡加權讓年輕球員占優——球團買的是可養成的年數，不只是當下的能力。
 */
export function runDraft(
  world: World,
  options: { readonly overall: number; readonly age: number },
): DraftResult {
  const rng = world.stream('career');
  const cfg = amateur.draft;
  const evalCfg = cfg.evaluation;

  const ageBonus = Math.max(0, evalCfg.age_pivot - options.age) * evalCfg.age_bonus_per_year;
  const score = options.overall + ageBonus + rng.int(evalCfg.noise.min, evalCfg.noise.max);

  let round = 0;
  for (const tier of cfg.rounds.tiers) {
    if (score < tier.min_score) continue;
    if (tier.round !== undefined) round = tier.round;
    else if (tier.round_range !== undefined) {
      round = rng.int(tier.round_range.min, tier.round_range.max);
    }
    break;
  }

  if (round === 0) {
    return { score, round: 0, undrafted: true, bonus: 0, level: null, team: null };
  }

  const promo = cfg.first_round_direct_promotion;
  const level =
    round === promo.round && options.overall >= promo.min_overall
      ? promo.level
      : promo.fallback_level;

  const cpbl = teams.leagues['CPBL'] ?? [];
  const team = rng.pick(cpbl).name;

  return {
    score,
    round,
    undrafted: false,
    bonus: cfg.signing_bonus_by_round[round] ?? cfg.default_bonus,
    level,
    team,
  };
}

/**
 * 這次指名可不可以拒絕。
 *
 * 前段指名沒有拒絕的道理；年齡太大也不給，避免無限拖延。
 */
export function canRejectOffer(result: DraftResult, age: number): boolean {
  const cfg = amateur.draft.reject_offer;
  return !result.undrafted && result.round >= cfg.reject_from_round && age < cfg.max_age;
}

/**
 * 判定是否取得二刀流天賦。
 *
 * 條件是投手側與野手側**都**達到門檻——不是整體評價高就好，那只代表單邊強。
 * 判定時機在高中畢業、選秀之前，因為二刀流會影響球團的評估。
 */
export function qualifiesAsTwoWay(rating: Rating): boolean {
  const cfg = amateur.two_way_talent;
  return rating.pitcher >= cfg.min_pitcher && rating.fielder >= cfg.min_fielder;
}

/** 二刀流天賦的特性代碼。 */
export const TWO_WAY_TRAIT = amateur.two_way_talent.trait;
