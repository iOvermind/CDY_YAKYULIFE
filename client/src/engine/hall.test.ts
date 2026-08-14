import { describe, expect, it } from 'vitest';
import { hallOfFame as cfg } from '../data/index.ts';
import type { LeagueCareer } from './career.ts';
import { runBallot, runBallots } from './hall.ts';
import { World } from './rng.ts';

const HOF = cfg.tier_thresholds.values[0]!;

const career = (over: Partial<LeagueCareer> = {}): LeagueCareer => ({
  org: 'CPBL',
  orgName: '中職',
  topLevel: 'CPBL1',
  seasons: 15,
  batting: null,
  pitching: null,
  defenseRuns: 0,
  shares: { win: 200, loss: 100 },
  sharesByPart: {
    batting: { win: 150, loss: 80 },
    pitching: { win: 0, loss: 0 },
    fielding: { win: 50, loss: 20 },
  },
  sharePoints: 120,
  awardPoints: 40,
  milestonePoints: 20,
  score: HOF + 10,
  tier: 0,
  tierLabel: '名人堂',
  milestones: [],
  capTeam: '台中猛瑪',
  ...over,
});

describe('runBallot', () => {
  it('名人堂帶的人入選', () => {
    const r = runBallot(new World('hof'), career());
    expect(r?.inducted).toBe(true);
    expect(r?.votes).toBeGreaterThan(0);
  });

  it('得票率不低於門檻也不超過上限', () => {
    for (let i = 0; i < 200; i++) {
      const r = runBallot(new World(`p-${i}`), career({ score: HOF + i * 3 }));
      expect(r!.percent).toBeGreaterThanOrEqual(cfg.vote_percent.floor);
      expect(r!.percent).toBeLessThanOrEqual(cfg.vote_percent.cap);
    }
  });

  it('評價分明顯超標才首輪入選', () => {
    const multiplier = cfg.first_ballot.multiplier['CPBL'] ?? cfg.first_ballot.default_multiplier;
    const barely = runBallot(new World('a'), career({ score: HOF + 1 }));
    const overwhelming = runBallot(new World('a'), career({ score: HOF * multiplier + 1 }));
    expect(barely?.firstBallot).toBe(false);
    expect(overwhelming?.firstBallot).toBe(true);
  });

  it('首輪入選的得票率高於等了幾年才上的', () => {
    const multiplier = cfg.first_ballot.multiplier['CPBL'] ?? cfg.first_ballot.default_multiplier;
    const first = runBallot(new World('v'), career({ score: HOF * multiplier + 1 }))!;
    const waited = runBallot(new World('v'), career({ score: HOF + 1 }))!;
    expect(first.ballotYear).toBe(1);
    expect(waited.ballotYear).toBeGreaterThan(1);
  });

  it('大聯盟的首輪門檻比中職嚴', () => {
    expect(cfg.first_ballot.multiplier['MLB']!).toBeGreaterThan(
      cfg.first_ballot.multiplier['CPBL']!,
    );
  });

  /** 差一點的人比差很多的人更難受，這是名人堂敘事裡最有重量的一種。 */
  it('明星帶的人年年入圍卻跨不過門檻', () => {
    const r = runBallot(new World('near'), career({ tier: 1, tierLabel: '明星', score: HOF - 30 }));
    expect(r?.inducted).toBe(false);
    expect(r?.ballotYear).toBeGreaterThanOrEqual(cfg.near_miss.tries.min);
    expect(r?.percent).toBeLessThan(cfg.vote_percent.floor);
    expect(r?.votes).toBe(0);
  });

  it('每日以下連候選都進不了——「從來沒被討論過」不該寫成「差一點就上」', () => {
    for (const tier of [2, 3, 4]) {
      expect(runBallot(new World('low'), career({ tier }))).toBeNull();
    }
  });

  it('沒有名人堂設定的體系不跑票選', () => {
    expect(runBallot(new World('x'), career({ org: 'MiLB' }))).toBeNull();
  });

  it('帽徽帶在結果上', () => {
    expect(runBallot(new World('cap'), career({ capTeam: '某隊' }))?.capTeam).toBe('某隊');
  });

  it('相同種子產生相同結果', () => {
    expect(runBallot(new World('same'), career())).toEqual(
      runBallot(new World('same'), career()),
    );
  });
});

describe('runBallots', () => {
  it('可多聯盟並存——三個聯盟的名人堂是三件事', () => {
    const results = runBallots(new World('multi'), [
      career({ org: 'CPBL' }),
      career({ org: 'NPB', orgName: '日職' }),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.inducted)).toBe(true);
  });

  it('沒資格的聯盟不會產生結果', () => {
    const results = runBallots(new World('mix'), [career(), career({ org: 'NPB', tier: 3 })]);
    expect(results).toHaveLength(1);
    expect(results[0]?.org).toBe('CPBL');
  });

  it('順序固定，與傳入的順序無關——否則同一個種子會給出不同結果', () => {
    const a = runBallots(new World('order'), [career({ org: 'CPBL' }), career({ org: 'MLB' })]);
    const b = runBallots(new World('order'), [career({ org: 'MLB' }), career({ org: 'CPBL' })]);
    expect(a.map((r) => r.org)).toEqual(b.map((r) => r.org));
    expect(a).toEqual(b);
  });

  it('全部沒資格時回傳空陣列', () => {
    expect(runBallots(new World('none'), [career({ tier: 4 })])).toEqual([]);
  });
});
