import { describe, expect, it } from 'vitest';
import { amateur, leagues } from '../data/index.ts';
import { pathOf } from './pro.ts';
import { World } from './rng.ts';
import {
  amateurOverseasOffers,
  canRefuseDemotion,
  canRequestPosting,
  fallbackOffers,
  hasOverseasFreeAgency,
  landingLevel,
  overseasFaOffers,
  postingBids,
  postingConsentChance,
  postingTarget,
  scoutingOffers,
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

describe('挖角的加薪門檻', () => {
  const scout = (currentOrg: string, salary: number, overall = topBar('KBO') + 10) =>
    scoutingOffers(new World('raise'), {
      overall,
      age: 26,
      lastWinPct: 0.7,
      currentOrg,
      currentTeam: '',
      playedOrgs: new Set<string>([currentOrg]),
      standards: null,
      salary,
    });

  it('平移或下降時要加薪兩成才提得出口', () => {
    // 日職球員（par 53）遇到韓職（par 50）——那是下降，必須加薪。
    const rich = scout('NPB', 100_000_000).filter((o) => o.org === 'KBO');
    expect(rich).toHaveLength(0);

    // 同一個人薪水很低時，韓職開得起價，報價就出得來。
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      const world = new World(`poor-${i}`);
      seen += scoutingOffers(world, {
        overall: topBar('KBO') + 10,
        age: 26,
        lastWinPct: 0.7,
        currentOrg: 'NPB',
        currentTeam: '',
        playedOrgs: new Set<string>(['NPB']),
        standards: null,
        salary: 1,
      }).filter((o) => o.org === 'KBO').length;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('往更強的體系去不受限制——他買的是舞台，不是薪水', () => {
    // 中職球員（par 44）被日職（par 53）看上，即使落地在二軍也照樣提得出口。
    let seen = 0;
    for (let i = 0; i < 60; i++) {
      seen += scoutingOffers(new World(`up-${i}`), {
        overall: topBar('NPB') + 6,
        age: 24,
        lastWinPct: 0.7,
        currentOrg: 'CPBL',
        currentTeam: '',
        playedOrgs: new Set<string>(['CPBL']),
        standards: null,
        salary: 100_000_000,
      }).filter((o) => o.org === 'NPB').length;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('母國聯盟不收外籍加成', () => {
  const home = leagues.transfer.home_org.value;
  const premium = leagues.transfer.import_premium.value;

  it('回中職的門檻就是該層級的 min，不加四分', () => {
    const bottom = pathOf(home)[0]!;
    const min = leagues.levels[bottom]!.min;
    expect(landingLevel(home, min, null)).toBe(bottom);
    expect(landingLevel(home, min - 1, null)).toBeNull();
  });

  it('其他體系照收——他在那裡是外籍球員', () => {
    for (const org of ['NPB', 'KBO', 'ABL', 'LMB', 'MiLB']) {
      const bottom = pathOf(org)[0]!;
      const min = leagues.levels[bottom]!.min;
      expect(landingLevel(org, min, null)).toBeNull();
      expect(landingLevel(org, min + premium, null)).toBe(bottom);
    }
  });
});

describe('高中畢業的旅外報價', () => {
  const cfg = amateur.amateur_overseas;
  const npb = cfg.paths.find((p) => p.org === 'NPB')!;
  const milb = cfg.paths.find((p) => p.org === 'MiLB')!;
  const offers = (overall: number, seed = 'amateur') =>
    amateurOverseasOffers(new World(seed), overall);

  it('門檻看綜合能力的絕對值——十八歲的人沒有所屬聯盟可以相對', () => {
    expect(offers(npb.min_overall - 1)).toHaveLength(0);
    expect(offers(npb.min_overall).some((o) => o.org === 'NPB')).toBe(true);
    expect(offers(milb.min_overall - 1).some((o) => o.org === 'MiLB')).toBe(false);
    expect(offers(milb.min_overall).some((o) => o.org === 'MiLB')).toBe(true);
  });

  it('落地層級寫死在資料裡，不走 landingLevel', () => {
    // 十八歲的人本來就打不動一軍，那不是拒絕他的理由。
    for (const o of offers(npb.min_overall).filter((x) => x.org === 'NPB')) {
      expect(o.level).toBe(npb.level);
    }
    expect(landingLevel('NPB', npb.min_overall, null)).toBeNull();
  });

  it('能力夠好的旅美直接從 1A 起跳', () => {
    const up = milb.level_upgrade!;
    for (const o of offers(up.min_overall - 1).filter((x) => x.org === 'MiLB')) {
      expect(o.level).toBe(milb.level);
    }
    for (const o of offers(up.min_overall).filter((x) => x.org === 'MiLB')) {
      expect(o.level).toBe(up.level);
    }
  });

  it('簽約金隨超出門檻的幅度上升', () => {
    const low = offers(npb.min_overall).find((o) => o.org === 'NPB')!;
    const high = offers(npb.min_overall + 6).find((o) => o.org === 'NPB')!;
    expect(high.bonus).toBeGreaterThan(low.bonus);
  });

  // 抽取次數必須與資格無關，否則同一個種子會因為差一分而讓後面所有判定整串偏移。
  it('不合格時也照抽', () => {
    const a = new World('drift');
    const b = new World('drift');
    amateurOverseasOffers(a, 0);
    amateurOverseasOffers(b, 0);
    expect(a.stream('career').next()).toBe(b.stream('career').next());
  });
});

describe('在籍夠久就視同本土', () => {
  const premium = leagues.transfer.import_premium.value;
  const years = leagues.transfer.orgs['NPB']!.domestic_after_years!;

  it('日職滿八年之後，落地門檻不再加四分', () => {
    const top = pathOf('NPB')[pathOf('NPB').length - 1]!;
    const min = leagues.levels[top]!.min;

    // 差一分就上不了一軍——外籍身分還在。
    expect(landingLevel('NPB', min + premium - 1, null, 0)).not.toBe(top);
    // 待滿之後同樣的能力就夠了。
    expect(landingLevel('NPB', min, null, years)).toBe(top);
  });

  it('差一年還不算——門檻是「滿」幾年', () => {
    const top = pathOf('NPB')[pathOf('NPB').length - 1]!;
    const min = leagues.levels[top]!.min;
    expect(landingLevel('NPB', min, null, years - 1)).not.toBe(top);
  });

  it('沒有這條規則的體系待再久也是外籍', () => {
    for (const org of ['KBO', 'MiLB', 'LMB', 'ABL']) {
      expect(leagues.transfer.orgs[org]?.domestic_after_years).toBeUndefined();
      const bottom = pathOf(org)[0]!;
      const min = leagues.levels[bottom]!.min;
      expect(landingLevel(org, min, null, 30)).toBeNull();
    }
  });

  it('母國本來就不收，年資無關', () => {
    const home = leagues.transfer.home_org.value;
    const bottom = pathOf(home)[0]!;
    expect(landingLevel(home, leagues.levels[bottom]!.min, null, 0)).toBe(bottom);
  });
});

describe('球隊處境影響開出的條件', () => {
  /**
   * 收集一整批報價。
   *
   * **只取同一個體系**：各體系的簽約金基數差很多（日職 1200、小聯盟 800），
   * 混在一起比會被基數的差距蓋過球隊處境的效果。
   */
  function sample(org: string): { odds: number; bonus: number; years: number }[] {
    const out: { odds: number; bonus: number; years: number }[] = [];
    for (let i = 0; i < 300; i++) {
      for (const o of amateurOverseasOffers(new World(`odds-${i}`), 60)) {
        if (o.org !== org) continue;
        out.push({ odds: o.odds, bonus: o.bonus, years: o.years });
      }
    }
    return out;
  }

  it('奪冠機率越高，簽約金越高', () => {
    const rows = sample('NPB').filter((r) => r.odds > 0);
    expect(rows.length).toBeGreaterThan(20);
    const sorted = [...rows].sort((a, b) => a.odds - b.odds);
    const low = sorted.slice(0, 20).reduce((s, r) => s + r.bonus, 0) / 20;
    const high = sorted.slice(-20).reduce((s, r) => s + r.bonus, 0) / 20;
    expect(high).toBeGreaterThan(low);
  });

  it('奪冠機率越高，年限反而越短——錢與年限是兩個要取捨的東西', () => {
    const rows = sample('NPB').filter((r) => r.odds > 0);
    const sorted = [...rows].sort((a, b) => a.odds - b.odds);
    const low = sorted.slice(0, 20).reduce((s, r) => s + r.years, 0) / 20;
    const high = sorted.slice(-20).reduce((s, r) => s + r.years, 0) / 20;
    expect(high).toBeLessThan(low);
  });

  it('年限永遠至少一年', () => {
    for (const r of sample('NPB')) expect(r.years).toBeGreaterThanOrEqual(1);
  });
});

describe('下放時的退路', () => {
  /** 從日職一軍被送回二軍的處境。 */
  function demotionOffers(overall: number) {
    return fallbackOffers(new World(`demote-${overall}`), {
      overall,
      currentOrg: 'NPB',
      currentTeam: '某隊',
      playedOrgs: new Set(['CPBL', 'NPB']),
      standards: null,
      topLevelOnly: true,
    });
  }

  /**
   * 這是回歸測試。先前這裡用 `minPar`（被送去的那一層的 par）當下限，
   * 而日職二軍的 par 是 47——中職一軍 44 與澳職 42 因此永遠被濾掉，
   * 能力不到墨聯 49 的人會一個邀請都收不到，只剩「接受下放」。
   */
  it('澳職與中職一軍要出現——它們的 par 低於日職二軍，但那是一軍的位置', () => {
    const orgs = demotionOffers(48).map((o) => o.org);
    expect(orgs).toContain('ABL');
    expect(orgs).toContain('CPBL');
  });

  it('能力不高的人也有退路，不會零邀請', () => {
    for (const overall of [46, 48, 50, 52]) {
      expect(demotionOffers(overall).length).toBeGreaterThan(0);
    }
  });

  it('四條路同時開著時不會被上限切掉最弱的那條', () => {
    const orgs = demotionOffers(54).map((o) => o.org);
    expect(new Set(orgs)).toEqual(new Set(['KBO', 'LMB', 'CPBL', 'ABL']));
  });

  it('只給一軍的位置——不會為了從日職二軍換到 2A 而搬家', () => {
    for (const o of demotionOffers(54)) {
      expect(leagues.levels[o.level]?.top).toBeDefined();
    }
  });

  /**
   * 落葉歸根不是「第五好的選項」。排序依 par 由高到低，而中職一軍的 44 是所有
   * 頂級聯盟裡最低的——候選一多它就會被 `max_offers` 擠出去。從澳職被下放、
   * 能力又高到連大聯盟都收得下的人正好踩到這格：MLB 59／日職 53／韓職 50／
   * 墨聯 48 剛好填滿四格。
   */
  it('母國永遠佔得到一格，不會被 par 排序擠掉', () => {
    const offers = fallbackOffers(new World('home-guarantee'), {
      overall: 60,
      currentOrg: 'ABL',
      currentTeam: '某隊',
      playedOrgs: new Set(['CPBL', 'ABL']),
      standards: null,
      topLevelOnly: true,
    });
    expect(offers.map((o) => o.org)).toContain('CPBL');
    expect(offers.length).toBeLessThanOrEqual(4);
  });
});

describe('canRefuseDemotion', () => {
  // MLB 的五年年資條款只有那一個體系有。這是規則差異，不是平衡調整——
  // 日職與中職沒有對應制度，年資在那裡只換來 FA。
  it('美職滿五年一軍年資才有拒絕權', () => {
    expect(canRefuseDemotion('MiLB', 5)).toBe(true);
    expect(canRefuseDemotion('MiLB', 9)).toBe(true);
    expect(canRefuseDemotion('MiLB', 4)).toBe(false);
    expect(canRefuseDemotion('MiLB', 0)).toBe(false);
  });

  it('其他體系不管幾年都不能拒絕', () => {
    for (const org of ['CPBL', 'NPB', 'KBO', 'LMB', 'ABL']) {
      expect(canRefuseDemotion(org, 20)).toBe(false);
    }
  });
});
