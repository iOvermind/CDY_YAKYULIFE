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
      readonly top_weights: readonly number[];
      readonly stamina_weight: number;
    };
    readonly fielder: {
      readonly offense_top_weights: readonly number[];
      readonly defense_weight: Readonly<Record<string, number>>;
      readonly dh_defense_penalty: { readonly base_position: string; readonly penalty: number };
      readonly default_position: Readonly<Record<string, string>>;
    };
    readonly trait_modifiers: Readonly<Record<string, number>>;
  };
  readonly potential_ceiling: { readonly tiers: readonly Range[] };
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
  /** 捕手的獨立基準線——蹲捕的容忍度比其他守位高。 */
  readonly catcher_bar: {
    readonly base: Readonly<Record<string, number>>;
    readonly age_discount: readonly { readonly max_age: number; readonly discount: number }[];
    readonly default_discount: number;
  };
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
    };
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

export interface LeaguesData {
  readonly levels: Readonly<Record<string, LeagueLevel>>;
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
    readonly role: { readonly starter: { readonly sta_min_d: number; readonly ctl_min_d: number } };
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
      readonly win_rate: { readonly base: number; readonly per_point: number } & Range;
      readonly closer_save_rate: number;
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
    readonly released_forces_retirement_age: number;
    readonly max_age: number;
  };
  readonly advanced: {
    readonly runs_per_win: number;
    readonly win_shares_per_win: number;
    readonly batting_replacement: number;
    readonly pitching_replacement_era_multiplier: number;
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

/** 全部能力代碼，順序穩定（依 abilities.json 的宣告順序）。 */
export const ALL_ABILITIES: readonly AbilityKey[] = Object.keys(abilities.abilities);
