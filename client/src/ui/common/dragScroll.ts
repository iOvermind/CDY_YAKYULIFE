/**
 * 一排固定四格、多的左右拖曳的按鈕列（`.seg-scroll`）用的拖曳捲動。
 *
 * 天梯的篩選與成就頁的分頁共用這一份——同一種列長成同一個樣子、同一種手感。
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * 滑鼠按住拖曳來橫向捲動。觸控是原生捲動，不必處理。
 *
 * **點擊必須照樣有效**：移動超過 4px 才算拖曳，而且不抓指標（setPointerCapture）
 * ——抓了的話 click 會落在容器上而不是按鈕上，整排就只剩拖得動、點不下去。拖過
 * 的那一次 click 由呼叫端用 `wasDrag()` 丟掉。
 */
export function useDragScroll() {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragged = useRef(false);

  /**
   * 按下之後**在整個視窗上**聽移動與放開：只要滑鼠沒放就一直拖得動，拖出那一排也
   * 不會斷。以前掛在那一排自己身上，指標一離開那一排（onPointerLeave）就結束拖曳。
   * 仍然不抓指標——抓了的話 click 會落在容器上，按鈕就點不下去了。
   */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (e.pointerType !== 'mouse' || el === null) return;
    dragged.current = false;
    const from = { x: e.clientX, left: el.scrollLeft };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - from.x;
      if (Math.abs(dx) > 4) dragged.current = true;
      if (dragged.current) el.scrollLeft = from.left - dx;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  return {
    ref,
    /**
     * 這一次 click 是不是拖出來的。**讀一次就清掉**——不清的話旗標會留到下一次，
     * 用鍵盤 Enter 按按鈕不經過 pointerdown，那一次就會被上一次的拖曳吃掉。
     */
    wasDrag: () => {
      const was = dragged.current;
      dragged.current = false;
      return was;
    },
    handlers: { onPointerDown },
  };
}
