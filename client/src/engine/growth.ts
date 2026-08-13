/**
 * 能力成長：訓練骰、成本曲線與蓄力槽。
 *
 * 移植自 index_legacy.html 的 abCost() / addAb() 與季初擲骰。
 * 本模組的所有抽取一律走 growth 子序列（見 ADR 0002 的歸屬規則）。
 */

import { abilities, type AbilityKey, type GrowthCurve } from '../data/index.ts';
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

/** 取得成長曲線。二刀流的曲線較平緩，是取得該天賦之後的機械性回報。 */
export function growthCurve(isTwoWay: boolean): GrowthCurve {
  return isTwoWay ? abilities.growth_cost.two_way : abilities.growth_cost.default;
}

/**
 * 目前這一級要花幾點。
 *
 * tiers 由高到低比對，取第一個 current >= from 的 cost；超過潛力天花板再乘上
 * above_ceiling_multiplier——天花板之上仍可成長，只是非常貴。
 */
export function abilityCost(current: number, ceiling: number, curve: GrowthCurve): number {
  let cost = 1;
  for (const tier of curve.tiers) {
    if (current >= tier.from) {
      cost = tier.cost;
      break;
    }
  }
  return current >= ceiling ? cost * curve.above_ceiling_multiplier : cost;
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
  curve: GrowthCurve,
  ceilingBonus = 0,
): TrainResult & { readonly value: number } {
  const max = hardCap(ceilingBonus);
  if (points < 0) throw new RangeError('train(): 點數不可為負，衰退請用 decline()');

  let value = current;
  let budget = points + carry;
  while (budget > 0 && value < max) {
    const cost = abilityCost(value, ceiling, curve);
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
 * 骰數依權重抽，再套用特性修正；每顆骰的點數區間也依特性而異——天才與大器
 * 晚成的下限被墊高，因此期望值更好。傷缺整季時骰數固定為最低值。
 */
export function rollTrainingDice(
  world: World,
  traits: ReadonlySet<string>,
  options: { readonly injured?: boolean; readonly bonusDice?: number } = {},
): TrainingDice {
  const rng = world.stream('growth');
  const cfg = abilities.training_dice;

  let count: number;
  if (options.injured === true) {
    count = cfg.count_when_injured;
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
 * 上一季奪冠帶來的額外骰數。
 *
 * 同一季拿下多項冠軍時取最高的一項，不相加——否則一年橫掃四個盃賽就會多擲
 * 四顆，滾雪球到失控。
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
