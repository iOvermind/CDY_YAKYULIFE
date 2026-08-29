import { describe, expect, it } from 'vitest';
import { abilities, ALL_ABILITIES, amateur, positions } from '../data/index.ts';
import {
  baseThreshold,
  battingRating,
  defenseScore,
  fieldingPosition,
  fielderRating,
  pitcherRating,
  rate,
  ratingPosition,
  twoWayPositionBonus,
} from './rating.ts';

const build = (base: number, over: Record<string, number> = {}) => ({
  ...Object.fromEntries(ALL_ABILITIES.map((k) => [k, base])),
  ...over,
});

describe('defenseScore', () => {
  it('依守位的能力權重加權', () => {
    // 游擊看重守備範圍：範圍高的分數應該比臂力高的好
    const ranger = build(40, { rng: 70 });
    const cannon = build(40, { arm: 70 });
    expect(defenseScore(ranger, 'SS')).toBeGreaterThan(defenseScore(cannon, 'SS'));
  });

  it('三壘看重臂力——與游擊相反', () => {
    const ranger = build(40, { rng: 70 });
    const cannon = build(40, { arm: 70 });
    expect(defenseScore(cannon, '3B')).toBeGreaterThan(defenseScore(ranger, '3B'));
  });

  it('捕手看重配球，其他守位完全不看', () => {
    const caller = build(40, { cat: 80 });
    expect(defenseScore(caller, 'C')).toBeGreaterThan(defenseScore(build(40), 'C'));
    expect(defenseScore(caller, 'SS')).toBe(defenseScore(build(40), 'SS'));
  });

  it('未知守位回傳 0，不丟錯', () => {
    expect(defenseScore(build(50), 'DH')).toBe(0);
  });
});

describe('pitcherRating', () => {
  it('一顆好球加基本功勝過四顆平庸的球', () => {
    const ace = build(30, { vel: 70, ctl: 65, swp: 75 });
    const spread = build(52);
    expect(pitcherRating(ace)).toBeGreaterThan(pitcherRating(spread));
  });

  it('武器庫是平均水準，不是件數——同水準的第四顆球不加分', () => {
    const two = build(30, { vel: 70, swp: 70 });
    const four = build(30, { vel: 70, swp: 70, drp: 70, chg: 70 });
    expect(pitcherRating(four)).toBe(pitcherRating(two));
  });

  it('點數固定時，攤薄反而扣分——三顆 60 的人多練一顆變成四顆 55', () => {
    const deep = build(30, { vel: 60, swp: 60, drp: 60 });
    const wide = build(30, { vel: 55, swp: 55, drp: 55, chg: 55 });
    expect(pitcherRating(deep)).toBeGreaterThan(pitcherRating(wide));
  });

  it('上限低的人靠多練球種補回來——五顆 62 追平兩顆 70', () => {
    const capped = build(30, { vel: 62, swp: 62, drp: 62, chg: 62, gim: 62 });
    const gifted = build(30, { vel: 70, swp: 70 });
    expect(pitcherRating(capped)).toBeLessThan(pitcherRating(gifted));
    expect(pitcherRating(capped)).toBeGreaterThan(pitcherRating(build(30, { vel: 70 })));
  });

  it('練出更好的一顆球一定加分', () => {
    const before = build(30, { vel: 70, swp: 70 });
    const after = build(30, { vel: 70, swp: 70, drp: 90 });
    expect(pitcherRating(after)).toBeGreaterThan(pitcherRating(before));
  });

  it('控球是基本功，不參與排序', () => {
    const wild = build(30, { vel: 90, swp: 90, ctl: 20 });
    const command = build(30, { vel: 90, swp: 90, ctl: 90 });
    expect(pitcherRating(command)).toBeGreaterThan(pitcherRating(wild));
  });

  it('體力完全不進評價——野手側不看它，投手側也不該重複計價', () => {
    const rested = build(40, { sta: 80 });
    expect(pitcherRating(rested)).toBe(pitcherRating(build(40, { sta: 20 })));
  });

  it('依角色走兩套權重：牛棚那套武器庫佔比更高、控球佔比更低', () => {
    const stuff = build(30, { vel: 85, swp: 85, ctl: 40 });
    const command = build(30, { vel: 55, swp: 55, ctl: 90 });
    // 折扣是角色的成本，比的是折扣以外的權重分配。
    const rp = abilities.overall.pitcher.roles['RP']?.discount ?? 0;
    const spGap = pitcherRating(command, 'SP') - pitcherRating(stuff, 'SP');
    const rpGap = pitcherRating(command, 'RP') + rp - (pitcherRating(stuff, 'RP') + rp);
    expect(spGap).toBeGreaterThan(rpGap);
  });

  it('後援吃角色折扣——責任額由角色決定，能力再高也補不回來', () => {
    const ability = build(50, { sta: 50 });
    const w = abilities.overall.pitcher.roles;
    const undiscounted = pitcherRating(ability, 'RP') + (w['RP']?.discount ?? 0);
    expect(undiscounted).toBeGreaterThan(pitcherRating(ability, 'RP'));
    expect(w['RP']?.discount ?? 0).toBeGreaterThan(0);
    expect(w['SP']?.discount ?? 0).toBe(0);
  });

  it('省略角色時取兩套較高者', () => {
    const flame = build(30, { vel: 85, ctl: 55, swp: 60, sta: 25 });
    expect(pitcherRating(flame)).toBe(
      Math.max(pitcherRating(flame, 'SP'), pitcherRating(flame, 'RP')),
    );
  });

});

describe('fielderRating', () => {
  it('打擊與守備都會影響', () => {
    const base = build(40);
    expect(fielderRating(build(40, { pow: 75 }), 'SS')).toBeGreaterThan(fielderRating(base, 'SS'));
    expect(fielderRating(build(40, { rng: 75 }), 'SS')).toBeGreaterThan(fielderRating(base, 'SS'));
  });

  it('關鍵守位的守備佔比較高', () => {
    const glove = build(40, { rng: 80, fld: 80 });
    // 同一個球員，守游擊比守一壘更能把守備轉換成評價
    expect(fielderRating(glove, 'SS')).toBeGreaterThan(fielderRating(glove, '1B'));
  });

  it('指定打擊沒有守備價值——同樣打擊下一壘手恆優於 DH', () => {
    const hitter = build(50);
    expect(fielderRating(hitter, '1B')).toBeGreaterThan(fielderRating(hitter, 'DH'));
  });
});

describe('rate', () => {
  it('整體取兩側較高者', () => {
    const r = rate(build(40, { vel: 78, ctl: 75, swp: 78 }), { position: 'SS' });
    expect(r.better).toBe('pitcher');
    expect(r.overall).toBe(r.pitcher);
  });

  it('野手強的人整體取野手側', () => {
    const r = rate(build(30, { con: 75, pow: 75, eye: 70, spd: 70, rng: 70, fld: 70 }), {
      position: 'SS',
    });
    expect(r.better).toBe('fielder');
    expect(r.overall).toBe(r.fielder);
  });

  it('巧克力讓系統評價下降', () => {
    const ability = build(50);
    const plain = rate(ability, { position: 'SS' });
    const yips = rate(ability, { position: 'SS', traits: new Set(['yips']) });
    expect(yips.overall).toBeLessThan(plain.overall);
  });

  it('無關的特性不影響評價', () => {
    const ability = build(50);
    expect(rate(ability, { position: 'SS', traits: new Set(['iron']) }).overall).toBe(
      rate(ability, { position: 'SS' }).overall,
    );
  });

  it('兩側都強的人，整體不會低於任一側', () => {
    const twoWay = build(70);
    const r = rate(twoWay, { position: 'SS' });
    expect(r.overall).toBeGreaterThanOrEqual(r.pitcher);
    expect(r.overall).toBeGreaterThanOrEqual(r.fielder);
  });
});

describe('ratingPosition', () => {
  it('真實守位一律對應自己', () => {
    for (const p of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
      expect(ratingPosition(p)).toBe(p);
    }
  });

  it('沒有登錄守位的人以指定打擊為基準', () => {
    expect(ratingPosition('P')).toBe('DH');
    expect(ratingPosition('UTIL')).toBe('DH');
    expect(ratingPosition('DH')).toBe('DH');
  });

  it('認不出來的起始守位不會被當成守得住游擊', () => {
    expect(ratingPosition('無此守位')).toBe('DH');
  });

  it('工具人依守備能力推定，不是一律指定打擊', () => {
    const glove = build(80);
    const auto = { ability: glove, level: 'CPBL1' };
    expect(ratingPosition('UTIL', auto)).toBe(fieldingPosition(glove, 'CPBL1'));
    expect(ratingPosition('UTIL', auto)).not.toBe('DH');
  });

  it('工具人是左投時推不出二三游（#54）', () => {
    const glove = build(80);
    expect(ratingPosition('UTIL', { ability: glove, level: 'CPBL1' })).toBe('SS');
    const left = ratingPosition('UTIL', { ability: glove, level: 'CPBL1', throws: 'L' });
    expect(['2B', '3B', 'SS']).not.toContain(left);
    // 但也不該因此掉到指定打擊——他守得動的位置還多的是。
    expect(left).not.toBe('DH');
  });

  it('推定守位跟著所在體系的尺走，不是一律用中職量（#13）', () => {
    // 守備門檻是「該層級 par + 位移」，層級越高門檻越高。同一副手套在中職
    // 上得了的守位，到大聯盟不一定上得了——評價因此必須帶當下的層級進來。
    const glove = build(55);
    const rank = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B', 'DH'];
    const home = ratingPosition('UTIL', { ability: glove, level: 'CPBL1' });
    const abroad = ratingPosition('UTIL', { ability: glove, level: 'MLB' });
    expect(rank.indexOf(abroad)).toBeGreaterThanOrEqual(rank.indexOf(home));
  });

  it('守備真的很差的工具人才落到指定打擊', () => {
    const stone = build(15);
    expect(ratingPosition('UTIL', { ability: stone, level: 'CPBL1' })).toBe('DH');
  });

  it('投手不受影響——他本來就不站守位', () => {
    const glove = build(80);
    expect(ratingPosition('P', { ability: glove, level: 'CPBL1' })).toBe('DH');
  });
});

describe('二刀流的野手側', () => {
  const TWO_WAY = new Set(['two_way']);
  // 打擊好、守備爛：合成制對他最不利的那種人。
  const slugger = build(30, { con: 70, pow: 70, eye: 65, spd: 60 });

  it('以純打擊為基準，指定打擊不加分', () => {
    const batting = battingRating(slugger);
    expect(fielderRating(slugger, 'DH', { twoWay: true })).toBeCloseTo(batting, 10);
  });

  it('守位只會往上加，永遠不會扣分', () => {
    const batting = battingRating(slugger);
    for (const p of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
      expect(fielderRating(slugger, p, { twoWay: true })).toBeGreaterThan(batting);
    }
  });

  it('加分依守位難度排序，捕手最高、一壘最低', () => {
    expect(twoWayPositionBonus('C')).toBeCloseTo(6, 10);
    expect(twoWayPositionBonus('SS')).toBeCloseTo(5, 10);
    expect(twoWayPositionBonus('1B')).toBeCloseTo(0.75, 10);
    expect(twoWayPositionBonus('DH')).toBe(0);
  });

  it('加分依出賽比重折算——投球日不能守備', () => {
    expect(twoWayPositionBonus('SS', 0.8)).toBeCloseTo(4, 10);
    expect(twoWayPositionBonus('SS', 0)).toBe(0);
  });

  it('守備爛的二刀流不會因為站上游擊而變差', () => {
    // 純野手走合成制，守備爛就會被稀釋；二刀流不該重蹈覆轍。
    const pure = fielderRating(slugger, 'SS');
    const twoWay = fielderRating(slugger, 'SS', { twoWay: true });
    expect(pure).toBeLessThan(battingRating(slugger));
    expect(twoWay).toBeGreaterThan(pure);
  });

  it('rate() 依二刀流特性自動切換算法', () => {
    const withTrait = rate(slugger, { position: 'SS', traits: TWO_WAY });
    const without = rate(slugger, { position: 'SS' });
    expect(withTrait.fielder).toBeGreaterThan(without.fielder);
    expect(withTrait.fielder).toBe(
      Math.round(battingRating(slugger) + twoWayPositionBonus('SS')),
    );
  });

  it('純野手的評價不受影響', () => {
    const pure = build(50, { con: 60, rng: 55 });
    expect(rate(pure, { position: 'SS' }).fielder).toBe(
      Math.round(fielderRating(pure, 'SS')),
    );
  });
});

describe('fieldingPosition', () => {
  const LEVEL = 'CPBL1';
  const flat = (v: number) => build(v);

  it('守備一塌糊塗的人是 DH', () => {
    expect(fieldingPosition(flat(15), LEVEL)).toBe(positions.scan_order.fallback);
  });

  it('守備頂尖的人守得動最難的守位', () => {
    // 游擊的門檻最高，全能守備者應該落在那裡
    expect(fieldingPosition(flat(80), LEVEL)).toBe('SS');
  });

  it('取的是守得動的最高階守位，不是守備分最高的守位', () => {
    // 門檻越高的守位越難守也越有價值——這是 scan_order 的定義
    const pos = fieldingPosition(flat(80), LEVEL);
    const required = baseThreshold(pos, LEVEL) ?? 0;
    for (const other of [...positions.scan_order.IF, ...positions.scan_order.OF]) {
      const otherReq = baseThreshold(other, LEVEL) ?? 0;
      if (otherReq <= required) continue;
      // 更高階的守位一定是守不動才沒被選
      expect(defenseScore(flat(80), other)).toBeLessThan(otherReq);
    }
  });

  it('守備能力越好，守得動的守位越高階', () => {
    const req = (v: number) =>
      baseThreshold(fieldingPosition(flat(v), LEVEL), LEVEL) ?? 0;
    expect(req(80)).toBeGreaterThan(req(45));
  });

  it('門檻越高的聯盟越容易被擠到 DH', () => {
    const mid = flat(52);
    const cpbl = fieldingPosition(mid, 'CPBL1');
    const mlb = fieldingPosition(mid, 'MLB');
    const rank = (p: string) => baseThreshold(p, 'CPBL1') ?? 0;
    expect(rank(mlb)).toBeLessThanOrEqual(rank(cpbl));
  });

  it('養成階段用該學制自己的 par，不是職業的尺（ADR 0021 修正）', () => {
    // 國中的游擊要跟國中的游擊比。借中職一軍的尺會讓整個養成期只剩 DH。
    expect(baseThreshold('SS', 'JHS')).toBe(amateur.cups.JHS.par + 5);
    expect(baseThreshold('SS', 'HS')).toBe(amateur.cups.HS.par + 5);
    expect(baseThreshold('SS', 'JHS')!).toBeLessThan(baseThreshold('SS', 'CPBL1')!);
  });

  it('養成階段的中間值守得動內野，不會被擠成 DH', () => {
    expect(fieldingPosition(flat(40), 'JHS')).not.toBe('DH');
  });

  it('相同能力永遠得到相同守位——沒有隨機成分', () => {
    expect(fieldingPosition(flat(55), LEVEL)).toBe(fieldingPosition(flat(55), LEVEL));
  });
});
