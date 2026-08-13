/**
 * 職業球季模擬。
 *
 * 公式來自 `docs/design/simulation_math.md` §3-4，核心哲學是**先算時間，再算
 * 機率**：出賽場次與打席／局數先定下來，各項率再乘上去。這跟養成期的簡化版
 * （amateurStats.ts）相反——那邊一季只有幾場球，先算時間會被噪音吃掉。
 *
 * 所有可調數字都在 `season.json`，本模組不得寫死任何一個。
 * 抽取一律走 season 子序列（見 ADR 0002 的歸屬規則）。
 */

import { leagues, positions, season as cfg } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import type { Abilities } from './rating.ts';
import type { World } from './rng.ts';

/** 一條率的設定：與聯盟 par 同水準時是 base，每高一點加 per_point。 */
interface RateSpec {
  readonly base: number;
  readonly per_point: number;
  readonly min: number;
  readonly max: number;
  readonly ability?: string;
  readonly abilities?: Readonly<Record<string, number>>;
}

/** 職業打擊成績。比養成期多了長打分項與勝負無關的累積數。 */
export interface ProBattingLine extends BattingLine {
  readonly ibb: number;
  readonly double: number;
  readonly triple: number;
  readonly cs: number;
  /** 上壘率。 */
  readonly obp: number;
  /** 長打率。 */
  readonly slg: number;
}

/** 職業投球成績。 */
export interface ProPitchingLine extends PitchingLine {
  readonly role: 'SP' | 'RP';
  readonly starts: number;
  readonly wins: number;
  readonly losses: number;
  readonly saves: number;
}

export interface SeasonLine {
  readonly level: string;
  readonly batting: ProBattingLine | null;
  readonly pitching: ProPitchingLine | null;
}

export interface SeasonContext {
  readonly level: string;
  readonly ability: Abilities;
  readonly position: string;
  /** 綜合能力，用於信任度與升降級判定。 */
  readonly overall: number;
  readonly better: 'pitcher' | 'fielder';
  readonly twoWay: boolean;
}

/** 取聯盟層級設定。找不到就是資料壞了，直接炸開比默默用預設值好。 */
export function levelOf(level: string) {
  const info = leagues.levels[level];
  if (info === undefined) throw new Error(`未知的聯盟層級：${level}`);
  return info;
}

/** 依能力算出一條率並套上下限。支援單一能力或加權組合。 */
function rateOf(spec: RateSpec, ability: Abilities, par: number): number {
  let value = par;
  if (spec.abilities !== undefined) {
    // 權重和不必為 1——除以總權重讓加權組合仍落在能力值的量綱上。
    let sum = 0;
    let weight = 0;
    for (const [key, w] of Object.entries(spec.abilities)) {
      sum += (ability[key] ?? par) * w;
      weight += w;
    }
    value = weight === 0 ? par : sum / weight;
  } else if (spec.ability !== undefined) {
    value = ability[spec.ability] ?? par;
  }
  const raw = spec.base + (value - par) * spec.per_point;
  return Math.max(spec.min, Math.min(spec.max, raw));
}

/**
 * 實際出賽場次。
 *
 * `G = min(聯盟場次, 聯盟場次 × clamp(staF × posF) × perfF × noise)`
 *
 * 三個係數各自獨立：體力決定撐不撐得住、守位決定勞損、信任度決定教練排不排。
 * 最後的 min 確保絕不超過聯盟上限——沒有人能打超過球季場次。
 */
export function gamesPlayed(
  world: World,
  ability: Abilities,
  position: string,
  level: string,
  overall: number,
): number {
  const rng = world.stream('season');
  const info = levelOf(level);
  const pt = cfg.playing_time;

  const staF = clamp(
    pt.stamina_factor.value_at +
      ((ability[pt.stamina_factor.ability] ?? pt.stamina_factor.at) - pt.stamina_factor.at) *
        pt.stamina_factor.per_point,
    pt.stamina_factor.min,
    pt.stamina_factor.max,
  );

  // 守位勞損：捕手是斷層級懲罰，因此移防是延長單季出賽壽命的真實手段。
  const posF = pt.position_factor[position] ?? 1.0;
  const load = clamp(staF * posF, pt.position_factor_clamp.min, pt.position_factor_clamp.max);

  const perfF = trustFactor(overall, info.par);
  const noise = pt.games_noise.min + rng.next() * (pt.games_noise.max - pt.games_noise.min);

  return Math.round(Math.min(info.games, info.games * load * perfF * noise));
}

/** 教練信任度：打不好會被下放替補，打得好會被塞滿出賽。 */
export function trustFactor(overall: number, par: number): number {
  const t = cfg.playing_time.trust_factor;
  return clamp(t.base + (overall - par) * t.per_point, t.min, t.max);
}

/**
 * 賽季打席數。
 *
 * `PA = G × (4.0~4.3) × noise + random(-G/8, +G/8)`
 *
 * 絕對噪音除以場次而非用固定值——這讓隨機性隨出賽動態縮放，只打 20 場的人
 * 不會因為一個固定的 ±40 打席而數據崩壞。
 */
export function plateAppearances(world: World, games: number, overall: number, par: number): number {
  const rng = world.stream('season');
  const pt = cfg.playing_time;

  // 信任度高的人排在前段棒次，打席自然多——基數係數因此掛在信任度上。
  const trust = trustFactor(overall, par);
  const span = pt.pa_per_game.max - pt.pa_per_game.min;
  const perGame = pt.pa_per_game.min + span * normalize(trust, pt.trust_factor.min, pt.trust_factor.max);

  const mult = pt.pa_noise.min + rng.next() * (pt.pa_noise.max - pt.pa_noise.min);
  const abs = games / pt.pa_absolute_noise_divisor.value;
  return Math.max(0, Math.round(games * perGame * mult + rng.next() * abs * 2 - abs));
}

/**
 * 故意四壞：指數型恐懼值。
 *
 * `Dom = (pow + con + eye - spd/4) / 180`，只有 Dom > 1 的極端打者才會被敬遠。
 * 速度是扣分項——敬遠快腿等於免費送他上二壘，沒有教練會這麼做。
 */
export function intentionalWalks(world: World, ability: Abilities, pa: number): number {
  const rng = world.stream('season');
  const ibb = cfg.batting.intentional_walk;

  let sum = 0;
  for (const [key, w] of Object.entries(ibb.abilities)) sum += (ability[key] ?? 0) * w;
  const dom = sum / ibb.divisor;
  if (dom <= ibb.threshold) return 0;

  const noise = ibb.noise.min + rng.next() * (ibb.noise.max - ibb.noise.min);
  return Math.round((pa * Math.pow(dom, ibb.exponent)) / ibb.rate_divisor * noise);
}

/** 打出一季職業打擊成績。 */
export function proBattingLine(
  world: World,
  ability: Abilities,
  position: string,
  level: string,
  overall: number,
): ProBattingLine {
  const rng = world.stream('season');
  const b = cfg.batting;
  const par = levelOf(level).par;
  const noise = () => b.noise.min + rng.next() * (b.noise.max - b.noise.min);

  const games = gamesPlayed(world, ability, position, level, overall);
  const pa = plateAppearances(world, games, overall, par);

  const bb = Math.round(pa * rateOf(b.walk_rate, ability, par) * noise());
  const ibb = intentionalWalks(world, ability, pa);
  const ab = Math.max(0, pa - bb - ibb);

  const hits = Math.min(ab, Math.round(ab * rateOf(b.hit_rate, ability, par) * noise()));
  const hr = Math.min(hits, Math.round(ab * rateOf(b.hr_rate, ability, par) * noise()));

  // 長打依速度分配：快腿的三壘打明顯較多。剩下的才是一壘安打。
  const rest = hits - hr;
  const double = Math.min(rest, Math.round(rest * rateOf(b.extra_base.double_rate, ability, par)));
  const triple = Math.min(
    rest - double,
    Math.round(rest * rateOf(b.extra_base.triple_rate, ability, par)),
  );

  const rbi = Math.round(hits * b.rbi_per_hit + hr * b.rbi_per_hr_extra);

  const onBase = hits + bb + ibb;
  const attempts = Math.round(onBase * rateOf(b.steal.attempt_rate, ability, par) * noise());
  const sb = Math.round(attempts * rateOf(b.steal.success_rate, ability, par));

  const single = rest - double - triple;
  const bases = single + double * 2 + triple * 3 + hr * 4;

  return {
    games,
    pa,
    ab,
    hits,
    hr,
    rbi,
    bb,
    sb,
    ibb,
    double,
    triple,
    cs: Math.max(0, attempts - sb),
    avg: ab === 0 ? 0 : hits / ab,
    obp: pa === 0 ? 0 : (hits + bb + ibb) / pa,
    slg: ab === 0 ? 0 : bases / ab,
  };
}

/** 投手角色：體力夠且控球好的排進輪值，否則進牛棚。 */
export function pitcherRole(ability: Abilities, level: string): 'SP' | 'RP' {
  const par = levelOf(level).par;
  const r = cfg.pitching.role.starter;
  const sta = (ability['sta'] ?? par) - par;
  const ctl = (ability['ctl'] ?? par) - par;
  return sta >= r.sta_min_d && ctl >= r.ctl_min_d ? 'SP' : 'RP';
}

/** 投出一季職業投球成績。先發與後援的出賽結構完全不同，因此分開算。 */
export function proPitchingLine(
  world: World,
  ability: Abilities,
  level: string,
  overall: number,
): ProPitchingLine {
  const rng = world.stream('season');
  const p = cfg.pitching;
  const info = levelOf(level);
  const par = info.par;
  const d = overall - par;
  const role = pitcherRole(ability, level);

  let games: number;
  let starts: number;
  let ip: number;

  if (role === 'SP') {
    const slots = info.games / p.starter.rotation_divisor.value;
    const share = clamp(
      p.starter.gs_factor.base + d * p.starter.gs_factor.per_point,
      p.starter.gs_factor.min,
      p.starter.gs_factor.max,
    );
    starts = Math.round(slots * share);
    games = starts;
    const perStart = rateOf(p.starter.innings_per_start, ability, par);
    const n = p.starter.noise;
    ip = starts * perStart * (n.min + rng.next() * (n.max - n.min));
  } else {
    starts = 0;
    games = Math.round(
      clamp(p.reliever.games.base + d * p.reliever.games.per_point, p.reliever.games.min, p.reliever.games.max),
    );
    const per =
      p.reliever.innings_per_game.min +
      rng.next() * (p.reliever.innings_per_game.max - p.reliever.innings_per_game.min);
    const n = p.reliever.noise;
    ip = games * per * (n.min + rng.next() * (n.max - n.min));
  }
  ip = Math.round(ip * 10) / 10;

  const noise = () => p.noise.min + rng.next() * (p.noise.max - p.noise.min);
  const kPerInning = rateOf(p.strikeout_rate, ability, par) * noise();
  const bbPerInning = rateOf(p.walk_rate, ability, par) * noise();
  const era = clamp(rateOf(p.era, ability, par) * noise(), p.era.min, p.era.max);

  // 勝敗只給先發，救援成功只給後援——這是角色的直接後果，不另外擲。
  const winRate = clamp(
    p.decision.win_rate.base + d * p.decision.win_rate.per_point,
    p.decision.win_rate.min,
    p.decision.win_rate.max,
  );
  const decisions = role === 'SP' ? Math.round(starts * p.decision.starter_decision_rate) : 0;
  const wins = Math.round(decisions * winRate);

  return {
    role,
    games,
    starts,
    ip,
    so: Math.round(ip * kPerInning),
    bb: Math.round(ip * bbPerInning),
    er: Math.round((ip * era) / 9),
    era,
    wins,
    losses: decisions - wins,
    saves: role === 'RP' ? Math.round(games * p.decision.closer_save_rate * winRate) : 0,
  };
}

/**
 * 打完一季。
 *
 * 順序固定：投球先於打擊。二刀流兩邊都算——那正是二刀流在數據上的樣子。
 * 順序若隨角色變動，同一個種子會產生不同結果。
 */
export function playSeason(world: World, ctx: SeasonContext): SeasonLine {
  const asPitcher = ctx.twoWay || ctx.better === 'pitcher';
  const asBatter = ctx.twoWay || ctx.better === 'fielder';

  return {
    level: ctx.level,
    pitching: asPitcher ? proPitchingLine(world, ctx.ability, ctx.level, ctx.overall) : null,
    batting: asBatter
      ? proBattingLine(world, ctx.ability, ctx.position, ctx.level, ctx.overall)
      : null,
  };
}

/** 這個守位的體能勞損係數。未登錄的守位視為無勞損。 */
export function positionLoad(position: string): number {
  return cfg.playing_time.position_factor[position] ?? 1.0;
}

/** 守位的中文名稱。 */
export function positionName(position: string): string {
  return positions.positions[position] ?? position;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 把值映射到 [0,1]，供「係數轉比例」使用。 */
function normalize(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  return clamp((v - lo) / (hi - lo), 0, 1);
}
