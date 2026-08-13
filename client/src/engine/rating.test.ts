import { describe, expect, it } from 'vitest';
import { ALL_ABILITIES } from '../data/index.ts';
import { defenseScore, fielderRating, pitcherRating, rate, ratingPosition } from './rating.ts';

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

  it('只取最好的三項——第四顆球再好也不加分', () => {
    const three = build(30, { vel: 70, ctl: 70, swp: 70 });
    const four = build(30, { vel: 70, ctl: 70, swp: 70, drp: 70 });
    expect(pitcherRating(four)).toBe(pitcherRating(three));
  });

  it('體力有貢獻但權重最低', () => {
    const stamina = build(40, { sta: 80 });
    const stuff = build(40, { swp: 80 });
    expect(pitcherRating(stamina)).toBeGreaterThan(pitcherRating(build(40)));
    expect(pitcherRating(stuff)).toBeGreaterThan(pitcherRating(stamina));
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

  it('失憶症讓系統評價下降', () => {
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
  it('外野的起始守位推定為中外野', () => {
    expect(ratingPosition('LF')).toBe('CF');
    expect(ratingPosition('RF')).toBe('CF');
  });

  it('捕手維持捕手', () => {
    expect(ratingPosition('C')).toBe('C');
  });

  it('其餘一律推定為游擊', () => {
    expect(ratingPosition('UTIL')).toBe('SS');
    expect(ratingPosition('P')).toBe('SS');
  });
});
