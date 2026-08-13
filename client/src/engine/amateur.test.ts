import { describe, expect, it } from 'vitest';
import { amateur } from '../data/index.ts';
import { academyUnlocked, playCups, type CupContext } from './amateur.ts';
import { World } from './rng.ts';

const flat = (value: number): Record<string, number> =>
  Object.fromEntries(
    ['sta', 'vel', 'ctl', 'swp', 'drp', 'chg', 'gim', 'con', 'pow', 'spd', 'eye', 'rng', 'fld', 'arm', 'cat'].map(
      (k) => [k, value],
    ),
  );

const ctx = (over: Partial<CupContext> = {}): CupContext => ({
  stage: 'HS',
  ability: flat(45),
  position: 'SS',
  traits: new Set(),
  ...over,
});

const play = (seed: string, over: Partial<CupContext> = {}) =>
  playCups(new World(seed), ctx(over));

describe('playCups', () => {
  it('相同種子與相同能力產生相同結果', () => {
    expect(play('a')).toEqual(play('a'));
  });

  it('打完該階段的每一場大賽', () => {
    const season = play('a');
    expect(season.results.map((r) => r.cup)).toEqual(amateur.cups.HS.names);
  });

  it('大學階段打的是大學的大賽', () => {
    expect(play('a', { stage: 'U' }).results.map((r) => r.cup)).toEqual(amateur.cups.U.names);
  });

  it('點數總和是各場之和，加上整季一次的綜合能力加成', () => {
    // 加成整季只加一次。原本是每場都加，賽事從 3 場擴到 4 場、再加上最多 3 項
    // 國際賽之後，一年就能拿到 50 點以上——能力點多到花不完，配點失去取捨。
    const season = play('a');
    const sum = season.results.reduce((n, r) => n + r.points, 0);
    expect(season.points).toBeGreaterThanOrEqual(sum);
    expect(season.points - sum).toBeLessThanOrEqual(
      Math.floor(80 / amateur.cups.points_bonus.overall_divisor),
    );
  });

  it('只有名次夠好才計入成就', () => {
    const allowed = new Set(amateur.cups.honor_ranks.values);
    for (let i = 0; i < 200; i++) {
      const season = play(`s${i}`);
      for (const h of season.honors) expect(allowed).toContain(h.rank);
      // 沒有達標的名次一律不留紀錄
      const worthy = season.results.filter((r) => allowed.has(r.rank)).length;
      expect(season.honors).toHaveLength(worthy);
    }
  });

  it('名次索引都在有效範圍內', () => {
    for (let i = 0; i < 200; i++) {
      for (const r of play(`s${i}`).results) {
        expect(r.rankIndex).toBeGreaterThanOrEqual(0);
        expect(r.rankIndex).toBeLessThan(amateur.cups.ranks.length);
        expect(r.rank).toBe(amateur.cups.ranks[r.rankIndex]);
      }
    }
  });

  it('能力越強名次越好', () => {
    const avgRank = (value: number) => {
      let total = 0;
      const n = 200;
      for (let i = 0; i < n; i++) {
        for (const r of play(`s${i}`, { ability: flat(value) }).results) total += r.rankIndex;
      }
      return total / n;
    };
    // rankIndex 越小越好
    expect(avgRank(60)).toBeLessThan(avgRank(40));
  });

  it('同一季的不同大賽可以打出不同名次——短期賽制的張力', () => {
    let varied = false;
    for (let i = 0; i < 100 && !varied; i++) {
      const ranks = play(`s${i}`).results.map((r) => r.rankIndex);
      if (new Set(ranks).size > 1) varied = true;
    }
    expect(varied).toBe(true);
  });

  it('名門高中的成績優於弱旅', () => {
    const avgRank = (tier: number) => {
      let total = 0;
      const n = 200;
      for (let i = 0; i < n; i++) {
        for (const r of play(`s${i}`, { schoolTier: tier }).results) total += r.rankIndex;
      }
      return total / n;
    };
    expect(avgRank(1)).toBeLessThan(avgRank(3));
  });

  it('冠軍會被記進 championships', () => {
    // 用極高能力確保拿到冠軍
    const season = play('a', { ability: flat(80) });
    expect(season.results.every((r) => r.rankIndex === 0)).toBe(true);
    expect(season.championships).toEqual(amateur.cups.HS.names);
  });

  it('能力極低時拿不到冠軍', () => {
    const season = play('a', { ability: flat(20) });
    expect(season.championships).toEqual([]);
  });

  it('只消耗 season 流，不動其他流', () => {
    const world = new World('a');
    playCups(world, ctx());
    const counts = world.drawCounts();
    expect(counts.season).toBeGreaterThan(0);
    expect(counts.genesis).toBe(0);
    expect(counts.growth).toBe(0);
    expect(counts.events).toBe(0);
    expect(counts.health).toBe(0);
    expect(counts.career).toBe(0);
  });

  it('每場大賽各擲一次波動——抽取次數等於大賽數', () => {
    const world = new World('a');
    playCups(world, ctx());
    expect(world.drawCounts().season).toBe(amateur.cups.HS.names.length);
  });
});

describe('academyUnlocked', () => {
  it('大學拿下冠軍即解鎖', () => {
    const season = playCups(new World('a'), ctx({ stage: 'U', ability: flat(80) }));
    expect(academyUnlocked('U', season)).toBe(true);
  });

  it('高中拿冠軍不解鎖——這個特性專屬於大學階段', () => {
    const season = playCups(new World('a'), ctx({ ability: flat(80) }));
    expect(academyUnlocked('HS', season)).toBe(false);
  });

  it('大學沒拿冠軍不解鎖', () => {
    const season = playCups(new World('a'), ctx({ stage: 'U', ability: flat(20) }));
    expect(academyUnlocked('U', season)).toBe(false);
  });
});
