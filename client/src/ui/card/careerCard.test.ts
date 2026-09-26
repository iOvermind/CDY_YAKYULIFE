import { describe, expect, it } from 'vitest';
import { careerCardOf } from './careerCard.ts';
import { Game, type GameSetup } from '../../engine/game.ts';
import { HARNESS_POSITIONS, playCareer } from '../../../scripts/harness.ts';

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

  it('生涯評價與生涯收入抄進圖裡，分行與小字的層級都留著', () => {
    let checked = 0;
    for (let i = 0; i < 5; i++) {
      // **要用護欄那套玩家。** 「一律挑第一個選項」的人跑不到頂級聯盟，而評價分
      // 那張卡只在有頂級聯盟成績時出現，於是這一條會永遠空轉。
      const card = careerCardOf(playCareer(`card-${i}`, HARNESS_POSITIONS[i % HARNESS_POSITIONS.length]!));
      // 沒打進職業的人沒有評價分那張卡，收入那張跟著沒有。
      if (card === null || card.score.length === 0) continue;
      checked++;
      // 總評價分那一行一定在，而且是主行不是小字。
      expect(card.score.some((l) => !l.dim && l.text.includes('總評價分'))).toBe(true);
      // 小字那幾行是卡片裡的層級，壓掉就看不出主從。
      expect(card.score.some((l) => l.dim)).toBe(true);
      for (const line of card.score) expect(line.text).not.toMatch(/[<>]/);

      expect(card.earnings.length).toBeGreaterThan(0);
      expect(card.earnings.some((l) => !l.dim && l.text.includes('合計'))).toBe(true);
      for (const line of card.earnings) expect(line.text).not.toMatch(/[<>]/);
    }
    expect(checked).toBeGreaterThan(0);
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
