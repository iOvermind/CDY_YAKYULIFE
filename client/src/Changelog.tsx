/**
 * 更新紀錄。
 *
 * 依版本由新到舊，每一版底下照 Added／Changed／Fixed 分節——**與 `CHANGELOG.md`
 * 同一個結構，因為它就是那份檔案**（建置時由 `scripts/changelog.mjs` 轉成資料檔）。
 * 這裡不重新分類、不重新排序：變更紀錄的版面規則寫在 `docs/rules/CHANGELOG_RULES.md`，
 * 顯示端再編一套等於多一個會走鐘的地方。
 *
 * `[Unreleased]` 空著是常態（剛切完一版），空的時候寫一句話而不是留一塊白。
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

function Version({ v }: { v: ChangelogVersion }) {
  const empty = v.categories.length === 0;
  return (
    <div className="achgroup">
      <h3>
        {v.version}
        {/* 日期掛在版本標題上，不逐條標——CHANGELOG_RULES §3.2。 */}
        {v.date !== null && <span className="sub">{v.date}</span>}
      </h3>
      {v.note.length > 0 && (
        <p className="modal-note">
          <Parts parts={v.note} />
        </p>
      )}
      {empty && <p className="modal-note">這一版之後還沒有新的變更。</p>}
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
    </div>
  );
}

export function Changelog() {
  return (
    <>
      <p className="modal-note">
        由新到舊。<b>版本號本身就是資訊</b>——中間那位跳動代表多了新東西，最後一位
        跳動代表只修了錯。
      </p>
      {/*
        版本一塊一塊往下疊，**兩欄切在條目上而不是版本上**。成就與天賦那邊一組
        頂多十來格，整組不切開剛好；這裡 0.1.0 一版就有一百多條，把版本當成不可
        切開的區塊等於要求瀏覽器把一根一千像素高的柱子塞進半欄——它塞不下，只會
        讓左欄爆出去、右欄全空。
      */}
      {changelog.versions.map((v) => (
        <Version key={v.version} v={v} />
      ))}
    </>
  );
}
