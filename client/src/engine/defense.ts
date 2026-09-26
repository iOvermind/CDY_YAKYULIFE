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

import { leagues, positions, type Hand } from '../data/index.ts';
import { personalStandardOf, type LeagueStandards } from './league.ts';
import { standardDiscount, type HandednessTier } from './handedness.ts';
import {
  blockedByHand,
  defenseMark,
  defenseScore,
  localPositionAverageLine,
  positionAverageLine,
  type Abilities,
} from './rating.ts';

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
 * 判定去留時用的平均線：該守位的平均，減掉球團願意給的折讓。
 *
 * 只有頂級聯盟與養成階段量得出來——二軍與小聯盟借該體系頂級聯盟的尺（ADR 0021），
 * 三個階段因此共用同一份登錄守位與同一套要求。回傳 null 表示這個層級量不出來，
 * 那就不挑守位。
 *
 * **折讓只作用在這條線上，不動顯示的守備分。** 球團願意為一個 22 歲的游擊手多等
 * 兩年，那是去留的事；他今年守得好不好是另一本帳，不該因為他年輕就變好看。
 */
export function judgingAverage(
  position: string,
  level: string,
  age: number,
  tier: HandednessTier = 'none',
): number | null {
  const base = positionAverageLine(position, level);
  if (base === null) return null;
  // 守位是關卡，整條尺按慣用手折扣平移——見 CONTEXT.md「個人尺 / 聯盟真尺」。
  // 年齡的折讓是加在折後的線上：那是「他還年輕」，跟他慣用哪隻手無關。
  return base * (1 - standardDiscount(tier)) + youthAdjust(age);
}

/** 年齡對判定線的折讓，取第一個符合的區間。 */
function youthAdjust(age: number): number {
  for (const tier of positions.youth_adjust.tiers) {
    if (age <= tier.max_age) return tier.adjust;
  }
  return positions.youth_adjust.default;
}

/**
 * 這個守位在這個層級的**平均**守備水準，也就是守備分的零點。
 *
 * 由 `defense_offsets` 直接定義：平均線 = 該層級 par + 守位位移。這張表曾經是
 * 「守得動的最低門檻」、平均線另外由一個 margin 推導，兩段在門檻不再是判準之後
 * 合一了（ADR 0048）。
 *
 * 基準必須是同守位的平均，不能用聯盟的一般 par：守備分是各守位自己那三項能力的
 * 加權，量級本來就不同。用聯盟 par 時，勉強守得住游擊的人拿 +6、勉強守得住一壘的
 * 人拿 −8，但這兩個人本質上是同一件事。
 *
 * **不套折讓**：折讓是給去留判定用的，同守位的平均水準不會因為某個球員年輕就下降。
 *
 * 平均線跟著聯盟一起浮動——聯盟整體變強，該守位的平均守備也會變強。用當年 par 與
 * 基準 par 的差額平移，不必為每個守位另外設一組浮動。
 *
 * 回傳 null 表示這個層級沒有自己的平均線（非頂級聯盟），因此年表上不顯示守備分。
 */
export function positionAverage(
  position: string,
  level: string,
  standards: LeagueStandards | null = null,
  tier: HandednessTier = 'none',
): number | null {
  const base = localPositionAverageLine(position, level);
  if (base === null) return null;
  // 守位是關卡，吃個人尺：左投左打被要求的守備水準跟著他自己的那把尺下移。
  const drift = personalStandardOf(standards, level, tier).par - (leagues.levels[level]?.par ?? 0);
  return base + drift;
}

/**
 * 守不守得動這個守位：**守備分還沒跌破降守位那條線**。量不出平均線的層級視為
 * 守得動——那些層級不挑守位。
 *
 * 判準從「守備分 ≥ 硬門檻」換成 DEF ≥ `demotion_line`（ADR 0048）。差別不只是
 * 換一把尺：舊門檻等於 DEF −7，新的線在 −10，因此一個打擊出色而守備平庸的游擊
 * 可以提著負的守備分繼續站在那裡，而不是被一條硬線掃到三壘。
 *
 * 吃的是**不乘出賽比重、不加抖動**的純值。擲骰決定守哪裡會讓玩家練了守備卻看不
 * 到效果；而乘上出賽比重的話，傷缺半季的爛守備反而會因為 DEF 貼近 0 保住位置。
 *
 * 捕手沒有另一套基準線。「蹲捕的容忍度高」已經由平均線本身表達——捕手的平均線
 * 低於游擊，那就是容忍度。
 */
export function canPlay(
  ability: Abilities,
  position: string,
  level: string,
  age: number,
  tier: HandednessTier = 'none',
): boolean {
  if (position === DH) return true;
  const line = judgingAverage(position, level, age, tier);
  if (line === null) return true;
  return defenseMark(defenseScore(ability, position), line) >= positions.defense_score.demotion_line;
}

/**
 * 這名球員走哪一條移防光譜——看**起始守位**，不看現在站哪裡（issue #24）。
 *
 * 一壘同時在內野與外野兩條光譜的尾端，只看「現在站哪裡」決定不了他該走哪一條：
 * 中外野手被移到一壘之後會被當成內野手，再也回不去外野。所以光譜跟著他的出身：
 * 外野手是外野 → 一壘 → DH、內野手是內野 → 一壘 → DH、捕手是捕手 → 一壘 → DH
 * （捕手本身另外處理，見 `assignPosition`）。守位不定（UTIL）與投手出身的人兩條都走，
 * 依守備責任由重到輕排——「守位不定」的特色就是哪裡都能去。
 */
export function spectrumOf(startPosition: string): readonly string[] {
  const order = positions.scan_order;
  if (startPosition === 'C') return ['1B'];
  if (order.OF.includes(startPosition) && startPosition !== '1B') return order.OF;
  if (order.IF.includes(startPosition)) return order.IF;
  return [...new Set([...order.IF, ...order.OF])].sort((a, b) => rankOf(a) - rankOf(b));
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
  /** 投球慣用手。左投的二三游整段從掃描裡消失（見 blockedByHand）。 */
  readonly throws?: Hand | null;
  /** 慣用手檔次。守位是關卡，門檻吃他自己的那把尺。 */
  readonly tier?: HandednessTier;
}): PositionResult {
  const { ability, current, level, age } = options;
  const tier = options.tier ?? 'none';

  // 捕手是一條獨立的路：先問守不守得動本壘板，守得動就不必掃別的。
  const catcherCandidate = current === 'C' || (current === null && options.startPosition === 'C');
  if (catcherCandidate && canPlay(ability, 'C', level, age, tier)) {
    return current === 'C'
      ? { position: 'C', move: 'stay', reason: '' }
      : { position: 'C', move: 'register', reason: '登錄為捕手' };
  }
  // 已經離開本壘板的人，守備練回來就能重披護具——但門檻不打折。
  if (current !== null && current !== 'C' && options.startPosition === 'C') {
    if (canPlay(ability, 'C', level, age, tier)) {
      return { position: 'C', move: 'promote', reason: '接捕又行了，重新登錄為捕手' };
    }
  }

  // 守不了的位置直接不進掃描，而不是掃到了再擋——擋在後面的話「守備追上來了」
  // 那條訊息會先組出來，玩家會收到一張把他改守游擊的卡片。
  const list = spectrumOf(options.startPosition).filter(
    (p) => !blockedByHand(options.throws, p),
  );
  let picked: string | null = null;
  for (const position of list) {
    if (canPlay(ability, position, level, age, tier)) {
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
 * 這一季的守備分（DEF），給年表與記分板看的那一份。
 *
 * 形狀與成績那一側的每一格一致：`錨點 × 比值^次方 × 出賽比重 + 抖動`，比值由
 * `defenseMark` 算好（見 rating.ts）。**所有守位的錨點都是 +25**，依守位縮的是
 * 「拿到 +25 需要多少能力」——游擊要 80，捕手 76，一壘 64。守位之間的價值差不在
 * 這個數字裡，它在勝利份額的責任占比上（ADR 0048）。
 *
 * 指定打擊不產生守備分——他不守備。
 *
 * 可以是負的：守得比同守位平均差就是負貢獻。**逐年的數據該誠實**——一個 −8 的
 * 球季就是 −8。結算時換算成勝利份額與敗戰份額，見 ADR 0003。
 *
 * **抖動只在這裡。** 去留判定走 `canPlay`，吃的是沒有抖動、沒有出賽比重的純值：
 * 擲骰決定守哪裡會讓玩家練了守備卻看不到效果。`jitter` 沒傳就不抖，年表因此可以
 * 在任何時候重算。
 */
/**
 * 沒有聯盟層級的場合（養成期、國際賽）的守備純值：平均線是那一段的 par 加上守位
 * 偏移，與職業的 `localPositionAverageLine` 同一條式子，只是 par 由呼叫端給。
 * 指定打擊與沒有偏移的守位回傳 null。
 */
export function defenseMarkAt(ability: Abilities, position: string, par: number): number | null {
  if (position === DH) return null;
  const offset = positions.defense_offsets[position];
  if (offset === undefined) return null;
  return defenseMark(defenseScore(ability, position), par + offset);
}

export function defenseRuns(options: {
  readonly ability: Abilities;
  readonly position: string;
  readonly level: string;
  readonly standards: LeagueStandards | null;
  /** 出賽比重：實際出賽數除以聯盟場次。 */
  readonly gamesShare: number;
  /** ±n 的整數抖動來源。不傳就是沒有抖動。 */
  readonly jitter?: (n: number) => number;
}): number {
  if (options.position === DH) return 0;

  const average = positionAverage(options.position, options.level, options.standards);
  if (average === null) return 0;

  const mark = defenseMark(defenseScore(options.ability, options.position), average);
  const d = positions.defense_score;
  const jitter = options.jitter?.(d.jitter) ?? 0;
  return Math.round(mark * options.gamesShare) + jitter;
}
