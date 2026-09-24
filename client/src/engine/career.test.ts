import { describe, expect, it } from 'vitest';
import { dataKeys, hallOfFame as cfg, leagues } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import type { AwardRecord } from './awards.ts';
import { proBaseline } from './metrics.ts';
import {
  applyTierFloors,
  awardPoints,
  difficultyOf,
  evaluateMilestones,
  seasonPoints,
  signatureRoles,
  summarizeCareer,
  tenureDeduction,
  tierThresholds,
  tierLabel,
  tierOf,
  type SeasonRecord,
} from './career.ts';

const NONE = { win: 0, loss: 0 };

const bat = (over: Partial<BattingLine> = {}): BattingLine => ({
  games: 120, starts: 120, pa: 500, ab: 450, runs: 60, hits: 130, double: 25, triple: 2, hr: 15,
  rbi: 70, bb: 45, ibb: 5, so: 80, sb: 10, cs: 4, hbp: 0, sac: 0,
  avg: 130 / 450, obp: 0.35, slg: 0.44,
  ...over,
});

const pitch = (over: Partial<PitchingLine> = {}): PitchingLine => ({
  games: 28, starts: 28, wins: 12, losses: 9, saves: 0, holds: 0, outs: 510, hits: 160,
  double: 32, triple: 3, runs: 70, er: 64, bb: 45, hbp: 6, so: 140, hr: 15, era: 3.39,
  ...over,
});

const season = (over: Partial<SeasonRecord> = {}): SeasonRecord => ({
  year: 2030,
  age: 24,
  org: 'CPBL',
  level: 'CPBL1',
  levelName: '中職一軍',
  team: '台中猛瑪',
  position: 'SS',
  pitcherRole: null,
  batting: bat(),
  pitching: null,
  injured: null,
  defenseRuns: 3,
  shares: { batting: { win: 12, loss: 8 }, pitching: NONE, fielding: { win: 2, loss: 1.5 } },
  lossPenalty: { batting: 0.8, pitching: 0.8, fielding: 0.8 },
  difficulty: 1,
  top: 'CPBL',
  seasonFactor: 1,
  salary: 0,
  bonus: 0,
  ...over,
});

const award = (code: string, org = 'CPBL'): AwardRecord => ({
  year: 2030,
  org,
  level: `${org}1`,
  code,
  name: code,
  side: 'both',
});

describe('difficultyOf', () => {
  it('基準 par 的係數是 1', () => {
    expect(difficultyOf(cfg.difficulty.baseline_par)).toBeCloseTo(1, 10);
  });

  it('聯盟越強係數越大——弱聯盟的份額會虛胖，係數把它壓回去', () => {
    expect(difficultyOf(59)).toBeGreaterThan(difficultyOf(44));
    expect(difficultyOf(34)).toBeLessThan(difficultyOf(44));
  });

  it('par 為 0 或負數時退回 1，不會炸開', () => {
    expect(difficultyOf(0)).toBe(1);
    expect(difficultyOf(-5)).toBe(1);
  });
});

describe('seasonPoints', () => {
  it('三個分段都算進去', () => {
    const only = seasonPoints(
      season({ shares: { batting: { win: 10, loss: 0 }, pitching: NONE, fielding: NONE } }),
    );
    const all = seasonPoints(
      season({
        shares: {
          batting: { win: 10, loss: 0 },
          pitching: { win: 5, loss: 0 },
          fielding: { win: 3, loss: 0 },
        },
      }),
    );
    expect(all).toBeCloseTo(only + 8, 10);
  });

  it('敗戰份額會扣分', () => {
    const clean = seasonPoints(
      season({ shares: { batting: { win: 10, loss: 0 }, pitching: NONE, fielding: NONE } }),
    );
    const messy = seasonPoints(
      season({ shares: { batting: { win: 10, loss: 10 }, pitching: NONE, fielding: NONE } }),
    );
    expect(messy).toBeLessThan(clean);
  });

  /** 這是 k 的定義：替代水準的球員原地踏步。 */
  it('勝率剛好落在零點的球季，貢獻是 0', () => {
    const k = 0.8;
    const p0 = k / (1 + k);
    const responsibility = 20;
    const record = season({
      shares: {
        batting: { win: responsibility * p0, loss: responsibility * (1 - p0) },
        pitching: NONE,
        fielding: NONE,
      },
      lossPenalty: { batting: k, pitching: k, fielding: k },
    });
    expect(seasonPoints(record)).toBeCloseTo(0, 10);
  });

  it('低於零點的球季會倒扣——混得越久分越高被修掉了', () => {
    const record = season({
      shares: { batting: { win: 4, loss: 20 }, pitching: NONE, fielding: NONE },
      lossPenalty: { batting: 0.8, pitching: 0.8, fielding: 0.8 },
    });
    expect(seasonPoints(record)).toBeLessThan(0);
  });

  it('難度係數整段放大或縮小', () => {
    const base = seasonPoints(season({ difficulty: 1 }));
    expect(seasonPoints(season({ difficulty: 1.8 }))).toBeCloseTo(base * 1.8, 10);
  });
});

describe('里程碑', () => {
  it('逐級累進——達到第二級的人同時拿到第一級的分', () => {
    const one = evaluateMilestones('league', bat({ hits: 1000 }), null);
    const two = evaluateMilestones('league', bat({ hits: 1500 }), null);
    expect(two.points).toBeGreaterThan(one.points);
  });

  it('沒達到第一級就沒有分', () => {
    expect(evaluateMilestones('league', bat({ hits: 499 }), null).points).toBe(0);
  });

  // 級距兩邊同一個 step，只有起算階不同：500 安在聯盟算一級，在生涯還不算。
  it('生涯的門高一階，但級距和聯盟一樣', () => {
    expect(evaluateMilestones('career', bat({ hits: 500 }), null).points).toBe(0);
    expect(evaluateMilestones('league', bat({ hits: 500 }), null).points).toBeGreaterThan(0);
    expect(evaluateMilestones('career', bat({ hits: 1000 }), null).reached).toContain('1000 安打');
  });

  /** 舊制會把 143 場聯盟的 2000 安門檻放大成 2383 支，玩家得多打 383 支才算數。 */
  it('門檻照表面數字，不乘聯盟賽程係數', () => {
    const r = evaluateMilestones('league', bat({ hits: 2000 }), null);
    expect(r.reached).toContain('2000 安打');
    const under = evaluateMilestones('league', bat({ hits: 1999 }), null);
    expect(under.points).toBeLessThan(r.points);
  });

  it('只列最高的那一級，但分數是累加的', () => {
    const r = evaluateMilestones('league', bat({ hits: 2000, hr: 0, rbi: 0, sb: 0 }), null);
    expect(r.reached.filter((s) => s.includes('安打'))).toHaveLength(1);
    expect(r.reached[0]).toContain('2000');
  });

  it('投手的里程碑不看打擊數據', () => {
    const r = evaluateMilestones('league', null, pitch({ wins: 200 }));
    expect(r.reached.some((s) => s.includes('勝投'))).toBe(true);
    expect(r.reached.some((s) => s.includes('安打'))).toBe(false);
  });

  it('生涯里程碑跨聯盟通算，門檻同樣照表面數字', () => {
    const r = evaluateMilestones('career', bat({ hits: 2000 }), null);
    expect(r.points).toBeGreaterThan(0);
    expect(r.reached.some((s) => s.startsWith('2000 '))).toBe(true);
  });
});

describe('分級', () => {
  it('由高到低比對門檻', () => {
    const v = cfg.tier_thresholds.values;
    expect(tierOf((v[0] ?? 0) + 10)).toBe(0);
    expect(tierOf(v[0] ?? 0)).toBe(0);
    expect(tierOf((v[0] ?? 0) - 1)).toBe(1);
    expect(tierOf(-100)).toBe(v.length);
  });

  it('五帶都有名字，最低帶是過客', () => {
    expect(cfg.tier_thresholds.labels).toHaveLength(5);
    expect(tierLabel(4)).toBe('過客');
    expect(tierLabel(0)).toBe('名人堂');
  });

  /**
   * 保底拿掉了（2026-09-24）：獎項只加評價分，不再保證分級。保底讓每日先發膨脹到
   * 五成，而投手拿不到金手套與守備王，同樣的生涯野手比投手高一帶。
   */
  it('獎項不再保證分級——MVP、單項王、金手套都一樣', () => {
    for (const code of ['mvp', 'pitcher_of_year', 'hr_king', 'gold_glove', 'defense_king']) {
      expect(applyTierFloors(4, new Set([code]))).toBe(4);
    }
  });

  it('保底不會把已經更高的分級往下拉', () => {
    expect(applyTierFloors(0, new Set(['hr_king']))).toBe(0);
  });

  it('沒得過獎就不套保底', () => {
    expect(applyTierFloors(3, new Set(['all_star']))).toBe(3);
  });
});

describe('awardPoints', () => {
  it('MVP 比單項王值錢，單項王比明星賽值錢', () => {
    expect(awardPoints('mvp')).toBeGreaterThan(awardPoints('hr_king'));
    expect(awardPoints('hr_king')).toBeGreaterThan(awardPoints('all_star'));
  });

  it('沒設定的代碼給預設值', () => {
    expect(awardPoints('nope')).toBe(cfg.award_points.default);
  });
});

describe('summarizeCareer', () => {
  it('沒有任何紀錄時回傳空的總結，不炸開', () => {
    const s = summarizeCareer([], []);
    expect(s.leagues).toEqual([]);
    expect(s.representative).toBeNull();
    expect(s.bestTier).toBe(cfg.tier_thresholds.values.length);
  });

  it('國際賽通算把每一屆加起來，而且不混進聯盟通算', () => {
    const intl = [
      { year: 2031, age: 25, tournament: '世界棒球經典賽', rank: '冠軍', mvp: false,
        batting: bat({ games: 7, pa: 30, hits: 10, hr: 2 }), pitching: null },
      { year: 2035, age: 29, tournament: '世界十二強', rank: '亞軍', mvp: true,
        batting: bat({ games: 6, pa: 25, hits: 8, hr: 1 }), pitching: null },
    ];
    const s = summarizeCareer([season()], [], 0, [], 0, intl);
    expect(s.internationalTotal.batting?.games).toBe(13);
    expect(s.internationalTotal.batting?.hr).toBe(3);
    expect(s.internationalTotal.pitching).toBeNull();
    // 聯盟那一份只有那一個球季，國際賽沒有滲進去。
    expect(s.topTotal.batting?.games).toBe(season().batting?.games);
  });

  it('沒打過國際賽就沒有通算', () => {
    const s = summarizeCareer([season()], []);
    expect(s.internationalTotal.batting).toBeNull();
    expect(s.internationalTotal.pitching).toBeNull();
  });

  /** 這是與 legacy 一致的關鍵決定。 */
  it('二軍成績不進評價分，但照樣通算顯示', () => {
    const withMinor = summarizeCareer(
      [season(), season({ level: 'CPBL2', levelName: '中職二軍', top: null })],
      [],
    );
    const topOnly = summarizeCareer([season()], []);
    expect(withMinor.leagues[0]?.score).toBeCloseTo(topOnly.leagues[0]?.score ?? 0, 10);
    expect(withMinor.minors).toHaveLength(1);
    expect(withMinor.minors[0]?.levelName).toBe('中職二軍');
  });

  it('每個頂級聯盟各算一份', () => {
    const s = summarizeCareer(
      [season(), season({ org: 'NPB', level: 'NPB1', levelName: '日職一軍', top: 'NPB' })],
      [],
    );
    expect(s.leagues).toHaveLength(2);
    expect(s.leagues.map((l) => l.org).sort()).toEqual(['CPBL', 'NPB']);
  });

  it('獎項只加進該聯盟的評價分', () => {
    const s = summarizeCareer(
      [season(), season({ org: 'NPB', level: 'NPB1', levelName: '日職一軍', top: 'NPB' })],
      [award('mvp', 'CPBL')],
    );
    expect(s.leagues.find((l) => l.org === 'CPBL')?.awardPoints).toBeGreaterThan(0);
    expect(s.leagues.find((l) => l.org === 'NPB')?.awardPoints).toBe(0);
  });

  it('帽徽是在該聯盟效力最久的球隊', () => {
    const s = summarizeCareer(
      [
        season({ team: 'A隊' }),
        season({ team: 'B隊' }),
        season({ team: 'B隊' }),
      ],
      [],
    );
    expect(s.leagues[0]?.capTeam).toBe('B隊');
  });

  it('代表聯盟取最佳分級，同分級取年資最長', () => {
    const s = summarizeCareer(
      [
        season(),
        season(),
        season({ org: 'NPB', level: 'NPB1', levelName: '日職一軍', top: 'NPB' }),
      ],
      [],
    );
    // 兩邊分數不同時，代表聯盟就是分級最好的那個
    expect(s.representative).not.toBeNull();
    expect(s.leagues.some((l) => l.org === s.representative?.org)).toBe(true);
  });

  it('生涯里程碑跨聯盟通算，但不進任何單一聯盟的評價分', () => {
    const many = Array.from({ length: 12 }, () => season({ batting: bat({ hits: 150 }) }));
    const split = [
      ...Array.from({ length: 6 }, () => season({ batting: bat({ hits: 150 }) })),
      ...Array.from({ length: 6 }, () =>
        season({ org: 'NPB', level: 'NPB1', levelName: '日職一軍', top: 'NPB', batting: bat({ hits: 150 }) }),
      ),
    ];
    const a = summarizeCareer(many, []);
    const b = summarizeCareer(split, []);
    // 通算安打數相同，因此生涯里程碑相同
    expect(b.careerMilestones).toEqual(a.careerMilestones);
    // 但分散在兩個聯盟時，單一聯盟的里程碑分數比較低
    expect(b.leagues[0]?.milestonePoints ?? 0).toBeLessThan(a.leagues[0]?.milestonePoints ?? 0);
  });

  it('所有一軍通算加總了每個頂級聯盟', () => {
    const s = summarizeCareer(
      [season(), season({ org: 'NPB', level: 'NPB1', levelName: '日職一軍', top: 'NPB' })],
      [],
    );
    expect(s.topTotal.batting?.hits).toBe(bat().hits * 2);
  });

  it('分級依評價分排序，分數最高的在前', () => {
    const s = summarizeCareer(
      [
        season(),
        season(),
        season(),
        season({ org: 'NPB', level: 'NPB1', levelName: '日職一軍', top: 'NPB' }),
      ],
      [],
    );
    expect(s.leagues[0]?.score).toBeGreaterThanOrEqual(s.leagues[1]?.score ?? 0);
  });

  it('純二軍生涯沒有代表聯盟，分級是最低帶', () => {
    const s = summarizeCareer([season({ level: 'CPBL2', levelName: '中職二軍', top: null })], []);
    expect(s.representative).toBeNull();
    expect(s.bestTier).toBe(cfg.tier_thresholds.values.length);
    expect(s.leagues).toEqual([]);
  });
});

describe('每座聯盟的頂級層級', () => {
  /**
   * `topLevel` 必須是真的查得到的層級代碼。
   *
   * 介面拿它去要聯盟平均。舊版是用 `org + '1'` 拼出來的，那只對中職、日職、
   * 韓職成立——墨聯的層級就叫 `LMB`、澳職叫 `ABL`、美職的頂級是 `MLB`，拼出來
   * 的 `LMB1` 不存在，`levelOf()` 直接拋錯，整個結算畫面變成一片空白。
   */
  it('六個體系的頂級層級都查得到', () => {
    let checked = 0;
    for (const level of dataKeys(leagues.levels)) {
      const info = leagues.levels[level];
      if (info?.top === undefined) continue;

      const record = season({ level, org: info.org, levelName: info.name, top: info.top });
      const summary = summarizeCareer([record], []);
      const league = summary.leagues[0];
      expect(league).toBeDefined();
      expect(league!.topLevel).toBe(level);
      // 這一行就是介面在做的事。查不到會拋錯。
      expect(() => proBaseline(league!.topLevel)).not.toThrow();
      checked++;
    }
    // 六個體系各一座頂級聯盟。跑不到就是這條測試什麼都沒驗到。
    expect(checked).toBe(6);
  });
});

describe('總冠軍的歸屬', () => {
  /**
   * 總冠軍是 awards 裡的一筆紀錄（code 為 championship），因此它跟其他獎項走同
   * 一條路：自動落在拿下它的那個聯盟，不必另外傳一個次數進來。
   */
  it('冠軍的點數加在拿下它的那個聯盟', () => {
    const plain = summarizeCareer([season()], []);
    const champ = summarizeCareer([season()], [award('championship')]);
    const gain = awardPoints('championship');
    expect(gain).toBeGreaterThan(0);
    expect(champ.leagues[0]!.awardPoints - plain.leagues[0]!.awardPoints).toBeCloseTo(gain);
  });

  it('在別的聯盟拿的冠軍不會加到這個聯盟', () => {
    const plain = summarizeCareer([season()], []);
    const elsewhere = summarizeCareer([season()], [award('championship', 'NPB')]);
    expect(elsewhere.leagues[0]!.awardPoints).toBeCloseTo(plain.leagues[0]!.awardPoints);
  });

  /**
   * 養成期的盃賽冠軍與國際賽同一個桶：只進總分。從前它加在**每一個**聯盟的榮譽
   * 分上，一個高中拿過三座盃的人，中職與日職兩本帳各自都多了那三座的分。
   */
  it('養成期的盃賽只進總分，不進任何聯盟', () => {
    const none = summarizeCareer([season()], [], 0);
    const two = summarizeCareer([season()], [], 2);
    expect(two.leagues[0]!.awardPoints).toBeCloseTo(none.leagues[0]!.awardPoints);
    expect(two.amateurTitlePoints).toBeCloseTo(2 * awardPoints('championship'));
    expect(two.totalScore - none.totalScore).toBeCloseTo(two.amateurTitlePoints);
  });
});

/** 引退後的代表守位（issue #25）。 */
describe('signatureRoles', () => {
  const at = (position: string | null, level = 'CPBL1', pitcherRole: SeasonRecord['pitcherRole'] = null) =>
    season({ position, level, pitcherRole });

  it('頂級聯盟守過最多季的那一個，不是最後一年', () => {
    const seasons = [...Array(6).fill(at('SS')), at('1B'), at('1B')];
    expect(signatureRoles(seasons).position).toBe('SS');
  });

  it('同樣多季取守備價值高的', () => {
    expect(signatureRoles([at('1B'), at('1B'), at('SS'), at('SS')]).position).toBe('SS');
    expect(signatureRoles([at('LF'), at('CF')]).position).toBe('CF');
  });

  it('二軍與小聯盟不算', () => {
    const seasons = [...Array(5).fill(at('SS', 'CPBL2')), at('3B'), at('3B')];
    expect(signatureRoles(seasons).position).toBe('3B');
  });

  it('投手定位同理', () => {
    const seasons = [...Array(10).fill(at(null, 'MLB', 'SP')), at(null, 'MLB', 'LR'), at(null, 'MLB', 'LR')];
    expect(signatureRoles(seasons).pitcherRole).toBe('SP');
    expect(signatureRoles([at(null, 'MLB', 'CP'), at(null, 'MLB', 'SP')]).pitcherRole).toBe('SP');
  });

  it('沒打過頂級聯盟就沒有代表守位', () => {
    expect(signatureRoles([at('SS', 'CPBL2')])).toEqual({ position: null, pitcherRole: null });
  });
});

/** 短球季聯盟的門檻打折（issue #31）：只動門檻，不動分數。 */
describe('各聯盟的分級門檻', () => {
  it('澳職與墨聯的門檻打折，其他聯盟共用原本那一組', () => {
    const base = cfg.tier_thresholds.values;
    expect(tierThresholds('CPBL')).toEqual(base);
    expect(tierThresholds('MLB')).toEqual(base);
    expect(tierThresholds('ABL')[0]).toBeLessThan((base[0] ?? 0) * 0.5);
    expect(tierThresholds('LMB')[0]).toBeLessThan(base[0] ?? 0);
    expect(tierThresholds('LMB')[0]).toBeGreaterThan(tierThresholds('ABL')[0] ?? 0);
  });

  it('同樣的分數在澳職進名人堂，在中職不一定', () => {
    const score = (tierThresholds('ABL')[0] ?? 0) + 1;
    expect(tierOf(score, 'ABL')).toBe(0);
    expect(tierOf(score, 'CPBL')).toBeGreaterThan(0);
  });
});

/** 年資未滿的級距扣分：像稅率級距，每日以下不扣、每日→明星輕扣、明星以上重扣。 */
describe('tenureDeduction', () => {
  const [hall = 0, star = 0, daily = 0] = tierThresholds('CPBL');

  it('大聯盟與滿十季的人不扣', () => {
    expect(tenureDeduction('MLB', 3, hall + 100)).toBe(0);
    expect(tenureDeduction('CPBL', 10, hall + 100)).toBe(0);
  });

  it('每日先發以下那一段不扣', () => {
    expect(tenureDeduction('CPBL', 5, daily)).toBe(0);
  });

  it('明星以上那一段扣得比每日→明星那一段重', () => {
    // 少 4 季：每日→明星那段扣 20%、明星以上那段扣 40%。
    const d = tenureDeduction('CPBL', 6, star + 100);
    expect(d).toBeCloseTo((star - daily) * 0.2 + 100 * 0.4, 6);
  });

  it('墨聯、澳職用自己打過折的門檻', () => {
    const [, lmbStar = 0, lmbDaily = 0] = tierThresholds('LMB');
    expect(tenureDeduction('LMB', 9, lmbStar)).toBeCloseTo((lmbStar - lmbDaily) * 0.05, 6);
  });
});

/** 完全沒出賽的球季（開 TJ、整季復健）不算他打了一季。 */
describe('沒出賽的球季不算季數', () => {
  it('聯盟季數只數有上場的年份', () => {
    const records = [
      season({ year: 2030 }),
      season({ year: 2031, batting: null, pitching: null, injured: 'rehab' }),
      season({ year: 2032 }),
    ];
    const s = summarizeCareer(records, []);
    expect(s.leagues[0]?.seasons).toBe(2);
  });

  it('出賽 0 場的成績列也不算', () => {
    const records = [season({ year: 2030 }), season({ year: 2031, batting: bat({ games: 0, pa: 0, ab: 0 }) })];
    expect(summarizeCareer(records, []).leagues[0]?.seasons).toBe(1);
  });
});
