import { describe, expect, it } from 'vitest';
import { isAppearance } from '../../api/contract.ts';
import { hueMatrix } from '../card/careerImage.ts';
import { DEFAULT_APPEARANCE, hueDegrees, pickTheme } from './appearance.ts';

describe('點主題鈕', () => {
  it('點沒選的主題是換主題，色相不動', () => {
    const next = pickTheme(DEFAULT_APPEARANCE, 'c');
    expect(next.theme).toBe('c');
    expect(next.hues).toEqual(DEFAULT_APPEARANCE.hues);
  });

  it('點已選的主題轉一格 60°，六次回到原色', () => {
    let a = DEFAULT_APPEARANCE;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      a = pickTheme(a, 'a');
      seen.push(hueDegrees(a));
    }
    expect(seen).toEqual([60, 120, 180, 240, 300, 0]);
  });

  it('每一套各自記住轉到哪', () => {
    let a = pickTheme(pickTheme(DEFAULT_APPEARANCE, 'a'), 'a'); // 科技藍轉兩格
    a = pickTheme(a, 'c'); // 換到報紙版面：原色
    expect(hueDegrees(a)).toBe(0);
    a = pickTheme(a, 'a'); // 切回科技藍：還是第二格
    expect(hueDegrees(a)).toBe(120);
  });
});

describe('色相矩陣', () => {
  it('0° 與 360° 都是原樣', () => {
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (const deg of [0, 360]) {
      hueMatrix(deg).forEach((v, i) => expect(v).toBeCloseTo(identity[i]!, 3));
    }
  });
});

describe('外觀設定的格式', () => {
  it('認得的主題、一圈之內的整數格', () => {
    expect(isAppearance(DEFAULT_APPEARANCE)).toBe(true);
    expect(isAppearance({ theme: 'e', hues: { a: 0, b: 0, c: 0, d: 0 } })).toBe(false);
    expect(isAppearance({ theme: 'a', hues: { a: 6, b: 0, c: 0, d: 0 } })).toBe(false);
    expect(isAppearance({ theme: 'a', hues: { a: 0, b: 0, c: 0 } })).toBe(false);
    expect(isAppearance(null)).toBe(false);
  });
});
