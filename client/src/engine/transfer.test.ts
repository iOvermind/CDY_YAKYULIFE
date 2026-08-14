import { describe, expect, it } from 'vitest';
import { leagues } from '../data/index.ts';
import { pathOf } from './pro.ts';
import { World } from './rng.ts';
import {
  canRequestPosting,
  hasOverseasFreeAgency,
  landingLevel,
  overseasFaOffers,
  postingBids,
  postingConsentChance,
  postingTarget,
} from './transfer.ts';

const cfg = leagues.transfer.posting;

/** 頂級聯盟落得下去的最低能力。入札的資格門檻就是它。 */
function topBar(org: string): number {
  const path = pathOf(org);
  const top = path[path.length - 1]!;
  return leagues.levels[top]!.min + leagues.transfer.import_premium.value;
}

const ctx = (overall: number, age = 27) => ({
  org: 'NPB',
  overall,
  age,
  playedOrgs: new Set<string>(['NPB']),
  standards: null,
});

describe('入札的目的地', () => {
  it('日職與韓職有，中職沒有', () => {
    expect(postingTarget('NPB')).toBe('MiLB');
    expect(postingTarget('KBO')).toBe('MiLB');
    expect(postingTarget('CPBL')).toBeNull();
  });
});

describe('入札的資格', () => {
  it('門檻就是落地在頂級聯盟，不另設數字', () => {
    const bar = topBar('MiLB');
    expect(canRequestPosting(ctx(bar))).toBe(true);
    expect(canRequestPosting(ctx(bar - 1))).toBe(false);
  });

  it('落地在小聯盟不算——那筆錢買的是即戰力', () => {
    const bar = topBar('MiLB');
    const level = landingLevel('MiLB', bar - 1, null);
    expect(level).not.toBeNull();
    expect(leagues.levels[level!]!.top).toBeUndefined();
  });

  it('沒有入札制度的體系永遠申請不了', () => {
    expect(canRequestPosting({ ...ctx(99), org: 'CPBL' })).toBe(false);
  });
});

describe('母隊的同意', () => {
  it('年資越深越容易點頭', () => {
    const a = postingConsentChance({ serviceYears: 3, fee: 0 });
    const b = postingConsentChance({ serviceYears: 8, fee: 0 });
    expect(b).toBeGreaterThan(a);
  });

  it('入札金越高越容易點頭', () => {
    const a = postingConsentChance({ serviceYears: 5, fee: 0 });
    const b = postingConsentChance({ serviceYears: 5, fee: 50_000 });
    expect(b).toBeGreaterThan(a);
  });

  it('永遠留在上下限之內——不會變成必然，也不會變成絕望', () => {
    const low = postingConsentChance({ serviceYears: 0, fee: 0 });
    const high = postingConsentChance({ serviceYears: 40, fee: 10_000_000 });
    expect(low).toBe(cfg.consent.clamp.min);
    expect(high).toBe(cfg.consent.clamp.max);
  });
});

describe('入札的競標', () => {
  it('報價落在頂級聯盟，數量在設定範圍內', () => {
    const world = new World('posting');
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      const bids = postingBids(world, ctx(topBar('MiLB') + 6, 25));
      if (bids.length === 0) continue;
      seen++;
      expect(bids.length).toBeLessThanOrEqual(cfg.bidders.max);
      for (const b of bids) {
        expect(b.org).toBe('MiLB');
        expect(b.level).toBe('MLB');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('年齡窗口關上之後，母隊點頭也可能沒有人出價', () => {
    const world = new World('posting-old');
    let empty = 0;
    for (let i = 0; i < 200; i++) {
      if (postingBids(world, ctx(topBar('MiLB'), 36)).length === 0) empty++;
    }
    expect(empty).toBeGreaterThan(0);
  });

  // 資格判定不能吃掉不同數量的亂數，否則同一個種子會因為某年差一分而讓後面
  // 所有判定整串偏移。落空的兩種理由必須消耗一樣多。
  it('落空的原因不影響亂數的推進', () => {
    const a = new World('drift');
    const b = new World('drift');
    expect(postingBids(a, ctx(topBar('MiLB') - 1, 25))).toHaveLength(0); // 能力不足
    expect(postingBids(b, { ...ctx(99, 25), org: 'CPBL' })).toHaveLength(0); // 沒有入札制度
    expect(a.stream('career').next()).toBe(b.stream('career').next());
  });
});

describe('海外自由球員', () => {
  const years = cfg.overseas_fa_years.value;

  it('滿年資才有，而且只有設有入札制度的體系有', () => {
    expect(hasOverseasFreeAgency('NPB', years - 1)).toBe(false);
    expect(hasOverseasFreeAgency('NPB', years)).toBe(true);
    expect(hasOverseasFreeAgency('CPBL', 20)).toBe(false);
  });

  it('年資不足時拿不到任何報價', () => {
    const world = new World('ofa');
    for (let i = 0; i < 50; i++) {
      const offers = overseasFaOffers(world, {
        ...ctx(topBar('MiLB') + 6, 27),
        serviceYears: years - 1,
      });
      expect(offers).toHaveLength(0);
    }
  });

  it('滿年資之後與入札走同一批球團', () => {
    const world = new World('ofa2');
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      const offers = overseasFaOffers(world, {
        ...ctx(topBar('MiLB') + 6, 26),
        serviceYears: years,
      });
      if (offers.length === 0) continue;
      seen++;
      for (const o of offers) expect(o.org).toBe('MiLB');
    }
    expect(seen).toBeGreaterThan(0);
  });
});
