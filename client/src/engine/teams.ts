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
  for (const [name, team] of table) {
    const pulled = team.winRate + (team.baseline - team.winRate) * d.mean_reversion;
    const noise = d.yearly.min + rng.next() * (d.yearly.max - d.yearly.min);
    let rate = pulled + noise;
    if (name === options.playerTeam) rate += options.playerEffect ?? 0;
    next.set(name, {
      name,
      baseline: team.baseline,
      winRate: Math.max(d.clamp.min, Math.min(d.clamp.max, rate)),
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
  const c = cfg.team_strength.championship;
  const self = table.get(team);
  if (self === undefined) return 0;

  // 除以全聯盟的權重和，確保所有球隊的機率加起來是 1（再乘上 scale）。
  let total = 0;
  for (const t of table.values()) total += Math.pow(t.winRate, c.exponent);
  if (total === 0) return 0;

  const odds = (Math.pow(self.winRate, c.exponent) / total) * c.scale;
  return Math.max(c.min, Math.min(c.max, odds));
}

/**
 * 這個聯盟的平均奪冠機率。
 *
 * 所有球隊的機率加起來是 `scale`，因此平均值就是 `scale ÷ 隊數`——**它是隊數的
 * 倒數，不是一個可以寫死的常數**。六隊的中職是 16.7%、三十隊的大聯盟是 3.3%，
 * 「這支球隊比一般球隊更接近冠軍嗎」這個問題因此只能拿同一個聯盟的平均去問。
 */
export function averageChampionshipOdds(table: LeagueTable): number {
  const c = cfg.team_strength.championship;
  return table.size === 0 ? 0 : c.scale / table.size;
}

/** 勝率的顯示字串，例如 .543。 */
export function fmtWinRate(rate: number): string {
  return rate.toFixed(3).replace(/^0/, '');
}
