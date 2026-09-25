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

import type { WikiBlock } from './data/index.ts';
import { wiki } from './data/index.ts';
import { Parts } from './Changelog.tsx';

function Block({ b }: { b: WikiBlock }) {
  switch (b.kind) {
    case 'h3':
      return <h4>{b.text}</h4>;
    case 'p':
      return (
        <p>
          <Parts parts={b.parts} />
        </p>
      );
    case 'note':
      return (
        <p className="modal-note">
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
    case 'table':
      return (
        // 表格太寬時只在表格裡橫捲，不把整個視窗撐開。
        <div className="wiki-table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i}>
                    <Parts parts={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((c, j) => (
                    <td key={j}>
                      <Parts parts={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Wiki() {
  return (
    <div className="wiki">
      {wiki.intro.map((b, i) => (
        <Block key={i} b={b} />
      ))}
      {wiki.chapters.map((c) => (
        <details key={c.title} className="achgroup">
          <summary>
            <h3>{c.title}</h3>
          </summary>
          {c.blocks.map((b, i) => (
            <Block key={i} b={b} />
          ))}
        </details>
      ))}
    </div>
  );
}
