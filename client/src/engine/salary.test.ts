import { describe, expect, it } from 'vitest';
import { leagues } from '../data/index.ts';
import { fmtMoney, fmtMoneyShort, postingFee, salaryFor } from './salary.ts';

describe('salaryFor', () => {
  it('與聯盟同水準時就是基礎年薪', () => {
    const spec = leagues.salary.levels['CPBL1']!;
    expect(salaryFor('CPBL1', 0)).toBe(spec.base);
  });

  it('打得越好年薪越高', () => {
    expect(salaryFor('CPBL1', 10)).toBeGreaterThan(salaryFor('CPBL1', 2));
  });

  /** 球團簽下你的時候不知道你會打成什麼樣——薪水是先給的。 */
  it('低於聯盟平均不會扣薪', () => {
    expect(salaryFor('CPBL1', -10)).toBe(salaryFor('CPBL1', 0));
  });

  it('超過上限就不再加', () => {
    const spec = leagues.salary.levels['CPBL1']!;
    expect(salaryFor('CPBL1', spec.d_cap + 50)).toBe(salaryFor('CPBL1', spec.d_cap));
  });

  it('二軍與小聯盟是固定薪，不隨表現浮動', () => {
    for (const level of ['CPBL2', 'NPB2', 'KBO2', 'R', 'A1', 'A2', 'A3']) {
      expect(salaryFor(level, 20)).toBe(salaryFor(level, 0));
    }
  });

  it('未知層級回傳 0，不會炸開', () => {
    expect(salaryFor('NOPE', 10)).toBe(0);
  });

  it('每個層級都有薪資設定——漏掉的話那一層會變成無薪', () => {
    for (const level of Object.keys(leagues.levels)) {
      expect(leagues.salary.levels[level]).toBeDefined();
    }
  });

  /**
   * 薪資反映市場規模，不是競技水準。大聯盟的 par 只比中職高三成，薪資卻是
   * 八倍起跳——這條斷言看著那個差距，免得哪天有人「順手」把薪資改成跟著 par。
   */
  it('大聯盟的薪資遠高於 par 的差距所能解釋的程度', () => {
    const parRatio = leagues.levels['MLB']!.par / leagues.levels['CPBL1']!.par;
    const payRatio = salaryFor('MLB', 0) / salaryFor('CPBL1', 0);
    expect(parRatio).toBeLessThan(1.5);
    expect(payRatio).toBeGreaterThan(5);
  });

  it('墨聯的競技水準接近韓職，但市場規模明顯較小', () => {
    expect(leagues.levels['LMB']!.par).toBeGreaterThan(leagues.levels['CPBL1']!.par);
    expect(salaryFor('LMB', 20)).toBeLessThan(salaryFor('KBO1', 20));
  });

  it('澳職是六個頂級聯盟裡薪水最低的——它接近半職業', () => {
    const tops = ['CPBL1', 'NPB1', 'KBO1', 'LMB', 'ABL', 'MLB'];
    const worst = tops.reduce((a, b) => (salaryFor(a, 10) <= salaryFor(b, 10) ? a : b));
    expect(worst).toBe('ABL');
  });
});

describe('postingFee', () => {
  it('是簽約金的固定倍數', () => {
    expect(postingFee(1000)).toBe(1000 * leagues.salary.posting_fee_multiplier.value);
  });

  it('簽約金越高，母隊拿到的越多——這是它願意放人的理由', () => {
    expect(postingFee(3000)).toBeGreaterThan(postingFee(1000));
  });

  it('沒有簽約金就沒有入札金', () => {
    expect(postingFee(0)).toBe(0);
  });
});

describe('金額顯示', () => {
  it('不到一億只寫萬', () => {
    expect(fmtMoney(3300)).toBe('3,300 萬');
  });

  it('超過一億拆成億與萬', () => {
    expect(fmtMoney(16160)).toBe('1 億 6,160 萬');
  });

  it('整億不寫多餘的零', () => {
    expect(fmtMoney(20000)).toBe('2 億');
  });

  it('零寫成 0 萬，不是空字串——空欄位看起來像壞掉', () => {
    expect(fmtMoney(0)).toBe('0 萬');
  });

  it('負數當成 0', () => {
    expect(fmtMoney(-500)).toBe('0 萬');
  });

  it('簡短版超過一億只留一位小數', () => {
    expect(fmtMoneyShort(114200)).toBe('11.4 億');
    expect(fmtMoneyShort(3300)).toBe('3,300 萬');
  });
});
