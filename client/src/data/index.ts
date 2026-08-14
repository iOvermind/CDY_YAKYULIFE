/**
 * 規則資料的載入層。
 *
 * 見 CONTEXT.md 的「規則資料」：這些常數決定遊戲怎麼運作，跟著版本走、
 * 對所有玩家相同，與玩家個人的「生涯資料」相對。
 *
 * 目前一律靜態 import，在 build 期綁進產物。未來會加上 runtime 覆蓋層，
 * 屆時凡是用過覆蓋的生涯都必須標記為「自訂規則局」（見 CONTEXT.md）。
 *
 * JSON 檔中所有 `_` 開頭的鍵都是給人看的註解，不參與運算，因此不出現在型別裡。
 */

import abilitiesJson from './abilities.json';
import amateurJson from './amateur.json';
import awardsJson from './awards.json';
import flavorJson from './flavor.json';
import hallOfFameJson from './hall_of_fame.json';
import leaguesJson from './leagues.json';
import positionsJson from './positions.json';
import traitsJson from './traits.json';
import seasonJson from './season.json';
import teamsJson from './teams.json';

/** 能力代碼，例如 'pow'、'ctl'。 */
export type AbilityKey = string;

/**
 * 開局選擇的起始守位。不含 DH；UTIL 為守位不定。
 * 它只影響潛力天賦的加權與初始能力加成，不決定球員擁有哪些能力——
 * 每位球員都擁有全部能力。
 */
export type StartPosition =
  | 'P'
  | 'C'
  | '1B'
  | '2B'
  | '3B'
  | 'SS'
  | 'LF'
  | 'CF'
  | 'RF'
  | 'UTIL';

export const START_POSITIONS: readonly StartPosition[] = [
  'P',
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'LF',
  'CF',
  'RF',
  'UTIL',
];

/**
 * 開局畫面的守位分列。
 *
 * 依守備位置的性質分成三列：投捕與守位不定、內野、外野。內野的順序是繞著
 * 內野走一圈（一壘 → 二壘 → 游擊 → 三壘），不是按代碼排序。
 */
export const START_POSITION_ROWS: readonly (readonly StartPosition[])[] = [
  ['P', 'C', 'UTIL'],
  ['1B', '2B', 'SS', '3B'],
  ['LF', 'CF', 'RF'],
];

/** 慣用手：R 右、L 左、S 左右開弓。 */
export type Hand = 'R' | 'L' | 'S';

/** 四大球系的代碼。取代舊版單一的 brk，見 simulation_math.md §5。 */
export type PitchFamily = 'swp' | 'drp' | 'chg' | 'gim';

export const PITCH_FAMILIES: readonly PitchFamily[] = ['swp', 'drp', 'chg', 'gim'];

/** 慣用手的抽樣權重，鍵為 Hand，值為相對權重（不必加總為 100）。 */
export type HandWeights = Readonly<Partial<Record<Hand, number>>>;

/** 一個閉區間，兩端皆含。 */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/** 一個投手角色的評價權重。 */
export interface PitcherRoleWeights {
  readonly velocity_weight: number;
  readonly control_weight: number;
  readonly stamina_weight: number;
  /** 變化球排序後的遞減權重。 */
  readonly pitch_weights: readonly number[];
  /** 角色折扣。責任額由角色決定，能力再高也補不回來。 */
  readonly discount: number;
}

export interface AbilitiesData {
  readonly scale: {
    readonly min: number;
    readonly max: number;
    readonly hard_floor: number;
    /** 每項能力可被提升的上限點數。提升上限不直接加能力值，只讓你練得更高。 */
    readonly max_ceiling_bonus: number;
  };
  readonly abilities: Readonly<Record<AbilityKey, string>>;
  /**
   * 能力只分三組：體力（共用）、投手、野手。
   * 體力不屬於任一側，二刀流判定時不計入任何一側。
   */
  readonly ability_groups: {
    readonly shared: readonly AbilityKey[];
    readonly pitcher: readonly AbilityKey[];
    readonly fielder: readonly AbilityKey[];
  };
  readonly ability_group_names: {
    readonly shared: string;
    readonly pitcher: string;
    readonly fielder: string;
  };
  /**
   * 介面用的能力分組。
   *
   * 與 `ability_groups` 是兩件事：那份是引擎用的，野手為一組，因為二刀流
   * 判定與定位鎖定都以「投手側／野手側」為單位。這份把野手拆成打擊與守備，
   * 純粹是為了讓能力表好讀。兩份的成員必須完全一致，護欄測試看著這件事。
   */
  readonly display_groups: {
    readonly order: readonly string[];
    readonly names: Readonly<Record<string, string>>;
    readonly members: Readonly<Record<string, readonly AbilityKey[]>>;
  };
  readonly pitch_families: Readonly<
    Record<
      PitchFamily,
      { readonly name: string; readonly en: string; readonly pitches: readonly string[] }
    >
  >;
  readonly start_positions: Readonly<Record<StartPosition, string>>;
  readonly talent_weights: {
    readonly default: number;
    readonly by_start_position: Readonly<
      Record<StartPosition, Readonly<Record<AbilityKey, number>>>
    >;
  };
  readonly handedness: {
    readonly throws: { readonly weights: HandWeights };
    readonly bats: { readonly weights: HandWeights };
    readonly selectable: { readonly throws: readonly Hand[]; readonly bats: readonly Hand[] };
    /** 左投左打的結構性優勢對價：受益的那一側，天賦上限相應降低。 */
    readonly ceiling_modifier: {
      readonly throws: Readonly<
        Partial<Record<Hand, { readonly group: string; readonly delta: number }>>
      >;
      readonly bats: Readonly<
        Partial<Record<Hand, { readonly group: string; readonly delta: number }>>
      >;
    };
  };
  readonly initial_ability: {
    readonly base: Range;
    readonly bonus: Readonly<Record<StartPosition, Readonly<Record<AbilityKey, Range>>>>;
    readonly pitch_bonus: { readonly applies_to: readonly StartPosition[]; readonly range: Range };
  };
  readonly growth_cost: {
    readonly default: GrowthCurve;
    readonly two_way_discount: TwoWayDiscount;
  };
  readonly training_dice: {
    /** 鍵為骰數，值為相對權重。 */
    readonly count_weights: Readonly<Record<string, number>>;
    readonly count_when_injured: number;
    readonly min_count: number;
    readonly faces: Readonly<Record<string, Range>>;
    readonly count_modifiers: Readonly<
      Record<string, { readonly delta: number; readonly chance?: number }>
    >;
    /** 上一季奪冠的回報：隔季多擲幾顆骰。取最高的一項，不相加。 */
    readonly championship_bonus: Readonly<Record<string, number>>;
  };
  readonly overall: {
    readonly pitcher: {
      /** 四項變化球。排序後遞減加權，沒有「算不算一種球」的離散判定。 */
      readonly pitches: readonly AbilityKey[];
      /** 依角色走兩套權重，與野手依守位走不同的守備權重同構。見 ADR 0005。 */
      readonly roles: Readonly<Record<string, PitcherRoleWeights>>;
    };
    readonly fielder: {
      /** 純打擊的能力清單。二刀流判定看它——「二刀流」指的是投打，不是投守。 */
      readonly offense_abilities: readonly AbilityKey[];
      readonly offense_top_weights: readonly number[];
      readonly defense_weight: Readonly<Record<string, number>>;
      readonly dh_defense_penalty: { readonly base_position: string; readonly penalty: number };
      readonly default_position: Readonly<Record<string, string>>;
    };
    readonly trait_modifiers: Readonly<Record<string, number>>;
  };
  readonly potential_ceiling: { readonly tiers: readonly Range[] };
}

/**
 * 文案庫。全部是展示用字串，不影響任何數值運算。
 *
 * 引退場景依「代表聯盟 + 生涯分級」選用；中職的第三帶還依投打分歧，因此那一格
 * 是物件而非字串。取用時要先判斷型別。
 */
export interface FlavorData {
  readonly placeholders: Readonly<Record<string, string>>;
  /** 引退時的鄉民留言，鍵是分級（0 最高）。 */
  readonly fan_reactions: Readonly<Record<string, readonly string[]>>;
  readonly retire_scenes: Readonly<
    Record<string, string | Readonly<Record<string, string | Readonly<Record<string, string>>>>>
  >;
  readonly second_life: { readonly closing: string; readonly stories: readonly string[] };
}

/** 一項里程碑：達到 steps[i] 就拿到 points[i] 分，逐級累進。 */
export interface Milestone {
  readonly stat: string;
  readonly name: string;
  readonly side: 'batter' | 'pitcher';
  readonly steps: readonly number[];
  readonly points: readonly number[];
}

export interface HallOfFameData {
  readonly difficulty: { readonly reference_par: number; readonly exponent: number };
  readonly tier_thresholds: {
    /** 五帶的名稱，由高到低。 */
    readonly labels: readonly string[];
    /** 四道門檻，由高到低。 */
    readonly values: readonly number[];
  };
  readonly award_points: {
    readonly by_code: Readonly<Record<string, number>>;
    readonly championship: { readonly points: number };
    readonly default: number;
  };
  readonly tier_floors: {
    readonly rules: readonly { readonly codes: readonly string[]; readonly min_tier: number }[];
  };
  readonly milestones: {
    readonly reference_games: number;
    readonly league: readonly Milestone[];
    readonly career: readonly Milestone[];
  };
  readonly halls: Readonly<
    Record<
      string,
      {
        readonly name: string;
        readonly wait_years: number;
        readonly total_voters: number;
        readonly league: string;
      }
    >
  >;
  readonly first_ballot: {
    readonly multiplier: Readonly<Record<string, number>>;
    readonly default_multiplier: number;
    readonly wait_if_not_first: Range;
  };
  readonly vote_percent: {
    readonly base: number;
    readonly over_threshold_factor: number;
    readonly random_max: number;
    readonly wait_penalty_per_year: number;
    readonly floor: number;
    readonly cap: number;
  };
  readonly near_miss: { readonly pct: Range; readonly tries: Range };
  readonly representative_league: { readonly check_order: readonly string[] };
  readonly settlement_traits: {
    readonly legend: { readonly trait: string };
    readonly small_school: { readonly trait: string; readonly school_tier: number };
    readonly grinder: {
      readonly trait: string;
      readonly percentile: number;
      readonly provisional_sum: number;
    };
  };
}

/** 一項獎的機率設定：達到基礎門檻才判定，每超出一個 step 加 per_step。 */
export interface AwardChance {
  readonly base: number;
  readonly step: number;
  readonly per_step: number;
  readonly clamp: Range;
}

/**
 * 一項「聯盟第一名」型的獎：單項王與年度最佳投手。
 *
 * 判定是「算出當年的門檻線，達到就拿」，不是「達標之後再擲機率」。那條線
 * 年年不同——它代表的是「今年聯盟第一名打到哪」。
 */
export interface LeaderAward {
  readonly code: string;
  readonly name: string;
  readonly side: 'pitcher' | 'batter';
  /** 對照哪一項成績。 */
  readonly stat: string;
  /**
   * 率型（avg / obp / era）的門檻寫成 d 值，因此會自動跟著成績模型走；
   * 累積型（hr / rbi / sb / so / sv）寫成絕對值，依球季場次等比放大。
   */
  readonly kind: 'rate' | 'counting';
  /** 率型的門檻：相對聯盟平均的能力差。 */
  readonly d?: number;
  /** 累積型的門檻，以 reference_games 場的聯盟為準。 */
  readonly base?: number;
  /** 那條線的年度波動。低於下緣一定拿不到，高於上緣一定拿得到。 */
  readonly band: number;
  readonly requires_role?: 'SP' | 'RP';
  readonly min_pa?: number;
  /** 局數需達該聯盟的場次數。 */
  readonly min_ip_equals_games?: boolean;
}

/** 守備獎項。判定看守備勝率，不看守備分的顯示數字。 */
export interface FieldingAward extends AwardChance {
  readonly code: string;
  readonly name: string;
  readonly min_win_pct: number;
  readonly god_win_pct: number;
}

export interface AwardsData {
  readonly thresholds: {
    readonly reference_games: number;
    readonly games: Readonly<Record<string, number>>;
    readonly default_games: number;
  };
  readonly titles: { readonly list: readonly LeaderAward[] };
  readonly pitcher_of_year: LeaderAward;
  /**
   * 年度 MVP。判定看那一季的勝利份額，不看 d 值——d 值是「他多強」，不是
   * 「他今年打得多好」。因此它與單項王共用同一套「當年門檻線 ± 波動」。
   */
  readonly mvp: LeaderAward & {
    readonly qualify: {
      readonly starter_min_ip: number;
      readonly reliever_min_games: number;
      readonly batter_pa_per_game: number;
    };
  };
  readonly fielding: { readonly list: readonly FieldingAward[] };
  readonly all_star: {
    readonly base: number;
    readonly per_d: number;
    readonly clamp: Range;
    readonly popularity_bonus: {
      readonly league: string;
      readonly team: string;
      readonly add: number;
      readonly clamp: Range;
      readonly flag_below_d: number;
    };
  };
  readonly rookie_of_year: {
    readonly min_d: number;
    readonly base: number;
    readonly per_d_over_min: number;
    readonly clamp: Range;
  };
}

export interface PositionsData {
  readonly positions: Readonly<Record<string, string>>;
  /** 各守位的能力權重。資格判定與守備分共用同一組，見該檔的 _deviation。 */
  readonly ability_weights: Readonly<Record<string, Readonly<Record<AbilityKey, number>>>>;
  readonly defense_thresholds: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** 年輕球員的門檻折扣，依年齡取第一個符合的區間。 */
  readonly youth_adjust: {
    readonly tiers: readonly { readonly max_age: number; readonly adjust: number }[];
    readonly default: number;
  };
  /** 該守位的平均守備水準：門檻加上 margin。守備分的比較基準。 */
  readonly defense_average: { readonly margin: number };
  /** 薪資議價力。與守備價值是兩個不同的量——捕手的年薪不是一壘手的八倍。 */
  readonly salary_multiplier: Readonly<Record<string, number>>;
  /**
   * 各守位的守備責任占比。守備分的權重、守備側勝利份額的責任額、守位的身價
   * 次序，三者共用這一份。DH 不在表內。
   */
  readonly fielding_responsibility: Readonly<Record<string, number>>;
  readonly defense_score_scale: { readonly scale: number };
  /**
   * 移防掃描順序。IF／OF 是各自的守位光譜，fallback 是掃不到時的保底。
   * 型別分開寫，呼叫端才不必為了取一個字串去做 union 收窄。
   */
  readonly scan_order: {
    readonly IF: readonly string[];
    readonly OF: readonly string[];
    readonly fallback: string;
  };
}

/** 成長成本曲線。tiers 由高到低比對，取第一個 current >= from 的 cost。 */
/** 二刀流的成本折扣。直接從成本扣點，不另立一條曲線。 */
export interface TwoWayDiscount {
  /** 天賦上限之內每級少付的點數。 */
  readonly within_ceiling: number;
  /** 天賦上限之外每級少付的點數，在乘上懲罰倍率之後才扣。 */
  readonly above_ceiling: number;
  /** 扣完之後的成本下限。 */
  readonly min_cost: number;
}

export interface GrowthCurve {
  readonly tiers: readonly { readonly from: number; readonly cost: number }[];
  readonly above_ceiling_multiplier: number;
}

/** 養成期投手的定位與勝敗設定。 */
export interface AmateurPitchingExtras {
  readonly role: {
    readonly starter_min_stamina: Readonly<Record<string, number>>;
    readonly default_min_stamina: number;
    readonly reliever_innings_factor: { readonly value: number };
  };
  readonly decision: {
    readonly starter_share: { readonly value: number };
    readonly reliever_save_share: { readonly value: number };
  };
}

export interface AmateurData {
  readonly career_start: {
    readonly age: number;
    readonly year: number;
    /** 生涯起點的季節。年度對齊球季而非學年，因此從春天算起。 */
    readonly season: string;
  };
  readonly stages: {
    readonly order: readonly SchoolStage[];
  } & Readonly<Record<string, StageDefinition | readonly SchoolStage[] | string>>;
  readonly junior_high: SchoolTiers;
  readonly high_school: SchoolTiers;
  readonly amateur_international: {
    readonly tournaments: Readonly<Record<string, YouthTournament>>;
    readonly ranks: readonly string[];
    readonly honor_ranks: { readonly values: readonly string[] };
    readonly points: readonly number[];
    readonly power_bonus: {
      readonly base_overall: number;
      readonly factor: number;
      readonly max: number;
    };
    readonly honor_prefix: string;
  };
  readonly draft: {
    readonly evaluation: {
      readonly age_pivot: number;
      readonly age_bonus_per_year: number;
      readonly noise: Range;
    };
    readonly rounds: {
      readonly tiers: readonly {
        readonly min_score: number;
        readonly round?: number;
        readonly round_range?: Range;
      }[];
    };
    readonly signing_bonus_by_round: readonly number[];
    readonly default_bonus: number;
    readonly first_round_direct_promotion: {
      readonly round: number;
      readonly min_overall: number;
      readonly level: string;
      readonly fallback_level: string;
    };
    readonly reject_offer: { readonly reject_from_round: number; readonly max_age: number };
  };
  readonly amateur_stats: {
    readonly batting: {
      readonly pa_per_game: number;
      readonly walk_rate: RateSpec;
      readonly hit_rate: RateSpec;
      readonly hr_rate: RateSpec;
      readonly rbi_per_hit: number;
      readonly double_rate: RateSpec;
      readonly triple_rate: RateSpec;
      readonly strikeout_rate: RateSpec;
      readonly runs_per_time_on_base: RateSpec;
      readonly steal_rate: RateSpec;
      readonly steal_success: number;
      readonly noise: Range;
    };
    readonly pitching: {
      readonly innings_per_game: RateSpec;
      readonly k_per_nine: RateSpec;
      readonly bb_per_nine: RateSpec;
      readonly hits_per_nine: RateSpec;
      readonly runs_per_earned_run: { readonly value: number };
      readonly era: RateSpec;
      readonly noise: Range;
    } & AmateurPitchingExtras;
  };
  readonly two_way_talent: {
    readonly trait: string;
    readonly min_pitcher: number;
    readonly min_fielder: number;
  };
  readonly cups: {
    readonly JHS: CupStage;
    readonly HS: CupStage;
    readonly U: CupStage;
    readonly AMA: CupStage;
    readonly ranks: readonly string[];
    readonly points: readonly number[];
    readonly games_by_rank: { readonly values: readonly number[] };
    /** 各名次的敗場。單淘汰裡輸一場就回家，第四名例外——他輸兩場。 */
    readonly losses_by_rank: { readonly values: readonly number[] };
    readonly honor_ranks: { readonly values: readonly string[] };
    readonly points_bonus: { readonly overall_divisor: number; readonly per_season: boolean };
    readonly academy_trigger: {
      readonly stage: string;
      readonly rank: string;
      readonly trait: string;
    };
  };
}

export interface CupStage {
  readonly names: readonly string[];
  /** 由高到低的名次門檻。實力值達到第 n 個門檻即取得第 n 名次。 */
  readonly thresholds: readonly number[];
  /** 該階段的對手平均水準，用於把能力值換算成成績。 */
  readonly par: number;
  /** 該階段的單場臨場波動。國中大於高中——那個年紀更容易爆冷。 */
  readonly power_noise: Range;
  /** 冠軍隊直通的國際賽：大賽名稱 → 國際賽代碼。 */
  readonly qualifies?: Readonly<Record<string, string>>;
}

/** 一條率的設定：與對手同水準時是 base，每高一點加 per_point。 */
export interface RateSpec {
  readonly base: number;
  readonly per_point: number;
  readonly min: number;
  readonly max: number;
  readonly ability?: string;
}

/** 養成階段：國中、高中、大學、業餘成棒。 */
export type AmateurStage = 'JHS' | 'HS' | 'U' | 'AMA';

/** 有學校分級的養成階段。 */
export type SchoolStage = 'JHS' | 'HS';

export interface StageDefinition {
  readonly name: string;
  readonly years: number;
  readonly year_labels: readonly string[];
  readonly next?: string;
}

export interface SchoolTiers {
  readonly tiers: Readonly<Record<string, { readonly label: string; readonly power_bonus: number }>>;
  readonly schools: Readonly<Record<string, number>>;
}

/**
 * 養成期的國際賽。
 *
 * 出線方式有兩種，對應真實制度的差異：
 * - `qualified_by`：冠軍隊直通。贏下指定的國內大賽即取得代表權（國中）。
 * - `call_up_threshold`：遴選國家隊。綜合能力達標才會被選上（高中）。
 */
export interface YouthTournament {
  readonly name: string;
  readonly stage: SchoolStage;
  /** 冠軍隊直通：取得代表權的國內大賽名稱。 */
  readonly qualified_by?: string;
  /** 遴選制：綜合能力達此值才會被徵召。 */
  readonly call_up_threshold?: number;
  /** 遴選制：只在該階段的第幾年舉辦。 */
  readonly held_in_year?: number;
  readonly thresholds: readonly number[];
  readonly games_by_rank: readonly number[];
}

/** 一條率的設定：與聯盟 par 同水準時是 base，每高一點加 per_point。 */
export interface RateSpec {
  readonly base: number;
  readonly per_point: number;
  readonly min: number;
  readonly max: number;
  readonly ability?: string;
  readonly abilities?: Readonly<Record<string, number>>;
}

/** 上下限或噪音區間。 */
export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface LeagueLevel {
  readonly name: string;
  /** 該層級的平均水準。所有 d 值都是相對這個數字算的。 */
  readonly par: number;
  /** 最低限度，低於則降級或戰力外。 */
  readonly min: number;
  readonly games: number;
  readonly org: string;
  /** 有這個欄位者為頂級聯盟——進入後才登錄守位並累積 FA 年資。 */
  readonly top?: string;
}

/** 年齡窗口的一階。年齡在 max_age 以內時，挖角機率乘上 value。 */
export interface AgeWindowTier {
  readonly max_age: number;
  readonly value: number;
}

/** 一個體系的年齡窗口。null 表示不看年齡（墨聯與澳職）。 */
export interface AgeWindow {
  readonly tiers: readonly AgeWindowTier[];
  readonly default: number;
  /** 關窗之後的例外：能力遠超落地門檻的即戰力仍有微弱機會。 */
  readonly monster?: { readonly over_landing_bar: number; readonly value: number };
}

/** 一個體系的轉會設定。`scouts` 為 false 者只接人、不挖人。 */
export interface TransferOrg {
  readonly scouts: boolean;
  readonly scout_min_overall?: number;
  readonly scout_chance?: number;
  readonly signing_bonus: { readonly base: number; readonly per_d: number };
  /** 入札制度的目的地。null 表示這個體系沒有入札。 */
  readonly posting: { readonly to: string } | null;
  readonly age_window: AgeWindow | null;
}

export interface TransferData {
  /** 球員的母國體系。回這裡不算外籍，不收 import_premium。 */
  readonly home_org: { readonly value: string };
  readonly import_premium: { readonly value: number };
  /** 入札制度。與自由球員互斥——分界正是合約。 */
  readonly posting: {
    readonly consent: {
      readonly base: number;
      readonly per_service_year: number;
      readonly fee_unit: number;
      readonly per_fee_unit: number;
      readonly clamp: Range;
    };
    readonly bidders: Range;
    readonly overseas_fa_years: { readonly value: number };
  };
  readonly scouting: {
    readonly offers_per_org: Range;
    readonly min_win_pct: { readonly value: number };
    /** 挖角的加薪門檻：落地層級的預估年薪至少要是目前年薪的這個倍數。 */
    readonly min_raise: number;
  };
  readonly fallback: { readonly max_offers: number };
  readonly orgs: Readonly<Record<string, TransferOrg>>;
}

/** 一個層級的薪資設定。年薪 = base + clamp(d, 0, d_cap) × per_point，單位萬元。 */
export interface SalarySpec {
  readonly base: number;
  readonly per_point: number;
  readonly d_cap: number;
}

export interface LeaguesData {
  readonly levels: Readonly<Record<string, LeagueLevel>>;
  /**
   * 薪資設定，單位萬元台幣／年。
   *
   * **反映的是市場規模，不是競技水準**——兩者是獨立的旋鈕。見 ADR 0004。
   */
  readonly salary: {
    readonly levels: Readonly<Record<string, SalarySpec>>;
    readonly posting_fee_multiplier: { readonly value: number };
  };
  /** 跨體系轉會。邊由這裡的門檻與年齡窗口推導，見 ADR 0004。 */
  readonly transfer: TransferData;
  /** 各體系由低到高的升遷路徑。 */
  readonly paths: Readonly<Record<string, readonly string[]>>;
  readonly top_league_names: Readonly<Record<string, string>>;
  readonly org_names: Readonly<Record<string, string>>;
  readonly minor_label: string;
}

export interface SeasonData {
  readonly league_standards: {
    readonly level_drift: {
      readonly yearly: Range;
      readonly mean_reversion: number;
      readonly clamp: Range;
    };
    readonly gap_drift: {
      readonly yearly: Range;
      readonly mean_reversion: number;
      readonly clamp: Range;
    };
  };
  readonly playing_time: {
    readonly stamina_factor: {
      readonly ability: string;
      readonly at: number;
      readonly value_at: number;
      readonly per_point: number;
      readonly min: number;
      readonly max: number;
    };
    readonly trust_factor: { readonly base: number; readonly per_point: number } & Range;
    readonly position_factor: Readonly<Record<string, number>>;
    readonly position_factor_clamp: Range;
    readonly games_noise: Range;
    readonly pa_per_game: Range;
    readonly pa_noise: Range;
    readonly pa_absolute_noise_divisor: { readonly value: number };
  };
  readonly batting: {
    readonly walk_rate: RateSpec;
    readonly intentional_walk: {
      readonly abilities: Readonly<Record<string, number>>;
      readonly divisor: number;
      readonly threshold: number;
      readonly exponent: number;
      readonly rate_divisor: number;
      readonly noise: Range;
    };
    readonly hit_rate: RateSpec;
    readonly hr_rate: RateSpec;
    readonly extra_base: { readonly double_rate: RateSpec; readonly triple_rate: RateSpec };
    readonly strikeout_rate: RateSpec;
    readonly runs_per_time_on_base: RateSpec;
    readonly rbi_per_hit: number;
    readonly rbi_per_hr_extra: number;
    readonly steal: { readonly attempt_rate: RateSpec; readonly success_rate: RateSpec };
    readonly noise: Range;
  };
  readonly pitching: {
    readonly role: {
      readonly starter: {
        readonly sta_min_d: number;
        /** 輪值線。掛在球隊戰力上——強隊難擠、弱隊容易占。 */
        readonly rotation: { readonly base_d: number; readonly per_win_rate: number };
      };
      /** 終結者的當年聯盟線。一隊只有一個關門人，稀缺性由這條線表達。 */
      readonly closer: { readonly line_d: number; readonly band: number };
    };
    /** 牛棚分的權重。決定他是關門人還是中繼。 */
    readonly bullpen: {
      readonly velocity_weight: number;
      readonly control_weight: number;
      readonly pitch_weights: readonly number[];
    };
    readonly starter: {
      readonly rotation_divisor: { readonly value: number };
      readonly gs_factor: { readonly base: number; readonly per_point: number } & Range;
      readonly innings_per_start: RateSpec;
      readonly noise: Range;
    };
    readonly reliever: {
      readonly games: { readonly base: number; readonly per_point: number } & Range;
      readonly innings_per_game: Range;
      readonly noise: Range;
    };
    readonly strikeout_rate: RateSpec;
    readonly hits_per_inning: RateSpec;
    readonly runs_per_earned_run: { readonly value: number };
    readonly walk_rate: RateSpec;
    readonly era: RateSpec;
    readonly decision: {
      readonly starter_decision_rate: number;
      /** 後援出賽中有勝敗的比例。後援本來就會掃勝也會背敗。 */
      readonly relief_decision_rate: number;
      /** 中繼的出賽中有中繼機會的比例。 */
      readonly hold_chance: number;
      readonly win_rate: { readonly base: number; readonly per_point: number } & Range;
      /** 終結者的出賽中有救援機會的比例。 */
      readonly closer_save_chance: number;
    };
    readonly noise: Range;
  };
  readonly movement: {
    readonly promote: {
      readonly margin: number;
      readonly chance: { readonly base: number; readonly per_point: number } & Range;
    };
    readonly demote: {
      readonly margin: number;
      readonly chance: { readonly base: number; readonly per_point: number } & Range;
    };
    readonly release: { readonly grace_years: number; readonly margin: number };
  };
  readonly aging: {
    readonly peak_start: number;
    readonly peak_end: number;
    readonly growth: { readonly points: Range };
    readonly decline: {
      readonly base: number;
      readonly per_year_after_peak: number;
      readonly max: number;
      readonly speed_first: {
        readonly fast: readonly string[];
        readonly slow: readonly string[];
        readonly fast_multiplier: number;
        readonly slow_multiplier: number;
      };
    };
  };
  readonly retirement: {
    readonly min_age: number;
    readonly age_chance: { readonly base: number; readonly per_year: number; readonly max: number };
    readonly max_age: number;
    /** 幾歲之後每季提供「宣布引退」的選項。 */
    readonly voluntary_from_age: number;
    /** 幾歲之後被下放時提供「就此引退」的選項。年輕人還有再拚一次的餘地。 */
    readonly refuse_demotion_from_age: number;
    /** 幾歲之前離開棒球會走第二人生的敘事。 */
    readonly second_life_max_age: number;
  };
  readonly advanced: {
    readonly runs_per_win: number;
    readonly win_shares_per_win: number;
    /** 勝利份額／敗戰份額雙帳制的參數，見 ADR 0003。 */
    readonly shares: {
      /** 每場球產生幾份（勝場與敗場各自 ×3）。 */
      readonly per_game: number;
      readonly split: {
        readonly batting: number;
        readonly pitching: number;
        readonly fielding: number;
      };
      /** 投球責任額的高槓桿加權，鍵為投手角色。終結者專挑關鍵局面。 */
      readonly leverage: Readonly<Record<string, number>>;
      readonly team_pa_per_game: number;
      readonly team_ip_per_game: number;
      readonly pythagorean_exponent: number;
      readonly win_pct_clamp: Range;
      /** 個人勝率錨在球隊戰績上的強度。1.0 完全照 James，0 則完全不看球隊。 */
      readonly team_coupling: number;
    };
  };
  /** 季中交易。逐段成績紀錄的唯一使用者。 */
  readonly trade: {
    readonly chance: {
      readonly base: number;
      readonly trait_bonus: Readonly<Record<string, number>>;
    };
    readonly star_margin: { readonly value: number };
    readonly untouchable_traits: { readonly value: readonly string[] };
    readonly rumor: {
      readonly complain_chance: number;
      readonly silence_chance: number;
      readonly ambience: { readonly complains: number; readonly trait: string };
    };
    readonly refuse: { readonly years: number; readonly championship_factor: number };
    readonly split: Range;
  };
  /** 合約的談判層。金額在 leagues.json 的 salary。 */
  readonly contract: {
    readonly years: {
      readonly base: number;
      readonly perf: { readonly d_at_zero: number; readonly d_at_full: number };
      readonly cap: { readonly pitcher: number; readonly fielder: number };
      readonly injury_penalty: {
        readonly per_major_injury: number;
        readonly per_tj_surgery: number;
      };
      readonly age_caps: {
        readonly tiers: readonly { readonly min_age: number; readonly max_years: number }[];
      };
    };
    readonly multiplier: {
      readonly by_performance: {
        readonly tiers: readonly { readonly min_d: number; readonly value: number }[];
        readonly default: number;
      };
      readonly long_factor: number;
      readonly short_factor: number;
      readonly injury_short_bonus: {
        readonly min_injuries: number;
        readonly max_years: number;
        readonly add: number;
      };
      readonly trade_refuse_penalty: { readonly value: number };
      readonly trait_modifiers: {
        readonly franchise_min: number;
        readonly cancer_max: number;
        readonly cancer_no_offer_chance: number;
      };
    };
    readonly long_contract: {
      readonly requires_years_over: number;
      readonly requires_min_d: number;
      readonly min_years: number;
    };
    readonly short_contract: { readonly min_years: number; readonly max_years: number };
    readonly control: {
      readonly years: number;
      readonly club_option: { readonly years: Range; readonly multiplier: number };
    };
    readonly extension: {
      readonly chance: number;
      readonly requires_min_d: number;
      readonly requires_top_level: boolean;
    };
    readonly buyout: { readonly player_initiated: number; readonly club_initiated: number };
    readonly rookie_contract: { readonly years: number; readonly multiplier: number };
  };
  readonly team_strength: {
    readonly initial: Range;
    readonly drift: {
      readonly yearly: Range;
      readonly mean_reversion: number;
      readonly clamp: Range;
    };
    readonly player_effect: { readonly per_point: number } & Range;
    readonly championship: {
      readonly exponent: number;
      readonly scale: number;
    } & Range;
  };
  readonly pro_dice: {
    readonly count_weights: Readonly<Record<string, number>>;
    readonly peak_bonus: { readonly delta: number };
  };
}

export interface Trait {
  readonly id: string;
  /** good 正向、bad 負向。決定標籤配色。 */
  readonly tone: string;
  /** 顯示名稱。dynamic_name 為 true 者為 null，名稱要依生涯內容組出來。 */
  readonly name: string | null;
  readonly dynamic_name?: boolean;
  readonly effect_text: string;
}

export interface TraitsData {
  readonly categories: { readonly positive: readonly string[]; readonly negative: readonly string[] };
  readonly traits: readonly Trait[];
}

export const abilities = abilitiesJson as unknown as AbilitiesData;
export const amateur = amateurJson as unknown as AmateurData;
export const awards = awardsJson as unknown as AwardsData;
export const flavor = flavorJson as unknown as FlavorData;
export const hallOfFame = hallOfFameJson as unknown as HallOfFameData;
export const positions = positionsJson as unknown as PositionsData;
export const traits = traitsJson as unknown as TraitsData;

/** 依 id 取特性。找不到回傳 undefined——未知的 id 不該假裝有名字。 */
export function traitOf(id: string): Trait | undefined {
  return traits.traits.find((t) => t.id === id);
}
export const teams = teamsJson as unknown as TeamsData;
export const leagues = leaguesJson as unknown as LeaguesData;
export const season = seasonJson as unknown as SeasonData;

export interface Team {
  readonly name: string;
  readonly color: string;
  /** 隊名代表詞，用於「◯◯先生」這類稱號；未指定時取隊名末兩字。 */
  readonly nick?: string;
}

export interface TeamsData {
  readonly leagues: Readonly<Record<string, readonly Team[]>>;
}

/**
 * 走訪一份 JSON 映射的「真正的鍵」。
 *
 * 本專案的慣例是 `_` 開頭的鍵都是給人看的註解（見本檔開頭）。那個慣例對讀
 * 檔的人很好，但對 `Object.keys()` 是陷阱——註解鍵會混進迭代裡，而且型別上
 * 看不出來，因為它們不在介面裡。
 *
 * 曾經發生過：`leagues.paths` 的 `_note` 被當成一條升遷路徑，字串被逐字元
 * 迭代，於是出現「未知的聯盟層級：各」。**任何要走訪 JSON 映射的地方都該
 * 用這個函式。**
 */
export function dataKeys<T>(map: Readonly<Record<string, T>>): readonly string[] {
  return Object.keys(map).filter((k) => !k.startsWith('_'));
}

/** 全部能力代碼，順序穩定（依 abilities.json 的宣告順序）。 */
export const ALL_ABILITIES: readonly AbilityKey[] = Object.keys(abilities.abilities);
