/**
 * 發版：看 `CHANGELOG.md` 的 `[Unreleased]` 決定新版號，並把那一節轉成版本區塊。
 *
 * `deploy.sh` 在建 image 之前呼叫它（見 DEVELOPER.md §7）。這支腳本**只管 CHANGELOG
 * 與算版號**；版號寫進 `client/package.json`、commit、tag、推送都是 deploy.sh 的事。
 *
 *     node scripts/release.mjs plan                 # 印出「minor 0.5.0」，沒有要發就印「none」
 *     node scripts/release.mjs apply 0.5.0 2026-09-27
 *
 * 跳哪一位照 `docs/rules/VERSION_RULES.md` §4.1，取 `[Unreleased]` 裡最高的那一個：
 *
 * | 類別 | 跳哪一位 |
 * | :--- | :--- |
 * | `Removed`，或任何條目標了 **[破壞性變更]** | MAJOR |
 * | `Added`、`Changed`、`Deprecated` | MINOR |
 * | `Fixed`、`Security` | PATCH |
 *
 * **0.x 也照字面**：一條 Removed 就會跳到 1.0.0（2026-09-27 定的，不另設 0.x 例外）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RANK = { patch: 0, minor: 1, major: 2 };
const BY_CATEGORY = {
  Added: 'minor',
  Changed: 'minor',
  Deprecated: 'minor',
  Removed: 'major',
  Fixed: 'patch',
  Security: 'patch',
};
const BREAKING = '**[破壞性變更]**';

/** `[Unreleased]` 那一節的內文（不含標題），找不到就是 null。 */
function unreleasedBody(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^## \[Unreleased\]\s*$/.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end);
}

/** 這次要跳哪一位、新版號是多少；`[Unreleased]` 沒有任何條目時是 null（不發版）。 */
export function planRelease(markdown, current) {
  const body = unreleasedBody(markdown);
  if (body === null) return null;
  let bump = null;
  let category = null;
  for (const line of body) {
    const heading = /^### (\w+) /.exec(line);
    if (heading !== null) {
      category = heading[1];
      continue;
    }
    if (!line.startsWith('- ') || category === null) continue;
    const level = line.includes(BREAKING) ? 'major' : BY_CATEGORY[category];
    if (level === undefined) throw new Error(`不認得的 CHANGELOG 類別：${category}`);
    if (bump === null || RANK[level] > RANK[bump]) bump = level;
  }
  if (bump === null) return null;

  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (m === null) throw new Error(`目前的版號不是 X.Y.Z：${current}`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const next =
    bump === 'major' ? `${major + 1}.0.0` : bump === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  return { bump, next };
}

/** `[Unreleased]` 改成 `[<版號>] - <日期>`，上面留一個新的空 `[Unreleased]`。 */
export function applyRelease(markdown, version, date) {
  // 行尾只吃空白與 tab，不吃換行——\s* 會把標題後面那行空行也吞掉。
  const re = /^## \[Unreleased\][ \t]*$/m;
  if (!re.test(markdown)) throw new Error('CHANGELOG.md 裡找不到 ## [Unreleased]');
  return markdown.replace(re, `## [Unreleased]\n\n## [${version}] - ${date}`);
}

// ── 指令列 ──────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const changelogPath = join(clientDir, '..', 'CHANGELOG.md');
  const pkg = JSON.parse(readFileSync(join(clientDir, 'package.json'), 'utf8'));
  const markdown = readFileSync(changelogPath, 'utf8');
  const [cmd, version, date] = process.argv.slice(2);

  if (cmd === 'plan') {
    const plan = planRelease(markdown, pkg.version);
    console.log(plan === null ? 'none' : `${plan.bump} ${plan.next}`);
  } else if (cmd === 'apply' && version !== undefined && date !== undefined) {
    writeFileSync(changelogPath, applyRelease(markdown, version, date), 'utf8');
  } else {
    console.error('用法：node scripts/release.mjs plan | apply <版號> <YYYY-MM-DD>');
    process.exit(2);
  }
}
