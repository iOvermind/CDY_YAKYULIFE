/**
 * 職業生涯的推進：升降級、年齡曲線與引退。
 *
 * 判定一律看**能力相對該層級的 par／min**，不看單季成績。成績本身就是能力
 * 加噪音，用成績判定等於把同一份噪音算兩次——會讓運氣好的一季直接送人上
 * 一軍，運氣差的一季直接把人踢出去。
 *
 * 所有數字都在 `season.json`。抽取走 career 子序列（生涯層級的決定），
 * 老化走 growth 子序列（能力變動）。
 */

import { abilities, leagues, season as cfg } from '../data/index.ts';
import { hardCap } from './growth.ts';
import { personalStandardOf, type LeagueStandards } from './league.ts';
import type { HandednessTier } from './handedness.ts';
import type { Abilities } from './rating.ts';
import type { World } from './rng.ts';

export type Movement = 'promote' | 'demote' | 'stay' | 'release';

export interface MovementResult {
  readonly movement: Movement;
  /** 移動後的層級；戰力外時為 null。 */
  readonly level: string | null;
  /** 給玩家看的一句話理由。 */
  readonly reason: string;
  /**
   * 這次下放判定用的機率（百分比，`rng.chance` 的口徑），只有 `demote` 會帶。
   *
   * 有資格拒絕下放的老將（見 ADR 0020）把它當作硬留在一軍的代價：球團越想把
   * 你送下去，拒絕之後被直接釋出的機率就越高。**不長第二個旋鈕**——同一個
   * 數字換一個位置用，缺口多大、壓力多大，是同一件事。
   */
  readonly pressure?: number;
}

/** 這個體系的升遷路徑，由低到高。 */
export function pathOf(org: string): readonly string[] {
  const path = leagues.paths[org];
  if (path === undefined) throw new Error(`未知的體系：${org}`);
  return path;
}

/** 層級在路徑上的位置。 */
function indexOf(level: string): { org: string; path: readonly string[]; index: number } {
  const info = leagues.levels[level];
  if (info === undefined) throw new Error(`未知的聯盟層級：${level}`);
  const path = pathOf(info.org);
  return { org: info.org, path, index: path.indexOf(level) };
}

/** 依 d 值算出一個機率並套上下限。 */
function chanceOf(
  spec: { base: number; per_point: number; min: number; max: number; tier_span?: number },
  d: number,
): number {
  // `tier_span` 存在時走級距：落差落在同一階的人拿到同一個壓力，而不是逐分敲。
  // 差一分與差三分在球團眼裡是同一種人——都是跟不上、但還沒到非換不可（見
  // season.json 的 movement.demote._tier_note）。
  const steps =
    spec.tier_span !== undefined && spec.tier_span > 0
      ? Math.floor(Math.max(0, d - 1) / spec.tier_span) + 1
      : d;
  return Math.max(spec.min, Math.min(spec.max, spec.base + steps * spec.per_point));
}

/**
 * 拒絕下放之後被釋出的機率，0-100。
 *
 * **沿用下放壓力，但先把倖存的那一半放大。** 直接拿同一個數字再擲一次是對同一
 * 件事收兩次費：球團想不想送你下去，前一擲已經問過了，而提問會出現就代表那一
 * 擲中了——玩家面對的壓力因此天生偏高（落差 3 分以上是 87-90%），拒絕下放於是
 * 不是賭注而是死刑判決書。
 *
 * 倍數取 2 而不是 3：乘 3 會讓落差 1 分的倖存率撞到 100%，那一段變成絕對安全，
 * 拒絕下放就不再是一個取捨。乘 2 之後落差 1 分是 18% 釋出、落差 4 分以上仍有
 * 80%——沒有任何一段是免費的，但賭得贏。
 */
export function refusalReleaseChance(pressure: number): number {
  const k = cfg.movement.demote.refuse_survival_multiplier.value;
  return Math.max(0, 100 - Math.min(100, (100 - pressure) * k));
}

/**
 * 球季結束後的去留。
 *
 * 判定順序是升級 → 降級 → 戰力外。先問升級是刻意的：一個能力已經超過上一層
 * 級門檻的人，不該因為還在最低層級而被同一輪判定拉去問「要不要放掉他」。
 *
 * **只有升級吃浮動門檻，降級與戰力外都不吃**（ADR 0011、ADR 0029）。今年人才
 * 斷層就該比較好擠上去——那是機會，浮動放在這裡是對的。但拿浮動去踢人不是同一
 * 回事：能力漲了一分、聯盟水準漲了兩分，於是進步的球員被下放，而他做對的每一
 * 件事都沒有回報。降級與戰力外一律對 `leagues.json` 的基準值，那條線只跟你自己
 * 有關。
 *
 * `yearsAtBottom` 是在最低層級連續待了幾季——戰力外需要寬限期，一個剛簽約的
 * 新人不該因為第一季達不到二軍標準就被釋出。
 *
 * `importPremium` 是外籍名額的擠壓（見 ADR 0019）：一軍的位置有限，球團不會拿
 * 一個剛好及格的外籍去佔，他必須明顯強過本土的替代人選。傳 0 表示本土身分——
 * 是不是本土由呼叫端算（`transfer.importPremium`），這裡只收結論。
 */
export function evaluateMovement(
  world: World,
  options: {
    readonly level: string;
    readonly overall: number;
    readonly yearsAtBottom: number;
    /** 當年的聯盟水準。null 表示用基準值。 */
    readonly standards?: LeagueStandards | null;
    /** 一軍門檻要額外加的分數。本土為 0。 */
    readonly importPremium?: number;
    /** 升降級與戰力外都是關卡，吃個人尺——見 CONTEXT.md「個人尺 / 聯盟真尺」。 */
    readonly tier: HandednessTier;
  },
): MovementResult {
  const rng = world.stream('career');
  const { path, index } = indexOf(options.level);
  const mv = cfg.movement;
  const standards = options.standards ?? null;
  const premium = options.importPremium ?? 0;
  // **只加在一軍。** 外籍名額限的是一軍的出場登録，二軍沒有這個限制——現實裡
  // 支配下登録不分國籍。加在二軍會變成「外籍連二軍都待不住」，那不是名額擠壓，
  // 那是把人趕出球界。
  const barAt = (level: string): number =>
    leagues.levels[level]?.top !== undefined ? premium : 0;
  /** 門檻被外籍名額墊高時，理由要說出來——不然玩家只會看到一個對不上的數字。 */
  const noteAt = (level: string): string => (barAt(level) > 0 ? '，外籍名額' : '');

  /**
   * 這名球員在某層級的下限。
   *
   * `floating` 決定吃不吃當年浮動（見函式開頭與 ADR 0011、0029）；個人尺的
   * 折扣則兩種都吃——那是他的身分，不是今年的行情。
   */
  const minOf = (level: string, floating: boolean): number =>
    personalStandardOf(floating ? standards : null, level, options.tier).min;

  const above = index >= 0 && index < path.length - 1 ? path[index + 1] : undefined;
  if (above !== undefined) {
    const target = leagues.levels[above];
    if (target !== undefined) {
      // 門檻用當年的值：人才斷層的年份比較好擠上去，這正是浮動該有的效果。
      const barOf = (level: string): number =>
        Math.round(minOf(level, true)) + barAt(level) + mv.promote.margin;
      const targetMin = Math.round(minOf(above, true)) + barAt(above);
      const d = options.overall - (targetMin + mv.promote.margin);
      if (d >= 0 && rng.chance(chanceOf(mv.promote.chance, d))) {
        // **升到清得過的最高一階，不是只升一階。** 小聯盟有四層，逐年升階代表
        // 一個十八歲就有大聯盟能力的人得先在 1A、2A、3A 各耗一年——球團不會這樣
        // 用他，那是把即戰力放在板凳上折舊。要不要動由上一層級的餘裕決定（跟原
        // 本一樣，升遷率不變），動到哪由能力本身決定。
        //
        // 反過來，一階都跳不過的人不受影響：他清得過的最高一階就是上一階。
        let dest = above;
        for (let i = path.length - 1; i > index + 1; i--) {
          const level = path[i];
          if (level !== undefined && options.overall >= barOf(level)) {
            dest = level;
            break;
          }
        }
        const destInfo = leagues.levels[dest];
        const skipped = path.indexOf(dest) - index - 1;
        return {
          movement: 'promote',
          level: dest,
          reason:
            `能力達到${destInfo?.name ?? dest}的標準（綜合 ${options.overall}／門檻 ${
              dest === above ? targetMin : barOf(dest) - mv.promote.margin
            }${noteAt(dest)}）` + (skipped > 0 ? `，越級跳過 ${skipped} 階` : ''),
        };
      }
    }
  }

  const here = leagues.levels[options.level];
  if (here === undefined) throw new Error(`未知的聯盟層級：${options.level}`);
  // 基準值，不吃浮動——見函式開頭與 ADR 0029。
  const hereMin = Math.round(minOf(options.level, false)) + barAt(options.level);
  const shortfall = hereMin + mv.demote.margin - options.overall;

  if (shortfall > 0 && index > 0) {
    const below = path[index - 1];
    const pressure = chanceOf(mv.demote.chance, shortfall);
    if (below !== undefined && rng.chance(pressure)) {
      return {
        movement: 'demote',
        level: below,
        reason: `跟不上${here.name}的水準（綜合 ${options.overall}／門檻 ${hereMin}${noteAt(options.level)}）`,
        pressure,
      };
    }
  }

  // 已經在最低層級卻仍跟不上：**看 d 分級的機率**，不是一條硬線（issue #1）。差 3
  // 分與差 10 分是兩種處境——前者球團還在猶豫，後者幾乎不必開會。
  //
  // **這條線不吃浮動**（見 ADR 0011）。升降級用當年的 par 是對的——今年人才斷層
  // 就該比較好卡位。但戰力外不同：浮動的 par 會跟著衰退的球員一起往下沉，等於
  // 每年都幫他把及格線調低，於是一路撐到四十歲。基準值是聯盟今年鬆一點可以保住
  // 你的位置，但不可能讓一個遠低於基準線的人無限期留著。
  if (index === 0 && options.yearsAtBottom >= mv.release.rookie_seasons) {
    const par = Math.round(personalStandardOf(null, options.level, options.tier).par);
    const d = options.overall - par;
    const tier = mv.release.tiers.find((t) => d <= t.d);
    if (tier !== undefined && rng.chance(tier.chance)) {
      return {
        movement: 'release',
        level: null,
        reason: `在${here.name}跟不上（綜合 ${options.overall}／平均 ${par}）`,
      };
    }
  }

  return { movement: 'stay', level: options.level, reason: '留在原層級' };
}

export interface AgingResult {
  readonly ability: Abilities;
  /** 每項能力的變動量，只列出非零的。 */
  readonly changes: ReadonlyMap<string, number>;
  readonly phase: 'growth' | 'peak' | 'decline';
}

/**
 * 一季的自然年齡變動。
 *
 * 巔峰之前緩升、巔峰之中持平、巔峰之後遞減，且衰退幅度隨年齡加速。
 *
 * 衰退不是等比落在每項能力上：速度、守備範圍與球速先掉，接觸與選球撐得比較
 * 久。這是真實的老化順序，也讓老將的生存策略（移防、改當接觸型打者）成立。
 */
export function applyAging(
  world: World,
  ability: Abilities,
  age: number,
  ceilingBonus: Readonly<Record<string, number>> = {},
): AgingResult {
  const rng = world.stream('growth');
  const a = cfg.aging;
  const changes = new Map<string, number>();
  const next: Record<string, number> = { ...ability };

  // 走訪順序必須固定，否則同一個種子會抽出不同結果。
  const keys = Object.keys(ability).sort();

  // 守備天賦的額外成長，排在自然成長**之前**。機率為 0 時一顆骰子都不抽，沒買
  // 天賦的生涯因此與加這條之前逐格相同。
  defenseBonus(rng, next, changes, age, ceilingBonus);

  if (age < a.peak_start) {
    const points = rng.int(a.growth.points.min, a.growth.points.max);
    for (let i = 0; i < points; i++) {
      const key = keys[rng.int(0, keys.length - 1)];
      if (key === undefined) continue;
      next[key] = (next[key] ?? 0) + 1;
      changes.set(key, (changes.get(key) ?? 0) + 1);
    }
    return { ability: next as Abilities, changes, phase: 'growth' };
  }

  if (age <= a.peak_end) return { ability: next as Abilities, changes, phase: 'peak' };

  const yearsPast = age - a.peak_end;
  const total = Math.min(a.decline.max, a.decline.base + yearsPast * a.decline.per_year_after_peak);
  const fast = new Set(a.decline.speed_first.fast);
  const slow = new Set(a.decline.speed_first.slow);

  for (const key of keys) {
    const mult = fast.has(key)
      ? a.decline.speed_first.fast_multiplier
      : slow.has(key)
        ? a.decline.speed_first.slow_multiplier
        : 1;
    // 期望值取整前先擲一次，讓 0.5 點的衰退表現為「一半的年份掉 1 點」而不是
    // 每年都掉或每年都不掉。
    const amount = total * mult;
    const whole = Math.floor(amount);
    const drop = whole + (rng.next() < amount - whole ? 1 : 0);
    if (drop <= 0) continue;
    // 下限是量表的底，不是 0。20 就是球探量表描述得了的最差，跌破它會產生
    // 沒有意義的數字——「比 20 更差」在球探報告上沒有對應的說法。
    const floored = Math.max(abilities.scale.hard_floor, (next[key] ?? 0) - drop);
    if (floored === (next[key] ?? 0)) continue;
    changes.set(key, floored - (next[key] ?? 0));
    next[key] = floored;
  }

  return { ability: next as Abilities, changes, phase: 'decline' };
}

/**
 * 守備天賦（勤能補拙）的額外成長：每季一次，一項守備能力 +1。
 *
 * **只到巔峰結束為止。** 門檻看的是 `peak_end` 而不是寫死的歲數，因此「不老妖
 * 精」把巔峰往後推的同時，也把這條可以領的年份一併延長——兩個天賦疊起來的效果
 * 是自然的，不必另外寫一條互動規則。
 *
 * 抽的池子只收**還沒頂到硬上限**的那幾項：頂到了還留在池子裡的話，機率會被一條
 * 動不了的能力吃掉，抽中了卻什麼都沒發生。四項全頂就整季不觸發。
 */
function defenseBonus(
  rng: ReturnType<World['stream']>,
  next: Record<string, number>,
  changes: Map<string, number>,
  age: number,
  ceilingBonus: Readonly<Record<string, number>>,
): void {
  const chance = cfg.aging.growth.defense_bonus_chance;
  if (chance <= 0 || age > cfg.aging.peak_end) return;
  if (rng.next() >= chance) return;

  const pool = (abilities.display_groups.members.fielding ?? []).filter(
    (key) => (next[key] ?? 0) < hardCap(ceilingBonus[key] ?? 0),
  );
  if (pool.length === 0) return;

  const key = pool[rng.int(0, pool.length - 1)];
  if (key === undefined) return;
  next[key] = (next[key] ?? 0) + 1;
  changes.set(key, (changes.get(key) ?? 0) + 1);
}

/**
 * 不由分說的引退。**只剩年齡上限一條。**
 *
 * 原本還有兩條：被釋出又過了某個年紀、以及三十歲起的年齡機率。兩條都拿掉了，
 * 理由是它們**跑在尋路與提問之前**——33 歲被日職釋出的人因此永遠走不到墨聯與
 * 澳職，而那兩個聯盟的存在理由正是「當所有頂級聯盟都關門時，還有地方打球」，
 * 連 `age_window` 都刻意為它們留空。回中職的路也走同一條尋路，一併被吃掉。
 *
 * 現在被釋出一律先跑尋路：**真的沒有任何球隊邀請，才是生涯的終點**。
 */
export function shouldRetire(options: {
  readonly age: number;
}): { readonly retire: boolean; readonly reason: string } {
  const r = cfg.retirement;
  if (options.age >= r.max_age) return { retire: true, reason: '年齡到了極限' };
  return { retire: false, reason: '' };
}

/**
 * 這一季身體有沒有發出訊號。
 *
 * 命中時**跳出引退提問**，而不是直接結束生涯——年紀到了是「該考慮了」，不是
 * 「你被開除了」。機率隨年齡上升，因此問得越來越頻繁。
 *
 * 一律先抽，年紀不夠時也抽：抽取次數必須與年齡無關，否則同一個種子會在生日
 * 前後讓後面所有判定整串偏移。
 */
export function asksRetirement(world: World, age: number): boolean {
  const r = cfg.retirement;
  const hit = world.stream('career').chance(
    Math.min(r.age_chance.max, r.age_chance.base + (age - r.min_age) * r.age_chance.per_year),
  );
  return age >= r.min_age && hit;
}

/** 職業階段的季初訓練骰數。比養成期少——球季佔滿了時間。 */
export function proDiceCount(world: World, age: number): number {
  const p = cfg.pro_dice;
  let count = Number(world.stream('growth').weighted(p.count_weights));
  if (age >= cfg.aging.peak_start && age <= cfg.aging.peak_end) count += p.peak_bonus.delta;
  return Math.max(1, count);
}
