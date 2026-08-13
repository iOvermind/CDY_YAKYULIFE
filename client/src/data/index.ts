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
import positionsJson from './positions.json';
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
    readonly two_way: GrowthCurve;
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
  readonly defense_score_weight: Readonly<Record<string, number>>;
  readonly defense_score_scale: { readonly scale: number };
  readonly rank: Readonly<Record<string, number>>;
  readonly scan_order: Readonly<Record<string, readonly string[] | string>>;
}

/** 成長成本曲線。tiers 由高到低比對，取第一個 current >= from 的 cost。 */
export interface GrowthCurve {
  readonly tiers: readonly { readonly from: number; readonly cost: number }[];
  readonly above_ceiling_multiplier: number;
}

export interface AmateurData {
  readonly career_start: { readonly age: number; readonly year: number };
  readonly stages: {
    readonly order: readonly SchoolStage[];
  } & Readonly<Record<string, StageDefinition | readonly SchoolStage[] | string>>;
  readonly junior_high: SchoolTiers;
  readonly high_school: SchoolTiers;
  readonly amateur_international: {
    readonly tournaments: Readonly<Record<string, YouthTournament>>;
    readonly ranks: readonly string[];
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
      readonly steal_rate: RateSpec;
      readonly steal_success: number;
      readonly noise: Range;
    };
    readonly pitching: {
      readonly innings_per_game: RateSpec;
      readonly k_per_nine: RateSpec;
      readonly bb_per_nine: RateSpec;
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
    readonly points_bonus: { readonly overall_divisor: number };
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

export const abilities = abilitiesJson as unknown as AbilitiesData;
export const amateur = amateurJson as unknown as AmateurData;
export const positions = positionsJson as unknown as PositionsData;
export const teams = teamsJson as unknown as TeamsData;

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
