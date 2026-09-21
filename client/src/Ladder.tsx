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

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { LadderBoard, LadderResponse } from './api/contract.ts';
import type { Account } from './useAccount.ts';
import { ladder as ladderCfg, leagues } from './data/index.ts';
import { CAREER_SCOPE } from './engine/ladder.ts';
import { ENGINE_VERSION } from './engine/game.ts';

/**
 * 範圍的中文名。生涯是跨聯盟通算，其餘是**頂級聯盟名**。
 *
 * 用 `top_league_names`（中職／日職／韓職／墨聯／澳職／大聯盟）而不是 `org_names`
 * （中職／旅日／旅美），有兩個理由。一是語意：天梯只收頂級聯盟的成績，榜上問的是
 * 「誰在這個聯盟最強」，不是「你待過哪個體系」——與獎項前綴同一把尺（見
 * `career.ts` 的 `orgNameOf`）。二是完整性：`org_names` 是刻意只寫幾個體系的覆蓋表，
 * 拿它當清單會讓韓職、墨聯、澳職顯示成生的代碼。
 */
function scopeName(scope: string): string {
  if (scope === CAREER_SCOPE) return '生涯';
  return leagues.top_league_names[scope] ?? scope;
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
              {/*
                **只留球員名。** 帳號接在後面時每一列都撐出表格的寬度，而一排有
                十幾塊榜，那一截寬度乘十幾倍就是整頁橫著爆出去。要分辨是誰的話
                滑鼠停在名字上看得到——那是不佔版面的地方。
              */}
              <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }} title={e.account}>
                {e.name}
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

/**
 * 聯盟那一排的拖曳捲動。
 *
 * **不用箭頭。** 箭頭要佔掉兩端的寬度，四顆聯盟按鈕就得跟著變窄；拖曳不佔任何
 * 版面，按鈕維持原本的寬度。手機本來就是拖的——那一排是原生的橫向捲動容器，
 * 觸控不必接手，這裡只補上滑鼠的那一半。
 *
 * **不能用 setPointerCapture。** 抓住指標之後 pointerdown 與 pointerup 的目標
 * 都會變成容器，瀏覽器於是把 click 派給容器而不是按鈕——結果是整排點不動，每
 * 一次點擊都被當成一次沒有位移的拖曳。改成只記狀態不抓指標：滑鼠移出那一排就
 * 結束拖曳，代價是甩得太快會鬆手，而那比「按鈕全部失效」好得多。
 *
 * 真的拖過才要吃掉那一次 click，否則放開滑鼠的位置剛好在某顆按鈕上就會誤選。
 * 門檻留四個像素——滑鼠按下去本來就很難完全不動。
 */
function useDragScroll() {
  const ref = useRef<HTMLDivElement | null>(null);
  const holding = useRef(false);
  const dragged = useRef(false);
  const from = useRef({ x: 0, left: 0 });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || ref.current === null) return;
    holding.current = true;
    dragged.current = false;
    from.current = { x: e.clientX, left: ref.current.scrollLeft };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!holding.current || el === null) return;
    const dx = e.clientX - from.current.x;
    if (Math.abs(dx) > 4) dragged.current = true;
    if (dragged.current) el.scrollLeft = from.current.left - dx;
  };

  /** 放開、移出那一排、或系統收走指標，都算結束。 */
  const stop = () => {
    holding.current = false;
  };

  return {
    ref,
    /**
     * 這一次 click 是不是拖出來的。是的話呼叫端要忽略它。
     *
     * **讀一次就清掉。** 不清的話旗標會留到下一次點擊——用鍵盤 Enter 按按鈕不會
     * 經過 pointerdown，於是那一次會被上一次的拖曳吃掉。
     */
    wasDrag: () => {
      const was = dragged.current;
      dragged.current = false;
      return was;
    },
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
    },
  };
}

export function Ladder({ account, self }: { account: Account; self: boolean }) {
  const [scope, setScope] = useState(CAREER_SCOPE);
  /** 生涯看哪一側。生涯的榜不左右並排，一次只畫一側。 */
  const [careerSide, setCareerSide] = useState<'batter' | 'pitcher'>('batter');
  const [data, setData] = useState<LadderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useDragScroll();

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

  // **生涯不是第七個聯盟。** 它是跨聯盟通算，與「誰在中職最強」問的是兩件事，
  // 因此拉出來自己一排。聯盟那一排永遠只有一行，多的用拖的。
  const leagueScopes = data.scopes.filter((s) => s !== CAREER_SCOPE);
  const hasCareer = data.scopes.includes(CAREER_SCOPE);
  const career = scope === CAREER_SCOPE;

  return (
    <>
      {/*
        範圍分頁。只出現有資料的那些——沒去過的聯盟整組不顯示。

        **一排四個，多的用拖的。** 按鈕的寬度固定成「四個剛好塞滿」，容器自己橫向
        捲動：滑鼠按住拖，觸控就是原生的捲動。這裡沒有箭頭——箭頭要佔掉兩端的寬度，
        四顆按鈕就得跟著變窄。
      */}
      <div
        className="seg-scroll"
        ref={drag.ref}
        {...drag.handlers}
        style={{ marginBottom: 8 }}
      >
        {leagueScopes.map((s) => (
          <button
            key={s}
            type="button"
            className={scope === s ? 'on' : undefined}
            onClick={() => {
              if (!drag.wasDrag()) setScope(s);
            }}
          >
            {scopeName(s)}
          </button>
        ))}
      </div>
      {/*
        生涯分成野手與投手兩顆。生涯的榜**一次只畫一側**：31 塊榜左右並排時，名字欄
        不能折行（球員名・帳號），名字一長就把一側推寬擠進另一側。聯盟那邊維持並排，
        靠 min-width:0 與各自的橫向捲動擋住同一件事。
      */}
      {hasCareer && (
        <div className="seg two" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={career && careerSide === 'batter' ? 'on' : undefined}
            onClick={() => {
              setScope(CAREER_SCOPE);
              setCareerSide('batter');
            }}
          >
            生涯・野手
          </button>
          <button
            type="button"
            className={career && careerSide === 'pitcher' ? 'on' : undefined}
            onClick={() => {
              setScope(CAREER_SCOPE);
              setCareerSide('pitcher');
            }}
          >
            生涯・投手
          </button>
        </div>
      )}
      {career ? (
        // 生涯一次只畫一側，因此不套 .ladder-sides 那個 1fr 1fr。
        <section>
          <h4>{careerSide === 'batter' ? '野手' : '投手'}</h4>
          <div className="ladder-grid">
            {(careerSide === 'batter' ? batter : pitcher).map((b) => (
              <Board key={b.column} board={b} />
            ))}
          </div>
        </section>
      ) : (
        /*
          野手一側、投手一側，左右並排，各自內部再排兩欄榜。**兩側是語意分欄，不是
          平衡分欄**——野手 18 塊、投手 13 塊，高度本來就不齊，硬要等高就得把投手的
          榜混進野手那一側。左右並排換到的是「不必滑過整個野手才看得到投手」。
          欄寬不夠時（窄視窗）兩側自己疊回上下，見 app.css 的 media query。
        */
        <div className="ladder-sides">
          {batter.length > 0 && (
            <section>
              <h4>野手</h4>
              <div className="ladder-grid">
                {batter.map((b) => (
                  <Board key={b.column} board={b} />
                ))}
              </div>
            </section>
          )}
          {pitcher.length > 0 && (
            <section>
              <h4>投手</h4>
              <div className="ladder-grid">
                {pitcher.map((b) => (
                  <Board key={b.column} board={b} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
