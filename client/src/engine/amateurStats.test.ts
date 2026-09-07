import { describe, expect, it } from 'vitest';
import { ALL_ABILITIES, amateur } from '../data/index.ts';
import {
  addBatting,
  addPitching,
  battingLine,
  fmtInnings,
  innings,
  pitchingLine,
  playAmateurStats,
  type PitchingLine,
} from './amateurStats.ts';
import { World } from './rng.ts';

const flat = (v: number): Record<string, number> =>
  Object.fromEntries(ALL_ABILITIES.map((k) => [k, v]));

const with_ = (v: number, over: Record<string, number>): Record<string, number> => ({
  ...flat(v),
  ...over,
});

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
    expect(pit('a', 45, 18).outs).toBeGreaterThan(pit('a', 45, 6).outs);
  });

  /**
   * **先發不是場場先發。** 連續兩天的賽程沒有人扛得下球隊的每一場；而一場先發
   * 最多投六局——學生賽事有投球局數限制與隔日再戰的現實，職業那種完投不適用。
   * 這兩條沒有的話，一個高中生會在一週內先發五場、每場六局多。
   */
  describe('先發的場數與局數', () => {
    const dec = amateur.amateur_stats.pitching.decision;
    const ace = { ...flat(70), sta: 70 };

    it('先發場數只佔球隊場次的一部分', () => {
      const line = pitchingLine(new World('a'), 'HS', ace, 5);
      expect(line.starts).toBe(Math.ceil(5 * dec.starts_per_game.value));
      expect(line.starts).toBeLessThan(5);
      // 出賽場數等於先發場數：沒先發的那幾場他不在場上。
      expect(line.games).toBe(line.starts);
    });

    it('一場先發最多投設定的局數', () => {
      for (const games of [1, 3, 5]) {
        const line = pitchingLine(new World('a'), 'HS', ace, games);
        const perStart = line.outs / 3 / line.starts;
        expect(perStart).toBeLessThanOrEqual(dec.max_innings_per_start.value + 0.01);
      }
    });

    it('至少先發一場——排得進輪值的人不會整個賽會沒上場', () => {
      expect(pitchingLine(new World('a'), 'HS', ace, 1).starts).toBe(1);
    });
  });

  /** 牛棚各拿各的：終結者換救援成功，布局與中繼換中繼成功，長中繼兩樣都沒有。 */
  describe('牛棚的救援與中繼', () => {
    /** 體力不足以先發，球威決定他落在牛棚的哪一階。 */
    const relief = (stuff: number) => ({ ...flat(stuff), sta: 20 });
    const line = (stuff: number) => pitchingLine(new World('a'), 'HS', relief(stuff), 5, 4);

    it('終結者拿救援，不拿中繼', () => {
      const cp = line(80);
      expect(cp.starts).toBe(0);
      expect(cp.saves).toBeGreaterThan(0);
      expect(cp.holds).toBe(0);
    });

    it('球威不足的落到長中繼，救援與中繼都沒有', () => {
      const lr = line(15);
      expect(lr.saves).toBe(0);
      expect(lr.holds).toBe(0);
    });

    it('後援不拿勝敗——勝敗跟著先發場數走', () => {
      expect(line(80).wins).toBe(0);
      expect(line(80).losses).toBe(0);
    });
  });
});

describe('playAmateurStats', () => {
  const play = (ability = flat(45)) => playAmateurStats(new World('a'), 'HS', ability, 9);

  it('投打一律都記——國高中的球隊人數有限，投手排進打線是常態', () => {
    const line = play();
    expect(line.pitching).not.toBeNull();
    expect(line.batting).not.toBeNull();
  });

  it('偏向投手的球員仍然留下打擊成績', () => {
    const line = play(with_(45, { vel: 70, ctl: 70, con: 25, pow: 25 }));
    expect(line.batting).not.toBeNull();
    expect(line.pitching).not.toBeNull();
  });

  it('偏向野手的球員仍然留下投球成績', () => {
    const line = play(with_(45, { con: 70, pow: 70, vel: 25, ctl: 25 }));
    expect(line.pitching).not.toBeNull();
    expect(line.batting).not.toBeNull();
  });

  it('能力弱的那一側自然反映成難看的數據——那本身就是資訊', () => {
    const weak = play(with_(45, { con: 70, pow: 70, vel: 20, ctl: 20 })).pitching;
    const strong = play(with_(45, { vel: 70, ctl: 70 })).pitching;
    expect(weak?.era ?? 0).toBeGreaterThan(strong?.era ?? 0);
  });

  it('沒有出賽就沒有成績', () => {
    const line = playAmateurStats(new World('a'), 'HS', flat(45), 0);
    expect(line.batting).toBeNull();
    expect(line.pitching).toBeNull();
  });

  it('只消耗 season 流', () => {
    const world = new World('a');
    playAmateurStats(world, 'HS', flat(45), 9);
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
    // 分母是**局數**，不是出局數——出局數要除以三才是局數。
    expect(sum?.era).toBeCloseTo(((a.er + b.er) * 9) / ((a.outs + b.outs) / 3), 3);
  });

  it('出局數是整數，累加不會產生小數誤差', () => {
    const a = pitchingLine(new World('a'), 'HS', flat(60), 9);
    const b = pitchingLine(new World('b'), 'HS', flat(20), 9);
    expect(Number.isInteger(a.outs)).toBe(true);
    expect(addPitching(a, b)?.outs).toBe(a.outs + b.outs);
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

describe('局數的棒球寫法', () => {
  it('小數點後是出局數，不是十進位小數', () => {
    expect(fmtInnings(0)).toBe('0.0');
    expect(fmtInnings(1)).toBe('0.1');
    expect(fmtInnings(2)).toBe('0.2');
    expect(fmtInnings(3)).toBe('1.0');
    expect(fmtInnings(88)).toBe('29.1');
    expect(fmtInnings(89)).toBe('29.2');
    expect(fmtInnings(90)).toBe('30.0');
  });

  /** 這正是換掉小數模型的理由：29.5 局在棒球裡不存在。 */
  it('永遠不會產生 .3 到 .9 的局數', () => {
    for (let outs = 0; outs < 500; outs++) {
      const decimal = Number(fmtInnings(outs).split('.')[1]);
      expect(decimal).toBeLessThanOrEqual(2);
    }
  });

  it('真實局數是出局數除以三，與顯示的寫法不同', () => {
    const line = { outs: 88 } as PitchingLine;
    expect(innings(line)).toBeCloseTo(88 / 3, 10);
    expect(fmtInnings(line.outs)).toBe('29.1');
  });

  it('負數不會產生怪字串', () => {
    expect(fmtInnings(-5)).toBe('0.0');
  });
});
