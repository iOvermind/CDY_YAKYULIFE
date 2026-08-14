/**
 * 薪資。
 *
 * 單位一律是**萬元台幣**，因為那是台灣講棒球薪水的單位（「年薪破千萬」）。
 * 顯示時才換算成億。
 *
 * 這裡只有金額層——年薪、簽約金、入札金、生涯總薪資。合約的談判層（長約短約、
 * 年限、續約權）是另一回事，見 `contract.ts`。
 *
 * **薪資反映的是市場規模，不是競技水準。** 大聯盟的 par 只比中職一軍高三成，
 * 薪資卻是八倍起跳、頂端三十四倍；韓職的 par 高於墨聯，但墨聯的市場小得多。
 * 兩者是獨立的旋鈕，若薪資跟著 par 走，那些聯盟就會失去性格。見 ADR 0004。
 *
 * 本模組是純函式，不抽亂數。
 */

import { leagues } from '../data/index.ts';

/**
 * 這個層級、這個 d 值的年薪，單位萬元。
 *
 * `d` 是綜合能力減**當年**的 par——聯盟水準逐年浮動，用基準值會讓弱年的薪水
 * 虛高。低於聯盟平均不會扣薪（d 夾在 0 以上）：球團簽下你的時候不知道你會
 * 打成什麼樣，薪水是先給的。
 *
 * 非頂級層級一律固定薪——二軍與小聯盟的薪水不隨表現浮動，那是真的。
 */
export function salaryFor(level: string, d: number): number {
  const spec = leagues.salary.levels[level];
  if (spec === undefined) return 0;
  const capped = Math.max(0, Math.min(d, spec.d_cap));
  return Math.round(spec.base + capped * spec.per_point);
}

/**
 * 入札金：母隊放人的對價，由承接的球團支付。
 *
 * 它與球員拿到的簽約金是**兩筆不同的錢**——入札金進母隊的口袋，簽約金進球員
 * 的口袋。這也是入札制度成立的原因：沒有這筆錢，母隊沒有理由放走還有合約的
 * 球員。
 */
export function postingFee(signingBonus: number): number {
  return Math.round(signingBonus * leagues.salary.posting_fee_multiplier.value);
}

/**
 * 金額的顯示字串。
 *
 * 一萬萬為一億，因此超過一億就拆成「◯億◯◯◯◯萬」。零元寫成「0 萬」而不是
 * 空字串——空的欄位看起來像壞掉。
 */
export function fmtMoney(wan: number): string {
  const safe = Math.max(0, Math.round(wan));
  const yi = Math.floor(safe / 10000);
  const rest = safe % 10000;
  if (yi === 0) return `${rest.toLocaleString('en-US')} 萬`;
  if (rest === 0) return `${yi} 億`;
  return `${yi} 億 ${rest.toLocaleString('en-US')} 萬`;
}

/**
 * 簡短的金額顯示，給空間有限的地方用（狀態欄、記分板）。
 *
 * 超過一億只留一位小數——生涯總薪資動輒九位數，完整寫出來會把版面撐爆，而
 * 那個精度對玩家也沒有意義。
 */
export function fmtMoneyShort(wan: number): string {
  const safe = Math.max(0, Math.round(wan));
  if (safe >= 10000) return `${(safe / 10000).toFixed(1)} 億`;
  return `${safe.toLocaleString('en-US')} 萬`;
}
