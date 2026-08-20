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
 * 這一季的受傷機率。
 *
 * 順序要緊：先套年齡與逃學威龍的加減，再套魔鬼筋肉人／帕瓦諾的上下限，**最後才加事件
 * 卡自找的額外風險**——那是自己選的，不該由體質買單，因此不受魔鬼筋肉人上限保護。
 */
export function injuryChance(options: {
  readonly age: number;
  readonly traits: ReadonlySet<string>;
  /** 事件卡等自找的額外風險。 */
  readonly extraRisk?: number;
}): number {
  const c = cfg.chance;
  let p = c.base;

  for (const tier of c.age_steps.tiers) {
    if (options.age >= tier.from_age) {
      p += tier.add;
      break;
    }
  }

  const t = c.traits;
  if (options.traits.has('academy') && options.age < t.academy.before_age) p += t.academy.add;

  const iron = options.traits.has('iron');
  const glass = options.traits.has('glass');
  if (iron && glass) p = t.both.value;
  else if (iron) p = Math.min(p, t.iron.cap);
  else if (glass) p = Math.max(p, t.glass.floor);

  p += options.extraRisk ?? 0;
  return Math.max(c.clamp.min, Math.min(c.clamp.max, p));
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
