import type { Option, Prompt } from '../../engine/flow.ts';
import { Game } from '../../engine/game.ts';
import { SaveCardButton } from '../card/SaveCardButton.tsx';
import { StatsPanel } from '../stats/StatsPanel.tsx';
import { AbilityPanel } from './AbilityPanel.tsx';
import { Board } from './Board.tsx';
import { DiceRow } from './DiceRow.tsx';
import { EventLog } from './EventLog.tsx';
import { PageNav } from './PageNav.tsx';
import { usePages } from './usePages.ts';
import styles from './GameScreen.module.css';
import controls from '../common/controls.module.css';
import { Heading } from '../common/Heading.tsx';

/**
 * alloc: 底下的控制項，不是能力。
 *
 * 它們與能力共用前綴是刻意的——同一個配點階段的選項應該長得一樣，重播日誌
 * 看起來才是連貫的一串。但介面上它們是動作鈕，不是能力列。
 */
const ALLOC_CONTROLS = new Set(['alloc:undo', 'alloc:confirm', 'alloc:forfeit']);

/** 動作鈕的樣式：主要動作與警告各有一種外框。 */
function buttonClass(role: Option['role']): string {
  return [controls.btn, role === 'main' && controls.main, role === 'warn' && controls.warn].filter(Boolean).join(' ');
}

/** 目前的提問是不是在要求分配點數到某項能力。 */
function allocOptions(prompt: Prompt | null): Map<string, Option> {
  const map = new Map<string, Option>();
  if (prompt === null) return map;
  for (const o of prompt.options) {
    if (o.id.startsWith('alloc:') && !ALLOC_CONTROLS.has(o.id)) {
      map.set(o.id.slice('alloc:'.length), o);
    }
  }
  return map;
}

export function GameScreen({
  game,
  onChoose,
  onRestart,
}: {
  game: Game;
  onChoose: (optionId: string) => void;
  onRestart: () => void;
}) {
  const state = game.state;
  const prompt = game.flow.prompt;
  const allocatable = allocOptions(prompt);
  // 加點時，能力選項已經在左欄的能力列上；動作區留下其餘的。
  const otherOptions = (prompt?.options ?? []).filter((o) => !o.id.startsWith('alloc:'));
  // 復原與確認（或放棄）獨立一排並列——它們是一組動作（退一步／往前走），拆成上下兩顆
  // 全寬按鈕會讓人以為是兩個不相干的選項。
  const controlOptions = (prompt?.options ?? []).filter((o) => ALLOC_CONTROLS.has(o.id));

  const pages = usePages(allocatable.size > 0, state !== null);

  return (
    <>
      <div id="game" className={styles.game} ref={pages.ref} onScroll={pages.onScroll}>
        <div id="col-left" className={styles.colLeft}>
          {state && (
            <Board state={state} rating={game.rating} seed={game.setup.seed} />
          )}
          {state && (
            <div id="panel-abilities" className={styles.panelAbilities}>
              <Heading>能力</Heading>
              <AbilityPanel
                state={state}
                allocatable={allocatable}
                repeatable={game.dice === null}
                onChoose={onChoose}
              />
            </div>
          )}
        </div>

        <div id="col-right" className={styles.colRight}>
          {/* 生涯結束後整塊拿掉：狀態、生涯年表、榮譽都改由事件流末端的結算卡呈現。 */}
          {state && game.summary === null && <StatsPanel state={state} />}
          <EventLog entries={game.flow.log} state={state} summary={game.summary} />
          <div id="panel-act" className={styles.panelAct}>
            {prompt !== null ? (
              <>
                {prompt.title !== undefined && <div className={styles.title}>{prompt.title}</div>}
                {game.dice !== null && <DiceRow dice={game.dice} />}
                {state !== null && state.pool > 0 && allocatable.size > 0 && game.dice === null && (
                  <div className={styles.pool}>大賽點數還有 {state.pool} 點（點一下能力 +1）</div>
                )}
                {allocatable.size > 0 && (
                  // 不寫方向。桌面在左欄、手機在同一頁的上方，而手機還能滑到事件
                  // 頁去——任何一個方向詞都會有講錯的時候，一份文案兩邊共用才不會。
                  <div className={styles.title} style={{ color: 'var(--accent)', letterSpacing: 0 }}>
                    點能力列加點
                  </div>
                )}
                {otherOptions.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={buttonClass(o.role)}
                    disabled={o.disabled === true}
                    onClick={() => {
                      onChoose(o.id);
                      pages.onAction();
                    }}
                  >
                    {o.label}
                    {o.note !== undefined && <small>{o.note}</small>}
                  </button>
                ))}
                {controlOptions.length > 0 && (
                  <div className={controls.row2}>
                    {controlOptions.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={buttonClass(o.role)}
                        disabled={o.disabled === true}
                        onClick={() => {
                          onChoose(o.id);
                          pages.onAction();
                        }}
                      >
                        {o.label}
                        {o.note !== undefined && <small>{o.note}</small>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.title}>{game.summary === null ? '流程已到目前實作的盡頭' : '生涯結束'}</div>
                {game.summary !== null && <SaveCardButton game={game} />}
                <button type="button" className={controls.btn} onClick={onRestart}>
                  重新開局
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {state !== null && <PageNav page={pages.page} moving={pages.moving} />}
    </>
  );
}
