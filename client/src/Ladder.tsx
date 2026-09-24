/**
 * 天梯。
 *
 * **四個選單挑一格，再看一整面欄位**：我的／所有玩家 × 聯盟／跨聯盟 × 累計／單季
 * × 守位／跨守位。守位選單同時決定畫哪幾張表——跨守位畫野手、投手與共通三張，
 * 野手守位只畫野手與共通，投手定位只畫投手與共通。共通那一張是份額、評價分、
 * 薪水：整個球員的數字，不分投打。
 *
 * **選單只列在其他選擇下有資料的選項**——沒去過墨聯就沒有墨聯，選了大聯盟之後守位
 * 只列有人在大聯盟守過的。清單由伺服器給（它知道有哪些資料），這裡不自己推。
 *
 * 見 [ADR 0038](../../docs/adr/0038-one-hosted-service-and-the-ladder-trusts-the-replay.md)。
 */

import { useEffect, useState } from 'react';
import type { LadderBoard, LadderQuery, LadderResponse } from './api/contract.ts';
import type { Account } from './useAccount.ts';
import { ladder as ladderCfg, leagues, positions as positionsCfg } from './data/index.ts';
import { ALL } from './engine/ladder.ts';
import { fmtMoney } from './engine/salary.ts';
import { ENGINE_VERSION } from './engine/version.ts';

/**
 * 聯盟選單上的名字。跨聯盟之外寫**頂級聯盟名**（中職／日職／大聯盟），不是體系名
 * （旅日／旅美）——榜上問的是「誰在這個聯盟最強」，與獎項前綴同一把尺。
 */
function orgName(org: string): string {
  if (org === ALL) return '跨聯盟';
  return leagues.top_league_names[org] ?? org;
}

/** 守位的中文全名。野手查 positions.json，投手查 ladder.json 的定位名。 */
function positionName(position: string): string {
  return (
    positionsCfg.positions[position] ?? ladderCfg.positions.pitching_names[position] ?? position
  );
}

/** 一個欄位的設定。找不到就不畫——資料檔是唯一來源，這裡不自己編一份備援。 */
function columnOf(side: LadderBoard['side'], key: string) {
  return ladderCfg.columns[side].find((c) => c.key === key);
}

/**
 * 榜上的數字怎麼寫。
 *
 * 率型帶小數位（打擊率 .312、防禦率 3.05）；投球局數存的是出局數，要換回棒球
 * 寫法（29.1 是 29 局又一人出局，不是 29.1 局）。
 */
function fmt(value: number, side: LadderBoard['side'], key: string): string {
  const column = columnOf(side, key);
  if (column === undefined) return String(value);
  // 薪水存的是萬元，寫成玩家讀得懂的 3000 萬、25 億。
  if (column.unit === 'money') return fmtMoney(value);
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
              <td style={{ width: '4em' }} title="這個組合內的球季數">
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

/** 三張表的標題，依畫面上的順序。 */
const SIDES: readonly { readonly side: LadderBoard['side']; readonly title: string }[] = [
  { side: 'shared', title: '綜合' },
  { side: 'batter', title: '野手' },
  { side: 'pitcher', title: '投手' },
];

const START: LadderQuery = { org: ALL, position: ALL, kind: 'total' };

/** 去重並保留第一次出現的順序——伺服器給的清單已經排好了。 */
function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

export function Ladder({ account }: { account: Account }) {
  // 個人是預設——玩家打開這一頁最先想看的是自己。
  const [self, setSelf] = useState(true);
  const [query, setQuery] = useState<LadderQuery>(START);
  const [data, setData] = useState<LadderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * 記住上一次拿到的組合清單。**查詢期間選單不能消失**——那時 `data` 是 null，選單
   * 要是跟著不畫，每換一次選項整排就閃一次。
   */
  const [combos, setCombos] = useState<readonly LadderQuery[]>([]);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    account.store
      .ladder(query, self)
      .then((res) => {
        if (!live) return;
        setData(res);
        setCombos(res.combos);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : '讀不到天梯。');
      });
    return () => {
      live = false;
    };
  }, [account, query, self]);

  // 每個選單只列「在其他選單目前的選擇下有資料」的選項。累計與單季一定成對出現
  // （結算時每個組合兩種都寫），所以那一個選單不必篩。
  const orgs = unique(
    combos.filter((c) => c.position === query.position && c.kind === query.kind).map((c) => c.org),
  );
  const positions = unique(
    combos.filter((c) => c.org === query.org && c.kind === query.kind).map((c) => c.position),
  );

  /**
   * 換聯盟時守位可能不存在了（大聯盟守過三壘、日職沒有）。那就回到跨守位——每一個
   * 打過的聯盟都一定有跨守位那一格。
   */
  const pickOrg = (org: string) => {
    const has = combos.some((c) => c.org === org && c.position === query.position);
    setQuery({ ...query, org, position: has ? query.position : ALL });
  };

  // 換「我的／所有玩家」時組合清單會跟著換；目前這一格在新清單裡不存在的話就回到
  // 起點（跨聯盟、跨守位、累計），那一格只要有任何一段生涯就一定存在。
  useEffect(() => {
    if (combos.length === 0) return;
    const ok = combos.some(
      (c) => c.org === query.org && c.position === query.position && c.kind === query.kind,
    );
    if (!ok) setQuery(START);
  }, [combos, query]);

  function boards() {
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
    return SIDES.map(({ side, title }) => {
      const list = data.boards.filter((b) => b.side === side);
      if (list.length === 0) return null;
      return (
        <section key={side}>
          <h4>{title}</h4>
          <div className="ladder-grid">
            {list.map((b) => (
              <Board key={b.column} board={b} />
            ))}
          </div>
        </section>
      );
    });
  }

  return (
    <>
      <div className="ladder-filters">
        <select
          aria-label="誰的生涯"
          value={self ? 'self' : 'all'}
          onChange={(e) => setSelf(e.target.value === 'self')}
        >
          <option value="self">我的生涯</option>
          <option value="all">所有玩家</option>
        </select>
        <select aria-label="聯盟" value={query.org} onChange={(e) => pickOrg(e.target.value)}>
          {(orgs.length > 0 ? orgs : [ALL]).map((o) => (
            <option key={o} value={o}>
              {orgName(o)}
            </option>
          ))}
        </select>
        <select
          aria-label="累計或單季"
          value={query.kind}
          onChange={(e) => setQuery({ ...query, kind: e.target.value === 'best' ? 'best' : 'total' })}
        >
          <option value="total">累計</option>
          <option value="best">單季</option>
        </select>
        <select
          aria-label="守位"
          value={query.position}
          onChange={(e) => setQuery({ ...query, position: e.target.value })}
        >
          {(positions.length > 0 ? positions : [ALL]).map((p) => (
            <option key={p} value={p}>
              {p === ALL ? '跨守位' : `${p} ${positionName(p)}`}
            </option>
          ))}
        </select>
      </div>
      {boards()}
    </>
  );
}
