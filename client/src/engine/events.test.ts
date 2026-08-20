import { describe, expect, it } from 'vitest';
import { ALL_ABILITIES, PITCH_FAMILIES } from '../data/index.ts';
import {
  drawEvent,
  eventPool,
  injuryMagnitude,
  magnitudeFactor,
  resolveEvent,
  successChances,
  type EventContext,
  type EventMode,
} from './events.ts';
import { World } from './rng.ts';

const ctx = (over: Partial<EventContext> = {}): EventContext => ({
  startPosition: 'SS',
  professional: false,
  traits: new Set(),
  ...over,
});

/** 找一張事件卡，不管它屬於哪個對象——測試要能指定任何一張。 */
const findEvent = (id: string) => {
  for (const pos of ['P', 'SS']) {
    const found = eventPool(ctx({ startPosition: pos, professional: true })).find(
      (e) => e.id === id,
    );
    if (found !== undefined) return found;
  }
  throw new Error(`找不到事件 ${id}`);
};

const resolve = (seed: string, id: string, mode: EventMode, over: Partial<EventContext> = {}) =>
  resolveEvent(new World(seed), findEvent(id), mode, ctx(over), ALL_ABILITIES, PITCH_FAMILIES);

describe('eventPool', () => {
  it('野手抽不到投手限定的事件', () => {
    const pool = eventPool(ctx());
    expect(pool.every((e) => e.for !== 'P')).toBe(true);
  });

  it('投手抽不到野手限定的事件', () => {
    const pool = eventPool(ctx({ startPosition: 'P' }));
    expect(pool.every((e) => e.for !== 'A' && e.for !== 'B')).toBe(true);
  });

  it('養成期抽不到職業限定的事件', () => {
    expect(eventPool(ctx()).every((e) => e.for !== 'PRO')).toBe(true);
  });

  it('職業階段抽得到職業限定的事件', () => {
    expect(eventPool(ctx({ professional: true })).some((e) => e.for === 'PRO')).toBe(true);
  });

  it('通用事件人人抽得到', () => {
    for (const pos of ['P', 'SS', 'C']) {
      expect(eventPool(ctx({ startPosition: pos })).some((e) => e.for === '*')).toBe(true);
    }
  });
});

describe('drawEvent', () => {
  it('相同種子抽到相同事件', () => {
    expect(drawEvent(new World('a'), ctx()).id).toBe(drawEvent(new World('a'), ctx()).id);
  });

  it('抽到的事件一定在該階段的池子裡', () => {
    const pool = new Set(eventPool(ctx()).map((e) => e.id));
    for (let i = 0; i < 200; i++) {
      expect(pool).toContain(drawEvent(new World(`s${i}`), ctx()).id);
    }
  });

  it('稀有事件明顯比常見事件少', () => {
    const counts: Record<string, number> = {};
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const e = drawEvent(new World(`s${i}`), ctx({ professional: true }));
      counts[e.id] = (counts[e.id] ?? 0) + 1;
    }
    // event_19（組頭接觸）權重 2，event_1（打擊機特訓）權重預設 100
    expect(counts['event_19'] ?? 0).toBeLessThan((counts['event_1'] ?? 0) / 10);
  });

  it('只消耗 events 流', () => {
    const world = new World('a');
    drawEvent(world, ctx());
    const counts = world.drawCounts();
    expect(counts.events).toBeGreaterThan(0);
    expect(counts.growth).toBe(0);
    expect(counts.season).toBe(0);
  });
});

describe('successChances', () => {
  it('保守最高、豪賭最低', () => {
    const c = successChances(new Set());
    expect(c.safe).toBeGreaterThan(c.normal);
    expect(c.normal).toBeGreaterThan(c.bold);
  });

  it('練武奇才提升全部三種應對的成功率', () => {
    const plain = successChances(new Set());
    const genius = successChances(new Set(['genius']));
    expect(genius.normal).toBeGreaterThan(plain.normal);
    expect(genius.bold).toBeGreaterThan(plain.bold);
  });

  it('何金銀降低成功率', () => {
    expect(successChances(new Set(['thief'])).normal).toBeLessThan(
      successChances(new Set()).normal,
    );
  });

  it('今晚打老虎讓豪賭不再有懲罰——那正是這個特性的意義', () => {
    const clutch = successChances(new Set(['clutch']));
    expect(clutch.bold).toBe(clutch.normal);
  });

  it('保守的成功率有上限，不會逼近必勝', () => {
    expect(successChances(new Set(['genius'])).safe).toBeLessThanOrEqual(95);
  });
});

describe('magnitudeFactor', () => {
  it('豪賭的幅度大於照常，照常大於保守', () => {
    const t = new Set<string>();
    expect(magnitudeFactor('bold', true, t)).toBeGreaterThan(magnitudeFactor('normal', true, t));
    expect(magnitudeFactor('normal', true, t)).toBeGreaterThan(magnitudeFactor('safe', true, t));
  });

  it('今晚打老虎的豪賭：上檔更高、下檔更軟', () => {
    const clutch = new Set(['clutch']);
    const plain = new Set<string>();
    expect(magnitudeFactor('bold', true, clutch)).toBeGreaterThan(
      magnitudeFactor('bold', true, plain),
    );
    expect(magnitudeFactor('bold', false, clutch)).toBeLessThan(
      magnitudeFactor('bold', false, plain),
    );
  });
});

describe('injuryMagnitude', () => {
  it('冒的險越大受傷風險越高', () => {
    const t = new Set<string>();
    expect(injuryMagnitude('bold', t)).toBeGreaterThan(injuryMagnitude('normal', t));
    expect(injuryMagnitude('normal', t)).toBeGreaterThan(injuryMagnitude('safe', t));
  });

  it('今晚打老虎把豪賭的受傷風險降到普通級', () => {
    expect(injuryMagnitude('bold', new Set(['clutch']))).toBe(
      injuryMagnitude('normal', new Set()),
    );
  });
});

describe('resolveEvent', () => {
  it('相同種子產生相同結果', () => {
    expect(resolve('a', 'event_1', 'normal')).toEqual(resolve('a', 'event_1', 'normal'));
  });

  it('效果值大的事件影響也大——這是與舊版最主要的差別', () => {
    // event_18 神秘的營養品 pow:5 vs event_1 打擊機特訓 con:2
    const findGood = (id: string, key: string) => {
      for (let i = 0; i < 200; i++) {
        const r = resolve(`s${i}`, id, 'normal', { professional: true });
        if (r.good) {
          const d = r.deltas.find((x) => x.key === key);
          if (d) return d.points;
        }
      }
      throw new Error(`沒有抽到 ${id} 的好結果`);
    };
    expect(findGood('event_18', 'pow')).toBeGreaterThan(findGood('event_1', 'con'));
  });

  it('倍率不會讓小效果歸零——保底一點', () => {
    for (let i = 0; i < 100; i++) {
      const r = resolve(`s${i}`, 'event_2', 'safe');
      for (const d of r.deltas) expect(Math.abs(d.points)).toBeGreaterThanOrEqual(1);
    }
  });

  it('壞結果的效果是負的', () => {
    for (let i = 0; i < 200; i++) {
      const r = resolve(`s${i}`, 'event_1', 'normal');
      if (!r.good) {
        expect(r.deltas.every((d) => d.points < 0)).toBe(true);
        return;
      }
    }
    throw new Error('沒有抽到壞結果');
  });

  it('rand 效果會挑一項實際存在的能力', () => {
    for (let i = 0; i < 100; i++) {
      const r = resolve(`s${i}`, 'event_10', 'normal');
      for (const d of r.deltas) expect(ALL_ABILITIES).toContain(d.key);
    }
  });

  it('pitch 效果只會挑球系', () => {
    // event_3 牛棚加練：好結果是 pitch（隨機一個球系），壞結果是 ctl
    let seen = false;
    for (let i = 0; i < 200; i++) {
      const r = resolve(`s${i}`, 'event_3', 'normal', { startPosition: 'P' });
      if (!r.good) continue;
      for (const d of r.deltas) {
        expect(PITCH_FAMILIES).toContain(d.key);
        seen = true;
      }
    }
    expect(seen).toBe(true);
  });

  it('inj 的幅度來自應對方式，與效果值無關', () => {
    for (let i = 0; i < 200; i++) {
      const r = resolve(`s${i}`, 'event_8', 'bold');
      if (!r.good) {
        expect(r.injury).toBe(injuryMagnitude('bold', new Set()));
        return;
      }
    }
    throw new Error('沒有抽到壞結果');
  });

  it('魔法學校的好結果提升上限，而不是直接加能力', () => {
    for (let i = 0; i < 200; i++) {
      const r = resolve(`s${i}`, 'event_20', 'normal');
      if (r.good) {
        expect(r.ceilings.length).toBeGreaterThan(0);
        expect(r.deltas).toHaveLength(0);
        return;
      }
    }
    throw new Error('沒有抽到好結果');
  });

  it('布林型的特殊效果原樣傳出，交由呼叫端處理', () => {
    for (let i = 0; i < 200; i++) {
      const r = resolve(`s${i}`, 'event_20', 'normal');
      if (!r.good) {
        expect(r.special['yips']).toBe(true);
        return;
      }
    }
    throw new Error('沒有抽到壞結果');
  });

  it('禁賽與聲望這類非能力效果不會被誤當成能力', () => {
    for (let i = 0; i < 300; i++) {
      const r = resolve(`s${i}`, 'event_18', 'normal', { professional: true });
      if (!r.good) {
        expect(r.special['suspension']).toBeDefined();
        expect(r.deltas.every((d) => ALL_ABILITIES.includes(d.key))).toBe(true);
        return;
      }
    }
    throw new Error('沒有抽到壞結果');
  });

  it('豪賭的成功率確實比較低', () => {
    const rate = (mode: EventMode) => {
      let good = 0;
      const n = 500;
      for (let i = 0; i < n; i++) if (resolve(`s${i}`, 'event_1', mode).good) good++;
      return good / n;
    };
    expect(rate('bold')).toBeLessThan(rate('normal'));
    expect(rate('normal')).toBeLessThan(rate('safe'));
  });
});
