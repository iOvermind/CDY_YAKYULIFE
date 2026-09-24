import { describe, expect, it } from 'vitest';
import { amateur } from '../data/index.ts';
import { initStandards } from './league.ts';
import {
  callUpBar,
  isConscripted,
  isEligible,
  isHonorRank,
  isPodium,
  lockYearsLeft,
  playTournament,
  nationalTeamWinPct,
  tournamentGames,
  tournamentInnings,
  tournamentOf,
  tournamentScore,
  winsMvp,
  unlocksAce,
  unlocksTaiwan,
} from './national.ts';
import { World } from './rng.ts';

const cfg = amateur.international;
const none = new Set<string>();

describe('賽事的年份', () => {
  it('經典賽與 12 強錯開兩年，因此每兩年有一次國際賽', () => {
    const years: number[] = [];
    for (let y = 2026; y <= 2040; y++) {
      if (tournamentOf(y, 'CPBL1') !== null) years.push(y);
    }
    expect(years).toEqual([2026, 2028, 2030, 2032, 2034, 2036, 2038, 2040]);
  });

  it('大聯盟球員不打 12 強——那個時間點他們在春訓', () => {
    expect(tournamentOf(2028, 'CPBL1')?.code).toBe('P12');
    expect(tournamentOf(2028, 'MLB')).toBeNull();
    // 經典賽照打。
    expect(tournamentOf(2026, 'MLB')?.code).toBe('WBC');
  });

  it('起始年之前沒有賽事', () => {
    expect(tournamentOf(2024, 'CPBL1')).toBeNull();
  });
});

describe('徵召資格', () => {
  const standards = initStandards();
  const bar = callUpBar(standards, 'none');

  it('門檻以中職為基準——旅外不會改變國籍', () => {
    // 日職球員用的是同一條線，不是日職的 par。
    expect(isEligible({ overall: bar, standards, seasonFactor: 1 , tier: 'none' })).toBe(true);
    expect(isEligible({ overall: bar - 1, standards, seasonFactor: 1 , tier: 'none' })).toBe(false);
  });

  it('傷缺大半季的人不會被徵召', () => {
    const factor = cfg.eligibility.min_season_factor;
    expect(isEligible({ overall: bar + 20, standards, seasonFactor: factor , tier: 'none' })).toBe(true);
    expect(isEligible({ overall: bar + 20, standards, seasonFactor: factor - 0.01 , tier: 'none' })).toBe(false);
  });
});

describe('體育署公文', () => {
  const lock = cfg.conscription.lock_years;

  it('還沒被徵召過的人，第一次就是強制', () => {
    expect(isConscripted(null, 2030)).toBe(true);
    expect(lockYearsLeft(null, 2030)).toBe(lock);
  });

  it('列管期內強制，期滿才能說不', () => {
    expect(isConscripted(2030, 2030 + lock - 1)).toBe(true);
    expect(isConscripted(2030, 2030 + lock)).toBe(false);
    expect(lockYearsLeft(2030, 2030 + lock)).toBe(0);
  });
});

describe('一屆賽會', () => {
  it('能力越高名次越好，但一個人扛不動一支國家隊', () => {
    const rate = (overall: number) => {
      const world = new World('tourney');
      let podiums = 0;
      for (let i = 0; i < 400; i++) {
        if (isPodium(playTournament(world, { overall, traits: none }).rankIndex)) podiums++;
      }
      return podiums / 400;
    };
    const weak = rate(cfg.power_bonus.base_overall);
    const strong = rate(cfg.power_bonus.base_overall + 30);
    expect(strong).toBeGreaterThan(weak);
    // 即使能力爆表，冠亞軍仍然是少數——加成上限只有 8 分。
    expect(strong).toBeLessThan(0.5);
  });

  it('東亞功夫有能力點保底，而且不增加受傷風險', () => {
    const world = new World('ace');
    const ace = new Set([cfg.intlace_effect.trait]);
    for (let i = 0; i < 200; i++) {
      const r = playTournament(world, { overall: 40, traits: ace });
      expect(r.points).toBeGreaterThanOrEqual(cfg.intlace_effect.min_points);
      expect(r.injuryNextSeason).toBe(cfg.intlace_effect.injury_next_season);
    }
  });

  it('沒有那個特性的人，打完一屆下季受傷風險上升', () => {
    const world = new World('tired');
    expect(playTournament(world, { overall: 55, traits: none }).injuryNextSeason).toBe(
      cfg.injury_next_season,
    );
  });

  it('今晚打老虎讓 MVP 機率加倍', () => {
    const rate = (traits: ReadonlySet<string>) => {
      const world = new World('mvp');
      let mvp = 0;
      let podium = 0;
      for (let i = 0; i < 800; i++) {
        const r = playTournament(world, { overall: 70, traits });
        if (isPodium(r.rankIndex)) {
          podium++;
          if (winsMvp({ roll: r.mvpRoll, rank: r.rank, winPct: 0.5, traits })) mvp++;
        }
      }
      return podium === 0 ? 0 : mvp / podium;
    };
    expect(rate(new Set([cfg.mvp.clutch_trait]))).toBeGreaterThan(rate(none));
  });

  describe('MVP：名次開門、成績決定機率', () => {
    const mvpRate = (rank: string, pct: number | null, traits = none) => {
      let hit = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        if (winsMvp({ roll: (i / n) * 100, rank, winPct: pct, traits })) hit++;
      }
      return hit / n;
    };

    it('打得越好機率越高', () => {
      expect(mvpRate('冠軍', 0.75)).toBeGreaterThan(mvpRate('冠軍', 0.5));
      expect(mvpRate('冠軍', 0.5)).toBeGreaterThan(mvpRate('冠軍', 0.315));
    });

    it('名次越高機率越高', () => {
      expect(mvpRate('冠軍', 0.5)).toBeGreaterThan(mvpRate('亞軍', 0.5));
      expect(mvpRate('亞軍', 0.5)).toBeGreaterThan(mvpRate('季軍', 0.5));
      expect(mvpRate('季軍', 0.5)).toBeGreaterThan(mvpRate('預賽出局', 0.5));
    });

    /** 這正是這條規則被改掉的原因：勝率 .315 的人不該有三成機率抱走 MVP。 */
    it('打得爛的冠軍隊球員機率被壓到一成以下', () => {
      expect(mvpRate('冠軍', 0.315)).toBeLessThan(0.1);
    });

    it('沒有成績就沒有 MVP', () => {
      expect(mvpRate('冠軍', null)).toBe(0);
    });

    it('機率夾在 100%——大場面倍率不會讓它破表', () => {
      const clutch = new Set([cfg.mvp.clutch_trait]);
      expect(mvpRate('冠軍', 1, clutch)).toBe(1);
    });
  });

  // 抽取次數與名次無關，否則同一個種子會因為某一屆差一名而讓後面整串偏移。
  it('不管名次如何，消耗的亂數一樣多', () => {
    const a = new World('drift');
    const b = new World('drift');
    playTournament(a, { overall: 20, traits: none });
    playTournament(b, { overall: 99, traits: none });
    expect(a.stream('career').next()).toBe(b.stream('career').next());
  });
});

describe('榮譽與計分', () => {
  it('前三名才進榮譽榜', () => {
    expect(isHonorRank('冠軍')).toBe(true);
    expect(isHonorRank('季軍')).toBe(true);
    expect(isHonorRank('複賽止步')).toBe(false);
  });

  it('名次越好分數越高，MVP 另外加', () => {
    expect(tournamentScore('冠軍', false)).toBeGreaterThan(tournamentScore('亞軍', false));
    expect(tournamentScore('冠軍', true)).toBeGreaterThan(tournamentScore('冠軍', false));
    expect(tournamentScore('預賽出局', false)).toBe(0);
  });
});

describe('特性的解鎖', () => {
  it('東亞功夫要徵召夠多次，而且真的站上過頒獎台', () => {
    const a = cfg.intlace_effect;
    expect(unlocksAce({ caps: a.min_caps, podiums: a.min_podiums - 1, traits: none })).toBe(false);
    expect(unlocksAce({ caps: a.min_caps - 1, podiums: a.min_podiums, traits: none })).toBe(false);
    expect(unlocksAce({ caps: a.min_caps, podiums: a.min_podiums, traits: none })).toBe(true);
    expect(unlocksAce({ caps: 9, podiums: 9, traits: new Set([a.trait]) })).toBe(false);
  });

  it('Team Taiwan 要超過指定次數，不是剛好', () => {
    const t = cfg.taiwan_trigger;
    expect(unlocksTaiwan({ caps: t.min_count, traits: none })).toBe(false);
    expect(unlocksTaiwan({ caps: t.min_count + 1, traits: none })).toBe(true);
  });
});


describe('一屆賽會的場次', () => {
  // 走得越遠打得越多。舊版是從一個固定區間亂數抽、完全不看名次，於是「複賽止步
  // 打了八場、亞軍只打五場」是必然會發生的事。
  it('場次隨名次遞減，而且冠亞軍同樣打滿決賽', () => {
    for (const side of ['batter', 'starter', 'reliever'] as const) {
      const games = [0, 1, 2, 3, 4].map((rank) => tournamentGames(rank, side));
      expect(games[0]).toBe(games[1]);
      for (let i = 1; i < games.length - 1; i++) {
        expect(games[i]!).toBeGreaterThanOrEqual(games[i + 1]!);
      }
      expect(games[0]!).toBeGreaterThan(games[4]!);
      // 被徵召卻一場都沒上，那不是成績，是另一件事。
      for (const g of games) expect(g).toBeGreaterThanOrEqual(1);
    }
  });

  it('野手打得比先發投手多——一屆賽會的先發只扛一兩場', () => {
    expect(tournamentGames(0, 'batter')).toBeGreaterThan(tournamentGames(0, 'starter'));
    expect(tournamentGames(0, 'reliever')).toBeGreaterThan(tournamentGames(0, 'starter'));
  });

  it('投球局數的期望值低於上限——上限是天花板，不是常態', () => {
    const i = tournamentInnings();
    expect(i.perStart).toBeLessThan(i.capPerStart);
    expect(i.perRelief).toBeLessThan(i.capPerRelief);
  });
});

describe('代表隊的預期勝率', () => {
  it('中職水準越高，代表隊在國際賽越強', () => {
    expect(nationalTeamWinPct(48)).toBeGreaterThan(nationalTeamWinPct(40));
  });

  /** 賽會的對手是各國一線球員，母國聯盟的 par 低於它，代表隊因此是弱隊。 */
  it('中職的 par 低於賽會水準，因此勝率低於五成', () => {
    expect(nationalTeamWinPct(44)).toBeLessThan(0.5);
    expect(nationalTeamWinPct(44)).toBeGreaterThan(0.3);
  });

  it('水準相同就是五成——那是畢氏公式的定義', () => {
    expect(nationalTeamWinPct(amateur.international.stats.par)).toBeCloseTo(0.5, 5);
  });
});

/** issue #29：國際賽程沒有那麼密集，前三名的先發投手一屆先發得到三場。 */
describe('國際賽的先發場次', () => {
  it('冠亞季軍三場、複賽兩場、預賽一場', () => {
    expect([0, 1, 2, 3, 4].map((r) => tournamentGames(r, 'starter'))).toEqual([3, 3, 3, 2, 1]);
  });
});
