import { describe, expect, it } from 'vitest';
import { season as cfg, teams as teamsData } from '../data/index.ts';
import {
  advanceLeague,
  championshipOdds,
  fmtWinRate,
  initLeague,
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

  it('玩家的貢獻只加在自己的球隊上', () => {
    const before = init('a');
    const team = CPBL[0]!.name;
    const withPlayer = step('b', before, { playerTeam: team, playerEffect: 0.05 });
    const without = step('b', before);
    expect(withPlayer.get(team)?.winRate).toBeGreaterThan(without.get(team)?.winRate ?? 0);
    // 其他球隊完全不受影響
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

  it('全聯盟的機率加起來大致是 1——沒有球隊被憑空多算', () => {
    const table = init('a');
    let total = 0;
    for (const t of table.values()) total += championshipOdds(table, t.name);
    expect(total).toBeGreaterThan(0.9);
    expect(total).toBeLessThan(1.1);
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

  it('機率不會超出上下限', () => {
    let table = init('a');
    for (let y = 0; y < 30; y++) {
      table = advanceLeague(new World(`y${y}`), table);
      for (const t of table.values()) {
        const odds = championshipOdds(table, t.name);
        expect(odds).toBeGreaterThanOrEqual(cfg.team_strength.championship.min);
        expect(odds).toBeLessThanOrEqual(cfg.team_strength.championship.max);
      }
    }
  });
});

describe('fmtWinRate', () => {
  it('照棒球的慣例去掉前導零', () => {
    expect(fmtWinRate(0.543)).toBe('.543');
    expect(fmtWinRate(0.5)).toBe('.500');
  });
});
