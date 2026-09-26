import { useState } from 'react';
import { Game } from '../../engine/game.ts';
import { careerCardOf } from './careerCard.ts';
import { saveCareerCard } from './careerImage.ts';

/**
 * 「下載生涯成績」。
 *
 * 圖是**按下去才畫的**，不預先產：一段長生涯的年表有兩張大表，畫一次要量上千次
 * 文字寬度，而多數人按完「重新開局」就走了。
 *
 * 三種狀態要分得出來：畫圖那一兩秒按鈕要說自己在忙（否則玩家會連按），失敗要
 * 講出原因（手機的分享面板可能被系統擋掉），成功則什麼都不必說——系統的分享
 * 面板或瀏覽器的下載提示自己會出現。
 */
export function SaveCardButton({ game }: { game: Game }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <button
      type="button"
      className="btn main"
      disabled={busy}
      onClick={() => {
        const card = careerCardOf(game);
        if (card === null) return;
        setBusy(true);
        setFailed(null);
        saveCareerCard(card)
          .catch((e: unknown) => {
            console.warn('[card] 生涯成績圖沒有存成', e);
            setFailed(e instanceof Error ? e.message : '存不下來');
          })
          .finally(() => setBusy(false));
      }}
    >
      {busy ? '產生中…' : '下載生涯成績'}
      {failed !== null && <small>{failed}</small>}
    </button>
  );
}
