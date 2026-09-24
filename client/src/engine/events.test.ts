import { describe, expect, it } from 'vitest';
import { ALL_ABILITIES, events, PITCH_FAMILIES } from '../data/index.ts';
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
import { applyTalents } from './overlay.ts';
import { World } from './rng.ts';

const ctx = (over: Partial<EventContext> = {}): EventContext => ({
  side: 'fielder',
  professional: false,
  traits: new Set(),
  ...over,
});

/** 找一張事件卡，不管它屬於哪個對象——測試要能指定任何一張。 */
const findEvent = (id: string) => {
  for (const side of ['pitcher', 'fielder', null] as const) {
    const found = eventPool(ctx({ side, professional: true })).find((e) => e.id === id);
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
    const pool = eventPool(ctx({ side: 'pitcher' }));
    expect(pool.every((e) => e.for !== 'A' && e.for !== 'B')).toBe(true);
  });

  it('養成期抽不到職業限定的事件', () => {
    expect(eventPool(ctx()).every((e) => e.for !== 'PRO')).toBe(true);
  });

  it('職業階段抽得到職業限定的事件', () => {
    expect(eventPool(ctx({ professional: true })).some((e) => e.for === 'PRO')).toBe(true);
  });

  it('通用事件人人抽得到', () => {
    for (const side of ['pitcher', 'fielder', null] as const) {
      expect(eventPool(ctx({ side })).some((e) => e.for === '*')).toBe(true);
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

  it('高手高手高高手提升全部三種應對的成功率', () => {
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

  it('三種應對的數字：一般人 35/50/70，天才級 50/65/85', () => {
    expect(successChances(new Set())).toEqual({ bold: 35, normal: 50, safe: 70 });
    expect(successChances(new Set(['genius']))).toEqual({ bold: 50, normal: 65, safe: 85 });
  });

  it('今晚打老虎的豪賭不會高過照常——豁免只是讓它齊平，不是讓它更划算', () => {
    const clutch = successChances(new Set(['clutch']));
    expect(clutch.bold).toBeLessThanOrEqual(clutch.normal);
    expect(clutch).toEqual({ bold: 65, normal: 65, safe: 85 });
  });

  it('成功率一律是整數——天賦的乘算層會跑出 68.9 與 77.00000000000001 那種數字，而它會原樣印在選項上', () => {
    // 天選之人 ×1.06 與梭哈 ×1.2 一起套：65 × 1.06 = 68.9，再乘 1.2 更難看。
    const revert = applyTalents({ fortune: 1, allin: 2 });
    try {
      for (const traits of [
        new Set<string>(),
        new Set(['genius']),
        new Set(['clutch']),
        new Set(['thief']),
      ]) {
        for (const v of Object.values(successChances(traits))) {
          expect(Number.isInteger(v)).toBe(true);
        }
      }
    } finally {
      revert();
    }
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
      const r = resolve(`s${i}`, 'event_3', 'normal', { side: 'pitcher' });
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

describe('事件卡只動得了這位球員練得到的能力（ADR 0022）', () => {
  const FIELDER = ALL_ABILITIES.filter((k) => k !== 'vel' && k !== 'ctl' && !PITCH_FAMILIES.includes(k as never));
  const PITCHER = ['sta', 'vel', 'ctl', ...PITCH_FAMILIES] as const;

  const resolveFor = (
    seed: string,
    id: string,
    mode: EventMode,
    over: Partial<EventContext>,
    abilityPool: readonly string[],
    families: readonly string[],
  ) =>
    resolveEvent(
      new World(seed),
      findEvent(id),
      mode,
      ctx(over),
      abilityPool as never,
      families as never,
    );

  it('野手抽到的通用卡不會加到控球——那是無感的獎勵', () => {
    // event_17 衰到流湯的大低潮：好結果 eye+ctl+sta，壞結果 con+pitch+sta
    let sawGood = false;
    for (let i = 0; i < 100; i++) {
      const r = resolveFor(`f${i}`, 'event_17', 'bold', { side: 'fielder', abilities: FIELDER }, FIELDER, []);
      if (r.good) sawGood = true;
      expect(r.deltas.map((d) => d.key)).not.toContain('ctl');
    }
    expect(sawGood).toBe(true);
  });

  it('扣分那一側一樣擋掉——免費的懲罰跟無感的獎勵一樣糟', () => {
    let sawBad = false;
    for (let i = 0; i < 100; i++) {
      const r = resolveFor(`f${i}`, 'event_35', 'safe', { side: 'fielder', abilities: FIELDER }, FIELDER, []);
      if (!r.good) sawBad = true;
      expect(r.deltas.map((d) => d.key)).not.toContain('ctl');
    }
    expect(sawBad).toBe(true);
  });

  it('野手抽到帶 pitch 的卡不會拿到球系，也不會多抽一顆骰', () => {
    const a = resolveFor('same', 'event_17', 'bold', { side: 'fielder', abilities: FIELDER }, FIELDER, []);
    const b = resolveFor('same', 'event_17', 'bold', { side: 'fielder', abilities: FIELDER }, FIELDER, []);
    expect(a.deltas).toEqual(b.deltas);
    for (const d of a.deltas) expect(PITCH_FAMILIES).not.toContain(d.key);
  });

  it('好結果整組被濾光的卡不會發給他', () => {
    // event_45 去做雷射近視手術：兩面都只給選球，純投手拿它等於白抽一張
    const pool = eventPool(ctx({ side: 'pitcher', professional: true, abilities: PITCHER }));
    expect(pool.map((e) => e.id)).not.toContain('event_45');
    // 沒有能力清單時不過濾——舊呼叫端與測試維持原行為
    expect(eventPool(ctx({ side: 'pitcher', professional: true })).map((e) => e.id)).toContain(
      'event_45',
    );
  });

  /**
   * issue #16：整面都被裁光的結果以前印了卡卻什麼都沒發生。現在同樣的點數與正負
   * 落在他自己那一側的隨機一項。
   */
  it('整面被裁光的結果轉成自己那一側的隨機能力', () => {
    for (let i = 0; i < 40; i++) {
      // event_45 雷射近視手術：兩面都只動選球——純投手一項都練不到。
      const r = resolveFor(`p${i}`, 'event_45', 'normal', { side: 'pitcher', abilities: PITCHER }, PITCHER, PITCH_FAMILIES);
      expect(r.deltas.length).toBeGreaterThan(0);
      for (const d of r.deltas) expect(PITCHER).toContain(d.key);
      for (const d of r.deltas) expect(Math.sign(d.points)).toBe(r.good ? 1 : -1);
    }
  });

  it('資料裡沒有沒實作的效果鍵', () => {
    const known = new Set([...ALL_ABILITIES, 'inj', 'rand', 'pitch', 'suspension', 'income', 'ban', 'yips', 'tj_countdown', 'clutch']);
    const cards = (events as unknown as { events: readonly { id: string; good_effects?: object; bad_effects?: object }[] }).events;
    for (const e of cards) {
      for (const fx of [e.good_effects, e.bad_effects]) {
        for (const key of Object.keys(fx ?? {})) expect(known, `${e.id} 的 ${key}`).toContain(key);
      }
    }
  });

  it('兩側都在的人（UTIL／二刀流）兩邊的牌都抽得到', () => {
    const pool = eventPool(ctx({ side: null, professional: true }));
    expect(pool.some((e) => e.for === 'P')).toBe(true);
    expect(pool.some((e) => e.for === 'A' || e.for === 'B')).toBe(true);
  });
});
