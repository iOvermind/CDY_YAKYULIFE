import { useEffect, useState } from 'react';
import './app.css';
import { abilities, ALL_ABILITIES, START_POSITIONS, type StartPosition } from './data/index.ts';
import { createPlayer, type NewPlayer } from './engine/genesis.ts';
import { newSeed, World } from './engine/rng.ts';

/**
 * 開局生成的垂直切片。
 *
 * 樣式在 app.css（自 index_legacy.html 抽出，主題 a 改為科技藍），版型比照
 * 原版的開局畫面 #start，讓整體結構與原版一致。介面規格見 INTERFACE.md。
 *
 * 這一頁同時穿過亂數層（genesis 子序列）、規則資料載入層，以及球員的狀態
 * 模型——輸入同一個種子必定得到同一位球員。
 */

const THEMES = [
  { code: 'a', name: '科技藍' },
  { code: 'b', name: '電子看板' },
  { code: 'c', name: '報紙版面' },
  { code: 'd', name: '現代儀表板' },
] as const;

const HAND_LABEL: Record<string, string> = { R: '右', L: '左', S: '左右開弓' };

export default function App() {
  const [name, setName] = useState('');
  const [start, setStart] = useState<StartPosition>('P');
  const [theme, setTheme] = useState('a');
  const [seed, setSeed] = useState(newSeed());
  const [player, setPlayer] = useState<NewPlayer | null>(null);

  // 主題掛在 body 上，與原版一致（body[data-theme]）。寫 DOM 是副作用，
  // 必須放在 effect 裡——直接寫在 render 中在 StrictMode 下會執行兩次。
  useEffect(() => {
    document.body.dataset['theme'] = theme;
  }, [theme]);

  const generate = () => setPlayer(createPlayer(new World(seed), name.trim() || '無名氏', start));

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
                className={p === start ? 'on' : undefined}
                onClick={() => setStart(p)}
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
                onClick={() => setTheme(t.code)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="btn main" style={{ marginTop: 28 }} onClick={generate}>
          擲出球員 ▸ 高一春天
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

        {player && <PlayerCard player={player} />}
      </div>
    </div>
  );
}

function PlayerCard({ player }: { player: NewPlayer }) {
  const tierLabel = ['', '名門', '中堅', '弱旅'][player.schoolTier] ?? '';
  const { pitching, hitting, fielding, shared } = abilities.ability_groups;

  return (
    <div className="card" style={{ marginTop: 22 }}>
      <h4>
        {player.name}／{abilities.start_positions[player.startPosition]}
      </h4>
      <p className="statline">
        {player.year} 年 · {player.age} 歲 · {player.school}
        {tierLabel && `（${tierLabel}）`} · 投{HAND_LABEL[player.throws]} 打
        {HAND_LABEL[player.bats]}
      </p>

      <AbilityBlock title="投球" keys={[...shared, ...pitching]} player={player} />
      <AbilityBlock title="打擊" keys={hitting} player={player} />
      <AbilityBlock title="守備" keys={fielding} player={player} />

      <p className="divider">開局生成</p>
      <p style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6 }}>
        每位球員都擁有全部 {ALL_ABILITIES.length} 項能力，起始守位只影響天賦的機率加權。
        數字為目前能力，括號內為潛力天花板。
      </p>
    </div>
  );
}

function AbilityBlock({
  title,
  keys,
  player,
}: {
  title: string;
  keys: readonly string[];
  player: NewPlayer;
}) {
  const max = abilities.scale.max;

  return (
    <>
      <p className="divider">{title}</p>
      {keys.map((key) => {
        const current = player.ability[key] ?? 0;
        const ceiling = player.potential[key] ?? 0;
        return (
          <div className="abrow" key={key}>
            <span className="nm">{abilities.abilities[key] ?? key}</span>
            <span className="bar">
              <i style={{ width: `${(current / max) * 100}%` }} />
              <em style={{ left: `${(ceiling / max) * 100}%` }} />
            </span>
            <span className="val">
              {current} <b>({ceiling})</b>
            </span>
          </div>
        );
      })}
    </>
  );
}
