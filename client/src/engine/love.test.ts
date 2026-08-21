import { describe, expect, it } from 'vitest';
import { love as cfg } from '../data/index.ts';
import {
  afterBreakup,
  breakupChance,
  cadenceChance,
  canPropose,
  childbirthChance,
  confessionChance,
  divorceCost,
  earnsConfidante,
  hasPartner,
  injuryRiskModifier,
  isChildhoodSweetheart,
  newLoveState,
  pickPartner,
  rehabChance,
  rewardMultiplier,
  turmoilChance,
  type LoveState,
} from './love.ts';
import { World } from './rng.ts';

const state = (over: Partial<LoveState> = {}): LoveState => ({ ...newLoveState(), ...over });

describe('求婚的門檻', () => {
  it('十五歲的人不會在主場本壘板後方跪下來', () => {
    expect(canPropose({ pro: false, age: 25 })).toBe(false);
    expect(canPropose({ pro: true, age: cfg.gate.propose.min_age - 1 })).toBe(false);
    expect(canPropose({ pro: true, age: cfg.gate.propose.min_age })).toBe(true);
  });
});

describe('每年跑不跑', () => {
  it('交往中必定跑——那是一段關係的進展，不該靠運氣', () => {
    expect(cadenceChance(state({ status: 'dating' }))).toBe(100);
  });

  it('有孩子的已婚跑得比沒孩子的少', () => {
    expect(cadenceChance(state({ status: 'married', kids: 2 }))).toBeLessThan(
      cadenceChance(state({ status: 'married', kids: 0 })),
    );
  });
});

describe('校園告白', () => {
  it('成功率看當年最好的大賽名次', () => {
    expect(confessionChance('冠軍')).toBeGreaterThan(confessionChance('八強'));
    expect(confessionChance('八強')).toBeGreaterThan(confessionChance(null));
  });

  it('永遠在上下限之內', () => {
    expect(confessionChance(null)).toBeGreaterThanOrEqual(cfg.amateur.confession.clamp.min);
    expect(confessionChance('冠軍')).toBeLessThanOrEqual(cfg.amateur.confession.clamp.max);
  });
});

describe('分手風險', () => {
  const long = state({ status: 'dating', datingYears: cfg.dating.breakup.from_years + 2 });

  it('「婚期一延再延」只在求婚已經可行時累計', () => {
    // 還不能求婚的人不該因為沒結婚而被拆散。
    expect(breakupChance(long, { canPropose: false })).toBe(0);
    expect(breakupChance(long, { canPropose: true })).toBeGreaterThan(0);
  });

  it('交往越久風險越高', () => {
    const a = state({ status: 'dating', datingYears: cfg.dating.breakup.from_years });
    const b = state({ status: 'dating', datingYears: cfg.dating.breakup.from_years + 3 });
    expect(breakupChance(b, { canPropose: true })).toBeGreaterThan(
      breakupChance(a, { canPropose: true }),
    );
  });

  it('劈腿被抓之後幾年，連還不能求婚的人也會被拆散', () => {
    const cheated = state({ status: 'dating', cheatPenaltyYears: 1 });
    expect(breakupChance(cheated, { canPropose: false })).toBe(
      cfg.affair.dating_breakup_penalty.add,
    );
  });
});

describe('風波機率', () => {
  it('沒有伴就沒有風波', () => {
    expect(turmoilChance(state({ status: 'single' }))).toBe(0);
    expect(turmoilChance(state({ status: 'divorced' }))).toBe(0);
  });

  it('吞下去的裂痕越多，往後越不平靜', () => {
    const clean = state({ status: 'married' });
    const cracked = state({ status: 'married', cracks: 3 });
    expect(turmoilChance(cracked)).toBeGreaterThan(turmoilChance(clean));
  });

  it('帶她走是駝峰——適應期會過去', () => {
    const at = (years: number) =>
      turmoilChance(state({ status: 'married', overseas: 'bring', overseasYears: years }));
    // 前兩年新鮮、第三四年最難熬、之後回落。
    expect(at(3)).toBeGreaterThan(at(1));
    expect(at(5)).toBeLessThan(at(3));
  });

  it('遠距離是一條平穩的高線，不隨年數惡化', () => {
    const at = (years: number) =>
      turmoilChance(state({ status: 'dating', overseas: 'apart', overseasYears: years }));
    expect(at(1)).toBe(at(6));
    expect(at(1)).toBeGreaterThan(turmoilChance(state({ status: 'dating' })));
  });
});

describe('吞下去的慢性代價', () => {
  it('裂痕會讓感情事件的回報遞減——心裡有事，安定感就沒了', () => {
    expect(rewardMultiplier(state())).toBe(1);
    expect(rewardMultiplier(state({ cracks: 1 }))).toBeLessThan(1);
    expect(rewardMultiplier(state({ cracks: 99 }))).toBe(0);
  });
});

describe('感情回饋到傷病', () => {
  it('已婚降風險、有孩子再降', () => {
    expect(injuryRiskModifier(state({ status: 'married' }))).toBeLessThan(0);
    expect(injuryRiskModifier(state({ status: 'married', kids: 1 }))).toBeLessThan(
      injuryRiskModifier(state({ status: 'married' })),
    );
  });

  it('出事的那一年升風險', () => {
    expect(injuryRiskModifier(state({ status: 'dating', turmoilThisYear: true }))).toBe(
      cfg.injury_risk.turmoil_year,
    );
  });

  it('有人陪的話大傷之後熬得住——不是治好，是熬得住', () => {
    const base = 20;
    expect(rehabChance(state({ status: 'single' }), base)).toBe(base);
    expect(rehabChance(state({ status: 'married' }), base)).toBeLessThan(base);
    expect(hasPartner(state({ status: 'dating' }))).toBe(true);
  });
});

describe('離婚的財務代價', () => {
  it('分走一部分生涯收入，有孩子分得更多', () => {
    const plain = divorceCost(1_000_000, 0);
    const withKids = divorceCost(1_000_000, 3);
    expect(plain).toBeGreaterThan(0);
    expect(withKids).toBeGreaterThan(plain);
    expect(plain).toBeLessThan(1_000_000);
  });
});

describe('生子', () => {
  it('第一胎最優先，越生越少', () => {
    expect(childbirthChance(0)).toBeGreaterThan(childbirthChance(1));
    expect(childbirthChance(1)).toBeGreaterThan(childbirthChance(3));
    expect(childbirthChance(cfg.marriage.max_kids)).toBe(0);
  });
});

describe('青梅竹馬', () => {
  it('養成期認識的對象走到結婚才算', () => {
    expect(isChildhoodSweetheart(state({ status: 'married', fromSchool: true }))).toBe(true);
    expect(isChildhoodSweetheart(state({ status: 'married', fromSchool: false }))).toBe(false);
    expect(isChildhoodSweetheart(state({ status: 'dating', fromSchool: true }))).toBe(false);
  });
});

describe('分手之後', () => {
  it('離過婚的人回不到「單身」', () => {
    expect(afterBreakup(state())).toBe('single');
    expect(afterBreakup(state({ divorces: 1 }))).toBe('divorced');
  });
});

describe('對象名單', () => {
  it('校園與職業各一組，而且不會挑到現任', () => {
    const world = new World('names');
    for (let i = 0; i < 60; i++) {
      const school = pickPartner(world, 'school', null);
      expect(cfg.names.school).toContain(school);
      const other = pickPartner(world, 'pro', cfg.names.pro[0] ?? null);
      expect(other).not.toBe(cfg.names.pro[0]);
    }
  });

  it('安全名單可以交往，卻永遠不會成為外遇對象', () => {
    const world = new World('safe');
    const safe = cfg.names.safe;
    expect(safe.length).toBeGreaterThan(0);

    // 前提：她本來就在名單裡，否則這條規則沒有意義。
    for (const n of safe) {
      expect(cfg.names.school).toContain(n);
      expect(cfg.names.pro).toContain(n);
    }

    let seenAsPartner = false;
    for (let i = 0; i < 400; i++) {
      if (safe.includes(pickPartner(world, 'pro', null))) seenAsPartner = true;
      expect(safe).not.toContain(pickPartner(world, 'pro', null, true));
      expect(safe).not.toContain(pickPartner(world, 'school', null, true));
    }
    expect(seenAsPartner).toBe(true);
  });

  it('名單被現任耗盡時，退路仍然排除安全名單', () => {
    const world = new World('safe-fallback');
    // 只剩安全名單與現任可選時，寧可回空字串也不能把她推去外遇。
    for (const n of cfg.names.pro) {
      if (cfg.names.safe.includes(n)) continue;
      expect(cfg.names.safe).not.toContain(pickPartner(world, 'pro', n, true));
    }
  });
});


describe('啦啦隊殺手', () => {
  const after = (over: Partial<ReturnType<typeof newLoveState>>) => ({ ...newLoveState(), ...over });
  const threshold = cfg.dating.confidante.dated_times;

  it('三段戀情都以分手收場才給', () => {
    for (let n = 0; n < threshold; n++) {
      expect(earnsConfidante(after({ datedTimes: n }))).toBe(false);
    }
    expect(earnsConfidante(after({ datedTimes: threshold }))).toBe(true);
  });

  it('結過婚的人永遠拿不到——離婚之後再交往幾段都一樣', () => {
    // 交往 A → 結婚 → 離婚 → 交往 B → 交往 C。段數湊得到，但他明明結過婚。
    expect(earnsConfidante(after({ datedTimes: threshold, divorces: 1 }))).toBe(false);
    expect(earnsConfidante(after({ datedTimes: threshold + 10, divorces: 1 }))).toBe(false);
  });

  it('孩子不必另外擋：沒結過婚的人不可能有孩子', () => {
    // `kids` 只在婚後的生產分支累加，所以 kids > 0 蘊含 divorces > 0（婚姻結束時）
    // 或者根本還在婚姻中（那就不會走到分手判定）。這條在 game.ts 側由呼叫點保證。
    expect(earnsConfidante(after({ datedTimes: threshold, kids: 2, divorces: 1 }))).toBe(false);
  });
});
