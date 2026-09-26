/**
 * 成績表的資料列：生涯年表、各聯盟與頂級聯盟通算、國際賽、合併生涯紀錄。
 *
 * 畫面上的表格與下載的生涯成績圖共用這一份。這裡不含 JSX。
 */
import { leagues } from '../../data/index.ts';
import type { BattingLine, PitchingLine } from '../../engine/amateurStats.ts';
import { seasonPoints, warOf, type CareerSummary, type SeasonRecord, type WarByPart } from '../../engine/career.ts';
import { fmtAvg } from '../../engine/format.ts';
import { amateurBaseline, baselineAt, proBaseline, sumShares, winPct, type Baseline } from '../../engine/metrics.ts';
import { tournamentPar } from '../../engine/national.ts';
import { amateurLedger, intlLedger, NA, sumLedgers, type EventRecord, type SharesByPart } from './columns.ts';

/** 一列通算成績。第一欄是列名（聯盟或「通算」），其餘欄位與生涯年表一致。 */
export interface TotalRow {
  readonly label: string;
  readonly seasons: number;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  readonly defenseRuns: number;
  /** 這一季的三本帳。養成期沒有這份資料，一律 null。 */
  readonly shares: SharesByPart | null;
  readonly base: Baseline;
}

/**
 * 年表用的層級簡稱。
 *
 * 「中職二軍」在球隊名旁邊只需要寫「二軍」——聯盟名已經由球隊說完了，
 * 「桃園金剛・中職二軍」裡的「中職」是贅字。小聯盟的 1A／3A 本來就沒有
 * 冠聯盟名，原樣留著。
 *
 * **剪完是空字串就不剪。** 美職體系的前綴是「大聯盟」，而它最高一層的名字剛好
 * 就是「大聯盟」——照剪會剩下一個空格，年表上變成「洋基・」。層級名等於前綴時
 * 那個名字本身就是要顯示的東西。
 */
/**
 * 成績表裡的聯盟名：簡稱（中職、大聯盟…）。欄寬有限，是「畫面上一律寫正名」的唯一
 * 例外（見 CONTEXT.md 的頂級聯盟）。沒有簡稱的退回正名。
 */
function leagueShort(org: string, orgName: string): string {
  return leagues.league_short_names[org] ?? orgName;
}

function shortLevelName(levelName: string, org: string): string {
  const prefix = leagues.top_league_names[org] ?? leagues.org_names[org] ?? '';
  if (prefix === '' || !levelName.startsWith(prefix)) return levelName;
  const rest = levelName.slice(prefix.length);
  return rest === '' ? levelName : rest;
}

/** 生涯年表的一列。養成期與職業共用同一個形狀，年表才接得起來。 */
export interface CareerRow {
  readonly key: string;
  readonly year: number;
  readonly age: number;
  /** 球隊或學校。 */
  readonly team: string;
  /** 層級或學制的補充說明；頂級聯盟不必寫。 */
  readonly note: string | null;
  readonly position: string | null;
  /** 這一年的投手定位。養成期沒有牛棚分工，一律 null。 */
  readonly pitcherRole: SeasonRecord['pitcherRole'];
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  /** 這一年帶著什麼傷。養成期不追蹤傷病，一律 null。 */
  readonly injured: SeasonRecord['injured'];
  readonly defenseRuns: number;
  /** 這一季的三本帳。養成期沒有這份資料，一律 null。 */
  readonly shares: SharesByPart | null;
  readonly base: Baseline;
  /** 這一季的份額分（含難度，見 seasonPoints）。只有職業有；養成期是 null。 */
  readonly points: number | null;
}

/**
 * 國際賽的兩種：養成期與職業期。**兩張表分開**，逐屆一列、最後一列是總和；
 * 同一份成績不併進年表（與職業同一個規則）。基準線各用自己那一段的：職業用
 * 賽會的 par（成績就是拿它生成的），養成期用養成的基準線。
 */
export type IntlKind = 'youth' | 'pro';

export const INTL: Record<IntlKind, {
  readonly title: string;
  readonly rows: (s: CareerSummary) => CareerSummary['internationalSeasons'];
  readonly total: (s: CareerSummary) => CareerSummary['internationalTotal'];
  readonly base: () => Baseline;
  readonly ledger: (r: EventRecord) => SharesByPart;
}> = {
  youth: {
    title: '養成國際賽',
    rows: (s) => s.youthInternationalSeasons,
    total: (s) => s.youthInternationalTotal,
    base: () => amateurBaseline(),
    ledger: (r) => amateurLedger(r),
  },
  pro: {
    title: '職業國際賽',
    rows: (s) => s.internationalSeasons,
    total: (s) => s.internationalTotal,
    base: () => baselineAt(tournamentPar()),
    ledger: (r) => intlLedger(r),
  },
};

/** 國際賽通算的那一列。屆數算的是出賽的賽會數，不是年數——同一年可能有兩屆。 */
export function intlTotalRow(summary: CareerSummary, kind: IntlKind): TotalRow {
  const spec = INTL[kind];
  const rows = spec.rows(summary);
  const total = spec.total(summary);
  return {
    label: spec.title,
    seasons: rows.length,
    batting: total.batting,
    pitching: total.pitching,
    defenseRuns: rows.reduce((n, r) => n + r.defenseRuns, 0),
    // 國際賽的份額不進評價分，但照樣逐屆現算、逐屆加總——與職業通算同一個做法。
    shares: sumLedgers(rows.map((r) => spec.ledger(r))),
    // 率類欄位（OPS+、ERA+）的基準線：養成期用養成的；職業期沒有自己的聯盟可挑，
    // 借代表聯盟那把尺。
    base: kind === 'youth' ? amateurBaseline() : proBaseline(summary.leagues[0]?.topLevel ?? 'CPBL1'),
  };
}

/**
 * 合併表的一列：投打守三本帳合起來看。
 *
 * 份額分與評價分分開兩欄：逐年只算得出份額那一段（含難度），榮譽、里程碑與年資
 * 扣分是聯盟層級才加的，所以只有聯盟通算有評價分。養成期與國際賽兩欄都沒有。
 */
interface CombinedRow {
  readonly key: string;
  /** 前三欄：年、齡、球隊；通算列只寫第三格（列名）。 */
  readonly lead: readonly [string, string, string];
  readonly ledger: SharesByPart | null;
  readonly points: number | null;
  readonly score: number | null;
}

export const COMBINED_COLUMNS: readonly { key: string; title: string; value: (r: CombinedRow) => string }[] = (() => {
  const total = (l: SharesByPart) => sumShares(l.batting, l.pitching, l.fielding);
  const war = (r: CombinedRow, pick: (w: WarByPart) => number) =>
    r.ledger?.war === undefined ? NA : pick(r.ledger.war).toFixed(1);
  const num = (v: number | null) => (v === null ? NA : v.toFixed(1));
  return [
    { key: 'WS', title: '勝利份額：打擊、投球、守備合計', value: (r) => (r.ledger === null ? NA : total(r.ledger).win.toFixed(1)) },
    { key: 'LS', title: '敗戰份額：打擊、投球、守備合計', value: (r) => (r.ledger === null ? NA : total(r.ledger).loss.toFixed(1)) },
    {
      key: 'W%',
      title: '勝率：合計的勝利份額佔責任額的比例，.500 為聯盟平均',
      value: (r) => {
        if (r.ledger === null) return NA;
        const t = total(r.ledger);
        return t.win + t.loss === 0 ? NA : fmtAvg(winPct(t));
      },
    },
    { key: '打擊WAR', title: '打擊的 WAR', value: (r) => war(r, (w) => w.batting) },
    { key: '守備WAR', title: '守備的 WAR', value: (r) => war(r, (w) => w.fielding) },
    { key: '投球WAR', title: '投球的 WAR', value: (r) => war(r, (w) => w.pitching) },
    { key: 'WAR', title: '合計 WAR：比替代水準的球員多贏幾場。聯盟內的數字；跨聯盟的通算是直接加總', value: (r) => war(r, (w) => w.batting + w.fielding + w.pitching) },
    { key: '份額分', title: '份額換算的評價分（含難度係數）。逐年只有這一段', value: (r) => num(r.points) },
    { key: '評價分', title: '份額分加上榮譽與里程碑、扣掉年資未滿。只有聯盟通算有', value: (r) => num(r.score) },
  ];
})();

/** 合併表的全部列：年表（養成＋職業），接各聯盟、頂級聯盟、兩種國際賽的通算。 */
export function combinedRows(summary: CareerSummary): readonly CombinedRow[] {
  const out: CombinedRow[] = [];
  let lastYear: number | null = null;
  for (const r of careerRows(summary)) {
    // 季中轉隊的那一年兩列，年與齡只寫第一列（與年表同一個規則）。
    const cont = r.year === lastYear;
    lastYear = r.year;
    out.push({
      key: `c-${r.key}`,
      lead: [cont ? '' : String(r.year), cont ? '' : String(r.age), r.note === null ? r.team : `${r.team}・${r.note}`],
      ledger: r.shares,
      points: r.points,
      score: null,
    });
  }
  summary.leagues.forEach((l, i) => {
    const row = leagueTotals(summary)[i]!;
    out.push({ key: `c-l-${l.org}`, lead: ['', '', `${leagueShort(l.org, l.orgName)}通算`], ledger: row.shares, points: l.sharePoints, score: l.score });
  });
  if (summary.leagues.length > 1) {
    const top = topTotalRow(summary);
    out.push({
      key: 'c-top',
      lead: ['', '', '頂級聯盟通算'],
      ledger: top.shares,
      points: summary.leagues.reduce((n, l) => n + l.sharePoints, 0),
      score: summary.leagues.reduce((n, l) => n + l.score, 0),
    });
  }
  for (const kind of ['youth', 'pro'] as const) {
    if (INTL[kind].rows(summary).length === 0) continue;
    const row = intlTotalRow(summary, kind);
    out.push({ key: `c-intl-${kind}`, lead: ['', '', `${INTL[kind].title}通算`], ledger: row.shares, points: null, score: null });
  }
  return out;
}

/** 整季沒上場那一年的空白成績列：數字全是 0，率類欄位由欄位定義畫成「-」。 */
const ZERO_BATTING: BattingLine = {
  games: 0, starts: 0, pa: 0, ab: 0, runs: 0, hits: 0, double: 0, triple: 0, hr: 0, rbi: 0,
  bb: 0, ibb: 0, so: 0, sb: 0, cs: 0, hbp: 0, sac: 0, avg: 0, obp: 0, slg: 0,
};

const ZERO_PITCHING: PitchingLine = {
  games: 0, starts: 0, wins: 0, losses: 0, saves: 0, holds: 0, outs: 0, hits: 0, double: 0,
  triple: 0, runs: 0, er: 0, bb: 0, hbp: 0, so: 0, hr: 0, era: 0,
};

/** 養成期與職業合成一份年表，依年度排序。 */
export function careerRows(summary: CareerSummary): readonly CareerRow[] {
  const amateurRows: CareerRow[] = summary.amateurSeasons.map((a, i) => ({
    key: `am-${a.year}-${i}`,
    year: a.year,
    age: a.age,
    team: a.school,
    // 學制不寫——校名已經說了那是國中還是高中。
    note: null,
    position: a.position,
    pitcherRole: a.pitcherRole,
    batting: a.batting,
    pitching: a.pitching,
    injured: null,
    defenseRuns: a.defenseRuns,
    // 養成期不記份額——那一段不進評價分，也沒有守備與球隊戰績可以算。份額與 WAR
    // 從成績現算，替代水準是 par − 3（見 amateurLedger）。
    shares: amateurLedger(a),
    points: null,
    base: amateurBaseline(),
  }));

  // **整季沒上場的那一年照樣列出來**（開 TJ、整季復健）：出賽 0 場的成績在引擎裡是
  // null，年表以前就整列消失，看起來像那一年不存在。有定位就補一列 0 的投手成績、
  // 有守位就補一列 0 的野手成績；不在任何球隊的那一年，球隊欄寫「無」。
  const proRows: CareerRow[] = summary.seasons.map((s, i) => ({
    key: `pro-${s.year}-${s.level}-${i}`,
    year: s.year,
    age: s.age,
    team: s.team === '' ? '無' : s.team,
    // 頂級聯盟不必註明（那是預設），二軍與小聯盟則只寫層級——聯盟名已經
    // 由同一格的球隊名說完了，「桃園金剛・中職二軍」裡的「中職」是贅字。
    note: s.top === null ? shortLevelName(s.levelName, s.org) : null,
    position: s.position,
    pitcherRole: s.pitcherRole,
    batting: s.batting ?? (s.pitching === null && s.position !== null ? ZERO_BATTING : null),
    pitching: s.pitching ?? (s.batting === null && s.pitcherRole !== null ? ZERO_PITCHING : null),
    injured: s.injured,
    defenseRuns: s.defenseRuns,
    shares: { ...s.shares, war: warOf(s) },
    base: proBaseline(s.level),
    points: seasonPoints(s),
  }));

  return [...amateurRows, ...proRows].sort((a, b) => a.year - b.year);
}

/** 各頂級聯盟各一列。二軍不列——那不是這張表在回答的問題。 */
export function leagueTotals(summary: CareerSummary): readonly TotalRow[] {
  return summary.leagues.map((l) => ({
    label: leagueShort(l.org, l.orgName),
    seasons: l.seasons,
    batting: l.batting,
    pitching: l.pitching,
    defenseRuns: l.defenseRuns,
    shares: { ...l.sharesByPart, war: l.war },
    // 用結算給的頂級層級，**不要拿 org 拼字串**：墨聯的層級就叫 LMB、澳職叫
    // ABL、美職的頂級是 MLB，拼出來的 LMB1 不存在，讀它會直接拋錯——整個
    // 結算畫面因此變成一片空白。
    base: proBaseline(l.topLevel),
  }));
}

/** 所有頂級聯盟加起來的一列。只有跨過聯盟的人才需要它——單一聯盟的話它等於上一張表。 */
export function topTotalRow(summary: CareerSummary): TotalRow {
  return {
    label: '通算',
    seasons: summary.leagues.reduce((n, l) => n + l.seasons, 0),
    batting: summary.topTotal.batting,
    pitching: summary.topTotal.pitching,
    defenseRuns: summary.leagues.reduce((n, l) => n + l.defenseRuns, 0),
    shares: {
      batting: sumShares(...summary.leagues.map((l) => l.sharesByPart.batting)),
      pitching: sumShares(...summary.leagues.map((l) => l.sharesByPart.pitching)),
      fielding: sumShares(...summary.leagues.map((l) => l.sharesByPart.fielding)),
      war: {
        batting: summary.leagues.reduce((n, l) => n + l.war.batting, 0),
        pitching: summary.leagues.reduce((n, l) => n + l.war.pitching, 0),
        fielding: summary.leagues.reduce((n, l) => n + l.war.fielding, 0),
      },
    },
    // 通算橫跨數個聯盟，基準線只能挑一個——取評價分最高的那座，那是這段生涯
    // 的代表舞台。沒有職業紀錄時退回中職一軍。
    base: proBaseline(summary.leagues[0]?.topLevel ?? 'CPBL1'),
  };
}
