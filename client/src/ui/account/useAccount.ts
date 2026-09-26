/**
 * 帳號的連線狀態與那一個 hook。
 *
 * 從 `Account.tsx` 拆出來的理由是 **React Fast Refresh**：一個模組同時 export
 * hook 與元件的話，Vite 的 react plugin 認不得它是不是元件模組，只能整包
 * invalidate 往上冒（`hmr invalidate /src/Account.tsx`）。冒到沒有人接的那一
 * 層就是整頁重載——開發時打到一半的一局會被丟掉，而且丟得沒有痕跡。
 *
 * 規則：**元件放 .tsx，hook 與型別放這裡。**
 */

import { useCallback, useEffect, useState } from 'react';
import { isOffline, type Me, type ProgressStore } from '../../api/contract.ts';
import { GATE_TIMEOUT_MS } from '../../api/gate.ts';

/** 帳號的連線狀態。 */
export type Progress =
  | { readonly kind: 'loading' }
  /** 連不上伺服器——這個部署沒有帳號功能，不是玩家沒登入。 */
  | { readonly kind: 'offline' }
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'signed-in'; readonly me: Me };

export interface Account {
  readonly progress: Progress;
  readonly store: ProgressStore;
  /** 伺服器回了新的 `Me` 時把它裝回去。 */
  readonly update: (me: Me) => void;
  readonly signOut: () => Promise<void>;
}

/** 開機時問一次「我是誰」，之後由各個動作把新的 `Me` 裝回來。 */
export function useAccount(store: ProgressStore): Account {
  const [progress, setProgress] = useState<Progress>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    // 讀取中時開始按鈕是反灰的——已登入的人在帳號回來前開局，會帶不到天賦
    // （issue #59）。API 卡住的話先當成離線放行，但**不中斷請求**：晚到的
    // 回應照樣裝回來，還在開始畫面的人就帶得到天賦。
    const giveUp = setTimeout(() => {
      if (alive) setProgress((p) => (p.kind === 'loading' ? { kind: 'offline' } : p));
    }, GATE_TIMEOUT_MS);
    void store
      .me()
      .then((me) => {
        if (!alive) return;
        setProgress(me === null ? { kind: 'anonymous' } : { kind: 'signed-in', me });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // 連不上不是錯誤，是另一種正常的部署方式。其他錯誤也只能當成連不上——
        // 開局畫面不該因為問了一句「我是誰」就整個掛掉。
        if (!isOffline(e)) console.warn('[account]', e);
        setProgress({ kind: 'offline' });
      })
      .finally(() => clearTimeout(giveUp));
    return () => {
      alive = false;
      clearTimeout(giveUp);
    };
  }, [store]);

  const update = useCallback((me: Me) => setProgress({ kind: 'signed-in', me }), []);
  const signOut = useCallback(async () => {
    await store.logout().catch(() => undefined);
    setProgress({ kind: 'anonymous' });
  }, [store]);

  return { progress, store, update, signOut };
}
