import type { BattingLine, PitchingLine } from '../../engine/amateurStats.ts';
import type { PlayerState } from '../../engine/game.ts';
import { amateurBaseline, type Baseline, proBaseline } from '../../engine/metrics.ts';
import { TraitList } from '../player/TraitList.tsx';
import { relationTags } from '../player/profile.ts';
import { BATTING_COLUMNS, PITCHING_COLUMNS, type SharesByPart } from './columns.ts';
import panel from './panel.module.css';
import table from './table.module.css';
import { Heading, Subheading } from '../common/Heading.tsx';

/**
 * 最近一季的成績與狀態。只在生涯進行中出現，而且**只有桌面看得到**。
 *
 * 手機把整塊收掉（見 panel.module.css 的手機段）：成績由每季結算的事件卡負責，狀態則
 * 由記分板底下那一份接手（`#bd-traits`）。**兩邊是同一個 `TraitList`**，差的
 * 只是掛在哪裡與帶不帶小標——桌面的狀態接在成績表下面（它們是同一段時間的
 * 側寫），手機沒有成績表可接，就釘在球員資料下面。
 */
export function StatsPanel({ state }: { state: PlayerState }) {
  return (
    <div id="panel-stats" className={panel.panelStats}>
      {/* 面板不帶自己的標題：底下那塊自己有 `<h4>`（最近一季），再加一個面板級
          標題就是兩個同級標題連在一起、中間沒有內容。 */}
      {/* 這裡不再放方格。

          年份、年齡、綜合、可分配點左側記分板都有；年薪、合約、生涯收入已經併
          進記分板底下那一行。聯盟水準整格刪掉——升降級卡片現在一律報「綜合 X／
          門檻 Y」（ADR 0029），而下放的門檻用的是基準值不是浮動值，一個常駐的
          浮動 par 解釋不了任何一次判定，只會讓玩家拿它去對一條不存在的線。

          動機是手機：右欄在窄螢幕上要一路捲到底才看得到成績表，方格佔掉的正是
          最上面那一屏。 */}

      {/* 只留最近打完的那一季。標題不寫「當年」——季初訓練時這裡放的還是去年的
          成績，寫當年是騙人的。 */}
      <StatLines
        label="最近一季"
        batting={state.seasonBatting}
        pitching={state.seasonPitching}
        base={state.pro === null ? amateurBaseline() : proBaseline(state.pro.level)}
        shares={
          state.seasonShares === null
            ? null
            : { ...state.seasonShares, ...(state.seasonWar === null ? {} : { war: state.seasonWar }) }
        }
        defenseRuns={state.seasonDefenseRuns}
      />
      <TraitList traits={state.traits} names={state.traitNames} notes={state.traitNotes} tags={relationTags(state)} />
    </div>
  );
}

/** 打擊與投球成績。養成期的成績依大賽場次結算，場次由名次決定。 */
function StatLines({
  label,
  batting,
  pitching,
  base,
  shares = null,
  defenseRuns,
}: {
  label: string | null;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
  /** 聯盟平均。ERA+／OPS+／WS 都要跟它比。 */
  base: Baseline;
  /** 這一季的三本帳。沒有就退回單側自算。 */
  shares?: SharesByPart | null;
  /** 這一季的守備分。守備沒有別的欄位，因此掛在野手那張表的最後一欄。 */
  defenseRuns?: number | null;
}) {
  if (batting === null && pitching === null) {
    return (
      <p className={panel.statPending}>
        {label === null ? '還沒有成績。' : `${label}：還沒打過大賽。`}
      </p>
    );
  }

  return (
    <>
      {/* 間距一律交給 CSS：這個標題現在是面板的第一行（面板自己的標題拿掉了），
          帶著行內 margin 會在 padding 之上再多一截頭。 */}
      {label !== null && <Heading>{label}</Heading>}
      {pitching !== null && (
        <div className={table.finScroll}>
          {/* 二刀流會同時出現兩張表，沒有小標就分不出哪張是哪張。 */}
          <Subheading>投手</Subheading>
          <table className={table.fin}>
            <thead>
              <tr>
                {PITCHING_COLUMNS.map((c) => (
                  <th key={c.key} title={c.title}>
                    {c.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {PITCHING_COLUMNS.map((c) => (
                  <td key={c.key}>{c.value(pitching, base, shares)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {batting !== null && (
        <div className={table.finScroll}>
          <Subheading>野手</Subheading>
          <table className={table.fin}>
            <thead>
              <tr>
                {BATTING_COLUMNS.map((c) => (
                  <th key={c.key} title={c.title}>
                    {c.key}
                  </th>
                ))}
                {defenseRuns != null && <th title="守備分">DEF</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                {BATTING_COLUMNS.map((c) => (
                  <td key={c.key}>{c.value(batting, base, shares)}</td>
                ))}
                {defenseRuns != null && (
                  <td>{defenseRuns > 0 ? `+${defenseRuns}` : defenseRuns}</td>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );

}
