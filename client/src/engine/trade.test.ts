import { describe, expect, it } from 'vitest';
import { season as cfg, teams as teamsData } from '../data/index.ts';
import type { BattingLine } from './amateurStats.ts';
import { World } from './rng.ts';
import type { ProPitchingLine } from './season.ts';
import {
  isStar,
  isUntouchable,
  splitBatting,
  splitPitching,
  tradeChance,
  tradeSplit,
  tradeTarget,
} from './trade.ts';

const trade = cfg.trade;

const batting: BattingLine = {
  games: 141,
  pa: 601,
  ab: 537,
  runs: 83,
  hits: 161,
  double: 29,
  triple: 3,
  hr: 21,
  rbi: 88,
  bb: 55,
  ibb: 7,
  so: 97,
  sb: 13,
  cs: 5,
  avg: 161 / 537,
  obp: 216 / 601,
  slg: 259 / 537,
};

const pitching: ProPitchingLine = {
  role: 'SP',
  games: 27,
  starts: 27,
  wins: 13,
  losses: 8,
  saves: 0,
  outs: 511,
  hits: 155,
  runs: 71,
  er: 66,
  bb: 44,
  so: 158,
  era: (66 * 27) / 511,
};

describe('被交易的機率', () => {
  it('特性把它推高', () => {
    const plain = tradeChance(new Set());
    expect(plain).toBe(trade.chance.base);
    expect(tradeChance(new Set(['cancer']))).toBeGreaterThan(plain);
    expect(tradeChance(new Set(['ambience']))).toBeGreaterThan(plain);
    expect(tradeChance(new Set(['cancer', 'ambience']))).toBeGreaterThan(
      tradeChance(new Set(['cancer'])),
    );
  });
});

describe('明星與非賣品', () => {
  it('明星看的是當年的聯盟平均', () => {
    const margin = trade.star_margin.value;
    expect(isStar(50 + margin, 50)).toBe(true);
    expect(isStar(50 + margin - 1, 50)).toBe(false);
    // 同樣的能力，在水準較高的年份就不算明星了。
    expect(isStar(50 + margin, 52)).toBe(false);
  });

  it('一人一城的兩個特性讓球團連會議都不開', () => {
    expect(isUntouchable(new Set())).toBe(false);
    for (const t of trade.untouchable_traits.value) {
      expect(isUntouchable(new Set([t]))).toBe(true);
    }
  });
});

describe('交易的對手', () => {
  it('同體系內換隊，而且不會換到自己', () => {
    const world = new World('trade');
    const list = teamsData.leagues['CPBL'] ?? [];
    const current = list[0]!.name;
    for (let i = 0; i < 100; i++) {
      const target = tradeTarget(world, 'CPBL', current);
      expect(target).not.toBeNull();
      expect(target).not.toBe(current);
      expect(list.some((t) => t.name === target)).toBe(true);
    }
  });
});

describe('交易大限的位置', () => {
  it('落在設定的區間內', () => {
    const world = new World('deadline');
    for (let i = 0; i < 200; i++) {
      const r = tradeSplit(world);
      expect(r).toBeGreaterThanOrEqual(trade.split.min);
      expect(r).toBeLessThanOrEqual(trade.split.max);
    }
  });
});

describe('成績的切分', () => {
  const ratios = [0.35, 0.5, 0.5001, 0.65];

  it('兩段相加精確等於全季——2000 安差一支就是另一個故事', () => {
    for (const r of ratios) {
      const [a, b] = splitBatting(batting, r);
      for (const key of [
        'games',
        'pa',
        'ab',
        'runs',
        'hits',
        'double',
        'triple',
        'hr',
        'rbi',
        'bb',
        'ibb',
        'so',
        'sb',
        'cs',
      ] as const) {
        expect(a[key] + b[key]).toBe(batting[key]);
      }
    }
  });

  it('投球也是——出局數是整數的原子單位', () => {
    for (const r of ratios) {
      const [a, b] = splitPitching(pitching, r);
      for (const key of [
        'games',
        'starts',
        'wins',
        'losses',
        'saves',
        'outs',
        'hits',
        'runs',
        'er',
        'bb',
        'so',
      ] as const) {
        expect(a[key] + b[key]).toBe(pitching[key]);
      }
      expect(a.role).toBe(pitching.role);
      expect(b.role).toBe(pitching.role);
    }
  });

  it('率用自己那一段的分母重算，不沿用全季', () => {
    const [a, b] = splitBatting(batting, 0.5);
    expect(a.avg).toBeCloseTo(a.hits / a.ab, 10);
    expect(b.obp).toBeCloseTo((b.hits + b.bb) / b.pa, 10);

    const [p1] = splitPitching(pitching, 0.5);
    expect(p1.era).toBeCloseTo((p1.er * 27) / p1.outs, 10);
  });

  it('全季都在同一段時，另一段是空的而不是壞的', () => {
    const [a, b] = splitBatting(batting, 1);
    expect(a.games).toBe(batting.games);
    expect(b.games).toBe(0);
    expect(b.avg).toBe(0);
    expect(b.obp).toBe(0);

    const [, p2] = splitPitching(pitching, 1);
    expect(p2.outs).toBe(0);
    expect(p2.era).toBe(0);
  });
});
