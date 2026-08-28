/**
 * 規則資料的載入層。
 *
 * JSON 一律帶 `with { type: 'json' }` 的匯入屬性——**伺服器端要用同一份引擎重跑
 * 驗證**（ADR 0007），而 Node 的 ESM 沒有這個屬性就拒絕載入 JSON。Vite 兩種都
 * 吃，因此一份原始碼兩邊都跑得動。
 *
 * 見 CONTEXT.md 的「規則資料」：這些常數決定遊戲怎麼運作，跟著版本走、
 * 對所有玩家相同，與玩家個人的「生涯資料」相對。
 *
 * 目前一律靜態 import，在 build 期綁進產物。未來會加上 runtime 覆蓋層，
 * 屆時凡是用過覆蓋的生涯都必須標記為「自訂規則局」（見 CONTEXT.md）。
 *
 * JSON 檔中所有 `_` 開頭的鍵都是給人看的註解，不參與運算，因此不出現在型別裡。
 */

import achievementsJson from './achievements.json' with { type: 'json' };
import abilitiesJson from './abilities.json' with { type: 'json' };
import amateurJson from './amateur.json' with { type: 'json' };
import awardsJson from './awards.json' with { type: 'json' };
import eventsJson from './events.json' with { type: 'json' };
import flavorJson from './flavor.json' with { type: 'json' };
import hallOfFameJson from './hall_of_fame.json' with { type: 'json' };
import injuryJson from './injury.json' with { type: 'json' };
import leaguesJson from './leagues.json' with { type: 'json' };
import loveJson from './love.json' with { type: 'json' };
import positionsJson from './positions.json' with { type: 'json' };
import traitsJson from './traits.json' with { type: 'json' };
import seasonJson from './season.json' with { type: 'json' };
import talentsJson from './talents.json' with { type: 'json' };
import teamsJson from './teams.json' with { type: 'json' };

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
  /** 用 AP 買下的天賦帶來的全域加成。平常是 0，由設定覆蓋層寫入。 */
  readonly talent_bonus: { readonly ceiling: number };
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
    /** 天賦買來的固定骰數，平常是 0。不吃 min_count，傷缺的球季照給。 */
    readonly bonus_count: number;
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
      /** 二刀流野手側的守位加分。基準是純打擊，守 DH 以外的守位才往上加。 */
      readonly two_way_position_bonus: { readonly scale: number };
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
/** 傷病。每季開打前擲一次，結果落在出賽係數上。 */
export interface InjuryData {
  readonly chance: {
    readonly base: number;
    /** 天賦的乘算層，平常是 1。套在所有加減與 clamp 之後——見 ADR 0033。 */
    readonly talent_multiplier: number;
    readonly age_steps: { readonly tiers: readonly { readonly from_age: number; readonly add: number }[] };
    readonly clamp: Range;
    /**
     * 體力折進受傷機率的部分。出賽場數那一側到頂之後，超額的體力改換這個。
     * 零點是各守位自己的打滿標準（反解自 `stamina_factor`），捕手釘在 `zero_point_cap`。
     */
    readonly stamina: {
      readonly ability: string;
      readonly floor_sta: number;
      readonly per_point_below: number;
      readonly max_add: number;
      readonly per_point_above: number;
      readonly max_cut: number;
      readonly zero_point_cap: number;
    };
    readonly traits: {
      readonly academy: { readonly before_age: number; readonly add: number };
      readonly iron: { readonly base: number };
      readonly glass: { readonly base: number };
      readonly both: { readonly base: number };
    };
  };
  readonly severity: {
    readonly minor_chance: number;
    readonly minor: {
      readonly games_lost_percent: Range;
      readonly aftereffect: { readonly chance: number; readonly points: Range };
    };
    readonly major: {
      readonly season_played_percent: Range;
      readonly ability_loss: { readonly points: number };
      readonly rehab_next_year: { readonly chance: number };
    };
  };
  readonly glass_unlock: {
    readonly major_injuries: number;
    readonly before_age: number;
    readonly trait: string;
  };
  readonly amateur: { readonly chance: number; readonly games_lost_percent: Range };
}

/** 感情。獨立於事件卡的年度場外事件，見 love.json 與 ADR 0006。 */
export interface LoveData {
  readonly gate: {
    readonly min_age: number;
    readonly propose: { readonly requires_pro: boolean; readonly min_age: number };
  };
  readonly cadence: Readonly<Record<string, number>>;
  readonly amateur: {
    readonly confession: {
      readonly base: number;
      readonly per_rank: Readonly<Record<string, number>>;
      readonly clamp: Range;
    };
    readonly checkpoint: {
      readonly break_chance: number;
      /** 天賦「青梅竹馬」的乘算層，平常是 1。乘存活率，不是分手率。見 ADR 0033。 */
      readonly talent_survive_multiplier: number;
    };
  };
  readonly dating: {
    readonly breakup: { readonly from_years: number; readonly base: number; readonly per_year: number };
    readonly public_confirm: { readonly chance: number };
    readonly confidante: { readonly dated_times: number; readonly trait: string };
  };
  readonly marriage: {
    readonly childbirth_chance: { readonly by_kids: readonly number[] };
    readonly max_kids: number;
  };
  readonly affair: {
    readonly chance: number;
    readonly escape_chance: number;
    readonly reward: { readonly ability: string; readonly escaped: number; readonly refused: number };
    readonly caught: {
      readonly single_ability_loss: number;
      readonly apology_success: number;
      readonly apology_failed_loss: number;
      readonly scum: {
        readonly caught_times: number;
        readonly trait: string;
        readonly all_ability_loss: number;
      };
    };
    readonly dating_breakup_penalty: { readonly add: number; readonly years: number };
  };
  readonly turmoil: {
    readonly base_chance: number;
    /** 天賦「心無旁騖」的乘算層，平常是 1。最後才乘。見 ADR 0033。 */
    readonly talent_multiplier: number;
    readonly swallow: { readonly crack_adds_chance: number; readonly reward_penalty_per_crack: number };
    readonly leave: { readonly ability_loss: number };
    readonly kinds: readonly { readonly id: string; readonly text: string }[];
  };
  readonly overseas: {
    readonly bring: {
      readonly turmoil_curve: readonly number[];
      readonly cost_ratio: number;
      readonly achievement: string;
    };
    readonly apart: { readonly turmoil_add: number };
  };
  readonly injury_support: { readonly rehab_chance: number };
  readonly injury_risk: {
    readonly married: number;
    readonly with_kids: number;
    readonly turmoil_year: number;
  };
  readonly divorce: { readonly base_ratio: number; readonly per_kid_ratio: number };
  readonly childhood_sweetheart: { readonly trait: string; readonly name: string };
  readonly names: {
    readonly school: readonly string[];
    readonly pro: readonly string[];
    /** 安全名單。與 school/pro 共用名字池，只在外遇抽選時排除。 */
    readonly safe: readonly string[];
  };
}

/** 成就與成就點數（AP）。跨局的 Meta-progression，見 CONTEXT.md。 */
export interface AchievementsData {
  readonly categories: {
    readonly trait: {
      readonly name: string;
      readonly default: number;
      readonly by_tone: Readonly<Record<string, number>>;
      readonly by_id: Readonly<Record<string, number>>;
    };
    readonly amateur_cup: {
      readonly name: string;
      readonly default: number;
      readonly by_rank: Readonly<Record<string, number>>;
    };
    readonly international: {
      readonly name: string;
      readonly default: number;
      readonly by_rank: Readonly<Record<string, number>>;
      readonly mvp: number;
    };
    readonly award: {
      readonly name: string;
      readonly default: number;
      readonly by_code: Readonly<Record<string, number>>;
    };
    readonly tier: { readonly name: string; readonly by_tier: readonly number[] };
    readonly hall: { readonly name: string; readonly default: number };
    /** 姻緣。與不同對象結婚各算一項，一律同價。 */
    readonly marriage: { readonly name: string; readonly default: number };
    readonly cumulative: {
      readonly name: string;
      /** 各範圍從第幾階起算。生涯的第一階就是聯盟的第二階，級距不變。 */
      readonly first_rung: { readonly league: number; readonly career: number };
      readonly rungs: Readonly<
        Record<
          string,
          {
            readonly name: string;
            /** 對應 BattingLine / PitchingLine 的欄位名。 */
            readonly side: 'batter' | 'pitcher';
            /** 一個顯示單位等於幾個原始數據（投球局數存出局數，unit 3）。 */
            readonly unit?: number;
            /**
             * 級距。第 n 階的門檻是 n×step，上不封頂——階梯是生成的，沒有表尾，
             * 也就沒有「表尾即天花板」這種沒人宣告過的上限。
             */
            readonly step: number;
            /** 第一階的分數。第 n 階給 n×points，AP 與生涯評價分共用。 */
            readonly points: number;
          }
        >
      >;
    };
  };
  readonly first_career_bonus: { readonly points: number; readonly name: string; readonly desc: string };
}

/** 天賦。用 AP 購買的永久強化，效果走設定覆蓋層宣告。見 ADR 0007。 */
export interface TalentsData {
  readonly talents: readonly {
    readonly id: string;
    readonly name: string;
    readonly group: string;
    readonly desc: string;
    readonly levels: readonly {
      readonly cost: number;
      readonly effect_text: string;
      readonly effects: readonly {
        readonly path: string;
        readonly op: 'add' | 'set';
        readonly value: number;
        readonly min?: number;
        readonly max?: number;
      }[];
    }[];
  }[];
}

export interface FlavorData {
  readonly placeholders: Readonly<Record<string, string>>;
  /** 引退時的鄉民留言，鍵是分級（0 最高）。 */
  readonly fan_reactions: Readonly<Record<string, readonly string[]>>;
  readonly retire_scenes: Readonly<
    Record<string, string | Readonly<Record<string, string | Readonly<Record<string, string>>>>>
  >;
  readonly second_life: { readonly closing: string; readonly stories: readonly string[] };
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
  readonly kind: 'rate' | 'counting' | 'shares';
  /**
   * 對手池代碼。給了就由 `rival_pool` 推導門檻，`d` / `base` 一律忽略。
   * 見 ADR 0017。
   */
  readonly pool?: string;
  /** 率型的門檻：相對聯盟平均的能力差。**有 `pool` 的獎不再需要它。** */
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
  };
  /** 「聯盟第一名」型獎項的門檻推導。見 ADR 0017。 */
  readonly rival_pool: {
    /** 替代水準在能力分佈的哪個下尾分位。整套模型唯一的自由參數。 */
    readonly replacement_quantile: number;
    /** 每隊有幾個人在爭這座獎，依獎項的對手池分類。 */
    readonly per_team: Readonly<Record<string, number>>;
    /** 查不到隊數時的隊數。 */
    readonly default_teams: number;
  };
  readonly titles: { readonly list: readonly LeaderAward[] };
  readonly pitcher_of_year: LeaderAward;
  /** 年度最佳打者。與最佳投手對稱——漢克阿倫獎掛在這裡。 */
  readonly batter_of_year: LeaderAward;
  /** 聯盟獨有的獎項名稱。鍵是體系代碼，值是獎項代碼到名稱的對照。 */
  readonly aliases: Readonly<Record<string, Readonly<Record<string, string>>>>;
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
  /** 守位門檻相對於該層級 par 的位移。門檻 = par + 位移，只在頂級聯盟生效。 */
  readonly defense_offsets: Readonly<Record<string, number>>;
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
  /** 天賦買來的全域折扣，平常是 0。在乘上倍率之後才扣。 */
  readonly discount: number;
  readonly min_cost: number;
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
  /** 職業期的國家隊徵召。門檻以中職為基準——旅外不會改變國籍。 */
  readonly international: {
    readonly tournaments: Readonly<
      Record<
        string,
        {
          readonly name: string;
          readonly short: string;
          readonly from_year: number;
          readonly every: number;
          readonly exclude_levels: readonly string[];
        }
      >
    >;
    readonly eligibility: {
      readonly reference_level: string;
      readonly min_d: number;
      readonly min_season_factor: number;
    };
    readonly conscription: { readonly lock_years: number };
    readonly power_bonus: {
      readonly base_overall: number;
      readonly factor: number;
      readonly max: number;
    };
    readonly thresholds: readonly number[];
    readonly ranks: readonly string[];
    readonly points: readonly number[];
    readonly honor_ranks: { readonly values: readonly string[] };
    /** 榮譽字串的前綴。與養成期同一個——中華隊就是中華隊。 */
    readonly honor_prefix: string;
    readonly mvp: {
      readonly by_rank: Readonly<Record<string, number>>;
      readonly clutch_multiplier: number;
      readonly clutch_trait: string;
      readonly suffix: string;
    };
    readonly stats: {
      readonly par: number;
      readonly batter_games: Range;
      readonly starter_games: Range;
      readonly reliever_games: Range;
    };
    readonly injury_next_season: number;
    readonly intlace_effect: {
      readonly trait: string;
      readonly injury_next_season: number;
      readonly min_points: number;
      readonly min_caps: number;
      readonly min_podiums: number;
    };
    readonly taiwan_trigger: { readonly min_count: number; readonly trait: string };
    readonly score: { readonly by_rank: Readonly<Record<string, number>>; readonly mvp: number };
  };
  /** 高中畢業時的旅外簽約。選秀之外的另一個出口，見 amateur.json。 */
  readonly amateur_overseas: {
    readonly offers: Range;
    readonly paths: readonly {
      readonly org: string;
      readonly min_overall: number;
      readonly label: string;
      readonly note: string;
      readonly level: string;
      readonly level_upgrade?: { readonly min_overall: number; readonly level: string };
      readonly signing_bonus: { readonly base: number; readonly per_point_over: number };
    }[];
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
  /**
   * 在這個體系服務滿幾年之後不再算外籍（不收 import_premium）。
   *
   * 缺席表示這個體系沒有這條規則。日職是 8——「在籍八年視同本土」。
   */
  readonly domestic_after_years?: number;
  /**
   * 一軍服務滿幾年之後可以拒絕下放（見 ADR 0020）。
   *
   * 缺席表示這個體系的下放是球團說了算。MLB 是 5——五年年資條款。
   */
  readonly refuse_demotion_after_years?: number;
  /** 入札制度的目的地。null 表示這個體系沒有入札。 */
  readonly posting: { readonly to: string } | null;
  readonly age_window: AgeWindow | null;
}

export interface TransferData {
  /** 球員的母國體系。回這裡不算外籍，不收 import_premium。 */
  readonly home_org: { readonly value: string };
  readonly import_premium: { readonly value: number };
  /** 球隊的處境如何改變它開出的條件：爭冠的砸錢但給短約，重建的相反。 */
  readonly contention: {
    readonly reference_odds: number;
    readonly bonus: { readonly per_odds: number; readonly min: number; readonly max: number };
    readonly years: { readonly per_odds: number; readonly min: number; readonly max: number };
  };
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
      /** 錨點是以幾場的賽季為尺量出來的。場次較少的聯盟依比例下調門檻。 */
      readonly reference_games: number;
      /** 錨點表，依 `sta` 遞增。段與段之間線性內插，兩端壓平。 */
      readonly anchors: readonly { readonly sta: number; readonly value: number }[];
      readonly min: number;
      readonly max: number;
    };
    readonly trust_factor: { readonly base: number; readonly per_point: number } & Range;
    readonly position_factor: Readonly<Record<string, number>>;
    readonly position_factor_clamp: Range;
    readonly games_noise: Range;
    readonly pa_per_game: { readonly at_par: number; readonly per_point: number } & Range;
    readonly pa_noise: Range;
    readonly pa_absolute_noise_divisor: { readonly value: number };
  };
  readonly batting: {
    readonly walk_rate: RateSpec;
    readonly intentional_walk: {
      readonly abilities: Readonly<Record<string, number>>;
      readonly divisor: number;
      /** 能力先平移到這個 par 再算恐懼值，因此 Dom 只吃 d，不吃絕對 par。 */
      readonly reference_par: number;
      readonly threshold: number;
      /** 曲線的另一端：Dom 到這裡時，一季 per_season_pa 個打席會被敬遠 walks 次。 */
      readonly peak: {
        readonly dom: number;
        readonly per_season_pa: number;
        readonly walks: number;
      };
      readonly exponent: number;
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
  /** 同一支球隊的年數門檻（mrteam）。 */
  readonly threshold?: number;
  /** 各聯盟的球隊數門檻，超過才觸發（rainbow）。沒列到的聯盟不會觸發。 */
  readonly thresholds?: Readonly<Record<string, number>>;
}

export interface TraitsData {
  readonly categories: { readonly positive: readonly string[]; readonly negative: readonly string[] };
  readonly traits: readonly Trait[];
  /**
   * 依生涯內容組出來的顯示名稱。
   *
   * 鍵為特性 id，只涵蓋 `dynamic_name` 為 true 的那幾個。`pattern` 裡的
   * `{...}` 佔位符由取得特性的當下填入——聯盟名、球隊代表詞這種東西在
   * 資料檔裡寫不死。
   */
  readonly dynamic_names: Readonly<
    Record<string, { readonly pattern: string; readonly source: string }>
  >;
}

export const abilities = abilitiesJson as unknown as AbilitiesData;
export const amateur = amateurJson as unknown as AmateurData;
export const awards = awardsJson as unknown as AwardsData;
export const flavor = flavorJson as unknown as FlavorData;
export const hallOfFame = hallOfFameJson as unknown as HallOfFameData;
/**
 * 事件卡。
 *
 * 型別定義在 `engine/events.ts`（那裡才有 GameEvent 的形狀），這裡只負責把原始
 * 資料掛進資料層——設定覆蓋層要透過統一的入口才改得到它。
 */
export const events = eventsJson as unknown as Record<string, unknown>;
export const injury = injuryJson as unknown as InjuryData;
export const love = loveJson as unknown as LoveData;
export const achievements = achievementsJson as unknown as AchievementsData;
export const talents = talentsJson as unknown as TalentsData;
export const positions = positionsJson as unknown as PositionsData;
export const traits = traitsJson as unknown as TraitsData;

/** 依 id 取特性。找不到回傳 undefined——未知的 id 不該假裝有名字。 */
export function traitOf(id: string): Trait | undefined {
  return traits.traits.find((t) => t.id === id);
}

/**
 * 特性的顯示名稱。**這是唯一來源。**
 *
 * 名稱曾經同時寫在兩個地方：發特性時傳進卡片的字串，與 `traits.json` 的
 * `name`。兩份不會自己對齊——`legend` 的卡片寫「歷史級球星」，資料檔卻是
 * null，於是特性面板把它整個濾掉了。玩家看得到卡片，看不到特性。
 *
 * `dynamic_name` 的三個沒有固定字串，要靠 `fill` 補上生涯內容；缺 `fill`
 * 是呼叫端的錯，寧可炸掉也不要靜靜生出一個半截的名字。
 */
export function traitName(id: string, fill?: string): string {
  const def = traitOf(id);
  if (def === undefined) throw new Error(`未知的特性：${id}`);
  if (def.name !== null) return def.name;

  const dynamic = traits.dynamic_names[id];
  if (dynamic === undefined) throw new Error(`特性 ${id} 沒有名字，也沒有 dynamic_names`);
  if (fill === undefined) throw new Error(`特性 ${id} 的名稱要靠生涯內容組出來，呼叫端沒有給`);
  return dynamic.pattern.replace(/\{[a-z_]+\}/g, fill);
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

/**
 * 四大球系的代碼。
 *
 * 從 `abilities.json` 推出來，不再手寫第二份——手寫的那份與資料檔一起活了
 * 很久，四個系的中文名與球種清單就這樣躺在資料裡沒人讀。護欄測試盯著它與
 * `ability_groups.pitcher` 的關係。
 */
export const PITCH_FAMILIES: readonly PitchFamily[] = dataKeys(
  abilities.pitch_families,
) as readonly PitchFamily[];
