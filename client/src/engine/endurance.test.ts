import { describe, expect, it } from 'vitest';
import { season } from '../data/index.ts';
import {
  afterSurgery,
  declineAmount,
  declineKeys,
  fielderWear,
  pitcherWear,
  rollEndurance,
  settleSeason,
  sevenFistsRisk,
  tierOf,
} from './endurance.ts';
import { World } from './rng.ts';

const cfg = season.endurance;
const pool = (value: number, max = 100) => ({ max, value, emptySeasons: 0 });

describe('耐力的上限', () => {
  it('兩池各擲各的，落在開局區間；橡膠果實只乘投手那一池', () => {
    for (let i = 0; i < 50; i++) {
      const { fielder, pitcher } = rollEndurance(new World(`e${i}`), false);
      for (const p of [fielder, pitcher]) {
        expect(p.max).toBeGreaterThanOrEqual(cfg.start.min);
        expect(p.max).toBeLessThanOrEqual(cfg.start.max);
        expect(p.value).toBe(p.max);
      }
      const rubber = rollEndurance(new World(`e${i}`), true);
      expect(rubber.fielder.max).toBe(fielder.max);
      expect(rubber.pitcher.max).toBeCloseTo(pitcher.max * cfg.rubber.pitcher_max);
    }
  });
});

describe('消耗與恢復', () => {
  it('指定打擊不磨損；捕手磨得最兇', () => {
    expect(fielderWear('DH', 150, 162, 1)).toBe(0);
    expect(fielderWear('C', 150, 162, 1)).toBeGreaterThan(fielderWear('SS', 150, 162, 1));
    expect(fielderWear('SS', 150, 162, 1)).toBeGreaterThan(fielderWear('1B', 150, 162, 1));
  });

  it('局數越多磨越兇', () => {
    expect(pitcherWear(600, 1)).toBeGreaterThan(pitcherWear(200, 1));
  });

  it('扣完消耗加回恢復，夾在 0 與上限之間；耗盡的季數在 0 時累加、回升就歸零', () => {
    expect(settleSeason(pool(50), 10, 4).value).toBe(44);
    expect(settleSeason(pool(99), 0, 4).value).toBe(100);
    const empty = settleSeason(pool(3), 20, 2);
    expect(empty.value).toBe(0);
    expect(empty.emptySeasons).toBe(1);
    expect(settleSeason(empty, 20, 2).emptySeasons).toBe(2);
    expect(settleSeason(empty, 0, 2).emptySeasons).toBe(0);
  });

  it('開完 TJ 回到上限的八成', () => {
    expect(afterSurgery(pool(0, 90)).value).toBeCloseTo(90 * cfg.tj.restore);
  });
});

describe('狀態', () => {
  it('充沛、疲勞、透支、耗盡依上限比例切', () => {
    expect(tierOf(pool(80))).toBe('full');
    expect(tierOf(pool(40))).toBe('tired');
    expect(tierOf(pool(10))).toBe('strained');
    expect(tierOf(pool(0))).toBe('empty');
  });
});

describe('耗盡之後的衰退', () => {
  it('第一季約 0.7，逐季加重，有上限', () => {
    expect(declineAmount(0)).toBe(0);
    expect(declineAmount(1)).toBeCloseTo(cfg.decline.base);
    expect(declineAmount(3)).toBeGreaterThan(declineAmount(2));
    expect(declineAmount(99)).toBe(cfg.decline.max);
  });

  it('野手只扣守備三項，配球永不衰退', () => {
    expect([...declineKeys('fielder')].sort()).toEqual(['arm', 'fld', 'rng']);
    expect(declineKeys('fielder')).not.toContain('cat');
  });
});

describe('七傷拳', () => {
  it('每撐一季累加，橡膠果實減半', () => {
    expect(sevenFistsRisk(0, false)).toBe(0);
    expect(sevenFistsRisk(2, false)).toBe(2 * cfg.seven_fists.per_season);
    expect(sevenFistsRisk(2, true)).toBe(cfg.seven_fists.per_season);
  });
});
