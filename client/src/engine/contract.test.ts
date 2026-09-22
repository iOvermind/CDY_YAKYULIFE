import { describe, expect, it } from 'vitest';
import { season as cfg } from '../data/index.ts';
import {
  buyoutCost,
  clubOption,
  contractYears,
  isFreeAgentEligible,
  offersExtension,
  rookieContract,
  termOptions,
  yearsCap,
  type Contract,
} from './contract.ts';
import { World } from './rng.ts';

const c = cfg.contract;

const contract = (over: Partial<Contract> = {}): Contract => ({
  years: 3,
  mult: 1,
  extensionOffered: false,
  ...over,
});

describe('contractYears', () => {
  it('打得越好年限越長', () => {
    expect(contractYears({ d: 8, age: 26, side: 'fielder' })).toBeGreaterThan(
      contractYears({ d: 0, age: 26, side: 'fielder' }),
    );
  });

  it('投手的年限上限遠低於野手——手臂的風險讓球團不敢給長約', () => {
    expect(yearsCap('pitcher')).toBeLessThan(yearsCap('fielder'));
    expect(contractYears({ d: 10, age: 25, side: 'pitcher' })).toBeLessThan(
      contractYears({ d: 10, age: 25, side: 'fielder' }),
    );
  });

  /** 球團不會給一個 36 歲的人五年約——那五年裡有三年他已經退休了。 */
  it('年齡越大年限被砍得越短', () => {
    const young = contractYears({ d: 10, age: 26, side: 'fielder' });
    const mid = contractYears({ d: 10, age: 33, side: 'fielder' });
    const old = contractYears({ d: 10, age: 37, side: 'fielder' });
    expect(young).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(old);
  });

  it('年齡上限就是設定裡的值', () => {
    const oldest = c.years.age_caps.tiers[0]!;
    expect(contractYears({ d: 20, age: oldest.min_age, side: 'fielder' })).toBe(oldest.max_years);
  });

  it('再差也有最短年限，不會是 0 年約', () => {
    expect(contractYears({ d: -30, age: 38, side: 'pitcher' })).toBeGreaterThanOrEqual(
      c.short_contract.min_years,
    );
  });

  /** 傷病系統尚未實作，但公式已經寫完整——接上時只要把數字餵進來。 */
  it('傷病史會縮短年限', () => {
    const healthy = contractYears({ d: 8, age: 26, side: 'fielder' });
    const injured = contractYears({
      d: 8,
      age: 26,
      side: 'fielder',
      injuries: { majorInjuries: 2, tjSurgeries: 1 },
    });
    expect(injured).toBeLessThan(healthy);
  });

  it('不給傷病資料時等同於沒有傷病', () => {
    expect(contractYears({ d: 5, age: 27, side: 'fielder' })).toBe(
      contractYears({ d: 5, age: 27, side: 'fielder', injuries: { majorInjuries: 0, tjSurgeries: 0 } }),
    );
  });
});

describe('termOptions', () => {
  it('長約年限長但係數低，短約反過來——這就是那個取捨', () => {
    const t = termOptions({ d: 8, age: 26, side: 'fielder' });
    expect(t.longEligible).toBe(true);
    expect(t.longYears).toBeGreaterThan(t.shortYears);
    expect(t.longMult).toBeLessThan(t.shortMult);
  });

  it('成績差就談不到長約', () => {
    expect(termOptions({ d: -3, age: 26, side: 'fielder' }).longEligible).toBe(false);
  });

  it('年紀大就談不到長約，即使打得好', () => {
    expect(termOptions({ d: 10, age: 37, side: 'fielder' }).longEligible).toBe(false);
  });

  it('短約永遠給得起——談判破局時的保底', () => {
    const t = termOptions({ d: -20, age: 40, side: 'pitcher' });
    expect(t.shortYears).toBeGreaterThanOrEqual(c.short_contract.min_years);
    expect(t.shortYears).toBeLessThanOrEqual(c.short_contract.max_years);
  });

  it('打得越好係數越高', () => {
    expect(termOptions({ d: 10, age: 26, side: 'fielder' }).shortMult).toBeGreaterThan(
      termOptions({ d: -5, age: 26, side: 'fielder' }).shortMult,
    );
  });

  it('重案組之虎的係數有保底', () => {
    const plain = termOptions({ d: -5, age: 30, side: 'fielder' });
    const franchise = termOptions({
      d: -5,
      age: 30,
      side: 'fielder',
      traits: new Set(['franchise']),
    });
    expect(franchise.shortMult).toBeGreaterThan(plain.shortMult);
  });

  it('烏鴉的係數有上限', () => {
    const plain = termOptions({ d: 10, age: 26, side: 'fielder' });
    const cancer = termOptions({ d: 10, age: 26, side: 'fielder', traits: new Set(['cancer']) });
    expect(cancer.shortMult).toBeLessThan(plain.shortMult);
  });

  it('否決過交易的人，下一張約的係數打折', () => {
    const plain = termOptions({ d: 5, age: 28, side: 'fielder' });
    const refused = termOptions({ d: 5, age: 28, side: 'fielder', tradeRefused: true });
    expect(refused.shortMult).toBeLessThan(plain.shortMult);
  });

  it('傷病多卻只簽得到短約的人，年薪補高一些', () => {
    const healthy = termOptions({ d: 1, age: 35, side: 'pitcher' });
    const injured = termOptions({
      d: 1,
      age: 35,
      side: 'pitcher',
      injuries: { majorInjuries: 2, tjSurgeries: 1 },
    });
    expect(injured.shortMult).toBeGreaterThan(healthy.shortMult);
  });
});

describe('buyoutCost', () => {
  /** 違約的一方付全額——這是合約的基本精神。 */
  it('球團主動終止付的比球員自請離開多', () => {
    const args = { contract: contract({ years: 4 }), seasonSalary: 1000 } as const;
    expect(buyoutCost({ ...args, initiator: 'club' })).toBeGreaterThan(
      buyoutCost({ ...args, initiator: 'player' }),
    );
  });

  it('剩餘年數越多付越多', () => {
    expect(
      buyoutCost({ contract: contract({ years: 5 }), seasonSalary: 1000, initiator: 'player' }),
    ).toBeGreaterThan(
      buyoutCost({ contract: contract({ years: 2 }), seasonSalary: 1000, initiator: 'player' }),
    );
  });

  it('本來就要到期的約不用付', () => {
    expect(
      buyoutCost({ contract: contract({ years: 1 }), seasonSalary: 1000, initiator: 'club' }),
    ).toBe(0);
    expect(
      buyoutCost({ contract: contract({ years: 0 }), seasonSalary: 1000, initiator: 'club' }),
    ).toBe(0);
  });
});

describe('FA 資格', () => {
  it('服務滿掌控期就取得資格', () => {
    expect(isFreeAgentEligible({ serviceYears: c.control.years, changedOrg: false })).toBe(true);
    expect(isFreeAgentEligible({ serviceYears: c.control.years - 1, changedOrg: false })).toBe(
      false,
    );
  });

  /** 新東家沒有理由享有原球團的掌控權。 */
  it('換過體系的人直接取得資格', () => {
    expect(isFreeAgentEligible({ serviceYears: 1, changedOrg: true })).toBe(true);
  });
});

describe('offersExtension', () => {
  const base = { topLevel: true, freeAgentEligible: true, d: 3 };

  it('合約剩一年才會來談', () => {
    expect(offersExtension({ ...base, contract: contract({ years: 1 }) })).toBe(true);
    expect(offersExtension({ ...base, contract: contract({ years: 3 }) })).toBe(false);
  });

  it('一張合約只問一次', () => {
    expect(
      offersExtension({ ...base, contract: contract({ years: 1, extensionOffered: true }) }),
    ).toBe(false);
  });

  it('還在掌控期內不會來談——球團本來就綁得住你', () => {
    expect(
      offersExtension({ ...base, freeAgentEligible: false, contract: contract({ years: 1 }) }),
    ).toBe(false);
  });

  it('二軍不會有延長續約', () => {
    expect(offersExtension({ ...base, topLevel: false, contract: contract({ years: 1 }) })).toBe(
      false,
    );
  });

  it('上季打不好就不會來談', () => {
    expect(
      offersExtension({
        ...base,
        d: c.extension.requires_min_d - 1,
        contract: contract({ years: 1 }),
      }),
    ).toBe(false);
  });
});

describe('rookieContract', () => {
  it('照設定給年數與係數', () => {
    const r = rookieContract();
    expect(r.years).toBe(c.rookie_contract.years);
    expect(r.mult).toBe(c.rookie_contract.multiplier);
    expect(r.extensionOffered).toBe(false);
  });
});

describe('clubOption', () => {
  const opt = c.control.club_option;

  it('年數落在設定的區間裡，薪資照層級基數不加成', () => {
    for (let i = 0; i < 40; i++) {
      const got = clubOption(new World(`opt-${i}`));
      expect(got.years).toBeGreaterThanOrEqual(opt.years.min);
      expect(got.years).toBeLessThanOrEqual(opt.years.max);
      expect(got.mult).toBe(opt.multiplier);
      // 續約權是新的一張約，母隊還沒提過延長。
      expect(got.extensionOffered).toBe(false);
    }
  });

  it('區間兩端都抽得到——不是每次都給同一個年數', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(clubOption(new World(`span-${i}`)).years);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('同一個種子抽出同一張約', () => {
    expect(clubOption(new World('same'))).toEqual(clubOption(new World('same')));
  });

  it('抽取走 career 子序列——換掉別條序列的抽法不影響它', () => {
    const a = new World('stream');
    a.stream('growth').int(1, 6);
    const b = new World('stream');
    expect(clubOption(a)).toEqual(clubOption(b));
  });
});
