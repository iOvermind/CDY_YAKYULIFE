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
  awards as awardsCfg,
  flavor,
  hallOfFame,
  leagues,
  amateur as amateurCfg,
  injury as injuryCfg,
  love as loveCfg,
  season as seasonCfg,
  PITCH_FAMILIES,
  traitName,
  traitOf,
  type AbilityKey,
  type EnduranceTier,
  type Hand,
  type SchoolStage,
} from '../data/index.ts';
import { fmtAvg } from './format.ts';
import { ENGINE_VERSION } from './version.ts';
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
  amateurRole,
  playAmateurStats,
  type BattingLine,
  type PitchingLine,
} from './amateurStats.ts';
import { canRejectOffer, qualifiesAsTwoWay, runDraft, TWO_WAY_TRAIT } from './draft.ts';
import {
  cardsPerYear,
  drawEvent,
  BOLD_FAILS_FOR_CANCER,
  BOLD_WINS_FOR_CLUTCH,
  DISTRACT,
  EVENT_STREAK_FOR_THIEF,
  EVENT_TRAIT_KEYS,
  resolveEvent,
  successChances,
  type EventContext,
  type EventMode,
  type GameEvent,
} from './events.ts';
import { annualAwards, type AwardRecord } from './awards.ts';
import {
  assignPosition,
  defenseMarkAt,
  fieldingResponsibility,
  positionAverage,
  positionLabel,
  spectrumOf,
  DH,
  type PositionResult,
} from './defense.ts';
import type { AmateurSeasonRecord, InternationalRecord } from './career.ts';
import {
  buyoutCost,
  clubOption,
  isFreeAgentEligible,
  offersExtension,
  rookieContract,
  termOptions,
  type Contract,
} from './contract.ts';
import {
  difficultyOf,
  signatureRoles,
  eventLedger,
  summarizeCareer,
  warOf,
  type CareerSummary,
  type SeasonRecord,
  type WarByPart,
} from './career.ts';
import { runBallots, type BallotResult } from './hall.ts';
import { ladderRows, type LadderRow } from './ladder.ts';
import {
  evaluateAchievements,
  type Achievement,
  type AchievementResult,
} from './achievements.ts';
import {
  amateurBaseline,
  amateurBaselineAt,
  baselineAt,
  battingShares,
  fieldingReplacementWinPct,
  fieldingShares,
  lossPenalty,
  pitchingShares,
  eraPlus,
  opsPlus,
  proBaseline,
  sumShares,
  winPct,
  type Shares,
} from './metrics.ts';
import { esc, Flow, type Option, type Prompt } from './flow.ts';
import { joinName } from './naming.ts';
import { displayName } from './playerName.ts';
import { applyTalents, type TalentLevels } from './overlay.ts';
import {
  advanceStandards,
  initStandards,
  leagueStandardOf,
  standardsNote,
  type LeagueStandards,
} from './league.ts';
import { assignSchool, createPlayer, START_SEASON, type NewPlayer } from './genesis.ts';
import {
  discountedPotential,
  handednessTier,
  SWITCH_PITCHER_TRAIT,
  type HandednessTier,
} from './handedness.ts';
import {
  abilityCost,
  carryGauge,
  championshipDice,
  growthCurve,
  hardCap,
  raiseCeiling,
  rollOneDie,
  rollTrainingDice,
  train,
  untrain,
} from './growth.ts';
import {
  agedInjuryLoss,
  concealFailChance,
  injuryChance,
  injuryChanceBeforeTalent,
  oldInjuryFactor,
  rollInjury,
  unlocksGlass,
  type Injury,
  type InjuryChanceOptions,
} from './injury.ts';
import {
  adjust as adjustEndurance,
  afterSurgery,
  declineAmount,
  declineKeys,
  fielderWear,
  pitcherWear,
  RECOVERY,
  rollEndurance,
  settleSeason,
  sevenFistsRisk,
  tierName,
  tierOf,
  tierRank,
  TJ_COUNTDOWN_PERCENT,
  wearCoefficient,
  type EndurancePool,
} from './endurance.ts';
import {
  isConscripted,
  isEligible,
  isHonorRank,
  isPodium,
  lockYearsLeft,
  playTournament,
  tournamentGames,
  tournamentInnings,
  tournamentOf,
  nationalTeamWinPct,
  tournamentPar,
  tournamentScore,
  winsMvp,
  unlocksAce,
  unlocksTaiwan,
  type Tournament,
} from './national.ts';
import {
  injuryRiskModifier,
  newLoveState,
  rehabChance,
  rewardMultiplier,
  totalKids,
  type LoveState,
} from './love.ts';
import {
  loveCheckpoint,
  loveOverseas,
  loveYear,
  partnerProfile,
  type LoveAsk,
  type LoveEffect,
  type LoveFlow,
  type LoveTell,
} from './loveYear.ts';
import {
  applyAging,
  asksRetirement,
  evaluateMovement,
  pathOf,
  proDiceCount,
  refusalReleaseChance,
  shouldRetire,
} from './pro.ts';
import { contractSalary, fmtMoney, postingFee, salaryFor } from './salary.ts';
import {
  amateurOverseasOffers,
  canRequestPosting,
  overseasBidChance,
  canRefuseDemotion,
  domesticFaOffers,
  curateOffers,
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
  isStarterRole,
  levelOf,
  playSeason,
  pitcherRole,
  bullpenRole,
  positionName,
  roleRank,
  proBattingLine,
  proPitchingLine,
  ROLE_NAMES,
  type PitcherRole,
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
  pickChampion,
  championshipBoost,
  playerEffect,
  teamNick,
  type LeagueTable,
} from './teams.ts';
import {
  benchmarkLevelOf,
  blockedByHand,
  defenseMark,
  defenseScore,
  homeBenchmarkLevel,
  isSideVisible,
  rate,
  ratingPosition,
  sideOfStartPosition,
  sideOveralls,
  UTIL,
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
   * **它必須在 setup 裡，因為它改變模擬結果。** 天賦動的是潛力、衰老、受傷
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

/**
 * 一段走完的生涯換算出來的東西：成就、AP，以及天梯要的每一列。
 *
 * **它是結算的唯一產物。** 伺服器把它整份寫進資料庫（成就、AP、`career_stats`
 * 的每一列與當下的引擎版本），客戶端只用其中的成就去畫那張結算卡。
 */
export interface CareerScore {
  readonly summary: CareerSummary;
  readonly achievements: AchievementResult;
  /** 天梯的原料：各聯盟、生涯通算、各守位的生涯與單季。 */
  readonly ladder: readonly LadderRow[];
  /** 榜上要寫得出這是誰。 */
  readonly playerName: string;
  /** 結算當下的引擎版本。榜單是歷史，每一列帶著它（ADR 0002）。 */
  readonly engineVersion: number;
}

/**
 * 感情線解鎖特性時要講的那段話。
 *
 * **規則那邊只說解鎖哪一個 id**，措辭在這裡（ADR 0025、0050）。
 */
const LOVE_TRAIT_TEXT: Readonly<Record<string, string>> = {
  [loveCfg.childhood_sweetheart.trait]:
    '十五歲那年放學後的河堤，一路走到了主場的本壘板。中間有幾次差點走散，但你們都熬過來了。',
  [loveCfg.dating.confidante.trait]:
    '第三段戀情，還是走到了同樣的結局。「我愛上了你，你卻只把我當好姊妹。」——有些人註定是別人生命裡的過客。',
  [loveCfg.affair.caught.scum.trait]:
    `第二次被逮個正著。從今以後你在球迷心中的形象定型了——<b class="dn">每次被抓到，全能力 −${loveCfg.affair.caught.scum.all_ability_loss}</b>。`,
  [loveCfg.threesome.harem.trait]:
    '她看了那個人很久，最後說：「與其你偷偷摸摸，不如三個人坐下來把話講清楚。」',
  [loveCfg.threesome.cuckold.trait]:
    '你聽見自己說出那句話的時候，比她更驚訝。房子還是那間房子，只是從此多了一雙鞋。',
};

/** 風波那五張卡的敘事。文案住在 `love.json`，這裡只負責取。 */
function turmoilText(kindId: string): string {
  return loveCfg.turmoil.kinds.find((k) => k.id === kindId)?.text ?? '';
}

/** 沒有帳號時的進度：每一局都是第一段人生，每一項都算新解鎖。 */
export const NO_PROGRESS: CareerProgress = { firstCareer: true, unlocked: new Set<string>() };


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
  /** 依生涯內容組出來的特性名稱，鍵為特性 id。其餘特性的名字在 traits.json。 */
  readonly traitNames: ReadonlyMap<string, string>;
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
    /** 第二位對象。只有三人行（鹿鼎公）有，其餘一律 null。 */
    readonly partner2: string | null;
    /** 三人行的形狀：none／harem（鹿鼎公）／cuckold（縮頭烏龜）。 */
    readonly open: string;
    readonly marriedYear: number | null;
    readonly kids: number;
    readonly divorces: number;
    readonly caught: number;
    /**
     * 這一生結過婚的對象，依結婚先後排列且去重。
     *
     * 與 partner 分工：那個是**現在**在身邊的人，這份是走過紅毯的全部。離婚再娶
     * 的人兩個名字都在裡面——成就要數的是不同的對象（見 achievements.ts）。
     */
    readonly spouses: readonly string[];
  };
  /** 生涯累積收入，單位萬元。含簽約金與逐季年薪。 */
  readonly earnings: number;
  /** 尚未分配的能力點。 */
  readonly pool: number;
  /** 各項能力被提升的上限點數。 */
  readonly ceilingBonus: Readonly<Record<AbilityKey, number>>;
  /**
   * 各項能力目前的潛力天花板，已含天賦加成與事件提升。
   *
   * **畫面要顯示天花板就讀這裡，不要自己拼。** 抽到的潛力、天賦加成、事件提升
   * 三者的合成規則（誰只在量表內移動、誰能頂過 80）只有引擎知道，前端重算一次
   * 就會跟收錢的那條公式分岔——玩家回報 #56 就是這樣來的。
   */
  readonly ceiling: Readonly<Record<AbilityKey, number>>;
  /** 本季累積的受傷機率增幅。 */
  readonly injuryRisk: number;
  /** 當年成績。尚未打完大賽時為 null。 */
  /**
   * 目前的**登錄守位**代碼。養成期、二軍與一軍都是同一份登錄（ADR 0037）。
   * 純投手為 null。
   */
  readonly position: string | null;
  /** 守位的中文名。 */
  readonly positionName: string | null;
  /**
   * 特性的即時註記：點開特性時接在說明後面。現在只有七傷拳——它累加的受傷機率
   * 每一季都在變，寫死在說明裡的數字會過期。
   */
  readonly traitNotes: ReadonlyMap<string, string>;
  /**
   * 身體狀態（ADR 0051）：耐力的狀態字，**不給數字**。只列他用得到的那一池——純投手
   * 沒有野手那一格，純野手沒有投手那一格。職業期之前是 null。
   */
  readonly endurance: {
    readonly fielder: string | null;
    readonly pitcher: string | null;
    /** 七傷拳還掛在身上。 */
    readonly sevenFists: boolean;
  } | null;
  /**
   * 現在的投手定位（SP／CP／SU／MR／LR）。
   *
   * **職業期是登錄值、養成期是現算值。** 兩者的來源不同是刻意的：職業有定位
   * 會議，那是一個玩家答應過的登錄；養成期沒有，位置就是體力與球威當下的樣子。
   */
  readonly pitcherRole: PitcherRole | null;
  /** 這一季走不走野手側。純投手為 false，他們的守位欄只是打席的落點。 */
  readonly playsField: boolean;
  readonly seasonBatting: BattingLine | null;
  readonly seasonPitching: PitchingLine | null;
  /** 這一季的守備分。守備沒有別的欄位，因此它掛在野手那張表上。 */
  readonly seasonDefenseRuns: number;
  /** 這一季的三本帳。還沒結算過就是 null。 */
  readonly seasonShares: SeasonRecord['shares'] | null;
  /** 最近一季的 WAR，與 `seasonShares` 同一季。沒有就是 null。 */
  readonly seasonWar: WarByPart | null;
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
  /**
   * 掛靴的地方：引退時所屬的球隊與層級。沒進過職業，或還沒引退時為 null。
   *
   * 引退會把 `pro` 收掉——他確實不再屬於任何球團——但介面上的「所屬單位」不能
   * 因此退回 `school`，那會讓一個打了二十年的老將在生涯落幕的那一刻變回高中生。
   */
  readonly retiredFrom: { readonly team: string; readonly levelName: string } | null;
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
  #seasonShares: SeasonRecord['shares'] | null = null;
  /** 最近一季的 WAR，與 `#seasonShares` 同一季、同時更新。 */
  #seasonWar: WarByPart | null = null;
  /** 這一季的出賽係數。傷病落在這裡：1 為全勤、0 為整季報銷。 */
  #seasonFactor = 1;
  /** 全力一搏累計成功的次數。〈今晚打老虎〉看它。 */
  #boldWins = 0;
  /** 養成期累計擲出的 6。〈高手高手高高手〉看它。 */
  #amateurSixes = 0;
  /** 事件卡連續抽到壞結果的次數。〈何金銀〉看它。 */
  #eventFailStreak = 0;
  /** 全力一搏累計失敗的次數。〈烏鴉〉看它。 */
  #boldFails = 0;
  /** 事件卡代言（好結果帶代言收入）的次數。〈外務纏身〉看它。 */
  #endorsements = 0;
  /** 〈善良之槍〉是在哪一隊拿到的；換了隊就解除。 */
  #onetoolTeam: string | null = null;
  /** 〈烏鴉〉是在哪一隊拿到的；換了隊就解除。養成期拿到的在進職業時補記。 */
  #cancerTeam: string | null = null;
  #cancerEver = false;
  /** 有〈帕瓦諾〉之後連續沒受傷的季數。〈浴火鳳凰〉看它。 */
  #glassHealthy = 0;
  /** 帕瓦諾、善良之槍拿掉之後，成就照樣算——跟七傷拳同一個處理。 */
  #glassEver = false;
  #onetoolEver = false;
  #yipsEver = false;
  /** 〈十里坡劍神〉：頂級聯盟、有出賽的季末綜合能力，連續的那一段。斷掉就清空。 */
  #lateBloomRun: number[] = [];
  /** 〈十里坡劍神〉加在抽到的潛力上的點數，量表內（最多到 80）。 */
  #potentialBonus: Record<string, number> = {};
  /** 走上的第二人生（故事的 title），成就看它。沒走到是 null。 */
  #secondLifeTitle: string | null = null;
  /**
   * 這一季的傷勢種類，寫進當年的 SeasonRecord。
   *
   * 與 `#seasonFactor` 分開存：出賽係數是**打了多少**，這個是**為什麼**。
   * 小傷有時候只扣一點點，係數看起來跟健康年沒兩樣，但那一年他確實是帶傷的。
   */
  #seasonInjury: 'minor' | 'major' | 'rehab' | null = null;
  /**
   * 生涯蹲過幾季捕手：職業球季登錄捕手就算，整季復健不算（他沒蹲）。改守別的
   * 位置之後，打擊時的速度照這個數字打折（issue #8，見 `catcherSpeedFactor`）。
   */
  #catcherSeasons = 0;
  /** 生涯大傷次數。帕瓦諾的解鎖條件與合約年限都看它。 */
  #majorInjuries = 0;
  /** 這一季被禁賽的場數（事件卡）。在球季開打時從出賽係數裡扣掉，用完歸零。 */
  #suspendedGames = 0;
  /** 被聯盟永久逐出（事件卡「組頭接觸」）。生涯當場結束、不進名人堂票選。 */
  #banned = false;
  /** 耐力：野手與投手兩池（ADR 0051）。開局就擲，之後只在職業球季被消耗。 */
  #endurance: { fielder: EndurancePool; pitcher: EndurancePool } | null = null;
  /** 七傷拳撐了幾季。0 是沒有；開了 TJ 就歸零。 */
  #sevenFists = 0;
  /** 生涯掛過七傷拳。開完 TJ 狀態會拿掉，但成就照算——那一段是真的撐過來的。 */
  #sevenFistsEver = false;
  /**
   * 舊傷：隱瞞傷勢成功時記一筆，能力 → 被抽中的次數。比賽中那項能力乘
   * `oldInjuryFactor(次數)`（見 `#seasonAbility`），綜合評價不受影響。下一次大傷
   * 時全部清除。
   */
  #oldInjury: Partial<Record<AbilityKey, number>> = {};
  #oldInjuryEver = false;
  /** 生涯開過幾次 TJ。合約年限看它。 */
  #tjSurgeries = 0;
  /** 這一季是 TJ 的復健季：季末把投手耐力回到上限的八成。 */
  #tjRehab = false;
  /** 上一次守位會議看到的野手耐力狀態。掉一階問一次要不要退守；同階與回升不問。 */
  #fielderTierSeen: EnduranceTier = 'full';
  /**
   * 因為耐力自己退下來的守位。**同一支球隊**要等身體養回充沛，教練團才會再把他推回
   * 更吃重的位置——那是他自己選的，不是守備掉下來。換了球隊就不算數。
   */
  #enduranceCap: { readonly position: string; readonly team: string } | null = null;
  /** 大傷永久拿走的訓練骰顆數（issue #11）。職業期的基礎骰數扣掉它，最低 1 顆。 */
  #diceLost = 0;
  /** 明年是否整季報廢。大傷後醫生搖頭的那個結果。 */
  #rehabYear = false;
  /** 感情狀態。 */
  #love: LoveState = newLoveState();
  /** 第一次被徵召的年份。列管期從這裡算。 */
  #intlLockedSince: number | null = null;
  /** 打進國際賽冠亞軍的次數。東亞功夫的解鎖條件看它。 */
  #intlPodiums = 0;
  /** 國際賽累積的總評價分。與生涯里程碑同一個桶。 */
  #intlScore = 0;
  /** 這一局的成就結算。引退後才有值。 */
  #achievements: AchievementResult | null = null;
  /** 名人堂票選的結果。跑一次就存著——它會消耗抽取，不能跑第二次。 */
  #ballots: readonly BallotResult[] = [];
  /** 還原天賦覆蓋的函式。見 constructor 與 dispose()。 */
  #revertTalents: () => void = () => {};
  /** 開局擲出的〈不老妖精〉延後年數與〈棒球公務員〉的年齡上限加成。沒買是 0。 */
  #peakDelay = 0;
  #maxAgeBonus = 0;
  /** 國際賽的生涯成績。與聯盟成績分開——它不屬於任何聯盟。 */
  #intlBatting: BattingLine | null = null;
  #intlPitching: PitchingLine | null = null;
  /**
   * 職業期國際賽的逐屆紀錄。
   *
   * 生涯合計那兩條線回答「他這輩子替中華隊打成什麼樣」，這一份回答「哪一年、
   * 哪一項賽事、打了什麼」——ADR 0031 把年份從榮譽字串裡拿掉之後，那個問題
   * 沒有別的地方留得住。養成期的國際賽併在該年的養成列裡，不進這一份。
   */
  #intlSeasons: InternationalRecord[] = [];
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
  } | null = null;
  /**
   * 登錄守位。**養成期第一年就登錄，三個階段共用同一份**（ADR 0037）。
   *
   * 首次登錄是玩家選的起始守位，不掃描也不覆蓋——UTIL 例外，他沒有本位，
   * 兩條光譜都掃並發卡告知。純投手為 null，他們走投手定位那條線。
   */
  #position: string | null = null;
  /**
   * 在**目前這個登錄守位上**被拒絕過的升防目標。
   *
   * 守位一有變動就整組清空：記住的是「我在這個位置上做過的決定」，不是
   * 「我這輩子拒絕過什麼」——離開了那個位置，當初拒絕的理由也就不在了。
   */
  #declinedPromotions = new Set<string>();
  /** 已登錄的投手定位。與守位同一個立場：它只在定位會議上改變，不每季重算。 */
  #pitcherRole: PitcherRole | null = null;
  /** 在哪些定位上拒絕過升遷。與守位的拒絕記憶同一套規則。 */
  #declinedRoles = new Set<PitcherRole>();
  /** 掛靴的地方。見 PlayerState.retiredFrom。 */
  #retiredFrom: { team: string; levelName: string } | null = null;
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
   * 已解析的特性顯示名稱。
   *
   * 只有 `dynamic_name` 的三個需要——它們的名字裡有聯盟或球隊，取得的當下
   * 是什麼就永遠是什麼。後來轉隊了，「猛瑪先生」也還是猛瑪先生。
   */
  #traitNames = new Map<string, string>();
  /**
   * 逐隊年資與它所屬的體系。
   *
   * `#orgYears` 記的是體系（中職／日職），這裡記的是**球隊**——「同一支球隊
   * 十五年」與「同一聯盟待過幾支球隊」都要這個顆粒度。二軍的年份照算：在同一
   * 個組織熬十五年就是熬了十五年，不因為其中幾年在二軍就不算。
   */
  #teamYears = new Map<string, { readonly org: string; years: number }>();
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
   * 下放的實際理由，原封不動來自 `evaluateMovement`。
   *
   * 卡片一律報這一句，不要在展示層另外編一個說法——玩家看到的理由和引擎判定的
   * 依據必須是同一件事，否則他無從對帳（ADR 0029）。
   */
  #demoteReason = '';
  /**
   * 生涯累積收入，單位萬元。
   *
   * 含簽約金與逐季年薪。它是玩家會在意的數字，也是將來天梯的排序依據之一
   * （ROADMAP 的「神獸殿堂」）。
   */
  #earnings = 0;
  /**
   * 簽下之後、還沒打出第一季的簽約金（萬元）。
   *
   * 簽約金在簽約的當下入帳（`#earnings`），但它要記在**下一段紀錄**上：那是新東家
   * 付的錢，該算進新東家的聯盟，而新東家的第一季要等到明年才打。
   */
  #pendingBonus = 0;
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
    const revertOverlay = applyTalents(setup.talents ?? {});
    // 〈不老妖精〉〈棒球公務員〉是機率型的：開局擲一次，擲到的年數整局有效。直接
    // 加在規則資料上，讀 peak_end／max_age 的每一處都自動吃到；還原跟著天賦覆蓋一起。
    // 沒買就不擲，沒買天賦的生涯逐格不變。
    const aging = seasonCfg.aging as { peak_end: number };
    const retirement = seasonCfg.retirement as { max_age: number };
    const before = { peakEnd: aging.peak_end, maxAge: retirement.max_age };
    const roll = (max: number) => (max > 0 ? this.world.stream('career').int(1, Math.round(max)) : 0);
    this.#peakDelay = roll(seasonCfg.aging.peak_delay_max);
    this.#maxAgeBonus = roll(seasonCfg.retirement.max_age_bonus_max);
    aging.peak_end += this.#peakDelay;
    retirement.max_age += this.#maxAgeBonus;
    this.#revertTalents = () => {
      aging.peak_end = before.peakEnd;
      retirement.max_age = before.maxAge;
      revertOverlay();
    };
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

  /**
   * 結算一段走完的生涯：成就、AP 與天梯要的每一列。
   *
   * **這是「一段生涯值多少」唯一的配方。** 客戶端引退時走它，伺服器重跑驗證時
   * 也走它（見 ADR 0049）——那九個欄位的組裝因此只存在一處。從前兩邊各抄一份，
   * 而伺服器拿不到私有欄位，只能用 `state?.awards ?? []` 這種退路補洞：`state`
   * 是 null 時它不會失敗，會靜靜算出另一組看起來很合理的成就。
   *
   * `progress` 是**跨局**的進度（第幾段人生、已經解鎖過哪些成就），只有伺服器
   * 手上有真的那一份；客戶端用開局時給的那份，沒有帳號時是 `NO_PROGRESS`。
   *
   * 還沒走到結算就回 null——那不是錯誤，是「這一局還沒有結論」。
   */
  score(progress: CareerProgress = this.#progress): CareerScore | null {
    const summary = this.#summary;
    if (summary === null) return null;
    return {
      summary,
      achievements: evaluateAchievements({
        summary,
        awards: this.#awards,
        // 七傷拳開完刀就拿掉了，但撐過的那幾季照樣算一項成就。
        // 七傷拳、帕瓦諾、善良之槍、巧克力拿掉之後，撐過的那段照樣算一項成就。
        traits: new Set([
          ...this.#traits,
          ...(this.#sevenFistsEver ? ['seven_fists'] : []),
          ...(this.#oldInjuryEver ? [injuryCfg.conceal.trait] : []),
          ...(this.#glassEver ? ['glass'] : []),
          ...(this.#onetoolEver ? ['onetool'] : []),
          ...(this.#cancerEver ? ['cancer'] : []),
          ...(this.#yipsEver ? ['yips'] : []),
        ]),
        traitNames: this.#traitNames,
        honors: this.#honors,
        halls: this.#ballots.filter((b) => b.inducted).map((b) => b.leagueName),
        firstCareer: progress.firstCareer,
        spouses: this.#love.spouses,
        secondLife: this.#secondLifeTitle,
        unlocked: progress.unlocked,
      }),
      // 跨聯盟跨守位那一列的薪水是生涯淨收入——扣掉離婚分走的與旅外安家費。
      ladder: ladderRows(summary, this.#earnings),
      playerName: this.#player?.name ?? '',
      engineVersion: ENGINE_VERSION,
    };
  }

  /** 目前的球員狀態。流程開始前為 null。 */
  get state(): PlayerState | null {
    if (this.#player === null) return null;
    // 引退之後姓名旁的標籤寫**代表守位**：頂級聯盟守過最多季的那一個（issue #25）。
    // 生涯還在走的時候寫現在的登錄——那才是玩家做決定時要看的。
    const current = {
      position: this.#fieldPosition,
      pitcherRole: this.#pro === null ? amateurRole(this.#stage, this.#ability) : this.#pitcherRole,
    };
    const career = this.#retiredFrom === null ? null : signatureRoles(this.#seasons);
    const signature = {
      position: career?.position ?? current.position,
      pitcherRole: career?.pitcherRole ?? current.pitcherRole,
    };
    return {
      origin: this.#player,
      ability: this.#ability,
      carry: this.#carry,
      traits: this.#traits,
      traitNames: this.#traitNames,
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
        partner2: this.#love.partner2,
        open: this.#love.open,
        marriedYear: this.#love.marriedYear,
        kids: totalKids(this.#love),
        divorces: this.#love.divorces,
        caught: this.#love.caught,
        spouses: this.#love.spouses,
      },
      earnings: this.#earnings,
      pool: this.#pool,
      ceilingBonus: this.#ceilingBonus,
      ceiling: Object.fromEntries(
        ALL_ABILITIES.map((key) => [key, this.#ceilingOf(key)]),
      ) as Record<AbilityKey, number>,
      injuryRisk: this.#injuryRisk,
      position: signature.position,
      positionName: signature.position === null ? null : positionLabel(signature.position),
      traitNotes: new Map([
        ...(this.#sevenFists > 0
          ? [['seven_fists', `目前額外受傷機率 +${pct(sevenFistsRisk(this.#sevenFists, this.#traits.has('rubber')))}%`] as const]
          : []),
        ...(this.#traits.has(injuryCfg.conceal.trait)
          ? [[injuryCfg.conceal.trait, this.#oldInjuryNote()] as const]
          : []),
      ]),
      endurance:
        this.#endurance === null || this.#pro === null
          ? null
          : {
              fielder: this.#playsField ? tierName(tierOf(this.#endurance.fielder)) : null,
              pitcher: this.#pitches ? tierName(tierOf(this.#endurance.pitcher)) : null,
              sevenFists: this.#sevenFists > 0,
            },
      // 職業期是**已登錄的**定位，不是現算的。與守位同一個立場：它在定位會議
      // 上決定，之後整季不變——現算會讓玩家拒絕過的升遷在畫面上偷偷生效。
      //
      // 養成期沒有定位會議，因此是**現算的**：學生球隊的位置不是誰宣告的，是
      // 體力與球威當下的樣子（見 amateurRole）。點下體力越過該階段的 par，
      // 記分板上的標籤當場從牛棚跳進輪值——那個即時回饋正是玩家需要的資訊。
      pitcherRole: signature.pitcherRole,
      playsField: this.#playsField,
      seasonBatting: this.#seasonBatting,
      seasonDefenseRuns: this.#seasonDefenseRuns,
      seasonShares: this.#seasonShares,
      seasonWar: this.#seasonWar,
      seasonPitching: this.#seasonPitching,
      statsByStage: this.#statsByStage,
      pro: this.#proState,
      lockedSide: this.#lockedSide,
      visibleSide: this.#activeSide,
      retiredFrom: this.#retiredFrom,
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
      championshipOdds:
        this.#league === null
          ? 0
          : championshipOdds(this.#league, pro.team, championshipBoost(pro.team, this.#traits)),
      position: this.#position,
      positionName: this.#position === null ? null : positionLabel(this.#position),
      defenseRuns: this.#defenseRuns[pro.level] ?? 0,
      par: leagueStandardOf(this.#standards, pro.level).par,
      min: leagueStandardOf(this.#standards, pro.level).min,
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
   * 這一季的年薪：層級薪資表 × 合約的年薪係數 × 特性。
   *
   * d 值用**當年**的 par 算——聯盟水準逐年浮動，用基準值會讓弱年的薪水虛高。
   *
   * **合約係數以前只印在談約選項上，實際年薪沒乘它**（2026-09-25 修正）：長約與短約
   * 在錢上沒有差別，重案組之虎的保底、烏鴉的上限、否決交易的折扣也全都沒有作用。
   */
  get #seasonSalary(): number {
    const pro = this.#pro;
    if (pro === null) return 0;
    return contractSalary(pro.level, this.#baseSalary, this.#salaryMultiplier(pro.contract.mult));
  }

  /** 只看層級與實力的年薪，不含合約係數。轉會比較「那邊開不開得出更好的價」用它。 */
  get #baseSalary(): number {
    const pro = this.#pro;
    if (pro === null) return 0;
    const d = (this.rating?.overall ?? 0) - leagueStandardOf(this.#standards, pro.level).par;
    return salaryFor(pro.level, d);
  }

  /** 合約係數再乘上特性（〈全台主場〉每一份合約 ×1.2）。 */
  #salaryMultiplier(contractMult: number): number {
    const home = seasonCfg.contract.multiplier.trait_modifiers;
    return contractMult * (this.#traits.has('goldcloth') ? home.goldcloth : 1);
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
        throws: this.#player.throws,
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
    // 姓名在這裡截一次，之後每一段流程文字拿到的都是能直接顯示的名字。
    const player = createPlayer(this.world, displayName(this.setup.name), this.setup.startPosition, {
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
    // 天生的體質：選投手開局才擲〈橡膠果實〉。耐力的上限緊接著擲——橡膠果實乘在投手那一池。
    const rubber =
      player.startPosition === 'P' && this.world.stream('health').chance(seasonCfg.endurance.rubber.chance);
    if (rubber) this.#traits.add('rubber');
    this.#endurance = rollEndurance(this.world, rubber);

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
    // **只對 UTIL 發。** 原文寫給所有人看，內容卻與 ADR 0009 直接矛盾：起始守位
    // 就是鎖側，選了一壘手的人投手側四項連加點選項都不會亮；而二刀流是「在鎖側
    // 之後由 UTIL 這個單一入口開啟的後續狀態」，專精單側者的取得率實測是 0%。
    // 對非 UTIL 的玩家，那兩句話都是假的。
    if (player.startPosition === UTIL) {
      this.flow.card(
        'info',
        undefined,
        '守位不定的人投打兩側都練得到，也只有這條路走得到二刀流——' +
          '代價是兩邊都不會頂尖。守備位置交給教練團，練到哪裡就站到哪裡。',
      );
    }

    // 開局擲出的機率型天賦，擲到幾年講一次，之後整局都照這個數字。
    const rolled = [
      this.#peakDelay > 0 ? `〈不老妖精〉巔峰期結束延後 <b class="hl">${this.#peakDelay}</b> 年` : '',
      this.#maxAgeBonus > 0 ? `〈棒球公務員〉年齡上限 <b class="hl">+${this.#maxAgeBonus}</b>` : '',
    ].filter((l) => l !== '');
    if (rolled.length > 0) this.flow.card('info', '天賦', rolled.join('<br>'));

    this.#registerInitialPosition();

    this.flow.push(() => this.#startYear());
  }

  /**
   * 首次登錄守位，與入學卡同時發生。
   *
   * **不能等到第一次季初的守位檢視**——那在季初訓練之後，開局第一個提問時
   * 記分板的守位欄會是空的，而入學卡上一行才剛寫過他是什麼守位。
   *
   * 用玩家選的起始守位，不掃描也不覆蓋。UTIL 沒有本位，交給掃描並發卡告知；
   * 純投手不進這個系統（ADR 0037）。
   */
  #registerInitialPosition(): void {
    const player = this.#player;
    if (player === null || !this.#playsField) return;
    if (player.startPosition !== UTIL) {
      this.#setPosition(player.startPosition);
      return;
    }
    const picked = this.#scanPosition(null);
    this.#setPosition(picked.position);
    this.flow.card(
      'info',
      '守位登錄',
      `教練團評估守備工具後，將你登錄為 <b class="hl">${esc(positionLabel(picked.position))}</b>。`,
    );
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
      () => this.#switchPitcherRoll(),
      () => this.#positionReview(() => this.#loveEvent(() => this.#drawEventCards())),
      () => this.#cups(),
      () => this.#youthTournament(),
      () => this.#endYear(),
    );
  }

  /**
   * 養成期每年一次的「左右開投」判定。
   *
   * **擲骰無條件執行，判定才有條件。** 是不是投手會因為中途定位確立而改變，
   * 把擲骰包在條件裡會讓同一個種子的 events 子序列從那一年起整串偏移。
   *
   * 左投的機率明顯高於右投：左撇子從小被迫用右手做事，兩邊都能用的底子本來
   * 就在；右投是從零練起一隻沒用過的手。
   */
  #switchPitcherRoll(): void {
    const cfg = abilities.handedness.switch_pitcher_chance;
    const throws = this.#player?.throws;
    const hit = this.world.stream('events').chance(cfg.by_throws[throws ?? 'R'] ?? 0);
    if (!hit || this.#activeSide !== 'pitcher') return;
    if (this.#traits.has(SWITCH_PITCHER_TRAIT)) return;

    this.#unlockTrait(
      SWITCH_PITCHER_TRAIT,
      '練習後留下來的那顆球，你隨手用另一隻手扔了回去——教練停住了腳步。' +
        '從那天起你多練了一隻手——<b class="hl">兩邊輪流投，單邊手臂的累積量也跟著少了</b>。',
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

      // 徵召一次就是一次，不管名次——「國家隊常客」看的是入選次數。
      this.#counts.internationalCaps++;
      if (result.rankIndex === 0) this.#counts.internationalTitles++;
      if (honorRanks.has(result.rank)) this.#counts.internationalPodiums++;

      // 國際賽與國內大賽的榮譽各自獨立——贏下謝國城盃是一項成就，代表台灣
      // 打 LLB 拿冠軍是另一項。名字與職業期的國家隊同一套組法（見 naming.ts）。
      if (honorRanks.has(result.rank)) {
        this.#addHonor(
          joinName(amateur.amateur_international.honor_prefix, result.tournament, result.rank),
        );
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
            note: `成功率 ${pct(chances.bold)}%｜幅度最大，受傷風險也最高`,
            role: 'warn',
          },
          { id: 'event:normal', label: '照常執行', note: `成功率 ${pct(chances.normal)}%`, role: 'main' },
          { id: 'event:safe', label: '保守應對', note: `成功率 ${pct(chances.safe)}%｜幅度最小` },
        ],
      },
      (choice) => {
        this.#resolveEventCard(event, choice.slice('event:'.length) as EventMode);
        // 被逐出棒球界的人沒有下一張卡了——生涯已經在上一行結束。
        if (this.#banned) return;
        this.#drawEventCard(remaining - 1);
      },
    );
  }

  /**
   * 一季的耐力帳（ADR 0051）：扣掉這一季的消耗、加回自然恢復；耗盡之後的能力衰退；
   * 狀態掉階或回升時發一張卡。
   *
   * 野手照登錄守位與出賽算（指定打擊不磨損），投手照局數算。係數每季各擲一次。
   */
  #wearSeason(games: number, outs: number): void {
    const pools = this.#endurance;
    const pro = this.#pro;
    if (pools === null || pro === null) return;
    const before = { fielder: tierOf(pools.fielder), pitcher: tierOf(pools.pitcher) };

    const leagueGames = levelOf(pro.level).games;
    const fielderCost = fielderWear(this.#fieldPosition ?? DH, games, leagueGames, wearCoefficient(this.world));
    const pitcherCost = pitcherWear(outs, wearCoefficient(this.world));
    const fielder = settleSeason(pools.fielder, fielderCost, RECOVERY.fielder);
    let pitcher = settleSeason(pools.pitcher, pitcherCost, RECOVERY.pitcher);
    if (this.#tjRehab) {
      pitcher = afterSurgery(pitcher);
      this.#tjRehab = false;
    }
    this.#endurance = { fielder, pitcher };

    const lines: string[] = [];
    // 野手耗盡：守備三項往下掉（配球永不衰退）。投手是七傷拳期間才掉。
    if (this.#playsField && fielder.emptySeasons > 0) {
      lines.push(...this.#enduranceDecline('fielder', fielder.emptySeasons));
    }
    if (this.#pitches && this.#sevenFists > 0) {
      lines.push(...this.#enduranceDecline('pitcher', this.#sevenFists));
    }

    const after = { fielder: tierOf(fielder), pitcher: tierOf(pitcher) };
    const sides: string[] = [];
    if (this.#playsField && after.fielder !== before.fielder) {
      sides.push(`${this.#pitches ? '野手的' : ''}身體：${tierName(after.fielder)}`);
    }
    if (this.#pitches && after.pitcher !== before.pitcher) {
      sides.push(`${this.#playsField ? '投手的' : ''}手臂：${tierName(after.pitcher)}`);
    }
    if (sides.length > 0 || lines.length > 0) {
      const worse =
        tierRank(after.fielder) > tierRank(before.fielder) || tierRank(after.pitcher) > tierRank(before.pitcher);
      this.flow.card(worse || lines.length > 0 ? 'bad' : 'info', '身體狀態', [...sides, ...lines].join('<br>'));
    }
  }

  /**
   * 耗盡之後的能力衰退：**獨立於年齡衰退之外**，量約七成。期望值取整前擲一次，
   * 與年齡衰退同一個做法。只扣在用那一側的能力。
   */
  #enduranceDecline(side: 'fielder' | 'pitcher', seasons: number): string[] {
    const amount = declineAmount(seasons);
    const rng = this.world.stream('growth');
    const hit: string[] = [];
    for (const key of declineKeys(side)) {
      if (!isSideVisible(key as AbilityKey, this.#activeSide)) continue;
      const whole = Math.floor(amount);
      const drop = whole + (rng.next() < amount - whole ? 1 : 0);
      if (drop <= 0) continue;
      const before = this.#ability[key] ?? 0;
      const after = Math.max(abilities.scale.hard_floor, before - drop);
      if (after === before) continue;
      this.#ability[key] = after;
      hit.push(`${esc(abilities.abilities[key] ?? key)} −${before - after}`);
    }
    if (hit.length === 0) return [];
    this.#settleCarry();
    // 與年齡衰退的卡同一個寫法：純文字、以「｜」分隔，不加粗不上色。
    return [`${side === 'fielder' ? '腿與手套跟不上了。' : '七傷拳的代價。'}${hit.join('｜')}`];
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
      const before = this.#ability[delta.key] ?? 0;
      // 兩側都走成本曲線：加的點進蓄力槽，扣的點也從蓄力槽扣，欠到夠退一級
      // 才退級。舊做法是扣值時 1 點 1 級，能力越高，同一張卡的下檔就越比上檔
      // 重——那個不對稱不是設計出來的。
      if (delta.points >= 0) this.#applyPoints(delta.key, delta.points, { silent: true });
      else this.#applyPenalty(delta.key, -delta.points);
      lines.push(`${esc(name)} ${this.#deltaNote(delta.key, delta.points, before)}`);
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
      lines.push(`本季受傷機率 <span class="dn">+${pct(outcome.injury)}%</span>`);
    }

    // 非能力的特殊效果（issue #16：以前禁賽、聲望、逐出都印了卡卻什麼也沒發生）。
    for (const key of Object.keys(outcome.special).sort()) {
      const value = outcome.special[key];
      if (EVENT_TRAIT_KEYS.includes(key)) {
        if (this.#traits.has(key)) continue;
        if (mode !== 'bold' && (event.bold_only ?? []).includes(key)) continue;
        this.#traits.add(key);
        // 〈善良之槍〉只到換隊為止：記下是在哪一隊被打入冷宮的。
        if (key === 'onetool') this.#onetoolTeam = this.#pro?.team ?? null;
        if (key === 'cancer') this.#cancerTeam = this.#pro?.team ?? null;
        const name = traitName(key);
        const bad = traitOf(key)?.tone === 'bad';
        lines.push(`取得特性<b class="${bad ? 'dn' : 'hl'}">〈${esc(name)}〉</b>`);
      } else if (key === 'income' && typeof value === 'number' && this.#pro !== null) {
        // 代言與罰款：當季年薪的百分比。養成期沒有年薪，這一格落空，交給下面的保底。
        const amount = Math.round((this.#seasonSalary * value) / 100);
        if (amount === 0) continue;
        this.#earnings += amount;
        lines.push(
          amount > 0
            ? `代言收入 <span class="up">+${fmtMoney(amount)}</span>`
            : `聯盟罰款 <span class="dn">−${fmtMoney(-amount)}</span>`,
        );
      } else if (key === 'suspension' && typeof value === 'number' && this.#pro !== null) {
        this.#suspendedGames += value;
        lines.push(`禁賽 <span class="dn">${value} 場</span>`);
      } else if (key === 'ban' && value === true && this.#pro !== null) {
        this.#banned = true;
      } else if (key === 'tj_countdown' && typeof value === 'number' && this.#pitches && this.#endurance !== null) {
        // 韌帶受損：投手耐力直接扣掉一截（ADR 0051）。
        this.#endurance = {
          ...this.#endurance,
          pitcher: adjustEndurance(this.#endurance.pitcher, -value * TJ_COUNTDOWN_PERCENT),
        };
        lines.push('<span class="dn">手肘的韌帶磨損了一截</span>');
      } else if (key === 'recover' && typeof value === 'number' && this.#endurance !== null) {
        // 休養：兩池各回上限的 value%（issue #19）。
        this.#endurance = {
          fielder: adjustEndurance(this.#endurance.fielder, value),
          pitcher: adjustEndurance(this.#endurance.pitcher, value),
        };
        lines.push('<span class="up">身體恢復了一些</span>');
      }
    }

    // 〈今晚打老虎〉的另一條路：全力一搏**累計**成功夠多次，不必連續（2026-09-25）。
    // 躲在保守裡練不出大心臟——只選保守的人以前 96% 拿得到。
    if (mode === 'bold' && outcome.good) this.#boldWins++;
    if (this.#boldWins >= BOLD_WINS_FOR_CLUTCH && !this.#traits.has('clutch')) {
      this.#traits.add('clutch');
      lines.push(`全力一搏第 ${this.#boldWins} 次賭贏——取得特性<b class="hl">〈${esc(traitName('clutch'))}〉</b>`);
    }
    // 〈何金銀〉是它的反面：連續抽到壞結果，好結果歸零。
    this.#eventFailStreak = outcome.good ? 0 : this.#eventFailStreak + 1;
    if (this.#eventFailStreak >= EVENT_STREAK_FOR_THIEF && !this.#traits.has('thief')) {
      this.#traits.add('thief');
      lines.push(`連續 ${this.#eventFailStreak} 張事件卡全部搞砸——取得特性<b class="dn">〈${esc(traitName('thief'))}〉</b>`);
    }
    // 〈烏鴉〉：全力一搏累計輸夠多次，賭輸就掀桌。
    if (mode === 'bold' && !outcome.good) this.#boldFails++;
    if (this.#boldFails >= BOLD_FAILS_FOR_CANCER && !this.#traits.has('cancer')) {
      this.#traits.add('cancer');
      this.#cancerTeam = this.#pro?.team ?? null;
      lines.push(`全力一搏第 ${this.#boldFails} 次失敗，你又掀了桌——取得特性<b class="dn">〈${esc(traitName('cancer'))}〉</b>`);
      // 歸零：換隊解除之後要再輸滿一輪才會再被貼上，不然下一張卡就立刻回來。
      this.#boldFails = 0;
    }
    // 〈外務纏身〉：代言接多了。代言是好結果帶代言收入的那幾張卡。
    const income = outcome.special['income'];
    if (outcome.good && typeof income === 'number' && income > 0) this.#endorsements++;
    const distract = this.#checkDistract();
    if (distract !== '') lines.push(distract);

    // **不留沒有作用的卡**：上面全部落空的話（養成期沒有年薪可罰、大心臟早就有了），
    // 照結果的好壞給在用那一側隨機一項 ±1。
    if (!this.#banned && lines.length === 0) {
      const key = this.#randomVisibleAbility();
      const before = this.#ability[key] ?? 0;
      if (outcome.good) this.#applyPoints(key, 1, { silent: true });
      else this.#applyPenalty(key, 1);
      lines.push(`${esc(abilities.abilities[key] ?? key)} ${this.#deltaNote(key, outcome.good ? 1 : -1, before)}`);
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

    // 永久逐出：這一年剩下的步驟（健康、球季、國家隊）全部不再發生，名人堂也不必
    // 票選——被逐出的人沒有資格。
    if (this.#banned) {
      this.flow.abort();
      this.#retire(`${this.#year} 年被聯盟永久逐出棒球界`);
    }
  }

  /**
   * 〈黯然銷魂飯〉：季初另外擲一顆骰，自動加在**最有發展潛力**的能力——潛力（上限）
   * 最高的那一項；已經練到 80 或練到頂的就換下一項。只看正在用的那一側。回傳要接在
   * 季初訓練卡後面的那一句；沒有這個特性就是空字串。
   */
  #comboDie(): string {
    if (!this.#traits.has('combo')) return '';
    const max = abilities.scale.max;
    const target = ALL_ABILITIES.filter((k) => isSideVisible(k, this.#activeSide))
      .filter((k) => (this.#ability[k] ?? 0) < Math.min(max, this.#ceilingOf(k)))
      .reduce<AbilityKey | null>((best, k) => (best === null || this.#ceilingOf(k) > this.#ceilingOf(best) ? k : best), null);
    const v = rollOneDie(this.world, this.#traits);
    if (target === null) return '';
    const before = this.#ability[target] ?? 0;
    this.#applyPoints(target, v, { silent: true });
    return `<br>黯然銷魂飯：只練一招，多擲的 <b class="hl">${v}</b> 點全給了${esc(abilities.abilities[target] ?? target)}（${this.#deltaNote(target, v, before)}）。`;
  }

  /**
   * 〈巧克力〉的解除：升上更高層級或拿下年度獎項。回傳要接在卡片後面的那一句；
   * 身上沒有就是空字串。成就照樣留著——撞到頭那件事發生過。
   */
  #cureYips(why: string): string {
    if (!this.#traits.has('yips')) return '';
    this.#traits.delete('yips');
    this.#yipsEver = true;
    return `<br>${esc(why)}，腦袋裡那團霧散了——<b class="hl">〈${esc(traitName('yips'))}〉解除</b>。`;
  }

  /** 〈外務纏身〉：代言次數 × 0.5 + 外遇次數到門檻就取得。回傳要接在卡片上的那一句。 */
  #checkDistract(): string {
    if (this.#traits.has('distract')) return '';
    const load = this.#endorsements * DISTRACT.endorsement_weight + this.#love.affairs;
    if (load < DISTRACT.threshold) return '';
    this.#traits.add('distract');
    return `通告、代言、還有不該有的約會，把休賽季塞滿了——取得特性<b class="dn">〈${esc(traitName('distract'))}〉</b>`;
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
    msg += this.#comboDie();
    this.flow.card('info', '季初訓練', msg);

    // 〈高手高手高高手〉：養成期累計擲出夠多的 6（這裡只在養成期跑，職業期走
    // #proSpringTraining）。
    this.#amateurSixes += dice.sixes;
    if (this.#amateurSixes >= abilities.training_dice.genius_sixes) {
      this.#unlockTrait(
        'genius',
        `養成期已經擲出 ${this.#amateurSixes} 顆 6——別人練一年的東西，你看一眼就會。`,
      );
    }

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
        throws: player.throws,
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
    const fieldingNow = this.#eventFielding(
      this.#ability,
      this.#fieldPosition,
      amateurCfg.cups[this.#stage].par,
      line.batting,
    );
    this.#seasonDefenseRuns = fieldingNow.defenseRuns;
    // 養成期沒有結算帳，份額與 WAR 從成績現算，替代水準是 par − 3（見 eventLedger）。
    const ledger = eventLedger(
      line.batting,
      line.pitching,
      fieldingNow.fielding,
      amateurBaseline(),
      amateurBaselineAt(amateurCfg.war_replacement.d),
    );
    this.#seasonShares = { batting: ledger.batting, pitching: ledger.pitching, fielding: ledger.fielding };
    this.#seasonWar = ledger.war;
    // 當季暫時能力用完就歸零——它只屬於這一年。
    this.#seasonBonus = {};
    this.#accumulate(line.batting, line.pitching);
    this.#amateurSeasons.push({
      year: this.#year,
      age: this.#age,
      stage: this.#stage,
      stageName: stageOf(this.#stage).name,
      school: this.#school,
      // 當下就存：守位會隨移防改變，引退時回頭問只會拿到最後一年的答案。
      position: this.#fieldPosition,
      // 定位同理，而且它每年都會變——體力練上去就從牛棚走進輪值。
      pitcherRole: line.pitching === null ? null : amateurRole(this.#stage, this.#ability),
      batting: line.batting,
      pitching: line.pitching,
      ...fieldingNow,
    });

    const statLines: string[] = [];
    if (line.pitching !== null) {
      const p = line.pitching;
      // 沒投就不報防禦率——0 局配一個防禦率是在報一件沒發生的事。
      statLines.push(
        p.outs === 0
          ? '本季未獲登板'
          : `投球 ${p.games} 場 ${fmtInnings(p.outs)} 局・${p.so} K・防禦率 <b class="hl">${p.era.toFixed(2)}</b>`,
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
    for (const h of season.honors) this.#addHonor(joinName(h.cup, h.rank));
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

    // 大學的每一學年結束都是一次出路（選秀或旅外），不是只有畢業那一次。
    if (this.#stage === 'U') {
      this.flow.push(() => this.#crossroads());
      return;
    }

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

  /** 高中畢業：結算三年，然後到出路（選秀、旅外或讀大學）。 */
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

    // 二刀流的判定在高中畢業、出路之前——讀大學的人不另外多給機會。
    this.#judgeTwoWay();
    this.flow.push(() => this.#crossroads());
  }

  /**
   * 二刀流判定與定位鎖定，**在高中畢業時**，出路之前。
   *
   * 讀大學的人不另外多給機會：二刀流的門檻是照六年養成校準的，大學四年再練
   * 兩邊會讓它變成「多讀幾年就湊得到」的東西。
   */
  #judgeTwoWay(): void {
    const r = this.rating;
    if (r === null || this.#lockedSide !== null || this.#traits.has(TWO_WAY_TRAIT)) return;
    // **只有 UTIL 起點判二刀流、比評價選邊。** 投手、野手起點本來就鎖在起始那一側
    // （ADR 0009）：另一側不能加點，但開局擲出的能力、自然成長與事件卡仍然讓它有
    // 評價——一個把野手側練爛的游擊手曾經因此在畢業時被鎖成投手，另一側夠高的
    // 人也可能不經 UTIL 就拿到二刀流（2026-09-26 修正）。
    const startSide = sideOfStartPosition(this.setup.startPosition);
    if (startSide !== null || !qualifiesAsTwoWay(r)) {
      // 沒取得二刀流就要選邊站，另一側從此關閉——這是二刀流之所以珍貴的代價面。
      this.#lockedSide = startSide ?? (r.pitcher >= r.fielder ? 'pitcher' : 'fielder');
      const kept = this.#lockedSide === 'pitcher' ? '投手' : '野手';
      const dropped = this.#lockedSide === 'pitcher' ? '打擊與守備' : '投球';
      this.flow.card(
        'info',
        `定位確立：${kept}`,
        `六年下來，你的<b class="hl">${kept}</b>能力明顯突出，球團就是這樣看你的。` +
          `從今以後${esc(dropped)}那一側不再練，能力表也不再顯示它——` +
          '職業球員的角色是固定的。',
      );
      return;
    }
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

  /**
   * 業餘 → 職業。選秀接受指名與簽下海外育成合約都走這裡。
   *
   * 大學生離校是一道感情關卡（高中那一道在高中畢業時已經擲過）。
   */
  #turnPro(level: string, team: string): void {
    if (this.#stage === 'U') this.#loveCheckpoint('離開大學');
    this.flow.push(() => this.#professionalStart(level, team));
  }

  /**
   * 進大學：高中畢業自己選、高中選秀落選、或被指名後選擇重返校園。
   *
   * 分發跟國中、高中一樣是隨機的，走 career 流——這是生涯事件，不是開局生成。
   */
  #enterUniversity(why: string): void {
    this.#stage = 'U';
    this.#stageYear = 1;
    const assigned = assignSchool(this.world, 'U', 'career');
    this.#school = assigned.school;
    this.#schoolTier = assigned.tier;
    const label = schoolTiersOf('U')?.tiers[String(assigned.tier)]?.label ?? '';
    this.flow.card(
      'gold',
      '大學入學',
      `${esc(why)}你進了<b class="hl">${esc(assigned.school)}</b>` +
        `${label ? `（${esc(label)}）` : ''}棒球隊。`,
    );
    this.flow.push(() => this.#startYear());
  }

  /** 大學的出路：大一到大三還能回去讀；大四畢業就沒有下一年了。 */
  #universityFinal(): boolean {
    return this.#stage === 'U' && this.#stageYear > stageOf('U').years;
  }

  /** 大學生在出路上沒走成（落選、拒絕指名、留校）：回去讀下一年。 */
  #backToSchool(): void {
    this.flow.push(() => this.#startYear());
  }

  /**
   * 出路：高中畢業，以及大學每一學年結束。
   *
   * **選秀不是唯一的出口。** 能力夠好的人可以直接與海外球團簽育成合約，不經過
   * 選秀，從對方體系的低階層級出發——那是一條完全不同的生涯：起點更低、薪水
   * 更少，但天花板高得多。大學生也能走，只是年紀越大條件越差。
   *
   * 高中畢業另外可以讀大學；大一到大三可以留下來再讀一年。只剩選秀一條路時
   * （大四畢業、沒有海外報價）不問，直接進選秀：只有一個選項的提問是雜訊。
   */
  #crossroads(): void {
    const overall = this.rating?.overall ?? 0;
    const inUniversity = this.#stage === 'U';
    const final = this.#universityFinal();
    const offers = amateurOverseasOffers(
      this.world,
      overall,
      this.#standards,
      this.#handednessTier,
      this.#age,
    );
    const stayOption: Option | null = !inUniversity
      ? { id: 'path:university', label: '就讀大學（延長養成）', note: '四年，每學年結束都能再參加選秀' }
      : final
        ? null
        : { id: 'path:stay', label: '留在大學繼續磨練', note: '明年這個時候還能再選一次' };
    if (offers.length === 0 && stayOption === null) {
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
      ...(stayOption === null ? [] : [stayOption]),
    ];

    const yearLabel = stageOf('U').year_labels[this.#stageYear - 2] ?? '大學';
    const title = !inUniversity
      ? `高中畢業 · 綜合能力 ${overall} · 人生的第一個路口`
      : final
        ? `大學畢業 · 綜合能力 ${overall}`
        : `${yearLabel}結束 · 綜合能力 ${overall}`;
    this.flow.ask({ title, options }, (choice) => {
      if (choice === 'path:university') {
        this.#enterUniversity('');
        return;
      }
      if (choice === 'path:stay') {
        this.#backToSchool();
        return;
      }
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
        this.#pendingBonus += picked.bonus;
        this.#playedOrgs.add(picked.org);
        this.flow.card(
          'gold',
          picked.label.replace('洽談', '').replace('合約', ''),
          `與 <b class="hl">${esc(picked.team)}</b> 簽下育成合約，從 <b class="hl">${esc(picked.levelName)}</b> 出發。` +
            `簽約金 <b class="hl">${fmtMoney(picked.bonus)}</b>。` +
            '<br><span class="sub">沒有選秀會的舞台，也沒有人保證你上得去。一切從最底層開始。</span>',
        );
        this.#turnPro(picked.level, picked.team);
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
      if (this.#stage === 'HS') {
        this.flow.push(() => this.#enterUniversity('落榜之後，你沒有放下手套。'));
      } else if (!this.#universityFinal()) {
        this.#backToSchool();
      } else {
        this.flow.push(() => this.#careerOver('大學畢業選秀落榜'));
      }
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
      this.#pendingBonus += result.bonus;
      this.#turnPro(result.level ?? '', result.team ?? '');
    };

    // 大四畢業那一次沒有「回去再拚一年」：已經沒有學校可以回了。
    if (!canRejectOffer(result, this.#age) || this.#universityFinal()) {
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
            note:
              this.#stage === 'HS'
                ? '放棄本次指名，進大學，每學年結束都能再參加選秀'
                : '放棄本次指名，留在大學，明年重新參加選秀',
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
        // 高中生進大學；大學生留在學校讀下一年。
        if (this.#stage === 'HS') this.#enterUniversity('');
        else this.#backToSchool();
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
      () =>
        this.#positionReview(() =>
          this.#roleReview(() => this.#loveEvent(() => this.#drawEventCards())),
        ),
      () => this.#healthCheck(),
      () => this.#tradeDeadline(),
      () => this.#proSeason(),
      () => this.#nationalTeam(() => this.#proEndYear()),
    );
  }

  /**
   * 季初的守位檢視。**養成期、二軍與一軍跑同一套**（ADR 0037）。
   *
   * 首次登錄用玩家選的起始守位，不掃描——入學卡已經說過他是什麼守位，系統
   * 再覆蓋一次等於開局第一年就推翻他唯一親手做過的守位決定。UTIL 沒有本位，
   * 兩條光譜都掃並發一張登錄卡：那正是他選「守位不定」的意思。
   *
   * 之後每年重掃一次——守備會退化，也會練回來，移防不是單向的。掃描永遠取
   * 守得動的最高階，所以升降都能跳階。
   *
   * **升降的話語權不對稱**：守不動就是守不動，那不是可以商量的事實，因此降
   * 守位直接發卡告知；往上是機會不是判決，而且更吃重的守位意味著更高的門檻，
   * 因此升守位要問過。兩者都不給「要守哪裡」的選擇——位置由守備能力決定，
   * 玩家決定的是要不要動。
   *
   * 純投手不進這個系統，他們走投手定位那條線。
   */
  #positionReview(then: () => void): void {
    const player = this.#player;
    if (player === null || !this.#playsField) {
      this.#setPosition(null);
      then();
      return;
    }

    if (this.#position === null) {
      // 還沒登錄過就補一次。正常路徑在入學時就登錄完了，這裡接的是中途才走回
      // 野手側的人——例如定位還沒鎖、去年被判成投手側的 UTIL。
      this.#registerInitialPosition();
      then();
      return;
    }

    this.#enduranceStepDown(() => this.#positionScan(then));
  }

  /**
   * 野手耐力每掉一階，守位會議問一次要不要退守（ADR 0051）：疲勞退一格、透支退一壘、
   * 耗盡退指定打擊。拒絕之後同一階與回升都不再問，再往下掉才問。
   *
   * 退下來之後，只要狀態沒有回升到退守那一階之上，教練團不會再把他推回更吃重的
   * 位置——那是他自己選的，不是守備掉下來的。
   */
  #enduranceStepDown(then: () => void): void {
    const pool = this.#endurance?.fielder;
    const current = this.#position;
    const player = this.#player;
    if (pool === undefined || current === null || player === null || this.#pro === null) {
      then();
      return;
    }
    const tier = tierOf(pool);
    const worse = tierRank(tier) > tierRank(this.#fielderTierSeen);
    this.#fielderTierSeen = tier;
    // 自己退下來的鎖：同一支球隊要等身體養回充沛才解；換了球隊（交易、轉隊、轉聯盟）
    // 就解——新教練團沒有答應過你什麼。
    if (
      this.#enduranceCap !== null &&
      (tier === 'full' || this.#enduranceCap.team !== this.#pro.team)
    ) {
      this.#enduranceCap = null;
    }
    const target = worse ? this.#stepDownTarget(tier, current, player.startPosition) : null;
    if (target === null) {
      then();
      return;
    }

    const name = positionLabel(target);
    this.flow.ask(
      {
        title: `守位會議：身體${tierName(tier)}了，要不要退守${name}？`,
        options: [
          { id: 'endurance:move', label: `退守${name}`, note: '少一點消耗，教練團不會再把你推回去', role: 'main' },
          { id: 'endurance:stay', label: `留守${positionLabel(current)}`, note: '同一個狀態不再問' },
        ],
      },
      (choice) => {
        if (choice === 'endurance:move') {
          this.#setPosition(target);
          this.#enduranceCap = { position: target, team: this.#pro?.team ?? '' };
          this.flow.card('info', '守位調整', `為了多打幾年，新球季改守 <b class="hl">${esc(name)}</b>。`);
        }
        then();
      },
    );
  }

  /** 這一階的退守目標：疲勞退光譜上的下一格、透支退一壘、耗盡退指定打擊。已經在那裡或更輕的位置就不問。 */
  #stepDownTarget(tier: EnduranceTier, current: string, startPosition: string): string | null {
    const load = (p: string) => (p === DH ? -1 : fieldingResponsibility(p));
    let target: string | null = null;
    if (tier === 'tired') {
      const list = [...spectrumOf(startPosition), DH].filter(
        (p) => p !== DH && !blockedByHand(this.#player?.throws ?? null, p),
      );
      const i = current === 'C' ? -1 : list.indexOf(current);
      target = list[i + 1] ?? null;
    } else if (tier === 'strained') target = '1B';
    else if (tier === 'empty') target = DH;
    if (target === null || load(target) >= load(current)) return null;
    return target;
  }

  /** 守位會議的正規掃描：守不動就降、守得動更吃重的位置就問。 */
  #positionScan(then: () => void): void {
    const current = this.#position;
    if (current === null) {
      then();
      return;
    }
    const result = this.#scanPosition(current);
    if (result.move === 'stay') {
      then();
      return;
    }

    if (result.move === 'demote') {
      this.#setPosition(result.position);
      this.flow.card('bad', '守位會議', `${esc(result.reason)}。`);
      then();
      return;
    }

    // 升防：在這個位置上拒絕過就不再問。記憶在 #setPosition 裡隨守位變動清空。
    // 因為耐力自己退下來的人，狀態沒回升之前也不問（見 #enduranceStepDown）。
    const capped =
      this.#enduranceCap !== null &&
      fieldingResponsibility(result.position) > fieldingResponsibility(this.#enduranceCap.position);
    if (this.#declinedPromotions.has(result.position) || capped) {
      then();
      return;
    }
    const target = positionLabel(result.position);
    this.flow.ask(
      {
        title: '守位會議：教練團想把你推上更吃重的位置',
        options: [
          {
            id: 'position:accept',
            label: `改守${target}`,
            note: '更吃重的守位，門檻也更高',
            role: 'main',
          },
          {
            id: 'position:decline',
            label: `留守${positionLabel(current)}`,
            note: '這個位置上不再問',
          },
        ],
      },
      (choice) => {
        if (choice === 'position:accept') {
          this.#setPosition(result.position);
          this.flow.card(
            'good',
            '守位調整',
            `守備數據說服了所有人——新球季改守 <b class="hl">${esc(target)}</b>。`,
          );
        } else {
          this.#declinedPromotions.add(result.position);
          this.flow.card(
            'info',
            '留守原位',
            `你婉拒了教練團的提議——<b class="hl">${esc(positionLabel(current))}</b>還是你的位置。`,
          );
        }
        then();
      },
    );
  }

  /** 用當下的能力與尺掃一次守位。current 為 null 時是首次登錄的掃描。 */
  #scanPosition(current: string | null): PositionResult {
    const player = this.#player!;
    return assignPosition({
      tier: this.#handednessTier,
      ability: this.#ability,
      current,
      level: this.#benchmarkLevel,
      age: this.#age,
      startPosition: player.startPosition,
      throws: player.throws,
    });
  }

  /**
   * 定位會議：這一季他在牛棚還是輪值。
   *
   * **與守位會議同一套規則（ADR 0037）**：往下是事實，教練團不會問你要不要掉出
   * 輪值；往上是機會，要問過你，而且**在同一個定位上拒絕過就不再問第二次**。
   *
   * 「即使體力到了也要問」是刻意的——體力只決定他撐不撐得住，不決定他想不想。
   * 一個關門人被推去當先發是升遷，不是調度。
   */
  #roleReview(then: () => void): void {
    const pro = this.#pro;
    // 只有走投球側的人有定位。養成期沒有牛棚分工，職業之前不判。
    if (pro === null || !this.#pitches) {
      this.#setPitcherRole(null);
      then();
      return;
    }

    const natural = pitcherRole(this.#seasonAbility, pro.level, this.#standards);
    const current = this.#pitcherRole;

    if (current === null) {
      // 首次登錄：照能力放，不問——他還沒有位置可以留守。
      this.#setPitcherRole(natural);
      this.flow.card(
        'info',
        '定位登錄',
        `教練團評估之後，把你放在 <b class="hl">${esc(ROLE_NAMES[natural])}</b>。`,
      );
      then();
      return;
    }

    if (natural === current) {
      then();
      return;
    }

    if (roleRank(natural) < roleRank(current)) {
      // 往下不問。那不是可以商量的事。
      this.#setPitcherRole(natural);
      this.flow.card(
        'bad',
        '定位會議',
        `你撐不住${esc(ROLE_NAMES[current])}的份量了——新球季改任 <b class="dn">${esc(ROLE_NAMES[natural])}</b>。`,
      );
      then();
      return;
    }

    // 升遷的選項：構得到的最高那一階，加上構到先發時牛棚那條路的最高一階——
    // 體力夠的人兩條路都能走，要進輪值還是去關門由他自己選（ADR 0052）。比現在
    // 低的不列；在那個定位上拒絕過的也不列，記憶在 #setPitcherRole 裡隨定位變動清空。
    const offers: PitcherRole[] = [natural];
    const relief = bullpenRole(this.#seasonAbility, pro.level, this.#standards);
    if (natural === 'SP' && relief !== null && roleRank(relief) > roleRank(current)) offers.push(relief);
    const open = offers.filter((r) => !this.#declinedRoles.has(r));
    if (open.length === 0) {
      then();
      return;
    }
    this.flow.ask(
      {
        title: '定位會議：教練團想把你放到更吃重的位置',
        options: [
          ...open.map((r, i) => ({
            // 第一顆沿用舊的 id：存檔是重播日誌，舊局裡的 role:accept 要照樣對得上。
            id: i === 0 ? 'role:accept' : `role:accept:${r}`,
            label: `改任${ROLE_NAMES[r]}`,
            note: r === 'SP' ? '進輪值，一季扛一百多局' : '進牛棚的後段，一局定勝負',
            ...(i === 0 ? { role: 'main' as const } : {}),
          })),
          {
            id: 'role:decline',
            label: `留任${ROLE_NAMES[current]}`,
            note: '這些定位上不再問',
          },
        ],
      },
      (choice) => {
        const picked = choice === 'role:accept' ? open[0] : open.find((r) => choice === `role:accept:${r}`);
        if (picked !== undefined) {
          this.#setPitcherRole(picked);
          this.flow.card(
            'good',
            '定位調整',
            `${picked === 'SP' ? '輪值' : '牛棚'}的位置空出來了——新球季改任 <b class="hl">${esc(ROLE_NAMES[picked])}</b>。`,
          );
        } else {
          for (const r of open) this.#declinedRoles.add(r);
          this.flow.card(
            'info',
            '留任原位',
            `你婉拒了教練團的提議——<b class="hl">${esc(ROLE_NAMES[current])}</b>還是你的位置。`,
          );
        }
        then();
      },
    );
  }

  /**
   * 換登錄定位。**定位一動就把拒絕記憶整組清空**——與守位同一個理由：記住的是
   * 「我在那個位置上做過的決定」，離開了那個位置，當初拒絕的理由也就不在了。
   */
  #setPitcherRole(role: PitcherRole | null): void {
    if (role === this.#pitcherRole) return;
    this.#pitcherRole = role;
    this.#declinedRoles.clear();
  }

  /**
   * 換登錄守位。**守位一動就把拒絕記憶整組清空**——記住的是「我在這個位置上
   * 做過的決定」，離開了那個位置，當初拒絕的理由也就不在了（ADR 0037）。
   */
  #setPosition(position: string | null): void {
    if (position === this.#position) return;
    this.#position = position;
    this.#declinedPromotions.clear();
  }

  /**
   * 算守位時該拿哪一把尺。
   *
   * 進職業後一律是所屬體系的**頂級聯盟**：問的是「他守不守得動游擊」，那是對
   * 上這項運動的標準，不是對上他這季剛好待在哪一層（ADR 0021）。
   *
   * 養成期則是當下的學制階段（JHS／HS）。同一句話換個對手：國中生的游擊要對
   * 上的是國中的游擊，拿中職一軍的尺量他，全隊只剩一壘手（ADR 0021 修正）。
   */
  get #benchmarkLevel(): string {
    const pro = this.#pro;
    if (pro === null) return this.#stage;
    return benchmarkLevelOf(pro.level) ?? homeBenchmarkLevel();
  }

  /**
   * 目前實際站的守備位置，也就是**登錄守位**（ADR 0037）。
   *
   * 它只在守位會議上改變，不再每次讀取都重算——出賽勞損與守備分吃的是同一個
   * 值，一個會自己漂移的欄位餵不出穩定的勞損。
   *
   * 生涯紀錄存的是當季結算那一刻的值，不是引退時回算：那張表問的是「這個人
   * 當年站哪裡」。
   *
   * 純投手在養成期回 DH、進職業後回 null：他們走先發／後援那條線，不進守位
   * 系統（ADR 0021 第 3 點）。
   */
  get #fieldPosition(): string | null {
    if (this.#player === null) return null;
    // 純投手：養成期照樣站打席（學生棒球沒有一輩子不打擊的投手），守位掛 DH，
    // 打擊成績才有位置可標；進了職業就真的不打了，回 null——那裡的純投手不該
    // 有野手成績。
    if (!this.#playsField) return this.#pro === null ? DH : null;
    return this.#position;
  }

  /**
   * 這一季要不要打野手側。投手側單獨鎖定的球員不守備。
   *
   * 問的是 `#activeSide` 而不是 `#lockedSide`：**畢業前定位鎖定還沒發生**，
   * 而起始守位早就把側別決定好了（ADR 0009，另一側的能力連加點選項都不出現）。
   * 原本這裡在養成期一路落到 `r.fielder > r.pitcher`，於是選一壘手開局的人在
   * 野手側評價追過初始擲出的投手側評價之前，會被判成純投手而掛上 DH——拿一個
   * 他根本不能訓練的評價去問他是不是投手，這個比較本身就不成立。
   *
   * UTIL 仍然比評價高低：他的側別本來就沒定，那正是「守位不定」的意思。
   */
  get #playsField(): boolean {
    if (this.isTwoWay) return true;
    const side = this.#activeSide;
    if (side !== null) return side === 'fielder';
    const r = this.rating;
    return r !== null && r.fielder > r.pitcher;
  }

  /**
   * 這一季上不上場投球。`#playsField` 的另一面，同一套判斷。
   *
   * 二刀流兩邊都算——那正是二刀流在數據上的樣子，也是他為什麼要開兩場會議。
   */
  get #pitches(): boolean {
    if (this.isTwoWay) return true;
    const side = this.#activeSide;
    if (side !== null) return side === 'pitcher';
    const r = this.rating;
    return r !== null && r.pitcher >= r.fielder;
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

    // 走養成期的同一條路：職業只是基礎骰數比較少，特性的骰面與天賦買來的骰數
    // 在職業期照樣生效——天賦是玩家帶進場的東西，不會因為畢業就失效。
    const dice = rollTrainingDice(this.world, this.#traits, {
      // 大傷拿走的骰從基礎骰數扣，最低 1 顆；冠軍與天賦的骰另外加，大傷拿不走。
      baseCount: Math.max(1, proDiceCount(this.world, this.#age) - this.#diceLost),
      bonusDice: bonus,
    });
    const values = dice.values;

    this.#dice = { values, index: 0 };

    let msg =
      `自主訓練擲出 <b class="hl">${values.length}</b> 顆骰：` +
      values.map((v) => `<b class="hl">${v}</b>`).join('、');
    if (dice.sixes > 0) msg += `，其中 ${dice.sixes} 顆是高標值。`;
    if (bonus > 0) {
      msg += `<br>去年的國際賽冠軍帶來更好的訓練資源與眼界，多擲 <b class="hl">${bonus}</b> 顆骰。`;
    }
    msg += this.#comboDie();
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

    // 三個階段共用的登錄守位（ADR 0037）。出賽勞損與守備分吃的都是這個位置——
    // 它只在守位會議上改變，因此勞損不會因為守位每年重算而漂移。
    const position = this.#fieldPosition ?? DH;
    // 禁賽 N 場：這一季的出賽量少掉那一截。用完歸零——禁賽不會跟到明年。
    this.#teamChangeCheck();
    const suspension = Math.max(0, 1 - this.#suspendedGames / levelOf(pro.level).games);
    this.#suspendedGames = 0;
    const line = playSeason(this.world, {
      level: pro.level,
      // 當季暫時能力：感情等非成長性的獎勵只抬高這一季（ADR 0006）。打擊、投球
      // 與守備分吃的是同一份。
      ability: this.#seasonAbility,
      position,
      // 守備分要算的守位：純投手在職業沒有守位，那一格就是 null。
      scoringPosition: this.#position,
      rating: r,
      lockedSide: this.#lockedSide,
      twoWay: this.isTwoWay,
      standards: this.#standards,
      // 定位是定位會議決定的，成績這邊照著用——現算會讓玩家拒絕過的升遷偷偷生效。
      pitcherRole: this.#pitcherRole,
      // 輪值線掛在球隊戰力上——在爛隊當先發、去強隊只能進牛棚。
      teamWinRate: this.#league?.get(pro.team)?.winRate ?? null,
      // 傷病與禁賽的結果。乘的是出賽量，不是事後把數據打折。
      // 〈善良之槍〉：被打入冷宮，出賽量再打折，直到換隊。
      seasonFactor: this.#seasonFactor * suspension * (this.#traits.has(injuryCfg.onetool.trait) ? injuryCfg.onetool.season_factor : 1),
      catcherSeasons: this.#catcherSeasons,
    });

    this.#seasonBatting = line.batting;
    this.#seasonPitching = line.pitching;
    this.#seasonDefenseRuns = 0;
    this.#seasonShares = null;
    this.#seasonWar = null;
    // 當季暫時能力用完就歸零——它只屬於這一年。
    this.#seasonBonus = {};
    this.#accumulate(line.batting, line.pitching);

    // 守備分由 playSeason 一起算（規則見那邊）——這裡只負責累加進生涯。
    const def = line.defenseRuns;
    this.#defenseRuns[pro.level] = (this.#defenseRuns[pro.level] ?? 0) + def;
    this.#seasonDefenseRuns = def;

    this.#lastD = r.overall - leagueStandardOf(this.#standards, pro.level).par;
    this.#playedOrgs.add(levelOf(pro.level).org);

    // 領薪水。**在成績結算之後才領**——年薪看的是這一季的 d 值，而 d 值要等
    // 這季打完、能力定案才算得準。
    const salary = this.#seasonSalary;
    this.#earnings += salary;

    const stints = this.#recordStints(line.batting, line.pitching, def, salary);
    // 這一季算不算蹲了一季捕手：在打完之後才記，這一季本身照「蹲捕中」打折。
    if (this.#fieldPosition === 'C' && this.#seasonInjury !== 'rehab') this.#catcherSeasons++;
    this.#wearSeason(line.batting?.games ?? 0, line.pitching?.outs ?? 0);
    // 上季勝率：這一年所有分段的份額加總。季中轉隊的人不能只算後半段。
    this.#lastWinPct = winPct(
      sumShares(
        ...stints.flatMap((s) => [s.shares.batting, s.shares.pitching, s.shares.fielding]),
      ),
    );

    // 相對聯盟平均的兩個指標。手機版沒有常駐的成績面板（只有這張卡），所以
    // 對照聯盟平均這件事必須由卡片自己講；桌面的面板照舊也算一份。
    const seasonBase = proBaseline(pro.level);
    const relERA = line.pitching === null ? null : eraPlus(line.pitching, seasonBase);
    const relOPS = line.batting === null ? null : opsPlus(line.batting, seasonBase);

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
          `・防禦率 <b class="hl">${p.era.toFixed(2)}</b>・奪三振 ${p.so}` +
          // 絕對數字讀不出「這一季在這個聯盟算好還算壞」——3.80 在投手聯盟是
          // 平庸、在打者聯盟是好投。相對值只在有值時附上（沒投滿就沒有）。
          `${relERA === null ? '' : `・ERA+ ${relERA}`}`,
      );
    }
    if (line.batting !== null) {
      const b = line.batting;
      parts.push(
        `<b>打者</b>（${esc(positionName(position))}）｜${b.games} 場・${b.pa} 打席` +
          `・打擊率 <b class="hl">${fmtAvg(b.avg)}</b>／${fmtAvg(b.obp)}／${fmtAvg(b.slg)}` +
          `・${b.hr} 轟 ${b.rbi} 打點${b.sb > 0 ? `・盜壘 ${b.sb}` : ''}` +
          `${b.ibb > 0 ? `・故意四壞 ${b.ibb}` : ''}` +
          `${def === null ? '' : `・守備 ${def > 0 ? '+' : ''}${def}`}` +
          `${relOPS === null ? '' : `・OPS+ ${relOPS}`}`,
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
    this.#annualAwards(line.batting, line.pitching, this.#seasonFactor * suspension);
    this.#championship();
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
      this.#seasonInjury = 'rehab';
      this.flow.card(
        'bad',
        '復健年',
        '整季都在復健室度過。<b class="dn">一場比賽也沒有上</b>——去年那一刀比誰想的都重。',
      );
      return;
    }

    this.#tjReview(() => this.#rollHealth());
  }

  /** 傷病判定要的輸入：感情與事件卡的額外風險、體力、守位、七傷拳。 */
  #healthInputs(): InjuryChanceOptions {
    const pro = this.#pro;
    const player = this.#player;
    const position =
      pro === null || player === null
        ? undefined
        : (this.#position ??
          ratingPosition(player.startPosition, {
            ability: this.#ability,
            level: pro.level,
            throws: player.throws,
          }));
    return {
      age: this.#age,
      traits: this.#traits,
      extraRisk: this.#injuryRisk + injuryRiskModifier(this.#love),
      wear: sevenFistsRisk(this.#sevenFists, this.#traits.has('rubber')),
      stamina: this.#ability['sta'],
      position,
      leagueGames: pro === null ? undefined : levelOf(pro.level).games,
    };
  }

  /**
   * 投手耐力的關卡：季前健康檢查的第一步（ADR 0051）。
   *
   * - 七傷拳撐到**天賦前**受傷機率滿 100%：這一季報銷、記一次大傷、強迫開 TJ。
   * - 耐力耗盡：問要不要開 TJ。開就是整季復健、隔季耐力回到八成；不開就掛上
   *   七傷拳，每撐一季受傷機率再累加。
   * - 還掛著七傷拳但耐力沒見底：不問，照樣再累加一季——只要沒開 TJ 它就不會走。
   *
   * 整季報銷時不再接 `then`：那一季不必再擲傷病。
   */
  #tjReview(then: () => void): void {
    const pool = this.#endurance?.pitcher;
    if (this.#pro === null || pool === undefined || !this.#pitches) {
      then();
      return;
    }

    // 天賦前的受傷機率滿 100%：韌帶真的斷了。累加之後也要再看一次——不然那一季
    // 會帶著 100% 以上的機率照常擲骰，而不是直接開刀。
    const snapped = (): boolean => {
      if (this.#sevenFists <= 0 || injuryChanceBeforeTalent(this.#healthInputs()) < 100) return false;
      this.#sevenFistsBreak('硬撐到最後，韌帶還是斷了。', null);
      return true;
    };
    if (snapped()) return;

    if (pool.value > 0) {
      if (this.#sevenFists > 0) this.#sevenFists++;
      if (snapped()) return;
      then();
      return;
    }

    this.flow.ask(
      {
        title: '健康檢查：手肘的韌帶快撐不住了',
        options: [
          {
            id: 'tj:surgery',
            label: '開 TJ',
            note: '這一季整季復健；隔季手臂回到八成',
            role: 'main',
          },
          {
            id: 'tj:endure',
            label: '打針硬撐',
            note: '照常出賽；每撐一季受傷機率再往上加，投球能力跟著掉',
            role: 'warn',
          },
        ],
      },
      (choice) => {
        if (choice === 'tj:surgery') {
          this.#surgery('rehab');
          this.flow.card(
            'info',
            'TJ 手術',
            '進了手術室。<b class="dn">這一季都在復健</b>，明年的手臂會回到八成左右。',
          );
          return;
        }
        this.#sevenFists++;
        this.#traits.add('seven_fists');
        this.#sevenFistsEver = true;
        if (snapped()) return;
        this.flow.card(
          'bad',
          '七傷拳',
          `打針上場。受傷機率 <span class="dn">+${pct(sevenFistsRisk(this.#sevenFists, this.#traits.has('rubber')))}%</span>，` +
            '而且只要不開刀，每一季都會再往上加，投球能力也會一路往下掉。',
        );
        then();
      },
    );
  }

  /**
   * 七傷拳的結局：韌帶斷了。**一律照大傷算**——全能力 −5、可能永久少一顆訓練骰、
   * 衰退期再抽兩項 −3——然後那一季報銷、強迫開 TJ、七傷拳拿掉。
   *
   * `diceLoss` 是那一次傷病已經擲好的「少一顆骰」結果；滿 100% 那條路沒有擲傷病，
   * 傳 null 就在這裡補擲一次（同一個機率，〈浴火重生〉照樣乘在上面）。
   */
  #sevenFistsBreak(opening: string, diceLoss: boolean | null): void {
    const lines = [opening];
    const loss = injuryCfg.severity.major.ability_loss.points;
    lines.push(this.#applyInjuryLoss({ kind: 'major', seasonFactor: 0, loss: { scope: 'all', points: loss }, rehabNextYear: false, diceLoss: false, text: '' }));
    this.#majorInjuries++;
    lines.push(this.#clearOldInjury());
    const aged = this.#applyAgedLoss();
    if (aged !== '') lines.push(aged);
    const lostDie = diceLoss ?? this.world.stream('health').chance(injuryCfg.severity.major.dice_loss.chance);
    if (lostDie) {
      this.#diceLost++;
      lines.push('身體再也回不到從前的訓練量：<b class="dn">往後每季的自主訓練少一顆骰</b>。');
    }
    this.#surgery('major');
    lines.push('<b class="dn">這一季報銷，而且這一次沒得選——直接開 TJ</b>。');
    this.flow.card('bad', '七傷拳', lines.filter((l) => l !== '').join('<br>'));
  }

  /** 開 TJ：這一季整季報銷，季末把投手耐力回到八成，七傷拳歸零。 */
  #surgery(kind: 'major' | 'rehab'): void {
    this.#seasonFactor = 0;
    this.#injuryRisk = 0;
    this.#seasonInjury = kind;
    this.#tjSurgeries++;
    this.#sevenFists = 0;
    this.#traits.delete('seven_fists');
    this.#tjRehab = true;
  }

  /** 季前擲一次傷病。 */
  #rollHealth(): void {
    // 感情狀態雙向回饋到傷病：穩定降風險、風波升風險。與事件卡的自找風險同性質，
    // 不受魔鬼筋肉人上限保護。體力也吃進受傷機率：40 以下加、超過這個守位的「打滿
    // 標準」減——用的是**本體能力**不是當季能力。七傷拳在夾子之外另加（ADR 0051）。
    const inputs = this.#healthInputs();
    const result = rollInjury(this.world, inputs);
    const chance = injuryChance(inputs);
    this.#injuryRisk = 0;
    this.#seasonFactor = result.seasonFactor;
    this.#seasonInjury = result.kind === 'none' ? null : result.kind;

    if (result.kind === 'none') {
      this.flow.card(
        'info',
        '健康回報',
        `本季平安出賽。<span class="sub">（受傷機率 ${pct(chance)}%）</span>`,
      );
      return;
    }

    // **七傷拳期間受傷就是韌帶斷了**：不分大傷小傷，一律照大傷扣（全能力 −5、訓練骰、
    // 衰退期再抽兩項），那一季報銷、強迫開 TJ，七傷拳跟著拿掉。開刀是「現在就認賠」；
    // 不開就是賭，賭輸了付的是大傷的全套代價。
    if (this.#sevenFists > 0) {
      this.#sevenFistsBreak(esc(result.text), result.kind === 'major' ? result.diceLoss : null);
      return;
    }

    if (result.kind === 'minor' && result.worsened !== undefined) {
      this.#askConceal(result, result.worsened, chance);
      return;
    }
    this.#settleInjury(result);
  }

  /**
   * 隱瞞傷勢：職業期的小傷當下問一次（2026-09-26）。
   *
   * 第一個選項是上報——自動代理與校準腳本都選第一個，校準數字因此不受影響。
   * 隱瞞只擲一次：輸了就是 `worsened` 那一次大傷（同一次擲骰已經擲好），贏了整季
   * 出賽、小傷的後遺症照擲，另外記一筆舊傷。
   */
  #askConceal(minor: Injury, worsened: Injury, injuryChancePercent: number): void {
    const fail = concealFailChance(injuryChancePercent);
    this.flow.ask(
      {
        title: `小傷：${minor.text}`,
        options: [
          {
            id: 'injury:report',
            label: '上報休養',
            note: '照醫囑缺賽，身體不會留下舊傷',
            role: 'main',
          },
          {
            id: 'injury:conceal',
            label: '隱瞞硬撐',
            note: `整季照常出賽，但留下舊傷（某項能力在比賽中永久打折）；${pct(fail)}% 會拖成大傷`,
            role: 'warn',
          },
        ],
      },
      (choice) => {
        if (choice === 'injury:report') {
          this.#settleInjury(minor);
          return;
        }
        if (this.world.stream('health').chance(fail)) {
          this.#seasonFactor = worsened.seasonFactor;
          this.#seasonInjury = 'major';
          this.#settleInjury(worsened);
          return;
        }
        this.#seasonFactor = 1;
        const lines = ['咬著牙沒讓任何人知道，<b class="up">整季照常出賽</b>。'];
        lines.push(this.#applyInjuryLoss(minor));
        lines.push(this.#addOldInjury());
        this.flow.card('bad', '隱瞞傷勢', lines.filter((l) => l !== '').join('<br>'));
      },
    );
  }

  /** 記一筆舊傷：從用得到的那一側抽一項能力，回傳給卡片用的敘述。 */
  #addOldInjury(): string {
    const keys = ALL_ABILITIES.filter((k) => isSideVisible(k, this.#lockedSide));
    const key = keys[this.world.stream('health').int(0, keys.length - 1)];
    if (key === undefined) return '';
    const hits = (this.#oldInjury[key] ?? 0) + 1;
    this.#oldInjury[key] = hits;
    this.#oldInjuryEver = true;
    const first = !this.#traits.has(injuryCfg.conceal.trait);
    this.#traits.add(injuryCfg.conceal.trait);
    const name = abilities.abilities[key] ?? key;
    return (
      `${first ? '取得〈舊傷〉：' : '舊傷又多一處：'}<b class="dn">${esc(name)}在比賽中只剩 ×${oldInjuryFactor(hits).toFixed(2)}</b>` +
      '<span class="sub">（能力表不變，下一次大傷時才會一起處理掉）</span>'
    );
  }

  /** 舊傷特性的說明：哪幾項打折、打多少。 */
  #oldInjuryNote(): string {
    return Object.entries(this.#oldInjury)
      .map(([key, hits]) => `${abilities.abilities[key] ?? key} ×${oldInjuryFactor(hits ?? 0).toFixed(2)}`)
      .join('、');
  }

  /** 大傷時把舊傷一起處理掉。回傳給卡片用的敘述。 */
  #clearOldInjury(): string {
    if (!this.#traits.has(injuryCfg.conceal.trait)) return '';
    this.#oldInjury = {};
    this.#traits.delete(injuryCfg.conceal.trait);
    return '這一刀連同身上的<b class="up">舊傷一起處理掉了</b>。';
  }

  /** 套用一次傷病：永久損失、大傷的連帶後果與卡片。 */
  #settleInjury(result: Injury): void {
    const lines = [esc(result.text)];
    lines.push(this.#applyInjuryLoss(result));

    if (result.kind === 'major') {
      this.#majorInjuries++;
      lines.push(this.#clearOldInjury());
      const aged = this.#applyAgedLoss();
      if (aged !== '') lines.push(aged);
      if (result.diceLoss) {
        this.#diceLost++;
        lines.push('身體再也回不到從前的訓練量：<b class="dn">往後每季的自主訓練少一顆骰</b>。');
      }
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
        '生涯第二次大傷。從此傷病如影隨形——<b class="dn">往後每季的受傷機率都有一個下限</b>。',
      );
    } else if (
      result.kind === 'major' &&
      this.#majorInjuries >= 2 &&
      !this.#traits.has('glass') &&
      // 浴火鳳凰已經從帕瓦諾走出來了，不再貼回去。
      !this.#traits.has(injuryCfg.phoenix.trait)
    ) {
      // 32 歲以後的大傷是歲月的損耗，不是體質問題。
      this.flow.card(
        'info',
        '醫療團隊評估',
        '「這是歲月的損耗，不是體質問題。」——老將的傷，球團看得比誰都開。',
      );
    }
  }

  /**
   * 巔峰結束之後的大傷再多扣一刀（issue #12）：從在用那一側、仍高於硬下限的能力裡
   * 抽幾項不同的，各扣幾點，扣到硬下限為止。已經在硬下限的不會被抽到。
   *
   * 巔峰看的是 `peak_end`——「不老妖精」把它往後延，這一條就跟著延。
   */
  #applyAgedLoss(): string {
    if (this.#age <= seasonCfg.aging.peak_end) return '';
    const keys = ALL_ABILITIES.filter((k) => isSideVisible(k, this.#lockedSide));
    const changes = agedInjuryLoss(this.world, this.#ability, keys);
    if (changes.size === 0) return '';
    for (const [key, after] of changes) this.#ability[key] = after.after;
    this.#settleCarry();
    const hit = [...changes].map(
      ([key, c]) => `${esc(abilities.abilities[key] ?? key)} −${c.before - c.after}`,
    );
    return `老將的身體恢復得慢：<b class="dn">${hit.join('、')}</b>。`;
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
    // 倒扣不打折：裂痕讓好事變少，但不會讓壞事變少。
    const scaled = points < 0 ? points : Math.round(points * rewardMultiplier(this.#love));
    if (scaled < 0) {
      this.#seasonBonus[key] = (this.#seasonBonus[key] ?? 0) + scaled;
      return (
        `<b class="dn">${esc(abilities.abilities[key] ?? key)} ${scaled}</b>` +
        '<span class="sub">（本季狀態，不計入能力表）</span>'
      );
    }
    if (scaled <= 0) {
      return `${esc(abilities.abilities[key] ?? key)}沒有起色——<span class="sub">心裡有事的人，安定不下來</span>`;
    }
    this.#seasonBonus[key] = (this.#seasonBonus[key] ?? 0) + scaled;
    return `<b class="up">${esc(abilities.abilities[key] ?? key)} +${scaled}</b><span class="sub">（本季狀態，不計入能力表）</span>`;
  }

  /**
   * 這一季實際上場用的能力：真實能力加上當季暫時能力，再乘上舊傷。
   *
   * 舊傷只在這裡打折——成績、守備分、當季定位看它，綜合評價看的是能力表，
   * 球團不知道你有舊傷。
   */
  get #seasonAbility(): Abilities {
    const hurt = Object.entries(this.#oldInjury);
    if (Object.keys(this.#seasonBonus).length === 0 && hurt.length === 0) return this.#ability;
    const out: Record<string, number> = { ...this.#ability };
    for (const [key, delta] of Object.entries(this.#seasonBonus)) {
      // 當季狀態可以是負的（縮頭烏龜），因此這裡要夾住量表的底——「比 20 更差」
      // 在球探報告上沒有對應的說法。
      out[key] = Math.max(abilities.scale.hard_floor, (out[key] ?? 0) + delta);
    }
    for (const [key, hits] of hurt) {
      out[key] = Math.max(abilities.scale.hard_floor, (out[key] ?? 0) * oldInjuryFactor(hits ?? 0));
    }
    return out as Abilities;
  }

  /**
   * 感情。每年一次，排在事件卡之前。
   *
   * **獨立於事件卡**——事件卡是球場上的事，感情是場外的事，混在同一個牌庫裡會
   * 互相稀釋。
   *
   * 規則在 `loveYear.ts`（ADR 0050），這裡只做兩件事：把步驟畫成卡片或提問，
   * 以及把步驟帶出來的意圖（能力、金錢、特性、榮銜）兌現。
   */
  #loveEvent(next: () => void): void {
    this.#runLove(
      loveYear(this.world, this.#love, {
        age: this.#age,
        year: this.#year,
        pro: this.#pro !== null,
        bestRank: this.#bestRankThisYear,
        earnings: this.#earnings,
      }),
      next,
    );
  }

  /**
   * 驅動一台感情的步驟機。
   *
   * 敘事型的步驟畫完就往下走，提問型的停下來等玩家——`flow.choose()` 會在回答
   * 時把選項 id 送回產生器，於是「這一年接下來發生什麼」由規則那邊決定，不是
   * 由這裡的巢狀 callback 決定。
   */
  #runLove(flow: LoveFlow, next: () => void, answer?: string): void {
    const result = answer === undefined ? flow.next() : flow.next(answer);
    if (result.done === true) {
      next();
      return;
    }
    const step = result.value;
    if (step.kind === 'tell') {
      this.#loveTell(step);
      this.#runLove(flow, next, '');
      return;
    }
    this.flow.ask(this.#lovePrompt(step), (choice) => {
      this.#runLove(flow, next, choice);
    });
  }

  /** 升學或進職業時的關卡。規則見 `loveCheckpoint()`——這裡只負責講。 */
  #loveCheckpoint(label: string): void {
    this.#runLove(loveCheckpoint(this.world, this.#love, label), () => {});
  }

  /**
   * 換了體系之後的感情安排。**每一條換體系的路都走這裡**：挖角、自由市場、戰力外
   * 尋路、入札（申請旅美）、下放時的他隊邀請。以前只有挖角會問，於是被放生到墨聯的
   * 人，對象就這樣默默跟過去了。
   *
   * 去海外就問帶她走、遠距離還是分手——海外之間轉隊也重問一次，新的國家是新的適應
   * 期；回到母國是團聚，不問，旅外的安排直接清掉。
   */
  #afterMove(offer: { readonly org: string; readonly orgName: string }, next: () => void): void {
    if (offer.org === leagues.transfer.home_org.value) {
      this.#love.overseas = 'none';
      this.#love.overseasYears = 0;
      next();
      return;
    }
    this.#loveOverseas(offer.orgName, next);
  }

  /** 旅外時對這段關係的安排。 */
  #loveOverseas(orgName: string, next: () => void): void {
    this.#runLove(
      loveOverseas(
        this.#love,
        {
          age: this.#age,
          year: this.#year,
          pro: this.#pro !== null,
          bestRank: this.#bestRankThisYear,
          earnings: this.#earnings,
        },
        orgName,
      ),
      next,
    );
  }

  /**
   * 兌現一步的意圖，回傳要寫進卡片的那幾句。
   *
   * **抽取留在這裡**：挑哪一項能力要看這一側在用哪些，那是這個類別才知道的事。
   * 位置沒有變——規則那邊 `yield` 出步驟的當下，就是從前呼叫這些 helper 的當下。
   */
  #applyLoveEffects(effects: readonly LoveEffect[]): readonly string[] {
    const lines: string[] = [];
    for (const effect of effects) {
      switch (effect.kind) {
        case 'bonus':
          lines.push(this.#grantSeasonBonus(this.#pickVisible(effect.choices), effect.points));
          break;
        case 'bonus-random':
          lines.push(this.#grantSeasonBonus(this.#randomVisibleAbility(), effect.points));
          break;
        case 'ability-loss':
          lines.push(this.#loseAbility(effect.points));
          break;
        case 'all-ability-loss':
          for (const key of ALL_ABILITIES.filter((k) => isSideVisible(k, this.#lockedSide))) {
            this.#ability[key] = Math.max(
              abilities.scale.hard_floor,
              (this.#ability[key] ?? 0) - effect.points,
            );
          }
          this.#settleCarry();
          lines.push(`<br><b class="dn">全能力 −${effect.points}</b>（花樣年華的代價）。`);
          break;
        case 'money':
          this.#earnings = Math.max(0, this.#earnings + effect.amount);
          break;
        case 'trait':
          this.#unlockTrait(effect.id, LOVE_TRAIT_TEXT[effect.id] ?? '');
          break;
        case 'honor':
          this.#addHonor(effect.name);
          break;
      }
    }
    // 外遇次數在 loveYear 裡累加——〈外務纏身〉看代言與外遇的合計。
    const distract = this.#checkDistract();
    if (distract !== '') lines.push(distract);
    return lines;
  }

  /** 一步的提問：選項 id 由規則那邊給，這裡只決定怎麼寫。 */
  #lovePrompt(step: LoveAsk): Prompt {
    const love = this.#love;
    switch (step.id) {
      case 'confess': {
        const desc = partnerProfile(step.partner);
        return {
          title: `${step.partner}最近常常在球場邊等你`,
          options: [
            {
              id: 'love:confess',
              label: '找個機會告白',
              note: `成功率 ${pct(step.chance)}%｜${step.rank === null ? '今年沒有大賽成績' : `今年打到${step.rank}`}｜${desc}`,
              role: 'main',
            },
            { id: 'love:wait', label: '再說吧，先專心打球' },
          ],
        };
      }
      case 'public-confirm':
        return {
          title: '記者把麥克風遞到你面前：「兩位是在交往嗎？」',
          options: [
            {
              id: 'love:admit',
              label: '大方承認：「請大家祝福我們」',
              note: '還要看她那邊敢不敢承認——啦啦隊的禁愛令壓力不小',
            },
            { id: 'love:dodge', label: '笑而不答，快步走過', note: '不承認就沒有下文', role: 'main' },
          ],
        };
      case 'proposal':
        return {
          title:
            step.partner2 === null
              ? `交往第 ${step.years} 年——${step.partner} 看著別人的婚禮影片看了很久`
              : `交往第 ${step.years} 年——${step.partner} 與 ${step.partner2} 一起看著別人的婚禮影片`,
          options: [
            {
              id: 'love:propose',
              label: '就是現在——求婚',
              note: '本季狀態提升，而且往後的受傷率下降',
              role: 'main',
            },
            { id: 'love:later', label: '再存一點錢吧', note: '她沒說什麼，但交往越久分手風險越高' },
          ],
        };
      case 'turmoil':
        // 標籤留在提問區，敘事留給卡片——提問區的 .title 是 12px 的小標，長文案在
        // 那裡等於沒寫，而且不會進事件記錄（#22／#28）。
        return {
          title: '感情出現裂痕 · 你要怎麼處理？',
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
            ...(step.openable
              ? [
                  {
                    id: 'love:open',
                    label: '「那就……讓他也留下來吧。」',
                    note: '關係保住了，往後不會再有風波——但你每年都要付一點代價，而且走不掉',
                    role: 'warn' as const,
                  },
                ]
              : []),
          ],
        };
      case 'affair':
        return {
          title: step.married
            ? `客場飯店酒吧，${step.other} 傳來訊息：「睡了嗎？」`
            : `聚餐散場，${step.other} 說順路想搭你的車`,
          options: [
            {
              id: 'love:affair',
              label: step.married ? '赴約' : '讓她上車',
              note: '沒被抓到＝本季狀態提升｜被抓到＝能力重挫、感情危機',
              role: 'warn',
            },
            {
              id: 'love:decline',
              label: step.married
                ? '回訊息：「陪小孩讀完故事書了，晚安」'
                : `「不順路。」直接載 ${love.partner} 回家`,
              note: '穩定，絕對不虧',
              role: 'main',
            },
          ],
        };
      case 'caught':
        return {
          title: step.married
            ? `${love.partner} 把離婚協議書放在餐桌上`
            : `${love.partner} 已讀不回三天後，終於答應見面`,
          options: [
            {
              id: 'love:apologise',
              label: '道歉，求她再給一次機會',
              note: `成功率 ${pct(loveCfg.affair.caught.apology_success)}%｜失敗要再扣能力並${step.married ? '離婚' : '分手'}`,
              role: 'main',
            },
            { id: 'love:accept', label: step.married ? '簽字離婚' : '坦然分手', role: 'warn' },
            ...(step.openable
              ? [
                  {
                    id: 'love:open',
                    label: `「要不……${step.other} 也一起？」`,
                    note: '兩位都留下來：每年的感情回報與生子各擲各的——但風波加倍，而且破局是兩份一起賠',
                    role: 'warn' as const,
                  },
                ]
              : []),
          ],
        };
      case 'overseas':
        return {
          title: `要去${step.orgName}了。${step.partner} 站在還沒收的行李旁邊`,
          options: [
            {
              id: 'love:bring',
              label: '帶她一起走',
              note: `養家要花 ${fmtMoney(step.cost)}｜前兩年新鮮，第三四年最難熬，之後會回穩`,
              role: 'main',
            },
            {
              id: 'love:apart',
              label: '先遠距離看看',
              note: '她的人生還在，只是你們的時差對不上——一直都不會太穩',
            },
            { id: 'love:end', label: '分手，不拖累她', role: 'warn' },
          ],
        };
    }
  }

  /** 一步的敘事。先兌現意圖拿到那幾句，再把它們寫進卡片。 */
  #loveTell(step: LoveTell): void {
    const lines = this.#applyLoveEffects(step.effects);
    const gain = lines.join('');
    switch (step.id) {
      case 'confess-skipped':
        this.flow.card('info', '再說吧', '你把話吞回去，走進打擊籠。');
        break;
      case 'confess-rejected':
        this.flow.card(
          'info',
          '被拒絕了',
          `${esc(step.partner)}低著頭說「對不起」。接下來那一週，你在走廊上都繞路。`,
        );
        break;
      case 'scandal': {
        const desc = partnerProfile(step.partner);
        this.flow.card(
          'info',
          '場外話題',
          `你和啦啦隊的 <b class="hl">${esc(step.partner)}</b> 被拍到球場外同框，緋聞登上娛樂版頭條。` +
            (desc === '' ? '' : `<br><span class="sub">${esc(desc)}</span>`) +
            (step.divorced ? '<br><span class="sub">（評論區：「離過婚還這麼搶手」）</span>' : ''),
        );
        break;
      }
      case 'scandal-faded':
        this.flow.card('info', '未完待續', '緋聞燒了三天就退燒。也許時機還沒到。');
        break;
      case 'scandal-denied':
        this.flow.card(
          'bad',
          '單方面承認',
          `她隔天透過經紀公司否認：「只是普通朋友。」據傳<b class="dn">禁愛令</b>壓力不小。你一個人站在風裡。`,
        );
        break;
      case 'dating-started':
        this.flow.card(
          'gold',
          step.fromSchool ? '在一起了' : '戀情公開',
          step.fromSchool
            ? `放學後的河堤，你們並肩走了很久。${esc(step.partner)}說：「我一直都有在看你比賽。」——${gain}`
            : `<b class="hl">${esc(step.partner)}</b> 在社群發出十指緊扣的照片：「謝謝大家的祝福。」——${gain}`,
        );
        break;
      case 'proposal-later':
        this.flow.card('info', '再等等', '她關掉影片，笑著說沒事。你假裝沒看到她眼裡的東西。');
        break;
      case 'wedding': {
        const brides =
          step.partner2 === null
            ? `<b class="hl">${esc(step.partner)}</b> 哭著點頭。`
            : `<b class="hl">${esc(step.partner)}</b> 與 <b class="hl">${esc(step.partner2)}</b> 一起點了頭。`;
        this.flow.card(
          'gold',
          '婚禮',
          `你在主場本壘板後方單膝跪地，大螢幕打出「Marry Me」。${brides}` +
            `休賽季完婚，紅毯用壘包排成——${gain}`,
        );
        break;
      }
      case 'childbirth':
        this.flow.card(
          'gold',
          '新生命',
          `${esc(step.partner)} 平安生下你們的第 <b class="hl">${step.nth}</b> 個孩子。` +
            `當了${step.total > 1 ? '幾次' : ''}爸爸的男人，眼神都不一樣了——${gain}`,
        );
        break;
      case 'turmoil-swallow':
        this.flow.card(
          'bad',
          '沒有問出口',
          `${turmoilText(step.kindId)}<br><br>` +
            `你把話吞了回去。那天之後你們還是一起吃飯、一起睡覺，只是有些話再也沒有提起。` +
            `<br><span class="sub">裂痕 ${step.cracks} 道——往後的日子會越來越不平靜。</span>`,
        );
        break;
      case 'cuckold':
        this.flow.card(
          'bad',
          '一個屋簷下',
          `${turmoilText(step.kindId)}<br><br>你沒有問，也沒有走。你只是說：「那就這樣吧。」` +
            '<br><span class="sub">往後不會再有風波了——該發生的都已經發生過。至於孩子⋯⋯</span>',
        );
        break;
      case 'harem':
        this.flow.card(
          'gold',
          step.married ? '三個人的家' : '三個人的關係',
          `事情沒有照任何人預期的方向發展。<b class="hl">${esc(step.other)}</b> 留了下來。` +
            '<br><span class="sub">往後每年的感情回報與生子，兩邊各擲各的——但三個人的日子也比兩個人難走。</span>',
        );
        break;
      case 'affair-declined':
        this.flow.card('good', '正確答案', `心定了，身體就穩了——${gain}`);
        break;
      case 'affair-escaped':
        this.flow.card(
          'bad',
          step.married ? '深夜行程' : '深夜兜風',
          `沒有人拍到。不知為何，罪惡感反而讓你精神亢奮——${gain}` +
            '<br><span class="sub">（你知道這不會有好下場）</span>',
        );
        break;
      case 'affair-caught':
        this.flow.card(
          'bad',
          step.married ? '頭版醜聞' : '劈腿曝光',
          `狗仔的鏡頭比你想的更快，照片鋪滿版面。贊助商緊急撤圖。${gain}`,
        );
        break;
      case 'apology-accepted':
        this.flow.card(
          'info',
          '低谷之後',
          `長談了一整夜。<b class="hl">${esc(step.partner)}</b> 最後說：「最後一次。」` +
            '關係保住了，但有些東西回不去了。',
        );
        break;
      case 'breakup':
        this.#breakupCard(step, gain);
        break;
      case 'flavour':
        this.#flavourCard(step, gain);
        break;
      case 'overseas-bring':
        this.flow.card(
          'gold',
          '舉家旅外',
          `兩張單程機票。她辭掉了工作，說「反正我本來也想換個環境」。` +
            `<br>安家費 <b class="dn">−${fmtMoney(step.cost)}</b>。`,
        );
        break;
      case 'overseas-apart':
        this.flow.card(
          'info',
          '遠距離',
          '登機前她抱了你很久，然後推你進安檢。往後的日子靠時差對不上的視訊撐著。',
        );
        break;
    }
    this.#applyLoveEffects(step.after);
  }

  /** 分手或離婚那張卡。離婚要分財產——**一個只會增加的數字不是資產，是計分板**。 */
  #breakupCard(step: LoveTell & { id: 'breakup' }, lossLine: string): void {
    const reason = step.reason;
    const said =
      reason.id === 'waited-too-long'
        ? `交往 ${reason.years} 年，婚期一延再延。<b class="hl">${esc(step.ex)}</b> 最後留下一句：「我等不到了。」`
        : reason.id === 'turmoil-leave'
          ? `${turmoilText(reason.kindId)}<br><br>你問了，她也答了。然後你們都知道結束了。${lossLine}`
          : reason.id === 'apology-failed'
            ? `她聽完只是搖頭，隔天律師的存證信函就到了。${lossLine}`
            : reason.id === 'accept'
              ? step.wasMarried
                ? '你在協議書上簽了名。'
                : '她把你送的東西整箱寄回。'
              : reason.id === 'cuckold-exit'
                ? step.wasMarried
                  ? '這一次換她把協議書推回來。你們都沒有再說什麼——那張桌子上該說的話，前幾年就說完了。'
                  : '她看完新聞只回了一句「所以呢」，然後把你封鎖了。'
                : reason.id === 'overseas-end'
                  ? '你說了那句「不要等我」。她沒有哭，只是點頭。'
                  : `${esc(reason.label)}的那個夏天，<b class="hl">${esc(step.ex)}</b> 說：「我們可能不會再見面了吧。」` +
                    '<br><span class="sub">沒有人做錯什麼，只是路不同了。</span>';

    // 關卡那一條是「各奔東西」，語氣與分手不同：沒有人做錯什麼。
    if (reason.id === 'checkpoint') {
      this.flow.card('bad', '各奔東西', said);
      return;
    }

    const money =
      step.money === 0
        ? ''
        : step.money > 0
          ? `<br>財產分配：<b class="up">+${fmtMoney(step.money)}</b>（這一次你是收的那一方）。`
          : `<br>財產分配：<b class="dn">−${fmtMoney(-step.money)}</b>${step.kids > 0 ? '（含扶養費）' : ''}。`;
    const ex2 = step.ex2 === null ? '' : `與 <b class="hl">${esc(step.ex2)}</b>`;
    this.flow.card(
      'bad',
      step.wasMarried ? '離婚' : '分手',
      `${said}<br><b class="hl">${esc(step.ex)}</b>${ex2} 從此不在你的生活裡了。${money}`,
    );
  }

  /** 平淡但溫暖的一年。感情線多數的年份都是這種。 */
  #flavourCard(step: LoveTell & { id: 'flavour' }, gain: string): void {
    const partner = esc(step.partner);
    switch (step.variant) {
      case 'cuckold':
        this.flow.card(
          'bad',
          '一個屋簷下',
          `客廳的燈亮著，玄關多了一雙不是你的鞋。你把裝備袋放下，自己走進房間——${gain}`,
        );
        return;
      case 'harem':
        this.flow.card(
          'good',
          '三個人的日常',
          `客場回來，<b class="hl">${partner}</b> 與 <b class="hl">${esc(step.partner2 ?? '')}</b> 一起在機場等你。` +
            `旁邊的人一臉困惑，你們三個人倒是很自在——${gain}`,
        );
        return;
      case 'married-kids':
        this.flow.card(
          'good',
          '球場邊的父親',
          `你被拍到賽前隔著護網教孩子怎麼戴手套，影片配文「最強棒球教室」瘋傳——${gain}`,
        );
        return;
      case 'married':
        this.flow.card(
          'good',
          '結婚紀念日',
          `你推掉了自主訓練，陪 <b class="hl">${partner}</b> 回到當年辦婚禮的場地。她說：「明年也要來喔。」——${gain}`,
        );
        return;
      case 'school':
        this.flow.card(
          'good',
          '放學後',
          `練習結束天已經黑了，${partner}還在看台上寫作業等你。回家的路上你們什麼都聊——${gain}`,
        );
        return;
      case 'pro':
        this.flow.card(
          'good',
          '愛情長跑',
          `沒有大新聞，只有每個客場系列賽結束後，機場出口那杯 <b class="hl">${partner}</b> 替你買好的熱美式——${gain}`,
        );
    }
  }

  /** 扣一項隨機能力，回傳要寫進卡片的那一句。 */
  #loseAbility(points: number): string {
    const key = this.#randomVisibleAbility();
    const before = this.#ability[key] ?? 0;
    this.#ability[key] = Math.max(abilities.scale.hard_floor, before - points);
    this.#settleCarry();
    const lost = before - (this.#ability[key] ?? 0);
    return lost > 0 ? `<br><b class="dn">${esc(abilities.abilities[key] ?? key)} −${lost}</b>。` : '';
  }

  /** 隨機挑一項這一側實際在用的能力。 */
  /**
   * 從候選裡挑一項**在用那一側**的能力。野手交女友不該加到投手的能力上（issue #15）。
   * 候選全在另一側時退回任一項在用的能力——當季狀態總得落在他用得到的地方。
   */
  #pickVisible(choices: readonly AbilityKey[]): AbilityKey {
    const pool = choices.filter((k) => isSideVisible(k, this.#lockedSide));
    if (pool.length === 0) return this.#randomVisibleAbility();
    return pool[this.world.stream('career').int(0, pool.length - 1)] ?? pool[0]!;
  }

  #randomVisibleAbility(): AbilityKey {
    const keys = ALL_ABILITIES.filter((k) => isSideVisible(k, this.#lockedSide));
    const pool = keys.length > 0 ? keys : ALL_ABILITIES;
    return pool[this.world.stream('career').int(0, pool.length - 1)] ?? 'sta';
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
        tier: this.#handednessTier,
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

    const line = this.#accumulateNationalStats(result.rankIndex);
    // MVP 現在要看成績，因此判定排在成績生成之後。骰子仍然在 playTournament
    // 裡擲、擲同樣的次數——移動的是判定，不是抽取。
    const mvp = winsMvp({
      roll: result.mvpRoll,
      rank: result.rank,
      winPct: this.#intlWinPct(line),
      traits: this.#traits,
    });
    this.#intlSeasons.push({
      year: this.#year,
      age: this.#age,
      tournament: tournament.name,
      rank: result.rank,
      mvp,
      batting: line.batting,
      pitching: line.pitching,
      ...this.#eventFielding(this.#seasonAbility, this.#fieldPosition ?? DH, tournamentPar(), line.batting),
    });
    this.#grantPoints(result.points);
    // 一屆賽會打完，下季的受傷風險上升。國家隊不是免費的榮耀。
    this.#injuryRisk += result.injuryNextSeason;
    // 奪冠的隔年多擲訓練骰，與養成期的大賽同一套。
    if (result.rankIndex === 0) this.#lastChampionships.push('PRO');

    // **不帶年份**：2030 與 2034 的經典賽冠軍是同一項成就（見 ADR 0031 的鄰居
    // ——成就 id 本來就要去年份）。年份留在生涯日誌裡，不留在榮譽的名字上。
    if (isHonorRank(result.rank)) {
      this.#addHonor(joinName(intl.honor_prefix, tournament.name, result.rank));
    }
    let mvpLine = '';
    if (mvp) {
      this.#addHonor(joinName(intl.honor_prefix, tournament.name, intl.mvp.suffix));
      mvpLine = `你被選為<b class="hl">賽會 ${intl.mvp.suffix}</b>！`;
    }
    this.#intlScore += tournamentScore(result.rank, mvp);

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
        '只要穿上那件球衣，你的痛覺就會消失——你是為大場面而生的男人。' +
          '<b class="hl">國際賽不再增加受傷風險，而且每次徵召的能力點有保底</b>。',
      );
    }
    if (unlocksTaiwan({ caps: this.#counts.internationalCaps, traits: this.#traits })) {
      this.#unlockTrait(
        intl.taiwan_trigger.trait,
        '永遠把國家榮耀放在比職涯更高的位子。台灣球迷心中永遠有一幅畫：你在球場上向全場比劃著胸口，那是你心中最榮耀的地方。',
      );
    }
  }

  /**
   * 這一屆的勝率：**投打兩側的份額相加**再算。
   *
   * 二刀流是一個人，拆成兩個半個人去比會讓他兩邊都不夠看。基準線用賽會自己的
   * par——MVP 問的是「這屆賽會裡誰最好」，那是一場比較，全場必須同一條線；跟著
   * 誰的母聯盟走的話，語意就變成「某些人的 MVP 比較便宜」（同 ADR 0017 的立場）。
   */
  #intlWinPct(line: {
    batting: BattingLine | null;
    pitching: PitchingLine | null;
  }): number | null {
    if (line.batting === null && line.pitching === null) return null;
    const base = baselineAt(tournamentPar());
    const shares = sumShares(
      line.batting === null ? { win: 0, loss: 0 } : battingShares(line.batting, base),
      line.pitching === null ? { win: 0, loss: 0 } : pitchingShares(line.pitching, base),
    );
    return shares.win + shares.loss === 0 ? null : winPct(shares);
  }

  /**
   * 養成期與國際賽的守備分與守備帳：沒有聯盟層級，平均線用那一段的 par 加守位
   * 偏移（`defenseMarkAt`）。這兩段的賽事短、每場都上，出賽比重視為 1——守備
   * 分因此就是純值，責任額照這一段實際上了幾場算。
   *
   * **記錄當下就算好**：守備分要的是那一季的能力，引退時回頭算只拿得到最後一年的。
   */
  #eventFielding(
    ability: Abilities,
    position: string | null,
    par: number,
    batting: BattingLine | null,
  ): { defenseRuns: number; fielding: Shares } {
    const none = { defenseRuns: 0, fielding: { win: 0, loss: 0 } };
    if (position === null || batting === null || batting.games === 0) return none;
    const mark = defenseMarkAt(ability, position, par);
    if (mark === null) return none;
    return {
      defenseRuns: Math.round(mark),
      fielding: fieldingShares({
        defenseMark: mark,
        positionShare: fieldingResponsibility(position),
        leagueGames: batting.games,
        gamesShare: 1,
      }),
    };
  }

  /**
   * 累積國際賽的個人成績。
   *
   * **復用球季模型**：把國際賽的 par 與場次直接傳進去，不在 `leagues.json` 建一個
   * 假層級——那會污染階梯、落地與升降級的邏輯。欄位因此與職業完全一致。
   */
  #accumulateNationalStats(rankIndex: number): {
    batting: BattingLine | null;
    pitching: PitchingLine | null;
  } {
    const empty = { batting: null, pitching: null };
    const pro = this.#pro;
    const player = this.#player;
    const r = this.rating;
    if (pro === null || player === null || r === null) return empty;
    let tourneyBatting: BattingLine | null = null;
    let tourneyPitching: PitchingLine | null = null;

    const position = this.#fieldPosition ?? DH;
    // 層級只借它的守位表與角色設定，**水準與場次都另外指定**：par 直接傳賽會的，
    // 場次直接傳這一屆上了幾場。
    //
    // 舊做法是把 `overall` 平移到聯盟的尺上、不動 par。在「率 = base + d × 斜率」
    // 的年代那是等價的（每條率只吃 d），但紀錄錨定模型的每一格都拿**個別能力**去
    // 比 par——平移 overall 動不到那些格子，國際賽的門檻會悄悄退回中職。
    const level = pro.level;
    const side = this.#lockedSide ?? (r.pitcher >= r.fielder ? 'pitcher' : 'fielder');
    const par = tournamentPar();
    // **兩側各認自己那一側**，與聯盟球季同一份扣分（issue #2）：那個扣分講的是
    // 「這一側的實力沒有那麼強」，與賽事長短無關。強打弱投的二刀流從前在這裡
    // 是以棒子撐起來的 overall 在投球。
    const sides = sideOveralls(r);

    if (side === 'pitcher' || this.isTwoWay) {
      // **照登錄的定位打。** 定位是定位會議決定的，不是每次算成績時重新判定——
      // 這裡從前只拿它決定上幾場，卻沒有傳進去，於是成績那一層走了它的退路
      // 現算一次；而現算只看體力與球威，體力夠的終結者因此被拉去先發，那幾場
      // 還全部算成先發（`starts = isStarterRole(role) ? games : 0`）。
      //
      // 還沒有登錄定位的人（剛升上來還沒開過會、或這季根本沒投球的二刀流）就
      // 讓成績那一層現算——那個退路的意思本來就是「這個呼叫端還沒有定位會議」。
      const role = this.#pitcherRole;
      const games = tournamentGames(rankIndex, isStarterRole(role ?? 'SP') ? 'starter' : 'reliever');
      const line = proPitchingLine(
        this.world,
        this.#seasonAbility,
        level,
        sides.pitching,
        this.#standards,
        {
          // 上幾場與以什麼定位上是同一件事，綁在一起傳（見 PitchingLineOptions）。
          usage: { role, appearances: games },
          par,
          innings: tournamentInnings(),
          // 勝敗要知道「他的球隊有多強」，而國際賽沒有戰力表。拿這一屆的名次
          // 去推是循環論證——名次是結果。改由母國頂級聯盟當年的浮動 par 對上
          // 賽會的 par 推導，見 nationalTeamWinPct。
          teamWinRate: nationalTeamWinPct(
            leagueStandardOf(this.#standards, homeBenchmarkLevel()).par,
          ),
        },
      );
      this.#intlPitching = addPitching(this.#intlPitching, line);
      tourneyPitching = line;
    }
    if (side === 'fielder' || this.isTwoWay) {
      const games = tournamentGames(rankIndex, 'batter');
      const line = proBattingLine(
        this.world,
        this.#seasonAbility,
        position,
        level,
        sides.batting,
        this.#standards,
        { appearances: games, par, catcherSeasons: this.#catcherSeasons },
      );
      this.#intlBatting = addBatting(this.#intlBatting, line);
      tourneyBatting = line;
    }
    return { batting: tourneyBatting, pitching: tourneyPitching };
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

    // 大聯盟 10-5 條款：年資買到的否決權，〈烏鴉〉也拿不走。
    const tf = seasonCfg.trade.ten_and_five;
    const org = levelOf(pro.level).org;
    if (
      org === tf.org &&
      (this.#orgYears.get(org) ?? 0) >= tf.league_years &&
      (this.#teamYears.get(pro.team)?.years ?? 0) >= tf.team_years
    ) {
      this.#tradeVeto('10-5 條款');
      return;
    }

    if (this.#traits.has('cancer')) {
      this.#executeTrade();
      this.flow.card('bad', '毒瘤交易', '球團受夠了休息室的氣氛，直接把你打包送走。');
      return;
    }

    const par = leagueStandardOf(this.#standards, pro.level).par;
    if (isStar(this.rating?.overall ?? 0, par)) {
      this.#tradeVeto();
      return;
    }
    this.#tradeRumor();
  }

  /** 明星（或 10-5 條款）的否決權。留下來要付代價，但那件球衣他留住了。 */
  #tradeVeto(why: string | null = null): void {
    const t = seasonCfg.trade.refuse;
    this.flow.ask(
      {
        title: `交易大限：他隊送來報價，球團徵詢你的否決權${why === null ? '' : `（${why}）`}`,
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
              '你又一次對媒體大吐苦水。球團高層看在眼裡——這種選手，留著也是不定時炸彈。' +
                '<b class="dn">往後被交易的機率永久提高</b>。',
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
    this.#teamChangeCheck();
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
    salary: number,
  ): readonly SeasonRecord[] {
    const pro = this.#pro;
    if (pro === null) return [];

    const from = pro.tradedFrom;
    if (from === null) {
      this.#recordSeason(batting, pitching, defense, pro.team, salary);
      const one = this.#seasons.at(-1);
      return one === undefined ? [] : [one];
    }

    const ratio = tradeSplit(this.world);
    const bat = batting === null ? null : splitBatting(batting, ratio);
    const pit = pitching === null ? null : splitPitching(pitching, ratio);
    const d1 = Math.round(defense * ratio);
    // 年薪照同一個比例拆：合約跟著人走，前半季與後半季各付各的。相減而不是各自
    // 四捨五入，兩段加起來才精確等於全年。
    const s1 = Math.round(salary * ratio);

    this.#recordSeason(bat?.[0] ?? null, pit?.[0] ?? null, d1, from, s1);
    this.#recordSeason(bat?.[1] ?? null, pit?.[1] ?? null, defense - d1, pro.team, salary - s1);
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
    salary: number,
  ): void {
    const pro = this.#pro;
    if (pro === null) return;
    const info = levelOf(pro.level);
    // 暫存的簽約金記在簽下之後的第一段上——季中被交易的那一年，它屬於開季時的
    // 那一隊，也就是第一段。
    const bonus = this.#pendingBonus;
    this.#pendingBonus = 0;
    const now = leagueStandardOf(this.#standards, pro.level);
    const baseline = proBaseline(pro.level);
    // 球隊戰績決定兩本帳怎麼切——0 勝的球隊沒有勝利份額可分。二軍沒有聯盟
    // 戰力表，那裡的球隊勝率視為未知，不做調整。
    const teamWinRate = this.#league?.get(team)?.winRate ?? null;

    // 守備的份額：投手與指定打擊沒有守備責任，二軍也不算——二軍現在同樣有
    // 登錄守位（ADR 0037），但守備勝利份額是與同層對手比出來的，那一層不進帳。
    let fielding: Shares = { win: 0, loss: 0 };
    let fieldingK = 0;
    const fieldPosition = info.top === undefined ? null : this.#position;
    if (fieldPosition !== null && fieldPosition !== DH && batting !== null) {
      const average = positionAverage(fieldPosition, pro.level, this.#standards);
      if (average !== null) {
        fielding = fieldingShares({
          defenseMark: defenseMark(defenseScore(this.#ability, fieldPosition), average),
          positionShare: fieldingResponsibility(fieldPosition),
          leagueGames: info.games,
          gamesShare: batting.games / info.games,
          teamWinRate,
        });
        const p0 = fieldingReplacementWinPct();
        fieldingK = p0 >= 1 ? 0 : p0 / (1 - p0);
      }
    }

    this.#seasons.push({
      year: this.#year,
      age: this.#age,
      org: info.org,
      level: pro.level,
      levelName: info.name,
      team,
      // 生涯表問的是他當年站哪裡。三個階段都有登錄守位，沒有留白的那幾列。
      position: this.#fieldPosition,
      // 投手的定位同理：體力掉下來的那一年他從輪值變成牛棚，那是生涯的轉折。
      pitcherRole: (pitching as ProPitchingLine | null)?.role ?? null,
      batting,
      pitching,
      injured: this.#seasonInjury,
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
      salary,
      bonus,
    });

    // 記分板的「最近一季」要的是同一份數字。三本帳**分開帶**——野手表取打擊加
    // 守備、投手表取投球，兩張表各取自己該取的那幾本。
    const last = this.#seasons.at(-1);
    this.#seasonShares = last?.shares ?? null;
    this.#seasonWar = last === undefined ? null : warOf(last);
  }

  /**
   * 年度獎項。
   *
   * 只在頂級聯盟評獎——二軍沒有年度獎項。獎項存成結構化紀錄供計分使用，同時
   * 把名稱寫進去重的榮譽清單供顯示（見 #addHonor 的說明：清單是「他做到過
   * 什麼」，次數要看結構化紀錄）。
   */
  #annualAwards(batting: BattingLine | null, pitching: ProPitchingLine | null, availability: number): void {
    const pro = this.#pro;
    if (pro === null) return;
    const info = levelOf(pro.level);
    if (info.top === undefined) return;

    const r = this.rating;
    const par = leagueStandardOf(this.#standards, pro.level).par;

    // 守備勝率：獎項判定看它而不是守備分的顯示數字——顯示尺度可以隨時調整，
    // 判定不該跟著跑掉。
    let fieldingWinPct: number | null = null;
    const fieldPosition = this.#position;
    if (fieldPosition !== null && fieldPosition !== DH && batting !== null) {
      const average = positionAverage(fieldPosition, pro.level, this.#standards);
      if (average !== null) {
        fieldingWinPct = winPct(
          fieldingShares({
            defenseMark: defenseMark(defenseScore(this.#ability, fieldPosition), average),
            positionShare: fieldingResponsibility(fieldPosition),
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
      position: fieldPosition,
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
      pitchingWinShares: this.#seasons.at(-1)?.shares.pitching.win ?? 0,
      // 明星賽看的勝率：投打守三本相加，二刀流是一個人。
      winPct: (() => {
        const shares = this.#seasons.at(-1)?.shares;
        return shares === undefined ? 0.5 : winPct(sumShares(shares.batting, shares.pitching, shares.fielding));
      })(),
      availability,
      homeFaith: this.#traits.has(awardsCfg.all_star.home_faith.trait),
    });
    if (won.length === 0) return;
    const cured = this.#cureYips('拿下年度獎項');
    if (cured !== '') this.flow.card('good', '巧克力解除', cured.replace(/^<br>/, ''));

    this.#awards.push(...won);
    const orgName = leagues.top_league_names[info.org] ?? info.org;
    for (const a of won) this.#addHonor(joinName(orgName, a.name));
    this.flow.card('gold', '年度獎項', won.map((a) => esc(a.name)).join('｜'));
  }

  /**
   * 今年誰奪冠。
   *
   * **從全聯盟按機率抽一支，不是對自己那支隊擲一次。** 兩者的期望值一樣，但抽
   * 一支保證每年恰好有一個冠軍，於是「別隊奪冠」也是看得到的事——那才是一個有
   * 別人的聯盟。機率就是畫面上那個數字（`championshipOdds`），夾在該聯盟的上下
   * 限之後照比例縮放回 1。
   *
   * 冠軍歸自己時的三件事是刻意的：
   *
   * **只有頂級聯盟的冠軍算榮譽。** 二軍與小聯盟沿用母隊的隊名，所以在 2A 的人
   * 也會看到母隊奪冠的消息——但那一年他不在一軍，戒指不是他的。
   *
   * **一季只認一支球隊：球季結束時所屬的那一支。** 季中被交易的人不會因為待過
   * 兩支球隊就有兩次機會。現實裡冠軍戒指也是給最後那支隊的人。
   *
   * **傷缺整季照樣算。** 冠軍是球隊的事，而他是那支球隊的人（同
   * `championshipDice` 對傷缺球季的處理）。
   *
   * 否決過交易的人機率打折（`trade.refuse.championship_factor`）：球團的重建計畫
   * 被打亂了，而那件事有代價。折扣用「重抽一次、命中才換成別隊」實作，因為機率
   * 表本身是全聯盟共用的——不能為了一個人把別隊的機率改掉。
   *
   * 不給訓練骰——國內奪冠的回報是評價分與榮譽，見 `abilities.json` 的
   * `championship_bonus._scope_note`。見 ADR 0045。
   */
  #championship(): void {
    const pro = this.#pro;
    const table = this.#league;
    if (pro === null || table === null) return;

    // 〈今晚打老虎〉：季後賽撐得住，所屬球隊的奪冠權重 ×1.2。
    const champion = pickChampion(this.world, table, championshipBoost(pro.team, this.#traits));
    if (champion === null) return;

    const info = levelOf(pro.level);
    const orgName = leagues.top_league_names[info.org] ?? info.org;
    const name = awardsCfg.championship.name;

    // 抽取次數不能隨結果變動，所以這一擲一律先做（ADR 0002）。
    const refused = this.#tradeRefuseYears > 0;
    const stolen = this.world
      .stream('career')
      .chance((1 - seasonCfg.trade.refuse.championship_factor) * 100);

    const mine = champion === pro.team && !(refused && stolen);
    if (!mine) {
      const who = champion === pro.team ? `${pro.team}（但那一年你不在陣中）` : champion;
      this.flow.card('info', name, `<b class="hl">${esc(who)}</b> 拿下${esc(orgName)}${name}。`);
      return;
    }

    if (info.top === undefined) {
      this.flow.card(
        'info',
        name,
        `母隊 <b class="hl">${esc(pro.team)}</b> 拿下${esc(orgName)}${name}。` +
          `<br><span class="sub">你在${esc(info.name)}，這一枚戒指不是你的。</span>`,
      );
      return;
    }

    this.#awards.push({
      year: this.#year,
      org: info.org,
      level: pro.level,
      code: awardsCfg.championship.code,
      name,
      // 冠軍不分投打。
      side: 'both',
    });
    // 與年度獎項同一個做法：名稱也寫進去重的榮譽清單，讓生涯中的「榮譽 N」那盞
    // 燈亮起來；次數要看結構化紀錄。
    this.#addHonor(joinName(orgName, name));
    this.flow.card(
      'gold',
      name,
      `<b class="hl">${esc(pro.team)}</b> 拿下${esc(orgName)}${name}。` +
        `<br><span class="sub">冠軍是九個人的事，但你在場上。</span>`,
    );
  }

  /**
   * 職業年度結束：老化 → 升降級 → 引退判定。
   *
   * 順序不能換。老化先跑，因為升降級看的是**這一季結束後**的能力——球團決定的
   * 是明年還要不要用你，而衰退卡當場就把新數字報給玩家了，不是黑箱。反過來，
   * 聯盟水準的推進排在升降級**之後**，因為那是明年的聯盟，不該拿來審今年的球季
   * （ADR 0029）。引退最後跑，因為被釋出是引退判定的輸入之一。
   */
  #proEndYear(): void {
    const pro = this.#pro;
    if (pro === null) return;

    this.#age++;
    this.#year++;
    pro.year++;
    // 否決交易的餘波會過去。球團記得那件事，但不是記一輩子。
    if (this.#tradeRefuseYears > 0) this.#tradeRefuseYears--;

    // 聯盟推進一年。玩家的貢獻只加在自己的球隊上——棒球是九個人的運動，
    // 再強的球員也翻不了一支爛隊，因此上限壓得很窄。
    if (this.#league !== null) {
      const par = leagueStandardOf(this.#standards, pro.level).par;
      this.#league = advanceLeague(this.world, this.#league, {
        playerTeam: pro.team,
        playerEffect: playerEffect(this.rating?.overall ?? 0, par),
      });
    }

    this.#lateBloom(levelOf(pro.level).top !== undefined && this.#seasonFactor > 0);
    this.#phoenix();

    // ---- 老化
    const aging = applyAging(
      this.world,
      this.#ability,
      this.#age,
      this.#ceilingBonus,
      this.#traits,
      // 二刀流兩側都抽；定位鎖定之後只抽用得到的那一側。
      ALL_ABILITIES.filter((k) => isSideVisible(k, this.#lockedSide)),
    );
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
      tier: this.#handednessTier,
    });

    // 聯盟水準推進一年。人才有興衰，同一個聯盟在不同年代不是同一個聯盟。
    //
    // 排在升降級**之後**：這一季的去留要用這一季的聯盟水準審，不能用明年的
    // （ADR 0029）。往下的合約、自由市場、挖角看到的則是新的一年——那些談的
    // 本來就是明年的事。
    if (this.#standards !== null) {
      this.#standards = advanceStandards(this.world, this.#standards);
    }

    let released = false;
    this.#demotedTo = null;
    this.#demotedFrom = null;
    this.#demoteReason = '';
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
        this.#demoteReason = move.reason;
      }
      else {
        // 「一軍」是頂級聯盟的專稱（見 CONTEXT.md 詞條），而且只有中日韓那三個
        // 體系這樣叫——墨聯、澳職、大聯盟都不是。標題一律報實際的層級名。
        // 登上頂級才是里程碑（gold）；農場裡的每一階是進度，不是終點（good）。
        const top = to.top !== undefined;
        this.flow.card(
          top ? 'gold' : 'good',
          `升上${to.name}`,
          `${esc(move.reason)}，被叫上<b class="hl">${esc(to.name)}</b>。` + this.#cureYips('升上更高的層級'),
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

    // 記帳排在升降級之後——年資與合約倒數要先知道自己在哪一層。
    this.#seasonLedger();
    // 自主引退是季末的第一個問句，排在挖角與談約之前（見 ADR 0028）。
    this.flow.push(() => this.#voluntaryRetirement(() => this.#endOfYearChoices()));
  }

  /**
   * 年度記帳：在隊年數、服務年資、合約倒數。
   *
   * **與談約分開**。這一段沒有任何選擇，每年必跑；談約則要等海外的邀請都攤在
   * 桌上之後才問（見 ADR 0027）。
   */
  #seasonLedger(): void {
    const pro = this.#pro;
    if (pro === null) return;
    const info = levelOf(pro.level);

    const tally = this.#teamYears.get(pro.team);
    if (tally === undefined) this.#teamYears.set(pro.team, { org: info.org, years: 1 });
    else tally.years++;
    this.#careerTraits();

    // 服務年資只在頂級聯盟累積——二軍的年份不算進掌控期。
    if (info.top !== undefined) {
      pro.serviceYears++;
      // 外籍身分只算一軍年份，與掌控期同一個計數口徑。
      this.#orgYears.set(info.org, (this.#orgYears.get(info.org) ?? 0) + 1);
    }

    pro.contract = { ...pro.contract, years: pro.contract.years - 1 };
  }

  /**
   * 年度的談約：延長續約 → 到期。
   *
   * 到期之後分兩條路：**掌控期內由球團行使續約權**（球員沒有選擇），**取得
   * FA 資格則由球員自己談**。那正是掌控期的意義——選秀球隊用一個順位賭了你，
   * 就先擁有你幾年。
   *
   * **排在海外挖角之後**。掌控期那條路球員一句話都插不上，如果它先跑完，海外
   * 報價來的時候人已經被續約綁住，跳約還要自付買斷——那不是取捨，是罰款。
   */
  #contractTalks(next: () => void): void {
    const pro = this.#pro;
    if (pro === null) {
      next();
      return;
    }
    const top = levelOf(pro.level).top !== undefined;
    const eligible = isFreeAgentEligible({
      serviceYears: pro.serviceYears,
      changedOrg: pro.changedOrg,
    });

    if (offersExtension({ contract: pro.contract, topLevel: top, freeAgentEligible: eligible, d: this.#lastD })) {
      this.#askTerms(
        `母隊提前延長續約 · ${pro.team}（合約剩 1 年）`,
        (years, mult) => {
          pro.contract = {
            // 延長是同一段關係的續篇，不是新的一張約——「先打完現有合約」那句話
            // 因此照樣算數，入札不會因為延長而重新開口問。
            ...pro.contract,
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
          next();
        },
        () => {
          pro.contract = { ...pro.contract, extensionOffered: true };
          this.flow.card('info', '婉拒延長', '你婉拒了母隊的提前延長，選擇打完現有合約再說。');
          next();
        },
      );
      return;
    }

    if (pro.contract.years > 0) {
      next();
      return;
    }

    // ---- 合約到期
    //
    // 兩種人拿到的是同一張約：**非頂級層級沒有談判可言**，而**掌控期之內球員沒有
    // 選擇**。規則歸 contract.ts，這裡只決定要不要把它講給玩家聽——非頂級層級不
    // 發卡片，那一層的續約不是一件事（ADR 0025）。
    if (!top || !eligible) {
      // 球團行使續約權是**同一段關係的延續**，不是球員坐下來談的新約——「先打完現有
      // 合約」那句話因此照樣算數。以前這裡開一張全新的約，掌控期裡每一兩年就默默
      // 重設一次，回絕過的入札（申請旅美）又被問回來。
      pro.contract = { ...clubOption(this.world), postingDeclined: pro.contract.postingDeclined };
      if (top) {
        this.flow.card(
          'info',
          '球團續約',
          `你仍在選秀球隊的掌控期（服務 ${pro.serviceYears}／${seasonCfg.contract.control.years} 年），` +
            `球團行使續約權——續 <b class="hl">${pro.contract.years} 年</b>，薪資照層級基數。`,
        );
      }
      next();
      return;
    }

    this.#freeAgency(next);
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
  #freeAgency(next: () => void): void {
    const pro = this.#pro;
    if (pro === null) return;

    const options: Option[] = [
      { id: 'fa:stay', label: `與 ${pro.team} 續約`, note: '接著選擇長約或短約', role: 'main' },
      {
        id: 'fa:market',
        label: '跳出合約，測試自由市場',
        note: '可能乏人問津，那時只剩減薪回原隊或引退',
        role: 'warn',
      },
    ];
    const quit = this.#retireOption('fa:quit');
    if (quit !== null) options.push(quit);

    this.flow.ask(
      {
        title: `合約到期 · 取得自由球員資格（服務 ${pro.serviceYears} 年）`,
        options,
      },
      (choice) => {
        if (choice === 'fa:quit') {
          this.#quitHere('合約到期，不再續約');
          return;
        }
        if (choice === 'fa:market') {
          this.#faMarket(next);
          return;
        }
        this.#askTerms(`與 ${pro.team} 續約 · 選擇合約類型`, (years, mult) => {
          pro.contract = { years, mult, extensionOffered: false, postingDeclined: false };
          this.flow.card(
            'info',
            '續約',
            `與 <b class="hl">${esc(pro.team)}</b> 完成 <b class="hl">${years} 年</b>續約` +
              `（年薪係數 ×${mult.toFixed(2)}）。`,
          );
          next();
        });
      },
    );
  }

  /** 自由市場。沒有人開價時的兩個結局：減薪回原隊，或就此引退。 */
  #faMarket(next: () => void): void {
    const pro = this.#pro;
    if (pro === null) return;

    // **跳出合約是玩家自己選的路**，所以跨體系那一邊不設水準下限、也不設筆數
    // 上限：墨聯、澳職與更低的層級都攤在桌上。沒有跳出合約的時候（球團上門挖角、
    // 母隊續約）照舊不會有更差的舞台來找你。
    //
    // 三份名單攤在同一張桌上，順序是**先自家聯盟、再跨體系**：
    //
    // - **同體系的其他球隊**是這個市場的主體。合約到期卻只有海外球團打電話
    //   來，那不叫自由球員，那叫被迫出走。
    // - **海外 FA**：熬滿年資之後不必再求誰放你走。
    // - **跨體系尋路**：借用尋路的名單，但這條路是球團在挑人。
    const table = this.#league;
    const domestic =
      table === null
        ? []
        : domesticFaOffers(this.world, {
            org: levelOf(pro.level).org,
            level: pro.level,
            currentTeam: pro.team,
            overall: this.rating?.overall ?? 0,
            d: this.#lastD,
            standards: this.#standards,
            tier: this.#handednessTier,
            table,
          });
    // 每個聯盟一筆、最多四筆：現在的聯盟與最強的聯盟各保一格，其餘隨機（見 curateOffers）。
    const offers = curateOffers(this.world, [
      ...domestic,
      ...overseasFaOffers(this.world, {
        ...this.#overseasContext,
        serviceYears: pro.serviceYears,
      }),
      ...fallbackOffers(this.world, {
        ...this.#transferContext,
        limit: Number.POSITIVE_INFINITY,
        // 借用尋路的名單，但這條路是球團在挑人——外籍加成照收。見 ADR 0012。
        approach: 'recruit',
      }),
    ], levelOf(pro.level).org, this.#standards);
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
            postingDeclined: false,
          };
          this.flow.card(
            'bad',
            '減薪合約',
            `低著頭回到 <b class="hl">${esc(pro.team)}</b>，年薪打折。`,
          );
          next();
        },
      );
      return;
    }

    const currentOrg = levelOf(pro.level).org;
    const overseas = postingTarget(currentOrg);
    const options: Option[] = [
      ...offers.map((o, i) => ({
        id: `market:${i}`,
        label: `${o.orgName}　${o.team}（${o.levelName}）`,
        note:
          // 同體系的報價不寫年限——球衣換了，長短約仍然是坐下來談的，與母隊
          // 續約走同一張桌子。跨體系那一邊的年限由開價的球隊決定。
          (o.org === currentOrg ? Game.#domesticTerms(o) : Game.#terms(o)) +
          (o.org === overseas ? `｜海外 FA・不需母隊同意` : '') +
          (o.homecoming ? '｜落葉歸根' : ''),
      })),
      { id: 'market:stay', label: `回 ${pro.team} 續約`, role: 'main' },
    ];

    this.flow.ask({ title: '自由市場報價一覽', options }, (choice) => {
      const picked = offers[Number(choice.split(':')[1])];
      if (picked === undefined) {
        this.#askTerms(`與 ${pro.team} 續約 · 選擇合約類型`, (years, mult) => {
          pro.contract = { years, mult, extensionOffered: false, postingDeclined: false };
          this.flow.card('info', '續約', `重回 <b class="hl">${esc(pro.team)}</b>。`);
          next();
        });
        return;
      }
      if (picked.org === currentOrg) {
        this.#signWithinOrg(picked, next);
        return;
      }
      this.#moveTo(picked, picked.homecoming ? '落葉歸根' : '新的舞台');
      this.#afterMove(picked, next);
    });
  }

  /**
   * 在同一個體系裡換一件球衣。
   *
   * **不是轉會。** 層級沒變、聯盟沒變、外籍身分沒變，因此服務年資與掌控期的帳
   * 一律不歸零——那是體系對你的帳，不是某一支球隊的。`#moveTo` 把這些全部重來
   * 是因為它處理的是換體系；同體系換隊只動球衣、簽約金與那張新合約。
   *
   * 長短約走與母隊續約同一張桌子（`#askTerms`）：條件由玩家自己的成績與年齡
   * 決定，不是新東家單方面開的。
   */
  #signWithinOrg(offer: TransferOffer, next: () => void): void {
    const pro = this.#pro;
    if (pro === null) return;

    const from = pro.team;
    this.#earnings += offer.bonus;
    this.#pendingBonus += offer.bonus;
    pro.team = offer.team;

    this.#askTerms(`${offer.team} · 選擇合約類型`, (years, mult) => {
      pro.contract = { years, mult, extensionOffered: false, postingDeclined: false };
      this.flow.card(
        'gold',
        '轉隊',
        `離開 <b class="hl">${esc(from)}</b>，與 <b class="hl">${esc(offer.team)}</b> 簽下 ` +
          `<b class="hl">${years} 年</b>約（年薪係數 ×${mult.toFixed(2)}）。` +
          `簽約金 <b class="hl">${fmtMoney(offer.bonus)}</b>。`,
      );
      next();
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
      injuries: { majorInjuries: this.#majorInjuries, tjSurgeries: this.#tjSurgeries },
    });

    const base = salaryFor(pro.level, this.#lastD);
    const options: Option[] = [];
    if (terms.longEligible) {
      options.push({
        id: 'term:long',
        label: `長約（${terms.longYears} 年）`,
        note: `年薪係數 ×${terms.longMult.toFixed(2)}，約 ${fmtMoney(contractSalary(pro.level, base, this.#salaryMultiplier(terms.longMult)))}／年｜穩定保障`,
        role: 'main',
      });
    }
    options.push({
      id: 'term:short',
      label: `短約（${terms.shortYears} 年）`,
      note:
        `年薪係數 ×${terms.shortMult.toFixed(2)}，約 ${fmtMoney(contractSalary(pro.level, base, this.#salaryMultiplier(terms.shortMult)))}／年｜` +
        (terms.longEligible ? '賭下次身價' : '以你目前的年齡與成績，球團只願提供短約'),
      role: terms.longEligible ? 'warn' : 'main',
    });
    if (onReject !== undefined) {
      options.push({ id: 'term:reject', label: '婉拒，維持現狀', role: 'warn' });
    }
    const quit = this.#retireOption('term:retire');
    if (quit !== null) options.push(quit);

    this.flow.ask({ title, options }, (choice) => {
      if (choice === 'term:retire') {
        this.#quitHere('談約談到一半決定不簽了');
        return;
      }
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
      tier: this.#handednessTier,
      overall: this.rating?.overall ?? 0,
      age: this.#age,
      lastWinPct: this.#lastWinPct,
      currentOrg: pro === null ? '' : levelOf(pro.level).org,
      currentTeam: pro?.team ?? '',
      playedOrgs: this.#playedOrgs,
      standards: this.#standards,
      // 比的是層級與實力開得出的價，合約係數是這邊簽約談出來的，那邊還沒談。
      salary: this.#baseSalary,
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
        this.#afterMove(picked, next);
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
      this.#afterMove(picked, () => this.flow.push(() => this.#proYear()));
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
    this.#pendingBonus += offer.bonus;
    this.#playedOrgs.add(offer.org);

    pro.level = offer.level;
    pro.team = offer.team;
    // **登錄守位不隨轉會歸零。** 尺會換（ADR 0021 借新體系頂級聯盟的門檻），
    // 但那是下一次守位會議該回答的事——歸零等於讓三十歲的老將回到他十三歲時
    // 選的那個守位（ADR 0037 的首次登錄規則）。
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

  /**
   * 同體系報價的條件摘要。
   *
   * 少了年限那一欄——同聯盟換隊的長短約由 `#askTerms` 談，報價單上寫死一個
   * 數字會與接下來問的東西打架。
   */
  static #domesticTerms(o: TransferOffer): string {
    return `簽約金 ${fmtMoney(o.bonus)}｜長短約另談｜球隊奪冠 ${Math.round(o.odds * 100)}%`;
  }

  /** 入札與海外 FA 共用的上下文。 */
  get #overseasContext() {
    const pro = this.#pro;
    return {
      tier: this.#handednessTier,
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
    // **問得到的人才問。** 年齡窗口硬關之後不會有任何球團出價，那一問的每一個
    // 答案都通往同一個結果。「點頭了卻沒有人出手」仍然留著——那是機率落空，
    // 不是規則擋下。
    if (overseasBidChance(ctx) <= 0) {
      next();
      return;
    }
    // **「先打完現有合約」那句話要算數。** 答過之後這張合約剩下的年份不再問；
    // 換約、行使續約權、跳槽都會開一張新的約，那時才重新開口。提了申請卻沒走
    // 成（流標、母隊婉拒、自己收回）不算數——那些是沒有得到答案，隔年照問。
    if (pro.contract.postingDeclined) {
      next();
      return;
    }

    const words = this.#postingWords();
    this.flow.ask(
      {
        title: `你的能力已經站得上${orgLabel(target)}。要向球團${words.ask}嗎？`,
        options: [
          {
            id: 'posting:ask',
            label: words.ask,
            note: `母隊收下${words.fee}才會放人｜年資越深越容易點頭`,
          },
          {
            id: 'posting:wait',
            label: '再等等，先打完現有合約',
            note: '這張合約期間不會再問——換約之後才會重新開口',
            role: 'main',
          },
        ],
      },
      (choice) => {
        if (choice !== 'posting:ask') {
          pro.contract = { ...pro.contract, postingDeclined: true };
          next();
          return;
        }
        this.#postingResult(target, next);
      },
    );
  }

  /**
   * 旅美那一問的用語。**入札是日職的制度名稱**，韓職那一問叫「申請旅美」——流程
   * 一樣（母隊點頭、競標、流標），只是說法不能套用日本的。
   */
  #postingWords(): { readonly noun: string; readonly ask: string; readonly fee: string; readonly listed: string } {
    const org = this.#pro === null ? '' : levelOf(this.#pro.level).org;
    return org === 'NPB'
      ? { noun: '入札', ask: '提出入札申請', fee: '入札金', listed: '掛上入札名單' }
      : { noun: '旅美申請', ask: '申請旅美', fee: '轉隊費', listed: '挑戰大聯盟' };
  }

  /** 母隊的答覆與競標結果。 */
  #postingResult(target: string, next: () => void): void {
    const pro = this.#pro;
    if (pro === null) {
      next();
      return;
    }

    const words = this.#postingWords();
    // 先問有沒有人要——入札金是簽約金的倍數，沒有報價就沒有金額可談。
    const bids = postingBids(this.world, this.#overseasContext);
    if (bids.length === 0) {
      this.flow.card(
        'bad',
        `${words.noun}流標`,
        `球團同意讓你${words.listed}，但競標期結束時<b class="dn">沒有任何球團出價</b>。` +
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
        `球團婉拒了你的${words.noun}——<b class="dn">再打幾年，我們就放你走</b>。` +
          `<br><span class="sub">服務年資 ${pro.serviceYears} 年。待得越久，球團越沒有理由留你。</span>`,
      );
      next();
      return;
    }

    this.flow.card(
      'gold',
      `${words.noun}成立`,
      `球團同意放人，${words.fee} <b class="hl">${fmtMoney(fee)}</b> 進了母隊口袋。` +
        `<br>${esc(orgLabel(target))}遞出了報價——`,
    );

    this.flow.ask(
      {
        title: `${words.noun} · 選擇你的新東家`,
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
        this.#moveTo(picked, `${words.noun}成功`);
        this.#afterMove(picked, next);
      },
    );
  }

  /**
   * 年末的一連串選擇。整個季末的順序是：
   *
   * ```
   * 自主引退 → 挖角 → 談約 → 入札 → 下放遞約 → 不願下放的掛靴
   * ```
   *
   * **自主引退排在最前面**（見 ADR 0028）：要不要繼續打是先對自己回答的問題。
   *
   * **海外挖角排在談約之前**（見 ADR 0027）。掌控期內的球團續約權球員插不上
   * 話，談約先跑等於每年都在報價到達前先把人綁住。挖角成功就換了體系，那份
   * 合約由 `#moveTo` 重新開，這一年的談約自然不必再問。
   *
   * 留在最後的只剩「被下放，不願接受」——那要先知道自己被送去哪一層。
   */
  #endOfYearChoices(): void {
    const teamBefore = this.#pro?.team ?? '';
    this.#scouting(() => {
      const rest = () =>
        this.#posting(() => {
          const demotedTo = this.#demotedTo;
          if (demotedTo === null) {
            this.#retirementChoices();
            return;
          }
          this.#demotionOffers(demotedTo, () => this.#retirementChoices());
        });
      // 已經簽去別的體系了，母隊的約無從談起。
      if ((this.#pro?.team ?? '') !== teamBefore) {
        rest();
        return;
      }
      this.#contractTalks(rest);
    });
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
        `${esc(this.#demoteReason)}，被送回 <b class="dn">${esc(demotedTo)}</b>。`,
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
      `${esc(this.#demoteReason)}，球團打算把你送回 <b class="dn">${esc(demotedTo)}</b>${
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
        this.#afterMove(picked, next);
        return;
      }
      next();
    });
  }

  /**
   * 行使拒絕下放的權利。
   *
   * 拒絕不是白拿的：球團不能送你去二軍，但可以不要你。跟不上得越多，這個選項
   * 越像是逼球團在「忍受你」與「放掉你」之間選一個。
   *
   * **釋出機率沿用下放壓力，但先把倖存的那一半放大。** 直接拿同一個數字再擲一
   * 次是對同一件事收兩次費：球團想不想送你下去，前一擲已經問過了，而提問會出現
   * 就代表那一擲中了——玩家面對的壓力因此天生偏高（落差 3 分以上是 87-90%），
   * 拒絕下放於是不是賭注而是死刑判決書。放大倖存率之後，落差 1 分是 18% 釋出、
   * 落差 4 分以上仍有 80%：沒有任何一段是免費的，但賭得贏。
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

    if (this.world.stream('career').chance(refusalReleaseChance(this.#demotePressure))) {
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
      // 拒絕下放的權利只有美職那個體系給（`refuse_demotion_after_years`），所以
      // 這張卡的「一軍」以前永遠是錯的——那裡叫大聯盟。報實際的層級名。
      `留在${levelOf(from).name}`,
      `你行使了年資賦予的權利，球團收回下放通知——<b class="hl">${esc(levelOf(from).name)}</b>的位置還是你的。`,
    );
    next();
  }

  /**
   * 自主引退：季末的第一個問句。
   *
   * **排在所有合約與挖角之前**（見 ADR 0028）。「要不要繼續打」是一個人先對
   * 自己回答的問題，先簽完約再問他要不要走，順序是顛倒的。
   *
   * 這裡不會逼退任何人：答「再拚一年」之後仍然可能沒有球團要他，那條路走
   * `#fallback` 與 `#demotionOffers`，結局一樣是引退，但那是被決定的，不是選的。
   */
  #voluntaryRetirement(next: () => void): void {
    const cfg = seasonCfg.retirement;
    // 抽取一律先做，與年齡無關——否則同一個種子會在生日前後讓後面所有判定
    // 整串偏移。
    const bodyAsks = asksRetirement(this.world, this.#age);

    // 高齡的每季自主引退。這是玩家自己按下的那個鍵——與被系統告知「你老了」
    // 是兩種完全不同的情緒，而引退場景要承接的正是這個差別。
    //
    // 身體發出訊號的那一年換一種問法。**那條機率原本是直接結束生涯**，現在
    // 只改變語氣：它是一個很重的暗示，但按下去的仍然是玩家。年紀還不到自主
    // 引退時，也只有身體開口的那一年才會被問。
    if (!bodyAsks && this.#age < cfg.voluntary_from_age) {
      next();
      return;
    }
    this.#askRetire(
      bodyAsks
        ? '身體開始抱怨了。再拚一年，還是在這裡畫下句點？'
        : `${this.#age} 歲了。再拚一年，還是在這裡畫下句點？`,
      '再拚一年',
      bodyAsks ? `${this.#year} 年宣布引退` : `功成身退，${this.#year} 年宣布引退`,
      next,
      bodyAsks,
    );
  }

  /**
   * 被下放的老將可以選擇不接受，就此掛靴。
   *
   * 這一條**不能**跟自主引退一起提到前面：它要先知道自己被送去哪一層、以及
   * 有沒有別的球團接手（`#demotionOffers`），才問得出口。年輕人不給這個選項
   * ——他們還有再拚一次的餘地，讓他們在二十出頭就能一鍵結束生涯只會製造後悔。
   */
  #retirementChoices(): void {
    const cfg = seasonCfg.retirement;
    // 讀的是**現在**的狀態：中途換了體系的人已經不算被下放。
    const demotedTo = this.#demotedTo;
    if (demotedTo !== null && this.#age >= cfg.refuse_demotion_from_age) {
      this.#askRetire(
        `你被送回${demotedTo}。要接受下放，還是就此掛靴？`,
        '接受下放，從頭再來',
        `不願下放，${this.#year} 年宣布引退`,
        () => this.flow.push(() => this.#proYear()),
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

  /**
   * 掛在合約問句上的那條退路。
   *
   * 自主引退已經有獨立的問句排在季末最前面（ADR 0028），但那一問一年只出現
   * 一次；談約談到一半才發現「我不想再簽了」是真的會發生的事，而那時候玩家
   * 手上只有簽或不簽兩個鍵。合約問句因此永遠掛一個引退選項。
   *
   * 年齡門檻與獨立問句同一條：年輕人不給一鍵結束生涯的按鈕，他們還有再拚一次
   * 的餘地。回 `null` 就是這一問不掛。
   */
  #retireOption(id: string): Option | null {
    if (this.#age < seasonCfg.retirement.voluntary_from_age) return null;
    return {
      id,
      label: `不簽了，${this.#year} 年宣布引退`,
      note: '談約談到一半也可以就此收手',
      role: 'warn',
    };
  }

  /**
   * 從合約問句直接引退。
   *
   * 照樣走買斷：延長合約那一問是在**約還沒到期**時談的，中途走人要付七成；
   * 續約與減薪回原隊那兩問的約已經到期，`#payBuyout` 算出來是 0，不會多收。
   */
  #quitHere(reason: string): void {
    this.#payBuyout('player');
    this.flow.push(() => this.#retire(reason));
  }

  /** 問玩家要不要就此引退。選擇本身會寫進重播日誌。 */
  #askRetire(
    question: string,
    stay: string,
    quit: string,
    stayNext: () => void,
    bodyAsks = false,
  ): void {
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
        stayNext();
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
    if (pro !== null) {
      this.#retiredFrom = { team: pro.team, levelName: levelOf(pro.level).name };
    }
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
      // 養成期的盃賽冠軍。職業的總冠軍不走這裡——它是 awards 裡的一筆紀錄。
      this.#counts.domesticTitles,
      this.#amateurSeasons,
      this.#intlScore,
      this.#intlSeasons,
      this.#traits.has(hallOfFame.franchise_bonus.trait) ? hallOfFame.franchise_bonus.multiplier : 1,
    );
    this.#summary = summary;

    this.#careerTables(summary);
    this.#careerScores(summary);

    // **票選只跑一次，結果存下來。** 它會消耗抽取，跑第二次得到的得票年與得票率
    // 就不是玩家看到的那一份了；而結算（score()）也要知道誰進了名人堂。
    this.#ballots =
      summary.leagues.length > 0 && !this.#banned ? runBallots(this.world, summary.leagues) : [];
    const ballots = this.#ballots;
    this.#retireScene(summary);
    this.#hallOfFame(ballots);
    this.#settlementTraits(summary, ballots);
    // 第二人生走哪條路要在成就之前抽好——那條路本身就是一項成就（issue #39）。
    // 故事卡照舊排在最後，那是這段生涯的收尾。
    const secondLife = this.#pickSecondLife();
    this.#achievementCard();
    this.#fanBoard(summary);
    this.#secondLife(secondLife);

    // 收尾的三塊：狀態、生涯年表、榮譽榜。引退之後右欄那塊面板整個消失——這三者
    // 是這段生涯的結論，結論屬於敘事的結尾，不是常駐的儀表板；而且「最近一季」
    // 已經沒有下一季可比，把結局壓在半個畫面高的面板裡捲並不合理。
    this.flow.finale('traits');
    this.flow.finale('career');
    this.flow.finale('honors');
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
    //
    // 標題不寫「一軍／二軍」：`topTotal` 收的是所有頂級聯盟，包含大聯盟與墨聯，
    // 那些地方沒有「一軍」這個講法；`minorTotal` 同理收了 1A 到 3A。
    if (summary.leagues.length > 1) {
      const body = line(summary.topTotal.batting, summary.topTotal.pitching);
      if (body !== '') this.flow.card('gold', '所有頂級聯盟通算', body);
    }
    if (summary.minors.length > 1) {
      const body = line(summary.minorTotal.batting, summary.minorTotal.pitching);
      if (body !== '') this.flow.card('info', '所有二軍與小聯盟通算', body);
    }
  }

  /** 生涯評價分：各聯盟一份，並攤開三個來源。 */
  #careerScores(summary: CareerSummary): void {
    if (summary.leagues.length === 0) return;

    const rows = summary.leagues.map((l) => {
      const detail =
        `份額 ${l.sharePoints.toFixed(1)}` +
        `${l.awardPoints > 0 ? `＋榮譽 ${l.awardPoints.toFixed(1)}` : ''}` +
        `${l.milestonePoints > 0 ? `＋里程碑 ${l.milestonePoints.toFixed(1)}` : ''}` +
        `${l.tenureDeduction > 0 ? `－年資未滿 ${l.tenureDeduction.toFixed(1)}` : ''}`;
      return (
        `<b class="hl">${esc(l.orgName)}${esc(l.tierLabel)}</b>` +
        `　評價分 <b class="hl">${Math.round(l.score)}</b>（${detail}）` +
        `<br><span class="sub">勝利份額 ${l.shares.win.toFixed(1)}／敗戰份額 ${l.shares.loss.toFixed(1)}` +
        // 投打守合計的 WAR。聯盟內的數字，所以跟著各聯盟那一列，不加總成跨聯盟的一個數。
        `　·　WAR ${(l.war.batting + l.war.pitching + l.war.fielding).toFixed(1)}` +
        `${l.milestones.length > 0 ? `　·　${esc(l.milestones.join('、'))}` : ''}</span>`
      );
    });

    // 總評價分要看得到。**生涯里程碑與國際賽都只加在這裡**，不進任何單一
    // 聯盟的評價分——不顯示的話那兩個系統的貢獻等於憑空消失。
    const extras: string[] = [];
    const milestonePoints = summary.totalScore
      - summary.leagues.reduce((sum, l) => sum + l.sharePoints + l.awardPoints, 0)
      - summary.amateurTitlePoints
      - summary.internationalScore;
    if (milestonePoints > 0.05) extras.push(`生涯里程碑 ${milestonePoints.toFixed(1)}`);
    if (summary.amateurTitlePoints > 0) extras.push(`養成期冠軍 ${summary.amateurTitlePoints.toFixed(0)}`);
    if (summary.internationalScore > 0) extras.push(`國際賽 ${summary.internationalScore.toFixed(0)}`);
    rows.push(
      `<b class="hl">總評價分 ${summary.totalScore.toFixed(1)}</b>` +
        (extras.length > 0
          ? `<br><span class="sub">各聯盟合計＋${extras.join('＋')}——這些不屬於任何聯盟，只進總分。</span>`
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
   * 吃生涯軌跡的兩個特性：一支球隊待到底，或在同一個聯盟輾轉過太多隊。
   *
   * 兩者都在球季結束當下判，不等結算——「效力滿十五年」是那一年發生的事，
   * 卡片就該落在那一年。等到引退才一起跳，那個時刻就沒了。
   */
  #careerTraits(): void {
    const mrteam = traitOf('mrteam');
    const longest = [...this.#teamYears.entries()].sort((a, b) => b[1].years - a[1].years)[0];
    if (mrteam?.threshold !== undefined && longest !== undefined && longest[1].years >= mrteam.threshold) {
      this.#unlockTrait(
        'mrteam',
        `同一件球衣穿了 ${longest[1].years} 年。球迷提到這支球隊就會想到你，提到你就會想到這支球隊——<b class="hl">你成了它的代名詞</b>。`,
        teamNick(longest[0]),
      );
    }

    const rainbow = traitOf('rainbow');
    if (rainbow?.thresholds === undefined) return;
    const perOrg = new Map<string, number>();
    for (const { org } of this.#teamYears.values()) perOrg.set(org, (perOrg.get(org) ?? 0) + 1);
    for (const [org, count] of perOrg) {
      const limit = rainbow.thresholds[org];
      if (limit === undefined || count <= limit) continue;
      this.#unlockTrait(
        'rainbow',
        `同一個聯盟裡待過 ${count} 支球隊。你的球衣收藏拼得出一道彩虹——<b class="hl">而那不全是你自己選的</b>。`,
        orgLabel(org),
      );
      return;
    }
  }

  /**
   * 只在結算時才判定得了的三個特性。
   *
   * 它們的觸發條件全部要等生涯結束才知道結果，離開這裡就沒有別的地方能判。
   */
  #settlementTraits(summary: CareerSummary, ballots: readonly BallotResult[]): void {
    const cfg = hallOfFame.settlement_traits;

    const firstBallot = ballots.find((b) => b.firstBallot);
    if (firstBallot !== undefined) {
      this.#unlockTrait(
        cfg.legend.trait,
        '第一年投票就披上名人堂金袍——你不只是進了殿堂，你<b class="hl">定義了一個時代</b>。',
        firstBallot.leagueName,
      );
    }

    // 以下兩個都要求「站上過頂級舞台」——在二軍打一輩子的人，那兩個故事都不成立。
    const reachedTop = summary.leagues.length > 0;
    if (!reachedTop) return;

    if (this.#schoolTier === cfg.small_school.school_tier) {
      this.#unlockTrait(
        cfg.small_school.trait,
        '當年那所沒沒無聞的小學校，走出了一個站上頂級舞台的男人。你證明了：出身，從來不是天花板。',
      );
    }

    const potential = Object.values(this.#player?.potential ?? {}).reduce((a, b) => a + b, 0);
    if (potential > 0 && potential <= cfg.grinder.provisional_sum) {
      this.#unlockTrait(
        cfg.grinder.trait,
        '天賦平庸的球員千千萬萬，能走到這裡的卻寥寥無幾。你不是天選之人，你是把汗水熬成天賦的那種人。',
      );
    }
  }

  /**
   * 取得一個特性並跳卡。已經有了就不重複。
   *
   * 名稱與配色一律向 `traits.json` 要——這裡曾經自己帶一份字串進來，於是
   * 卡片與特性面板各說各話。`fill` 只有 `dynamic_name` 的三個用得到。
   */
  #unlockTrait(id: string, text: string, fill?: string): void {
    if (this.#traits.has(id)) return;
    const def = traitOf(id);
    if (def === undefined) throw new Error(`未知的特性：${id}`);
    const name = traitName(id, fill);
    this.#traits.add(id);
    if (def.name === null) this.#traitNames.set(id, name);
    this.flow.card(def.tone === 'bad' ? 'bad' : 'gold', `隱藏特性：${name}`, text);
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
  #achievementCard(): void {
    // 配方在 score()，這裡只負責把結果講給玩家聽。未登入時進度是 NO_PROGRESS：
    // 每一局都是「第一段人生」、每一項都算新解鎖。
    const result = this.score()?.achievements;
    if (result === undefined) return;
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
        `<br><span class="sub">成就點數可在下一段生涯開場兌換天賦，買到的天賦永久啟用。` +
        `同一項成就只給一次點數。</span>`,
    );
  }

  /**
   * 球迷看板。
   *
   * 依生涯分級挑留言。這是唯一會**根據分級變臉**的區塊——玩家從留言的語氣就
   * 讀得出自己這輩子打得怎麼樣，那是結算的情緒收尾。
   *
   * **則數也跟著名氣走**：語氣變了但每個人都固定三則的話，看板讀起來像制式表
   * 單；過客的引退串只有兩個人路過，名人堂的串會刷滿一整頁，那是名氣本身的形
   * 狀。最低那一級用 `base_count`，每高一級多 `per_tier` 則，分級數改了也不必
   * 回頭修對照表。
   */
  #fanBoard(summary: CareerSummary): void {
    const pool = flavor.fan_reactions[String(summary.bestTier)];
    if (pool === undefined || pool.length === 0) return;

    const cfg = flavor.fan_board;
    const lowest = hallOfFame.tier_thresholds.values.length;
    const rng = this.world.stream('career');
    const picks: string[] = [];
    const used = new Set<number>();
    const want = Math.min(
      pool.length,
      Math.max(1, cfg.base_count + (lowest - summary.bestTier) * cfg.per_tier),
    );
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

  /**
   * 〈十里坡劍神〉：在頂級聯盟連續打了 `seasons` 季，這一季季末的綜合能力比
   * `seasons` 季前的季末多 `rise` 以上。沒在頂級聯盟、或整季沒出賽，就從頭算。
   *
   * 門檻刻意高（6 季 +8，沒點成長天賦的 200 局實測一個都沒有）：成長天賦本來就
   * 讓人一年比一年強，門檻壓低等於點了天賦就自動送一個（2026-09-25）。
   *
   * 取得的當下兌現一次：每項能力的潛力 +5、能力值 +1，都不超過量表上限 80。能力
   * 值是直接加，不經蓄力槽——那是「開竅」，不是練出來的。
   */
  #lateBloom(countable: boolean): void {
    const cfg = abilities.late_bloom;
    const overall = this.rating?.overall ?? 0;
    if (!countable) {
      this.#lateBloomRun = [];
      return;
    }
    this.#lateBloomRun.push(overall);
    const run = this.#lateBloomRun;
    const before = run[run.length - 1 - cfg.seasons];
    if (before === undefined || overall - before < cfg.rise || this.#traits.has('late')) return;

    const max = abilities.scale.max;
    for (const key of ALL_ABILITIES) {
      this.#potentialBonus[key] = (this.#potentialBonus[key] ?? 0) + cfg.potential;
      const v = this.#ability[key] ?? 0;
      if (v < max) this.#ability[key] = Math.min(max, v + cfg.ability);
    }
    this.#settleCarry();
    this.#unlockTrait(
      'late',
      `${cfg.seasons} 季裡綜合能力從 ${before} 爬到 ${overall}。長年的沉潛終於開花結果——` +
        `<b class="hl">所有能力的潛力 +${cfg.potential}、能力 +${cfg.ability}</b>。`,
    );
  }

  /**
   * 〈浴火鳳凰〉：有〈帕瓦諾〉的人連續 `healthy_seasons` 季沒受傷，帕瓦諾拿掉、換成
   * 浴火鳳凰。帕瓦諾的成就照樣留著——那是這一生發生過的事。
   */
  #phoenix(): void {
    if (!this.#traits.has('glass')) {
      this.#glassHealthy = 0;
      return;
    }
    this.#glassHealthy = this.#seasonInjury === null ? this.#glassHealthy + 1 : 0;
    if (this.#glassHealthy < injuryCfg.phoenix.healthy_seasons) return;
    this.#traits.delete('glass');
    this.#glassEver = true;
    this.#unlockTrait(
      injuryCfg.phoenix.trait,
      `帶著帕瓦諾的名聲，連續 ${this.#glassHealthy} 季沒進過傷兵名單。你回來了，而且比以前更硬——` +
        '<b class="hl">帕瓦諾解除，受傷率恢復正常</b>。',
    );
  }

  /**
   * 〈善良之槍〉與〈烏鴉〉只跟著拿到它的那一隊：換隊就解除——交易、自由球員、
   * 被挖角、被釋出都算。交易當下與每季開打前各查一次，換隊的路徑再多也漏不掉。
   *
   * 在養成期拿到的〈烏鴉〉還沒有球隊，進職業的第一隊就是它的球隊（選秀不算換隊）。
   */
  #teamChangeCheck(): void {
    const pro = this.#pro;
    if (pro === null) return;
    if (this.#traits.has('cancer') && this.#cancerTeam === null) this.#cancerTeam = pro.team;
    if (this.#traits.has('onetool') && pro.team !== this.#onetoolTeam) {
      this.#traits.delete('onetool');
      this.#onetoolEver = true;
      this.#onetoolTeam = null;
      this.flow.card('good', '重獲重用', `換到${esc(pro.team)}，新的總教練不管過去那些事——<b class="hl">〈${esc(traitName('onetool'))}〉解除</b>，你又有位置了。`);
    }
    if (this.#traits.has('cancer') && pro.team !== this.#cancerTeam) {
      this.#traits.delete('cancer');
      this.#cancerEver = true;
      this.#cancerTeam = null;
      this.flow.card('good', '重新開始', `換到${esc(pro.team)}，沒有人記得你以前在休息室掀過幾次桌——<b class="hl">〈${esc(traitName('cancer'))}〉解除</b>。`);
    }
  }

  /** 太早離開棒球的人走上哪一條路。沒走到第二人生是 null。 */
  #pickSecondLife(): (typeof flavor.second_life.stories)[number] | null {
    if (this.#age >= seasonCfg.retirement.second_life_max_age) return null;
    const stories = flavor.second_life.stories;
    if (stories.length === 0) return null;
    const story = stories[this.world.stream('career').int(0, stories.length - 1)] ?? null;
    this.#secondLifeTitle = story?.title ?? null;
    return story;
  }

  /** 太早離開棒球的人，走向棒球之外的第二人生。 */
  #secondLife(story: (typeof flavor.second_life.stories)[number] | null): void {
    if (story === null) return;
    const name = this.#player?.name ?? '';
    this.flow.card(
      'gold',
      `第二人生：${story.title}`,
      `${esc(story.text.replace(/\{n\}/g, name))}<br><br>` +
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
   * 一次提問管到底：可以逐點分配、隨時復原上一步，全部分配完才進確認關卡。
   *
   * **還沒分配完就只能放棄。** 原本的「確認」在點數沒分配完時反灰；現在換成
   * 「放棄」——按下去剩下的點數直接作廢，不另外問「你確定嗎」，也不經過確認
   * 關卡。手殘按到就是按到了，那是刻意的惡趣味。它用自己的 id（alloc:forfeit）
   * 而不是 alloc:confirm：測試與校準的代理看到 confirm 就會先按，同一個 id 會讓
   * 它們每一局都把點數丟掉。
   * 復原**本身也是一次選擇**，會寫進重播日誌——配點不消耗亂數，因此反向操作
   * 是精確的，日誌記下「加了什麼、又退了什麼」仍然完整重現同一段生涯。
   *
   * 沒有「先留著」：點數留到下一年會讓每一季的起點都不一樣，玩家得記住上一季
   * 剩多少，而畫面上並沒有地方講這件事。
   */
  #allocationPhase(source: 'dice' | 'pool'): void {
    const dice = this.#remainingDice;
    const left = source === 'dice' ? dice.length : this.#pool;
    // 分配完就交給確認關卡。**這裡不能清掉復原堆疊**——在確認畫面按復原，
    // 靠的正是這份紀錄。清空與收骰面都由確認那一步負責。
    if (left === 0) return;

    /**
     * 選這一項要投進去幾點。
     *
     * 骰子是「一顆幾點就加幾點」——點數由骰面決定，跟這一級要幾點無關；投完
     * 升幾級由 train() 一路花到底。
     *
     * 大賽點數則是相反：一次投滿這一級的成本，能力真的動一格。以前一次只給
     * 1 點，遇到 2 點或 6 點一級的段位，按下去只會看到蓄力槽 +1、能力沒動，
     * 等於逼玩家連按好幾次才會發生事情。池子不夠付一整級時才退成蓄力。
     */
    const spendOf = (key: AbilityKey): number =>
      source === 'dice' ? (dice[0] ?? 1) : Math.min(this.#pool, this.#poolPriceOf(key));

    const done = this.#allocHistory.length;

    const options: Option[] = this.#allocatableAbilities.map((key) =>
      this.#abilityOption(key, spendOf(key), source === 'pool'),
    );
    // 每一項都頂到天花板時，剩下的點數沒有地方去——這時放棄就是唯一的出口。
    // **只看能力選項**——復原鍵可不可按跟「還有沒有地方加點」無關。
    const stuck = options.every((o) => o.disabled === true);
    const rest = source === 'dice' ? `${left} 顆骰` : `${left} 點`;
    options.push({
      id: 'alloc:undo',
      label: '復原',
      note: done === 0 ? '還沒有可以復原的動作' : '退回上一次加點',
      role: 'warn',
      disabled: done === 0,
    });
    options.push({
      id: 'alloc:forfeit',
      label: '放棄',
      note: stuck ? `所有能力都到頂了，剩下的${rest}作廢` : `剩下的${rest}直接作廢，不再確認`,
      role: 'warn',
    });

    const title =
      source === 'dice'
        ? `第 ${done + 1}／${done + dice.length} 顆骰：${dice[0] ?? 1} 點要加在哪？`
        : `大賽點數：還有 ${left} 點要加在哪？`;

    this.flow.ask({ title, options }, (choice) => {
      if (choice === 'alloc:forfeit') {
        // 作廢剩下的點數：池子歸零、骰子收掉，不留到下一年（見上面的「沒有先留著」）。
        // 清掉復原堆疊，確認關卡看到空的就直接放行——放棄不再問第二次。
        if (source === 'pool') this.#pool = 0;
        this.#dice = null;
        this.#allocHistory = [];
        return;
      }
      if (choice === 'alloc:undo') this.#undoAllocation();
      else {
        const key = choice.slice('alloc:'.length) as AbilityKey;
        this.#pushAllocation(key, spendOf(key), source);
      }
      this.flow.unshift(() => this.#allocationPhase(source));
    });
  }

  /**
   * 大賽點數投一次這項能力的價碼：補滿這一級還差幾點。
   *
   * 蓄力槽裡已經有的先折抵——存了 1 點的能力再投 1 點就該升級，不該再收整級
   * 的錢。至少 1 點，否則點數不會減少，畫面會卡在同一步。
   */
  #poolPriceOf(key: AbilityKey): number {
    const current = this.#ability[key] ?? 0;
    const cost = abilityCost(current, this.#ceilingOf(key), growthCurve(this.isTwoWay, this.#age, key));
    return Math.max(1, cost - (this.#carry[key] ?? 0));
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

  /** 這一輪還沒投出去的骰面，各自的點數。 */
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
    // 配點是靜音的（一輪 8 顆骰寫 8 張卡片會把事件流洗掉），出事時沒有任何痕跡
    // 可以追。這一行把整筆交易的前後值印進 console：能力、天花板、這一級的價
    // 錢、蓄力槽、投進去幾點，以及升了幾級。回報「骰子怪怪的」時把它貼出來，
    // 就分得出是引擎算錯還是畫面顯示的時機不對。
    const dbgBefore = this.#ability[key] ?? 0;
    const dbgCarry = this.#carry[key] ?? 0;
    const dbgCeiling = this.#ceilingOf(key);
    const dbgCurve = growthCurve(this.isTwoWay, this.#age, key);
    const dbgCost = abilityCost(dbgBefore, dbgCeiling, dbgCurve);
    this.#applyPoints(key, value, { silent: true });
    console.info(
      `[alloc] ${key} ${source} 投 ${value} 點｜` +
        `能力 ${dbgBefore} → ${this.#ability[key] ?? 0}（潛力 ${dbgCeiling}` +
        `${dbgBefore >= dbgCeiling ? '，已在天花板之上' : ''}、上限 ${hardCap(this.#ceilingBonus[key] ?? 0)}）｜` +
        `蓄力 ${dbgCarry}/${dbgCost} → ${this.#carry[key] ?? 0}/${abilityCost(this.#ability[key] ?? 0, dbgCeiling, dbgCurve)}` +
        // 天賦覆蓋層是全域可變狀態，掉了的話成本會靜靜地變回原價（突破極限沒生效時
        // 天花板外是 3 倍而不是 1.5 倍）。把當下的倍率與折扣一起印出來，下次
        // 「同樣的能力怎麼價錢不一樣」就不必用算的去反推是哪一種。
        `｜倍率 ${dbgCurve.curve.above_ceiling_multiplier}、折扣 ${dbgCurve.curve.discount}` +
        `${this.isTwoWay ? '｜二刀流' : ''}`,
    );
    if (source === 'dice' && this.#dice !== null) {
      this.#dice = { values: this.#dice.values, index: this.#dice.index + 1 };
    } else if (source === 'pool') {
      this.#pool -= value;
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
      // 一次投的不見得是 1 點——退回當初扣掉的那個數，不是加一。
      this.#pool += last.value;
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

  /**
   * 這個球員目前落在哪一慣用手檔次。
   *
   * 每次讀都重算，因為左右開投是後天拿到的：拿到的當下尺與上限一起改變，
   * 不需要任何補算或快照。
   */
  get #handednessTier(): HandednessTier {
    const p = this.#player;
    if (p === null) return 'none';
    return handednessTier({ throws: p.throws, bats: p.bats, traits: this.#traits });
  }

  /** 這項能力目前的潛力天花板，含事件提升的部分。 */
  #ceilingOf(key: AbilityKey): number {
    // 抽到的潛力先吃慣用手折扣——左手的順風在尺那邊，代價在這裡。折扣只咬
    // 這個原值，後面兩項加成都是原價疊上去的（見 handedness.ts）。
    const rolled = this.#player?.potential[key] ?? abilities.scale.max;
    const base = discountedPotential(rolled, this.#handednessTier);
    // 三個來源，但不是同一種東西：抽到的潛力與「天生神力」那類全域加成都只是
    // 在量表**之內**移動，加起來最多 80；只有事件卡提升的那一項有資格把量表
    // 本身頂過 80（hardCap 同樣只認它）。最後一項平常是 0，由設定覆蓋層寫入
    // （見 ADR 0007）。
    const inScale = Math.min(
      abilities.scale.max,
      base + abilities.talent_bonus.ceiling + (this.#potentialBonus[key] ?? 0),
    );
    return inScale + (this.#ceilingBonus[key] ?? 0);
  }

  /** 把點數投進一項能力，並產生對應的敘事。 */
  #applyPoints(key: AbilityKey, points: number, options: { silent?: boolean } = {}): void {
    const before = this.#ability[key] ?? 0;
    const result = train(
      before,
      points,
      this.#ceilingOf(key),
      this.#carry[key] ?? 0,
      growthCurve(this.isTwoWay, this.#age, key),
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

  /** 扣點，走與加點同一條成本曲線。點數為正數。 */
  #applyPenalty(key: AbilityKey, points: number): void {
    const result = untrain(
      this.#ability[key] ?? 0,
      points,
      this.#ceilingOf(key),
      this.#carry[key] ?? 0,
      growthCurve(this.isTwoWay, this.#age, key),
    );
    this.#ability[key] = result.value;
    this.#carry[key] = result.carry;
    // 這裡不必再 #settleCarry()：untrain() 的迴圈已經一路借位到槽轉正為止，
    // 而成本只跟這一項自己的能力值有關，退這項不會改變別項的價錢。
  }

  /**
   * 一次能力增減的戰報文字。
   *
   * 一律以**點數**為單位報告，級數是附帶結果。三種應對方式的差別（保守 1 點、
   * 照常 2 點、豪賭 3 點）全在點數上，只講級數的話，能力 58 以上一級要 4–8
   * 點，那個差別會塌成「+1 或什麼都沒有」，玩家看不到自己賭贏了什麼。
   */
  #deltaNote(key: AbilityKey, points: number, before: number): string {
    const gained = (this.#ability[key] ?? 0) - before;
    const carry = this.#carry[key] ?? 0;
    const gauge = carryGauge(
      this.#ability[key] ?? 0,
      this.#ceilingOf(key),
      carry,
      growthCurve(this.isTwoWay, this.#age, key),
    );
    const head = `<span class="${points >= 0 ? 'up' : 'dn'}">${points > 0 ? '+' : ''}${points} 點</span>`;

    if (gained !== 0) return `${head}（${gained > 0 ? '+' : ''}${gained}）`;
    if (carry !== 0) return `${head}（蓄力 ${gauge.points}/${gauge.need}）`;
    return `${head}（已經到底，沒有去處）`;
  }

  /**
   * 結算蓄力槽。
   *
   * 蓄力槽只在**加點的當下**結算，但那一級的成本會被幾件事往下拉：年齡衰退
   * 讓能力值降下來、事件扣點退了一級、事件提升天花板、取得二刀流換到較便宜
   * 的成長曲線。這些事發生之後，原本存著的點數可能已經足夠升一級，卻沒有人
   * 去花它——畫面於是顯示「2/2」卻不進位，看起來像壞掉。
   *
   * 因此凡是會改變成本的地方，事後都要把槽清一次。
   */
  #settleCarry(): void {
    for (const key of Object.keys(this.#carry)) {
      if ((this.#carry[key] ?? 0) > 0) this.#applyPoints(key, 0, { silent: true });
    }
  }

  /**
   * 產生一個能力的分配選項，附上目前值、天花板與這一級的成本。
   *
   * `showPrice` 是給大賽點數用的：各項能力的段位不同，同一次分配按下去可能扣
   * 2 點也可能扣 6 點，價碼得寫在選項上，不能等按下去才發現。
   */
  #abilityOption(key: AbilityKey, value: number, showPrice = false): Option {
    const current = this.#ability[key] ?? 0;
    const ceiling = this.#ceilingOf(key);
    const carry = this.#carry[key] ?? 0;
    const result = train(
      current,
      value,
      ceiling,
      carry,
      growthCurve(this.isTwoWay, this.#age, key),
      this.#ceilingBonus[key] ?? 0,
    );

    const name = abilities.abilities[key] ?? key;
    const price = showPrice ? `－${value} 點・` : '';
    // 反灰的判準是**硬上限**，不是潛力。潛力天花板是價錢的轉折點（之上每級
    // 乘 above_ceiling_multiplier，突破極限這個天賦可以把倍率壓低），不是牆——牆只有
    // 一道，就是量表的 80，事件提升過上限的能力才會往上挪。
    //
    // 舊版在 current >= ceiling 就擋掉，於是 abilityCost() 那條「天花板之上
    // 仍可成長」的曲線只有事件點數走得到，玩家看到的卻是「上限 80、點到 7X
    // 就不給點」（problems #55）。
    const cap = hardCap(this.#ceilingBonus[key] ?? 0);
    if (current >= cap) {
      return {
        id: `alloc:${key}`,
        label: name,
        note: `${current}／上限 ${cap}・已達上限`,
        disabled: true,
      };
    }
    // 潛力之上要提醒一句，否則玩家只會看到蓄力槽突然變慢，不知道是自己越線了。
    const over = current >= ceiling ? `・潛力 ${ceiling} 之上` : '';
    const note =
      result.gained > 0
        ? `${price}${current} → ${result.value}（潛力 ${ceiling}／上限 ${cap}）`
        : // 槽是負的就寫「欠」——這裡是「點下去會怎樣」的預告，寫成「蓄力 -1」
          // 會讓玩家以為自己在存一個負數。
          `${price}${current}／潛力 ${ceiling}${over}・${slotText(carry)} → ${slotText(result.carry)}`;

    return { id: `alloc:${key}`, label: name, note };
  }

}

/** 蓄力槽的短寫法：正的是存，負的是欠。 */
function slotText(n: number): string {
  return n < 0 ? `欠 ${-n}` : `蓄力 ${n}`;
}

/**
 * 機率一律顯示整數。
 *
 * `15.399999999999999%` 那條尾巴是浮點運算的雜訊，不是精度——受傷機率是十幾條
 * 加減乘出來的，小數點後那十幾位沒有任何意義，只會讓一張資訊卡看起來像當機。
 * 需要小數的地方（名人堂得票率）自己 `toFixed`，不走這裡。
 */
function pct(v: number): number {
  return Math.round(v);
}

function handLabel(hand: string): string {
  return hand === 'S' ? '雙' : hand === 'L' ? '左' : '右';
}
