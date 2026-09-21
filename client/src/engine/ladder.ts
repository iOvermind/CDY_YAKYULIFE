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
import { addBatting, addPitching, type BattingLine, type PitchingLine } from './amateurStats.ts';
import type { CareerSummary, SeasonRecord } from './career.ts';

/** 生涯範圍的代碼。與體系代碼共用同一個欄位，因此挑一個不可能是體系代碼的字。 */
export const CAREER_SCOPE = 'CAREER';

/** 守位的生涯榜：`pos:SS`。 */
export const POSITION_PREFIX = 'pos:';
/** 守位的單季榜：`best:SS`。 */
export const BEST_PREFIX = 'best:';

/** 天梯排得出榜的守位，依顯示順序。野手在前、投手在後。 */
export const LADDER_POSITIONS: readonly string[] = [
  ...ladder.positions.fielding,
  ...ladder.positions.pitching,
];

const PITCHER_ROLES = new Set<string>(ladder.positions.pitching);

/**
 * 這一季算不算在某個守位底下。
 *
 * 野手看登錄守位、投手看定位，**二刀流兩邊都算**——他那一年既是游擊手也是先發
 * 投手，兩張榜上都該有他。
 */
function playedAt(record: SeasonRecord, position: string): boolean {
  return PITCHER_ROLES.has(position)
    ? record.pitcherRole === position
    : record.position === position;
}

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
  /** 勝利份額與敗戰份額。**整個球員的，不分投打**——他的份額本來就只有一份。 */
  readonly winShares: number;
  readonly lossShares: number;
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
function thresholdOf(records: readonly SeasonRecord[]): Threshold {
  const cfg = ladder.qualification.per_season;
  let pa = 0;
  let outs = 0;
  for (const r of records) {
    const games = leagues.levels[r.level]?.games ?? 0;
    pa += cfg.batter.per_team_game * games;
    outs += cfg.pitcher.per_team_game * games;
  }
  return { pa, outs, seasons: seasonCount(records) };
}

/**
 * 這批紀錄橫跨幾個球季。
 *
 * **數的是年份而不是列數**——季中被交易的那一年是一年，不是兩年。與生涯表的
 * `seasonCount` 同一條規則。
 */
function seasonCount(records: readonly SeasonRecord[]): number {
  return new Set(records.map((r) => r.year)).size;
}

/** 頂級聯盟的球季。二軍不算——它不進通算，也不該墊高門檻。 */
function topSeasons(summary: CareerSummary, org: string | null): readonly SeasonRecord[] {
  return summary.seasons.filter((r) => r.top !== null && (org === null || r.org === org));
}

/** 一批球季的份額合計。三本帳相加——份額是整個球員的，不分投打。 */
function sharesOf(records: readonly SeasonRecord[]): { win: number; loss: number } {
  let win = 0;
  let loss = 0;
  for (const r of records) {
    for (const part of ['batting', 'pitching', 'fielding'] as const) {
      win += r.shares[part].win;
      loss += r.shares[part].loss;
    }
  }
  return { win, loss };
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

/** 把一段生涯攤成榜單資料列。 */
export function ladderRows(summary: CareerSummary): readonly LadderRow[] {
  const rows: LadderRow[] = [];

  for (const league of summary.leagues) {
    const at = topSeasons(summary, league.org);
    const t = thresholdOf(at);
    const shares = sharesOf(at);
    rows.push({
      scope: league.org,
      seasons: league.seasons,
      batting: league.batting,
      pitching: league.pitching,
      defenseRuns: league.defenseRuns,
      winShares: shares.win,
      lossShares: shares.loss,
      qualifiedBatter: qualifies(league.batting?.pa ?? 0, t.pa, t.seasons),
      qualifiedPitcher: qualifies(league.pitching?.outs ?? 0, t.outs, t.seasons),
    });
  }

  // 生涯：跨聯盟通算。沒打過任何頂級聯盟就沒有這一列——一段沒上過一軍的生涯
  // 在榜上是空的，那是對的，不是漏算。
  if (summary.leagues.length > 0) {
    const all = topSeasons(summary, null);
    const t = thresholdOf(all);
    const shares = sharesOf(all);
    rows.push({
      scope: CAREER_SCOPE,
      seasons: summary.leagues.reduce((n, l) => n + l.seasons, 0),
      batting: summary.topTotal.batting,
      pitching: summary.topTotal.pitching,
      defenseRuns: summary.leagues.reduce((n, l) => n + l.defenseRuns, 0),
      winShares: shares.win,
      lossShares: shares.loss,
      qualifiedBatter: qualifies(summary.topTotal.batting?.pa ?? 0, t.pa, t.seasons),
      qualifiedPitcher: qualifies(summary.topTotal.pitching?.outs ?? 0, t.outs, t.seasons),
    });
  }

  // 守位：每個守位兩列——生涯累計與單季最佳。**只採計在那個守位登錄的球季**，
  // 二十六年生涯只有二十二年守游擊，游擊那兩列就只有那二十二年。
  for (const position of LADDER_POSITIONS) {
    const at = topSeasons(summary, null).filter((r) => playedAt(r, position));
    if (at.length === 0) continue;
    rows.push(careerRow(`${POSITION_PREFIX}${position}`, at));
    rows.push(bestRow(`${BEST_PREFIX}${position}`, at));
  }

  return rows;
}

/** 一批球季的累計列。 */
function careerRow(scope: string, records: readonly SeasonRecord[]): LadderRow {
  const t = thresholdOf(records);
  const shares = sharesOf(records);
  let batting: BattingLine | null = null;
  let pitching: PitchingLine | null = null;
  let defenseRuns = 0;
  for (const r of records) {
    batting = addBatting(batting, r.batting);
    pitching = addPitching(pitching, r.pitching);
    defenseRuns += r.defenseRuns;
  }
  return {
    scope,
    seasons: t.seasons,
    batting,
    pitching,
    defenseRuns,
    winShares: shares.win,
    lossShares: shares.loss,
    qualifiedBatter: qualifies(batting?.pa ?? 0, t.pa, t.seasons),
    qualifiedPitcher: qualifies(pitching?.outs ?? 0, t.outs, t.seasons),
  };
}

/**
 * 一批球季的**單季最佳**列。
 *
 * **每一欄各取最好的那一季，不必是同一年。** 全壘打取 2041 年的 62 支、打擊率取
 * 2038 年的 .402——現實的單季紀錄榜就是這樣讀的，每一項各問「誰的單季最高」。
 * 「最好」的方向照欄位自己的 `order`：防禦率越低越好，取最小。
 *
 * 率型只看**那一季自己達得到規定打席**的球季；一季都沒達到就整列沒有資格，與
 * 累計列同一套規則，只是分母換成一季。
 */
function bestRow(scope: string, records: readonly SeasonRecord[]): LadderRow {
  const qualified = (r: SeasonRecord, side: 'batter' | 'pitcher'): boolean => {
    const cfg = ladder.qualification.per_season;
    const games = leagues.levels[r.level]?.games ?? 0;
    return side === 'batter'
      ? (r.batting?.pa ?? 0) >= cfg.batter.per_team_game * games
      : (r.pitching?.outs ?? 0) >= cfg.pitcher.per_team_game * games;
  };

  const shares = { win: 0, loss: 0 };
  for (const r of records) {
    const one = sharesOf([r]);
    shares.win = Math.max(shares.win, one.win);
    shares.loss = Math.max(shares.loss, one.loss);
  }

  return {
    scope,
    // 單季榜比的就是一季，季數寫 1——榜上那一欄問的是「這是幾季累積出來的」。
    seasons: 1,
    batting: bestLine('batter', records, qualified),
    pitching: bestLine('pitcher', records, qualified),
    defenseRuns: records.reduce((best, r) => Math.max(best, r.defenseRuns), 0),
    winShares: shares.win,
    lossShares: shares.loss,
    qualifiedBatter: records.some((r) => qualified(r, 'batter')),
    qualifiedPitcher: records.some((r) => qualified(r, 'pitcher')),
  };
}

/**
 * 逐欄取最好的那一季，組成一條合成的成績列。
 *
 * 非榜上欄位沿用出賽最多那一季的值——沒有人讀它們，但留著才是一條形狀完整的
 * 成績列，而不是一個半截的物件。
 */
function bestLine<T extends BattingLine | PitchingLine>(
  side: 'batter' | 'pitcher',
  records: readonly SeasonRecord[],
  qualified: (r: SeasonRecord, side: 'batter' | 'pitcher') => boolean,
): T | null {
  const lines = records
    .map((r) => ({ record: r, line: (side === 'batter' ? r.batting : r.pitching) as T | null }))
    .filter((x): x is { record: SeasonRecord; line: T } => x.line !== null);
  if (lines.length === 0) return null;

  const template = lines.reduce((a, b) => (b.line.games > a.line.games ? b : a)).line;
  const out: Record<string, number> = { ...(template as unknown as Record<string, number>) };
  for (const column of ladder.columns[side]) {
    let best: number | null = null;
    for (const { record, line } of lines) {
      if (column.rate && !qualified(record, side)) continue;
      const value = (line as unknown as Record<string, number>)[column.key];
      if (typeof value !== 'number') continue;
      best =
        best === null ? value : column.order === 'asc' ? Math.min(best, value) : Math.max(best, value);
    }
    if (best !== null) out[column.key] = best;
  }
  return out as unknown as T;
}
