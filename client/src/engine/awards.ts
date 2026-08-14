/**
 * 年度獎項。
 *
 * 每個球季結束後判定一次。判定的形狀一律相同：**先過資格門檻，再擲機率**——
 * 成績達到基礎門檻才有機會，達到鬼神門檻則必定入選。這保留了「打出好成績也
 * 可能拿不到獎」的真實感（獎是投票投出來的，不是成績表自動兌換的），同時讓
 * 壓倒性的球季不會空手而回。
 *
 * 獎項存成**結構化紀錄**而不是中文字串。legacy 用 `h.includes('王')` 這類字串
 * 比對回推計分，任何名字裡有「王」的東西都會被誤判成單項王；而且榮譽清單是
 * 刻意去重的，數不出「七座 MVP」。計分一律讀這裡產生的紀錄。
 *
 * 所有數字都在 `awards.json`。抽取走 career 子序列——得獎是生涯層級的事件，
 * 不是某一場球的結果。
 */

import { awards as cfg, type FieldingAward, type TitleAward } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
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
}

/** 取該體系的門檻表。沒有對應設定的聯盟退回預設。 */
function thresholdsOf(org: string) {
  return cfg.thresholds[org] ?? cfg.thresholds['CPBL']!;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 由「超出基礎門檻多少」算出機率。
 *
 * 達到鬼神門檻直接回傳 100——壓倒性的球季不該還要看運氣。
 */
function chanceFrom(
  value: number,
  gate: readonly number[] | undefined,
  spec: { base: number; step: number; per_step: number; clamp: { min: number; max: number } },
): number | null {
  const floor = gate?.[0];
  const god = gate?.[1];
  if (floor === undefined || value < floor) return null;
  if (god !== undefined && value >= god) return 100;
  const steps = (value - floor) / spec.step;
  return clamp(spec.base + steps * spec.per_step, spec.clamp.min, spec.clamp.max);
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
    default:
      return null;
  }
}

/** 這項單項王的資格。打席或局數不足就沒有資格，不管成績多漂亮。 */
function qualifiesForTitle(ctx: AwardContext, title: TitleAward): boolean {
  if (title.side === 'pitcher') {
    if (ctx.pitching === null) return false;
    if (title.requires_role !== undefined && ctx.role !== title.requires_role) return false;
    if (title.min_ip !== undefined && ctx.pitching.ip < title.min_ip) return false;
    return true;
  }
  if (ctx.batting === null) return false;
  if (title.min_pa !== undefined && ctx.batting.pa < title.min_pa) return false;
  return true;
}

/** 年度最佳投手：限先發，局數需達該聯盟的場次數，防禦率需達門檻。 */
function pitcherOfYearChance(ctx: AwardContext): number | null {
  const p = ctx.pitching;
  const a = cfg.pitcher_of_year;
  if (p === null || ctx.role !== a.requires_role) return null;
  const gate = thresholdsOf(ctx.org)['era'];
  const floor = gate?.[0];
  const god = gate?.[1];
  if (floor === undefined || p.era > floor || p.ip < ctx.leagueGames) return null;
  if (god !== undefined && p.era <= god && p.ip >= a.god.ip) return 100;
  return clamp(
    a.base + (floor - p.era) * a.era_factor + (p.ip - ctx.leagueGames) * a.ip_factor,
    a.clamp.min,
    a.clamp.max,
  );
}

/** 年度 MVP：資格看出場量，機率看 d 值。 */
function mvpChance(ctx: AwardContext): number | null {
  const m = cfg.mvp;
  if (ctx.d < m.min_d) return null;

  let roleKey: string;
  if (ctx.pitching !== null && ctx.role !== null) {
    const ok =
      ctx.role === 'SP'
        ? ctx.pitching.ip >= m.qualify.starter_min_ip
        : ctx.pitching.games >= m.qualify.reliever_min_games;
    if (!ok && ctx.batting === null) return null;
    roleKey = ok ? ctx.role : 'batter';
  } else {
    roleKey = 'batter';
  }
  if (roleKey === 'batter') {
    const b = ctx.batting;
    if (b === null || b.pa < ctx.leagueGames * m.qualify.batter_pa_per_game) return null;
  }

  if (ctx.d >= m.god_d) return 100;
  const base = m.base[roleKey] ?? m.base['batter'] ?? 0;
  return clamp(base + (ctx.d - m.min_d) * m.per_d_over_min, m.clamp.min, m.clamp.max);
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
  const th = thresholdsOf(ctx.org);

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
    const chance = pitcherOfYearChance(ctx);
    if (chance !== null && rng.chance(chance)) {
      add('pitcher_of_year', cfg.pitcher_of_year.name, 'pitcher');
    }
  }

  // ---- 單項王
  for (const title of cfg.titles.list) {
    if (!qualifiesForTitle(ctx, title)) continue;
    const value = statValue(ctx, title.stat);
    if (value === null) continue;
    const chance = chanceFrom(value, th[title.stat], title);
    if (chance !== null && rng.chance(chance)) add(title.code, title.name, title.side);
  }

  // ---- 守備獎項
  for (const award of cfg.fielding.list) {
    const chance = fieldingChance(ctx, award);
    if (chance !== null && rng.chance(chance)) add(award.code, award.name, 'batter');
  }

  // ---- 年度 MVP
  {
    const chance = mvpChance(ctx);
    if (chance !== null && rng.chance(chance)) add('mvp', cfg.mvp.name, 'both');
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
