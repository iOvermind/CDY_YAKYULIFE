/**
 * 年度獎項。
 *
 * 每個球季結束後判定一次，但**兩類獎的判定方式不同**：
 *
 * - **單項王與年度最佳投手**是「聯盟第一名」——判定方式是算出當年的門檻線，
 *   達到就拿。那條線年年不同（`band`），因為它代表的是「今年聯盟第一名打到
 *   哪」：有些年份群雄並起，有些年份三成二就能拿走打擊王。低於下緣一定拿不
 *   到，高於上緣一定拿得到，中間則看那年抽到多少。
 * - **明星賽、新人王、MVP、守備獎**是票選或選拔——維持機率判定，因為它們
 *   本來就不是「數字最高的人自動獲得」。
 *
 * 率型門檻寫成 **d 值**（相對聯盟平均的能力差）而不是絕對成績，因此會自動
 * 跟著成績模型走：調了打擊率的斜率，門檻跟著變，不會默默失準。
 *
 * 獎項存成**結構化紀錄**而不是中文字串。legacy 用 `h.includes('王')` 這類字串
 * 比對回推計分，任何名字裡有「王」的東西都會被誤判成單項王；而且榮譽清單是
 * 刻意去重的，數不出「七座 MVP」。計分一律讀這裡產生的紀錄。
 *
 * 所有數字都在 `awards.json`。抽取走 career 子序列——得獎是生涯層級的事件，
 * 不是某一場球的結果。
 */

import { awards as cfg, type FieldingAward, type LeaderAward } from '../data/index.ts';
import { innings, type BattingLine, type PitchingLine } from './amateurStats.ts';
import {
  battingShares,
  pitchingShares,
  proBaseline,
  proBaselineAt,
  proLineAt,
  proPaAt,
  type Baseline,
} from './metrics.ts';
import type { World } from './rng.ts';
import { eraAt, levelOf, type PitcherRole } from './season.ts';

/**
 * 一座獎。
 *
 * `side` 讓二刀流的投打兩側分開評獎——同一年拿下年度最佳投手與打擊王是允許的，
 * 兩者互不稀釋。
 */
export interface AwardRecord {
  readonly year: number;
  /** 體系代碼，例如 CPBL。 */
  readonly org: string;
  /** 層級代碼，例如 CPBL1。 */
  readonly level: string;
  readonly code: string;
  readonly name: string;
  readonly side: 'pitcher' | 'batter' | 'both';
}

export interface AwardContext {
  readonly year: number;
  readonly org: string;
  readonly level: string;
  /** 該聯盟的球季場次。 */
  readonly leagueGames: number;
  /** d 值：綜合能力減當年 par。 */
  readonly d: number;
  readonly team: string;
  /** 是否為在這個體系的第一個球季（新人王用）。 */
  readonly rookie: boolean;
  readonly batting: BattingLine | null;
  readonly pitching: PitchingLine | null;
  /** 投手定位。沒投球時為 null。救援王限終結者、中繼王限中繼。 */
  readonly role: PitcherRole | null;
  /** 登錄的守備位置；沒登錄或不守備時為 null。 */
  readonly position: string | null;
  /** 守備勝率。沒有守位時為 null。 */
  readonly fieldingWinPct: number | null;
  /**
   * 這一季的勝利份額（打擊＋投球＋守備）。MVP 看它。
   *
   * 用份額而不是 d 值，是因為 MVP 問的是「他今年打得多好」而不是「他多強」。
   * 份額會自動把出賽時間、守位價值、投打合計與球隊戰績一起算進去。
   */
  readonly winShares: number;
  /** 只有打擊那一段的勝利份額。年度最佳打者看它。 */
  readonly battingWinShares: number;
  /** 這一季投球那一本的勝利份額。年度最佳投手看它。 */
  readonly pitchingWinShares: number;
  /**
   * 當年這個層級的能力離散度，單位與 d 值相同。「聯盟第一名」型的門檻由它推導。
   *
   * 由球季那一側算好帶進來——獎項模組不該去翻聯盟標準。見 ADR 0017。
   */
  readonly spread: number;
  /**
   * 這一季的出賽係數（傷病 × 禁賽），1 是全勤、0 是整季不在場上。
   *
   * 明星賽看它：在明星賽前就傷退或被禁賽的人不會入選（issue #37）。
   */
  readonly availability: number;
  /** 有〈全台主場〉：明星賽入選率另外加 `all_star.home_faith.add` 個百分點，不論效力哪一隊。 */
  readonly homeFaith: boolean;
}

/**
 * 畫一條門檻線需要知道的一切。`AwardContext` 天生就滿足它，所以實際發獎時
 * 直接把 ctx 傳進來即可；校正腳本則自己湊一個。
 *
 * 場次一律由呼叫端給——來源是 `leagues.json` 的 level.games，那是唯一基準。
 * 這裡曾經自己用 org 查一份 `thresholds.games` 副本，但那份表的鍵混了 org 與
 * level（`MLB` 是 level，其餘是 org），於是美職查不到、二軍全部沿用一軍的場
 * 次——只有五個聯盟的一軍是對的。見 ADR 0017。
 */
export interface LineInput {
  readonly level: string;
  readonly org: string;
  readonly leagueGames: number;
  readonly spread: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 從基準線取出某一項率。 */
function rateOf(base: Baseline, stat: string): number | null {
  switch (stat) {
    case 'avg':
      return base.avg;
    case 'obp':
      return base.obp;
    case 'era':
      return base.era;
    default:
      return null;
  }
}

/**
 * 一條推導成績單上的累積項。回 null 代表這項還推導不出來——投手的三振、救援、
 * 中繼都在這一邊，它們要的是投手版的 `proLineAt`，而那條還沒建。
 */
function countingOf(line: BattingLine, stat: string): number | null {
  switch (stat) {
    case 'hr':
      return line.hr;
    case 'rbi':
      return line.rbi;
    case 'sb':
      return line.sb;
    case 'runs':
      return line.runs;
    case 'hits':
      return line.hits;
    default:
      return null;
  }
}

/**
 * 這一年拿下這項獎需要的成績。
 *
 * 率型：`聯盟平均 + (門檻 − 聯盟平均) × (1 ± band)`。**波動加在超出聯盟平均
 * 的幅度上，不是加在絕對值上**——.380 的打擊率 ±12% 會讓線在 .334–.426 之間
 * 跳，那太誇張；加在超出幅度上則是 ±.014，剛好。
 *
 * 累積型：`門檻 × 場次比例 × (1 ± band)`。這類數據的自然下限就是 0，因此
 * 波動直接加在絕對值上。
 *
 * `roll` 是 0–1 的抽取值，決定那條線落在波動區間的哪裡。**roll 越大代表那年
 * 越難拿**——率型越高越好的獎（打擊率、上壘率）線往上抬，防禦率這種越低越好
 * 的則往下壓。方向雖然相反，語意是一致的。
 */
export function winningLine(award: LeaderAward, at: LineInput, roll: number): number | null {
  const { level } = at;
  const swing = 1 + (roll * 2 - 1) * award.band;
  const games = at.leagueGames;
  // 門檻線的球員是**能力 80 的那個人**（d = 80 − 大聯盟 par，現在是 18），也就是成績錨點的定義。
  // 這取代了對手池推導（ADR 0017）：對手池算的是「聯盟最強的那個人」，在大聯盟
  // 推出 d +22.5——那個人每一項能力都 81.5，現實中不存在，而且他已經超過錨點線，
  // 於是門檻每年都貼著紀錄。錨點線是一個講得出來的人；極值不是。
  const d = award.d;

  if (award.kind === 'rate') {
    if (d === undefined) return null;
    const average = rateOf(proBaseline(level), award.stat);
    const target = rateOf(proBaselineAt(level, d), award.stat);
    if (average === null || target === null) return null;
    return average + (target - average) * swing;
  }

  if (award.kind === 'shares' && award.stat === 'pitching_win_shares') {
    if (d === undefined) return null;
    // 年度最佳投手：比聯盟平均高 d 分的先發投滿一季的投球勝利份額。局數寫在資料裡
    // （每場球隊比賽幾局），防禦率照成績模型的 eraAt——與 ERA+ 的分母同一組公式。
    const par = levelOf(level).par;
    const ip = games * (award.ip_per_game ?? 1.35);
    const line = { outs: Math.round(ip * 3), era: eraAt(d, par) } as PitchingLine;
    return pitchingShares(line, proBaseline(level), null, 'SP').win * (award.line_scale ?? 1) * swing;
  }

  if (award.kind === 'shares') {
    if (d === undefined) return null;
    // **聯盟真尺**：門檻線吃該層級的 par，同一座獎全聯盟同一條線。個人的上限
    // 折扣（慣用手那類）不平移這裡——那會變成「某些人的 MVP 比較便宜」。
    const line = proLineAt(d, proPaAt(d, games), levelOf(level).par);
    const shares = battingShares(line, proBaseline(level), null);
    // 球隊勝率傳 null：門檻線問的是「這種等級的球員能打出多少份額」，不是
    // 「他在哪一隊」。球隊調整留給實際球員那一側，否則強隊的人門檻反而更高。
    // **門檻線只算打擊那一本，MVP 也一樣。**
    //
    // 它曾經用 `positionPlayerShares` 把守備那一段補回去，於是線變成「守備中庸
    // 的野手打滿整季」。問題是 OPS 高到能爭 MVP 的打者在這個遊戲裡幾乎都被守位
    // 光譜推到一壘或指定打擊，守備份額接近 0——大聯盟的線 34.53 份，而他的打擊
    // 那一本帳頂多 27.4 份，**結構上永遠到不了**。
    //
    // 球員那一側仍然吃三本帳（MVP 的 stat 是 win_shares），所以守得好的野手與
    // 二刀流照樣佔便宜，那是對的：MVP 本來就該把守備與投球算進去。
    return shares.win * (award.line_scale ?? 1) * swing;
  }

  // 累積型：門檻線就是「那個等級的球員在這個聯盟打這麼多場，會累積到多少」。
  // 場次已經在 proPaAt 裡了，所以短季聯盟不必再乘一次比例——那正是寫死 base
  // 的那條路的老問題：它照場次縮線，卻沒照聯盟水準縮，結果短季反而好拿。
  if (d !== undefined) {
    const line = proLineAt(d, proPaAt(d, games), levelOf(level).par);
    const value = countingOf(line, award.stat);
    if (value !== null) return value * swing;
  }

  if (award.base === undefined) return null;
  return award.base * (games / cfg.thresholds.reference_games) * swing;
}

/** 這項獎的成績是不是越低越好。目前只有防禦率。 */
function lowerIsBetter(stat: string): boolean {
  return stat === 'era';
}

/** 這一季的成績在某項統計上的值。找不到回傳 null——不是 0，0 會被當成真的有這個數字。 */
function statValue(ctx: AwardContext, stat: string): number | null {
  const b = ctx.batting;
  const p = ctx.pitching;
  switch (stat) {
    case 'so':
      return p?.so ?? null;
    case 'sv':
      return p?.saves ?? null;
    case 'hld':
      return p?.holds ?? null;
    case 'era':
      return p?.era ?? null;
    case 'avg':
      return b?.avg ?? null;
    case 'obp':
      return b?.obp ?? null;
    case 'hr':
      return b?.hr ?? null;
    case 'rbi':
      return b?.rbi ?? null;
    case 'sb':
      return b?.sb ?? null;
    case 'win_shares':
      return ctx.winShares;
    case 'batting_win_shares':
      return ctx.battingWinShares;
    case 'pitching_win_shares':
      return ctx.pitchingWinShares;
    case 'w':
      return p?.wins ?? null;
    default:
      return null;
  }
}

/**
 * 有沒有資格競爭這項獎。
 *
 * 打席或局數不足就沒有資格，不管成績多漂亮——一個只出賽三十場的人打三成八，
 * 不會是打擊王。
 */
function qualifies(ctx: AwardContext, award: LeaderAward): boolean {
  if (award.side === 'pitcher') {
    if (ctx.pitching === null) return false;
    // 沒投過就沒有資格，即使 `era` 欄位有值：那是「他若上場會投成怎樣」的率，
    // 不是他投出來的成績。少了這道，被清出投手名單的人會用一個沒兌現的防禦率
    // 去角逐防禦率王。
    if (ctx.pitching.outs === 0) return false;
    if (award.requires_role !== undefined && ctx.role !== award.requires_role) return false;
    if (award.min_ip_equals_games === true && innings(ctx.pitching) < ctx.leagueGames) return false;
    return true;
  }
  if (ctx.batting === null) return false;
  if (award.min_pa !== undefined && ctx.batting.pa < award.min_pa) return false;
  return true;
}

/**
 * 這一季拿不拿得下這項「聯盟第一名」型的獎。
 *
 * 先過資格，再與當年的門檻線比。防禦率越低越好，因此比較方向相反。
 */
function winsLeaderAward(ctx: AwardContext, award: LeaderAward, roll: number): boolean {
  if (!qualifies(ctx, award)) return false;
  const value = statValue(ctx, award.stat);
  if (value === null) return false;
  const line = winningLine(award, ctx, roll);
  if (line === null) return false;
  return lowerIsBetter(award.stat) ? value <= line : value >= line;
}

/**
 * MVP 的出場量資格。
 *
 * 投手看局數或後援場次，野手看打席——只要其中一條過得了就有資格。二刀流
 * 兩邊都算得上，因此他更容易站上這道門。
 */
function qualifiesForMvp(ctx: AwardContext): boolean {
  const q = cfg.mvp.qualify;
  if (ctx.pitching !== null && ctx.role !== null) {
    const ok =
      ctx.role === 'SP'
        ? innings(ctx.pitching) >= q.starter_min_ip
        : ctx.pitching.games >= q.reliever_min_games;
    if (ok) return true;
  }
  const b = ctx.batting;
  return b !== null && b.pa >= ctx.leagueGames * q.batter_pa_per_game;
}

/** 守備獎項：判定看守備勝率，不看守備分的顯示數字。 */
function fieldingChance(ctx: AwardContext, award: FieldingAward): number | null {
  const pct = ctx.fieldingWinPct;
  if (pct === null || ctx.position === null) return null;
  if (pct < award.min_win_pct) return null;
  if (pct >= award.god_win_pct) return 100;
  const steps = (pct - award.min_win_pct) / award.step;
  return clamp(award.base + steps * award.per_step, award.clamp.min, award.clamp.max);
}

/**
 * 判定這一季拿下哪些獎。
 *
 * 判定順序固定（明星賽 → 新人王 → 投手獎 → 單項王 → 守備獎 → MVP），因為每一次
 * 判定都會消耗一次抽取——順序變了，同一個種子就會給出不同的結果。
 */
export function annualAwards(world: World, ctx: AwardContext): readonly AwardRecord[] {
  const rng = world.stream('career');
  const out: AwardRecord[] = [];

  // 名稱查聯盟的別名表：同一個獎在不同聯盟有不同的名字——澤村賞、崔東源獎、
  // 賽揚獎講的是同一件事，但那不只是換皮，那是這個獎在那個聯盟的歷史。
  const add = (code: string, name: string, side: AwardRecord['side']) => {
    out.push({ year: ctx.year, org: ctx.org, level: ctx.level, code, name: awardName(ctx.org, code, name), side });
  };

  // ---- 明星賽
  {
    const a = cfg.all_star;
    // 沒打到明星賽的人不在票上——不是機率低，是根本不在名單上。
    const present = ctx.availability >= a.min_availability;
    // 次方曲線：平均水準的人拿得到但不常，強的人陡升上去（見 awards.json 的 _curve_note）。
    const x = Math.max(0, (ctx.d + a.shift) / a.shift);
    let chance = clamp(a.base * Math.pow(x, a.exponent), a.clamp.min, a.clamp.max);
    const pop = a.popularity_bonus;
    const popular = ctx.org === pop.league && ctx.team === pop.team;
    if (popular) chance = clamp(chance + pop.add, pop.clamp.min, pop.clamp.max);
    // 〈全台主場〉：主場的信仰就是票投得最多的那個人。與台中猛瑪的人氣加成疊加，
    // 上限跟它同一條。
    if (ctx.homeFaith) chance = clamp(chance + a.home_faith.add, pop.clamp.min, pop.clamp.max);
    // 天賦〈流量密碼〉乘在最後，上限同一條。
    if (a.talent_multiplier !== 1) chance = clamp(chance * a.talent_multiplier, pop.clamp.min, pop.clamp.max);
    // 照擲一次再判斷在不在場：缺席不改變後面其他獎的抽籤順序。
    if (rng.chance(chance) && present) {
      const byPopularity = popular && ctx.d < pop.flag_below_d;
      add('all_star', byPopularity ? '明星賽（人氣入選）' : '明星賽', 'both');
    }
  }

  // ---- 新人王
  {
    const a = cfg.rookie_of_year;
    if (ctx.rookie && ctx.d >= a.min_d) {
      const chance = clamp(
        a.base + (ctx.d - a.min_d) * a.per_d_over_min,
        a.clamp.min,
        a.clamp.max,
      );
      if (rng.chance(chance)) add('rookie_of_year', '新人王', 'both');
    }
  }

  // ---- 年度最佳投手
  {
    const a = cfg.pitcher_of_year;
    // 門檻線一律先抽，不管有沒有資格——抽取次數必須與資格無關，否則同一個
    // 種子會因為某年打席差幾個而讓後面所有判定整串偏移。
    const roll = rng.next();
    if (winsLeaderAward(ctx, a, roll)) add(a.code, a.name, a.side);
  }

  // ---- 年度最佳打者
  {
    const a = cfg.batter_of_year;
    const roll = rng.next();
    if (winsLeaderAward(ctx, a, roll)) add(a.code, a.name, a.side);
  }

  // ---- 單項王
  for (const title of cfg.titles.list) {
    const roll = rng.next();
    if (winsLeaderAward(ctx, title, roll)) add(title.code, title.name, title.side);
  }

  // ---- 守備獎項
  for (const award of cfg.fielding.list) {
    // 只在指定體系頒的獎（白金手套只有大聯盟）。不抽骰就跳過：抽取次數會跟著聯盟
    // 變，但同一個聯盟裡每一季都一樣，重播不受影響。
    if (award.orgs !== undefined && !award.orgs.includes(ctx.org)) continue;
    const chance = fieldingChance(ctx, award);
    if (chance !== null && rng.chance(chance)) add(award.code, award.name, 'batter');
  }

  // ---- 年度 MVP
  {
    const roll = rng.next();
    const line = winningLine(cfg.mvp, ctx, roll);
    if (qualifiesForMvp(ctx) && line !== null && ctx.winShares >= line) {
      add(cfg.mvp.code, cfg.mvp.name, 'both');
    }
  }

  return out;
}

/**
 * 這個獎在這個聯盟叫什麼。
 *
 * **只改顯示名稱，判定與計分完全共用同一套規則。** 查不到就用預設名——新增
 * 聯盟時不寫別名表也不會壞。
 */
export function awardName(org: string, code: string, fallback: string): string {
  const table = cfg.aliases[org];
  return table?.[code] ?? fallback;
}

/**
 * 某個代碼的獎拿過幾座。
 *
 * 這正是獎項要結構化的理由——榮譽清單刻意去重，數不出「七座 MVP」。
 */
export function countAwards(records: readonly AwardRecord[], code: string): number {
  return records.filter((r) => r.code === code).length;
}
