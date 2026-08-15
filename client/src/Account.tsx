/**
 * 帳號、成就與天賦商店的介面。
 *
 * 從 App.tsx 拆出來是因為它有自己的一整組狀態機（未登入／登入中／已登入／
 * 連不上），塞回開局畫面會讓那個檔案再也讀不動。
 *
 * **這一層不做任何判定**：AP 夠不夠、天賦幾級、成就有沒有解鎖，全部由伺服器
 * 決定，這裡只把 `Me` 畫出來、把玩家的動作送回去（見 ADR 0007）。前端自己算
 * 一份會與伺服器分岔，而分岔的那一份一定是錯的那一份。
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, isOffline, type Me, type ProgressStore } from './api/contract.ts';
import { talents as talentData } from './data/index.ts';
import { costOf, maxLevelOf } from './engine/overlay.ts';

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
      });
    return () => {
      alive = false;
    };
  }, [store]);

  const update = useCallback((me: Me) => setProgress({ kind: 'signed-in', me }), []);
  const signOut = useCallback(async () => {
    await store.logout().catch(() => undefined);
    setProgress({ kind: 'anonymous' });
  }, [store]);

  return { progress, store, update, signOut };
}

/** 開局畫面右上角。 */
export function AccountBar({ account }: { account: Account }) {
  const [panel, setPanel] = useState<'login' | 'achievements' | null>(null);
  const { progress } = account;
  const me = progress.kind === 'signed-in' ? progress.me : null;
  const offline = progress.kind === 'offline';

  // 還在問「我是誰」的那一瞬間先不畫。**只有這個狀態隱藏**——連不上伺服器時
  // 仍然要畫出來反灰，不然單機執行（Vite dev、Tauri、GitHub Pages）的人會
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
          title={offline ? OFFLINE_HINT : me === null ? '登入後才看得到成就與天賦商店' : undefined}
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
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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

/** 成就櫃與天賦商店。 */
function AchievementPanel({
  account,
  me,
  onClose,
}: {
  account: Account;
  me: Me;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'achievements' | 'shop'>('achievements');

  return (
    <Modal title={`${me.account} · ${me.ap} AP`} onClose={onClose}>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={tab === 'achievements' ? 'on' : undefined}
          onClick={() => setTab('achievements')}
        >
          成就 {me.achievements.length}
        </button>
        <button
          type="button"
          className={tab === 'shop' ? 'on' : undefined}
          onClick={() => setTab('shop')}
        >
          天賦商店
        </button>
      </div>
      {tab === 'achievements' ? (
        <AchievementList me={me} />
      ) : (
        <TalentShop account={account} me={me} />
      )}
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

  // 依分類分組，但**組內維持伺服器給的順序**（最新的在前）——玩家開這個面板
  // 多半是想看剛才那一局拿到什麼。
  const groups = new Map<string, Me['achievements'][number][]>();
  for (const a of me.achievements) {
    const list = groups.get(a.category);
    if (list === undefined) groups.set(a.category, [a]);
    else list.push(a);
  }

  return (
    <>
      <p className="modal-note">
        生涯累積 {me.apEarned} AP，目前可用 {me.ap} AP。同一項成就只給一次點數。
      </p>
      {[...groups.entries()].map(([category, items]) => (
        <div key={category} className="achgroup">
          <h3>
            {category}
            <span className="sub">
              {items.reduce((sum, a) => sum + a.points, 0)} AP
            </span>
          </h3>
          <ul>
            {items.map((a) => (
              <li key={a.id}>
                <span className="achname">{a.name}</span>
                <span className="sub">{DATE.format(new Date(a.at))}</span>
                <span className="achpts">+{a.points}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

/**
 * 天賦商店。
 *
 * **整份畫面是從 `talents.json` 長出來的**——新增一個天賦只要加一筆 JSON，這裡
 * 一行都不用改。分組、名稱、每一級的敘述與價格全部來自資料。
 */
function TalentShop({ account, me }: { account: Account; me: Me }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = (id: string, go: (id: string) => Promise<Me>) => {
    if (busy !== null) return;
    setBusy(id);
    setError(null);
    void go(id)
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

      {[...groups.entries()].map(([group, items]) => (
        <div key={group} className="achgroup">
          <h3>{group}</h3>
          {items.map((t) => {
            const level = me.talents[t.id] ?? 0;
            const max = maxLevelOf(t.id);
            const next = t.levels[level];
            const affordable = next !== undefined && me.ap >= next.cost;
            return (
              <div key={t.id} className={level > 0 ? 'talent owned' : 'talent'}>
                <div className="talent-head">
                  <b>{t.name}</b>
                  <span className="sub">
                    {level} / {max}
                  </span>
                </div>
                <p className="talent-desc">{t.desc}</p>
                <ol className="talent-levels">
                  {t.levels.map((l, i) => (
                    <li key={i} className={i < level ? 'have' : undefined}>
                      {l.effect_text}
                      <span className="sub">{l.cost} AP</span>
                    </li>
                  ))}
                </ol>
                <div className="talent-buttons">
                  {next === undefined ? (
                    <span className="sub">已經點滿</span>
                  ) : (
                    <button
                      type="button"
                      className={affordable ? 'on' : undefined}
                      disabled={!affordable || busy !== null}
                      onClick={() => act(t.id, account.store.buyTalent)}
                    >
                      {level === 0 ? '解鎖' : `升到 Lv${level + 1}`}
                      <span className="price">{next.cost} AP</span>
                    </button>
                  )}
                  {level > 0 && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => act(t.id, account.store.refundTalent)}
                      title={`退掉全部 ${level} 級，返還 ${costOf(t.id, level)} AP`}
                    >
                      退還 {costOf(t.id, level)} AP
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
