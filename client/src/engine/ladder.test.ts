import { describe, expect, it } from 'vitest';
import { ladder, leagues } from '../data/index.ts';
import { playCareer } from '../../scripts/harness.ts';
import type { Game, GameSetup } from './game.ts';
import { seasonPoints } from './career.ts';
import { ALL, ladderRows, type LadderRow } from './ladder.ts';

const setup: GameSetup = {
  seed: 'ladder-seed',
  name: '王小明',
  startPosition: 'SS',
  throws: 'R',
  bats: 'R',
};

/** 打完一整段生涯。配點走校準用的均衡玩家——只配一兩項的人走不到一軍。 */
function play(seed: string): Game {
  return playCareer(seed, setup.startPosition, setup.name);
}

/** 一段生涯的組合列，外加它的淨收入（跨聯盟跨守位那一列的薪水）。 */
function rowsOf(game: Game): { readonly rows: readonly LadderRow[]; readonly earnings: number } {
  const summary = game.summary;
  const earnings = game.state?.earnings ?? 0;
  return { rows: summary == null ? [] : ladderRows(summary, earnings), earnings };
}

const find = (rows: readonly LadderRow[], org: string, position: string, kind: 'total' | 'best') =>
  rows.find((r) => r.org === org && r.position === position && r.kind === kind);

/** 找一段打過頂級聯盟的生涯。 */
function withTop(tag: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const game = play(`${tag}-${i}`);
    const summary = game.summary;
    if (summary == null || summary.leagues.length === 0) continue;
    return { game, summary, ...rowsOf(game) };
  }
  throw new Error(`${tries} 局都沒有人上過頂級聯盟`);
}

describe('天梯的資料列', () => {
  it('每個待過的頂級聯盟與跨聯盟各一組，每一組都有跨守位', () => {
    const { summary, rows } = withTop('rows');
    for (const org of [ALL, ...summary.leagues.map((l) => l.org)]) {
      expect(find(rows, org, ALL, 'total'), org).toBeDefined();
      expect(find(rows, org, ALL, 'best'), org).toBeDefined();
    }
  });

  it('累計與單季一定成對——有累計就有單季', () => {
    const { rows } = withTop('pair');
    const key = (r: LadderRow) => `${r.org}|${r.position}`;
    const total = rows.filter((r) => r.kind === 'total').map(key).sort();
    const best = rows.filter((r) => r.kind === 'best').map(key).sort();
    expect(best).toEqual(total);
  });

  it('沒上過頂級聯盟就一列都沒有——那不是漏算', () => {
    for (let i = 0; i < 60; i++) {
      const summary = play(`empty-${i}`).summary;
      if (summary == null || summary.leagues.length > 0) continue;
      expect(ladderRows(summary, 0)).toHaveLength(0);
      return;
    }
  });

  it('跨聯盟跨守位那一列的成績等於各聯盟通算', () => {
    const { summary, rows } = withTop('total');
    const career = find(rows, ALL, ALL, 'total');
    expect(career?.batting).toEqual(summary.topTotal.batting);
    expect(career?.pitching).toEqual(summary.topTotal.pitching);
    expect(career?.seasons).toBe(summary.leagues.reduce((n, l) => n + l.seasons, 0));
  });

  it('二軍的球季不進通算，也不墊高門檻', () => {
    for (let i = 0; i < 40; i++) {
      const game = play(`minor-${i}`);
      const summary = game.summary;
      if (summary == null || summary.leagues.length === 0) continue;
      if (!summary.seasons.some((s) => s.top === null)) continue;
      const career = find(rowsOf(game).rows, ALL, ALL, 'total');
      // **數的是年份而不是列數**——季中被交易的那一年有兩列，年資只算一年。
      const topYears = new Set(summary.seasons.filter((s) => s.top !== null).map((s) => s.year));
      expect(career?.seasons).toBe(topYears.size);
      return;
    }
    throw new Error('四十局都沒有人在二軍待過');
  });
});

describe('評價分與薪水在每種組合下的意思', () => {
  it('某聯盟跨守位累計的評價分就是那個聯盟的生涯評價分', () => {
    const { summary, rows } = withTop('score-league');
    for (const l of summary.leagues) {
      expect(find(rows, l.org, ALL, 'total')?.score, l.org).toBe(l.score);
    }
  });

  it('跨聯盟跨守位累計的評價分是總評價分', () => {
    const { summary, rows } = withTop('score-all');
    expect(find(rows, ALL, ALL, 'total')?.score).toBe(summary.totalScore);
  });

  /** 獎項與里程碑分不到守位上——一座 MVP 是那一季拿的，不是游擊這個位置拿的。 */
  it('有指定守位時是那些球季的份額淨分；單季取最高的那一季', () => {
    const { summary, rows } = withTop('score-pos');
    for (const row of rows.filter((r) => r.position !== ALL)) {
      const played = summary.seasons.filter(
        (r) =>
          r.top !== null &&
          (row.org === ALL || r.org === row.org) &&
          (r.position === row.position || r.pitcherRole === row.position),
      );
      const points = played.map(seasonPoints);
      const expected =
        row.kind === 'total' ? points.reduce((a, b) => a + b, 0) : Math.max(0, ...points);
      expect(row.score, `${row.org} ${row.position} ${row.kind}`).toBeCloseTo(expected, 8);
    }
  });

  it('跨聯盟跨守位累計的薪水是生涯淨收入', () => {
    const { rows, earnings } = withTop('pay-net');
    expect(find(rows, ALL, ALL, 'total')?.salary).toBe(earnings);
  });

  /** 問的是「那個體系的球團付了多少」——選秀的簽約金就是在二軍那一季入帳的。 */
  it('某聯盟跨守位累計的薪水是那個體系付的年薪＋簽約金，二軍那幾年也算', () => {
    const { summary, rows } = withTop('pay-org');
    for (const l of summary.leagues) {
      const paid = summary.seasons
        .filter((r) => r.org === l.org)
        .reduce((n, r) => n + r.salary + r.bonus, 0);
      expect(find(rows, l.org, ALL, 'total')?.salary, l.org).toBe(paid);
    }
  });

  /** 簽約金是一次性的，算進去的話「單季最高薪」會變成「哪一年跳槽」。 */
  it('單季的薪水只算年薪，取最高的那一季', () => {
    const { summary, rows } = withTop('pay-best');
    const top = summary.seasons.filter((r) => r.top !== null);
    expect(find(rows, ALL, ALL, 'best')?.salary).toBe(Math.max(...top.map((r) => r.salary)));
  });
});

describe('率型數值的上榜資格', () => {
  it('季數不足十二季就不合格，累積量再高也一樣', () => {
    for (let i = 0; i < 60; i++) {
      const game = play(`short-${i}`);
      const summary = game.summary;
      if (summary == null || summary.leagues.length === 0) continue;
      const career = find(rowsOf(game).rows, ALL, ALL, 'total');
      if ((career?.seasons ?? 0) >= ladder.qualification.min_seasons) continue;
      expect(career?.qualifiedBatter).toBe(false);
      expect(career?.qualifiedPitcher).toBe(false);
      return;
    }
    throw new Error('六十局都沒有出現不滿十二季的生涯');
  });

  it('門檻逐年累加當年所在聯盟的場次', () => {
    for (let i = 0; i < 60; i++) {
      const game = play(`thr-${i}`);
      const summary = game.summary;
      if (summary == null || summary.leagues.length === 0) continue;
      const tops = summary.seasons.filter((s) => s.top !== null);
      if (tops.length < ladder.qualification.min_seasons) continue;
      const required = tops.reduce(
        (n, s) =>
          n + ladder.qualification.per_season.batter.per_team_game * (leagues.levels[s.level]?.games ?? 0),
        0,
      );
      const career = find(rowsOf(game).rows, ALL, ALL, 'total');
      expect(career?.qualifiedBatter).toBe((career?.batting?.pa ?? 0) >= required);
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

describe('守位的組合', () => {
  /** 找一段在頂級聯盟登錄過守位的生涯。 */
  function withPositions() {
    const { summary, rows } = withTop('pos', 60);
    const at = rows.filter((r) => r.position !== ALL && r.kind === 'total');
    if (at.length === 0) throw new Error('那段生涯沒有登錄過守位');
    return { summary, rows, at };
  }

  it('只採計在那個聯盟、那個守位登錄的球季', () => {
    const { summary, at } = withPositions();
    for (const row of at) {
      const played = summary.seasons.filter(
        (r) =>
          r.top !== null &&
          (row.org === ALL || r.org === row.org) &&
          (r.position === row.position || r.pitcherRole === row.position),
      );
      expect(row.seasons, `${row.org} ${row.position}`).toBe(new Set(played.map((r) => r.year)).size);
      const games = played.reduce((n, r) => n + (r.batting?.games ?? 0), 0);
      expect(row.batting?.games ?? 0, `${row.org} ${row.position}`).toBe(games);
    }
  });

  it('份額是投打守三本帳相加——二刀流的同一季不會被拆成兩份', () => {
    const { summary, at } = withPositions();
    for (const row of at) {
      const played = summary.seasons.filter(
        (r) =>
          r.top !== null &&
          (row.org === ALL || r.org === row.org) &&
          (r.position === row.position || r.pitcherRole === row.position),
      );
      let win = 0;
      let loss = 0;
      for (const r of played) {
        for (const part of ['batting', 'pitching', 'fielding'] as const) {
          win += r.shares[part].win;
          loss += r.shares[part].loss;
        }
      }
      expect(row.winShares).toBeCloseTo(win, 10);
      expect(row.lossShares).toBeCloseTo(loss, 10);
    }
  });

  it('守位的累計不會超過同一聯盟的跨守位——它是其中一部分', () => {
    const { rows, at } = withPositions();
    for (const row of at) {
      const whole = find(rows, row.org, ALL, 'total');
      expect(row.batting?.hits ?? 0).toBeLessThanOrEqual(whole?.batting?.hits ?? 0);
      expect(row.seasons).toBeLessThanOrEqual(whole?.seasons ?? 0);
    }
  });

  it('單季每一欄各取最好的那一季，季數寫 1', () => {
    const { summary, rows } = withPositions();
    const best = rows.filter((r) => r.kind === 'best' && r.position !== ALL);
    expect(best.length).toBeGreaterThan(0);
    for (const row of best) {
      expect(row.seasons).toBe(1);
      const played = summary.seasons.filter(
        (r) =>
          r.top !== null &&
          (row.org === ALL || r.org === row.org) &&
          (r.position === row.position || r.pitcherRole === row.position),
      );
      const topHr = played.reduce((m, r) => Math.max(m, r.batting?.hr ?? 0), 0);
      expect(row.batting?.hr ?? 0, `${row.org} ${row.position}`).toBe(topHr);
    }
  });
});

describe('天梯欄位清單', () => {
  const all = [...ladder.columns.batter, ...ladder.columns.pitcher, ...ladder.columns.shared];

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
    for (const side of ['batter', 'pitcher', 'shared'] as const) {
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

  /**
   * 份額、評價分、薪水是整個球員的數字，不分投打——它們住在共通那一張，不在野手與
   * 投手兩張表各放一次。
   */
  it('投打共通的欄位只在共通那一張', () => {
    const shared = ladder.columns.shared.map((c) => c.key);
    expect(shared).toEqual(['ws', 'ls', 'war', 'rings', 'score', 'salary']);
    for (const side of ['batter', 'pitcher'] as const) {
      for (const c of ladder.columns[side]) expect(shared, side).not.toContain(c.key);
    }
  });
});

/** WAR 與總冠軍數（原本的「神獸殿堂」併進天梯，2026-09-26）。 */
describe('天梯的 WAR 與總冠軍', () => {
  it('跨聯盟跨守位的 WAR 是各聯盟 WAR 直接加總', () => {
    const { summary, rows } = withTop('war');
    const career = find(rows, ALL, ALL, 'total')!;
    const sum = summary.leagues.reduce((n, l) => n + l.war.batting + l.war.fielding + l.war.pitching, 0);
    expect(career.war).toBeCloseTo(sum, 6);
  });

  it('單季榜沒有總冠軍數；累計的總冠軍數等於拿過的座數', () => {
    const { game, summary } = withTop('rings');
    const awards = game.state?.awards ?? [];
    const rows = ladderRows(summary, game.state?.earnings ?? 0, awards);
    for (const r of rows.filter((x) => x.kind === 'best')) expect(r.rings).toBeNull();
    const rings = awards.filter((a) => a.code === 'championship').length;
    expect(find(rows, ALL, ALL, 'total')?.rings).toBe(rings);
  });
});
