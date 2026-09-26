import { useEffect, useRef, useState } from 'react';
import { HUE_STEPS, isAppearance, type Appearance, type ThemeCode } from '../../api/contract.ts';
import type { Account } from '../account/useAccount.ts';

/**
 * 畫面的外觀：佈景主題，以及每一套各自轉到第幾格色相。
 *
 * **點一個還沒選的主題是換主題；點已經選著的那一套是色相轉一格**（60°），轉滿
 * 六格回到原色。每一套各自記住自己轉到哪（見 contract.ts 的 `Appearance`）。
 *
 * 色相轉的是**整個畫面**：`<html>` 掛 `hue-rotate`，骰子、logo、紅綠語意色都一起轉。
 * 掛在根元素上不會讓 `position:fixed` 的記分板與動作區改認它當定位基準——規格
 * 對根元素另有例外。下載的生涯成績圖讀 `--hue` 自己轉一次（canvas 不吃 CSS 濾鏡）。
 */

export const DEFAULT_APPEARANCE: Appearance = { theme: 'a', hues: { a: 0, b: 0, c: 0, d: 0 } };

/** 點了主題鈕之後的外觀。 */
export function pickTheme(current: Appearance, code: ThemeCode): Appearance {
  if (current.theme !== code) return { ...current, theme: code };
  return { ...current, hues: { ...current.hues, [code]: (current.hues[code] + 1) % HUE_STEPS } };
}

/** 目前這一套轉了幾度。 */
export function hueDegrees(a: Appearance): number {
  return (a.hues[a.theme] * 360) / HUE_STEPS;
}

const STORAGE_KEY = 'yakyulife:appearance';

/**
 * 這台裝置上記的那一份。**讀不到就是預設值**——私密視窗、被清掉的網站資料、被擋
 * 的 storage 都可能讓存取直接拋錯，外觀不該因此讓開局畫面掛掉。
 */
function loadLocal(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return isAppearance(parsed) ? parsed : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function saveLocal(a: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    // 存不下來只是下次要重選，不是錯誤。
  }
}

/**
 * 外觀的狀態與同步。
 *
 * - **未登入**：記在這台裝置上。
 * - **登入**：帳號上的為準。帳號還沒設定過（`appearance === null`）就把裝置上的
 *   寫上去——第一次登入不會把玩家已經選好的顏色洗掉。
 * - 之後每次改動：裝置與帳號都寫一份。帳號寫不進去只記一行警告，畫面照樣換色。
 */
export function useAppearance(account: Account): {
  readonly appearance: Appearance;
  readonly pick: (code: ThemeCode) => void;
} {
  const [appearance, setAppearance] = useState<Appearance>(loadLocal);
  /** 已經和哪個帳號對過一次帳。換帳號（登出再登入別人）要重新對。 */
  const synced = useRef<string | null>(null);
  const progress = account.progress;
  const me = progress.kind === 'signed-in' ? progress.me : null;

  useEffect(() => {
    if (me === null) {
      synced.current = null;
      return;
    }
    if (synced.current === me.account) return;
    synced.current = me.account;
    if (me.appearance !== null) {
      setAppearance(me.appearance);
      saveLocal(me.appearance);
    } else {
      push(account, appearance);
    }
    // 只在「登入的是誰」改變時對帳；appearance 之後的變化由 pick 自己同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.account]);

  // 套到畫面上。色相是 0 時整個拿掉濾鏡，不要讓每一頁都多一層合成。
  useEffect(() => {
    document.body.dataset['theme'] = appearance.theme;
    const deg = hueDegrees(appearance);
    const root = document.documentElement.style;
    root.setProperty('--hue', `${deg}deg`);
    root.filter = deg === 0 ? '' : `hue-rotate(${deg}deg)`;
  }, [appearance]);

  const pick = (code: ThemeCode) => {
    const next = pickTheme(appearance, code);
    setAppearance(next);
    saveLocal(next);
    if (me !== null) push(account, next);
  };

  return { appearance, pick };
}

function push(account: Account, a: Appearance): void {
  void account.store
    .setAppearance(a)
    .then((me) => account.update(me))
    .catch((e: unknown) => console.warn('[appearance] 外觀沒有存到帳號上', e));
}
