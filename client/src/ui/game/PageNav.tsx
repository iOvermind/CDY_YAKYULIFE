

/**
 * 手機的換頁提示：左右半透明箭頭 ＋ 兩顆頁點。
 *
 * 掛在 `#game` 外面而不是裡面——`#game` 在手機上的直接子元素就是那兩頁，多一個
 * 就多一頁。整塊是 fixed，蓋在中間那條帶子上，只有箭頭與頁點自己收事件。
 */
export function PageNav({ page, go }: { page: number; go: (i: number) => void }) {
  return (
    <div id="pagenav">
      <button
        type="button"
        className="pagearrow left"
        aria-label="看能力"
        hidden={page === 0}
        onClick={() => go(0)}
      >
        ‹
      </button>
      <button
        type="button"
        className="pagearrow right"
        aria-label="看事件"
        hidden={page === 1}
        onClick={() => go(1)}
      >
        ›
      </button>
      <div className="pagedots" aria-hidden="true">
        <i className={page === 0 ? 'on' : ''} />
        <i className={page === 1 ? 'on' : ''} />
      </div>
    </div>
  );
}
