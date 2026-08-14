/**
 * 守位系統：登錄、移防與守備分。
 *
 * 正式的守備位置在**進入頂級聯盟時登錄**（見 CONTEXT.md 的「頂級聯盟」），
 * 之後每年球季開始前重新檢視——守得動就留著，守不動就往下一階移防。開局選的
 * 起始守位只是養成的起點，它不決定職業生涯要守哪裡。
 *
 * 移防是單向的嗎？不是。守備能力練回來、或年輕時的門檻折扣還在，都可能往上
 * 移回去。但一階一階往下掉是常態，因為老化最先吃掉的就是守備範圍。
 *
 * 守備分（DEF）是野手守備貢獻的獨立數據，逐年累積，並在結算時換算成守備側的
 * 勝利份額（ADR 0003）。**守備爛不會倒扣**——守不動游擊就被掃到三壘、一壘，
 * 最後到指定打擊，他失去的是守位的乘數而不是被扣分。
 *
 * 所有數字都在 `positions.json`。本模組是純函式，不抽亂數——守位是能力的直接
 * 後果，擲骰決定守哪裡會讓玩家練了守備卻看不到效果。
 */

import { positions } from '../data/index.ts';
import { standardOf, type LeagueStandards } from './league.ts';
import { defenseScore, type Abilities } from './rating.ts';

/** 指定打擊。掃不到任何守位時的去處，不產生守備分。 */
export const DH = 'DH';

/** 守位變動的種類。 */
export type PositionMove =
  /** 首次登錄。 */
  | 'register'
  /** 守不動了，往身價較低的守位移。 */
  | 'demote'
  /** 守備練回來了，往身價較高的守位移。 */
  | 'promote'
  /** 維持原守位。 */
  | 'stay';

export interface PositionResult {
  readonly position: string;
  readonly move: PositionMove;
  /** 給玩家看的一句話理由。`stay` 時為空字串。 */
  readonly reason: string;
}

/**
 * 守這個守位需要的門檻。
 *
 * 只有頂級聯盟設門檻——二軍與小聯盟不挑守位，能上場就讓你上。年輕球員吃潛力
 * 紅利，門檻略降：球團願意為一個 22 歲的游擊手多等兩年。
 *
 * 回傳 null 表示這個層級不設限（或這個守位沒有門檻資料）。
 */
export function requiredScore(position: string, level: string, age: number): number | null {
  const base = positions.defense_thresholds[position]?.[level];
  if (base === undefined) return null;
  return base + youthAdjust(age);
}

/** 年齡對門檻的折扣，取第一個符合的區間。 */
function youthAdjust(age: number): number {
  for (const tier of positions.youth_adjust.tiers) {
    if (age <= tier.max_age) return tier.adjust;
  }
  return positions.youth_adjust.default;
}

/** 捕手走自己的一套基準線——蹲捕的容忍度比其他守位高得多。 */
function catcherBar(level: string, age: number): number | null {
  const base = positions.catcher_bar.base[level];
  if (base === undefined) return null;
  for (const tier of positions.catcher_bar.age_discount) {
    if (age <= tier.max_age) return base - tier.discount;
  }
  return base - positions.catcher_bar.default_discount;
}

/** 守不守得動這個守位。門檻不存在時視為守得動——非頂級聯盟不挑。 */
export function canPlay(
  ability: Abilities,
  position: string,
  level: string,
  age: number,
): boolean {
  if (position === DH) return true;
  if (position === 'C') {
    const bar = catcherBar(level, age);
    return bar === null || defenseScore(ability, 'C') >= bar;
  }
  const required = requiredScore(position, level, age);
  return required === null || defenseScore(ability, position) >= required;
}

/** 這個守位屬於哪一條移防光譜。捕手自成一路。 */
function scanListFor(position: string): readonly string[] {
  const order = positions.scan_order;
  if (order.IF.includes(position)) return order.IF;
  if (order.OF.includes(position)) return order.OF;
  // 捕手守不動時往內野走——蹲不了就去守一壘，這是最常見的去處。
  if (position === 'C') return order.IF;
  // 指定打擊要回到場上，兩條光譜都掃：他當初是從哪一邊來的已經不重要了。
  return [...order.IF, ...order.OF];
}

/**
 * 這個守位承擔的守備責任占比。
 *
 * 取自 Bill James 的 Win Shares 守備份額分配。它是**責任額**而非品質倍率——
 * 決定的是「有多少份額經過這個守位」，因此爛捕手累積的敗戰份額遠多於爛一壘
 * 手，而再神的一壘手也賺不了多少。
 *
 * DH 是 0：不守備的人在守備上既無貢獻也無過失，這與「守備零分」是兩件事。
 */
export function fieldingResponsibility(position: string): number {
  return positions.fielding_responsibility[position] ?? 0;
}

/**
 * 守位的身價次序，數字越小越高階。
 *
 * 直接由責任占比推導，不另外維護一份表——同一件事有兩份資料，遲早會對不起來。
 * 左外野與右外野的占比相同，因此身價相同；兩者的難度差由門檻表達（右外野的
 * 門檻本來就比左外野高），不由身價表達。
 */
function rankOf(position: string): number {
  return -fieldingResponsibility(position);
}

/**
 * 決定這一季登錄哪個守位。
 *
 * 掃描規則：沿著當前守位所屬的光譜（`scan_order`），由高階往低階找第一個守得
 * 動的。捕手另外處理——他守不動時才離開本壘板，而一旦離開，要回去必須重新
 * 達到捕手基準線。
 *
 * `current` 為 null 表示首次登錄。
 */
export function assignPosition(options: {
  readonly ability: Abilities;
  readonly current: string | null;
  readonly level: string;
  readonly age: number;
  /** 起始守位。首次登錄時用它決定從哪條光譜開始掃。 */
  readonly startPosition: string;
}): PositionResult {
  const { ability, current, level, age } = options;

  // 捕手是一條獨立的路：先問守不守得動本壘板，守得動就不必掃別的。
  const catcherCandidate = current === 'C' || (current === null && options.startPosition === 'C');
  if (catcherCandidate && canPlay(ability, 'C', level, age)) {
    return current === 'C'
      ? { position: 'C', move: 'stay', reason: '' }
      : { position: 'C', move: 'register', reason: '登錄為捕手' };
  }
  // 已經離開本壘板的人，守備練回來就能重披護具——但門檻不打折。
  if (current !== null && current !== 'C' && options.startPosition === 'C') {
    if (canPlay(ability, 'C', level, age)) {
      return { position: 'C', move: 'promote', reason: '接捕又行了，重新登錄為捕手' };
    }
  }

  const list = scanListFor(current ?? options.startPosition);
  let picked: string | null = null;
  for (const position of list) {
    if (canPlay(ability, position, level, age)) {
      picked = position;
      break;
    }
  }
  const position = picked ?? positions.scan_order.fallback;

  if (current === null) {
    return {
      position,
      move: 'register',
      reason:
        position === DH
          ? '守備守不住任何一個位置，登錄為指定打擊'
          : `登錄為${positionLabel(position)}`,
    };
  }
  if (position === current) return { position, move: 'stay', reason: '' };

  const move = rankOf(position) < rankOf(current) ? 'promote' : 'demote';
  return {
    position,
    move,
    reason:
      move === 'promote'
        ? `守備追上來了，改守${positionLabel(position)}`
        : position === DH
          ? '連一壘都站不住了，改任指定打擊'
          : `守不住${positionLabel(current)}，改守${positionLabel(position)}`,
  };
}

/** 守位的中文名。 */
export function positionLabel(position: string): string {
  return positions.positions[position] ?? position;
}

/**
 * 這一季的守備責任額。
 *
 * `責任額 = 守位責任占比 × 出賽比重`
 *
 * 同時吃守位與出賽時間：傷缺半季的游擊手不該被當成打滿的游擊手評價。這是
 * 守備側勝利份額與敗戰份額的共同基數（ADR 0003）。
 */
export function defenseResponsibility(position: string, gamesShare: number): number {
  return fieldingResponsibility(position) * gamesShare;
}

/**
 * 這一季的守備分。
 *
 * `DEF = (守備分 − 當年 par) × 守位責任占比 × scale × 出賽比重`
 *
 * 用**當年的 par**：聯盟水準逐年浮動，用基準值會讓弱年的守備分虛胖。
 * 指定打擊不產生守備分——他不守備。
 *
 * 守位的價值用**責任占比**表達，不另外乘一個品質倍率——兩邊都乘會讓游擊與
 * 捕手的守位優勢被算兩次。因此這個數字與守備側的 `WS − LS` 只差一個常數，
 * 兩者必然一致。
 *
 * 可以是負的：守備分低於聯盟平均就是負貢獻。**逐年的數據該誠實**——一個 −8
 * 的球季就是 −8。
 */
export function defenseRuns(options: {
  readonly ability: Abilities;
  readonly position: string;
  readonly level: string;
  readonly standards: LeagueStandards | null;
  /** 出賽比重：實際出賽數除以聯盟場次。 */
  readonly gamesShare: number;
}): number {
  if (options.position === DH) return 0;
  const responsibility = defenseResponsibility(options.position, options.gamesShare);
  if (responsibility === 0) return 0;

  const par = standardOf(options.standards, options.level).par;
  const raw =
    (defenseScore(options.ability, options.position) - par) *
    responsibility *
    positions.defense_score_scale.scale;
  return Math.round(raw);
}
