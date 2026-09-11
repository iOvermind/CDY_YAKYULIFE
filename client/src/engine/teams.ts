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
 * 這個聯盟的勝率界線。
 *
 * **上下限定在奪冠機率上，但夾在勝率上。** 想要的是「一支球隊最多能比平均強幾
 * 倍」，而那是機率的語言；可是夾機率會把「全聯盟加起來是 1」弄壞，得再縮放回去，
 * 縮放又讓極端值溢出一點。改成反解：算出「達到那個機率需要多高的勝率」，然後夾
 * 勝率。機率因此完全不必夾——它天生落在界線內，總和天生是 1。
 *
 * 反解的是其他隊都在 .500 的情形：
 *
 * ```
 * c = w⁴ / (w⁴ + (N−1) × .5⁴)   →   w = .5 × [c(N−1) / (1−c)]^(1/4)
 * ```
 *
 * 代上限 `1/√N` 與下限 `1/N^1.75` 得到的線，在小聯盟比 `drift.clamp` 緊、在大聯盟
 * 比它寬（三十隊的上限反解出 .798，那是一年 129 勝——不是棒球）。因此**取兩道線
 * 的交集**：推導線只在它比現況緊的時候生效。
 */
export function winRateBounds(teams: number): { readonly min: number; readonly max: number } {
  const d = cfg.team_strength.drift;
  const c = cfg.team_strength.championship;
  if (teams <= 1) return d.clamp;

  const at = (odds: number): number =>
    d.target_mean * Math.pow((odds * (teams - 1)) / (1 - odds), 1 / c.exponent);

  return {
    min: Math.max(d.clamp.min, at(Math.pow(teams, -c.floor_exponent))),
    max: Math.min(d.clamp.max, at(Math.pow(teams, -c.cap_exponent))),
  };
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

  const table = new Map<string, TeamSeason>();
  const { min, max } = cfg.team_strength.initial;
  for (const team of list) {
    const baseline = min + rng.next() * (max - min);
    table.set(team.name, { name: team.name, baseline, winRate: baseline });
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
  //
  // **夾子只管單一球隊，不管全聯盟的平均。** 曾經加過一道「同一年的平均勝率平移
  // 回 .500」的守衛，理由是封閉聯盟裡每一勝都是別人的一敗。它被拿掉了：那道平移
  // 讓玩家的貢獻變成零和的（自己多贏就從對手身上扣），於是他自己的奪冠率反而被
  // 推高，而模型要表達的只是「這支球隊今年強不強」。
  //
  // 界線由奪冠機率的上下限反解（見 winRateBounds）：六隊聯盟夾在 .345 到 .681，
  // 三十隊聯盟沿用 .300 到 .700。
  const bounds = winRateBounds(table.size);
  for (const [name, team] of table) {
    const pulled = team.winRate + (team.baseline - team.winRate) * d.mean_reversion;
    const noise = d.yearly.min + rng.next() * (d.yearly.max - d.yearly.min);
    let rate = pulled + noise;
    if (name === options.playerTeam) rate += options.playerEffect ?? 0;
    next.set(name, {
      name,
      baseline: team.baseline,
      winRate: Math.max(bounds.min, Math.min(bounds.max, rate)),
    });
  }
  return next;
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
 * 勝率取次方之後的佔比，沒有夾子也沒有縮放——**上下限已經在勝率那一側處理掉了**
 * （見 {@link winRateBounds}）。夾機率的舊做法要再縮放回 1，而縮放會讓極端值溢出
 * 一點；夾勝率沒有這個問題，因為佔比的分母就是全聯盟。
 *
 * 平均值因此永遠是隊數的倒數：六隊的中職 16.7%、三十隊的大聯盟 3.3%。
 */
export function championshipOddsOf(table: LeagueTable): ReadonlyMap<string, number> {
  const c = cfg.team_strength.championship;
  const out = new Map<string, number>();
  if (table.size === 0) return out;

  let total = 0;
  for (const t of table.values()) total += Math.pow(t.winRate, c.exponent);
  if (total === 0) return out;
  for (const [name, t] of table) out.set(name, Math.pow(t.winRate, c.exponent) / total);
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
