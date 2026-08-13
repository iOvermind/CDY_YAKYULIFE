import { describe, expect, it } from 'vitest';
import { ALL_ABILITIES, amateur } from '../data/index.ts';
import { addBatting, addPitching, battingLine, pitchingLine, playAmateurStats } from './amateurStats.ts';
import { World } from './rng.ts';

const flat = (v: number): Record<string, number> =>
  Object.fromEntries(ALL_ABILITIES.map((k) => [k, v]));

const par = amateur.cups.HS.par;

describe('battingLine', () => {
  const bat = (seed: string, value: number, games = 9) =>
    battingLine(new World(seed), 'HS', flat(value), games);

  it('相同種子與相同能力產生相同成績', () => {
    expect(bat('a', 45)).toEqual(bat('a', 45));
  });

  it('數據彼此自洽', () => {
    for (let i = 0; i < 200; i++) {
      const b = bat(`s${i}`, 30 + (i % 40));
      expect(b.ab + b.bb).toBe(b.pa);
      expect(b.hits).toBeLessThanOrEqual(b.ab);
      expect(b.hr).toBeLessThanOrEqual(b.hits);
      expect(b.avg).toBeCloseTo(b.ab === 0 ? 0 : b.hits / b.ab, 5);
    }
  });

  it('擊球能力越好打擊率越高', () => {
    const avg = (v: number) => {
      let total = 0;
      for (let i = 0; i < 100; i++) total += bat(`s${i}`, v).avg;
      return total / 100;
    };
    expect(avg(60)).toBeGreaterThan(avg(30));
  });

  it('與對手同水準時打擊率接近設定的基準', () => {
    let total = 0;
    for (let i = 0; i < 200; i++) total += bat(`s${i}`, par).avg;
    const mean = total / 200;
    const base = amateur.amateur_stats.batting.hit_rate.base;
    expect(Math.abs(mean - base)).toBeLessThan(0.05);
  });

  it('場次越多累積數越大', () => {
    expect(bat('a', 45, 18).ab).toBeGreaterThan(bat('a', 45, 6).ab);
  });

  it('打擊率不會超出設定的上下限', () => {
    for (const v of [1, 20, 50, 80]) {
      for (let i = 0; i < 50; i++) {
        const b = bat(`s${i}`, v);
        expect(b.avg).toBeGreaterThanOrEqual(0);
        expect(b.avg).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('pitchingLine', () => {
  const pit = (seed: string, value: number, games = 9) =>
    pitchingLine(new World(seed), 'HS', flat(value), games);

  it('相同種子與相同能力產生相同成績', () => {
    expect(pit('a', 45)).toEqual(pit('a', 45));
  });

  it('能力越好防禦率越低', () => {
    const era = (v: number) => {
      let total = 0;
      for (let i = 0; i < 100; i++) total += pit(`s${i}`, v).era;
      return total / 100;
    };
    expect(era(60)).toBeLessThan(era(30));
  });

  it('球速越快三振越多', () => {
    const so = (v: number) => {
      const ability = { ...flat(par), vel: v };
      let total = 0;
      for (let i = 0; i < 100; i++) total += pitchingLine(new World(`s${i}`), 'HS', ability, 9).so;
      return total / 100;
    };
    expect(so(70)).toBeGreaterThan(so(30));
  });

  it('控球越好保送越少', () => {
    const bb = (v: number) => {
      const ability = { ...flat(par), ctl: v };
      let total = 0;
      for (let i = 0; i < 100; i++) total += pitchingLine(new World(`s${i}`), 'HS', ability, 9).bb;
      return total / 100;
    };
    expect(bb(70)).toBeLessThan(bb(30));
  });

  it('防禦率不會低於設定的下限', () => {
    for (let i = 0; i < 100; i++) {
      expect(pit(`s${i}`, 80).era).toBeGreaterThanOrEqual(amateur.amateur_stats.pitching.era.min);
    }
  });

  it('局數與場次成正比', () => {
    expect(pit('a', 45, 18).ip).toBeGreaterThan(pit('a', 45, 6).ip);
  });
});

describe('playAmateurStats', () => {
  const play = (better: 'pitcher' | 'fielder', twoWay: boolean) =>
    playAmateurStats(new World('a'), 'HS', flat(45), 9, { better, twoWay });

  it('投手側較強者只產生投球成績', () => {
    const line = play('pitcher', false);
    expect(line.pitching).not.toBeNull();
    expect(line.batting).toBeNull();
  });

  it('野手側較強者只產生打擊成績', () => {
    const line = play('fielder', false);
    expect(line.batting).not.toBeNull();
    expect(line.pitching).toBeNull();
  });

  it('二刀流投打都算——那正是二刀流在數據上的樣子', () => {
    const line = play('fielder', true);
    expect(line.batting).not.toBeNull();
    expect(line.pitching).not.toBeNull();
  });

  it('沒有出賽就沒有成績', () => {
    const line = playAmateurStats(new World('a'), 'HS', flat(45), 0, {
      better: 'fielder',
      twoWay: true,
    });
    expect(line.batting).toBeNull();
    expect(line.pitching).toBeNull();
  });

  it('只消耗 season 流', () => {
    const world = new World('a');
    playAmateurStats(world, 'HS', flat(45), 9, { better: 'fielder', twoWay: true });
    const counts = world.drawCounts();
    expect(counts.season).toBeGreaterThan(0);
    expect(counts.growth).toBe(0);
    expect(counts.events).toBe(0);
    expect(counts.career).toBe(0);
  });
});

describe('累加', () => {
  it('打擊累加後打擊率重新計算，不是兩個率相加', () => {
    const a = battingLine(new World('a'), 'HS', flat(60), 9);
    const b = battingLine(new World('b'), 'HS', flat(20), 9);
    const sum = addBatting(a, b);
    expect(sum?.ab).toBe(a.ab + b.ab);
    expect(sum?.hits).toBe(a.hits + b.hits);
    expect(sum?.avg).toBeCloseTo((a.hits + b.hits) / (a.ab + b.ab), 5);
  });

  it('投球累加後防禦率重新計算', () => {
    const a = pitchingLine(new World('a'), 'HS', flat(60), 9);
    const b = pitchingLine(new World('b'), 'HS', flat(20), 9);
    const sum = addPitching(a, b);
    expect(sum?.er).toBe(a.er + b.er);
    expect(sum?.era).toBeCloseTo(((a.er + b.er) * 9) / (a.ip + b.ip), 3);
  });

  it('與 null 相加等於原值', () => {
    const a = battingLine(new World('a'), 'HS', flat(45), 9);
    expect(addBatting(a, null)).toEqual(a);
    expect(addBatting(null, a)).toEqual(a);
    expect(addBatting(null, null)).toBeNull();
  });
});

describe('階段差異', () => {
  it('同樣的能力在較高階段的成績較差——對手更強', () => {
    const avg = (stage: 'JHS' | 'HS') => {
      let total = 0;
      for (let i = 0; i < 100; i++) {
        total += battingLine(new World(`s${i}`), stage, flat(40), 9).avg;
      }
      return total / 100;
    };
    expect(avg('JHS')).toBeGreaterThan(avg('HS'));
  });
});
