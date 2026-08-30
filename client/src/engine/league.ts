/**
 * 聯盟水準的逐年浮動。
 *
 * `leagues.json` 的 par／min 是**基準值**，不是每一年的實際值。人才有興衰，
 * 同一個聯盟在不同年代不是同一個聯盟——2003 年的中職一軍和 2019 年的中職一軍
 * 需要的能力不一樣。
 *
 * 兩個自由度：
 *
 * - **整體水準**：par 在基準上下擺盪。今年 44、明年 45。
 * - **貧富差距**：par 與 min 的距離會伸縮。差距大代表平均與邊緣拉開（人才
 *   斷層，只有少數強者撐場）；差距小代表競爭白熱（混不下去的立刻被換掉）。
 *
 * 擺盪**以體系為單位**：中職一軍與二軍共用同一組當年數值，同進同退。同一個
 * 體系的人才庫是連通的，一軍變強而二軍不動會讓升降級判定出現怪現象。
 *
 * 這是世界狀態，不是球員狀態——因此與 `teams.ts` 的球隊戰力一樣走 career
 * 子序列（ADR 0002 的歸屬規則：抽取歸屬於執行它的領域函式，而這兩者是同一類
 * 「生涯層級的世界逐年變動」）。
 *
 * 對評價分的影響：**沒有**。難度係數與替代水準都用當年的數值計算，浮動會被
 * 吃掉。它影響的是成績單——弱年的成績確實比較漂亮，那正是它該有的效果。
 * 見 ADR 0003。
 */

import { leagues, season as cfg } from '../data/index.ts';
import { standardDiscount, type HandednessTier } from './handedness.ts';
import type { World } from './rng.ts';

/** 某個層級在某一年的實際水準。 */
export interface LevelStandard {
  /** 該年的平均水準。 */
  readonly par: number;
  /** 該年的最低門檻，也就是替代水準。 */
  readonly min: number;
}

/** 全部層級在某一年的水準，以層級代碼為鍵。 */
export type LeagueStandards = ReadonlyMap<string, LevelStandard>;

/** 一個體系當年的擺盪狀態。 */
interface OrgDrift {
  /** 整體水準相對基準的位移，直接加在 par 上。 */
  readonly level: number;
  /** 差距倍率，1.0 為基準差距。 */
  readonly gap: number;
}

/** 體系代碼 → 該體系的當年擺盪。 */
type DriftTable = ReadonlyMap<string, OrgDrift>;

/** 全部體系代碼，順序照 leagues.json 的宣告——走訪順序改變會改變抽取順序。 */
function allOrgs(): readonly string[] {
  const seen: string[] = [];
  for (const info of Object.values(leagues.levels)) {
    if (!seen.includes(info.org)) seen.push(info.org);
  }
  return seen;
}

/** 把擺盪套用到每個層級，算出當年的水準表。 */
function applyDrift(drift: DriftTable): LeagueStandards {
  const table = new Map<string, LevelStandard>();
  for (const [level, info] of Object.entries(leagues.levels)) {
    const d = drift.get(info.org) ?? { level: 0, gap: 1 };
    const par = info.par + d.level;
    // 差距是伸縮的，不是平移的——min 由 par 減去縮放後的差距推導，這樣
    // 「平均與邊緣的距離」才會真的改變，而不是兩條線一起上下移動。
    const gap = (info.par - info.min) * d.gap;
    table.set(level, { par, min: par - gap });
  }
  return table;
}

/**
 * 開局的聯盟水準。
 *
 * 起點就是基準值，不先擲一次——生涯的第一年是玩家認識這個世界的基準點，
 * 讓它偏離會使「今年比較弱」這件事失去參照。
 */
export function initStandards(): LeagueStandards {
  return applyDrift(new Map());
}

/**
 * 推進一年。
 *
 * 每個體系先往基準靠攏，再加上一年的隨機變動。與球隊戰力同構——長期回歸，
 * 短期擺盪。
 *
 * 由當年的水準表反推擺盪狀態，因此不需要額外保存：位移是 par 減基準 par，
 * 差距倍率是當年差距除以基準差距。同一體系的所有層級擺盪相同，取任一即可。
 */
export function advanceStandards(world: World, prev: LeagueStandards): LeagueStandards {
  const rng = world.stream('career');
  const c = cfg.league_standards;
  const next = new Map<string, OrgDrift>();

  for (const org of allOrgs()) {
    const drift = driftOf(prev, org);

    const lPulled = drift.level * (1 - c.level_drift.mean_reversion);
    const lNoise =
      c.level_drift.yearly.min + rng.next() * (c.level_drift.yearly.max - c.level_drift.yearly.min);
    const level = clamp(lPulled + lNoise, c.level_drift.clamp.min, c.level_drift.clamp.max);

    // 差距的基準是 1.0，因此回歸的目標也是 1.0，不是 0。
    const gPulled = 1 + (drift.gap - 1) * (1 - c.gap_drift.mean_reversion);
    const gNoise =
      c.gap_drift.yearly.min + rng.next() * (c.gap_drift.yearly.max - c.gap_drift.yearly.min);
    const gap = clamp(gPulled + gNoise, c.gap_drift.clamp.min, c.gap_drift.clamp.max);

    next.set(org, { level, gap });
  }

  return applyDrift(next);
}

/** 由當年水準表反推某體系的擺盪狀態。 */
function driftOf(standards: LeagueStandards, org: string): OrgDrift {
  for (const [level, info] of Object.entries(leagues.levels)) {
    if (info.org !== org) continue;
    const now = standards.get(level);
    if (now === undefined) continue;
    const baseGap = info.par - info.min;
    return {
      level: now.par - info.par,
      gap: baseGap === 0 ? 1 : (now.par - now.min) / baseGap,
    };
  }
  return { level: 0, gap: 1 };
}

/**
 * 取某層級當年的**聯盟真尺**。
 *
 * 這把尺回答「他比別人強不強」——獎項門檻、生涯評價的難度係數。比較必須全
 * 聯盟同一條線，因此這裡不吃任何球員身上的折扣。
 *
 * `standards` 為 null 時退回基準值——養成期還沒有聯盟水準表，而評價用的守位
 * 推定仍需要一組數字。
 */
export function leagueStandardOf(standards: LeagueStandards | null, level: string): LevelStandard {
  const now = standards?.get(level);
  if (now !== undefined) return now;
  const info = leagues.levels[level];
  if (info === undefined) throw new Error(`未知的聯盟層級：${level}`);
  return { par: info.par, min: info.min };
}

/**
 * 取某層級當年**這名球員的那一把尺**。
 *
 * 這把尺回答「他被不被接受」——升降級、戰力外、球團簽約、守位門檻、國家隊
 * 徵召。這些是關卡，而關卡的高度因人而異：慣用手的折扣把整條尺平移到球員自
 * 己的那一把。
 *
 * **par 與 min 同步下移，兩者的差距不動。** 差距是「這個層級容得下多少落差」
 * ——那是聯盟的性質，不是球員的性質。只折 par 會讓左投的容錯區間跟著縮水，
 * 語意變成「他更容易被降級」，剛好反了。
 */
export function personalStandardOf(
  standards: LeagueStandards | null,
  level: string,
  tier: HandednessTier,
): LevelStandard {
  const now = leagueStandardOf(standards, level);
  const shift = now.par * standardDiscount(tier);
  if (shift === 0) return now;
  return { par: now.par - shift, min: now.min - shift };
}

/**
 * 這一年的聯盟給玩家的一句話。
 *
 * 只在偏離基準夠明顯時才說——每年都跳一則「今年聯盟略強」是雜訊，玩家會學會
 * 略過它。回傳 null 表示這年沒什麼好說的。
 */
export function standardsNote(standards: LeagueStandards, level: string): string | null {
  const info = leagues.levels[level];
  if (info === undefined) return null;
  const now = leagueStandardOf(standards, level);
  const shift = now.par - info.par;
  const gap = now.par - now.min;
  const baseGap = info.par - info.min;

  if (shift >= 1.2) return '一批天才同時成熟，整個聯盟的水準被往上拉了一截。';
  if (shift <= -1.2) return '幾位招牌球星同時退場，聯盟的整體水準比往年鬆了一些。';
  if (baseGap > 0 && gap >= baseGap * 1.3) {
    return '中間層薄得嚇人——強的很強，剩下的都在生死線上掙扎。';
  }
  if (baseGap > 0 && gap <= baseGap * 0.75) {
    return '競爭進入白熱化，稍微鬆懈一點就會有人把位置拿走。';
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
