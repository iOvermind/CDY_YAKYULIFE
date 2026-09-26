import { useEffect, useRef, useState } from 'react';

/**
 * 量出元素目前的像素寬度，並在尺寸變動時跟著更新。
 *
 * 潛力的標記線需要它。標記線用百分比定位會落在小數像素上，瀏覽器把
 * 2px 的墨水抹在三欄上（例如 0.6／1／0.4），每欄的不透明度都被稀釋——同一
 * 條線因此有時紮實、有時糊成一片，看起來就是有粗有細。只有先知道實際像素
 * 寬度，才能把位置取整到整數像素。
 *
 * CSS 這邊無解：round() 不接受把百分比與 px 混在一起，因為百分比要等版面
 * 算完才知道解析成多少。
 */
export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
