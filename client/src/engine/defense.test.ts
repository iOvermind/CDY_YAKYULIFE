import { describe, expect, it } from 'vitest';
import { ALL_ABILITIES, positions } from '../data/index.ts';
import {
  assignPosition,
  canPlay,
  defenseResponsibility,
  defenseRuns,
  fieldingResponsibility,
  positionAverage,
  positionLabel,
  judgingAverage,
  DH,
} from './defense.ts';
import { advanceStandards, initStandards, leagueStandardOf } from './league.ts';
import { defenseMark, defenseScore, positionAverageLine, type Abilities } from './rating.ts';
import { World } from './rng.ts';

/** 全部能力都是同一個值的球員，再覆寫指定幾項。 */
function player(base: number, overrides: Record<string, number> = {}): Abilities {
  const ability: Record<string, number> = {};
  for (const key of ALL_ABILITIES) ability[key] = base;
  return { ...ability, ...overrides };
}

/** 守備三圍：範圍、接球、臂力（捕手另加接捕）。 */
const glove = (rng: number, fld: number, arm: number, cat = 20) =>
  player(20, { rng, fld, arm, cat });

describe('judgingAverage', () => {
  it('年輕球員的判定線比較低——球團願意為潛力多等兩年', () => {
    const young = judgingAverage('SS', 'CPBL1', 22)!;
    const old = judgingAverage('SS', 'CPBL1', 30)!;
    expect(young).toBeLessThan(old);
  });

  it('二軍借同體系頂級聯盟的尺——線與一軍同一把（ADR 0021）', () => {
    expect(judgingAverage('SS', 'CPBL2', 25)).toBe(judgingAverage('SS', 'CPBL1', 25));
  });

  it('沒有頂級聯盟可借的層級才真的不挑守位', () => {
    expect(judgingAverage('SS', '', 25)).toBeNull();
  });

  it('越難守的守位平均線越高', () => {
    const ss = judgingAverage('SS', 'CPBL1', 30)!;
    const first = judgingAverage('1B', 'CPBL1', 30)!;
    expect(ss).toBeGreaterThan(first);
  });
});

describe('canPlay', () => {
  it('二軍守不動游擊的人也一樣擋下來——尺是同一把（ADR 0021）', () => {
    expect(canPlay(glove(20, 20, 20), 'SS', 'CPBL2', 28)).toBe(false);
  });

  it('一軍守不動游擊的人，被降守位那條線擋下來', () => {
    expect(canPlay(glove(20, 20, 20), 'SS', 'CPBL1', 28)).toBe(false);
  });

  it('指定打擊人人守得動——他不守備', () => {
    expect(canPlay(glove(20, 20, 20), DH, 'CPBL1', 28)).toBe(true);
  });

  it('捕手與其他守位共用同一張平均線表，沒有平行機制', () => {
    const bar = positionAverageLine('C', 'CPBL1')!;
    const good = player(20, { fld: bar, cat: bar, arm: bar });
    expect(defenseScore(good, 'C')).toBeCloseTo(bar, 6);
    expect(canPlay(good, 'C', 'CPBL1', 30)).toBe(true);
    const bad = player(20, { fld: bar - 12, cat: bar - 12, arm: bar - 12 });
    expect(canPlay(bad, 'C', 'CPBL1', 30)).toBe(false);
  });

  it('捕手的平均線低於游擊——「蹲捕容忍度高」由平均線本身表達', () => {
    expect(judgingAverage('C', 'CPBL1', 30)!).toBeLessThan(judgingAverage('SS', 'CPBL1', 30)!);
  });

  it('守備平庸的游擊守得住——負的守備分不等於站不住', () => {
    const average = positionAverageLine('SS', 'CPBL1')!;
    const mediocre = player(20, { rng: average - 5, fld: average - 5, arm: average - 5 });
    expect(defenseMark(defenseScore(mediocre, 'SS'), average)).toBeLessThan(0);
    expect(canPlay(mediocre, 'SS', 'CPBL1', 30)).toBe(true);
  });
});

describe('defenseMark', () => {
  const d = positions.defense_score;

  it('站在平均線上是 0，高出 span 就是錨點', () => {
    expect(defenseMark(70, 70)).toBe(0);
    expect(defenseMark(70 + d.span, 70)).toBeCloseTo(d.anchor, 6);
  });

  it('守得住的最低標準（平均線 −4）落在 −4 左右，離降守位的線還有一段', () => {
    expect(defenseMark(66, 70)).toBeCloseTo(-4, 1);
    expect(defenseMark(66, 70)).toBeGreaterThan(d.demotion_line);
  });

  it('兩端都夾得住', () => {
    expect(defenseMark(200, 70)).toBeCloseTo(d.anchor * d.cap_ratio, 6);
    expect(defenseMark(0, 70)).toBe(-d.anchor);
  });

  it('所有守位的錨點都是同一個數字，縮的是拿到它需要的能力', () => {
    const ss = positionAverageLine('SS', 'CPBL1')!;
    const first = positionAverageLine('1B', 'CPBL1')!;
    expect(first).toBeLessThan(ss);
    expect(defenseMark(ss + d.span, ss)).toBeCloseTo(defenseMark(first + d.span, first), 6);
  });
});

describe('positionAverage', () => {
  it('與借尺那一條同源——頂級聯盟量出同一個數字', () => {
    for (const pos of ['C', 'SS', '2B', '3B', 'CF', 'RF', 'LF', '1B']) {
      expect(positionAverage(pos, 'CPBL1')!).toBe(positionAverageLine(pos, 'CPBL1')!);
    }
  });

  it('不套年齡折讓——同守位的平均不會因為某個人年輕就下降', () => {
    expect(positionAverage('SS', 'CPBL1')).toBe(positionAverage('SS', 'CPBL1'));
    expect(judgingAverage('SS', 'CPBL1', 22)!).toBeLessThan(judgingAverage('SS', 'CPBL1', 32)!);
  });

  it('跟著聯盟水準一起浮動', () => {
    const world = new World('avg-drift');
    let standards = initStandards();
    const base = positionAverage('SS', 'CPBL1')!;
    for (let i = 0; i < 15; i++) standards = advanceStandards(world, standards);
    const drifted = positionAverage('SS', 'CPBL1', standards)!;
    const parShift = leagueStandardOf(standards, 'CPBL1').par - leagueStandardOf(null, 'CPBL1').par;
    expect(drifted - base).toBeCloseTo(parShift, 10);
  });

  it('非頂級聯盟沒有平均線可比', () => {
    expect(positionAverage('SS', 'CPBL2')).toBeNull();
  });
});

describe('assignPosition', () => {
  const base = { level: 'CPBL1', age: 28 } as const;

  it('首次登錄取守得動的最高階守位', () => {
    const r = assignPosition({
      ...base,
      ability: glove(80, 80, 80),
      current: null,
      startPosition: 'SS',
    });
    expect(r.position).toBe('SS');
    expect(r.move).toBe('register');
  });

  it('守不動任何守位就登錄為指定打擊', () => {
    const r = assignPosition({
      ...base,
      ability: glove(20, 20, 20),
      current: null,
      startPosition: 'SS',
    });
    expect(r.position).toBe(DH);
    expect(r.move).toBe('register');
  });

  it('守備退化就往下一階移防，且理由說得出來', () => {
    const r = assignPosition({
      ...base,
      ability: glove(20, 60, 20),
      current: 'SS',
      startPosition: 'SS',
    });
    expect(r.position).not.toBe('SS');
    expect(r.move).toBe('demote');
    expect(r.reason).not.toBe('');
  });

  it('守備練回來可以往上移防——移防不是單向的', () => {
    const r = assignPosition({
      ...base,
      ability: glove(80, 80, 80),
      current: '1B',
      startPosition: 'SS',
    });
    expect(r.move).toBe('promote');
    expect(r.position).toBe('SS');
  });

  it('守得住就留著，不會每年亂換', () => {
    const r = assignPosition({
      ...base,
      ability: glove(80, 80, 80),
      current: 'SS',
      startPosition: 'SS',
    });
    expect(r.move).toBe('stay');
    expect(r.reason).toBe('');
  });

  it('內野手往內野光譜掉，不會被掃到外野', () => {
    const r = assignPosition({
      ...base,
      ability: glove(20, 55, 20),
      current: 'SS',
      startPosition: 'SS',
    });
    expect(positions.scan_order.IF).toContain(r.position);
  });

  it('外野手往外野光譜掉', () => {
    const r = assignPosition({
      ...base,
      ability: glove(40, 45, 40),
      current: 'CF',
      startPosition: 'CF',
    });
    expect([...positions.scan_order.OF, DH]).toContain(r.position);
  });

  it('捕手蹲得住就不必掃別的光譜', () => {
    const bar = positionAverageLine('C', 'CPBL1')!;
    const r = assignPosition({
      ...base,
      ability: player(20, { fld: bar + 5, cat: bar + 5, arm: bar + 5 }),
      current: 'C',
      startPosition: 'C',
    });
    expect(r.position).toBe('C');
  });

  it('捕手蹲不住就離開本壘板', () => {
    const r = assignPosition({
      ...base,
      ability: player(20, { fld: 25, cat: 25, arm: 25 }),
      current: 'C',
      startPosition: 'C',
    });
    expect(r.position).not.toBe('C');
    expect(r.move).toBe('demote');
  });

  it('離開本壘板的捕手，接捕練回來可以重披護具', () => {
    const bar = positionAverageLine('C', 'CPBL1')!;
    const r = assignPosition({
      ...base,
      ability: player(20, { fld: bar + 10, cat: bar + 10, arm: bar + 10 }),
      current: '1B',
      startPosition: 'C',
    });
    expect(r.position).toBe('C');
    expect(r.move).toBe('promote');
  });

  it('指定打擊要回到場上時兩條光譜都掃', () => {
    const r = assignPosition({
      ...base,
      ability: glove(80, 80, 80),
      current: DH,
      startPosition: 'SS',
    });
    expect(r.position).not.toBe(DH);
    expect(r.move).toBe('promote');
  });

  it('左投一壘手守備練起來也不會被移防到二三游', () => {
    const ability = glove(80, 80, 80);
    const right = assignPosition({ ...base, ability, current: '1B', startPosition: '1B' });
    const left = assignPosition({
      ...base,
      ability,
      current: '1B',
      startPosition: '1B',
      throws: 'L',
    });
    // 右投同樣的守備會被拉去游擊——證明這個測試咬得到東西。
    expect(right.position).toBe('SS');
    expect(left.position).toBe('1B');
    expect(left.move).toBe('stay');
  });

  it('左投掃不到二三游時往外野走，不是掉到指定打擊', () => {
    const r = assignPosition({
      ...base,
      ability: glove(80, 80, 80),
      current: null,
      startPosition: 'CF',
      throws: 'L',
    });
    expect(r.position).toBe('CF');
  });

  it('年輕的門檻折扣真的讓人守得住原本守不住的位置', () => {
    const ability = glove(48, 48, 48);
    const young = assignPosition({ ...base, age: 22, ability, current: null, startPosition: 'SS' });
    const old = assignPosition({ ...base, age: 32, ability, current: null, startPosition: 'SS' });
    expect(fieldingResponsibility(young.position)).toBeGreaterThanOrEqual(
      fieldingResponsibility(old.position),
    );
  });
});

describe('fieldingResponsibility', () => {
  it('捕手最重，一壘最輕——中線守位吃掉大半的守備責任', () => {
    const order = ['C', 'SS', '2B', 'CF', '3B', 'LF', '1B'];
    for (let i = 1; i < order.length; i++) {
      expect(fieldingResponsibility(order[i - 1]!)).toBeGreaterThanOrEqual(
        fieldingResponsibility(order[i]!),
      );
    }
    expect(fieldingResponsibility('C')).toBeGreaterThan(fieldingResponsibility('1B'));
  });

  it('右外野的責任略高於左外野——邊線與長傳本壘的臂力責任更重', () => {
    expect(fieldingResponsibility('RF')).toBeGreaterThan(fieldingResponsibility('LF'));
    expect(judgingAverage('RF', 'CPBL1', 30)!).toBeGreaterThan(judgingAverage('LF', 'CPBL1', 30)!);
  });

  it('指定打擊的責任是 0——不守備的人既無貢獻也無過失', () => {
    expect(fieldingResponsibility(DH)).toBe(0);
  });

  it('投手不分守備責任', () => {
    expect(fieldingResponsibility('P')).toBe(0);
  });
});

describe('defenseResponsibility', () => {
  it('責任額同時吃守位與出賽時間', () => {
    const full = defenseResponsibility('SS', 1);
    const half = defenseResponsibility('SS', 0.5);
    expect(half).toBeCloseTo(full / 2, 10);
  });

  it('傷缺全季就不承擔守備責任', () => {
    expect(defenseResponsibility('SS', 0)).toBe(0);
  });

  it('打滿的一壘手責任仍遠低於打滿的捕手', () => {
    expect(defenseResponsibility('1B', 1)).toBeLessThan(defenseResponsibility('C', 1));
  });
});

describe('defenseRuns', () => {
  const standards = initStandards();

  it('指定打擊不產生守備分', () => {
    expect(
      defenseRuns({
        ability: glove(80, 80, 80),
        position: DH,
        level: 'CPBL1',
        standards,
        gamesShare: 1,
      }),
    ).toBe(0);
  });

  it('守得比同守位平均好是正的，差是負的——逐年的數據誠實記錄', () => {
    const good = defenseRuns({
      ability: glove(80, 80, 80),
      position: 'SS',
      level: 'CPBL1',
      standards,
      gamesShare: 1,
    });
    const bad = defenseRuns({
      ability: glove(20, 20, 20),
      position: 'SS',
      level: 'CPBL1',
      standards,
      gamesShare: 1,
    });
    expect(good).toBeGreaterThan(0);
    expect(bad).toBeLessThan(0);
  });

  /**
   * 這是換掉基準之後最重要的一條。
   *
   * 舊版用聯盟一般 par 當基準，於是「勉強守得住游擊」拿 +6、「勉強守得住一壘」
   * 拿 −8——但這兩個人本質上是同一件事。改成同守位平均之後，兩者都應該貼近 0。
   */
  it('各守位「剛好在平均線上」的人，守備分都是 0', () => {
    for (const pos of ['C', 'SS', '2B', '3B', 'CF', 'RF', 'LF', '1B']) {
      const avg = positionAverage(pos, 'CPBL1')!;
      // 該守位權重加總為 1，所以三項都設成平均值時守備分剛好等於平均線
      const ability = player(avg);
      expect(defenseScore(ability, pos)).toBeCloseTo(avg, 6);
      expect(defenseRuns({ ability, position: pos, level: 'CPBL1', standards, gamesShare: 1 })).toBe(
        0,
      );
    }
  });

  it('同樣超出自己守位平均的幅度，每個守位拿到的守備分一樣', () => {
    const over = 10;
    const value = (pos: string) => {
      const ability = player(positionAverage(pos, 'CPBL1')! + over);
      return defenseRuns({ ability, position: pos, level: 'CPBL1', standards, gamesShare: 1 });
    };
    // 守位價值不在這個數字裡，它在勝利份額的責任占比上（ADR 0048）。
    for (const pos of ['SS', '2B', 'LF', '1B']) {
      expect(value(pos)).toBe(value('C'));
    }
  });

  it('守位價值改由責任占比承擔——同樣的守備分，捕手的份額遠大於一壘手', () => {
    expect(defenseResponsibility('C', 1)).toBeGreaterThan(defenseResponsibility('SS', 1));
    expect(defenseResponsibility('SS', 1)).toBeGreaterThan(defenseResponsibility('2B', 1));
    expect(defenseResponsibility('2B', 1)).toBeGreaterThan(defenseResponsibility('LF', 1));
    expect(defenseResponsibility('LF', 1)).toBeGreaterThan(defenseResponsibility('1B', 1));
  });

  it('守位平均越高的位置越難超出——同一組能力在一壘拿到的守備分比在游擊高', () => {
    // 70/70/70 在兩個守位都頂到夾子，量不出差別；60 才落在曲線上。
    const ability = glove(60, 60, 60);
    const ss = defenseRuns({ ability, position: 'SS', level: 'CPBL1', standards, gamesShare: 1 });
    const first = defenseRuns({
      ability,
      position: '1B',
      level: 'CPBL1',
      standards,
      gamesShare: 1,
    });
    expect(first).toBeGreaterThan(ss);
  });

  it('出賽越少，守備分越少', () => {
    const ability = glove(80, 80, 80);
    const full = defenseRuns({ ability, position: 'SS', level: 'CPBL1', standards, gamesShare: 1 });
    const half = defenseRuns({
      ability,
      position: 'SS',
      level: 'CPBL1',
      standards,
      gamesShare: 0.5,
    });
    expect(half).toBeLessThan(full);
    expect(half).toBeGreaterThan(0);
  });
});

describe('positionLabel', () => {
  it('說得出中文名', () => {
    expect(positionLabel('SS')).toBe('游擊手');
    expect(positionLabel(DH)).toBe('指定打擊');
  });
});
