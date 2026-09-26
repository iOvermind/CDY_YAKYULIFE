/**
 * 玩家攻略。
 *
 * **它就是根目錄那份 `WIKI.md`**（建置時由 `scripts/wiki.mjs` 轉成 `wiki.json`），
 * 這裡只負責畫，不重新編排——攻略改了什麼、數值表長什麼樣，都在那份檔案與產生器
 * 裡決定。顯示端再編一套，就是多一個會跟攻略走鐘的地方。
 *
 * **每一章一個摺疊區塊，預設全部收起。** 十五章加附錄、好幾張長表，全部攤開在手機
 * 上要滑很久；收起來之後章名本身就是目錄。用原生 `<details>`：瀏覽器的頁內搜尋會
 * 自動展開命中的那一章，自己做摺疊就沒有這一項。
 */

import { Fragment } from 'react';
import type { ChangelogPart, WikiBlock } from '../../data/index.ts';
import { wiki } from '../../data/index.ts';
import { Parts } from './Changelog.tsx';
import sections from './sections.module.css';
import modal from '../common/modal.module.css';
import { Heading, Subheading } from '../common/Heading.tsx';

/** 分組表的組名列：第一格以粗體開頭、其餘格子全空。 */
function isGroupRow(row: readonly (readonly ChangelogPart[])[]): boolean {
  return row[0]?.[0]?.kind === 'strong' && row.slice(1).every((c) => c.length === 0);
}

function Block({ b }: { b: WikiBlock }) {
  switch (b.kind) {
    case 'h3':
      return <Subheading>{b.text}</Subheading>;
    case 'p':
      return (
        <p>
          <Parts parts={b.parts} />
        </p>
      );
    case 'note':
      return (
        <p className={modal.modalNote}>
          <Parts parts={b.parts} />
        </p>
      );
    case 'ul':
      return (
        <ul>
          {b.items.map((item, i) => (
            <li key={i}>
              <Parts parts={item} />
            </li>
          ))}
        </ul>
      );
    case 'table': {
      // 分組表（產生器的聯盟階梯、球隊名單）：組名列畫成小標題、底下重複表頭，
      // 看起來是分開的幾張表，但仍是同一張 <table>，欄寬上下對齊。
      const grouped = b.rows.some(isGroupRow);
      const head = (
        <tr>
          {b.head.map((c, i) => (
            <th key={i}>
              <Parts parts={c} />
            </th>
          ))}
        </tr>
      );
      return (
        // 表格太寬時只在表格裡橫捲，不把整個視窗撐開。
        <div className={sections.wikiTable}>
          <table>
            {!grouped && <thead>{head}</thead>}
            <tbody>
              {b.rows.map((row, i) =>
                isGroupRow(row) ? (
                  <Fragment key={i}>
                    <tr className={sections.wikiGroup}>
                      <th colSpan={b.head.length}>
                        <Parts parts={row[0] ?? []} />
                      </th>
                    </tr>
                    {head}
                  </Fragment>
                ) : (
                  <tr key={i}>
                    {row.map((c, j) => (
                      <td key={j}>
                        <Parts parts={c} />
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      );
    }
  }
}

export function Wiki() {
  return (
    <div className={sections.wiki}>
      {wiki.intro.map((b, i) => (
        <Block key={i} b={b} />
      ))}
      {wiki.chapters.map((c) => (
        <details key={c.title} className={sections.achgroup}>
          <summary>
            <Heading as="h3" collapsible>{c.title}</Heading>
          </summary>
          {/* 章的內容整塊內縮，一眼看得出哪些字屬於這一章。 */}
          <div className={sections.wikiBody}>
            {c.blocks.map((b, i) => (
              <Block key={i} b={b} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
