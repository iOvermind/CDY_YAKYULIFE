import { describe, expect, it } from 'vitest';
import { amateur } from '../data/index.ts';
import { academyUnlocked, playCups, winsForRank, type CupContext } from './amateur.ts';
import { amateurRole } from './amateurStats.ts';
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

describe('單淘汰的名次、場次與勝敗', () => {
  const cups = amateur.cups;

  it('季軍是獨立名次，而且列入生涯成就', () => {
    expect(cups.ranks).toContain('季軍');
    expect(cups.honor_ranks.values).toContain('季軍');
  });

  /** 那一場輸贏不改變「你打進了四強」這件事。 */
  it('季軍與四強同分', () => {
    const third = cups.ranks.indexOf('季軍');
    const fourth = cups.ranks.indexOf('四強');
    expect(cups.points[third]).toBe(cups.points[fourth]);
  });

  /** 兩支打決賽、兩支打季軍戰——四支隊伍都打滿五場。 */
  it('進了四強的四個名次場次相同', () => {
    const semiFinalists = ['冠軍', '亞軍', '季軍', '四強'].map((r) => cups.ranks.indexOf(r));
    const games = semiFinalists.map((i) => cups.games_by_rank.values[i]);
    expect(new Set(games).size).toBe(1);
  });

  it('場次隨名次遞減，且預賽出局只打一場', () => {
    const values = cups.games_by_rank.values;
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeLessThanOrEqual(values[i - 1]!);
    }
    expect(values.at(-1)).toBe(1);
  });

  it('冠軍全勝', () => {
    const games = cups.games_by_rank.values[0]!;
    expect(winsForRank(0, games)).toBe(games);
  });

  /** 輸一場就回家——只有第四名例外，他準決賽輸掉、季軍戰又輸。 */
  it('除了冠軍與第四名，每支球隊都恰好輸一場', () => {
    cups.ranks.forEach((rank, i) => {
      const games = cups.games_by_rank.values[i]!;
      const losses = games - winsForRank(i, games);
      if (rank === '冠軍') expect(losses).toBe(0);
      else if (rank === '四強') expect(losses).toBe(2);
      else expect(losses).toBe(1);
    });
  });

  it('勝場永遠不會是負的', () => {
    for (let i = 0; i < cups.ranks.length; i++) {
      expect(winsForRank(i, cups.games_by_rank.values[i] ?? 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it('每個名次都有場次、敗場與能力點', () => {
    const n = cups.ranks.length;
    expect(cups.points).toHaveLength(n);
    expect(cups.games_by_rank.values).toHaveLength(n);
    expect(cups.losses_by_rank.values).toHaveLength(n);
  });

  it('各階段的門檻數比名次少一——最後一個名次是沒達到任何門檻', () => {
    for (const stage of ['JHS', 'HS'] as const) {
      expect(amateur.cups[stage].thresholds).toHaveLength(cups.ranks.length - 1);
    }
  });
});

describe('養成期的投手定位', () => {
  const par = (stage: 'JHS' | 'HS' | 'U' | 'AMA') => amateur.cups[stage].par;
  /** 球威（vel/ctl 那一組）拉滿的一個能力表，體力另外指定。 */
  const arm = (sta: number, stuff = 80) =>
    ({ sta, vel: stuff, ctl: stuff, swp: stuff, drp: stuff, chg: stuff, gim: stuff }) as never;

  it('體力達到該階段的 par 才走先發那條路', () => {
    expect(amateurRole('HS', arm(par('HS')))).toBe('SP');
    expect(amateurRole('HS', arm(par('HS') - 1))).not.toBe('SP');
  });

  /** 球賽變長、對手變強，同一個體力值在國中撐得完一場，在高中撐不完。 */
  it('階段越高，先發門檻越高——因為 par 越高', () => {
    expect(par('HS')).toBeGreaterThan(par('JHS'));
    const sta = (par('JHS') + par('HS')) / 2;
    expect(amateurRole('JHS', arm(sta))).toBe('SP');
    expect(amateurRole('HS', arm(sta))).not.toBe('SP');
  });

  /** 撐不住的人整組落到牛棚，牛棚內部再依球威由高到低排。 */
  it('體力不足時依球威落進 CP／SU／MR／LR', () => {
    const weak = par('HS') - 10;
    expect(amateurRole('HS', arm(weak, 80))).toBe('CP');
    expect(amateurRole('HS', arm(weak, 20))).toBe('LR');
  });
});
