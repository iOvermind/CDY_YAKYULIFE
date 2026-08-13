import { useEffect, useRef, useState } from 'react';
import './app.css';
import { abilities, START_POSITIONS, type Hand, type StartPosition } from './data/index.ts';
import { schoolTiersOf, stageOf } from './engine/amateur.ts';
import type { LogEntry, Option, Prompt } from './engine/flow.ts';
import type { BattingLine, PitchingLine } from './engine/amateurStats.ts';
import { fmtAvg, Game, type PlayerState } from './engine/game.ts';
import { abilityCost, growthCurve } from './engine/growth.ts';
import type { Rating } from './engine/rating.ts';
import { newSeed } from './engine/rng.ts';

/**
 * 介面層。
 *
 * 引擎不知道 React 的存在——依賴方向是單向的（見 DEVELOPER.md §5）。這裡只做
 * 三件事：收集開局設定、把 flow.log 畫出來、把玩家點的選項餵回 flow.choose()。
 *
 * 樣式在 app.css，版型比照原版。介面規格見 INTERFACE.md。
 */

/** 生涯數據的分段顯示順序。職業生涯尚未實作，先留位置。 */
const STAGE_ORDER: readonly (readonly [string, string])[] = [
  ['JHS', '國中生涯'],
  ['HS', '高中生涯'],
  ['PRO', '職業生涯'],
];

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
  const [throws, setThrows] = useState<Hand>('R');
  const [bats, setBats] = useState<Hand>('R');
  const [seed, setSeed] = useState(newSeed());

  const begin = () =>
    onStart(
      new Game({ seed, name: name.trim() || '無名氏', startPosition, throws, bats }).start(),
    );

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
          <label>投球慣用手</label>
          <div className="seg two">
            {abilities.handedness.selectable.throws.map((h) => (
              <button
                key={h}
                type="button"
                className={h === throws ? 'on' : undefined}
                onClick={() => setThrows(h)}
              >
                {HAND_LABEL[h]}投
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>打擊慣用手</label>
          <div className="seg">
            {abilities.handedness.selectable.bats.map((h) => (
              <button
                key={h}
                type="button"
                className={h === bats ? 'on' : undefined}
                onClick={() => setBats(h)}
              >
                {HAND_LABEL[h]}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 6, lineHeight: 1.6 }}>
            左投與左打在棒球裡有結構性優勢，因此天賦上限會相應降低。
            <b style={{ color: 'var(--bad)' }}>
              注意：那份優勢（同邊／反邊對決）尚未接上賽季模擬，目前選左手只有扣分。
            </b>
          </p>
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

/** 目前的提問是不是在要求分配點數到某項能力。 */
function allocOptions(prompt: Prompt | null): Map<string, Option> {
  const map = new Map<string, Option>();
  if (prompt === null) return map;
  for (const o of prompt.options) {
    if (o.id.startsWith('alloc:')) map.set(o.id.slice('alloc:'.length), o);
  }
  return map;
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
  const prompt = game.flow.prompt;
  const allocatable = allocOptions(prompt);
  // 加點時，選項已經在左欄的能力列上，動作區只留下非能力的選項（例如「先留著」）
  const otherOptions = (prompt?.options ?? []).filter((o) => !o.id.startsWith('alloc:'));

  return (
    <div id="game">
      <div id="col-left">
        {state && (
          <Board state={state} rating={game.rating?.overall ?? 0} seed={game.setup.seed} />
        )}
        {state && (
          <div id="panel-abilities">
            <h4>能力</h4>
            <AbilityPanel state={state} allocatable={allocatable} onChoose={onChoose} />
          </div>
        )}
      </div>

      <div id="col-right">
        {state && <StatsPanel state={state} rating={game.rating} />}
        <EventLog entries={game.flow.log} />
        <div id="panel-act">
          {prompt !== null ? (
            <>
              {prompt.title !== undefined && <div className="title">{prompt.title}</div>}
              {game.dice !== null && <DiceRow dice={game.dice} />}
              {state !== null && state.pool > 0 && allocatable.size > 0 && game.dice === null && (
                <div className="pool">大賽點數還有 {state.pool} 點（點一下能力 +1）</div>
              )}
              {allocatable.size > 0 && (
                <div className="title" style={{ color: 'var(--accent)', letterSpacing: 0 }}>
                  ← 點左側的能力列加點
                </div>
              )}
              {otherOptions.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`btn${o.role === 'main' ? ' main' : ''}${
                    o.role === 'warn' ? ' warn' : ''
                  }`}
                  onClick={() => onChoose(o.id)}
                >
                  {o.label}
                  {o.note !== undefined && <small>{o.note}</small>}
                </button>
              ))}
            </>
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
  );
}

/**
 * 事件紀錄。新卡片出現時自動捲到底。
 *
 * 只在使用者原本就貼著底部時才自動捲——如果他正往回翻舊紀錄，把畫面拉走是
 * 很煩人的事。門檻抓 40px，容許一點捲動慣性造成的誤差。
 */
function EventLog({ entries }: { entries: readonly LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el === null || !stuckToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div
      id="panel-log"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      <LogView entries={entries} />
    </div>
  );
}

/**
 * 這一季擲出的訓練骰。
 *
 * 已分配的變暗、目前這一顆高亮——玩家看得到「還剩哪幾顆、現在要分配的是幾點」，
 * 而不是只讀到一行文字。6 點用不同顏色標示，那是高標值。
 */
function DiceRow({ dice }: { dice: { values: readonly number[]; index: number } }) {
  return (
    <div id="dice">
      {dice.values.map((v, i) => (
        <div
          key={i}
          className={`die${i < dice.index ? ' used' : ''}${i === dice.index ? ' active' : ''}${
            v === 6 ? ' six' : ''
          }`}
        >
          {v}
        </div>
      ))}
    </div>
  );
}

/** 當年數據與生涯數據。 */
function StatsPanel({ state, rating }: { state: PlayerState; rating: Rating | null }) {
  const def = stageOf(state.stage);
  const yearLabel = def.year_labels[state.stageYear - 1] ?? `${def.name}${state.stageYear}`;

  return (
    <div id="panel-stats">
      <h4>當年數據</h4>
      <div className="stat-grid">
        <div className="stat-cell">
          <b>{state.year}</b>
          <span>年份</span>
        </div>
        <div className="stat-cell">
          <b>{state.age}</b>
          <span>年齡</span>
        </div>
        <div className="stat-cell">
          <b>{yearLabel}</b>
          <span>學年</span>
        </div>
        <div className="stat-cell">
          <b>{state.pool}</b>
          <span>可分配點</span>
        </div>
        <div className="stat-cell">
          <b>{rating?.pitcher ?? 0}</b>
          <span>投手側</span>
        </div>
        <div className="stat-cell">
          <b>{rating?.fielder ?? 0}</b>
          <span>野手側</span>
        </div>
      </div>

      <StatLines
        label="當年成績"
        batting={state.seasonBatting}
        pitching={state.seasonPitching}
      />

      <h4 style={{ marginTop: 12 }}>生涯數據</h4>
      {STAGE_ORDER.map(([code, name]) => {
        const line = state.statsByStage[code];
        if (line === undefined) return null;
        return (
          <div key={code}>
            <p className="divider" style={{ margin: '8px 0 2px' }}>
              {name}
            </p>
            <StatLines label={null} batting={line.batting} pitching={line.pitching} />
          </div>
        );
      })}
      {Object.keys(state.statsByStage).length === 0 && (
        <p className="stat-pending" style={{ marginTop: 8 }}>
          還沒有成績。
        </p>
      )}

      {state.honors.length > 0 ? (
        <p style={{ fontSize: 12, lineHeight: 1.9, margin: '8px 0 0' }}>
          {state.honors.map((h, i) => (
            <span className="tag" key={i} style={{ marginRight: 4 }}>
              {h}
            </span>
          ))}
        </p>
      ) : (
        <p className="stat-pending" style={{ marginTop: 8 }}>
          還沒有任何榮譽。
        </p>
      )}
    </div>
  );
}

/** 打擊與投球成績。養成期的成績依大賽場次結算，場次由名次決定。 */
function StatLines({
  label,
  batting,
  pitching,
}: {
  label: string | null;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
}) {
  if (batting === null && pitching === null) {
    return (
      <p className="stat-pending" style={{ marginTop: 8 }}>
        {label === null ? '還沒有成績。' : `${label}：還沒打過大賽。`}
      </p>
    );
  }

  return (
    <>
      {label !== null && <h4 style={{ marginTop: 12 }}>{label}</h4>}
      {pitching !== null && (
        <table className="fin">
          <thead>
            <tr>
              <th>G</th>
              <th>IP</th>
              <th>SO</th>
              <th>BB</th>
              <th>ERA</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{pitching.games}</td>
              <td>{pitching.ip.toFixed(1)}</td>
              <td>{pitching.so}</td>
              <td>{pitching.bb}</td>
              <td>{pitching.era.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {batting !== null && (
        <table className="fin">
          <thead>
            <tr>
              <th>G</th>
              <th>AB</th>
              <th>H</th>
              <th>HR</th>
              <th>RBI</th>
              <th>SB</th>
              <th>AVG</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{batting.games}</td>
              <td>{batting.ab}</td>
              <td>{batting.hits}</td>
              <td>{batting.hr}</td>
              <td>{batting.rbi}</td>
              <td>{batting.sb}</td>
              <td>{fmtAvg(batting.avg)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </>
  );
}

function Board({
  state,
  rating,
  seed,
}: {
  state: PlayerState;
  rating: number;
  seed: string;
}) {
  const player = state.origin;
  // 學校與強度都讀目前的狀態——升學會換學校，讀開局的那一份會永遠停在國中。
  const tierLabel = schoolTiersOf(state.stage)?.tiers[String(state.schoolTier)]?.label ?? '';
  return (
    <div id="board">
      <h4 className="board-title">球員</h4>
      <div id="bd-top">
        <span id="bd-name">
          {player.name}
          <small>
            {abilities.start_positions[player.startPosition]}·投
            {hand(player.throws)}打{hand(player.bats)}
          </small>
        </span>
        <span id="bd-team">
          {state.school}
          {tierLabel !== '' && <small style={{ opacity: 0.75 }}>·{tierLabel}</small>}
        </span>
      </div>
      <div id="bd-grid">
        <div className="bd-cell">
          <b>{state.year}</b>
          <span>年份</span>
        </div>
        <div className="bd-cell">
          <b>{state.age}</b>
          <span>年齡</span>
        </div>
        <div className="bd-cell">
          <b>{rating}</b>
          <span>綜合</span>
        </div>
        <div className="bd-cell">
          <b>{state.pool}</b>
          <span>可分配點</span>
        </div>
      </div>
      <div id="lamps">
        <span className="lamp on">
          <i />
          SEED {seed}
        </span>
        {state.honors.length > 0 && (
          <span className="lamp on">
            <i />
            榮譽 {state.honors.length}
          </span>
        )}
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

function AbilityPanel({
  state,
  allocatable,
  onChoose,
}: {
  state: PlayerState;
  allocatable: Map<string, Option>;
  onChoose: (optionId: string) => void;
}) {
  const groups = abilities.ability_groups;
  const names = abilities.ability_group_names;
  const common = { state, allocatable, onChoose };

  return (
    <>
      <AbilityBlock title={names.shared} keys={groups.shared} {...common} />
      <AbilityBlock title={names.pitcher} keys={groups.pitcher} {...common} />
      <AbilityBlock title={names.fielder} keys={groups.fielder} {...common} />
    </>
  );
}

function AbilityBlock({
  title,
  keys,
  state,
  allocatable,
  onChoose,
}: {
  title: string;
  keys: readonly string[];
  state: PlayerState;
  allocatable: Map<string, Option>;
  onChoose: (optionId: string) => void;
}) {
  return (
    <>
      <p className="divider">{title}</p>
      {keys.map((key) => (
        <AbilityRow
          key={key}
          abilityKey={key}
          state={state}
          option={allocatable.get(key)}
          onChoose={onChoose}
        />
      ))}
    </>
  );
}

function AbilityRow({
  abilityKey,
  state,
  option,
  onChoose,
}: {
  abilityKey: string;
  state: PlayerState;
  option: Option | undefined;
  onChoose: (optionId: string) => void;
}) {
  const current = state.ability[abilityKey] ?? 0;
  const potential = state.origin.potential[abilityKey] ?? 0;
  const carry = state.carry[abilityKey] ?? 0;
  const bonus = state.ceilingBonus[abilityKey] ?? 0;
  // 與舊版一致的表達方式：蓄力／這一級所需點數，例如 0/2。成本 1 點時不顯示。
  const cost = abilityCost(current, potential + bonus, growthCurve(state.traits.has('two_way')));

  // 量表刻度：頭 20 尾 80。只有被事件提升過上限的能力，尾端才會延伸到 80 以上。
  const head = abilities.scale.min;
  const tail = abilities.scale.max + bonus;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - head) / (tail - head)) * 100));

  const allocating = option !== undefined;
  const ceiling = potential + bonus;

  const row = (
    <>
      <span className="nm">{abilities.abilities[abilityKey] ?? abilityKey}</span>
      <span className="bar">
        <i style={{ width: `${pct(current)}%` }} />
        <em style={{ left: `${pct(ceiling)}%` }} />
      </span>
      <span className="val" style={{ lineHeight: 1.1 }}>
        {current}
        <small style={{ opacity: 0.5 }}>/{ceiling}</small>
        {cost > 1 && (
          <span
            style={{ display: 'block', opacity: 0.5, fontSize: 10.5, letterSpacing: 1, marginTop: -2 }}
          >
            {carry}/{cost}
          </span>
        )}
      </span>
    </>
  );

  if (!allocating) {
    return (
      <div className="abrow" title={`${head}–${tail}${bonus > 0 ? `（上限已提升 +${bonus}）` : ''}`}>
        {row}
      </div>
    );
  }

  return (
    <div
      className="abrow pickable"
      role="button"
      tabIndex={0}
      title={option.note}
      onClick={() => onChoose(option.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChoose(option.id);
        }
      }}
    >
      {row}
    </div>
  );
}

const HAND_LABEL: Record<string, string> = { R: '右', L: '左', S: '左右開弓' };

function hand(h: string): string {
  return h === 'S' ? '雙' : h === 'L' ? '左' : '右';
}
