import { type UIEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * 手機的兩頁：能力頁（`#col-left`）與事件頁（`#col-right`）。
 *
 * **走馬燈不是另外包一層做出來的，是 `#game` 自己在手機上變成橫向 snap 容器。**
 * 這兩塊在桌面分屬左右欄，一個 DOM 生不出兩種父子關係；硬包一層就得改寫桌面的
 * grid，而 grid 的列高會把 `#board` 與 `#panel-stats` 綁進同一列，桌面的版面
 * 就跟著動了。改成讓 `#game` 換角色，所有手機的規則都關在 `@media` 裡，桌面那段
 * CSS 一行都不用碰。
 *
 * 記分板與動作區在手機上是 `position:fixed`，橫向捲動時才不會跟著滑走；它們的
 * 高度會隨合約、年薪、特性數量與選項數量變動，因此量出來餵給 CSS 變數，版面
 * 用它算出中間那條帶子的上下界。
 *
 * 自動切頁**只在轉折的那一刻切一次**：需要加點時滑到能力頁，加完滑回事件頁。
 * 加點的過程中（還剩幾點沒分配）不再干預——玩家滑去事件頁看卡片是他的選擇，
 * 每次提問都把他拉回來等於沒收了那個選擇。
 */
export function usePages(needsAbility: boolean, started: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  // 同一件事的兩份：`page` 給畫面（頁點要跟著亮），`at` 給事件處理器（在
  // 回呼裡讀 state 會讀到閉包當時的那一份）。
  const [page, setPage] = useState(1);
  const at = useRef(1);

  /** 手指是不是還壓在螢幕上。 */
  const touching = useRef(false);
  /** 排隊中的自動切頁：目標頁、已經等了多久。 */
  const pending = useRef<{ to: number; waited: number } | null>(null);
  const timers = useRef<{ flush?: number; settle?: number; fade?: number }>({});
  /** 正在橫向捲動（手指拖曳或自動切頁都算）。頁點只在這時候出現。 */
  const [moving, setMoving] = useState(false);

  /** 立刻滑到第 i 頁。 */
  const go = (i: number) => {
    const el = ref.current;
    // 桌面沒有橫向捲動空間，這裡就什麼也不做——不必另外判斷斷點。
    if (el === null || el.scrollWidth <= el.clientWidth) return;
    at.current = i;
    setPage(i);
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    settle(i, 0);
  };

  /**
   * 自動切頁的請求。**兩件事都在這裡等：先等 `after` 毫秒，再等手指放開。**
   *
   * - 等 `after`：滑去能力頁之前停半秒，讓玩家先讀完剛跳出來的卡片。不停的話
   *   畫面會在他讀之前就換掉，變成點完能力才知道發生了什麼事。
   * - 等放手：能力列有長按連發（`useHold`，按住每 90ms +1），點數點完的那一刻
   *   手指多半還壓著，而瀏覽器一偵測到觸控就會取消進行中的 smooth scroll，
   *   畫面會停在兩頁中間。
   *
   * 等放手**有上限**：`pointerup` 不保證送得到（元件被換掉、系統攔截手勢），
   * 無限等的話那一筆待辦就永遠不會兌現——那正是「偶發不會自動滑回事件」的
   * 樣子。等滿上限就直接滑，寧可打斷一次觸控也不要卡在錯的頁。
   */
  const request = (to: number, after: number) => {
    window.clearTimeout(timers.current.flush);
    pending.current = { to, waited: 0 };
    timers.current.flush = window.setTimeout(flush, after);
  };

  const flush = () => {
    const job = pending.current;
    if (job === undefined || job === null) return;
    if (touching.current && job.waited < HOLD_WAIT_MAX) {
      job.waited += HOLD_WAIT_STEP;
      timers.current.flush = window.setTimeout(flush, HOLD_WAIT_STEP);
      return;
    }
    pending.current = null;
    go(job.to);
  };

  /**
   * 收尾：滑完之後如果卡在兩頁中間，直接對齊過去。
   *
   * 用瞬移不用 smooth——會走到這裡就是因為 smooth 被打斷過，再滑一次可能再被
   * 打斷一次。**只在「卡在中間」時才動**：已經停在另一頁是玩家自己滑過去的，
   * 那是他的選擇，不該把他拉回來。
   */
  const settle = (i: number, waited: number) => {
    window.clearTimeout(timers.current.settle);
    timers.current.settle = window.setTimeout(() => {
      const el = ref.current;
      if (el === null) return;
      // 手指還在，這一刻的位置還不是最終位置——再等一輪，同樣有上限。
      if (touching.current && waited < HOLD_WAIT_MAX) {
        settle(i, waited + SETTLE_DELAY);
        return;
      }
      const w = el.clientWidth;
      if (w === 0) return;
      const off = el.scrollLeft % w;
      if (off > 2 && off < w - 2) el.scrollLeft = i * w;
    }, SETTLE_DELAY);
  };

  // 手指的狀態掛在 window 上（捕獲階段），因為按著的可能是能力列、也可能是
  // 動作區的按鈕，兩邊都不該各自回報一次。
  useEffect(() => {
    const down = () => {
      touching.current = true;
    };
    const up = () => {
      touching.current = false;
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.clearTimeout(timers.current.flush);
      window.clearTimeout(timers.current.settle);
      window.clearTimeout(timers.current.fade);
    };
  }, []);

  // 記分板與動作區的高度。兩者都是 fixed，中間那條帶子要靠它們算出上下界。
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const watched = [el.querySelector('#board'), el.querySelector('#panel-act')].filter(
      (n): n is Element => n !== null,
    );
    const sync = () => {
      const root = document.documentElement.style;
      for (const n of watched) {
        const h = `${n.getBoundingClientRect().height}px`;
        root.setProperty(n.id === 'board' ? '--board-h' : '--act-h', h);
      }
    };
    const observer = new ResizeObserver(sync);
    for (const n of watched) observer.observe(n);
    sync();
    return () => observer.disconnect();
  }, [started]);

  // 起始頁：預設事件頁——故事線是常態，能力頁是被叫出來的那一頁。但**開局第一
  // 個提問就是配點的時候要直接停在能力頁**：自動切頁只認「由不需要變成需要」
  // 那個轉折，開局就已經需要的話那個轉折不存在，停在事件頁會沒有人把他帶過去。
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || el.scrollWidth <= el.clientWidth) return;
    if (!first.current) return;
    first.current = false;
    at.current = needsAbility ? 0 : 1;
    setPage(at.current);
    el.scrollLeft = at.current * el.clientWidth;
  }, [started, needsAbility]);

  const wanted = useRef(needsAbility);
  useEffect(() => {
    if (wanted.current === needsAbility) return;
    wanted.current = needsAbility;
    request(needsAbility ? 0 : 1, needsAbility ? READ_FIRST : 0);
  }, [needsAbility]);

  /**
   * 玩家按了動作區的按鈕。
   *
   * **每按一次就重新確認一遍該待在哪一頁。** 光靠上面那個「由需要變成不需要」
   * 的轉折不夠：轉折只認得到變化，認不出「本來就不需要、但畫面停在能力頁」
   * 這種已經歪掉的狀態，而那個狀態只要漏掉一次事件就會出現，然後一直錯下去。
   * 按鈕是流程往前走的唯一入口，在這裡對一次帳最省事。
   *
   * 對帳延到下一次 render：按下去的當下 `needsAbility` 還是**這一步之前**的
   * 值，拿它判斷的話，通往加點的那一步會先往事件頁滑一次再滑回來。
   */
  const recheck = useRef(false);
  const onAction = () => {
    recheck.current = true;
  };
  useEffect(() => {
    if (!recheck.current) return;
    recheck.current = false;
    if (!needsAbility) request(1, 0);
  });

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    at.current = i;
    setPage((p) => (p === i ? p : i));
    // 頁點：捲動中亮著，停下來 DOTS_LINGER 之後才收。自動切頁也會走到這裡——
    // 畫面自己換了頁，玩家要看得出換到哪一頁。
    setMoving(true);
    window.clearTimeout(timers.current.fade);
    timers.current.fade = window.setTimeout(() => setMoving(false), DOTS_LINGER);
  };

  // 轉螢幕之後把當前頁重新對齊。頁寬等於視窗寬，寬度一變舊的 scrollLeft 就落在
  // 兩頁中間；各家瀏覽器對「版面改變後要不要重新吸附」的處理並不一致，自己對
  // 一次最省事。
  useEffect(() => {
    const onResize = () => {
      const el = ref.current;
      if (el === null || el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft = at.current * el.clientWidth;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { ref, page, moving, go, onAction, onScroll };
}

/** 滑去能力頁之前先停這麼久，讓玩家讀完剛跳出來的卡片。 */
const READ_FIRST = 1000;

/** 等手指放開的輪詢間隔與總上限。 */
const HOLD_WAIT_STEP = 100;

const HOLD_WAIT_MAX = 1200;

/** 滑完之後多久檢查一次有沒有卡在兩頁中間。 */
const SETTLE_DELAY = 400;

/** 捲動停下來之後，頁點再亮多久才淡出。 */
const DOTS_LINGER = 800;
