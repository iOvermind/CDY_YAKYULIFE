/**
 * 慣用手的對價。
 *
 * 左投、左打、左右開弓在棒球裡都有結構性優勢。這個模組是那份優勢的價目表：
 * 一個球員落在哪一檔，那一檔要付多少。
 *
 * 對價分兩半，兩半都在這裡算：
 *
 * - **個人尺**（standard）：他被拿來比的 par／min 一起下移。同樣的能力值，
 *   他的成績被算得比別人好看——這是順風那一半，永久有效。
 * - **潛力上限**（potential）：出生時抽到的潛力打折。他天生就練不到那麼高
 *   ——這是代價那一半。
 *
 * 兩半必須一起存在。只降上限是純扣分（那是舊的 ceiling_modifier 留下的
 * `_pending_warning`）；只降尺是白送。
 *
 * 檔次**取代不累加**：左右開弓的人不是在左打那一檔上再疊一層，而是整個換到
 * 更深的那一檔。同一個球員只吃一個檔次。
 */

import { abilities } from '../data/index.ts';
import type { Hand } from '../data/index.ts';

export type HandednessTier = 'none' | 'left' | 'switch' | 'switch_pitcher';

/** 左右開投是隱藏特性，不是出生時選的慣用手——見 abilities.json 的 throws._note。 */
export const SWITCH_PITCHER_TRAIT = 'switch_pitcher';

/**
 * 這個球員落在哪一檔。
 *
 * 左右開投是後天拿到的，因此這裡吃 traits：中途拿到的右投當下就換檔，
 * 尺與上限同時改變。已經點超過新上限的能力值不回扣，他只是接下來變貴。
 *
 * **左右開投自己一檔**，不併進左右開弓：順風同級（標準都降 15%），但潛力上限只降
 * 15% 而不是 25%——那個特性是養成期擲出來的，折扣卻會回頭咬他出生時抽到的潛力，
 * 用打者那一檔的 25% 等於在事後追罰一件他沒得選的事。
 */
export function handednessTier(player: {
  readonly throws: Hand;
  readonly bats: Hand;
  readonly traits?: ReadonlySet<string> | readonly string[];
}): HandednessTier {
  const traits = player.traits;
  const switchPitcher =
    traits instanceof Set
      ? traits.has(SWITCH_PITCHER_TRAIT)
      : Array.isArray(traits)
        ? traits.includes(SWITCH_PITCHER_TRAIT)
        : false;

  // 左右開弓的打者在前：一個人若兩者都有，順風更大的那一檔才對——左右開投自己
  // 那一檔的潛力折扣比較輕（見 abilities.json），不該讓「多會一件事」變成折扣變便宜。
  if (player.bats === 'S' || player.throws === 'S') return 'switch';
  if (switchPitcher) return 'switch_pitcher';
  if (player.bats === 'L' || player.throws === 'L') return 'left';
  return 'none';
}

function rateOf(tier: HandednessTier, kind: 'standard' | 'potential'): number {
  if (tier === 'none') return 0;
  return abilities.handedness.discount.tiers[tier][kind];
}

/** 個人尺要下移的比例。par 與 min 同步吃這個折扣。 */
export function standardDiscount(tier: HandednessTier): number {
  return rateOf(tier, 'standard');
}

/**
 * 折後的潛力上限。
 *
 * 只作用在出生時抽到的潛力上——天生神力與事件的加成原價疊在折後的值上面，
 * 硬上限 80 對誰都一樣。無條件捨去：折扣是代價，不四捨五入成免費的半點。
 */
export function discountedPotential(base: number, tier: HandednessTier): number {
  const rate = rateOf(tier, 'potential');
  if (rate === 0) return base;
  return Math.max(abilities.scale.hard_floor, Math.floor(base * (1 - rate)));
}
