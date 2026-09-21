import { describe, expect, it } from 'vitest';
import { ladder, leagues } from '../data/index.ts';
import { Game, type GameSetup } from './game.ts';
import { BEST_PREFIX, CAREER_SCOPE, POSITION_PREFIX, ladderRows } from './ladder.ts';

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
      // 聯盟 + 生涯，另外每個守過的守位兩列（生涯累計與單季最佳）。
      const plain = rows.filter(
        (r) => !r.scope.startsWith(POSITION_PREFIX) && !r.scope.startsWith(BEST_PREFIX),
      );
      expect(plain).toHaveLength(summary.leagues.length + 1);
      expect(plain.at(-1)?.scope).toBe(CAREER_SCOPE);
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

describe('守位的榜', () => {
  /** 找一段守過至少兩個守位的生涯——移防在這個遊戲裡是常態。 */
  function withPositions() {
    for (let i = 0; i < 60; i++) {
      const summary = play(`pos-${i}`).summary;
      if (summary == null || summary.leagues.length === 0) continue;
      const rows = ladderRows(summary);
      const at = rows.filter((r) => r.scope.startsWith(POSITION_PREFIX));
      if (at.length > 0) return { summary, rows, at };
    }
    throw new Error('六十局都沒有人在頂級聯盟登錄過守位');
  }

  it('只採計在那個守位登錄的球季', () => {
    const { summary, at } = withPositions();
    for (const row of at) {
      const position = row.scope.slice(POSITION_PREFIX.length);
      const played = summary.seasons.filter(
        (r) => r.top !== null && (r.position === position || r.pitcherRole === position),
      );
      expect(row.seasons, position).toBe(new Set(played.map((r) => r.year)).size);
      const games = played.reduce((n, r) => n + (r.batting?.games ?? 0), 0);
      expect(row.batting?.games ?? 0, position).toBe(games);
    }
  });

  it('生涯累計不會超過跨聯盟通算——它是其中一部分', () => {
    const { rows, at } = withPositions();
    const career = rows.find((r) => r.scope === CAREER_SCOPE);
    for (const row of at) {
      expect(row.batting?.hits ?? 0).toBeLessThanOrEqual(career?.batting?.hits ?? 0);
      expect(row.seasons).toBeLessThanOrEqual(career?.seasons ?? 0);
    }
  });

  it('單季榜每一欄各取最好的那一季，季數寫 1', () => {
    const { summary, rows } = withPositions();
    const best = rows.filter((r) => r.scope.startsWith(BEST_PREFIX));
    expect(best.length).toBeGreaterThan(0);
    for (const row of best) {
      expect(row.seasons).toBe(1);
      const position = row.scope.slice(BEST_PREFIX.length);
      const played = summary.seasons.filter(
        (r) => r.top !== null && (r.position === position || r.pitcherRole === position),
      );
      const topHr = played.reduce((m, r) => Math.max(m, r.batting?.hr ?? 0), 0);
      expect(row.batting?.hr ?? 0, position).toBe(topHr);
    }
  });

  it('守位的列與生涯的列一一對應——有生涯就有單季', () => {
    const { rows } = withPositions();
    const career = rows
      .filter((r) => r.scope.startsWith(POSITION_PREFIX))
      .map((r) => r.scope.slice(POSITION_PREFIX.length));
    const best = rows
      .filter((r) => r.scope.startsWith(BEST_PREFIX))
      .map((r) => r.scope.slice(BEST_PREFIX.length));
    expect(best).toEqual(career);
  });
});

describe('天梯欄位清單', () => {
  const all = [...ladder.columns.batter, ...ladder.columns.pitcher];

  /**
   * `digits` 講的是「這一欄要印幾位小數」，不是「這一欄是不是率」。
   *
   * 率型一定有小數位。累積型多半是整數（安打、全壘打）所以不帶；**份額是例外**
   * ——它是累積型，但本身就帶小數，不指定小數位會印成一長串浮點數。
   */
  it('率型欄位都指定了小數位；累積欄位要嘛不帶，要嘛是帶小數的份額', () => {
    for (const c of all) {
      if (c.rate) expect(c.digits, c.name).toBeGreaterThan(0);
      else if (c.digits !== undefined) expect(c.digits, c.name).toBeGreaterThan(0);
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
