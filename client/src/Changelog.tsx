/**
 * 更新紀錄。
 *
 * 依版本由新到舊，每一版底下照 Added／Changed／Fixed 分節——**與 `CHANGELOG.md`
 * 同一個結構，因為它就是那份檔案**（建置時由 `scripts/changelog.mjs` 轉成資料檔）。
 * 這裡不重新分類、不重新排序：變更紀錄的版面規則寫在 `docs/rules/CHANGELOG_RULES.md`，
 * 顯示端再編一套等於多一個會走鐘的地方。
 *
 * **版本區塊是摺疊的，只有最新一版預設展開。** CHANGELOG_RULES §3.4 要求每條變更
 * 是能獨立看懂的單行，那讓條目數量隨版本累積——0.1.0 一版就有兩百多條。全部攤開
 * 的話，第二次進來想看「這次改了什麼」的人要先滑過上一版的全部歷史。
 *
 * **展開狀態不記憶。** 這一頁是偶爾點進來看一次的東西；記住上次展開了哪三版，只會
 * 讓下次進來的畫面看起來像壞掉。
 */

import { changelog } from './data/index.ts';
import type { ChangelogPart, ChangelogVersion } from './data/index.ts';

/** 行內語法。連結在轉檔時就已經變成純文字了，這裡只剩三種。 */
function Parts({ parts }: { parts: readonly ChangelogPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === 'strong' ? (
          <b key={i}>{p.text}</b>
        ) : p.kind === 'code' ? (
          <code key={i}>{p.text}</code>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function Version({ v, open }: { v: ChangelogVersion; open: boolean }) {
  return (
    // 用原生 <details>，不自己接 useState：摺疊、鍵盤操作與瀏覽器的頁內搜尋
    // （Chrome 會自動展開命中的區塊）都是免費的，自己做只會少掉最後那一項。
    <details className="achgroup" open={open}>
      <summary>
        <h3>
          {v.version}
          {/* 日期掛在版本標題上，不逐條標——CHANGELOG_RULES §3.2。 */}
          {v.date !== null && <span className="sub">{v.date}</span>}
        </h3>
      </summary>
      {/* 版本導言：這一版整體是什麼（CHANGELOG_RULES §3.1.1）。 */}
      {v.note.length > 0 && (
        <p className="modal-note">
          <Parts parts={v.note} />
        </p>
      )}
      {v.categories.map((c) => (
        <div key={c.key} className="achsub">
          <h4>{c.name}</h4>
          <ul className="changelist">
            {c.entries.map((entry, i) => (
              <li key={i}>
                <Parts parts={entry} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

export function Changelog() {
  // 空的 `[Unreleased]` 不顯示。它在 CHANGELOG.md 裡必須永遠存在（規範 §3.1），
  // 但在摺疊的清單裡會變成一個點開只有一句「還沒有新東西」的假項目——那比不放
  // 更糟，因為它看起來像有東西。
  const shown = changelog.versions.filter((v) => v.categories.length > 0);
  return (
    <>
      <p className="modal-note">
        由新到舊，點版本號展開。<b>版本號本身就是資訊</b>——中間那位跳動代表多了新
        東西，最後一位跳動代表只修了錯。
      </p>
      {shown.map((v, i) => (
        // 最新一版展開，其餘收起：進來想知道的是「這次改了什麼」。
        <Version key={v.version} v={v} open={i === 0} />
      ))}
    </>
  );
}
