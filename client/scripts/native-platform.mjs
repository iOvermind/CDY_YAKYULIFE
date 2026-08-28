/**
 * 跨平台 preflight：修正 WSL / Windows 共用同一份 node_modules 的原生二進位衝突。
 *
 * 專案放在 D:\Dev\CDY_YAKYULIFE，WSL 從 /mnt/d/... 看到的是「同一個」目錄，
 * 所以 client/node_modules 也是同一份。但 rollup、esbuild 與 TypeScript 7（Go 實作）
 * 都是原生二進位，npm 只會安裝「目前平台」的那一個 optional dependency：
 *   - 從 WSL 跑 npm i  → 只有 @rollup/rollup-linux-x64-gnu、@esbuild/linux-x64、@typescript/typescript-linux-x64
 *   - 從 Windows 跑    → 只有 @rollup/rollup-win32-x64-msvc、@esbuild/win32-x64、@typescript/typescript-win32-x64
 * 換邊執行就會炸 "Cannot find module @rollup/rollup-win32-x64-msvc"
 * 或 "Unable to resolve @typescript/typescript-linux-x64"。
 *
 * 這裡在 dev / build / test 之前檢查 node_modules 目前屬於哪個平台，
 * 不符就用 npm 的 --os/--cpu 覆寫重裝（約 5 秒）。package-lock.json 不會被改動，
 * 因為 lock 本來就列出了所有平台的 optional dependency，只是安裝時二選一。
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(clientDir, 'node_modules');

/** 目錄裡是否存在符合目前平台的原生套件。用前綴比對，避免自己重刻 msvc/gnu/musl 的對照表。 */
function hasNative(scope, prefix) {
  const dir = join(modules, scope);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((name) => name.startsWith(prefix));
}

// 還沒 npm i 過就不要多事，讓使用者自己裝。
if (!existsSync(modules)) process.exit(0);

const { platform, arch } = process;

/** [scope, 該 scope 底下屬於本平台的套件名前綴] */
const NATIVE = [
  ['@rollup', `rollup-${platform}-${arch}`],
  ['@esbuild', `${platform}-${arch}`],
  ['@typescript', `typescript-${platform}-${arch}`],
];

if (NATIVE.every(([scope, prefix]) => hasNative(scope, prefix))) process.exit(0);

console.warn(
  `[preflight] node_modules 裡的 rollup/esbuild 不是 ${platform}-${arch} 的版本（多半是剛從另一邊的 WSL/Windows 跑過），重裝原生套件中……`,
);

// Windows 上 npm 是 npm.cmd，Node 自 CVE-2024-27980 修正後
// 不帶 shell:true 直接 spawn .cmd 會丟 EINVAL，所以這裡走 shell。
const isWin = platform === 'win32';
const r = spawnSync(
  'npm',
  ['i', `--os=${platform}`, `--cpu=${arch}`, '--no-audit', '--no-fund'],
  { cwd: clientDir, stdio: 'inherit', shell: isWin },
);

if (r.status !== 0) {
  console.error(
    '[preflight] 自動修復失敗。請手動執行：\n' +
      `  cd client && npm i --os=${platform} --cpu=${arch}\n` +
      '若仍失敗，刪掉 client/node_modules 後重新 npm i。',
  );
  process.exit(r.status ?? 1);
}
