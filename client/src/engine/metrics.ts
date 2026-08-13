/**
 * 進階指標：ERA+、OPS+、Win Shares。
 *
 * 三者都要跟「聯盟平均」比，因此核心是 `baseline()`——它用各項率的 base 值
 * （定義上就是「與聯盟同水準時的值」）組出一條聯盟平均的成績列。**基準線是
 * 算出來的，不是另外抄一份數字**，否則調整率的設定時基準線會偷偷失準。
 *
 * 這裡不抽任何亂數，全部是純函數。
 */

import { amateur, season as cfg } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import { levelOf } from './season.ts';

/** 聯盟平均：一名平均球員的上壘率、長打率與防禦率。 */
export interface Baseline {
  readonly obp: number;
  readonly slg: number;
  readonly era: number;
  /** 每個打席創造的分數，用於 Win Shares 的替代水準。 */
  readonly runsCreatedPerPa: number;
}

/**
 * 基本得分創造（Runs Created）。
 *
 * `RC = 上壘次數 × 壘打數 ÷ (打數 + 保送)`——Bill James 最早的那個版本。
 * 用最基本的形式是刻意的：它只需要我們已經有的欄位，而且看得懂。
 */
export function runsCreated(line: BattingLine): number {
  const onBase = line.hits + line.bb + line.ibb;
  const single = line.hits - line.double - line.triple - line.hr;
  const totalBases = single + line.double * 2 + line.triple * 3 + line.hr * 4;
  const denominator = line.ab + line.bb + line.ibb;
  return denominator === 0 ? 0 : (onBase * totalBases) / denominator;
}

/** 職業聯盟的平均水準。 */
export function proBaseline(level: string): Baseline {
  const b = cfg.batting;
  const pa = 600;
  const bb = pa * b.walk_rate.base;
  const ab = pa - bb;
  const hits = ab * b.hit_rate.base;
  const hr = ab * b.hr_rate.base;
  const rest = hits - hr;
  const double = rest * b.extra_base.double_rate.base;
  const triple = rest * b.extra_base.triple_rate.base;
  return build(pa, ab, bb, hits, double, triple, hr, cfg.pitching.era.base, levelOf(level).name);
}

/** 養成期的平均水準。門檻與職業不同，因此基準線也不同。 */
export function amateurBaseline(): Baseline {
  const b = amateur.amateur_stats.batting;
  const pa = 600;
  const bb = pa * b.walk_rate.base;
  const ab = pa - bb;
  const hits = ab * b.hit_rate.base;
  const hr = hits * b.hr_rate.base;
  const rest = hits - hr;
  const double = rest * b.double_rate.base;
  const triple = rest * b.triple_rate.base;
  return build(pa, ab, bb, hits, double, triple, hr, amateur.amateur_stats.pitching.era.base, '');
}

function build(
  pa: number,
  ab: number,
  bb: number,
  hits: number,
  double: number,
  triple: number,
  hr: number,
  era: number,
  _label: string,
): Baseline {
  const single = hits - double - triple - hr;
  const totalBases = single + double * 2 + triple * 3 + hr * 4;
  const line = {
    hits,
    bb,
    ibb: 0,
    double,
    triple,
    hr,
    ab,
  } as unknown as BattingLine;
  return {
    obp: pa === 0 ? 0 : (hits + bb) / pa,
    slg: ab === 0 ? 0 : totalBases / ab,
    era,
    runsCreatedPerPa: pa === 0 ? 0 : runsCreated(line) / pa,
  };
}

/**
 * ERA+：相對聯盟平均的防禦率，100 是聯盟平均，越高越好。
 *
 * 沒有投球局數就沒有意義，回傳 null 而不是 0——0 會被誤讀成「差到極點」。
 */
export function eraPlus(line: PitchingLine, base: Baseline): number | null {
  if (line.ip === 0 || line.era === 0) return null;
  return Math.round((base.era / line.era) * 100);
}

/**
 * OPS+：相對聯盟平均的攻擊表現，100 是聯盟平均。
 *
 * `100 × (OBP/lgOBP + SLG/lgSLG − 1)`。上壘與長打各自相對聯盟再相加，而不是
 * 直接把 OPS 相除——兩者的離散程度不同，直接相除會低估上壘型打者。
 */
export function opsPlus(line: BattingLine, base: Baseline): number | null {
  if (line.pa === 0 || base.obp === 0 || base.slg === 0) return null;
  return Math.round((line.obp / base.obp + line.slg / base.slg - 1) * 100);
}

/**
 * 打者的 Win Shares。
 *
 * 完整的 Bill James WS 要把球隊的總勝利分配給全隊，需要全隊的成績。這裡改用
 * 「相對替代水準的貢獻」直接估算個人值：比替代級球員多創造幾分，除以每勝
 * 所需分數，再乘上每勝三份的慣例。
 *
 * 數量級與真正的 WS 相當，但**不保證全隊加總等於球隊勝場的三倍**——這是取捨，
 * 換來的是不需要模擬隊友。
 */
export function battingWinShares(line: BattingLine, base: Baseline): number {
  const a = cfg.advanced;
  const replacement = base.runsCreatedPerPa * line.pa * a.batting_replacement;
  const above = runsCreated(line) - replacement;
  return Math.max(0, (above / a.runs_per_win) * a.win_shares_per_win);
}

/**
 * 投手的 Win Shares。
 *
 * 用「比替代級投手少失幾分」估算。替代水準是聯盟防禦率乘上一個倍率——一個
 * 隨時找得到的投手，防禦率本來就比聯盟平均差一截。
 */
export function pitchingWinShares(line: PitchingLine, base: Baseline): number {
  const a = cfg.advanced;
  const replacementEra = base.era * a.pitching_replacement_era_multiplier;
  const runsSaved = ((replacementEra - line.era) / 9) * line.ip;
  return Math.max(0, (runsSaved / a.runs_per_win) * a.win_shares_per_win);
}
