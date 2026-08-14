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

import { abilities, positions, season, type AbilityKey } from '../data/index.ts';

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

/** 投手的角色。尚未定位時為 null。 */
export type PitcherRole = 'SP' | 'RP';

/**
 * 投手側評價：**依角色走兩套權重**，與野手依守位走不同的守備權重同構。
 * 見 ADR 0005。
 *
 * 球速與控球固定採計，不參與排序——那是每個投手都要的基本功，不是可以拿去
 * 交換的選項。四項變化球排序後遞減加權，**沒有「算不算一種球」的離散判定**，
 * 與打擊四項同一套辦法。
 *
 * 後援還要再減一道角色折扣：責任額由角色決定，能力再高也補不回來。不折扣的話
 * 低體力的火球男一掉進牛棚綜合能力反而上升。
 *
 * `role` 省略時取兩套較高者——與二刀流取投打較高者同一個邏輯，球探本來就是照
 * 你最適合的角色估價。
 */
export function pitcherRating(ability: Abilities, role: PitcherRole | null = null): number {
  if (role === null) {
    return Math.max(pitcherRating(ability, 'SP'), pitcherRating(ability, 'RP'));
  }

  const cfg = abilities.overall.pitcher;
  const w = cfg.roles[role];
  if (w === undefined) return 0;

  const pitches = topValues(ability, cfg.pitches, w.pitch_weights.length);
  return (
    (ability['vel'] ?? 0) * w.velocity_weight +
    (ability['ctl'] ?? 0) * w.control_weight +
    (ability['sta'] ?? 0) * w.stamina_weight +
    weightedSum(pitches, w.pitch_weights) -
    w.discount
  );
}

/**
 * 牛棚分：掉進牛棚之後，決定他是關門人還是中繼。
 *
 * 以球速為主——**一局的工作，用力塞進去就對了**。與評價分開一條公式，因為問的
 * 是不同的問題：評價問「他有多好」，牛棚分問「他適不適合關門」。
 */
export function bullpenScore(ability: Abilities): number {
  const cfg = season.pitching.bullpen;
  const pitches = topValues(ability, abilities.overall.pitcher.pitches, cfg.pitch_weights.length);
  return (
    (ability['vel'] ?? 0) * cfg.velocity_weight +
    (ability['ctl'] ?? 0) * cfg.control_weight +
    weightedSum(pitches, cfg.pitch_weights)
  );
}

/**
 * 純打擊評價。
 *
 * **二刀流判定看的是它，不是野手側評價**——「二刀流」在棒球裡指的是投打二刀
 * 流，不是投守二刀流。野手側評價含守備，因此一個守備一流、打擊平庸的游擊手
 * 會被誤判成二刀流，而那不是這個詞的意思。
 *
 * 守備仍然留在野手側評價裡（綜合能力、守位、薪資都要用），只是不參與二刀流。
 */
export function battingRating(ability: Abilities): number {
  const cfg = abilities.overall.fielder;
  return weightedSum(
    topValues(ability, cfg.offense_abilities, cfg.offense_top_weights.length),
    cfg.offense_top_weights,
  );
}

/**
 * 野手側評價：打擊與守備依守位的守備權重合成。
 *
 * position 是用於評價的守位。尚未登錄守備位置時，呼叫端應先用
 * ratingPosition() 依起始守位推定一個。
 */
export function fielderRating(ability: Abilities, position: string): number {
  const cfg = abilities.overall.fielder;
  const offense = battingRating(ability);

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
  /** 純打擊評價。二刀流判定看它——「二刀流」指的是投打，不是投守。 */
  readonly batting: number;
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
  options: {
    readonly position?: string;
    readonly traits?: ReadonlySet<string>;
    /** 這一季的投手角色。省略時取兩套權重較高者。 */
    readonly role?: PitcherRole | null;
  } = {},
): Rating {
  const position = options.position ?? 'SS';
  const pitcher = pitcherRating(ability, options.role ?? null);
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
    batting: Math.round(battingRating(ability)),
    overall: Math.round(overall),
    better: pitcher >= fielder ? 'pitcher' : 'fielder',
  };
}
