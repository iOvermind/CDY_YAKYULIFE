import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * 一行放不下就縮字級，絕不換行。
 *
 * 給的是「值」那一行（`<b>`）：CSS 沒有依內容自動縮字的機制，而這裡真正要
 * 守的是**方格的高度**——四等分的固定寬度配上二刀流的兩個數字，換行會把整排
 * 方格頂高一截，全版面跟著跳。
 *
 * 縮法是量完之後按比例調一次，不是逐級試：`scrollWidth / clientWidth` 就是超出
 * 的倍率，字級照這個比例乘回去即可，省掉迴圈。下限 9px 是可讀性的底線，真的
 * 撐不下就讓它溢出（`overflow:hidden` 會裁掉）——那是資料異常，不是排版問題。
 */
export function FitValue({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  const fit = (): void => {
    const el = ref.current;
    if (el === null) return;
    // 先還原成 CSS 的字級再量：留著上一次縮過的值會讓它只縮不放，視窗變寬或
    // 數字變短之後就回不來了。
    el.style.fontSize = '';
    const base = Number.parseFloat(getComputedStyle(el).fontSize);
    const room = el.clientWidth;
    const need = el.scrollWidth;
    if (room > 0 && need > room && Number.isFinite(base)) {
      el.style.fontSize = `${Math.max(9, Math.floor(base * (room / need) * 10) / 10)}px`;
    }
  };

  // 內容變了要重量（每次 render），版面寬度變了也要——後者不會觸發 render，
  // 所以另外盯著父格。只在**寬度**變的時候重量：縮完字級之後高度會跟著變，
  // 拿高度當條件會自己餵自己，變成觀察迴圈。
  useLayoutEffect(fit);
  useEffect(() => {
    const cell = ref.current?.parentElement;
    if (cell === undefined || cell === null) return;
    let last = cell.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const next = entry.contentRect.width;
      if (next === last) return;
      last = next;
      fit();
    });
    observer.observe(cell);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <b ref={ref} className="fit-value">
      {children}
    </b>
  );
}
