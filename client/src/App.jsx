import { useState } from 'react';
import './App.css';

// Component: Board (記分板)
function Board({ player }) {
  if (!player.active) return null;

  return (
    <header id="board">
      <div id="bd-top">
        <div id="bd-name">
          {player.name}
          <small>{player.pos} · {player.traits.genius ? '★' : ''}</small>
        </div>
        <div id="bd-team">{player.team}</div>
        <button id="btn-restart" title="重新開始">↺</button>
      </div>
      <div id="bd-grid">
        <div className="bd-cell"><b id="bd-age">{player.age}</b><span>年齡</span></div>
        <div className="bd-cell"><b id="bd-year">{player.year}</b><span>年份</span></div>
        <div className="bd-cell"><b id="bd-ovr">{player.ovr}</b><span>綜合</span></div>
        <div className="bd-cell"><b id="bd-sal">{player.salary}</b><span>生涯薪(萬)</span></div>
      </div>
      <div id="lamps">
        <span className="lamp on"><i></i>季初</span>
        <span className="lamp"><i></i>賽季中</span>
        <span className="lamp"><i></i>季末</span>
      </div>
    </header>
  );
}

// Component: Start Screen (開場畫面)
function StartScreen({ onStart }) {
  const [name, setName] = useState('');
  const [pos, setPos] = useState('P');

  return (
    <div id="start">
      <div className="wrap">
        <div className="stitch"></div>
        <h1 id="logo-tap">YaKyoLife<br/><em>棒球人生模擬器 (Tauri 版)</em></h1>
        <div id="ver-badge" style={{position:'fixed', top:'6px', right:'8px', fontSize:'10px', color:'var(--dim)'}}>v2.0.0-dev</div>
        <p className="sub">高中三年養成 → 選秀・旅日・旅美 → 國際賽 → 衰退與引退。</p>
        
        <div className="field">
          <label>球員姓名</label>
          <input 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            maxLength="10" 
            placeholder="例如：林家正" 
          />
        </div>
        
        <div className="field">
          <label>守位</label>
          <div className="seg" id="seg-pos">
            <button className={pos === 'P' ? 'on' : ''} onClick={() => setPos('P')}>投手</button>
            <button className={pos === 'C' ? 'on' : ''} onClick={() => setPos('C')}>捕手</button>
            <button className={pos === 'IF' ? 'on' : ''} onClick={() => setPos('IF')}>內野手</button>
            <button className={pos === 'OF' ? 'on' : ''} onClick={() => setPos('OF')}>外野手</button>
          </div>
        </div>

        <button 
          className="btn main" 
          style={{marginTop:'28px'}} 
          onClick={() => onStart({ name: name || '林家正', pos })}
        >
          開始生涯 ▸ 高一春天
        </button>
      </div>
    </div>
  );
}

function App() {
  // State: 遊戲狀態 (Game State)
  const [player, setPlayer] = useState({
    active: false,
    name: '',
    pos: 'P',
    team: '平鎮高中',
    age: 16,
    year: 2026,
    ovr: 30,
    salary: 0,
    traits: { genius: false }
  });

  const handleStart = (data) => {
    setPlayer({
      ...player,
      active: true,
      name: data.name,
      pos: data.pos
    });
  };

  return (
    <div id="app">
      {/* 若尚未開局，顯示開始畫面 */}
      {!player.active && <StartScreen onStart={handleStart} />}

      {/* 記分板 */}
      <Board player={player} />

      {/* 主紀錄 (Log) */}
      {player.active && (
        <main id="log">
          <div className="card info">
            <h4>系統訊息</h4>
            <p>這是一個 Tauri + React 的重構示範版本。</p>
            <p>UI 已經拆分成 React Components，且完整保留了原本的 CSS 樣式！</p>
          </div>
        </main>
      )}

      {/* 操作區 */}
      {player.active && (
        <footer id="act">
          <div className="title">行動</div>
          <button className="btn">進行春季訓練</button>
          <button className="btn main">全力一搏</button>
        </footer>
      )}
    </div>
  );
}

export default App;
