/**
 * 職業球季模擬。
 *
 * 公式來自 `docs/design/formulas.md`〈職業球季〉，核心哲學是**先算時間，再算
 * 機率**：出賽場次與打席／局數先定下來，各項率再乘上去。這跟養成期的簡化版
 * （amateurStats.ts）相反——那邊一季只有幾場球，先算時間會被噪音吃掉。
 *
 * 所有可調數字都在 `season.json`，本模組不得寫死任何一個。
 * 抽取一律走 season 子序列（見 ADR 0002 的歸屬規則）。
 */

import { ALL_ABILITIES, leagues, positions, season as cfg, type RecordSpec } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import { leagueStandardOf, type LeagueStandards } from './league.ts';
import { defenseRuns } from './defense.ts';
import { bullpenScore, pitcherStuff, sideOveralls, type Abilities, type Rating } from './rating.ts';
import type { World } from './rng.ts';


/** 職業打擊成績。與養成期共用同一組欄位，生涯累計才不會在升上職業時斷掉。 */
export type ProBattingLine = BattingLine;

/** 投手定位的中文名。 */
export const ROLE_NAMES: Readonly<Record<PitcherRole, string>> = {
  SP: '先發',
  CP: '終結者',
  SU: '布局',
  MR: '中繼',
  LR: '長中繼',
};

/** 職業投球成績。只多一個角色標記——三種角色的敘述與獎項都不同。 */
export interface ProPitchingLine extends PitchingLine {
  readonly role: PitcherRole;
}

export interface SeasonLine {
  readonly level: string;
  readonly batting: ProBattingLine | null;
  readonly pitching: ProPitchingLine | null;
  /**
   * 這一季的守備分。**不計分的情況是 0**——純投手、指定打擊、二軍，都沒有它。
   *
   * 守備分只在頂級聯盟算：二軍現在也有登錄守位（ADR 0037），但守備分是拿來與
   * 同層對手比的，二軍的守備不該進生涯的守備勝利份額。
   */
  readonly defenseRuns: number;
}

export interface SeasonContext {
  readonly level: string;
  /**
   * 這一季的能力：**含當季暫時能力**（ADR 0006）。
   *
   * 打擊、投球與守備分吃的是同一份——當季狀態講的是「他今年的身手」，沒有理由
   * 只算進打擊與投球（issue #3）。
   */
  readonly ability: Abilities;
  /** 登錄守位。打擊那一側用它——純投手在職業沒有守位，呼叫端給 DH。 */
  readonly position: string;
  /**
   * 守備分要算的守位。**null 就是不算**。
   *
   * 與 `position` 分開是刻意的：純投手的打擊成績仍要標一個位置（DH），但他不
   * 該有守備分。指定打擊同理，由 `defenseRuns()` 自己擋掉。
   */
  readonly scoringPosition: string | null;
  /**
   * 這一季的評價。**兩側各認自己那一側的扣分在這裡算**，不必由呼叫端先算好。
   */
  readonly rating: Rating;
  /**
   * 定位鎖定的那一側；還沒鎖定是 null。
   *
   * 鎖定之後就照鎖定的那一側打，不再每季比較評價高低——職業球員的角色是固定
   * 的，不會因為某年打擊練得比較好就改當野手。
   */
  readonly lockedSide: 'pitcher' | 'fielder' | null;
  readonly twoWay: boolean;
  /** 當年的聯盟水準。null 表示用 leagues.json 的基準值。 */
  readonly standards: LeagueStandards | null;
  /** 球隊勝率。輪值線掛在它上面——強隊難擠、弱隊容易占。未知時視為 .500。 */
  readonly teamWinRate: number | null;
  /**
   * 這一季**已登錄的**投手定位；沒有登錄過是 null。
   *
   * 與守位同一個立場：定位是每季在定位會議上決定的，不是每次算成績時重新判定。
   * 傳 null 的話由 `proPitchingLine()` 現算——那是「這個呼叫端還沒有定位會議」
   * 的意思，不是「這一季不必決定」。
   */
  readonly pitcherRole: PitcherRole | null;
  /**
   * 這一季的出賽係數，1 為全勤、0 為整季報銷。傷病落在這裡。
   *
   * **它乘的是出賽量，不是事後把數據打折**——他真的只上場了那麼多，因此率型
   * 數據（打擊率、防禦率）不受影響，累積型數據才會少。
   */
  readonly seasonFactor: number;
  /** 生涯蹲過幾季捕手，見 `catcherSpeedFactor`。沒給就是 0。 */
  readonly catcherSeasons?: number;
}

/**
 * 取聯盟層級設定。找不到就是資料壞了，直接炸開比默默用預設值好。
 *
 * 注意：這裡的 par／min 是**基準值**。實際判定要用當年的值，見 `league.ts` 的
 * `leagueStandardOf()`——聯盟水準逐年浮動，直接讀這裡等於假裝聯盟永遠一樣強。
 * 場次數（games）不浮動，讀這裡是對的。
 */
export function levelOf(level: string) {
  const info = leagues.levels[level];
  if (info === undefined) throw new Error(`未知的聯盟層級：${level}`);
  return info;
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
  const par = leagueStandardOf(standards, level).par;
  const pt = cfg.playing_time;

  const staF = staminaFactor(ability[pt.stamina_factor.ability] ?? 0, info.games);

  // 守位勞損：捕手是斷層級懲罰，因此移防是延長單季出賽壽命的真實手段。
  const posF = pt.position_factor[position] ?? 1.0;
  const load = clamp(staF * posF, pt.position_factor_clamp.min, pt.position_factor_clamp.max);

  const perfF = trustFactor(overall, par);
  const noise = pt.games_noise.min + rng.next() * (pt.games_noise.max - pt.games_noise.min);

  // 判定放在抽完噪音之後：抽取次數不能隨結果變動，否則同一顆種子會因為某年
  // 少抽一次而讓後面整串偏移（ADR 0002）。
  if (offRoster(overall, par)) return 0;

  return Math.round(Math.min(info.games, info.games * load * perfF * noise));
}

/**
 * 體力健康係數 staF：由 `sta` 換算成「能撐住整季的幾成」。
 *
 * 錨點表分段線性內插，兩端各自壓平。**曲線不是直線**——40→55 的斜率是
 * 55→65 的三倍，因為前半段買的是「從輪替變成先發」，後半段買的是「從先發
 * 變成鐵人」。用單一斜率去配這兩件事，一定有一頭是錯的。
 *
 * 上限刻意大於 1.0：SS 的 `position_factor` 是 0.95，要讓「sta 65 的游擊手
 * 打滿整季」成立，staF 就得補得回那 5%。
 */
export function staminaFactor(sta: number, leagueGames = cfg.playing_time.stamina_factor.reference_games): number {
  const s = cfg.playing_time.stamina_factor;
  const pts = s.anchors;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;

  // 短賽季比較不操，所以門檻要跟著降——但**要沿能力軸降，不是沿 staF 軸降**。
  //
  // 曲線是凹的，兩種降法差很多：中職 120 場是大聯盟的 74%，若拿 staF 打
  // 0.74 折，需求會直接掉到底限，體力在中職完全不影響出賽場數——而中職正是
  // 校準的主樣本，等於把旋鈕在主樣本上關掉。沿能力軸內插則是
  // `40 + (55−40) × 0.74 = 51`，體力仍然分得出高下。
  //
  // 實作上等價於把底限之上的能力距離拉長，再餵回同一條曲線。
  const scale = leagueGames / s.reference_games;
  const adj = scale > 0 ? first.sta + (sta - first.sta) / scale : sta;

  if (adj <= first.sta) return clamp(first.value, s.min, s.max);
  if (adj >= last.sta) return clamp(last.value, s.min, s.max);
  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1]!;
    const hi = pts[i]!;
    if (adj <= hi.sta) {
      const t = (adj - lo.sta) / (hi.sta - lo.sta);
      return clamp(lo.value + t * (hi.value - lo.value), s.min, s.max);
    }
  }
  return clamp(last.value, s.min, s.max);
}

/**
 * 這個守位「打滿整季」需要的 `sta`。
 *
 * 反解 `staminaFactor(sta) × posF = 1`。這是 {@link staminaFactor} 的逆函數，
 * 所以它**不是另一組手寫數字**——改了錨點表或 `position_factor`，這裡自動跟著動。
 *
 * 得到的階梯是 DH 55、1B 57、LF 59、3B/RF 61、2B 63、SS/CF 65、C 76.5。
 *
 * 捕手那個 76.5 沒有人到得了（實測生涯最高 sta max 64），所以傷病那一側用
 * `zero_point_cap` 把它壓到 70——但**那是傷病自己的取捨，不屬於這個函數**，
 * 這裡照實回傳反解的結果。
 */
export function fullSeasonSta(
  position: string,
  leagueGames = cfg.playing_time.stamina_factor.reference_games,
): number {
  const s = cfg.playing_time.stamina_factor;
  const posF = cfg.playing_time.position_factor[position] ?? 1.0;
  const want = 1 / posF;
  const pts = s.anchors;

  let base = pts[pts.length - 1]!.sta;
  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1]!;
    const hi = pts[i]!;
    if (want <= hi.value) {
      const span = hi.value - lo.value;
      const t = span === 0 ? 0 : (want - lo.value) / span;
      base = lo.sta + t * (hi.sta - lo.sta);
      break;
    }
  }
  if (want <= pts[0]!.value) base = pts[0]!.sta;

  return staThresholdForLeague(base, leagueGames);
}

/**
 * 把一個以 162 場為尺量出的 `sta` 門檻換算到別的聯盟。
 *
 * 與 {@link staminaFactor} 內部的短賽季調整是同一件事反過來走，抽出來是為了讓
 * 傷病那一側也能沿同一條軸換算，而不是各寫各的。
 */
export function staThresholdForLeague(
  sta: number,
  leagueGames = cfg.playing_time.stamina_factor.reference_games,
): number {
  const s = cfg.playing_time.stamina_factor;
  const floor = s.anchors[0]!.sta;
  return floor + (sta - floor) * (leagueGames / s.reference_games);
}

/** 教練信任度：打不好會被下放替補，打得好會被塞滿出賽。 */
export function trustFactor(overall: number, par: number): number {
  const t = cfg.playing_time.trust_factor;
  const d = overall - par;
  if (d >= 0) return clamp(t.base + d * t.per_point, t.min, t.max);
  // 低於平均那一側是 1.5 次方：一開始緩降、然後劇烈降，d = −span 落到 min（issue #14）。
  return Math.max(t.min, t.base - (t.base - t.min) * belowCurve(d, t.below));
}

/** 低於聯盟平均那一側的進度：0 在 par，1 在 −span 以下，中間走 exponent 次方。 */
function belowCurve(d: number, spec: { readonly span: number; readonly exponent: number }): number {
  return Math.pow(Math.min(1, -d / spec.span), spec.exponent);
}

/**
 * 這一側是否連名單都排不進去。
 *
 * `trustFactor` 的 min 是**名單裡的最後一格**，不是「再爛也有得打」的保證：
 * 掉到觸底點以下就是 0 場。斷崖是刻意的——名單是離散的，現實中沒有從一年
 * 40 場平滑滑到一年 3 場這條路，你要嘛佔著位子、要嘛被清掉。
 *
 * 二刀流兩側各判各的：投球那側被清掉不影響他繼續當野手上場。
 */
export function offRoster(overall: number, par: number): boolean {
  return overall - par < cfg.playing_time.trust_factor.cut_d;
}

/**
 * 每場打席數——棒次的代理值。
 *
 * 能力越高排得越前面，一場就多站一次打擊區。**刻意不走 `trustFactor`**：那條
 * 係數 d ≥ +5 就飽和到 1.0，會把所有站得住腳的打者壓成同一個 PA/場，於是單季
 * 打席永遠摸不到設計上限。棒次要的正是 trust 拒絕提供的那段解析度。
 */
export function paPerGame(overall: number, par: number): number {
  const p = cfg.playing_time.pa_per_game;
  return clamp(p.at_par + (overall - par) * p.per_point, p.min, p.max);
}

/**
 * 賽季打席數。
 *
 * `PA = G × paPerGame(d) × noise + random(-G/8, +G/8)`
 *
 * 絕對噪音除以場次而非用固定值——這讓隨機性隨出賽動態縮放，只打 20 場的人
 * 不會因為一個固定的 ±40 打席而數據崩壞。
 */
export function plateAppearances(
  world: World,
  starts: number,
  bench: number,
  overall: number,
  par: number,
): number {
  const rng = world.stream('season');
  const pt = cfg.playing_time;

  // 先發那幾場站棒次決定的次數，替補那幾場站的少得多——代打通常就是一個打席。
  const perGame = paPerGame(overall, par);
  const perBench = benchPaPerGame(overall - par);

  const mult = pt.pa_noise.min + rng.next() * (pt.pa_noise.max - pt.pa_noise.min);
  const abs = (starts + bench) / pt.pa_absolute_noise_divisor.value;
  return Math.max(
    0,
    Math.round((starts * perGame + bench * perBench) * mult + rng.next() * abs * 2 - abs),
  );
}

/**
 * 先發率：有上場的那些場次裡，幾場是先發。
 *
 * **出賽不等於先發。** 一個整季一百場都是第七局才上去代打的人，用「出賽 × 棒次」
 * 算會得到三百多個打席——那是先發球員的量。
 *
 * 刻意不重用 `trustFactor`：信任度已經乘在 `gamesPlayed()` 裡了，再乘一次等於 d 的
 * 效果平方，邊緣球員被砍兩刀。不過**它飽和在 1.0 這件事在這裡反而是對的**——明顯
 * 強過 par 的人，他有上場的每一場本來就都是先發。
 */
export function startShare(overall: number, par: number): number {
  const s = cfg.batting.start_share;
  const d = overall - par;
  if (d >= 0) return clamp(s.at_par + d * s.per_point, s.min, s.max);
  // 與出賽係數同一個形狀：跟不上的人上場的那幾場也全是替補（issue #14）。
  return Math.max(s.min, s.at_par * (1 - belowCurve(d, s.below)));
}

/**
 * 替補上場那一場站幾次打擊區。低於聯盟平均時線性降下去：代跑、守備替補、垃圾
 * 時間——那種上場不一定輪得到打擊（issue #14）。
 */
export function benchPaPerGame(d: number): number {
  const b = cfg.batting.bench_pa_per_game;
  if (d >= 0) return b.value;
  return b.value - (b.value - b.at_floor) * Math.min(1, -d / b.span);
}

/**
 * 一格紀錄錨定的數據。
 *
 * `anchor × (機會數 / per) × ratio × noise`，四捨五入之後加上抖動，**最後才夾**。
 * 夾在最後是關鍵：抖動寫在 `min()` 外面的話，`HR = min(H, …) + 3` 會生出比安打還多
 * 的全壘打，`3B = 0 + (-3)` 會生出負的三壘打。
 */
function anchored(
  anchor: number,
  volume: number,
  ratio: number,
  noise: number,
  jitter: number,
  cap: number,
): number {
  const raw = Math.round(anchor * volume * ratio * noise) + jitter;
  return Math.max(0, Math.min(cap, raw));
}

/** 一格能力加權和，先平移到基準聯盟。 */
function weightedShifted(spec: RecordSpec, ability: Abilities, par: number): number {
  let sum = spec.offset ?? 0;
  for (const [key, w] of Object.entries(spec.weights ?? {})) sum += (ability[key] ?? 0) * w;
  return sum - (spec.par_slope ?? 0) * (par - cfg.batting.reference_par);
}

/**
 * 一格的能力佔比，夾在 `ratio_cap`，下限由 `floor` 決定。
 *
 * 比值的定義是 `(加權平均能力 − par + 62) / 80`——**納入的能力都到 80 就是 1.0，
 * 也就是打到錨點**。因此 `divisor` 必然是 `80 × 權重和`、`par_slope` 必然等於
 * 權重和，兩者都不是自由參數（見 season.json 的 records._note）。
 *
 * `exponent` 作用在**取完下限、夾上限之前**的比值上，它是兩端釘死之後唯一還能
 * 調的東西：把中段壓下去，而 1.0 那一點不動（1 的任何次方都是 1）。先夾再取次方
 * 也會壓中段，但負的比值取小數次方是 NaN——下限得先擋掉。
 */
function abilityRatio(spec: RecordSpec, ability: Abilities, par: number): number {
  const raw = weightedShifted(spec, ability, par) / (spec.divisor ?? 1);
  const ratio = Math.pow(Math.max(spec.floor ?? 0, raw), spec.exponent ?? 1);
  return Math.min(cfg.batting.ratio_cap, Math.max(spec.floor ?? 0, ratio));
}

/**
 * 故意四壞：指數型恐懼值。
 *
 * `Dom = (pow + con + eye) / 240`，也就是三圍相對 80 的比值——與成績每一格
 * 「納入的能力都到 80 就是 1.0」同一套語意。只有過了門檻的打者才會被敬遠。
 *
 * **腳程不在裡面。** 它曾經是扣分項，理由是「敬遠快腿等於免費送他上二壘」；
 * 那個方向站得住，量級站不住——而真要面對一個三圍全滿的打者，沒有教練會因為
 * 他跑得快就敢對決。
 */
export function intentionalWalks(
  world: World,
  ability: Abilities,
  pa: number,
  par: number,
): number {
  const rng = world.stream('season');
  return intentionalWalksFrom(
    dominanceOf((key) => ability[key] ?? 0, par),
    pa,
    () => rng.next(),
  );
}

/**
 * 恐懼值：各項能力照設定的權重加總，除以除數。速度的權重是負的。
 *
 * **能力先平移到基準聯盟**（見 `season.json` 的 `_reference_par_note`）。平移後
 * Dom 只是 d 的函數，跟 `proLineAt` 裡其他每一條率的立場一致：一個 d=+6 的打者
 * 在中職和大聯盟被敬遠的頻率相同。若不平移，敬遠會只存在於大聯盟——par 44 的
 * 中職連聯盟第一名都構不到 1.0。
 *
 * 平移量是權重和本身，不是新的自由參數：全能力齊平在 par 的球員，任何聯盟都
 * 必須拿到同一個 Dom。
 */
function dominanceOf(valueOf: (key: string) => number, par: number): number {
  const ibb = cfg.batting.intentional_walk;
  const shift = par - ibb.reference_par;
  let sum = 0;
  for (const [key, w] of Object.entries(ibb.abilities)) sum += (valueOf(key) - shift) * w;
  return sum / ibb.divisor;
}

/**
 * 全能力齊平在 `overall` 的球員的恐懼值。
 *
 * 門檻線那側要的就是這種假想球員——`proLineAt` 的每一條率都假設「相關能力都
 * 在 par+d」，敬遠沒有理由自己一套。
 */
export function dominanceAt(overall: number, par: number): number {
  return dominanceOf(() => overall, par);
}

/**
 * 給定恐懼值與打席數的故意四壞數。
 *
 * 因為 Dom 只吃 d，全聯盟共用同一條觸發線（見 {@link dominanceOf}）。門檻之上
 * 夾在 `ratio_cap`，與成績的每一格同一個夾子——紀錄仍然打得破，靠的是那 5% 加上
 * 噪音的 15%。
 *
 * `noise` 是延後求值的 0–1 抽取；**只有真的會被敬遠時才會抽**。這個順序不能
 * 改——提早抽會讓每一個 Dom 不到門檻的普通打者都多消耗一次亂數，同一顆種子
 * 就會給出不同的球季（ADR 0002）。門檻線那側傳 `() => 0.5` 取期望值。
 */
export function intentionalWalksFrom(dom: number, pa: number, noise: () => number): number {
  const ibb = cfg.batting.intentional_walk;
  if (dom <= ibb.threshold) return 0;

  // 從門檻起算，不是過線就滿額：Dom 在門檻處是 1.0，直接取冪會讓第一支敬遠
  // 就是三十幾支。改成量門檻到頂峰之間走了多遠，過線從 0 長上去。
  //
  // **夾在 ratio_cap，與成績的每一格同一個夾子。** 峰值的 Dom 是用「三圍 80、
  // 腳程 20 **在大聯盟**」定義的，而同一個絕對能力在弱聯盟的 d 大得多——日職的
  // 能力 80 是 Dom 1.414、中職是 1.562，遠在峰值之外。不夾的話 `reach^1.6` 在
  // 上面長得比線性快，中職的能力 80 一季會被敬遠三百多次。
  //
  // 這裡曾經刻意不封頂，理由是「上限事件把能力推過 80 的怪物該打破紀錄」。那句話
  // 只想到能力，沒想到換個聯盟更便宜。紀錄仍然打得破：夾子留 5%，噪音再給 15%。
  const reach = Math.min(
    cfg.batting.ratio_cap,
    (dom - ibb.threshold) / (ibb.peak.dom - ibb.threshold),
  );
  const season = ibb.peak.walks * Math.pow(reach, ibb.exponent);

  const n = ibb.noise.min + noise() * (ibb.noise.max - ibb.noise.min);
  return Math.round((season * pa) / ibb.peak.per_season_pa * n);
}

/** 打出一季職業打擊成績。 */
/**
 * 兩支成績函式共用的尾巴參數。
 *
 * **收成一個物件而不是一串位置參數。** 到 `parOverride` 為止已經是第九個尾巴了，
 * 而位置參數多到某個程度，加一格就會有人把值填進隔壁的洞——`trade.ts` 的兩支
 * split 就是這樣被我修掉兩次的。
 */
/** 兩條成績線都吃得到的選項。 */
export interface LineOptions {
  /** 出賽量的縮放。傷病落在這裡——他真的只上場了那麼多，率型數據不受影響。 */
  readonly seasonFactor?: number;
  /**
   * 覆寫對手水準。
   *
   * 國際賽借用聯盟層級換算場次，但對手是各國的一線球員。紀錄錨定模型的每一格都拿
   * **個別能力**去比 par，所以平移 `overall` 動不到那些格子——par 得自己傳。
   */
  readonly par?: number;
}

/** 打擊成績線的選項。 */
export interface BattingLineOptions extends LineOptions {
  /**
   * 直接指定上了幾場。
   *
   * **國際賽用，不能改用比例去縮**：一屆兩場對上一季一百二十場是 0.017，整季場次
   * 乘完再四捨五入就是 0。
   */
  readonly appearances?: number;
  /** 生涯蹲過幾季捕手，見 `catcherSpeedFactor`。沒給就是 0。 */
  readonly catcherSeasons?: number;
}

/**
 * 打擊時速度打幾折（issue #8）。
 *
 * 蹲捕的季度直接打 `catching` 折；改守別的位置之後，每蹲過一季扣 `per_season`，
 * 最多扣 `max_loss`。**只進成績的計算**——能力表上的速度不動，守備範圍也不吃它。
 */
export function catcherSpeedFactor(position: string, catcherSeasons: number): number {
  const c = cfg.batting.catcher_speed;
  if (position === 'C') return c.catching;
  return 1 - Math.min(c.max_loss, c.per_season * Math.max(0, catcherSeasons));
}

/**
 * 投球成績線的選項。
 *
 * **出賽與定位是同一件事的兩面**，所以它們綁在 `usage` 裡：先發上二十八場、終結者
 * 上六十場，那個差別正是定位本身。分成兩個獨立的選項欄位的年代出過事——國際賽拿
 * 登錄定位決定上幾場，卻沒把定位傳進來，於是這一層現算了一次，而現算只看體力與
 * 球威：體力夠的終結者被拉去先發，那幾場還全部算成先發。綁在一起之後，那個錯誤
 * 寫不出來。
 */
export interface PitchingLineOptions extends LineOptions {
  /** 球隊勝率。勝敗場掛在它上面。 */
  readonly teamWinRate?: number | null;
  /**
   * 這一季（或這一屆）的出賽形狀。
   *
   * - 省略：場次照能力與聯盟推，定位現算。
   * - `{ role }`：場次照推，**定位照給**——定位是在定位會議上決定的（升要問過玩家、
   *   降不問），現算會讓玩家拒絕過的升遷在成績上偷偷生效。
   * - `{ role, appearances }`：場次與定位都指定（國際賽）。
   *
   * `role` 給 null 是「這個呼叫端還沒有定位會議，請現算」——那是一句要說出口的話，
   * 不是一個可以忘記填的欄位。
   */
  readonly usage?: {
    readonly role: PitcherRole | null;
    readonly appearances?: number;
  };
  /**
   * 覆寫投球局數：**期望值與天花板都要給**。
   *
   * 國際賽有投球數限制，全季先發那個七局多的節奏在那裡不成立。只覆寫上限的話每一
   * 場都會剛好卡在上限，成績反而變得一模一樣——期望值訂得比上限低，體力與噪音才有
   * 浮動的空間。
   */
  readonly innings?: {
    readonly perStart: number;
    readonly perRelief: number;
    readonly capPerStart: number;
    readonly capPerRelief: number;
  };
}

/**
 * 一條打擊成績單的核心：**從打席數開始，把每一格算出來**。
 *
 * 抽離成純函式是為了讓 `proLineAt()`（門檻線與基準線用的那條假想成績單）走的是
 * **同一條式子**，只是把噪音餵成 1、抖動餵成 0。兩邊各寫一份的年代出過的事：
 * 門檻線用的率和實際產生成績的率悄悄分岔，於是「聯盟平均」跟真實的聯盟平均對不上。
 *
 * 計算順序是相依的，**不可以重排**：BB → IBB → HBP → SAC → AB → H → HR → 3B → 2B
 * → SO → SB → CS → RBI → R。每一格的上限只引用比它早算的東西，所以
 * `HR + 3B + 2B ≤ H`、`SO ≤ AB − H`、`SB ≤ 上壘數 − HR` 全部恆成立。
 */
export function battingCore(
  ability: Abilities,
  par: number,
  pa: number,
  noise: () => number,
  jit: (n: number) => number,
  ibbOf: (pa: number) => number,
): Omit<BattingLine, 'games' | 'starts'> {
  const b = cfg.batting;
  const r = b.records;

  /**
   * 這一格的噪音。
   *
   * 傳進來的 `noise()` 已經是套用全域範圍之後的倍率，所以覆寫的做法是把它**換算
   * 回 0–1 的位置**再套自己的範圍——這樣同一顆骰子在兩種範圍下落在同一個相對
   * 位置，重播與門檻線的一致性才不會壞。
   */
  const spread = b.noise.max - b.noise.min;
  const noiseOf = (spec: { readonly noise?: { readonly min: number; readonly max: number } }) => {
    const n = noise();
    if (spec.noise === undefined) return n;
    const at = spread === 0 ? 0.5 : (n - b.noise.min) / spread;
    return spec.noise.min + at * (spec.noise.max - spec.noise.min);
  };

  const bb = anchored(r.bb.anchor, pa / (r.bb.per ?? 1), abilityRatio(r.bb, ability, par), noiseOf(r.bb), jit(r.bb.jitter), pa);
  const ibb = Math.max(0, Math.min(pa - bb, Math.round(ibbOf(pa))));

  // 觸身球與犧牲打掛在打席上，不是打數——打數要扣掉它們才算得出來，掛在打數上
  // 是循環定義。
  const hbp = anchored(pa, b.hbp_rate.value, 1, noise(), jit(b.hbp_rate.jitter), pa - bb - ibb);
  const sac = anchored(pa, b.sac_rate.value, 1, noise(), jit(b.sac_rate.jitter), pa - bb - ibb - hbp);

  const ab = Math.max(0, pa - bb - ibb - hbp - sac);

  const hits = anchored(r.h.anchor, ab / (r.h.per ?? 1), abilityRatio(r.h, ability, par), noiseOf(r.h), jit(r.h.jitter), ab);
  // 全壘打夾在安打之內，長打再從剩下的安打裡切——三者相加因此不可能超過 H。
  const hr = anchored(r.hr.anchor, ab / (r.hr.per ?? 1), abilityRatio(r.hr, ability, par), noiseOf(r.hr), jit(r.hr.jitter), hits);
  const triple = anchored(r.triple.anchor, ab / (r.triple.per ?? 1), abilityRatio(r.triple, ability, par), noiseOf(r.triple), jit(r.triple.jitter), hits - hr);
  const double = anchored(r.double.anchor, ab / (r.double.per ?? 1), abilityRatio(r.double, ability, par), noiseOf(r.double), jit(r.double.jitter), hits - hr - triple);
  const single = hits - hr - triple - double;

  // 三振的機會數是「出局的那些打數」——安打與三振加起來不可能超過打數。
  const outs = Math.max(0, ab - hits);
  const so = anchored(r.so.anchor, outs / (r.so.per ?? 1), abilityRatio(r.so, ability, par), noiseOf(r.so), jit(r.so.jitter), outs);

  // 盜壘的上限是「站上壘包而且還在跑壘」的次數：全壘打不算，他直接回本壘了。
  const onBase = hits + bb + ibb + hbp;
  const sb = anchored(r.sb.anchor, pa / (r.sb.per ?? 1), abilityRatio(r.sb, ability, par), noiseOf(r.sb), jit(r.sb.jitter), Math.max(0, onBase - hr));
  const spdAdj = (ability['spd'] ?? 0) - (par - b.reference_par);
  const csRate = b.cs.base - b.cs.per_ability * Math.min(1, spdAdj / b.cs.divisor);
  const cs = Math.max(0, Math.min(sb, Math.round(sb * csRate * noise()) + jit(b.cs.jitter)));

  // 打點與得分由**打出來的東西**推導，不是由安打數乘一個係數。
  const rw = b.rbi.weights;
  // **被敬遠會吃掉打點。** 敬遠不是隨機發生的——對手挑的正是壘上有人、你打得下來
  // 的那一個打席，那些打席的打點期望值遠高於平均。權重那一側算不出這件事：它只看
  // 你打出了什麼，而被敬遠的那一次你根本沒揮棒。折扣與敬遠佔打席的比例成正比，用
  // 比例而不是次數，短季聯盟才不會被多罰。
  const ibbPenalty =
    pa <= 0
      ? 1
      : Math.max(b.rbi.ibb_penalty.min, 1 - b.rbi.ibb_penalty.per_share * (ibb / pa));
  const rbiRaw =
    (hr * (rw['hr'] ?? 0) +
      triple * (rw['triple'] ?? 0) +
      double * (rw['double'] ?? 0) +
      single * (rw['single'] ?? 0)) *
    ibbPenalty;
  // 不低於全壘打數——每一支全壘打至少是一分打點，那是規則不是模型。
  const rbi = Math.max(
    hr,
    anchored(b.rbi.anchor, 1, Math.min(b.ratio_cap, rbiRaw / b.rbi.anchor), noise(), jit(b.rbi.jitter), Number.MAX_SAFE_INTEGER),
  );

  // 全壘打以外的每一次上壘都要靠腳程回本壘，所以先加權再整組乘上腳程係數；
  // 全壘打不乘——他自己走回來。
  const nw = b.runs.weights;
  // 腿係數也是一條比值，因此吃同一個次方。兩端釘死：腳程 80 仍然是 1.0（1 的任何
  // 次方都是 1），聯盟平均那一點接回聯盟往上搬 2 之前的值，中段跟著壓下去。負的
  // 比值取小數次方是 NaN，所以先擋掉。
  const legs = Math.min(
    b.ratio_cap,
    Math.pow(Math.max(0, spdAdj) / b.runs.speed_divisor, b.runs.speed_exponent ?? 1),
  );
  const runsRaw =
    hr * b.runs.hr_weight +
    (triple * (nw['triple'] ?? 0) +
      double * (nw['double'] ?? 0) +
      single * (nw['single'] ?? 0) +
      (bb + ibb) * (nw['bb'] ?? 0)) *
      legs;
  const runs = Math.max(
    hr,
    anchored(b.runs.anchor, 1, Math.min(b.ratio_cap, runsRaw / b.runs.anchor), noise(), jit(b.runs.jitter), Number.MAX_SAFE_INTEGER),
  );

  const bases = single + double * 2 + triple * 3 + hr * 4;
  // 上壘率的分母是 PA − SAC：犧牲打不算在內（見 BattingLine.sac 的說明）。
  const obpDen = Math.max(0, pa - sac);

  return {
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
    cs,
    hbp,
    sac,
    avg: ab === 0 ? 0 : hits / ab,
    obp: obpDen === 0 ? 0 : (hits + bb + ibb + hbp) / obpDen,
    slg: ab === 0 ? 0 : bases / ab,
  };
}

/**
 * 一季的打擊成績。
 *
 * 出賽先拆成先發與替補（見 `startShare`），打席由兩者各自的棒次組出來，其餘每一格
 * 走 `battingCore`。
 */
export function proBattingLine(
  world: World,
  ability: Abilities,
  position: string,
  level: string,
  overall: number,
  standards: LeagueStandards | null = null,
  options: BattingLineOptions = {},
): ProBattingLine {
  const { seasonFactor = 1, appearances, par: parOverride, catcherSeasons = 0 } = options;
  const rng = world.stream('season');
  const b = cfg.batting;
  // **par 要能被覆寫。** 國際賽借用聯盟層級來換算場次，但對手的水準是賽會自己的
  // ——而紀錄錨定模型的每一格都拿個別能力去比 par，不是比一個純量 d。只平移
  // `overall` 的舊做法在率型模型下等價，在這裡不等價：那會讓國際賽的門檻悄悄
  // 退回中職。
  const par = parOverride ?? leagueStandardOf(standards, level).par;

  // 抽取次數必須固定：每一格各拿一次噪音、一次抖動，順序寫死。條件式抽取會讓
  // 同一顆種子在改版前後對不起來（ADR 0002）。
  const noise = (): number => b.noise.min + rng.next() * (b.noise.max - b.noise.min);
  const jit = (n: number): number => rng.int(-n, n);

  // `appearances` 是「這次只上了這麼多場」的直接指定（國際賽用）。**不能用比例去
  // 縮**：一屆賽會兩場對上一季一百二十場是 0.017，整季場次乘完再四捨五入就是 0
  // ——職業期國際賽的投手成績一直是空的，就是這麼來的。
  const games =
    appearances ??
    Math.round(gamesPlayed(world, ability, position, level, overall, standards) * seasonFactor);
  // 國際賽每一場都是先發——被叫去打國家隊的人不會坐板凳。
  const starts =
    appearances === undefined
      ? Math.min(games, Math.round(games * startShare(overall, par) * noise()))
      : games;
  const bench = games - starts;
  const pa = plateAppearances(world, starts, bench, overall, par);

  // 速度打折只進成績這一格——出賽與打席看的是評價，不是腿。敬遠的恐懼值本來就
  // 不看速度，照舊吃原本那份。
  const speed = catcherSpeedFactor(position, catcherSeasons);
  const hitting = speed === 1 ? ability : { ...ability, spd: (ability['spd'] ?? 0) * speed };
  const core = battingCore(hitting, par, pa, noise, jit, (n) =>
    intentionalWalks(world, ability, n, par),
  );
  return { games, starts, ...core };
}

/** 場上的三種投手角色。中繼與終結者在出賽結構上相同，差別在拿到的是中繼還是救援。 */
export type PitcherRole = 'SP' | 'CP' | 'SU' | 'MR' | 'LR';

/**
 * 定位的高低。**先發最高，長中繼最低。**
 *
 * 這條順序只回答一件事：這次異動是升是降。升要問過玩家，降不問——與守位會議
 * 同一套規則（ADR 0037）。一個人從牛棚被推上輪值是機會，從輪值掉進牛棚是事實。
 */
const ROLE_RANK: Readonly<Record<PitcherRole, number>> = {
  LR: 0,
  MR: 1,
  SU: 2,
  CP: 3,
  SP: 4,
};

/** 這個定位在階梯上的高度。 */
export function roleRank(role: PitcherRole): number {
  return ROLE_RANK[role];
}

/** 牛棚的三階，由高到低。LR 不在裡面——它是 fallback。 */
const BULLPEN_LADDER: readonly (readonly [PitcherRole, 'closer_line' | 'setup_line' | 'middle_line'])[] = [
  ['CP', 'closer_line'],
  ['SU', 'setup_line'],
  ['MR', 'middle_line'],
];

/**
 * 這一季的投手角色。見 ADR 0005。
 *
 * **體力是先發的先決條件**：撐不住的人只有牛棚那條路。體力是絕對的生理條件——
 * 撐不了一百五十局就是撐不了，跟同年度有沒有別人更強無關。撐得住的人**兩條路都
 * 判**，取構得到的最高那一階（ADR 0052）：體力好不代表只能在輪值與長中繼之間二選
 * 一，先發評價差一點、球威夠關門的人該去關門。
 *
 * 兩條路各自比對評價與 par 的比值。牛棚三階由高到低比，**沒有一階收得下的人就是
 * 長中繼**——LR 寫成 fallback 而不是再給一條 `< 0.95` 的線，是因為兩條線之間會
 * 開洞：0.95 與 0.97 之間的人以前無家可歸。
 */
export function pitcherRole(
  ability: Abilities,
  level: string,
  standards: LeagueStandards | null = null,
): PitcherRole {
  return pitcherRoleAt(ability, leagueStandardOf(standards, level).par, cfg.pitching.role.starter_sta_min);
}

/**
 * 同一套判定，但直接餵 par 與體力門檻。
 *
 * 養成期用得到：那邊沒有聯盟層級可查，par 掛在賽事上（`amateur.cups[stage].par`），
 * 而體力門檻就是那個 par——學生球隊的先發輪值本來就是「撐得住這個級別的比賽」。
 * 職業那邊的體力門檻則是一個固定值（`starter_sta_min`），不隨聯盟浮動：撐不了
 * 一百五十局就是撐不了，跟他在幾軍無關。
 */
export function pitcherRoleAt(ability: Abilities, par: number, staminaBar: number): PitcherRole {
  const r = cfg.pitching.role;

  // 兩條路都比**原始能力**，不比帶著角色折扣的評價。折扣是身價、是升降與留隊那
  // 一側的判斷，拿它跟聯盟 par 比大小等於拿兩把不同的尺量同一件事。
  if ((ability['sta'] ?? 0) >= staminaBar && pitcherStuff(ability, 'SP') >= par * r.starter_line) return 'SP';
  return bullpenRoleAt(ability, par) ?? 'LR';
}

/** 牛棚分構得到的最高一階（CP／SU／MR）。一階都構不到是 null——那是長中繼。 */
export function bullpenRole(
  ability: Abilities,
  level: string,
  standards: LeagueStandards | null = null,
): PitcherRole | null {
  return bullpenRoleAt(ability, leagueStandardOf(standards, level).par);
}

function bullpenRoleAt(ability: Abilities, par: number): PitcherRole | null {
  const r = cfg.pitching.role;
  // **牛棚內部用牛棚分**，不是投手評價：問的是「他適不適合關門」而不是「他有多好」
  // ——一局的工作，球威才是那個排序的依據。
  const relief = bullpenScore(ability);
  for (const [role, line] of BULLPEN_LADDER) {
    if (relief >= par * r[line]) return role;
  }
  return null;
}

/** 這個角色算先發還是後援。獎項資格與國際賽的出賽結構都只分這兩種。 */
export function isStarterRole(role: PitcherRole): boolean {
  return role === 'SP' || role === 'LR';
}

/**
 * 能力平移到基準聯盟之後，除以 `ability_divisor` 的佔比，夾在 `ratio_cap`。
 *
 * 與打者那側同一個立場：低階聯盟的門檻自動下修，同樣的絕對能力在中職投得比在
 * 大聯盟好。
 */
function pitcherRatio(value: number, par: number, floor = 0): number {
  const p = cfg.pitching;
  const adj = value - (par - p.reference_par);
  return Math.min(p.ratio_cap, Math.max(floor, adj / p.ability_divisor));
}

/**
 * 加權平均的能力：`Σ 權重 × 能力 ÷ Σ 權重`。
 *
 * 除以淨和，所以**所有能力一樣時就是那個值本身**——球系寫進局數與保送（issue #10）
 * 之後，四系一樣強的投手結果不變，聯盟基準與 ERA+ 分母都不必重校。
 */
function weightedAbility(ability: Abilities, weights: Readonly<Record<string, number>>): number {
  let sum = 0;
  let net = 0;
  for (const [key, w] of Object.entries(weights)) {
    sum += (ability[key] ?? 0) * w;
    net += w;
  }
  return net === 0 ? 0 : sum / net;
}

/** 被打出來的一組事件。自責分由它推導，勝敗再由自責分推導。 */
interface AllowedEvents {
  readonly hits: number;
  readonly hr: number;
  readonly triple: number;
  readonly double: number;
  readonly bb: number;
  readonly hbp: number;
  readonly so: number;
}

/**
 * 一段局數裡被打出來的事件。
 *
 * **抽取由呼叫端注入**：`proPitchingLine` 傳真正的亂數，`eraAt` 傳「沒有波動」
 * 的常數函式。兩者因此走同一組公式——聯盟平均防禦率必須就是這組公式在 d=0
 * 時真正產生的數字，各寫一份遲早會分岔。
 */
function allowedEvents(
  ability: Abilities,
  par: number,
  ip: number,
  skill: number,
  noise: () => number,
  jit: (n: number) => number,
): AllowedEvents {
  const p = cfg.pitching;
  const rec = p.records;
  const volume = (per: number): number => ip / per;

  const hits = clampInt(
    Math.round(rec.hits.anchor * volume(rec.hits.per) * Math.max(rec.hits.floor, rec.hits.base - rec.hits.slope * skill) * noise()) +
      jit(rec.hits.jitter),
    Math.round(ip * rec.hits.cap_per_inning),
  );

  // 被全壘打看的是**投不好的地方**：控球、縱向與球速離基準差多少。
  let deficit = 0;
  for (const [key, w] of Object.entries(rec.hr.deficit_weights)) {
    deficit += (rec.hr.reference - (ability[key] ?? 0)) * w;
  }
  for (const [key, w] of Object.entries(rec.hr.plus_weights)) deficit += (ability[key] ?? 0) * w;
  deficit -= rec.hr.par_slope * (par - p.reference_par);
  const gopher = clamp(deficit / rec.hr.divisor, 0, 1);
  const hr = clampInt(
    Math.round((rec.hr.floor_anchor + rec.hr.range_anchor * gopher) * volume(rec.hr.per) * noise()) +
      jit(rec.hr.jitter),
    // 全壘打是安打的一種。
    hits,
  );

  // 長打**從安打總數裡切**，不另外生成——安打總數是已經校準過的，讓新欄位去
  // 動它等於把那份校準推翻。球威輕微壓低長打比例：投得好的人被打到的多半是
  // 軟弱的一壘安，但那個效果很小，長打率本來就很難由投手控制。
  const xb = rec.extra_base;
  const nonHr = Math.max(0, hits - hr);
  const compress = Math.max(0, 1 - (skill - 1) * xb.stuff_slope);
  const triple = clampInt(
    Math.round(nonHr * xb.triple_share * compress * noise()) + jit(xb.jitter_triple),
    nonHr,
  );
  const double = clampInt(
    Math.round(nonHr * xb.double_share * compress * noise()) + jit(xb.jitter_double),
    nonHr - triple,
  );

  // 「控球」是加權平均：橫向與特殊是負權重，那兩系的球本來就常丟在好球帶外面。
  const ctlAdj = weightedAbility(ability, rec.bb.weights) - (par - p.reference_par);
  // **次方小於 1，曲線是凹的。** 控球的缺口才剛出現就已經看得到保送，往後每差一
  // 分只再多一點——現實裡的保送率就是這個形狀，中間水準的投手離「幾乎不保送」比
  // 線性式子想像的遠得多。兩端釘死：缺口 0 仍然是地板，缺口滿檔仍然是上限。
  // span 在聯盟平均搬到 62 時跟著縮：缺口 0 那一端本來就釘住，把 span 乘 19/21
  // 就讓聯盟平均那一端接回原本的缺口 .35。觸身球走同一條路。
  const ctlGap = clamp((rec.bb.reference - ctlAdj) / rec.bb.span, 0, 1);
  const wildness = Math.pow(ctlGap, rec.bb.exponent ?? 1);
  // 四壞吃自己的噪音區間（issue #33）：錨點抬高之後把波動放大，運氣好的年份仍然
  // 摸得到低保送。傳進來的 noise() 已經套過全域區間，換算回 0–1 的位置再套這一格
  // 的——同一顆骰子落在同一個相對位置，eraAt 傳的常數 1 因此仍是區間正中央。
  const spread = p.noise.max - p.noise.min;
  const bbNoise = (() => {
    const n = noise();
    const own = rec.bb.noise;
    if (own === undefined) return n;
    const at = spread === 0 ? 0.5 : (n - p.noise.min) / spread;
    return own.min + at * (own.max - own.min);
  })();
  const bb = clampInt(
    Math.round((rec.bb.floor_anchor + rec.bb.range_anchor * wildness) * volume(rec.bb.per) * bbNoise) +
      jit(rec.bb.jitter),
    Math.round(ip * rec.bb.cap_per_inning),
  );

  // 觸身球與四壞同源——都是控球掉出去的球，只是量小得多，因此走同一條式子：
  // 控球的缺口取次方。兩者的次方不同（四壞 0.71、觸身 1.18）是因為它們各自
  // 要接回自己原本在 par 的量，見 season.json 的 _exponent_note。
  const hbpAdj = (ability[rec.hbp.ability] ?? 0) - (par - p.reference_par);
  const hbpGap = clamp((rec.hbp.reference - hbpAdj) / rec.hbp.span, 0, 1);
  const wild2 = Math.pow(hbpGap, rec.hbp.exponent ?? 1);
  const hbp = clampInt(
    Math.round((rec.hbp.floor_anchor + rec.hbp.range_anchor * wild2) * volume(rec.hbp.per) * noise()) +
      jit(rec.hbp.jitter),
    Math.round(ip * rec.hbp.cap_per_inning),
  );

  let arsenal = 0;
  for (const [key, w] of Object.entries(rec.so.weights)) arsenal += (ability[key] ?? 0) * w;
  arsenal -= rec.so.par_slope * (par - p.reference_par);
  // **三次方**：會投的人才三振得到人，普通球種再多也只是被打。
  const stuff = Math.pow(clamp(arsenal / rec.so.divisor, 0, 1), rec.so.exponent);
  const so = clampInt(
    Math.round((rec.so.floor_anchor + rec.so.range_anchor * stuff) * volume(rec.so.per) * noise()) +
      jit(rec.so.jitter),
    Math.round(ip * rec.so.cap_per_inning),
  );

  return { hits, hr, triple, double, bb, hbp, so };
}

/**
 * 自責分：**由被打出來的事件推導**，不是自己一條式子。
 *
 * 用的是打者側同一條 Bill James 得分創造——`(上壘 × 壘打數) ÷ (被打數 + 保送
 * + 觸身)`，其中被打數就是出局數加被安打。投手被打得很少，自責分就會跟著少；
 * 舊的錨點式做不到這件事，被安打與自責分各算各的，彼此不相干。
 *
 * `scale` 把「這些事件會生出多少分」折成「投手該負責的那一份」：殘壘、雙殺、
 * 換投之後由接手負責的跑者，都讓實際自責分低於估計值。
 */
function earnedRunsFrom(e: AllowedEvents, outs: number): number {
  const single = e.hits - e.double - e.triple - e.hr;
  const totalBases = single + e.double * 2 + e.triple * 3 + e.hr * 4;
  const onBase = e.hits + e.bb + e.hbp;
  const atBats = outs + e.hits;
  const denominator = atBats + e.bb + e.hbp;
  if (denominator === 0) return 0;
  return ((onBase * totalBases) / denominator) * cfg.pitching.records.er.scale;
}

/**
 * 所有能力都等於同一個值的投手。`eraAt` 的受試者。
 *
 * 「能力比聯盟平均高 d 點」這句話在事件模型裡沒有唯一解——被安打看球威、四壞
 * 看控球、被全壘打看縱向與球速，各項可以長得完全不同。取**每一項都相同**的那
 * 一個，是這句話唯一不偏袒任何一種投手的讀法。
 */
function uniformAbility(value: number): Abilities {
  const out: Record<string, number> = {};
  for (const key of ALL_ABILITIES) out[key] = value;
  return out;
}

/**
 * 能力比聯盟平均高 `d` 點的投手，防禦率是多少。
 *
 * 基準線（ERA+ 的分母）與門檻線要的都是這個數字。**與 `proPitchingLine` 走同一
 * 組公式**：同一個受試者、同一組事件、同一條自責分式子，只是把波動與抖動關掉。
 * 自責分改由事件推導之後，這個分母也必須跟著改——否則 ERA+ 100 會不再是聯盟
 * 平均，而勝敗正是踩在 ERA+ 上面的。
 */
export function eraAt(d: number, par = cfg.pitching.reference_par): number {
  const ip = cfg.pitching.records.hits.per;
  const outs = Math.round(ip * 3);
  const ability = uniformAbility(par + d);
  const skill = pitcherRatio(pitcherStuff(ability, 'SP'), par);
  const events = allowedEvents(ability, par, ip, skill, () => 1, () => 0);
  return (earnedRunsFrom(events, outs) * 9) / ip;
}

/**
 * FIP 的常數：讓聯盟平均投手的 FIP 等於他的防禦率。
 *
 * 受試者與 `eraAt(0)` 同一個——能力等於聯盟平均、關掉波動與抖動——因此 FIP 與
 * ERA+ 對「聯盟平均」的定義是同一件事。各層級共用：聯盟平均是自我參照的。
 */
export const FIP_CONSTANT: number = (() => {
  const par = cfg.pitching.reference_par;
  const ip = cfg.pitching.records.hits.per;
  const ability = uniformAbility(par);
  const skill = pitcherRatio(pitcherStuff(ability, 'SP'), par);
  const e = allowedEvents(ability, par, ip, skill, () => 1, () => 0);
  return eraAt(0) - fipCore(e.hr, e.bb, e.hbp, e.so, ip);
})();

/** FIP 去掉常數的那一段：只看投手自己決定的事——全壘打、四壞觸身、三振。 */
function fipCore(hr: number, bb: number, hbp: number, so: number, ip: number): number {
  return (13 * hr + 3 * (bb + hbp) - 2 * so) / ip;
}

/**
 * FIP（Fielding Independent Pitching）：拿掉守備與運氣之後的防禦率。
 *
 * 沒有投球局數回傳 null。
 */
export function fip(line: PitchingLine): number | null {
  if (line.outs === 0) return null;
  return fipCore(line.hr, line.bb, line.hbp, line.so, line.outs / 3) + FIP_CONSTANT;
}

/**
 * 一季的投球成績。
 *
 * 順序是相依的，**不可以重排**：角色 → 出賽與先發 → 局數 → 勝敗 → 救援 → 中繼
 * → 被安打 → 自責分 → 失分 → 四壞 → 三振 → 被全壘打。每一格的上限只引用比它早
 * 算的東西（ADR 0002 要的抽取次數也因此固定）。
 */
export function proPitchingLine(
  world: World,
  ability: Abilities,
  level: string,
  overall: number,
  standards: LeagueStandards | null = null,
  options: PitchingLineOptions = {},
): ProPitchingLine {
  const {
    teamWinRate = null,
    seasonFactor = 1,
    par: parOverride,
    innings: inningsOverride,
    usage,
  } = options;
  // 出賽與定位綁在一起（見 PitchingLineOptions.usage）：指定了上幾場就一定說得
  // 出是以什麼定位上的。
  const appearances = usage?.appearances;
  const roleOverride = usage?.role ?? null;
  const rng = world.stream('season');
  const p = cfg.pitching;
  const info = levelOf(level);
  // 見 `proBattingLine` 的說明：國際賽的對手水準是賽會自己的。
  const par = parOverride ?? leagueStandardOf(standards, level).par;
  const d = overall - par;

  const noise = (): number => p.noise.min + rng.next() * (p.noise.max - p.noise.min);
  const jit = (n: number): number => rng.int(-n, n);

  const role = roleOverride ?? pitcherRole(ability, level, standards);
  // **成績看的是實力，不是身價。** 評價低不代表成績差——角色折扣是責任額的折價，
  // 折過的數字拿去算防禦率，會讓終結者的自責分比 par 先發還多。
  //
  // **長中繼兩套式子都算過取高的。** 他既可能是撐局數的先發備胎，也可能是多投
  // 一局的牛棚手，沒有理由只准他用其中一把尺（ADR 0005）。
  const rating = pitcherStuff(ability, role === 'LR' ? null : isStarterRole(role) ? 'SP' : 'RP');
  // 投得好不好那條係數，勝敗、被安打、自責分與救援都吃它。
  const skill = pitcherRatio(rating, par);
  const stamina = p.innings[role];

  // ── 出賽與先發
  const app = p.appearances;
  const slots = info.games / app.rotation_divisor.value;
  const share = clamp(
    app.gs_factor.base + d * app.gs_factor.per_point,
    app.gs_factor.min,
    app.gs_factor.max,
  );
  let starts = 0;
  let games = 0;
  if (role === 'SP') {
    // **夾在輪值容量再加抖動之內**：一隊五個輪值位置給出 32.4 個先發，但補休與
    // 跳過第五號讓王牌多投幾場。夾死在容量本身的話，單季局數的紀錄（2000 年後
    // 266 局）就永遠摸不到——那該是很難，不是不可能。
    starts = clampInt(
      Math.round(slots * share) + jit(app.jitter_starts),
      Math.ceil(slots) + app.jitter_starts,
    );
    games = starts;
  } else {
    // 長中繼偶爾遞補先發；純牛棚的三階一場都不先發。
    //
    // **低於聯盟 lr_no_start 點就不再遞補先發**（issue #36）：從 par 起線性收到那裡
    // 歸零。輪值缺人時教練找的是牛棚裡最能投的，不是最後一個。
    const lrFade = clamp(1 - d / app.lr_no_start, 0, 1);
    starts =
      role === 'LR' && lrFade > 0
        ? clampInt(
            Math.round(slots * share * app.lr_start_share * lrFade) + jit(app.jitter_starts),
            Math.ceil(slots * app.lr_start_share * lrFade),
          )
        : 0;
    const g = app.relief_games[role];
    // **依球季長度縮放**：錨點是照 162 場訂的，照抄會讓 120 場的中職出現一年
    // 出賽七十場的終結者。
    const seasonScale = info.games / app.reference_games;
    const relief = Math.max(
      0,
      Math.round(clamp(g.base + d * g.per_point, g.min, g.max) * seasonScale) +
        jit(app.jitter_games),
    );
    games = starts + relief;
  }

  if (appearances === undefined) {
    // 傷病落在出賽量上：他真的只上場了那麼多，因此率型數據不受影響。
    games = Math.max(0, Math.round(games * seasonFactor));
    starts = Math.min(games, Math.max(0, Math.round(starts * seasonFactor)));
  } else {
    // 直接指定上了幾場（國際賽用）。**不能用比例去縮**：一屆兩場對上一季一百二十
    // 場是 0.017，整季場次乘完再四捨五入就是 0——職業期國際賽的投手成績一直是空的，
    // 就是這麼來的。
    games = Math.max(0, appearances);
    starts = isStarterRole(role) ? games : 0;
  }

  // 投手側的信任度判定。放在抽完之後，理由見 `gamesPlayed`。
  //
  // 這裡的 `overall` 已經是投球側的（見 SeasonContext.pitchingOverall），所以強打
  // 弱投的二刀流會被這道判定清出投手名單，而他的打擊側不受影響。
  if (offRoster(overall, par)) {
    games = 0;
    starts = 0;
  }

  // ── 局數
  const relief = games - starts;
  // **體力係數也吃一個次方。** 局數的錨點（先發 260 局）定在「體力 80」上，而那條
  // 線一搬，par 水準的投手就會少投 6% ——那不是這次要改的東西。次方把 par 那一點
  // 接回原值，兩端仍然釘死：體力 80 是 1.0，底下是 stamina.floor。
  //
  // 「體力」是加權平均：變速與縱向讓他吃得下更多局，橫向與特殊反過來。
  const staminaRatio = Math.pow(
    pitcherRatio(weightedAbility(ability, p.innings.weights), par, stamina.floor),
    p.innings.exponent ?? 1,
  );
  const ipRaw =
    (inningsOverride === undefined
      ? stamina.start_anchor * (starts / stamina.per_start) +
        stamina.relief_anchor * (relief / stamina.per_relief)
      : starts * inningsOverride.perStart + relief * inningsOverride.perRelief) *
    staminaRatio *
    noise();
  // **局數不先取整**——換成出局數時才取整，`.1`／`.2` 才出得來。
  const ipCap =
    starts * (inningsOverride?.capPerStart ?? stamina.cap_per_start) +
    relief * (inningsOverride?.capPerRelief ?? stamina.cap_per_relief);
  const outs = Math.max(
    0,
    Math.min(Math.round(ipCap * 3), Math.round(ipRaw * 3) + jit(p.innings.jitter)),
  );
  const ip = outs / 3;

  // ── 被打出來的事件（自責分要用它，因此排在勝敗之前）
  //
  // **順序在這一版換過**：舊版是局數 → 勝敗 → 被安打 → 自責分，因為勝敗只看
  // 能力，不需要成績。現在勝敗踩在 ERA+ 上，自責分就必須先算出來。抽取順序
  // 因此改變，舊的重播日誌重組不出同一段生涯——引擎版本號已經跳過。
  const events = allowedEvents(ability, par, ip, skill, noise, jit);
  const { hits, hr, triple, double, bb, hbp, so } = events;

  const rec = p.records;
  const er = clampInt(
    Math.round(earnedRunsFrom(events, outs) * noise()) + jit(rec.er.jitter),
    Math.round(ip * rec.er.cap_per_inning),
  );
  // 非自責的失分與能力無關——那是野手掉的球。
  const runs =
    er + Math.max(0, Math.round(rec.unearned.anchor * (ip / rec.unearned.per) * noise()) + jit(rec.unearned.jitter));
  const era = ip === 0 ? 0 : (er * 9) / ip;

  // ── 勝敗、救援、中繼
  //
  // **全部由成績推導，沒有一格直接看能力。** 一名投手的勝敗是「他讓對手得幾分」
  // 與「他的球隊得幾分」相撞的結果；能力只透過成績間接進來，因此投得好卻在爛隊
  // 的人，該吞的敗還是要吞。
  const dec = p.decision;
  const teamWp = clamp(
    teamWinRate ?? dec.team_win_reference,
    dec.team_win_clamp.min,
    dec.team_win_clamp.max,
  );
  const teamOdds = teamWp / (1 - teamWp);
  // ERA+ 的比值，1.0 是聯盟平均。防禦率 0.00 在短局數的後援身上真的會發生，
  // 因此兩端都夾住——賠率在 0 與無限大處會炸開。
  const ratio = clamp(
    era === 0 ? dec.era_ratio_clamp.max : eraAt(0, par) / era,
    dec.era_ratio_clamp.min,
    dec.era_ratio_clamp.max,
  );

  const st = dec.starter;
  // 第一段：從先發場次裡切出勝場。
  const oddsW = teamOdds * st.win_constant * Math.pow(ratio, st.win_exponent);
  const pW = oddsW / (1 + oddsW);
  let wins = clampInt(Math.round(starts * pW * noise()) + jit(st.jitter), starts);
  // 第二段：從**沒贏的先發場次**裡切出敗投，兩個因子都鏡射。剩下的是無關勝敗
  // ——它不必另外指定，決定率因此是導出的而不是設定的。
  const remaining = Math.max(0, starts - wins);
  const oddsL = (1 / teamOdds) * st.loss_constant * Math.pow(1 / ratio, st.loss_exponent);
  const pL = oddsL / (1 + oddsL);
  let losses = clampInt(Math.round(remaining * pL * noise()) + jit(st.jitter), remaining);

  // ── 後援：機會 × 成功率
  //
  // **機會是球隊給的，成功率是自己的。** 一支爛隊的鐵門終結者機會很少，一支
  // 強隊的爛終結者機會很多但守不住——兩件事分開之後，救援數才有得對帳。
  const rel = dec.relief;
  // **球季有多長由這一次模擬的長度決定，不是層級的場數。** 國際賽直接指定上了
  // 幾場（一屆四到八場），拿聯盟的 162 去算球隊勝場，會讓一個打四場的後援投手
  // 拿到五十次救援機會——上限雖然夾得住，夾出來的仍然是「每次上場都關門成功」。
  const seasonGames = appearances === undefined ? info.games : appearances;
  const teamWins = seasonGames * teamWp;
  const shareOf = (spec: { base: number; per_team_win_pct: number; min: number; max: number }): number =>
    clamp(spec.base - spec.per_team_win_pct * (teamWp - dec.team_win_reference), spec.min, spec.max);
  // 成功率的指數很小，99% 的情形自己就落在 0.70 到 0.95 之間——那正是真實的
  // 窄帶，因此不設硬上下限。
  const conversion = rel.conversion.anchor * Math.pow(ratio, rel.conversion.exponent);

  // **機會不按出賽比例縮，但它不能超過他實際上場的場次。** 終結者一年只上場
  // 六十場卻拿得到五十次救援機會——他上場的那六十場就是球隊需要關門的那幾場，
  // 不是全季的一個抽樣。但只上十七場的人不可能有四十次機會：那個差額會從
  // `blown` 那條路變成十幾場敗投（一個 17 場 3 勝 12 敗 4 救援 13 中繼的球季
  // 就是這樣長出來的）。機會因此先被後援出賽夾住，剩下的才留給下一項。
  const saveOpps = Math.min(
    relief,
    teamWins * shareOf(rel.save_opportunity) * (dec.save_coefficient[role] ?? 0),
  );
  const saves = clampInt(
    Math.round(saveOpps * conversion * noise()) + jit(rel.conversion.jitter),
    Math.min(Math.round(saveOpps), relief),
  );
  const holdOpps = Math.min(
    Math.max(0, relief - saves),
    teamWins * shareOf(rel.hold_opportunity) * (dec.hold_coefficient[role] ?? 0),
  );
  const holds = clampInt(
    Math.round(holdOpps * conversion * noise()) + jit(rel.conversion.jitter),
    Math.min(Math.round(holdOpps), relief - saves),
  );

  // 搞砸的機會有一部分變成敗投——不是全部，接手的人可能再掉分，球隊也可能打
  // 回來。撿勝與投得好不好幾乎無關，只與上場次數和球隊會不會逆轉有關。
  const blown = Math.max(0, saveOpps - saves) + Math.max(0, holdOpps - holds);
  const blownLosses = Math.max(0, Math.round(blown * rel.blown_to_loss.value * noise()));
  const vultureWins = Math.max(
    0,
    Math.round(relief * rel.vulture_win.per_game * (teamWp / dec.team_win_reference) * noise()) +
      jit(rel.vulture_win.jitter),
  );

  // **一次出賽最多換到一個決定。** 勝、敗、救援、中繼是互斥的：同一場比賽裡
  // 拿到中繼就不會同時是勝投。因此兩個出賽池各自分配，總和自然不會超過出賽數
  // ——先發那一段早就夾在先發場次內，後援這一段依序切救援、中繼、撿勝、backfill
  // 的敗投，切完就沒了。
  const reliefLeft = Math.max(0, relief - saves - holds);
  const reliefWins = Math.min(reliefLeft, vultureWins);
  const reliefLosses = Math.min(reliefLeft - reliefWins, blownLosses);

  wins += reliefWins;
  losses += reliefLosses;

  return {
    role,
    games,
    starts,
    outs,
    hits,
    double,
    triple,
    runs,
    er,
    bb,
    hbp,
    so,
    hr,
    // 防禦率是**導出**的，不再自己生成一個再反推自責分——兩個數字各生各的，遲早
    // 會對不起來。
    era,
    wins,
    losses,
    saves,
    holds,
  };
}

/** 夾在 0 與上限之間的整數。抖動加完才夾——夾在抖動之前等於沒夾。 */
function clampInt(value: number, cap: number): number {
  return Math.max(0, Math.min(Math.max(0, cap), value));
}

/**
 * 打完一季。
 *
 * 順序固定：投球先於打擊。二刀流兩邊都算——那正是二刀流在數據上的樣子。
 * 順序若隨角色變動，同一個種子會產生不同結果。
 */
export function playSeason(world: World, ctx: SeasonContext): SeasonLine {
  // 鎖定之後照鎖定的那一側打。**比的是四捨五入後的評價**，與呼叫端從前算的一
  // 字不差——`rating.better` 比的是未取整的值，兩者在剛好平手的邊界上會不同。
  const better = ctx.lockedSide ?? (ctx.rating.pitcher >= ctx.rating.fielder ? 'pitcher' : 'fielder');
  const asPitcher = ctx.twoWay || better === 'pitcher';
  const asBatter = ctx.twoWay || better === 'fielder';

  // 兩側各認自己那一側的綜合能力，規則見 sideOveralls()——國際賽用的是同一份。
  const sides = sideOveralls(ctx.rating);

  const pitching = played(
    asPitcher
      ? proPitchingLine(world, ctx.ability, ctx.level, sides.pitching, ctx.standards, {
          teamWinRate: ctx.teamWinRate,
          seasonFactor: ctx.seasonFactor,
          // 場次照能力推，定位照登錄的給；沒登錄過（null）才由那一層現算——那是
          // 「這個呼叫端還沒有定位會議」。
          usage: { role: ctx.pitcherRole },
        })
      : null,
  );
  const batting = played(
    asBatter
      ? proBattingLine(world, ctx.ability, ctx.position, ctx.level, sides.batting, ctx.standards, {
          seasonFactor: ctx.seasonFactor,
          catcherSeasons: ctx.catcherSeasons ?? 0,
        })
      : null,
  );

  return { level: ctx.level, pitching, batting, defenseRuns: fieldingRuns(world, ctx, batting) };
}

/**
 * 這一季的守備分。
 *
 * **只在頂級聯盟算。** 二軍現在也有登錄守位（ADR 0037），但守備分是拿來與同層
 * 對手比的，二軍的守備不該進生涯的守備勝利份額。沒上過場（`batting` 是 null）
 * 或沒有計分守位的人一律是 0。
 */
function fieldingRuns(
  world: World,
  ctx: SeasonContext,
  batting: ProBattingLine | null,
): number {
  const position = ctx.scoringPosition;
  if (position === null || batting === null) return 0;
  if (levelOf(ctx.level).top === undefined) return 0;
  return defenseRuns({
    ability: ctx.ability,
    position,
    level: ctx.level,
    standards: ctx.standards,
    gamesShare: batting.games / levelOf(ctx.level).games,
    // 抖動走 season 那條流——它與成績同一個球季結算，共用一條序列。
    jitter: (n) => world.stream('season').int(-n, n),
  });
}

/**
 * 一場都沒上的那一側不留成績列，直接當作沒有。
 *
 * 一整排 0 不是成績，是「他今年沒在這一側出現過」——留著它，
 * 顯示端就得每個印表處各自記得跳過，獎項端也得各自記得排除；
 * 零出賽卻掛在打擊排行榜上的洞就是這樣開的。少一個狀態勝過多一層防呆。
 */
function played<T extends { readonly games: number }>(line: T | null): T | null {
  return line === null || line.games === 0 ? null : line;
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
