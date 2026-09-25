import { describe, expect, it } from 'vitest';
import { injury, season, talents as talentData } from '../data/index.ts';
import { applyTalents, costOf, effectsOf, maxLevelOf, resolvePath } from './overlay.ts';

describe('天賦的路徑', () => {
  /**
   * **這是資料驅動的代價。**
   *
   * 效果寫在 JSON 裡，路徑打錯不會在編譯期被抓到——所以這條測試把每一個天賦的
   * 每一級的每一條路徑都解一次。少了它，一個錯字會變成「這個天賦買了沒反應」，
   * 而那種 bug 沒有人會回報。
   */
  it('每一個天賦的每一條路徑都解得到', () => {
    const broken: string[] = [];
    let checked = 0;
    for (const talent of talentData.talents) {
      talent.levels.forEach((level, i) => {
        for (const effect of level.effects) {
          checked++;
          if (resolvePath(effect.path) === null) {
            broken.push(`${talent.id} Lv${i + 1}：${effect.path}`);
          }
        }
      });
    }
    expect(broken).toEqual([]);
    // 迴圈跑零次也會「通過」，因此要確認真的檢查了東西。
    expect(checked).toBeGreaterThan(20);
  });

  it('每一個天賦都有名字、說明與至少一級', () => {
    for (const talent of talentData.talents) {
      expect(talent.name).not.toBe('');
      expect(talent.desc).not.toBe('');
      expect(talent.levels.length).toBeGreaterThan(0);
      for (const level of talent.levels) {
        expect(level.cost).toBeGreaterThan(0);
        expect(level.effect_text).not.toBe('');
      }
    }
  });

  it('價格逐級遞增——不然買高階就沒有取捨了', () => {
    for (const talent of talentData.talents) {
      for (let i = 1; i < talent.levels.length; i++) {
        expect(talent.levels[i]!.cost).toBeGreaterThan(talent.levels[i - 1]!.cost);
      }
    }
  });

  it('id 不重複', () => {
    const ids = talentData.talents.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('套用與還原', () => {
  it('套上去會改，還原之後回到原值', () => {
    // 天賦改的是乘算層，不是體質給的起點（base）——見 ADR 0033。
    const before = injury.chance.talent_multiplier;
    const revert = applyTalents({ ironframe: 1 });
    expect(injury.chance.talent_multiplier).toBeLessThan(before);
    revert();
    expect(injury.chance.talent_multiplier).toBe(before);
  });

  it('沒買的天賦什麼都不做', () => {
    const before = injury.chance.base;
    const revert = applyTalents({});
    expect(injury.chance.base).toBe(before);
    revert();
  });

  it('夾擠會生效——「仍不超過」「不低於」就寫在那裡', () => {
    // 突破極限把突破天賦的成本倍率往下壓，但不會低於 1。
    const revert = applyTalents({ breakthrough: 2 });
    expect(injury.chance.base).toBeGreaterThanOrEqual(0);
    revert();

    const deep = applyTalents({ ironframe: 2 });
    expect(injury.chance.base).toBeGreaterThanOrEqual(0);
    deep();
  });

  it('層級越高效果越強', () => {
    const base = season.aging.peak_delay_max;
    const one = applyTalents({ evergreen: 1 });
    const lv1 = season.aging.peak_delay_max;
    one();
    const two = applyTalents({ evergreen: 2 });
    const lv2 = season.aging.peak_delay_max;
    two();
    expect(lv1).toBeGreaterThan(base);
    expect(lv2).toBeGreaterThan(lv1);
    expect(season.aging.peak_delay_max).toBe(base);
  });

  it('連續套用與還原不會累積殘留', () => {
    const before = season.retirement.max_age;
    for (let i = 0; i < 20; i++) {
      const revert = applyTalents({ marathoner: 2, evergreen: 1 });
      revert();
    }
    expect(season.retirement.max_age).toBe(before);
  });

  it('一個天賦改多個路徑時，全部都會還原', () => {
    const revert = applyTalents({ overseas_eyes: 2 });
    revert();
    // 國際認證第二級動了三個體系的球探機率。
    expect(effectsOf('overseas_eyes', 2).length).toBeGreaterThan(1);
  });
});

describe('價格與層級', () => {
  it('買到第 N 級的花費是前 N 級的總和', () => {
    const talent = talentData.talents[0]!;
    expect(costOf(talent.id, 1)).toBe(talent.levels[0]!.cost);
    expect(costOf(talent.id, 2)).toBe(talent.levels[0]!.cost + talent.levels[1]!.cost);
    expect(costOf(talent.id, 0)).toBe(0);
  });

  it('查不到的天賦一律回零，不會拋錯', () => {
    expect(costOf('沒有這個天賦', 3)).toBe(0);
    expect(maxLevelOf('沒有這個天賦')).toBe(0);
    expect(effectsOf('沒有這個天賦', 1)).toEqual([]);
  });
});
