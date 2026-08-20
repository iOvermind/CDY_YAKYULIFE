/**
 * 合約的談判層：年限、長短約取捨、掌控期、續約權。
 *
 * 金額不在這裡——年薪、簽約金、入札金在 `salary.ts`。這裡決定的是**幾年**與
 * **係數**，實際的錢由層級與 d 值算出來再乘上係數。
 *
 * 核心的取捨只有一個：**長約年限長但係數略低，短約年限短但係數高。** 要穩定
 * 保障，還是要賭下一次的身價？年齡越大、成績越差，這個選擇會越來越不由你——
 * 球團乾脆只給短約。
 *
 * 否決過交易的人，下一張合約的係數打折（`tradeRefused`）——季中交易已經接上，
 * 球團記得那件事。傷病史縮短年限（`injuries`）的公式同樣寫完整了，但傷病系統
 * 還沒上線，那個輸入目前恆為零。
 *
 * 本模組是純函式。續約權的年數要擲骰，因此那部分在 `game.ts`。
 */

import { season as cfg } from '../data/index.ts';

/** 一張合約。 */
export interface Contract {
  /** 剩餘年數。跑到 0 就是到期。 */
  readonly years: number;
  /** 年薪係數，乘在該層級的基礎年薪上。 */
  readonly mult: number;
  /** 母隊是否已經提過延長續約。一張合約只問一次。 */
  readonly extensionOffered: boolean;
}

/** 傷病史。目前恆為零——傷病系統尚未實作。 */
export interface InjuryHistory {
  readonly majorInjuries: number;
  readonly tjSurgeries: number;
}

export const NO_INJURIES: InjuryHistory = { majorInjuries: 0, tjSurgeries: 0 };

/** 長短約的兩個方案。 */
export interface TermOptions {
  /** 夠不夠格談長約。年齡大或成績不佳時，球團只給短約。 */
  readonly longEligible: boolean;
  readonly longYears: number;
  readonly longMult: number;
  readonly shortYears: number;
  readonly shortMult: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 這個守位的年限上限。投手遠低於野手——手臂的風險讓球團不敢給長約。 */
export function yearsCap(side: 'pitcher' | 'fielder'): number {
  return cfg.contract.years.cap[side];
}

/** 年齡對年限的上限。取第一個符合的區間；都不符合就是沒有額外限制。 */
function ageCap(age: number, fallback: number): number {
  for (const tier of cfg.contract.years.age_caps.tiers) {
    if (age >= tier.min_age) return tier.max_years;
  }
  return fallback;
}

/**
 * 球團願意給幾年。
 *
 * 成績穩定、傷病少的人簽得到長約；年齡大則被年齡上限截斷——**球團不會給一個
 * 36 歲的人五年約，那五年裡有三年他已經退休了。**
 */
export function contractYears(options: {
  readonly d: number;
  readonly age: number;
  readonly side: 'pitcher' | 'fielder';
  readonly injuries?: InjuryHistory;
}): number {
  const c = cfg.contract.years;
  const cap = yearsCap(options.side);
  const injuries = options.injuries ?? NO_INJURIES;

  const span = c.perf.d_at_full - c.perf.d_at_zero;
  const perf = span === 0 ? 1 : clamp((options.d - c.perf.d_at_zero) / span, 0, 1);

  const penalty =
    injuries.majorInjuries * c.injury_penalty.per_major_injury +
    injuries.tjSurgeries * c.injury_penalty.per_tj_surgery;

  const raw = Math.round(c.base + perf * (cap - c.base) - penalty * cap);
  return clamp(raw, cfg.contract.short_contract.min_years, ageCap(options.age, cap));
}

/** 依上季 d 值決定的基礎年薪係數。 */
function baseMultiplier(d: number): number {
  const m = cfg.contract.multiplier.by_performance;
  for (const tier of m.tiers) {
    if (d >= tier.min_d) return tier.value;
  }
  return m.default;
}

/**
 * 這次談判能拿到的兩個方案。
 *
 * `traits` 用來套用重案組之虎（係數保底）與烏鴉（係數設上限）。兩個特性
 * 目前都不會被授予，因此暫時不會觸發。
 */
export function termOptions(options: {
  readonly d: number;
  readonly age: number;
  readonly side: 'pitcher' | 'fielder';
  readonly injuries?: InjuryHistory;
  readonly traits?: ReadonlySet<string>;
  /** 是否否決過交易。季中交易尚未實作，目前恆為 false。 */
  readonly tradeRefused?: boolean;
}): TermOptions {
  const c = cfg.contract;
  const maxYears = contractYears(options);
  const injuries = options.injuries ?? NO_INJURIES;
  const traits = options.traits ?? new Set<string>();

  let base = baseMultiplier(options.d);
  if (traits.has('franchise')) base = Math.max(base, c.multiplier.trait_modifiers.franchise_min);
  if (options.tradeRefused === true) base *= c.multiplier.trade_refuse_penalty.value;
  if (traits.has('cancer')) base = Math.min(base, c.multiplier.trait_modifiers.cancer_max);

  const shortYears = clamp(maxYears, c.short_contract.min_years, c.short_contract.max_years);
  const longYears = Math.max(c.long_contract.min_years, maxYears);

  // 傷病史多卻只簽得到短約的人，年薪補高一些——球團用錢換掉年限的風險。
  const bonus = c.multiplier.injury_short_bonus;
  const injured = injuries.majorInjuries + injuries.tjSurgeries;
  const shortBoost =
    injured >= bonus.min_injuries && maxYears <= bonus.max_years ? bonus.add : 0;

  return {
    longEligible:
      maxYears > c.long_contract.requires_years_over && options.d >= c.long_contract.requires_min_d,
    longYears,
    longMult: round2(base * c.multiplier.long_factor),
    shortYears,
    shortMult: round2((base + shortBoost) * c.multiplier.short_factor),
  };
}

/**
 * 提前結束合約要付多少，以剩餘年數的年薪計算。
 *
 * **違約的一方付全額**：球員自請離開只付七成，球團主動終止要付十成。剩餘
 * 年數為 1 以下時不計——那張約本來就要到期了。
 */
export function buyoutCost(options: {
  readonly contract: Contract;
  readonly seasonSalary: number;
  readonly initiator: 'player' | 'club';
}): number {
  const remaining = options.contract.years - 1;
  if (remaining <= 0) return 0;
  const rate =
    options.initiator === 'player'
      ? cfg.contract.buyout.player_initiated
      : cfg.contract.buyout.club_initiated;
  return Math.round(remaining * options.seasonSalary * rate);
}

/**
 * 取得 FA 資格了嗎。
 *
 * 兩條路：在同一個體系服務滿掌控期，或者**換過體系**——新東家沒有理由享有
 * 原球團的掌控權。
 */
export function isFreeAgentEligible(options: {
  readonly serviceYears: number;
  readonly changedOrg: boolean;
}): boolean {
  return options.changedOrg || options.serviceYears >= cfg.contract.control.years;
}

/** 母隊會不會提前來談延長。合約剩一年、已有 FA 資格、上季打得不錯才會。 */
export function offersExtension(options: {
  readonly contract: Contract;
  readonly topLevel: boolean;
  readonly freeAgentEligible: boolean;
  readonly d: number;
}): boolean {
  const e = cfg.contract.extension;
  if (options.contract.years !== 1) return false;
  if (options.contract.extensionOffered) return false;
  if (e.requires_top_level && !options.topLevel) return false;
  if (!options.freeAgentEligible) return false;
  return options.d >= e.requires_min_d;
}

/** 選秀進來的第一張約。 */
export function rookieContract(): Contract {
  return {
    years: cfg.contract.rookie_contract.years,
    mult: cfg.contract.rookie_contract.multiplier,
    extensionOffered: false,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
