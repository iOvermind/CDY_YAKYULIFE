import { describe, expect, it } from 'vitest';
import { abilities } from '../data/index.ts';
import { abilityCost, decline, growthCurve, rollTrainingDice, train } from './growth.ts';
import { World } from './rng.ts';

const curve = growthCurve(false);
const twoWay = growthCurve(true);
const noTraits = new Set<string>();

describe('abilityCost', () => {
  it('低段一級一點', () => {
    expect(abilityCost(30, 80, curve)).toBe(1);
    expect(abilityCost(63, 80, curve)).toBe(1);
  });

  it('中高段變貴', () => {
    expect(abilityCost(64, 80, curve)).toBe(2);
    expect(abilityCost(71, 80, curve)).toBe(2);
    expect(abilityCost(72, 80, curve)).toBe(3);
  });

  it('超過潛力天花板要乘上懲罰倍率', () => {
    const m = curve.above_ceiling_multiplier;
    expect(abilityCost(50, 50, curve)).toBe(1 * m);
    expect(abilityCost(75, 50, curve)).toBe(3 * m);
  });

  it('二刀流的曲線較平緩——變貴的門檻往後推', () => {
    // 同一個值，二刀流付的比較少或相同，絕不會更貴
    for (let v = 20; v <= 80; v++) {
      expect(abilityCost(v, 80, twoWay)).toBeLessThanOrEqual(abilityCost(v, 80, curve));
    }
    // 至少要有一段是真的比較便宜，否則這個天賦沒有意義
    expect(abilityCost(72, 80, twoWay)).toBeLessThan(abilityCost(72, 80, curve));
  });

  it('二刀流超過天花板的懲罰也較輕', () => {
    expect(twoWay.above_ceiling_multiplier).toBeLessThan(curve.above_ceiling_multiplier);
  });
});

describe('train', () => {
  it('低段投入幾點就升幾級', () => {
    const r = train(30, 5, 80, 0, curve);
    expect(r.value).toBe(35);
    expect(r.gained).toBe(5);
    expect(r.carry).toBe(0);
  });

  it('未滿一級的點數留在蓄力槽，不蒸發', () => {
    // 64 這一級要 2 點，只投 1 點升不了級
    const r = train(64, 1, 80, 0, curve);
    expect(r.gained).toBe(0);
    expect(r.carry).toBe(1);
  });

  it('蓄力槽會累積，湊滿就升級', () => {
    const first = train(64, 1, 80, 0, curve);
    const second = train(64, 1, 80, first.carry, curve);
    expect(second.gained).toBe(1);
    expect(second.value).toBe(65);
    expect(second.carry).toBe(0);
  });

  it('一次投入足夠的點數可以連升多級', () => {
    // 64→65 要 2 點、65→66 要 2 點，共 4 點
    const r = train(64, 4, 80, 0, curve);
    expect(r.value).toBe(66);
    expect(r.gained).toBe(2);
  });

  it('不會超過量表上限', () => {
    const r = train(79, 100, 80, 0, curve);
    expect(r.value).toBe(abilities.scale.max);
  });

  it('到達上限後蓄力歸零，多的點數才算浪費', () => {
    const r = train(79, 100, 80, 0, curve);
    expect(r.carry).toBe(0);
    expect(r.overflow).toBeGreaterThan(0);
  });

  it('未達上限時不產生浪費——點數不是留在能力上就是留在蓄力槽', () => {
    const r = train(40, 7, 80, 3, curve);
    expect(r.overflow).toBe(0);
    // 投入的總點數必須完全被吸收：升級花掉的 + 留在槽裡的
    let spent = 0;
    for (let v = 40; v < r.value; v++) spent += abilityCost(v, 80, curve);
    expect(spent + r.carry).toBe(7 + 3);
  });

  it('天花板之上仍可成長，只是很貴', () => {
    const under = train(50, 6, 80, 0, curve);
    const over = train(50, 6, 50, 0, curve);
    expect(over.gained).toBeGreaterThan(0);
    expect(over.gained).toBeLessThan(under.gained);
  });

  it('二刀流在高段成長得比較快', () => {
    const normal = train(72, 9, 80, 0, curve);
    const both = train(72, 9, 80, 0, twoWay);
    expect(both.gained).toBeGreaterThan(normal.gained);
  });

  it('拒絕負點數——衰退要走 decline()', () => {
    expect(() => train(50, -1, 80, 0, curve)).toThrow(RangeError);
  });
});

describe('decline', () => {
  it('一律 1:1，不吃成本曲線', () => {
    expect(decline(75, 5)).toBe(70);
    expect(decline(30, 5)).toBe(25);
  });

  it('不會低於絕對下限', () => {
    expect(decline(3, 100)).toBe(abilities.scale.hard_floor);
  });

  it('拒絕負點數', () => {
    expect(() => decline(50, -1)).toThrow(RangeError);
  });
});

describe('rollTrainingDice', () => {
  const roll = (seed: string, traits = noTraits, opts = {}) =>
    rollTrainingDice(new World(seed), traits, opts);

  it('相同種子擲出相同結果', () => {
    expect(roll('a')).toEqual(roll('a'));
  });

  it('骰數落在設定的範圍內', () => {
    const allowed = Object.keys(abilities.training_dice.count_weights).map(Number);
    for (let i = 0; i < 300; i++) {
      expect(allowed).toContain(roll(`s${i}`).values.length);
    }
  });

  it('每顆骰都在 1 到 6 之間', () => {
    for (let i = 0; i < 200; i++) {
      for (const v of roll(`s${i}`).values) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      }
    }
  });

  it('傷缺整季時骰數固定為最低值', () => {
    for (let i = 0; i < 50; i++) {
      expect(roll(`s${i}`, noTraits, { injured: true }).values.length).toBe(
        abilities.training_dice.count_when_injured,
      );
    }
  });

  it('天才的骰面下限被墊高', () => {
    const genius = new Set(['genius']);
    for (let i = 0; i < 200; i++) {
      for (const v of roll(`s${i}`, genius).values) {
        expect(v).toBeGreaterThanOrEqual(abilities.training_dice.faces['genius']?.min ?? 0);
      }
    }
  });

  it('天才優先於大器晚成——兩者同時擁有時用天才的區間', () => {
    const both = new Set(['genius', 'late']);
    const geniusMin = abilities.training_dice.faces['genius']?.min ?? 0;
    for (let i = 0; i < 200; i++) {
      for (const v of roll(`s${i}`, both).values) {
        expect(v).toBeGreaterThanOrEqual(geniusMin);
      }
    }
  });

  it('外務纏身讓骰數變少，但不低於下限', () => {
    const distract = new Set(['distract']);
    const min = abilities.training_dice.min_count;
    let total = 0;
    let plain = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const d = roll(`s${i}`, distract).values.length;
      expect(d).toBeGreaterThanOrEqual(min);
      total += d;
      plain += roll(`s${i}`).values.length;
    }
    expect(total / n).toBeLessThan(plain / n);
  });

  it('回報這次擲出的 6 的數量', () => {
    for (let i = 0; i < 100; i++) {
      const d = roll(`s${i}`);
      expect(d.sixes).toBe(d.values.filter((v) => v === 6).length);
    }
  });

  it('只消耗 growth 流，不動其他流', () => {
    const world = new World('a');
    rollTrainingDice(world, noTraits);
    const counts = world.drawCounts();
    expect(counts.growth).toBeGreaterThan(0);
    expect(counts.genesis).toBe(0);
    expect(counts.season).toBe(0);
    expect(counts.health).toBe(0);
  });
});
