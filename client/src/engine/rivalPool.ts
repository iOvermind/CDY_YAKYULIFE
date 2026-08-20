/**
 * 獎項門檻的對手池模型。
 *
 * 「聯盟第一名」型的獎項，門檻不該是手寫的常數。一個聯盟一年一座，所以那條線
 * 的位置只取決於兩件事：**這個聯盟的人差距有多大**，以及**有幾個人在爭**。
 *
 * 兩件事都已經在資料裡了：
 *
 * - 差距：`leagues.json` 的 `par − min`。`min` 是替代水準——混不下去會被換掉的
 *   那條線。把能力視為常態分佈，並把替代水準放在下尾第 `replacement_quantile`
 *   分位，就得到這個聯盟的能力標準差。它**逐年浮動**（人才斷層的年份差距拉開，
 *   競爭白熱的年份收窄），也**逐聯盟不同**，因此獎項難度自動跟著世界走。
 * - 人數：隊數 × 該獎的競爭人數。打擊王要跟全聯盟的野手比，救援王只跟各隊的
 *   終結者比——救援王因此天生比打擊王好拿，這是對的。
 *
 * 得獎落點取常態上尾的 `1 − 1/n`：**預期只有一個人跨得過的那條線**。
 *
 * 這取代了 ADR 0014 提的極值模擬表。上尾分位與極值期望值在這個量級上差不到
 * 一成，而分位函數本來就要拿來處理替代水準，同一支函式用兩次，不必再存一張
 * 查表，也不必為 `per_team` 的精確值煩惱——`z(1 − 1/n)` 對 n 是對數級的鈍，
 * 池大小翻倍只換到幾個百分點。**它是數量級的旋鈕，不是精調的旋鈕。**
 *
 * 見 [ADR 0017](../../../docs/adr/0017-award-lines-from-the-rival-pool.md)。
 */

import { awards as cfg, teams } from '../data/index.ts';
import { standardOf, type LeagueStandards } from './league.ts';

/**
 * 標準常態的分位函數，也就是 CDF 的反函數。
 *
 * Acklam 的有理逼近，相對誤差 < 1.15e-9——遠比我們需要的精度好，而且不需要
 * 迭代，是純算式。
 */
export function zQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError(`zQuantile 需要 0 < p < 1，收到 ${p}`);

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];

  // 兩端與中央用不同的展開式，接點在 0.02425。
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      ((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!
    ) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -zQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/**
 * 這個層級在這一年的能力標準差，單位與 d 值相同。
 *
 * `par − min` 是「平均」到「替代水準」的距離，而替代水準被定義成下尾第
 * `replacement_quantile` 分位，兩者相除即得標準差。
 *
 * **這是全套模型唯一的自由參數。** 得獎率整體偏高就把分位調小（尺變大、線
 * 變高），偏低就調大。
 */
export function abilitySpread(level: string, standards: LeagueStandards | null = null): number {
  const now = standardOf(standards, level);
  const q = cfg.rival_pool.replacement_quantile;
  return Math.max(0, now.par - now.min) / Math.abs(zQuantile(q));
}

/** 某個獎在某個體系有幾個人在爭。 */
export function contenders(org: string, pool: string): number {
  const p = cfg.rival_pool;
  const clubs = teams.leagues[org]?.length ?? p.default_teams;
  const per = p.per_team[pool] ?? 1;
  // 少於兩個人就不叫競爭，分位函數也會在 n = 1 時發散。
  return Math.max(2, clubs * per);
}

/**
 * 拿下這座獎需要的 d 值——聯盟裡預期只有一個人站得到的位置。
 *
 * 差距為零的聯盟（par 等於 min）回傳 0：所有人一樣強時，獎項的門檻就是平均。
 */
export function winnerAbility(
  level: string,
  org: string,
  pool: string,
  standards: LeagueStandards | null = null,
): number {
  return winnerAbilityFrom(abilitySpread(level, standards), org, pool);
}

/**
 * 同上，但直接吃算好的離散度。
 *
 * 判定獎項的地方拿得到的是一個球季的快照，不是整份聯盟標準；離散度在球季開始
 * 時算一次帶進來，比讓獎項模組去翻聯盟狀態乾淨。
 */
export function winnerAbilityFrom(spread: number, org: string, pool: string): number {
  return spread * zQuantile(1 - 1 / contenders(org, pool));
}
