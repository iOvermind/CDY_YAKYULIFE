/**
 * 開局生成：從世界種子造出一位剛入學的高中球員。
 *
 * 移植自 index_legacy.html:575-592 的 newState()，並依二刀流球員模型改寫。
 *
 * 與舊版最大的差別：**每位球員都擁有全部能力**，不再有投手／野手的能力二分。
 * 開局選的起始守位只影響潛力天賦的加權與初始能力加成，不決定你有哪些能力。
 * 因此投手也可能打得好，游擊手也可能投得動；投打俱佳者可在選秀前取得二刀流天賦。
 *
 * 本模組的所有抽取一律走 genesis 子序列（見 ADR 0002 的歸屬規則）。
 */

import {
  abilities,
  ALL_ABILITIES,
  amateur,
  PITCH_FAMILIES,
  type AbilityKey,
  type Hand,
  type StartPosition,
} from '../data/index.ts';
import type { World } from './rng.ts';

/** 開局起始年齡與年份，沿用 legacy 的設定（高中一年級）。 */
export const START_AGE = 16;
export const START_YEAR = 2026;

export interface NewPlayer {
  readonly name: string;
  /** 起始守位。只影響天賦加權與初始加成，不限制能力範圍。 */
  readonly startPosition: StartPosition;
  readonly age: number;
  readonly year: number;
  /**
   * 投球慣用手。二刀流模型下每位球員都有，因為任何人都可能上場投球。
   * 不會擲出 S：雙手投列為隱藏特性（traits.json 的 switch_pitcher）。
   */
  readonly throws: Hand;
  /** 打擊慣用手。S 為左右開弓，永遠取得反邊優勢。 */
  readonly bats: Hand;
  /** 目前能力值，涵蓋全部能力。 */
  readonly ability: Readonly<Record<AbilityKey, number>>;
  /** 潛力天花板：每項能力這輩子的上限。 */
  readonly potential: Readonly<Record<AbilityKey, number>>;
  /** 出身高中 */
  readonly school: string;
  /** 高中隱藏強度分級：1 名門 / 2 中堅 / 3 弱旅 */
  readonly schoolTier: number;
}

/**
 * 擲出開局能力。
 *
 * 全部能力每項先擲 base，再依起始守位給招牌能力加成。起始守位為投手者，
 * 另外隨機挑一個球系加成——代表少年時期最先練起來的那顆變化球。
 * UTIL（守位不定）沒有任何加成：樣樣都練的代價就是樣樣都沒有先發優勢。
 */
function rollAbility(world: World, start: StartPosition): Record<AbilityKey, number> {
  const rng = world.stream('genesis');
  const { base, bonus, pitch_bonus } = abilities.initial_ability;

  const ability: Record<AbilityKey, number> = {};
  for (const key of ALL_ABILITIES) ability[key] = rng.int(base.min, base.max);

  // 加成的取用順序必須穩定，否則同一個種子會擲出不同結果。
  const positionBonus = bonus[start] ?? {};
  for (const key of Object.keys(positionBonus).sort()) {
    const range = positionBonus[key];
    if (range === undefined) continue;
    const current = ability[key];
    if (current === undefined) continue;
    ability[key] = current + rng.int(range.min, range.max);
  }

  if (pitch_bonus.applies_to.includes(start)) {
    const family = rng.pick(PITCH_FAMILIES);
    const current = ability[family];
    if (current !== undefined) {
      ability[family] = current + rng.int(pitch_bonus.range.min, pitch_bonus.range.max);
    }
  }

  return ability;
}

/**
 * 擲出潛力天花板。
 *
 * 全部能力依起始守位的天賦權重加權洗牌，再依名次套用區間——1 項頂尖工具、
 * 1 項優質、1 項中上、其餘平庸。名次超出階梯數者一律吃最後一階。
 *
 * 15 項能力一起洗牌，所以絕大多數球員只會在單側拿到高階天賦。投打各有一項
 * 頂尖是罕見結果——這就是二刀流稀有的來源，不需要另外設限。
 */
function rollPotential(world: World, start: StartPosition): Record<AbilityKey, number> {
  const rng = world.stream('genesis');
  const weights = abilities.talent_weights.by_start_position[start] ?? {};
  const ranked = rng.weightedShuffle(
    [...ALL_ABILITIES],
    weights,
    abilities.talent_weights.default,
  );

  const tiers = abilities.potential_ceiling.tiers;
  const last = tiers[tiers.length - 1];
  if (last === undefined) throw new Error('potential_ceiling.tiers 是空的');

  const potential: Record<AbilityKey, number> = {};
  ranked.forEach((key, rank) => {
    const range = tiers[rank] ?? last;
    potential[key] = rng.int(range.min, range.max);
  });
  return potential;
}

/** 分發出身高中。學校名單與隱藏分級來自 amateur.json。 */
function assignSchool(world: World): { school: string; tier: number } {
  const rng = world.stream('genesis');
  const names = Object.keys(amateur.high_school.schools).sort();
  const school = rng.pick(names);
  const tier = amateur.high_school.schools[school];
  if (tier === undefined) throw new Error(`高中 ${school} 沒有對應的分級`);
  return { school, tier };
}

/**
 * 造出一位新球員。
 *
 * 抽取順序即此函式的敘述順序，改動順序會讓同一個種子產出不同的球員——
 * 這在同一個引擎版本內是不允許的（見 ADR 0002）。
 */
export function createPlayer(
  world: World,
  name: string,
  startPosition: StartPosition,
): NewPlayer {
  const rng = world.stream('genesis');
  const ability = rollAbility(world, startPosition);
  const potential = rollPotential(world, startPosition);
  const throws = rng.weighted(abilities.handedness.throws.weights);
  const bats = rng.weighted(abilities.handedness.bats.weights);
  const { school, tier } = assignSchool(world);

  return {
    name,
    startPosition,
    age: START_AGE,
    year: START_YEAR,
    throws,
    bats,
    ability,
    potential,
    school,
    schoolTier: tier,
  };
}
