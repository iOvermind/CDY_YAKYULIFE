/**
 * WIKI 數值表的產生器。
 *
 * 釘住三件事：標記外的手寫文字一個字都不動；劇透的界線（特性不列效果、罕見事件
 * 不列結果）；以及資料不齊時會報錯，而不是默默產出一張缺格子的表。
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error 產生器是 .mjs，沒有型別宣告；這裡只在測試裡用它。
import { fillWiki, loadData, renderBlocks } from './wiki.mjs';

type Data = Record<string, any>;
const fill = fillWiki as (markdown: string, blocks: Record<string, string>) => string;
const render = renderBlocks as (data: Data) => Record<string, string>;
const load = loadData as () => Data;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('把表格填回 WIKI', () => {
  it('只換標記之間的內容，標記外的文字原樣保留', () => {
    const md = ['# 手寫', '', '<!-- gen:teams -->', '舊表', '<!-- /gen:teams -->', '', '結尾'].join('\n');
    expect(fill(md, { teams: '新表' })).toBe(
      ['# 手寫', '', '<!-- gen:teams -->', '新表', '<!-- /gen:teams -->', '', '結尾'].join('\n'),
    );
  });

  it('標記指到不存在的表格就報錯', () => {
    expect(() => fill('<!-- gen:nope -->\n<!-- /gen:nope -->', {})).toThrow(/gen:nope/);
  });

  it('標記沒有結尾就報錯', () => {
    expect(() => fill('<!-- gen:teams -->\n舊表', { teams: '新表' })).toThrow(/結尾/);
  });
});

describe('劇透的界線', () => {
  const blocks = render(load());

  it('特性表列出取得條件，但不列效果', () => {
    const data = load();
    const glass = data.traits.traits.find((t: Data) => t.id === 'glass');
    expect(blocks.traits).toContain(glass.trigger_text);
    expect(blocks.traits).not.toContain(glass.effect_text);
  });

  it('罕見事件（有標 weight）只列名字，結果不公開', () => {
    const data = load();
    const rare = data.events.events.find((e: Data) => e.weight !== undefined);
    const common = data.events.events.find((e: Data) => e.weight === undefined);
    expect(blocks.events).toContain(rare.name);
    expect(blocks.events).not.toContain(rare.good_text);
    expect(blocks.events).toContain(common.good_text);
  });
});

describe('資料不齊就停下來', () => {
  it('特性沒寫 trigger_text 就報錯', () => {
    const data = load();
    data.traits.traits[0].trigger_text = '';
    expect(() => render(data)).toThrow(/trigger_text/);
  });
});

describe('WIKI.md 與資料檔', () => {
  it('標記裡的表格跟資料檔一致——沒有人手改過，也沒有人忘了重跑', () => {
    const md = readFileSync(join(root, 'WIKI.md'), 'utf8');
    expect(fill(md, render(load()))).toBe(md);
  });
});
