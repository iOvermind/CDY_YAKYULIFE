import { describe, expect, it } from 'vitest';
import { ladder, leagues } from '../data/index.ts';
import { Game, type GameSetup } from './game.ts';
import { CAREER_SCOPE, ladderRows } from './ladder.ts';

const setup: GameSetup = {
  seed: 'ladder-seed',
  name: '王小明',
  startPosition: 'SS',
  throws: 'R',
  bats: 'R',
};

/** 打完一整段生涯。配點投進真正影響評價的能力，不然點數全進體力。 */
function play(seed: string): Game {
  const game = new Game({ ...setup, seed }).start();
  let guard = 0;
  while (game.flow.prompt !== null && guard++ < 8000) {
    const usable = game.flow.prompt.options.filter(
      (o) => o.disabled !== true && o.id !== 'alloc:undo',
    );
    const pick =
      ['con', 'pow', 'eye', 'spd', 'rng', 'fld']
        .map((k) => usable.find((o) => o.id === `alloc:${k}`))
        .find((o) => o !== undefined) ??
      usable.find((o) => o.id === 'alloc:confirm') ??
      usable[0];
    if (pick === undefined) break;
    game.choose(pick.id);
  }
  return game;
}

describe('天梯的資料列', () => {
  it('每個待過的頂級聯盟一列，外加生涯那一列', () => {
    for (let i = 0; i < 40; i++) {
      const summary = play(`rows-${i}`).summary;
      if (summary == null || summary.leagues.length === 0) continue;
      const rows = ladderRows(summary);
      expect(rows).toHaveLength(summary.leagues.length + 1);
      expect(rows.at(-1)?.scope).toBe(CAREER_SCOPE);
      for (const l of summary.leagues) {
        expect(rows.some((r) => r.scope === l.org)).toBe(true);
      }
      return;
    }
    throw new Error('四十局都沒有人上過頂級聯盟');
  });

  it('沒上過頂級聯盟就一列都沒有——那不是漏算', () => {
    for (let i = 0; i < 60; i++) {
      const summary = play(`empty-${i}`).summary;
      if (summary == null || summary.leagues.length > 0) continue;
      expect(ladderRows(summary)).toHaveLength(0);
      return;
    }
  });

  it('生涯那一列的成績等於各聯盟通算', () => {
    for (let i = 0; i < 40; i++) {
      const summary = play(`total-${i}`).summary;
      if (summary == null || summary.leagues.length === 0) continue;
      const career = ladderRows(summary).find((r) => r.scope === CAREER_SCOPE);
      expect(career?.batting).toEqual(summary.topTotal.batting);
      expect(career?.pitching).toEqual(summary.topTotal.pitching);
      expect(career?.seasons).toBe(summary.leagues.reduce((n, l) => n + l.seasons, 0));
      return;
    }
    throw new Error('四十局都沒有人上過頂級聯盟');
  });

  it('二軍的球季不進通算，也不墊高門檻', () => {
    for (let i = 0; i < 40; i++) {
      const summary = play(`minor-${i}`).summary;
      if (summary == null || summary.leagues.length === 0) continue;
      const minorSeasons = summary.seasons.filter((s) => s.top === null).length;
      if (minorSeasons === 0) continue;
      const career = ladderRows(summary).find((r) => r.scope === CAREER_SCOPE);
      // 季數只數頂級聯盟：二軍那幾年既不加成績也不加門檻。
      // **數的是年份而不是列數**——季中被交易的那一年有兩列，年資只算一年。
      const topYears = new Set(
        summary.seasons.filter((s) => s.top !== null).map((s) => s.year),
      );
      expect(career?.seasons).toBe(topYears.size);
      return;
    }
    throw new Error('四十局都沒有人在二軍待過');
  });
});

describe('率型數值的上榜資格', () => {
  it('季數不足十二季就不合格，累積量再高也一樣', () => {
    for (let i = 0; i < 60; i++) {
      const summary = play(`short-${i}`).summary;
      if (summary == null || summary.leagues.length === 0) continue;
      const career = ladderRows(summary).find((r) => r.scope === CAREER_SCOPE);
      const seasons = career?.seasons ?? 0;
      if (seasons >= ladder.qualification.min_seasons) continue;
      expect(career?.qualifiedBatter).toBe(false);
      expect(career?.qualifiedPitcher).toBe(false);
      return;
    }
    throw new Error('六十局都沒有出現不滿十二季的生涯');
  });

  it('門檻逐年累加當年所在聯盟的場次', () => {
    for (let i = 0; i < 60; i++) {
      const summary = play(`thr-${i}`).summary;
      if (summary == null || summary.leagues.length === 0) continue;
      const tops = summary.seasons.filter((s) => s.top !== null);
      if (tops.length < ladder.qualification.min_seasons) continue;

      const required = tops.reduce(
        (n, s) =>
          n + ladder.qualification.per_season.batter.per_team_game * (leagues.levels[s.level]?.games ?? 0),
        0,
      );
      const career = ladderRows(summary).find((r) => r.scope === CAREER_SCOPE);
      const pa = career?.batting?.pa ?? 0;
      expect(career?.qualifiedBatter).toBe(pa >= required);
      return;
    }
  });

  it('投手門檻用出局數，不是出賽數——先發投手永遠達不到八成場次', () => {
    // 這條是規則本身的守門：如果有人把門檻改回「出賽數 × 0.8」，先發投手會全部
    // 被排除，防禦率榜永遠是空的。
    const cfg = ladder.qualification.per_season.pitcher;
    expect(cfg.stat).toBe('outs');
    // 1.0 局／場 = 3 個出局數／場。
    expect(cfg.per_team_game).toBe(3);
  });
});

describe('天梯欄位清單', () => {
  const all = [...ladder.columns.batter, ...ladder.columns.pitcher];

  it('率型欄位都指定了小數位，累積欄位都沒有', () => {
    for (const c of all) {
      if (c.rate) expect(c.digits, c.name).toBeGreaterThan(0);
      else expect(c.digits, c.name).toBeUndefined();
    }
  });

  it('只有防禦率是越少越前面', () => {
    const asc = all.filter((c) => c.order === 'asc').map((c) => c.key);
    expect(asc).toEqual(['era']);
  });

  it('欄位名不重複——同一側出現兩個「奪三振」就分不出在看哪一欄', () => {
    for (const side of ['batter', 'pitcher'] as const) {
      const names = ladder.columns[side].map((c) => c.name);
      expect(new Set(names).size, side).toBe(names.length);
    }
  });

  it('#57 點名的欄位一項都不能少', () => {
    const batter = new Set(ladder.columns.batter.map((c) => c.key));
    for (const k of ['so', 'hr', 'hits', 'double', 'triple', 'defenseRuns']) {
      expect(batter.has(k), `野手少了 ${k}`).toBe(true);
    }
    const pitcher = new Set(ladder.columns.pitcher.map((c) => c.key));
    for (const k of ['so', 'outs', 'runs', 'er']) {
      expect(pitcher.has(k), `投手少了 ${k}`).toBe(true);
    }
  });
});
