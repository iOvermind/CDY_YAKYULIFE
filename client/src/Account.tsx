/**
 * 帳號、成就與天賦的介面。
 *
 * 從 App.tsx 拆出來是因為它有自己的一整組狀態機（未登入／登入中／已登入／
 * 連不上），塞回開局畫面會讓那個檔案再也讀不動。
 *
 * **這一層不做任何判定**：AP 夠不夠、天賦幾級、成就有沒有解鎖，全部由伺服器
 * 決定，這裡只把 `Me` 畫出來、把玩家的動作送回去（見 ADR 0007）。前端自己算
 * 一份會與伺服器分岔，而分岔的那一份一定是錯的那一份。
 *
 * **這個檔案只放元件。** `useAccount` 與型別在 `useAccount.ts`——一個模組同時
 * export hook 與元件的話 Fast Refresh 會整包放棄（見那個檔案開頭）。
 */

import { useEffect, useState } from 'react';
import { Changelog } from './Changelog.tsx';
import { Ladder } from './Ladder.tsx';
import { partnerOf } from './engine/love.ts';
import { type Account } from './useAccount.ts';
import { ApiError, type Me } from './api/contract.ts';
import { talents as talentData } from './data/index.ts';
import { cabinetSections, cabinetTiles } from './engine/achievements.ts';
import { maxLevelOf } from './engine/overlay.ts';

/** 開局畫面右上角。 */
export function AccountBar({ account }: { account: Account }) {
  const [panel, setPanel] = useState<'login' | 'achievements' | null>(null);
  const { progress } = account;
  const me = progress.kind === 'signed-in' ? progress.me : null;
  const offline = progress.kind === 'offline';

  // 還在問「我是誰」的那一瞬間先不畫。**只有這個狀態隱藏**——連不上伺服器時
  // 仍然要畫出來反灰，不然只跑前端的人（例如 `npm run dev` 沒開伺服器）會
  // 以為功能根本沒做，而不是「這個版本沒接上伺服器」。
  if (progress.kind === 'loading') return null;

  const OFFLINE_HINT = '這個版本沒有連上伺服器，帳號與成就功能無法使用。';

  return (
    <>
      <div className="accountbar">
        <button
          type="button"
          className="ghost"
          // 未登入時反灰：成就是掛在帳號上的，沒有帳號就沒有東西可看。
          disabled={me === null}
          title={offline ? OFFLINE_HINT : me === null ? '登入後才看得到成就與天賦' : undefined}
          onClick={() => setPanel('achievements')}
        >
          成就{me !== null && <span className="ap">{me.ap} AP</span>}
        </button>
        {me === null ? (
          <button
            type="button"
            className="ghost"
            disabled={offline}
            title={offline ? OFFLINE_HINT : undefined}
            onClick={() => setPanel('login')}
          >
            {offline ? '離線' : '登入'}
          </button>
        ) : (
          <button type="button" className="ghost" onClick={() => void account.signOut()}>
            {me.account} · 登出
          </button>
        )}
      </div>

      {panel === 'login' && <LoginPanel account={account} onClose={() => setPanel(null)} />}
      {panel === 'achievements' && me !== null && (
        <AchievementPanel account={account} me={me} onClose={() => setPanel(null)} />
      )}
    </>
  );
}

/** 遮罩。點空白處或按 Esc 關掉。 */
/**
 * 浮動視窗。
 *
 * `wide` 是給成就櫃那一張用的：它底下三個分頁的內容都要排兩欄（成就與天賦靠
 * `column-count`，天梯是野手／投手左右並排再各自兩欄），窄框塞不下。**寬度給整張
 * 視窗而不是給某個分頁**——切分頁時視窗橫向跳一下比多留一點白邊難看得多。登入框
 * 維持窄的：一排輸入欄拉到 1200px 只會變成一條。
 */
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={wide ? 'modal wide' : 'modal'} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            關閉
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * 登入與註冊。
 *
 * 同一個表單兩顆按鈕——**註冊不需要任何驗證**（沒有信箱、沒有驗證信），因此把
 * 註冊做成另一個流程只是多一道沒有內容的手續。
 */
function LoginPanel({ account, onClose }: { account: Account; onClose: () => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (mode: 'login' | 'register') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const call = mode === 'login' ? account.store.login : account.store.register;
    void call(name, password)
      .then((me) => {
        account.update(me);
        onClose();
      })
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : '出了點問題，請再試一次。');
        setBusy(false);
      });
  };

  return (
    <Modal title="帳號" onClose={onClose}>
      <p className="modal-note">
        成就與天賦是跨生涯累積的，因此要有個地方記著它們。這裡不收信箱、不寄驗證信
        ——取個名字、設個密碼就開始。
      </p>
      <form
        className="loginform"
        onSubmit={(e) => {
          e.preventDefault();
          submit('login');
        }}
      >
        <div className="field">
          <label htmlFor="acc-name">帳號</label>
          <input
            id="acc-name"
            autoComplete="username"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="acc-pw">密碼</label>
          <input
            id="acc-pw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error !== null && <p className="modal-error">{error}</p>}
        <div className="seg" style={{ marginTop: 16 }}>
          <button type="submit" className="on" disabled={busy}>
            登入
          </button>
          <button type="button" disabled={busy} onClick={() => submit('register')}>
            註冊新帳號
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 成就櫃與天賦。 */
function AchievementPanel({
  account,
  me,
  onClose,
}: {
  account: Account;
  me: Me;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'achievements' | 'talents' | 'ladder' | 'changelog'>(
    'achievements',
  );
  // 天梯的兩種範圍。個人是預設——玩家打開這一頁最先想看的是自己。
  const [self, setSelf] = useState(true);

  return (
    <Modal title={`${me.account} · ${me.ap} AP`} onClose={onClose} wide>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={tab === 'achievements' ? 'on' : undefined}
          onClick={() => setTab('achievements')}
        >
          {/* 數的是收斂後的格數——500／1000／1500 安是一格，不是三格。 */}
          成就 {cabinetTiles(me.achievements).length}
        </button>
        <button
          type="button"
          className={tab === 'talents' ? 'on' : undefined}
          onClick={() => setTab('talents')}
        >
          天賦
        </button>
        <button
          type="button"
          className={tab === 'ladder' ? 'on' : undefined}
          onClick={() => setTab('ladder')}
        >
          天梯
        </button>
        {/*
          更新紀錄排在最右邊。前三個分頁是「這個帳號有什麼」，這一個是「這個遊戲
          變成什麼樣了」——不同的問題，所以放在隊伍尾巴而不是插進中間。
        */}
        <button
          type="button"
          className={tab === 'changelog' ? 'on' : undefined}
          onClick={() => setTab('changelog')}
        >
          更新
        </button>
      </div>
      {tab === 'ladder' && (
        // 個人／全伺服器是同一份資料的兩種查法，不是兩張榜（ADR 0038）。
        <div className="seg" style={{ marginBottom: 12 }}>
          <button type="button" className={self ? 'on' : undefined} onClick={() => setSelf(true)}>
            我的
          </button>
          <button type="button" className={self ? undefined : 'on'} onClick={() => setSelf(false)}>
            全伺服器
          </button>
        </div>
      )}
      {tab === 'achievements' && <AchievementList me={me} />}
      {tab === 'talents' && <TalentPanel account={account} me={me} />}
      {tab === 'ladder' && <Ladder account={account} self={self} />}
      {tab === 'changelog' && <Changelog />}
    </Modal>
  );
}

const DATE = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium' });

function AchievementList({ me }: { me: Me }) {
  if (me.achievements.length === 0) {
    return (
      <p className="modal-note">
        還沒有解鎖任何成就。打完一段生涯就會結算——<b>就算打得很差也可能拿到</b>，
        累積型的成就看的是總量，不是高度。
      </p>
    );
  }

  // 階梯收斂成一格、分組與順序固定（見 ADR 0031）——判定全部在 engine，這裡只畫。
  const sections = cabinetSections(me.achievements);

  return (
    <>
      <p className="modal-note">
        生涯累積 {me.apEarned} AP，目前可用 {me.ap} AP。同一項成就只給一次點數，
        <b>同一座階梯只佔一格</b>——顯示的是爬到的最高一階。
      </p>
      {/* 分類排兩欄。用多欄而不是格線，理由見 app.css 的 `.twocol`：多欄的閱讀順序
          是「左欄由上往下、再跳右欄」，正好保住 ADR 0031 釘的固定排序。 */}
      <div className="twocol">
        {sections.map((s) => (
          <div key={s.key} className="achgroup">
            <h3>
              {s.title}
              <span className="sub">{s.points} AP</span>
            </h3>
            {s.groups.map((g) => (
              <div key={g.title ?? '-'} className="achsub">
                {/* 小標只有在大標底下真的分得出兩堆時才出現（聯盟＝獎項＋累積）。 */}
                {g.title !== null && <h4>{g.title}</h4>}
                {/* 小方塊而不是逐條列——櫃子是拿來一眼掃過的，不是拿來讀的。點數與
                    日期收進 tooltip，需要的人再問。 */}
                <ul className="achtiles">
                  {g.items.map((a) => (
                    <li
                      key={a.id}
                      title={`+${String(a.points)} AP · ${DATE.format(new Date(a.at))}`}
                    >
                      {a.name}
                      {/* 姻緣那一格底下接她的側寫。收藏櫃問的是「這一生遇過誰」，
                          而那一句話正是你當初選她的理由。 */}
                      {partnerOf(a.name) !== null && (
                        <span className="sub">{partnerOf(a.name)?.desc}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * 天賦。
 *
 * **整份畫面是從 `talents.json` 長出來的**——新增一個天賦只要加一筆 JSON，這裡
 * 一行都不用改。分組、名稱、每一級的敘述與價格全部來自資料。
 */
function TalentPanel({ account, me }: { account: Account; me: Me }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * 送出「這個天賦要變成幾級」。**畫面上的按鈕只是把目標級數算出來**——加價、退錢
   * 都是伺服器的事，這裡不重算一次價格，兩邊的算法就不可能對不起來。
   */
  const act = (id: string, level: number) => {
    if (busy !== null) return;
    setBusy(id);
    setError(null);
    void account.store
      .setTalent(id, level)
      .then(account.update)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : '出了點問題，請再試一次。'),
      )
      .finally(() => setBusy(null));
  };

  const groups = new Map<string, (typeof talentData.talents)[number][]>();
  for (const t of talentData.talents) {
    const list = groups.get(t.group);
    if (list === undefined) groups.set(t.group, [t]);
    else list.push(t);
  }

  return (
    <>
      <p className="modal-note">
        買下的天賦<b>永久啟用</b>，每一段新生涯都帶著。隨時可以退掉，AP 全額返還——
        但<b>已經開始的生涯用的是開局時凍結的那一組</b>，中途退掉不會影響它。
      </p>
      {error !== null && <p className="modal-error">{error}</p>}

      {/* 分組排兩欄，與成就櫃同一套：「成長」那六張卡不會被切成左三右三，欄高由
          瀏覽器平衡，落單的那一組留在左欄。順序在 talents.json 裡就定好了，多欄的
          由上往下、再跳右欄正好保住它。 */}
      <div className="twocol">
        {[...groups.entries()].map(([group, items]) => (
          <div key={group} className="achgroup">
            <h3>{group}</h3>
            {items.map((t) => {
              const level = me.talents[t.id] ?? 0;
              const max = maxLevelOf(t.id);
              const next = t.levels[level];
              const canBuy = next !== undefined && me.ap >= next.cost;
              const short = next === undefined ? 0 : next.cost - me.ap;
              // 降一級退的就是「爬上這一級付的那一筆」——全額，沒有價差。
              const prev = level > 0 ? (t.levels[level - 1]?.cost ?? 0) : 0;
              // 每一級的效果收進 tooltip：常態攤開來的話，一整頁天賦會變成一面
              // 讀不完的規格表，而玩家在這一頁要做的決定只有「買不買」。
              const tip = t.levels
                .map((l, i) => `Lv${i + 1} ${l.effect_text}（${l.cost} AP）`)
                .join('\n');
              return (
                /*
                  **整張卡片就是控制項**：左鍵升一級、右鍵降一級。兩顆鍵互為反向
                  操作——玩家在自己的存檔上按出來的每一步，都要能用另一顆鍵原地
                  還原。等級只能一級一級走，價格由伺服器算；這裡只送目標級數。
                */
                <button
                  type="button"
                  key={t.id}
                  className={`talent${level > 0 ? ' owned' : ''}${canBuy || next === undefined ? '' : ' broke'}`}
                  /*
                    **買不起但退得掉的時候不能 disable**：`disabled` 的按鈕收不到
                    `contextmenu`，玩家會被鎖在一個退不回來的等級上。那種卡片只反灰
                    （`.broke`），右鍵照樣退錢；真的什麼都不能做的才 disable。
                  */
                  disabled={busy !== null || (level === 0 && !canBuy)}
                  title={`${tip}\n\n左鍵升一級、右鍵降一級${canBuy || next === undefined ? '' : `\nAP 不夠，還差 ${String(short)} 點`}`}
                  onClick={() => {
                    if (canBuy) act(t.id, level + 1);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (level > 0) act(t.id, level - 1);
                  }}
                >
                  <div className="talent-head">
                    <b>{t.name}</b>
                    <span className="sub">
                      {level} / {max}
                    </span>
                  </div>
                  <p className="talent-desc">{t.desc}</p>
                  {/* 一條從左到右的進度，不是一格一格的刻度——玩家要看的是「還有
                      多遠」，切成格子反而要先數格子才讀得出來。 */}
                  <div className="talent-bar">
                    <span
                      className="fill"
                      style={{ width: `${String(max === 0 ? 0 : (level / max) * 100)}%` }}
                    />
                  </div>
                  <span className="talent-hint">
                    {next === undefined ? (
                      '已經點滿'
                    ) : (
                      <>
                        升到 Lv{level + 1} 需
                        <b className={canBuy ? 'price on' : 'price'}>{next.cost} AP</b>
                        {/* 差多少要寫在卡片上：反灰只說得出「不行」，說不出「還差幾點」。 */}
                        {!canBuy && `（還差 ${String(short)}）`}
                      </>
                    )}
                    {level > 0 && `・右鍵退回 Lv${level - 1}，返還 ${prev} AP`}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
