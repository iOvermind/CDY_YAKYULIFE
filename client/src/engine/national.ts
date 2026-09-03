/**
 * 職業期的國家隊徵召。
 *
 * 移植自 `index_legacy.html` 的 `maybeIntl()`。
 *
 * 兩件事讓它與養成期的國際賽不同：
 *
 * - **體育署公文**：第一次徵召起列管五年，期間強制、沒有選項。期滿之後「婉拒」
 *   才變成一個真的選擇——而那時你已經三十幾歲、身上有傷。
 * - **代價**：一屆賽會打完，下季的受傷風險上升。國家隊不是免費的榮耀。
 *
 * **門檻以中職為基準，旅外的人也用同一把尺**——國籍不會因為旅外而改變，中華隊的
 * 遴選標準不會因為你在日職打球就變嚴。
 */

import { amateur } from '../data/index.ts';
import { personalStandardOf, type LeagueStandards } from './league.ts';
import type { HandednessTier } from './handedness.ts';
import type { World } from './rng.ts';

const cfg = amateur.international;

/** 一屆賽事。 */
export interface Tournament {
  readonly code: string;
  readonly name: string;
  readonly short: string;
}

/**
 * 這一年有哪一項國際賽。沒有就回傳 null。
 *
 * 經典賽與 12 強錯開兩年，因此每兩年有一次。`level` 用來排除——**大聯盟球員不打
 * 12 強**，那個時間點他們在春訓。
 */
export function tournamentOf(year: number, level: string): Tournament | null {
  for (const [code, spec] of Object.entries(cfg.tournaments)) {
    if (code.startsWith('_')) continue;
    if ((year - spec.from_year) % spec.every !== 0) continue;
    if (year < spec.from_year) continue;
    if (spec.exclude_levels.includes(level)) continue;
    return { code, name: spec.name, short: spec.short };
  }
  return null;
}

/**
 * 有沒有被徵召的資格。
 *
 * 傷缺大半季的人不會被徵召，復健年更不會——那不是取捨，是他根本上不了場。
 */
export function isEligible(options: {
  readonly overall: number;
  readonly standards: LeagueStandards | null;
  readonly seasonFactor: number;
  /** 徵召是關卡，吃個人尺——見 CONTEXT.md「個人尺 / 聯盟真尺」。 */
  readonly tier: HandednessTier;
}): boolean {
  const e = cfg.eligibility;
  if (options.seasonFactor < e.min_season_factor) return false;
  const par = personalStandardOf(options.standards, e.reference_level, options.tier).par;
  return options.overall >= par + e.min_d;
}

/** 徵召的門檻值，給提示文字用。門檻因人而異，因此要帶檔次。 */
export function callUpBar(standards: LeagueStandards | null, tier: HandednessTier): number {
  const e = cfg.eligibility;
  return personalStandardOf(standards, e.reference_level, tier).par + e.min_d;
}

/**
 * 還在列管期內嗎。
 *
 * `lockedSince` 為 null 表示還沒被徵召過——那一年會被列管，因此也是強制的。
 */
export function isConscripted(lockedSince: number | null, year: number): boolean {
  if (lockedSince === null) return true;
  return year - lockedSince < cfg.conscription.lock_years;
}

/** 列管還剩幾年。 */
export function lockYearsLeft(lockedSince: number | null, year: number): number {
  if (lockedSince === null) return cfg.conscription.lock_years;
  return Math.max(0, cfg.conscription.lock_years - (year - lockedSince));
}

/** 一屆賽會的結果。 */
export interface TournamentResult {
  readonly rankIndex: number;
  readonly rank: string;
  readonly points: number;
  readonly mvp: boolean;
  readonly injuryNextSeason: number;
}

/**
 * 打一屆國際賽。
 *
 * 名次由**整體興衰**決定，個人能力只佔一小部分——一個人扛不動一支國家隊，那正是
 * 國際賽與個人成績的差別。
 *
 * **抽取次數與結果無關**：不管名次如何，MVP 的骰子都要擲，否則同一個種子會因為
 * 某一屆差一名而讓後面所有判定整串偏移。
 */
export function playTournament(
  world: World,
  options: { readonly overall: number; readonly traits: ReadonlySet<string> },
): TournamentResult {
  const rng = world.stream('career');
  const p = cfg.power_bonus;
  const bonus = Math.max(0, Math.min(p.max, Math.round((options.overall - p.base_overall) * p.factor)));
  const roll = rng.next() * 100 + bonus;

  let index = cfg.thresholds.length;
  for (let i = 0; i < cfg.thresholds.length; i++) {
    if (roll >= (cfg.thresholds[i] ?? 0)) {
      index = i;
      break;
    }
  }
  const rank = cfg.ranks[index] ?? '';

  const ace = options.traits.has(cfg.intlace_effect.trait);
  const base = cfg.points[index] ?? 0;
  const points = ace ? Math.max(base, cfg.intlace_effect.min_points) : base;

  // MVP 的骰子一律擲，與名次無關。
  const mvpRoll = rng.next() * 100;
  const clutch = options.traits.has(cfg.mvp.clutch_trait) ? cfg.mvp.clutch_multiplier : 1;
  const mvpChance = (cfg.mvp.by_rank[rank] ?? 0) * clutch;

  return {
    rankIndex: index,
    rank,
    points,
    mvp: mvpRoll < mvpChance,
    injuryNextSeason: ace ? cfg.intlace_effect.injury_next_season : cfg.injury_next_season,
  };
}

/** 這個名次值不值得記進榮譽榜。前三名才記。 */
export function isHonorRank(rank: string): boolean {
  return cfg.honor_ranks.values.includes(rank);
}

/** 這一屆的表現值多少總評價分。與生涯里程碑同一個桶，不進任何單一聯盟。 */
export function tournamentScore(rank: string, mvp: boolean): number {
  return (cfg.score.by_rank[rank] ?? 0) + (mvp ? cfg.score.mvp : 0);
}

/** 打進冠亞軍。東亞功夫的解鎖條件看它。 */
export function isPodium(rankIndex: number): boolean {
  return rankIndex <= 1;
}

/** 東亞功夫的解鎖：徵召夠多次，而且真的站上過頒獎台。 */
export function unlocksAce(options: {
  readonly caps: number;
  readonly podiums: number;
  readonly traits: ReadonlySet<string>;
}): boolean {
  const a = cfg.intlace_effect;
  if (options.traits.has(a.trait)) return false;
  return options.caps >= a.min_caps && options.podiums >= a.min_podiums;
}

/** Team Taiwan 的解鎖：國際賽出賽超過指定次數。 */
export function unlocksTaiwan(options: {
  readonly caps: number;
  readonly traits: ReadonlySet<string>;
}): boolean {
  const t = cfg.taiwan_trigger;
  if (options.traits.has(t.trait)) return false;
  return options.caps > t.min_count;
}

/**
 * 一屆賽會這個人上了幾場。
 *
 * **場次由名次決定。** 走得越遠打得越多——冠軍與亞軍同樣打滿決賽，季軍輸在準決賽，
 * 複賽止步輸在複賽，預賽出局只打了分組賽。舊版是從一個固定區間亂數抽、完全不看
 * 名次，於是「複賽止步打了八場、亞軍只打五場」是必然會發生的事。
 *
 * 個人的成績變化交給成績模型自己的抖動，不靠場次亂跳——場次是賽制決定的事實，
 * 不是隨機事件。
 */
export function tournamentGames(
  rankIndex: number,
  side: 'batter' | 'starter' | 'reliever',
): number {
  const s = cfg.stats;
  const values = s.games_by_rank.values;
  const teamGames = values[Math.min(Math.max(0, rankIndex), values.length - 1)] ?? 0;
  const share =
    side === 'batter' ? s.batter_share : side === 'starter' ? s.starter_share : s.reliever_share;
  return Math.max(s.min_games, Math.round(teamGames * share));
}

/** 國際賽的水準。一屆賽會的對手是各國的一線球員。 */
export function tournamentPar(): number {
  return cfg.stats.par;
}
