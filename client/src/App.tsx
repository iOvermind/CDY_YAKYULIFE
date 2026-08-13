import { useEffect, useRef, useState } from 'react';
import './app.css';
import {
  abilities,
  amateur,
  traits as traitsData,
  traitOf,
  START_POSITION_ROWS,
  type Hand,
  type StartPosition,
} from './data/index.ts';
import { schoolTiersOf, stageOf } from './engine/amateur.ts';
import type { LogEntry, Option, Prompt } from './engine/flow.ts';
import {
  bbPerNine,
  kPerNine,
  ops,
  whip,
  type BattingLine,
  type PitchingLine,
} from './engine/amateurStats.ts';
import { fmtAvg, Game, TWO_WAY_REFERENCE_LEVEL, type PlayerState } from './engine/game.ts';
import { abilityCost, growthCurve } from './engine/growth.ts';
import {
  amateurBaseline,
  battingWinShares,
  eraPlus,
  opsPlus,
  pitchingWinShares,
  proBaseline,
  type Baseline,
} from './engine/metrics.ts';
import { fieldingPosition, isSideVisible, type Rating } from './engine/rating.ts';
import { positionName } from './engine/season.ts';
import { newSeed } from './engine/rng.ts';

/**
 * 量出元素目前的像素寬度，並在尺寸變動時跟著更新。
 *
 * 天賦上限的標記線需要它。標記線用百分比定位會落在小數像素上，瀏覽器把
 * 2px 的墨水抹在三欄上（例如 0.6／1／0.4），每欄的不透明度都被稀釋——同一
 * 條線因此有時紮實、有時糊成一片，看起來就是有粗有細。只有先知道實際像素
 * 寬度，才能把位置取整到整數像素。
 *
 * CSS 這邊無解：round() 不接受把百分比與 px 混在一起，因為百分比要等版面
 * 算完才知道解析成多少。
 */
function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
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
          <em>棒球人生模擬器</em>
        </h1>
        <p className="sub">國中、高中六年養成 → 選秀・旅外 → 國際賽 → 衰退與引退。每一顆骰子都算數。</p>

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
          {/* 三列：投捕與不定、內野、外野。每列都是四格的網格，不足四個就空著
              ——按鈕寬度因此與「打擊慣用手」那幾組完全一致，整個開局畫面看起來
              才是同一套元件。 */}
          <div className="poslist">
            {START_POSITION_ROWS.map((row, i) => (
              <div key={i} className="seg">
                {row.map((p) => (
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
            ))}
          </div>
        </div>

        <div className="field">
          <label>投球慣用手</label>
          <div className="seg">
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
          <div className="seg">
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
          {/* 起點的學年與季節都從資料來——寫死會像先前那樣，養成期擴成六年之後
              按鈕還停在「高一春天」。 */}
          開始生涯 ▸ {stageOf('JHS').year_labels[0]}{amateur.career_start.season}
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
/**
 * alloc: 底下的控制項，不是能力。
 *
 * 它們與能力共用前綴是刻意的——同一個配點階段的選項應該長得一樣，重播日誌
 * 看起來才是連貫的一串。但介面上它們是動作鈕，不是能力列。
 */
const ALLOC_CONTROLS = new Set(['alloc:undo', 'alloc:confirm']);

function allocOptions(prompt: Prompt | null): Map<string, Option> {
  const map = new Map<string, Option>();
  if (prompt === null) return map;
  for (const o of prompt.options) {
    if (o.id.startsWith('alloc:') && !ALLOC_CONTROLS.has(o.id)) {
      map.set(o.id.slice('alloc:'.length), o);
    }
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
  // 加點時，能力選項已經在左欄的能力列上；動作區留下其餘的。
  const otherOptions = (prompt?.options ?? []).filter((o) => !o.id.startsWith('alloc:'));
  // 復原與確認獨立一排並列——它們是一組動作（退一步／往前走），拆成上下兩顆
  // 全寬按鈕會讓人以為是兩個不相干的選項。
  const controlOptions = (prompt?.options ?? []).filter((o) => ALLOC_CONTROLS.has(o.id));

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
                  disabled={o.disabled === true}
                  onClick={() => onChoose(o.id)}
                >
                  {o.label}
                  {o.note !== undefined && <small>{o.note}</small>}
                </button>
              ))}
              {controlOptions.length > 0 && (
                <div className="row2">
                  {controlOptions.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`btn${o.role === 'main' ? ' main' : ''}${
                        o.role === 'warn' ? ' warn' : ''
                      }`}
                      disabled={o.disabled === true}
                      onClick={() => onChoose(o.id)}
                    >
                      {o.label}
                      {o.note !== undefined && <small>{o.note}</small>}
                    </button>
                  ))}
                </div>
              )}
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
  // 進職業之後 stage 仍停在 HS、stageYear 繼續累加，直接沿用會顯示「高中4」。
  // 職業改用體系名加年資，與養成期的「國中1」是同一種寫法。
  const yearLabel =
    state.pro === null
      ? (def.year_labels[state.stageYear - 1] ?? `${def.name}${state.stageYear}`)
      : `${state.pro.orgName}${state.pro.year}`;


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
          <span>{state.pro === null ? '學年' : '職涯'}</span>
        </div>
        <div className="stat-cell">
          <b>{state.pool}</b>
          <span>可分配點</span>
        </div>
        {state.lockedSide !== 'fielder' && (
          <div className="stat-cell">
            <b>{rating?.pitcher ?? 0}</b>
            <span>投手側</span>
          </div>
        )}
        {state.lockedSide !== 'pitcher' && (
          <div className="stat-cell">
            <b>{rating?.fielder ?? 0}</b>
            <span>野手側</span>
          </div>
        )}
      </div>

      {/* 只留最近打完的那一季。標題不寫「當年」——季初訓練時這裡放的還是去年
          的成績，寫當年是騙人的。生涯累計與榮譽都移到結算時才呈現，右欄留給
          玩家當下真正在看的東西。 */}
      <StatLines
        label="最近一季"
        batting={state.seasonBatting}
        pitching={state.seasonPitching}
        base={state.pro === null ? amateurBaseline() : proBaseline(state.pro.level)}
      />

      <TraitList traits={state.traits} />
    </div>
  );
}

/**
 * 目前的狀態：已取得的隱藏特性。
 *
 * 正向在前、負向在後，同一組內依 traits.json 的宣告順序——那個順序就是設計
 * 上的重要性排序。名稱要靠生涯內容組出來的特性（如「◯◯先生」）目前無法解析，
 * 直接跳過而不是顯示 id：顯示一個看不懂的英文代號比不顯示更糟。
 */
function TraitList({ traits: owned }: { traits: ReadonlySet<string> }) {
  const order = [...traitsData.categories.positive, ...traitsData.categories.negative];
  const shown = order
    .filter((id) => owned.has(id))
    .map((id) => traitOf(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined && t.name !== null);

  return (
    <>
      <h4 style={{ marginTop: 12 }}>狀態</h4>
      {shown.length === 0 ? (
        <p className="stat-pending" style={{ marginTop: 8 }}>
          還沒有任何特性。
        </p>
      ) : (
        <p style={{ fontSize: 12, lineHeight: 2.1, margin: '8px 0 0' }}>
          {shown.map((t) => (
            <span
              className="tag"
              key={t.id}
              title={t.effect_text}
              style={{ marginRight: 4, ...(t.tone === 'bad' ? BAD_TAG : {}) }}
            >
              {t.name}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/** 負向特性的標籤配色。取自 traits.json 的 tag_styles.negative。 */
const BAD_TAG = { background: '#2a0f0f', borderColor: '#c0392b', color: '#ff8b7a' };

/** 打擊與投球成績。養成期的成績依大賽場次結算，場次由名次決定。 */
/**
 * 標準打擊列與投球列。
 *
 * 欄位表寫成資料，兩張表就不必各自維護一份 thead 與 tbody——欄位增減只要改
 * 一個地方，而且順序一定對得上。表頭用縮寫（棒球記錄的通用寫法），滑鼠停留
 * 顯示中文全名。
 */
interface StatColumn<T> {
  readonly key: string;
  readonly title: string;
  readonly value: (line: T, base: Baseline) => string | number;
}

/** 相對聯盟平均的指標統一這樣顯示：沒有樣本就畫破折號，不畫 0。 */
const rel = (v: number | null) => (v === null ? '—' : v);

const BATTING_COLUMNS: readonly StatColumn<BattingLine>[] = [
  { key: 'G', title: '出賽', value: (b) => b.games },
  { key: 'PA', title: '打席', value: (b) => b.pa },
  { key: 'AB', title: '打數', value: (b) => b.ab },
  { key: 'R', title: '得分', value: (b) => b.runs },
  { key: 'H', title: '安打', value: (b) => b.hits },
  { key: '2B', title: '二壘打', value: (b) => b.double },
  { key: '3B', title: '三壘打', value: (b) => b.triple },
  { key: 'HR', title: '全壘打', value: (b) => b.hr },
  { key: 'RBI', title: '打點', value: (b) => b.rbi },
  { key: 'BB', title: '四壞', value: (b) => b.bb },
  { key: 'IBB', title: '故意四壞', value: (b) => b.ibb },
  { key: 'SO', title: '三振', value: (b) => b.so },
  { key: 'SB', title: '盜壘', value: (b) => b.sb },
  { key: 'CS', title: '盜壘刺', value: (b) => b.cs },
  { key: 'AVG', title: '打擊率', value: (b) => fmtAvg(b.avg) },
  { key: 'OBP', title: '上壘率', value: (b) => fmtAvg(b.obp) },
  { key: 'SLG', title: '長打率', value: (b) => fmtAvg(b.slg) },
  { key: 'OPS', title: '整體攻擊指數', value: (b) => fmtAvg(ops(b)) },
  { key: 'OPS+', title: '相對聯盟平均的攻擊表現（100 為聯盟平均）', value: (b, base) => rel(opsPlus(b, base)) },
  { key: 'WS', title: 'Win Shares：勝利貢獻', value: (b, base) => battingWinShares(b, base).toFixed(1) },
];

const PITCHING_COLUMNS: readonly StatColumn<PitchingLine>[] = [
  { key: 'G', title: '出賽', value: (p) => p.games },
  { key: 'GS', title: '先發', value: (p) => p.starts },
  { key: 'W', title: '勝', value: (p) => p.wins },
  { key: 'L', title: '敗', value: (p) => p.losses },
  { key: 'SV', title: '救援成功', value: (p) => p.saves },
  { key: 'IP', title: '投球局數', value: (p) => p.ip.toFixed(1) },
  { key: 'H', title: '被安打', value: (p) => p.hits },
  { key: 'R', title: '失分', value: (p) => p.runs },
  { key: 'ER', title: '自責分', value: (p) => p.er },
  { key: 'BB', title: '四壞', value: (p) => p.bb },
  { key: 'SO', title: '奪三振', value: (p) => p.so },
  { key: 'ERA', title: '防禦率', value: (p) => p.era.toFixed(2) },
  { key: 'WHIP', title: '每局被上壘率', value: (p) => whip(p).toFixed(2) },
  { key: 'K/9', title: '每九局奪三振', value: (p) => kPerNine(p).toFixed(1) },
  { key: 'BB/9', title: '每九局四壞', value: (p) => bbPerNine(p).toFixed(1) },
  { key: 'ERA+', title: '相對聯盟平均的防禦率（100 為聯盟平均）', value: (p, base) => rel(eraPlus(p, base)) },
  { key: 'WS', title: 'Win Shares：勝利貢獻', value: (p, base) => pitchingWinShares(p, base).toFixed(1) },
];

function StatLines({
  label,
  batting,
  pitching,
  base,
}: {
  label: string | null;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
  /** 聯盟平均。ERA+／OPS+／WS 都要跟它比。 */
  base: Baseline;
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
        <div className="fin-scroll">
          <table className="fin">
            <thead>
              <tr>
                {PITCHING_COLUMNS.map((c) => (
                  <th key={c.key} title={c.title}>
                    {c.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {PITCHING_COLUMNS.map((c) => (
                  <td key={c.key}>{c.value(pitching, base)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {batting !== null && (
        <div className="fin-scroll">
          <table className="fin">
            <thead>
              <tr>
                {BATTING_COLUMNS.map((c) => (
                  <th key={c.key} title={c.title}>
                    {c.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {BATTING_COLUMNS.map((c) => (
                  <td key={c.key}>{c.value(batting, base)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
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
  // 所屬單位一律讀目前的狀態：升學會換學校、選秀會換成球隊。讀 origin 那一份
  // 會永遠停在開局的國中，讀 state.school 則會在進職業之後停在高中。
  const tierLabel = schoolTiersOf(state.stage)?.tiers[String(state.schoolTier)]?.label ?? '';
  const affiliation =
    state.pro === null
      ? { name: state.school, note: tierLabel }
      : { name: state.pro.team, note: state.pro.levelName };

  // 取得二刀流之後，起始守位就不再說明他是什麼球員了——他是投手也是打者。
  // 野手側的守位由守備能力決定：守得動就站守位，守不動就是 DH，這也是多數
  // 投手出身的二刀流的歸宿。
  const roleLabel = state.traits.has('two_way')
    ? `二刀流·投手＋${positionName(fieldingPosition(state.ability, TWO_WAY_REFERENCE_LEVEL))}`
    : abilities.start_positions[player.startPosition];
  return (
    <div id="board">
      <h4 className="board-title">球員</h4>
      <div id="bd-top">
        <span id="bd-name">
          {player.name}
          <small>
            {roleLabel}·投{hand(player.throws)}打{hand(player.bats)}
          </small>
        </span>
        <span id="bd-team">
          {/* 奪冠機率放在隊名上方自成一行。它講的是球隊的處境，不是球員的
              頭銜——擠在隊名後面會跟層級混成一串讀不出重點。 */}
          {state.pro !== null && (
            <small className="odds">
              奪冠 {Math.round(state.pro.championshipOdds * 100)}%
            </small>
          )}
          {affiliation.name}
          {affiliation.note !== '' && (
            <small style={{ opacity: 0.75 }}>·{affiliation.note}</small>
          )}
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

  // 定位鎖定之後整組收起來，不是變灰。留著一組永遠動不了的數字只會佔版面，
  // 也會讓玩家一直以為還有機會補回來。
  const show = (side: 'pitcher' | 'fielder') =>
    isSideVisible(groups[side][0] ?? '', state.lockedSide);

  return (
    <>
      <AbilityBlock title={names.shared} keys={groups.shared} {...common} />
      {show('pitcher') && (
        <AbilityBlock title={names.pitcher} keys={groups.pitcher} {...common} />
      )}
      {show('fielder') && (
        <AbilityBlock title={names.fielder} keys={groups.fielder} {...common} />
      )}
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

  const [barRef, barWidth] = useElementWidth<HTMLSpanElement>();
  const markerStyle =
    barWidth > 0
      ? { left: `${Math.round((pct(ceiling) / 100) * barWidth)}px` }
      : { left: `${pct(ceiling)}%` };

  const row = (
    <>
      <span className="nm">{abilities.abilities[abilityKey] ?? abilityKey}</span>
      <span className="bar" ref={barRef}>
        <i style={{ width: `${pct(current)}%` }} />
        {/* 位置取整到整數像素，否則 2px 的線會被抹在三欄上，看起來忽粗忽細。
            還沒量到寬度時先退回百分比——第一幀糊一下，好過整條線不見。 */}
        <em style={markerStyle} />
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
