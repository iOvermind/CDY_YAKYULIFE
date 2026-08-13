import { useEffect, useState } from 'react';
import './app.css';
import { abilities, START_POSITIONS, type StartPosition } from './data/index.ts';
import type { LogEntry, Prompt } from './engine/flow.ts';
import { Game, type PlayerState } from './engine/game.ts';
import { newSeed } from './engine/rng.ts';

/**
 * 介面層。
 *
 * 引擎不知道 React 的存在——依賴方向是單向的（見 DEVELOPER.md §5）。這裡只做
 * 三件事：收集開局設定、把 flow.log 畫出來、把玩家點的選項餵回 flow.choose()。
 *
 * 樣式在 app.css，版型比照原版。介面規格見 INTERFACE.md。
 */

const THEMES = [
  { code: 'a', name: '科技藍' },
  { code: 'b', name: '電子看板' },
  { code: 'c', name: '報紙版面' },
  { code: 'd', name: '現代儀表板' },
] as const;

export default function App() {
  const [theme, setTheme] = useState('a');
  const [game, setGame] = useState<Game | null>(null);
  // Game 是可變物件，React 不會察覺內部變化，因此用一個計數器手動觸發重繪。
  const [, bump] = useState(0);

  useEffect(() => {
    document.body.dataset['theme'] = theme;
  }, [theme]);

  if (game === null) {
    return <StartScreen theme={theme} onTheme={setTheme} onStart={setGame} />;
  }

  return (
    <GameScreen
      game={game}
      onChoose={(id) => {
        game.choose(id);
        bump((n) => n + 1);
      }}
      onRestart={() => setGame(null)}
    />
  );
}

function StartScreen({
  theme,
  onTheme,
  onStart,
}: {
  theme: string;
  onTheme: (t: string) => void;
  onStart: (g: Game) => void;
}) {
  const [name, setName] = useState('');
  const [startPosition, setStartPosition] = useState<StartPosition>('P');
  const [seed, setSeed] = useState(newSeed());

  const begin = () =>
    onStart(new Game({ seed, name: name.trim() || '無名氏', startPosition }).start());

  return (
    <div id="start">
      <div className="wrap">
        <h1>
          YaKyoLife
          <br />
          <em>棒球人生模擬器</em>
        </h1>
        <p className="sub">高中三年養成 → 選秀・旅日・旅美 → 國際賽 → 衰退與引退。每一顆骰子都算數。</p>

        <div className="field">
          <label htmlFor="in-name">球員姓名</label>
          <input
            id="in-name"
            maxLength={10}
            placeholder="例如：林家正"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <label>起始守位</label>
          <div className="seg two">
            {START_POSITIONS.map((p) => (
              <button
                key={p}
                type="button"
                className={p === startPosition ? 'on' : undefined}
                onClick={() => setStartPosition(p)}
              >
                {abilities.start_positions[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>佈景主題</label>
          <div className="seg two">
            {THEMES.map((t) => (
              <button
                key={t.code}
                type="button"
                className={t.code === theme ? 'on' : undefined}
                onClick={() => onTheme(t.code)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="btn main" style={{ marginTop: 28 }} onClick={begin}>
          開始生涯 ▸ 高一春天
        </button>

        <p className="seedline">
          世界種子{' '}
          <input
            id="seed-show"
            maxLength={24}
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
          />{' '}
          ·{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setSeed(newSeed());
            }}
          >
            換一個
          </a>
          <br />
          相同種子＋相同選擇＝相同人生（可直接輸入朋友的種子碼）
        </p>
      </div>
    </div>
  );
}

function GameScreen({
  game,
  onChoose,
  onRestart,
}: {
  game: Game;
  onChoose: (optionId: string) => void;
  onRestart: () => void;
}) {
  const state = game.state;

  return (
    <div id="app">
      <div id="mid">
        {state && <Board state={state} seed={game.setup.seed} />}
        <div id="log">
          <LogView entries={game.flow.log} />
          {state && <AbilityCard state={state} />}
        </div>
      </div>
      <div id="act-side">
        <div id="act-in">
          <div id="act">
            {game.flow.prompt ? (
              <PromptView prompt={game.flow.prompt} onChoose={onChoose} />
            ) : (
              <>
                <div className="title">流程已到目前實作的盡頭</div>
                <button type="button" className="btn main" onClick={onRestart}>
                  重新開局
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Board({ state, seed }: { state: PlayerState; seed: string }) {
  const player = state.origin;
  return (
    <div id="board">
      <div id="bd-top">
        <span id="bd-name">
          {player.name}
          <small>
            {abilities.start_positions[player.startPosition]}·投
            {hand(player.throws)}打{hand(player.bats)}
          </small>
        </span>
        <span id="bd-team">{player.school}</span>
      </div>
      <div id="bd-grid">
        <div className="bd-cell">
          <b>{player.year}</b>
          <span>年份</span>
        </div>
        <div className="bd-cell">
          <b>{player.age}</b>
          <span>年齡</span>
        </div>
        <div className="bd-cell">
          <b>{overall(state)}</b>
          <span>綜合</span>
        </div>
        <div className="bd-cell">
          <b style={{ fontSize: 12 }}>{seed}</b>
          <span>種子</span>
        </div>
      </div>
    </div>
  );
}

function LogView({ entries }: { entries: readonly LogEntry[] }) {
  // divider 開啟新的年度區塊，後續卡片都掛在它底下，與原版的摺疊結構一致。
  const blocks: { head: string | null; cards: LogEntry[] }[] = [];
  for (const entry of entries) {
    if (entry.kind === 'divider') blocks.push({ head: entry.text, cards: [] });
    else {
      const last = blocks[blocks.length - 1];
      if (last) last.cards.push(entry);
      else blocks.push({ head: null, cards: [entry] });
    }
  }

  return (
    <>
      {blocks.map((block, i) => (
        <div className="yr-block" key={i}>
          {block.head !== null && <div className="yr-head has-body">{block.head}</div>}
          <div className="yr-body">
            {block.cards.map((entry, j) =>
              entry.kind === 'card' ? (
                <div className={`card ${entry.tone}`} key={j}>
                  {entry.title !== undefined && <h4>{entry.title}</h4>}
                  <p dangerouslySetInnerHTML={{ __html: entry.body }} />
                </div>
              ) : null,
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function PromptView({
  prompt,
  onChoose,
}: {
  prompt: Prompt;
  onChoose: (optionId: string) => void;
}) {
  return (
    <>
      {prompt.title !== undefined && <div className="title">{prompt.title}</div>}
      {prompt.options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`btn${o.role === 'main' ? ' main' : ''}${o.role === 'warn' ? ' warn' : ''}`}
          onClick={() => onChoose(o.id)}
        >
          {o.label}
          {o.note !== undefined && <small>{o.note}</small>}
        </button>
      ))}
    </>
  );
}

function AbilityCard({ state }: { state: PlayerState }) {
  const groups = abilities.ability_groups;
  const names = abilities.ability_group_names;

  return (
    <div className="card">
      <h4>能力</h4>
      <AbilityBlock title={names.shared} keys={groups.shared} state={state} />
      <AbilityBlock title={names.pitcher} keys={groups.pitcher} state={state} />
      <AbilityBlock title={names.fielder} keys={groups.fielder} state={state} />
    </div>
  );
}

function AbilityBlock({
  title,
  keys,
  state,
}: {
  title: string;
  keys: readonly string[];
  state: PlayerState;
}) {
  const max = abilities.scale.max;

  return (
    <>
      <p className="divider">{title}</p>
      {keys.map((key) => {
        const current = state.ability[key] ?? 0;
        const ceiling = state.origin.potential[key] ?? 0;
        const carry = state.carry[key] ?? 0;
        return (
          <div className="abrow" key={key}>
            <span className="nm">{abilities.abilities[key] ?? key}</span>
            <span className="bar">
              <i style={{ width: `${(current / max) * 100}%` }} />
              <em style={{ left: `${(ceiling / max) * 100}%` }} />
            </span>
            <span className="val" style={{ lineHeight: 1.1 }}>
              {current}
              <small style={{ opacity: 0.5 }}>/{ceiling}</small>
              {carry > 0 && (
                <span
                  style={{
                    display: 'block',
                    opacity: 0.5,
                    fontSize: 10.5,
                    letterSpacing: 1,
                    marginTop: -2,
                  }}
                >
                  蓄力 {carry}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}

function hand(h: string): string {
  return h === 'S' ? '雙' : h === 'L' ? '左' : '右';
}

/** 綜合能力：所有能力的平均，四捨五入。之後會由引擎提供，這裡只是暫時的顯示值。 */
function overall(state: PlayerState): number {
  const values = Object.values(state.ability);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
