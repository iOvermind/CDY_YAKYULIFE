/**
 * 能力成長：訓練骰、成本曲線與蓄力槽。
 *
 * 移植自 index_legacy.html 的 abCost() / addAb() 與季初擲骰。
 * 本模組的所有抽取一律走 growth 子序列（見 ADR 0002 的歸屬規則）。
 */

import { abilities, season, type AbilityKey, type GrowthCurve } from '../data/index.ts';
import type { World } from './rng.ts';

/** 蓄力槽：每項能力未滿一級的點數存放處。 */
export type Carry = Record<AbilityKey, number>;

export interface TrainResult {
  /** 實際提升的級數。 */
  readonly gained: number;
  /** 這次之後留在蓄力槽的點數。 */
  readonly carry: number;
  /** 已達量表上限後真正浪費掉的點數。 */
  readonly overflow: number;
}

/**
 * 成本情境：一條曲線，加上二刀流是否適用折扣。
 *
 * 二刀流不再有自己的一條曲線。舊做法是把整條 tiers 往後推，結果「便宜多少」
 * 得靠兩張表對照才看得出來；改成直接從成本扣點，玩家看得到自己省了幾點。
 */
export interface CostContext {
  readonly curve: GrowthCurve;
  readonly twoWay: boolean;
  /**
   * 目前年齡。決定年齡附加費（見 `agingSurcharge`）。
   *
   * 省略時附加費為零——養成期、以及只想問「這條曲線本身長怎樣」的地方都用得到。
   */
  readonly age?: number | undefined;
  /**
   * 這是哪一項能力。只有守備能力吃得到「守備奇才」那個折扣倍率。
   *
   * 省略時不套用守備折扣——問「這條曲線本身長怎樣」的地方不必指定是哪一項。
   */
  readonly key?: AbilityKey | undefined;
}

/** 取得成本情境。名稱沿用 growthCurve，呼叫端不必改。 */
export function growthCurve(isTwoWay: boolean, age?: number, key?: AbilityKey): CostContext {
  return { curve: abilities.growth_cost.default, twoWay: isTwoWay, age, key };
}

/** 這一項算不算守備能力。與能力表的守備那一格同一份名單。 */
function isFielding(key: AbilityKey | undefined): boolean {
  if (key === undefined) return false;
  return (abilities.display_groups.members.fielding ?? []).some((k) => k === key);
}

/**
 * 年齡附加費：開始老化之後，每一級要多付幾點。
 *
 * **這是老化的第二條腿。** 衰退把練上去的東西吃回來，附加費則讓你再也追不回來
 * ——只加重衰退做不到後者，那只是掉得快一點，練回來的價錢還是一樣，於是三十五
 * 歲的球員仍然可以靠訓練骰把自己補回巔峰。
 *
 * 每四年 +1，**與能力段無關**：31–34 +1、35–38 +2、39–42 +3、43–46 +4。只對
 * 能力 50 以上生效——50 以下本來就是 1 點一級，那是還沒開發的東西，年紀大了也
 * 不該變貴。
 */
export function agingSurcharge(current: number, age: number | undefined): number {
  const s = abilities.growth_cost.aging_surcharge;
  if (age === undefined || current < s.from_ability) return 0;
  const past = age - season.aging.peak_end;
  if (past <= 0) return 0;
  return Math.ceil(past / s.years_per_step) * s.per_step;
}

/**
 * 目前這一級要花幾點。
 *
 * tiers 由高到低比對，取第一個 current >= from 的 cost；超過潛力天花板再乘上
 * above_ceiling_multiplier——天花板之上仍可成長，只是非常貴。
 *
 * 二刀流在最後扣點：天賦之內每級少付 within_ceiling，天賦之外少付
 * above_ceiling（在乘上倍率之後才扣）。天賦之內的折扣只在成本大於 1 時看得
 * 出來，也就是能力 50 以上——50 以下本來就是 1 點，扣不動。
 */
export function abilityCost(current: number, ceiling: number, ctx: CostContext): number {
  const { curve, twoWay } = ctx;
  let cost = 1;
  for (const tier of curve.tiers) {
    if (current >= tier.from) {
      cost = tier.cost;
      break;
    }
  }

  // 年齡附加費加在倍率**之前**：附加費是「這一級本身變貴了」，天花板的倍率該
  // 乘在變貴之後的價錢上。31 歲、能力 51 超出天花板因此是 (2+1)×3 = 9。
  cost += agingSurcharge(current, ctx.age);

  // 倍率可以被天賦（突破極限）拉成小數，乘完四捨五入——蓄力槽是整數，不能出現
  // 半點。這裡曾經無條件進位，理由是「寧可貴一點也不要出現半點」；但進位讓每一
  // 個小數倍率都變成一次額外加價，倍率 1.1 與 1.4 對成本 3 的能力是同一個價錢。
  const aboveCeiling = current >= ceiling;
  if (aboveCeiling) cost = Math.round(cost * curve.above_ceiling_multiplier);

  if (twoWay) {
    const d = abilities.growth_cost.two_way_discount;
    cost = Math.max(d.min_cost, cost - (aboveCeiling ? d.above_ceiling : d.within_ceiling));
  }

  // 天賦折扣同樣後扣：先讓倍率把天花板之外撐貴，再扣掉固定的幾點。
  cost = Math.max(curve.min_cost, cost - curve.discount);

  // 守備折扣**乘在最後**，成長相關的加減全部算完才乘：玩家買的是「守備練起來
  // 比較便宜」，那要對著他實際付的價錢打折，而不是對著還沒扣任何東西的牌價。
  // 成本 1 點的那幾級不打折——本來就是底價，再乘只會變成 0。
  if (isFielding(ctx.key) && cost > 1) {
    cost = Math.max(1, Math.round(cost * curve.defense_multiplier));
  }

  return cost;
}

/**
 * 蓄力槽怎麼寫給玩家看。
 *
 * 槽只會是正的——扣點走借位（見 untrain()），不會留下負數。分母固定是「買下
 * 一級」的價錢 abilityCost(current)。
 */
export function carryGauge(
  current: number,
  ceiling: number,
  carry: number,
  ctx: CostContext,
): { readonly points: number; readonly need: number } {
  return { points: Math.max(0, carry), need: abilityCost(current, ceiling, ctx) };
}

/**
 * 投入點數，回傳提升的級數與剩餘的蓄力。
 *
 * 未滿一級的點數留在蓄力槽而不蒸發——這讓細微的訓練成果得以累積，也是
 * CONTEXT.md 定義「蓄力槽」的原因。到達量表上限後蓄力歸零，多的點數才是
 * 真正的浪費。
 */
export function train(
  current: number,
  points: number,
  ceiling: number,
  carry: number,
  ctx: CostContext,
  ceilingBonus = 0,
): TrainResult & { readonly value: number } {
  const max = hardCap(ceilingBonus);
  if (points < 0) throw new RangeError('train(): 點數不可為負，衰退請用 decline()');

  let value = current;
  let budget = points + carry;
  while (budget > 0 && value < max) {
    const cost = abilityCost(value, ceiling, ctx);
    if (budget < cost) break;
    budget -= cost;
    value++;
  }

  const capped = value >= max;
  return {
    value,
    gained: value - current,
    carry: capped ? 0 : budget,
    overflow: capped ? budget : 0,
  };
}

/**
 * 扣除點數，回傳降低的級數與剩餘的蓄力。train() 的鏡像。
 *
 * **不夠退一級就借位**：能力 66、蓄力 0/6 被扣 3 點，會變成 65 3/6——退掉
 * 65 → 66 這一級，拿回它的價錢 6 點，扣掉 3 點，找零 3 點留在槽裡。能力值
 * 與蓄力槽合起來是一條連續的點數座標，扣點就是在這條座標上往下走。
 *
 * 因此蓄力槽永遠是正的，沒有「欠點」這種東西。舊版讓槽變成負數（欠滿一級
 * 才掉），畫面上就會出現「欠 3/6」——一個能力值沒動、卻說你欠著債的狀態，
 * 玩家看不懂扣掉的 3 點跑去哪裡了。借位把它寫成「已經掉了一級，但你手上還
 * 剩 3 點」，同一件事，看得見。
 *
 * 退掉的那一級**退還它自己的價錢**：當初花 6 點買的，退掉就還 6 點。因此同
 * 一項能力 +n 點之後再 −n 點，會回到完全相同的能力值與蓄力（測試釘住這條）。
 *
 * 這是為了修掉事件結算的兩側不對稱：舊做法把能力值直接減掉點數（1 點 = 1
 * 級），於是能力 64 以上時，同一張卡成功 +3 點只進蓄力槽（一級要 6 點），
 * 失敗 −3 點卻立刻掉 3 級。上檔付級價、下檔付點價，能力越高差得越遠。
 *
 * 與 decline() 的分界：老化與傷病是時間對所有人一視同仁地收費，維持 1:1；
 * 事件是玩家自己下的賭注，賭注的兩側必須用同一種貨幣結算。
 */
export function untrain(
  current: number,
  points: number,
  ceiling: number,
  carry: number,
  ctx: CostContext,
): TrainResult & { readonly value: number } {
  if (points < 0) throw new RangeError('untrain(): 點數不可為負，加點請用 train()');

  const floor = abilities.scale.hard_floor;
  let value = current;
  let budget = carry - points;
  while (budget < 0 && value > floor) {
    // 退的是 value-1 → value 這一級，價錢按當初買它的算。
    budget += abilityCost(value - 1, ceiling, ctx);
    value--;
  }

  // 觸底之後欠的點不再累積——已經扣到量表的底，再欠也沒有東西可以扣，
  // 那些點是真的浪費掉了（與 train() 觸頂時的處理對稱）。
  const grounded = value <= floor && budget < 0;
  return {
    value,
    gained: value - current,
    carry: grounded ? 0 : budget,
    overflow: grounded ? -budget : 0,
  };
}

/**
 * 這項能力目前的絕對上限。
 *
 * 球探量表的上限是 80，但被事件提升過上限的能力可以練得更高——每項最多
 * 累積 max_ceiling_bonus 點。
 */
export function hardCap(ceilingBonus = 0): number {
  return abilities.scale.max + clampCeilingBonus(ceilingBonus);
}

/**
 * 提升上限。
 *
 * **不會直接增加能力值**——它讓潛力天花板與量表上限一起往上移，點數要自己
 * 練上去。回傳提升後的累積值，超過上限的部分會被截斷。
 */
export function raiseCeiling(currentBonus: number, amount: number): number {
  if (amount < 0) throw new RangeError('raiseCeiling(): 提升量不可為負');
  return clampCeilingBonus(currentBonus + amount);
}

function clampCeilingBonus(bonus: number): number {
  return Math.max(0, Math.min(abilities.scale.max_ceiling_bonus, bonus));
}

/**
 * 能力下降。
 *
 * 一律 1:1，不吃成本曲線——衰退與傷病不該因為能力高就扣得比較少。
 * 下限是 hard_floor 而非量表下限：能力可以掉到球探量表描述不了的程度。
 */
export function decline(current: number, points: number): number {
  if (points < 0) throw new RangeError('decline(): 點數不可為負');
  return Math.max(abilities.scale.hard_floor, current - points);
}

export interface TrainingDice {
  /** 每顆骰的點數。 */
  readonly values: readonly number[];
  /** 這次擲出的 6 的數量。舊版用它累計高標值，供隱藏特性判定。 */
  readonly sixes: number;
}

/**
 * 擲季初的自主訓練骰。
 *
 * 骰數依權重抽，再套用特性修正；每顆骰的點數區間也依特性而異——高手高手高高手與大器
 * 晚成的下限被墊高，因此期望值更好。傷缺整季時骰數固定為最低值。
 *
 * 職業期走同一條路，只是把基礎骰數換成 `baseCount`（球季佔滿時間，骰數比養成
 * 期少）——特性的骰面、天賦買來的骰數、奪冠加成在兩段生涯裡都照樣生效。
 */
export function rollTrainingDice(
  world: World,
  traits: ReadonlySet<string>,
  options: {
    readonly injured?: boolean;
    readonly bonusDice?: number;
    readonly baseCount?: number;
  } = {},
): TrainingDice {
  const rng = world.stream('growth');
  const cfg = abilities.training_dice;

  let count: number;
  if (options.injured === true) {
    count = cfg.count_when_injured;
  } else if (options.baseCount !== undefined) {
    count = options.baseCount;
  } else {
    count = Number(rng.weighted(cfg.count_weights));
    // 修正的取用順序必須穩定，否則同一個種子會擲出不同結果。
    for (const trait of Object.keys(cfg.count_modifiers).sort()) {
      if (!traits.has(trait)) continue;
      const mod = cfg.count_modifiers[trait];
      if (mod === undefined) continue;
      if (mod.chance !== undefined && !rng.chance(mod.chance)) continue;
      count += mod.delta;
    }
    count = Math.max(cfg.min_count, count);
  }
  // 上一季奪冠的回報：多擲幾顆骰，骰面不變。傷缺的球季也照給——冠軍是去年
  // 掙來的，跟今年有沒有受傷無關。
  count += Math.max(0, options.bonusDice ?? 0);
  // 天賦買來的骰數。理由同上：那是玩家帶進場的東西，不是那一季的境遇。
  count += Math.max(0, cfg.bonus_count);

  const face = pickFaceRange(traits);
  const values: number[] = [];
  let sixes = 0;
  for (let i = 0; i < count; i++) {
    const v = rng.int(face.min, face.max);
    values.push(v);
    if (v === 6) sixes++;
  }
  return { values, sixes };
}

/**
 * 上一季**國際賽**奪冠帶來的額外骰數。
 *
 * 只有國際賽算，國內盃賽一律不給——國內大賽的回報已經是大賽點數與成就紀錄，
 * 再給訓練骰等於同一件事獎勵兩次，而且名門學校的球員本來就容易橫掃國內盃賽，
 * 會滾雪球到失控。
 *
 * 傳進來的是**拿下冠軍時所處的階段**（JHS／HS／PRO）。同一季拿下多項國際賽
 * 冠軍時取最高的一項，不相加。
 */
export function championshipDice(kinds: readonly string[]): number {
  const cfg = abilities.training_dice.championship_bonus;
  let best = 0;
  for (const kind of kinds) best = Math.max(best, cfg[kind] ?? 0);
  return best;
}

/** 依特性取骰面區間；命中第一個即採用，都沒有則用 default。 */
function pickFaceRange(traits: ReadonlySet<string>) {
  const faces = abilities.training_dice.faces;
  for (const trait of Object.keys(faces).sort()) {
    if (trait === 'default') continue;
    const range = faces[trait];
    if (range !== undefined && traits.has(trait)) return range;
  }
  const fallback = faces['default'];
  if (fallback === undefined) throw new Error('training_dice.faces 缺少 default');
  return fallback;
}
