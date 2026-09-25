/**
 * 跑完一整段生涯的測試替身。
 *
 * 護欄與「圖裡有沒有那一節」這類整合測試共用同一個玩家：**同一套策略跑出來的
 * 才是同一種人**，各寫一份 while 迴圈的話，兩邊紅起來的原因會對不上。
 *
 * 校準腳本（`scripts/calibrate.ts`）有自己的一組策略（balanced／slugger／glove
 * ……），沒有併進來——它要的是多種玩家的對照，這裡要的是一種。balanced 那一份
 * 必須與下面這套一致，改了一邊就要改另一邊。
 */

import { Game, type GameSetup } from '../src/engine/game.ts';

/**
 * 與校準腳本的 balanced 策略一致——護欄與校準必須看同一種玩家。
 *
 * **必須依起始守位分兩份**。自從養成期依起始守位鎖側（見 ADR 0009）之後，P 起點
 * 的玩家只加得動 `sta`，其餘五項全被擋下、點數等於丟掉。在鎖側之前這個破洞是靜
 * 悄悄的：P 起點照樣把點加進 con/rng/pow/fld，畢業時野手側較高，`lockedSide` 判
 * 成野手——也就是說這套取樣**從來沒產生過投手**，校準報表上「投手 目標 35%／實際
 * 0.0%」就是這麼來的。鎖側只是把靜靜地變成野手，換成明顯地跑不到職業。
 */
export const BALANCED_FIELDER = ['sta', 'con', 'rng', 'pow', 'fld', 'eye'];
export const BALANCED_PITCHER = ['sta', 'vel', 'ctl', 'swp', 'drp'];

export function playCareer(
  seed: string,
  startPosition: GameSetup['startPosition'],
  name = '護欄',
): Game {
  const game = new Game({ seed, name, startPosition, throws: 'R', bats: 'R' }).start();
  let guard = 0;
  let cursor = 0;
  const balanced = startPosition === 'P' ? BALANCED_PITCHER : BALANCED_FIELDER;
  while (game.flow.prompt !== null && guard++ < 8000) {
    const options = game.flow.prompt.options;
    const rotated = [...balanced.slice(cursor % balanced.length), ...balanced];
    // 與校準腳本的策略必須一致——護欄與校準要看同一種玩家。
    const pick =
      // **身體開口的那一年就掛靴**——與校準腳本同一條規則。這裡原本漏了它，於是
      // 代理一路硬撐到年齡上限，生涯長度中位數 27 個球季。生涯評價分是累積 Win
      // Shares，打三十年當然進名人堂：名人堂帶因此虛胖成 16.7%，補上這條之後是
      // 8.3%，與校準報表的 8.1% 對得上。護欄與校準必須看同一種玩家。
      (options.some((o) => o.id === 'retire:push')
        ? options.find((o) => o.id === 'retire:quit')
        : undefined) ??
      options.find((o) => o.id === 'retire:stay') ??
      options.find((o) => o.id === 'transfer:stay') ??
      options.find((o) => o.id === 'term:long') ??
      options.find((o) => o.id === 'term:short') ??
      options.find((o) => o.id === 'fa:stay') ??
      options.find((o) => o.id === 'fa:crawl') ??
      options.find((o) => o.id === 'demote:accept') ??
      // **升守位一律接受**——寫成明示的策略而不是讓它從最後的 fallback 掉下去。
      // 那條 fallback 會挑第一個可選項，剛好也是 accept，但那是巧合不是決定：
      // 選項順序一改，護欄與校準的玩家就會安靜地換一種人（ADR 0009 記過同樣的坑）。
      options.find((o) => o.id === 'position:accept') ??
      options.find((o) => o.id === 'fallback:0') ??
      rotated
        .map((k) => options.find((o) => o.id === `alloc:${k}` && o.disabled !== true))
        .find((o) => o !== undefined) ??
      options.find((o) => o.id === 'alloc:confirm' && o.disabled !== true) ??
      options.find((o) => o.id === 'draft:accept') ??
      options.find((o) => o.disabled !== true && o.id !== 'alloc:undo' && o.id !== 'alloc:forfeit') ??
      // 所有能力都到頂時只剩放棄可按——那是唯一的出口，不按就卡死在這一步。
      options.find((o) => o.id === 'alloc:forfeit') ??
      undefined;
    if (pick === undefined) break;
    if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') cursor++;
    game.choose(pick.id);
  }
  return game;
}


/** 護欄與校準取樣的守位輪替。投手一定要在裡面，見 BALANCED_PITCHER 的說明。 */
export const HARNESS_POSITIONS = ['SS', 'CF', 'C', '1B', 'P'] as const;
