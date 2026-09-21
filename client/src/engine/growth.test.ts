import { describe, expect, it } from 'vitest';
import { abilities } from '../data/index.ts';
import {
  abilityCost,
  carryGauge,
  championshipDice,
  decline,
  growthCurve,
  hardCap,
  rollTrainingDice,
  train,
  untrain,
} from './growth.ts';
import { applyTalents } from './overlay.ts';
import { World } from './rng.ts';

const curve = growthCurve(false);
const twoWay = growthCurve(true);
const tiersOf = () => abilities.growth_cost.default;
const noTraits = new Set<string>();

describe('年齡附加費', () => {
  const at = (age: number, twoWayPlayer = false) => growthCurve(twoWayPlayer, age);
  const s = abilities.growth_cost.aging_surcharge;

  /**
   * 這幾個數字是規則本身，不是從公式反推的——它們定義了「每四年 +1」是什麼
   * 意思。公式改寫的時候，對得上這張表才算沒改壞。
   */
  it('每四年 +1，與能力段無關', () => {
    // 31–34 +1
    expect(abilityCost(50, 80, at(31))).toBe(3); // 基礎 2
    expect(abilityCost(65, 80, at(31))).toBe(7); // 基礎 6
    // 35–38 +2
    expect(abilityCost(50, 80, at(36))).toBe(4);
    expect(abilityCost(65, 80, at(36))).toBe(8);
    // 43–46 +4
    expect(abilityCost(50, 80, at(43))).toBe(6);
  });

  it('巔峰期與更年輕的時候完全沒有附加費', () => {
    for (const age of [18, 25, 26, 30]) {
      expect(abilityCost(65, 80, at(age))).toBe(abilityCost(65, 80, curve));
    }
  });

  it('能力低於門檻不吃附加費——那是還沒開發的東西', () => {
    expect(abilityCost(s.from_ability - 1, 80, at(43))).toBe(
      abilityCost(s.from_ability - 1, 80, curve),
    );
  });

  /** 附加費加在倍率之前：31 歲、能力 51 超出天花板 = (2+1)×3 = 9。 */
  it('天花板的倍率乘在加過附加費之後', () => {
    expect(abilityCost(51, 51, at(31))).toBe(9);
  });

  /** 天賦折扣扣在最後：二刀流 −1、練武奇才 −1，31 歲的 51→52 仍然只要 1 點。 */
  it('天賦折扣仍然扣得到，而且扣在最後', () => {
    const discounted = {
      ...at(31, true),
      curve: { ...abilities.growth_cost.default, discount: 1 },
    };
    expect(abilityCost(51, 80, discounted)).toBe(1);
  });

  /** 上下同一條座標：扣點的借位吃同一份成本（ADR 0033）。 */
  it('扣點的借位吃同一條曲線', () => {
    const old = at(43);
    const cost = abilityCost(64, 80, old); // 基礎 6 + 4 = 10
    expect(cost).toBe(10);
    const back = untrain(65, 5, 80, 0, old);
    expect(back.value).toBe(64);
    expect(back.carry).toBe(cost - 5);
  });
});

describe('abilityCost', () => {
  // 期望值一律從資料推導，不寫死——曲線是平衡參數，調整時測試不該跟著紅。
  const tiers = [...tiersOf().tiers].sort((a, b) => a.from - b.from);
  const lowest = tiers[0];
  const highest = tiers[tiers.length - 1];
  if (lowest === undefined || highest === undefined) throw new Error('tiers 是空的');

  it('最低段的成本最便宜', () => {
    expect(abilityCost(abilities.scale.min, 80, curve)).toBe(lowest.cost);
  });

  it('成本隨能力值單調遞增，不會忽高忽低', () => {
    let previous = 0;
    for (let v = abilities.scale.min; v <= abilities.scale.max; v++) {
      const cost = abilityCost(v, 80, curve);
      expect(cost).toBeGreaterThanOrEqual(previous);
      previous = cost;
    }
  });

  it('每一階的門檻都確實讓成本跳一級', () => {
    for (const tier of tiers) {
      if (tier.from <= abilities.scale.min) continue;
      expect(abilityCost(tier.from, 80, curve)).toBe(tier.cost);
      expect(abilityCost(tier.from - 1, 80, curve)).toBeLessThan(tier.cost);
    }
  });

  it('超過潛力天花板要乘上懲罰倍率', () => {
    const m = tiersOf().above_ceiling_multiplier;
    for (const tier of tiers) {
      expect(abilityCost(tier.from, tier.from, curve)).toBe(tier.cost * m);
    }
  });

  it('二刀流的曲線較平緩——變貴的門檻往後推', () => {
    // 同一個值，二刀流付的比較少或相同，絕不會更貴
    for (let v = 20; v <= 80; v++) {
      expect(abilityCost(v, 80, twoWay)).toBeLessThanOrEqual(abilityCost(v, 80, curve));
    }
    // 至少要有一段是真的比較便宜，否則這個天賦沒有意義
    expect(abilityCost(72, 80, twoWay)).toBeLessThan(abilityCost(72, 80, curve));
  });

  it('二刀流超過天花板時付得比較少', () => {
    // 倍率一樣，差別在折扣：天賦之外每級少付 above_ceiling
    for (const tier of tiersOf().tiers) {
      if (tier.cost === 1) continue;
      expect(abilityCost(tier.from, tier.from, twoWay)).toBeLessThan(
        abilityCost(tier.from, tier.from, curve),
      );
    }
  });

  it('二刀流的折扣是直接扣點，不是另一條曲線', () => {
    const d = abilities.growth_cost.two_way_discount;
    // 天賦之內：v 必須低於天花板，否則走的是天賦之外那條折扣
    for (let v = abilities.scale.min; v < abilities.scale.max; v++) {
      const full = abilityCost(v, abilities.scale.max, curve);
      const discounted = abilityCost(v, abilities.scale.max, twoWay);
      expect(discounted).toBe(Math.max(d.min_cost, full - d.within_ceiling));
    }
    // 天賦之外：扣的是 above_ceiling，且是在乘上倍率之後才扣
    for (const tier of tiersOf().tiers) {
      const full = abilityCost(tier.from, tier.from, curve);
      expect(abilityCost(tier.from, tier.from, twoWay)).toBe(
        Math.max(d.min_cost, full - d.above_ceiling),
      );
    }
  });

  it('天賦折扣（練武奇才）每一級都少付，且在倍率之後才扣', () => {
    const base = tiersOf();
    const discounted = { curve: { ...base, discount: 2 }, twoWay: false };
    for (let v = abilities.scale.min; v <= abilities.scale.max; v++) {
      // 天賦之內
      const within = abilityCost(v, abilities.scale.max, curve);
      expect(abilityCost(v, abilities.scale.max, discounted)).toBe(
        Math.max(base.min_cost, within - 2),
      );
      // 天賦之外：先乘倍率再扣，所以折扣不會被倍率放大
      const above = abilityCost(v, v, curve);
      expect(abilityCost(v, v, discounted)).toBe(Math.max(base.min_cost, above - 2));
    }
  });

  it('天賦折扣不會把成本壓到 0 以下', () => {
    const base = tiersOf();
    const huge = { curve: { ...base, discount: 99 }, twoWay: true };
    for (let v = abilities.scale.min; v <= abilities.scale.max; v++) {
      expect(abilityCost(v, v, huge)).toBe(base.min_cost);
    }
  });

  it('50 以下沒有折扣——本來就是 1 點，扣不動', () => {
    for (let v = abilities.scale.min; v < 50; v++) {
      expect(abilityCost(v, 80, twoWay)).toBe(abilityCost(v, 80, curve));
    }
  });

  it('折扣不會把成本壓到 0 以下', () => {
    const d = abilities.growth_cost.two_way_discount;
    for (let v = abilities.scale.min; v <= abilities.scale.max; v++) {
      expect(abilityCost(v, v, twoWay)).toBeGreaterThanOrEqual(d.min_cost);
      expect(abilityCost(v, 80, twoWay)).toBeGreaterThanOrEqual(d.min_cost);
    }
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
    // 找一個成本大於 1 的值，逐點投入直到升級
    const start = 64;
    const cost = abilityCost(start, 80, curve);
    expect(cost).toBeGreaterThan(1);

    let carry = 0;
    for (let i = 0; i < cost - 1; i++) {
      const step = train(start, 1, 80, carry, curve);
      expect(step.gained).toBe(0);
      carry = step.carry;
    }
    const last = train(start, 1, 80, carry, curve);
    expect(last.gained).toBe(1);
    expect(last.value).toBe(start + 1);
    expect(last.carry).toBe(0);
  });

  it('一次投入足夠的點數可以連升多級', () => {
    const start = 64;
    const need = abilityCost(start, 80, curve) + abilityCost(start + 1, 80, curve);
    const r = train(start, need, 80, 0, curve);
    expect(r.value).toBe(start + 2);
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
    // 折扣只有 1 點，不是每個預算都看得出差別——因此驗證兩件事：
    // 同樣的預算下二刀流絕不吃虧，而且確實存在看得出差別的預算。
    let better = 0;
    for (let budget = 1; budget <= 40; budget++) {
      const normal = train(60, budget, 80, 0, curve);
      const both = train(60, budget, 80, 0, twoWay);
      expect(both.gained).toBeGreaterThanOrEqual(normal.gained);
      if (both.gained > normal.gained) better++;
    }
    expect(better).toBeGreaterThan(0);
  });

  it('拒絕負點數——衰退要走 decline()', () => {
    expect(() => train(50, -1, 80, 0, curve)).toThrow(RangeError);
  });
});

describe('carryGauge', () => {
  it('分母是升上去那一級的價錢', () => {
    const g = carryGauge(50, 80, 3, curve);
    expect(g.points).toBe(3);
    expect(g.need).toBe(abilityCost(50, 80, curve));
  });

  it('槽不會是負的——扣點走借位，見 untrain()', () => {
    expect(carryGauge(50, 80, -3, curve).points).toBe(0);
  });
});

describe('untrain', () => {
  /**
   * 找一個「退下去那一級要價大於 1 點」的能力值——蓄力槽只在那一段才有戲。
   * 退級退還的是 v-1 → v 那一級的價錢，所以要看的是 abilityCost(v - 1)。
   */
  const expensive = (() => {
    for (let v = abilities.scale.min + 1; v <= abilities.scale.max; v++) {
      if (abilityCost(v - 1, 80, curve) > 1) return v;
    }
    throw new Error('曲線上找不到成本大於 1 的能力值');
  })();

  it('低段扣幾點就掉幾級——一級 1 點時與舊行為一致', () => {
    expect(abilityCost(30, 80, curve)).toBe(1);
    const r = untrain(30, 5, 80, 0, curve);
    expect(r.value).toBe(25);
    expect(r.gained).toBe(-5);
    expect(r.carry).toBe(0);
  });

  it('不夠退一級就借位——能力掉一級，找零留在槽裡', () => {
    const cost = abilityCost(expensive - 1, 80, curve);
    const r = untrain(expensive, cost - 1, 80, 0, curve);
    // 66 0/6 被扣 3 點就是 65 3/6：退掉那一級拿回 6 點，扣掉 3 點，剩 3 點。
    expect(r.gained).toBe(-1);
    expect(r.value).toBe(expensive - 1);
    expect(r.carry).toBe(1);
  });

  it('剛好一級就是掉一級、槽歸零', () => {
    const cost = abilityCost(expensive - 1, 80, curve);
    const r = untrain(expensive, cost, 80, 0, curve);
    expect(r.gained).toBe(-1);
    expect(r.value).toBe(expensive - 1);
    expect(r.carry).toBe(0);
  });

  it('先扣蓄力槽裡的點，扣得動就不掉級', () => {
    const r = untrain(expensive, 2, 80, 3, curve);
    expect(r.gained).toBe(0);
    expect(r.carry).toBe(1);
  });

  /**
   * 這條是方案 A 的全部理由：加了再扣同樣的點數，要回到**完全相同**的狀態。
   * 舊做法加點走成本曲線、扣值走 1:1，於是能力越高，同一張事件卡的下檔就越
   * 比上檔重——這個往返測試在那個版本上必然失敗。
   */
  it('加點與扣點對稱：+n 之後 −n 回到原樣', () => {
    for (let v = abilities.scale.min + 5; v <= abilities.scale.max - 5; v++) {
      for (const points of [1, 2, 3, 4]) {
        const up = train(v, points, 80, 0, curve);
        const back = untrain(up.value, points, 80, up.carry, curve);
        expect(`${v}+${points}: ${back.value}/${back.carry}`).toBe(`${v}+${points}: ${v}/0`);
      }
    }
  });

  it('扣到量表底部就停住，欠的點算浪費', () => {
    const floor = abilities.scale.hard_floor;
    const r = untrain(floor + 1, 100, 80, 0, curve);
    expect(r.value).toBe(floor);
    expect(r.carry).toBe(0);
    expect(r.overflow).toBeGreaterThan(0);
  });

  it('扣到剩下的點數永遠是正的', () => {
    for (let v = abilities.scale.min + 1; v <= abilities.scale.max; v++) {
      for (const points of [1, 2, 3, 5, 8]) {
        expect(untrain(v, points, 80, 0, curve).carry).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('拒絕負點數——加點要走 train()', () => {
    expect(() => untrain(50, -1, 80, 0, curve)).toThrow(RangeError);
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

  it('高手高手高高手的骰面下限被墊高', () => {
    const genius = new Set(['genius']);
    for (let i = 0; i < 200; i++) {
      for (const v of roll(`s${i}`, genius).values) {
        expect(v).toBeGreaterThanOrEqual(abilities.training_dice.faces['genius']?.min ?? 0);
      }
    }
  });

  it('高手高手高高手優先於十里坡劍神——兩者同時擁有時用高手高手高高手的區間', () => {
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

  it('baseCount 換掉基礎骰數，天賦與奪冠加成照樣疊上去', () => {
    const cfg = abilities.training_dice;
    for (let i = 0; i < 50; i++) {
      const d = roll(`s${i}`, noTraits, { baseCount: 2, bonusDice: 1 });
      expect(d.values.length).toBe(3 + Math.max(0, cfg.bonus_count));
    }
  });

  it('baseCount 仍吃特性的骰面——職業期不會把墊高的下限弄丟', () => {
    const genius = abilities.training_dice.faces['genius'];
    const boosted = new Set(['genius']);
    for (let i = 0; i < 50; i++) {
      for (const v of roll(`s${i}`, boosted, { baseCount: 4 }).values) {
        expect(v).toBeGreaterThanOrEqual(genius?.min ?? 1);
      }
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

describe('championshipDice', () => {
  const cfg = abilities.training_dice.championship_bonus;

  it('沒奪冠就沒有加成', () => {
    expect(championshipDice([])).toBe(0);
  });

  it('階段越高，國際賽冠軍給的骰數越多', () => {
    expect(championshipDice(['HS'])).toBeGreaterThan(championshipDice(['JHS']));
    expect(championshipDice(['PRO'])).toBeGreaterThan(championshipDice(['HS']));
  });

  it('同季多項國際賽冠軍取最高的一項，不相加', () => {
    expect(championshipDice(['JHS', 'JHS', 'JHS'])).toBe(cfg['JHS']);
    expect(championshipDice(['JHS', 'HS'])).toBe(cfg['HS']);
  });

  it('不認得的種類不給加成', () => {
    expect(championshipDice(['nonsense'])).toBe(0);
  });

  it('加成確實讓骰數變多，骰面維持 1-6', () => {
    for (let i = 0; i < 100; i++) {
      const plain = rollTrainingDice(new World(`s${i}`), noTraits);
      const boosted = rollTrainingDice(new World(`s${i}`), noTraits, { bonusDice: 3 });
      expect(boosted.values.length).toBe(plain.values.length + 3);
      for (const v of boosted.values) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('蓄力槽的結算', () => {
  /**
   * 成本變便宜之後，存著的點數要花得出去。
   *
   * 蓄力槽只在加點的當下結算，但那一級的成本會被年齡衰退、天花板提升與二刀流
   * 三件事往下拉。舊版沒有在那三處重新結算，於是畫面顯示「2/2」卻不進位，
   * 看起來像壞掉。這裡釘住 train() 這一端：只要餵 0 點進去，滿了的槽就該升級。
   */
  it('餵 0 點也會把滿了的槽兌現', () => {
    const ctx = growthCurve(false);
    const ceiling = 70;
    const value = 54;
    const cost = abilityCost(value, ceiling, ctx);

    // 槽裡剛好放著這一級的成本——那正是「2/2 卻不進位」的狀態。
    const settled = train(value, 0, ceiling, cost, ctx);
    expect(settled.value).toBe(value + 1);
    expect(settled.carry).toBe(0);
  });

  it('槽沒滿就原封不動', () => {
    const ctx = growthCurve(false);
    const ceiling = 70;
    const value = 54;
    const cost = abilityCost(value, ceiling, ctx);
    if (cost <= 1) return; // 成本 1 的區間沒有「差一點」可言

    const settled = train(value, 0, ceiling, cost - 1, ctx);
    expect(settled.value).toBe(value);
    expect(settled.carry).toBe(cost - 1);
  });
});

describe('hardCap', () => {
  it('沒有事件加成時，硬上限就是量表上限', () => {
    expect(hardCap(0)).toBe(abilities.scale.max);
  });

  it('潛力之上仍練得動，只是變貴——牆是硬上限而不是潛力', () => {
    const ctx = growthCurve(false);
    const ceiling = 70;
    const cheap = abilityCost(ceiling - 1, ceiling, ctx);
    const dear = abilityCost(ceiling, ceiling, ctx);
    expect(dear).toBeGreaterThan(cheap);

    // 給足點數，能力應該一路長到硬上限，而不是停在潛力。
    let value = ceiling;
    let carry = 0;
    for (let i = 0; i < 200; i++) {
      const r = train(value, 10, ceiling, carry, ctx);
      value = r.value;
      carry = r.carry;
    }
    expect(value).toBe(hardCap(0));
  });
});

describe('守備奇才的蓄力折扣', () => {
  it('只打守備那四項，打擊與投球照原價', () => {
    const revert = applyTalents({ defense_focus: 3 });
    try {
      // 能力 72 那一段一級 8 點，×0.7 = 5.6 → 6。
      expect(abilityCost(72, 80, growthCurve(false, undefined, 'rng'))).toBe(6);
      expect(abilityCost(72, 80, growthCurve(false, undefined, 'pow'))).toBe(8);
      expect(abilityCost(72, 80, growthCurve(false, undefined, 'vel'))).toBe(8);
      // 沒指定是哪一項的時候不打折——那是在問「這條曲線本身長怎樣」。
      expect(abilityCost(72, 80, growthCurve(false))).toBe(8);
    } finally {
      revert();
    }
  });

  it('成本 1 點的那幾級不打折——本來就是底價，再乘只會變成 0', () => {
    const revert = applyTalents({ defense_focus: 3 });
    try {
      expect(abilityCost(40, 80, growthCurve(false, undefined, 'fld'))).toBe(1);
      // 二刀流把 2 點折成 1 之後，守備折扣也咬不動了。
      expect(abilityCost(50, 80, growthCurve(true, undefined, 'fld'))).toBe(1);
    } finally {
      revert();
    }
  });

  it('乘在成長相關的加減之後：先扣二刀流與全域折扣，最後才打折', () => {
    const revert = applyTalents({ defense_focus: 2, light_lift: 2 });
    try {
      const base = abilityCost(72, 80, growthCurve(true, undefined, 'pow'));
      // 8 點扣掉二刀流 1 點與練武奇才的折扣之後，再 ×0.8。
      expect(abilityCost(72, 80, growthCurve(true, undefined, 'arm'))).toBe(
        Math.max(1, Math.round(base * 0.8)),
      );
      expect(base).toBeGreaterThan(1);
    } finally {
      revert();
    }
  });
});
