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
    expect(handednessTier(P('R', 'R', ['switch_pitcher']))).toBe('switch');
    expect(handednessTier(P('L', 'R', ['switch_pitcher']))).toBe('switch');
  });
});

describe('對價', () => {
  it('順風與代價成對——每一檔兩邊都不為零', () => {
    for (const tier of ['left', 'switch'] as const) {
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
