/**
 * 感情。
 *
 * 移植自 `index_legacy.html` 的 `loveEvent()` 一族，並補上五件 legacy 沒有的事：
 * 養成期的感情線、旅外的遠距離、大傷那一年的陪伴、離婚的財務代價、感情風波。
 *
 * **legacy 的感情線除了外遇之外沒有真正的兩難**——正確答案永遠是陪伴與拒絕誘惑。
 * 新增的五項都是為了補這件事：旅外要選一種壞法，風波要選一種痛法。
 *
 * 本模組是狀態機與純函式。提問與卡片在 `game.ts`，因為那些要用 flow。
 */

import { love as cfg } from '../data/index.ts';
import type { World } from './rng.ts';

/** 感情狀態。 */
export type LoveStatus = 'single' | 'dating' | 'married' | 'divorced';

/** 旅外時對這段關係的安排。 */
export type OverseasArrangement = 'none' | 'bring' | 'apart';

/** 一段生涯的感情狀態。 */
export interface LoveState {
  status: LoveStatus;
  partner: string | null;
  /** 對象是在養成期認識的。青梅竹馬的前提。 */
  fromSchool: boolean;
  /** 交往年數。求婚可行之後才累計——見 `breakupChance`。 */
  datingYears: number;
  kids: number;
  /** 交往過幾段。啦啦隊殺手看它。 */
  datedTimes: number;
  /** 外遇次數（含沒被抓到的）。外務纏身看它。 */
  affairs: number;
  /** 被抓次數。花樣年華看它。 */
  caught: number;
  /** 離過幾次婚。 */
  divorces: number;
  /** 吞下去的風波次數。裂痕越多，往後越不平靜。 */
  cracks: number;
  /** 劈腿被抓之後的分手加成還剩幾年。 */
  cheatPenaltyYears: number;
  /** 這一年有沒有出過事。傷病的風險修正看它。 */
  turmoilThisYear: boolean;
  /** 旅外時的安排。 */
  overseas: OverseasArrangement;
  /** 旅外之後過了幾年。帶她走的適應期駝峰看它。 */
  overseasYears: number;
}

export function newLoveState(): LoveState {
  return {
    status: 'single',
    partner: null,
    fromSchool: false,
    datingYears: 0,
    kids: 0,
    datedTimes: 0,
    affairs: 0,
    caught: 0,
    divorces: 0,
    cracks: 0,
    cheatPenaltyYears: 0,
    turmoilThisYear: false,
    overseas: 'none',
    overseasYears: 0,
  };
}

/** 有沒有伴。傷病的陪伴與風波都看它。 */
export function hasPartner(love: LoveState): boolean {
  return love.status === 'dating' || love.status === 'married';
}

/** 求婚可不可行。**十五歲的人不會在主場本壘板後方跪下來。** */
export function canPropose(options: { readonly pro: boolean; readonly age: number }): boolean {
  const g = cfg.gate.propose;
  if (g.requires_pro && !options.pro) return false;
  return options.age >= g.min_age;
}

/** 這一年要不要跑感情事件。**交往中必定跑**——那是一段關係的進展，不該靠運氣。 */
export function cadenceChance(love: LoveState): number {
  const c = cfg.cadence;
  switch (love.status) {
    case 'dating':
      return c.dating ?? 100;
    case 'married':
      return (love.kids > 0 ? c.married_with_kids : c.married_childless) ?? 30;
    case 'divorced':
      return c.divorced ?? 40;
    default:
      return c.single ?? 40;
  }
}

/**
 * 校園告白的成功率。
 *
 * 看**當年最好的大賽名次**——打進四強的王牌與坐板凳的人，在學校裡本來就不是同一
 * 回事。這讓養成期的感情線接上已經存在的系統，而不是另開一個與棒球無關的擲骰。
 */
export function confessionChance(bestRank: string | null): number {
  const c = cfg.amateur.confession;
  const bonus = bestRank === null ? 0 : (c.per_rank[bestRank] ?? 0);
  return Math.max(c.clamp.min, Math.min(c.clamp.max, c.base + bonus));
}

/**
 * 交往的分手風險。
 *
 * 「婚期一延再延」——**只在求婚已經可行的時候累計**。還不能求婚的人不該因為沒
 * 結婚而被拆散，學生時期改由關卡處理。
 */
export function breakupChance(
  love: LoveState,
  options: { readonly canPropose: boolean },
): number {
  const b = cfg.dating.breakup;
  const cheat = love.cheatPenaltyYears > 0 ? cfg.affair.dating_breakup_penalty.add : 0;
  if (!options.canPropose) return cheat;
  const over = love.datingYears - b.from_years;
  const aging = over >= 0 ? b.base + over * b.per_year : 0;
  return aging + cheat;
}

/**
 * 這一年的風波機率。
 *
 * 三個來源疊加：**吞下去累積的裂痕**、旅外的安排、基礎值。帶她走是駝峰（適應期
 * 會過去），遠距離是平穩的一條高線（她的人生還在，只是時差對不上）。
 */
export function turmoilChance(love: LoveState): number {
  if (!hasPartner(love)) return 0;
  const t = cfg.turmoil;
  let p = t.base_chance + love.cracks * t.swallow.crack_adds_chance;

  if (love.overseas === 'bring') {
    const curve = cfg.overseas.bring.turmoil_curve;
    p += curve[Math.min(love.overseasYears, curve.length - 1)] ?? 0;
  } else if (love.overseas === 'apart') {
    p += cfg.overseas.apart.turmoil_add;
  }
  return Math.max(0, p);
}

/**
 * 感情事件給的點數要打幾折。
 *
 * 吞下去的裂痕越多，回報越少——**心裡有事，安定感就沒了**。這是「慢性」的具體
 * 形狀：它不會在某一年痛，它讓往後每一年都少一點。
 */
export function rewardMultiplier(love: LoveState): number {
  const penalty = love.cracks * cfg.turmoil.swallow.reward_penalty_per_crack;
  return Math.max(0, 1 - penalty);
}

/** 這一年的受傷率修正。感情狀態雙向回饋到傷病。 */
export function injuryRiskModifier(love: LoveState): number {
  const r = cfg.injury_risk;
  let delta = 0;
  if (love.status === 'married') {
    delta += r.married;
    if (love.kids > 0) delta += r.with_kids;
  }
  if (love.turmoilThisYear) delta += r.turmoil_year;
  return delta;
}

/** 大傷之後隔年報廢的機率。有人陪的話熬得住——**不是治好，是熬得住**。 */
export function rehabChance(love: LoveState, base: number): number {
  return hasPartner(love) ? cfg.injury_support.rehab_chance : base;
}

/** 生子的機率。第一胎最優先，越生越少。 */
export function childbirthChance(kids: number): number {
  return cfg.marriage.childbirth_chance.by_kids[kids] ?? 0;
}

/** 離婚要分走多少生涯收入。有孩子分得更多。 */
export function divorceCost(earnings: number, kids: number): number {
  const d = cfg.divorce;
  return Math.round(earnings * (d.base_ratio + kids * d.per_kid_ratio));
}

/**
 * 青梅竹馬：養成期認識的對象，熬過所有關卡，最後結婚。
 *
 * **那是養成期感情線存在的理由**——不然學生時期的感情只是一段跟後面無關的插曲。
 */
export function isChildhoodSweetheart(love: LoveState): boolean {
  return love.status === 'married' && love.fromSchool;
}

/**
 * 從名單裡挑一個對象。走訪順序照資料的宣告順序，否則同一個種子會挑出不同的人。
 *
 * `excludeSafe` 用於外遇：安全名單上的名字**永遠不會**成為外遇對象。它們仍然
 * 是正常的交往與結婚人選——差別只在這一個抽選點。連耗盡名單時的退路也要排除，
 * 不然「永遠不會」就變成「幾乎不會」。
 */
export function pickPartner(
  world: World,
  pool: 'school' | 'pro',
  exclude: string | null,
  excludeSafe = false,
): string {
  const safe = new Set(excludeSafe ? cfg.names.safe : []);
  const usable = cfg.names[pool].filter((n) => !safe.has(n));
  const list = usable.filter((n) => n !== exclude);
  const source = list.length > 0 ? list : usable;
  if (source.length === 0) return '';
  return source[world.stream('career').int(0, source.length - 1)] ?? '';
}

/** 分手或離婚之後的狀態。離過婚的人回不到「單身」。 */
export function afterBreakup(love: LoveState): LoveStatus {
  return love.divorces > 0 ? 'divorced' : 'single';
}

/**
 * 啦啦隊殺手：三段戀情**都以分手收場**，而且從未結過婚。
 *
 * **只在戀情結束的那一刻判定。** 呼叫點在 `game.ts` 的兩條分手路徑上，而且離婚那
 * 條要排除——見 ADR 0024。原本寫在開始交往的地方，於是在「剛在一起」的那一刻就
 * 宣告「還是走到了同樣的結局」，這段有沒有走到婚姻根本還沒發生。
 *
 * `divorces === 0` 就是「從未結過婚」：婚姻只有分手那個出口，那裡必定累加
 * `divorces`。孩子不必另外擋——`kids` 只在婚後的生產分支累加，沒結婚本身就擋掉了。
 */
export function earnsConfidante(love: LoveState): boolean {
  if (love.divorces > 0) return false;
  return love.datedTimes >= cfg.dating.confidante.dated_times;
}
