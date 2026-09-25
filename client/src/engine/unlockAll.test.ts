import { describe, expect, it } from 'vitest';
import { achievements as cfg, flavor, traits } from '../data/index.ts';
import { lifeIndex, priceOwned } from './achievements.ts';
import { unlockEverything } from './unlockAll.ts';

/** unlock-all.sh 的名單：除了第 N 段人生，拿得到的全部開。 */
describe('unlockEverything', () => {
  const all = unlockEverything(new Set());
  const ids = new Set(all.map((a) => a.id));
  const byId = new Map(all.map((a) => [a.id, a]));

  /**
   * 開出來的每一項都要是現行規則認得的——認不出的會在伺服器啟動時被刪掉，等於
   * 白開。賽事表的 `_note` 曾經被當成一項賽事，開出少了賽事名的「中華隊 冠軍」。
   */
  it('每一項都認得出來', () => {
    const prices = priceOwned(all);
    expect([...prices].filter(([, p]) => p === null).map(([id]) => id)).toEqual([]);
  });

  it('沒有第 N 段人生，也沒有重複的 id', () => {
    expect(all.some((a) => lifeIndex(a.id) !== null)).toBe(false);
    expect(ids.size).toBe(all.length);
  });

  it('每個特性都開，名字隨生涯變的開遍每一種', () => {
    for (const t of traits.traits) {
      if (t.dynamic_name === true) continue;
      expect(ids).toContain(`trait:${t.id}`);
    }
    expect(all.filter((a) => a.id.startsWith('trait:legend:'))).toHaveLength(6);
    expect(all.filter((a) => a.id.startsWith('trait:rainbow:'))).toHaveLength(3);
    expect(all.filter((a) => a.id.startsWith('trait:mrteam:')).length).toBeGreaterThan(50);
  });

  it('獎項照各聯盟實際會頒的開，名字用該聯盟的叫法', () => {
    expect(byId.get('award:MLB:defense_king')?.name).toBe('白金手套');
    expect(ids.has('award:CPBL:defense_king')).toBe(false);
    expect(ids).toContain('award:CPBL:championship');
    expect(ids).toContain('award:ABL:mvp');
  });

  it('累積開到 AP 封頂那一階：聯盟第 6 階、生涯第 7 階', () => {
    const hits = cfg.categories.cumulative.rungs['hits']!;
    expect(byId.get('cum:CPBL:hits:3000')?.points).toBe(hits.points * cfg.categories.cumulative.ap_max_rungs);
    expect(ids).toContain('cum:career:hits:3500');
    expect(ids).toContain('cum:MLB:outs:3000');
  });

  it('盃賽與國際賽開冠軍，分級開到名人堂，第二人生八條都開', () => {
    expect([...ids].some((id) => id.startsWith('cup:'))).toBe(true);
    expect(ids).toContain('intl:中華隊 世界棒球經典賽');
    expect(ids).toContain('intl:mvp:中華隊 世界棒球經典賽 MVP');
    expect(all.filter((a) => a.id.startsWith('tier:') && a.id.endsWith(':0'))).toHaveLength(6);
    expect(byId.get('tier:CPBL:0')?.name).toBe('中華職棒名人堂級生涯');
    expect(all.filter((a) => a.id.startsWith('hall:'))).toHaveLength(6);
    expect(all.filter((a) => a.id.startsWith('second_life:'))).toHaveLength(flavor.second_life.stories.length);
  });

  it('已經領過的階只補差額；全部都有就什麼都不給', () => {
    const hits = cfg.categories.cumulative.rungs['hits']!;
    const partial = unlockEverything(new Set(['cum:CPBL:hits:1000']));
    expect(partial.find((a) => a.id === 'cum:CPBL:hits:3000')?.points).toBe(hits.points * 4);
    expect(unlockEverything(ids)).toEqual([]);
  });

  it('階梯上已經有更高一階的人，不補一列 0 點的低階', () => {
    const got = unlockEverything(new Set(['cum:CPBL:hits:4000']));
    expect(got.some((a) => a.id.startsWith('cum:CPBL:hits:'))).toBe(false);
  });
});
