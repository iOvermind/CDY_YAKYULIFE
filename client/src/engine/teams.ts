/**
 * 球隊戰力與勝率。
 *
 * 舊版有兩套互不相干的東西：`teamChampRate()` 把隊名雜湊成 8–29% 的固定數字
 * 給玩家看，球季結束卻另外用球員自己的能力擲一次奪冠判定。**顯示的與實際
 * 發生的完全無關**，而且那個「顯示用」的數字連年份都不會變。
 *
 * 這裡只有一套：勝率是真的逐年模擬出來的，奪冠機率由勝率推導。
 *
 * 抽取一律走 career 子序列——球隊的興衰是生涯層級的世界狀態，不是某一場球的
 * 結果。所有數字都在 `season.json` 的 team_strength。
 */

import { season as cfg, teams as teamsData } from '../data/index.ts';
import type { World } from './rng.ts';

export interface TeamSeason {
  readonly name: string;
  /** 這一季的勝率。 */
  readonly winRate: number;
  /** 該隊的體質，逐年變動都圍繞它擺盪。 */
  readonly baseline: number;
}

/** 一個聯盟所有球隊的當季狀態，以隊名為鍵。 */
export type LeagueTable = ReadonlyMap<string, TeamSeason>;

/**
 * 球隊的代表詞，用於「◯◯先生」這類稱號。
 *
 * 大多數隊名是「地名＋代表詞」（台中猛瑪 → 猛瑪），少數整個隊名就是代表詞
 * （東京大人）。`teams.json` 只在後者標了 nick，其餘照 `nick_fallback` 取
 * 末兩字——把每一隊都列一次只會多一份會過期的資料。
 */
export function teamNick(name: string): string {
  for (const org of Object.keys(teamsData.leagues)) {
    for (const team of teamsData.leagues[org] ?? []) {
      if (team.name === name) return team.nick ?? name.slice(-2);
    }
  }
  return name.slice(-2);
}

/**
 * 開局：為一個聯盟的每支球隊抽出基準勝率。
 *
 * 基準抽一次就固定成為該隊的「體質」。沒有這個錨，幾年之後所有球隊都會回歸
 * 同一個平均值，強弱隊的區別就消失了。
 *
 * 走訪順序照 teams.json 的宣告順序，否則同一個種子會抽出不同的聯盟格局。
 */
export function initLeague(world: World, org: string): LeagueTable {
  const rng = world.stream('career');
  const list = teamsData.leagues[org];
  if (list === undefined) throw new Error(`未知的聯盟：${org}`);

  const { min, max } = cfg.team_strength.initial;
  const drawn = new Map<string, number>();
  for (const team of list) drawn.set(team.name, min + rng.next() * (max - min));

  // **體質的平均也必須是 .500。** 抽出來的那幾個數字平均不會剛好落在中間，而
  // 開局那一年就是用體質當勝率——不平移的話，第一季就會出現「全聯盟一起變強」
  // 的年份，而那沒有對手。平移之後每一年都由 advanceLeague 維持。
  const table = new Map<string, TeamSeason>();
  // 平移之後仍然要落在開局的區間裡，那個區間是「體質有多好」的定義。
  for (const [name, baseline] of recenter(drawn, cfg.team_strength.initial)) {
    table.set(name, { name, baseline, winRate: baseline });
  }
  return table;
}

/**
 * 推進一年。
 *
 * 每隊先往自己的基準靠攏（球隊會補強也會崩盤，但長期回歸體質），再加上一年
 * 的隨機變動。玩家所屬的球隊另外加上玩家自己的貢獻——一個球員撐不起一支
 * 球隊，但頂級球員確實看得出來。
 */
export function advanceLeague(
  world: World,
  table: LeagueTable,
  options: { readonly playerTeam?: string; readonly playerEffect?: number } = {},
): LeagueTable {
  const rng = world.stream('career');
  const d = cfg.team_strength.drift;
  const next = new Map<string, TeamSeason>();

  // 走訪順序即插入順序，Map 保證穩定——不排序，因為那會改變抽取順序。
  const raw = new Map<string, number>();
  for (const [name, team] of table) {
    const pulled = team.winRate + (team.baseline - team.winRate) * d.mean_reversion;
    const noise = d.yearly.min + rng.next() * (d.yearly.max - d.yearly.min);
    let rate = pulled + noise;
    if (name === options.playerTeam) rate += options.playerEffect ?? 0;
    raw.set(name, rate);
  }

  for (const [name, rate] of recenter(raw)) {
    next.set(name, { name, baseline: table.get(name)?.baseline ?? rate, winRate: rate });
  }
  return next;
}

/**
 * 把一整個聯盟的勝率移回平均 .500。
 *
 * **封閉聯盟裡每一勝都是別人的一敗**，所以同一年全聯盟的平均勝率必然是 .500。
 * 各隊獨立抽完再各自夾住並不保證這件事：實測量到過中職單年全聯盟平均 .405 與
 * .580、澳職 .387 與 .613——那等於某些年份整個聯盟一起變強，而那沒有對手。
 *
 * 做法是平移而不是縮放：**平移只改強弱的絕對位置，縮放會改變差距**，而差距正是
 * 體質與波動要表達的東西。平移之後可能有人越界，夾完再平移一次，來回幾輪就收斂
 * （每一輪的越界量都比上一輪小）。極端情形下夾子贏——寧可留一點偏差，也不要為了
 * 湊平均把某支球隊推出 [.300, .700]。
 */
function recenter(
  rates: ReadonlyMap<string, number>,
  bounds: { readonly min: number; readonly max: number } = cfg.team_strength.drift.clamp,
): Map<string, number> {
  const d = cfg.team_strength.drift;
  const out = new Map(rates);
  for (let round = 0; round < d.recenter_rounds; round++) {
    let sum = 0;
    for (const v of out.values()) sum += v;
    const shift = d.target_mean - sum / out.size;
    if (Math.abs(shift) < 1e-9) break;
    for (const [name, v] of out) {
      out.set(name, Math.max(bounds.min, Math.min(bounds.max, v + shift)));
    }
  }
  return out;
}

/**
 * 玩家對所屬球隊勝率的貢獻。
 *
 * 以綜合能力相對聯盟 par 換算，上下限刻意壓得很窄——棒球是九個人的運動，
 * 再強的球員也翻不了一支爛隊。
 */
export function playerEffect(overall: number, par: number): number {
  const e = cfg.team_strength.player_effect;
  return Math.max(e.min, Math.min(e.max, (overall - par) * e.per_point));
}

/**
 * 由勝率推導奪冠機率。
 *
 * 取指數放大強隊的優勢：短期賽制有運氣成分，但一支勝率七成的球隊本來就該
 * 明顯比五成的容易奪冠，線性換算會把這個差距抹平。
 */
export function championshipOdds(table: LeagueTable, team: string): number {
  return championshipOddsOf(table).get(team) ?? 0;
}

/**
 * 全聯盟的奪冠機率，**加起來是 1**。
 *
 * 三步：勝率取次方算佔比 → 夾在該聯盟的上下限 → 照比例縮放回 1。
 *
 * **上下限是隊數的函數，不是絕對值。** 「一支球隊最多能比平均強幾倍」在六隊聯盟
 * 與三十隊聯盟不是同一件事：上限取 `1/√隊數`（澳職 50%、中職 40.8%、大聯盟
 * 18.3%），下限取 `1/隊數^1.75`（澳職 8.8%、中職 4.4%、大聯盟 0.26%）。舊的絕對
 * 值 1% 與 55% 是反過來的——1% 只咬得到大聯盟（把墊底的球隊從 0.33% 抬到 1%，
 * 總和因此變成 1.0029），55% 則除了澳職以外一次都咬不到。
 *
 * 夾完要縮放回 1，否則夾子會把總和弄壞，而**那個總和就是「每年有一支球隊奪冠」
 * 這件事**。縮放之後可能又有人越界，夾與縮放來回幾輪即收斂。
 */
export function championshipOddsOf(table: LeagueTable): ReadonlyMap<string, number> {
  const c = cfg.team_strength.championship;
  const out = new Map<string, number>();
  const n = table.size;
  if (n === 0) return out;

  let total = 0;
  for (const t of table.values()) total += Math.pow(t.winRate, c.exponent);
  if (total === 0) return out;
  for (const [name, t] of table) out.set(name, Math.pow(t.winRate, c.exponent) / total);

  const cap = Math.pow(n, -c.cap_exponent);
  const floor = Math.pow(n, -c.floor_exponent);
  for (let round = 0; round < c.renormalise_rounds; round++) {
    let sum = 0;
    for (const [name, v] of out) {
      const clamped = Math.max(floor, Math.min(cap, v));
      out.set(name, clamped);
      sum += clamped;
    }
    if (Math.abs(sum - 1) < 1e-9) break;
    for (const [name, v] of out) out.set(name, v / sum);
  }
  return out;
}

/**
 * 今年誰奪冠。
 *
 * **從全聯盟按機率抽一支，不是對某一支球隊擲一次。** 兩者的差別不只是寫法：
 * 抽一支保證每年恰好有一個冠軍，因此「別隊奪冠」也是一件看得到的事，而奪冠
 * 機率的總和是 1 這句話變成結構上的事實而不是一條要維護的性質。
 *
 * 走 career 子序列——誰奪冠是世界狀態，與球員個人的成績同層以上。
 */
export function pickChampion(world: World, table: LeagueTable): string | null {
  const odds = championshipOddsOf(table);
  if (odds.size === 0) return null;

  const roll = world.stream('career').next();
  let acc = 0;
  let last: string | null = null;
  for (const [name, p] of odds) {
    acc += p;
    last = name;
    if (roll < acc) return name;
  }
  // 浮點誤差讓累加差一點點到 1 時，最後一支就是它。
  return last;
}

/**
 * 這個聯盟的平均奪冠機率。
 *
 * 所有球隊的機率加起來是 1，因此平均值就是**隊數的倒數，不是一個可以寫死的
 * 常數**。六隊的中職是 16.7%、三十隊的大聯盟是 3.3%，
 * 「這支球隊比一般球隊更接近冠軍嗎」這個問題因此只能拿同一個聯盟的平均去問。
 */
export function averageChampionshipOdds(table: LeagueTable): number {
  return table.size === 0 ? 0 : 1 / table.size;
}

/** 勝率的顯示字串，例如 .543。 */
export function fmtWinRate(rate: number): string {
  return rate.toFixed(3).replace(/^0/, '');
}
