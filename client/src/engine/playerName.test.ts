import { describe, expect, it } from 'vitest';
import { clampName, displayName, nameWidth } from './playerName.ts';

describe('姓名寬度', () => {
  it('中文算 2、英數算 1', () => {
    expect(nameWidth('林家正')).toBe(6);
    expect(nameWidth('Ichiro')).toBe(6);
    expect(nameWidth('王A')).toBe(3);
  });
});

describe('輸入上限', () => {
  it('八個中文字、十六個英文字母剛好放得下', () => {
    expect(clampName('一二三四五六七八')).toBe('一二三四五六七八');
    expect(clampName('abcdefghijklmnop')).toBe('abcdefghijklmnop');
  });

  it('超過的部分丟掉，不會把中文字切成一半', () => {
    expect(clampName('一二三四五六七八九')).toBe('一二三四五六七八');
    expect(clampName('abcdefghijklmno一')).toBe('abcdefghijklmno');
  });
});

describe('顯示', () => {
  it('寬度 16 以內顯示全名', () => {
    expect(displayName('一二三四五六七八')).toBe('一二三四五六七八');
    expect(displayName('abcdefghijklmnop')).toBe('abcdefghijklmnop');
  });

  it('超過的截成六個中文字寬再接刪節號', () => {
    expect(displayName('一二三四五六七八九')).toBe('一二三四五六……');
    expect(displayName('一二三四五六七八九十')).toBe('一二三四五六……');
    expect(displayName('abcdefghijklmnopq')).toBe('abcdefghijkl……');
  });
});
