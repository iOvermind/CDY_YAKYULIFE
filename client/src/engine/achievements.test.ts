import { describe, expect, it } from 'vitest';
import { achievements as cfg, amateur } from '../data/index.ts';
import type { BattingLine } from './amateurStats.ts';
import {
  cabinetSections,
  evaluateAchievements,
  ladderAp,
  ladderTop,
  type AchievementContext,
} from './achievements.ts';
import { joinName } from './naming.ts';
import { evaluateMilestones, type CareerSummary, type LeagueCareer } from './career.ts';

const NONE = { win: 0, loss: 0 };

const bat = (over: Partial<BattingLine> = {}): BattingLine => ({
  games: 0, starts: 0, pa: 0, ab: 0, runs: 0, hits: 0, double: 0, triple: 0, hr: 0,
  rbi: 0, bb: 0, ibb: 0, so: 0, sb: 0, cs: 0, hbp: 0, sac: 0, avg: 0, obp: 0, slg: 0,
  ...over,
});

const league = (over: Partial<LeagueCareer> = {}): LeagueCareer =>
  ({
    org: 'CPBL',
    orgName: '中職',
    topLevel: 'CPBL1',
    seasons: 12,
    batting: null,
    pitching: null,
    defenseRuns: 0,
    shares: NONE,
    sharesByPart: { batting: NONE, pitching: NONE, fielding: NONE },
    sharePoints: 0,
    awardPoints: 0,
    milestonePoints: 0,
    score: 0,
    tier: 3,
    tierLabel: '替補',
    milestones: [],
    capTeam: '',
    ...over,
  }) as unknown as LeagueCareer;

const summary = (over: Partial<CareerSummary> = {}): CareerSummary =>
  ({
    seasons: [],
    amateurSeasons: [],
    leagues: [],
    minors: [],
    topTotal: { batting: null, pitching: null },
    minorTotal: { batting: null, pitching: null },
    totalScore: 0,
    careerMilestones: [],
    internationalScore: 0,
    representative: null,
    bestTier: cfg.categories.tier.by_tier.length - 1,
    ...over,
  }) as unknown as CareerSummary;

const ctx = (over: Partial<AchievementContext> = {}): AchievementContext => ({
  summary: summary(),
  awards: [],
  traits: new Set<string>(),
  traitNames: new Map<string, string>(),
  honors: [],
  halls: [],
  firstCareer: false,
  spouses: [],
  unlocked: new Set<string>(),
  ...over,
});

describe('累積成就', () => {
  // 階梯就是里程碑的級距，同一份生成規則（見 ADR 0031）。
  const cum = cfg.categories.cumulative;
  const spec = cum.rungs['hits']!;
  // 生涯從第二階起算，級距與聯盟同一個 step。
  const firstRung = cum.first_rung.career;
  const first = spec.step * firstRung;
  const second = spec.step * (firstRung + 1);

  it('一段真的失敗的生涯就是拿零分', () => {
    // 生涯的第一階刻意拉高：養出一個廢物不該有回報。
    const poor = summary({ topTotal: { batting: bat({ hits: first - 1 }), pitching: null } });
    const got = evaluateAchievements(ctx({ summary: poor }));
    expect(got.list.filter((a) => a.id.startsWith('cum:career:hits'))).toHaveLength(0);
  });

  it('跨過幾階就給幾點，每階同價——AP 是線性的，但清單上只列最高的那一階', () => {
    const good = summary({ topTotal: { batting: bat({ hits: second }), pitching: null } });
    const rows = evaluateAchievements(ctx({ summary: good })).list.filter((a) =>
      a.id.startsWith('cum:career:hits'),
    );
    expect(rows).toHaveLength(1);
    // 兩階，每階 spec.points——不是 n×points 的平方累加，那一套留給生涯評價分。
    expect(rows[0]?.points).toBe(spec.points * 2);
    expect(rows[0]?.name).toContain(String(second));
  });

  it('AP 封在第五階，但階梯本身不封頂——紀錄照爬，只是不再多給錢', () => {
    const cap = cum.ap_max_rungs;
    const far = spec.step * (firstRung + cap + 3);
    const row = evaluateAchievements(
      ctx({ summary: summary({ topTotal: { batting: bat({ hits: far }), pitching: null } }) }),
    ).list.find((a) => a.id.startsWith('cum:career:hits'));
    expect(row?.points).toBe(spec.points * cap);
    // 顯示的仍然是他真正走到的那一階。
    expect(row?.id).toBe(`cum:career:hits:${far}`);
  });

  it('生涯評價分不受 AP 封頂影響——那是兩把不同的尺', () => {
    const cap = cum.ap_max_rungs;
    const far = spec.step * (firstRung + cap + 3);
    const near = spec.step * (firstRung + cap);
    const score = (hits: number) => evaluateMilestones('career', bat({ hits }), null).points;
    expect(score(far)).toBeGreaterThan(score(near));
  });

  it('不足一階的餘數不算，顯示的是走到的那一階', () => {
    // 4200 安顯示 4000 安：手寫表格的結尾不該變成天花板。
    const over = summary({ topTotal: { batting: bat({ hits: second + 1 }), pitching: null } });
    const row = evaluateAchievements(ctx({ summary: over })).list.find((a) =>
      a.id.startsWith('cum:career:hits'),
    );
    expect(row?.id).toBe(`cum:career:hits:${second}`);
  });

  it('上一段生涯爬過的階不再給分，只補新爬上來的那幾階', () => {
    const good = summary({ topTotal: { batting: bat({ hits: second }), pitching: null } });
    const row = evaluateAchievements(
      ctx({ summary: good, unlocked: new Set([`cum:career:hits:${first}`]) }),
    ).list.find((a) => a.id.startsWith('cum:career:hits'));
    // 只拿第二階，不是從第一階重新加總。
    expect(row?.points).toBe(spec.points);
  });

  it('各聯盟各算一份，另外再算一份一軍通算', () => {
    const leagueFirst = spec.step * cum.first_rung.league;
    const s = summary({
      leagues: [league({ batting: bat({ hits: leagueFirst }) })],
      topTotal: { batting: bat({ hits: first }), pitching: null },
    });
    const ids = evaluateAchievements(ctx({ summary: s })).list.map((a) => a.id);
    expect(ids).toContain(`cum:CPBL:hits:${leagueFirst}`);
    expect(ids).toContain(`cum:career:hits:${first}`);
  });

  // 同一階在成就櫃和生涯里程碑卡上得長成同一個樣子，否則玩家會以為那是兩件事。
  it('成就櫃和里程碑卡的階名是同一份', () => {
    const s = summary({ topTotal: { batting: bat({ hits: first }), pitching: null } });
    const tile = evaluateAchievements(ctx({ summary: s })).list.find((a) =>
      a.id.startsWith('cum:career:hits'),
    );
    const [milestone] = evaluateMilestones('career', bat({ hits: first }), null).reached;
    expect(milestone).toBeDefined();
    expect(tile?.name.endsWith(milestone!)).toBe(true);
  });
});

describe('同一項成就只給一次 AP', () => {
  const spec = cfg.categories.cumulative.rungs['hits']!;
  const hits = spec.step * cfg.categories.cumulative.first_rung.career;
  const s = summary({ topTotal: { batting: bat({ hits }), pitching: null } });

  it('已經領過的仍然列在清單上，但不再計分', () => {
    const first = evaluateAchievements(ctx({ summary: s }));
    expect(first.points).toBeGreaterThan(0);

    const again = evaluateAchievements(
      ctx({ summary: s, unlocked: new Set(first.list.map((a) => a.id)) }),
    );
    // 這一生做到的事還是要看得到。
    expect(again.list).toHaveLength(first.list.length);
    expect(again.newly).toHaveLength(0);
    expect(again.points).toBe(0);
  });
});

describe('同一項賽事只留最高的名次', () => {
  const wbsc = (rank: string) => joinName(amateur.international.honor_prefix, '世界棒球經典賽', rank);

  it('冠亞軍都拿過只出現一格，點數是冠軍的', () => {
    const got = evaluateAchievements(ctx({ honors: [wbsc('亞軍'), wbsc('冠軍')] }));
    const rows = got.list.filter((a) => a.id.startsWith('intl:'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(wbsc('冠軍'));
  });

  it('榮譽字串不帶年份——帶了的話每一年都會被當成新解鎖，AP 無限刷', () => {
    const got = evaluateAchievements(ctx({ honors: [wbsc('冠軍')] }));
    expect(got.list[0]?.id).not.toMatch(/\d{4}/);
  });
});

describe('獎項', () => {
  it('每一種獎各算一項，不論拿過幾座', () => {
    const mvp = (year: number) => ({
      year,
      org: 'CPBL',
      level: 'CPBL1',
      code: 'mvp',
      name: '年度MVP',
      side: 'both' as const,
    });
    const got = evaluateAchievements(ctx({ awards: [mvp(2030), mvp(2031), mvp(2032)] }));
    const rows = got.list.filter((a) => a.id.startsWith('award:'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.points).toBe(cfg.categories.award.by_code['mvp']);
  });
});

describe('生涯分級', () => {
  it('只給最高的那一級，點數是這一級以下每一級的總和', () => {
    const hof = summary({ bestTier: 0 });
    const rows = evaluateAchievements(ctx({ summary: hof })).list.filter((a) =>
      a.id.startsWith('tier:'),
    );
    expect(rows).toHaveLength(1);
    // 名人堂 = 4+3+2+1+0，階梯累加（見 ADR 0031）。
    expect(rows[0]?.points).toBe(
      cfg.categories.tier.by_tier.reduce((sum, v) => sum + v, 0),
    );
  });

  it('最低那一級不給分', () => {
    const last = cfg.categories.tier.by_tier.length - 1;
    const rows = evaluateAchievements(ctx({ summary: summary({ bestTier: last }) })).list.filter(
      (a) => a.id.startsWith('tier:'),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('姻緣', () => {
  it('每一位對象各算一項', () => {
    const got = evaluateAchievements(ctx({ spouses: ['王小美', '陳大文'] }));
    const rows = got.list.filter((a) => a.id.startsWith('marriage:'));
    expect(rows).toHaveLength(2);
    expect(got.points).toBe(cfg.categories.marriage.default * 2);
  });

  it('id 掛名字不掛年份——跨局娶到同一個人不再給點', () => {
    const first = evaluateAchievements(ctx({ spouses: ['王小美'] }));
    expect(first.list[0]?.id).not.toMatch(/\d{4}/);

    const again = evaluateAchievements(
      ctx({ spouses: ['王小美', '陳大文'], unlocked: new Set(first.list.map((a) => a.id)) }),
    );
    // 兩段婚姻都看得到，但只有新的那一位給 AP。
    expect(again.list.filter((a) => a.id.startsWith('marriage:'))).toHaveLength(2);
    expect(again.newly.map((a) => a.name)).toEqual(['陳大文']);
    expect(again.points).toBe(cfg.categories.marriage.default);
  });
});

describe('特性', () => {
  it('名字組出來的特性，聯盟不同就是不同成就', () => {
    const got = evaluateAchievements(
      ctx({
        traits: new Set(['legend']),
        traitNames: new Map([['legend', '中職歷史級球星']]),
      }),
    );
    const rows = got.list.filter((a) => a.id.startsWith('trait:'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('中職歷史級球星');
    // 名字進了 id——否則日職的那一座會被當成同一項而拿不到 AP。
    expect(rows[0]?.id).toBe('trait:legend:中職歷史級球星');

    const other = evaluateAchievements(
      ctx({
        traits: new Set(['legend']),
        traitNames: new Map([['legend', '日職歷史級球星']]),
        unlocked: new Set(rows.map((a) => a.id)),
      }),
    );
    expect(other.newly.map((a) => a.name)).toEqual(['日職歷史級球星']);
  });

  it('固定名字的特性照舊掛 id', () => {
    const got = evaluateAchievements(ctx({ traits: new Set(['smallschool']) }));
    const row = got.list.find((a) => a.id.startsWith('trait:'));
    expect(row?.id).toBe('trait:smallschool');
    expect(row?.name).not.toBe('smallschool');
  });
});

describe('名人堂', () => {
  it('可以多座並存', () => {
    const got = evaluateAchievements(ctx({ halls: ['中職', '日職'] }));
    const rows = got.list.filter((a) => a.id.startsWith('hall:'));
    expect(rows).toHaveLength(2);
    expect(got.points).toBe(cfg.categories.hall.default * 2);
  });
});

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
      tile('award:CPBL:mvp', cfg.categories.award.name, '中職 年度MVP'),
      tile('cum:CPBL:hits:0', cfg.categories.cumulative.name, '中職 安打'),
      // 大聯盟只有名人堂沒有獎項——名人堂併進「獎項」之後仍然要排在累積前面。
      tile('cum:MLB:hits:0', cfg.categories.cumulative.name, '大聯盟 安打'),
      tile('hall:大聯盟', cfg.categories.hall.name, '大聯盟 名人堂'),
    ]);
    const titles = (key: string) =>
      sections.find((s) => s.key === key)?.groups.map((g) => g.title);
    expect(titles('league:CPBL')).toEqual([cfg.categories.award.name, cfg.categories.cumulative.name]);
    expect(titles('league:MLB')).toEqual(titles('league:CPBL'));
  });
});

describe('階梯上不封頂', () => {
  // 安打：級距 500、每階 4 分。聯盟從第 1 階起算、生涯從第 2 階。
  const step = 500;
  const pts = 4;

  it('沒跨過第一階就什麼都沒有', () => {
    expect(ladderTop(step, pts, 1, 499)).toEqual({ top: null, points: 0 });
  });

  it('生涯的門高一階，級距不變', () => {
    // 500 安在聯盟是一階成就，在生涯還不算數。
    expect(ladderTop(step, pts, 2, 500)).toEqual({ top: null, points: 0 });
    expect(ladderTop(step, pts, 1, 500)).toEqual({ top: 500, points: 4 });
  });

  it('不足一階的餘數不算，走到哪一階就顯示哪一階', () => {
    expect(ladderTop(step, pts, 1, 4200).top).toBe(4000);
    expect(ladderTop(50, 3, 1, 380).top).toBe(350);
  });

  // 這是使用者回報的那一局：3600 安卡在 3000。手寫表格的結尾就是那道天花板。
  it('表格沒有結尾，階梯永遠往上生成', () => {
    expect(ladderTop(step, pts, 1, 3600).top).toBe(3500);
    expect(ladderTop(step, pts, 1, 99999).top).toBe(99500);
  });

  it('分數逐階累加，第 n 階給 n 倍——高處的分數也不封頂', () => {
    // 1..8 階 = 36 級，×4 分。
    expect(ladderTop(step, pts, 1, 4000).points).toBe(144);
    // 生涯扣掉第 1 階那 4 分。
    expect(ladderTop(step, pts, 2, 4000).points).toBe(140);
  });

  it('級距必須為正，否則階梯無從生成', () => {
    expect(() => ladderTop(0, pts, 1, 100)).toThrow();
  });
});

describe('AP 那一份：線性且封頂', () => {
  // 安打：級距 500、每階 4 分。AP 最多認 5 階。
  const step = 500;
  const pts = 4;
  const cap = 5;

  it('每階同價，不是第 n 階給 n 倍', () => {
    expect(ladderAp(step, pts, 1, cap, 500).points).toBe(4);
    expect(ladderAp(step, pts, 1, cap, 1000).points).toBe(8);
    expect(ladderAp(step, pts, 1, cap, 1500).points).toBe(12);
  });

  it('封在第五階：再打下去 AP 不再增加', () => {
    expect(ladderAp(step, pts, 1, cap, 2500).points).toBe(20);
    expect(ladderAp(step, pts, 1, cap, 50000).points).toBe(20);
  });

  it('封的是 AP 不是階梯——顯示的仍然是真正走到的那一階', () => {
    expect(ladderAp(step, pts, 1, cap, 50000).top).toBe(50000);
    expect(ladderAp(step, pts, 1, cap, 4200).top).toBe(4000);
  });

  it('生涯的門高一階，五階從那裡開始數', () => {
    // 生涯第 2..6 階是它的五階；1000 安（第 2 階）只拿一階的分。
    expect(ladderAp(step, pts, 2, cap, 500).points).toBe(0);
    expect(ladderAp(step, pts, 2, cap, 1000).points).toBe(4);
    expect(ladderAp(step, pts, 2, cap, 3000).points).toBe(20);
    expect(ladderAp(step, pts, 2, cap, 9000).points).toBe(20);
  });

  it('同一個數字上，AP 一定不高於評價分——線性封頂 vs 平方不封頂', () => {
    for (const value of [500, 1000, 2500, 4000, 20000]) {
      expect(ladderAp(step, pts, 1, cap, value).points).toBeLessThanOrEqual(
        ladderTop(step, pts, 1, value).points,
      );
    }
  });

  it('級距必須為正', () => {
    expect(() => ladderAp(0, pts, 1, cap, 100)).toThrow();
  });
});
