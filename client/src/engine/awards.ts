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
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import { proBaseline, proBaselineAt, type Baseline } from './metrics.ts';
import type { World } from './rng.ts';

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
  /** 投手定位。沒投球時為 null。 */
  readonly role: 'SP' | 'RP' | null;
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
}

/** 該體系的球季場次。累積型門檻依它等比放大。 */
export function leagueGamesOf(org: string): number {
  return cfg.thresholds.games[org] ?? cfg.thresholds.default_games;
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
export function winningLine(award: LeaderAward, level: string, org: string, roll: number): number | null {
  const swing = 1 + (roll * 2 - 1) * award.band;

  if (award.kind === 'rate') {
    if (award.d === undefined) return null;
    const average = rateOf(proBaseline(level), award.stat);
    const target = rateOf(proBaselineAt(level, award.d), award.stat);
    if (average === null || target === null) return null;
    return average + (target - average) * swing;
  }

  if (award.base === undefined) return null;
  const scale = leagueGamesOf(org) / cfg.thresholds.reference_games;
  return award.base * scale * swing;
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
    if (award.requires_role !== undefined && ctx.role !== award.requires_role) return false;
    if (award.min_ip_equals_games === true && ctx.pitching.ip < ctx.leagueGames) return false;
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
  const line = winningLine(award, ctx.level, ctx.org, roll);
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
        ? ctx.pitching.ip >= q.starter_min_ip
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

  const add = (code: string, name: string, side: AwardRecord['side']) => {
    out.push({ year: ctx.year, org: ctx.org, level: ctx.level, code, name, side });
  };

  // ---- 明星賽
  {
    const a = cfg.all_star;
    let chance = clamp(a.base + ctx.d * a.per_d, a.clamp.min, a.clamp.max);
    const pop = a.popularity_bonus;
    const popular = ctx.org === pop.league && ctx.team === pop.team;
    if (popular) chance = clamp(chance + pop.add, pop.clamp.min, pop.clamp.max);
    if (rng.chance(chance)) {
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

  // ---- 單項王
  for (const title of cfg.titles.list) {
    const roll = rng.next();
    if (winsLeaderAward(ctx, title, roll)) add(title.code, title.name, title.side);
  }

  // ---- 守備獎項
  for (const award of cfg.fielding.list) {
    const chance = fieldingChance(ctx, award);
    if (chance !== null && rng.chance(chance)) add(award.code, award.name, 'batter');
  }

  // ---- 年度 MVP
  {
    const roll = rng.next();
    const line = winningLine(cfg.mvp, ctx.level, ctx.org, roll);
    if (qualifiesForMvp(ctx) && line !== null && ctx.winShares >= line) {
      add(cfg.mvp.code, cfg.mvp.name, 'both');
    }
  }

  return out;
}

/**
 * 某個代碼的獎拿過幾座。
 *
 * 這正是獎項要結構化的理由——榮譽清單刻意去重，數不出「七座 MVP」。
 */
export function countAwards(records: readonly AwardRecord[], code: string): number {
  return records.filter((r) => r.code === code).length;
}
