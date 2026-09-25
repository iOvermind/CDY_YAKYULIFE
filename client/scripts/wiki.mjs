/**
 * 把 `WIKI.md` 裡的數值表從資料檔重新產生一次。
 *
 * **WIKI 是給玩家的攻略，數字一律從 json 來。** 之前整份手寫，數字抄一次就開始
 * 過期——隊名、門檻、天賦價格改了，攻略還停在一個月前。現在說明文字手寫，表格
 * 寫在一對標記之間：
 *
 *     <!-- gen:talents -->
 *     （這裡的內容每次都會被覆寫）
 *     <!-- /gen:talents -->
 *
 * 標記外的文字這支腳本一個字都不碰；標記內的東西手改了也會被蓋掉。
 *
 * **劇透的界線也寫在這裡，因為表格是這裡產生的。**
 * - 特性：列名字、正負向、取得條件（`traits.json` 的 `trigger_text`），**不列效果**——
 *   效果等拿到了在遊戲裡點開才看得到。
 * - 事件卡：全部列出；**有標 `weight` 的（比預設 100 罕見的）不寫結果**，只留名字
 *   與適用對象。以後新增的罕見事件自動被藏起來，不必記得來這裡改。
 * - 其他一律公開。
 *
 * **資料不齊就報錯停建置**——跟 changelog.mjs 同一個理由：長歪了要當場知道。
 * 由 `predev` / `prebuild` / `pretest` 帶著跑，所以 WIKI 永遠跟著資料檔走。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(clientDir, 'src', 'data');
const target = join(clientDir, '..', 'WIKI.md');

const load = (name) => JSON.parse(readFileSync(join(dataDir, `${name}.json`), 'utf8'));

/** 事件卡未標 weight 時的抽取權重（engine/events.ts 的 DEFAULT_WEIGHT）。 */
const DEFAULT_EVENT_WEIGHT = 100;

// ---------------------------------------------------------------- 小工具

function fail(message) {
  throw new Error(`[wiki] ${message}`);
}

/** Markdown 表格：表頭一列、分隔線、內容。格子裡的 `|` 與換行會弄壞表格，先換掉。 */
function table(head, rows) {
  const cell = (v) => String(v).replace(/\|/g, '｜').replace(/\n/g, ' ');
  return [
    `| ${head.map(cell).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** 資料檔裡的說明欄可能帶 HTML（`<b class="hl">`），表格只要文字。 */
const plain = (s) => String(s).replace(/<[^>]+>/g, '');

// ---------------------------------------------------------------- 各張表

function teamsTable({ teams, leagues }) {
  const out = [];
  for (const [org, list] of Object.entries(teams.leagues)) {
    const name = leagues.top_league_names[org] ?? fail(`leagues.json 沒有 ${org} 的聯盟名稱`);
    out.push(`**${name}**（${list.length} 隊）`, '');
    out.push(table(['球隊', '代表詞'], list.map((t) => [t.name, t.nick ?? t.name.slice(-2)])));
    out.push('');
  }
  return out.join('\n').trimEnd();
}

function ladderTable({ leagues }) {
  const out = [];
  for (const [org, path] of Object.entries(leagues.paths)) {
    if (org.startsWith('_')) continue;
    const name = leagues.top_league_names[org] ?? fail(`leagues.json 沒有 ${org} 的聯盟名稱`);
    const rows = [...path].reverse().map((code) => {
      const lv = leagues.levels[code] ?? fail(`leagues.json 的 paths.${org} 列了不存在的層級 ${code}`);
      return [lv.name, lv.par, lv.min, lv.games];
    });
    out.push(`**${name}**`, '', table(['層級', '平均水準', '最低門檻', '每季場數'], rows), '');
  }
  return out.join('\n').trimEnd();
}

function talentsTable({ talents }) {
  const tiers = Math.max(...talents.talents.map((t) => t.levels.length));
  const head = ['天賦', '分組', ...Array.from({ length: tiers }, (_, i) => `第 ${i + 1} 階`)];
  const rows = talents.talents.map((t) => {
    if (t.levels.length === 0) fail(`天賦 ${t.id} 沒有任何一階`);
    const cells = t.levels.map((l) => {
      if (!l.effect_text) fail(`天賦 ${t.id} 有一階沒寫 effect_text`);
      return `${l.effect_text}（${l.cost} AP）`;
    });
    while (cells.length < tiers) cells.push('—');
    return [t.name, t.group, ...cells];
  });
  return table(head, rows);
}

/** 特性的顯示名稱。名稱依生涯組出來的那幾個，用 ◯◯ 代替要填的地方。 */
function traitLabel(t, traits) {
  if (t.name !== null) return t.name;
  const pattern = traits.dynamic_names?.[t.id]?.pattern ?? fail(`特性 ${t.id} 沒有名稱也沒有 dynamic_names`);
  return pattern.replace(/\{[^}]+\}/g, '◯◯');
}

function traitAp(t, ach) {
  const c = ach.categories.trait;
  return c.by_id[t.id] ?? c.by_tone[t.tone] ?? c.default;
}

function traitsTable({ traits, achievements }) {
  const byId = new Map(traits.traits.map((t) => [t.id, t]));
  const section = (title, ids) => {
    const rows = ids.map((id) => {
      const t = byId.get(id) ?? fail(`traits.json 的 categories 列了不存在的特性 ${id}`);
      if (!t.trigger_text) fail(`特性 ${id} 沒寫 trigger_text（給玩家看的取得條件）`);
      return [traitLabel(t, traits), t.trigger_text, traitAp(t, achievements)];
    });
    return [`**${title}**（${ids.length} 種）`, '', table(['特性', '取得條件', '成就 AP'], rows)].join('\n');
  };
  const listed = new Set([...traits.categories.positive, ...traits.categories.negative]);
  const orphan = traits.traits.filter((t) => !listed.has(t.id)).map((t) => t.id);
  if (orphan.length > 0) fail(`這些特性沒列在 categories 裡：${orphan.join('、')}`);
  return [section('正向特性', traits.categories.positive), '', section('負向特性', traits.categories.negative)].join(
    '\n',
  );
}

/**
 * `by_rank` 由高到低、值是增量：拿到某一階就把它與底下每一階全部加起來。
 * 回傳每一階實際拿到的總點數。
 */
function cumulativeByRank(byRank) {
  const ranks = Object.keys(byRank);
  return ranks.map((r, i) => [r, ranks.slice(i).reduce((sum, k) => sum + byRank[k], 0)]);
}

/** 名字寫在 engine/awards.ts 而不在資料檔裡的獎項。 */
const AWARD_NAMES_IN_ENGINE = { all_star: '明星賽', rookie_of_year: '新人王' };

/** 在 awards.json 裡找一個獎項代碼的中文名。 */
function awardName(code, awards) {
  if (AWARD_NAMES_IN_ENGINE[code] !== undefined) return AWARD_NAMES_IN_ENGINE[code];
  let found;
  const walk = (o) => {
    if (found !== undefined || o === null || typeof o !== 'object') return;
    if (o.code === code && typeof o.name === 'string') found = o.name;
    for (const v of Object.values(o)) walk(v);
  };
  walk(awards);
  if (found === undefined && typeof awards[code]?.name === 'string') found = awards[code].name;
  return found ?? fail(`awards.json 找不到獎項 ${code} 的名稱`);
}

function achievementsTable({ achievements, awards, hall_of_fame }) {
  const c = achievements.categories;
  const out = [];

  const rows = [];
  rows.push([achievements.first_career_bonus.name, '每走完一段生涯多一階「第 N 段人生」', achievements.first_career_bonus.points]);
  rows.push([c.trait.name, '取得過的每一種特性各一項（點數見特性表）', '1～5']);
  for (const [rank, ap] of cumulativeByRank(c.amateur_cup.by_rank)) {
    rows.push([c.amateur_cup.name, `養成期大賽${rank}`, ap]);
  }
  for (const [rank, ap] of cumulativeByRank(c.international.by_rank)) {
    rows.push([c.international.name, `國家隊${rank}`, ap]);
  }
  rows.push([c.international.name, '國際賽 MVP', c.international.mvp]);
  for (const [code, ap] of Object.entries(c.award.by_code)) {
    rows.push([c.award.name, `${awardName(code, awards)}（各聯盟各一項）`, ap]);
  }
  rows.push([c.award.name, '其他獎項與個人成績王（各聯盟各一項）', c.award.default]);
  const labels = hall_of_fame.tier_thresholds.labels;
  const tierAp = c.tier.by_tier.map((_, i) => c.tier.by_tier.slice(i).reduce((a, b) => a + b, 0));
  labels.forEach((label, i) => {
    if (tierAp[i] > 0) rows.push(['生涯分級', `${label}級生涯（各聯盟各一項，只算最高那一級）`, tierAp[i]]);
  });
  rows.push([c.hall.name, '進入一個聯盟的名人堂', c.hall.default]);
  rows.push([c.marriage.name, '與每一位不同的對象結婚', c.marriage.default]);
  rows.push([c.second_life.name, '每一條第二人生的路', c.second_life.default]);
  out.push(table(['分類', '什麼算一項', 'AP'], rows), '');

  const rungs = Object.entries(c.cumulative.rungs)
    .filter(([k]) => !k.startsWith('_'))
    .map(([, r]) => [
    r.name,
    r.side === 'pitcher' ? '投手' : '打者',
    `每 ${r.step}`,
    r.points,
  ]);
  out.push(`**${c.cumulative.name}**：生涯數據每跨過一階算一項，階梯不封頂。`, '');
  out.push(table(['數據', '側', '一階', '每階 AP'], rungs));
  return out.join('\n');
}

function effectText(key, value, ctx) {
  const { abilities, traits, events } = ctx;
  const traitName = (id) => {
    const t = traits.traits.find((x) => x.id === id) ?? fail(`事件卡給了不存在的特性 ${id}`);
    return `取得〈${traitLabel(t, traits)}〉`;
  };
  switch (key) {
    case 'rand':
      return `隨機一項能力 ${signed(value)}`;
    case 'pitch':
      return `隨機一個球系 ${signed(value)}`;
    case 'inj':
      return `受傷機率 ${signed(value)}%`;
    case 'suspension':
      return `禁賽 ${value} 場`;
    case 'income':
      return `收入 ${signed(value)}%（當季年薪）`;
    case 'ban':
      return '永久逐出棒球界';
    case 'yips':
      return traitName('yips');
    case 'tj_countdown':
      return `投手耐力 −${value * 15}%`;
    case 'recover':
      return `耐力回復 ${value}%`;
    default:
      if (abilities.abilities[key] !== undefined) return `${abilities.abilities[key]} ${signed(value)}`;
      if (traits.traits.some((t) => t.id === key)) return traitName(key);
      if (events.effect_keys[key] !== undefined) return plain(events.effect_keys[key]);
      return fail(`事件卡的效果鍵 ${key} 不認得`);
  }
}

function effectsText(effects, ctx) {
  const parts = Object.entries(effects ?? {}).map(([k, v]) => effectText(k, v, ctx));
  return parts.length === 0 ? '無' : parts.join('、');
}

function eventsTable(ctx) {
  const { events } = ctx;
  const audience = (code) => events.audience_codes[code] ?? fail(`事件卡的對象代碼 ${code} 不認得`);
  const common = [];
  const rare = [];
  for (const e of events.events) {
    const who = audience(e.for ?? '*');
    if ((e.weight ?? DEFAULT_EVENT_WEIGHT) < DEFAULT_EVENT_WEIGHT) {
      rare.push([e.name, who]);
      continue;
    }
    common.push([
      e.name,
      who,
      `${plain(e.good_text)}（${effectsText(e.good_effects, ctx)}）`,
      `${plain(e.bad_text)}（${effectsText(e.bad_effects, ctx)}）`,
    ]);
  }
  return [
    `**常見事件**（${common.length} 張）`,
    '',
    table(['事件', '對象', '好結果', '壞結果'], common),
    '',
    `**罕見事件**（${rare.length} 張，結果不公開）`,
    '',
    table(['事件', '對象'], rare),
  ].join('\n');
}

const GENERATORS = {
  teams: teamsTable,
  ladder: ladderTable,
  talents: talentsTable,
  traits: traitsTable,
  achievements: achievementsTable,
  events: eventsTable,
};

// ---------------------------------------------------------------- 填回 WIKI

/** 讀進所有資料檔，產生每一張表。 */
export function renderBlocks(data) {
  return Object.fromEntries(Object.entries(GENERATORS).map(([k, fn]) => [k, fn(data)]));
}

const MARKER = /<!-- gen:([a-z_]+) -->\n[\s\S]*?<!-- \/gen:\1 -->/g;

/** 把標記之間的內容換成產生的表格。標記外的文字原樣保留。 */
export function fillWiki(markdown, blocks) {
  const seen = new Set();
  const out = markdown.replace(MARKER, (_, name) => {
    const body = blocks[name] ?? fail(`WIKI.md 有標記 gen:${name}，但沒有這張表的產生器`);
    seen.add(name);
    return `<!-- gen:${name} -->\n${body}\n<!-- /gen:${name} -->`;
  });
  const opened = [...markdown.matchAll(/<!-- gen:([a-z_]+) -->/g)].map((m) => m[1]);
  const unclosed = opened.filter((n) => !seen.has(n));
  if (unclosed.length > 0) fail(`這些標記沒有對應的結尾：${unclosed.join('、')}`);
  return out;
}

export function loadData() {
  return Object.fromEntries(
    ['teams', 'leagues', 'talents', 'traits', 'achievements', 'awards', 'hall_of_fame', 'events', 'abilities'].map(
      (n) => [n, load(n)],
    ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const before = readFileSync(target, 'utf8');
  const after = fillWiki(before, renderBlocks(loadData()));
  if (after !== before) writeFileSync(target, after);
}
