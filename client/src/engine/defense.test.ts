import { describe, expect, it } from 'vitest';
import { ALL_ABILITIES, positions } from '../data/index.ts';
import {
  assignPosition,
  canPlay,
  defenseRuns,
  positionLabel,
  requiredScore,
  DH,
} from './defense.ts';
import { initStandards } from './league.ts';
import { defenseScore, type Abilities } from './rating.ts';

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

  it('捕手走自己的基準線，不用 defense_thresholds', () => {
    const bar = positions.catcher_bar.base['CPBL1']!;
    const good = player(20, { fld: bar, cat: bar, arm: bar });
    expect(defenseScore(good, 'C')).toBeCloseTo(bar, 6);
    expect(canPlay(good, 'C', 'CPBL1', 30)).toBe(true);
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
    const bar = positions.catcher_bar.base['CPBL1']!;
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
    const bar = positions.catcher_bar.base['CPBL1']!;
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
    expect(positions.rank[young.position]!).toBeLessThanOrEqual(positions.rank[old.position]!);
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

  it('守備優於聯盟平均是正的，低於是負的——逐年的數據誠實記錄', () => {
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

  it('同樣的守備能力，守游擊的貢獻大於守一壘', () => {
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
