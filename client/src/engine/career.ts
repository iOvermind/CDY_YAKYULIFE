/**
 * 生涯評價分與生涯總結。
 *
 * 評價分 = `勝利份額 − k × 敗戰份額`，再加上榮譽與聯盟里程碑的加分，全部乘上
 * 該聯盟的難度係數。見 [ADR 0003](../../../docs/adr/0003-win-loss-shares-career-score.md)。
 *
 * 三個原則貫穿整份計算：
 *
 * 1. **只算頂級聯盟。** 二軍與小聯盟的成績照樣逐年顯示與通算，但不進任何評價
 *    分——與 legacy 一致（`endGame()` 的 `if(b!=='MINOR')`）。
 * 2. **每個頂級聯盟各算一份。** 三個聯盟的名人堂是三件事，一個人可以同時進入
 *    多個。「所有一軍通算」只是顯示用的一列，不參與判定。
 * 3. **零點在替代水準。** `k` 由該層級當年的 `min` 與 `par` 推導，不是自由
 *    參數——卡在留隊邊緣的球員，生涯評價分原地踏步。
 *
 * 本模組是純函式，不抽亂數。名人堂票選要擲骰，因此在 `hall.ts`。
 */

import { hallOfFame as cfg, leagues, type Milestone } from '../data/index.ts';
import { addBatting, addPitching, type BattingLine, type PitchingLine } from './amateurStats.ts';
import type { AwardRecord } from './awards.ts';
import { sumShares, type Shares } from './metrics.ts';

/**
 * 一段效力的紀錄。
 *
 * 以「一段」而非「一年」為單位：季中下放或季中轉隊會在同一年產生兩段。目前
 * 的升降級都在球季結束後判定，因此實際上一年就是一段——但紀錄的形狀先做對，
 * 將來接上季中交易時不必重寫。
 *
 * 份額與 `k` 在球季當下就算好存進來，不在結算時回算：那些值取決於**當年**的
 * 聯盟水準，而聯盟水準逐年浮動，事後回算會全部套到引退那年的數字上。
 */
export interface SeasonRecord {
  readonly year: number;
  readonly age: number;
  /** 體系代碼，例如 CPBL。 */
  readonly org: string;
  /** 層級代碼，例如 CPBL1。 */
  readonly level: string;
  readonly levelName: string;
  readonly team: string;
  /** 登錄守位；沒登錄時為 null。 */
  readonly position: string | null;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  /** 這一季的守備分（顯示用）。 */
  readonly defenseRuns: number;
  /** 三個分段的雙帳。 */
  readonly shares: {
    readonly batting: Shares;
    readonly pitching: Shares;
    readonly fielding: Shares;
  };
  /** 三個分段各自的敗戰份額扣分係數，取自**當年**的聯盟水準。 */
  readonly lossPenalty: {
    readonly batting: number;
    readonly pitching: number;
    readonly fielding: number;
  };
  /** 這一年這個層級的難度係數。 */
  readonly difficulty: number;
  /** 頂級聯盟代碼；非頂級層級為 null。評價分只看有值的那些。 */
  readonly top: string | null;
}

/** 某個聯盟的生涯總結。 */
export interface LeagueCareer {
  readonly org: string;
  readonly orgName: string;
  readonly seasons: number;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  readonly defenseRuns: number;
  readonly shares: Shares;
  /** 份額換算出來的分數（已含難度係數與 k 的扣分）。 */
  readonly sharePoints: number;
  readonly awardPoints: number;
  readonly milestonePoints: number;
  /** 評價分：以上三者相加。 */
  readonly score: number;
  /** 分級，0 為名人堂，4 為過客。 */
  readonly tier: number;
  readonly tierLabel: string;
  /** 達成的里程碑敘述。 */
  readonly milestones: readonly string[];
  /** 帽徽：在這個聯盟效力最久的球隊。 */
  readonly capTeam: string;
}

/** 非頂級層級的通算，只顯示不計分。 */
export interface MinorCareer {
  readonly level: string;
  readonly levelName: string;
  readonly seasons: number;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
}

export interface CareerSummary {
  /** 各頂級聯盟的總結，依評價分由高到低。 */
  readonly leagues: readonly LeagueCareer[];
  /** 非頂級層級的通算，依層級代碼排序。 */
  readonly minors: readonly MinorCareer[];
  /** 所有一軍通算。純顯示，不參與任何判定。 */
  readonly topTotal: { readonly batting: BattingLine | null; readonly pitching: PitchingLine | null };
  /** 所有二軍通算。 */
  readonly minorTotal: {
    readonly batting: BattingLine | null;
    readonly pitching: PitchingLine | null;
  };
  /** 總評價分：跨聯盟通算，供合併生涯紀錄、成就與天梯使用。 */
  readonly totalScore: number;
  /** 生涯里程碑（跨聯盟通算），只進總評價分。 */
  readonly careerMilestones: readonly string[];
  /** 生涯代表聯盟。沒打過頂級聯盟時為 null。 */
  readonly representative: LeagueCareer | null;
  /** 生涯最佳分級。沒打過頂級聯盟時為最低帶。 */
  readonly bestTier: number;
}

/**
 * 聯盟難度係數。
 *
 * `(當年 par / 基準 par) ^ 指數`。弱聯盟的份額會虛胖——聯盟平均是自我參照的，
 * 因此能力相同的球員在弱聯盟宰制力更強、份額更高。這個係數把虛胖壓回去。
 *
 * 用**當年**的 par，因此聯盟水準的逐年浮動會被吃掉：玩家不會因為生在弱年而
 * 白賺評價分，但成績單上仍看得到那年打得特別兇。
 */
export function difficultyOf(par: number): number {
  const d = cfg.difficulty;
  if (d.reference_par <= 0 || par <= 0) return 1;
  return Math.pow(par / d.reference_par, d.exponent);
}

/** 一段效力貢獻的分數：三個分段各自扣完敗戰份額，再乘難度係數。 */
export function seasonPoints(record: SeasonRecord): number {
  const net =
    record.shares.batting.win - record.lossPenalty.batting * record.shares.batting.loss +
    record.shares.pitching.win - record.lossPenalty.pitching * record.shares.pitching.loss +
    record.shares.fielding.win - record.lossPenalty.fielding * record.shares.fielding.loss;
  return net * record.difficulty;
}

/** 這座獎值多少分。 */
export function awardPoints(code: string): number {
  return cfg.award_points.by_code[code] ?? cfg.award_points.default;
}

/** 從累計成績取出某項統計。找不到回傳 null——0 會被當成真的打出這個數字。 */
function statOf(
  batting: BattingLine | null,
  pitching: PitchingLine | null,
  milestone: Milestone,
): number | null {
  if (milestone.side === 'batter') {
    if (batting === null) return null;
    switch (milestone.stat) {
      case 'hits':
        return batting.hits;
      case 'hr':
        return batting.hr;
      case 'rbi':
        return batting.rbi;
      case 'sb':
        return batting.sb;
      default:
        return null;
    }
  }
  if (pitching === null) return null;
  switch (milestone.stat) {
    case 'wins':
      return pitching.wins;
    case 'so':
      return pitching.so;
    case 'saves':
      return pitching.saves;
    default:
      return null;
  }
}

/**
 * 里程碑結算。
 *
 * 逐級累進：達到第一級拿第一級的分，達到第二級再加第二級的分。門檻依球季場次
 * 等比放大——中職 120 場的 1000 安，到大聯盟 162 場就是 1350 安。
 *
 * `leagueGames` 傳 null 表示不縮放（生涯里程碑跨聯盟通算，沒有單一的場次可依）。
 */
export function evaluateMilestones(
  list: readonly Milestone[],
  batting: BattingLine | null,
  pitching: PitchingLine | null,
  leagueGames: number | null,
): { readonly points: number; readonly reached: readonly string[] } {
  const scale = leagueGames === null ? 1 : leagueGames / cfg.milestones.reference_games;
  let points = 0;
  const reached: string[] = [];

  for (const m of list) {
    const value = statOf(batting, pitching, m);
    if (value === null) continue;

    let highest: number | null = null;
    for (let i = 0; i < m.steps.length; i++) {
      const need = Math.round((m.steps[i] ?? 0) * scale);
      if (value < need) break;
      points += m.points[i] ?? 0;
      highest = need;
    }
    // 只列最高的那一級——「1000 安、1500 安、2000 安」三行都印出來很囉唆，
    // 玩家要看的是他走到哪裡。分數則是逐級累加的。
    if (highest !== null) reached.push(`${highest} ${m.name}`);
  }
  return { points, reached };
}

/** 分級：由高到低比對門檻，取第一個達到的。全部沒達到就是最低帶。 */
export function tierOf(score: number): number {
  const values = cfg.tier_thresholds.values;
  for (let i = 0; i < values.length; i++) {
    if (score >= (values[i] ?? Number.POSITIVE_INFINITY)) return i;
  }
  return values.length;
}

/**
 * 獎項保底。
 *
 * 拿過 MVP 或年度最佳投手的人至少是明星，拿過單項王的至少是每日。這個機制
 * 處理的是「短而璀璨」的生涯——那種人的累積份額不高，但沒有人會說他不是
 * 明星球員。
 */
export function applyTierFloors(tier: number, codes: ReadonlySet<string>): number {
  let best = tier;
  for (const rule of cfg.tier_floors.rules) {
    if (rule.codes.some((c) => codes.has(c))) best = Math.min(best, rule.min_tier);
  }
  return best;
}

export function tierLabel(tier: number): string {
  return cfg.tier_thresholds.labels[tier] ?? cfg.tier_thresholds.labels.at(-1) ?? '';
}

/** 在這些紀錄裡效力最久的球隊。用於名人堂帽徽。 */
function longestTeam(records: readonly SeasonRecord[]): string {
  const tally = new Map<string, number>();
  for (const r of records) tally.set(r.team, (tally.get(r.team) ?? 0) + 1);
  let best = '';
  let most = 0;
  for (const [team, count] of tally) {
    if (count > most) {
      most = count;
      best = team;
    }
  }
  return best;
}

function totalLines(records: readonly SeasonRecord[]): {
  batting: BattingLine | null;
  pitching: PitchingLine | null;
} {
  let batting: BattingLine | null = null;
  let pitching: PitchingLine | null = null;
  for (const r of records) {
    batting = addBatting(batting, r.batting);
    pitching = addPitching(pitching, r.pitching);
  }
  return { batting, pitching };
}

/** 這個體系的中文名。 */
function orgNameOf(org: string): string {
  return leagues.top_league_names[org] ?? leagues.org_names[org] ?? org;
}

/**
 * 結算一段生涯。
 *
 * 純函式：同樣的紀錄與獎項一定得到同樣的總結，因此可以在任何時候重算——
 * 引退畫面、成就檢定、伺服器端驗證用的是同一份邏輯。
 */
export function summarizeCareer(
  records: readonly SeasonRecord[],
  awards: readonly AwardRecord[],
  championships = 0,
): CareerSummary {
  // ---- 頂級聯盟：各算一份
  const byTop = new Map<string, SeasonRecord[]>();
  const minorRecords: SeasonRecord[] = [];
  for (const r of records) {
    if (r.top === null) {
      minorRecords.push(r);
      continue;
    }
    const list = byTop.get(r.top);
    if (list === undefined) byTop.set(r.top, [r]);
    else list.push(r);
  }

  const leagueCareers: LeagueCareer[] = [];
  for (const [org, list] of byTop) {
    const lines = totalLines(list);
    const shares = sumShares(
      ...list.flatMap((r) => [r.shares.batting, r.shares.pitching, r.shares.fielding]),
    );
    const sharePoints = list.reduce((sum, r) => sum + seasonPoints(r), 0);

    const own = awards.filter((a) => a.org === org);
    const awardTotal =
      own.reduce((sum, a) => sum + awardPoints(a.code), 0) +
      championships * cfg.award_points.championship.points;

    const games = leagues.levels[list[0]?.level ?? '']?.games ?? cfg.milestones.reference_games;
    const milestones = evaluateMilestones(
      cfg.milestones.league,
      lines.batting,
      lines.pitching,
      games,
    );

    const score = sharePoints + awardTotal + milestones.points;
    const tier = applyTierFloors(tierOf(score), new Set(own.map((a) => a.code)));

    leagueCareers.push({
      org,
      orgName: orgNameOf(org),
      seasons: list.length,
      batting: lines.batting,
      pitching: lines.pitching,
      defenseRuns: list.reduce((sum, r) => sum + r.defenseRuns, 0),
      shares,
      sharePoints,
      awardPoints: awardTotal,
      milestonePoints: milestones.points,
      score,
      tier,
      tierLabel: tierLabel(tier),
      milestones: milestones.reached,
      capTeam: longestTeam(list),
    });
  }
  leagueCareers.sort((a, b) => b.score - a.score);

  // ---- 非頂級層級：依層級分列，只顯示不計分
  const byLevel = new Map<string, SeasonRecord[]>();
  for (const r of minorRecords) {
    const list = byLevel.get(r.level);
    if (list === undefined) byLevel.set(r.level, [r]);
    else list.push(r);
  }
  const minors: MinorCareer[] = [...byLevel.entries()]
    .map(([level, list]) => {
      const lines = totalLines(list);
      return {
        level,
        levelName: list[0]?.levelName ?? level,
        seasons: list.length,
        batting: lines.batting,
        pitching: lines.pitching,
      };
    })
    .sort((a, b) => a.level.localeCompare(b.level));

  // ---- 生涯里程碑：跨聯盟通算，只進總評價分
  const allTop = totalLines(records.filter((r) => r.top !== null));
  const careerMilestones = evaluateMilestones(
    cfg.milestones.career,
    allTop.batting,
    allTop.pitching,
    null,
  );

  // ---- 總評價分：各聯盟的份額與榮譽加總，再加生涯里程碑
  const totalScore =
    leagueCareers.reduce((sum, l) => sum + l.sharePoints + l.awardPoints, 0) +
    careerMilestones.points;

  const representative = pickRepresentative(leagueCareers, records);

  return {
    leagues: leagueCareers,
    minors,
    topTotal: allTop,
    minorTotal: totalLines(minorRecords),
    totalScore,
    careerMilestones: careerMilestones.reached,
    representative,
    bestTier: representative?.tier ?? cfg.tier_thresholds.values.length,
  };
}

/**
 * 生涯代表聯盟。
 *
 * 先取最佳分級；同分級取年資最長；仍相同則取當年 par 較高者——同樣的成就在
 * 更強的聯盟達成，代表性更高。引退場景與帽徽都看它。
 */
function pickRepresentative(
  leagueCareers: readonly LeagueCareer[],
  records: readonly SeasonRecord[],
): LeagueCareer | null {
  if (leagueCareers.length === 0) return null;
  const best = Math.min(...leagueCareers.map((l) => l.tier));
  const tied = leagueCareers.filter((l) => l.tier === best);
  if (tied.length === 1) return tied[0] ?? null;

  const parOf = (org: string) =>
    Math.max(
      0,
      ...records.filter((r) => r.top === org).map((r) => leagues.levels[r.level]?.par ?? 0),
    );

  return (
    [...tied].sort((a, b) => b.seasons - a.seasons || parOf(b.org) - parOf(a.org))[0] ?? null
  );
}
