/**
 * 特性的名稱通道。
 *
 * 名稱曾經同時活在兩個地方：發特性時傳進卡片的字串，與 `traits.json` 的
 * `name`。兩份沒有人比對，於是三個 `dynamic_name` 的特性拿得到卻在面板上
 * 消失，`sweetheart` 更是連定義都不存在。這裡盯著修好之後的不變式。
 */

import { describe, expect, it } from 'vitest';
import { love as loveCfg, traitName, traitOf, traits as traitsData } from '../data/index.ts';
import { Game, type GameSetup } from './game.ts';

const setup: GameSetup = {
  seed: 'trait-seed',
  name: '王小明',
  startPosition: 'SS',
  throws: 'R',
  bats: 'R',
};

describe('traitName', () => {
  it('固定名稱直接回資料檔', () => {
    expect(traitName('glass')).toBe('帕瓦諾');
  });

  it('動態名稱把生涯內容填進樣板', () => {
    expect(traitName('legend', '中職')).toBe('中職歷史級球星');
    expect(traitName('mrteam', '猛瑪')).toBe('猛瑪先生');
    expect(traitName('rainbow', '日職')).toBe('日職七彩球衣');
  });

  it('動態名稱少了生涯內容就炸掉，不生出半截的名字', () => {
    expect(() => traitName('legend')).toThrow();
  });

  it('未知的 id 不假裝有名字', () => {
    expect(() => traitName('nonesuch')).toThrow();
  });

  it('青梅竹馬發得出來也查得到——它曾經只存在於 love.json', () => {
    expect(traitOf(loveCfg.childhood_sweetheart.trait)?.name).toBe('青梅竹馬');
  });

  it('三人行的兩個特性查得到——它們的 id 只寫在 love.json 裡', () => {
    expect(traitOf(loveCfg.threesome.harem.trait)?.name).toBe('鹿鼎公');
    expect(traitOf(loveCfg.threesome.cuckold.trait)?.name).toBe('縮頭烏龜');
  });
});

/** 把目前提問的第一個選項選下去，直到流程結束。 */
function playToEnd(seed: string): Game {
  const game = new Game({ ...setup, seed });
  game.start();
  while (game.flow.prompt !== null) {
    const usable = (game.flow.prompt?.options ?? []).filter(
      (o) => o.disabled !== true && o.id !== 'alloc:undo',
    );
    const pick = (usable.find((o) => o.id === 'alloc:confirm') ?? usable[0])?.id;
    if (pick === undefined) throw new Error('提問沒有選項');
    game.choose(pick);
  }
  return game;
}

describe('特性顯示', () => {
  const dynamic = new Set(traitsData.traits.filter((t) => t.name === null).map((t) => t.id));

  it('拿到的每個特性都叫得出名字', () => {
    for (let i = 0; i < 20; i++) {
      const state = playToEnd(`show-${i}`).state;
      if (state === null) continue;
      for (const id of state.traits) {
        // 面板照 traits.json 的分類順序走，查不到定義的 id 會被整個跳過。
        expect(traitOf(id), `特性 ${id} 不在 traits.json 裡`).toBeDefined();
        const label = state.traitNames.get(id) ?? traitOf(id)?.name;
        expect(label, `特性 ${id} 顯示不出名字`).toBeTruthy();
      }
    }
  });

  it('動態命名的特性一定帶著解析好的名字', () => {
    for (let i = 0; i < 20; i++) {
      const state = playToEnd(`dyn-${i}`).state;
      if (state === null) continue;
      for (const id of state.traits) {
        if (!dynamic.has(id)) continue;
        expect(state.traitNames.get(id)).toBeTruthy();
      }
    }
  });

  it('沒拿到的特性不會有殘留名稱', () => {
    const state = playToEnd('clean-1').state;
    for (const id of state?.traitNames.keys() ?? []) expect(state?.traits.has(id)).toBe(true);
  });
});

/** 點開狀態顯示的是文案（desc）。每一個特性都要有，而且效果要用粗體寫進去。 */
describe('特性的文案', () => {
  it('每一個特性都有文案，文案裡用粗體寫出效果', () => {
    for (const t of traitsData.traits) {
      expect(t.desc, `${t.id} 沒有文案`).toBeTruthy();
      expect(t.desc, `${t.id} 的文案沒有粗體的效果`).toMatch(/<b class="(hl|dn)">/);
    }
  });
});
