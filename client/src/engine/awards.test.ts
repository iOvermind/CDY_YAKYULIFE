import { describe, expect, it } from 'vitest';
import { awards as cfg } from '../data/index.ts';
import type { BattingLine } from './amateurStats.ts';
import {
  annualAwards,
  countAwards,
  winningLine,
  type AwardContext,
  type AwardRecord,
} from './awards.ts';
import { proBaseline, proBaselineAt } from './metrics.ts';
import { winnerAbilityFrom } from './rivalPool.ts';
import { World } from './rng.ts';
import type { ProPitchingLine } from './season.ts';

const SPREAD = 8.4;
/** 場次來自 leagues.json 的 level.games，不再有第二份副本。 */
const CPBL1_GAMES = 120;
const MLB_GAMES = 162;
const GAMES = CPBL1_GAMES;
/** 美職的體系代碼是 MiLB，MLB 只是最高的那一層——見 teams.json 的 _key_note。 */
const MLB = { level: 'MLB', org: 'MiLB', leagueGames: MLB_GAMES, spread: SPREAD };
const CPBL = { level: 'CPBL1', org: 'CPBL', leagueGames: CPBL1_GAMES, spread: SPREAD };
const BASE = proBaseline('CPBL1');

/** 找出某項獎的設定。 */
const titleOf = (code: string) => cfg.titles.list.find((t) => t.code === code)!;

const bat = (over: Partial<BattingLine> = {}): BattingLine => ({
  games: 115, pa: 480, ab: 430, runs: 70, hits: 120, double: 24, triple: 2, hr: 12,
  rbi: 60, bb: 45, ibb: 5, so: 80, sb: 10, cs: 4,
  avg: 120 / 430, obp: 0.34, slg: 0.42,
  ...over,
});

const pit = (over: Partial<ProPitchingLine> = {}): ProPitchingLine => ({
  role: 'SP', games: 26, starts: 26, wins: 12, losses: 8, saves: 0, holds: 0, outs: 480, hits: 150,
  runs: 65, er: 60, bb: 40, so: 120, era: 3.38,
  ...over,
});

const ctx = (over: Partial<AwardContext> = {}): AwardContext => ({
  year: 2030,
  org: 'CPBL',
  level: 'CPBL1',
  leagueGames: GAMES,
  spread: SPREAD,
  d: 3,
  team: '某隊',
  rookie: false,
  batting: bat(),
  pitching: null,
  role: null,
  position: 'SS',
  fieldingWinPct: 0.5,
  winShares: 8,
  battingWinShares: 5,
  ...over,
});

/** 跑很多次，回傳某個獎出現的比例——門檻線帶年度波動，單次結果沒有意義。 */
function rate(over: Partial<AwardContext>, code: string, runs = 400): number {
  let hit = 0;
  for (let i = 0; i < runs; i++) {
    if (annualAwards(new World(`aw-${i}`), ctx(over)).some((a) => a.code === code)) hit++;
  }
  return hit / runs;
}

describe('winningLine', () => {
  const batting = titleOf('batting_king');
  /** 門檻線的 d 不再寫死，是從對手池推出來的——見 ADR 0017。 */
  const dOf = (a: { pool?: string }, org: string) => winnerAbilityFrom(SPREAD, org, a.pool!);

  it('波動加在超出聯盟平均的幅度上，不是加在絕對值上', () => {
    const low = winningLine(batting, CPBL, 0)!;
    const high = winningLine(batting, CPBL, 1)!;
    const target = proBaselineAt('CPBL1', dOf(batting, 'CPBL')).avg;
    const excess = target - BASE.avg;
    expect(low).toBeCloseTo(BASE.avg + excess * (1 - batting.band), 10);
    expect(high).toBeCloseTo(BASE.avg + excess * (1 + batting.band), 10);
    // 擺盪幅度遠小於「絕對值 ±band」會造成的範圍
    expect(high - low).toBeLessThan(target * batting.band);
  });

  it('抽到中間值時就是門檻本身', () => {
    expect(winningLine(batting, CPBL, 0.5)).toBeCloseTo(
      proBaselineAt('CPBL1', dOf(batting, 'CPBL')).avg,
      10,
    );
  });

  it('率型門檻由 d 值推導，因此高於聯盟平均', () => {
    expect(winningLine(batting, CPBL, 0.5)!).toBeGreaterThan(BASE.avg);
  });

  it('累積型門檻依球季場次等比放大', () => {
    // 只能在同一個 org 內比：盜壘王已接上對手池（ADR 0017），org 不同 →
    // 競爭者人數不同 → d 不同，跨聯盟的門檻本來就不該是純場次等比。
    const sb = titleOf('steal_king');
    const short = winningLine(sb, CPBL, 0.5)!;
    const long = winningLine(sb, { ...CPBL, leagueGames: MLB_GAMES }, 0.5)!;
    // 不是嚴格等比：上壘數含敬遠，而敬遠數是整數（`intentionalWalksFrom` 取整），
    // 在兩個球季長度上各自捨入 → 殘留千分之二左右的偏差。
    expect(long / short).toBeCloseTo(MLB_GAMES / CPBL1_GAMES, 2);
  });

  it('全壘打王已改由對手池推導，不再是場次的線性放大', () => {
    const hr = titleOf('hr_king');
    const ratio = winningLine(hr, MLB, 0.5)! / winningLine(hr, CPBL, 0.5)!;
    // 大聯盟對手池更深（30 隊 × 9 人），門檻抬得比單純的場次比例更凶。
    expect(ratio).toBeGreaterThan(MLB_GAMES / CPBL1_GAMES);
  });

  it('防禦率的門檻低於聯盟平均——越低越好', () => {
    expect(winningLine(cfg.pitcher_of_year, CPBL, 0.5)!).toBeLessThan(BASE.era);
  });
});

describe('單項王', () => {
  const batting = titleOf('batting_king');
  const lineAt = (roll: number) => winningLine(batting, CPBL, roll)!;

  it('低於波動下緣一定拿不到', () => {
    expect(rate({ batting: bat({ avg: lineAt(0) - 0.001 }) }, 'batting_king')).toBe(0);
  });

  it('高於波動上緣一定拿得到——這就是鬼神必得，不必另設一道門檻', () => {
    expect(rate({ batting: bat({ avg: lineAt(1) + 0.001 }) }, 'batting_king')).toBe(1);
  });

  it('落在波動區間內時，成績越好機率越高', () => {
    const low = lineAt(0.25);
    const high = lineAt(0.75);
    expect(rate({ batting: bat({ avg: high }) }, 'batting_king')).toBeGreaterThan(
      rate({ batting: bat({ avg: low }) }, 'batting_king'),
    );
  });

  it('打席不足就沒有資格，成績再好也一樣', () => {
    const monster = lineAt(1) + 0.05;
    expect(rate({ batting: bat({ avg: monster, pa: 200 }) }, 'batting_king')).toBe(0);
    expect(rate({ batting: bat({ avg: monster, pa: 480 }) }, 'batting_king')).toBe(1);
  });

  it('救援王限終結者——中繼投手拿的是中繼王', () => {
    const sv = Math.ceil(winningLine(titleOf('save_king'), CPBL, 1)!) + 5;
    expect(
      rate({ pitching: pit({ role: 'CL', saves: sv }), role: 'CL' }, 'save_king'),
    ).toBeGreaterThan(0);
    expect(rate({ pitching: pit({ role: 'RP', saves: sv }), role: 'RP' }, 'save_king')).toBe(0);
    expect(rate({ pitching: pit({ role: 'SP', saves: sv }), role: 'SP' }, 'save_king')).toBe(0);
  });

  it('中繼王限中繼投手', () => {
    const hld = Math.ceil(winningLine(titleOf('hold_king'), CPBL, 1)!) + 5;
    expect(
      rate({ pitching: pit({ role: 'RP', holds: hld }), role: 'RP' }, 'hold_king'),
    ).toBeGreaterThan(0);
    expect(rate({ pitching: pit({ role: 'CL', holds: hld }), role: 'CL' }, 'hold_king')).toBe(0);
  });

  it('投手不會拿到打擊類的單項王', () => {
    const got = annualAwards(
      new World('p-only'),
      ctx({ batting: null, pitching: pit({ so: 300 }), role: 'SP', position: null, fieldingWinPct: null }),
    );
    expect(got.every((a) => a.side !== 'batter')).toBe(true);
  });

  it('門檻線隨年度變動——同樣的成績不會每年都拿到', () => {
    const mid = lineAt(0.5);
    const r = rate({ batting: bat({ avg: mid }) }, 'batting_king');
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });
});

describe('年度最佳投手', () => {
  const a = cfg.pitcher_of_year;
  const lineAt = (roll: number) => winningLine(a, CPBL, roll)!;

  it('限先發——後援投手拿不到', () => {
    const era = lineAt(0) - 0.5;
    expect(rate({ pitching: pit({ era, outs: 600 }), role: 'SP', batting: null }, 'pitcher_of_year')).toBe(1);
    expect(
      rate({ pitching: pit({ role: 'RP', era, outs: 600 }), role: 'RP', batting: null }, 'pitcher_of_year'),
    ).toBe(0);
  });

  it('局數不足該聯盟場次就沒有資格', () => {
    expect(
      rate({ pitching: pit({ era: 1.5, outs: 240 }), role: 'SP', batting: null }, 'pitcher_of_year'),
    ).toBe(0);
  });

  /**
   * 防禦率越低越好，因此門檻線的方向是反的：`roll` 越大，線壓得越低、那年
   * 越難拿。所以「一定拿不到」的界線在 roll = 0 那一端（最寬鬆的那年）。
   */
  it('防禦率高於最寬鬆的那條線就一定拿不到', () => {
    expect(
      rate(
        { pitching: pit({ era: lineAt(0) + 0.3, outs: 600 }), role: 'SP', batting: null },
        'pitcher_of_year',
      ),
    ).toBe(0);
  });

  it('roll 越大那年越難拿——防禦率的門檻線壓得更低', () => {
    expect(lineAt(1)).toBeLessThan(lineAt(0));
  });
});

describe('明星賽', () => {
  it('d 值越高入選率越高', () => {
    expect(rate({ d: 12 }, 'all_star')).toBeGreaterThan(rate({ d: -2 }, 'all_star'));
  });

  it('人氣球團有加成', () => {
    const pop = cfg.all_star.popularity_bonus;
    expect(rate({ d: 0, org: pop.league, team: pop.team }, 'all_star')).toBeGreaterThan(
      rate({ d: 0, team: '某隊' }, 'all_star'),
    );
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

describe('年度 MVP', () => {
  const lineAt = (roll: number) => winningLine(cfg.mvp, CPBL, roll)!;

  /** MVP 問的是「他今年打得多好」，不是「他多強」——因此看份額不看 d 值。 */
  it('份額低於最寬鬆的那條線就一定拿不到', () => {
    expect(rate({ winShares: lineAt(0) - 0.1, d: 30 }, 'mvp')).toBe(0);
  });

  it('份額高於最嚴的那條線就一定拿得到，即使 d 值不高', () => {
    expect(rate({ winShares: lineAt(1) + 0.1, d: 0 }, 'mvp')).toBe(1);
  });

  it('份額越高機率越高', () => {
    expect(rate({ winShares: lineAt(0.75) }, 'mvp')).toBeGreaterThan(
      rate({ winShares: lineAt(0.25) }, 'mvp'),
    );
  });

  it('打席不足就沒有資格——再有價值也要先站上場', () => {
    expect(rate({ winShares: lineAt(1) + 5, batting: bat({ pa: 100 }) }, 'mvp')).toBe(0);
  });

  it('投手靠局數就取得資格，不必有打席', () => {
    expect(
      rate(
        { winShares: lineAt(1) + 5, batting: null, pitching: pit({ outs: 540 }), role: 'SP' },
        'mvp',
      ),
    ).toBe(1);
  });

  it('門檻依球季場次等比放大', () => {
    expect(winningLine(cfg.mvp, MLB, 0.5)!).toBeGreaterThan(lineAt(0.5));
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
    expect(annualAwards(new World('same'), ctx({ d: 8 }))).toEqual(
      annualAwards(new World('same'), ctx({ d: 8 })),
    );
  });

  /**
   * 門檻線一律先抽再判資格。抽取次數若隨資格變動，同一個種子會因為某年打席
   * 差幾個而讓後面所有判定整串偏移。
   */
  it('抽取次數與資格無關', () => {
    const qualified = new World('draws');
    annualAwards(qualified, ctx({ batting: bat({ pa: 480 }) }));
    const short = new World('draws');
    annualAwards(short, ctx({ batting: bat({ pa: 100 }) }));
    // 兩者之後再抽一次，值應該相同——代表消耗掉的抽取次數一樣
    expect(qualified.stream('career').next()).toBe(short.stream('career').next());
  });

  it('沒有任何成績時不會發獎', () => {
    expect(
      annualAwards(
        new World('empty'),
        ctx({ d: -20, batting: null, pitching: null, role: null, position: null, fieldingWinPct: null }),
      ),
    ).toEqual([]);
  });
});
