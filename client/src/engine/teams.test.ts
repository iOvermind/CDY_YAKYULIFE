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
  teamNick,
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

  it('玩家的貢獻只加在自己的球隊上', () => {
    const before = init('a');
    const team = CPBL[0]!.name;
    const withPlayer = step('b', before, { playerTeam: team, playerEffect: 0.05 });
    const without = step('b', before);
    expect(withPlayer.get(team)?.winRate).toBeGreaterThan(without.get(team)?.winRate ?? 0);
    // 其他球隊完全不受影響——夾子不管全聯盟的平均。
    for (const other of CPBL.slice(1)) {
      expect(withPlayer.get(other.name)?.winRate).toBe(without.get(other.name)?.winRate);
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
      // 機率不被加工，所以總和是精確的 1，不是「大致」。
      expect(total).toBeCloseTo(1, 9);
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
   * **機率沒有夾子，它是勝率的結果。** 勝率有一道硬邊 [.300, .700]，所以上緣自然
   * 被限住：一支 .700 的球隊配五支 .300 的，它在六隊聯盟拿到 57%，而那正是那種
   * 年份該有的樣子。
   */
  it('勝率夾在硬邊內，不隨隊數浮動', () => {
    const clamp = cfg.team_strength.drift.clamp;
    let table = init('a');
    for (let y = 0; y < 30; y++) {
      table = advanceLeague(new World(`y${y}`), table);
      for (const t of table.values()) {
        expect(t.winRate).toBeGreaterThanOrEqual(clamp.min);
        expect(t.winRate).toBeLessThanOrEqual(clamp.max);
      }
    }
  });

  it('機率就是勝率次方的佔比——沒有被加工過', () => {
    const table = init('a');
    const e = cfg.team_strength.championship.exponent;
    let total = 0;
    for (const t of table.values()) total += Math.pow(t.winRate, e);
    for (const t of table.values()) {
      expect(championshipOdds(table, t.name)).toBeCloseTo(Math.pow(t.winRate, e) / total, 12);
    }
  });

  it('平均奪冠率就是隊數的倒數', () => {
    const table = init('a');
    expect(averageChampionshipOdds(table)).toBeCloseTo(1 / table.size);
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

/** 「XX先生」的隊名代表詞：三個字以上的隊名不能只抓最後兩個字。 */
describe('隊名代表詞', () => {
  it('三個字以上的代表詞照資料寫的', () => {
    expect(teamNick('水原魔法使')).toBe('魔法使');
    expect(teamNick('布里斯本亡命之徒')).toBe('亡命之徒');
    expect(teamNick('猶加敦百獸王')).toBe('百獸王');
    expect(teamNick('台中猛瑪')).toBe('猛瑪');
  });
});
