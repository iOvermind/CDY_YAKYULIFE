import styles from './PageNav.module.css';

/**
 * 手機的換頁提示：兩顆頁點，**只在橫向捲動時出現**。
 *
 * 平常不佔畫面——兩頁的內容本身就說明了現在在哪一頁；要換頁的那一刻（手指拖曳、
 * 或自動切去加點）才亮起來，停下來一會兒再淡出。以前還有左右兩顆箭頭，但走馬燈
 * 本來就能滑，箭頭只是同一件事的第二個入口，而它們蓋在內容上面。
 *
 * 掛在 `#game` 外面而不是裡面——`#game` 在手機上的直接子元素就是那兩頁，多一個
 * 就多一頁。整塊是 fixed，蓋在中間那條帶子上，不收任何事件。
 */
export function PageNav({ page, moving }: { page: number; moving: boolean }) {
  return (
    <div id="pagenav" className={styles.pagenav}>
      <div className={`${styles.pagedots}${moving ? ` ${styles.shown}` : ''}`} aria-hidden="true">
        <i className={page === 0 ? styles.on : ''} />
        <i className={page === 1 ? styles.on : ''} />
      </div>
    </div>
  );
}
