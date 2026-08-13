import { useState } from 'react';
import './App.css';
import { abilities, ALL_ABILITIES, START_POSITIONS, type StartPosition } from './data/index.ts';
import { createPlayer, type NewPlayer } from './engine/genesis.ts';
import { newSeed, World } from './engine/rng.ts';

const HAND_LABEL: Record<string, string> = { R: '右', L: '左', S: '左右開弓' };

/**
 * 開局生成的垂直切片。
 *
 * 這一頁的用途是驗證架構——它同時穿過亂數層（genesis 子序列）、規則資料
 * 載入層，以及球員的狀態模型。輸入同一個種子必定得到同一位球員。
 *
 * 介面刻意保持樸素：INTERFACE.md 記載視覺將改為科技藍主題，現在做樣式會白做。
 */
export default function App() {
  const [name, setName] = useState('王小明');
  const [start, setStart] = useState<StartPosition>('SS');
  const [seed, setSeed] = useState(newSeed());
  const [player, setPlayer] = useState<NewPlayer | null>(null);

  const generate = () => setPlayer(createPlayer(new World(seed), name.trim() || '無名氏', start));

  return (
    <main className="genesis">
      <h1>開局生成</h1>

      <div className="field">
        <label htmlFor="name">球員名稱</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} />
      </div>

      <div className="field">
        <label htmlFor="start">起始守位</label>
        <select
          id="start"
          value={start}
          onChange={(e) => setStart(e.target.value as StartPosition)}
        >
          {START_POSITIONS.map((p) => (
            <option key={p} value={p}>
              {abilities.start_positions[p]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="seed">世界種子</label>
        <input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} maxLength={24} />
        <button type="button" onClick={() => setSeed(newSeed())}>
          換一個
        </button>
      </div>

      <button type="button" className="primary" onClick={generate}>
        開局
      </button>

      {player && <PlayerCard player={player} />}
    </main>
  );
}

function PlayerCard({ player }: { player: NewPlayer }) {
  const tierLabel = ['', '名門', '中堅', '弱旅'][player.schoolTier] ?? '';
  const { pitching, hitting, fielding, shared } = abilities.ability_groups;

  return (
    <section className="card">
      <h2>
        {player.name}／{abilities.start_positions[player.startPosition]}
      </h2>
      <p>
        {player.year} 年 · {player.age} 歲 · {player.school}
        {tierLabel && `（${tierLabel}）`} · 投 {HAND_LABEL[player.throws]} 打{' '}
        {HAND_LABEL[player.bats]}
      </p>

      <AbilityTable title="投球" keys={[...shared, ...pitching]} player={player} />
      <AbilityTable title="打擊" keys={hitting} player={player} />
      <AbilityTable title="守備" keys={fielding} player={player} />

      <p className="hint">
        每位球員都擁有全部 {ALL_ABILITIES.length} 項能力，起始守位只影響天賦的機率加權。
        潛力 70 以上為頂尖工具。相同種子＋相同起始守位必定產生同一位球員。
      </p>
    </section>
  );
}

function AbilityTable({
  title,
  keys,
  player,
}: {
  title: string;
  keys: readonly string[];
  player: NewPlayer;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>{title}</th>
          <th>目前</th>
          <th>潛力</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => {
          const ceiling = player.potential[key] ?? 0;
          return (
            <tr key={key}>
              <td>{abilities.abilities[key] ?? key}</td>
              <td>{player.ability[key] ?? 0}</td>
              <td className={ceiling >= 70 ? 'top-tool' : undefined}>{ceiling}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
