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
 * 大多數隊名是「地名＋兩字代表詞」（台中猛瑪 → 猛瑪），少數代表詞超過兩個字
 * （沙城競技者 → 競技者）。`teams.json` 只在後者標了 nick，其餘照 `nick_fallback`
 * 取末兩字——把每一隊都列一次只會多一份會過期的資料。
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
  //
  // **夾子是一道硬邊，只管單一球隊。** 每支球隊照自己的體質走，各自夾在
  // [.300, .700]，不隨隊數浮動、也不管全聯盟的平均。
  //
  // 兩條試過又拿掉的路留在這裡，免得有人再走一次：
  //
  // 一是「同一年的平均勝率平移回 .500」（封閉聯盟裡每一勝都是別人的一敗）。它讓
  // 玩家的貢獻變成零和的——自己多贏就從對手身上扣——於是他自己的奪冠率反而被推高。
  //
  // 二是「把奪冠機率的上下限反解成勝率界線」，讓六隊聯盟夾得比三十隊聯盟緊。那條
  // 線在大聯盟反解出 .798（一年 129 勝），而在小聯盟把墊底的球隊抬到 .345——兩頭
  // 都不像棒球。**勝率是勝率，它的合理範圍與聯盟有幾隊無關。**
  //
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
export function championshipOdds(table: LeagueTable, team: string, boost: ChampionshipBoost | null = null): number {
  return championshipOddsOf(table, boost).get(team) ?? 0;
}

/** 某一隊的奪冠權重再乘一個倍率（〈今晚打老虎〉）。其他隊照比例分掉剩下的。 */
export interface ChampionshipBoost {
  readonly team: string;
  readonly multiplier: number;
}

/** 玩家的特性帶來的奪冠加成；沒有就是 null。 */
export function championshipBoost(team: string, traits: ReadonlySet<string>): ChampionshipBoost | null {
  const c = cfg.team_strength.championship.clutch;
  return traits.has(c.trait) ? { team, multiplier: c.multiplier } : null;
}

/**
 * 全聯盟的奪冠機率，**加起來是 1**。
 *
 * 勝率取次方之後的佔比，**沒有夾子也沒有縮放**。機率完全由勝率推導：一支球隊的
 * 奪冠機率就是它在全聯盟裡的相對強度，而總和因此天生是 1——那就是「每年恰好有一支
 * 球隊奪冠」這件事。
 *
 * 曾經在這裡夾過上下限（絕對值 1% 與 55%，後來改成隊數的函數）。夾機率必然要再照
 * 比例縮放回 1，而縮放讓極端值溢出；改成夾勝率則等於宣稱「小聯盟的球隊不准太強或
 * 太爛」，那不成立。兩條都拿掉了：**機率不是可以調的旋鈕，它是勝率的結果。**
 *
 * 平均值因此永遠是隊數的倒數：六隊的中職 16.7%、三十隊的大聯盟 3.3%。上緣由勝率
 * 的硬邊決定——一支 .700 的球隊配五支 .300 的，它在中職拿到 57%，而那正是那種年份
 * 該有的樣子。
 */
export function championshipOddsOf(
  table: LeagueTable,
  boost: ChampionshipBoost | null = null,
): ReadonlyMap<string, number> {
  const c = cfg.team_strength.championship;
  const out = new Map<string, number>();
  if (table.size === 0) return out;

  const weight = (name: string, winRate: number): number =>
    Math.pow(winRate, c.exponent) * (boost !== null && boost.team === name ? boost.multiplier : 1);
  let total = 0;
  for (const [name, t] of table) total += weight(name, t.winRate);
  if (total === 0) return out;
  for (const [name, t] of table) out.set(name, weight(name, t.winRate) / total);
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
export function pickChampion(
  world: World,
  table: LeagueTable,
  boost: ChampionshipBoost | null = null,
): string | null {
  const odds = championshipOddsOf(table, boost);
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
