/**
 * 天梯。
 *
 * **先選範圍，再看一整面欄位**：範圍是「生涯／中職／日職…」，底下一項數值一塊、
 * 每塊列前十。攤開所有範圍的話是十幾個欄位乘上七個範圍，沒有人讀得完。
 *
 * 沒去過的聯盟整組不出現——與成就櫃「未解鎖的一律不顯示」同一個規矩。範圍清單
 * 由伺服器算（它知道有哪些資料），這裡不自己推。
 *
 * 見 [ADR 0038](../../docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)。
 */

import { useEffect, useState } from 'react';
import type { LadderBoard, LadderResponse } from './api/contract.ts';
import type { Account } from './useAccount.ts';
import { ladder as ladderCfg, leagues } from './data/index.ts';
import { CAREER_SCOPE } from './engine/ladder.ts';
import { ENGINE_VERSION } from './engine/game.ts';

/** 範圍的中文名。生涯是跨聯盟通算，其餘是體系名。 */
function scopeName(scope: string): string {
  if (scope === CAREER_SCOPE) return '生涯';
  return leagues.org_names[scope] ?? scope;
}

/** 一個欄位的設定。找不到就不畫——資料檔是唯一來源，這裡不自己編一份備援。 */
function columnOf(side: 'batter' | 'pitcher', key: string) {
  return ladderCfg.columns[side].find((c) => c.key === key);
}

/**
 * 榜上的數字怎麼寫。
 *
 * 率型帶小數位（打擊率 .312、防禦率 3.05）；投球局數存的是出局數，要換回棒球
 * 寫法（29.1 是 29 局又一人出局，不是 29.1 局）。
 */
function fmt(value: number, side: 'batter' | 'pitcher', key: string): string {
  const column = columnOf(side, key);
  if (column === undefined) return String(value);
  if (column.unit === 3) {
    const whole = Math.floor(value / 3);
    return `${whole}.${value % 3}`;
  }
  if (column.digits === undefined) return String(Math.round(value));
  const text = value.toFixed(column.digits);
  // 打擊率那一類的個位數是 0 時省掉，跟成績表同一個寫法。
  return column.digits === 3 && value < 1 ? text.slice(1) : text;
}

function Board({ board }: { board: LadderBoard }) {
  const column = columnOf(board.side, board.column);
  if (column === undefined) return null;

  return (
    <div className="ladder-board">
      <div className="fin-caption">{column.name}</div>
      <table className="fin">
        <tbody>
          {board.entries.map((e) => (
            <tr key={`${e.rank}-${e.account}-${e.at}`}>
              <td style={{ width: '2.5em' }}>{e.rank}</td>
              <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                {e.name}
                <span className="sub">・{e.account}</span>
                {/*
                  舊規則的紀錄要標出來。榜單是歷史而不是同一把尺——跨版本不保證
                  重現（ADR 0002），所以沒有「用新引擎重算」這條路。
                */}
                {e.engineVersion !== ENGINE_VERSION && (
                  <span className="sub" title={`結算於引擎 v${e.engineVersion}`}>
                    ・舊規則
                  </span>
                )}
              </td>
              <td style={{ width: '4em' }} title="這個範圍內的球季數">
                {e.seasons} 季
              </td>
              <td style={{ textAlign: 'right', width: '6em' }}>
                <b className="hl">{fmt(e.value, board.side, board.column)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Ladder({ account, self }: { account: Account; self: boolean }) {
  const [scope, setScope] = useState(CAREER_SCOPE);
  const [data, setData] = useState<LadderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    account.store
      .ladder(scope, self)
      .then((res) => {
        if (live) setData(res);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : '讀不到天梯。');
      });
    return () => {
      live = false;
    };
  }, [account, scope, self]);

  if (error !== null) return <p className="modal-note">{error}</p>;
  if (data === null) return <p className="modal-note">讀取中…</p>;
  if (data.boards.length === 0) {
    return (
      <p className="modal-note">
        還沒有任何紀錄。天梯收的是<b>打完並結算過</b>的生涯——
        {self ? '打完一段就會出現在這裡。' : '這台服務上還沒有人打完一段生涯。'}
      </p>
    );
  }

  const batter = data.boards.filter((b) => b.side === 'batter');
  const pitcher = data.boards.filter((b) => b.side === 'pitcher');

  return (
    <>
      {/* 範圍分頁。只出現有資料的那些——沒去過的聯盟整組不顯示。 */}
      <div className="seg" style={{ marginBottom: 12 }}>
        {data.scopes.map((s) => (
          <button
            key={s}
            type="button"
            className={scope === s ? 'on' : undefined}
            onClick={() => setScope(s)}
          >
            {scopeName(s)}
          </button>
        ))}
      </div>

      {batter.length > 0 && (
        <>
          <h4>野手</h4>
          <div className="ladder-grid">
            {batter.map((b) => (
              <Board key={b.column} board={b} />
            ))}
          </div>
        </>
      )}
      {pitcher.length > 0 && (
        <>
          <h4 style={{ marginTop: 14 }}>投手</h4>
          <div className="ladder-grid">
            {pitcher.map((b) => (
              <Board key={b.column} board={b} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
