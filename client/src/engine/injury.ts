/**
 * 傷病。
 *
 * 移植自 `index_legacy.html` 的 `injuryProb()` / `rollInjury()` / `injStatLoss()`。
 *
 * **傷病在這個遊戲裡不是一個獨立的懲罰數字，它是「你這一季能上場多久」。**
 * 結果落在出賽係數上，而出賽量本身就是勝利份額的分母——一個大傷年的敗戰份額
 * 不會增加（他沒有佔著位置打不好，他根本不在場上），但那一年的貢獻就是沒有。
 * 這與「表現差」是兩種不同的事，數據上也該長得不一樣。
 *
 * 全部走 `health` 子序列。那條子序列從 ADR 0002 就保留著，一直沒有使用者。
 */

import { injury as cfg } from '../data/index.ts';
import type { World } from './rng.ts';
import { fullSeasonSta, staThresholdForLeague } from './season.ts';

/** 一次傷病的結果。 */
export interface Injury {
  readonly kind: 'none' | 'minor' | 'major';
  /**
   * 這一季的出賽係數，1 表示全勤、0 表示整季報銷。
   *
   * 成績模擬把出賽量乘上它——**不是事後把數據打折**，而是他真的只上場了那麼多。
   */
  readonly seasonFactor: number;
  /** 永久的能力損失：`all` 為全能力扣點，`one` 為隨機一項。 */
  readonly loss: { readonly scope: 'none' | 'all' | 'one'; readonly points: number };
  /** 隔年是否整季報廢。 */
  readonly rehabNextYear: boolean;
  /** 給卡片用的敘述。 */
  readonly text: string;
}

const HEALTHY: Injury = {
  kind: 'none',
  seasonFactor: 1,
  loss: { scope: 'none', points: 0 },
  rehabNextYear: false,
  text: '',
};

/**
 * 體力折在受傷機率上的部分。
 *
 * **體力有兩種貨幣。**第一種是出賽場數，但那一側每個守位都有到頂的地方——DH 55、
 * SS 65、捕手 80——到頂之後再練，場數上一分錢也拿不到。第二種就是這裡：超過
 * 「打滿標準」的體力改折成免傷。體力從來不是白練的。
 *
 * 零點是**各守位自己的**打滿標準，由 {@link fullSeasonSta} 反解，不是手寫的。
 * 捕手反解出 76.5 而實測沒有人到得了 65，所以用 `zero_point_cap` 壓到 70——70 是
 * 捕手蹲到 144 場的地方。
 *
 * 另一頭：`floor_sta` 40 以下反過來加風險。那是 `stamina_factor` 的底限，再低不會
 * 少打，改成容易壞。
 */
function staminaRisk(options: {
  readonly stamina?: number | undefined;
  readonly position?: string | undefined;
  readonly leagueGames?: number | undefined;
}): number {
  const s = cfg.chance.stamina;
  const sta = options.stamina;
  if (sta === undefined) return 0;

  if (sta < s.floor_sta) {
    return Math.round(Math.min(s.max_add, (s.floor_sta - sta) * s.per_point_below));
  }

  // cap 先套在 162 場的尺上再換算到本聯盟，順序反過來的話短賽季的捕手會拿到
  // 比長賽季更高的零點——反解已經隨場次降下去，cap 卻沒有。
  const zero = staThresholdForLeague(
    Math.min(s.zero_point_cap, fullSeasonSta(options.position ?? 'DH')),
    options.leagueGames,
  );
  if (sta <= zero) return 0;
  // 取整：這個數字會原樣印在健康回報卡上。
  return -Math.round(Math.min(s.max_cut, (sta - zero) * s.per_point_above));
}

/**
 * 這一季的受傷機率。
 *
 * 順序要緊：**體質特性決定基礎值**（魔鬼筋肉人 10／帕瓦諾 40／並存 25／其餘 15），再套
 * 年齡、體力、逃學威龍的加減，然後才加事件卡自找的額外風險——那是自己選的。夾在
 * clamp 之後，最後乘上天賦的 `talent_multiplier`：天賦是玩家帶進場的，在夾擠之外。
 * 見 ADR 0033。
 */
export function injuryChance(options: {
  readonly age: number;
  readonly traits: ReadonlySet<string>;
  /** 事件卡等自找的額外風險。 */
  readonly extraRisk?: number;
  /** 體力。省略時這一項不計。 */
  readonly stamina?: number | undefined;
  /** 守位，決定免傷的零點。省略時以 DH 計。 */
  readonly position?: string | undefined;
  /** 聯盟場次，短賽季的零點跟著下調。 */
  readonly leagueGames?: number | undefined;
}): number {
  const c = cfg.chance;
  const t = c.traits;

  const iron = options.traits.has('iron');
  const glass = options.traits.has('glass');
  let p: number;
  if (iron && glass) p = t.both.base;
  else if (iron) p = t.iron.base;
  else if (glass) p = t.glass.base;
  else p = c.base;

  for (const tier of c.age_steps.tiers) {
    if (options.age >= tier.from_age) {
      p += tier.add;
      break;
    }
  }

  p += staminaRisk(options);

  if (options.traits.has('academy') && options.age < t.academy.before_age) p += t.academy.add;

  p += options.extraRisk ?? 0;
  p = Math.max(c.clamp.min, Math.min(c.clamp.max, p));
  return p * c.talent_multiplier;
}

/**
 * 擲一次傷病。
 *
 * **抽取次數與是否受傷無關**：命中與否都把後續的骰子擲完，否則同一個種子會因為
 * 某年差一分而讓整條 health 子序列偏移。
 */
export function rollInjury(
  world: World,
  options: {
    readonly age: number;
    readonly traits: ReadonlySet<string>;
    readonly extraRisk?: number;
    readonly stamina?: number | undefined;
    readonly position?: string | undefined;
    readonly leagueGames?: number | undefined;
  },
): Injury {
  const rng = world.stream('health');
  const s = cfg.severity;

  const hit = rng.chance(injuryChance(options));
  const minor = rng.chance(s.minor_chance);
  const lostPercent = rng.int(s.minor.games_lost_percent.min, s.minor.games_lost_percent.max);
  const aftereffect = rng.chance(s.minor.aftereffect.chance);
  const aftereffectPoints = rng.int(s.minor.aftereffect.points.min, s.minor.aftereffect.points.max);
  const playedPercent = rng.int(
    s.major.season_played_percent.min,
    s.major.season_played_percent.max,
  );
  const rehab = rng.chance(s.major.rehab_next_year.chance);

  if (!hit) return HEALTHY;

  if (minor) {
    return {
      kind: 'minor',
      seasonFactor: 1 - lostPercent / 100,
      loss: aftereffect
        ? { scope: 'one', points: aftereffectPoints }
        : { scope: 'none', points: 0 },
      rehabNextYear: false,
      text: `肌肉拉傷進了傷兵名單，本季出賽量減少 ${lostPercent}%。`,
    };
  }

  return {
    kind: 'major',
    seasonFactor: playedPercent / 100,
    loss: { scope: 'all', points: s.major.ability_loss.points },
    rehabNextYear: rehab,
    text: `重大傷勢——進手術室了。賽季提前報銷（本季留下 ${playedPercent}% 的出賽紀錄）。`,
  };
}

/**
 * 這次大傷會不會讓他被貼上帕瓦諾的標籤。
 *
 * **32 歲以後的大傷是歲月的損耗，不是體質問題**——那時不再貼標籤，球團看得比
 * 誰都開。
 */
export function unlocksGlass(options: {
  readonly majorInjuries: number;
  readonly age: number;
  readonly traits: ReadonlySet<string>;
}): boolean {
  const g = cfg.glass_unlock;
  if (options.traits.has(g.trait)) return false;
  return options.majorInjuries >= g.major_injuries && options.age < g.before_age;
}

/**
 * 養成期的傷病。
 *
 * **不做大傷**：十五歲就報銷一年在敘事上太重，而且那個階段沒有合約與薪水可以
 * 承接後果。只砍出賽，不留後遺症。
 */
export function rollAmateurInjury(world: World, age: number): Injury {
  const rng = world.stream('health');
  const a = cfg.amateur;
  const hit = rng.chance(a.chance);
  const lostPercent = rng.int(a.games_lost_percent.min, a.games_lost_percent.max);
  if (!hit) return HEALTHY;
  void age;
  return {
    kind: 'minor',
    seasonFactor: 1 - lostPercent / 100,
    loss: { scope: 'none', points: 0 },
    rehabNextYear: false,
    text: `練習中拉傷，這一季少了 ${lostPercent}% 的出賽。`,
  };
}
