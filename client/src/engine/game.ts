/**
 * 一局遊戲：把亂數層、規則資料與流程編排綁在一起。
 *
 * 開局設定（種子、姓名、起始守位）是**參數**，不是流程中的選擇——它們在
 * 進入流程之前就決定了，與舊版的開局畫面一致。進入流程之後，玩家的選擇是
 * 唯一的外部輸入。
 *
 * 因此「開局設定＋選擇序列」就是一段生涯的完整表述，見 ADR 0002。
 */

import {
  abilities,
  ALL_ABILITIES,
  amateur,
  flavor,
  hallOfFame,
  leagues,
  amateur as amateurCfg,
  injury as injuryCfg,
  love as loveCfg,
  season as seasonCfg,
  PITCH_FAMILIES,
  type AbilityKey,
  type Hand,
  type SchoolStage,
} from '../data/index.ts';
import {
  academyUnlocked,
  nextStageOf,
  playCups,
  playYouthTournament,
  qualifiedTournaments,
  schoolTiersOf,
  stageOf,
  type CupSeason,
} from './amateur.ts';
import {
  addBatting,
  addPitching,
  fmtInnings,
  playAmateurStats,
  type BattingLine,
  type PitchingLine,
} from './amateurStats.ts';
import { canRejectOffer, qualifiesAsTwoWay, runDraft, TWO_WAY_TRAIT } from './draft.ts';
import {
  cardsPerYear,
  drawEvent,
  resolveEvent,
  successChances,
  type EventContext,
  type EventMode,
  type GameEvent,
} from './events.ts';
import { annualAwards, type AwardRecord } from './awards.ts';
import {
  assignPosition,
  defenseRuns,
  fieldingResponsibility,
  positionAverage,
  positionLabel,
  requiredScore,
  DH,
} from './defense.ts';
import type { AmateurSeasonRecord } from './career.ts';
import {
  buyoutCost,
  isFreeAgentEligible,
  offersExtension,
  rookieContract,
  termOptions,
  type Contract,
} from './contract.ts';
import {
  difficultyOf,
  summarizeCareer,
  type CareerSummary,
  type SeasonRecord,
} from './career.ts';
import { runBallots, type BallotResult } from './hall.ts';
import {
  evaluateAchievements,
  type Achievement,
  type AchievementResult,
} from './achievements.ts';
import {
  battingShares,
  fieldingReplacementWinPct,
  fieldingShares,
  lossPenalty,
  pitchingShares,
  proBaseline,
  sumShares,
  winPct,
  type Shares,
} from './metrics.ts';
import { esc, Flow, type Option } from './flow.ts';
import { applyTalents, type TalentLevels } from './overlay.ts';
import {
  advanceStandards,
  initStandards,
  standardOf,
  standardsNote,
  type LeagueStandards,
} from './league.ts';
import { assignSchool, createPlayer, START_SEASON, type NewPlayer } from './genesis.ts';
import { championshipDice, growthCurve, raiseCeiling, rollTrainingDice, train } from './growth.ts';
import { injuryChance, rollInjury, unlocksGlass, type Injury } from './injury.ts';
import {
  isConscripted,
  isEligible,
  isHonorRank,
  isPodium,
  lockYearsLeft,
  playTournament,
  tournamentGames,
  tournamentOf,
  tournamentPar,
  tournamentScore,
  unlocksAce,
  unlocksTaiwan,
  type Tournament,
} from './national.ts';
import {
  afterBreakup,
  earnsConfidante,
  cadenceChance,
  canPropose,
  childbirthChance,
  confessionChance,
  divorceCost,
  hasPartner,
  isChildhoodSweetheart,
  newLoveState,
  pickPartner,
  rehabChance,
  rewardMultiplier,
  turmoilChance,
  breakupChance,
  injuryRiskModifier,
  type LoveState,
} from './love.ts';
import {
  applyAging,
  asksRetirement,
  evaluateMovement,
  pathOf,
  proDiceCount,
  shouldRetire,
} from './pro.ts';
import { fmtMoney, postingFee, salaryFor } from './salary.ts';
import {
  amateurOverseasOffers,
  canRequestPosting,
  canRefuseDemotion,
  fallbackOffers,
  importPremium,
  orgLabel,
  overseasFaOffers,
  postingBids,
  postingConsentChance,
  postingTarget,
  scoutingNote,
  scoutingOffers,
  type TransferOffer,
} from './transfer.ts';
import {
  levelOf,
  playSeason,
  positionName,
  proBattingLine,
  proPitchingLine,
  ROLE_NAMES,
  type ProPitchingLine,
} from './season.ts';
import {
  isStar,
  isUntouchable,
  splitBatting,
  splitPitching,
  tradeChance,
  tradeSplit,
  tradeTarget,
} from './trade.ts';
import {
  advanceLeague,
  championshipOdds,
  initLeague,
  playerEffect,
  type LeagueTable,
} from './teams.ts';
import {
  benchmarkLevelOf,
  defenseScore,
  homeBenchmarkLevel,
  isSideVisible,
  rate,
  ratingPosition,
  sideOfStartPosition,
  type Abilities,
} from './rating.ts';
import { abilitySpread } from './rivalPool.ts';
import { World } from './rng.ts';



/** 一局遊戲的開局設定。與重播日誌合起來即可完整重建一段生涯。 */
export interface GameSetup {
  readonly seed: string;
  readonly name: string;
  readonly startPosition: NewPlayer['startPosition'];
  /** 投球慣用手。由玩家選擇，不是擲出來的。 */
  readonly throws: Hand;
  /** 打擊慣用手。 */
  readonly bats: Hand;
  /**
   * 這一局帶著的天賦與層級。
   *
   * **它必須在 setup 裡，因為它改變模擬結果。** 天賦動的是天賦上限、衰老、受傷
   * 機率這些引擎的輸入，重播日誌少了它，伺服器重跑就會得到另一段人生。
   *
   * 天賦可以退款，因此「玩家現在擁有什麼」與「這一局帶著什麼」是兩件事——伺服器
   * 驗證時用的是開局登記凍結的那一組，不是客戶端在這裡寫的。見 ADR 0007。
   */
  readonly talents?: TalentLevels;
}

/**
 * 跨局累積的進度。
 *
 * **刻意不放進 `GameSetup`**：它不影響模擬，只影響成就結算怎麼算 AP。放進去
 * 會讓重播日誌帶著一份會隨時間變動的資料，同一份日誌今天與明天重播出不同的
 * 結果——而伺服器驗證時本來就會用自己那邊的紀錄重算（見 ADR 0007）。
 */
export interface CareerProgress {
  /** 這是不是玩家的第一段人生。有幾項成就只在第一段給。 */
  readonly firstCareer: boolean;
  /** 先前已經解鎖過的成就 id。同一項只給一次 AP。 */
  readonly unlocked: ReadonlySet<string>;
}

/** 沒有帳號時的進度：每一局都是第一段人生，每一項都算新解鎖。 */
export const NO_PROGRESS: CareerProgress = { firstCareer: true, unlocked: new Set<string>() };

/** 目前引擎版本。重播日誌帶著它，跨版本一律拒絕重播（ADR 0002）。 */
export const ENGINE_VERSION = 1;

/** 一段可重播的生涯紀錄。 */
export interface ReplayLog {
  readonly engineVersion: number;
  readonly setup: GameSetup;
  readonly choices: readonly string[];
}

/** 球員的可變狀態。genesis 產出的是起點，之後由訓練與衰退推移。 */
export interface PlayerState {
  /** 開局時擲出的不變資料：姓名、潛力天花板、慣用手、出身。 */
  readonly origin: NewPlayer;
  /** 目前能力值。 */
  readonly ability: Readonly<Record<AbilityKey, number>>;
  /** 蓄力槽：每項能力未滿一級的點數。 */
  readonly carry: Readonly<Record<AbilityKey, number>>;
  /** 已取得的隱藏特性。 */
  readonly traits: ReadonlySet<string>;
  readonly age: number;
  readonly year: number;
  /** 目前的養成階段。 */
  readonly stage: SchoolStage;
  /** 目前階段的第幾年，從 1 起算。 */
  readonly stageYear: number;
  /** 目前就讀的學校。 */
  readonly school: string;
  /** 學校的隱藏強度分級。 */
  readonly schoolTier: number;
  /**
   * 生涯榮譽。**同一項只記一次**——連三年拿下同一個盃賽冠軍是一件事，不是
   * 三件。要數次數請用 counts，不要 filter 這份清單。
   */
  readonly honors: readonly string[];
  /** 生涯次數統計。榮譽清單去重之後，次數必須另外算。 */
  readonly counts: CareerCounts;
  /**
   * 得過的年度獎項，結構化保存。
   *
   * 與 honors 分工：那份清單去重、負責顯示；這份逐座記錄、負責計分與計次。
   * 七座 MVP 在清單上只有一行，在這裡是七筆。
   */
  readonly awards: readonly AwardRecord[];
  /** 感情。結算的【人生】區塊與球迷看板的語氣看它。 */
  readonly love: {
    readonly status: string;
    readonly partner: string | null;
    readonly marriedYear: number | null;
    readonly kids: number;
    readonly divorces: number;
    readonly caught: number;
  };
  /** 生涯累積收入，單位萬元。含簽約金與逐季年薪。 */
  readonly earnings: number;
  /** 尚未分配的能力點。 */
  readonly pool: number;
  /** 各項能力被提升的上限點數。 */
  readonly ceilingBonus: Readonly<Record<AbilityKey, number>>;
  /** 本季累積的受傷機率增幅。 */
  readonly injuryRisk: number;
  /** 當年成績。尚未打完大賽時為 null。 */
  /**
   * 目前的守備位置代碼。頂級聯盟是**登錄守位**，養成期與二軍是**暫定守位**
   * （見 CONTEXT.md）。純投手為 null。
   */
  readonly position: string | null;
  /** 守位的中文名。 */
  readonly positionName: string | null;
  /** 這個守位是不是暫定的——沒有登錄、不寫進生涯紀錄、每年重算。 */
  readonly positionTentative: boolean;
  /** 這一季走不走野手側。純投手為 false，他們的守位欄只是打席的落點。 */
  readonly playsField: boolean;
  readonly seasonBatting: BattingLine | null;
  readonly seasonPitching: PitchingLine | null;
  /** 這一季的守備分。守備沒有別的欄位，因此它掛在野手那張表上。 */
  readonly seasonDefenseRuns: number;
  /**
   * 各階段的累計成績。
   *
   * 養成期的鍵是階段代碼（JHS / HS），職業的鍵是**體系代碼**（CPBL / NPB / …）
   * 而不是層級——二軍與一軍屬於同一個聯盟，分開記會讓一段生涯被拆成兩半。
   * 用體系當鍵也讓「離開又回來」自然接續：回到同一個聯盟就繼續累加。
   */
  readonly statsByStage: Readonly<
    Record<string, { batting: BattingLine | null; pitching: PitchingLine | null }>
  >;
  /** 職業狀態。尚未進職業時為 null。 */
  readonly pro: ProState | null;
  /**
   * 定位鎖定：養成結束時沒取得二刀流，另一側就此關閉。
   *
   * 值是**保留下來**的那一側。鎖定之後另一側的能力不再顯示、不能加點，投打
   * 定位也不再隨評價高低互換——職業球員的角色是固定的，這正是二刀流稀有的
   * 意義所在。尚未畢業或已取得二刀流時為 null。
   */
  readonly lockedSide: 'pitcher' | 'fielder' | null;
  /**
   * 目前該顯示哪一側的能力。
   *
   * 與 `lockedSide` 分成兩個欄位，因為它們回答不同的問題：`lockedSide` 是
   * 「畢業時定位確立了沒」，屬於劇情與職業邏輯；這個是「畫面現在該畫什麼」，
   * 畢業前就已經有答案——起始守位一選定，另一側就不再出現（見 ADR 0009）。
   * 介面請用這個，不要用 `lockedSide` 判斷顯示。
   */
  readonly visibleSide: 'pitcher' | 'fielder' | null;
}

/**
 * 生涯次數統計。
 *
 * 榮譽清單刻意去重（見 PlayerState.honors），因此「打過幾次國際賽」「拿過幾次
 * 冠軍」這類問題不能靠數那份清單。特性的觸發條件多半看的是次數——例如
 * traits.json 的 taiwan 要求國際賽徵召超過五次——所以次數要獨立記。
 */
export interface CareerCounts {
  /** 打過的國內大賽項次，一年打四個盃賽就加四。 */
  readonly domesticEntries: number;
  /** 國內大賽奪冠次數。 */
  readonly domesticTitles: number;
  /** 國內大賽進入榮譽名次（冠亞軍）的次數。 */
  readonly domesticPodiums: number;
  /** 國際賽徵召次數，也就是入選國家隊的次數。 */
  readonly internationalCaps: number;
  /** 國際賽奪冠次數。 */
  readonly internationalTitles: number;
  /** 國際賽進入榮譽名次的次數。 */
  readonly internationalPodiums: number;
}

/** 職業階段的狀態。 */
export interface ProState {
  /** 體系代碼，例如 CPBL。生涯數據以它為鍵。 */
  readonly org: string;
  /** 目前層級代碼，例如 CPBL1。 */
  readonly level: string;
  /** 層級的中文名，例如中職一軍。 */
  readonly levelName: string;
  /** 體系的中文名，例如中職。 */
  readonly orgName: string;
  readonly team: string;
  /** 在這個體系待到第幾年，從 1 起算。 */
  readonly year: number;
  /** 所屬球隊這一季的勝率。 */
  readonly winRate: number;
  /** 所屬球隊這一季的奪冠機率，由全聯盟的勝率推導。 */
  readonly championshipOdds: number;
  /** 登錄的守備位置代碼。只有頂級聯盟的野手才有，其餘為 null。 */
  readonly position: string | null;
  /** 登錄守位的中文名。 */
  readonly positionName: string | null;
  /** 在這個層級累計的守備分。 */
  readonly defenseRuns: number;
  /** 這個層級**當年**的平均水準。逐年浮動，不是 leagues.json 的基準值。 */
  readonly par: number;
  /** 這個層級**當年**的最低門檻，也就是替代水準。 */
  readonly min: number;
  /** 這一季的年薪，單位萬元。 */
  readonly salary: number;
  /** 合約剩餘年數。 */
  readonly contractYears: number;
  /** 在頂級聯盟累積的服務年資。 */
  readonly serviceYears: number;
  /** 取得 FA 資格了嗎。掌控期內為 false——合約到期時球團說了算。 */
  readonly freeAgentEligible: boolean;
}

export class Game {
  readonly setup: GameSetup;
  readonly world: World;
  readonly flow = new Flow();

  #player: NewPlayer | null = null;
  #ability: Record<AbilityKey, number> = {};
  #carry: Record<AbilityKey, number> = {};
  #traits = new Set<string>();
  #age = 0;
  #year = 0;
  #stage: SchoolStage = 'JHS';
  #stageYear = 1;
  #school = '';
  #schoolTier = 2;
  #honors: string[] = [];
  #counts: {
    domesticEntries: number;
    domesticTitles: number;
    domesticPodiums: number;
    internationalCaps: number;
    internationalTitles: number;
    internationalPodiums: number;
  } = {
    domesticEntries: 0,
    domesticTitles: 0,
    domesticPodiums: 0,
    internationalCaps: 0,
    internationalTitles: 0,
    internationalPodiums: 0,
  };
  #pool = 0;
  #ceilingBonus: Record<AbilityKey, number> = {};
  #injuryRisk = 0;
  #dice: { values: readonly number[]; index: number } | null = null;
  /** 這一季的大賽結果。國際賽的直通資格要看它，因此必須留著。 */
  #lastCupSeason: CupSeason | null = null;
  /**
   * 上一季奪下**國際賽**冠軍時所處的階段，供隔季的訓練骰加成使用。
   *
   * 國內盃賽不記——它的回報已經是大賽點數與成就紀錄。只保留一季，加成不
   * 累積到再下一季。
   */
  #lastChampionships: string[] = [];
  /** 養成結束後保留下來的那一側；二刀流或尚未畢業時為 null。 */
  #lockedSide: 'pitcher' | 'fielder' | null = null;
  /**
   * 這一輪配點的復原堆疊，存的是「加之前的樣子」。
   *
   * 存快照而非增量：蓄力槽跨級數之後「減掉幾點」不是單純的減法，反推會在
   * 邊界上出錯。確認之後清空——跨輪復原沒有意義，中間已經發生別的事了。
   */
  #allocHistory: {
    key: AbilityKey;
    value: number;
    source: 'dice' | 'pool';
    ability: number;
    carry: number;
  }[] = [];
  #seasonBatting: BattingLine | null = null;
  #seasonPitching: PitchingLine | null = null;
  /** 這一季的守備分。與 #defenseRuns 的層級累計值不同，最近一季那張表看它。 */
  #seasonDefenseRuns = 0;
  /** 這一季的出賽係數。傷病落在這裡：1 為全勤、0 為整季報銷。 */
  #seasonFactor = 1;
  /** 生涯大傷次數。帕瓦諾的解鎖條件與合約年限都看它。 */
  #majorInjuries = 0;
  /** 明年是否整季報廢。大傷後醫生搖頭的那個結果。 */
  #rehabYear = false;
  /** 感情狀態。 */
  #love: LoveState = newLoveState();
  /** 結婚的年份。結算的【人生】區塊要寫它。 */
  #weddingYear: number | null = null;
  /** 第一次被徵召的年份。列管期從這裡算。 */
  #intlLockedSince: number | null = null;
  /** 打進國際賽冠亞軍的次數。東亞功夫的解鎖條件看它。 */
  #intlPodiums = 0;
  /** 國際賽累積的總評價分。與生涯里程碑同一個桶。 */
  #intlScore = 0;
  /** 這一局的成就結算。引退後才有值。 */
  #achievements: AchievementResult | null = null;
  /** 還原天賦覆蓋的函式。見 constructor 與 dispose()。 */
  #revertTalents: () => void = () => {};
  /** 國際賽的生涯成績。與聯盟成績分開——它不屬於任何聯盟。 */
  #intlBatting: BattingLine | null = null;
  #intlPitching: PitchingLine | null = null;
  /** 今年最好的大賽名次。校園告白的成功率看它——打進四強的王牌與坐板凳的人不一樣。 */
  get #bestRankThisYear(): string | null {
    const ranks = this.#lastCupSeason?.honors ?? [];
    return ranks[0]?.rank ?? null;
  }
  /**
   * 當季暫時能力。見 ADR 0006：非成長性的獎勵只抬高這一季，不寫回能力表。
   * 球季結束歸零。
   */
  #seasonBonus: Record<AbilityKey, number> = {};
  #statsByStage: Record<string, { batting: BattingLine | null; pitching: PitchingLine | null }> =
    {};
  /**
   * 職業狀態。尚未進職業時為 null——用它而不是用 stage 判斷是否在職業階段，
   * 因為 stage 是養成階段的代碼，硬塞一個 'PRO' 進去會讓學校、學年那些欄位
   * 全部失去意義。
   */
  #pro: {
    level: string;
    team: string;
    /** 在最低層級連續待了幾季，供戰力外的寬限期判定。 */
    yearsAtBottom: number;
    /** 職業第幾年，從 1 起算。 */
    year: number;
    /** 目前的合約。 */
    contract: Contract;
    /** 在頂級聯盟累積的服務年資，供 FA 資格判定。 */
    serviceYears: number;
    /** 是否換過體系。換過的人直接取得 FA 資格。 */
    changedOrg: boolean;
    /** 這一季季中被交易前的球隊；沒有交易時為 null。逐段紀錄看它。 */
    tradedFrom: string | null;
    /**
     * 目前登錄的守備位置；尚未登錄時為 null。
     *
     * 只有頂級聯盟才登錄——二軍不挑守位。投手一律為 null，他們走投手定位那條
     * 線（先發／後援），不進守位系統。
     */
    position: string | null;
  } | null = null;
  /**
   * 各層級當年的水準。尚未進職業時為 null。
   *
   * 聯盟水準是世界狀態，與球隊戰力同層——因此和 #league 一樣掛在這裡，不掛在
   * 球員身上。見 league.ts。
   */
  #standards: LeagueStandards | null = null;
  /** 生涯累計的守備分，以層級為鍵。 */
  #defenseRuns: Record<string, number> = {};
  /**
   * 得過的年度獎項，結構化保存。
   *
   * 與去重的榮譽清單分開：清單負責顯示「他做到過什麼」，這裡負責計分與計次
   * ——七座 MVP 在清單上只有一行，但評價分要算七次。
   */
  #awards: AwardRecord[] = [];
  /**
   * 逐段的生涯紀錄。
   *
   * 取代「以體系為鍵的桶式累加」——桶裡只留總計，年份與層級當場就丟掉了，
   * 因此印不出逐年表，也分不出一軍與二軍。評價分只算頂級聯盟，那個區分是
   * 必要的。
   */
  #seasons: SeasonRecord[] = [];
  /**
   * 養成期的逐年紀錄。
   *
   * 與職業的紀錄分開存——養成期沒有聯盟水準、沒有份額、沒有守位登錄。但生涯
   * 年表要把兩者接在一起，因為養成六年也是這段生涯的一部分。
   */
  #amateurSeasons: AmateurSeasonRecord[] = [];
  /** 待過的體系。回到其中之一算落葉歸根。 */
  #playedOrgs = new Set<string>();
  /**
   * 各體系的累計一軍年資。外籍身分看它——日職在籍八年視同本土。
   *
   * **與 pro.serviceYears 分開記**：那一個換體系就歸零（掌控期是新東家的事），
   * 而外籍身分留得住——去韓職打幾年再回日職，先前的八年還是那八年。
   */
  #orgYears = new Map<string, number>();
  /**
   * 上一季的勝率——勝利份額佔責任額的比例。
   *
   * 挖角的成績門檻看它：**球探是看了你去年的表現才來的**。傷缺或低潮的一年
   * 會讓你錯過窗口，而年齡窗口本來就在關。
   */
  #lastWinPct = 0.5;
  /** 結算出來的生涯總結。引退之前為 null。 */
  #summary: CareerSummary | null = null;
  /**
   * 上一季的 d 值——綜合能力減當年的 par。
   *
   * 合約談判與挖角看的都是它，而**必須是球季當下的值**：年末已經跑過老化，
   * 那時再算會用到衰退後的能力，把一個剛打完生涯年的三十歲球員算成下坡。
   */
  #lastD = 0;
  /** 公開抱怨過幾次。第二次會被貼上「我不是針對你」的標籤。 */
  #complains = 0;
  /** 否決交易的餘波還剩幾年。影響下一張合約的係數。 */
  #tradeRefuseYears = 0;
  /**
   * 這一年被下放到哪一層；沒被下放時為 null。
   *
   * **必須是欄位而不是傳下去的參數。** 從判定下放到問「要不要接受」之間隔著
   * 挖角、入札、下放遞約三個入口，任何一個成交都會讓玩家換到別的體系——那時
   * 他根本沒有被下放，參數卻還帶著舊值，於是跳出「你被送回中職二軍」。
   * 換體系的唯一出口是 #moveTo，在那裡清掉就一次補齊所有路徑。
   */
  #demotedTo: string | null = null;
  /**
   * 被下放前所在的層級，以及那次下放判定的機率。
   *
   * 有年資的球員可以拒絕下放（ADR 0020），拒絕成功就要把人放回原本的層級——
   * 升降級在球季結算時就已經寫進 `pro.level`，年末才問玩家，因此得記著回頭
   * 路。機率則是拒絕的代價：球團越想送你下去，硬留下來被釋出的機率越高。
   */
  #demotedFrom: string | null = null;
  #demotePressure = 0;
  /**
   * 生涯累積收入，單位萬元。
   *
   * 含簽約金與逐季年薪。它是玩家會在意的數字，也是將來天梯的排序依據之一
   * （ROADMAP 階段三的「神獸殿堂」）。
   */
  #earnings = 0;
  /** 上一年說過的聯盟風向。用來避免同一句話年年重複。 */
  #lastStandardsNote: string | null = null;
  /**
   * 所屬聯盟這一季的戰力表。
   *
   * 球隊的興衰是世界狀態，不是球員狀態——因此它跟著聯盟走，不跟著球員走。
   * 尚未進職業時為 null。
   */
  #league: LeagueTable | null = null;

  /** 跨局進度。見 CareerProgress——它不進重播日誌。 */
  readonly #progress: CareerProgress;

  constructor(setup: GameSetup, progress: CareerProgress = NO_PROGRESS) {
    this.setup = setup;
    this.#progress = progress;
    this.world = new World(setup.seed);
    // 天賦是設定覆蓋層，**在整局期間都套著**——它改的是規則資料本身，而規則資料
    // 在每一個步驟都會被讀到。還原交給 dispose()。
    //
    // 這是全域可變狀態：**同一時間只能有一局套著覆蓋**。瀏覽器本來就只跑一局；
    // 伺服器端的重跑驗證必須序列化，或隔離到獨立行程。見 ADR 0007。
    this.#revertTalents = applyTalents(setup.talents ?? {});
  }

  /**
   * 收掉這一局，還原天賦的覆蓋。
   *
   * **開始下一局之前一定要呼叫**，否則新的一局會帶著上一局的加成。
   */
  dispose(): void {
    this.#revertTalents();
    this.#revertTalents = () => {};
  }

  /** 目前的球員。流程開始前為 null。 */
  get player(): NewPlayer | null {
    return this.#player;
  }

  /**
   * 結算出來的生涯總結。引退之前為 null。
   *
   * 介面層要畫生涯表與名人堂結果都靠它——引擎已經算好了，介面不必再算一次。
   */
  get summary(): CareerSummary | null {
    return this.#summary;
  }

  /** 這一局的成就結算。引退後才有值。 */
  get achievements(): AchievementResult | null {
    return this.#achievements;
  }

  /** 目前的球員狀態。流程開始前為 null。 */
  get state(): PlayerState | null {
    if (this.#player === null) return null;
    return {
      origin: this.#player,
      ability: this.#ability,
      carry: this.#carry,
      traits: this.#traits,
      age: this.#age,
      year: this.#year,
      stage: this.#stage,
      stageYear: this.#stageYear,
      school: this.#school,
      schoolTier: this.#schoolTier,
      honors: this.#honors,
      counts: this.#counts,
      awards: this.#awards,
      love: {
        status: this.#love.status,
        partner: this.#love.partner,
        marriedYear: this.#weddingYear,
        kids: this.#love.kids,
        divorces: this.#love.divorces,
        caught: this.#love.caught,
      },
      earnings: this.#earnings,
      pool: this.#pool,
      ceilingBonus: this.#ceilingBonus,
      injuryRisk: this.#injuryRisk,
      position: this.#fieldPosition,
      positionName: this.#fieldPosition === null ? null : positionLabel(this.#fieldPosition),
      positionTentative: this.#pro?.position == null,
      playsField: this.#playsField,
      seasonBatting: this.#seasonBatting,
      seasonDefenseRuns: this.#seasonDefenseRuns,
      seasonPitching: this.#seasonPitching,
      statsByStage: this.#statsByStage,
      pro: this.#proState,
      lockedSide: this.#lockedSide,
      visibleSide: this.#activeSide,
    };
  }

  /** 對外的職業狀態。層級與體系的中文名在這裡查好，介面層不必再碰 leagues。 */
  get #proState(): ProState | null {
    const pro = this.#pro;
    if (pro === null) return null;
    const info = levelOf(pro.level);
    return {
      org: info.org,
      level: pro.level,
      levelName: info.name,
      orgName: leagues.top_league_names[info.org] ?? info.org,
      team: pro.team,
      year: pro.year,
      winRate: this.#league?.get(pro.team)?.winRate ?? 0,
      championshipOdds: this.#league === null ? 0 : championshipOdds(this.#league, pro.team),
      position: pro.position,
      positionName: pro.position === null ? null : positionLabel(pro.position),
      defenseRuns: this.#defenseRuns[pro.level] ?? 0,
      par: standardOf(this.#standards, pro.level).par,
      min: standardOf(this.#standards, pro.level).min,
      salary: this.#seasonSalary,
      contractYears: pro.contract.years,
      serviceYears: pro.serviceYears,
      freeAgentEligible: isFreeAgentEligible({
        serviceYears: pro.serviceYears,
        changedOrg: pro.changedOrg,
      }),
    };
  }

  /**
   * 這一季的年薪。
   *
   * d 值用**當年**的 par 算——聯盟水準逐年浮動，用基準值會讓弱年的薪水虛高。
   */
  get #seasonSalary(): number {
    const pro = this.#pro;
    if (pro === null) return 0;
    const d = (this.rating?.overall ?? 0) - standardOf(this.#standards, pro.level).par;
    return salaryFor(pro.level, d);
  }

  /**
   * 這一季擲出的訓練骰與分配進度，供介面畫出骰面。
   * 不在分配階段時為 null。
   */
  get dice(): { readonly values: readonly number[]; readonly index: number } | null {
    return this.#dice;
  }

  /** 事件系統需要的情境。 */
  get #eventContext(): EventContext {
    return {
      side: this.#activeSide,
      professional: this.#pro !== null,
      traits: this.#traits,
      // 加點看得到哪些能力，事件卡就只動得了哪些（ADR 0022）。同一份清單，
      // 不另外長一套「事件專用的能力表」。
      abilities: this.#allocatableAbilities,
    };
  }

  /** 目前的綜合能力評價。 */
  get rating() {
    if (this.#player === null) return null;
    return rate(this.#ability, {
      // 評價用的守位要拿**他現在這個體系**的尺去量（ADR 0021 的 `#benchmarkLevel`）。
      // 原本這裡硬寫中職一軍，於是旅外的二刀流會用中職的門檻判定守得動游擊，
      // 守位加分因此給高了——人在大聯盟，量他的卻是中職那把尺。
      position: ratingPosition(this.#player.startPosition, {
        ability: this.#ability,
        level: this.#benchmarkLevel,
      }),
      traits: this.#traits,
    });
  }

  /** 是否已取得二刀流天賦。決定成長曲線走哪一條。 */
  get isTwoWay(): boolean {
    return this.#traits.has('two_way');
  }

  /** 開始這局遊戲，推進到第一個需要玩家決定的地方。 */
  start(): this {
    this.flow.push(() => this.#genesis());
    this.flow.run();
    return this;
  }

  /** 回答目前的提問。 */
  choose(optionId: string): this {
    this.flow.choose(optionId);
    return this;
  }

  /** 匯出重播日誌。 */
  toReplayLog(): ReplayLog {
    return {
      engineVersion: ENGINE_VERSION,
      setup: this.setup,
      choices: [...this.flow.choices],
    };
  }

  /**
   * 從重播日誌重建一段生涯。
   *
   * 跨版本一律拒絕，不嘗試相容——抽取順序在版本之間沒有保證，硬跑只會得到
   * 一段看似合理但完全不同的人生（ADR 0002）。
   */
  static replay(log: ReplayLog): Game {
    if (log.engineVersion !== ENGINE_VERSION) {
      throw new Error(
        `重播日誌的引擎版本為 ${log.engineVersion}，目前為 ${ENGINE_VERSION}。` +
          `跨版本不保證重現，因此拒絕重播。`,
      );
    }
    const game = new Game(log.setup).start();
    for (const choice of log.choices) game.choose(choice);
    return game;
  }

  // ---------------------------------------------------------------- 流程

  /** 開局：擲出球員，並交代他的出身。 */
  #genesis(): void {
    const player = createPlayer(this.world, this.setup.name, this.setup.startPosition, {
      throws: this.setup.throws,
      bats: this.setup.bats,
    });
    this.#player = player;
    this.#ability = { ...player.ability };
    this.#carry = Object.fromEntries(ALL_ABILITIES.map((k) => [k, 0]));
    this.#ceilingBonus = Object.fromEntries(ALL_ABILITIES.map((k) => [k, 0]));
    this.#age = player.age;
    this.#year = player.year;
    this.#school = player.school;
    this.#schoolTier = player.schoolTier;

    const tier = ['', '名門', '中堅', '弱旅'][player.schoolTier] ?? '';
    const startName = abilities.start_positions[player.startPosition];

    // 卡片內文的 HTML 只能由程式碼寫死，變數一律先 esc()——姓名是自由輸入的。
    this.flow.card(
      'gold',
      '入學',
      `${esc(START_SEASON)}，<b class="hl">${esc(player.name)}</b>進了` +
        `<b class="hl">${esc(player.school)}</b>` +
        `${tier ? `（${esc(tier)}）` : ''}，在球隊裡的位置是<b class="hl">${esc(startName)}</b>。` +
        `投${handLabel(player.throws)}打${handLabel(player.bats)}。`,
    );
    this.flow.card(
      'info',
      undefined,
      '起始守位只決定你的天賦往哪邊長，不決定你只能練那一邊——' +
        '投打俱佳的人，在選秀前有機會取得二刀流。',
    );

    this.flow.push(() => this.#startYear());
  }

  /** 一個年度：分隔線 → 季初訓練 → 事件卡 → 大賽 → 國際賽 → 分配點數 → 年度結束。 */
  #startYear(): void {
    const def = stageOf(this.#stage);
    const label = def.year_labels[this.#stageYear - 1] ?? `${def.name}第 ${this.#stageYear} 年`;
    // 只有生涯的第一年標出季節——它是整段人生的起點，之後每個年度都從春天
    // 開始，再標一次只是重複。
    const first = this.#stage === 'JHS' && this.#stageYear === 1;
    this.flow.divider(
      `${this.#year} 年 · ${this.#age} 歲 · ${label}${first ? `・${START_SEASON}` : ''}`,
    );
    this.flow.push(
      () => this.#springTraining(),
      () => this.#loveEvent(() => this.#drawEventCards()),
      () => this.#cups(),
      () => this.#youthTournament(),
      () => this.#endYear(),
    );
  }

  /**
   * 養成期的國際賽。
   *
   * 判定方式是「贏下掛著代表權的國內大賽」，因此必須排在大賽之後。敘事上
   * 一律寫成入選國家隊——現實中打好國內盃賽本來就是入選的主要依據。
   */
  #youthTournament(): void {
    const season = this.#lastCupSeason;
    if (season === null) return;
    const overall = this.rating?.overall ?? 0;

    const honorRanks = new Set(amateur.amateur_international.honor_ranks.values);
    for (const code of qualifiedTournaments(this.#stage, season)) {
      const result = playYouthTournament(this.world, code, overall);
      const prefix = amateur.amateur_international.honor_prefix;

      // 徵召一次就是一次，不管名次——「國家隊常客」看的是入選次數。
      this.#counts.internationalCaps++;
      if (result.rankIndex === 0) this.#counts.internationalTitles++;
      if (honorRanks.has(result.rank)) this.#counts.internationalPodiums++;

      // 國際賽與國內大賽的榮譽各自獨立——贏下謝國城盃是一項成就，代表台灣
      // 打 LLB 拿冠軍是另一項。
      if (honorRanks.has(result.rank)) {
        this.#addHonor(`${prefix}${result.tournament}${result.rank}`);
      }
      this.#grantPoints(result.points);
      // 只有國際賽冠軍給訓練骰加成，且記的是拿下時所處的階段。
      if (result.rankIndex === 0) this.#lastChampionships.push(this.#stage);

      this.flow.card(
        result.rankIndex <= 1 ? 'gold' : 'good',
        result.tournament,
        `這一年的表現讓你入選國家隊，披上中華隊戰袍。` +
          `最終 <b class="hl">${esc(result.rank)}</b>` +
          `（${result.games} 場・+${result.points} 點）。`,
      );

      // 國際賽的出賽同樣計入成績。
      const line = playAmateurStats(this.world, this.#stage, this.#ability, result.games);
      this.#seasonBatting = addBatting(this.#seasonBatting, line.batting);
      this.#seasonPitching = addPitching(this.#seasonPitching, line.pitching);
      this.#accumulate(line.batting, line.pitching);
      // 國際賽併進當年那一列，不另立一列——同一年只該有一行。
      const current = this.#amateurSeasons.at(-1);
      if (current !== undefined && current.year === this.#year) {
        this.#amateurSeasons[this.#amateurSeasons.length - 1] = {
          ...current,
          batting: addBatting(current.batting, line.batting),
          pitching: addPitching(current.pitching, line.pitching),
        };
      }
    }
  }

  /**
   * 這一年的事件卡。
   *
   * 張數由階段決定（國中 1、高中 2、職業 3）——十三歲的一年裡不會發生那麼多
   * 事，而高中開始密度就該上來了。一張解完才抽下一張，因此用續傳串起來，不能
   * 用迴圈：中間每一張都要等玩家作答。
   */
  #drawEventCards(): void {
    const stage = this.#pro === null ? this.#stage : 'PRO';
    const remaining = cardsPerYear(stage);
    this.#drawEventCard(remaining);
  }

  /** 抽一張事件卡並讓玩家決定怎麼應對。解完之後接著抽剩下的。 */
  #drawEventCard(remaining: number): void {
    if (remaining <= 0) return;
    const event = drawEvent(this.world, this.#eventContext);
    const chances = successChances(this.#traits);

    this.flow.ask(
      {
        title: `事件｜${event.name} — 你要怎麼應對？`,
        options: [
          {
            id: 'event:bold',
            label: '全力一搏',
            note: `成功率 ${chances.bold}%｜幅度最大，受傷風險也最高`,
            role: 'warn',
          },
          { id: 'event:normal', label: '照常執行', note: `成功率 ${chances.normal}%`, role: 'main' },
          { id: 'event:safe', label: '保守應對', note: `成功率 ${chances.safe}%｜幅度最小` },
        ],
      },
      (choice) => {
        this.#resolveEventCard(event, choice.slice('event:'.length) as EventMode);
        this.#drawEventCard(remaining - 1);
      },
    );
  }

  /** 解算事件卡並套用結果。 */
  #resolveEventCard(event: GameEvent, mode: EventMode): void {
    const ctx = this.#eventContext;
    const outcome = resolveEvent(
      this.world,
      event,
      mode,
      ctx,
      // rand 從他自己練得到的能力裡挑；投不到球的人不抽球系。
      ctx.abilities ?? ALL_ABILITIES,
      this.#activeSide === 'fielder' ? [] : PITCH_FAMILIES,
    );

    const lines: string[] = [];

    for (const delta of outcome.deltas) {
      const name = abilities.abilities[delta.key] ?? delta.key;
      if (delta.points >= 0) {
        const before = this.#ability[delta.key] ?? 0;
        this.#applyPoints(delta.key, delta.points, { silent: true });
        const after = this.#ability[delta.key] ?? 0;
        lines.push(
          after > before
            ? `${esc(name)} <span class="up">+${after - before}</span>`
            : `${esc(name)}：點數進了蓄力槽，未滿一級`,
        );
      } else {
        const before = this.#ability[delta.key] ?? 0;
        this.#ability[delta.key] = Math.max(
          abilities.scale.hard_floor,
          before + delta.points,
        );
        lines.push(
          `${esc(name)} <span class="dn">${(this.#ability[delta.key] ?? 0) - before}</span>`,
        );
      }
    }

    for (const raise of outcome.ceilings) {
      const name = abilities.abilities[raise.key] ?? raise.key;
      const before = this.#ceilingBonus[raise.key] ?? 0;
      this.#ceilingBonus[raise.key] = raiseCeiling(before, raise.points);
      // 天花板往上移，離頂的距離變遠，這一級因此變便宜。
      this.#settleCarry();
      const gained = (this.#ceilingBonus[raise.key] ?? 0) - before;
      lines.push(
        gained > 0
          ? `${esc(name)} 上限 <span class="up">+${gained}</span>`
          : `${esc(name)} 的上限已經到頂`,
      );
    }

    if (outcome.injury > 0) {
      this.#injuryRisk += outcome.injury;
      lines.push(`本季受傷機率 <span class="dn">+${outcome.injury}%</span>`);
    }

    // 非能力的特殊效果目前只實作觸發特性；禁賽、聲望等要等對應系統做出來。
    for (const key of Object.keys(outcome.special).sort()) {
      if (key === 'yips' || key === 'clutch') this.#traits.add(key);
    }

    const tag = mode === 'safe' ? '（保守應對）' : mode === 'bold' ? '（全力一搏）' : '';
    const verdict =
      mode === 'bold'
        ? outcome.good
          ? '<b class="hl">豪賭成功！</b>'
          : '<b class="dn">豪賭失敗……</b>'
        : '';
    this.flow.card(
      outcome.good ? 'good' : 'bad',
      `事件卡｜${event.name}${tag}`,
      `${esc(outcome.text)}。${verdict}<br>${lines.join('｜') || '（沒有明顯的變化）'}`,
    );
  }

  /** 季初的自主訓練：擲骰，逐顆分配。 */
  #springTraining(): void {
    // 上一季的冠軍在這裡兌現，兌現後即清空——加成只延續一季。
    const bonus = championshipDice(this.#lastChampionships);
    this.#lastChampionships = [];

    const dice = rollTrainingDice(this.world, this.#traits, { bonusDice: bonus });

    this.#dice = { values: dice.values, index: 0 };

    let msg = `自主訓練擲出 <b class="hl">${dice.values.length}</b> 顆骰：` +
      dice.values.map((v) => `<b class="hl">${v}</b>`).join('、');
    if (dice.sixes > 0) msg += `，其中 ${dice.sixes} 顆是高標值。`;
    if (bonus > 0) {
      msg += `<br>去年的國際賽冠軍帶來更好的訓練資源與眼界，多擲 <b class="hl">${bonus}</b> 顆骰。`;
    }
    this.flow.card('info', '季初訓練', msg);

    // 每一顆骰都是一次選擇——重播日誌因此記下「哪顆骰加在哪」。
    // 必須 unshift 而非 push：佇列裡已經排著本年度後續的步驟，push 會讓分配
    // 跑到事件卡與大賽之後。
    this.#allocHistory = [];
    this.flow.unshift(
      () => this.#allocationPhase('dice'),
      () => this.#allocationConfirm('dice'),
    );
  }

  /** 這一季的大賽。 */
  #cups(): void {
    const player = this.#player;
    if (player === null) return;

    const season = playCups(this.world, {
      stage: this.#stage,
      ability: this.#ability,
      position: ratingPosition(player.startPosition, {
        ability: this.#ability,
        level: this.#benchmarkLevel,
      }),
      traits: this.#traits,
      schoolTier: this.#schoolTier,
    });

    const lines = season.results
      .map(
        (r) =>
          `${esc(r.cup)}：<b class="hl">${esc(r.rank)}</b>` +
          `（${r.games} 場・+${r.points} 點）`,
      )
      .join('<br>');
    this.flow.card('info', '大賽結算', lines);

    // 成績依主要角色產生；二刀流投打都算。
    const line = playAmateurStats(this.world, this.#stage, this.#ability, season.games, season.wins);
    this.#seasonBatting = line.batting;
    this.#seasonPitching = line.pitching;
    this.#seasonDefenseRuns = 0;
    // 當季暫時能力用完就歸零——它只屬於這一年。
    this.#seasonBonus = {};
    this.#accumulate(line.batting, line.pitching);
    this.#amateurSeasons.push({
      year: this.#year,
      age: this.#age,
      stage: this.#stage,
      stageName: stageOf(this.#stage).name,
      school: this.#school,
      batting: line.batting,
      pitching: line.pitching,
    });

    const statLines: string[] = [];
    if (line.pitching !== null) {
      const p = line.pitching;
      statLines.push(
        `投球 ${p.games} 場 ${fmtInnings(p.outs)} 局・${p.so} K・防禦率 <b class="hl">${p.era.toFixed(2)}</b>`,
      );
    }
    if (line.batting !== null) {
      const b = line.batting;
      statLines.push(
        `打擊 ${b.ab} 打數 ${b.hits} 安打 ${b.hr} 轟 ${b.rbi} 打點・` +
          `打擊率 <b class="hl">${fmtAvg(b.avg)}</b>`,
      );
    }
    if (statLines.length > 0) this.flow.card('good', '個人成績', statLines.join('<br>'));

    // 只有名次夠好才計入成就，且不帶年份——六年下來會累積出一長串「八強」，
    // 把真正的榮譽淹掉。其餘名次照樣給能力點。
    this.#counts.domesticEntries += season.results.length;
    this.#counts.domesticTitles += season.championships.length;
    this.#counts.domesticPodiums += season.honors.length;
    for (const h of season.honors) this.#addHonor(`${h.cup}${h.rank}`);
    if (season.championships.length > 0) {
      this.flow.card(
        'gold',
        '冠軍',
        `拿下 <b class="hl">${esc(season.championships.join('、'))}</b> 的冠軍。`,
      );
    }

    if (academyUnlocked(this.#stage, season)) this.#traits.add(amateur.cups.academy_trigger.trait);

    this.#lastCupSeason = season;
    this.#grantPoints(season.points);
  }


  /** 年度結束：推進年齡與年份；同階段還有下一年就繼續，否則升學或畢業。 */
  #endYear(): void {
    this.#age++;
    this.#year++;
    this.#stageYear++;

    if (this.#stageYear <= stageOf(this.#stage).years) {
      this.flow.push(() => this.#startYear());
      return;
    }

    const next = nextStageOf(this.#stage);
    if (next === null) {
      this.#loveCheckpoint('高中畢業');
      this.flow.push(() => this.#graduate());
      return;
    }
    this.#loveCheckpoint(`${stageOf(this.#stage).name}畢業`);
    this.flow.push(() => this.#advanceStage(next));
  }

  /** 升學：換階段、重新分發學校。 */
  #advanceStage(next: SchoolStage): void {
    const from = stageOf(this.#stage);
    this.#stage = next;
    this.#stageYear = 1;

    // 升學分發走 career 流——這是生涯事件，不是開局生成。
    const assigned = assignSchool(this.world, next, 'career');
    this.#school = assigned.school;
    this.#schoolTier = assigned.tier;

    const tiers = schoolTiersOf(next);
    const label = tiers?.tiers[String(assigned.tier)]?.label ?? '';
    this.flow.divider(`${this.#year} 年 · ${this.#age} 歲 · ${from.name}畢業`);
    this.flow.card(
      'gold',
      `${stageOf(next).name}入學`,
      `${esc(from.name)}三年結束，你進了<b class="hl">${esc(assigned.school)}</b>` +
        `${label ? `（${esc(label)}）` : ''}。`,
    );
    this.flow.push(() => this.#startYear());
  }

  /** 高中畢業：結算三年、判定二刀流，然後進選秀。 */
  #graduate(): void {
    const r = this.rating;
    this.flow.divider(`${this.#year} 年 · ${this.#age} 歲 · 高中畢業`);
    this.flow.card(
      'gold',
      '高中畢業',
      `三年結束，綜合能力 <b class="hl">${r?.overall ?? 0}</b>` +
        `（投手側 ${r?.pitcher ?? 0}／野手側 ${r?.fielder ?? 0}）。` +
        (this.#honors.length > 0 ? `<br>生涯榮譽：${esc(this.#honors.join('、'))}` : ''),
    );

    // 二刀流的判定在選秀之前——它會影響球團怎麼評估你。
    if (r !== null && !qualifiesAsTwoWay(r)) {
      // 沒取得二刀流就要選邊站。保留評價較高的那一側，另一側從此關閉——
      // 這是二刀流之所以珍貴的代價面。
      this.#lockedSide = r.pitcher >= r.fielder ? 'pitcher' : 'fielder';
      const kept = this.#lockedSide === 'pitcher' ? '投手' : '野手';
      const dropped = this.#lockedSide === 'pitcher' ? '打擊與守備' : '投球';
      this.flow.card(
        'info',
        `定位確立：${kept}`,
        `六年下來，你的<b class="hl">${kept}</b>能力明顯突出，球團就是這樣看你的。` +
          `從今以後${esc(dropped)}那一側不再練，能力表也不再顯示它——` +
          '職業球員的角色是固定的。',
      );
    }

    if (r !== null && qualifiesAsTwoWay(r)) {
      this.#traits.add(TWO_WAY_TRAIT);
      // 二刀流換到另一條成長曲線，成本結構整個變了。
      this.#settleCarry();
      this.flow.card(
        'gold',
        '隱藏天賦：二刀流',
        '投得動也打得開。球探報告上多了一行少見的註記——' +
          '<b class="hl">兩邊都值得投資</b>。從今以後，投打兩側的成長都不再像專精者那樣陡。',
      );
    }

    this.flow.push(() => this.#crossroads());
  }

  /**
   * 高中畢業 · 人生的第一個路口。
   *
   * **選秀不是唯一的出口。** 能力夠好的人可以直接與海外球團簽育成合約，不經過
   * 選秀，從對方體系的低階層級出發——那是一條完全不同的生涯：起點更低、薪水
   * 更少，但天花板高得多。
   *
   * 沒有任何海外報價時不問，直接進選秀：只有一個選項的提問是雜訊。
   */
  #crossroads(): void {
    const overall = this.rating?.overall ?? 0;
    const offers = amateurOverseasOffers(this.world, overall);
    if (offers.length === 0) {
      this.flow.push(() => this.#draft());
      return;
    }

    // 同一個體系的報價收成一個選項，選了之後再挑球團——路口問的是「走哪條
    // 路」，一次攤開六支球隊會把那個選擇淹掉。
    const paths = new Map<string, typeof offers>();
    for (const o of offers) {
      const list = paths.get(o.org);
      if (list === undefined) paths.set(o.org, [o]);
      else paths.set(o.org, [...list, o]);
    }

    const options: Option[] = [
      {
        id: 'path:draft',
        label: '投入中華職棒選秀',
        note: `目前綜合 ${overall}`,
        role: 'main',
      },
      ...[...paths.entries()].map(([org, list]) => ({
        id: `path:${org}`,
        label: list[0]!.label,
        note: `${list[0]!.note}｜${Game.#terms(list[0]!)}`,
      })),
    ];

    this.flow.ask({ title: `高中畢業 · 綜合能力 ${overall} · 人生的第一個路口`, options }, (choice) => {
      const org = choice.slice('path:'.length);
      const list = paths.get(org);
      if (list === undefined) {
        this.flow.push(() => this.#draft());
        return;
      }
      this.#amateurSigning(list);
    });
  }

  /** 選定體系之後挑球團。與旅外的報價單同一個形狀。 */
  #amateurSigning(offers: readonly (TransferOffer & { readonly label: string })[]): void {
    this.flow.ask(
      {
        title: `${offers[0]!.orgName}球團的報價`,
        options: offers.map((o, i) => ({
          id: `sign:${i}`,
          label: `${o.team}（${o.levelName}）`,
          note: Game.#terms(o),
        })),
      },
      (choice) => {
        const picked = offers[Number(choice.split(':')[1])];
        if (picked === undefined) {
          this.flow.push(() => this.#draft());
          return;
        }
        this.#earnings += picked.bonus;
        this.#playedOrgs.add(picked.org);
        this.flow.card(
          'gold',
          picked.label.replace('洽談', '').replace('合約', ''),
          `與 <b class="hl">${esc(picked.team)}</b> 簽下育成合約，從 <b class="hl">${esc(picked.levelName)}</b> 出發。` +
            `簽約金 <b class="hl">${fmtMoney(picked.bonus)}</b>。` +
            '<br><span class="sub">沒有選秀會的舞台，也沒有人保證你上得去。一切從最底層開始。</span>',
        );
        this.flow.push(() => this.#professionalStart(picked.level, picked.team));
      },
    );
  }

  /** 中華職棒選秀。 */
  #draft(): void {
    const overall = this.rating?.overall ?? 0;
    const result = runDraft(this.world, { overall, age: this.#age });

    if (result.undrafted) {
      this.flow.card(
        'bad',
        '選秀落榜',
        `唱名一輪又一輪，始終沒有你的名字。` +
          `（綜合 ${overall}｜年齡加權後評價 ${result.score}）`,
      );
      this.flow.push(() => this.#careerOver('落榜'));
      return;
    }

    const accept = () => {
      this.flow.card(
        'gold',
        '中華職棒選秀會',
        `第 <b class="hl">${result.round}</b> 輪獲 <b class="hl">${esc(result.team ?? '')}</b> 指名！` +
          `簽約金 <b class="hl">${result.bonus} 萬</b>。` +
          (result.level === amateur.draft.first_round_direct_promotion.level
            ? '即戰力評價，直接放入一軍名單。'
            : '先從二軍出發。'),
      );
      this.#earnings += result.bonus;
      this.flow.push(() => this.#professionalStart(result.level ?? '', result.team ?? ''));
    };

    if (!canRejectOffer(result, this.#age)) {
      accept();
      return;
    }

    this.flow.ask(
      {
        title: `中華職棒選秀會 · 第 ${result.round} 輪獲 ${result.team} 指名`,
        options: [
          {
            id: 'draft:accept',
            label: '接受指名，加盟球隊',
            note: `簽約金 ${result.bonus} 萬｜從${
              result.level === amateur.draft.first_round_direct_promotion.level ? '一軍' : '二軍'
            }出發`,
            role: 'main',
          },
          {
            id: 'draft:reject',
            label: '重返校園，再拚一年',
            note: '放棄本次指名，明年重新參加選秀',
            role: 'warn',
          },
        ],
      },
      (choice) => {
        if (choice === 'draft:accept') {
          accept();
          return;
        }
        this.flow.card(
          'info',
          '重返校園',
          '看到被選到的輪次，雙眼發黑。你握緊拳頭，決定再磨一年——' +
            '這一次，你一定要在前段輪次被叫到名字。',
        );
        this.flow.push(() => this.#careerOver('重返校園'));
      },
    );
  }

  /** 進入職業。目前只跑 CPBL 主軸——旅外體系的轉會與尋路尚未實作。 */
  #professionalStart(level: string, team: string): void {
    this.#pro = {
      level,
      team,
      yearsAtBottom: 0,
      year: 1,
      position: null,
      contract: rookieContract(),
      serviceYears: 0,
      changedOrg: false,
      tradedFrom: null,
    };
    // 聯盟格局在進入職業的那一刻定下來：每隊各抽一個基準勝率當作體質。
    this.#league = initLeague(this.world, levelOf(level).org);
    // 生涯的第一年就是基準值——它是玩家認識這個世界的參照點。
    this.#standards = initStandards();
    this.#seasonBatting = null;
    this.#seasonPitching = null;
    this.flow.push(() => this.#proYear());
  }

  /** 職業的一個年度：分隔線 → 季初訓練 → 事件卡 → 球季 → 年度結束。 */
  #proYear(): void {
    const pro = this.#pro;
    if (pro === null) return;
    const info = levelOf(pro.level);

    this.flow.divider(
      `${this.#year} 年 · ${this.#age} 歲 · ${pro.team} · ${info.name}（職業第 ${pro.year} 年）`,
    );
    // 只在「風向變了」的那一年說。同一句話連講四年是雜訊，玩家會學會略過它。
    const note = this.#standards === null ? null : standardsNote(this.#standards, pro.level);
    if (note !== null && note !== this.#lastStandardsNote) {
      this.flow.card('info', '聯盟風向', note);
    }
    this.#lastStandardsNote = note;

    this.flow.push(
      () => this.#proSpringTraining(),
      () => this.#positionReview(),
      () => this.#loveEvent(() => this.#drawEventCards()),
      () => this.#healthCheck(),
      () => this.#tradeDeadline(),
      () => this.#proSeason(),
      () => this.#nationalTeam(() => this.#proEndYear()),
    );
  }

  /**
   * 球季前的守位檢視。
   *
   * 只在頂級聯盟登錄——二軍不挑守位，能上場就讓你上。純投手不進這個系統，
   * 他們走投手定位那條線。
   *
   * 每年都重跑一次：守備會退化，也會練回來。移防不是單向的。
   */
  #positionReview(): void {
    const pro = this.#pro;
    const player = this.#player;
    if (pro === null || player === null) return;

    if (levelOf(pro.level).top === undefined) {
      // 離開頂級聯盟就撤銷登錄——回來時重新掃一次，不沿用兩年前的守位。
      pro.position = null;
      return;
    }
    if (!this.#playsField) {
      pro.position = null;
      return;
    }

    const result = assignPosition({
      ability: this.#ability,
      current: pro.position,
      level: pro.level,
      age: this.#age,
      startPosition: player.startPosition,
    });
    pro.position = result.position;

    if (result.move === 'stay') return;
    this.flow.card(
      result.move === 'demote' ? 'bad' : result.move === 'promote' ? 'good' : 'info',
      '守位會議',
      `${esc(result.reason)}。`,
    );
  }

  /**
   * 算守位時該拿哪一把尺。
   *
   * 一律是所屬體系的**頂級聯盟**：問的是「他守不守得動游擊」，那是對上這項
   * 運動的標準，不是對上他這季剛好待在哪一層（ADR 0021）。還沒進職業就用母國
   * 體系的頂級聯盟。
   */
  get #benchmarkLevel(): string {
    const pro = this.#pro;
    if (pro === null) return homeBenchmarkLevel();
    return benchmarkLevelOf(pro.level) ?? homeBenchmarkLevel();
  }

  /**
   * 目前實際站的守備位置：登錄守位優先，沒登錄就用**暫定守位**。
   *
   * 暫定守位每次讀取都現算——養成期與二軍的守備能力天天在動，而它沒有登錄
   * 這道手續把數字釘住。掃描規則與登錄完全一樣（同一把尺、同一條光譜），差別
   * 只在不登錄、不寫進生涯紀錄、不經球員選擇。
   *
   * 純投手回傳 null：他們走先發／後援那條線，不進守位系統。
   */
  get #fieldPosition(): string | null {
    if (this.#player === null) return null;
    const registered = this.#pro?.position ?? null;
    if (registered !== null) return registered;
    // 純投手：養成期照樣站打席（學生棒球沒有一輩子不打擊的投手），守位掛 DH，
    // 打擊成績才有位置可標；進了職業就真的不打了，回 null——那裡的純投手不該
    // 有野手成績。
    if (!this.#playsField) return this.#pro === null ? DH : null;
    return assignPosition({
      ability: this.#ability,
      current: null,
      level: this.#benchmarkLevel,
      age: this.#age,
      startPosition: this.#player.startPosition,
    }).position;
  }

  /** 這一季要不要打野手側。投手側單獨鎖定的球員不守備。 */
  get #playsField(): boolean {
    if (this.isTwoWay) return true;
    if (this.#lockedSide !== null) return this.#lockedSide === 'fielder';
    const r = this.rating;
    return r !== null && r.fielder > r.pitcher;
  }

  /**
   * 職業的季初訓練。
   *
   * 骰數比養成期少——職業球員的時間被球季佔滿，能自主訓練的空間有限。奪冠
   * 加成仍然生效，接上養成期的同一套機制。
   */
  #proSpringTraining(): void {
    const bonus = championshipDice(this.#lastChampionships);
    this.#lastChampionships = [];

    const count = proDiceCount(this.world, this.#age) + bonus;
    const rng = this.world.stream('growth');
    const values = Array.from({ length: count }, () => rng.int(1, 6));

    this.#dice = { values, index: 0 };

    let msg =
      `自主訓練擲出 <b class="hl">${values.length}</b> 顆骰：` +
      values.map((v) => `<b class="hl">${v}</b>`).join('、');
    if (bonus > 0) {
      msg += `<br>去年的國際賽冠軍帶來更好的訓練資源與眼界，多擲 <b class="hl">${bonus}</b> 顆骰。`;
    }
    this.flow.card('info', '季初訓練', msg);

    // 與養成期同理：必須 unshift，否則配點會跑到球季之後。
    this.#allocHistory = [];
    this.flow.unshift(
      () => this.#allocationPhase('dice'),
      () => this.#allocationConfirm('dice'),
    );
  }

  /** 打完一季，並把成績記進生涯累計。 */
  #proSeason(): void {
    const pro = this.#pro;
    const player = this.#player;
    const r = this.rating;
    if (pro === null || player === null || r === null) return;

    // 登錄守位優先，二軍與養成期用暫定守位——兩者都是同一把尺掃出來的，出賽
    // 勞損與守備分吃的都是這個位置（ADR 0021）。
    const position = this.#fieldPosition ?? DH;
    const line = playSeason(this.world, {
      level: pro.level,
      // 當季暫時能力：感情等非成長性的獎勵只抬高這一季（ADR 0006）。
      ability: this.#seasonAbility,
      position,
      overall: r.overall,
      // 定位鎖定之後就照鎖定的那一側打，不再每季比較評價高低——職業球員的
      // 角色是固定的，不會因為某年打擊練得比較好就改當野手。
      better: this.#lockedSide ?? (r.pitcher >= r.fielder ? 'pitcher' : 'fielder'),
      twoWay: this.isTwoWay,
      standards: this.#standards,
      // 輪值線掛在球隊戰力上——在爛隊當先發、去強隊只能進牛棚。
      teamWinRate: this.#league?.get(pro.team)?.winRate ?? null,
      // 傷病的結果。乘的是出賽量，不是事後把數據打折。
      seasonFactor: this.#seasonFactor,
    });

    this.#seasonBatting = line.batting;
    this.#seasonPitching = line.pitching;
    this.#seasonDefenseRuns = 0;
    // 當季暫時能力用完就歸零——它只屬於這一年。
    this.#seasonBonus = {};
    this.#accumulate(line.batting, line.pitching);

    // 守備分只在登錄了守位時才算——沒登錄就沒有守位權重可乘。
    let def: number | null = null;
    if (pro.position !== null && pro.position !== DH && line.batting !== null) {
      def = defenseRuns({
        ability: this.#ability,
        position: pro.position,
        level: pro.level,
        standards: this.#standards,
        gamesShare: line.batting.games / levelOf(pro.level).games,
      });
      this.#defenseRuns[pro.level] = (this.#defenseRuns[pro.level] ?? 0) + def;
      this.#seasonDefenseRuns = def;
    }

    this.#lastD = r.overall - standardOf(this.#standards, pro.level).par;
    this.#playedOrgs.add(levelOf(pro.level).org);

    // 領薪水。**在成績結算之後才領**——年薪看的是這一季的 d 值，而 d 值要等
    // 這季打完、能力定案才算得準。
    const salary = this.#seasonSalary;
    this.#earnings += salary;

    const stints = this.#recordStints(line.batting, line.pitching, def ?? 0);
    // 上季勝率：這一年所有分段的份額加總。季中轉隊的人不能只算後半段。
    this.#lastWinPct = winPct(
      sumShares(
        ...stints.flatMap((s) => [s.shares.batting, s.shares.pitching, s.shares.fielding]),
      ),
    );

    const parts: string[] = [];
    if (pro.tradedFrom !== null && stints.length === 2) {
      // 兩段各自的出賽量說明了大限落在哪裡。合計在下面照常列出——**逐年表要
      // 看得到兩段，生涯數字仍然是一個人的**。
      const games = (s: SeasonRecord): number => s.batting?.games ?? s.pitching?.games ?? 0;
      parts.push(
        `<span class="sub">季中轉隊　${esc(stints[0]!.team)} ${games(stints[0]!)} 場` +
          `　→　${esc(stints[1]!.team)} ${games(stints[1]!)} 場</span>`,
      );
    }
    if (line.pitching !== null) {
      const p = line.pitching;
      parts.push(
        `<b>投手</b>（${ROLE_NAMES[p.role]}）｜${p.games} 場` +
          `${p.starts > 0 ? `・先發 ${p.starts}` : ''}・${fmtInnings(p.outs)} 局` +
          `・${p.wins} 勝 ${p.losses} 敗${p.saves > 0 ? ` ${p.saves} 救援` : ''}` +
          `${p.holds > 0 ? ` ${p.holds} 中繼` : ''}` +
          `・防禦率 <b class="hl">${p.era.toFixed(2)}</b>・奪三振 ${p.so}`,
      );
    }
    if (line.batting !== null) {
      const b = line.batting;
      parts.push(
        `<b>打者</b>（${esc(positionName(position))}）｜${b.games} 場・${b.pa} 打席` +
          `・打擊率 <b class="hl">${fmtAvg(b.avg)}</b>／${fmtAvg(b.obp)}／${fmtAvg(b.slg)}` +
          `・${b.hr} 轟 ${b.rbi} 打點${b.sb > 0 ? `・盜壘 ${b.sb}` : ''}` +
          `${b.ibb > 0 ? `・故意四壞 ${b.ibb}` : ''}` +
          `${def === null ? '' : `・守備 ${def > 0 ? '+' : ''}${def}`}`,
      );
    }

    parts.push(
      `<span class="sub">年薪 ${fmtMoney(salary)}　·　生涯累積 ${fmtMoney(this.#earnings)}</span>`,
    );

    // 整季報銷時不印成績列——一整排 0 不是成績，那一年他不在場上。
    if (this.#seasonFactor <= 0) {
      this.flow.card('bad', `${levelOf(pro.level).name} 球季成績`, '傷缺全季，沒有出賽紀錄。');
    } else {
      this.flow.card('info', `${levelOf(pro.level).name} 球季成績`, parts.join('<br>'));
    }
    this.#annualAwards(line.batting, line.pitching);
  }

  /**
   * 球季前的健康檢查。
   *
   * 排在球季之前，因為結果決定的是**這一季能上場多久**——它不是事後把數據打折，
   * 而是他真的只上場了那麼多。
   *
   * 事件卡自找的額外風險在這裡兌現並歸零：那是「今年」的帳，不該累積到明年。
   */
  #healthCheck(): void {
    // 隔年報廢的傷勢優先——去年的醫生已經說過了，今年不必再擲一次。
    if (this.#rehabYear) {
      this.#rehabYear = false;
      this.#seasonFactor = 0;
      this.#injuryRisk = 0;
      this.flow.card(
        'bad',
        '復健年',
        '整季都在復健室度過。<b class="dn">一場比賽也沒有上</b>——去年那一刀比誰想的都重。',
      );
      return;
    }

    // 感情狀態雙向回饋到傷病：穩定降風險、風波升風險。與事件卡的自找風險同性質，
    // 不受魔鬼筋肉人上限保護。
    const extraRisk = this.#injuryRisk + injuryRiskModifier(this.#love);

    // 體力也吃進受傷機率：40 以下加、超過這個守位的「打滿標準」減。零點是守位
    // 自己的（DH 55、SS 65、捕手 70），所以蹲捕的免傷比 DH 難換得多。用的是
    // **本體能力**不是當季能力——感情加成抬的是這一年的表現，不是他的身體。
    const pro = this.#pro;
    const player = this.#player;
    const position =
      pro === null || player === null
        ? undefined
        : (pro.position ??
          ratingPosition(player.startPosition, { ability: this.#ability, level: pro.level }));
    const durability = {
      stamina: this.#ability['sta'],
      position,
      leagueGames: pro === null ? undefined : levelOf(pro.level).games,
    };

    const result = rollInjury(this.world, {
      age: this.#age,
      traits: this.#traits,
      extraRisk,
      ...durability,
    });
    const chance = injuryChance({
      age: this.#age,
      traits: this.#traits,
      extraRisk,
      ...durability,
    });
    this.#injuryRisk = 0;
    this.#seasonFactor = result.seasonFactor;

    if (result.kind === 'none') {
      this.flow.card('info', '健康回報', `本季平安出賽。<span class="sub">（受傷機率 ${chance}%）</span>`);
      return;
    }

    const lines = [esc(result.text)];
    lines.push(this.#applyInjuryLoss(result));

    if (result.kind === 'major') {
      this.#majorInjuries++;
      // 有人陪的話熬得住——不是治好，是熬得住。
      const rehabHit =
        result.rehabNextYear &&
        this.world
          .stream('health')
          .chance(rehabChance(this.#love, injuryCfg.severity.major.rehab_next_year.chance));
      if (rehabHit) {
        this.#rehabYear = true;
        lines.push('醫生搖搖頭：<b class="dn">明年也很難趕上開季</b>。');
      }
    }

    this.flow.card('bad', result.kind === 'major' ? '大傷' : '小傷', lines.filter((l) => l !== '').join('<br>'));

    if (
      result.kind === 'major' &&
      unlocksGlass({ majorInjuries: this.#majorInjuries, age: this.#age, traits: this.#traits })
    ) {
      this.#unlockTrait(
        'glass',
        '帕瓦諾',
        '生涯第二次大傷。從此傷病如影隨形——<b class="dn">往後每季的受傷機率都有一個下限</b>。',
        'bad',
      );
    } else if (result.kind === 'major' && this.#majorInjuries >= 2 && !this.#traits.has('glass')) {
      // 32 歲以後的大傷是歲月的損耗，不是體質問題。
      this.flow.card(
        'info',
        '醫療團隊評估',
        '「這是歲月的損耗，不是體質問題。」——老將的傷，球團看得比誰都開。',
      );
    }
  }

  /** 套用傷勢留下的永久損失，回傳給卡片用的敘述。 */
  #applyInjuryLoss(result: Injury): string {
    if (result.loss.scope === 'none') return '';

    // 只扣他實際在用的那一側。定位鎖定之後另一側早就不練了，扣它沒有意義。
    const keys = ALL_ABILITIES.filter((k) => isSideVisible(k, this.#lockedSide));
    if (keys.length === 0) return '';

    if (result.loss.scope === 'all') {
      for (const key of keys) {
        this.#ability[key] = Math.max(
          abilities.scale.hard_floor,
          (this.#ability[key] ?? 0) - result.loss.points,
        );
      }
      // 能力值降下來，那一級的成本跟著變便宜——存著的點數可能已經夠用了。
      this.#settleCarry();
      return `重大傷勢重創身體素質：<b class="dn">全能力 −${result.loss.points}</b>。`;
    }

    const key = keys[this.world.stream('health').int(0, keys.length - 1)];
    if (key === undefined) return '';
    const before = this.#ability[key] ?? 0;
    this.#ability[key] = Math.max(abilities.scale.hard_floor, before - result.loss.points);
    this.#settleCarry();
    const name = abilities.abilities[key] ?? key;
    return `傷勢留下後遺症：<b class="dn">${esc(name)} −${before - (this.#ability[key] ?? 0)}</b>。`;
  }

  /**
   * 當季暫時能力：非成長性的獎勵走這裡，不進蓄力槽。見 ADR 0006。
   *
   * 一個 34 歲的老將結婚，說他因此變強是不合理的，但說那一年他狀態特別好是合理
   * 的。因此感情給的點數只抬高這一季的能力，球季結束就歸零，也不寫進能力表。
   */
  #grantSeasonBonus(key: AbilityKey, points: number): string {
    const scaled = Math.round(points * rewardMultiplier(this.#love));
    if (scaled <= 0) {
      return `${esc(abilities.abilities[key] ?? key)}沒有起色——<span class="sub">心裡有事的人，安定不下來</span>`;
    }
    this.#seasonBonus[key] = (this.#seasonBonus[key] ?? 0) + scaled;
    return `<b class="up">${esc(abilities.abilities[key] ?? key)} +${scaled}</b><span class="sub">（本季狀態，不計入能力表）</span>`;
  }

  /** 這一季實際上場用的能力：真實能力加上當季暫時能力。 */
  get #seasonAbility(): Abilities {
    if (Object.keys(this.#seasonBonus).length === 0) return this.#ability;
    const out: Record<string, number> = { ...this.#ability };
    for (const [key, delta] of Object.entries(this.#seasonBonus)) {
      out[key] = (out[key] ?? 0) + delta;
    }
    return out as Abilities;
  }

  /**
   * 感情。每年一次，排在事件卡之前。
   *
   * **獨立於事件卡**——事件卡是球場上的事，感情是場外的事，混在同一個牌庫裡會
   * 互相稀釋。
   */
  #loveEvent(next: () => void): void {
    const love = this.#love;
    love.turmoilThisYear = false;
    if (this.#age < loveCfg.gate.min_age) {
      next();
      return;
    }

    const rng = this.world.stream('career');
    // 抽取一律先做，與狀態無關——否則某一年的狀態差異會讓後面所有判定整串偏移。
    const runs = rng.chance(cadenceChance(love));
    if (love.cheatPenaltyYears > 0) love.cheatPenaltyYears--;
    if (love.overseas !== 'none') love.overseasYears++;
    if (!runs) {
      next();
      return;
    }

    switch (love.status) {
      case 'dating':
        this.#datingYear(next);
        return;
      case 'married':
        this.#marriedYear(next);
        return;
      default:
        this.#singleYear(next);
    }
  }

  /** 單身或離婚：認識一個人。校園看球場上的表現，職業看緋聞。 */
  #singleYear(next: () => void): void {
    const pro = this.#pro !== null;
    const partner = pickPartner(this.world, pro ? 'pro' : 'school', null);

    if (!pro) {
      const rank = this.#bestRankThisYear;
      const chance = confessionChance(rank);
      this.flow.ask(
        {
          title: `${partner}最近常常在球場邊等你`,
          options: [
            {
              id: 'love:confess',
              label: '找個機會告白',
              note: `成功率 ${chance}%｜${rank === null ? '今年沒有大賽成績' : `今年打到${rank}`}`,
              role: 'main',
            },
            { id: 'love:wait', label: '再說吧，先專心打球' },
          ],
        },
        (choice) => {
          if (choice !== 'love:confess') {
            this.flow.card('info', '再說吧', '你把話吞回去，走進打擊籠。');
            next();
            return;
          }
          if (!this.world.stream('career').chance(chance)) {
            this.flow.card(
              'info',
              '被拒絕了',
              `${esc(partner)}低著頭說「對不起」。接下來那一週，你在走廊上都繞路。`,
            );
            next();
            return;
          }
          this.#startDating(partner, true);
          next();
        },
      );
      return;
    }

    this.flow.card(
      'info',
      '場外話題',
      `你和啦啦隊的 <b class="hl">${esc(partner)}</b> 被拍到球場外同框，緋聞登上娛樂版頭條。` +
        (this.#love.divorces > 0 ? '<br><span class="sub">（評論區：「離過婚還這麼搶手」）</span>' : ''),
    );
    this.flow.ask(
      {
        title: '記者把麥克風遞到你面前：「兩位是在交往嗎？」',
        options: [
          {
            id: 'love:admit',
            label: '大方承認：「請大家祝福我們」',
            note: '還要看她那邊敢不敢承認——啦啦隊的禁愛令壓力不小',
          },
          { id: 'love:dodge', label: '笑而不答，快步走過', note: '不承認就沒有下文', role: 'main' },
        ],
      },
      (choice) => {
        if (choice !== 'love:admit') {
          this.flow.card('info', '未完待續', '緋聞燒了三天就退燒。也許時機還沒到。');
          next();
          return;
        }
        if (!this.world.stream('career').chance(loveCfg.dating.public_confirm.chance)) {
          this.flow.card(
            'bad',
            '單方面承認',
            `她隔天透過經紀公司否認：「只是普通朋友。」據傳<b class="dn">禁愛令</b>壓力不小。你一個人站在風裡。`,
          );
          next();
          return;
        }
        this.#startDating(partner, false);
        next();
      },
    );
  }

  /** 開始交往。 */
  #startDating(partner: string, fromSchool: boolean): void {
    const love = this.#love;
    love.status = 'dating';
    love.partner = partner;
    love.fromSchool = fromSchool;
    love.datingYears = 0;
    love.datedTimes++;

    const gain = this.#grantSeasonBonus(loveCfg.affair.reward.ability, 1);
    this.flow.card(
      'gold',
      fromSchool ? '在一起了' : '戀情公開',
      fromSchool
        ? `放學後的河堤，你們並肩走了很久。${esc(partner)}說：「我一直都有在看你比賽。」——${gain}`
        : `<b class="hl">${esc(partner)}</b> 在社群發出十指緊扣的照片：「謝謝大家的祝福。」——${gain}`,
    );
  }

  /** 啦啦隊殺手。條件與判定時機見 `earnsConfidante()`。 */
  #confidante(): void {
    if (!earnsConfidante(this.#love)) return;
    this.#unlockTrait(
      loveCfg.dating.confidante.trait,
      '啦啦隊殺手',
      '第三段戀情，還是走到了同樣的結局。「我愛上了你，你卻只把我當好姊妹。」——有些人註定是別人生命裡的過客。',
    );
  }

  /** 交往中的一年：風波 → 分手判定 → 插曲 → 求婚。 */
  #datingYear(next: () => void): void {
    const love = this.#love;
    const propose = canPropose({ pro: this.#pro !== null, age: this.#age });
    if (propose) love.datingYears++;

    this.#turmoil(() => {
      if (love.status !== 'dating') {
        next();
        return;
      }
      if (this.world.stream('career').chance(breakupChance(love, { canPropose: propose }))) {
        this.#breakup(
          `交往 ${love.datingYears} 年，婚期一延再延。<b class="hl">${esc(love.partner ?? '')}</b> 最後留下一句：「我等不到了。」`,
        );
        next();
        return;
      }
      if (!propose) {
        this.#datingFlavour();
        next();
        return;
      }
      this.#affairOrFlavour(() => this.#proposalAsk(next));
    });
  }

  /** 求婚。**十五歲的人不會在主場本壘板後方跪下來**，因此它有職業與年齡的門檻。 */
  #proposalAsk(next: () => void): void {
    const love = this.#love;
    this.flow.ask(
      {
        title: `交往第 ${love.datingYears} 年——${love.partner} 看著別人的婚禮影片看了很久`,
        options: [
          {
            id: 'love:propose',
            label: '就是現在——求婚',
            note: '本季狀態提升，而且往後的受傷率下降',
            role: 'main',
          },
          { id: 'love:later', label: '再存一點錢吧', note: '她沒說什麼，但交往越久分手風險越高' },
        ],
      },
      (choice) => {
        if (choice !== 'love:propose') {
          this.flow.card('info', '再等等', '她關掉影片，笑著說沒事。你假裝沒看到她眼裡的東西。');
          next();
          return;
        }
        love.status = 'married';
        love.kids = 0;
        love.datingYears = 0;
        this.#weddingYear = this.#year;
        const gain = this.#grantSeasonBonus(loveCfg.affair.reward.ability, 2);
        this.flow.card(
          'gold',
          '婚禮',
          `你在主場本壘板後方單膝跪地，大螢幕打出「Marry Me」。<b class="hl">${esc(love.partner ?? '')}</b> 哭著點頭。` +
            `休賽季完婚，紅毯用壘包排成——${gain}`,
        );
        if (isChildhoodSweetheart(love)) {
          this.#unlockTrait(
            loveCfg.childhood_sweetheart.trait,
            loveCfg.childhood_sweetheart.name,
            '十五歲那年放學後的河堤，一路走到了主場的本壘板。中間有幾次差點走散，但你們都熬過來了。',
          );
        }
        next();
      },
    );
  }

  /** 已婚的一年：風波 → 生子 → 外遇或日常。 */
  #marriedYear(next: () => void): void {
    const love = this.#love;
    this.#turmoil(() => {
      if (love.status !== 'married') {
        next();
        return;
      }
      if (
        love.kids < loveCfg.marriage.max_kids &&
        this.world.stream('career').chance(childbirthChance(love.kids))
      ) {
        love.kids++;
        const key = this.#randomVisibleAbility();
        const gain = this.#grantSeasonBonus(key, 2);
        this.flow.card(
          'gold',
          '新生命',
          `${esc(love.partner ?? '')} 平安生下你們的第 <b class="hl">${love.kids}</b> 個孩子。` +
            `當了${love.kids > 1 ? '幾次' : ''}爸爸的男人，眼神都不一樣了——${gain}`,
        );
        next();
        return;
      }
      this.#affairOrFlavour(next);
    });
  }

  /**
   * 感情風波。
   *
   * **這是整條感情線唯一沒有正確答案的地方**——外遇算得出來該拒絕，這條算不出來。
   * 吞下去是慢性、分手是重擊：斷乾淨的人痛一次，忍下來的人被慢慢消耗。
   */
  #turmoil(next: () => void): void {
    const love = this.#love;
    const rng = this.world.stream('career');
    const hit = rng.chance(turmoilChance(love));
    const kinds = loveCfg.turmoil.kinds;
    const kind = kinds[rng.int(0, kinds.length - 1)];
    if (!hit || kind === undefined || !hasPartner(love)) {
      next();
      return;
    }

    love.turmoilThisYear = true;
    this.flow.ask(
      {
        title: kind.text,
        options: [
          {
            id: 'love:swallow',
            label: '不問，當作沒看見',
            note: '關係還在，但裂痕會累積——往後越來越不平靜，感情帶來的狀態也越來越少',
            role: 'main',
          },
          {
            id: 'love:leave',
            label: '問清楚，然後結束',
            note: '當年重挫，但明年歸零，可以重新開始',
            role: 'warn',
          },
        ],
      },
      (choice) => {
        if (choice === 'love:swallow') {
          love.cracks++;
          this.flow.card(
            'bad',
            '沒有問出口',
            `你把話吞了回去。那天之後你們還是一起吃飯、一起睡覺，只是有些話再也沒有提起。` +
              `<br><span class="sub">裂痕 ${love.cracks} 道——往後的日子會越來越不平靜。</span>`,
          );
          next();
          return;
        }
        this.#loseAbility(loveCfg.turmoil.leave.ability_loss, (line) => {
          this.#breakup(`你問了，她也答了。然後你們都知道結束了。${line}`);
        });
        next();
      },
    );
  }

  /** 外遇的誘惑，或平淡的一年。 */
  #affairOrFlavour(next: () => void): void {
    const love = this.#love;
    const rng = this.world.stream('career');
    if (!rng.chance(loveCfg.affair.chance)) {
      this.#datingFlavour();
      next();
      return;
    }

    const other = pickPartner(this.world, this.#pro !== null ? 'pro' : 'school', love.partner, true);
    const married = love.status === 'married';
    this.flow.ask(
      {
        title: married
          ? `客場飯店酒吧，${other} 傳來訊息：「睡了嗎？」`
          : `聚餐散場，${other} 說順路想搭你的車`,
        options: [
          {
            id: 'love:affair',
            label: married ? '赴約' : '讓她上車',
            note: '沒被抓到＝本季狀態提升｜被抓到＝能力重挫、感情危機',
            role: 'warn',
          },
          {
            id: 'love:decline',
            label: married ? '回訊息：「陪小孩讀完故事書了，晚安」' : `「不順路。」直接載 ${love.partner} 回家`,
            note: '穩定，絕對不虧',
            role: 'main',
          },
        ],
      },
      (choice) => {
        if (choice !== 'love:affair') {
          const gain = this.#grantSeasonBonus(
            loveCfg.affair.reward.ability,
            loveCfg.affair.reward.refused,
          );
          this.flow.card('good', '正確答案', `心定了，身體就穩了——${gain}`);
          next();
          return;
        }
        love.affairs++;
        if (this.world.stream('career').chance(loveCfg.affair.escape_chance)) {
          const gain = this.#grantSeasonBonus(
            loveCfg.affair.reward.ability,
            loveCfg.affair.reward.escaped,
          );
          this.flow.card(
            'bad',
            married ? '深夜行程' : '深夜兜風',
            `沒有人拍到。不知為何，罪惡感反而讓你精神亢奮——${gain}` +
              '<br><span class="sub">（你知道這不會有好下場）</span>',
          );
          next();
          return;
        }
        this.#affairCaught(next);
      },
    );
  }

  /** 被抓到。第二次起解鎖花樣年華，而那個量級與一次大傷相同——是刻意的。 */
  #affairCaught(next: () => void): void {
    const love = this.#love;
    const c = loveCfg.affair.caught;
    love.caught++;
    love.turmoilThisYear = true;
    love.cheatPenaltyYears = loveCfg.affair.dating_breakup_penalty.years;

    this.#loseAbility(c.single_ability_loss, (line) => {
      let extra = '';
      if (love.caught >= c.scum.caught_times) {
        this.#unlockTrait(
          c.scum.trait,
          '花樣年華',
          `第二次被逮個正著。從今以後你在球迷心中的形象定型了——<b class="dn">每次被抓到，全能力 −${c.scum.all_ability_loss}</b>。`,
          'bad',
        );
        for (const key of ALL_ABILITIES.filter((k) => isSideVisible(k, this.#lockedSide))) {
          this.#ability[key] = Math.max(
            abilities.scale.hard_floor,
            (this.#ability[key] ?? 0) - c.scum.all_ability_loss,
          );
        }
        this.#settleCarry();
        extra = `<br><b class="dn">全能力 −${c.scum.all_ability_loss}</b>（花樣年華的代價）。`;
      }
      this.flow.card(
        'bad',
        love.status === 'married' ? '頭版醜聞' : '劈腿曝光',
        `狗仔的鏡頭比你想的更快，照片鋪滿版面。贊助商緊急撤圖。${line}${extra}`,
      );
    });

    const married = love.status === 'married';
    this.flow.ask(
      {
        title: married
          ? `${love.partner} 把離婚協議書放在餐桌上`
          : `${love.partner} 已讀不回三天後，終於答應見面`,
        options: [
          {
            id: 'love:apologise',
            label: '道歉，求她再給一次機會',
            note: `成功率 ${c.apology_success}%｜失敗要再扣能力並${married ? '離婚' : '分手'}`,
            role: 'main',
          },
          { id: 'love:accept', label: married ? '簽字離婚' : '坦然分手', role: 'warn' },
        ],
      },
      (choice) => {
        if (choice === 'love:apologise') {
          if (this.world.stream('career').chance(c.apology_success)) {
            this.flow.card(
              'info',
              '低谷之後',
              `長談了一整夜。<b class="hl">${esc(love.partner ?? '')}</b> 最後說：「最後一次。」` +
                '關係保住了，但有些東西回不去了。',
            );
            love.cracks++;
            next();
            return;
          }
          this.#loseAbility(c.apology_failed_loss, (line) => {
            this.#breakup(`她聽完只是搖頭，隔天律師的存證信函就到了。${line}`);
          });
          next();
          return;
        }
        this.#breakup(married ? '你在協議書上簽了名。' : '她把你送的東西整箱寄回。');
        next();
      },
    );
  }

  /** 分手或離婚。離婚要分財產——**一個只會增加的數字不是資產，是計分板**。 */
  #breakup(reason: string): void {
    const love = this.#love;
    const ex = love.partner ?? '';
    const wasMarried = love.status === 'married';

    let money = '';
    if (wasMarried) {
      const cost = divorceCost(this.#earnings, love.kids);
      this.#earnings = Math.max(0, this.#earnings - cost);
      love.divorces++;
      money = `<br>財產分配：<b class="dn">−${fmtMoney(cost)}</b>${love.kids > 0 ? '（含扶養費）' : ''}。`;
    }

    love.status = afterBreakup(love);
    love.partner = null;
    love.datingYears = 0;
    love.kids = 0;
    love.fromSchool = false;
    love.cracks = 0;
    love.overseas = 'none';
    love.overseasYears = 0;
    love.turmoilThisYear = true;

    this.flow.card(
      'bad',
      wasMarried ? '離婚' : '分手',
      `${reason}<br><b class="hl">${esc(ex)}</b> 從此不在你的生活裡了。${money}`,
    );

    if (!wasMarried) this.#confidante();
  }

  /** 平淡但溫暖的一年。感情線多數的年份都是這種。 */
  #datingFlavour(): void {
    const love = this.#love;
    const gain = this.#grantSeasonBonus(loveCfg.affair.reward.ability, 1);
    const partner = esc(love.partner ?? '');
    if (love.status === 'married' && love.kids > 0) {
      this.flow.card(
        'good',
        '球場邊的父親',
        `你被拍到賽前隔著護網教孩子怎麼戴手套，影片配文「最強棒球教室」瘋傳——${gain}`,
      );
      return;
    }
    if (love.status === 'married') {
      this.flow.card(
        'good',
        '結婚紀念日',
        `你推掉了自主訓練，陪 <b class="hl">${partner}</b> 回到當年辦婚禮的場地。她說：「明年也要來喔。」——${gain}`,
      );
      return;
    }
    if (this.#pro === null) {
      this.flow.card(
        'good',
        '放學後',
        `練習結束天已經黑了，${partner}還在看台上寫作業等你。回家的路上你們什麼都聊——${gain}`,
      );
      return;
    }
    this.flow.card(
      'good',
      '愛情長跑',
      `沒有大新聞，只有每個客場系列賽結束後，機場出口那杯 <b class="hl">${partner}</b> 替你買好的熱美式——${gain}`,
    );
  }

  /** 扣一項隨機能力，把敘述交給呼叫端。 */
  #loseAbility(points: number, then: (line: string) => void): void {
    const key = this.#randomVisibleAbility();
    const before = this.#ability[key] ?? 0;
    this.#ability[key] = Math.max(abilities.scale.hard_floor, before - points);
    this.#settleCarry();
    const lost = before - (this.#ability[key] ?? 0);
    then(
      lost > 0
        ? `<br><b class="dn">${esc(abilities.abilities[key] ?? key)} −${lost}</b>。`
        : '',
    );
  }

  /** 隨機挑一項這一側實際在用的能力。 */
  #randomVisibleAbility(): AbilityKey {
    const keys = ALL_ABILITIES.filter((k) => isSideVisible(k, this.#lockedSide));
    const pool = keys.length > 0 ? keys : ALL_ABILITIES;
    return pool[this.world.stream('career').int(0, pool.length - 1)] ?? 'sta';
  }

  /**
   * 升學或進職業時的關卡。
   *
   * **還不能求婚的人不該因為沒結婚而被拆散**，因此學生時期不累計「婚期一延再延」
   * 的風險，改成身分轉換各擲一次。撐過去的對象會延續到職業生涯——那個在國中認識
   * 的人，可能就是日後在本壘板後方跪下來求婚的對象。
   */
  #loveCheckpoint(label: string): void {
    const love = this.#love;
    const rng = this.world.stream('career');
    const broke = rng.chance(loveCfg.amateur.checkpoint.break_chance);
    if (love.status !== 'dating' || !broke) return;

    const ex = love.partner ?? '';
    love.status = afterBreakup(love);
    love.partner = null;
    love.datingYears = 0;
    love.fromSchool = false;
    this.flow.card(
      'bad',
      '各奔東西',
      `${esc(label)}的那個夏天，<b class="hl">${esc(ex)}</b> 說：「我們可能不會再見面了吧。」` +
        '<br><span class="sub">沒有人做錯什麼，只是路不同了。</span>',
    );

    this.#confidante();
  }

  /**
   * 旅外時的安排。
   *
   * **帶她走與遠距離都會壞，只是壞的形狀不同**——沒有代價的選項不是選擇，是儀式。
   * 帶她走是駝峰（適應期會過去），遠距離是一條平穩的高線（她的人生還在，只是
   * 時差對不上）。
   */
  #loveOverseas(orgName: string, next: () => void): void {
    const love = this.#love;
    if (!hasPartner(love)) {
      next();
      return;
    }

    const cost = Math.round(this.#earnings * loveCfg.overseas.bring.cost_ratio);
    this.flow.ask(
      {
        title: `要去${orgName}了。${love.partner} 站在還沒收的行李旁邊`,
        options: [
          {
            id: 'love:bring',
            label: '帶她一起走',
            note: `養家要花 ${fmtMoney(cost)}｜前兩年新鮮，第三四年最難熬，之後會回穩`,
            role: 'main',
          },
          {
            id: 'love:apart',
            label: '先遠距離看看',
            note: '她的人生還在，只是你們的時差對不上——一直都不會太穩',
          },
          { id: 'love:end', label: '分手，不拖累她', role: 'warn' },
        ],
      },
      (choice) => {
        if (choice === 'love:end') {
          this.#breakup('你說了那句「不要等我」。她沒有哭，只是點頭。');
          next();
          return;
        }
        love.overseasYears = 0;
        if (choice === 'love:bring') {
          love.overseas = 'bring';
          this.#earnings = Math.max(0, this.#earnings - cost);
          this.#addHonor(loveCfg.overseas.bring.achievement);
          this.flow.card(
            'gold',
            '舉家旅外',
            `兩張單程機票。她辭掉了工作，說「反正我本來也想換個環境」。` +
              `<br>安家費 <b class="dn">−${fmtMoney(cost)}</b>。`,
          );
          next();
          return;
        }
        love.overseas = 'apart';
        this.flow.card(
          'info',
          '遠距離',
          '登機前她抱了你很久，然後推你進安檢。往後的日子靠時差對不上的視訊撐著。',
        );
        next();
      },
    );
  }

  /**
   * 職業期的國家隊徵召。排在球季之後——一屆賽會的代價落在**下一季**的受傷風險上。
   *
   * **體育署公文**：第一次徵召起列管五年，期間強制、沒有選項。期滿之後「婉拒」
   * 才變成一個真的選擇，而那時你已經三十幾歲、身上有傷。
   */
  #nationalTeam(next: () => void): void {
    const pro = this.#pro;
    if (pro === null) {
      next();
      return;
    }

    const tournament = tournamentOf(this.#year, pro.level);
    const eligible =
      tournament !== null &&
      isEligible({
        overall: this.rating?.overall ?? 0,
        standards: this.#standards,
        seasonFactor: this.#seasonFactor,
      });
    if (tournament === null || !eligible) {
      next();
      return;
    }

    const forced = isConscripted(this.#intlLockedSince, this.#year);
    const first = this.#intlLockedSince === null;
    if (forced) {
      if (first) this.#intlLockedSince = this.#year;
      this.flow.card(
        'info',
        '體育署公文',
        first
          ? '「查 台端符合國家代表隊遴選資格，依規定<b class="hl">強制徵召</b>，並自即日起' +
            `<b class="hl">列管 ${amateurCfg.international.conscription.lock_years} 年</b>，` +
            '列管期間各國際賽事皆須配合徵召，不得以任何理由推辭。」' +
            '<br>——你甚至還沒拆完信封，行李箱已經被球團打包好了。'
          : `列管期間（剩 ${lockYearsLeft(this.#intlLockedSince, this.#year)} 年），` +
            '依規定<b class="hl">強制徵召</b>。你沒有選擇。',
      );
    }

    const options: Option[] = [
      {
        id: 'intl:go',
        label: forced ? '⋯⋯只能報到（強制徵召）' : '披上國家隊戰袍',
        note: '依成績獲得能力點｜下季受傷機率上升',
        role: 'main',
      },
    ];
    if (!forced) {
      options.push({ id: 'intl:decline', label: '以調整為由婉拒', note: '列管期已過，終於能說不' });
    }

    this.flow.ask({ title: `中華隊徵召 · ${tournament.name}`, options }, (choice) => {
      if (choice !== 'intl:go') {
        this.flow.card('info', '婉拒徵召', '你在記者會上說要調整身體。沒有人多問，但你知道自己在說謊。');
        next();
        return;
      }
      this.#playNationalTournament(tournament);
      next();
    });
  }

  /** 打一屆國際賽：名次、成績、榮譽、能力點、下季的代價。 */
  #playNationalTournament(tournament: Tournament): void {
    const intl = amateurCfg.international;
    const result = playTournament(this.world, {
      overall: this.rating?.overall ?? 0,
      traits: this.#traits,
    });

    this.#counts.internationalCaps++;
    if (result.rankIndex === 0) this.#counts.internationalTitles++;
    if (isHonorRank(result.rank)) this.#counts.internationalPodiums++;
    if (isPodium(result.rankIndex)) this.#intlPodiums++;

    this.#accumulateNationalStats();
    this.#grantPoints(result.points);
    // 一屆賽會打完，下季的受傷風險上升。國家隊不是免費的榮耀。
    this.#injuryRisk += result.injuryNextSeason;
    // 奪冠的隔年多擲訓練骰，與養成期的大賽同一套。
    if (result.rankIndex === 0) this.#lastChampionships.push('PRO');

    const label = `${this.#year} ${tournament.name}${result.rank}`;
    if (isHonorRank(result.rank)) this.#addHonor(label);
    let mvpLine = '';
    if (result.mvp) {
      this.#addHonor(`${this.#year} ${tournament.name}${intl.mvp.suffix}`);
      mvpLine = `你被選為<b class="hl">賽會 ${intl.mvp.suffix}</b>！`;
    }
    this.#intlScore += tournamentScore(result.rank, result.mvp);

    this.flow.card(
      result.rankIndex <= 1 ? 'gold' : 'info',
      tournament.name,
      `中華隊最終成績：<b class="hl">${esc(result.rank)}</b>。${mvpLine}` +
        `<br>獲得能力點 <b class="hl">${result.points}</b> 點。` +
        (result.injuryNextSeason > 0
          ? '國際賽的高強度消耗，讓下季受傷風險上升。'
          : '國家英雄不知何謂疲憊。'),
    );

    if (unlocksAce({ caps: this.#counts.internationalCaps, podiums: this.#intlPodiums, traits: this.#traits })) {
      this.#unlockTrait(
        intl.intlace_effect.trait,
        '東亞功夫',
        '只要穿上那件球衣，你的痛覺就會消失——你是為大場面而生的男人。' +
          '<b class="hl">國際賽不再增加受傷風險，而且每次徵召的能力點有保底</b>。',
      );
    }
    if (unlocksTaiwan({ caps: this.#counts.internationalCaps, traits: this.#traits })) {
      this.#unlockTrait(
        intl.taiwan_trigger.trait,
        'Team Taiwan',
        '永遠把國家榮耀放在比職涯更高的位子。台灣球迷心中永遠有一幅畫：你在球場上向全場比劃著胸口，那是你心中最榮耀的地方。',
      );
    }
  }

  /**
   * 累積國際賽的個人成績。
   *
   * **復用球季模型**：把國際賽的 par 與場次直接傳進去，不在 `leagues.json` 建一個
   * 假層級——那會污染階梯、落地與升降級的邏輯。欄位因此與職業完全一致。
   */
  #accumulateNationalStats(): void {
    const pro = this.#pro;
    const player = this.#player;
    const r = this.rating;
    if (pro === null || player === null || r === null) return;

    const position = this.#fieldPosition ?? DH;
    // 用一個 par 相當於國際賽水準的層級當尺——場次另外指定，因此層級只借它的
    // 「一季有幾場」來換算比例。
    const level = pro.level;
    const leagueGames = levelOf(level).games;
    const side = this.#lockedSide ?? (r.pitcher >= r.fielder ? 'pitcher' : 'fielder');
    const par = tournamentPar();
    const overall = (r.overall ?? 0) - par + standardOf(this.#standards, level).par;

    if (side === 'pitcher' || this.isTwoWay) {
      const role = (this.#seasonPitching as ProPitchingLine | null)?.role ?? 'SP';
      const games = tournamentGames(this.world, role === 'SP' ? 'starter' : 'reliever');
      const line = proPitchingLine(
        this.world,
        this.#seasonAbility,
        level,
        overall,
        this.#standards,
        null,
        games / leagueGames,
      );
      this.#intlPitching = addPitching(this.#intlPitching, line);
    }
    if (side === 'fielder' || this.isTwoWay) {
      const games = tournamentGames(this.world, 'batter');
      const line = proBattingLine(
        this.world,
        this.#seasonAbility,
        position,
        level,
        overall,
        this.#standards,
        games / leagueGames,
      );
      this.#intlBatting = addBatting(this.#intlBatting, line);
    }
  }

  /**
   * 交易大限。
   *
   * 在球季打完之前問——**大限就在球季中間**，那正是一年會出現兩段成績的原因。
   * 只在頂級聯盟發生：二軍的異動不是新聞。
   *
   * 三條路徑，差別在球員有多少話語權：毒瘤直接被打包、明星有否決權、其他人
   * 只有抱怨或沉默。夠強的人才有得選，那個差別本身就是資訊。
   */
  #tradeDeadline(): void {
    const pro = this.#pro;
    if (pro === null) return;
    pro.tradedFrom = null;
    if (levelOf(pro.level).top === undefined) return;

    const rng = this.world.stream('career');
    // 機率一律先抽，與資格無關——否則某年剛好非賣品會讓後面整串判定偏移。
    const rolled = rng.chance(tradeChance(this.#traits));
    if (!rolled) return;

    if (isUntouchable(this.#traits)) {
      this.flow.card(
        'info',
        '非賣品',
        '他隊捧著誘人的包裹來詢價，高層連會議都沒開就回絕了——' +
          '<b class="hl">「他是這座城市的象徵，非賣品。」</b>',
      );
      return;
    }

    if (this.#traits.has('cancer')) {
      this.#executeTrade();
      this.flow.card('bad', '毒瘤交易', '球團受夠了休息室的氣氛，直接把你打包送走。');
      return;
    }

    const par = standardOf(this.#standards, pro.level).par;
    if (isStar(this.rating?.overall ?? 0, par)) {
      this.#tradeVeto();
      return;
    }
    this.#tradeRumor();
  }

  /** 明星的否決權。留下來要付代價，但那件球衣他留住了。 */
  #tradeVeto(): void {
    const t = seasonCfg.trade.refuse;
    this.flow.ask(
      {
        title: '交易大限：他隊送來報價，球團徵詢你的否決權',
        options: [
          { id: 'trade:accept', label: '點頭同意，換個環境', role: 'main' },
          {
            id: 'trade:veto',
            label: '行使否決權，我要留下',
            note: `未來 ${t.years} 年的下一張合約薪水打折`,
            role: 'warn',
          },
        ],
      },
      (choice) => {
        if (choice === 'trade:accept') {
          this.#executeTrade();
          this.flow.card('info', '轉隊', '你打包行李，前往新的城市。');
          return;
        }
        this.#tradeRefuseYears = t.years;
        this.flow.card(
          'info',
          '否決交易',
          '你按下否決鍵。忠誠是一種選擇——球團的重建計畫被你打亂了，' +
            '下張合約也會付出一點代價，但這件球衣，你留下來了。',
        );
      },
    );
  }

  /** 非明星的交易傳言。抱怨或沉默，兩者的差別只在機率。 */
  #tradeRumor(): void {
    const r = seasonCfg.trade.rumor;
    this.flow.ask(
      {
        title: '交易傳言：媒體報導你可能被交易',
        options: [
          {
            id: 'trade:complain',
            label: '公開抱怨表達不滿',
            note: '增加本次被交易的可能性',
            role: 'warn',
          },
          { id: 'trade:silent', label: '保持沉默，專心打球', note: '交易機率不變', role: 'main' },
        ],
      },
      (choice) => {
        const complained = choice === 'trade:complain';
        if (complained) {
          this.#complains++;
          if (this.#complains >= r.ambience.complains) {
            this.#unlockTrait(
              r.ambience.trait,
              '我不是針對你',
              '你又一次對媒體大吐苦水。球團高層看在眼裡——這種選手，留著也是不定時炸彈。' +
                '<b class="dn">往後被交易的機率永久提高</b>。',
              'bad',
            );
          }
        }

        const chance = complained ? r.complain_chance : r.silence_chance;
        if (!this.world.stream('career').chance(chance)) {
          this.flow.card(
            'info',
            complained ? '雷聲大雨點小' : '留了下來',
            complained
              ? '抱怨歸抱怨，這次交易最後沒有成局。你還在原隊，但氣氛有點僵。'
              : '傳言就是傳言。這個球季，你還是穿著同一件球衣。',
          );
          return;
        }
        this.#executeTrade();
        this.flow.card(
          complained ? 'bad' : 'info',
          complained ? '弄假成真' : '交易成局',
          complained
            ? '你的抱怨上了頭條，球團順勢把你送走。新東家，好好打吧。'
            : '儘管你不動聲色，球團還是完成了這筆交易。',
        );
      },
    );
  }

  /**
   * 成交。
   *
   * 同體系內換隊，因此**該重置的只有球隊層級的東西**——年資、合約、守位登錄
   * 都跟著球員走，那正是季中交易與跨體系轉會的差別。
   */
  #executeTrade(): void {
    const pro = this.#pro;
    if (pro === null) return;
    const team = tradeTarget(this.world, levelOf(pro.level).org, pro.team);
    if (team === null) return;
    pro.tradedFrom = pro.team;
    pro.team = team;
  }

  /**
   * 把這一季記進生涯紀錄，季中轉隊的年份記成兩段。
   *
   * 兩段各自帶著**自己那支球隊的戰績**去切兩本帳——那正是逐段紀錄存在的理由：
   * 前半季在墊底球隊、後半季在冠軍隊，那是兩件不同的事。
   *
   * 切分用相減而不是各自四捨五入，因此兩段相加精確等於全季，生涯累積與逐年表
   * 不會對不起來。
   */
  #recordStints(
    batting: BattingLine | null,
    pitching: ProPitchingLine | null,
    defense: number,
  ): readonly SeasonRecord[] {
    const pro = this.#pro;
    if (pro === null) return [];

    const from = pro.tradedFrom;
    if (from === null) {
      this.#recordSeason(batting, pitching, defense, pro.team);
      const one = this.#seasons.at(-1);
      return one === undefined ? [] : [one];
    }

    const ratio = tradeSplit(this.world);
    const bat = batting === null ? null : splitBatting(batting, ratio);
    const pit = pitching === null ? null : splitPitching(pitching, ratio);
    const d1 = Math.round(defense * ratio);

    this.#recordSeason(bat?.[0] ?? null, pit?.[0] ?? null, d1, from);
    this.#recordSeason(bat?.[1] ?? null, pit?.[1] ?? null, defense - d1, pro.team);
    return this.#seasons.slice(-2);
  }

  /**
   * 把一段記進生涯紀錄。
   *
   * **份額與 k 在當下就算好存進去**，不留到結算時回算：那些值取決於當年的聯盟
   * 水準，而聯盟水準逐年浮動，事後回算會把整段生涯都套上引退那年的數字。
   */
  #recordSeason(
    batting: BattingLine | null,
    pitching: ProPitchingLine | null,
    defense: number,
    team: string,
  ): void {
    const pro = this.#pro;
    if (pro === null) return;
    const info = levelOf(pro.level);
    const now = standardOf(this.#standards, pro.level);
    const baseline = proBaseline(pro.level);
    // 球隊戰績決定兩本帳怎麼切——0 勝的球隊沒有勝利份額可分。二軍沒有聯盟
    // 戰力表，那裡的球隊勝率視為未知，不做調整。
    const teamWinRate = this.#league?.get(team)?.winRate ?? null;

    // 守備的份額：沒登錄守位（二軍、投手、指定打擊）就沒有守備責任。
    let fielding: Shares = { win: 0, loss: 0 };
    let fieldingK = 0;
    if (pro.position !== null && pro.position !== DH && batting !== null) {
      const average = positionAverage(pro.position, pro.level, this.#standards);
      const threshold = requiredScore(pro.position, pro.level, this.#age);
      if (average !== null) {
        fielding = fieldingShares({
          defenseScore: defenseScore(this.#ability, pro.position),
          positionAverage: average,
          positionShare: fieldingResponsibility(pro.position),
          leagueGames: info.games,
          gamesShare: batting.games / info.games,
          teamWinRate,
        });
        if (threshold !== null) {
          const p0 = fieldingReplacementWinPct(threshold, average);
          fieldingK = p0 >= 1 ? 0 : p0 / (1 - p0);
        }
      }
    }

    this.#seasons.push({
      year: this.#year,
      age: this.#age,
      org: info.org,
      level: pro.level,
      levelName: info.name,
      team,
      position: pro.position,
      batting,
      pitching,
      defenseRuns: defense,
      shares: {
        batting:
          batting === null ? { win: 0, loss: 0 } : battingShares(batting, baseline, teamWinRate),
        pitching:
          pitching === null
            ? { win: 0, loss: 0 }
            : pitchingShares(pitching, baseline, teamWinRate, pitching.role),
        fielding,
      },
      lossPenalty: {
        batting: lossPenalty('batting', pro.level, this.#standards),
        pitching: lossPenalty('pitching', pro.level, this.#standards),
        fielding: fieldingK,
      },
      difficulty: difficultyOf(now.par),
      top: info.top ?? null,
      seasonFactor: this.#seasonFactor,
    });
  }

  /**
   * 年度獎項。
   *
   * 只在頂級聯盟評獎——二軍沒有年度獎項。獎項存成結構化紀錄供計分使用，同時
   * 把名稱寫進去重的榮譽清單供顯示（見 #addHonor 的說明：清單是「他做到過
   * 什麼」，次數要看結構化紀錄）。
   */
  #annualAwards(batting: BattingLine | null, pitching: ProPitchingLine | null): void {
    const pro = this.#pro;
    if (pro === null) return;
    const info = levelOf(pro.level);
    if (info.top === undefined) return;

    const r = this.rating;
    const par = standardOf(this.#standards, pro.level).par;

    // 守備勝率：獎項判定看它而不是守備分的顯示數字——顯示尺度可以隨時調整，
    // 判定不該跟著跑掉。
    let fieldingWinPct: number | null = null;
    if (pro.position !== null && pro.position !== DH && batting !== null) {
      const average = positionAverage(pro.position, pro.level, this.#standards);
      if (average !== null) {
        fieldingWinPct = winPct(
          fieldingShares({
            defenseScore: defenseScore(this.#ability, pro.position),
            positionAverage: average,
            positionShare: fieldingResponsibility(pro.position),
            leagueGames: info.games,
            gamesShare: batting.games / info.games,
          }),
        );
      }
    }

    const won = annualAwards(this.world, {
      year: this.#year,
      org: info.org,
      level: pro.level,
      leagueGames: info.games,
      spread: abilitySpread(pro.level, this.#standards),
      d: (r?.overall ?? 0) - par,
      team: pro.team,
      // 第一年就在頂級聯盟才算新人年——在二軍待過幾年再上來的人不是新人。
      rookie: this.#awards.every((a) => a.org !== info.org),
      batting,
      pitching,
      role: pitching?.role ?? null,
      position: pro.position,
      fieldingWinPct,
      // 這一季的勝利份額。#recordSeason 已經在前一步算好並存進紀錄裡，
      // 直接取最後一筆——重算一次會有兩份實作，遲早對不起來。
      winShares: (() => {
        const last = this.#seasons.at(-1);
        if (last === undefined) return 0;
        return last.shares.batting.win + last.shares.pitching.win + last.shares.fielding.win;
      })(),
      // 年度最佳打者只看打擊那一段——守備有金手套，投球有最佳投手。
      battingWinShares: this.#seasons.at(-1)?.shares.batting.win ?? 0,
    });
    if (won.length === 0) return;

    this.#awards.push(...won);
    const orgName = leagues.top_league_names[info.org] ?? info.org;
    for (const a of won) this.#addHonor(`${orgName}${a.name}`);
    this.flow.card('gold', '年度獎項', won.map((a) => esc(a.name)).join('｜'));
  }

  /**
   * 職業年度結束：老化 → 升降級 → 引退判定。
   *
   * 順序不能換。老化先跑，因為升降級看的是**這一季結束後**的能力；引退最後
   * 跑，因為被釋出是引退判定的輸入之一。
   */
  #proEndYear(): void {
    const pro = this.#pro;
    if (pro === null) return;

    this.#age++;
    this.#year++;
    pro.year++;
    // 否決交易的餘波會過去。球團記得那件事，但不是記一輩子。
    if (this.#tradeRefuseYears > 0) this.#tradeRefuseYears--;

    // 聯盟水準推進一年。人才有興衰，同一個聯盟在不同年代不是同一個聯盟。
    if (this.#standards !== null) {
      this.#standards = advanceStandards(this.world, this.#standards);
    }

    // 聯盟推進一年。玩家的貢獻只加在自己的球隊上——棒球是九個人的運動，
    // 再強的球員也翻不了一支爛隊，因此上限壓得很窄。
    if (this.#league !== null) {
      const par = standardOf(this.#standards, pro.level).par;
      this.#league = advanceLeague(this.world, this.#league, {
        playerTeam: pro.team,
        playerEffect: playerEffect(this.rating?.overall ?? 0, par),
      });
    }

    // ---- 老化
    const aging = applyAging(this.world, this.#ability, this.#age);
    this.#ability = { ...aging.ability };
    // 能力值降下來之後，那一級的成本跟著變便宜——存著的點數可能已經夠用了。
    this.#settleCarry();
    // 只列還在用的能力。定位鎖定之後另一側早就不顯示了，卻仍在衰退卡上刷出
    // 一整排數字，等於在提醒玩家一堆他已經動不了的東西。
    const visible = [...aging.changes.entries()].filter(([k]) =>
      isSideVisible(k, this.#lockedSide),
    );
    if (visible.length > 0) {
      const lines = visible
        .map(([k, v]) => `${esc(abilities.abilities[k as AbilityKey] ?? k)} ${v > 0 ? '+' : ''}${v}`)
        .join('｜');
      this.flow.card(
        aging.phase === 'decline' ? 'bad' : 'good',
        aging.phase === 'decline' ? '歲月' : '成長',
        aging.phase === 'decline'
          ? `身體開始誠實了。${lines}`
          : `還在往上走。${lines}`,
      );
    }

    // ---- 升降級
    const r = this.rating;
    const org = levelOf(pro.level).org;
    const move = evaluateMovement(this.world, {
      level: pro.level,
      overall: r?.overall ?? 0,
      yearsAtBottom: pro.yearsAtBottom,
      standards: this.#standards,
      // 一軍的位置有外籍名額擋著，直到在籍年資讓你視同本土為止（ADR 0019）。
      importPremium: importPremium(org, this.#orgYears.get(org) ?? 0),
    });

    let released = false;
    this.#demotedTo = null;
    this.#demotedFrom = null;
    if (move.movement === 'release') {
      released = true;
      this.flow.card('bad', '戰力外', `球團通知你不再續約——${esc(move.reason)}。`);
    } else if (move.level !== null && move.level !== pro.level) {
      const to = levelOf(move.level);
      // 下放的卡片交給 #demotionOffers 說——那裡才知道有沒有別的邀請，
      // 在這裡先講一次會變成同一件事講兩遍。
      if (move.movement === 'demote') {
        this.#demotedTo = to.name;
        this.#demotedFrom = pro.level;
        this.#demotePressure = move.pressure ?? 0;
      }
      else {
        this.flow.card(
          'gold',
          '升上一軍',
          `${esc(move.reason)}，被叫上<b class="hl">${esc(to.name)}</b>。`,
        );
      }
      pro.level = move.level;
    }

    // 只有待在體系最底層才累計寬限期——升上去就歸零。
    pro.yearsAtBottom = pathOf(levelOf(pro.level).org)[0] === pro.level ? pro.yearsAtBottom + 1 : 0;

    // ---- 引退
    // 只剩年齡上限會不由分說地結束生涯。被釋出的人先跑尋路——真的沒有任何
    // 球隊邀請，才是終點。
    const retire = shouldRetire({ age: this.#age });
    if (retire.retire) {
      this.#payBuyout('player');
      this.flow.push(() => this.#retire(retire.reason));
      return;
    }
    if (released) {
      // 球團主動終止要付全額。被釋出不等於生涯結束——先問問別的體系收不收。
      this.#payBuyout('club');
      this.flow.push(() => this.#fallback(move.reason));
      return;
    }

    // 合約處理排在升降級之後、引退選擇之前——談約要先知道自己在哪一層。
    this.flow.push(() => this.#contractPhase());
  }

  /**
   * 年度的合約處理：倒數 → 延長續約 → 到期。
   *
   * 到期之後分兩條路：**掌控期內由球團行使續約權**（球員沒有選擇），**取得
   * FA 資格則由球員自己談**。那正是掌控期的意義——選秀球隊用一個順位賭了你，
   * 就先擁有你幾年。
   */
  #contractPhase(): void {
    const pro = this.#pro;
    if (pro === null) return;
    const info = levelOf(pro.level);
    const top = info.top !== undefined;

    // 服務年資只在頂級聯盟累積——二軍的年份不算進掌控期。
    if (top) {
      pro.serviceYears++;
      // 外籍身分只算一軍年份，與掌控期同一個計數口徑。
      const org = levelOf(pro.level).org;
      this.#orgYears.set(org, (this.#orgYears.get(org) ?? 0) + 1);
    }
    const eligible = isFreeAgentEligible({
      serviceYears: pro.serviceYears,
      changedOrg: pro.changedOrg,
    });

    pro.contract = { ...pro.contract, years: pro.contract.years - 1 };

    if (offersExtension({ contract: pro.contract, topLevel: top, freeAgentEligible: eligible, d: this.#lastD })) {
      this.#askTerms(
        `母隊提前延長續約 · ${pro.team}（合約剩 1 年）`,
        (years, mult) => {
          pro.contract = {
            years: pro.contract.years + years,
            mult,
            extensionOffered: true,
          };
          this.flow.card(
            'gold',
            '延長續約',
            `與 <b class="hl">${esc(pro.team)}</b> 達成延長協議，追加 <b class="hl">${years} 年</b>` +
              `（年薪係數 ×${mult.toFixed(2)}）。`,
          );
          this.#endOfYearChoices();
        },
        () => {
          pro.contract = { ...pro.contract, extensionOffered: true };
          this.flow.card('info', '婉拒延長', '你婉拒了母隊的提前延長，選擇打完現有合約再說。');
          this.#endOfYearChoices();
        },
      );
      return;
    }

    if (pro.contract.years > 0) {
      this.#endOfYearChoices();
      return;
    }

    // ---- 合約到期
    if (!top) {
      // 非頂級層級沒有談判可言——續個短約繼續打。
      const opt = seasonCfg.contract.control.club_option;
      pro.contract = {
        years: this.world.stream('career').int(opt.years.min, opt.years.max),
        mult: opt.multiplier,
        extensionOffered: false,
      };
      this.#endOfYearChoices();
      return;
    }

    if (!eligible) {
      const opt = seasonCfg.contract.control.club_option;
      pro.contract = {
        years: this.world.stream('career').int(opt.years.min, opt.years.max),
        mult: opt.multiplier,
        extensionOffered: false,
      };
      this.flow.card(
        'info',
        '球團續約',
        `你仍在選秀球隊的掌控期（服務 ${pro.serviceYears}／${seasonCfg.contract.control.years} 年），` +
          `球團行使續約權——續 <b class="hl">${pro.contract.years} 年</b>，薪資照層級基數。`,
      );
      this.#endOfYearChoices();
      return;
    }

    this.#freeAgency();
  }

  /**
   * 自由球員。
   *
   * 兩條路：與母隊續約，或**跳出合約測試市場**。後者是真正的賭注——市場可能
   * 冷得可怕，那時只剩減薪回原隊或掛靴。
   *
   * 市場上的報價來自尋路（不看年齡、不看上季表現），因為 FA 問的同樣是「哪裡
   * 收得下你」而不是「誰想要你」。旅外球員因此在這裡自然拿得到返台的選項——
   * 落葉歸根不必特別寫。
   */
  #freeAgency(): void {
    const pro = this.#pro;
    if (pro === null) return;

    this.flow.ask(
      {
        title: `合約到期 · 取得自由球員資格（服務 ${pro.serviceYears} 年）`,
        options: [
          { id: 'fa:stay', label: `與 ${pro.team} 續約`, note: '接著選擇長約或短約', role: 'main' },
          {
            id: 'fa:market',
            label: '跳出合約，測試自由市場',
            note: '可能乏人問津，那時只剩減薪回原隊或引退',
            role: 'warn',
          },
        ],
      },
      (choice) => {
        if (choice === 'fa:market') {
          this.#faMarket();
          return;
        }
        this.#askTerms(`與 ${pro.team} 續約 · 選擇合約類型`, (years, mult) => {
          pro.contract = { years, mult, extensionOffered: false };
          this.flow.card(
            'info',
            '續約',
            `與 <b class="hl">${esc(pro.team)}</b> 完成 <b class="hl">${years} 年</b>續約` +
              `（年薪係數 ×${mult.toFixed(2)}）。`,
          );
          this.#endOfYearChoices();
        });
      },
    );
  }

  /** 自由市場。沒有人開價時的兩個結局：減薪回原隊，或就此引退。 */
  #faMarket(): void {
    const pro = this.#pro;
    if (pro === null) return;

    // FA 問的是「誰想要你」，因此不列比現在更差的舞台。真的沒有人開價，
    // 那才叫市場冷。
    //
    // 海外 FA 併在同一份報價單裡：**熬滿年資之後不必再求誰放你走**，那條路
    // 與國內市場一起攤在桌上，玩家自己選。
    const offers = [
      ...overseasFaOffers(this.world, {
        ...this.#overseasContext,
        serviceYears: pro.serviceYears,
      }),
      ...fallbackOffers(this.world, {
        ...this.#transferContext,
        minPar: standardOf(this.#standards, pro.level).par,
        // 借用尋路的名單，但這條路是球團在挑人——外籍加成照收。見 ADR 0012。
        approach: 'recruit',
      }),
    ];
    if (offers.length === 0) {
      this.flow.card(
        'bad',
        '自由市場',
        '電話一直沒有響。經紀人聳聳肩——市場對你的評價比想像中冷。',
      );
      this.flow.ask(
        {
          title: '沒有球隊開價',
          options: [
            {
              id: 'fa:crawl',
              label: `回 ${pro.team} 減薪簽約`,
              note: `1 年｜年薪係數 ×${seasonCfg.contract.multiplier.by_performance.default.toFixed(2)}`,
              role: 'main',
            },
            { id: 'fa:retire', label: '就此引退', role: 'warn' },
          ],
        },
        (choice) => {
          if (choice === 'fa:retire') {
            this.flow.push(() => this.#retire(`自由市場乏人問津，${this.#year} 年黯然引退`));
            return;
          }
          pro.contract = {
            years: 1,
            mult: seasonCfg.contract.multiplier.by_performance.default,
            extensionOffered: false,
          };
          this.flow.card(
            'bad',
            '減薪合約',
            `低著頭回到 <b class="hl">${esc(pro.team)}</b>，年薪打折。`,
          );
          this.#endOfYearChoices();
        },
      );
      return;
    }

    const overseas = postingTarget(levelOf(pro.level).org);
    const options: Option[] = [
      ...offers.map((o, i) => ({
        id: `market:${i}`,
        label: `${o.orgName}　${o.team}（${o.levelName}）`,
        note:
          Game.#terms(o) +
          (o.org === overseas ? `｜海外 FA・不需母隊同意` : '') +
          (o.homecoming ? '｜落葉歸根' : ''),
      })),
      { id: 'market:stay', label: `回 ${pro.team} 續約`, role: 'main' },
    ];

    this.flow.ask({ title: '自由市場報價一覽', options }, (choice) => {
      const picked = offers[Number(choice.split(':')[1])];
      if (picked === undefined) {
        this.#askTerms(`與 ${pro.team} 續約 · 選擇合約類型`, (years, mult) => {
          pro.contract = { years, mult, extensionOffered: false };
          this.flow.card('info', '續約', `重回 <b class="hl">${esc(pro.team)}</b>。`);
          this.#endOfYearChoices();
        });
        return;
      }
      this.#moveTo(picked, picked.homecoming ? '落葉歸根' : '新的舞台');
      this.#endOfYearChoices();
    });
  }

  /**
   * 長短約的提問。
   *
   * 只有夠格的人才看得到長約選項——**年齡大或成績不佳時，球團乾脆只給短約**，
   * 那個「沒有選擇」本身就是資訊。
   */
  #askTerms(
    title: string,
    onPick: (years: number, mult: number) => void,
    onReject?: () => void,
  ): void {
    const pro = this.#pro;
    const player = this.#player;
    if (pro === null || player === null) return;

    // 括號不可省：`a ?? b >= c ? x : y` 會解析成 `(a ?? (b >= c)) ? x : y`，
    // 而 #lockedSide 是非空字串時永遠 truthy——鎖定成野手的人會被當成投手
    // 談約，年限上限因此被壓到投手的 7 年。
    const side: 'pitcher' | 'fielder' =
      this.#lockedSide ??
      ((this.rating?.pitcher ?? 0) >= (this.rating?.fielder ?? 0) ? 'pitcher' : 'fielder');

    const terms = termOptions({
      d: this.#lastD,
      age: this.#age,
      side,
      traits: this.#traits,
      tradeRefused: this.#tradeRefuseYears > 0,
      // 傷病史縮短年限。這個輸入從合約系統做好那天就寫在那裡，恆為 0——
      // 傷病系統上線之後它第一次有數字。
      injuries: { majorInjuries: this.#majorInjuries, tjSurgeries: 0 },
    });

    const base = salaryFor(pro.level, this.#lastD);
    const options: Option[] = [];
    if (terms.longEligible) {
      options.push({
        id: 'term:long',
        label: `長約（${terms.longYears} 年）`,
        note: `年薪係數 ×${terms.longMult.toFixed(2)}，約 ${fmtMoney(Math.round(base * terms.longMult))}／年｜穩定保障`,
        role: 'main',
      });
    }
    options.push({
      id: 'term:short',
      label: `短約（${terms.shortYears} 年）`,
      note:
        `年薪係數 ×${terms.shortMult.toFixed(2)}，約 ${fmtMoney(Math.round(base * terms.shortMult))}／年｜` +
        (terms.longEligible ? '賭下次身價' : '以你目前的年齡與成績，球團只願提供短約'),
      role: terms.longEligible ? 'warn' : 'main',
    });
    if (onReject !== undefined) {
      options.push({ id: 'term:reject', label: '婉拒，維持現狀', role: 'warn' });
    }

    this.flow.ask({ title, options }, (choice) => {
      if (choice === 'term:reject') {
        onReject?.();
        return;
      }
      if (choice === 'term:long') onPick(terms.longYears, terms.longMult);
      else onPick(terms.shortYears, terms.shortMult);
    });
  }

  /** 轉會判定用的上下文。挖角與尋路共用。 */
  get #transferContext() {
    const pro = this.#pro;
    return {
      overall: this.rating?.overall ?? 0,
      age: this.#age,
      lastWinPct: this.#lastWinPct,
      currentOrg: pro === null ? '' : levelOf(pro.level).org,
      currentTeam: pro?.team ?? '',
      playedOrgs: this.#playedOrgs,
      standards: this.#standards,
      salary: this.#seasonSalary,
      servedYears: this.#orgYears,
    };
  }

  /**
   * 挖角。
   *
   * 每個體系各自擲一次，命中的**併成同一張報價單**——「日職和大聯盟同時來搶」
   * 是旅外題材最好看的一幕，拆成兩次提問就沒了。
   *
   * 拒絕沒有代價，但敘述會透露球探的關注度在變——用觀察到的現象講，不講機率。
   */
  #scouting(next: () => void): void {
    const pro = this.#pro;
    if (pro === null) {
      next();
      return;
    }

    const ctx = this.#transferContext;
    const offers = scoutingOffers(this.world, ctx);
    const note = scoutingNote(ctx);

    if (offers.length === 0) {
      if (note !== null) this.flow.card('info', '海外的風聲', esc(note));
      next();
      return;
    }

    this.flow.ask(
      {
        title: '海外球團遞出合約',
        options: [
          ...offers.map((o, i) => ({
            id: `transfer:${i}`,
            label: `${o.orgName}　${o.team}（${o.levelName}）`,
            note:
              Game.#terms(o) +
              (o.homecoming ? '｜回到熟悉的體系' : '') +
              (levelOf(o.level).top === undefined ? '｜先從小聯盟出發' : ''),
          })),
          { id: 'transfer:stay', label: `留在${orgLabel(ctx.currentOrg)}`, role: 'main' as const },
        ],
      },
      (choice) => {
        const picked = offers[Number(choice.split(':')[1])];
        if (picked === undefined) {
          if (note !== null) this.flow.card('info', '海外的風聲', esc(note));
          next();
          return;
        }
        this.#payBuyout('player');
        this.#moveTo(picked, '旅外');
        this.#loveOverseas(picked.orgName, next);
      },
    );
  }

  /**
   * 尋路：被釋出時，其他體系的邀請。
   *
   * 這裡問的不是「誰想要你」，而是「哪裡還收得下你」——因此不看年齡、不看
   * 上季表現。墨聯與澳職只出現在這條路上，那正是它們的價值：當所有頂級聯盟
   * 都關門時，還有地方打球。
   *
   * 一個都找不到就是真的沒有球隊要你了，生涯到此為止。
   */
  #fallback(reason: string): void {
    const offers = fallbackOffers(this.world, this.#transferContext);
    if (offers.length === 0) {
      this.flow.push(() => this.#retire(reason));
      return;
    }

    this.flow.card(
      'bad',
      '戰力外通告',
      `${esc(reason)}。所幸還有球隊捎來邀請——`,
    );

    const options: Option[] = offers.map((o, i) => {
      const base = {
        id: `fallback:${i}`,
        label: `${o.orgName}　${o.team}（${o.levelName}）`,
        note: `${Game.#terms(o)}${o.homecoming ? '｜落葉歸根' : ''}`,
      };
      return i === 0 ? { ...base, role: 'main' as const } : base;
    });
    options.push({ id: 'fallback:retire', label: '就此引退', role: 'warn' });

    this.flow.ask({ title: '新東家的邀請', options }, (choice) => {
      const picked = offers[Number(choice.split(':')[1])];
      if (picked === undefined) {
        this.flow.push(() => this.#retire(`${reason}，${this.#year} 年選擇引退`));
        return;
      }
      this.#moveTo(picked, picked.homecoming ? '落葉歸根' : '新的舞台');
      this.flow.push(() => this.#proYear());
    });
  }

  /**
   * 換體系。
   *
   * 要重置的東西比想像中多：守位登錄（各層級門檻不同）、體系年資（新東家沒有
   * 理由享有原球團的掌控權）、聯盟戰力表、以及合約。**任何以體系為鍵的東西
   * 都要檢查是否需要重置**，漏掉會產生難以察覺的錯誤。
   */
  #moveTo(offer: TransferOffer, headline: string): void {
    const pro = this.#pro;
    if (pro === null) return;

    this.#earnings += offer.bonus;
    this.#playedOrgs.add(offer.org);

    pro.level = offer.level;
    pro.team = offer.team;
    pro.position = null;
    // **底層年資不因換體系歸零。** 它量的是「連續在最低層級掙扎了幾季」，那是
    // 球員的狀態，不是球團的帳。歸零的話，戰力外轉隊等於每次再送滿一次寬限期，
    // 六個體系就能讓一個早該收山的人一直再拼一年。落腳在底層以上才算真的重新
    // 站穩，那時才歸零。
    pro.yearsAtBottom = pathOf(levelOf(offer.level).org)[0] === offer.level ? pro.yearsAtBottom : 0;
    pro.year = 1;
    pro.serviceYears = 0;
    pro.changedOrg = true;
    // **年限由開價的球隊決定**，不是一律的新人約——爭冠的球隊給短約，重建的
    // 敢給長約，那個取捨正是報價單上要讀的東西。
    pro.contract = { ...rookieContract(), years: offer.years };
    // **換了體系就不算被下放了。** 沒清掉的話，接下來會跳出「你被送回中職
    // 二軍，要接受下放還是掛靴」——而他人已經在墨西哥了。
    this.#demotedTo = null;
    this.#demotedFrom = null;

    // **用報價帶來的那一份戰力表**，不重抽——報價單上寫的奪冠機率必須就是簽下去
    // 之後真正面對的格局，重抽等於讓玩家看到的數字與拿到的球隊是兩回事。
    this.#league = offer.table;
    this.#lastStandardsNote = null;

    this.flow.card(
      'gold',
      headline,
      `與 <b class="hl">${esc(offer.team)}</b> 簽約，從 <b class="hl">${esc(offer.levelName)}</b> 出發。` +
        `簽約金 <b class="hl">${fmtMoney(offer.bonus)}</b>，約期 <b class="hl">${offer.years}</b> 年。` +
        (offer.homecoming ? '<br>回到熟悉的體系，看台上有人記得你的名字。' : ''),
    );
  }

  /**
   * 報價的條件摘要。
   *
   * **三件事要一起看**：錢、年限、球隊處境。爭冠的球隊砸錢卻只給一兩年，
   * 重建的給不起大錢卻敢給長約——把奪冠機率寫出來，那個取捨才讀得出來。
   */
  static #terms(o: TransferOffer): string {
    return (
      `簽約金 ${fmtMoney(o.bonus)}｜${o.years} 年` +
      `｜球隊奪冠 ${Math.round(o.odds * 100)}%`
    );
  }

  /** 入札與海外 FA 共用的上下文。 */
  get #overseasContext() {
    const pro = this.#pro;
    return {
      org: pro === null ? '' : levelOf(pro.level).org,
      overall: this.rating?.overall ?? 0,
      age: this.#age,
      playedOrgs: this.#playedOrgs,
      standards: this.#standards,
      servedYears: this.#orgYears,
    };
  }

  /**
   * 入札申請。
   *
   * **入札與自由球員是互斥的兩條路，分界正是合約**——入札存在的理由就是「他
   * 還有合約，但他想走」。因此它由玩家在合約期間主動提出，母隊依年資與入札金
   * 決定放不放。
   *
   * 被拒絕不是挫折，是還沒到時候——那個邏輯玩家看得懂。
   */
  #posting(next: () => void): void {
    const pro = this.#pro;
    if (pro === null || pro.changedOrg || pro.serviceYears < 1) {
      next();
      return;
    }

    const ctx = this.#overseasContext;
    if (!canRequestPosting(ctx)) {
      next();
      return;
    }
    const target = postingTarget(ctx.org);
    if (target === null) {
      next();
      return;
    }

    this.flow.ask(
      {
        title: `你的能力已經站得上${orgLabel(target)}。要向球團提出入札申請嗎？`,
        options: [
          {
            id: 'posting:ask',
            label: '提出入札申請',
            note: '母隊收下入札金才會放人｜年資越深越容易點頭',
          },
          { id: 'posting:wait', label: '再等等，先打完現有合約', role: 'main' },
        ],
      },
      (choice) => {
        if (choice !== 'posting:ask') {
          next();
          return;
        }
        this.#postingResult(target, next);
      },
    );
  }

  /** 母隊的答覆與競標結果。 */
  #postingResult(target: string, next: () => void): void {
    const pro = this.#pro;
    if (pro === null) {
      next();
      return;
    }

    // 先問有沒有人要——入札金是簽約金的倍數，沒有報價就沒有金額可談。
    const bids = postingBids(this.world, this.#overseasContext);
    if (bids.length === 0) {
      this.flow.card(
        'bad',
        '入札流標',
        `球團同意把你掛上入札名單，但競標期結束時<b class="dn">沒有任何球團出價</b>。` +
          `<br><span class="sub">${esc(orgLabel(target))}要的是可以養的年輕人，而你已經不是了。</span>`,
      );
      next();
      return;
    }

    const best = bids.reduce((a, b) => (b.bonus > a.bonus ? b : a));
    const fee = postingFee(best.bonus);
    const chance = postingConsentChance({ serviceYears: pro.serviceYears, fee });
    if (!this.world.stream('career').chance(chance)) {
      this.flow.card(
        'bad',
        '球團的答覆',
        `球團婉拒了你的入札申請——<b class="dn">再打幾年，我們就放你走</b>。` +
          `<br><span class="sub">服務年資 ${pro.serviceYears} 年。待得越久，球團越沒有理由留你。</span>`,
      );
      next();
      return;
    }

    this.flow.card(
      'gold',
      '入札成立',
      `球團同意掛牌，入札金 <b class="hl">${fmtMoney(fee)}</b> 進了母隊口袋。` +
        `<br>${esc(orgLabel(target))}遞出了報價——`,
    );

    this.flow.ask(
      {
        title: '入札 · 選擇你的新東家',
        options: [
          ...bids.map((b, i) => ({
            id: `posting:${i}`,
            label: `${b.orgName}　${b.team}（${b.levelName}）`,
            note: `簽約金 ${fmtMoney(b.bonus)}${b.homecoming ? '｜回到熟悉的體系' : ''}`,
          })),
          { id: 'posting:cancel', label: '反悔，留在原隊', role: 'warn' as const },
        ],
      },
      (choice) => {
        const picked = bids[Number(choice.split(':')[1])];
        if (picked === undefined) {
          this.flow.card('info', '撤回申請', '你在最後一刻收回了申請。球團什麼也沒說。');
          next();
          return;
        }
        // 入札不必付買斷——母隊拿到的入札金就是對價。
        this.#moveTo(picked, '入札成功');
        next();
      },
    );
  }

  /**
   * 年末的引退選擇。合約處理完、挖角與入札問過才輪到它——先知道明年有沒有球
   * 打、在哪裡打，再決定要不要走。
   */
  #endOfYearChoices(): void {
    this.#scouting(() =>
      this.#posting(() => {
        const demotedTo = this.#demotedTo;
        if (demotedTo === null) {
          this.#retirementChoices();
          return;
        }
        this.#demotionOffers(demotedTo, () => this.#retirementChoices());
      }),
    );
  }

  /**
   * 下放遞約。
   *
   * 被送回二軍的那一刻，其他體系的邀請也到了——**這是旅外最真實的觸發時機**：
   * 在這裡待不下去，不代表在別處待不下去。與戰力外走同一條尋路，差別只在
   * 這裡可以選擇留下。
   */
  #demotionOffers(demotedTo: string, next: () => void): void {
    const pro = this.#pro;
    if (pro === null) {
      next();
      return;
    }
    // **只問「哪裡有一軍的位置」，不比水準高低。** 用 par 當下限會把澳職與中職
    // 濾掉——它們的 par 確實低於日職二軍，但「回台灣先發」與「在日本坐農場」
    // 對一段生涯是完全不同的兩件事，而後者正是玩家想避開的。
    const offers = fallbackOffers(this.world, {
      ...this.#transferContext,
      topLevelOnly: true,
    });
    // 年資夠的人可以行使拒絕權（ADR 0020）——一個沒有任何邀請的老將也該有這
    // 個選項，所以要在「沒有邀請」的早退之前先算。
    const org = levelOf(pro.level).org;
    const canRefuse =
      this.#demotedFrom !== null && canRefuseDemotion(org, this.#orgYears.get(org) ?? 0);
    if (offers.length === 0 && !canRefuse) {
      // 沒有別的邀請時仍要說一聲——不然下放會無聲發生。
      this.flow.card(
        'bad',
        '降級通知',
        `成績未達標，被送回 <b class="dn">${esc(demotedTo)}</b>。`,
      );
      next();
      return;
    }

    const options: Option[] = [
      { id: 'demote:accept', label: `接受下放，留在${demotedTo}`, role: 'main' },
      ...offers.map((o, i) => ({
        id: `demote:${i}`,
        label: `${o.orgName}　${o.team}（${o.levelName}）`,
        note: `${Game.#terms(o)}${o.homecoming ? '｜落葉歸根' : ''}`,
      })),
    ];
    if (canRefuse) {
      options.push({
        id: 'demote:refuse',
        label: '行使年資權利，拒絕下放',
        note: '球團可以直接釋出你——成績越差，風險越高',
        role: 'warn',
      });
    }

    this.flow.card(
      'bad',
      '降級通知',
      `成績未達標，球團打算把你送回 <b class="dn">${esc(demotedTo)}</b>${
        offers.length === 0 ? '。' : '——但消息一出，其他聯盟的邀請也到了。'
      }`,
    );
    this.flow.ask({ title: '接受下放，還是換個舞台？', options }, (choice) => {
      if (choice === 'demote:refuse') {
        this.#refuseDemotion(next);
        return;
      }
      const picked = offers[Number(choice.split(':')[1])];
      if (picked !== undefined) {
        this.#payBuyout('player');
        this.#moveTo(picked, picked.homecoming ? '落葉歸根' : '新的舞台');
      }
      next();
    });
  }

  /**
   * 行使拒絕下放的權利。
   *
   * 拒絕不是白拿的：球團不能送你去二軍，但可以不要你。**釋出機率就是下放判定
   * 那一個機率**——球團越想把你送下去，你越留不住。跟不上得越多，這個選項越
   * 像是逼球團在「忍受你」與「放掉你」之間選一個，而現實裡他們常選後者。
   */
  #refuseDemotion(next: () => void): void {
    const pro = this.#pro;
    const from = this.#demotedFrom;
    if (pro === null || from === null) {
      next();
      return;
    }
    this.#demotedTo = null;
    this.#demotedFrom = null;

    if (this.world.stream('career').chance(this.#demotePressure)) {
      // 被 DFA。與一般戰力外走同一條路：球團主動終止付全額，再問別的體系。
      this.flow.card(
        'bad',
        '讓渡名單',
        '你拒絕下放，球團也就不再為你留位置——當天你被放進讓渡名單。',
      );
      this.#payBuyout('club');
      this.flow.push(() => this.#fallback('拒絕下放後遭到釋出'));
      return;
    }

    pro.level = from;
    // 留在原本的層級就不是體系最底層了，寬限期歸零——結算時已經加過一次。
    pro.yearsAtBottom = pathOf(levelOf(from).org)[0] === from ? pro.yearsAtBottom : 0;
    this.flow.card(
      'gold',
      '留在一軍',
      `你行使了年資賦予的權利，球團收回下放通知——<b class="hl">${esc(levelOf(from).name)}</b>的位置還是你的。`,
    );
    next();
  }

  /** 引退的兩個選擇點。 */
  #retirementChoices(): void {
    // 被下放的老將可以選擇不接受。年輕人不給這個選項——他們還有再拚一次的
    // 餘地，讓他們在二十出頭就能一鍵結束生涯只會製造後悔。
    const cfg = seasonCfg.retirement;
    // 抽取一律先做，與年齡和下放與否都無關——否則同一個種子會在生日前後讓
    // 後面所有判定整串偏移。
    const bodyAsks = asksRetirement(this.world, this.#age);

    // 讀的是**現在**的狀態：中途換了體系的人已經不算被下放。
    const demotedTo = this.#demotedTo;
    if (demotedTo !== null && this.#age >= cfg.refuse_demotion_from_age) {
      this.#askRetire(
        `你被送回${demotedTo}。要接受下放，還是就此掛靴？`,
        '接受下放，從頭再來',
        `不願下放，${this.#year} 年宣布引退`,
      );
      return;
    }

    // 高齡的每季自主引退。這是玩家自己按下的那個鍵——與被系統告知「你老了」
    // 是兩種完全不同的情緒，而引退場景要承接的正是這個差別。
    //
    // 身體發出訊號的那一年換一種問法。**那條機率原本是直接結束生涯**，現在
    // 只改變語氣：它是一個很重的暗示，但按下去的仍然是玩家。年紀還不到自主
    // 引退時，也只有身體開口的那一年才會被問。
    if (bodyAsks || this.#age >= cfg.voluntary_from_age) {
      this.#askRetire(
        bodyAsks
          ? '身體開始抱怨了。再拚一年，還是在這裡畫下句點？'
          : `${this.#age} 歲了。再拚一年，還是在這裡畫下句點？`,
        '再拚一年',
        bodyAsks ? `${this.#year} 年宣布引退` : `功成身退，${this.#year} 年宣布引退`,
        bodyAsks,
      );
      return;
    }

    this.flow.push(() => this.#proYear());
  }

  /** 提前結束合約要付的錢。玩家自請離開付七成，球團主動終止付十成。 */
  #payBuyout(initiator: 'player' | 'club'): void {
    const pro = this.#pro;
    if (pro === null) return;
    const cost = buyoutCost({
      contract: pro.contract,
      seasonSalary: this.#seasonSalary,
      initiator,
    });
    if (cost <= 0) return;
    // 買斷是球團付給球員的——提前解約的人拿到剩餘合約的一部分。
    this.#earnings += cost;
    this.flow.card(
      'info',
      '合約買斷',
      `剩餘 ${pro.contract.years - 1} 年的合約以 <b class="hl">${fmtMoney(cost)}</b> 結清。`,
    );
  }

  /** 問玩家要不要就此引退。選擇本身會寫進重播日誌。 */
  #askRetire(question: string, stay: string, quit: string, bodyAsks = false): void {
    this.flow.ask(
      {
        title: question,
        options: [
          // 身體開口的那一年給不同的 id。玩家看不出差別，但校準腳本要分得出
          // 「他自己想退」與「身體叫他退」——舊版那條機率是強制的，基準線的
          // 代理要能重現同樣的生涯長度。
          { id: bodyAsks ? 'retire:push' : 'retire:stay', label: stay, role: 'main' },
          { id: 'retire:quit', label: quit, role: 'warn' },
        ],
      },
      (choice) => {
        if (choice === 'retire:quit') {
          // 自請提前結束合約，因此只拿七成。
          this.#payBuyout('player');
          this.flow.push(() => this.#retire(quit));
          return;
        }
        this.flow.push(() => this.#proYear());
      },
    );
  }

  /**
   * 引退：結算生涯。
   *
   * 順序是刻意的——先說「他走了」，再算他留下什麼，最後才是別人怎麼記得他。
   * 名人堂票選必須排在結算特性之前，因為首輪入選是「歷史級球星」的觸發條件。
   */
  #retire(reason: string): void {
    const pro = this.#pro;
    this.flow.divider(`${this.#year} 年 · ${this.#age} 歲 · 引退`);
    this.flow.card(
      'info',
      '引退',
      `${esc(reason)}。在<b class="hl">${esc(pro?.team ?? '')}</b>結束了 ${pro?.year ?? 0} 年的職業生涯。`,
    );
    this.#pro = null;
    this.#settle();
  }

  /**
   * 生涯在進入職業之前結束。
   *
   * 走**同一個出口**：生涯總結照樣呈現，只是沒有職業成績可算，名人堂整段跳過。
   * 選秀落選是一個相當常見的結局，尤其是玩得不好的第一局——讓玩家撞上一張
   * 「尚未實作」，體感是遊戲壞了。
   *
   * 大學與業餘成棒那條路還沒做，因此落選目前就是生涯結束，只是結束得早。
   */
  #careerOver(reason: string): void {
    this.flow.divider(`${this.#year} 年 · ${this.#age} 歲 · 生涯結束`);
    this.flow.card('info', '球員生涯結束', `${esc(reason)}。`);
    this.#settle();
  }

  /** 生涯總結：成績、評價、名人堂、特性、看板、第二人生。 */
  #settle(): void {
    const summary = summarizeCareer(
      this.#seasons,
      this.#awards,
      this.#counts.domesticTitles,
      this.#amateurSeasons,
      this.#intlScore,
    );
    this.#summary = summary;

    this.#careerTables(summary);
    this.#careerScores(summary);

    const ballots = summary.leagues.length > 0 ? runBallots(this.world, summary.leagues) : [];
    this.#retireScene(summary);
    this.#hallOfFame(ballots);
    this.#settlementTraits(summary, ballots);
    this.#achievementCard(summary, ballots);
    this.#fanBoard(summary);
    this.#secondLife();
  }

  /** 生涯成績表：養成期、各頂級聯盟、各非頂級層級，最後是兩份通算。 */
  #careerTables(summary: CareerSummary): void {
    const line = (batting: BattingLine | null, pitching: PitchingLine | null): string => {
      const parts: string[] = [];
      if (pitching !== null) {
        parts.push(
          `投手 ${pitching.games} 場・${fmtInnings(pitching.outs)} 局・` +
            `${pitching.wins} 勝 ${pitching.losses} 敗` +
            `${pitching.saves > 0 ? ` ${pitching.saves} 救援` : ''}・` +
            `防禦率 <b class="hl">${pitching.era.toFixed(2)}</b>・奪三振 ${pitching.so}`,
        );
      }
      if (batting !== null) {
        parts.push(
          `打者 ${batting.games} 場・${batting.hits} 安打・${batting.hr} 轟・` +
            `${batting.rbi} 打點・打擊率 <b class="hl">${fmtAvg(batting.avg)}</b>`,
        );
      }
      return parts.join('<br>');
    };

    for (const stage of amateur.stages.order) {
      const stats = this.#statsByStage[stage];
      if (stats === undefined) continue;
      const body = line(stats.batting, stats.pitching);
      if (body !== '') this.flow.card('info', `${stageOf(stage).name}通算`, body);
    }

    for (const league of summary.leagues) {
      const body = line(league.batting, league.pitching);
      if (body === '') continue;
      this.flow.card(
        'info',
        `${league.orgName}通算（${league.seasons} 季）`,
        `${body}${league.defenseRuns !== 0 ? `<br>守備 ${league.defenseRuns > 0 ? '+' : ''}${league.defenseRuns}` : ''}`,
      );
    }

    for (const minor of summary.minors) {
      const body = line(minor.batting, minor.pitching);
      if (body !== '') {
        this.flow.card('info', `${minor.levelName}通算（${minor.seasons} 季）`, body);
      }
    }

    // 兩份通算只有在真的分成好幾段時才有意義——單一聯盟的生涯，通算等於上面
    // 那張表，再印一次是噪音。
    if (summary.leagues.length > 1) {
      const body = line(summary.topTotal.batting, summary.topTotal.pitching);
      if (body !== '') this.flow.card('gold', '所有一軍通算', body);
    }
    if (summary.minors.length > 1) {
      const body = line(summary.minorTotal.batting, summary.minorTotal.pitching);
      if (body !== '') this.flow.card('info', '所有二軍通算', body);
    }
  }

  /** 生涯評價分：各聯盟一份，並攤開三個來源。 */
  #careerScores(summary: CareerSummary): void {
    if (summary.leagues.length === 0) return;

    const rows = summary.leagues.map((l) => {
      const detail =
        `份額 ${l.sharePoints.toFixed(1)}` +
        `${l.awardPoints > 0 ? `＋榮譽 ${l.awardPoints.toFixed(1)}` : ''}` +
        `${l.milestonePoints > 0 ? `＋里程碑 ${l.milestonePoints.toFixed(1)}` : ''}`;
      return (
        `<b class="hl">${esc(l.orgName)}${esc(l.tierLabel)}</b>` +
        `　評價分 <b class="hl">${Math.round(l.score)}</b>（${detail}）` +
        `<br><span class="sub">勝利份額 ${l.shares.win.toFixed(1)}／敗戰份額 ${l.shares.loss.toFixed(1)}` +
        `${l.milestones.length > 0 ? `　·　${esc(l.milestones.join('、'))}` : ''}</span>`
      );
    });

    // 總評價分要看得到。**生涯里程碑與國際賽都只加在這裡**，不進任何單一
    // 聯盟的評價分——不顯示的話那兩個系統的貢獻等於憑空消失。
    const extras: string[] = [];
    const milestonePoints = summary.totalScore
      - summary.leagues.reduce((sum, l) => sum + l.sharePoints + l.awardPoints, 0)
      - summary.internationalScore;
    if (milestonePoints > 0.05) extras.push(`生涯里程碑 ${milestonePoints.toFixed(1)}`);
    if (summary.internationalScore > 0) extras.push(`國際賽 ${summary.internationalScore.toFixed(0)}`);
    rows.push(
      `<b class="hl">總評價分 ${summary.totalScore.toFixed(1)}</b>` +
        (extras.length > 0
          ? `<br><span class="sub">各聯盟合計＋${extras.join('＋')}——這兩項不屬於任何聯盟，只進總分。</span>`
          : ''),
    );

    this.flow.card('gold', '生涯評價', rows.join('<br><br>'));

    this.flow.card(
      'info',
      '生涯收入',
      `簽約金與年薪合計 <b class="hl">${fmtMoney(this.#earnings)}</b>。` +
        `<br><span class="sub">錢不是這個遊戲的分數，但它是這段人生留下的另一種紀錄。</span>`,
    );

    if (summary.careerMilestones.length > 0) {
      this.flow.card(
        'gold',
        '生涯里程碑',
        `${esc(summary.careerMilestones.join('、'))}` +
          `<br><span class="sub">跨聯盟通算的成就，不計入單一聯盟的評價分。</span>`,
      );
    }

    this.#nationalCareerCard(summary);
  }

  /**
   * 國際賽的生涯。
   *
   * 獨立一張表——**它不屬於任何聯盟**，因此不混進聯盟通算，評價分也只進總分。
   */
  #nationalCareerCard(summary: CareerSummary): void {
    const caps = this.#counts.internationalCaps;
    if (caps === 0) return;

    const parts: string[] = [];
    if (this.#intlPitching !== null) {
      const p = this.#intlPitching;
      parts.push(
        `<b>投手</b>｜${p.games} 場・${fmtInnings(p.outs)} 局・${p.wins} 勝 ${p.losses} 敗` +
          `${p.saves > 0 ? ` ${p.saves} 救援` : ''}・防禦率 <b class="hl">${p.era.toFixed(2)}</b>` +
          `・奪三振 ${p.so}`,
      );
    }
    if (this.#intlBatting !== null) {
      const b = this.#intlBatting;
      parts.push(
        `<b>打者</b>｜${b.games} 場・${b.pa} 打席・打擊率 <b class="hl">${fmtAvg(b.avg)}</b>` +
          `・${b.hits} 安 ${b.hr} 轟 ${b.rbi} 打點`,
      );
    }
    parts.push(
      `<span class="sub">中華隊 ${caps} 屆` +
        `${this.#counts.internationalTitles > 0 ? `・冠軍 ${this.#counts.internationalTitles} 次` : ''}` +
        `　·　貢獻總評價分 ${summary.internationalScore.toFixed(0)}（不計入任何單一聯盟）</span>`,
    );

    this.flow.card('gold', '國際賽生涯', parts.join('<br>'));
  }

  /**
   * 引退之日。
   *
   * 場景依「代表聯盟＋生涯分級」選用，文案全在 flavor.json。沒打過頂級聯盟的
   * 人走 minor 那則——沒有鎂光燈的版本。
   */
  #retireScene(summary: CareerSummary): void {
    const org = summary.representative?.org ?? null;
    const tier = summary.bestTier;
    const scenes = flavor.retire_scenes;

    let text: string | null = null;
    const bucket = org === null ? undefined : scenes[org];
    if (typeof bucket === 'string') {
      text = bucket;
    } else if (bucket !== undefined) {
      const hit = bucket[String(tier)] ?? bucket['default'];
      if (typeof hit === 'string') {
        text = hit;
      } else if (hit !== undefined) {
        // 中職第三帶依投打分歧，因此那一格是物件。
        text = hit[this.#lockedSide === 'pitcher' ? 'P' : 'default'] ?? hit['default'] ?? null;
      }
    }
    if (text === null) {
      const fallback = scenes['minor'];
      text = typeof fallback === 'string' ? fallback : null;
    }
    if (text === null) return;

    const firstHit = this.#lockedSide === 'pitcher' ? '職棒初登板' : '職棒初安打';
    this.flow.card(
      'gold',
      '引退之日',
      text.replace(/\{n\}/g, esc(this.#player?.name ?? '')).replace(/\{first_hit\}/g, firstHit),
    );
  }

  /** 名人堂票選。可多聯盟並存——三個聯盟的名人堂是三件事。 */
  #hallOfFame(ballots: readonly BallotResult[]): void {
    if (ballots.length === 0) return;

    const lines = ballots.map((b) => {
      if (!b.inducted) {
        return (
          `你連續 ${b.ballotYear} 年入圍${esc(b.hallName)}票選，最高曾獲得 ` +
          `${b.percent.toFixed(1)}% 得票率，可惜始終未能跨過門檻。`
        );
      }
      return (
        `引退 <b class="hl">${b.waitYears}</b> 年後（${this.#year + b.waitYears} 年）進入候選，` +
        `於<b class="hl">第 ${b.ballotYear} 年投票</b>以 <b class="hl">${b.votes}</b> 票` +
        `（得票率 ${b.percent.toFixed(1)}%）榮登<b class="hl">${esc(b.hallName)}</b>。` +
        `名匾上的隊徽，是 <b class="hl">${esc(b.capTeam || '—')}</b>。` +
        `${b.firstBallot ? '<b class="hl">一票入魂，首輪即殿堂。</b>' : ''}`
      );
    });

    this.flow.card('gold', '名人堂票選', lines.join('<br><br>'));
  }

  /**
   * 只在結算時才判定得了的三個特性。
   *
   * 它們的觸發條件全部要等生涯結束才知道結果，離開這裡就沒有別的地方能判。
   */
  #settlementTraits(summary: CareerSummary, ballots: readonly BallotResult[]): void {
    const cfg = hallOfFame.settlement_traits;

    if (ballots.some((b) => b.firstBallot)) {
      this.#unlockTrait(
        cfg.legend.trait,
        '歷史級球星',
        '第一年投票就披上名人堂金袍——你不只是進了殿堂，你<b class="hl">定義了一個時代</b>。',
      );
    }

    // 以下兩個都要求「站上過頂級舞台」——在二軍打一輩子的人，那兩個故事都不成立。
    const reachedTop = summary.leagues.length > 0;
    if (!reachedTop) return;

    if (this.#schoolTier === cfg.small_school.school_tier) {
      this.#unlockTrait(
        cfg.small_school.trait,
        '國產凌凌漆',
        '當年那所沒沒無聞的小學校，走出了一個站上頂級舞台的男人。你證明了：出身，從來不是天花板。',
      );
    }

    const potential = Object.values(this.#player?.potential ?? {}).reduce((a, b) => a + b, 0);
    if (potential > 0 && potential <= cfg.grinder.provisional_sum) {
      this.#unlockTrait(
        cfg.grinder.trait,
        '包龍星',
        '天賦平庸的球員千千萬萬，能走到這裡的卻寥寥無幾。你不是天選之人，你是把汗水熬成天賦的那種人。',
      );
    }
  }

  /** 取得一個特性並跳卡。已經有了就不重複。 */
  #unlockTrait(id: string, name: string, text: string, tone: 'gold' | 'bad' = 'gold'): void {
    if (this.#traits.has(id)) return;
    this.#traits.add(id);
    this.flow.card(tone, `隱藏特性：${name}`, text);
  }

  /**
   * 成就結算。
   *
   * **成就是推導出來的**：每一個取得過的特性、每一座獎項、每一次前三名、每一階
   * 累積都自動成為一項成就，不必另外維護一份清單。
   *
   * **同一項成就只給一次 AP**——在中職打滿 500 安兩次不會拿兩次點數。AP 買到的
   * 天賦是永久啟用的，因此成就是一棵解鎖樹，不是每局重刷的獎金。跨局的已解鎖
   * 清單由 `CareerProgress` 帶進來；未登入時是空的，因此每一項都顯示成新解鎖。
   *
   * **這裡算出來的只是顯示用的。** 真正入帳的 AP 由伺服器重跑同一份日誌後認定，
   * 客戶端算的只拿去比對（見 ADR 0007）。
   */
  #achievementCard(summary: CareerSummary, ballots: readonly BallotResult[]): void {
    const result = evaluateAchievements({
      summary,
      awards: this.#awards,
      traits: this.#traits,
      honors: this.#honors,
      halls: ballots.filter((b) => b.inducted).map((b) => b.leagueName),
      // 未登入時是 NO_PROGRESS：每一局都是「第一段人生」、每一項都算新解鎖。
      firstCareer: this.#progress.firstCareer,
      unlocked: this.#progress.unlocked,
    });
    this.#achievements = result;
    if (result.list.length === 0) return;

    const byCategory = new Map<string, Achievement[]>();
    for (const a of result.list) {
      const list = byCategory.get(a.category);
      if (list === undefined) byCategory.set(a.category, [a]);
      else list.push(a);
    }

    const rows = [...byCategory.entries()].map(
      ([category, items]) =>
        `<b>${esc(category)}</b>　` +
        items.map((a) => `${esc(a.name)} <span class="sub">+${a.points}</span>`).join('、'),
    );

    this.flow.card(
      'gold',
      `成就結算 · ${result.points} AP`,
      `${rows.join('<br>')}` +
        `<br><span class="sub">成就點數可在下一段生涯開場的天賦商店消耗，買到的天賦永久啟用。` +
        `同一項成就只給一次點數。</span>`,
    );
  }

  /**
   * 球迷看板。
   *
   * 依生涯分級挑留言。這是唯一會**根據分級變臉**的區塊——玩家從留言的語氣就
   * 讀得出自己這輩子打得怎麼樣，那是結算的情緒收尾。
   */
  #fanBoard(summary: CareerSummary): void {
    const pool = flavor.fan_reactions[String(summary.bestTier)];
    if (pool === undefined || pool.length === 0) return;

    const rng = this.world.stream('career');
    const picks: string[] = [];
    const used = new Set<number>();
    const want = Math.min(3, pool.length);
    while (picks.length < want) {
      const i = rng.int(0, pool.length - 1);
      if (used.has(i)) continue;
      used.add(i);
      picks.push(pool[i] ?? '');
    }

    const name = this.#player?.name ?? '';
    this.flow.card(
      'info',
      '球迷看板・引退串',
      picks.map((p) => `「${esc(p.replace(/\{n\}/g, name))}」`).join('<br>'),
    );
  }

  /** 太早離開棒球的人，走向棒球之外的第二人生。 */
  #secondLife(): void {
    if (this.#age >= seasonCfg.retirement.second_life_max_age) return;
    const stories = flavor.second_life.stories;
    if (stories.length === 0) return;

    const name = this.#player?.name ?? '';
    const story = stories[this.world.stream('career').int(0, stories.length - 1)] ?? '';
    this.flow.card(
      'gold',
      '第二人生',
      `${esc(story.replace(/\{n\}/g, name))}<br><br>` +
        `<span class="sub">${esc(flavor.second_life.closing.replace(/\{n\}/g, name))}</span>`,
    );
  }

  /**
   * 發能力點，並當場排進配點關卡。
   *
   * **給點與配點必須綁在一起**。這兩件事原本分開寫，靠呼叫端記得配對，於是三個
   * 給點的地方漏了兩個：職業期的國際賽只加不減，點數永遠花不掉（介面上唯一能花
   * 掉點數的入口是配點提問本身）；養成期的國際賽排在大賽**之後**，點數要等隔年
   * 的大賽才花得到，違反下面那條「沒有先留著」。包成一個入口之後，漏排配點在結
   * 構上就不可能發生——沒有別的路徑能加到 `#pool`。
   *
   * 一律用 unshift：呼叫端都在某個年度步驟裡，而年度結束早就排在佇列上了，用
   * push 會讓配點跑到球季之後。
   */
  #grantPoints(points: number): void {
    if (points <= 0) return;
    this.#pool += points;
    this.#allocHistory = [];
    this.flow.unshift(
      () => this.#allocationPhase('pool'),
      () => this.#allocationConfirm('pool'),
    );
  }

  /**
   * 配點階段。
   *
   * 一次提問管到底：可以逐點分配、隨時復原上一步，全部分配完才能確認往下走。
   * 復原**本身也是一次選擇**，會寫進重播日誌——配點不消耗亂數，因此反向操作
   * 是精確的，日誌記下「加了什麼、又退了什麼」仍然完整重現同一段生涯。
   *
   * 沒有「先留著」：點數留到下一年會讓每一季的起點都不一樣，玩家得記住上一季
   * 剩多少，而畫面上並沒有地方講這件事。
   */
  #allocationPhase(source: 'dice' | 'pool'): void {
    // 骰子每顆的點數不同，大賽點數一律 1 點——統一成「剩下的每一份是幾點」
    // 的陣列，後面的計數與標題就不必再分兩套。
    const remaining: readonly number[] =
      source === 'dice' ? this.#remainingDice : Array.from({ length: this.#pool }, () => 1);
    // 分配完就交給確認關卡。**這裡不能清掉復原堆疊**——在確認畫面按復原，
    // 靠的正是這份紀錄。清空與收骰面都由確認那一步負責。
    if (remaining.length === 0) return;

    const value = remaining[0] ?? 1;
    const done = this.#allocHistory.length;
    const total = done + remaining.length;

    const options: Option[] = this.#allocatableAbilities.map((key) =>
      this.#abilityOption(key, value),
    );
    options.push({
      id: 'alloc:undo',
      label: '復原',
      note: done === 0 ? '還沒有可以復原的動作' : '退回上一次加點',
      role: 'warn',
      disabled: done === 0,
    });
    options.push({
      id: 'alloc:confirm',
      label: '確認',
      note: `還有 ${remaining.length} 點沒分配`,
      role: 'main',
      disabled: true,
    });

    const title =
      source === 'dice'
        ? `第 ${done + 1}／${total} 顆骰：${value} 點要加在哪？`
        : `大賽點數 ${done + 1}／${total}：1 點要加在哪？`;

    this.flow.ask({ title, options }, (choice) => {
      if (choice === 'alloc:undo') this.#undoAllocation();
      else this.#pushAllocation(choice.slice('alloc:'.length) as AbilityKey, value, source);
      this.flow.unshift(() => this.#allocationPhase(source));
    });
  }

  /** 分配完最後一點之後的確認關卡。到這裡才允許往下走。 */
  #allocationConfirm(source: 'dice' | 'pool'): void {
    if (this.#allocHistory.length === 0) {
      this.#dice = null;
      return;
    }
    this.flow.ask(
      {
        title: '點數分配完畢',
        options: [
          { id: 'alloc:undo', label: '復原', note: '退回上一次加點', role: 'warn' },
          { id: 'alloc:confirm', label: '確認', note: '結束配點，繼續往下', role: 'main' },
        ],
      },
      (choice) => {
        if (choice === 'alloc:confirm') {
          this.#allocHistory = [];
          this.#dice = null;
          return;
        }
        this.#undoAllocation();
        this.flow.unshift(() => this.#allocationPhase(source));
      },
    );
  }

  /** 這一輪還沒分配的點數。骰子是各自的點數，大賽點數一律 1 點。 */
  get #remainingDice(): readonly number[] {
    const dice = this.#dice;
    if (dice === null) return [];
    return dice.values.slice(dice.index);
  }

  /** 加一次點，並把「加之前的樣子」推進復原堆疊。 */
  #pushAllocation(key: AbilityKey, value: number, source: 'dice' | 'pool'): void {
    this.#allocHistory.push({
      key,
      value,
      source,
      ability: this.#ability[key] ?? 0,
      carry: this.#carry[key] ?? 0,
    });
    this.#applyPoints(key, value, { silent: true });
    if (source === 'dice' && this.#dice !== null) {
      this.#dice = { values: this.#dice.values, index: this.#dice.index + 1 };
    } else if (source === 'pool') {
      this.#pool--;
    }
  }

  /**
   * 退回上一次加點。
   *
   * 直接還原快照，不做反向計算——蓄力槽跨級數之後「減掉幾點」不是單純的減法，
   * 反推會在邊界上出錯。
   */
  #undoAllocation(): void {
    const last = this.#allocHistory.pop();
    if (last === undefined) return;
    this.#ability[last.key] = last.ability;
    this.#carry[last.key] = last.carry;
    if (last.source === 'dice' && this.#dice !== null) {
      this.#dice = { values: this.#dice.values, index: Math.max(0, this.#dice.index - 1) };
    } else if (last.source === 'pool') {
      this.#pool++;
    }
  }

  /**
   * 記下一項榮譽，重複的不再記第二次。
   *
   * 連三年拿下謝國城盃冠軍是一件事，不是三件——榮譽是「他做到過什麼」的清單，
   * 不是流水帳。同一個盃賽的冠軍與亞軍是不同的字串，因此仍然各記一筆。
   *
   * 次數本身有意義的地方（例如國際賽徵召次數）另外計數，不靠這份清單。
   */
  #addHonor(text: string): void {
    if (this.#honors.includes(text)) return;
    this.#honors.push(text);
  }

  /** 把一段成績累加到目前階段。各階段分開累計，介面才能分開呈現。 */
  #accumulate(batting: BattingLine | null, pitching: PitchingLine | null): void {
    // 職業以體系（CPBL / NPB / …）為鍵，不以層級。二軍與一軍屬於同一個聯盟，
    // 分開記會把一段生涯拆成兩半；用體系當鍵也讓「離開又回來」自然接續。
    const key = this.#pro === null ? this.#stage : levelOf(this.#pro.level).org;
    const current = this.#statsByStage[key] ?? { batting: null, pitching: null };
    this.#statsByStage[key] = {
      batting: addBatting(current.batting, batting),
      pitching: addPitching(current.pitching, pitching),
    };
  }

  /**
   * 目前生效的側別：畢業前看起始守位，畢業後看定位鎖定。
   *
   * 兩者其實是同一件事的兩個階段，因此收在一個地方。二刀流的 `#lockedSide` 是
   * null，而他的起始守位必定是 UTIL（也推導出 null），所以兩側始終都在。
   */
  get #activeSide(): 'pitcher' | 'fielder' | null {
    return this.#lockedSide ?? sideOfStartPosition(this.setup.startPosition);
  }

  /**
   * 目前還能加點的能力。
   *
   * 另一側的能力不出現在選項裡——留著只會讓玩家把點數倒進一個永遠用不到的
   * 地方。共用能力（體力）兩邊都留：投手要撐局數、野手要撐出賽數。
   */
  get #allocatableAbilities(): readonly AbilityKey[] {
    return ALL_ABILITIES.filter((key) => isSideVisible(key, this.#activeSide));
  }

  /** 這項能力目前的潛力天花板，含事件提升的部分。 */
  #ceilingOf(key: AbilityKey): number {
    const base = this.#player?.potential[key] ?? abilities.scale.max;
    // 三個來源：抽到的天賦、事件卡提升的那一項、天賦商店買到的全域加成。
    // 最後一項平常是 0，由設定覆蓋層寫入（見 ADR 0007）。
    return base + (this.#ceilingBonus[key] ?? 0) + abilities.talent_bonus.ceiling;
  }

  /** 把點數投進一項能力，並產生對應的敘事。 */
  #applyPoints(key: AbilityKey, points: number, options: { silent?: boolean } = {}): void {
    const before = this.#ability[key] ?? 0;
    const result = train(
      before,
      points,
      this.#ceilingOf(key),
      this.#carry[key] ?? 0,
      growthCurve(this.isTwoWay),
      this.#ceilingBonus[key] ?? 0,
    );
    this.#ability[key] = result.value;
    this.#carry[key] = result.carry;
    if (options.silent === true) return;

    const name = abilities.abilities[key] ?? key;
    if (result.gained > 0) {
      this.flow.card(
        'good',
        undefined,
        `<b class="hl">${esc(name)}</b> ${before} → <b class="hl">${result.value}</b>`,
      );
    } else {
      this.flow.card(
        'info',
        undefined,
        `<b class="hl">${esc(name)}</b> 還沒突破，${points} 點存進蓄力槽（目前 ${result.carry} 點）。`,
      );
    }
  }

  /**
   * 結算蓄力槽。
   *
   * 蓄力槽只在**加點的當下**結算，但那一級的成本會被三件事往下拉：年齡衰退
   * 讓能力值降下來、事件提升天花板、取得二刀流換到較便宜的成長曲線。這三件
   * 事發生之後，原本存著的點數可能已經足夠升一級，卻沒有人去花它——畫面於是
   * 顯示「2/2」卻不進位，看起來像壞掉。
   *
   * 因此凡是會改變成本的地方，事後都要把槽清一次。
   */
  #settleCarry(): void {
    for (const key of Object.keys(this.#carry)) {
      if ((this.#carry[key] ?? 0) <= 0) continue;
      this.#applyPoints(key, 0, { silent: true });
    }
  }

  /** 產生一個能力的分配選項，附上目前值、天花板與這一級的成本。 */
  #abilityOption(key: AbilityKey, value: number): Option {
    const current = this.#ability[key] ?? 0;
    const ceiling = this.#ceilingOf(key);
    const carry = this.#carry[key] ?? 0;
    const result = train(
      current,
      value,
      ceiling,
      carry,
      growthCurve(this.isTwoWay),
      this.#ceilingBonus[key] ?? 0,
    );

    const name = abilities.abilities[key] ?? key;
    const note =
      result.gained > 0
        ? `${current} → ${result.value}（上限 ${ceiling}）`
        : `${current}／上限 ${ceiling}・蓄力 ${carry} → ${result.carry}`;

    return { id: `alloc:${key}`, label: name, note };
  }

}

/** 打擊率的棒球慣例寫法：去掉個位數的 0，例如 .333。 */
export function fmtAvg(avg: number): string {
  return avg.toFixed(3).replace(/^0/, '');
}

function handLabel(hand: string): string {
  return hand === 'S' ? '雙' : hand === 'L' ? '左' : '右';
}
