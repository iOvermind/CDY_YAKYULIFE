import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './app.css';
import { AccountBar, useAccount, type Account } from './Account.tsx';
import { httpProgress } from './api/http.ts';
import {
  abilities,
  amateur,
  leagues,
  traits as traitsData,
  traitOf,
  START_POSITION_ROWS,
  type Hand,
  type StartPosition,
} from './data/index.ts';
import { schoolTiersOf, stageOf } from './engine/amateur.ts';
import type { Finale, LogEntry, Option, Prompt } from './engine/flow.ts';
import {
  bbPerNine,
  fmtInnings,
  kPerNine,
  ops,
  whip,
  type BattingLine,
  type PitchingLine,
} from './engine/amateurStats.ts';
import type { AwardRecord } from './engine/awards.ts';
import type { CareerSummary, SeasonRecord } from './engine/career.ts';
import {
  fmtAvg,
  Game,
  NO_PROGRESS,
  type CareerProgress,
  type PlayerState,
} from './engine/game.ts';
import { abilityCost, carryGauge, growthCurve } from './engine/growth.ts';
import {
  amateurBaseline,
  battingShares,
  eraPlus,
  opsPlus,
  pitchingShares,
  proBaseline,
  winPct,
  type Baseline,
} from './engine/metrics.ts';
import { joinName } from './engine/naming.ts';
import { blockedByHand, isSideVisible, type Rating } from './engine/rating.ts';
import { fmtMoneyShort } from './engine/salary.ts';
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
function FitValue({ children }: { children: React.ReactNode }) {
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

function StartScreen({
  theme,
  onTheme,
  onStart,
  account,
}: {
  theme: string;
  onTheme: (t: string) => void;
  onStart: (g: Game, careerId: string | null) => void;
  account: Account;
}) {
  const [name, setName] = useState('');
  const [startPosition, setStartPosition] = useState<StartPosition>('P');
  const [throws, setThrows] = useState<Hand>('R');
  const [bats, setBats] = useState<Hand>('R');
  const [seed, setSeed] = useState(newSeed());
  const [starting, setStarting] = useState(false);

  /**
   * 左投封死的守位（二、三、游）。兩個方向都要反灰：選了左投就不能選這三個位置，
   * 已經選了這三個位置也不能改成左投——否則玩家會從一個合法組合走到一個非法組合。
   *
   * 規則本身在引擎（`blockedByHand`），這裡只是同一條規則的提前顯示。開局畫面
   * 自己讀一次設定檔的話，引擎那邊的移防掃描就會變成另一份實作。
   */
  const posBlocked = (p: StartPosition) => blockedByHand(throws, p);
  const leftThrowBlocked = blockedByHand('L', startPosition);

  /**
   * 開局。
   *
   * 登入時**先向伺服器登記**，拿回它凍結的那一組天賦——天賦可以退款，「玩家現在
   * 擁有什麼」與「這一局帶著什麼」是兩件事，而驗證時算數的是伺服器凍結的那一組
   * （見 ADR 0007）。
   *
   * 登記失敗就照樣開局，只是這一局不入帳。**不能因為伺服器打嗝就不讓人玩**。
   */
  const begin = () => {
    if (starting) return;
    setStarting(true);
    const setup = { seed, name: name.trim() || '無名氏', startPosition, throws, bats };
    const signedIn = account.progress.kind === 'signed-in';
    const ticket = signedIn
      ? account.store.startCareer().catch((e: unknown) => {
          console.warn('[career] 開局登記失敗，這一局不入帳', e);
          return null;
        })
      : Promise.resolve(null);

    void ticket.then((t) => {
      const me = account.progress.kind === 'signed-in' ? account.progress.me : null;
      const progress: CareerProgress =
        me === null
          ? NO_PROGRESS
          : {
              firstCareer: me.achievements.length === 0,
              unlocked: new Set(me.achievements.map((a) => a.id)),
            };
      const game = new Game({ ...setup, talents: t?.talents ?? {} }, progress).start();
      onStart(game, t?.careerId ?? null);
    });
  };

  return (
    <div id="start">
      <AccountBar account={account} />
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
                    disabled={posBlocked(p)}
                    title={posBlocked(p) ? '左投守不了這個位置' : undefined}
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
                disabled={h === 'L' && leftThrowBlocked}
                title={
                  h === 'L' && leftThrowBlocked
                    ? `${abilities.start_positions[startPosition]}不能由左投擔任`
                    : undefined
                }
                onClick={() => setThrows(h)}
              >
                {HAND_LABEL[h]}投
              </button>
            ))}
          </div>
          {(leftThrowBlocked || throws === 'L') && (
            <p style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 6, lineHeight: 1.6 }}>
              左投守不了二壘、三壘、游擊——接球後往一壘的傳球得多轉半圈，職業層級不可能。
            </p>
          )}
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

        <button
          type="button"
          className="btn main"
          style={{ marginTop: 28 }}
          disabled={starting}
          onClick={begin}
        >
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
          <Board state={state} rating={game.rating} seed={game.setup.seed} />
        )}
        {state && (
          <div id="panel-abilities">
            <h4>能力</h4>
            <AbilityPanel
              state={state}
              allocatable={allocatable}
              repeatable={game.dice === null}
              onChoose={onChoose}
            />
          </div>
        )}
      </div>

      <div id="col-right">
        {/* 生涯結束後整塊拿掉：狀態、生涯年表、榮譽都改由事件流末端的結算卡呈現。 */}
        {state && game.summary === null && <StatsPanel state={state} />}
        <EventLog entries={game.flow.log} state={state} summary={game.summary} />
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
              <div className="title">{game.summary === null ? '流程已到目前實作的盡頭' : '生涯結束'}</div>
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
/**
 * 事件流。新內容出現時自動捲到底，除非玩家自己往上捲去看舊的。
 *
 * 三件事必須一起做，少一件就會出現「有時候沒捲到底」：
 *
 * 1. **useLayoutEffect 而不是 useEffect**——要在瀏覽器繪製之前捲，否則會先
 *    閃一下舊位置。
 * 2. **監看容器與內容的尺寸變化**。這一欄是彈性版面：下方的動作區在選項出現
 *    或消失時會變高變矮，容器的可視高度跟著變，而那**不會觸發捲動事件**——
 *    只靠 onScroll 維護「是否貼底」就會漏掉這一種，畫面於是停在半空中。
 * 3. **捲到 scrollHeight − clientHeight**，不是 scrollHeight。瀏覽器雖然會
 *    夾住，但明確寫出來才不會在計算貼底距離時差一個 clientHeight。
 */
function EventLog({
  entries,
  state,
  summary,
}: {
  entries: readonly LogEntry[];
  state: PlayerState | null;
  summary: CareerSummary | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);
  /**
   * 版面變動引發的捲動事件要略過。
   *
   * **這是「事件卡有時不會捲到底」的真正原因。** 抽到事件卡時下方動作區長出
   * 三個選項，事件流被壓矮——瀏覽器會為此送出一個捲動事件，而那一瞬間
   * `scrollHeight − scrollTop − clientHeight` 因為 clientHeight 剛變小而超過
   * 門檻，「貼底」旗標於是被關掉，接下來的 pin() 就什麼都不做了。
   *
   * 旗標只該由**玩家自己的捲動**改變，不該由版面改變。
   */
  const ignoreScroll = useRef(false);

  /**
   * 開一個「接下來的捲動事件都不算數」的窗口，到下一幀為止。
   *
   * **必須是窗口，不能是用完就清的一次性旗標。** 版面一縮，瀏覽器會先把
   * scrollTop 夾回合法範圍（第一個事件），我們接著又指定新的 scrollTop
   * （第二個事件）——一次性旗標只擋得住第一個，第二個就被當成「玩家自己往上
   * 捲了」，貼底旗標於是被關掉。這就是「有時候」不捲的那個有時候。
   */
  const muteScroll = () => {
    ignoreScroll.current = true;
    requestAnimationFrame(() => {
      ignoreScroll.current = false;
    });
  };

  const pin = () => {
    const el = ref.current;
    if (el === null || !stuckToBottom.current) return;
    muteScroll();
    el.scrollTop = el.scrollHeight - el.clientHeight;
  };

  useLayoutEffect(pin, [entries.length]);

  useEffect(() => {
    const el = ref.current;
    const inner = innerRef.current;
    if (el === null || inner === null) return;
    const observer = new ResizeObserver(() => {
      muteScroll();
      pin();
    });
    observer.observe(el);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      id="panel-log"
      ref={ref}
      onScroll={(e) => {
        // 窗口內一律不理，也不清掉窗口——一次尺寸變動可能連送好幾個事件。
        if (ignoreScroll.current) return;
        const el = e.currentTarget;
        stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      <div ref={innerRef}>
        <LogView entries={entries} state={state} summary={summary} />
      </div>
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

/** 最近一季的成績與狀態。只在生涯進行中出現。 */
function StatsPanel({ state }: { state: PlayerState }) {
  return (
    <div id="panel-stats">
      {/* 面板不帶自己的標題：底下兩塊各自有 `<h4>`（最近一季／狀態），再加一個
          面板級標題就是兩個同級標題連在一起、中間沒有內容。右欄因此是兩個平級
          區塊。 */}
      {/* 這裡不再放方格。

          年份、年齡、綜合、可分配點左側記分板都有；年薪、合約、生涯收入已經併
          進記分板底下那一行。聯盟水準整格刪掉——升降級卡片現在一律報「綜合 X／
          門檻 Y」（ADR 0029），而下放的門檻用的是基準值不是浮動值，一個常駐的
          浮動 par 解釋不了任何一次判定，只會讓玩家拿它去對一條不存在的線。

          動機是手機：右欄在窄螢幕上要一路捲到底才看得到成績表，方格佔掉的正是
          最上面那一屏。 */}

      {/* 只留最近打完的那一季。標題不寫「當年」——季初訓練時這裡放的還是去年的
          成績，寫當年是騙人的。 */}
      <StatLines
        label="最近一季"
        batting={state.seasonBatting}
        pitching={state.seasonPitching}
        base={state.pro === null ? amateurBaseline() : proBaseline(state.pro.level)}
        defenseRuns={state.pro === null ? null : state.seasonDefenseRuns}
      />
      <TraitList traits={state.traits} names={state.traitNames} />
    </div>
  );
}

/**
 * 榮譽榜。**只在生涯結束後出現，而且含養成期。**
 *
 * 生涯進行中，左側記分板的「榮譽 N」那盞燈就夠了——那時玩家關心的是「我拿過
 * 幾項」，攤開一整面清單只會把版面吃掉。結算之後相反：那串東西就是他的生涯
 * 軌跡，該攤開來看。
 *
 * 三塊分開排，因為來源不同：
 *
 * - **職業獎項**冠上聯盟名並列出年份——「中職年度MVP」與「日職年度MVP」是
 *   兩件事，拆開才看得出一個旅外球員在哪裡拿的獎。
 * - **里程碑**是累積出來的，不是誰投票給你的，用不同的框線區隔。
 * - **養成期與國際賽**的榮譽沒有結構化紀錄，只有字串，因此照原樣列。
 */
function HonorBoard({
  awards,
  honors,
  summary,
  love,
}: {
  awards: readonly AwardRecord[];
  honors: readonly string[];
  summary: CareerSummary | null;
  love: PlayerState['love'];
}) {
  if (summary === null) return null;

  const milestones = [
    // 聯盟名與數字之間要留空白——「中職1000 安打」的中職與 1000 會黏成一團。
    ...summary.leagues.flatMap((l) => l.milestones.map((m) => `${l.orgName} ${m}`)),
    // 跨聯盟通算的那幾條也要冠上出處。同一排裡「大聯盟 2000 安打」旁邊擺一個
    // 沒有前綴的「3000 安打」，看起來像是漏字，而不是另一種計算方式。
    ...summary.careerMilestones.map((m) => `生涯 ${m}`),
  ];

  const tally = new Map<string, { label: string; years: number[] }>();
  for (const a of awards) {
    const league = leagues.top_league_names[a.org] ?? a.org;
    const key = `${a.org}:${a.code}`;
    const hit = tally.get(key);
    if (hit === undefined) tally.set(key, { label: joinName(league, a.name), years: [a.year] });
    else hit.years.push(a.year);
  }
  const shown = [...tally.values()].sort((a, b) => b.years.length - a.years.length);

  // 職業獎項已經由上面那份結構化紀錄列出來了，這裡只留養成期與國際賽的。
  const proLabels = new Set(shown.map((a) => a.label));
  const rest = sortHonors(honors.filter((h) => !proLabels.has(h)));

  if (shown.length === 0 && milestones.length === 0 && rest.length === 0) return null;

  // 四種不同的東西，各給一行小標。標籤的形狀（虛線／點線／顏色）本來就在分類，
  // 但那要先看得懂編碼才讀得出來；標題是直接寫出來的那一份。空的組不出現。
  const groups = [
    {
      caption: '獎項',
      tone: 'tag',
      items: shown.map((a) => `${a.label}（${[...a.years].sort((x, y) => x - y).join('、')}）`),
    },
    { caption: '里程碑', tone: 'tag milestone', items: milestones },
    { caption: '業餘與國際賽', tone: 'tag amateur', items: rest },
    // 【人生】不是獎項，但它是這個人的生涯的一部分——一個拿過五座 MVP 卻離了
    // 三次婚的人，與一個拿五座 MVP 且孩子坐滿看台的人，不是同一個故事。
    { caption: '人生', tone: 'tag life', items: lifeTags(love) },
  ].filter((g) => g.items.length > 0);

  return (
    <div id="panel-honors">
      <h4>榮譽</h4>
      {groups.map((g) => (
        <div className="tag-group" key={g.caption}>
          <div className="fin-caption">{g.caption}</div>
          <div className="tag-row">
            {g.items.map((t) => (
              <span className={g.tone} key={t}>
                {t}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TraitList({
  traits: owned,
  names,
}: {
  traits: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
}) {
  // 點開的那一個。一次只有一個：說明行固定在段落下方，多開就再也分不出哪行在
  // 講哪個標籤（標籤會換行，順序對不上），單開才不必在說明裡重複一次名稱。
  const [picked, setPicked] = useState<string | null>(null);
  const order = [...traitsData.categories.positive, ...traitsData.categories.negative];
  // 名稱以取得當下解析的為準；沒有動態名稱的就用資料檔的固定名。這裡曾經
  // 把 name 為 null 的整個濾掉，於是三個動態命名的特性拿得到卻永遠看不到。
  const shown = order
    .filter((id) => owned.has(id))
    .map((id) => traitOf(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ ...t, label: names.get(t.id) ?? t.name ?? t.id }));
  // 從當下的清單找，而不是記住點下去的那段文字：特性可以在生涯中途消失（受傷
  // 洗掉、負向被覆蓋），留著舊說明會變成一行沒有標籤對應的孤兒。
  const note = shown.find((t) => t.id === picked)?.effect_text ?? null;

  return (
    <>
      {/* 間距交給 CSS：在右欄它接在成績表下面要空一段，在結算卡裡它是卡片的
          第一行，帶著 12px 會多出一截頭。 */}
      <h4 className="tl-head">狀態</h4>
      {shown.length === 0 ? (
        <p className="stat-pending" style={{ marginTop: 8 }}>
          還沒有任何特性。
        </p>
      ) : (
        <>
          <p style={{ fontSize: 12, lineHeight: 2.1, margin: '8px 0 0' }}>
            {shown.map((t) => (
              // title 留著：桌面想一次掃過五六個特性時，懸停比逐個點快，內容與
              // 下面那行同源。點擊是給觸控用的第二條路——原生 title 在手機上
              // 永遠不會出現，而負向特性的說明是玩家判斷要不要留它的依據。
              <span
                className={`tag pick${picked === t.id ? ' on' : ''}`}
                key={t.id}
                title={t.effect_text}
                onClick={() => setPicked((p) => (p === t.id ? null : t.id))}
                style={{ marginRight: 4, ...(t.tone === 'bad' ? BAD_TAG : {}) }}
              >
                {t.label}
              </span>
            ))}
          </p>
          {/* 說明不做浮層：這塊在 #panel-stats 裡，那是個 overflow-y:auto 的捲動
              容器，浮層要嘛被裁掉、要嘛得改用 fixed 自己算座標並在捲動時重算。
              就地展開沒有這些問題，而 effect_text 最長也才 39 字。 */}
          <p className={`tag-note${note === null ? ' hint' : ''}`}>
            {note ?? '點特性看說明'}
          </p>
        </>
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
  { key: 'WS', title: '勝利份額：這一季替球隊贏下幾份勝利', value: (b, base) => battingShares(b, base).win.toFixed(1) },
  { key: 'LS', title: '敗戰份額：佔用了出場機會卻沒換回勝利的部分', value: (b, base) => battingShares(b, base).loss.toFixed(1) },
  { key: 'W%', title: '勝率：勝利份額佔責任額的比例，.500 為聯盟平均', value: (b, base) => fmtAvg(winPct(battingShares(b, base))) },
];

const PITCHING_COLUMNS: readonly StatColumn<PitchingLine>[] = [
  { key: 'G', title: '出賽', value: (p) => p.games },
  { key: 'GS', title: '先發', value: (p) => p.starts },
  { key: 'W', title: '勝', value: (p) => p.wins },
  { key: 'L', title: '敗', value: (p) => p.losses },
  { key: 'SV', title: '救援成功', value: (p) => p.saves },
  { key: 'HLD', title: '中繼成功', value: (p) => p.holds },
  { key: 'IP', title: '投球局數（小數點後是出局數，.1 為一人出局）', value: (p) => fmtInnings(p.outs) },
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
  { key: 'WS', title: '勝利份額：這一季替球隊贏下幾份勝利', value: (p, base) => pitchingShares(p, base).win.toFixed(1) },
  { key: 'LS', title: '敗戰份額：佔用了投球局數卻沒換回勝利的部分', value: (p, base) => pitchingShares(p, base).loss.toFixed(1) },
  { key: 'W%', title: '勝率：勝利份額佔責任額的比例，.500 為聯盟平均', value: (p, base) => fmtAvg(winPct(pitchingShares(p, base))) },
];

/** 一列通算成績。第一欄是列名（聯盟或「通算」），其餘欄位與生涯年表一致。 */
interface TotalRow {
  readonly label: string;
  readonly seasons: number;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  readonly defenseRuns: number;
  readonly base: Baseline;
}

/**
 * 年表用的層級簡稱。
 *
 * 「中職二軍」在球隊名旁邊只需要寫「二軍」——聯盟名已經由球隊說完了，
 * 「桃園金剛・中職二軍」裡的「中職」是贅字。小聯盟的 1A／3A 本來就沒有
 * 冠聯盟名，原樣留著。
 *
 * **剪完是空字串就不剪。** 美職體系的前綴是「大聯盟」，而它最高一層的名字剛好
 * 就是「大聯盟」——照剪會剩下一個空格，年表上變成「洋基・」。層級名等於前綴時
 * 那個名字本身就是要顯示的東西。
 */
function shortLevelName(levelName: string, org: string): string {
  const prefix = leagues.top_league_names[org] ?? leagues.org_names[org] ?? '';
  if (prefix === '' || !levelName.startsWith(prefix)) return levelName;
  const rest = levelName.slice(prefix.length);
  return rest === '' ? levelName : rest;
}

/** 結算時的【人生】標籤。婚姻、孩子與離婚各記一筆。 */
function lifeTags(love: PlayerState['love']): string[] {
  const out: string[] = [];
  if (love.status === 'married' && love.partner !== null) {
    out.push(love.marriedYear === null ? `與${love.partner}結婚` : `與${love.partner}結婚（${love.marriedYear}）`);
  }
  if (love.kids > 0) out.push(`${love.kids} 個孩子`);
  if (love.divorces > 0) out.push(`離婚 ${love.divorces} 次`);
  return out;
}

/** 生涯年表的一列。養成期與職業共用同一個形狀，年表才接得起來。 */
interface CareerRow {
  readonly key: string;
  readonly year: number;
  readonly age: number;
  /** 球隊或學校。 */
  readonly team: string;
  /** 層級或學制的補充說明；頂級聯盟不必寫。 */
  readonly note: string | null;
  readonly position: string | null;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  /** 這一年帶著什麼傷。養成期不追蹤傷病，一律 null。 */
  readonly injured: SeasonRecord['injured'];
  readonly defenseRuns: number;
  readonly base: Baseline;
}

/**
 * 成績表的資料列。
 *
 * 欄位定義直接沿用 `BATTING_COLUMNS` / `PITCHING_COLUMNS`——**同一份成績在
 * 年表與「最近一季」必須長得一樣**。各寫一份遲早會分岔，玩家會以為那是兩種
 * 不同的東西。
 */
function StatCells<T>({
  columns,
  line,
  base,
}: {
  columns: readonly StatColumn<T>[];
  line: T;
  base: Baseline;
}) {
  return (
    <>
      {columns.map((c) => (
        <td key={c.key}>{c.value(line, base)}</td>
      ))}
    </>
  );
}

function StatHeadCells<T>({ columns }: { columns: readonly StatColumn<T>[] }) {
  return (
    <>
      {columns.map((c) => (
        <th key={c.key} title={c.title}>
          {c.key}
        </th>
      ))}
    </>
  );
}

/**
 * 通算表。
 *
 * 與生涯年表分開是刻意的：年表回答「他哪一年打得怎麼樣」，通算回答「他這輩子
 * 累積了什麼」。兩者的閱讀方式不同，混在同一張表會兩邊都難讀。
 */
function TotalsTable({ title, rows }: { title: string; rows: readonly TotalRow[] }) {
  const batting = rows.filter((r) => r.batting !== null);
  const pitching = rows.filter((r) => r.pitching !== null);
  if (batting.length === 0 && pitching.length === 0) return null;

  return (
    <>
      <h4 style={{ marginTop: 14 }}>{title}</h4>
      {batting.length > 0 && (
        <div className="fin-scroll">
          <div className="fin-caption">野手</div>
          <table className="fin">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>聯盟</th>
                <th title="出賽季數">季</th>
                <StatHeadCells columns={BATTING_COLUMNS} />
                <th title="守備分">DEF</th>
              </tr>
            </thead>
            <tbody>
              {batting.map((r) => (
                <tr key={r.label}>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td>{r.seasons}</td>
                  <StatCells columns={BATTING_COLUMNS} line={r.batting!} base={r.base} />
                  <td>{r.defenseRuns > 0 ? `+${r.defenseRuns}` : r.defenseRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pitching.length > 0 && (
        <div className="fin-scroll">
          <div className="fin-caption">投手</div>
          <table className="fin">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>聯盟</th>
                <th title="出賽季數">季</th>
                <StatHeadCells columns={PITCHING_COLUMNS} />
              </tr>
            </thead>
            <tbody>
              {pitching.map((r) => (
                <tr key={r.label}>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td>{r.seasons}</td>
                  <StatCells columns={PITCHING_COLUMNS} line={r.pitching!} base={r.base} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * 生涯年表。
 *
 * **含國中與高中**——養成六年也是這段生涯的一部分。一段效力一列；目前一年
 * 就是一段，將來接上季中交易之後同一年會出現兩列，表格的形狀不必改。
 *
 * 投打分兩張表：單位不同，硬湊在同一列會讓兩邊的欄位都看不懂（見
 * `hall_of_fame.json` 的 `two_way`）。
 */
function CareerTable({ summary }: { summary: CareerSummary }) {
  const rows = careerRows(summary);
  if (rows.length === 0) return null;

  const batting = rows.filter((r) => r.batting !== null);
  const pitching = rows.filter((r) => r.pitching !== null);

  const headLead = (
    <>
      <th title="年度">年</th>
      <th title="年齡">齡</th>
      <th style={{ textAlign: 'left' }}>球隊</th>
    </>
  );
  // 傷過的年份整列標色，而不是加一欄「傷」——空白佔一整欄只為了標少數幾年，
  // 而且橫向已經很擠了。標色只回答「這一年他不是完整的」，細節在事件流裡。
  const rowClass = (r: CareerRow) => (r.injured === null ? undefined : `hurt hurt-${r.injured}`);
  // 季中轉隊的那一年會有兩列。年與齡只寫在第一列——同一年重覆印一次年份，
  // 讀起來像兩個球季，而球隊那一欄已經說清楚這是同一年的後半段了。
  const rowLead = (r: CareerRow, cont: boolean) => (
    <>
      <td>{cont ? '' : r.year}</td>
      <td>{cont ? '' : r.age}</td>
      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
        {r.team}
        {r.note !== null && <span className="sub">・{r.note}</span>}
      </td>
    </>
  );

  return (
    <div id="panel-career">
      <h4>生涯年表</h4>
      {batting.length > 0 && (
        <div className="fin-scroll">
          {/* 兩張表的欄位差很多，沒有小標的話捲到一半會分不出在看哪一側。 */}
          <div className="fin-caption">野手</div>
          <table className="fin">
            <thead>
              <tr>
                {headLead}
                <th title="登錄守位">守位</th>
                <StatHeadCells columns={BATTING_COLUMNS} />
                <th title="守備分">DEF</th>
              </tr>
            </thead>
            <tbody>
              {batting.map((r, i) => (
                <tr key={r.key} className={rowClass(r)}>
                  {rowLead(r, batting[i - 1]?.year === r.year)}
                  <td title={r.position === null ? undefined : positionName(r.position)}>
                    {r.position ?? '—'}
                  </td>
                  <StatCells columns={BATTING_COLUMNS} line={r.batting!} base={r.base} />
                  <td>{r.defenseRuns > 0 ? `+${r.defenseRuns}` : r.defenseRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pitching.length > 0 && (
        <div className="fin-scroll">
          <div className="fin-caption">投手</div>
          <table className="fin">
            <thead>
              <tr>
                {headLead}
                <StatHeadCells columns={PITCHING_COLUMNS} />
              </tr>
            </thead>
            <tbody>
              {pitching.map((r, i) => (
                <tr key={r.key} className={rowClass(r)}>
                  {rowLead(r, pitching[i - 1]?.year === r.year)}
                  <StatCells columns={PITCHING_COLUMNS} line={r.pitching!} base={r.base} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TotalsTable title="各聯盟通算" rows={leagueTotals(summary)} />
      {summary.leagues.length > 1 && (
        <TotalsTable title="頂級聯盟通算" rows={[topTotalRow(summary)]} />
      )}
    </div>
  );
}

/** 養成期與職業合成一份年表，依年度排序。 */
function careerRows(summary: CareerSummary): readonly CareerRow[] {
  const amateurRows: CareerRow[] = summary.amateurSeasons.map((a, i) => ({
    key: `am-${a.year}-${i}`,
    year: a.year,
    age: a.age,
    team: a.school,
    // 學制不寫——校名已經說了那是國中還是高中。
    note: null,
    position: a.position,
    batting: a.batting,
    pitching: a.pitching,
    injured: null,
    defenseRuns: 0,
    base: amateurBaseline(),
  }));

  const proRows: CareerRow[] = summary.seasons.map((s, i) => ({
    key: `pro-${s.year}-${s.level}-${i}`,
    year: s.year,
    age: s.age,
    team: s.team,
    // 頂級聯盟不必註明（那是預設），二軍與小聯盟則只寫層級——聯盟名已經
    // 由同一格的球隊名說完了，「桃園金剛・中職二軍」裡的「中職」是贅字。
    note: s.top === null ? shortLevelName(s.levelName, s.org) : null,
    position: s.position,
    batting: s.batting,
    pitching: s.pitching,
    injured: s.injured,
    defenseRuns: s.defenseRuns,
    base: proBaseline(s.level),
  }));

  return [...amateurRows, ...proRows].sort((a, b) => a.year - b.year);
}

/** 各頂級聯盟各一列。二軍不列——那不是這張表在回答的問題。 */
function leagueTotals(summary: CareerSummary): readonly TotalRow[] {
  return summary.leagues.map((l) => ({
    label: l.orgName,
    seasons: l.seasons,
    batting: l.batting,
    pitching: l.pitching,
    defenseRuns: l.defenseRuns,
    // 用結算給的頂級層級，**不要拿 org 拼字串**：墨聯的層級就叫 LMB、澳職叫
    // ABL、美職的頂級是 MLB，拼出來的 LMB1 不存在，讀它會直接拋錯——整個
    // 結算畫面因此變成一片空白。
    base: proBaseline(l.topLevel),
  }));
}

/** 所有頂級聯盟加起來的一列。只有跨過聯盟的人才需要它——單一聯盟的話它等於上一張表。 */
function topTotalRow(summary: CareerSummary): TotalRow {
  return {
    label: '通算',
    seasons: summary.leagues.reduce((n, l) => n + l.seasons, 0),
    batting: summary.topTotal.batting,
    pitching: summary.topTotal.pitching,
    defenseRuns: summary.leagues.reduce((n, l) => n + l.defenseRuns, 0),
    // 通算橫跨數個聯盟，基準線只能挑一個——取評價分最高的那座，那是這段生涯
    // 的代表舞台。沒有職業紀錄時退回中職一軍。
    base: proBaseline(summary.leagues[0]?.topLevel ?? 'CPBL1'),
  };
}

function StatLines({
  label,
  batting,
  pitching,
  base,
  defenseRuns,
}: {
  label: string | null;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
  /** 聯盟平均。ERA+／OPS+／WS 都要跟它比。 */
  base: Baseline;
  /** 這一季的守備分。守備沒有別的欄位，因此掛在野手那張表的最後一欄。 */
  defenseRuns?: number | null;
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
      {/* 間距一律交給 CSS：這個標題現在是面板的第一行（面板自己的標題拿掉了），
          帶著行內 margin 會在 padding 之上再多一截頭。 */}
      {label !== null && <h4 className="tl-head">{label}</h4>}
      {pitching !== null && (
        <div className="fin-scroll">
          {/* 二刀流會同時出現兩張表，沒有小標就分不出哪張是哪張。 */}
          <div className="fin-caption">投手</div>
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
          <div className="fin-caption">野手</div>
          <table className="fin">
            <thead>
              <tr>
                {BATTING_COLUMNS.map((c) => (
                  <th key={c.key} title={c.title}>
                    {c.key}
                  </th>
                ))}
                {defenseRuns != null && <th title="守備分">DEF</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                {BATTING_COLUMNS.map((c) => (
                  <td key={c.key}>{c.value(batting, base)}</td>
                ))}
                {defenseRuns != null && (
                  <td>{defenseRuns > 0 ? `+${defenseRuns}` : defenseRuns}</td>
                )}
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
  rating: Rating | null;
  seed: string;
}) {
  const player = state.origin;
  // 所屬單位一律讀目前的狀態：升學會換學校、選秀會換成球隊。讀 origin 那一份
  // 會永遠停在開局的國中，讀 state.school 則會在進職業之後停在高中。
  const tierLabel = schoolTiersOf(state.stage)?.tiers[String(state.schoolTier)]?.label ?? '';
  // 引退之後球團關係已經結束，但這一格要停在他掛靴的地方——退回學校會讓一段
  // 二十年的職業生涯在落幕那一刻變回高中生（見 PlayerState.retiredFrom）。
  const affiliation =
    state.pro !== null
      ? { name: state.pro.team, note: state.pro.levelName }
      : state.retiredFrom !== null
        ? { name: state.retiredFrom.team, note: `${state.retiredFrom.levelName}·引退` }
        : { name: state.school, note: tierLabel };

  // 取得二刀流之後，起始守位就不再說明他是什麼球員了——他是投手也是打者，
  // 因此寫成兩個守位。不再冠上「二刀流」三個字：右欄的狀態欄已經會列出這個
  // 特性，寫兩次只是佔位。
  // 野手側的守位由守備能力決定：守得動就站守位，守不動就是 DH，這也是多數
  // 投手出身的二刀流的歸宿。
  // 寫英文代碼（P＋DH），不寫「投手＋指定打擊」——姓名那一行還要擠慣用手，
  // 中文全稱會把它撐到換行。
  //
  // 進了頂級聯盟就寫**現在登錄的守位**，不是起始守位：移防之後那兩者會分岔，
  // 而右欄已經不另外列一格了，這裡停在舊守位的話就沒有地方看得到現況。
  //
  // 還沒登錄守位時（養成期，或人在二軍）寫**暫定守位**：那是引擎依當下守備能力
  // 現算的，不是十三歲選的起始守位——拿起始守位冒充球團的登錄結果，守備沒點的人
  // 會被顯示成蹲捕。引擎那邊的出賽勞損也吃同一個位置，介面不另外算一份。
  //
  // 純投手只寫 P。養成期他的守位欄是 DH（那是打席的落點，成績要標），但姓名旁
  // 寫 P＋DH 會把他說成二刀流——他只是還沒被免除打擊而已。
  const roleLabel = !state.playsField
    ? 'P'
    : state.traits.has('two_way')
      ? `P＋${state.position ?? 'DH'}`
      : (state.position ?? 'DH');
  return (
    <div id="board">
      <h4 className="board-title">球員</h4>
      <div id="bd-top">
        <span id="bd-name">
          {/* 合約剩餘年數放在姓名上方——那塊空白本來就對著隊名側的奪冠機率，
              兩邊各自佔一行。它是「我還剩幾年安穩」，屬於處境，不是能力，因此
              不進下面的方格。 */}
          {state.pro !== null && <small className="deal">約 {state.pro.contractYears} 年</small>}
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
        {/* 二刀流寫兩個數字：他是兩種球員，一個數字說不完，而右欄那兩格
            「投手側／野手側」已經收掉了，這裡不寫就沒有地方看得到。
            單邊的人仍寫 overall——那才是升降級判定吃的那個數字（含 yips 之類的
            特性修正），寫成側評價會跟卡片上的「綜合 X」對不起來（ADR 0029）。 */}
        {state.visibleSide === null ? (
          <div className="bd-cell">
            {/* 斜線兩側不留空格，且字級隨寬度自動縮：兩個數字比一個長，方格
                的寬度卻是四等分的固定值，換行會把整排方格頂高一截。**寧可字
                小一點也不要版面跳動**——這一格在整局裡只有二刀流會用到，為它
                改動所有人的版面高度是本末倒置。 */}
            <FitValue>
              {rating?.pitcher ?? 0}/{rating?.fielder ?? 0}
            </FitValue>
            <span>投/野</span>
          </div>
        ) : (
          <div className="bd-cell">
            <b>{rating?.overall ?? 0}</b>
            <span>綜合</span>
          </div>
        )}
        <div className="bd-cell">
          <b>{state.pool}</b>
          <span>可分配點</span>
        </div>
      </div>
      {/* 年薪與生涯收入併成一行。兩個都是錢，分成兩格只是把同一件事切開；
          斜線左邊是今年拿多少，右邊是這輩子拿過多少。 */}
      {state.pro !== null && (
        <div id="bd-money">
          {fmtMoneyShort(state.pro.salary)}
          {state.earnings > 0 && <span> / {fmtMoneyShort(state.earnings)}</span>}
        </div>
      )}
      <div id="lamps">
        <span className="lamp on">
          <i />
          SEED {seed}
        </span>
        {state.honors.length > 0 && (
          // 清單掛在滑鼠停留的提示上。生涯累積下來會有十幾項，攤在版面上會把
          // 記分板撐開，而它們平常並不需要被讀。
          <span className="lamp on honors" title={sortHonors(state.honors).join('\n')}>
            <i />
            榮譽 {state.honors.length}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 榮譽的顯示排序：繁體中文的預設定序就是筆劃順序。
 *
 * 明確指定 co-stroke 而不是依賴地區預設——不同引擎對 zh-Hant 的預設定序未必
 * 一致，寫死才不會在別的環境裡變成注音或碼位順序。
 */
const HONOR_COLLATOR = new Intl.Collator('zh-Hant-TW-u-co-stroke');

/**
 * 事件流末端的結算卡：狀態、生涯年表、榮譽榜。
 *
 * 日誌只記下段落別，內容一律從 state / summary 重算（見 flow.ts 的 `Finale`）。
 * 因此重讀存檔時這三塊跟著最新的資料走，不會留下一份過期的畫面副本。
 */
function FinaleCard({
  section,
  state,
  summary,
}: {
  section: Finale['section'];
  state: PlayerState | null;
  summary: CareerSummary | null;
}) {
  // 讀檔中途或狀態尚未就緒時整塊不畫——結算卡沒有半成品的形態。
  if (state === null || summary === null) return null;
  if (section === 'traits')
    return (
      <div className="card">
        <TraitList traits={state.traits} names={state.traitNames} />
      </div>
    );
  if (section === 'career')
    return (
      <div className="card">
        <CareerTable summary={summary} />
      </div>
    );
  return (
    <div className="card">
      <HonorBoard
        awards={state.awards}
        honors={state.honors}
        summary={summary}
        love={state.love}
      />
    </div>
  );
}

function sortHonors(honors: readonly string[]): string[] {
  return [...honors].sort((a, b) => HONOR_COLLATOR.compare(a, b));
}

function LogView({
  entries,
  state,
  summary,
}: {
  entries: readonly LogEntry[];
  state: PlayerState | null;
  summary: CareerSummary | null;
}) {
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
              ) : entry.kind === 'finale' ? (
                <FinaleCard key={j} section={entry.section} state={state} summary={summary} />
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
  repeatable,
  onChoose,
}: {
  state: PlayerState;
  allocatable: Map<string, Option>;
  repeatable: boolean;
  onChoose: (optionId: string) => void;
}) {
  const display = abilities.display_groups;
  const common = { state, allocatable, repeatable, onChoose };

  return (
    <>
      {display.order.map((group) => {
        const keys = display.members[group] ?? [];
        // 另一側整組收起來，不是變灰。留著一組永遠動不了的數字只會佔版面，也會
        // 讓玩家一直以為還有機會補回來。體力兩側共用，永遠顯示。
        // 用 visibleSide 而非 lockedSide：起始守位一選定就該收起來，不必等畢業。
        if (!isSideVisible(keys[0] ?? '', state.visibleSide)) return null;
        return (
          <AbilityBlock
            key={group}
            title={display.names[group] ?? group}
            keys={keys}
            {...common}
          />
        );
      })}
    </>
  );
}

function AbilityBlock({
  title,
  keys,
  state,
  allocatable,
  repeatable,
  onChoose,
}: {
  title: string;
  keys: readonly string[];
  state: PlayerState;
  allocatable: Map<string, Option>;
  repeatable: boolean;
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
          repeatable={repeatable}
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
  repeatable,
  onChoose,
}: {
  abilityKey: string;
  state: PlayerState;
  option: Option | undefined;
  /** 長按可以連續加點。骰子分配是一顆一顆按的，不適用。 */
  repeatable: boolean;
  onChoose: (optionId: string) => void;
}) {
  const repeat = useHold();
  const current = state.ability[abilityKey] ?? 0;
  const potential = state.origin.potential[abilityKey] ?? 0;
  const carry = state.carry[abilityKey] ?? 0;
  const bonus = state.ceilingBonus[abilityKey] ?? 0;
  // 與舊版一致的表達方式：蓄力／這一級所需點數，例如 0/2。成本 1 點時不顯示。
  // 欠點另外標一個「欠」字：分母跟著換成退一級退回來的錢，只寫負號會讀成
  // 「存了 -1 點」。
  const gauge = carryGauge(
    current,
    potential + bonus,
    carry,
    growthCurve(state.traits.has('two_way')),
  );
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
            {gauge.points}/{gauge.need}
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
      // 一次 100 點的大賽點數按一百下不是遊戲，是勞動。長按接管重複的部分：
      // 首次的 +1 仍由 onClick 發出（放開手才算數），按住超過門檻才開始連發。
      onPointerDown={() => repeatable && repeat.start(() => onChoose(option.id))}
      onPointerUp={repeat.stop}
      onPointerLeave={repeat.stop}
      onPointerCancel={repeat.stop}
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

/**
 * 長按連發。
 *
 * 按住 400ms 後開始，每 90ms 一次——比游標移開就停，因為手指滑出按鈕範圍是
 * 玩家想停下來的意思。計時器掛在 ref 上並在卸載時清掉：加點會讓整條能力列
 * 重繪，若計時器留在舊的閉包裡就會變成停不下來的連發。
 */
function useHold(delay = 400, every = 90): { start: (fn: () => void) => void; stop: () => void } {
  const timers = useRef<{ start?: number; tick?: number }>({});

  const stop = () => {
    window.clearTimeout(timers.current.start);
    window.clearInterval(timers.current.tick);
    timers.current = {};
  };

  useEffect(() => stop, []);

  return {
    start: (fn: () => void) => {
      stop();
      timers.current.start = window.setTimeout(() => {
        timers.current.tick = window.setInterval(fn, every);
      }, delay);
    },
    stop,
  };
}

const HAND_LABEL: Record<string, string> = { R: '右', L: '左', S: '左右開弓' };

function hand(h: string): string {
  return h === 'S' ? '雙' : h === 'L' ? '左' : '右';
}
