import { describe, expect, it } from 'vitest';
import { season as cfg, teams as teamsData } from '../data/index.ts';
import {
  advanceLeague,
  averageChampionshipOdds,
  championshipOdds,
  fmtWinRate,
  initLeague,
  pickChampion,
  playerEffect,
  type LeagueTable,
} from './teams.ts';
import { World } from './rng.ts';

const CPBL = teamsData.leagues['CPBL']!;
const init = (seed: string) => initLeague(new World(seed), 'CPBL');

describe('initLeague', () => {
  it('聯盟裡的每支球隊都有勝率', () => {
    const table = init('a');
    expect(table.size).toBe(CPBL.length);
    for (const team of CPBL) expect(table.has(team.name)).toBe(true);
  });

  it('初始勝率落在設定的區間內', () => {
    for (let i = 0; i < 50; i++) {
      for (const t of init(`s${i}`).values()) {
        expect(t.winRate).toBeGreaterThanOrEqual(cfg.team_strength.initial.min);
        expect(t.winRate).toBeLessThanOrEqual(cfg.team_strength.initial.max);
      }
    }
  });

  it('相同種子產生完全相同的聯盟格局', () => {
    expect([...init('a')]).toEqual([...init('a')]);
  });

  it('不同種子產生不同的聯盟格局', () => {
    expect([...init('a')]).not.toEqual([...init('b')]);
  });

  it('同一個聯盟裡的球隊強弱有別——不是全部一樣', () => {
    const rates = [...init('a').values()].map((t) => t.winRate);
    expect(new Set(rates).size).toBeGreaterThan(1);
  });

  it('未知的聯盟直接炸開', () => {
    expect(() => initLeague(new World('a'), 'NOPE')).toThrow();
  });

  it('只消耗 career 流——球隊興衰是生涯層級的世界狀態', () => {
    const world = new World('a');
    initLeague(world, 'CPBL');
    const counts = world.drawCounts();
    expect(counts.career).toBeGreaterThan(0);
    expect(counts.season).toBe(0);
    expect(counts.growth).toBe(0);
  });
});

describe('advanceLeague', () => {
  const step = (seed: string, table: LeagueTable, over = {}) =>
    advanceLeague(new World(seed), table, over);

  it('勝率會逐年變動', () => {
    const before = init('a');
    const after = step('b', before);
    const changed = [...after.values()].some(
      (t) => t.winRate !== before.get(t.name)?.winRate,
    );
    expect(changed).toBe(true);
  });

  it('勝率永遠落在上下限之內', () => {
    let table = init('a');
    for (let y = 0; y < 30; y++) {
      table = step(`y${y}`, table);
      for (const t of table.values()) {
        expect(t.winRate).toBeGreaterThanOrEqual(cfg.team_strength.drift.clamp.min);
        expect(t.winRate).toBeLessThanOrEqual(cfg.team_strength.drift.clamp.max);
      }
    }
  });

  it('基準勝率不變——那是球隊的體質', () => {
    const before = init('a');
    let table: LeagueTable = before;
    for (let y = 0; y < 10; y++) table = step(`y${y}`, table);
    for (const t of table.values()) {
      expect(t.baseline).toBe(before.get(t.name)?.baseline);
    }
  });

  it('長期來看強隊仍然是強隊——回歸的是自己的體質，不是聯盟平均', () => {
    let table = init('a');
    const sorted = [...table.values()].sort((a, b) => b.baseline - a.baseline);
    const best = sorted[0]!.name;
    const worst = sorted[sorted.length - 1]!.name;

    let bestSum = 0;
    let worstSum = 0;
    const years = 40;
    for (let y = 0; y < years; y++) {
      table = step(`y${y}`, table);
      bestSum += table.get(best)?.winRate ?? 0;
      worstSum += table.get(worst)?.winRate ?? 0;
    }
    expect(bestSum / years).toBeGreaterThan(worstSum / years);
  });

  /**
   * **玩家的貢獻是零和的。** 他讓自己的球隊多贏，那些勝場只能從別人身上拿——
   * 平均勝率每年都是 .500，所以貢獻加上去之後平移會把全聯盟一起壓回來，其他
   * 球隊各讓出 `貢獻 ÷ 隊數`。他自己淨賺 `貢獻 × (1 − 1/隊數)`。
   */
  it('玩家的貢獻是零和的——自己多贏就是別人少贏', () => {
    const before = init('a');
    const team = CPBL[0]!.name;
    const effect = 0.05;
    const withPlayer = step('b', before, { playerTeam: team, playerEffect: effect });
    const without = step('b', before);

    const gain = (withPlayer.get(team)?.winRate ?? 0) - (without.get(team)?.winRate ?? 0);
    expect(gain).toBeCloseTo(effect * (1 - 1 / CPBL.length), 6);

    for (const other of CPBL.slice(1)) {
      const delta =
        (withPlayer.get(other.name)?.winRate ?? 0) - (without.get(other.name)?.winRate ?? 0);
      expect(delta).toBeCloseTo(-effect / CPBL.length, 6);
    }
  });

  it('相同種子與相同輸入產生相同結果', () => {
    const before = init('a');
    expect([...step('b', before)]).toEqual([...step('b', before)]);
  });
});

describe('playerEffect', () => {
  it('與聯盟同水準時沒有貢獻', () => {
    expect(playerEffect(50, 50)).toBe(0);
  });

  it('能力越高貢獻越大', () => {
    expect(playerEffect(60, 50)).toBeGreaterThan(playerEffect(55, 50));
  });

  it('上下限壓得很窄——再強的球員也翻不了一支爛隊', () => {
    expect(playerEffect(200, 50)).toBe(cfg.team_strength.player_effect.max);
    expect(playerEffect(0, 50)).toBe(cfg.team_strength.player_effect.min);
    expect(cfg.team_strength.player_effect.max).toBeLessThan(0.1);
  });
});

describe('championshipOdds', () => {
  it('勝率越高奪冠機率越高', () => {
    const table = init('a');
    const sorted = [...table.values()].sort((a, b) => b.winRate - a.winRate);
    expect(championshipOdds(table, sorted[0]!.name)).toBeGreaterThan(
      championshipOdds(table, sorted[sorted.length - 1]!.name),
    );
  });

  it('全聯盟的機率加起來就是 1——每年恰好有一支球隊奪冠', () => {
    let table = init('a');
    for (let y = 0; y < 30; y++) {
      table = advanceLeague(new World(`sum-y${y}`), table);
      let total = 0;
      for (const t of table.values()) total += championshipOdds(table, t.name);
      // 夾完照比例縮放回 1，所以這裡要的是等於，不是「大致」。
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it('強隊的優勢被放大——不是勝率的線性換算', () => {
    const table = init('a');
    const sorted = [...table.values()].sort((a, b) => b.winRate - a.winRate);
    const top = sorted[0]!;
    const bottom = sorted[sorted.length - 1]!;
    const rateRatio = top.winRate / bottom.winRate;
    const oddsRatio =
      championshipOdds(table, top.name) / championshipOdds(table, bottom.name);
    expect(oddsRatio).toBeGreaterThan(rateRatio);
  });

  it('不在聯盟裡的球隊沒有機率', () => {
    expect(championshipOdds(init('a'), '不存在的球隊')).toBe(0);
  });

  /**
   * 上下限是隊數的函數：上限 `1/隊數^0.5`、下限 `1/隊數^1.75`。縮放回 1 之後仍
   * 然可能有極小的越界（夾與縮放來回收斂），所以留一點容差。
   */
  it('機率不會超出該聯盟的上下限', () => {
    const c = cfg.team_strength.championship;
    let table = init('a');
    const cap = Math.pow(table.size, -c.cap_exponent);
    const floor = Math.pow(table.size, -c.floor_exponent);
    for (let y = 0; y < 30; y++) {
      table = advanceLeague(new World(`y${y}`), table);
      for (const t of table.values()) {
        const odds = championshipOdds(table, t.name);
        expect(odds).toBeGreaterThanOrEqual(floor * 0.999);
        expect(odds).toBeLessThanOrEqual(cap * 1.001);
      }
    }
  });

  it('平均奪冠率就是隊數的倒數', () => {
    const table = init('a');
    expect(averageChampionshipOdds(table)).toBeCloseTo(1 / table.size);
  });

  /**
   * 每一年的全聯盟平均勝率必然是 .500——封閉聯盟裡每一勝都是別人的一敗。
   */
  it('每一年的全聯盟平均勝率是 .500', () => {
    let table = init('a');
    {
      // 開局那一年也算——它用體質當勝率，體質的平均同樣必須是 .500。
      const rates = [...table.values()].map((t) => t.winRate);
      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      expect(mean).toBeCloseTo(cfg.team_strength.drift.target_mean, 6);
    }
    for (let y = 0; y < 30; y++) {
      table = advanceLeague(new World(`mean-y${y}`), table);
      const rates = [...table.values()].map((t) => t.winRate);
      const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
      expect(mean).toBeCloseTo(cfg.team_strength.drift.target_mean, 6);
    }
  });

  describe('pickChampion', () => {
    it('抽出來的一定是聯盟裡的球隊', () => {
      const table = init('a');
      for (let i = 0; i < 50; i++) {
        const champ = pickChampion(new World(`champ-${i}`), table);
        expect(champ).not.toBeNull();
        expect(table.has(champ!)).toBe(true);
      }
    });

    it('抽出來的分布貼著奪冠機率——強隊真的比較常拿', () => {
      const table = init('a');
      const odds = [...table.values()].map((t) => ({
        name: t.name,
        p: championshipOdds(table, t.name),
      }));
      const counts = new Map<string, number>();
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const champ = pickChampion(new World(`dist-${i}`), table)!;
        counts.set(champ, (counts.get(champ) ?? 0) + 1);
      }
      for (const { name, p } of odds) {
        expect((counts.get(name) ?? 0) / n).toBeCloseTo(p, 1);
      }
    });

    it('空聯盟沒有冠軍', () => {
      expect(pickChampion(new World('empty'), new Map())).toBeNull();
    });
  });
});

describe('fmtWinRate', () => {
  it('照棒球的慣例去掉前導零', () => {
    expect(fmtWinRate(0.543)).toBe('.543');
    expect(fmtWinRate(0.5)).toBe('.500');
  });
});
