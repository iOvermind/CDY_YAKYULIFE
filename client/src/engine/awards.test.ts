import { describe, expect, it } from 'vitest';
import { awards as cfg, leagues } from '../data/index.ts';
import type { BattingLine } from './amateurStats.ts';
import {
  annualAwards,
  countAwards,
  winningLine,
  type AwardContext,
  type AwardRecord,
} from './awards.ts';
import { proBaseline, proBaselineAt } from './metrics.ts';
import { World } from './rng.ts';
import type { ProPitchingLine } from './season.ts';

const SPREAD = 8.4;
/** 場次來自 leagues.json 的 level.games，不再有第二份副本。 */
const CPBL1_GAMES = 120;
const MLB_GAMES = 162;
const GAMES = CPBL1_GAMES;
/** 美職的體系代碼是 MLB，MLB 只是最高的那一層——見 teams.json 的 _key_note。 */
const MLB = { level: 'MLB', org: 'MLB', leagueGames: MLB_GAMES, spread: SPREAD };
const CPBL = { level: 'CPBL1', org: 'CPBL', leagueGames: CPBL1_GAMES, spread: SPREAD };
const BASE = proBaseline('CPBL1');

/** 找出某項獎的設定。 */
const titleOf = (code: string) => cfg.titles.list.find((t) => t.code === code)!;

const bat = (over: Partial<BattingLine> = {}): BattingLine => ({
  games: 115, starts: 115, pa: 480, ab: 430, runs: 70, hits: 120, double: 24, triple: 2, hr: 12,
  rbi: 60, bb: 45, ibb: 5, so: 80, sb: 10, cs: 4, hbp: 0, sac: 0,
  avg: 120 / 430, obp: 0.34, slg: 0.42,
  ...over,
});

const pit = (over: Partial<ProPitchingLine> = {}): ProPitchingLine => ({
  role: 'SP', games: 26, starts: 26, wins: 12, losses: 8, saves: 0, holds: 0, outs: 480, hits: 150,
  double: 30, triple: 3, runs: 65, er: 60, bb: 40, hbp: 6, so: 120, hr: 14, era: 3.38,
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
  /**
   * 門檻線的球員是**能力 75 的那個人**（d = 16），也就是成績錨點的定義。
   * 這取代了對手池推導：那條線算的是「聯盟最強的那個人」，推出來的 d 已經超過
   * 錨點線，於是門檻每年都貼著紀錄。
   */
  const dOf = (a: { d?: number }) => a.d!;

  it('波動加在超出聯盟平均的幅度上，不是加在絕對值上', () => {
    const low = winningLine(batting, CPBL, 0)!;
    const high = winningLine(batting, CPBL, 1)!;
    const target = proBaselineAt('CPBL1', dOf(batting)).avg;
    const excess = target - BASE.avg;
    expect(low).toBeCloseTo(BASE.avg + excess * (1 - batting.band), 10);
    expect(high).toBeCloseTo(BASE.avg + excess * (1 + batting.band), 10);
    // 擺盪幅度遠小於「絕對值 ±band」會造成的範圍
    expect(high - low).toBeLessThan(target * batting.band);
  });

  it('抽到中間值時就是門檻本身', () => {
    expect(winningLine(batting, CPBL, 0.5)).toBeCloseTo(
      proBaselineAt('CPBL1', dOf(batting)).avg,
      10,
    );
  });

  it('率型門檻由 d 值推導，因此高於聯盟平均', () => {
    expect(winningLine(batting, CPBL, 0.5)!).toBeGreaterThan(BASE.avg);
  });

  it('累積型門檻依球季場次等比放大', () => {
    const sb = titleOf('steal_king');
    const short = winningLine(sb, CPBL, 0.5)!;
    const long = winningLine(sb, { ...CPBL, leagueGames: MLB_GAMES }, 0.5)!;
    // 不是嚴格等比：打席裡有三個各自取整的整數欄位（敬遠、觸身球、犧牲打），
    // 在兩個球季長度上各自捨入，偏差因此比單一來源的年代大一些。等比是意圖，
    // 不是恆等式——真正該擋的是「短季聯盟的門檻沒有跟著縮」。
    expect(long / short).toBeCloseTo(MLB_GAMES / CPBL1_GAMES, 1);
  });

  /**
   * 門檻線是「錨點水準的那個人在這個聯盟打一整季」，因此跨聯盟的差別只剩球季
   * 長度——**d 在每個聯盟都是 16**，它指的是相對那個聯盟平均的高度，不是絕對能力。
   */
  it('全壘打王的門檻跨聯盟只差球季長度', () => {
    const hr = titleOf('hr_king');
    const ratio = winningLine(hr, MLB, 0.5)! / winningLine(hr, CPBL, 0.5)!;
    expect(ratio).toBeCloseTo(MLB_GAMES / CPBL1_GAMES, 1);
  });

  /** 錨點水準的一季就是單項王的門檻——這條線把兩個系統釘在一起。 */
  it('全壘打王的門檻就是「能力 80 的人打一整季」', () => {
    const hr = titleOf('hr_king');
    // 成績錨點的定義：能力 80 打一整季剛好打到錨點，d = 80 − 大聯盟 par。
    expect(hr.d).toBe(80 - leagues.levels['MLB']!.par);
    const line = winningLine(hr, MLB, 0.5)!;
    // 累積型的獎看的是季總量，而能力 80 的人一季被敬遠一百次上下——那些打席不進
    // 打數，所以季總量低於「每 600 打數」的錨點。門檻跟著往下，那是對的。
    expect(line).toBeGreaterThan(48);
    expect(line).toBeLessThan(70);
  });

  it('防禦率的門檻低於聯盟平均——越低越好', () => {
    expect(winningLine(cfg.pitcher_of_year, CPBL, 0.5)!).toBeLessThan(BASE.era);
  });

  it('賽揚的門檻比單項王低兩分——2.2 的球季該拿得到，不是五六季才一次', () => {
    expect(cfg.pitcher_of_year.d).toBe(80 - leagues.levels['MLB']!.par - 2);
    // 波動的鬆那一端必須放得過 2.2，否則那種球季永遠是擲骰。
    expect(winningLine(cfg.pitcher_of_year, MLB, 0)!).toBeGreaterThan(2.2);
  });

  it('年度最佳打者有門檻線——少了 d 的話這個獎永遠沒有人拿得到', () => {
    // winningLine 在 d 缺席時回傳 null，而 null 一律判定為沒拿到。
    expect(winningLine(cfg.batter_of_year, MLB, 0.5)).not.toBeNull();
  });

  it('MVP 的門檻只算打擊那一本——指定打擊也要構得到', () => {
    // 線曾經用守備補回去，於是變成「守備中庸的野手打滿整季」；而 OPS 高到能爭
    // MVP 的打者幾乎都被守位光譜推到一壘或指定打擊，守備份額接近 0。
    // 線是打擊那一本墊高一成（line_scale），而不是把守備整段補回去（約 ×1.3）：
    // 比年度最佳打者難一點——球員那一側吃三本帳——但指定打擊仍構得到。
    const line = winningLine(cfg.mvp, MLB, 0.5)!;
    const batter = winningLine(cfg.batter_of_year, MLB, 0.5)!;
    expect(line).toBeCloseTo(batter * (cfg.mvp.line_scale ?? 1), 10);
    expect(line).toBeGreaterThan(batter);
    expect(line).toBeLessThan(batter * 1.2);
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

  it('救援王與中繼王不限角色——數字說了算', () => {
    // 救援與中繼**不是角色專屬**，只是機率不同：終結者偶爾也拿中繼，布局與中繼
    // 偶爾也關門（比賽情境不由投手決定）。一個中繼投手真的救了三十場，那就是他的
    // 救援王——用角色去擋等於宣告那三十場不算數。
    const sv = Math.ceil(winningLine(titleOf('save_king'), CPBL, 1)!) + 5;
    for (const role of ['CP', 'SU', 'MR'] as const) {
      expect(rate({ pitching: pit({ role, saves: sv }), role }, 'save_king')).toBeGreaterThan(0);
    }
    const hld = Math.ceil(winningLine(titleOf('hold_king'), CPBL, 1)!) + 5;
    for (const role of ['SU', 'MR', 'CP'] as const) {
      expect(rate({ pitching: pit({ role, holds: hld }), role }, 'hold_king')).toBeGreaterThan(0);
    }
  });

  it('沒有救援就沒有救援王——角色不擋，數字擋', () => {
    expect(rate({ pitching: pit({ role: 'SP', saves: 0 }), role: 'SP' }, 'save_king')).toBe(0);
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

  /**
   * 對照組的先發不必是「必定拿到」：門檻線現在是**能力 80 那個人**的成績，而他
   * 的防禦率比舊制的能力 75 低了約 0.3（被安打那一格的斜率在錨點搬家時重解，頂端
   * 因此變陡）。比線低 0.5 已經不足以把機率推到 1。這一條要說的是牛棚拿不到，先發
   * 那一半只需要「幾乎一定拿到」。
   */
  it('限先發——牛棚拿不到', () => {
    const era = lineAt(0) - 0.5;
    expect(
      rate({ pitching: pit({ era, outs: 600 }), role: 'SP', batting: null }, 'pitcher_of_year'),
    ).toBeGreaterThan(0.9);
    for (const role of ['CP', 'SU', 'MR', 'LR'] as const) {
      expect(
        rate({ pitching: pit({ role, era, outs: 600 }), role, batting: null }, 'pitcher_of_year'),
      ).toBe(0);
    }
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
