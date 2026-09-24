import { describe, expect, it } from 'vitest';
import { amateur, leagues } from '../data/index.ts';
import { pathOf } from './pro.ts';
import { World } from './rng.ts';
import { initLeague } from './teams.ts';
import { teams as teamsData } from '../data/index.ts';
import {
  amateurOverseasOffers,
  canRefuseDemotion,
  canRequestPosting,
  domesticFaOffers,
  fallbackOffers,
  hasOverseasFreeAgency,
  landingLevel,
  overseasBidChance,
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
  tier: 'none' as const,
});

describe('入札的目的地', () => {
  it('日職與韓職有，中職沒有', () => {
    expect(postingTarget('NPB')).toBe('MLB');
    expect(postingTarget('KBO')).toBe('MLB');
    expect(postingTarget('CPBL')).toBeNull();
  });
});

describe('入札的資格', () => {
  it('門檻就是落地在頂級聯盟，不另設數字', () => {
    const bar = topBar('MLB');
    expect(canRequestPosting(ctx(bar))).toBe(true);
    expect(canRequestPosting(ctx(bar - 1))).toBe(false);
  });

  it('落地在小聯盟不算——那筆錢買的是即戰力', () => {
    const bar = topBar('MLB');
    const level = landingLevel('MLB', bar - 1, null);
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
      const bids = postingBids(world, ctx(topBar('MLB') + 6, 25));
      if (bids.length === 0) continue;
      seen++;
      expect(bids.length).toBeLessThanOrEqual(cfg.bidders.max);
      for (const b of bids) {
        expect(b.org).toBe('MLB');
        expect(b.level).toBe('MLB');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('年齡窗口關上之後，母隊點頭也可能沒有人出價', () => {
    const world = new World('posting-old');
    let empty = 0;
    for (let i = 0; i < 200; i++) {
      if (postingBids(world, ctx(topBar('MLB'), 36)).length === 0) empty++;
    }
    expect(empty).toBeGreaterThan(0);
  });

  it('機率是 0 的時候不該再問——overseasBidChance 擋在提問之前', () => {
    // 35 歲窗口硬關，能力加成不適用。
    expect(overseasBidChance(ctx(topBar('MLB') + 20, 35))).toBe(0);
    // 窗口之內就有機率，而且吃能力加成。
    expect(overseasBidChance(ctx(topBar('MLB') + 10, 34))).toBeCloseTo(0.15 + 0.03 * 10, 10);
    // 沒有入札制度的體系一律是 0。
    expect(overseasBidChance({ ...ctx(99, 25), org: 'CPBL' })).toBe(0);
  });

  it('三十五歲是硬關——能力再高也沒有人出價', () => {
    // 窗口之內的能力加成不適用於窗口之外。年紀到了就是到了。
    const world = new World('posting-35');
    for (let i = 0; i < 100; i++) {
      expect(postingBids(world, ctx(topBar('MLB') + 20, 35))).toHaveLength(0);
    }
  });

  it('三十四歲的即戰力仍然出得去——每超過門檻一分多 3%', () => {
    // 15%（34 歲那一階）+ 3% × 超出門檻的分數。超出 10 分就是 45%。
    const window = leagues.transfer.orgs['MLB']?.age_window;
    expect(window?.per_over_landing_bar).toBe(0.03);
    let seen = 0;
    for (let i = 0; i < 300; i++) {
      if (postingBids(new World(`old-ace-${i}`), ctx(topBar('MLB') + 10, 34)).length > 0) seen++;
    }
    // 45% 上下，抓一個寬鬆的區間就好——這裡驗的是「出得去」，不是機率本身。
    expect(seen).toBeGreaterThan(300 * 0.3);
    expect(seen).toBeLessThan(300 * 0.6);
  });

  // 資格判定不能吃掉不同數量的亂數，否則同一個種子會因為某年差一分而讓後面
  // 所有判定整串偏移。落空的兩種理由必須消耗一樣多。
  it('落空的原因不影響亂數的推進', () => {
    const a = new World('drift');
    const b = new World('drift');
    expect(postingBids(a, ctx(topBar('MLB') - 1, 25))).toHaveLength(0); // 能力不足
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
        ...ctx(topBar('MLB') + 6, 27),
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
        ...ctx(topBar('MLB') + 6, 26),
        serviceYears: years,
      });
      if (offers.length === 0) continue;
      seen++;
      for (const o of offers) expect(o.org).toBe('MLB');
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('挖角的加薪門檻', () => {
  const scout = (currentOrg: string, salary: number, overall = topBar('KBO') + 10) =>
    scoutingOffers(new World('raise'), {
      tier: 'none' as const,
      overall,
      age: 26,
      lastWinPct: 0.7,
      currentOrg,
      currentTeam: '',
      playedOrgs: new Set<string>([currentOrg]),
      standards: null,
      salary,
    });

  it('平移或下降時年薪要加兩成才提得出口', () => {
    // 日職球員遇到韓職——那是下降，必須加薪。
    const rich = scout('NPB', 100_000_000).filter((o) => o.org === 'KBO');
    expect(rich).toHaveLength(0);
  });

  it('往下挖人，簽約金也不能比留在原體系少', () => {
    // 薪水低到年薪那一關必定放行，擋下來的是簽約金：韓職的簽約金表整整比日職
    // 小一截，同一個球員在日職的底價本來就比韓職開得出來的高。
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      seen += scoutingOffers(new World(`poor-${i}`), {
        tier: 'none' as const,
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
    expect(seen).toBe(0);
  });

  it('在大聯盟站穩的人不會收到日職與韓職的邀請', () => {
    let seen = 0;
    for (let i = 0; i < 60; i++) {
      seen += scoutingOffers(new World(`mlb-${i}`), {
        tier: 'none' as const,
        overall: topBar('MLB') + 8,
        age: 27,
        lastWinPct: 0.7,
        currentOrg: 'MLB',
        currentTeam: '',
        playedOrgs: new Set<string>(['MLB']),
        standards: null,
        salary: 2400,
      }).filter((o) => o.org === 'NPB' || o.org === 'KBO').length;
    }
    expect(seen).toBe(0);
  });

  it('往更強的體系去不受限制——他買的是舞台，不是薪水', () => {
    // 中職球員（par 44）被日職（par 53）看上，即使落地在二軍也照樣提得出口。
    let seen = 0;
    for (let i = 0; i < 60; i++) {
      seen += scoutingOffers(new World(`up-${i}`), {
      tier: 'none' as const,
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
    for (const org of ['NPB', 'KBO', 'ABL', 'LMB', 'MLB']) {
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
  const milb = cfg.paths.find((p) => p.org === 'MLB')!;
  const offers = (overall: number, seed = 'amateur') =>
    amateurOverseasOffers(new World(seed), overall);

  it('門檻看綜合能力的絕對值——十八歲的人沒有所屬聯盟可以相對', () => {
    expect(offers(npb.min_overall - 1).some((o) => o.org === 'NPB')).toBe(false);
    expect(offers(npb.min_overall).some((o) => o.org === 'NPB')).toBe(true);
    expect(offers(milb.min_overall - 1).some((o) => o.org === 'MLB')).toBe(false);
    expect(offers(milb.min_overall).some((o) => o.org === 'MLB')).toBe(true);
  });

  it('打不動任何一層的人照樣從地板起步——十八歲打不動一軍不是拒絕他的理由', () => {
    expect(landingLevel('NPB', npb.min_overall, null)).toBeNull();
    for (const o of offers(npb.min_overall).filter((x) => x.org === 'NPB')) {
      expect(o.level).toBe(npb.level);
    }
  });

  /**
   * **能直接上就直接上**，而且吃外籍加成：海外球團簽的是外籍球員，他得明顯強過
   * 本土的替代人選。所以落點是「地板」與 `landingLevel()` 取高。
   */
  it('能力夠的人直接從打得動的那一層出發', () => {
    const premium = leagues.transfer.import_premium.value;
    const npb1 = leagues.levels['NPB1']!.min + premium;
    expect(offers(npb1 - 1).find((o) => o.org === 'NPB')?.level).toBe('NPB2');
    expect(offers(npb1).find((o) => o.org === 'NPB')?.level).toBe('NPB1');

    const kbo1 = leagues.levels['KBO1']!.min + premium;
    expect(offers(kbo1 - 1).find((o) => o.org === 'KBO')?.level).toBe('KBO2');
    expect(offers(kbo1).find((o) => o.org === 'KBO')?.level).toBe('KBO1');

    // 旅美一路往上：夠格就 2A、3A，甚至直接上大聯盟。
    for (const level of ['A2', 'A3', 'MLB']) {
      const bar = leagues.levels[level]!.min + premium;
      expect(offers(bar).find((o) => o.org === 'MLB')?.level).toBe(level);
    }
  });

  it('旅韓的門檻就是韓職二軍的實力', () => {
    const kbo = cfg.paths.find((p) => p.org === 'KBO')!;
    expect(kbo.level).toBe('KBO2');
    expect(offers(kbo.min_overall - 1).some((o) => o.org === 'KBO')).toBe(false);
    expect(offers(kbo.min_overall).some((o) => o.org === 'KBO')).toBe(true);
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
    for (const org of ['KBO', 'MLB', 'LMB', 'ABL']) {
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
      tier: 'none' as const,
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
      tier: 'none' as const,
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
    expect(canRefuseDemotion('MLB', 5)).toBe(true);
    expect(canRefuseDemotion('MLB', 9)).toBe(true);
    expect(canRefuseDemotion('MLB', 4)).toBe(false);
    expect(canRefuseDemotion('MLB', 0)).toBe(false);
  });

  it('其他體系不管幾年都不能拒絕', () => {
    for (const org of ['CPBL', 'NPB', 'KBO', 'LMB', 'ABL']) {
      expect(canRefuseDemotion(org, 20)).toBe(false);
    }
  });
});

describe('落葉歸根只算「離開之後再回來」（#17）', () => {
  it('報價名單裡沒有現在待的體系——homecoming 因此永遠代表「離開過」', () => {
    // #17 的誤會出在文案（「聯盟」寫成了「體系」該說的事），不在判定：
    // 待過 1A、收到 3A 邀約時人已經不在美職了，那確實是回鄉。
    const offers = fallbackOffers(new World('milb-internal'), {
      tier: 'none' as const,
      overall: 55,
      currentOrg: 'MLB',
      currentTeam: '某隊',
      playedOrgs: new Set(['MLB']),
      standards: null,
    });
    expect(offers.some((o) => o.org === 'MLB')).toBe(false);
    expect(offers.length).toBeGreaterThan(0);
  });

  it('離開之後再收到同一個體系的邀約才算回鄉', () => {
    const offers = fallbackOffers(new World('milb-internal'), {
      tier: 'none' as const,
      overall: 55,
      currentOrg: 'CPBL1',
      currentTeam: '某隊',
      playedOrgs: new Set(['MLB']),
      standards: null,
    });
    const milb = offers.filter((o) => o.org === 'MLB');
    expect(milb.length).toBeGreaterThan(0);
    expect(milb.every((o) => o.homecoming)).toBe(true);
  });
});

describe('慣用手的順風', () => {
  it('同樣的能力，左手落得下更高的層級——那是上限折扣的對價', () => {
    // 剛好差一分落不到頂級聯盟的人，換成左投就落得下去。
    const bar = topBar('NPB');
    const overall = bar - 1;
    const top = pathOf('NPB')[pathOf('NPB').length - 1]!;
    expect(landingLevel('NPB', overall, null, 0, 'recruit', 'none')).not.toBe(top);
    expect(landingLevel('NPB', overall, null, 0, 'recruit', 'switch')).toBe(top);
  });

  it('順風不是無限的——差太多還是簽不下去', () => {
    const bottom = pathOf('CPBL')[0]!;
    const min = leagues.levels[bottom]!.min;
    expect(landingLevel('CPBL', min - 30, null, 0, 'recruit', 'switch')).toBeNull();
  });
});

describe('自由球員的國內市場', () => {
  const faCtx = (d: number, seed: string) => {
    const world = new World(seed);
    return {
      world,
      ctx: {
        org: 'CPBL',
        level: 'CPBL1',
        currentTeam: teamsData.leagues['CPBL']![0]!.name,
        overall: 50,
        d,
        standards: null,
        tier: 'none' as const,
        table: initLeague(world, 'CPBL'),
      },
    };
  };

  it('打得好就有同聯盟的球隊上門——這是 FA 市場的主體', () => {
    let withOffers = 0;
    for (let i = 0; i < 20; i++) {
      const { world, ctx } = faCtx(6, `fa-strong-${i}`);
      if (domesticFaOffers(world, ctx).length > 0) withOffers++;
    }
    expect(withOffers).toBe(20);
  });

  it('d 值高的人拿到的報價比中庸的人多', () => {
    const count = (d: number, tag: string) => {
      let total = 0;
      for (let i = 0; i < 40; i++) {
        const { world, ctx } = faCtx(d, `fa-${tag}-${i}`);
        total += domesticFaOffers(world, ctx).length;
      }
      return total;
    };
    expect(count(6, 'star')).toBeGreaterThan(count(-3, 'weak'));
  });

  it('不會開自己現在這一隊，也不會重複開同一隊', () => {
    for (let i = 0; i < 30; i++) {
      const { world, ctx } = faCtx(6, `fa-dup-${i}`);
      const offers = domesticFaOffers(world, ctx);
      const names = offers.map((o) => o.team);
      expect(names).not.toContain(ctx.currentTeam);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('層級與體系都不變——同聯盟換隊不是轉會', () => {
    const { world, ctx } = faCtx(6, 'fa-level');
    for (const offer of domesticFaOffers(world, ctx)) {
      expect(offer.org).toBe('CPBL');
      expect(offer.level).toBe('CPBL1');
      expect(offer.homecoming).toBe(false);
      expect(offer.table).toBe(ctx.table);
    }
  });

});
