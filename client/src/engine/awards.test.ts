import { describe, expect, it } from 'vitest';
import { awards as cfg } from '../data/index.ts';
import type { BattingLine } from './amateurStats.ts';
import { annualAwards, countAwards, type AwardContext, type AwardRecord } from './awards.ts';
import { World } from './rng.ts';
import type { ProPitchingLine } from './season.ts';

const TH = cfg.thresholds['CPBL']!;

const bat = (over: Partial<BattingLine> = {}): BattingLine => ({
  games: 115, pa: 480, ab: 430, runs: 70, hits: 120, double: 24, triple: 2, hr: 12,
  rbi: 60, bb: 45, ibb: 5, so: 80, sb: 10, cs: 4,
  avg: 120 / 430, obp: 0.34, slg: 0.42,
  ...over,
});

const pit = (over: Partial<ProPitchingLine> = {}): ProPitchingLine => ({
  role: 'SP', games: 26, starts: 26, wins: 12, losses: 8, saves: 0, ip: 160, hits: 150,
  runs: 65, er: 60, bb: 40, so: 120, era: 3.38,
  ...over,
});

const ctx = (over: Partial<AwardContext> = {}): AwardContext => ({
  year: 2030,
  org: 'CPBL',
  level: 'CPBL1',
  leagueGames: TH.games,
  d: 3,
  team: '某隊',
  rookie: false,
  batting: bat(),
  pitching: null,
  role: null,
  position: 'SS',
  fieldingWinPct: 0.5,
  ...over,
});

/** 跑很多次，回傳某個獎出現的比例——判定帶機率，單次結果沒有意義。 */
function rate(over: Partial<AwardContext>, code: string, runs = 400): number {
  let hit = 0;
  for (let i = 0; i < runs; i++) {
    const got = annualAwards(new World(`aw-${i}`), ctx(over));
    if (got.some((a) => a.code === code)) hit++;
  }
  return hit / runs;
}

describe('明星賽', () => {
  it('d 值越高入選率越高', () => {
    expect(rate({ d: 12 }, 'all_star')).toBeGreaterThan(rate({ d: -2 }, 'all_star'));
  });

  it('人氣球團有加成，而且 d 值不足時會標註', () => {
    const pop = cfg.all_star.popularity_bonus;
    const plain = rate({ d: 0, team: '某隊' }, 'all_star');
    const popular = rate({ d: 0, org: pop.league, team: pop.team }, 'all_star');
    expect(popular).toBeGreaterThan(plain);

    const got = annualAwards(
      new World('pop'),
      ctx({ d: 0, org: pop.league, team: pop.team }),
    );
    const star = got.find((a) => a.code === 'all_star');
    if (star !== undefined && 0 < pop.flag_below_d) {
      expect(star.name).toContain('人氣');
    }
  });
});

describe('新人王', () => {
  it('只有新人年拿得到', () => {
    expect(rate({ rookie: false, d: 10 }, 'rookie_of_year')).toBe(0);
    expect(rate({ rookie: true, d: 10 }, 'rookie_of_year')).toBeGreaterThan(0);
  });

  it('d 值不到門檻就沒有機會', () => {
    expect(rate({ rookie: true, d: cfg.rookie_of_year.min_d - 1 }, 'rookie_of_year')).toBe(0);
  });
});

describe('年度最佳投手', () => {
  it('限先發——後援投手拿不到', () => {
    const good = { pitching: pit({ era: 2.5, ip: 160 }), role: 'SP' as const, batting: null };
    const relief = { pitching: pit({ role: 'RP', era: 2.5, ip: 160 }), role: 'RP' as const, batting: null };
    expect(rate(good, 'pitcher_of_year')).toBeGreaterThan(0);
    expect(rate(relief, 'pitcher_of_year')).toBe(0);
  });

  it('局數不足該聯盟場次就沒有資格', () => {
    expect(
      rate({ pitching: pit({ era: 2.0, ip: 80 }), role: 'SP', batting: null }, 'pitcher_of_year'),
    ).toBe(0);
  });

  it('防禦率高於門檻就沒有資格', () => {
    const era = TH['era']![0]! + 0.5;
    expect(
      rate({ pitching: pit({ era, ip: 180 }), role: 'SP', batting: null }, 'pitcher_of_year'),
    ).toBe(0);
  });

  it('鬼神級球季必定入選', () => {
    const era = TH['era']![1]! - 0.2;
    expect(
      rate({ pitching: pit({ era, ip: 200 }), role: 'SP', batting: null }, 'pitcher_of_year', 50),
    ).toBe(1);
  });
});

describe('單項王', () => {
  it('打席不足就沒有資格，成績再好也一樣', () => {
    const avg = TH['avg']![0]! + 0.05;
    expect(rate({ batting: bat({ avg, pa: 200 }) }, 'batting_king')).toBe(0);
    expect(rate({ batting: bat({ avg, pa: 480 }) }, 'batting_king')).toBeGreaterThan(0);
  });

  it('成績越好機率越高', () => {
    const floor = TH['hr']![0]!;
    expect(rate({ batting: bat({ hr: floor + 8 }) }, 'hr_king')).toBeGreaterThan(
      rate({ batting: bat({ hr: floor }) }, 'hr_king'),
    );
  });

  it('鬼神門檻必定入選', () => {
    expect(rate({ batting: bat({ hr: TH['hr']![1]! }) }, 'hr_king', 50)).toBe(1);
  });

  it('沒達到基礎門檻就完全沒有機會', () => {
    expect(rate({ batting: bat({ hr: TH['hr']![0]! - 1 }) }, 'hr_king')).toBe(0);
  });

  it('救援王限後援投手', () => {
    const sv = TH['sv']![0]! + 5;
    expect(rate({ pitching: pit({ role: 'RP', saves: sv }), role: 'RP' }, 'save_king')).toBeGreaterThan(0);
    expect(rate({ pitching: pit({ role: 'SP', saves: sv }), role: 'SP' }, 'save_king')).toBe(0);
  });

  it('投手不會拿到打擊類的單項王', () => {
    const got = annualAwards(
      new World('p-only'),
      ctx({ batting: null, pitching: pit({ so: 200 }), role: 'SP', position: null, fieldingWinPct: null }),
    );
    expect(got.every((a) => a.side !== 'batter')).toBe(true);
  });
});

describe('年度 MVP', () => {
  it('d 值不到門檻就沒有機會', () => {
    expect(rate({ d: cfg.mvp.min_d - 1 }, 'mvp')).toBe(0);
  });

  it('d 值越高機率越高', () => {
    expect(rate({ d: 12 }, 'mvp')).toBeGreaterThan(rate({ d: 7 }, 'mvp'));
  });

  it('鬼神級的 d 值必定入選', () => {
    expect(rate({ d: cfg.mvp.god_d }, 'mvp', 50)).toBe(1);
  });

  it('打席不足就沒有資格——再強也要先上場', () => {
    expect(rate({ d: 12, batting: bat({ pa: 100 }) }, 'mvp')).toBe(0);
  });

  it('後援投手的機率明顯低於先發', () => {
    const relief = rate({ d: 10, batting: null, pitching: pit({ role: 'RP', games: 60 }), role: 'RP' }, 'mvp');
    const starter = rate({ d: 10, batting: null, pitching: pit({ role: 'SP', ip: 180 }), role: 'SP' }, 'mvp');
    expect(relief).toBeLessThan(starter);
  });
});

describe('守備獎項', () => {
  it('守備勝率越高越容易拿金手套', () => {
    expect(rate({ fieldingWinPct: 0.68 }, 'gold_glove')).toBeGreaterThan(
      rate({ fieldingWinPct: 0.57 }, 'gold_glove'),
    );
  });

  it('守備勝率不到門檻就沒有機會', () => {
    expect(rate({ fieldingWinPct: 0.5 }, 'gold_glove')).toBe(0);
  });

  it('沒有登錄守位就沒有守備獎項', () => {
    expect(rate({ position: null, fieldingWinPct: null }, 'gold_glove')).toBe(0);
  });

  /** 判定看勝率而不是守備分的顯示數字——顯示尺度改了，得獎率不該跟著跑掉。 */
  it('守備王比金手套更難拿', () => {
    expect(rate({ fieldingWinPct: 0.65 }, 'defense_king')).toBeLessThan(
      rate({ fieldingWinPct: 0.65 }, 'gold_glove'),
    );
  });
});

describe('紀錄的形狀', () => {
  it('每筆都帶年份、體系、層級與投打側', () => {
    for (const a of annualAwards(new World('shape'), ctx({ d: 20 }))) {
      expect(a.year).toBe(2030);
      expect(a.org).toBe('CPBL');
      expect(a.level).toBe('CPBL1');
      expect(['pitcher', 'batter', 'both']).toContain(a.side);
    }
  });

  it('countAwards 數得出同一個獎拿過幾座——這正是結構化的理由', () => {
    const records: AwardRecord[] = [
      { year: 2030, org: 'CPBL', level: 'CPBL1', code: 'mvp', name: '年度MVP', side: 'both' },
      { year: 2031, org: 'CPBL', level: 'CPBL1', code: 'mvp', name: '年度MVP', side: 'both' },
      { year: 2032, org: 'CPBL', level: 'CPBL1', code: 'hr_king', name: '全壘打王', side: 'batter' },
    ];
    expect(countAwards(records, 'mvp')).toBe(2);
    expect(countAwards(records, 'hr_king')).toBe(1);
    expect(countAwards(records, 'none')).toBe(0);
  });

  it('相同種子產生完全相同的獎項', () => {
    const a = annualAwards(new World('same'), ctx({ d: 8 }));
    const b = annualAwards(new World('same'), ctx({ d: 8 }));
    expect(a).toEqual(b);
  });

  it('沒有任何成績時不會發獎', () => {
    const got = annualAwards(
      new World('empty'),
      ctx({ d: -20, batting: null, pitching: null, role: null, position: null, fieldingWinPct: null }),
    );
    expect(got).toEqual([]);
  });
});
