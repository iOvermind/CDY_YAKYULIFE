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
 *    多個。「所有頂級聯盟通算」只是顯示用的一列，不參與判定。
 * 3. **零點在替代水準。** `k` 由該層級當年的 `min` 與 `par` 推導，不是自由
 *    參數——卡在留隊邊緣的球員，生涯評價分原地踏步。
 *
 * 本模組是純函式，不抽亂數。名人堂票選要擲骰，因此在 `hall.ts`。
 */

import { achievements, awards as awardsCfg, hallOfFame as cfg, leagues } from '../data/index.ts';
import { addBatting, addPitching, statTotal, type BattingLine, type PitchingLine } from './amateurStats.ts';
import { ladderTop, rungName } from './achievements.ts';
import type { PitcherRole } from './season.ts';
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
/**
 * 一屆國際賽的紀錄。
 *
 * **與聯盟成績分開存**：國際賽不屬於任何聯盟（見 summarizeCareer 的說明），
 * 混進 SeasonRecord 會污染聯盟通算與階梯成就。
 *
 * 名次與賽事名存在這裡而不是只留一條榮譽字串：ADR 0031 之後榮譽字串不帶年份
 * （帶了的話同一項成就每年都會被當成新解鎖），因此「哪一年代表隊拿了什麼」
 * 沒有別的地方留得住。成就問「這輩子做到了嗎」，年表問「哪一年做到的」。
 *
 * **一屆一列，不逐場**：引擎沒有逐場的粒度，一屆賽會直接產出一條合計成績，
 * 聯盟球季也是同一種模型。
 */
export interface InternationalRecord {
  readonly year: number;
  readonly age: number;
  /** 賽事名稱，例如「世界棒球經典賽」。 */
  readonly tournament: string;
  /** 中華隊的最終名次。 */
  readonly rank: string;
  /** 是否獲選賽會 MVP。 */
  readonly mvp: boolean;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
}
export interface SeasonRecord {
  readonly year: number;
  readonly age: number;
  /** 體系代碼，例如 CPBL。 */
  readonly org: string;
  /** 層級代碼，例如 CPBL1。 */
  readonly level: string;
  readonly levelName: string;
  readonly team: string;
  /**
   * 這一季實際站的守位。三個階段共用同一份登錄守位（ADR 0037）。
   *
   * 生涯表要的是「這個人當時站哪裡」，不是「他有沒有辦過登錄手續」——二軍
   * 那幾年留白等於在說他沒上場。純投手為 null，他們不進守位系統。
   */
  readonly position: string | null;
  /**
   * 這一季的投手定位（SP／CP／SU／MR／LR）。非投手與養成期為 null。
   *
   * 與 `position` 同一個立場：生涯表問的是「這個人當年在做什麼」。投手的定位每季
   * 重新判定——體力掉下來的那一年他從輪值變成牛棚，那是他生涯的轉折，年表上看得到
   * 才有意義。
   */
  readonly pitcherRole: PitcherRole | null;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  /**
   * 這一季的傷勢：小傷 / 大傷 / 整季復健，沒事是 null。
   *
   * 存在檔裡而不是從日誌重算（ADR 0002：日誌是事實、顯示是重算），是因為
   * 生涯表要的正是「哪幾年他不是完整的」——那是這張表的事實之一，不是排版。
   * `rehab` 與 `major` 分開：復健年是**去年那一刀的帳**在今年到期，這一年
   * 他根本沒有受新的傷。
   */
  readonly injured: 'minor' | 'major' | 'rehab' | null;
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
  /**
   * 這一季的出賽係數，1 為健康、< 1 為傷缺。
   *
   * 評價分不讀它——傷病早就乘進出賽量裡了，再讀一次是重複計算。它留在這裡是
   * 為了讓校準能把「傷缺季」與「健康季」分開量：出賽率偏低到底是體力曲線太
   * 苛還是傷病太頻繁，混在一起是分不出來的。
   */
  readonly seasonFactor: number;
  /**
   * 這一段實領的年薪（萬元台幣）。季中被交易的那一年照出賽比例拆給兩段——
   * 合約跟著人走，前半季與後半季各付各的。
   */
  readonly salary: number;
  /**
   * 這一段收到的簽約金（萬元台幣）。
   *
   * 簽約金在簽約的當下入帳，但它記在**簽下之後的第一季**上：那是新東家付的錢，
   * 該算進新東家的聯盟。只記球團付的錢——離婚分走的財產、旅外的安家費、買斷
   * 都不在這裡，那些只進生涯淨收入。
   */
  readonly bonus: number;
}

/**
 * 一年的養成期紀錄。
 *
 * 與職業的 `SeasonRecord` 分開，因為兩者能回答的問題不同：養成期沒有聯盟
 * 水準、沒有份額、沒有守位登錄，硬塞進同一個型別會讓一半的欄位永遠是空的。
 * 但生涯年表要把它們接在一起顯示——**養成六年也是這段生涯的一部分**。
 */
export interface AmateurSeasonRecord {
  readonly year: number;
  readonly age: number;
  /** 階段代碼，例如 JHS。 */
  readonly stage: string;
  /** 階段的中文名，例如國中。 */
  readonly stageName: string;
  /** 就讀的學校。年表的「球隊」欄顯示它。 */
  readonly school: string;
  /**
   * 這一季的登錄守位（見 ADR 0037）。學生棒球沒有登錄手續，但人站在某個位置
   * 上，生涯表就該寫出來；純投手掛 DH——他在學生時代照樣進打擊區。
   */
  readonly position: string | null;
  /**
   * 這一季的投手定位（SP／CP／SU／MR／LR）。沒投球的人是 null。
   *
   * 養成期以前一律不寫，理由是「學生棒球沒有牛棚分工」——但那不對：學生球隊
   * 一樣有王牌與救火的人，而定位本來就由體力與球威決定，不是職業才長出來的
   * 東西。年表少了這一欄，一個高中就在關門的人看起來跟先發沒有兩樣。
   */
  readonly pitcherRole: PitcherRole | null;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
}

/** 某個聯盟的生涯總結。 */
export interface LeagueCareer {
  readonly org: string;
  readonly orgName: string;
  /**
   * 這個體系的頂級層級代碼，例如 CPBL1、LMB、MLB。
   *
   * **不要用 `org + '1'` 拼**：那只對中職、日職、韓職成立。墨聯的層級就叫
   * `LMB`、澳職叫 `ABL`、美職叫 `MLB`——拼出來的 `LMB1` 不存在，讀它的地方會
   * 直接拋錯。
   */
  readonly topLevel: string;
  readonly seasons: number;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  readonly defenseRuns: number;
  /** 三分量加總的雙帳。 */
  readonly shares: Shares;
  /**
   * 三分量各自的雙帳。
   *
   * 校準要看的靶是「守備約佔全體份額的 16–17%」，那個比例只有拆開才量得出來；
   * 介面上把三段分開列，玩家也才看得懂自己的價值來自哪裡。
   */
  readonly sharesByPart: {
    readonly batting: Shares;
    readonly pitching: Shares;
    readonly fielding: Shares;
  };
  /** 份額換算出來的分數（已含難度係數與 k 的扣分）。 */
  readonly sharePoints: number;
  readonly awardPoints: number;
  readonly milestonePoints: number;
  /** 評價分：以上三者相加。 */
  readonly score: number;
  /** 分級，0 為名人堂，4 為過客。**含獎項保底**——這是這段生涯的稱號。 */
  readonly tier: number;
  /**
   * 分數本身落在哪一帶，**不含保底**。
   *
   * 名人堂票選看這一個：保底處理的是「短而璀璨」的生涯——拿過 MVP 的人沒有人會
   * 說他不是明星，所以稱號給他；但年年入圍、拿六七成的票要靠整段生涯的份量，
   * 一座獎盃撐不起來。
   */
  readonly scoreTier: number;
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
  /**
   * 逐段紀錄的原件，依時間排序。
   *
   * 生涯年表直接畫它——一段一列。目前一年就是一段，將來接上季中交易之後
   * 同一年會出現兩列，年表的形狀不必改。
   */
  readonly seasons: readonly SeasonRecord[];
  /** 養成期的逐年紀錄。只給年表顯示用——養成成績不進任何評價分。 */
  readonly amateurSeasons: readonly AmateurSeasonRecord[];
  /** 各頂級聯盟的總結，依評價分由高到低。 */
  readonly leagues: readonly LeagueCareer[];
  /** 非頂級層級的通算，依層級代碼排序。 */
  readonly minors: readonly MinorCareer[];
  /** 所有頂級聯盟通算。純顯示，不參與任何判定。 */
  readonly topTotal: { readonly batting: BattingLine | null; readonly pitching: PitchingLine | null };
  /** 所有二軍與小聯盟通算。 */
  readonly minorTotal: {
    readonly batting: BattingLine | null;
    readonly pitching: PitchingLine | null;
  };
  /** 總評價分：跨聯盟通算，供合併生涯紀錄、成就與天梯使用。 */
  readonly totalScore: number;
  /** 生涯里程碑（跨聯盟通算），只進總評價分。 */
  readonly careerMilestones: readonly string[];
  /**
   * 養成期的盃賽冠軍貢獻的總評價分。
   *
   * **與國際賽同一個桶：只進總分，不屬於任何職業聯盟。** 從前它加在每一個聯盟
   * 的榮譽分上——一個高中拿過三座盃的人，中職、日職、大聯盟三本帳各自都多了那
   * 三座的分，同一件事被算了三次。
   */
  readonly amateurTitlePoints: number;
  /** 國際賽貢獻的總評價分。與生涯里程碑同一個桶，不進任何單一聯盟。 */
  readonly internationalScore: number;
  /** 職業期的國際賽逐屆紀錄。養成期的國際賽併在該年的養成列裡，不進這一份。 */
  readonly internationalSeasons: readonly InternationalRecord[];
  /**
   * 國際賽的通算。**與聯盟通算分開**：國際賽不屬於任何聯盟，混進去會污染階梯
   * 成就與各聯盟的評價分（見 `internationalScore`）。
   */
  readonly internationalTotal: {
    readonly batting: BattingLine | null;
    readonly pitching: PitchingLine | null;
  };
  /** 生涯代表聯盟。沒打過頂級聯盟時為 null。 */
  readonly representative: LeagueCareer | null;
  /** 生涯最佳分級。沒打過頂級聯盟時為最低帶。 */
  readonly bestTier: number;
}

/**
 * 聯盟難度係數。
 *
 * `(當年 par / baseline_par) ^ 指數`。弱聯盟的份額會虛胖——聯盟平均是自我參照的，
 * 因此能力相同的球員在弱聯盟宰制力更強、份額更高。這個係數把虛胖壓回去。
 *
 * 用**當年**的 par，因此聯盟水準的逐年浮動會被吃掉：玩家不會因為生在弱年而
 * 白賺評價分，但成績單上仍看得到那年打得特別兇。
 *
 * **分母不跟著浮動**，那不是疏漏：分子浮動、分母釘死，才是浮動被吃掉的機制。
 * 見 `hall_of_fame.json` 的 `_baseline_note`。
 *
 * 這條是**聯盟真尺**——它只吃聯盟 par，不吃球員能力。慣用手之類的個人上限
 * 折扣對它自動生效（能力低→份額低→分數低），不可以在這裡再折一次。
 */
export function difficultyOf(par: number): number {
  const d = cfg.difficulty;
  if (d.baseline_par <= 0 || par <= 0) return 1;
  return Math.pow(par / d.baseline_par, d.exponent);
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

/**
 * 里程碑結算。
 *
 * 逐級累進：達到第一級拿第一級的分，達到第二級再加第二級的分。
 *
 * 門檻不依聯盟賽程縮放：2000 安就是 2000 安，日職球季長不代表那裡的 2000 安
 * 比較不值錢。賽程長度已經反映在「同樣年數打得出多少累積量」上了，再乘一次
 * 係數等於罰他選了長球季的聯盟——而且玩家看到的是「日職 2383 安」這種沒人
 * 認得的數字，看不出自己離哪一座里程碑還有多遠。
 */
export function evaluateMilestones(
  scope: 'league' | 'career',
  batting: BattingLine | null,
  pitching: PitchingLine | null,
): { readonly points: number; readonly reached: readonly string[] } {
  let points = 0;
  const reached: string[] = [];

  const cfgRungs = achievements.categories.cumulative;
  for (const [stat, spec] of Object.entries(cfgRungs.rungs)) {
    if (stat.startsWith('_')) continue;
    const value = statTotal(stat, spec.side, spec.unit ?? 1, batting, pitching);
    if (value === null) continue;

    // 與成就櫃共用 `ladderTop()`：同一個級距、同一座階梯，門檻與分數都不封頂。
    // **分數的底數不同**：AP 走 `points`，評價分走 `score_points`（省略時沿用
    // `points`）——投手的級距比較粗，而評價分是階數的平方（見 achievements.json）。
    const { top: highest, points: pts } = ladderTop(
      spec.step,
      spec.score_points ?? spec.points,
      cfgRungs.first_rung[scope],
      value,
    );
    points += pts;
    // 只列最高的那一級——「1000 安、1500 安、2000 安」三行都印出來很囉唆，
    // 玩家要看的是他走到哪裡。分數則是逐級累加的。
    // 名字也跟成就櫃共用一份（`rungName`）——同一階在兩張卡上得長成同一個樣子。
    if (highest !== null) reached.push(rungName(highest, spec.name));
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
 * 拿過 MVP 或年度最佳投手的人至少是明星，拿過單項王的至少是每日先發。這個機制
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
  // 季中轉隊的兩段各算半年——待了兩個月的球隊不該和待了整季的並列。
  for (const r of records) {
    const share = records.filter((o) => o.year === r.year).length;
    tally.set(r.team, (tally.get(r.team) ?? 0) + 1 / share);
  }
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

/** 國際賽的通算。一屆一筆加起來，與 `totalLines` 同一個做法。 */
function totalInternational(records: readonly InternationalRecord[]): {
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

/**
 * 這個體系在成績單上的名字——**最高層級的名字**，不是體系名。
 *
 * 這個字串會去冠里程碑（「大聯盟 1000 安打」）與獎項，而那些數字只有頂級聯盟才
 * 累積得到，所以冠的是「大聯盟」而不是「旅美」。體系本身的稱呼見 transfer.ts 的
 * orgLabel，那裡講的是「你人在哪個體系」，兩者刻意不同。
 */
function orgNameOf(org: string): string {
  return leagues.top_league_names[org] ?? leagues.org_names[org] ?? org;
}

/**
 * 這批紀錄橫跨幾個球季。
 *
 * **數的是年份而不是段數**——季中被交易的那一年是一年，不是兩年。逐段紀錄
 * 讓同一年可以有兩列，年資不能跟著翻倍。
 */
function seasonCount(list: readonly SeasonRecord[]): number {
  return new Set(list.map((r) => r.year)).size;
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
  amateurTitles = 0,
  amateurSeasons: readonly AmateurSeasonRecord[] = [],
  internationalScore = 0,
  internationalSeasons: readonly InternationalRecord[] = [],
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
    const sharesByPart = {
      batting: sumShares(...list.map((r) => r.shares.batting)),
      pitching: sumShares(...list.map((r) => r.shares.pitching)),
      fielding: sumShares(...list.map((r) => r.shares.fielding)),
    };
    const shares = sumShares(sharesByPart.batting, sharesByPart.pitching, sharesByPart.fielding);
    const sharePoints = list.reduce((sum, r) => sum + seasonPoints(r), 0);

    // 總冠軍就在 awards 裡（code 為 championship），因此它跟其他獎項一樣自動
    // 落在拿下它的那個聯盟。養成期的盃賽不在這裡——見 `amateurTitlePoints`。
    const own = awards.filter((a) => a.org === org);
    const awardTotal = own.reduce((sum, a) => sum + awardPoints(a.code), 0);

    const milestones = evaluateMilestones('league', lines.batting, lines.pitching);

    const score = sharePoints + awardTotal + milestones.points;
    const scoreTier = tierOf(score);
    const tier = applyTierFloors(scoreTier, new Set(own.map((a) => a.code)));

    leagueCareers.push({
      org,
      orgName: orgNameOf(org),
      topLevel: list[0]?.level ?? org,
      seasons: seasonCount(list),
      batting: lines.batting,
      pitching: lines.pitching,
      defenseRuns: list.reduce((sum, r) => sum + r.defenseRuns, 0),
      shares,
      sharesByPart,
      sharePoints,
      awardPoints: awardTotal,
      milestonePoints: milestones.points,
      score,
      tier,
      scoreTier,
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
        seasons: seasonCount(list),
        batting: lines.batting,
        pitching: lines.pitching,
      };
    })
    .sort((a, b) => a.level.localeCompare(b.level));

  // ---- 生涯里程碑：跨聯盟通算，只進總評價分
  const allTop = totalLines(records.filter((r) => r.top !== null));
  const careerMilestones = evaluateMilestones('career', allTop.batting, allTop.pitching);

  // ---- 總評價分：各聯盟的份額與榮譽加總，再加生涯里程碑與國際賽
  //
  // 國際賽與生涯里程碑同一個桶：**它不屬於任何聯盟**，因此不進任何單一聯盟的
  // 評價分，只進總分。一個帶中華隊拿下經典賽冠軍的人，歷史地位就是跟沒入選過
  // 的人不一樣。
  // 養成期的盃賽冠軍與職業總冠軍同一個價錢，差別只在歸屬：那幾座盃不屬於任何
  // 職業聯盟，因此跟國際賽一樣只進總分。
  const amateurTitlePoints = amateurTitles * awardPoints(awardsCfg.championship.code);

  const totalScore =
    leagueCareers.reduce((sum, l) => sum + l.sharePoints + l.awardPoints, 0) +
    careerMilestones.points +
    amateurTitlePoints +
    internationalScore;

  const representative = pickRepresentative(leagueCareers, records);

  return {
    seasons: records,
    amateurSeasons,
    leagues: leagueCareers,
    minors,
    topTotal: allTop,
    minorTotal: totalLines(minorRecords),
    totalScore,
    careerMilestones: careerMilestones.reached,
    amateurTitlePoints,
    internationalScore,
    internationalSeasons,
    internationalTotal: totalInternational(internationalSeasons),
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
