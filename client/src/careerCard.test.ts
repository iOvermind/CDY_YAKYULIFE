import { describe, expect, it } from 'vitest';
import { careerCardOf } from './App.tsx';
import { Game, type GameSetup } from './engine/game.ts';

const setup: GameSetup = {
  seed: 'card-seed',
  name: '王小明',
  startPosition: 'SS',
  throws: 'R',
  bats: 'L',
};

/** 打完一整段生涯。選項一律挑第一個能挑的，配點挑「確認」。 */
function played(seed: string): Game {
  const game = new Game({ ...setup, seed });
  game.start();
  let guard = 0;
  while (game.flow.prompt !== null && guard++ < 20000) {
    const usable = game.flow.prompt.options.filter(
      (o) => o.disabled !== true && o.id !== 'alloc:undo',
    );
    const pick = (usable.find((o) => o.id === 'alloc:confirm') ?? usable[0])?.id;
    if (pick === undefined) break;
    game.choose(pick);
  }
  return game;
}

describe('生涯成績圖的內容', () => {
  it('生涯還沒結束就沒有圖', () => {
    const game = new Game(setup);
    game.start();
    expect(careerCardOf(game)).toBeNull();
  });

  it('每一列的格數與表頭一致', () => {
    // 欄數對不上的話圖上不會報錯，只會整排數字往旁邊挪一格——那種錯只有人眼
    // 看得出來，所以在這裡擋住。
    let checked = 0;
    for (let i = 0; i < 5; i++) {
      const card = careerCardOf(played(`card-${i}`));
      if (card === null) continue;
      expect(card.tables.length).toBeGreaterThan(0);
      for (const t of card.tables) {
        for (const r of t.rows) expect(r.cells).toHaveLength(t.head.length);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('球員卡帶著姓名、投打與掛靴的地方', () => {
    const card = careerCardOf(played('card-0'));
    expect(card).not.toBeNull();
    expect(card?.name).toBe('王小明');
    expect(card?.hands).toBe('投右打左');
    expect(card?.age).toBeGreaterThan(18);
    expect(card?.seed).toBe('card-0');
  });

  it('引退之日的敘述抄進圖裡，而且不帶 HTML', () => {
    let checked = 0;
    for (let i = 0; i < 5; i++) {
      const card = careerCardOf(played(`card-${i}`));
      if (card?.retire == null) continue;
      checked++;
      expect(card.retire).not.toMatch(/[<>]/);
      expect(card.retire.length).toBeGreaterThan(20);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
