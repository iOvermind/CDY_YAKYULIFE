/**
 * 天梯。
 *
 * **四顆按鈕挑一格，再看一整面欄位**：我的／所有玩家 × 聯盟／跨聯盟 × 累計／單季
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
import { useDragScroll } from './dragScroll.ts';
import type { LadderBoard, LadderQuery, LadderResponse } from './api/contract.ts';
import type { Account } from './useAccount.ts';
import { ladder as ladderCfg, leagues, positions as positionsCfg } from './data/index.ts';
import { ALL } from './engine/ladder.ts';
import { displayName } from './engine/playerName.ts';
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

/**
 * 一塊榜。`single` 是單季最佳：一列就是一季，「1 季」那一欄每列都一樣，
 * 不必寫（issue #38）。
 */
function Board({ board, single }: { board: LadderBoard; single: boolean }) {
  const column = columnOf(board.side, board.column);
  if (column === undefined) return null;

  return (
    <div className="ladder-board">
      <div className="fin-caption">{column.name}</div>
      <table className="fin">
        <tbody>
          {board.entries.map((e) => {
            const shown = displayName(e.name);
            return (
              <tr key={`${e.rank}-${e.account}-${e.at}`}>
                {/*
                  前三名的名次與名字用強調色＋粗體，一眼看得出誰站在頒獎台上。名次欄
                  只留兩位數的寬、右邊不留白——名次跟名字之間每多一格，十幾塊榜並排
                  就多十幾格。
                */}
                <td style={{ width: '2ch', paddingRight: 0 }}>{e.rank <= 3 ? <b className="hl">{e.rank}</b> : e.rank}</td>
                {/*
                  **只留球員名。** 帳號接在後面時每一列都撐出表格的寬度，而一排有
                  十幾塊榜，那一截寬度乘十幾倍就是整頁橫著爆出去。要分辨是誰的話
                  滑鼠停在名字上看得到——那是不佔版面的地方。
                */}
                <td
                  style={{ textAlign: 'left', whiteSpace: 'nowrap' }}
                  title={shown === e.name ? e.account : `${e.name}｜${e.account}`}
                >
                  {e.rank <= 3 ? <b className="hl">{shown}</b> : shown}
                  {/*
                    舊規則的紀錄要標出來。榜單是歷史而不是同一把尺——跨版本不保證
                    重現（ADR 0002），所以沒有「用新引擎重算」這條路。只寫一個「舊」
                    字，是名字欄的寬度撐不起四個字；是哪一版，滑鼠停上去看得到。
                  */}
                  {e.engineVersion !== ENGINE_VERSION && (
                    <span className="sub" style={{ marginLeft: 4 }} title={`舊規則：結算於引擎 v${e.engineVersion}`}>
                      舊
                    </span>
                  )}
                </td>
                {!single && (
                  <td style={{ width: '4em' }} title="這個組合內的球季數">
                    {e.seasons} 季
                  </td>
                )}
                <td style={{ textAlign: 'right', width: '6em' }}>
                  <b className="hl">{fmt(e.value, board.side, board.column)}</b>
                </td>
              </tr>
            );
          })}
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

/** 四顆篩選按鈕。展開的是哪一顆，null 是全部收起。 */
type Filter = 'who' | 'org' | 'kind' | 'position';

interface Choice {
  readonly value: string;
  readonly label: string;
}

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
  const [open, setOpen] = useState<Filter | null>(null);
  const drag = useDragScroll();

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
        <section key={side} className="ladder-section">
          <h4>{title}</h4>
          <div className="ladder-grid">
            {list.map((b) => (
              <Board key={b.column} board={b} single={query.kind === 'best'} />
            ))}
          </div>
        </section>
      );
    });
  }

  const positionLabel = (p: string) => (p === ALL ? '跨守位' : `${p} ${positionName(p)}`);

  /** 每一顆按鈕：現在的值、第三層的選項、選了之後做什麼。 */
  const filters: Record<Filter, { current: string; choices: readonly Choice[]; pick: (v: string) => void }> = {
    who: {
      current: self ? 'self' : 'all',
      choices: [
        { value: 'self', label: '我的生涯' },
        { value: 'all', label: '所有玩家' },
      ],
      pick: (v) => setSelf(v === 'self'),
    },
    org: {
      current: query.org,
      choices: (orgs.length > 0 ? orgs : [ALL]).map((o) => ({ value: o, label: orgName(o) })),
      pick: pickOrg,
    },
    kind: {
      current: query.kind,
      choices: [
        { value: 'total', label: '累計' },
        { value: 'best', label: '單季' },
      ],
      pick: (v) => setQuery({ ...query, kind: v === 'best' ? 'best' : 'total' }),
    },
    position: {
      current: query.position,
      choices: (positions.length > 0 ? positions : [ALL]).map((p) => ({ value: p, label: positionLabel(p) })),
      pick: (v) => setQuery({ ...query, position: v }),
    },
  };

  const labelOf = (f: Filter) =>
    filters[f].choices.find((c) => c.value === filters[f].current)?.label ?? filters[f].current;

  const opened = open === null ? null : filters[open];

  return (
    <>
      {/* 第二層：跟上面的分頁同一個樣式，只寫目前的值。按一下展開第三層，再按一下收起。 */}
      <div className="seg" style={{ marginBottom: 8 }}>
        {(['who', 'org', 'kind', 'position'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={open === f ? 'on' : undefined}
            aria-expanded={open === f}
            onClick={() => setOpen(open === f ? null : f)}
          >
            {labelOf(f)}
          </button>
        ))}
      </div>
      {/*
        第三層：一排四顆，多的左右滑（滑鼠按住拖、觸控原生捲動）。選了就收起。
        只列選項，不另加標題——展開的是哪一顆，第二層那顆亮著就看得出來。
      */}
      {opened !== null && (
        <div className="seg-scroll" ref={drag.ref} {...drag.handlers}>
          {opened.choices.map((c) => (
            <button
              key={c.value}
              type="button"
              className={c.value === opened.current ? 'on' : undefined}
              onClick={() => {
                if (drag.wasDrag()) return;
                opened.pick(c.value);
                setOpen(null);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {boards()}
    </>
  );
}
