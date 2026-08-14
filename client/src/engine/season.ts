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
import { standardOf, type LeagueStandards } from './league.ts';
import { bullpenScore, pitcherRating, type Abilities } from './rating.ts';
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

/** 職業打擊成績。與養成期共用同一組欄位，生涯累計才不會在升上職業時斷掉。 */
export type ProBattingLine = BattingLine;

/** 投手定位的中文名。 */
export const ROLE_NAMES: Readonly<Record<PitcherRole, string>> = {
  SP: '先發',
  RP: '中繼',
  CL: '終結者',
};

/** 職業投球成績。只多一個角色標記——三種角色的敘述與獎項都不同。 */
export interface ProPitchingLine extends PitchingLine {
  readonly role: PitcherRole;
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
  /** 當年的聯盟水準。null 表示用 leagues.json 的基準值。 */
  readonly standards?: LeagueStandards | null;
  /** 球隊勝率。輪值線掛在它上面——強隊難擠、弱隊容易占。二軍沒有戰力表，未知時視為 .500。 */
  readonly teamWinRate?: number | null;
  /**
   * 這一季的出賽係數，1 為全勤、0 為整季報銷。傷病落在這裡。
   *
   * **它乘的是出賽量，不是事後把數據打折**——他真的只上場了那麼多，因此率型
   * 數據（打擊率、防禦率）不受影響，累積型數據才會少。
   */
  readonly seasonFactor?: number;
}

/**
 * 取聯盟層級設定。找不到就是資料壞了，直接炸開比默默用預設值好。
 *
 * 注意：這裡的 par／min 是**基準值**。實際判定要用當年的值，見 `league.ts` 的
 * `standardOf()`——聯盟水準逐年浮動，直接讀這裡等於假裝聯盟永遠一樣強。
 * 場次數（games）不浮動，讀這裡是對的。
 */
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
  standards: LeagueStandards | null = null,
): number {
  const rng = world.stream('season');
  const info = levelOf(level);
  const par = standardOf(standards, level).par;
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

  const perfF = trustFactor(overall, par);
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
  standards: LeagueStandards | null = null,
  seasonFactor = 1,
): ProBattingLine {
  const rng = world.stream('season');
  const b = cfg.batting;
  const par = standardOf(standards, level).par;
  const noise = () => b.noise.min + rng.next() * (b.noise.max - b.noise.min);

  const games = Math.round(
    gamesPlayed(world, ability, position, level, overall, standards) * seasonFactor,
  );
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

  const so = Math.min(ab - hits, Math.round(ab * rateOf(b.strikeout_rate, ability, par) * noise()));
  const runs = Math.round(onBase * rateOf(b.runs_per_time_on_base, ability, par));

  return {
    games,
    pa,
    ab,
    runs,
    hits,
    double,
    triple,
    hr,
    rbi,
    bb,
    ibb,
    so,
    sb,
    cs: Math.max(0, attempts - sb),
    avg: ab === 0 ? 0 : hits / ab,
    obp: pa === 0 ? 0 : (hits + bb + ibb) / pa,
    slg: ab === 0 ? 0 : bases / ab,
  };
}

/** 場上的三種投手角色。中繼與終結者在出賽結構上相同，差別在拿到的是中繼還是救援。 */
export type PitcherRole = 'SP' | 'RP' | 'CL';

/**
 * 這一季的投手角色。見 ADR 0005。
 *
 * **先發與牛棚的分界是體力**——體力是絕對的生理條件，撐不了一百五十局就是撐
 * 不了，跟同年度有沒有別人更強無關，因此用固定的 d 值門檻。
 *
 * 體力過關之後還要擠得進輪值，而**輪值線掛在球隊戰力上**：強隊難擠、弱隊容易
 * 占。引擎沒有隊友名單，球隊戰力表就是同隊水準的代理。「在爛隊當先發、去強隊
 * 只能進牛棚」因此不必另外寫。
 *
 * 掉進牛棚之後由牛棚分決定關門還是中繼，用的是**當年的聯盟線**——一隊只有一個
 * 關門人，稀缺性得有地方表達，與單項王同一套模型。
 */
export function pitcherRole(
  world: World,
  ability: Abilities,
  level: string,
  options: {
    readonly standards?: LeagueStandards | null;
    /** 球隊勝率。二軍沒有戰力表，未知時視為 .500。 */
    readonly teamWinRate?: number | null;
    /** 先發評價。輪值線比的是它，不是綜合能力。 */
    readonly starterRating: number;
  },
): PitcherRole {
  const par = standardOf(options.standards ?? null, level).par;
  const r = cfg.pitching.role.starter;
  const rng = world.stream('season');

  // 抽取次數必須與資格無關，否則同一個種子會因為某年差一分而讓後面所有判定
  // 整串偏移。終結者的線每年都要抽，不管他有沒有掉進牛棚。
  const wobble = 1 + (rng.next() * 2 - 1) * cfg.pitching.role.closer.band;

  const sta = (ability['sta'] ?? par) - par;
  if (sta >= r.sta_min_d) {
    const winRate = options.teamWinRate ?? 0.5;
    const line = par + r.rotation.base_d + (winRate - 0.5) * r.rotation.per_win_rate;
    if (options.starterRating >= line) return 'SP';
  }

  const closerLine = par + cfg.pitching.role.closer.line_d * wobble;
  return bullpenScore(ability) >= closerLine ? 'CL' : 'RP';
}

/** 投出一季職業投球成績。先發與後援的出賽結構完全不同，因此分開算。 */
export function proPitchingLine(
  world: World,
  ability: Abilities,
  level: string,
  overall: number,
  standards: LeagueStandards | null = null,
  teamWinRate: number | null = null,
  seasonFactor = 1,
): ProPitchingLine {
  const rng = world.stream('season');
  const p = cfg.pitching;
  const info = levelOf(level);
  const par = standardOf(standards, level).par;
  const d = overall - par;
  const role = pitcherRole(world, ability, level, {
    standards,
    teamWinRate,
    starterRating: pitcherRating(ability, 'SP'),
  });

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
  // 傷病落在出賽量上：他真的只上場了那麼多，因此率型數據不受影響。
  games = Math.round(games * seasonFactor);
  starts = Math.round(starts * seasonFactor);
  ip *= seasonFactor;

  // 出局數才是原子單位——存小數會生出 29.5 這種棒球裡不存在的局數。
  const outs = Math.max(0, Math.round(ip * 3));
  ip = outs / 3;

  const noise = () => p.noise.min + rng.next() * (p.noise.max - p.noise.min);
  const kPerInning = rateOf(p.strikeout_rate, ability, par) * noise();
  const bbPerInning = rateOf(p.walk_rate, ability, par) * noise();
  const era = clamp(rateOf(p.era, ability, par) * noise(), p.era.min, p.era.max);

  // 勝敗、救援成功與中繼成功**全部掛在主數據上**——先發乘先發場次，後援乘後援
  // 出賽數，沒有任何欄位自己擲點數。後援本來就會掃勝也會背敗，舊版讓後援永遠
  // 0 勝 0 敗是錯的。
  const winRate = clamp(
    p.decision.win_rate.base + d * p.decision.win_rate.per_point,
    p.decision.win_rate.min,
    p.decision.win_rate.max,
  );
  const decisions =
    role === 'SP'
      ? Math.round(starts * p.decision.starter_decision_rate)
      : Math.round(games * p.decision.relief_decision_rate);
  const wins = Math.round(decisions * winRate);

  const er = Math.round((ip * era) / 9);

  return {
    role,
    games,
    starts,
    outs,
    hits: Math.round(ip * rateOf(p.hits_per_inning, ability, par) * noise()),
    runs: Math.round(er * p.runs_per_earned_run.value),
    er,
    bb: Math.round(ip * bbPerInning),
    so: Math.round(ip * kPerInning),
    era,
    wins,
    losses: decisions - wins,
    // 救援成功只給關門人，中繼成功只給中繼——舊版是「只要是後援就發救援成功」，
    // 於是牛棚裡人人都是終結者。
    saves: role === 'CL' ? Math.round(games * p.decision.closer_save_chance * winRate) : 0,
    holds: role === 'RP' ? Math.round(games * p.decision.hold_chance * winRate) : 0,
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

  const standards = ctx.standards ?? null;
  return {
    level: ctx.level,
    pitching: asPitcher
      ? proPitchingLine(
          world,
          ctx.ability,
          ctx.level,
          ctx.overall,
          standards,
          ctx.teamWinRate ?? null,
          ctx.seasonFactor ?? 1,
        )
      : null,
    batting: asBatter
      ? proBattingLine(
          world,
          ctx.ability,
          ctx.position,
          ctx.level,
          ctx.overall,
          standards,
          ctx.seasonFactor ?? 1,
        )
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
