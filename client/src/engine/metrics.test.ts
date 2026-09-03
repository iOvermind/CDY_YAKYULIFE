import { describe, expect, it } from 'vitest';
import { season as cfg } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import { advanceStandards, initStandards, leagueStandardOf } from './league.ts';
import {
  amateurBaseline,
  battingResponsibility,
  battingShares,
  eraPlus,
  fieldingReplacementWinPct,
  fieldingShares,
  lossPenalty,
  opsPlus,
  pitchingResponsibility,
  pitchingShares,
  proBaseline,
  proBaselineAt,
  pythagoreanWinPct,
  replacementWinPct,
  responsibilityOf,
  runsCreated,
  splitShares,
  sumShares,
  teamAdjustedWinPct,
  winPct,
} from './metrics.ts';
import { World } from './rng.ts';
import { eraAt } from './season.ts';

const base = proBaseline('CPBL1');

const bat = (over: Partial<BattingLine> = {}): BattingLine => ({
  games: 120, starts: 120, pa: 500, ab: 450, runs: 60, hits: 120, double: 24, triple: 3, hr: 12,
  rbi: 60, bb: 45, ibb: 5, so: 80, sb: 8, cs: 3, hbp: 0, sac: 0,
  avg: 120 / 450, obp: 170 / 500, slg: (81 + 48 + 9 + 48) / 450,
  ...over,
});

const pit = (over: Partial<PitchingLine> = {}): PitchingLine => ({
  games: 25, starts: 25, wins: 10, losses: 8, saves: 0, holds: 0, outs: 450, hits: 145,
  runs: 70, er: 65, bb: 45, so: 120, hr: 16, era: 3.9,
  ...over,
});

describe('baseline', () => {
  it('職業的基準線是算出來的，不是抄的——上壘率落在合理範圍', () => {
    expect(base.obp).toBeGreaterThan(0.28);
    expect(base.obp).toBeLessThan(0.38);
  });

  it('長打率高於打擊率', () => {
    expect(base.slg).toBeGreaterThan(base.obp - 0.1);
  });

  it('防禦率就是設定裡的 base', () => {
    // 基準防禦率由新模型導出，不再是設定裡的一個常數。
    expect(base.era).toBeCloseTo(eraAt(0), 10);
  });

  it('養成期與職業的基準線不同——門檻本來就不一樣', () => {
    expect(amateurBaseline().era).not.toBe(base.era);
  });

  it('每打席創造的分數是正的', () => {
    expect(base.runsCreatedPerPa).toBeGreaterThan(0);
  });
});

describe('runsCreated', () => {
  it('沒有打數就沒有得分創造', () => {
    expect(runsCreated(bat({ ab: 0, bb: 0, ibb: 0 }))).toBe(0);
  });

  it('全壘打比一壘安打創造更多分', () => {
    const single = bat({ hits: 120, double: 0, triple: 0, hr: 0 });
    const power = bat({ hits: 120, double: 0, triple: 0, hr: 40 });
    expect(runsCreated(power)).toBeGreaterThan(runsCreated(single));
  });

  it('保送也創造分數', () => {
    expect(runsCreated(bat({ bb: 80 }))).toBeGreaterThan(runsCreated(bat({ bb: 20 })));
  });
});

describe('eraPlus', () => {
  it('防禦率等於聯盟平均時是 100', () => {
    expect(eraPlus(pit({ era: base.era }), base)).toBe(100);
  });

  it('防禦率越低 ERA+ 越高', () => {
    expect(eraPlus(pit({ era: 2.0 }), base)!).toBeGreaterThan(eraPlus(pit({ era: 5.0 }), base)!);
  });

  it('防禦率是聯盟一半時大約 200', () => {
    expect(eraPlus(pit({ era: base.era / 2 }), base)).toBe(200);
  });

  it('沒有投球局數時回傳 null，不是 0——0 會被誤讀成差到極點', () => {
    expect(eraPlus(pit({ outs: 0 }), base)).toBeNull();
  });
});

describe('opsPlus', () => {
  it('上壘率與長打率都等於聯盟平均時是 100', () => {
    expect(opsPlus(bat({ obp: base.obp, slg: base.slg }), base)).toBe(100);
  });

  it('打得越好 OPS+ 越高', () => {
    expect(opsPlus(bat({ obp: 0.42, slg: 0.55 }), base)!).toBeGreaterThan(
      opsPlus(bat({ obp: 0.29, slg: 0.33 }), base)!,
    );
  });

  it('上壘與長打各自相對聯盟——上壘型打者不會被低估', () => {
    const onBase = opsPlus(bat({ obp: base.obp + 0.06, slg: base.slg }), base)!;
    const slugger = opsPlus(bat({ obp: base.obp, slg: base.slg + 0.06 }), base)!;
    expect(onBase).toBeGreaterThan(slugger);
  });

  it('沒有打席時回傳 null', () => {
    expect(opsPlus(bat({ pa: 0 }), base)).toBeNull();
  });
});

describe('pythagoreanWinPct', () => {
  it('與聯盟同水準的人是五成勝率', () => {
    expect(pythagoreanWinPct(1)).toBeCloseTo(0.5, 10);
  });

  it('表現越好勝率越高，越差越低', () => {
    expect(pythagoreanWinPct(1.3)).toBeGreaterThan(0.5);
    expect(pythagoreanWinPct(0.7)).toBeLessThan(0.5);
  });

  it('極端值被夾住，不會出現 0 或 1', () => {
    const c = cfg.advanced.shares.win_pct_clamp;
    expect(pythagoreanWinPct(999)).toBeLessThanOrEqual(c.max);
    expect(pythagoreanWinPct(0.0001)).toBeGreaterThanOrEqual(c.min);
    expect(pythagoreanWinPct(0)).toBe(c.min);
    expect(pythagoreanWinPct(-1)).toBe(c.min);
  });
});

describe('責任額', () => {
  it('打席越多責任額越大——上場本身就是責任', () => {
    expect(battingResponsibility(600)).toBeGreaterThan(battingResponsibility(200));
  });

  it('責任額與打席成正比', () => {
    expect(battingResponsibility(600)).toBeCloseTo(battingResponsibility(300) * 2, 10);
  });

  it('沒上場就沒有責任', () => {
    expect(battingResponsibility(0)).toBe(0);
    expect(pitchingResponsibility(0)).toBe(0);
  });

  it('全職主力的責任額落在真實 WS+LS 的數量級——二十幾份', () => {
    expect(battingResponsibility(600)).toBeGreaterThan(15);
    expect(battingResponsibility(600)).toBeLessThan(35);
  });

  it('責任額就是兩本帳的總和', () => {
    const s = battingShares(bat(), base);
    expect(responsibilityOf(s)).toBeCloseTo(battingResponsibility(500), 10);
  });
});

describe('雙帳制', () => {
  it('聯盟平均的打者勝率貼近 .500', () => {
    const s = battingShares(bat(), base);
    expect(winPct(s)).toBeGreaterThan(0.4);
    expect(winPct(s)).toBeLessThan(0.6);
  });

  it('打得越好，勝利份額越多、敗戰份額越少', () => {
    const good = battingShares(bat({ hits: 180, hr: 35, obp: 0.42, slg: 0.6 }), base);
    const bad = battingShares(bat({ hits: 80, hr: 2, obp: 0.25, slg: 0.28 }), base);
    expect(good.win).toBeGreaterThan(bad.win);
    expect(good.loss).toBeLessThan(bad.loss);
  });

  it('打席相同時，好壞球員的責任額相同——差別在怎麼分配', () => {
    const good = battingShares(bat({ hits: 180, hr: 35 }), base);
    const bad = battingShares(bat({ hits: 80, hr: 2 }), base);
    expect(responsibilityOf(good)).toBeCloseTo(responsibilityOf(bad), 10);
  });

  /** 這正是雙帳制存在的理由：單帳制下混得越久分越高。 */
  it('爛球員打得越多，敗戰份額累積越多', () => {
    const few = battingShares(bat({ pa: 150, hits: 24, hr: 0, obp: 0.24, slg: 0.26 }), base);
    const many = battingShares(bat({ pa: 600, hits: 96, hr: 0, obp: 0.24, slg: 0.26 }), base);
    expect(many.loss).toBeGreaterThan(few.loss);
  });

  it('勝利份額永遠不是負的——負面貢獻表達為敗戰份額', () => {
    const awful = battingShares(
      bat({ hits: 5, double: 0, triple: 0, hr: 0, bb: 0, ibb: 0, obp: 0.02, slg: 0.02 }),
      base,
    );
    expect(awful.win).toBeGreaterThanOrEqual(0);
    expect(awful.loss).toBeGreaterThan(awful.win);
  });

  it('沒有出賽就兩本帳都是 0', () => {
    expect(battingShares(bat({ pa: 0, ab: 0, hits: 0, bb: 0, ibb: 0 }), base)).toEqual({
      win: 0,
      loss: 0,
    });
    expect(pitchingShares(pit({ outs: 0 }), base)).toEqual({ win: 0, loss: 0 });
  });

  it('投得越好勝利份額越高', () => {
    expect(pitchingShares(pit({ era: 2.2 }), base).win).toBeGreaterThan(
      pitchingShares(pit({ era: 4.5 }), base).win,
    );
  });

  it('同樣的防禦率，投得越多兩本帳都越大', () => {
    const many = pitchingShares(pit({ outs: 600 }), base);
    const few = pitchingShares(pit({ outs: 180 }), base);
    expect(many.win).toBeGreaterThan(few.win);
    expect(many.loss).toBeGreaterThan(few.loss);
  });

  it('防禦率 0 不會炸開', () => {
    expect(Number.isFinite(pitchingShares(pit({ era: 0 }), base).win)).toBe(true);
  });

  it('全職主力的勝利份額落在真實 WS 的數量級', () => {
    const star = battingShares(
      bat({ hits: 175, double: 35, hr: 30, bb: 70, obp: 0.4, slg: 0.55 }),
      base,
    );
    expect(star.win).toBeGreaterThan(5);
    expect(star.loss).toBeGreaterThan(0);
    expect(star.win).toBeLessThan(45);
  });

  it('splitShares 與 sumShares 是一對可逆操作', () => {
    const total = sumShares(splitShares(10, 0.6), splitShares(20, 0.4));
    expect(responsibilityOf(total)).toBeCloseTo(30, 10);
    expect(total.win).toBeCloseTo(6 + 8, 10);
  });
});

describe('守備的雙帳', () => {
  const field = (score: number, share: number) =>
    fieldingShares({
      defenseScore: score,
      positionAverage: 54,
      positionShare: share,
      leagueGames: 120,
      gamesShare: 1,
    });

  it('剛好在守位平均上的人是五成勝率', () => {
    expect(winPct(field(54, 18))).toBeCloseTo(0.5, 10);
  });

  it('同樣的守備水準，責任占比越重的守位份額越大', () => {
    expect(responsibilityOf(field(60, 24))).toBeGreaterThan(responsibilityOf(field(60, 3)));
  });

  it('爛捕手累積的敗戰份額遠多於爛一壘手——這正是責任額的意義', () => {
    expect(field(45, 24).loss).toBeGreaterThan(field(45, 3).loss);
  });

  it('沒有守位責任就沒有份額', () => {
    expect(field(60, 0)).toEqual({ win: 0, loss: 0 });
  });

  it('守備段的份額量級小於打擊段——真實 WS 的守備只佔約 16%', () => {
    expect(responsibilityOf(field(54, 18))).toBeLessThan(battingResponsibility(600));
  });
});

describe('替代水準與 k', () => {
  it('替代水準的勝率低於五成——那是留隊邊緣，不是聯盟平均', () => {
    expect(replacementWinPct('batting', 'CPBL1')).toBeLessThan(0.5);
    expect(replacementWinPct('pitching', 'CPBL1')).toBeLessThan(0.5);
  });

  it('k 由替代水準推導，不是自由參數', () => {
    const p0 = replacementWinPct('batting', 'CPBL1');
    expect(lossPenalty('batting', 'CPBL1')).toBeCloseTo(p0 / (1 - p0), 10);
  });

  /** k 的唯一作用就是決定「哪個水準的球員生涯評價分不動」。 */
  it('替代水準的球員，評價分剛好是 0', () => {
    const k = lossPenalty('batting', 'CPBL1');
    const s = splitShares(20, replacementWinPct('batting', 'CPBL1'));
    expect(s.win - k * s.loss).toBeCloseTo(0, 10);
  });

  it('聯盟平均的球員評價分為正、低於替代水準的為負', () => {
    const k = lossPenalty('batting', 'CPBL1');
    const average = splitShares(20, 0.5);
    const below = splitShares(20, replacementWinPct('batting', 'CPBL1') - 0.05);
    expect(average.win - k * average.loss).toBeGreaterThan(0);
    expect(below.win - k * below.loss).toBeLessThan(0);
  });

  it('k 逐年不同——平均與門檻的差距本身會擺盪', () => {
    const world = new World('k-drift');
    let standards = initStandards();
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      standards = advanceStandards(world, standards);
      seen.add(Number(lossPenalty('batting', 'CPBL1', standards).toFixed(6)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('差距拉大時替代水準更低，k 也更小', () => {
    const world = new World('k-gap');
    let standards = initStandards();
    let widest = { gap: -1, k: 0 };
    let narrowest = { gap: 999, k: 0 };
    for (let i = 0; i < 60; i++) {
      standards = advanceStandards(world, standards);
      const now = leagueStandardOf(standards, 'CPBL1');
      const gap = now.par - now.min;
      const k = lossPenalty('batting', 'CPBL1', standards);
      if (gap > widest.gap) widest = { gap, k };
      if (gap < narrowest.gap) narrowest = { gap, k };
    }
    expect(widest.k).toBeLessThan(narrowest.k);
  });

  it('守備的替代水準是守位門檻，低於守位平均', () => {
    expect(fieldingReplacementWinPct(50, 54)).toBeLessThan(0.5);
  });
});

describe('proBaselineAt', () => {
  it('d 為 0 時就是聯盟平均', () => {
    expect(proBaselineAt('CPBL1', 0)).toEqual(proBaseline('CPBL1'));
  });

  it('能力越高，基準線的成績越好、防禦率越低', () => {
    expect(proBaselineAt('CPBL1', 6).runsCreatedPerPa).toBeGreaterThan(base.runsCreatedPerPa);
    expect(proBaselineAt('CPBL1', 6).era).toBeLessThan(base.era);
  });

  it('基準線與層級無關——聯盟平均是自我參照的', () => {
    expect(proBaseline('CPBL2').runsCreatedPerPa).toBe(proBaseline('MLB').runsCreatedPerPa);
  });
});

describe('球隊戰績的耦合', () => {
  const coupling = cfg.advanced.shares.team_coupling;

  it('.500 的球隊不改變個人勝率', () => {
    expect(teamAdjustedWinPct(0.6, 0.5)).toBeCloseTo(0.6, 10);
  });

  /** 這是這條修正存在的理由：0 勝的球隊沒有任何勝利份額可分。 */
  it('0 勝的球隊裡，聯盟平均水準的球員拿不到勝利份額', () => {
    expect(teamAdjustedWinPct(0.5, 0)).toBeCloseTo(0.5 - 0.5 * coupling, 10);
    if (coupling >= 1) expect(teamAdjustedWinPct(0.5, 0)).toBe(0);
  });

  it('0 勝的球隊裡，比平均強的球員仍拿得到一點份額', () => {
    expect(teamAdjustedWinPct(0.65, 0)).toBeGreaterThan(teamAdjustedWinPct(0.5, 0));
  });

  it('同樣的表現，球隊越強份額越多', () => {
    expect(teamAdjustedWinPct(0.55, 0.65)).toBeGreaterThan(teamAdjustedWinPct(0.55, 0.35));
  });

  it('夾在 0 與 1 之間，不會溢出', () => {
    expect(teamAdjustedWinPct(0.98, 1)).toBeLessThanOrEqual(1);
    expect(teamAdjustedWinPct(0.02, 0)).toBeGreaterThanOrEqual(0);
  });

  it('沒有球隊戰績時不做調整——養成期沒有球隊勝率可言', () => {
    expect(teamAdjustedWinPct(0.6, null)).toBe(0.6);
  });

  it('接進打擊與投球的雙帳：同樣的成績，爛隊的勝利份額比較少', () => {
    const strong = battingShares(bat(), base, 0.65);
    const weak = battingShares(bat(), base, 0.35);
    expect(strong.win).toBeGreaterThan(weak.win);
    expect(strong.loss).toBeLessThan(weak.loss);
    // 責任額不變——出賽時間與球隊強弱無關
    expect(responsibilityOf(strong)).toBeCloseTo(responsibilityOf(weak), 10);
  });

  it('接進投球的雙帳', () => {
    expect(pitchingShares(pit(), base, 0.65).win).toBeGreaterThan(
      pitchingShares(pit(), base, 0.35).win,
    );
  });

  it('接進守備的雙帳', () => {
    const field = (teamWinRate: number) =>
      fieldingShares({
        defenseScore: 58,
        positionAverage: 54,
        positionShare: 18,
        leagueGames: 120,
        gamesShare: 1,
        teamWinRate,
      });
    expect(field(0.65).win).toBeGreaterThan(field(0.35).win);
  });
});
