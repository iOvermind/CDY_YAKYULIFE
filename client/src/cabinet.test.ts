/**
 * 成就櫃的版面。**測的是「櫃子怎麼畫」**——分組、排序、聯盟前綴剝不剝——而不是
 * 「這一生值多少」，後者在 `engine/achievements.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { achievements as cfg } from './data/index.ts';
import { cabinetSections } from './cabinet.ts';

describe('成就櫃', () => {
  const tile = (id: string, category: string, name: string) => ({
    id,
    name,
    category,
    points: 10,
    at: '2030',
  });

  it('聯盟底下的小標一律是獎項在前、累積在後', () => {
    const sections = cabinetSections([
      tile('award:CPBL:mvp', cfg.categories.award.name, '中華職棒 年度MVP'),
      tile('cum:CPBL:hits:0', cfg.categories.cumulative.name, '中華職棒 安打'),
      // 大聯盟只有名人堂沒有獎項——名人堂併進「獎項」之後仍然要排在累積前面。
      tile('cum:MLB:hits:0', cfg.categories.cumulative.name, '美國大聯盟 安打'),
      tile('hall:美國大聯盟', cfg.categories.hall.name, '美國大聯盟 名人堂'),
    ]);
    const titles = (key: string) =>
      sections.find((s) => s.key === key)?.groups.map((g) => g.title);
    expect(titles('league:CPBL')).toEqual([cfg.categories.award.name, cfg.categories.cumulative.name]);
    expect(titles('league:MLB')).toEqual(titles('league:CPBL'));
  });

  it('動態命名的特性歸到它講的那個聯盟', () => {
    const sections = cabinetSections([
      tile('trait:legend:中華職棒歷史級球星', cfg.categories.trait.name, '中華職棒歷史級球星'),
      tile('trait:rainbow:美國大聯盟七彩球衣', cfg.categories.trait.name, '美國大聯盟七彩球衣'),
      // 名字固定的特性沒有聯盟可歸，留在「特性」那個大標底下。
      tile('trait:muscle', cfg.categories.trait.name, '魔鬼筋肉人'),
    ]);
    const names = (key: string) =>
      sections.find((s) => s.key === key)?.groups.flatMap((g) => g.items.map((i) => i.name));
    // 進了聯盟大標之後前綴就是重複的，剝掉。
    expect(names('league:CPBL')).toEqual(['歷史級球星']);
    expect(names('league:MLB')).toEqual(['七彩球衣']);
    expect(names(cfg.categories.trait.name)).toEqual(['魔鬼筋肉人']);
  });

  it('生涯分級歸到那個聯盟的特性底下，只留最高那一級', () => {
    const sections = cabinetSections([
      tile('tier:CPBL:2', cfg.categories.trait.name, '中華職棒每日先發級生涯'),
      tile('tier:CPBL:0', cfg.categories.trait.name, '中華職棒名人堂級生涯'),
    ]);
    const league = sections.find((s) => s.key === 'league:CPBL');
    expect(league?.groups.map((g) => [g.title, g.items.map((i) => i.name)])).toEqual([
      [cfg.categories.trait.name, ['名人堂級生涯']],
    ]);
    expect(league?.points).toBe(20);
  });
});
