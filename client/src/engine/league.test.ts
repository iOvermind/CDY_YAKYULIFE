import { describe, expect, it } from 'vitest';
import { leagues, season as cfg } from '../data/index.ts';
import {
  advanceStandards,
  initStandards,
  standardOf,
  standardsNote,
  type LeagueStandards,
} from './league.ts';
import { World } from './rng.ts';

/** 跑 n 年，回傳每一年的水準表。 */
function run(seed: string, years: number): LeagueStandards[] {
  const world = new World(seed);
  const out: LeagueStandards[] = [initStandards()];
  for (let i = 0; i < years; i++) {
    out.push(advanceStandards(world, out[out.length - 1]!));
  }
  return out;
}

describe('initStandards', () => {
  it('開局就是 leagues.json 的基準值——第一年是玩家認識世界的參照點', () => {
    const s = initStandards();
    for (const [level, info] of Object.entries(leagues.levels)) {
      expect(standardOf(s, level).par).toBe(info.par);
      expect(standardOf(s, level).min).toBe(info.min);
    }
  });

  it('涵蓋全部層級', () => {
    expect(initStandards().size).toBe(Object.keys(leagues.levels).length);
  });
});

describe('advanceStandards', () => {
  it('相同種子產生完全相同的浮動', () => {
    expect([...run('a', 10)[10]!]).toEqual([...run('a', 10)[10]!]);
  });

  it('不同種子產生不同的浮動', () => {
    expect([...run('a', 10)[10]!]).not.toEqual([...run('b', 10)[10]!]);
  });

  it('par 真的會動——不是每年都停在基準值', () => {
    const years = run('drift', 20);
    const pars = years.map((s) => standardOf(s, 'CPBL1').par);
    expect(new Set(pars).size).toBeGreaterThan(1);
  });

  it('par 的位移不超過設定的上下限', () => {
    const base = leagues.levels['CPBL1']!.par;
    const c = cfg.league_standards.level_drift.clamp;
    for (let seed = 0; seed < 30; seed++) {
      for (const s of run(`s${seed}`, 15)) {
        const shift = standardOf(s, 'CPBL1').par - base;
        expect(shift).toBeGreaterThanOrEqual(c.min - 1e-9);
        expect(shift).toBeLessThanOrEqual(c.max + 1e-9);
      }
    }
  });

  it('差距倍率不超過設定的上下限', () => {
    const info = leagues.levels['CPBL1']!;
    const baseGap = info.par - info.min;
    const c = cfg.league_standards.gap_drift.clamp;
    for (let seed = 0; seed < 30; seed++) {
      for (const s of run(`g${seed}`, 15)) {
        const now = standardOf(s, 'CPBL1');
        const ratio = (now.par - now.min) / baseGap;
        expect(ratio).toBeGreaterThanOrEqual(c.min - 1e-9);
        expect(ratio).toBeLessThanOrEqual(c.max + 1e-9);
      }
    }
  });

  it('min 永遠低於 par——替代水準不會爬到平均之上', () => {
    for (let seed = 0; seed < 20; seed++) {
      for (const s of run(`m${seed}`, 15)) {
        for (const level of Object.keys(leagues.levels)) {
          const now = standardOf(s, level);
          expect(now.min).toBeLessThan(now.par);
        }
      }
    }
  });

  it('同一個體系的所有層級同進同退——一軍與二軍的位移相同', () => {
    for (const s of run('org', 12)) {
      const one = standardOf(s, 'CPBL1').par - leagues.levels['CPBL1']!.par;
      const two = standardOf(s, 'CPBL2').par - leagues.levels['CPBL2']!.par;
      expect(two).toBeCloseTo(one, 10);
    }
  });

  it('不同體系各走各的——中職與日職不會同步', () => {
    const years = run('cross', 12);
    const cpbl = years.map((s) => standardOf(s, 'CPBL1').par - leagues.levels['CPBL1']!.par);
    const npb = years.map((s) => standardOf(s, 'NPB1').par - leagues.levels['NPB1']!.par);
    expect(cpbl).not.toEqual(npb);
  });

  it('長期會被基準值拉回去——二十年的平均位移遠小於單年的極端值', () => {
    let sum = 0;
    let n = 0;
    for (let seed = 0; seed < 40; seed++) {
      for (const s of run(`r${seed}`, 20)) {
        sum += standardOf(s, 'CPBL1').par - leagues.levels['CPBL1']!.par;
        n++;
      }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.5);
  });
});

describe('standardOf', () => {
  it('standards 為 null 時退回基準值', () => {
    expect(standardOf(null, 'CPBL1')).toEqual({
      par: leagues.levels['CPBL1']!.par,
      min: leagues.levels['CPBL1']!.min,
    });
  });

  it('未知層級直接炸開，不默默給預設值', () => {
    expect(() => standardOf(null, 'NOPE')).toThrow();
  });
});

describe('standardsNote', () => {
  it('基準年沒有話可說', () => {
    expect(standardsNote(initStandards(), 'CPBL1')).toBeNull();
  });

  it('偏離夠明顯時才給一句話，而且不是每年都給', () => {
    let notes = 0;
    let total = 0;
    for (let seed = 0; seed < 20; seed++) {
      for (const s of run(`n${seed}`, 20)) {
        total++;
        if (standardsNote(s, 'CPBL1') !== null) notes++;
      }
    }
    expect(notes).toBeGreaterThan(0);
    expect(notes / total).toBeLessThan(0.7);
  });
});
