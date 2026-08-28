import { describe, expect, it } from 'vitest';
import { achievements as cfg, amateur } from '../data/index.ts';
import type { BattingLine } from './amateurStats.ts';
import { evaluateAchievements, type AchievementContext } from './achievements.ts';
import { joinName } from './naming.ts';
import type { CareerSummary, LeagueCareer } from './career.ts';

const NONE = { win: 0, loss: 0 };

const bat = (over: Partial<BattingLine> = {}): BattingLine => ({
  games: 0, pa: 0, ab: 0, runs: 0, hits: 0, double: 0, triple: 0, hr: 0,
  rbi: 0, bb: 0, ibb: 0, so: 0, sb: 0, cs: 0, avg: 0, obp: 0, slg: 0,
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
  // 階梯是等距的：`step` 一階，爬到 `max` 為止（見 ADR 0031）。
  const hits = cfg.categories.cumulative.rungs['hits']!;

  it('一段真的失敗的生涯就是拿零分', () => {
    // 第一階刻意拉高：養出一個廢物不該有回報。
    const poor = summary({ topTotal: { batting: bat({ hits: hits.step - 1 }), pitching: null } });
    const got = evaluateAchievements(ctx({ summary: poor }));
    expect(got.list.filter((a) => a.id.startsWith('cum:'))).toHaveLength(0);
    expect(got.points).toBe(0);
  });

  it('跨過幾階就給幾點，但清單上只列最高的那一階', () => {
    const good = summary({ topTotal: { batting: bat({ hits: hits.step * 2 }), pitching: null } });
    const rows = evaluateAchievements(ctx({ summary: good })).list.filter((a) =>
      a.id.startsWith('cum:career:hits'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.points).toBe(2);
    expect(rows[0]?.name).toContain(String(hits.step * 2));
  });

  it('各聯盟各算一份，另外再算一份一軍通算', () => {
    const s = summary({
      leagues: [league({ batting: bat({ hits: hits.step }) })],
      topTotal: { batting: bat({ hits: hits.step }), pitching: null },
    });
    const ids = evaluateAchievements(ctx({ summary: s })).list.map((a) => a.id);
    expect(ids).toContain(`cum:CPBL:hits:${hits.step}`);
    expect(ids).toContain(`cum:career:hits:${hits.step}`);
  });
});

describe('同一項成就只給一次 AP', () => {
  const hits = cfg.categories.cumulative.rungs['hits']!;
  const s = summary({ topTotal: { batting: bat({ hits: hits.step }), pitching: null } });

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
