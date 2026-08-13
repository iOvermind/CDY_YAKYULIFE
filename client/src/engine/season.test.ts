import { describe, expect, it } from 'vitest';
import { leagues, season as cfg } from '../data/index.ts';
import {
  gamesPlayed,
  intentionalWalks,
  levelOf,
  pitcherRole,
  plateAppearances,
  playSeason,
  proBattingLine,
  proPitchingLine,
  trustFactor,
} from './season.ts';
import type { Abilities } from './rating.ts';
import { World } from './rng.ts';

const KEYS = ['sta','vel','ctl','swp','drp','chg','gim','con','pow','spd','eye','rng','fld','arm','cat'];
const flat = (v: number): Abilities =>
  Object.fromEntries(KEYS.map((k) => [k, v])) as unknown as Abilities;
const with_ = (v: number, over: Record<string, number>): Abilities =>
  ({ ...flat(v), ...over }) as unknown as Abilities;

const CPBL1 = leagues.levels['CPBL1']!;

describe('levelOf', () => {
  it('取得層級設定', () => {
    expect(levelOf('CPBL1').name).toBe('中職一軍');
  });

  it('未知層級直接炸開——默默用預設值只會產生一段看似合理的假資料', () => {
    expect(() => levelOf('NOPE')).toThrow();
  });
});

describe('gamesPlayed', () => {
  const play = (seed: string, ability: Abilities, pos = 'SS', ovr = CPBL1.par) =>
    gamesPlayed(new World(seed), ability, pos, 'CPBL1', ovr);

  it('永遠不超過聯盟球季場次', () => {
    for (let i = 0; i < 200; i++) {
      expect(play(`s${i}`, flat(80), 'DH', 80)).toBeLessThanOrEqual(CPBL1.games);
    }
  });

  it('體力越高出賽越多', () => {
    const avg = (sta: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += play(`s${i}`, with_(45, { sta }));
      return t / 100;
    };
    expect(avg(70)).toBeGreaterThan(avg(30));
  });

  it('捕手的出賽場次明顯少於指定打擊——斷層級的守位勞損', () => {
    const avg = (pos: string) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += play(`s${i}`, flat(60), pos, 60);
      return t / 100;
    };
    const c = avg('C');
    const dh = avg('DH');
    expect(c).toBeLessThan(dh);
    // 捕手係數是 0.80，其餘守位都在 0.95 以上——差距必須看得出來
    expect(c / dh).toBeLessThan(0.9);
  });

  it('移防到負擔輕的守位可以延長單季出賽', () => {
    const avg = (pos: string) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += play(`s${i}`, with_(45, { sta: 40 }), pos);
      return t / 100;
    };
    expect(avg('1B')).toBeGreaterThan(avg('SS'));
  });

  it('打不好的人被下放替補，出賽變少', () => {
    const avg = (ovr: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += play(`s${i}`, flat(45), 'SS', ovr);
      return t / 100;
    };
    expect(avg(CPBL1.par - 8)).toBeLessThan(avg(CPBL1.par + 8));
  });

  it('相同種子產生相同結果', () => {
    expect(play('a', flat(50))).toBe(play('a', flat(50)));
  });
});

describe('trustFactor', () => {
  it('與聯盟同水準時就是 base', () => {
    expect(trustFactor(50, 50)).toBeCloseTo(cfg.playing_time.trust_factor.base);
  });

  it('不會超出上下限', () => {
    expect(trustFactor(200, 50)).toBe(cfg.playing_time.trust_factor.max);
    expect(trustFactor(0, 50)).toBe(cfg.playing_time.trust_factor.min);
  });
});

describe('plateAppearances', () => {
  it('打席數大致落在場次的 4 倍上下', () => {
    for (let i = 0; i < 100; i++) {
      const pa = plateAppearances(new World(`s${i}`), 120, CPBL1.par, CPBL1.par);
      expect(pa).toBeGreaterThan(120 * 3.5);
      expect(pa).toBeLessThan(120 * 5);
    }
  });

  it('絕對噪音隨場次縮放——少場次者的數據不會崩壞', () => {
    // 只打 10 場的人，打席不該出現負值或誇張的數字
    for (let i = 0; i < 200; i++) {
      const pa = plateAppearances(new World(`s${i}`), 10, CPBL1.par, CPBL1.par);
      expect(pa).toBeGreaterThanOrEqual(0);
      expect(pa).toBeLessThan(60);
    }
  });

  it('沒有出賽就沒有打席', () => {
    expect(plateAppearances(new World('a'), 0, CPBL1.par, CPBL1.par)).toBe(0);
  });
});

describe('intentionalWalks', () => {
  it('一般球員不會被敬遠', () => {
    expect(intentionalWalks(new World('a'), flat(50), 600)).toBe(0);
  });

  it('極端重砲才會被敬遠', () => {
    expect(intentionalWalks(new World('a'), with_(50, { pow: 80, con: 80, eye: 80 }), 600)).toBeGreaterThan(0);
  });

  it('速度是扣分項——沒有教練會敬遠快腿', () => {
    const slow = intentionalWalks(new World('a'), with_(50, { pow: 80, con: 80, eye: 80, spd: 20 }), 600);
    const fast = intentionalWalks(new World('a'), with_(50, { pow: 80, con: 80, eye: 80, spd: 80 }), 600);
    expect(fast).toBeLessThan(slow);
  });
});

describe('proBattingLine', () => {
  const bat = (seed: string, ability: Abilities, ovr: number) =>
    proBattingLine(new World(seed), ability, 'SS', 'CPBL1', ovr);

  it('打數等於打席扣掉保送', () => {
    for (let i = 0; i < 100; i++) {
      const b = bat(`s${i}`, flat(50), 50);
      expect(b.ab).toBe(b.pa - b.bb - b.ibb);
    }
  });

  it('安打不會多於打數，全壘打不會多於安打', () => {
    for (let i = 0; i < 200; i++) {
      const b = bat(`s${i}`, flat(60), 60);
      expect(b.hits).toBeLessThanOrEqual(b.ab);
      expect(b.hr).toBeLessThanOrEqual(b.hits);
      expect(b.double + b.triple + b.hr).toBeLessThanOrEqual(b.hits);
    }
  });

  it('長打率不低於打擊率——每支安打至少值一個壘包', () => {
    for (let i = 0; i < 200; i++) {
      const b = bat(`s${i}`, flat(55), 55);
      expect(b.slg).toBeGreaterThanOrEqual(b.avg - 1e-9);
    }
  });

  it('打擊率落在職業該有的範圍——職業一季上百場，樣本數足以收斂', () => {
    for (let i = 0; i < 300; i++) {
      const b = bat(`s${i}`, flat(50), 50);
      if (b.ab < 100) continue;
      expect(b.avg).toBeGreaterThan(0.15);
      expect(b.avg).toBeLessThan(0.42);
    }
  });

  it('接觸能力越好打擊率越高', () => {
    const avg = (con: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += bat(`s${i}`, with_(50, { con }), 50).avg;
      return t / 100;
    };
    expect(avg(70)).toBeGreaterThan(avg(35));
  });

  it('力量越好全壘打越多', () => {
    const hr = (pow: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += bat(`s${i}`, with_(50, { pow }), 50).hr;
      return t / 100;
    };
    expect(hr(75)).toBeGreaterThan(hr(30));
  });

  it('盜壘刺不會多於嘗試次數', () => {
    for (let i = 0; i < 100; i++) {
      const b = bat(`s${i}`, with_(50, { spd: 75 }), 50);
      expect(b.cs).toBeGreaterThanOrEqual(0);
      expect(b.sb).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('pitcherRole', () => {
  it('體力與控球都夠的人排進輪值', () => {
    expect(pitcherRole(with_(CPBL1.par, { sta: 60, ctl: 60 }), 'CPBL1')).toBe('SP');
  });

  it('體力不足的人進牛棚', () => {
    expect(pitcherRole(with_(CPBL1.par, { sta: 25, ctl: 60 }), 'CPBL1')).toBe('RP');
  });

  it('控球太差的人進牛棚', () => {
    expect(pitcherRole(with_(CPBL1.par, { sta: 60, ctl: 25 }), 'CPBL1')).toBe('RP');
  });
});

describe('proPitchingLine', () => {
  const pitch = (seed: string, ability: Abilities, ovr: number) =>
    proPitchingLine(new World(seed), ability, 'CPBL1', ovr);

  it('先發場次不超過輪值容量', () => {
    const max = CPBL1.games / cfg.pitching.starter.rotation_divisor.value;
    for (let i = 0; i < 200; i++) {
      const p = pitch(`s${i}`, with_(65, { sta: 70, ctl: 70 }), 65);
      expect(p.starts).toBeLessThanOrEqual(Math.ceil(max));
    }
  });

  it('後援投手沒有先發場次，先發投手沒有救援成功', () => {
    for (let i = 0; i < 100; i++) {
      const rp = pitch(`s${i}`, with_(45, { sta: 25 }), 45);
      expect(rp.role).toBe('RP');
      expect(rp.starts).toBe(0);
      const sp = pitch(`s${i}`, with_(55, { sta: 65, ctl: 65 }), 55);
      expect(sp.role).toBe('SP');
      expect(sp.saves).toBe(0);
    }
  });

  it('勝敗場合計不超過先發場次', () => {
    for (let i = 0; i < 100; i++) {
      const p = pitch(`s${i}`, with_(55, { sta: 65, ctl: 65 }), 55);
      expect(p.wins + p.losses).toBeLessThanOrEqual(p.starts);
      expect(p.losses).toBeGreaterThanOrEqual(0);
    }
  });

  it('防禦率落在設定的上下限之內', () => {
    for (let i = 0; i < 300; i++) {
      const p = pitch(`s${i}`, flat(20 + (i % 60)), 20 + (i % 60));
      expect(p.era).toBeGreaterThanOrEqual(cfg.pitching.era.min);
      expect(p.era).toBeLessThanOrEqual(cfg.pitching.era.max);
    }
  });

  it('能力越好防禦率越低', () => {
    const era = (v: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += pitch(`s${i}`, with_(v, { sta: 65, ctl: v }), v).era;
      return t / 100;
    };
    expect(era(65)).toBeLessThan(era(35));
  });

  it('球威越強三振越多', () => {
    const so = (vel: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += pitch(`s${i}`, with_(55, { sta: 65, ctl: 65, vel }), 55).so;
      return t / 100;
    };
    expect(so(75)).toBeGreaterThan(so(35));
  });

  it('控球越好保送越少', () => {
    const bb = (ctl: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += pitch(`s${i}`, with_(55, { sta: 65, ctl }), 55).bb;
      return t / 100;
    };
    expect(bb(72)).toBeLessThan(bb(42));
  });
});

describe('playSeason', () => {
  const ctx = (over = {}) => ({
    level: 'CPBL1',
    ability: flat(50),
    position: 'SS',
    overall: 50,
    better: 'fielder' as const,
    twoWay: false,
    ...over,
  });

  it('野手只有打擊成績', () => {
    const line = playSeason(new World('a'), ctx());
    expect(line.batting).not.toBeNull();
    expect(line.pitching).toBeNull();
  });

  it('投手只有投球成績', () => {
    const line = playSeason(new World('a'), ctx({ better: 'pitcher' }));
    expect(line.pitching).not.toBeNull();
    expect(line.batting).toBeNull();
  });

  it('二刀流兩邊都有——那正是二刀流在數據上的樣子', () => {
    const line = playSeason(new World('a'), ctx({ twoWay: true }));
    expect(line.pitching).not.toBeNull();
    expect(line.batting).not.toBeNull();
  });

  it('只消耗 season 流，不動其他流', () => {
    const world = new World('a');
    playSeason(world, ctx({ twoWay: true }));
    const counts = world.drawCounts();
    expect(counts.season).toBeGreaterThan(0);
    expect(counts.genesis).toBe(0);
    expect(counts.growth).toBe(0);
    expect(counts.events).toBe(0);
    expect(counts.career).toBe(0);
  });

  it('相同種子產生完全相同的一季', () => {
    expect(playSeason(new World('a'), ctx({ twoWay: true }))).toEqual(
      playSeason(new World('a'), ctx({ twoWay: true })),
    );
  });

  it('二軍的門檻較低——同樣的能力在二軍打得比較好', () => {
    const avg = (level: string) => {
      let t = 0;
      for (let i = 0; i < 100; i++) {
        t += playSeason(new World(`s${i}`), ctx({ level })).batting?.avg ?? 0;
      }
      return t / 100;
    };
    expect(avg('CPBL2')).toBeGreaterThan(avg('CPBL1'));
  });
});
