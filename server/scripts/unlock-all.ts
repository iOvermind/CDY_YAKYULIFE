/**
 * 把一個帳號的成就開滿（`./unlock-all.sh` 的本體）。
 *
 * 流程：邊打邊列出開頭符合的帳號（不分大小寫）→ 選一個 → 印出會新增幾項、多少 AP
 * → 輸入 yes 才寫。名單來自引擎的 `unlockEverything`，走的是正式的結算路徑，
 * 第 N 段人生不開、已經領過的階只補差額（見 client/src/engine/unlockAll.ts）。
 *
 * 資料庫一律經 `docker compose exec db psql`，與 reset-db.sh 同一條路——db 的埠
 * 不一定有對外開，走容器裡的 psql 不必知道連線設定。
 */

import { spawnSync } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';
import { unlockEverything } from '../../client/src/engine/index.ts';

const say = (s: string) => process.stdout.write(`\x1b[36m[unlock-all]\x1b[0m ${s}\n`);
const die = (s: string): never => {
  process.stderr.write(`\x1b[31m[unlock-all]\x1b[0m ${s}\n`);
  process.exit(1);
};

/** 跑一段 SQL，回傳以 tab 分隔的列。`input` 給了就從 stdin 餵整份 SQL。 */
function psql(sql: string | null, input?: string): string[][] {
  const args = ['compose', 'exec', '-T', 'db', 'psql', '-U', 'yakyu', '-d', 'yakyu', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t'];
  if (sql !== null) args.push('-c', sql);
  const r = spawnSync('docker', args, { input: input ?? '', encoding: 'utf8' });
  if (r.status !== 0) die(`psql 失敗：${r.stderr || r.stdout}`);
  return r.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\t'));
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** 邊打邊跳候選的帳號選單。沒打字時不列任何人。Esc／Ctrl-C 離開。 */
function pickAccount(users: readonly { id: string; account: string }[]): Promise<{ id: string; account: string }> {
  if (!process.stdin.isTTY) die('要在終端機裡互動執行（選帳號需要鍵盤）。');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  let query = '';
  let cursor = 0;
  let drawn = 0;
  const matches = () =>
    query === '' ? [] : users.filter((u) => u.account.toLowerCase().startsWith(query.toLowerCase())).slice(0, 10);

  const render = () => {
    const list = matches();
    cursor = Math.min(cursor, Math.max(0, list.length - 1));
    const lines = [`帳號：${query}`];
    if (query !== '' && list.length === 0) lines.push('  （沒有符合的帳號）');
    list.forEach((u, i) => lines.push(i === cursor ? `  \x1b[33m▸ ${u.account}\x1b[0m` : `    ${u.account}`));
    lines.push('', '\x1b[2m↑↓ 選擇　Enter 確定　Esc 離開\x1b[0m');
    // 回到上一次畫的第一行，清掉底下，再重畫。
    if (drawn > 0) process.stdout.write(`\x1b[${drawn}A\r`);
    process.stdout.write('\x1b[J' + lines.join('\n') + '\n');
    drawn = lines.length;
  };

  return new Promise((resolve) => {
    const done = (value: { id: string; account: string } | null) => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (value === null) die('取消了，什麼都沒動。');
      else resolve(value);
    };
    const onKey = (str: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) return done(null);
      if (key.name === 'return') {
        const picked = matches()[cursor];
        if (picked !== undefined) return done(picked);
      } else if (key.name === 'up') cursor = Math.max(0, cursor - 1);
      else if (key.name === 'down') cursor = Math.min(matches().length - 1, cursor + 1);
      else if (key.name === 'backspace') {
        query = query.slice(0, -1);
        cursor = 0;
      } else if (str !== undefined && !key.ctrl && str >= ' ' && str.length === 1) {
        query += str;
        cursor = 0;
      }
      render();
    };
    process.stdin.on('keypress', onKey);
    render();
  });
}

/** 讀一行。 */
function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (d) => {
      process.stdin.pause();
      resolve(String(d).trim());
    });
  });
}

const users = psql('SELECT id, account FROM users ORDER BY account_key').map(([id, account]) => ({
  id: id ?? '',
  account: account ?? '',
}));
if (users.length === 0) die('這台服務上還沒有任何帳號。');

const user = await pickAccount(users);
const earned = () => Number(psql(`SELECT COALESCE(SUM(points), 0) FROM achievements WHERE user_id = ${Number(user.id)}`)[0]?.[0] ?? 0);
const owned = new Set(
  psql(`SELECT achievement FROM achievements WHERE user_id = ${Number(user.id)}`).map(([a]) => a ?? ''),
);
const rows = unlockEverything(owned);
const gain = rows.reduce((sum, a) => sum + a.points, 0);

say(`帳號 ${user.account}：已有 ${owned.size} 項成就、累計賺過 ${earned()} AP。`);
if (rows.length === 0) {
  say('已經全部開滿了，沒有東西可以加。');
  process.exit(0);
}
say(`會新增 ${rows.length} 項成就、+${gain} AP（第 N 段人生不動）。`);
const answer = await ask('確定要寫入嗎？輸入 yes 繼續：');
if (answer !== 'yes') die('取消了，什麼都沒動。');

// 一個交易寫完。ON CONFLICT 擋住「選單之後、寫入之前剛好有一局結算」的那一種撞車。
const values = rows
  .map((a) => `(${Number(user.id)}, ${quote(a.id)}, ${quote(a.name)}, ${quote(a.category)}, ${a.points})`)
  .join(',\n');
psql(
  null,
  `BEGIN;
INSERT INTO achievements (user_id, achievement, name, category, points) VALUES
${values}
ON CONFLICT (user_id, achievement) DO NOTHING;
COMMIT;
`,
);
say(`寫好了。${user.account} 現在累計賺過 ${earned()} AP。`);
