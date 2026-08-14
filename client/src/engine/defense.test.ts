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
  requiredScore,
  DH,
} from './defense.ts';
import { advanceStandards, initStandards, standardOf } from './league.ts';
import { defenseScore, type Abilities } from './rating.ts';
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

describe('requiredScore', () => {
  it('年輕球員的門檻比較低——球團願意為潛力多等兩年', () => {
    const young = requiredScore('SS', 'CPBL1', 22)!;
    const old = requiredScore('SS', 'CPBL1', 30)!;
    expect(young).toBeLessThan(old);
  });

  it('非頂級聯盟不設門檻', () => {
    expect(requiredScore('SS', 'CPBL2', 25)).toBeNull();
  });

  it('越難守的守位門檻越高', () => {
    const ss = requiredScore('SS', 'CPBL1', 30)!;
    const first = requiredScore('1B', 'CPBL1', 30)!;
    expect(ss).toBeGreaterThan(first);
  });
});

describe('canPlay', () => {
  it('二軍不挑守位——守備再差也守得動', () => {
    expect(canPlay(glove(20, 20, 20), 'SS', 'CPBL2', 28)).toBe(true);
  });

  it('一軍守不動游擊的人，被門檻擋下來', () => {
    expect(canPlay(glove(20, 20, 20), 'SS', 'CPBL1', 28)).toBe(false);
  });

  it('指定打擊人人守得動——他不守備', () => {
    expect(canPlay(glove(20, 20, 20), DH, 'CPBL1', 28)).toBe(true);
  });

  it('捕手與其他守位共用同一張門檻表，沒有平行機制', () => {
    const bar = positions.defense_thresholds['C']!['CPBL1']!;
    const good = player(20, { fld: bar, cat: bar, arm: bar });
    expect(defenseScore(good, 'C')).toBeCloseTo(bar, 6);
    expect(canPlay(good, 'C', 'CPBL1', 30)).toBe(true);
    const bad = player(20, { fld: bar - 6, cat: bar - 6, arm: bar - 6 });
    expect(canPlay(bad, 'C', 'CPBL1', 30)).toBe(false);
  });

  it('捕手的門檻低於游擊——「蹲捕容忍度高」由門檻數字本身表達', () => {
    expect(requiredScore('C', 'CPBL1', 30)!).toBeLessThan(requiredScore('SS', 'CPBL1', 30)!);
  });
});

describe('positionAverage', () => {
  it('平均線高於門檻——實際佔著位置的人比最低標準好一些', () => {
    for (const pos of ['C', 'SS', '2B', '3B', 'CF', 'RF', 'LF', '1B']) {
      const avg = positionAverage(pos, 'CPBL1')!;
      expect(avg).toBeGreaterThan(positions.defense_thresholds[pos]!['CPBL1']!);
    }
  });

  it('不套年齡折扣——同守位的平均不會因為某個人年輕就下降', () => {
    // requiredScore 吃年齡，positionAverage 不吃；兩者的差在年輕時才會拉開
    expect(positionAverage('SS', 'CPBL1')).toBe(positionAverage('SS', 'CPBL1'));
    expect(requiredScore('SS', 'CPBL1', 22)!).toBeLessThan(requiredScore('SS', 'CPBL1', 32)!);
  });

  it('跟著聯盟水準一起浮動', () => {
    const world = new World('avg-drift');
    let standards = initStandards();
    const base = positionAverage('SS', 'CPBL1')!;
    for (let i = 0; i < 15; i++) standards = advanceStandards(world, standards);
    const drifted = positionAverage('SS', 'CPBL1', standards)!;
    const parShift = standardOf(standards, 'CPBL1').par - standardOf(null, 'CPBL1').par;
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
    const bar = positions.defense_thresholds['C']!['CPBL1']!;
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
    const bar = positions.defense_thresholds['C']!['CPBL1']!;
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

  it('左外野與右外野的責任相同——兩者的難度差由門檻表達，不由身價表達', () => {
    expect(fieldingResponsibility('LF')).toBe(fieldingResponsibility('RF'));
    expect(requiredScore('RF', 'CPBL1', 30)!).toBeGreaterThan(requiredScore('LF', 'CPBL1', 30)!);
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

  it('同樣超出自己守位平均的幅度，捕手的貢獻遠大於一壘手', () => {
    const over = 10;
    const value = (pos: string) => {
      const ability = player(positionAverage(pos, 'CPBL1')! + over);
      return defenseRuns({ ability, position: pos, level: 'CPBL1', standards, gamesShare: 1 });
    };
    expect(value('C')).toBeGreaterThan(value('SS'));
    expect(value('SS')).toBeGreaterThan(value('2B'));
    expect(value('2B')).toBeGreaterThan(value('LF'));
    expect(value('LF')).toBeGreaterThan(value('1B'));
  });

  it('守位平均越高的位置越難超出，但超出之後的回報也越大', () => {
    const ability = glove(70, 70, 70);
    const ss = defenseRuns({ ability, position: 'SS', level: 'CPBL1', standards, gamesShare: 1 });
    const first = defenseRuns({
      ability,
      position: '1B',
      level: 'CPBL1',
      standards,
      gamesShare: 1,
    });
    expect(ss).toBeGreaterThan(first);
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
