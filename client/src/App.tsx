import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import './app.css';
import { saveCareerCard, type CardLine, type CardRow, type CardTable, type CareerCard } from './careerImage.ts';
import { AccountBar } from './Account.tsx';
import { useAccount, type Account } from './useAccount.ts';
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
  Game,
  NO_PROGRESS,
  type CareerProgress,
  type PlayerState,
} from './engine/game.ts';
import { fmtAvg } from './engine/format.ts';
import { abilityCost, carryGauge, growthCurve } from './engine/growth.ts';
import {
  amateurBaseline,
  battingShares,
  eraPlus,
  opsPlus,
  pitchingShares,
  baselineAt,
  proBaseline,
  sumShares,
  winPct,
  type Baseline,
  type Shares,
} from './engine/metrics.ts';
import { joinName } from './engine/naming.ts';
import { clampName } from './engine/playerName.ts';
import { tournamentPar } from './engine/national.ts';
import { blockedByHand, isSideVisible, type Rating } from './engine/rating.ts';
import { fmtMoneyShort } from './engine/salary.ts';
import { positionName, ROLE_NAMES } from './engine/season.ts';
import { partnerProfile } from './engine/loveYear.ts';
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
  /** 注音、拼音選字到一半時不截——組字中的符號也算寬度，截下去會把字吃掉。 */
  const composing = useRef(false);
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
    const setup = { seed, name: clampName(name.trim()) || '無名氏', startPosition, throws, bats };
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
      /**
       * 天賦從哪裡來。
       *
       * 優先用伺服器凍結的那一組（`t.talents`）——驗證時算數的是它。但登記失敗
       * 時**不能退回「沒有天賦」**：玩家買了突破極限卻在天花板外照付三倍價，畫面上
       * 沒有任何提示，那一局就是靜靜地變難了（實際發生過：API 沒起來，同一個
       * 存檔 6X 能力要 18 點蓄力，隔一局同樣的天賦只要 10 點）。
       *
       * 「這一局不入帳」與「這一局沒有天賦」是兩件事。不入帳的局本來就不會拿去
       * 驗證，用本機那份 `me.talents` 開下去是安全的。
       */
      const talents = t?.talents ?? me?.talents ?? {};
      if (t === null && me !== null) {
        console.warn('[career] 沒拿到開局票，改用本機的天賦開局，這一局不入帳');
      }
      const game = new Game({ ...setup, talents }, progress).start();
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
            placeholder="例如：林家正"
            value={name}
            onChange={(e) =>
              setName(composing.current ? e.target.value : clampName(e.target.value))
            }
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={(e) => {
              composing.current = false;
              setName(clampName(e.currentTarget.value));
            }}
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
            左投與左打在棒球裡有結構性優勢，對價是**兩把尺一起降**：他被拿來比的門檻
            （升降級、戰力外、簽約、守位、國家隊徵召）整條下移，代價是天賦上限打折。
            左右開弓更深一檔。獎項與生涯評價分吃的是聯盟真尺，不受折扣影響——那是比較，
            比較必須全聯盟同一條線。
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
const ALLOC_CONTROLS = new Set(['alloc:undo', 'alloc:confirm', 'alloc:forfeit']);

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
  // 復原與確認（或放棄）獨立一排並列——它們是一組動作（退一步／往前走），拆成上下兩顆
  // 全寬按鈕會讓人以為是兩個不相干的選項。
  const controlOptions = (prompt?.options ?? []).filter((o) => ALLOC_CONTROLS.has(o.id));

  const pages = usePages(allocatable.size > 0, state !== null);

  return (
    <>
      <div id="game" ref={pages.ref} onScroll={pages.onScroll}>
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
                  // 不寫方向。桌面在左欄、手機在同一頁的上方，而手機還能滑到事件
                  // 頁去——任何一個方向詞都會有講錯的時候，一份文案兩邊共用才不會。
                  <div className="title" style={{ color: 'var(--accent)', letterSpacing: 0 }}>
                    點能力列加點
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
                    onClick={() => {
                      onChoose(o.id);
                      pages.onAction();
                    }}
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
                        onClick={() => {
                          onChoose(o.id);
                          pages.onAction();
                        }}
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
                {game.summary !== null && <SaveCardButton game={game} />}
                <button type="button" className="btn" onClick={onRestart}>
                  重新開局
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {state !== null && <PageNav page={pages.page} go={pages.go} />}
    </>
  );
}

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
function SaveCardButton({ game }: { game: Game }) {
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

/**
 * 手機的兩頁：能力頁（`#col-left`）與事件頁（`#col-right`）。
 *
 * **走馬燈不是另外包一層做出來的，是 `#game` 自己在手機上變成橫向 snap 容器。**
 * 這兩塊在桌面分屬左右欄，一個 DOM 生不出兩種父子關係；硬包一層就得改寫桌面的
 * grid，而 grid 的列高會把 `#board` 與 `#panel-stats` 綁進同一列，桌面的版面
 * 就跟著動了。改成讓 `#game` 換角色，所有手機的規則都關在 `@media` 裡，桌面那段
 * CSS 一行都不用碰。
 *
 * 記分板與動作區在手機上是 `position:fixed`，橫向捲動時才不會跟著滑走；它們的
 * 高度會隨合約、年薪、特性數量與選項數量變動，因此量出來餵給 CSS 變數，版面
 * 用它算出中間那條帶子的上下界。
 *
 * 自動切頁**只在轉折的那一刻切一次**：需要加點時滑到能力頁，加完滑回事件頁。
 * 加點的過程中（還剩幾點沒分配）不再干預——玩家滑去事件頁看卡片是他的選擇，
 * 每次提問都把他拉回來等於沒收了那個選擇。
 */
function usePages(needsAbility: boolean, started: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  // 同一件事的兩份：`page` 給畫面（頁點要跟著亮），`at` 給事件處理器（在
  // 回呼裡讀 state 會讀到閉包當時的那一份）。
  const [page, setPage] = useState(1);
  const at = useRef(1);

  /** 手指是不是還壓在螢幕上。 */
  const touching = useRef(false);
  /** 排隊中的自動切頁：目標頁、已經等了多久。 */
  const pending = useRef<{ to: number; waited: number } | null>(null);
  const timers = useRef<{ flush?: number; settle?: number }>({});

  /** 立刻滑到第 i 頁。 */
  const go = (i: number) => {
    const el = ref.current;
    // 桌面沒有橫向捲動空間，這裡就什麼也不做——不必另外判斷斷點。
    if (el === null || el.scrollWidth <= el.clientWidth) return;
    at.current = i;
    setPage(i);
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    settle(i, 0);
  };

  /**
   * 自動切頁的請求。**兩件事都在這裡等：先等 `after` 毫秒，再等手指放開。**
   *
   * - 等 `after`：滑去能力頁之前停半秒，讓玩家先讀完剛跳出來的卡片。不停的話
   *   畫面會在他讀之前就換掉，變成點完能力才知道發生了什麼事。
   * - 等放手：能力列有長按連發（`useHold`，按住每 90ms +1），點數點完的那一刻
   *   手指多半還壓著，而瀏覽器一偵測到觸控就會取消進行中的 smooth scroll，
   *   畫面會停在兩頁中間。
   *
   * 等放手**有上限**：`pointerup` 不保證送得到（元件被換掉、系統攔截手勢），
   * 無限等的話那一筆待辦就永遠不會兌現——那正是「偶發不會自動滑回事件」的
   * 樣子。等滿上限就直接滑，寧可打斷一次觸控也不要卡在錯的頁。
   */
  const request = (to: number, after: number) => {
    window.clearTimeout(timers.current.flush);
    pending.current = { to, waited: 0 };
    timers.current.flush = window.setTimeout(flush, after);
  };

  const flush = () => {
    const job = pending.current;
    if (job === undefined || job === null) return;
    if (touching.current && job.waited < HOLD_WAIT_MAX) {
      job.waited += HOLD_WAIT_STEP;
      timers.current.flush = window.setTimeout(flush, HOLD_WAIT_STEP);
      return;
    }
    pending.current = null;
    go(job.to);
  };

  /**
   * 收尾：滑完之後如果卡在兩頁中間，直接對齊過去。
   *
   * 用瞬移不用 smooth——會走到這裡就是因為 smooth 被打斷過，再滑一次可能再被
   * 打斷一次。**只在「卡在中間」時才動**：已經停在另一頁是玩家自己滑過去的，
   * 那是他的選擇，不該把他拉回來。
   */
  const settle = (i: number, waited: number) => {
    window.clearTimeout(timers.current.settle);
    timers.current.settle = window.setTimeout(() => {
      const el = ref.current;
      if (el === null) return;
      // 手指還在，這一刻的位置還不是最終位置——再等一輪，同樣有上限。
      if (touching.current && waited < HOLD_WAIT_MAX) {
        settle(i, waited + SETTLE_DELAY);
        return;
      }
      const w = el.clientWidth;
      if (w === 0) return;
      const off = el.scrollLeft % w;
      if (off > 2 && off < w - 2) el.scrollLeft = i * w;
    }, SETTLE_DELAY);
  };

  // 手指的狀態掛在 window 上（捕獲階段），因為按著的可能是能力列、也可能是
  // 動作區的按鈕，兩邊都不該各自回報一次。
  useEffect(() => {
    const down = () => {
      touching.current = true;
    };
    const up = () => {
      touching.current = false;
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.clearTimeout(timers.current.flush);
      window.clearTimeout(timers.current.settle);
    };
  }, []);

  // 記分板與動作區的高度。兩者都是 fixed，中間那條帶子要靠它們算出上下界。
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const watched = [el.querySelector('#board'), el.querySelector('#panel-act')].filter(
      (n): n is Element => n !== null,
    );
    const sync = () => {
      const root = document.documentElement.style;
      for (const n of watched) {
        const h = `${n.getBoundingClientRect().height}px`;
        root.setProperty(n.id === 'board' ? '--board-h' : '--act-h', h);
      }
    };
    const observer = new ResizeObserver(sync);
    for (const n of watched) observer.observe(n);
    sync();
    return () => observer.disconnect();
  }, [started]);

  // 起始頁：預設事件頁——故事線是常態，能力頁是被叫出來的那一頁。但**開局第一
  // 個提問就是配點的時候要直接停在能力頁**：自動切頁只認「由不需要變成需要」
  // 那個轉折，開局就已經需要的話那個轉折不存在，停在事件頁會沒有人把他帶過去。
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || el.scrollWidth <= el.clientWidth) return;
    if (!first.current) return;
    first.current = false;
    at.current = needsAbility ? 0 : 1;
    setPage(at.current);
    el.scrollLeft = at.current * el.clientWidth;
  }, [started, needsAbility]);

  const wanted = useRef(needsAbility);
  useEffect(() => {
    if (wanted.current === needsAbility) return;
    wanted.current = needsAbility;
    request(needsAbility ? 0 : 1, needsAbility ? READ_FIRST : 0);
  }, [needsAbility]);

  /**
   * 玩家按了動作區的按鈕。
   *
   * **每按一次就重新確認一遍該待在哪一頁。** 光靠上面那個「由需要變成不需要」
   * 的轉折不夠：轉折只認得到變化，認不出「本來就不需要、但畫面停在能力頁」
   * 這種已經歪掉的狀態，而那個狀態只要漏掉一次事件就會出現，然後一直錯下去。
   * 按鈕是流程往前走的唯一入口，在這裡對一次帳最省事。
   *
   * 對帳延到下一次 render：按下去的當下 `needsAbility` 還是**這一步之前**的
   * 值，拿它判斷的話，通往加點的那一步會先往事件頁滑一次再滑回來。
   */
  const recheck = useRef(false);
  const onAction = () => {
    recheck.current = true;
  };
  useEffect(() => {
    if (!recheck.current) return;
    recheck.current = false;
    if (!needsAbility) request(1, 0);
  });

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    at.current = i;
    setPage((p) => (p === i ? p : i));
  };

  // 轉螢幕之後把當前頁重新對齊。頁寬等於視窗寬，寬度一變舊的 scrollLeft 就落在
  // 兩頁中間；各家瀏覽器對「版面改變後要不要重新吸附」的處理並不一致，自己對
  // 一次最省事。
  useEffect(() => {
    const onResize = () => {
      const el = ref.current;
      if (el === null || el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft = at.current * el.clientWidth;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { ref, page, go, onAction, onScroll };
}

/** 滑去能力頁之前先停這麼久，讓玩家讀完剛跳出來的卡片。 */
const READ_FIRST = 1000;
/** 等手指放開的輪詢間隔與總上限。 */
const HOLD_WAIT_STEP = 100;
const HOLD_WAIT_MAX = 1200;
/** 滑完之後多久檢查一次有沒有卡在兩頁中間。 */
const SETTLE_DELAY = 400;

/**
 * 手機的換頁提示：左右半透明箭頭 ＋ 兩顆頁點。
 *
 * 掛在 `#game` 外面而不是裡面——`#game` 在手機上的直接子元素就是那兩頁，多一個
 * 就多一頁。整塊是 fixed，蓋在中間那條帶子上，只有箭頭與頁點自己收事件。
 */
function PageNav({ page, go }: { page: number; go: (i: number) => void }) {
  return (
    <div id="pagenav">
      <button
        type="button"
        className="pagearrow left"
        aria-label="看能力"
        hidden={page === 0}
        onClick={() => go(0)}
      >
        ‹
      </button>
      <button
        type="button"
        className="pagearrow right"
        aria-label="看事件"
        hidden={page === 1}
        onClick={() => go(1)}
      >
        ›
      </button>
      <div className="pagedots" aria-hidden="true">
        <i className={page === 0 ? 'on' : ''} />
        <i className={page === 1 ? 'on' : ''} />
      </div>
    </div>
  );
}

/**
 * 事件流。**新內容出現時一律捲到底，不管玩家有沒有自己往上捲。**
 *
 * 這裡曾經維護一個「玩家是不是貼著底部」的旗標，只在貼底時才自動捲。那個設計
 * 在這個介面裡是錯的：事件流是**當下正在發生的事**，新卡片就是提問本身，停在
 * 半空中的畫面等於把提問藏起來。而且旗標本身很難維護正確——版面一動，瀏覽器
 * 送出的捲動事件與玩家自己的捲動長得一模一樣，只要漏擋一次就會卡住不再自動捲，
 * 那正是「有時候沒捲到底」的來源。旗標拿掉，那一整類 bug 也跟著消失。
 *
 * 兩件事仍必須一起做：
 *
 * 1. **useLayoutEffect 而不是 useEffect**——要在瀏覽器繪製之前捲，否則會先
 *    閃一下舊位置。
 * 2. **監看容器與內容的尺寸變化**。光在 entries 變動時捲一次不夠：卡片的高度
 *    要等字體與換行定案才算得出來，那發生在這一次 effect 之後，捲到的會是舊
 *    高度。動作區長出選項把事件流壓矮也是同一類——那不會觸發捲動事件。
 *    但尺寸變化只在玩家原本就停在底部時才追——見 `atBottom`。
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

  // 捲到 scrollHeight − clientHeight，不是 scrollHeight。瀏覽器雖然會夾住，
  // 但明確寫出來才不會有人以為這裡差了一個 clientHeight。
  const pin = () => {
    const el = ref.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight - el.clientHeight;
  };

  // 玩家上一次停下來時是不是在底部。尺寸變化只在這時候追到底：往上捲回去點開
  // 結算裡的狀態說明，說明展開也是尺寸變化，不該把人拖回今晚打老虎（issue #35）。
  // 程式自己捲到底送出的捲動事件算出來也是「在底部」，所以不會卡住。
  const atBottom = useRef(true);

  useLayoutEffect(() => {
    atBottom.current = true;
    pin();
  }, [entries.length]);

  useEffect(() => {
    const el = ref.current;
    const inner = innerRef.current;
    if (el === null || inner === null) return;
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 8;
    };
    const observer = new ResizeObserver(() => {
      if (atBottom.current) pin();
    });
    el.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(el);
    observer.observe(inner);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  return (
    <div id="panel-log" ref={ref}>
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

/**
 * 最近一季的成績與狀態。只在生涯進行中出現，而且**只有桌面看得到**。
 *
 * 手機把整塊收掉（見 app.css 的手機段）：成績由每季結算的事件卡負責，狀態則
 * 由記分板底下那一份接手（`#bd-traits`）。**兩邊是同一個 `TraitList`**，差的
 * 只是掛在哪裡與帶不帶小標——桌面的狀態接在成績表下面（它們是同一段時間的
 * 側寫），手機沒有成績表可接，就釘在球員資料下面。
 */
function StatsPanel({ state }: { state: PlayerState }) {
  return (
    <div id="panel-stats">
      {/* 面板不帶自己的標題：底下那塊自己有 `<h4>`（最近一季），再加一個面板級
          標題就是兩個同級標題連在一起、中間沒有內容。 */}
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
        shares={state.seasonShares}
        defenseRuns={state.pro === null ? null : state.seasonDefenseRuns}
      />
      <TraitList traits={state.traits} names={state.traitNames} notes={state.traitNotes} tags={relationTags(state)} />
    </div>
  );
}

/** 榮譽榜的一組：小標 ＋ 幾個標籤。 */
export interface HonorGroup {
  readonly caption: string;
  readonly items: readonly string[];
}

/**
 * 榮譽的分組。**只有這一份**——畫面上的榮譽卡與下載的生涯成績圖共用它，各算
 * 各的遲早會分岔成兩種「榮譽」。
 *
 * 四組分開排，因為來源不同：
 *
 * - **職業獎項**冠上聯盟名並列出年份——「中職年度MVP」與「日職年度MVP」是
 *   兩件事，拆開才看得出一個旅外球員在哪裡拿的獎。
 * - **里程碑**是累積出來的，不是誰投票給你的。
 * - **養成期與國際賽**的榮譽沒有結構化紀錄，只有字串，因此照原樣列。
 * - **人生**不是獎項，但它是這個人的生涯的一部分——一個拿過五座 MVP 卻離了
 *   三次婚的人，與一個拿五座 MVP 且孩子坐滿看台的人，不是同一個故事。
 *
 * 空的組不回傳。標籤的樣式四組一致：每一組上面本來就寫著自己的小標，用形狀
 * 再編碼一次只是要求讀的人先學會那套編碼（見 app.css 的 .tag）。
 */
function honorGroups({
  awards,
  honors,
  summary,
  love,
}: {
  awards: readonly AwardRecord[];
  honors: readonly string[];
  summary: CareerSummary;
  love: PlayerState['love'];
}): HonorGroup[] {
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

  return [
    {
      caption: '獎項',
      items: shown.map((a) => `${a.label}（${[...a.years].sort((x, y) => x - y).join('、')}）`),
    },
    { caption: '里程碑', items: milestones },
    { caption: '業餘與國際賽', items: rest },
    { caption: '人生', items: lifeTags(love) },
  ].filter((g) => g.items.length > 0);
}

/**
 * 榮譽榜。**只在生涯結束後出現，而且含養成期。**
 *
 * 生涯進行中，左側記分板的「榮譽 N」那盞燈就夠了——那時玩家關心的是「我拿過
 * 幾項」，攤開一整面清單只會把版面吃掉。結算之後相反：那串東西就是他的生涯
 * 軌跡，該攤開來看。
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
  const groups = honorGroups({ awards, honors, summary, love });
  if (groups.length === 0) return null;

  return (
    <div id="panel-honors">
      <h4>榮譽</h4>
      {groups.map((g) => (
        <div className="tag-group" key={g.caption}>
          <div className="fin-caption">{g.caption}</div>
          <div className="tag-row">
            {g.items.map((t) => (
              <span className="tag" key={t}>
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
  notes,
  tags = [],
  heading = true,
}: {
  traits: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
  /** 特性的即時註記（例如七傷拳現在加了多少受傷機率），接在說明後面。 */
  notes?: ReadonlyMap<string, string>;
  /** 特性之外的狀態標籤（已婚：名字），排在特性前面，點開一樣看說明。 */
  tags?: readonly { readonly id: string; readonly label: string; readonly note: string }[];
  /** 記分板裡不帶標題：它接在 SEED 那排下面，那一帶本來就沒有小標。 */
  heading?: boolean;
}) {
  // 點開的那一個。一次只有一個：說明行固定在段落下方，多開就再也分不出哪行在
  // 講哪個標籤（標籤會換行，順序對不上），單開才不必在說明裡重複一次名稱。
  const [picked, setPicked] = useState<string | null>(null);
  const shown: { id: string; label: string; tone: string | undefined; effect_text: string; desc?: string }[] = [
    ...tags.map((t) => ({ id: t.id, label: t.label, tone: undefined, effect_text: t.note })),
    ...shownTraits(owned, names),
  ];
  // 從當下的清單找，而不是記住點下去的那段文字：特性可以在生涯中途消失（受傷
  // 洗掉、負向被覆蓋），留著舊說明會變成一行沒有標籤對應的孤兒。
  const pickedTrait = shown.find((t) => t.id === picked);
  const extra = picked === null ? undefined : notes?.get(picked);
  // 點開顯示**文案**（traits.json 的 desc：一句敘述＋粗體的效果）；沒有文案的退回
  // 效果說明。文案是資料檔寫死的 HTML，不含任何玩家輸入。
  const noteHtml = pickedTrait?.desc;
  const note =
    pickedTrait === undefined ? null : extra === undefined ? pickedTrait.effect_text : `${pickedTrait.effect_text}｜${extra}`;

  return (
    <>
      {/* 間距交給 CSS：在結算卡裡它是卡片的第一行，帶著 12px 會多出一截頭。 */}
      {heading && <h4 className="tl-head">狀態</h4>}
      {shown.length === 0 ? (
        // 記分板裡不留這一行：一開局什麼特性都沒有，一句「還沒有任何特性」會
        // 常駐在版面上好幾年，而它沒有任何資訊。結算卡裡才需要交代空的情況。
        heading ? (
          <p className="stat-pending" style={{ marginTop: 8 }}>
            還沒有任何特性。
          </p>
        ) : null
      ) : (
        <>
          {/* 跟榮譽同一個 tag-row：以前是一段文字靠行高撐開，標籤一換行，第二行就
              貼著第一行的下緣。flex 換行加 gap，上下與左右一樣寬。 */}
          <div className="tag-row" style={{ margin: '8px 0 0' }}>
            {shown.map((t) => (
              // title 留著：桌面想一次掃過五六個特性時，懸停比逐個點快，內容與
              // 下面那行同源。點擊是給觸控用的第二條路——原生 title 在手機上
              // 永遠不會出現，而負向特性的說明是玩家判斷要不要留它的依據。
              <span
                className={`tag pick${picked === t.id ? ' on' : ''}`}
                key={t.id}
                title={t.effect_text}
                onClick={() => setPicked((p) => (p === t.id ? null : t.id))}
                style={t.tone === 'bad' ? BAD_TAG : undefined}
              >
                {t.label}
              </span>
            ))}
          </div>
          {/* 說明不做浮層：這塊所在的位置（記分板、結算卡）都在會捲動或會被裁切
              的容器裡，浮層要嘛被裁掉、要嘛得改用 fixed 自己算座標並在捲動時
              重算。就地展開沒有這些問題，而 effect_text 最長也才 39 字。 */}
          {noteHtml !== undefined ? (
            <p className="tag-note">
              <span dangerouslySetInnerHTML={{ __html: noteHtml }} />
              {extra !== undefined && `｜${extra}`}
            </p>
          ) : (
            <p className={`tag-note${note === null ? ' hint' : ''}`}>{note ?? '點特性看說明'}</p>
          )}
        </>
      )}
    </>
  );
}

/**
 * 目前帶著的特性，依資料檔的順序（正向在前、負向在後）。
 *
 * 名稱以取得當下解析的為準；沒有動態名稱的就用資料檔的固定名。這裡曾經把
 * `name` 為 null 的整個濾掉，於是三個動態命名的特性拿得到卻永遠看不到。
 *
 * 抽成函式是因為畫面上的狀態列與下載的生涯成績圖都要用它——兩邊各寫一份的話，
 * 圖上的特性遲早會跟畫面上的對不起來。
 */
function shownTraits(
  owned: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
): { id: string; label: string; tone: string | undefined; effect_text: string; desc?: string }[] {
  const order = [...traitsData.categories.positive, ...traitsData.categories.negative];
  return order
    .filter((id) => owned.has(id))
    .map((id) => traitOf(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => ({ ...t, label: names.get(t.id) ?? t.name ?? t.id }));
}

/**
 * 感情的狀態標籤：已婚或交往中的對象，點開看她的側寫。鹿鼎公兩位都列。單身與
 * 離婚不列——狀態列講的是「現在身邊是誰」。
 */
function relationTags(state: PlayerState): { id: string; label: string; note: string }[] {
  const love = state.love;
  if (love.status !== 'married' && love.status !== 'dating') return [];
  const married = love.status === 'married';
  const years = married && love.marriedYear !== null ? `結婚 ${Math.max(0, state.year - love.marriedYear)} 年` : '';
  const kids = married && love.kids > 0 ? `孩子 ${love.kids} 個` : '';
  return [love.partner, love.partner2]
    .filter((n): n is string => n !== null)
    .map((name, i) => ({
      id: `partner-${i}`,
      label: `${married ? '已婚' : '交往'}：${name}`,
      note: [partnerProfile(name), years, kids].filter((s) => s !== '').join('｜'),
    }));
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
  /**
   * 那一季的三本帳，**分開給**。
   *
   * 份額算不出來自單側那條成績列：守備那一本帳不在打擊列上，而球隊勝率的調整
   * 也只有結算當下手上才有。兩張表各取自己該取的那幾本——**野手表是打擊加守備**
   * （守備份額本來就是野手的一部分），投手表是投球。二刀流照樣分開放。
   *
   * 沒有那份資料時（養成期、國際賽）退回單側自算。
   */
  readonly value: (line: T, base: Baseline, shares: SharesByPart | null) => string | number;
}

/** 三本帳。守備那一本沒有自己的表，它跟著野手走。 */
type SharesByPart = SeasonRecord['shares'];

/**
 * 野手那張表的份額：**打擊加守備**。
 *
 * 守備份額本來就是野手的一部分——一個守游擊的人有三成多的價值在手套上，把它
 * 留在表外等於說那些年他沒做什麼。沒有結算資料時退回只算打擊。
 */
function batterShares(line: BattingLine, base: Baseline, parts: SharesByPart | null): Shares {
  return parts === null ? battingShares(line, base) : sumShares(parts.batting, parts.fielding);
}

/** 相對聯盟平均的指標統一這樣顯示：沒有樣本就畫破折號，不畫 0。 */
const rel = (v: number | null) => (v === null ? '—' : v);

/**
 * 率類欄位：**分母是 0 就畫「-」**，不畫 .000 或 0.00——整季報銷的那一年沒有打席、
 * 沒有局數，那不是「打擊率零」，是沒有打擊率。
 */
const noPa = (b: BattingLine) => b.pa === 0;
const noOuts = (p: PitchingLine) => p.outs === 0;
const NA = '-';

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
  { key: 'AVG', title: '打擊率', value: (b) => (noPa(b) ? NA : fmtAvg(b.avg)) },
  { key: 'OBP', title: '上壘率', value: (b) => (noPa(b) ? NA : fmtAvg(b.obp)) },
  { key: 'SLG', title: '長打率', value: (b) => (noPa(b) ? NA : fmtAvg(b.slg)) },
  { key: 'OPS', title: '整體攻擊指數', value: (b) => (noPa(b) ? NA : fmtAvg(ops(b))) },
  { key: 'OPS+', title: '相對聯盟平均的攻擊表現（100 為聯盟平均）', value: (b, base) => rel(opsPlus(b, base)) },
  { key: 'WS', title: '勝利份額：這一季替球隊贏下幾份勝利（打擊與守備合計）', value: (b, base, shares) => batterShares(b, base, shares).win.toFixed(1) },
  { key: 'LS', title: '敗戰份額：佔用了出場機會與守備位置卻沒換回勝利的部分', value: (b, base, shares) => batterShares(b, base, shares).loss.toFixed(1) },
  { key: 'W%', title: '勝率：勝利份額佔責任額的比例，.500 為聯盟平均', value: (b, base, shares) => (noPa(b) ? NA : fmtAvg(winPct(batterShares(b, base, shares)))) },
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
  { key: 'ERA', title: '防禦率', value: (p) => (noOuts(p) ? NA : p.era.toFixed(2)) },
  { key: 'WHIP', title: '每局被上壘率', value: (p) => (noOuts(p) ? NA : whip(p).toFixed(2)) },
  { key: 'K/9', title: '每九局奪三振', value: (p) => (noOuts(p) ? NA : kPerNine(p).toFixed(1)) },
  { key: 'BB/9', title: '每九局四壞', value: (p) => (noOuts(p) ? NA : bbPerNine(p).toFixed(1)) },
  { key: 'ERA+', title: '相對聯盟平均的防禦率（100 為聯盟平均）', value: (p, base) => rel(eraPlus(p, base)) },
  { key: 'WS', title: '勝利份額：這一季替球隊贏下幾份勝利', value: (p, base, shares) => (shares?.pitching ?? pitchingShares(p, base)).win.toFixed(1) },
  { key: 'LS', title: '敗戰份額：佔用了投球局數卻沒換回勝利的部分', value: (p, base, shares) => (shares?.pitching ?? pitchingShares(p, base)).loss.toFixed(1) },
  { key: 'W%', title: '勝率：勝利份額佔責任額的比例，.500 為聯盟平均', value: (p, base, shares) => (noOuts(p) ? NA : fmtAvg(winPct(shares?.pitching ?? pitchingShares(p, base)))) },
];

/** 一列通算成績。第一欄是列名（聯盟或「通算」），其餘欄位與生涯年表一致。 */
interface TotalRow {
  readonly label: string;
  readonly seasons: number;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  readonly defenseRuns: number;
  /** 這一季的三本帳。養成期沒有這份資料，一律 null。 */
  readonly shares: SharesByPart | null;
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
    // 三人行是一場婚禮、兩個名字——年表上不該只寫其中一位。
    const who = love.partner2 === null ? love.partner : `${love.partner}、${love.partner2}`;
    out.push(love.marriedYear === null ? `與${who}結婚` : `與${who}結婚（${love.marriedYear}）`);
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
  /** 這一年的投手定位。養成期沒有牛棚分工，一律 null。 */
  readonly pitcherRole: SeasonRecord['pitcherRole'];
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  /** 這一年帶著什麼傷。養成期不追蹤傷病，一律 null。 */
  readonly injured: SeasonRecord['injured'];
  readonly defenseRuns: number;
  /** 這一季的三本帳。養成期沒有這份資料，一律 null。 */
  readonly shares: SharesByPart | null;
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
  shares,
}: {
  columns: readonly StatColumn<T>[];
  line: T;
  base: Baseline;
  shares: SharesByPart | null;
}) {
  return (
    <>
      {columns.map((c) => (
        <td key={c.key}>{c.value(line, base, shares)}</td>
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
function TotalsTable({
  title,
  rows,
  leadHead = '聯盟',
  countHead = '季',
  countTitle = '出賽季數',
}: {
  title: string;
  rows: readonly TotalRow[];
  /** 第一欄的欄名。國際賽那張是「賽事」，不是聯盟。 */
  leadHead?: string;
  /** 第二欄的欄名與說明。國際賽算的是屆數。 */
  countHead?: string;
  countTitle?: string;
}) {
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
                <th style={{ textAlign: 'left' }}>{leadHead}</th>
                <th title={countTitle}>{countHead}</th>
                <StatHeadCells columns={BATTING_COLUMNS} />
                <th title="守備分">DEF</th>
              </tr>
            </thead>
            <tbody>
              {batting.map((r) => (
                <tr key={r.label}>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td>{r.seasons}</td>
                  <StatCells columns={BATTING_COLUMNS} line={r.batting!} base={r.base} shares={r.shares} />
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
                <th style={{ textAlign: 'left' }}>{leadHead}</th>
                <th title={countTitle}>{countHead}</th>
                <StatHeadCells columns={PITCHING_COLUMNS} />
              </tr>
            </thead>
            <tbody>
              {pitching.map((r) => (
                <tr key={r.label}>
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td>{r.seasons}</td>
                  <StatCells columns={PITCHING_COLUMNS} line={r.pitching!} base={r.base} shares={r.shares} />
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
 * 國際賽年表。
 *
 * **獨立一張表**：國際賽不屬於任何聯盟，混進聯盟通算會污染階梯成就與各聯盟的
 * 評價分。它接在通算後面而不是併進生涯年表，理由同上——年表那幾列的「球隊」欄
 * 是他當年效力的球團，中華隊不是其中之一。
 *
 * **一屆一列，不逐場**：引擎沒有逐場的粒度，一屆賽會直接產出一條合計成績。
 *
 * 只收職業期。養成期的國際賽併在該年的養成列裡——那幾屆與謝國城盃同一個季節，
 * 是學生賽程的一部分。
 */
function InternationalTable({ summary }: { summary: CareerSummary }) {
  const rows = summary.internationalSeasons;
  if (rows.length === 0) return null;
  const batting = rows.filter((r) => r.batting !== null);
  const pitching = rows.filter((r) => r.pitching !== null);
  if (batting.length === 0 && pitching.length === 0) return null;

  // 基準線用**賽會自己的 par**，不是他母聯盟的。成績本來就是拿那個 par 生成的
  // （見 game.ts 的 #accumulateNationalStats），量它也該用同一把。差別只落在吃
  // par 的那一格（故意四壞／恐懼值），量不大，但沒有理由留著一把對不上的尺。
  const base = baselineAt(tournamentPar());
  const head = (
    <>
      <th title="年度">年</th>
      <th title="年齡">齡</th>
      <th style={{ textAlign: 'left' }}>賽事</th>
      <th style={{ textAlign: 'left' }} title="中華隊最終名次">名次</th>
    </>
  );
  const lead = (r: CareerSummary['internationalSeasons'][number]) => (
    <>
      <td>{r.year}</td>
      <td>{r.age}</td>
      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.tournament}</td>
      <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
        {r.rank}
        {r.mvp && <span className="sub">・MVP</span>}
      </td>
    </>
  );

  return (
    <>
      <h4 style={{ marginTop: 14 }}>國際賽</h4>
      {batting.length > 0 && (
        <div className="fin-scroll">
          <div className="fin-caption">野手</div>
          <table className="fin">
            <thead>
              <tr>
                {head}
                <StatHeadCells columns={BATTING_COLUMNS} />
              </tr>
            </thead>
            <tbody>
              {batting.map((r) => (
                <tr key={`intl-b-${r.year}-${r.tournament}`}>
                  {lead(r)}
                  <StatCells columns={BATTING_COLUMNS} line={r.batting!} base={base} shares={null} />
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
                {head}
                <StatHeadCells columns={PITCHING_COLUMNS} />
              </tr>
            </thead>
            <tbody>
              {pitching.map((r) => (
                <tr key={`intl-p-${r.year}-${r.tournament}`}>
                  {lead(r)}
                  <StatCells columns={PITCHING_COLUMNS} line={r.pitching!} base={base} shares={null} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* 國際賽通算。與頂級聯盟通算同一個角色，但**永遠是自己一張**——國際賽不
          屬於任何聯盟，加進聯盟那張表會讓通算多出幾場不存在的聯盟出賽。 */}
      <TotalsTable
        title="國際賽通算"
        rows={[intlTotalRow(summary)]}
        leadHead="賽事"
        countHead="屆"
        countTitle="出賽屆數"
      />
    </>
  );
}

/** 國際賽通算的那一列。屆數算的是出賽的賽會數，不是年數——同一年可能有兩屆。 */
function intlTotalRow(summary: CareerSummary): TotalRow {
  return {
    label: '國際賽',
    seasons: summary.internationalSeasons.length,
    batting: summary.internationalTotal.batting,
    pitching: summary.internationalTotal.pitching,
    defenseRuns: 0,
    // 國際賽的份額不進評價分，年表上那幾欄退回單側自算。
    shares: null,
    // 國際賽沒有自己的聯盟可挑，成績本來就是拿他當時所在的層級換算出來的，
    // 因此借代表聯盟那把尺——與上面逐屆那兩張表同一個基準。
    base: proBaseline(summary.leagues[0]?.topLevel ?? 'CPBL1'),
  };
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
                  <StatCells columns={BATTING_COLUMNS} line={r.batting!} base={r.base} shares={r.shares} />
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
                <th title="投手定位">定位</th>
                <StatHeadCells columns={PITCHING_COLUMNS} />
              </tr>
            </thead>
            <tbody>
              {pitching.map((r, i) => (
                <tr key={r.key} className={rowClass(r)}>
                  {rowLead(r, pitching[i - 1]?.year === r.year)}
                  {/* 與野手那張表的「守位」對稱：他那一年在做什麼。養成期沒有
                      牛棚分工，留白。 */}
                  <td title={r.pitcherRole === null ? undefined : ROLE_NAMES[r.pitcherRole]}>
                    {r.pitcherRole ?? '—'}
                  </td>
                  <StatCells columns={PITCHING_COLUMNS} line={r.pitching!} base={r.base} shares={r.shares} />
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
      <InternationalTable summary={summary} />
    </div>
  );
}

/**
 * 生涯成績圖的內容。
 *
 * **這裡只組內容，不畫圖**（畫的部分在 careerImage.ts）。每一格都走畫面上同一
 * 批函式與同一份欄位定義——圖與畫面各算一份的話，玩家遲早會拿圖來質疑畫面，
 * 而那時他是對的。
 *
 * 圖的順序不照畫面：球員卡、狀態、引退之日、生涯年表、榮譽。畫面上引退之日
 * 是事件流裡的一張卡，排在年表之前；圖是要傳出去給人看的東西，先講他是誰、
 * 再講那一天發生了什麼事，最後才攤開數字。
 */
export function careerCardOf(game: Game): CareerCard | null {
  const state = game.state;
  const summary = game.summary;
  if (state === null || summary === null) return null;

  const cells = <T,>(
    cols: readonly StatColumn<T>[],
    v: T,
    base: Baseline,
    shares: SharesByPart | null,
  ): string[] => cols.map((c) => String(c.value(v, base, shares)));

  const rows = careerRows(summary);
  const batting = rows.filter((r) => r.batting !== null);
  const pitching = rows.filter((r) => r.pitching !== null);
  const totals = leagueTotals(summary);
  const intlBase = baselineAt(tournamentPar());

  // 季中轉隊的那一年會有兩列。年與齡只寫在第一列——同一年重覆印一次年份，讀起來
  // 像兩個球季，而球隊那一欄已經說清楚這是同一年的後半段了（與畫面上同一個規則）。
  const lead = (r: CareerRow, cont: boolean): string[] => [
    cont ? '' : String(r.year),
    cont ? '' : String(r.age),
    r.note === null ? r.team : `${r.team}・${r.note}`,
  ];
  const tint = (r: CareerRow): CardRow['tint'] =>
    r.injured === null ? null : r.injured === 'minor' ? 'minor' : 'major';

  const tables: CardTable[] = [];
  if (batting.length > 0) {
    tables.push({
      title: '生涯年表',
      caption: '野手',
      head: ['年', '齡', '球隊', '守位', ...BATTING_COLUMNS.map((c) => c.key), 'DEF'],
      lefts: [2],
      rows: batting.map((r, i) => ({
        tint: tint(r),
        cells: [
          ...lead(r, batting[i - 1]?.year === r.year),
          r.position ?? '—',
          ...cells(BATTING_COLUMNS, r.batting!, r.base, r.shares),
          r.defenseRuns > 0 ? `+${r.defenseRuns}` : String(r.defenseRuns),
        ],
      })),
    });
  }
  if (pitching.length > 0) {
    tables.push({
      title: '生涯年表',
      caption: '投手',
      head: ['年', '齡', '球隊', '定位', ...PITCHING_COLUMNS.map((c) => c.key)],
      lefts: [2],
      rows: pitching.map((r, i) => ({
        tint: tint(r),
        cells: [
          ...lead(r, pitching[i - 1]?.year === r.year),
          r.pitcherRole ?? '—',
          ...cells(PITCHING_COLUMNS, r.pitching!, r.base, r.shares),
        ],
      })),
    });
  }

  const totalTable = (
    title: string,
    picked: readonly TotalRow[],
    side: 'batting' | 'pitching',
  ): CardTable | null => {
    const only = picked.filter((r) => r[side] !== null);
    if (only.length === 0) return null;
    return {
      title,
      caption: side === 'batting' ? '野手' : '投手',
      head:
        side === 'batting'
          ? ['聯盟', '季', ...BATTING_COLUMNS.map((c) => c.key), 'DEF']
          : ['聯盟', '季', ...PITCHING_COLUMNS.map((c) => c.key)],
      lefts: [0],
      rows: only.map((r) => ({
        tint: null,
        cells:
          side === 'batting'
            ? [
                r.label,
                String(r.seasons),
                ...cells(BATTING_COLUMNS, r.batting!, r.base, r.shares),
                r.defenseRuns > 0 ? `+${r.defenseRuns}` : String(r.defenseRuns),
              ]
            : [r.label, String(r.seasons), ...cells(PITCHING_COLUMNS, r.pitching!, r.base, r.shares)],
      })),
    };
  };

  const top = summary.leagues.length > 1 ? [topTotalRow(summary)] : [];
  for (const t of [
    totalTable('各聯盟通算', totals, 'batting'),
    totalTable('各聯盟通算', totals, 'pitching'),
    ...(top.length > 0
      ? [totalTable('頂級聯盟通算', top, 'batting'), totalTable('頂級聯盟通算', top, 'pitching')]
      : []),
  ]) {
    if (t !== null) tables.push(t);
  }

  for (const side of ['batting', 'pitching'] as const) {
    const only = summary.internationalSeasons.filter((r) => r[side] !== null);
    if (only.length === 0) continue;
    tables.push({
      title: '國際賽',
      caption: side === 'batting' ? '野手' : '投手',
      head: [
        '年',
        '齡',
        '賽事',
        '名次',
        ...(side === 'batting' ? BATTING_COLUMNS : PITCHING_COLUMNS).map((c) => c.key),
      ],
      lefts: [2, 3],
      rows: only.map((r) => ({
        tint: null,
        cells: [
          String(r.year),
          String(r.age),
          r.tournament,
          `${r.rank}${r.mvp ? '・MVP' : ''}`,
          ...(side === 'batting'
            ? cells(BATTING_COLUMNS, r.batting!, intlBase, null)
            : cells(PITCHING_COLUMNS, r.pitching!, intlBase, null)),
        ],
      })),
    });
  }

  if (summary.internationalSeasons.length > 0) {
    const row = intlTotalRow(summary);
    for (const side of ['batting', 'pitching'] as const) {
      if (row[side] === null) continue;
      tables.push({
        title: '國際賽通算',
        caption: side === 'batting' ? '野手' : '投手',
        head:
          side === 'batting'
            ? ['賽事', '屆', ...BATTING_COLUMNS.map((c) => c.key), 'DEF']
            : ['賽事', '屆', ...PITCHING_COLUMNS.map((c) => c.key)],
        lefts: [0],
        rows: [
          {
            tint: null,
            cells:
              side === 'batting'
                ? [row.label, String(row.seasons), ...cells(BATTING_COLUMNS, row.batting!, row.base, row.shares), '0']
                : [row.label, String(row.seasons), ...cells(PITCHING_COLUMNS, row.pitching!, row.base, row.shares)],
          },
        ],
      });
    }
  }

  // 掛靴的地方：引退之後球團關係已經結束，因此讀 retiredFrom 而不是 pro
  // （見 PlayerState.retiredFrom，記分板也是讀這一份）。
  const at = state.retiredFrom;
  return {
    name: state.origin.name,
    role: roleLabelOf(state),
    hands: `投${hand(state.origin.throws)}打${hand(state.origin.bats)}`,
    age: state.age,
    year: state.year,
    seed: game.setup.seed,
    team: at?.team ?? state.pro?.team ?? '',
    league: at?.levelName ?? state.pro?.levelName ?? '',
    traits: shownTraits(state.traits, state.traitNames).map((t) => ({
      label: t.label,
      bad: t.tone === 'bad',
    })),
    retire: retireText(game.flow.log),
    score: cardLines(game.flow.log, '生涯評價'),
    earnings: cardLines(game.flow.log, '生涯收入'),
    tables,
    honors: honorGroups({
      awards: state.awards,
      honors: state.honors,
      summary,
      love: state.love,
    }),
  };
}

/**
 * 引退之日那張卡的內文。
 *
 * 從事件流裡撈，不跟引擎再要一份——那段文字是抽出來的場景（依代表聯盟與生涯
 * 分級選用），重算一次可能抽到另一則，圖上寫的就不是他那天讀到的那一段了。
 * 卡片內文是 HTML，這裡要還原成純文字。
 */
function retireText(log: readonly LogEntry[]): string | null {
  const body = cardBody(log, '引退之日');
  return body === null ? null : plain(body.replace(/<br\s*\/?>/gi, '\n'));
}

/** 事件流裡最後一張指定標題的卡，還沒去 HTML。 */
function cardBody(log: readonly LogEntry[], title: string): string | null {
  const hit = [...log].reverse().find((e) => e.kind === 'card' && e.title === title);
  return hit === undefined || hit.kind !== 'card' ? null : hit.body;
}

/** 卡片內文還原成純文字。 */
function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 一張卡的內文，逐行拆成圖上要畫的東西。
 *
 * **跟引退之日同一條路：從事件流撈，不跟引擎再要一份。** 圖上寫的就是他結算時
 * 讀到的那幾行，兩邊不可能對不起來；生涯收入也因此不必為了畫圖而多接一條管線。
 *
 * 分行沿用卡片自己的 `<br>`，`<span class="sub">` 那幾行標成小字——那是卡片裡
 * 的層級，不是排版的裝飾。
 */
function cardLines(log: readonly LogEntry[], title: string): CardLine[] {
  const body = cardBody(log, title);
  if (body === null) return [];
  const out: CardLine[] = [];
  for (const raw of body.split(/<br\s*\/?>/i)) {
    const text = plain(raw).trim();
    if (text === '') continue;
    out.push({ text, dim: /class="sub"/i.test(raw) });
  }
  return out;
}

/** 整季沒上場那一年的空白成績列：數字全是 0，率類欄位由欄位定義畫成「-」。 */
const ZERO_BATTING: BattingLine = {
  games: 0, starts: 0, pa: 0, ab: 0, runs: 0, hits: 0, double: 0, triple: 0, hr: 0, rbi: 0,
  bb: 0, ibb: 0, so: 0, sb: 0, cs: 0, hbp: 0, sac: 0, avg: 0, obp: 0, slg: 0,
};
const ZERO_PITCHING: PitchingLine = {
  games: 0, starts: 0, wins: 0, losses: 0, saves: 0, holds: 0, outs: 0, hits: 0, double: 0,
  triple: 0, runs: 0, er: 0, bb: 0, hbp: 0, so: 0, hr: 0, era: 0,
};

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
    pitcherRole: a.pitcherRole,
    batting: a.batting,
    pitching: a.pitching,
    injured: null,
    defenseRuns: 0,
    // 養成期不記份額——那一段不進評價分，也沒有守備與球隊戰績可以算。
    shares: null,
    base: amateurBaseline(),
  }));

  // **整季沒上場的那一年照樣列出來**（開 TJ、整季復健）：出賽 0 場的成績在引擎裡是
  // null，年表以前就整列消失，看起來像那一年不存在。有定位就補一列 0 的投手成績、
  // 有守位就補一列 0 的野手成績；不在任何球隊的那一年，球隊欄寫「無」。
  const proRows: CareerRow[] = summary.seasons.map((s, i) => ({
    key: `pro-${s.year}-${s.level}-${i}`,
    year: s.year,
    age: s.age,
    team: s.team === '' ? '無' : s.team,
    // 頂級聯盟不必註明（那是預設），二軍與小聯盟則只寫層級——聯盟名已經
    // 由同一格的球隊名說完了，「桃園金剛・中職二軍」裡的「中職」是贅字。
    note: s.top === null ? shortLevelName(s.levelName, s.org) : null,
    position: s.position,
    pitcherRole: s.pitcherRole,
    batting: s.batting ?? (s.pitching === null && s.position !== null ? ZERO_BATTING : null),
    pitching: s.pitching ?? (s.batting === null && s.pitcherRole !== null ? ZERO_PITCHING : null),
    injured: s.injured,
    defenseRuns: s.defenseRuns,
    shares: s.shares,
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
    shares: l.sharesByPart,
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
    shares: {
      batting: sumShares(...summary.leagues.map((l) => l.sharesByPart.batting)),
      pitching: sumShares(...summary.leagues.map((l) => l.sharesByPart.pitching)),
      fielding: sumShares(...summary.leagues.map((l) => l.sharesByPart.fielding)),
    },
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
  shares = null,
  defenseRuns,
}: {
  label: string | null;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
  /** 聯盟平均。ERA+／OPS+／WS 都要跟它比。 */
  base: Baseline;
  /** 這一季的三本帳。沒有就退回單側自算。 */
  shares?: SharesByPart | null;
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
                  <td key={c.key}>{c.value(pitching, base, shares)}</td>
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
                  <td key={c.key}>{c.value(batting, base, shares)}</td>
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

/**
 * 姓名旁邊那個守位／定位標籤。記分板與生涯成績圖共用。
 *
 * 寫英文代碼（P＋DH），不寫「投手＋指定打擊」——姓名那一行還要擠慣用手，中文
 * 全稱會把它撐到換行。純投手只寫定位：先發、終結、布局、中繼、長中繼是五種
 * 不同的球員，一個沒有資訊量的 P 說不出他是哪一種。
 */
function roleLabelOf(state: PlayerState): string {
  const pitcherRole = state.pitcherRole ?? 'P';
  if (!state.playsField) return pitcherRole;
  if (state.traits.has('two_way')) return `${pitcherRole}＋${state.position ?? 'DH'}`;
  return state.position ?? 'DH';
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
  // 養成期與二軍寫的是**同一份登錄守位**（ADR 0037）——它從入學那一刻就存在，
  // 起點是玩家選的起始守位，之後每年由守位會議往上或往下調。引擎那邊的出賽勞損
  // 也吃同一個位置，介面不另外算一份。
  //
  // 純投手只寫 P。養成期他的守位欄是 DH（那是打席的落點，成績要標），但姓名旁
  // 寫 P＋DH 會把他說成二刀流——他只是還沒被免除打擊而已。
  // 投手寫**定位**而不是一個沒有資訊量的 P——先發、終結、布局、中繼、長中繼是
  // 五種不同的球員，跟守位一樣每季重新判定。還沒進職業之前沒有牛棚分工，那時
  // 就是 P。
  const roleLabel = roleLabelOf(state);
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
        {/* 身體狀態：耐力只給狀態字、不給數字（ADR 0051）。二刀流兩池各一盞。 */}
        {state.endurance?.fielder != null && (
          <span className="lamp on" title="野手的耐力：守位的消耗扣在這裡，指定打擊是純恢復">
            <i />
            身體 {state.endurance.fielder}
          </span>
        )}
        {state.endurance?.pitcher != null && (
          <span className="lamp on" title="投手的耐力：投球局數扣在這裡；耗盡要開 TJ">
            <i />
            手臂 {state.endurance.pitcher}
          </span>
        )}
        {state.honors.length > 0 && (
          // 清單掛在滑鼠停留的提示上。生涯累積下來會有十幾項，攤在版面上會把
          // 記分板撐開，而它們平常並不需要被讀。
          <span className="lamp on honors" title={sortHonors(state.honors).join('\n')}>
            <i />
            榮譽 {state.honors.length}
          </span>
        )}
      </div>
      {/* 特性接在 SEED 那排下面。**這一份只有手機看得到**（桌面由右欄的成績
          面板負責，見 app.css）：手機把成績面板整塊收掉，狀態得有地方去，而
          記分板是釘在畫面頂端、兩頁都看得到的那一塊。
          同一個 `TraitList`，只是不帶「狀態」小標——這一帶（年薪、SEED、榮譽）
          本來就沒有小標。 */}
      <div id="bd-traits">
        <TraitList traits={state.traits} names={state.traitNames} notes={state.traitNotes} tags={relationTags(state)} heading={false} />
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
        <TraitList traits={state.traits} names={state.traitNames} notes={state.traitNotes} tags={relationTags(state)} />
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
  // 連發要綁在「這一列現在還能不能點」上。放掉手指時這一列可能已經因為加點
  // 而變成不可點（沒有 option 了），pointerup 就落在一個沒有 handler 的
  // element 上，計時器會活過整個階段，下一輪骰子一發出來全灌進這條能力
  // （problems #55）。
  const repeat = useHold(option !== undefined && option.disabled !== true);
  const current = state.ability[abilityKey] ?? 0;
  const carry = state.carry[abilityKey] ?? 0;
  const bonus = state.ceilingBonus[abilityKey] ?? 0;
  // 天花板一律問引擎要。這裡曾經拿 origin.potential 自己加 ceilingBonus，漏掉了
  // 「天生神力」那類天賦加成（最高 +10），於是收錢按 80 收、畫面卻寫 70
  // （problems.txt #56）。合成規則歸引擎，前端只負責畫。
  const ceiling = state.ceiling[abilityKey] ?? 0;
  // 天花板被事件頂過量表上限的那幾項（最多 +5，見 abilities.json 的
  // max_ceiling_bonus）。刻度不為它們伸縮，改用底色與 marker 標示。
  const overScale = ceiling > abilities.scale.max;
  // 與舊版一致的表達方式：蓄力／這一級所需點數，例如 0/2。成本 1 點時不顯示。
  // 欠點另外標一個「欠」字：分母跟著換成退一級退回來的錢，只寫負號會讀成
  // 「存了 -1 點」。
  const curve = growthCurve(state.traits.has('two_way'), state.age, abilityKey);
  const gauge = carryGauge(current, ceiling, carry, curve);
  const cost = abilityCost(current, ceiling, curve);

  // 量表刻度固定 20–80，**任何情況都不伸縮**。尾端會跟著上限提升而變長的話，
  // 同一條能力在事件前後長度不同、十幾條之間也互相對不齊，玩家沒辦法一眼橫著
  // 掃完一整欄。破 80 的部分寧可畫成滿條，由分母的數字去講完剩下的事。
  const head = abilities.scale.min;
  const tail = abilities.scale.max;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - head) / (tail - head)) * 100));

  // 已達上限的能力是「看得到、按不動」：仍然列在那裡（玩家要能看見自己的
  // 天花板），但不掛任何點擊或長按。之前只看 option 存不存在，於是滿級的列
  // 照樣可以按下去，engine 那邊 choose() 對 disabled 選項是丟例外的——畫面
  // 沒有任何反應，點數也不會少，看起來就是「卡在同一步」。
  const allocating = option !== undefined && option.disabled !== true;

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
        {/* 分母是這一項真正的天花板。原本固定寫 80，於是所有能力看起來都一樣有
            前途，玩家得靠 marker 的位置目測自己的潛力——而那道線只有兩像素。
            分子超過分母（例如 74/70）就是已經踩進加價區，那個寫法本身就是提示，
            不再另外上色。 */}
        <small style={{ opacity: 0.5 }} title={`潛力天花板 ${ceiling}`}>
          /{ceiling}
        </small>
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
      <div
        className={`abrow${option !== undefined ? ' capped' : ''}${overScale ? ' over' : ''}`}
        // 分配中卻不能點的列，把 engine 給的理由（已達上限）直接掛上去，
        // 不要退回那條泛用的量表說明。
        title={option?.note ?? `${head}–${tail}${bonus > 0 ? `（上限已提升 +${bonus}）` : ''}`}
      >
        {row}
      </div>
    );
  }

  return (
    <div
      className={`abrow pickable${overScale ? ' over' : ''}`}
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
 *
 * `active` 轉 false 也停：見 problems #55——放手時那一列可能已經沒有
 * handler 了，光靠 pointerup 收不乾淨。
 */
function useHold(
  active = true,
  delay = 400,
  every = 90,
): { start: (fn: () => void) => void; stop: () => void } {
  const timers = useRef<{ start?: number; tick?: number }>({});

  const stop = () => {
    window.clearTimeout(timers.current.start);
    window.clearInterval(timers.current.tick);
    timers.current = {};
  };

  useEffect(() => stop, []);
  // 元件還在、但已經不該連發了（選項消失或反灰）也要收掉：卸載不是唯一的
  // 結束方式，這一列多半是原地重繪的。
  useEffect(() => {
    if (!active) stop();
  }, [active]);

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
