import { describe, expect, it } from 'vitest';
import { abilities, leagues, season as cfg } from '../data/index.ts';
import {
  applyAging,
  asksRetirement,
  evaluateMovement,
  pathOf,
  proDiceCount,
  shouldRetire,
} from './pro.ts';
import type { Abilities } from './rating.ts';
import { World } from './rng.ts';

const KEYS = ['sta','vel','ctl','swp','drp','chg','gim','con','pow','spd','eye','rng','fld','arm','cat'];
const flat = (v: number): Abilities =>
  Object.fromEntries(KEYS.map((k) => [k, v])) as unknown as Abilities;
const sum = (a: Abilities) => Object.values(a).reduce((x, y) => x + y, 0);

const CPBL1 = leagues.levels['CPBL1']!;
const CPBL2 = leagues.levels['CPBL2']!;

describe('pathOf', () => {
  it('中職的路徑是二軍到一軍', () => {
    expect(pathOf('CPBL')).toEqual(['CPBL2', 'CPBL1']);
  });

  it('未知體系直接炸開', () => {
    expect(() => pathOf('NOPE')).toThrow();
  });
});

describe('evaluateMovement', () => {
  const move = (seed: string, level: string, overall: number, yearsAtBottom = 0) =>
    evaluateMovement(new World(seed), { level, overall, yearsAtBottom });

  /** 帶外籍名額擠壓的版本（ADR 0019）。 */
  const moveAsImport = (seed: string, level: string, overall: number, premium = 4) =>
    evaluateMovement(new World(seed), {
      level,
      overall,
      yearsAtBottom: 0,
      importPremium: premium,
    });

  const rateOf = (fn: (seed: string) => boolean, n = 300) => {
    let hit = 0;
    for (let i = 0; i < n; i++) if (fn(`s${i}`)) hit++;
    return hit / n;
  };

  it('能力遠超一軍門檻的二軍球員多半會被叫上去', () => {
    const rate = rateOf((s) => move(s, 'CPBL2', CPBL1.min + 10).movement === 'promote');
    expect(rate).toBeGreaterThan(0.7);
  });

  it('能力還沒到一軍門檻就絕不升級', () => {
    for (let i = 0; i < 200; i++) {
      expect(move(`s${i}`, 'CPBL2', CPBL1.min - 1).movement).not.toBe('promote');
    }
  });

  it('跟不上一軍水準的人會被下放', () => {
    const rate = rateOf((s) => move(s, 'CPBL1', CPBL1.min - 8).movement === 'demote');
    expect(rate).toBeGreaterThan(0.5);
  });

  it('差距越大越容易被下放', () => {
    const near = rateOf((s) => move(s, 'CPBL1', CPBL1.min - 2).movement === 'demote');
    const far = rateOf((s) => move(s, 'CPBL1', CPBL1.min - 10).movement === 'demote');
    expect(far).toBeGreaterThan(near);
  });

  it('外籍名額把一軍的升級門檻墊高，剛好及格的外籍上不去', () => {
    // 本土在 min+1 有機會上，外籍在同一個能力被名額擋住。
    const local = rateOf((s) => move(s, 'CPBL2', CPBL1.min + 1).movement === 'promote');
    expect(local).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) {
      expect(moveAsImport(`s${i}`, 'CPBL2', CPBL1.min + 1).movement).not.toBe('promote');
    }
  });

  it('外籍明顯強過本土替代人選就照樣升上一軍', () => {
    const rate = rateOf((s) => moveAsImport(s, 'CPBL2', CPBL1.min + 14).movement === 'promote');
    expect(rate).toBeGreaterThan(0.7);
  });

  it('外籍名額只加在一軍，二軍的去留判定一模一樣', () => {
    // 二軍不是 top，名額不擠壓——現實裡支配下登録不限國籍。加在這裡會變成
    // 「外籍連二軍都待不住」，那不是名額擠壓，那是把人趕出球界。
    for (let i = 0; i < 200; i++) {
      const local = evaluateMovement(new World(`s${i}`), {
        level: 'CPBL2',
        overall: CPBL2.min - 6,
        yearsAtBottom: 3,
      });
      const asImport = evaluateMovement(new World(`s${i}`), {
        level: 'CPBL2',
        overall: CPBL2.min - 6,
        yearsAtBottom: 3,
        importPremium: 4,
      });
      expect(asImport).toEqual(local);
    }
  });

  it('待滿在籍年數視同本土後，同一個能力就升得上去', () => {
    const blocked = rateOf((s) => moveAsImport(s, 'CPBL2', CPBL1.min + 3).movement === 'promote');
    const domestic = rateOf(
      (s) => moveAsImport(s, 'CPBL2', CPBL1.min + 3, 0).movement === 'promote',
    );
    expect(blocked).toBe(0);
    expect(domestic).toBeGreaterThan(0);
  });

  it('守不住加成後門檻的外籍會被擠下二軍', () => {
    const local = rateOf((s) => move(s, 'CPBL1', CPBL1.min + 2).movement === 'demote');
    const asImport = rateOf((s) => moveAsImport(s, 'CPBL1', CPBL1.min + 2).movement === 'demote');
    expect(local).toBe(0);
    expect(asImport).toBeGreaterThan(0.3);
  });

  it('達標的一軍球員留在原地', () => {
    for (let i = 0; i < 200; i++) {
      const m = move(`s${i}`, 'CPBL1', CPBL1.min + 2);
      expect(['stay', 'promote']).toContain(m.movement);
    }
  });

  it('已在最底層的人不會再被下放——沒有更低的地方可去', () => {
    for (let i = 0; i < 200; i++) {
      expect(move(`s${i}`, 'CPBL2', 10).movement).not.toBe('demote');
    }
  });

  it('寬限期內不會被戰力外——新人不該第一季就被釋出', () => {
    for (let i = 0; i < 200; i++) {
      expect(move(`s${i}`, 'CPBL2', 10, 0).movement).not.toBe('release');
      expect(move(`s${i}`, 'CPBL2', 10, cfg.movement.release.grace_years - 1).movement).not.toBe(
        'release',
      );
    }
  });

  it('撐過寬限期仍達不到最低標準就是戰力外', () => {
    const m = move('a', 'CPBL2', CPBL2.min - cfg.movement.release.margin - 5, 3);
    expect(m.movement).toBe('release');
    expect(m.level).toBeNull();
  });

  it('先問升級再問降級——已達上層門檻的人不該在同一輪被放掉', () => {
    // 這個人在最底層，但能力已經超過一軍門檻。升級的判定必須先跑。
    const rate = rateOf((s) => move(s, 'CPBL2', CPBL1.min + 15, 5).movement === 'release');
    expect(rate).toBe(0);
  });

  it('相同種子產生相同判定', () => {
    expect(move('a', 'CPBL2', CPBL1.min + 3)).toEqual(move('a', 'CPBL2', CPBL1.min + 3));
  });

  it('只消耗 career 流', () => {
    const world = new World('a');
    evaluateMovement(world, { level: 'CPBL2', overall: 40, yearsAtBottom: 0 });
    const counts = world.drawCounts();
    expect(counts.growth).toBe(0);
    expect(counts.season).toBe(0);
  });
});

describe('applyAging', () => {
  const age = (seed: string, a: number, ability = flat(50)) =>
    applyAging(new World(seed), ability, a);

  it('巔峰之前還在成長', () => {
    let rose = 0;
    for (let i = 0; i < 100; i++) {
      const r = age(`s${i}`, cfg.aging.peak_start - 3);
      expect(r.phase).toBe('growth');
      if (sum(r.ability) > sum(flat(50))) rose++;
    }
    expect(rose).toBeGreaterThan(50);
  });

  it('巔峰期間能力不動', () => {
    const r = age('a', cfg.aging.peak_start);
    expect(r.phase).toBe('peak');
    expect(r.ability).toEqual(flat(50));
    expect(r.changes.size).toBe(0);
  });

  it('巔峰之後開始衰退', () => {
    const r = age('a', cfg.aging.peak_end + 3);
    expect(r.phase).toBe('decline');
    expect(sum(r.ability)).toBeLessThan(sum(flat(50)));
  });

  it('衰退幅度隨年齡加速', () => {
    const drop = (a: number) => {
      let t = 0;
      for (let i = 0; i < 100; i++) t += sum(flat(50)) - sum(age(`s${i}`, a).ability);
      return t / 100;
    };
    expect(drop(cfg.aging.peak_end + 8)).toBeGreaterThan(drop(cfg.aging.peak_end + 1));
  });

  it('速度先掉，接觸撐得比較久——這是真實的老化順序', () => {
    const drop = (key: string) => {
      let t = 0;
      for (let i = 0; i < 200; i++) {
        const r = age(`s${i}`, cfg.aging.peak_end + 6);
        t += 50 - ((r.ability as unknown as Record<string, number>)[key] ?? 50);
      }
      return t / 200;
    };
    expect(drop('spd')).toBeGreaterThan(drop('con'));
    expect(drop('rng')).toBeGreaterThan(drop('eye'));
  });

  it('能力不會掉到負數', () => {
    const r = age('a', cfg.aging.peak_end + 20, flat(1));
    for (const v of Object.values(r.ability)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('changes 只列出真的有變動的項目', () => {
    const r = age('a', cfg.aging.peak_end + 5);
    for (const [, v] of r.changes) expect(v).not.toBe(0);
  });

  it('相同種子產生相同結果', () => {
    expect(age('a', 34)).toEqual(age('a', 34));
  });

  it('只消耗 growth 流', () => {
    const world = new World('a');
    applyAging(world, flat(50), 34);
    expect(world.drawCounts().career).toBe(0);
    expect(world.drawCounts().season).toBe(0);
  });
});

describe('拒絕下放的代價（ADR 0020）', () => {
  it('下放結果帶著判定用的機率，拒絕下放要拿它當代價', () => {
    // pressure 必須就是那一次判定的機率——ADR 0020 的釋出風險直接用它，
    // 兩者對不上就等於偷偷長出了第二個旋鈕。
    let pressure = 0;
    let hit = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const move = evaluateMovement(new World(`pressure${i}`), {
        level: 'CPBL1',
        overall: CPBL1.min - 6,
        yearsAtBottom: 0,
      });
      if (move.movement === 'demote') {
        hit++;
        pressure = move.pressure ?? 0;
      }
    }
    // 機率是百分比（rng.chance 的口徑），不是 0–1。
    expect(pressure).toBeGreaterThan(0);
    expect(pressure).toBeLessThanOrEqual(100);
    expect(Math.abs(hit / n - pressure / 100)).toBeLessThan(0.08);
  });
});

describe('shouldRetire', () => {
  it('只剩年齡上限會不由分說地結束生涯', () => {
    expect(shouldRetire({ age: cfg.retirement.max_age }).retire).toBe(true);
    expect(shouldRetire({ age: cfg.retirement.max_age - 1 }).retire).toBe(false);
  });

  // 被釋出不再是死刑。33 歲被日職釋出的人得先跑尋路——墨聯與澳職的存在理由
  // 正是「當所有頂級聯盟都關門時，還有地方打球」，它們連年齡窗口都沒有。
  it('被釋出不會直接結束生涯，不管幾歲', () => {
    for (let age = 20; age < cfg.retirement.max_age; age++) {
      expect(shouldRetire({ age }).retire).toBe(false);
    }
  });
});

describe('asksRetirement', () => {
  const rate = (age: number) => {
    let hit = 0;
    for (let i = 0; i < 400; i++) if (asksRetirement(new World(`s${i}`), age)) hit++;
    return hit / 400;
  };

  it('年輕球員不會被問', () => {
    expect(rate(cfg.retirement.min_age - 1)).toBe(0);
  });

  it('年紀越大問得越頻繁', () => {
    expect(rate(38)).toBeGreaterThan(rate(31));
  });

  // 抽取次數必須與年齡無關，否則同一個種子會在生日前後讓後面所有判定整串偏移。
  it('年紀不夠時也照抽', () => {
    const young = new World('drift');
    const old = new World('drift');
    asksRetirement(young, cfg.retirement.min_age - 5);
    asksRetirement(old, cfg.retirement.min_age + 5);
    expect(young.stream('career').next()).toBe(old.stream('career').next());
  });
});

describe('proDiceCount', () => {
  it('骰數落在設定的權重範圍內', () => {
    const allowed = Object.keys(cfg.pro_dice.count_weights).map(Number);
    const max = Math.max(...allowed) + cfg.pro_dice.peak_bonus.delta;
    for (let i = 0; i < 200; i++) {
      const n = proDiceCount(new World(`s${i}`), 24);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(max);
    }
  });

  it('巔峰期多擲一顆', () => {
    for (let i = 0; i < 100; i++) {
      const peak = proDiceCount(new World(`s${i}`), cfg.aging.peak_start);
      const young = proDiceCount(new World(`s${i}`), cfg.aging.peak_start - 5);
      expect(peak).toBe(young + cfg.pro_dice.peak_bonus.delta);
    }
  });

  it('職業的骰數少於養成期——球季佔滿了時間', () => {
    let pro = 0;
    for (let i = 0; i < 300; i++) pro += proDiceCount(new World(`s${i}`), 22);
    expect(pro / 300).toBeLessThan(3.5);
  });
});

describe('衰退的下限', () => {
  it('不會跌破球探量表的下限——20 就是底', () => {
    let ability = flat(abilities.scale.min + 2);
    for (let y = 0; y < 40; y++) {
      ability = applyAging(new World(`y${y}`), ability, 40).ability;
    }
    for (const v of Object.values(ability)) {
      expect(v).toBeGreaterThanOrEqual(abilities.scale.min);
    }
  });

  it('已經在下限的能力不再列入變動——沒動就不該報告有動', () => {
    const r = applyAging(new World('a'), flat(abilities.scale.min), 40);
    expect(r.changes.size).toBe(0);
    expect(r.ability).toEqual(flat(abilities.scale.min));
  });

  it('量表下限與 hard_floor 一致', () => {
    expect(abilities.scale.hard_floor).toBe(abilities.scale.min);
  });
});
