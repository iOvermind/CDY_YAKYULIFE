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

import {
  abilities,
  amateur,
  leagues,
  positions,
  season,
  type AbilityKey,
  type Hand,
} from '../data/index.ts';

/**
 * 二刀流特性名。
 *
 * 這裡直接讀資料而不從 draft.ts 取 TWO_WAY_TRAIT：draft.ts 依賴 rating.ts，
 * 反向 import 會成環。
 */
const TWO_WAY_TRAIT = amateur.two_way_talent.trait;

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
 * 球速與四項變化球合為「武器庫」一起排序，取前 n 名套第 n 組權重，四組全算過
 * 取最高分——球種數不該是離散的門檻判定（ADR 0005），一個只有一顆決勝球的
 * 火球男該落在兩格那組，而不是被三顆爛球稀釋。控球固定採計，不參與排序：
 * 那是每個投手都要的基本功，不是可以拿去交換的選項。
 *
 * 體力不進評價。野手側完全不看它，而它已經在出賽場數、投球局數與受傷機率上
 * 結算過了——評價再算一次，同一個數字在投打兩條路上的價值就會天差地遠。
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

  const arsenal = Math.max(
    ...cfg.arsenal_weights.map((weights) =>
      weightedSum(topValues(ability, ['vel', ...cfg.pitches], weights.length), weights),
    ),
  );
  return (
    arsenal * w.arsenal_share + (ability['ctl'] ?? 0) * w.control_weight - w.discount
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
 * 二刀流的守位加分。
 *
 * `加分 = scale × 守位責任占比 × 出賽比重`
 *
 * 依守位難度固定給，不看守備分高低——「守不守得動」由 defense_thresholds 把
 * 關，評價不再問第二次。指定打擊不加分，他就是基準。
 *
 * fieldingShare 反映投球日不能守備，與守備份額用同一個量（ADR 0003）。省略時
 * 視為 1，即「若能天天守」的上限。
 */
export function twoWayPositionBonus(position: string, fieldingShare = 1): number {
  const scale = abilities.overall.fielder.two_way_position_bonus.scale;
  const responsibility = positions.fielding_responsibility[position] ?? 0;
  return responsibility * scale * fieldingShare;
}

/**
 * 野手側評價：打擊與守備依守位的守備權重合成。
 *
 * position 是用於評價的守位。尚未登錄守備位置時，呼叫端應先用
 * ratingPosition() 依起始守位推定一個。
 *
 * 二刀流走另一套：**以純打擊為基準，守位是加分**。合成制對他不成立——那會逼
 * 一個打擊好、守備差的二刀流站在對自己不利的位置上，而他明明可以退回指定打擊
 * 拿滿打擊分。見 ADR 0008。
 */
export function fielderRating(
  ability: Abilities,
  position: string,
  options: { readonly twoWay?: boolean; readonly fieldingShare?: number } = {},
): number {
  const cfg = abilities.overall.fielder;
  const offense = battingRating(ability);

  if (options.twoWay === true) {
    return offense + twoWayPositionBonus(position, options.fieldingShare ?? 1);
  }

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

/** 守位不定。沒有本位，首次登錄因此交給掃描（ADR 0037），也是二刀流的唯一入口（ADR 0009）。 */
export const UTIL = 'UTIL';

/**
 * 起始守位屬於哪一側。UTIL 不屬於任何一側，回傳 null。
 *
 * 養成期就靠這個決定哪些能力能加點：選了投手就不再練打擊守備，選了守位就不再
 * 練投球。**UTIL 因此成為二刀流的唯一入口**——其他起點的另一側從開局就不成長，
 * 畢業時的二刀流判定對他們不可能成立。見 ADR 0009。
 */
export function sideOfStartPosition(startPosition: string): 'pitcher' | 'fielder' | null {
  if (startPosition === UTIL) return null;
  return startPosition === 'P' ? 'pitcher' : 'fielder';
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
/**
 * 這個層級算守位時該拿哪一把尺：所屬體系的**頂級聯盟**。
 *
 * 二軍與小聯盟不自己訂門檻，一律借上面那把（見 ADR 0021）。一個人守不守得動
 * 游擊，是他的守備能力對上這項運動的標準，不是對上他這季剛好待在哪一層；
 * 二軍用二軍的低標會讓同一個人下放後突然「守得動游擊」，升上來又守不動。
 *
 * 路徑的最後一段就是該體系的頂級聯盟。認不出來的層級回傳 null。
 */
export function benchmarkLevelOf(level: string): string | null {
  if (leagues.levels[level]?.top !== undefined) return level;
  for (const path of Object.values(leagues.paths)) {
    if (path.includes(level)) return path[path.length - 1] ?? null;
  }
  return null;
}

/** 母國體系的頂級聯盟。認不出球員所在體系時的退路。 */
export function homeBenchmarkLevel(): string {
  const path = leagues.paths[leagues.transfer.home_org.value];
  return path?.[path.length - 1] ?? 'CPBL1';
}

/**
 * 這個養成階段的對手平均水準，也就是它那把尺的 par。不是養成階段就回 null。
 *
 * 養成期的守位門檻**跟同齡人比**，不借職業的尺（ADR 0021 修正）：拿中職一軍
 * 的 par 44 去量一個國一生，八個守位沒有一個守得動，養成期的守位欄只剩 1B 與
 * DH 兩種值——那不是「他守不動游擊」，那是尺拿錯了。國中的游擊手就是要跟國中
 * 的游擊手比。
 */
function amateurPar(stage: string): number | null {
  const cup: unknown = amateur.cups[stage as keyof typeof amateur.cups];
  if (typeof cup !== 'object' || cup === null) return null;
  const par: unknown = (cup as { par?: unknown }).par;
  return typeof par === 'number' ? par : null;
}

/**
 * 守這個守位的門檻基準線：該層級的 par 加上守位位移。**不含年齡折扣**。
 *
 * par 從哪裡來分兩條路：養成階段（JHS／HS）用 `amateur.cups[stage].par`，職業
 * 層級先過 `benchmarkLevelOf` 拿該體系**頂級聯盟**的 par。因此二軍與小聯盟拿到
 * 的是跟一軍同一組數字——三個階段共用同一份登錄守位，也共用同一套門檻
 * （ADR 0021）；而養成期自成一把尺，因為那六年他的對手是同齡人。
 *
 * 認不出來的層級回傳 null，而不是無條件放行：後者曾讓 KBO 一軍、墨西哥聯盟、
 * 澳職三個頂級聯盟因為漏填而放行，守備零分的人照樣登錄為游擊手（見 ADR
 * 0010）。缺資料不該長得像沒有要求。
 *
 * 定義在 rating.ts 而非 defense.ts，是因為 defense.ts 依賴本模組，反向 import
 * 會成環——與檔首 TWO_WAY_TRAIT 的處理同一個理由。
 */
export function baseThreshold(position: string, level: string): number | null {
  const offset = positions.defense_offsets[position];
  if (offset === undefined) return null;
  const stagePar = amateurPar(level);
  if (stagePar !== null) return stagePar + offset;
  const benchmark = benchmarkLevelOf(level);
  if (benchmark === null) return null;
  const info = leagues.levels[benchmark];
  if (info === undefined) return null;
  return info.par + offset;
}

/**
 * 同一條門檻線，但**不借尺**：只有自己設門檻的層級（頂級聯盟）才有值。
 *
 * 守備分的比較基準用它，不用 `baseThreshold`。判定「守不守得動」該用全運動
 * 的標準（所以借尺），但「守得好不好」必須跟同一層的人比——拿一軍的平均去
 * 量二軍球員，會讓整個二軍的守備份額變成一片負數。
 */
export function localBaseThreshold(position: string, level: string): number | null {
  const offset = positions.defense_offsets[position];
  if (offset === undefined) return null;
  const info = leagues.levels[level];
  if (info === undefined || info.top === undefined) return null;
  return info.par + offset;
}

/**
 * 左投守不守得了這個位置。
 *
 * 二壘、三壘、游擊的傳球都得先轉身，左投要多轉 180 度——這在職業層級是「不
 * 可能」，不是「扣分」，所以它是資格判定的一部分，跟門檻站在一起，而不是守
 * 備分的一個修正項。
 *
 * **因此它不能只活在開局畫面上**：開局擋掉的組合，生涯中途照樣走得進去——一個
 * 左投一壘手把守備練起來，移防掃描的第一個候選就是游擊。規則的家在引擎裡，
 * 開局畫面只是同一條規則的提前顯示，兩邊讀同一個函式。
 *
 * 捕手不在此列——左投捕手雖然罕見但確實存在，那是留給玩家的一條稀有的路。
 */
export function blockedByHand(throws: Hand | null | undefined, position: string): boolean {
  if (throws !== 'L') return false;
  return abilities.handedness.left_throw_blocked_positions.positions.includes(position as never);
}

export function fieldingPosition(
  ability: Abilities,
  level: string,
  throws?: Hand | null,
): string {
  // 內野與外野的光譜合起來掃，取「守得動的最高階守位」——門檻越高的守位越
  // 難守，也越有價值。掃不到任何一個就落到 DH。
  const candidates = [...positions.scan_order.IF, ...positions.scan_order.OF, 'C'];
  let best: { position: string; required: number } | null = null;

  for (const position of candidates) {
    if (blockedByHand(throws, position)) continue;
    const required = baseThreshold(position, level);
    if (required === null) continue;
    if (defenseScore(ability, position) < required) continue;
    if (best === null || required > best.required) best = { position, required };
  }
  return best?.position ?? positions.scan_order.fallback;
}

/**
 * 對應表裡代表「依守備能力自動推定」的哨兵值。
 *
 * 只有 UTIL 用它——「守位不定」本來就沒有固定守位可對應。
 */
const AUTO_POSITION = 'AUTO';

/**
 * 依起始守位推定一個用於評價的守位。正式守位要進入頂級聯盟後才登錄。
 *
 * **這個結果不只用於評價**：沒登錄守位的球季（二軍、還沒進頂級聯盟）也拿它當
 * 守位跑模擬，因此它同時決定守備勝利份額的責任額。把人推到 DH 等於宣告他不
 * 守備，要有理由才做。
 *
 * `auto` 供 UTIL 使用：沒帶的話只能退回 DH，帶了就依當下的守備能力推定。
 */
export function ratingPosition(
  startPosition: string,
  auto?: { readonly ability: Abilities; readonly level: string; readonly throws?: Hand | null },
): string {
  const map = abilities.overall.fielder.default_position;
  // 退路是指定打擊而非游擊：認不出來的起始守位不該被當成守得住游擊。
  const mapped = map[startPosition] ?? map['default'] ?? 'DH';
  if (mapped !== AUTO_POSITION) return mapped;
  return auto === undefined
    ? positions.scan_order.fallback
    : fieldingPosition(auto.ability, auto.level, auto.throws);
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
 *
 * 但二刀流的**野手側內部**算法不同：以純打擊為基準、守位為加分，見
 * fielderRating() 與 ADR 0008。那不是「把投球加進打擊」，是修正一套對他不
 * 成立的合成公式。
 */
export function rate(
  ability: Abilities,
  options: {
    readonly position?: string;
    readonly traits?: ReadonlySet<string>;
    /** 這一季的投手角色。省略時取兩套權重較高者。 */
    readonly role?: PitcherRole | null;
    /** 二刀流實際能守備的比重：投球日不能守。省略時視為 1。 */
    readonly fieldingShare?: number;
  } = {},
): Rating {
  // 退路是指定打擊而非游擊，理由同 ratingPosition()。
  const position = options.position ?? 'DH';
  const twoWay = options.traits?.has(TWO_WAY_TRAIT) === true;
  const pitcher = pitcherRating(ability, options.role ?? null);
  const fielder = fielderRating(ability, position, {
    twoWay,
    fieldingShare: options.fieldingShare ?? 1,
  });

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
