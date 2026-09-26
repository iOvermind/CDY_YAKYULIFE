import { useRef, useState } from 'react';
import { ApiError, type CareerTicket, type Me } from '../../api/contract.ts';
import { withTimeout } from '../../api/gate.ts';
import { abilities, amateur, type Hand, START_POSITION_ROWS, type StartPosition } from '../../data/index.ts';
import { stageOf } from '../../engine/amateur.ts';
import { type CareerProgress, Game, NO_PROGRESS } from '../../engine/game.ts';
import { clampName } from '../../engine/playerName.ts';
import { blockedByHand } from '../../engine/rating.ts';
import { newSeed } from '../../engine/rng.ts';
import { AccountBar, Modal } from '../account/Account.tsx';
import type { Account } from '../account/useAccount.ts';
import { HAND_LABEL } from '../player/profile.ts';
import styles from './StartScreen.module.css';
import controls from '../common/controls.module.css';
import modal from '../common/modal.module.css';

const THEMES = [
  { code: 'a', name: '科技藍' },
  { code: 'b', name: '電子看板' },
  { code: 'c', name: '報紙版面' },
  { code: 'd', name: '現代儀表板' },
] as const;

export function StartScreen({
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

  /** 開局登記沒成功時，擋下來讓玩家選：重試，或照樣開一局不入帳的。 */
  const [refused, setRefused] = useState<string | null>(null);
  /** 帳號還沒讀回來就不能開局：已登入的人會帶不到天賦（issue #59）。 */
  const loading = account.progress.kind === 'loading';

  /**
   * 用這一組天賦開局。`ticket` 是 null 就是**不入帳的局**。
   *
   * 天賦優先用伺服器凍結的那一組（`ticket.talents`）——驗證時算數的是它。沒有
   * 開局票時**不能退回「沒有天賦」**：玩家買了突破極限卻在天花板外照付三倍價，
   * 畫面上沒有任何提示，那一局就是靜靜地變難了（實際發生過：API 沒起來，同一
   * 個存檔 6X 能力要 18 點蓄力，隔一局同樣的天賦只要 10 點）。
   *
   * 「這一局不入帳」與「這一局沒有天賦」是兩件事。不入帳的局本來就不會拿去
   * 驗證，用本機那份 `me.talents` 開下去是安全的。
   */
  const launch = (me: Me | null, ticket: CareerTicket | null) => {
    const setup = { seed, name: clampName(name.trim()) || '無名氏', startPosition, throws, bats };
    const progress: CareerProgress =
      me === null
        ? NO_PROGRESS
        : {
            firstCareer: me.achievements.length === 0,
            unlocked: new Set(me.achievements.map((a) => a.id)),
          };
    const talents = ticket?.talents ?? me?.talents ?? {};
    const game = new Game({ ...setup, talents }, progress).start();
    onStart(game, ticket?.careerId ?? null);
  };

  /**
   * 開局。
   *
   * 登入時**先向伺服器登記**，拿回它凍結的那一組天賦——天賦可以退款，「玩家現在
   * 擁有什麼」與「這一局帶著什麼」是兩件事，而驗證時算數的是伺服器凍結的那一組
   * （見 ADR 0007）。
   *
   * 登記失敗（包含逾時）不默默開局：這一局不入帳是玩家在意的代價，讓他自己選
   * 要重試還是照樣開局。**不能因為伺服器打嗝就不讓人玩**，所以「照樣開局」永遠
   * 在那裡。
   */
  const begin = () => {
    if (starting || loading) return;
    const me = account.progress.kind === 'signed-in' ? account.progress.me : null;
    if (me === null) {
      launch(null, null);
      return;
    }
    setStarting(true);
    setRefused(null);
    withTimeout(account.store.startCareer()).then(
      (ticket) => launch(me, ticket),
      (e: unknown) => {
        console.warn('[career] 開局登記失敗', e);
        setRefused(e instanceof ApiError ? e.message : '伺服器沒有回應。');
        setStarting(false);
      },
    );
  };

  return (
    <div id="start" className={styles.start}>
      <AccountBar account={account} />
      <div className={styles.wrap}>
        <h1>
          <em>棒球人生模擬器</em>
        </h1>
        <p className={styles.tagline}>國中、高中六年養成 → 選秀・旅外 → 國際賽 → 衰退與引退。每一顆骰子都算數。</p>

        <div className={controls.field}>
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

        <div className={controls.field}>
          <label>起始守位</label>
          {/* 三列：投捕與不定、內野、外野。每列都是四格的網格，不足四個就空著
              ——按鈕寬度因此與「打擊慣用手」那幾組完全一致，整個開局畫面看起來
              才是同一套元件。 */}
          <div className={styles.poslist}>
            {START_POSITION_ROWS.map((row, i) => (
              <div key={i} className={controls.seg}>
                {row.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={p === startPosition ? controls.on : undefined}
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

        <div className={controls.field}>
          <label>投球慣用手</label>
          <div className={controls.seg}>
            {abilities.handedness.selectable.throws.map((h) => (
              <button
                key={h}
                type="button"
                className={h === throws ? controls.on : undefined}
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

        <div className={controls.field}>
          <label>打擊慣用手</label>
          <div className={controls.seg}>
            {abilities.handedness.selectable.bats.map((h) => (
              <button
                key={h}
                type="button"
                className={h === bats ? controls.on : undefined}
                onClick={() => setBats(h)}
              >
                {HAND_LABEL[h]}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 6, lineHeight: 1.6 }}>
            左投與左打在棒球裡有結構性優勢，對價是**兩把尺一起降**：他被拿來比的門檻
            （升降級、戰力外、簽約、守位、國家隊徵召）整條下移，代價是潛力打折。
            左右開弓更深一檔。獎項與生涯評價分吃的是聯盟真尺，不受折扣影響——那是比較，
            比較必須全聯盟同一條線。
          </p>
        </div>

        <div className={controls.field}>
          <label>佈景主題</label>
          <div className={controls.seg}>
            {THEMES.map((t) => (
              <button
                key={t.code}
                type="button"
                className={t.code === theme ? controls.on : undefined}
                onClick={() => onTheme(t.code)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className={`${controls.btn} ${controls.main}`}
          style={{ marginTop: 28 }}
          disabled={starting || loading}
          onClick={begin}
        >
          {/* 起點的學年與季節都從資料來——寫死會像先前那樣，養成期擴成六年之後
              按鈕還停在「高一春天」。 */}
          {loading
            ? '讀取帳號中…'
            : starting
              ? '開局登記中…'
              : `開始生涯 ▸ ${stageOf('JHS').year_labels[0]}${amateur.career_start.season}`}
        </button>

        {refused !== null && (
          <Modal title="開局登記失敗" onClose={() => setRefused(null)}>
            <p className={modal.modalError}>{refused}</p>
            <p className={modal.modalNote}>
              照樣開局的話，這一局帶著你的天賦照常進行，但不計入天梯，也不結算 AP。
            </p>
            <div className={controls.seg} style={{ marginTop: 16 }}>
              <button type="button" className={controls.on} onClick={begin}>
                重試
              </button>
              <button
                type="button"
                onClick={() => {
                  const me = account.progress.kind === 'signed-in' ? account.progress.me : null;
                  setRefused(null);
                  launch(me, null);
                }}
              >
                照樣開局（不入帳）
              </button>
            </div>
          </Modal>
        )}

        <p className={styles.seedline}>
          世界種子{' '}
          <input
            id="seed-show" className={styles.seedShow}
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
          相同版本下，相同種子＋相同選擇＝相同人生（可直接輸入朋友的種子碼）
        </p>
      </div>
    </div>
  );
}
