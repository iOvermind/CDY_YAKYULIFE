/**
 * 更新紀錄的轉檔。
 *
 * 兩件事要釘住。一是**解析器認得 `CHANGELOG_RULES.md` 定的版面**——版本標題、
 * 類別標題、單行條目、行內語法。二是**產物與 `CHANGELOG.md` 沒有走鐘**：那份
 * JSON 是產生出來的，但它進了版本控制，有人手改或忘了重跑就會與原始檔對不上，
 * 而畫面上不會有任何徵兆。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error 轉檔腳本是 .mjs，沒有型別宣告；這裡只在測試裡用它。
import { parseChangelog } from './changelog.mjs';

const parse = parseChangelog as (markdown: string) => {
  version: string;
  date: string | null;
  note: { kind: string; text: string }[];
  categories: { key: string; name: string; entries: { kind: string; text: string }[][] }[];
}[];

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('更新紀錄的轉檔', () => {
  it('版本標題帶日期，Unreleased 不帶', () => {
    const out = parse(
      ['# 前言', '', '## [Unreleased]', '', '## [0.1.0] - 2026-09-06', '', '### Fixed (修復)', '', '- 修好了。'].join(
        '\n',
      ),
    );
    expect(out.map((v) => [v.version, v.date])).toEqual([
      ['Unreleased', null],
      ['0.1.0', '2026-09-06'],
    ]);
  });

  it('行內語法只認粗體、行內程式碼與連結，連結轉成純文字', () => {
    const [v] = parse(
      ['## [0.1.0] - 2026-09-06', '', '### Added (新增)', '', '- **粗** 與 `code`，見 [ADR 0007](docs/adr/x.md)。'].join(
        '\n',
      ),
    );
    expect(v?.categories[0]?.entries[0]).toEqual([
      { kind: 'strong', text: '粗' },
      { kind: 'text', text: ' 與 ' },
      { kind: 'code', text: 'code' },
      // 連結只剩文字——它指向 repo 裡的檔案，玩家點了也打不開。而且與前後的純文字
      // 併成一段：一條變更切成三十個 span 只是讓 DOM 變胖，讀起來沒有任何差別。
      { kind: 'text', text: '，見 ADR 0007。' },
    ]);
  });

  it('中文的續行不補空白', () => {
    const [v] = parse(
      ['## [0.1.0] - 2026-09-06', '', '### Fixed (修復)', '', '- 前半句——', '  後半句。'].join('\n'),
    );
    expect(v?.categories[0]?.entries[0]?.map((p) => p.text).join('')).toBe('前半句——後半句。');
  });

  it('空的類別是錯的——規範明文「沒有內容的類別必須整節省略」', () => {
    expect(() => parse(['## [0.1.0] - 2026-09-06', '', '### Fixed (修復)', ''].join('\n'))).toThrow(
      /是空的/,
    );
  });

  // 底下三條守的是「類別名就是結構」。`### Fixed (修正)`（規範寫的是「修復」）曾經
  // 過了建置、進了遊戲，隔了一版才被發現——正規式當時中文括號裡填什麼都收。
  it('自創的類別不收', () => {
    expect(() =>
      parse(['## [0.1.0] - 2026-09-06', '', '### Bugs (蟲)', '', '- 修好了。'].join('\n')),
    ).toThrow(/不是六個標準類別之一/);
  });

  it('中譯寫錯不收', () => {
    expect(() =>
      parse(['## [0.1.0] - 2026-09-06', '', '### Fixed (修正)', '', '- 修好了。'].join('\n')),
    ).toThrow(/必須是「修復」/);
  });

  it('類別順序不對不收——同一類重複出現也是', () => {
    const back = ['## [0.1.0] - 2026-09-06', '', '### Fixed (修復)', '', '- 修好了。', '', '### Added (新增)', '', '- 加了。'];
    expect(() => parse(back.join('\n'))).toThrow(/順序不對/);
    const twice = ['## [0.1.0] - 2026-09-06', '', '### Added (新增)', '', '- 加了。', '', '### Added (新增)', '', '- 又加了。'];
    expect(() => parse(twice.join('\n'))).toThrow(/順序不對/);
  });

  it('產物與 CHANGELOG.md 一致——沒有人手改過 changelog.json，也沒有人忘了重跑', () => {
    const fresh = parse(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
    const built = JSON.parse(
      readFileSync(join(root, 'client', 'src', 'data', 'changelog.json'), 'utf8'),
    ) as { versions: unknown };
    expect(built.versions).toEqual(fresh);
  });

  it('CHANGELOG.md 的第一個版本區塊永遠是 Unreleased', () => {
    const out = parse(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
    expect(out[0]?.version).toBe('Unreleased');
  });
});
