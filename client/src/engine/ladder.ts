/**
 * 天梯：把一段生涯攤成排名榜要的資料列。
 *
 * 一段生涯產出數列——每個他待過的頂級聯盟各一列，加上跨聯盟通算的「生涯」那列。
 * 個人天梯與全伺服器天梯用的是同一份資料，差別只在查詢時限不限 `user_id`
 * （見 [ADR 0038](../../../docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)）。
 *
 * **只收頂級聯盟。** 與生涯表的「各聯盟通算」同一個界線——二軍與小聯盟的成績不
 * 進通算，也不該進榜：那些數字是在不同水準的對手身上打出來的。
 */

import { leagues, ladder } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import type { CareerSummary } from './career.ts';

/** 生涯範圍的代碼。與體系代碼共用同一個欄位，因此挑一個不可能是體系代碼的字。 */
export const CAREER_SCOPE = 'CAREER';

/**
 * 一段生涯在某個範圍下的成績，以及它的上榜資格。
 *
 * 資格算在這裡而不是查詢時：門檻要逐年累加各聯盟的球隊場次，那份逐年資料只在
 * 結算當下手上有——存進去之後就不必為了排一次榜把所有日誌重跑一遍。
 */
export interface LadderRow {
  /** 體系代碼，或 `CAREER`。 */
  readonly scope: string;
  /** 這個範圍內的球季數。 */
  readonly seasons: number;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  readonly defenseRuns: number;
  /** 率型打擊數值（打擊率／上壘率／長打率）上不上得了榜。 */
  readonly qualifiedBatter: boolean;
  /** 率型投球數值（防禦率）上不上得了榜。 */
  readonly qualifiedPitcher: boolean;
}

/** 一個範圍內的規定打席與規定局數（出局數），逐年累加。 */
interface Threshold {
  readonly pa: number;
  readonly outs: number;
  readonly seasons: number;
}

/**
 * 逐年累加規定量。
 *
 * 打者 `3.1 × 球隊場次`、投手 `1.0 × 球隊場次`（存的是出局數，所以是 `3 ×`），
 * 取自現實的規定打席與規定投球局數。**用他當年所在聯盟的場次**——在中職的那幾年
 * 用 120 場算、在大聯盟的那幾年用 162 場算，與現實的生涯榜同一個做法。
 *
 * 原始回報寫的是「每年出賽數達該聯盟的 8 成」。那條對打者近似成立，對投手則是
 * 不可能的門檻：先發投手一年出賽約 30 場，而 8 成場次是 96–130 場——沒有任何
 * 投手達得到，防禦率榜會永遠是空的。
 */
function thresholdOf(summary: CareerSummary, org: string | null): Threshold {
  const cfg = ladder.qualification.per_season;
  let pa = 0;
  let outs = 0;
  let seasons = 0;
  for (const r of summary.seasons) {
    if (r.top === null) continue; // 二軍不算——它不進通算，也不該墊高門檻
    if (org !== null && r.org !== org) continue;
    const games = leagues.levels[r.level]?.games ?? 0;
    pa += cfg.batter.per_team_game * games;
    outs += cfg.pitcher.per_team_game * games;
    seasons += 1;
  }
  return { pa, outs, seasons };
}

/**
 * 率型數值的兩道門檻。
 *
 * **兩道同時成立才算。** 季數擋掉「打五年就退休的高點生涯」，累積量擋掉「打十二年
 * 但年年都是代打」——各自招不同的人，不是重複收費。中間有大傷沒關係：門檻看的是
 * 加總，不是每一年都要達標。
 */
function qualifies(total: number, required: number, seasons: number): boolean {
  return seasons >= ladder.qualification.min_seasons && total >= required;
}

/** 把一段生涯攤成榜單資料列：每個待過的頂級聯盟一列，加上生涯一列。 */
export function ladderRows(summary: CareerSummary): readonly LadderRow[] {
  const rows: LadderRow[] = [];

  for (const league of summary.leagues) {
    const t = thresholdOf(summary, league.org);
    rows.push({
      scope: league.org,
      seasons: league.seasons,
      batting: league.batting,
      pitching: league.pitching,
      defenseRuns: league.defenseRuns,
      qualifiedBatter: qualifies(league.batting?.pa ?? 0, t.pa, t.seasons),
      qualifiedPitcher: qualifies(league.pitching?.outs ?? 0, t.outs, t.seasons),
    });
  }

  // 生涯：跨聯盟通算。沒打過任何頂級聯盟就沒有這一列——一段沒上過一軍的生涯
  // 在榜上是空的，那是對的，不是漏算。
  if (summary.leagues.length > 0) {
    const t = thresholdOf(summary, null);
    rows.push({
      scope: CAREER_SCOPE,
      seasons: summary.leagues.reduce((n, l) => n + l.seasons, 0),
      batting: summary.topTotal.batting,
      pitching: summary.topTotal.pitching,
      defenseRuns: summary.leagues.reduce((n, l) => n + l.defenseRuns, 0),
      qualifiedBatter: qualifies(summary.topTotal.batting?.pa ?? 0, t.pa, t.seasons),
      qualifiedPitcher: qualifies(summary.topTotal.pitching?.outs ?? 0, t.outs, t.seasons),
    });
  }

  return rows;
}
