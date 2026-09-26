import type { LogEntry } from '../../engine/flow.ts';
import type { Game } from '../../engine/game.ts';
import type { Baseline } from '../../engine/metrics.ts';
import { BATTING_COLUMNS, PITCHING_COLUMNS, type SharesByPart, type StatColumn } from '../stats/columns.ts';
import {
  careerRows,
  COMBINED_COLUMNS,
  combinedRows,
  INTL,
  intlTotalRow,
  leagueTotals,
  topTotalRow,
  type CareerRow,
  type TotalRow,
} from '../stats/rows.ts';
import { hand, honorGroups, roleLabelOf, shownTraits } from '../player/profile.ts';
import type { CardLine, CardRow, CardTable, CareerCard } from './careerImage.ts';

/**
 * 生涯成績圖的內容。
 *
 * **這裡只組內容，不畫圖**（畫的部分在 careerImage.ts）。每一格都走畫面上同一
 * 批函式與同一份欄位定義——圖與畫面各算一份的話，玩家遲早會拿圖來質疑畫面，
 * 而那時他是對的。
 *
 * 圖的順序不照畫面：球員卡、狀態、引退之日、生涯年表、榮譽。畫面上引退之日
 * 是事件流裡的一張卡，排在年表之前；圖是要傳出去給人看的東西，先講他是誰、
 * 再講那一天發生了什麼事，最後才攤開數字。
 */
export function careerCardOf(game: Game): CareerCard | null {
  const state = game.state;
  const summary = game.summary;
  if (state === null || summary === null) return null;

  const cells = <T,>(
    cols: readonly StatColumn<T>[],
    v: T,
    base: Baseline,
    shares: SharesByPart | null,
  ): string[] => cols.map((c) => String(c.value(v, base, shares)));

  const rows = careerRows(summary);
  const batting = rows.filter((r) => r.batting !== null);
  const pitching = rows.filter((r) => r.pitching !== null);
  const totals = leagueTotals(summary);

  // 季中轉隊的那一年會有兩列。年與齡只寫在第一列——同一年重覆印一次年份，讀起來
  // 像兩個球季，而球隊那一欄已經說清楚這是同一年的後半段了（與畫面上同一個規則）。
  const lead = (r: CareerRow, cont: boolean): string[] => [
    cont ? '' : String(r.year),
    cont ? '' : String(r.age),
    r.note === null ? r.team : `${r.team}・${r.note}`,
  ];
  const tint = (r: CareerRow): CardRow['tint'] =>
    r.injured === null ? null : r.injured === 'minor' ? 'minor' : 'major';

  const tables: CardTable[] = [];
  if (batting.length > 0) {
    tables.push({
      title: '生涯年表',
      caption: '野手',
      head: ['年', '齡', '球隊', '守位', ...BATTING_COLUMNS.map((c) => c.key), 'DEF'],
      lefts: [2],
      rows: batting.map((r, i) => ({
        tint: tint(r),
        cells: [
          ...lead(r, batting[i - 1]?.year === r.year),
          r.position ?? '—',
          ...cells(BATTING_COLUMNS, r.batting!, r.base, r.shares),
          r.defenseRuns > 0 ? `+${r.defenseRuns}` : String(r.defenseRuns),
        ],
      })),
    });
  }
  if (pitching.length > 0) {
    tables.push({
      title: '生涯年表',
      caption: '投手',
      head: ['年', '齡', '球隊', '定位', ...PITCHING_COLUMNS.map((c) => c.key)],
      lefts: [2],
      rows: pitching.map((r, i) => ({
        tint: tint(r),
        cells: [
          ...lead(r, pitching[i - 1]?.year === r.year),
          r.pitcherRole ?? '—',
          ...cells(PITCHING_COLUMNS, r.pitching!, r.base, r.shares),
        ],
      })),
    });
  }

  const totalTable = (
    title: string,
    picked: readonly TotalRow[],
    side: 'batting' | 'pitching',
  ): CardTable | null => {
    const only = picked.filter((r) => r[side] !== null);
    if (only.length === 0) return null;
    return {
      title,
      caption: side === 'batting' ? '野手' : '投手',
      head:
        side === 'batting'
          ? ['聯盟', '季', ...BATTING_COLUMNS.map((c) => c.key), 'DEF']
          : ['聯盟', '季', ...PITCHING_COLUMNS.map((c) => c.key)],
      lefts: [0],
      rows: only.map((r) => ({
        tint: null,
        cells:
          side === 'batting'
            ? [
                r.label,
                String(r.seasons),
                ...cells(BATTING_COLUMNS, r.batting!, r.base, r.shares),
                r.defenseRuns > 0 ? `+${r.defenseRuns}` : String(r.defenseRuns),
              ]
            : [r.label, String(r.seasons), ...cells(PITCHING_COLUMNS, r.pitching!, r.base, r.shares)],
      })),
    };
  };

  const top = summary.leagues.length > 1 ? [topTotalRow(summary)] : [];
  for (const t of [
    totalTable('各聯盟通算', totals, 'batting'),
    totalTable('各聯盟通算', totals, 'pitching'),
    ...(top.length > 0
      ? [totalTable('頂級聯盟通算', top, 'batting'), totalTable('頂級聯盟通算', top, 'pitching')]
      : []),
  ]) {
    if (t !== null) tables.push(t);
  }

  // 國際賽兩種各一組：養成在前、職業在後，與畫面同一個順序。
  for (const kind of ['youth', 'pro'] as const) {
    const spec = INTL[kind];
    const intlRows = spec.rows(summary);
    const base = spec.base();
    for (const side of ['batting', 'pitching'] as const) {
      const only = intlRows.filter((r) => r[side] !== null);
      if (only.length === 0) continue;
      tables.push({
        title: spec.title,
        caption: side === 'batting' ? '野手' : '投手',
        head: [
          '年',
          '齡',
          '賽事',
          '名次',
          ...(side === 'batting' ? [...BATTING_COLUMNS.map((c) => c.key), 'DEF'] : PITCHING_COLUMNS.map((c) => c.key)),
        ],
        lefts: [2, 3],
        rows: only.map((r) => ({
          tint: null,
          cells: [
            String(r.year),
            String(r.age),
            r.tournament,
            `${r.rank}${r.mvp ? '・MVP' : ''}`,
            ...(side === 'batting'
              ? [
                  ...cells(BATTING_COLUMNS, r.batting!, base, spec.ledger(r)),
                  r.defenseRuns > 0 ? `+${r.defenseRuns}` : String(r.defenseRuns),
                ]
              : cells(PITCHING_COLUMNS, r.pitching!, base, spec.ledger(r))),
          ],
        })),
      });
    }

    if (intlRows.length > 0) {
      const row = intlTotalRow(summary, kind);
      for (const side of ['batting', 'pitching'] as const) {
        if (row[side] === null) continue;
        tables.push({
          title: `${spec.title}通算`,
          caption: side === 'batting' ? '野手' : '投手',
          head:
            side === 'batting'
              ? ['屆', ...BATTING_COLUMNS.map((c) => c.key), 'DEF']
              : ['屆', ...PITCHING_COLUMNS.map((c) => c.key)],
          // 沒有「賽事」欄：只有一列，那一列就是標題寫的賽事（與畫面同一個規則）。
          lefts: [],
          rows: [
            {
              tint: null,
              cells:
                side === 'batting'
                  ? [String(row.seasons), ...cells(BATTING_COLUMNS, row.batting!, row.base, row.shares), row.defenseRuns > 0 ? `+${row.defenseRuns}` : String(row.defenseRuns)]
                  : [String(row.seasons), ...cells(PITCHING_COLUMNS, row.pitching!, row.base, row.shares)],
            },
          ],
        });
      }
    }
  }

  // 合併生涯紀錄：投打守合起來的一張，與畫面同一份列與欄。
  {
    const rows = combinedRows(summary);
    if (rows.length > 0) {
      tables.push({
        title: '合併生涯紀錄',
        caption: null,
        head: ['年', '齡', '球隊', ...COMBINED_COLUMNS.map((c) => c.key)],
        lefts: [2],
        rows: rows.map((r) => ({ tint: null, cells: [...r.lead, ...COMBINED_COLUMNS.map((c) => c.value(r))] })),
      });
    }
  }

  // 掛靴的地方：引退之後球團關係已經結束，因此讀 retiredFrom 而不是 pro
  // （見 PlayerState.retiredFrom，記分板也是讀這一份）。
  const at = state.retiredFrom;
  return {
    name: state.origin.name,
    role: roleLabelOf(state),
    hands: `投${hand(state.origin.throws)}打${hand(state.origin.bats)}`,
    age: state.age,
    year: state.year,
    seed: game.setup.seed,
    team: at?.team ?? state.pro?.team ?? '',
    league: at?.levelName ?? state.pro?.levelName ?? '',
    traits: shownTraits(state.traits, state.traitNames).map((t) => ({
      label: t.label,
      bad: t.tone === 'bad',
    })),
    retire: retireText(game.flow.log),
    score: cardLines(game.flow.log, '生涯評價'),
    earnings: cardLines(game.flow.log, '生涯收入'),
    tables,
    honors: honorGroups({
      awards: state.awards,
      honors: state.honors,
      summary,
      love: state.love,
    }),
  };
}

/**
 * 引退之日那張卡的內文。
 *
 * 從事件流裡撈，不跟引擎再要一份——那段文字是抽出來的場景（依代表聯盟與生涯
 * 分級選用），重算一次可能抽到另一則，圖上寫的就不是他那天讀到的那一段了。
 * 卡片內文是 HTML，這裡要還原成純文字。
 */
function retireText(log: readonly LogEntry[]): string | null {
  const body = cardBody(log, '引退之日');
  return body === null ? null : plain(body.replace(/<br\s*\/?>/gi, '\n'));
}

/** 事件流裡最後一張指定標題的卡，還沒去 HTML。 */
function cardBody(log: readonly LogEntry[], title: string): string | null {
  const hit = [...log].reverse().find((e) => e.kind === 'card' && e.title === title);
  return hit === undefined || hit.kind !== 'card' ? null : hit.body;
}

/** 卡片內文還原成純文字。 */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 一張卡的內文，逐行拆成圖上要畫的東西。
 *
 * **跟引退之日同一條路：從事件流撈，不跟引擎再要一份。** 圖上寫的就是他結算時
 * 讀到的那幾行，兩邊不可能對不起來；生涯收入也因此不必為了畫圖而多接一條管線。
 *
 * 分行沿用卡片自己的 `<br>`，`<span class="sub">` 那幾行標成小字——那是卡片裡
 * 的層級，不是排版的裝飾。
 */
function cardLines(log: readonly LogEntry[], title: string): CardLine[] {
  const body = cardBody(log, title);
  if (body === null) return [];
  const out: CardLine[] = [];
  for (const raw of body.split(/<br\s*\/?>/i)) {
    const text = plain(raw).trim();
    if (text === '') continue;
    out.push({ text, dim: /class="sub"/i.test(raw) });
  }
  return out;
}
