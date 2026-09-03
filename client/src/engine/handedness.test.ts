import { describe, expect, it } from 'vitest';
import { abilities } from '../data/index.ts';
import { discountedPotential, handednessTier, standardDiscount } from './handedness.ts';

const P = (throws: 'R' | 'L' | 'S', bats: 'R' | 'L' | 'S', traits: string[] = []) => ({
  throws,
  bats,
  traits: new Set(traits),
});

describe('慣用手檔次', () => {
  it('右投右打不吃任何對價', () => {
    expect(handednessTier(P('R', 'R'))).toBe('none');
    expect(standardDiscount('none')).toBe(0);
    expect(discountedPotential(74, 'none')).toBe(74);
  });

  it('左投或左打落在同一檔', () => {
    expect(handednessTier(P('L', 'R'))).toBe('left');
    expect(handednessTier(P('R', 'L'))).toBe('left');
  });

  it('檔次取代不累加——左投左打不會比單邊更深', () => {
    expect(handednessTier(P('L', 'L'))).toBe('left');
  });

  it('左右開弓取最深的一檔', () => {
    expect(handednessTier(P('R', 'S'))).toBe('switch');
    expect(handednessTier(P('L', 'S'))).toBe('switch');
  });

  it('左右開投是後天特性，拿到的當下就換檔', () => {
    expect(handednessTier(P('R', 'R'))).toBe('none');
    expect(handednessTier(P('R', 'R', ['switch_pitcher']))).toBe('switch_pitcher');
    expect(handednessTier(P('L', 'R', ['switch_pitcher']))).toBe('switch_pitcher');
  });

  it('左右開弓的打者壓過左右開投——多會一件事不該讓折扣變便宜', () => {
    // 兩檔的順風同級，但左右開投那一檔的潛力折扣比較輕。兩者都有的人若掉進
    // 比較輕的那一檔，等於「學會第二件事之後代價反而變小」。
    expect(handednessTier(P('R', 'S', ['switch_pitcher']))).toBe('switch');
  });
});

describe('對價', () => {
  it('左右開投的順風與左右開弓同級，但天花板的代價輕一檔', () => {
    // 那個特性是養成期擲出來的，而潛力折扣會回頭咬他出生時抽到的潛力——用打者
    // 那一檔的 25% 等於在事後追罰一件他沒得選的事。
    expect(standardDiscount('switch_pitcher')).toBe(standardDiscount('switch'));
    expect(discountedPotential(60, 'switch_pitcher')).toBeGreaterThan(
      discountedPotential(60, 'switch'),
    );
    expect(discountedPotential(60, 'switch_pitcher')).toBe(discountedPotential(60, 'left'));
  });

  it('順風與代價成對——每一檔兩邊都不為零', () => {
    for (const tier of ['left', 'switch', 'switch_pitcher'] as const) {
      expect(standardDiscount(tier)).toBeGreaterThan(0);
      expect(discountedPotential(74, tier)).toBeLessThan(74);
    }
  });

  it('越深的檔次，順風越大、代價也越大', () => {
    expect(standardDiscount('switch')).toBeGreaterThan(standardDiscount('left'));
    expect(discountedPotential(74, 'switch')).toBeLessThan(discountedPotential(74, 'left'));
  });

  it('潛力折扣無條件捨去——不四捨五入成免費的半點', () => {
    expect(discountedPotential(74, 'left')).toBe(62); // 74 × 0.85 = 62.9
    expect(discountedPotential(74, 'switch')).toBe(55); // 74 × 0.75 = 55.5
  });

  it('折後潛力不會掉到硬底線以下', () => {
    expect(discountedPotential(1, 'switch')).toBeGreaterThanOrEqual(
      abilities.scale.hard_floor,
    );
  });
});
