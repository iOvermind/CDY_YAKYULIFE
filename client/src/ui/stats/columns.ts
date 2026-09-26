/**
 * 成績表的欄位定義與每一列的三本帳。
 *
 * 畫面上的每一張成績表與下載的生涯成績圖都讀這一份——**同一份成績在哪裡都必須
 * 長得一樣**，欄位各寫一份遲早會分岔。這裡不含 JSX。
 */
import { amateur } from '../../data/index.ts';
import {
  bbPerNine,
  fmtInnings,
  kPerNine,
  ops,
  strikeoutsPerWalk,
  whip,
  type BattingLine,
  type PitchingLine,
} from '../../engine/amateurStats.ts';
import { eventLedger, type SeasonRecord, type WarByPart } from '../../engine/career.ts';
import { fmtAvg } from '../../engine/format.ts';
import {
  amateurBaseline,
  amateurBaselineAt,
  battingShares,
  baselineAt,
  eraPlus,
  opsPlus,
  pitchingShares,
  sumShares,
  winPct,
  type Baseline,
  type Shares,
} from '../../engine/metrics.ts';
import { tournamentPar } from '../../engine/national.ts';
import { fip } from '../../engine/season.ts';

/**
 * 標準打擊列與投球列。
 *
 * 欄位表寫成資料，兩張表就不必各自維護一份 thead 與 tbody——欄位增減只要改
 * 一個地方，而且順序一定對得上。表頭用縮寫（棒球記錄的通用寫法），滑鼠停留
 * 顯示中文全名。
 */
export interface StatColumn<T> {
  readonly key: string;
  readonly title: string;
  /**
   * 那一季的三本帳，**分開給**。
   *
   * 份額算不出來自單側那條成績列：守備那一本帳不在打擊列上，而球隊勝率的調整
   * 也只有結算當下手上才有。兩張表各取自己該取的那幾本——**野手表是打擊加守備**
   * （守備份額本來就是野手的一部分），投手表是投球。二刀流照樣分開放。
   *
   * 沒有那份資料時（養成期、國際賽）退回單側自算。
   */
  readonly value: (line: T, base: Baseline, shares: SharesByPart | null) => string | number;
}

/** 三本帳。守備那一本沒有自己的表，它跟著野手走。 */
/**
 * 一列成績的三本帳，外加那一列的 WAR。WAR 要逐季用當年的 k 換算，不能從合計的
 * 份額回推，因此由產生這一列的地方算好帶進來。
 */
export type SharesByPart = SeasonRecord['shares'] & { readonly war?: WarByPart };

// 養成期與國際賽沒有結算帳，由 `ledgerOf` 從成績現算——替代水準是那一段的 par − 3。

/**
 * 養成期與國際賽的三本帳：打擊與投球從成績現算，守備那本在記錄當下就算好了，
 * WAR 的替代水準是比那一段的 par 低 `war_replacement.d` 點的球員（見 eventLedger）。
 */
export type EventRecord = { readonly batting: BattingLine | null; readonly pitching: PitchingLine | null; readonly fielding: Shares };

export const amateurLedger = (r: EventRecord): SharesByPart =>
  eventLedger(r.batting, r.pitching, r.fielding, amateurBaseline(), amateurBaselineAt(amateur.war_replacement.d));

export const intlLedger = (r: EventRecord): SharesByPart =>
  eventLedger(r.batting, r.pitching, r.fielding, baselineAt(tournamentPar()), baselineAt(tournamentPar(), amateur.war_replacement.d));

/** 幾列帳加總：份額與 WAR 都逐列加。 */
export function sumLedgers(list: readonly SharesByPart[]): SharesByPart {
  const war = (part: keyof WarByPart) => list.reduce((n, l) => n + (l.war?.[part] ?? 0), 0);
  return {
    batting: sumShares(...list.map((l) => l.batting)),
    pitching: sumShares(...list.map((l) => l.pitching)),
    fielding: sumShares(...list.map((l) => l.fielding)),
    war: { batting: war('batting'), pitching: war('pitching'), fielding: war('fielding') },
  };
}

/** WAR 一位小數；沒有就是「-」。 */
const fmtWar = (war: number | undefined): string => (war === undefined ? NA : war.toFixed(1));

/**
 * 野手那張表的份額：**打擊加守備**。
 *
 * 守備份額本來就是野手的一部分——一個守游擊的人有三成多的價值在手套上，把它
 * 留在表外等於說那些年他沒做什麼。沒有結算資料時退回只算打擊。
 */
function batterShares(line: BattingLine, base: Baseline, parts: SharesByPart | null): Shares {
  return parts === null ? battingShares(line, base) : sumShares(parts.batting, parts.fielding);
}

/** 相對聯盟平均的指標統一這樣顯示：沒有樣本就畫破折號，不畫 0。 */
const rel = (v: number | null) => (v === null ? '—' : v);

/**
 * 率類欄位：**分母是 0 就畫「-」**，不畫 .000 或 0.00——整季報銷的那一年沒有打席、
 * 沒有局數，那不是「打擊率零」，是沒有打擊率。
 */
const noPa = (b: BattingLine) => b.pa === 0;

const noOuts = (p: PitchingLine) => p.outs === 0;

export const NA = '-';

export const BATTING_COLUMNS: readonly StatColumn<BattingLine>[] = [
  { key: 'G', title: '出賽', value: (b) => b.games },
  { key: 'PA', title: '打席', value: (b) => b.pa },
  { key: 'AB', title: '打數', value: (b) => b.ab },
  { key: 'R', title: '得分', value: (b) => b.runs },
  { key: 'H', title: '安打', value: (b) => b.hits },
  { key: '2B', title: '二壘打', value: (b) => b.double },
  { key: '3B', title: '三壘打', value: (b) => b.triple },
  { key: 'HR', title: '全壘打', value: (b) => b.hr },
  { key: 'RBI', title: '打點', value: (b) => b.rbi },
  { key: 'BB', title: '四壞', value: (b) => b.bb },
  { key: 'IBB', title: '故意四壞', value: (b) => b.ibb },
  { key: 'SO', title: '三振', value: (b) => b.so },
  { key: 'SB', title: '盜壘', value: (b) => b.sb },
  { key: 'CS', title: '盜壘刺', value: (b) => b.cs },
  { key: 'AVG', title: '打擊率', value: (b) => (noPa(b) ? NA : fmtAvg(b.avg)) },
  { key: 'OBP', title: '上壘率', value: (b) => (noPa(b) ? NA : fmtAvg(b.obp)) },
  { key: 'SLG', title: '長打率', value: (b) => (noPa(b) ? NA : fmtAvg(b.slg)) },
  { key: 'OPS', title: '整體攻擊指數', value: (b) => (noPa(b) ? NA : fmtAvg(ops(b))) },
  { key: 'OPS+', title: '相對聯盟平均的攻擊表現（100 為聯盟平均）', value: (b, base) => rel(opsPlus(b, base)) },
  { key: 'WS', title: '勝利份額：這一季替球隊贏下幾份勝利（打擊與守備合計）', value: (b, base, shares) => batterShares(b, base, shares).win.toFixed(1) },
  { key: 'LS', title: '敗戰份額：佔用了出場機會與守備位置卻沒換回勝利的部分', value: (b, base, shares) => batterShares(b, base, shares).loss.toFixed(1) },
  { key: 'W%', title: '勝率：勝利份額佔責任額的比例，.500 為聯盟平均', value: (b, base, shares) => (noPa(b) ? NA : fmtAvg(winPct(batterShares(b, base, shares)))) },
  {
    key: 'WAR',
    title: '勝場貢獻：比替代水準的球員多贏幾場（打擊＋守備）。聯盟內的數字，不跨聯盟換算',
    value: (_b, _base, shares) => fmtWar(shares?.war === undefined ? undefined : shares.war.batting + shares.war.fielding),
  },
];

export const PITCHING_COLUMNS: readonly StatColumn<PitchingLine>[] = [
  { key: 'G', title: '出賽', value: (p) => p.games },
  { key: 'GS', title: '先發', value: (p) => p.starts },
  { key: 'W', title: '勝', value: (p) => p.wins },
  { key: 'L', title: '敗', value: (p) => p.losses },
  { key: 'SV', title: '救援成功', value: (p) => p.saves },
  { key: 'HLD', title: '中繼成功', value: (p) => p.holds },
  { key: 'IP', title: '投球局數（小數點後是出局數，.1 為一人出局）', value: (p) => fmtInnings(p.outs) },
  { key: 'H', title: '被安打', value: (p) => p.hits },
  { key: 'R', title: '失分', value: (p) => p.runs },
  { key: 'ER', title: '自責分', value: (p) => p.er },
  { key: 'BB', title: '四壞', value: (p) => p.bb },
  { key: 'SO', title: '奪三振', value: (p) => p.so },
  { key: 'ERA', title: '防禦率', value: (p) => (noOuts(p) ? NA : p.era.toFixed(2)) },
  { key: 'WHIP', title: '每局被上壘率', value: (p) => (noOuts(p) ? NA : whip(p).toFixed(2)) },
  { key: 'K/9', title: '每九局奪三振', value: (p) => (noOuts(p) ? NA : kPerNine(p).toFixed(1)) },
  { key: 'BB/9', title: '每九局四壞', value: (p) => (noOuts(p) ? NA : bbPerNine(p).toFixed(1)) },
  { key: 'ERA+', title: '相對聯盟平均的防禦率（100 為聯盟平均）', value: (p, base) => rel(eraPlus(p, base)) },
  { key: 'FIP', title: '拿掉守備與運氣的防禦率：只看全壘打、四壞觸身與三振，聯盟平均等於聯盟防禦率', value: (p) => { const v = fip(p); return v === null ? NA : v.toFixed(2); } },
  { key: 'K/BB', title: '三振與四壞的比', value: (p) => { const v = strikeoutsPerWalk(p); return v === null ? NA : v.toFixed(2); } },
  { key: 'WS', title: '勝利份額：這一季替球隊贏下幾份勝利', value: (p, base, shares) => (shares?.pitching ?? pitchingShares(p, base)).win.toFixed(1) },
  { key: 'LS', title: '敗戰份額：佔用了投球局數卻沒換回勝利的部分', value: (p, base, shares) => (shares?.pitching ?? pitchingShares(p, base)).loss.toFixed(1) },
  { key: 'W%', title: '勝率：勝利份額佔責任額的比例，.500 為聯盟平均', value: (p, base, shares) => (noOuts(p) ? NA : fmtAvg(winPct(shares?.pitching ?? pitchingShares(p, base)))) },
  {
    key: 'WAR',
    title: '勝場貢獻：比替代水準的投手多贏幾場。聯盟內的數字，不跨聯盟換算',
    value: (_p, _base, shares) => fmtWar(shares?.war?.pitching),
  },
];
