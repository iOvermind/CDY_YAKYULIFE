import type { CareerSummary } from '../../engine/career.ts';
import type { Baseline } from '../../engine/metrics.ts';
import { positionName, ROLE_NAMES } from '../../engine/season.ts';
import { BATTING_COLUMNS, PITCHING_COLUMNS, type SharesByPart, type StatColumn } from './columns.ts';
import { type CareerRow, careerRows, COMBINED_COLUMNS, combinedRows, INTL, type IntlKind, intlTotalRow, leagueTotals, topTotalRow, type TotalRow } from './rows.ts';
import table from './table.module.css';
import { Heading, Subheading } from '../common/Heading.tsx';

/**
 * 成績表的資料列。
 *
 * 欄位定義直接沿用 `BATTING_COLUMNS` / `PITCHING_COLUMNS`——**同一份成績在
 * 年表與「最近一季」必須長得一樣**。各寫一份遲早會分岔，玩家會以為那是兩種
 * 不同的東西。
 */
function StatCells<T>({
  columns,
  line,
  base,
  shares,
}: {
  columns: readonly StatColumn<T>[];
  line: T;
  base: Baseline;
  shares: SharesByPart | null;
}) {
  return (
    <>
      {columns.map((c) => (
        <td key={c.key}>{c.value(line, base, shares)}</td>
      ))}
    </>
  );
}

function StatHeadCells<T>({ columns }: { columns: readonly StatColumn<T>[] }) {
  return (
    <>
      {columns.map((c) => (
        <th key={c.key} title={c.title}>
          {c.key}
        </th>
      ))}
    </>
  );
}

/**
 * 通算表。
 *
 * 與生涯年表分開是刻意的：年表回答「他哪一年打得怎麼樣」，通算回答「他這輩子
 * 累積了什麼」。兩者的閱讀方式不同，混在同一張表會兩邊都難讀。
 */
function TotalsTable({
  title,
  rows,
  leadHead = '聯盟',
  countHead = '季',
  countTitle = '出賽季數',
}: {
  title: string;
  rows: readonly TotalRow[];
  /** 第一欄的欄名。國際賽那張是「賽事」，不是聯盟。 */
  leadHead?: string;
  /** 第二欄的欄名與說明。國際賽算的是屆數。 */
  countHead?: string;
  countTitle?: string;
}) {
  const batting = rows.filter((r) => r.batting !== null);
  const pitching = rows.filter((r) => r.pitching !== null);
  if (batting.length === 0 && pitching.length === 0) return null;

  return (
    <>
      <Heading>{title}</Heading>
      {batting.length > 0 && (
        <div className={table.finScroll}>
          <Subheading>野手</Subheading>
          <table className={table.fin}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{leadHead}</th>
                <th title={countTitle}>{countHead}</th>
                <StatHeadCells columns={BATTING_COLUMNS} />
                <th title="守備分">DEF</th>
              </tr>
            </thead>
            <tbody>
              {batting.map((r) => (
                <tr key={r.label}>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td>{r.seasons}</td>
                  <StatCells columns={BATTING_COLUMNS} line={r.batting!} base={r.base} shares={r.shares} />
                  <td>{r.defenseRuns > 0 ? `+${r.defenseRuns}` : r.defenseRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pitching.length > 0 && (
        <div className={table.finScroll}>
          <Subheading>投手</Subheading>
          <table className={table.fin}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{leadHead}</th>
                <th title={countTitle}>{countHead}</th>
                <StatHeadCells columns={PITCHING_COLUMNS} />
              </tr>
            </thead>
            <tbody>
              {pitching.map((r) => (
                <tr key={r.label}>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td>{r.seasons}</td>
                  <StatCells columns={PITCHING_COLUMNS} line={r.pitching!} base={r.base} shares={r.shares} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * 國際賽年表。
 *
 * **獨立一張表**：國際賽不屬於任何聯盟，混進聯盟通算會污染階梯成就與各聯盟的
 * 評價分。它接在通算後面而不是併進生涯年表，理由同上——年表那幾列的「球隊」欄
 * 是他當年效力的球團，中華隊不是其中之一。
 *
 * **一屆一列，不逐場**：引擎沒有逐場的粒度，一屆賽會直接產出一條合計成績。
 *
 * 只收職業期。養成期的國際賽併在該年的養成列裡——那幾屆與謝國城盃同一個季節，
 * 是學生賽程的一部分。
 */
function InternationalTable({ summary, kind }: { summary: CareerSummary; kind: IntlKind }) {
  const spec = INTL[kind];
  const rows = spec.rows(summary);
  if (rows.length === 0) return null;
  const batting = rows.filter((r) => r.batting !== null);
  const pitching = rows.filter((r) => r.pitching !== null);
  if (batting.length === 0 && pitching.length === 0) return null;

  // 基準線用**賽會自己的 par**，不是他母聯盟的。成績本來就是拿那個 par 生成的
  // （見 game.ts 的 #accumulateNationalStats），量它也該用同一把。差別只落在吃
  // par 的那一格（故意四壞／恐懼值），量不大，但沒有理由留著一把對不上的尺。
  const base = spec.base();
  const intlLedgerOf = spec.ledger;
  const head = (
    <>
      <th title="年度">年</th>
      <th title="年齡">齡</th>
      <th style={{ textAlign: 'left' }}>賽事</th>
      <th style={{ textAlign: 'left' }} title="中華隊最終名次">名次</th>
    </>
  );
  const lead = (r: CareerSummary['internationalSeasons'][number]) => (
    <>
      <td>{r.year}</td>
      <td>{r.age}</td>
      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.tournament}</td>
      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
        {r.rank}
        {r.mvp && <span className="sub">・MVP</span>}
      </td>
    </>
  );

  return (
    <>
      <Heading>{spec.title}</Heading>
      {batting.length > 0 && (
        <div className={table.finScroll}>
          <Subheading>野手</Subheading>
          <table className={table.fin}>
            <thead>
              <tr>
                {head}
                <StatHeadCells columns={BATTING_COLUMNS} />
                <th title="守備分">DEF</th>
              </tr>
            </thead>
            <tbody>
              {batting.map((r) => (
                <tr key={`intl-${kind}-b-${r.year}-${r.tournament}`}>
                  {lead(r)}
                  <StatCells columns={BATTING_COLUMNS} line={r.batting!} base={base} shares={intlLedgerOf(r)} />
                  <td>{r.defenseRuns > 0 ? `+${r.defenseRuns}` : r.defenseRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pitching.length > 0 && (
        <div className={table.finScroll}>
          <Subheading>投手</Subheading>
          <table className={table.fin}>
            <thead>
              <tr>
                {head}
                <StatHeadCells columns={PITCHING_COLUMNS} />
              </tr>
            </thead>
            <tbody>
              {pitching.map((r) => (
                <tr key={`intl-${kind}-p-${r.year}-${r.tournament}`}>
                  {lead(r)}
                  <StatCells columns={PITCHING_COLUMNS} line={r.pitching!} base={base} shares={intlLedgerOf(r)} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* 國際賽通算。與頂級聯盟通算同一個角色，但**永遠是自己一張**——國際賽不
          屬於任何聯盟，加進聯盟那張表會讓通算多出幾場不存在的聯盟出賽。 */}
      <TotalsTable
        title={`${spec.title}通算`}
        rows={[intlTotalRow(summary, kind)]}
        leadHead="賽事"
        countHead="屆"
        countTitle="出賽屆數"
      />
    </>
  );
}

/**
 * 合併生涯紀錄：投打守三本帳合起來的一張表，每個人都有。
 *
 * 投手表與野手表的單位不同，分開放（見 `hall_of_fame.json` 的 `two_way`）；但勝利份額
 * 與 WAR 是投打通用的，二刀流要跟單一領域的球員比，看的就是這一張。
 */
function CombinedTable({ summary }: { summary: CareerSummary }) {
  const rows = combinedRows(summary);
  if (rows.length === 0) return null;
  return (
    <>
      <Heading>合併生涯紀錄</Heading>
      <div className={table.finScroll}>
        <table className={table.fin}>
          <thead>
            <tr>
              <th title="年度">年</th>
              <th title="年齡">齡</th>
              <th style={{ textAlign: 'left' }}>球隊</th>
              {COMBINED_COLUMNS.map((c) => (
                <th key={c.key} title={c.title}>
                  {c.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.lead[0]}</td>
                <td>{r.lead[1]}</td>
                <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.lead[2]}</td>
                {COMBINED_COLUMNS.map((c) => (
                  <td key={c.key}>{c.value(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * 生涯年表。
 *
 * **含國中與高中**——養成六年也是這段生涯的一部分。一段效力一列；目前一年
 * 就是一段，將來接上季中交易之後同一年會出現兩列，表格的形狀不必改。
 *
 * 投打分兩張表：單位不同，硬湊在同一列會讓兩邊的欄位都看不懂（見
 * `hall_of_fame.json` 的 `two_way`）。
 */
export function CareerTable({ summary }: { summary: CareerSummary }) {
  const rows = careerRows(summary);
  if (rows.length === 0) return null;

  const batting = rows.filter((r) => r.batting !== null);
  const pitching = rows.filter((r) => r.pitching !== null);

  const headLead = (
    <>
      <th title="年度">年</th>
      <th title="年齡">齡</th>
      <th style={{ textAlign: 'left' }}>球隊</th>
    </>
  );
  // 傷過的年份整列標色，而不是加一欄「傷」——空白佔一整欄只為了標少數幾年，
  // 而且橫向已經很擠了。標色只回答「這一年他不是完整的」，細節在事件流裡。
  const rowClass = (r: CareerRow) =>
    r.injured === null ? undefined : r.injured === 'minor' ? `${table.hurt} ${table.hurtMinor}` : table.hurt;
  // 季中轉隊的那一年會有兩列。年與齡只寫在第一列——同一年重覆印一次年份，
  // 讀起來像兩個球季，而球隊那一欄已經說清楚這是同一年的後半段了。
  const rowLead = (r: CareerRow, cont: boolean) => (
    <>
      <td>{cont ? '' : r.year}</td>
      <td>{cont ? '' : r.age}</td>
      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
        {r.team}
        {r.note !== null && <span className="sub">・{r.note}</span>}
      </td>
    </>
  );

  return (
    <div id="panel-career" className={table.panelCareer}>
      <Heading>生涯年表</Heading>
      {batting.length > 0 && (
        <div className={table.finScroll}>
          {/* 兩張表的欄位差很多，沒有小標的話捲到一半會分不出在看哪一側。 */}
          <Subheading>野手</Subheading>
          <table className={table.fin}>
            <thead>
              <tr>
                {headLead}
                <th title="登錄守位">守位</th>
                <StatHeadCells columns={BATTING_COLUMNS} />
                <th title="守備分">DEF</th>
              </tr>
            </thead>
            <tbody>
              {batting.map((r, i) => (
                <tr key={r.key} className={rowClass(r)}>
                  {rowLead(r, batting[i - 1]?.year === r.year)}
                  <td title={r.position === null ? undefined : positionName(r.position)}>
                    {r.position ?? '—'}
                  </td>
                  <StatCells columns={BATTING_COLUMNS} line={r.batting!} base={r.base} shares={r.shares} />
                  <td>{r.defenseRuns > 0 ? `+${r.defenseRuns}` : r.defenseRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pitching.length > 0 && (
        <div className={table.finScroll}>
          <Subheading>投手</Subheading>
          <table className={table.fin}>
            <thead>
              <tr>
                {headLead}
                <th title="投手定位">定位</th>
                <StatHeadCells columns={PITCHING_COLUMNS} />
              </tr>
            </thead>
            <tbody>
              {pitching.map((r, i) => (
                <tr key={r.key} className={rowClass(r)}>
                  {rowLead(r, pitching[i - 1]?.year === r.year)}
                  {/* 與野手那張表的「守位」對稱：他那一年在做什麼。養成期沒有
                      牛棚分工，留白。 */}
                  <td title={r.pitcherRole === null ? undefined : ROLE_NAMES[r.pitcherRole]}>
                    {r.pitcherRole ?? '—'}
                  </td>
                  <StatCells columns={PITCHING_COLUMNS} line={r.pitching!} base={r.base} shares={r.shares} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TotalsTable title="各聯盟通算" rows={leagueTotals(summary)} />
      {summary.leagues.length > 1 && (
        <TotalsTable title="頂級聯盟通算" rows={[topTotalRow(summary)]} />
      )}
      <InternationalTable summary={summary} kind="youth" />
      <InternationalTable summary={summary} kind="pro" />
      <CombinedTable summary={summary} />
    </div>
  );
}
