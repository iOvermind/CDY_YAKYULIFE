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
import type { AbilityKey } from '../data/index.ts';
import type { World } from './rng.ts';

/** 感情狀態。 */
export type LoveStatus = 'single' | 'dating' | 'married' | 'divorced';

/** 旅外時對這段關係的安排。 */
export type OverseasArrangement = 'none' | 'bring' | 'apart';

/**
 * 三人行的兩種形狀。**刻意不對稱**——你破的局收得回來，她破的局收不回來。
 *
 * `harem`（鹿鼎公）：你外遇被抓，她反而把那個人請上檯面。兩位對象並存，感情
 * 回報與生子各擲各的骰。
 *
 * `cuckold`（縮頭烏龜）：她出軌，而你留下來了。多出來的那個人不是你的，所以
 * 沒有第二份回報——只有每年倒扣的當季狀態，與一段走不掉的關係。
 */
export type OpenRelationship = 'none' | 'harem' | 'cuckold';

/** 一段生涯的感情狀態。 */
export interface LoveState {
  status: LoveStatus;
  partner: string | null;
  /** 第二位對象。只有鹿鼎公有，其餘一律 null。 */
  partner2: string | null;
  /** 三人行的形狀。 */
  open: OpenRelationship;
  /** 對象是在養成期認識的。青梅竹馬的前提。 */
  fromSchool: boolean;
  /** 交往年數。求婚可行之後才累計——見 `breakupChance`。 */
  datingYears: number;
  /** 第一位對象生的孩子。 */
  kids: number;
  /** 第二位對象生的孩子。**各記各的**——生子機率是逐胎遞減的，兩位得各自從第一胎算起。 */
  kids2: number;
  /** 交往過幾段。啦啦隊殺手看它。 */
  datedTimes: number;
  /** 外遇次數（含沒被抓到的）。外務纏身看它。 */
  affairs: number;
  /** 被抓次數。花樣年華看它。 */
  caught: number;
  /** 離過幾次婚。 */
  divorces: number;
  /**
   * 結婚的年份。沒結過婚是 null。
   *
   * **它是感情的狀態，不是流程的變數**——結算的【人生】那一列要寫它，而那一列
   * 問的正是「這段感情走到哪裡」。
   */
  marriedYear: number | null;
  /**
   * 走過紅毯的對象，依序去重。離婚再娶不會抹掉前一個名字。
   *
   * 與 `partner` 分工：那個是**現在**在身邊的人，這份是這一生走過紅毯的全部。
   * 成就的「姻緣」數的是不同的對象（見 achievements.ts），所以它活得比任何一段
   * 關係都長——分手與離婚都不清空它。
   */
  spouses: string[];
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
    partner2: null,
    open: 'none',
    fromSchool: false,
    datingYears: 0,
    kids: 0,
    kids2: 0,
    datedTimes: 0,
    affairs: 0,
    caught: 0,
    divorces: 0,
    marriedYear: null,
    spouses: [],
    cracks: 0,
    cheatPenaltyYears: 0,
    turmoilThisYear: false,
    overseas: 'none',
    overseasYears: 0,
  };
}

/**
 * 把一位對象記進婚姻史。
 *
 * 去重是刻意的：離婚後與同一個人復合再婚，成就上不算新的一項——那是同一段關係
 * 的第二次嘗試，不是另一個人。
 */
export function recordSpouse(love: LoveState, name: string | null): void {
  if (name === null || name === '') return;
  if (love.spouses.includes(name)) return;
  love.spouses.push(name);
}

/** 兩位對象一起算的孩子數。畫面上的「幾個孩子」與贍養費看的都是這個。 */
export function totalKids(love: LoveState): number {
  return love.kids + love.kids2;
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
 *
 * 天賦「練球機器」是**最後才乘**的一層（見 ADR 0033）：它按比例減災，所以裂痕
 * 累得越多、它擋掉的越多，但永遠壓不到零。
 */
export function turmoilChance(love: LoveState): number {
  if (!hasPartner(love)) return 0;
  // 縮頭烏龜那段關係不會再有風波——**最壞的事已經發生過，而你選擇留下來**。
  // 它的代價寫在別的地方（每年倒扣的狀態、走不掉的出口），不在這裡。
  if (love.open === 'cuckold') return 0;
  const t = cfg.turmoil;
  // **她的性格決定起點，你們一起走過的事決定後來。** 檔次只換掉基礎那一格，
  // 裂痕與旅外的加成照樣疊在上面——不然「定得下來」會變成一張免死金牌。
  //
  // 三人行先取兩位的平均，再乘上三個人本來就比較難的那個倍率：抽到兩個安定
  // 的人仍然比較平靜，但平靜不到只有兩個人的程度。
  let p =
    t.base_chance * loyaltyTier(love) * (love.open === 'harem' ? cfg.threesome.harem.turmoil_multiplier : 1) +
    love.cracks * t.swallow.crack_adds_chance;

  if (love.overseas === 'bring') {
    const curve = cfg.overseas.bring.turmoil_curve;
    p += curve[Math.min(love.overseasYears, curve.length - 1)] ?? 0;
  } else if (love.overseas === 'apart') {
    p += cfg.overseas.apart.turmoil_add;
  }
  return Math.max(0, p * t.talent_multiplier);
}

/** 風波基礎值看的那一格「定不定得下來」。兩位對象時取平均。 */
function loyaltyTier(love: LoveState): number {
  const first = partnerTier(love.partner, 'loyalty');
  if (love.partner2 === null) return first;
  return (first + partnerTier(love.partner2, 'loyalty')) / 2;
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

/**
 * 生子的機率。第一胎最優先，越生越少，再乘上她自己想不想要。
 *
 * 夾在 100：想要孩子的那一檔乘完第一胎會超過 100，而機率不該大於必然。
 */
export function childbirthChance(kids: number, partner: string | null = null): number {
  const base = cfg.marriage.childbirth_chance.by_kids[kids] ?? 0;
  return Math.min(100, base * partnerTier(partner, 'children'));
}

/**
 * 離婚要分走多少生涯收入。有孩子分得更多，花錢兇的分得也更多。
 *
 * **只有基礎那一段吃檔次，每個孩子那一段不吃**——孩子的贍養費是孩子的事，
 * 與她習慣怎麼過日子無關。
 */
export function divorceCost(
  earnings: number,
  kids: number,
  partner: string | null = null,
  partner2: string | null = null,
): number {
  const d = cfg.divorce;
  // 三人行破局是**兩份一起賠**：兩位的花錢檔次相加，不是取平均——好處放大的
  // 那一段就是這裡要還的。
  const spending =
    partnerTier(partner, 'spending') + (partner2 === null ? 0 : partnerTier(partner2, 'spending'));
  return Math.round(earnings * (d.base_ratio * spending + kids * d.per_kid_ratio));
}

/**
 * 縮頭烏龜那段關係結束時，你**收得到**的贍養費。
 *
 * 她先外遇的事實，不會因為你後來也外遇而消失——所以出口不管走哪一條，錢都是
 * 往你這邊流。只有已婚才有，交往中就只是分手。
 */
export function alimony(earnings: number): number {
  return Math.round(earnings * cfg.threesome.cuckold.alimony_ratio);
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

/**
 * 對象的側寫。**每個名字都有一筆**——沒有空白的對象，所以重抽只會換風格，不會換強弱。
 *
 * 側寫那一句話不明寫數值，但看得出她怎麼花錢、想不想要孩子、定不定得下來。**那是玩家
 * 在告白之前唯一拿得到的線索**，所以它必須在選擇之前就顯示出來，不是在一起之後才補。
 */
export function partnerOf(
  name: string | null,
): {
  readonly desc: string;
  readonly abilities: readonly AbilityKey[];
  readonly spending: string;
  readonly children: string;
  readonly loyalty: string;
} | null {
  if (name === null) return null;
  const profile = cfg.partners[name];
  // `tier_multipliers` 與側寫掛在同一張表上，它不是一位對象。
  return profile === undefined || typeof profile.desc !== 'string' ? null : profile;
}

/**
 * 對象在某一條軸上的倍率。
 *
 * 側寫那三句話——她怎麼花錢、想不想要孩子、定不定得下來——各對應一條軸，而
 * **這支函式是那三句話唯一的兌現處**。名單外的名字（測試造的、舊存檔留下的）
 * 一律回 1，也就是改版前的全域值：查無此人不該讓整條感情線斷掉。
 */
export function partnerTier(name: string | null, axis: 'spending' | 'children' | 'loyalty'): number {
  const profile = partnerOf(name);
  if (profile === null) return 1;
  return cfg.partners.tier_multipliers[axis][profile[axis]] ?? 1;
}

/**
 * 感情事件把當季點數加在哪一項能力上。
 *
 * 走對象自己的那兩項——這是側寫裡 `[增加能力]` 的兌現處。名單外的名字（測試造的、
 * 舊存檔留下的）退回設定裡的預設值，不要因為查無此人就整條感情線斷掉。
 */
export function partnerBonusKey(world: World, name: string | null): AbilityKey {
  const profile = partnerOf(name);
  const keys = profile?.abilities ?? [];
  if (keys.length === 0) return cfg.affair.reward.ability as AbilityKey;
  return keys[world.stream('career').int(0, keys.length - 1)] ?? (cfg.affair.reward.ability as AbilityKey);
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
