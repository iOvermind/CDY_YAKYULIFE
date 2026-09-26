import './ui/global.css';
import { useEffect, useRef, useState } from 'react';
import { httpProgress } from './api/http.ts';
import { Game } from './engine/game.ts';
import { useAccount } from './ui/account/useAccount.ts';
import { GameScreen } from './ui/game/GameScreen.tsx';
import { StartScreen } from './ui/start/StartScreen.tsx';

/**
 * 介面層。
 *
 * 引擎不知道 React 的存在——依賴方向是單向的（見 DEVELOPER.md §5）。介面只做
 * 三件事：收集開局設定、把 flow.log 畫出來、把玩家點的選項餵回 flow.choose()。
 * 這一層只在開局畫面與遊戲畫面之間切換；各畫面在 `ui/` 底下，依畫面分資料夾。
 *
 * 樣式：主題 token 與引擎詞彙在 `ui/global.css`，其餘是各元件旁邊的 CSS Module。
 * 版型比照原版。介面規格見 INTERFACE.md。
 */
export default function App() {
  const [theme, setTheme] = useState('a');
  const [game, setGame] = useState<Game | null>(null);
  // Game 是可變物件，React 不會察覺內部變化，因此用一個計數器手動觸發重繪。
  const [, bump] = useState(0);
  const account = useAccount(httpProgress);
  /** 這一局在伺服器上的登記編號。未登入時是 null，那一局不入帳。 */
  const careerId = useRef<string | null>(null);
  /** 已經送出結算的局，避免重繪時重送。 */
  const reported = useRef<Game | null>(null);

  useEffect(() => {
    document.body.dataset['theme'] = theme;
  }, [theme]);

  /**
   * 引退時把重播日誌送回伺服器。
   *
   * **伺服器用同一份引擎重跑，自己算 AP**；這裡送上去的成就只是拿來比對的
   * （見 ADR 0007）。因此送不出去也不擋畫面——玩家已經看完結算了，重試或放棄
   * 都是背景的事。
   */
  useEffect(() => {
    const id = careerId.current;
    if (game === null || id === null) return;
    if (game.summary === null || reported.current === game) return;
    reported.current = game;
    void account.store
      .finishCareer(id, {
        log: game.toReplayLog(),
        claimed: (game.achievements?.list ?? []).map((a) => a.id),
      })
      .then(() => account.store.me())
      .then((me) => {
        if (me !== null) account.update(me);
      })
      .catch((e: unknown) => console.warn('[career] 結算沒有送出', e));
  });

  if (game === null) {
    return (
      <StartScreen
        theme={theme}
        onTheme={setTheme}
        account={account}
        onStart={(g, ticket) => {
          careerId.current = ticket;
          setGame(g);
        }}
      />
    );
  }

  return (
    <GameScreen
      game={game}
      onChoose={(id) => {
        game.choose(id);
        bump((n) => n + 1);
      }}
      onRestart={() => {
        // 天賦覆蓋是全域可變狀態，不還原的話下一局會疊上這一局的加成。
        game.dispose();
        careerId.current = null;
        setGame(null);
      }}
    />
  );
}
