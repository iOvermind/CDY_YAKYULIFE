/**
 * 天梯：把一段生涯攤成排名榜要的資料列。
 *
 * **一列是一個組合**：聯盟（或跨聯盟）× 守位（或跨守位）× 累計／單季。一段生涯
 * 只寫它實際打過的組合——打過中職與大聯盟、守過游擊與三壘的人，大概二三十列。
 * 畫面上的四個選單（我的／所有玩家、聯盟、累計／單季、守位）就是在這些列上挑。
 * 個人天梯與全伺服器天梯用的是同一份資料，差別只在查詢時限不限 `user_id`
 * （見 [ADR 0038](../../../docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)）。
 *
 * **只收頂級聯盟。** 與生涯表的「各聯盟通算」同一個界線——二軍與小聯盟的成績不
 * 進通算，也不該進榜：那些數字是在不同水準的對手身上打出來的。唯一的例外是薪水：
 * 某個聯盟的薪水問的是「那個體系的球團付了多少」，二軍那幾年也是他們付的。
 */

import { leagues, ladder } from '../data/index.ts';
import { addBatting, addPitching, type BattingLine, type PitchingLine } from './amateurStats.ts';
import { seasonPoints, type CareerSummary, type SeasonRecord } from './career.ts';

/** 「跨聯盟」與「跨守位」。與體系代碼、守位代碼共用同一個欄位，挑一個不可能撞名的字。 */
export const ALL = '*';

/** 累計，或單季最佳。 */
export type LadderKind = 'total' | 'best';

/** 一列的身分：三個選單的選擇。 */
export interface LadderKey {
  /** 體系代碼，或 `*`（跨聯盟）。 */
  readonly org: string;
  /** 守位或投手定位，或 `*`（跨守位）。 */
  readonly position: string;
  readonly kind: LadderKind;
}

/** 天梯排得出榜的守位，依顯示順序。野手在前、投手在後。 */
export const LADDER_POSITIONS: readonly string[] = [
  ...ladder.positions.fielding,
  ...ladder.positions.pitching,
];

const PITCHER_ROLES = new Set<string>(ladder.positions.pitching);

/** 這個守位代碼是投手定位嗎。守位選單靠它決定要畫野手表還是投手表。 */
export function isPitcherRole(position: string): boolean {
  return PITCHER_ROLES.has(position);
}

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
 * 一段生涯在某個組合下的成績，以及它的上榜資格。
 *
 * 資格算在這裡而不是查詢時：門檻要逐年累加各聯盟的球隊場次，那份逐年資料只在
 * 結算當下手上有——存進去之後就不必為了排一次榜把所有日誌重跑一遍。
 */
export interface LadderRow extends LadderKey {
  /** 這個組合內的球季數。單季寫 1。 */
  readonly seasons: number;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  readonly defenseRuns: number;
  /** 勝利份額與敗戰份額。**整個球員的，不分投打**——他的份額本來就只有一份。 */
  readonly winShares: number;
  readonly lossShares: number;
  /** 評價分。每種組合的意思不同，見 `scoreOf()`。 */
  readonly score: number;
  /** 薪水（萬元台幣）。每種組合的意思不同，見 `salaryOf()`。 */
  readonly salary: number;
  /** 率型打擊數值（打擊率／上壘率／長打率）上不上得了榜。 */
  readonly qualifiedBatter: boolean;
  /** 率型投球數值（防禦率）上不上得了榜。 */
  readonly qualifiedPitcher: boolean;
}

/** 一列扣掉身分、評價分與薪水之後的部分——那三樣要看它是哪一種組合。 */
type RowBody = Omit<LadderRow, keyof LadderKey | 'score' | 'salary'>;

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

/**
 * 把一段生涯攤成榜單資料列：每一個打過的「聯盟 × 守位 × 累計／單季」各一列。
 *
 * `earnings` 是生涯淨收入——跨聯盟跨守位那一列的薪水要它（扣掉離婚分走的財產
 * 與旅外安家費），其他組合拆不出淨收入，改用逐季的年薪與簽約金。
 */
export function ladderRows(summary: CareerSummary, earnings: number): readonly LadderRow[] {
  const rows: LadderRow[] = [];
  // 沒打過任何頂級聯盟就一列都沒有——一段沒上過一軍的生涯在榜上是空的，那是對
  // 的，不是漏算。
  if (summary.leagues.length === 0) return rows;

  for (const org of [ALL, ...summary.leagues.map((l) => l.org)]) {
    const top = topSeasons(summary, org === ALL ? null : org);
    if (top.length === 0) continue;
    // 守位：**只採計在那個守位登錄的球季**，二十六年生涯只有二十二年守游擊，游擊
    // 那兩列就只有那二十二年。二刀流兩邊都算。
    const played = LADDER_POSITIONS.filter((p) => top.some((r) => playedAt(r, p)));
    for (const position of [ALL, ...played]) {
      const records = position === ALL ? top : top.filter((r) => playedAt(r, position));
      const key = { org, position };
      rows.push({
        ...careerRow(records),
        ...key,
        kind: 'total',
        score: scoreOf(summary, key, 'total', records),
        salary: salaryOf(summary, key, 'total', records, earnings),
      });
      rows.push({
        ...bestRow(records),
        ...key,
        kind: 'best',
        score: scoreOf(summary, key, 'best', records),
        salary: salaryOf(summary, key, 'best', records, earnings),
      });
    }
  }
  return rows;
}

/**
 * 這一列的評價分。
 *
 * - 某聯盟、跨守位、累計：**那個聯盟的生涯評價分**（份額＋獎項＋里程碑），與名人堂
 *   看的是同一個數字。
 * - 跨聯盟、跨守位、累計：**總評價分**。
 * - 有指定守位：那些球季的份額淨分。獎項與里程碑分不到守位上——一座 MVP 是那一
 *   季拿的，不是游擊這個位置拿的。
 * - 單季：那一季的份額淨分，取最高的那一季。
 */
function scoreOf(
  summary: CareerSummary,
  key: { readonly org: string; readonly position: string },
  kind: LadderKind,
  records: readonly SeasonRecord[],
): number {
  if (kind === 'best') return records.reduce((best, r) => Math.max(best, seasonPoints(r)), 0);
  if (key.position === ALL) {
    if (key.org === ALL) return summary.totalScore;
    const league = summary.leagues.find((l) => l.org === key.org);
    if (league !== undefined) return league.score;
  }
  return records.reduce((sum, r) => sum + seasonPoints(r), 0);
}

/**
 * 這一列的薪水（萬元台幣）。
 *
 * - 某聯盟、跨守位、累計：**那個體系的球團付的年薪＋簽約金**。這裡刻意連二軍與
 *   小聯盟那幾年都算——問的是「那些球團付了多少」，而選秀的簽約金就是在二軍那一
 *   季入帳的。
 * - 跨聯盟、跨守位、累計：**生涯淨收入**，扣掉離婚分走的財產與旅外安家費。
 * - 有指定守位：那些球季的年薪＋簽約金。
 * - 單季：只算年薪，取最高的那一季。簽約金是一次性的，算進去的話「單季最高薪」
 *   會變成「哪一年跳槽」。
 */
function salaryOf(
  summary: CareerSummary,
  key: { readonly org: string; readonly position: string },
  kind: LadderKind,
  records: readonly SeasonRecord[],
  earnings: number,
): number {
  if (kind === 'best') return records.reduce((best, r) => Math.max(best, r.salary), 0);
  if (key.position === ALL) {
    if (key.org === ALL) return earnings;
    return summary.seasons
      .filter((r) => r.org === key.org)
      .reduce((sum, r) => sum + r.salary + r.bonus, 0);
  }
  return records.reduce((sum, r) => sum + r.salary + r.bonus, 0);
}

/** 一批球季的累計列。身分（聯盟、守位）與評價分、薪水由呼叫端補上。 */
function careerRow(records: readonly SeasonRecord[]): RowBody {
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
function bestRow(records: readonly SeasonRecord[]): RowBody {
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
