import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CareerSummary } from '../../engine/career.ts';
import type { Finale, LogEntry } from '../../engine/flow.ts';
import type { PlayerState } from '../../engine/game.ts';
import { HonorBoard } from '../player/HonorBoard.tsx';
import { TraitList } from '../player/TraitList.tsx';
import { relationTags } from '../player/profile.ts';
import { CareerTable } from '../stats/CareerTable.tsx';
import styles from './EventLog.module.css';

/**
 * 事件流。**新內容出現時一律捲到底，不管玩家有沒有自己往上捲。**
 *
 * 這裡曾經維護一個「玩家是不是貼著底部」的旗標，只在貼底時才自動捲。那個設計
 * 在這個介面裡是錯的：事件流是**當下正在發生的事**，新卡片就是提問本身，停在
 * 半空中的畫面等於把提問藏起來。而且旗標本身很難維護正確——版面一動，瀏覽器
 * 送出的捲動事件與玩家自己的捲動長得一模一樣，只要漏擋一次就會卡住不再自動捲，
 * 那正是「有時候沒捲到底」的來源。旗標拿掉，那一整類 bug 也跟著消失。
 *
 * 兩件事仍必須一起做：
 *
 * 1. **useLayoutEffect 而不是 useEffect**——要在瀏覽器繪製之前捲，否則會先
 *    閃一下舊位置。
 * 2. **監看容器與內容的尺寸變化**。光在 entries 變動時捲一次不夠：卡片的高度
 *    要等字體與換行定案才算得出來，那發生在這一次 effect 之後，捲到的會是舊
 *    高度。動作區長出選項把事件流壓矮也是同一類——那不會觸發捲動事件。
 *    但尺寸變化只在玩家原本就停在底部時才追——見 `atBottom`。
 */
export function EventLog({
  entries,
  state,
  summary,
}: {
  entries: readonly LogEntry[];
  state: PlayerState | null;
  summary: CareerSummary | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // 捲到 scrollHeight − clientHeight，不是 scrollHeight。瀏覽器雖然會夾住，
  // 但明確寫出來才不會有人以為這裡差了一個 clientHeight。
  const pin = () => {
    const el = ref.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight - el.clientHeight;
  };

  // 玩家上一次停下來時是不是在底部。尺寸變化只在這時候追到底：往上捲回去點開
  // 結算裡的狀態說明，說明展開也是尺寸變化，不該把人拖回今晚打老虎（issue #35）。
  // 程式自己捲到底送出的捲動事件算出來也是「在底部」，所以不會卡住。
  const atBottom = useRef(true);

  useLayoutEffect(() => {
    atBottom.current = true;
    pin();
  }, [entries.length]);

  useEffect(() => {
    const el = ref.current;
    const inner = innerRef.current;
    if (el === null || inner === null) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 8;
    };
    const observer = new ResizeObserver(() => {
      if (atBottom.current) pin();
    });
    el.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(el);
    observer.observe(inner);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  return (
    <div id="panel-log" className={styles.panelLog} ref={ref}>
      <div ref={innerRef}>
        <LogView entries={entries} state={state} summary={summary} />
      </div>
    </div>
  );
}

/**
 * 事件流末端的結算卡：狀態、生涯年表、榮譽榜。
 *
 * 日誌只記下段落別，內容一律從 state / summary 重算（見 flow.ts 的 `Finale`）。
 * 因此重讀存檔時這三塊跟著最新的資料走，不會留下一份過期的畫面副本。
 */
function FinaleCard({
  section,
  state,
  summary,
}: {
  section: Finale['section'];
  state: PlayerState | null;
  summary: CareerSummary | null;
}) {
  // 讀檔中途或狀態尚未就緒時整塊不畫——結算卡沒有半成品的形態。
  if (state === null || summary === null) return null;
  if (section === 'traits')
    return (
      <div className={styles.card}>
        <TraitList traits={state.traits} names={state.traitNames} notes={state.traitNotes} tags={relationTags(state)} />
      </div>
    );
  if (section === 'career')
    return (
      <div className={styles.card}>
        <CareerTable summary={summary} />
      </div>
    );
  return (
    <div className={styles.card}>
      <HonorBoard
        awards={state.awards}
        honors={state.honors}
        summary={summary}
        love={state.love}
      />
    </div>
  );
}

function LogView({
  entries,
  state,
  summary,
}: {
  entries: readonly LogEntry[];
  state: PlayerState | null;
  summary: CareerSummary | null;
}) {
  // divider 開啟新的年度區塊，後續卡片都掛在它底下，與原版的摺疊結構一致。
  const blocks: { head: string | null; cards: LogEntry[] }[] = [];
  for (const entry of entries) {
    if (entry.kind === 'divider') blocks.push({ head: entry.text, cards: [] });
    else {
      const last = blocks[blocks.length - 1];
      if (last) last.cards.push(entry);
      else blocks.push({ head: null, cards: [entry] });
    }
  }

  return (
    <>
      {blocks.map((block, i) => (
        <div className={styles.yrBlock} key={i}>
          {block.head !== null && <div className={`${styles.yrHead} ${styles.hasBody}`}>{block.head}</div>}
          <div className={styles.yrBody}>
            {block.cards.map((entry, j) =>
              entry.kind === 'card' ? (
                <div className={`${styles.card} ${styles[entry.tone]}`} key={j}>
                  {entry.title !== undefined && <h4>{entry.title}</h4>}
                  <p dangerouslySetInnerHTML={{ __html: entry.body }} />
                </div>
              ) : entry.kind === 'finale' ? (
                <FinaleCard key={j} section={entry.section} state={state} summary={summary} />
              ) : null,
            )}
          </div>
        </div>
      ))}
    </>
  );
}
