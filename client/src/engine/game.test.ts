import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, Game, type GameSetup } from './game.ts';

const setup: GameSetup = { seed: 'test-seed', name: '王小明', startPosition: 'SS' };

const started = (over: Partial<GameSetup> = {}) => new Game({ ...setup, ...over }).start();

describe('Game', () => {
  it('start() 產生球員並推進到第一個提問', () => {
    const game = started();
    expect(game.player).not.toBeNull();
    expect(game.player?.name).toBe('王小明');
    expect(game.flow.prompt).not.toBeNull();
  });

  it('start() 之前沒有球員', () => {
    expect(new Game(setup).player).toBeNull();
  });

  it('開局會寫下年度分隔線與入學卡片', () => {
    const game = started();
    const log = game.flow.log;
    expect(log[0]).toMatchObject({ kind: 'divider' });
    expect(log[1]).toMatchObject({ kind: 'card', tone: 'gold', title: '入學' });
    // 入學卡片必須提到實際分發到的高中
    const school = game.player?.school ?? '';
    expect(JSON.stringify(log)).toContain(school);
  });

  it('相同設定產生完全相同的球員', () => {
    expect(started().player).toEqual(started().player);
  });

  it('不同種子產生不同球員', () => {
    expect(started().player).not.toEqual(started({ seed: 'other' }).player);
  });
});

describe('卡片內文的跳脫', () => {
  // 介面層用 innerHTML 渲染卡片（高光標記需要），因此玩家輸入的字串必須跳脫。
  const evil = '<script>alert(1)</script>';

  it('球員姓名裡的 HTML 會被跳脫，不會變成標記', () => {
    const game = started({ name: evil });
    const body = JSON.stringify(game.flow.log);
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
  });

  it('跳脫不影響球員資料本身——只有卡片內文需要', () => {
    expect(started({ name: evil }).player?.name).toBe(evil);
  });
});

/** 把目前提問的第一個選項選下去，直到流程結束。 */
function playToEnd(game: Game): Game {
  while (game.flow.prompt !== null) {
    const first = game.flow.prompt.options[0];
    if (first === undefined) throw new Error('提問沒有選項');
    game.choose(first.id);
  }
  return game;
}

describe('重播', () => {
  it('相同設定與相同選擇必定重現同一段生涯', () => {
    const a = playToEnd(started());

    const b = Game.replay(a.toReplayLog());

    expect(b.player).toEqual(a.player);
    expect(b.flow.log).toEqual(a.flow.log);
    expect(b.flow.choices).toEqual(a.flow.choices);
    expect(b.world.drawCounts()).toEqual(a.world.drawCounts());
    // 能力與蓄力槽都必須一致——重播重建的是完整狀態，不只是敘事
    expect(b.state?.ability).toEqual(a.state?.ability);
    expect(b.state?.carry).toEqual(a.state?.carry);
  });

  it('不同的選擇走出不同的能力分佈', () => {
    const a = started();
    a.choose('alloc:pow');
    const b = started();
    b.choose('alloc:ctl');
    expect(a.state?.ability).not.toEqual(b.state?.ability);
  });

  it('重播日誌帶著引擎版本', () => {
    expect(started().toReplayLog().engineVersion).toBe(ENGINE_VERSION);
  });

  it('跨版本一律拒絕重播，不嘗試相容', () => {
    const log = { ...started().toReplayLog(), engineVersion: ENGINE_VERSION + 1 };
    expect(() => Game.replay(log)).toThrow(/跨版本不保證重現/);
  });

  it('重播日誌只需要設定與選擇——沒有任何狀態快照', () => {
    const log = playToEnd(started()).toReplayLog();
    expect(Object.keys(log).sort()).toEqual(['choices', 'engineVersion', 'setup']);
    // 一整個球季的選擇仍只有幾百 bytes，這是重播日誌相對狀態快照的價值所在
    expect(JSON.stringify(log).length).toBeLessThan(500);
  });

  it('尚未做出任何選擇時也能重播', () => {
    const a = started();
    const b = Game.replay(a.toReplayLog());
    expect(b.player).toEqual(a.player);
    expect(b.flow.prompt).toEqual(a.flow.prompt);
  });
});

describe('子序列歸屬', () => {
  it('開局用 genesis、季初擲骰用 growth，其餘一律未動', () => {
    const counts = playToEnd(started()).world.drawCounts();
    expect(counts.genesis).toBeGreaterThan(0);
    expect(counts.growth).toBeGreaterThan(0);
    expect(counts.events).toBe(0);
    expect(counts.health).toBe(0);
    expect(counts.season).toBe(0);
    expect(counts.career).toBe(0);
  });
});

describe('訓練骰的分配', () => {
  it('每一顆骰都是一次選擇，全部記進重播日誌', () => {
    const game = playToEnd(started());
    const allocs = game.flow.choices.filter((c) => c.startsWith('alloc:'));
    expect(allocs.length).toBeGreaterThanOrEqual(2);
    // 分配的目標必須都是實際存在的能力
    for (const c of allocs) {
      expect(game.state?.ability).toHaveProperty(c.slice('alloc:'.length));
    }
  });

  it('分配後的能力值不低於開局值——訓練只會往上', () => {
    const game = playToEnd(started());
    const origin = game.state?.origin.ability ?? {};
    for (const [key, value] of Object.entries(game.state?.ability ?? {})) {
      expect(value).toBeGreaterThanOrEqual(origin[key] ?? 0);
    }
  });

  it('投入的點數不會憑空消失——不是變成能力就是留在蓄力槽', () => {
    const game = started();
    const before = { ...(game.state?.ability ?? {}) };
    const first = game.flow.prompt?.options[0];
    if (first === undefined) throw new Error('沒有提問');
    game.choose(first.id);

    const key = first.id.slice('alloc:'.length);
    const gained = (game.state?.ability[key] ?? 0) - (before[key] ?? 0);
    const carry = game.state?.carry[key] ?? 0;
    expect(gained > 0 || carry > 0).toBe(true);
  });
});
