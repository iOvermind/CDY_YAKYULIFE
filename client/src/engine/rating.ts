/**
 * 能力評價：守備分、投手側評價、野手側評價、綜合能力。
 *
 * 移植自 index_legacy.html 的 ovr() 與 dpScore()，並依二刀流球員模型改寫。
 *
 * 舊版的 ovr() 依 S.pos 分兩套算法，投手算球威、野手算攻守。二刀流模型下每位
 * 球員兩側都有能力，因此兩側各算一個評價，整體取較高者——上場時你打的是自己
 * 擅長的位置。
 *
 * 本模組是純函式，不抽任何亂數。
 */

import { abilities, positions, type AbilityKey } from '../data/index.ts';

/** 一組能力值。 */
export type Abilities = Readonly<Record<AbilityKey, number>>;

/**
 * 某個守位的守備分。
 *
 * 依 positions.json 的 ability_weights 加權——資格判定與守備分共用同一組權重，
 * 這是刻意偏離舊版的修正，見該檔的 _deviation。
 */
export function defenseScore(ability: Abilities, position: string): number {
  const weights = positions.ability_weights[position];
  if (weights === undefined) return 0;
  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    score += (ability[key] ?? 0) * weight;
  }
  return score;
}

/** 取前 n 高的值，由高到低。 */
function topValues(ability: Abilities, keys: readonly AbilityKey[], n: number): number[] {
  return keys
    .map((k) => ability[k] ?? 0)
    .sort((a, b) => b - a)
    .slice(0, n);
}

/** 加權求和；權重與值一一對應，缺值視為 0。 */
function weightedSum(values: readonly number[], weights: readonly number[]): number {
  let sum = 0;
  weights.forEach((w, i) => {
    sum += (values[i] ?? 0) * w;
  });
  return sum;
}

/**
 * 投手側評價：投球能力中最好的三項加權，再加上體力。
 *
 * 舊版取球速／控球／變化球三項；球系拆開後改為六項取前三，讓「一顆決勝球
 * 加上基本功」自然勝出，而不必寫死哪三項。
 */
export function pitcherRating(ability: Abilities): number {
  const cfg = abilities.overall.pitcher;
  const pitching = abilities.ability_groups.pitcher;
  const top = topValues(ability, pitching, cfg.top_weights.length);
  const sta = ability['sta'] ?? 0;
  return weightedSum(top, cfg.top_weights) + sta * cfg.stamina_weight;
}

/**
 * 野手側評價：打擊與守備依守位的守備權重合成。
 *
 * position 是用於評價的守位。尚未登錄守備位置時，呼叫端應先用
 * ratingPosition() 依起始守位推定一個。
 */
export function fielderRating(ability: Abilities, position: string): number {
  const cfg = abilities.overall.fielder;
  const hitting = ['con', 'pow', 'eye', 'spd'];
  const offense = weightedSum(
    topValues(ability, hitting, cfg.offense_top_weights.length),
    cfg.offense_top_weights,
  );

  const dh = cfg.dh_defense_penalty;
  const defense =
    position === 'DH'
      ? defenseScore(ability, dh.base_position) - dh.penalty
      : defenseScore(ability, position);

  const dw = cfg.defense_weight[position] ?? cfg.defense_weight['default'] ?? 0;
  return offense * (1 - dw) + defense * dw;
}

/**
 * 這項能力在定位鎖定後是否仍然顯示／可加點。
 *
 * 共用能力（體力）兩邊都留——投手要撐局數、野手要撐出賽數，是同一個量。
 * `locked` 為 null（尚未畢業或已取得二刀流）時一律可見。
 */
export function isSideVisible(key: string, locked: 'pitcher' | 'fielder' | null): boolean {
  if (locked === null) return true;
  if (abilities.ability_groups.shared.includes(key as AbilityKey)) return true;
  return abilities.ability_groups[locked].includes(key as AbilityKey);
}

/**
 * 依守備能力挑出守得動的最佳守位；一個都守不動就是 DH。
 *
 * 二刀流的野手側守位用它決定——大多數投手出身的二刀流守備分不夠，自然落到
 * DH，但守備真的夠好的人可以站上守位。門檻與 fallback 都在 positions.json。
 *
 * `level` 決定門檻高低。還沒進職業時傳頂級聯盟的入門層級即可——養成期沒有
 * 正式登錄守位，這裡算的是「以現在的守備能力，職業上得了哪個守位」。
 */
export function fieldingPosition(ability: Abilities, level: string): string {
  const thresholds = positions.defense_thresholds;

  // 內野與外野的光譜合起來掃，取「守得動的最高階守位」——門檻越高的守位越
  // 難守，也越有價值。掃不到任何一個就落到 DH。
  const candidates = [...positions.scan_order.IF, ...positions.scan_order.OF, 'C'];
  let best: { position: string; required: number } | null = null;

  for (const position of candidates) {
    const required = thresholds[position]?.[level];
    if (required === undefined) continue;
    if (defenseScore(ability, position) < required) continue;
    if (best === null || required > best.required) best = { position, required };
  }
  return best?.position ?? positions.scan_order.fallback;
}

/** 依起始守位推定一個用於評價的守位。正式守位要進入頂級聯盟後才登錄。 */
export function ratingPosition(startPosition: string): string {
  const map = abilities.overall.fielder.default_position;
  return map[startPosition] ?? map['default'] ?? 'SS';
}

export interface Rating {
  readonly pitcher: number;
  readonly fielder: number;
  /** 整體評價：兩側取較高者，再套用特性修正。 */
  readonly overall: number;
  /** 較高的是哪一側。 */
  readonly better: 'pitcher' | 'fielder';
}

/**
 * 計算完整評價。
 *
 * 整體取兩側較高者。另一側目前不計入——二刀流的價值在於「能同時貢獻兩種
 * 角色」，那要等賽季模擬能讓同一個人既投又打時才體現得出來，硬塞一個加成
 * 進評價只是憑空編數字。這是 abilities.json 記錄的待校準項。
 */
export function rate(
  ability: Abilities,
  options: { readonly position?: string; readonly traits?: ReadonlySet<string> } = {},
): Rating {
  const position = options.position ?? 'SS';
  const pitcher = pitcherRating(ability);
  const fielder = fielderRating(ability, position);

  let overall = Math.max(pitcher, fielder);
  const traits = options.traits;
  if (traits !== undefined) {
    // 修正的取用順序必須穩定，即使這裡不抽亂數也一樣——加法可交換，但保持
    // 一致的走訪順序可讓浮點結果逐位元可重現。
    for (const trait of Object.keys(abilities.overall.trait_modifiers).sort()) {
      if (traits.has(trait)) overall += abilities.overall.trait_modifiers[trait] ?? 0;
    }
  }

  return {
    pitcher: Math.round(pitcher),
    fielder: Math.round(fielder),
    overall: Math.round(overall),
    better: pitcher >= fielder ? 'pitcher' : 'fielder',
  };
}
