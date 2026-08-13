import { describe, expect, it } from 'vitest';
import { amateur, teams } from '../data/index.ts';
import { canRejectOffer, qualifiesAsTwoWay, runDraft } from './draft.ts';
import type { Rating } from './rating.ts';
import { World } from './rng.ts';

const draft = (seed: string, overall: number, age = 19) =>
  runDraft(new World(seed), { overall, age });

const rating = (pitcher: number, fielder: number): Rating => ({
  pitcher,
  fielder,
  overall: Math.max(pitcher, fielder),
  better: pitcher >= fielder ? 'pitcher' : 'fielder',
});

describe('runDraft', () => {
  it('相同種子與相同條件產生相同結果', () => {
    expect(draft('a', 45)).toEqual(draft('a', 45));
  });

  it('能力越強輪次越前', () => {
    const avgRound = (overall: number) => {
      let total = 0;
      let drafted = 0;
      for (let i = 0; i < 200; i++) {
        const r = draft(`s${i}`, overall);
        if (!r.undrafted) {
          total += r.round;
          drafted++;
        }
      }
      return drafted === 0 ? Infinity : total / drafted;
    };
    expect(avgRound(55)).toBeLessThan(avgRound(40));
  });

  it('能力太低會落榜', () => {
    let undrafted = 0;
    for (let i = 0; i < 100; i++) if (draft(`s${i}`, 10).undrafted) undrafted++;
    expect(undrafted).toBe(100);
  });

  it('能力夠強一定被指名', () => {
    for (let i = 0; i < 100; i++) expect(draft(`s${i}`, 60).undrafted).toBe(false);
  });

  it('年輕球員占優——球團買的是可養成的年數', () => {
    const avgScore = (age: number) => {
      let total = 0;
      const n = 200;
      for (let i = 0; i < n; i++) total += draft(`s${i}`, 45, age).score;
      return total / n;
    };
    expect(avgScore(18)).toBeGreaterThan(avgScore(23));
  });

  it('超過年齡樞紐之後不再加分，但也不倒扣', () => {
    const pivot = amateur.draft.evaluation.age_pivot;
    const at = draft('a', 45, pivot).score;
    const older = draft('a', 45, pivot + 5).score;
    expect(older).toBe(at);
  });

  it('落榜時沒有球隊、沒有簽約金、沒有層級', () => {
    const r = draft('a', 10);
    expect(r.undrafted).toBe(true);
    expect(r.round).toBe(0);
    expect(r.bonus).toBe(0);
    expect(r.team).toBeNull();
    expect(r.level).toBeNull();
  });

  it('簽約金依輪次遞減', () => {
    const bonuses = amateur.draft.signing_bonus_by_round;
    for (let i = 2; i < bonuses.length; i++) {
      expect(bonuses[i]).toBeLessThanOrEqual(bonuses[i - 1] ?? 0);
    }
  });

  it('指名球隊來自中職名單', () => {
    const names = new Set((teams.leagues['CPBL'] ?? []).map((t) => t.name));
    for (let i = 0; i < 100; i++) {
      const r = draft(`s${i}`, 50);
      if (!r.undrafted) expect(names).toContain(r.team);
    }
  });

  it('第一輪且能力達標者直接進一軍', () => {
    const promo = amateur.draft.first_round_direct_promotion;
    let checked = false;
    for (let i = 0; i < 300; i++) {
      const r = draft(`s${i}`, 60);
      if (r.round === promo.round) {
        expect(r.level).toBe(promo.level);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });

  it('後段輪次一律從二軍出發', () => {
    const promo = amateur.draft.first_round_direct_promotion;
    for (let i = 0; i < 200; i++) {
      const r = draft(`s${i}`, 42);
      if (!r.undrafted && r.round > promo.round) expect(r.level).toBe(promo.fallback_level);
    }
  });

  it('只消耗 career 流', () => {
    const world = new World('a');
    runDraft(world, { overall: 45, age: 19 });
    const counts = world.drawCounts();
    expect(counts.career).toBeGreaterThan(0);
    expect(counts.season).toBe(0);
    expect(counts.growth).toBe(0);
    expect(counts.events).toBe(0);
  });
});

describe('canRejectOffer', () => {
  const cfg = amateur.draft.reject_offer;

  it('前段指名不能拒絕——沒有拒絕的道理', () => {
    const r = { ...draft('a', 60), round: 1, undrafted: false };
    expect(canRejectOffer(r, 18)).toBe(false);
  });

  it('後段指名可以拒絕', () => {
    const r = { ...draft('a', 45), round: cfg.reject_from_round, undrafted: false };
    expect(canRejectOffer(r, 18)).toBe(true);
  });

  it('年齡太大就不給這個選項，避免無限拖延', () => {
    const r = { ...draft('a', 45), round: cfg.reject_from_round, undrafted: false };
    expect(canRejectOffer(r, cfg.max_age)).toBe(false);
  });

  it('落榜沒有東西可以拒絕', () => {
    expect(canRejectOffer(draft('a', 10), 18)).toBe(false);
  });
});

describe('qualifiesAsTwoWay', () => {
  const cfg = amateur.two_way_talent;

  it('兩側都達標才算', () => {
    expect(qualifiesAsTwoWay(rating(cfg.min_pitcher, cfg.min_fielder))).toBe(true);
  });

  it('單邊很強不算——那只代表專精', () => {
    expect(qualifiesAsTwoWay(rating(80, cfg.min_fielder - 1))).toBe(false);
    expect(qualifiesAsTwoWay(rating(cfg.min_pitcher - 1, 80))).toBe(false);
  });

  it('兩側都不到不算', () => {
    expect(qualifiesAsTwoWay(rating(cfg.min_pitcher - 1, cfg.min_fielder - 1))).toBe(false);
  });
});
