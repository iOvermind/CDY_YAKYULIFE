import { describe, expect, it } from 'vitest';
import {
  abilities,
  ALL_ABILITIES,
  amateur,
  PITCH_FAMILIES,
  START_POSITIONS,
  type AbilityKey,
  type StartPosition,
} from '../data/index.ts';
import { createPlayer, START_AGE, START_YEAR } from './genesis.ts';
import { World } from './rng.ts';

const make = (seed: string, start: StartPosition = 'SS') =>
  createPlayer(new World(seed), '測試員', start, { throws: 'R', bats: 'R' });

/** 取一批球員，用於分佈檢查。 */
const sample = (n: number, start: StartPosition) =>
  Array.from({ length: n }, (_, i) => make(`seed-${i}`, start));

const { pitcher, fielder } = abilities.ability_groups;

describe('createPlayer', () => {
  it('同種子同起始守位產生完全相同的球員', () => {
    expect(make('seed-a')).toEqual(make('seed-a'));
  });

  it('不同種子產生不同球員', () => {
    expect(make('seed-a')).not.toEqual(make('seed-b'));
  });

  it('設定開局年齡與年份', () => {
    const p = make('seed-a');
    expect(p.age).toBe(START_AGE);
    expect(p.year).toBe(START_YEAR);
  });

  it.each(START_POSITIONS)('%s 一樣擁有全部能力——二刀流模型不做投打二分', (start) => {
    const p = make('seed-a', start);
    const expected = [...ALL_ABILITIES].sort();
    expect(Object.keys(p.ability).sort()).toEqual(expected);
    expect(Object.keys(p.potential).sort()).toEqual(expected);
  });

  it.each(START_POSITIONS)('%s 的能力值落在合理範圍', (start) => {
    const { base, bonus, pitch_bonus } = abilities.initial_ability;
    const positionBonus = bonus[start] ?? {};
    const pitchExtra = pitch_bonus.applies_to.includes(start) ? pitch_bonus.range.max : 0;

    for (const p of sample(200, start)) {
      for (const [key, value] of Object.entries(p.ability)) {
        const extra =
          (positionBonus[key]?.max ?? 0) +
          (PITCH_FAMILIES.includes(key as never) ? pitchExtra : 0);
        expect(value).toBeGreaterThanOrEqual(base.min);
        expect(value).toBeLessThanOrEqual(base.max + extra);
      }
    }
  });

  it.each(START_POSITIONS)('%s 的潛力不超過球探量表上限', (start) => {
    for (const p of sample(200, start)) {
      for (const value of Object.values(p.potential)) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThanOrEqual(abilities.scale.max);
      }
    }
  });

  it.each(START_POSITIONS)('%s 一定有一項頂尖工具', (start) => {
    const top = abilities.potential_ceiling.tiers[0];
    if (top === undefined) throw new Error('tiers 是空的');
    for (const p of sample(200, start)) {
      expect(Math.max(...Object.values(p.potential))).toBeGreaterThanOrEqual(top.min);
    }
  });

  it('潛力的階梯分佈符合設定——排序後每一名都落在對應區間', () => {
    const tiers = abilities.potential_ceiling.tiers;
    const last = tiers[tiers.length - 1];
    if (last === undefined) throw new Error('tiers 是空的');

    for (const p of sample(200, 'SS')) {
      const sorted = Object.values(p.potential).sort((a, b) => b - a);
      sorted.forEach((value, rank) => {
        const range = tiers[rank] ?? last;
        expect(value).toBeGreaterThanOrEqual(range.min);
        expect(value).toBeLessThanOrEqual(range.max);
      });
    }
  });
});

describe('起始守位的天賦加權', () => {
  /** 該組能力在潛力排名前三（即拿到高階區間）的平均個數。 */
  const topTalentCount = (start: StartPosition, group: readonly AbilityKey[]) => {
    const players = sample(400, start);
    let total = 0;
    for (const p of players) {
      const topThree = Object.entries(p.potential)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([key]) => key);
      total += topThree.filter((key) => group.includes(key)).length;
    }
    return total / players.length;
  };

  it('選投手的人，高階天賦明顯偏向投球能力', () => {
    expect(topTalentCount('P', pitcher)).toBeGreaterThan(topTalentCount('SS', pitcher));
  });

  it('選野手的人，高階天賦明顯偏向打擊與守備', () => {
    const fielderTalent = topTalentCount('SS', fielder);
    const pitcherTalent = topTalentCount('P', fielder);
    expect(fielderTalent).toBeGreaterThan(pitcherTalent);
  });

  it('捕手的配球天賦高於其他守位', () => {
    expect(topTalentCount('C', ['cat'])).toBeGreaterThan(topTalentCount('SS', ['cat']));
  });

  it('游擊的守備範圍天賦高於一壘', () => {
    expect(topTalentCount('SS', ['rng'])).toBeGreaterThan(topTalentCount('1B', ['rng']));
  });

  it('守位不定的天賦分佈介於投手與野手之間——不偏袒任何一側', () => {
    const util = topTalentCount('UTIL', pitcher);
    expect(util).toBeLessThan(topTalentCount('P', pitcher));
    expect(util).toBeGreaterThan(topTalentCount('SS', pitcher));
  });

  it('加權不封死任何一條路——選投手的人仍可能拿到打擊天賦', () => {
    const anyHittingTalent = sample(400, 'P').some((p) => {
      const best = Object.entries(p.potential).sort((a, b) => b[1] - a[1])[0];
      return best !== undefined && fielder.includes(best[0]);
    });
    expect(anyHittingTalent).toBe(true);
  });

  /**
   * 投打兩側都有頂尖天賦的比例。
   *
   * 注意「只有一項能拿到 tier0，所以不可能兩側頂尖」是錯的：tier0 是 72-80、
   * tier1 是 64-74，兩者重疊，所以第二名的能力擲到 72 以上是可能的。
   * 二刀流的稀有性就來自這個重疊區的機率，不是靠額外設限。
   */
  const twoWayRate = (start: StartPosition) => {
    const top = abilities.potential_ceiling.tiers[0];
    if (top === undefined) throw new Error('tiers 是空的');
    const players = sample(500, start);
    const twoWay = players.filter((p) => {
      const elite = Object.entries(p.potential)
        .filter(([, v]) => v >= top.min)
        .map(([k]) => k);
      return elite.some((k) => pitcher.includes(k)) && elite.some((k) => fielder.includes(k));
    });
    return twoWay.length / players.length;
  };

  it('投打各有一項頂尖天賦是罕見但可能的——二刀流的稀有性來自這裡', () => {
    const rate = twoWayRate('UTIL');
    // 罕見到值得當成一個成就，但不到絕跡。這個區間是刻意的驗收線：
    // 掉出去代表 potential_ceiling 的階梯重疊被改動了，二刀流會變得氾濫或絕跡。
    expect(rate).toBeGreaterThan(0.01);
    expect(rate).toBeLessThan(0.15);
  });

  it('守位不定比專精者更容易成為二刀流——這是它的補償', () => {
    expect(twoWayRate('UTIL')).toBeGreaterThan(twoWayRate('P'));
    expect(twoWayRate('UTIL')).toBeGreaterThan(twoWayRate('SS'));
  });
});

describe('慣用手', () => {
  const withHands = (throws: 'R' | 'L', bats: 'R' | 'L' | 'S', seed = 'h') =>
    createPlayer(new World(seed), '測試員', 'UTIL', { throws, bats });

  it('慣用手由玩家選擇，不是擲出來的', () => {
    const p = withHands('L', 'S');
    expect(p.throws).toBe('L');
    expect(p.bats).toBe('S');
  });

  it('選慣用手不消耗任何抽取——它不是隨機的', () => {
    const a = new World('h');
    createPlayer(a, '測試員', 'UTIL', { throws: 'R', bats: 'R' });
    const b = new World('h');
    createPlayer(b, '測試員', 'UTIL', { throws: 'L', bats: 'S' });
    expect(a.drawCounts()).toEqual(b.drawCounts());
  });

  it('慣用手不改寫抽到的潛力——折扣是衍生的，不是寫死在出生資料裡', () => {
    const right = withHands('R', 'R');
    for (const bats of ['R', 'L', 'S'] as const)
      for (const throws of ['R', 'L'] as const) {
        const p = withHands(throws, bats);
        for (const k of ALL_ABILITIES) expect(p.potential[k]).toBe(right.potential[k]);
      }
  });
});

describe('出身學校', () => {
  it('開局分發的是國中，分級與名單一致', () => {
    const schools = amateur.junior_high.schools;
    const seen = new Set<string>();
    for (const p of sample(500, 'SS')) {
      expect(schools[p.school]).toBe(p.schoolTier);
      seen.add(p.school);
    }
    expect(seen).toEqual(new Set(Object.keys(schools)));
  });
});

describe('子序列歸屬', () => {
  it('只消耗 genesis 流，不動其他流', () => {
    const world = new World('seed-a');
    createPlayer(world, '測試員', 'SS', { throws: 'R', bats: 'R' });
    const counts = world.drawCounts();
    expect(counts.genesis).toBeGreaterThan(0);
    expect(counts.growth).toBe(0);
    expect(counts.events).toBe(0);
    expect(counts.health).toBe(0);
    expect(counts.season).toBe(0);
    expect(counts.career).toBe(0);
  });
});
