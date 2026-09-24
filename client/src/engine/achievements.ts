/**
 * 成就與成就點數（AP）。
 *
 * **AP 與生涯評價分是兩件事。** 評價分問「這一生多強」（局內，決定名人堂分級）；
 * AP 問「下一局能買什麼」（跨局，見 CONTEXT.md 的「成就點數」與「天賦」）。
 * 同一件事可以同時給兩者，也可以只給其中一種——每 500 安只給 AP，2000 安則兩者
 * 都給。
 *
 * **成就是推導出來的，不是一份手寫清單。** 每一個取得過的隱藏特性、每一座職業
 * 獎項、每一次大賽與國際賽的前三名，都自動成為一項成就。這樣新增一個特性或獎項
 * 時不必記得回來補一筆——那種兩份清單遲早會分岔。
 *
 * 本模組是純函式：同一段生涯一定得到同一份成就清單。
 */

import {
  achievements as cfg,
  amateur,
  traitName,
  traits as traitsData,
} from '../data/index.ts';
import { statTotal, type BattingLine, type PitchingLine } from './amateurStats.ts';
import type { AwardRecord } from './awards.ts';
import type { CareerSummary } from './career.ts';
import { joinName } from './naming.ts';

/** 一項成就。 */
export interface Achievement {
  /** 穩定的識別字串。日後寫進資料庫的就是它。 */
  readonly id: string;
  /** 分類名稱，給顯示分組用。 */
  readonly category: string;
  readonly name: string;
  readonly points: number;
}

/** 第一段人生的成就 id（沿用舊名，已領過的帳號照樣算第一階）。 */
export const FIRST_LIFE = 'first_career';
/** 第二段以後的成就 id 前綴：`life:2`、`life:3`…… */
export const LIFE_PREFIX = 'life:';

/** 第 n 段人生的顯示名稱。 */
export function lifeName(n: number): string {
  return `第 ${n} 段人生`;
}

/** 這個 id 是第幾段人生；不是人生那一格就回 null。 */
export function lifeIndex(id: string): number | null {
  if (id === FIRST_LIFE) return 1;
  if (!id.startsWith(LIFE_PREFIX)) return null;
  const n = Number(id.slice(LIFE_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 一次結算的成就總表。 */
export interface AchievementResult {
  /** 這一局達成的全部成就。顯示用——玩家要看得到自己這一生做到了什麼。 */
  readonly list: readonly Achievement[];
  /** 其中**本次才第一次解鎖**的。只有這些會給 AP。 */
  readonly newly: readonly Achievement[];
  /** 本次實得的 AP。 */
  readonly points: number;
}

/** 一段生涯裡與成就有關的東西。全部是既有系統的產物，沒有為成就另外記帳。 */
export interface AchievementContext {
  readonly summary: CareerSummary;
  readonly awards: readonly AwardRecord[];
  readonly traits: ReadonlySet<string>;
  /**
   * 名字由生涯內容組出來的特性，id → 已經填好的名稱。
   *
   * 只有 `dynamic_name` 的特性在裡面（見 traits.json）。發特性的當下才知道那個
   * 「◯◯」是哪個聯盟、哪支球隊，所以名字記在 `PlayerState.traitNames`，成就這裡
   * 只是接收。不在表裡的特性走 traits.json 的固定名字。
   */
  readonly traitNames: ReadonlyMap<string, string>;
  /** 養成期與國際賽的榮譽字串。前三名才在裡面。 */
  readonly honors: readonly string[];
  /** 名人堂入選的聯盟。 */
  readonly halls: readonly string[];
  /** 這是不是玩家的第一段生涯。 */
  readonly firstCareer: boolean;
  /**
   * 這一生走過紅毯的對象。
   *
   * 跨局去重由 unlocked 負責——id 掛的是名字，所以在不同的生涯娶到同一個人只算
   * 一項，娶到不同的人才會長出新的一格。
   */
  readonly spouses: readonly string[];
  /**
   * 已經領過 AP 的成就 id。
   *
   * **同一項成就只給一次 AP。** 在中職打滿 500 安兩次不會拿兩次點數——AP 買到的
   * 天賦是永久啟用的，成就因此是一棵解鎖樹而不是每局重刷的獎金。這也是成就 id
   * **不能含年份**的原因：帶年份的話每一局都會被當成新的。
   */
  readonly unlocked: ReadonlySet<string>;
}

/** 這個特性的基調。查不到就當中性。 */
function traitTone(id: string): string | null {
  for (const t of traitsData.traits) {
    if (t.id === id) return t.tone ?? null;
  }
  return null;
}

/**
 * 這個特性在成就櫃上的一格：識別字串與顯示名稱。
 *
 * 三個特性的名字是**生涯內容組出來的**——`legend`（◯◯歷史級球星）、`mrteam`
 * （◯◯先生）、`rainbow`（◯◯七彩球衣）。名字裡的那個「◯◯」是聯盟或球隊，而
 * **聯盟／球隊不同就是不同成就**：中職的歷史級球星與日職的歷史級球星是兩件事，
 * 跟「同一個獎在不同聯盟分開記」是同一條規則（見 evaluateAchievements 的獎項）。
 * 所以解析後的名字要進識別字串，不能只掛一個 `trait:legend`——那樣第二個聯盟的
 * 同名成就會被 unlocked 當成已經領過而拿不到 AP。
 *
 * 名字本身由 `ctx.traitNames` 提供：那是發特性的當下就記下來的字串（見 game.ts
 * 的 `#traitNames`），因為當時才知道是哪個聯盟、哪支球隊。查不到就交給資料層的
 * `traitName` 去炸——半截的名字比錯誤訊息難查得多。
 */
function traitTile(id: string, resolved: string | undefined): { id: string; name: string } {
  return resolved === undefined
    ? { id: `trait:${id}`, name: traitName(id) }
    : { id: `trait:${id}:${resolved}`, name: resolved };
}

/**
 * 階梯的點數：跨到第 `index` 階（0 = 最高）就把它與底下每一階的增量全部加起來。
 *
 * 資料檔一律由高到低寫**增量**，見 [ADR 0031]。這個函式是那份約定的唯一實作，
 * 養成、國際賽、生涯分級共用——三個地方各寫一次加總，就會各錯一次。
 */
function ladderPoints(increments: readonly number[], index: number): number {
  return increments.slice(index).reduce((sum, v) => sum + v, 0);
}

/**
 * 拆出階梯鍵與階數。
 *
 * `cum:<org>:<stat>:<top>` 與 `tier:<n>` 是階梯；其他成就（獎項、國際賽、名人堂）
 * 本來就一格一件事，鍵就是 id 自己。
 */
export function ladderOf(id: string): { readonly key: string; readonly rung: number } {
  const parts = id.split(':');
  if (parts[0] === 'cum' && parts.length === 4) {
    return { key: parts.slice(0, 3).join(':'), rung: Number(parts[3]) };
  }
  // 生涯分級的數字愈小愈高階（0 是最強），翻過來才能跟「愈大愈高」對齊。
  if (parts[0] === 'tier' && parts.length === 2) {
    return { key: 'tier', rung: -Number(parts[1]) };
  }
  // 第 N 段人生也是一座階梯：櫃子裡只留最高那一段。
  const life = lifeIndex(id);
  if (life !== null) return { key: 'life', rung: life };
  return { key: id, rung: 0 };
}

/**
 * 同一座階梯上，之前的生涯已經爬到哪一階；沒爬過回傳 null。
 *
 * 階梯的 id 只記「走到的那一階」（`cum:MLB:rbi:1000`），所以上一段生涯領走的
 * 是一個**不同的 id**——不扣掉它，這一段走到 1500 時會把 500 與 1000 的分數
 * 再領一次（#51／#52 的 +828 就是這麼來的）。階梯只補沒拿過的階。
 */
function bestUnlockedRung(unlocked: ReadonlySet<string>, key: string): number | null {
  let best: number | null = null;
  for (const id of unlocked) {
    const l = ladderOf(id);
    if (l.key !== key) continue;
    if (best === null || l.rung > best) best = l.rung;
  }
  return best;
}

/**
 * 名次階梯：從榮譽字串的結尾認出名次，回傳它在階梯上的位置。
 *
 * 找不到回傳 -1——十六強不是成就，不該被硬塞進最後一階。
 */
function rankIndexOf(byRank: Readonly<Record<string, number>>, honor: string): number {
  return Object.keys(byRank).findIndex((r) => honor.endsWith(r));
}

/**
 * 階梯結算。階梯是**生成**的，不是查表：第 n 階的門檻就是 n×step，往上沒有盡頭。
 * 4200 安顯示「4000 安」，380 盜顯示「350 盜」——手寫的表格總有結尾，而結尾遲早
 * 會變成沒人宣告過的天花板（3600 安卡在 3000 就是這麼來的）。
 *
 * 分數同樣不封頂：跨過的第 n 階給 n×points，逐階累加，AP 與生涯評價分都照給。
 * 累加的結果隨階數平方成長，這是刻意的——能打到那個份上的人早就不缺 AP，攔他
 * 只會讓紀錄停在半路。
 *
 * `firstRung` 決定從第幾階開始給：聯盟 1、生涯 2。生涯的門高一階，級距不變。
 */
export function ladderTop(
  step: number,
  points: number,
  firstRung: number,
  value: number,
): { readonly top: number | null; readonly points: number } {
  const rung = rungOf(step, firstRung, value);
  if (rung === null) return { top: null, points: 0 };

  // firstRung..rung 每階 n×points 的總和。逐階跑迴圈也對，但生涯可以走到幾十階，
  // 用公式省得有人日後把上限塞回迴圈裡。
  const sum = (n: number): number => (n * (n + 1)) / 2;
  return { top: rung * step, points: points * (sum(rung) - sum(firstRung - 1)) };
}

/** 跨到第幾階。沒跨過第一階就是 null。 */
function rungOf(step: number, firstRung: number, value: number): number | null {
  if (step <= 0) throw new Error(`級距必須為正，收到 ${step}`);
  const rung = Math.floor(value / step);
  return rung < firstRung ? null : rung;
}

/**
 * 同一座階梯的 **AP** 那一份：**線性，而且只認前幾階**。
 *
 * 與 `ladderTop()` 共用級距、門檻與階名——玩家看到的仍然是同一座階梯，4200 安還是
 * 顯示 4000 安。**分開的只有分數的算法**，因為那兩個數字回答的是不同的問題：
 *
 * - **評價分**問「這一生多強」。平方成長是對的：傳奇本來就該甩開一般人，而那把尺
 *   只在這一局裡用。
 * - **AP** 是跨局的**貨幣**。平方成長在貨幣上就是通膨——多打五年不是多值 1.5 倍，
 *   是多值 4 倍。累積類因此吃掉了一段好生涯九成以上的 AP，而整棵天賦樹兩段生涯
 *   就買得完。
 *
 * 天花板只封 **AP**：`maxRungs` 之後再怎麼打都不再多給點數，但階梯本身不封頂，
 * 紀錄照爬、評價分照給。封的是獎金，不是成就。
 */
export function ladderAp(
  step: number,
  points: number,
  firstRung: number,
  maxRungs: number,
  value: number,
): { readonly top: number | null; readonly points: number } {
  const rung = rungOf(step, firstRung, value);
  if (rung === null) return { top: null, points: 0 };
  const counted = Math.min(rung - firstRung + 1, maxRungs);
  return { top: rung * step, points: points * counted };
}

/**
 * 一階階梯的名字。
 *
 * **數字在前。**「500 安打」是一句話，「安打 500」讀起來像另一個欄位的數值。
 * 成就櫃與生涯里程碑爬的是同一座階梯（見 `ladderTop`），這裡是它們唯一的
 * 寫法——分開寫過一次，結果就是同一個 500 安在成就卡上叫「安打 500」、在
 * 里程碑卡上叫「500 安打」，玩家得自己猜那是不是同一件事。
 */
export function rungName(top: number, name: string): string {
  return joinName(top, name);
}

/**
 * 累積成就：一項數據只佔清單裡的一格，顯示跨過的**最高階**，點數是每一階加總。
 *
 * 級距讀 `step`，`scope` 只決定從第幾階起算。級距與門檻與生涯里程碑共用同一份
 * ——兩邊分開寫過一次，結果就是聯盟盜壘 50 進得了成就櫃、生涯 350 卻不見蹤影。
 * **分數的算法則不共用**：這裡給的是 AP（線性、封頂），里程碑給的是評價分
 * （平方、不封頂）。見 `ladderAp()`。
 *
 * 跨不過第一階就什麼都沒有——打 300 安就引退的人不會出現在成就櫃上。那不是漏掉
 * 了他，是這個系統要說的話：養出一個廢物不該有回報。
 */
function cumulative(
  scope: 'league' | 'career',
  prefix: string,
  label: string,
  batting: BattingLine | null,
  pitching: PitchingLine | null,
  unlocked: ReadonlySet<string>,
): Achievement[] {
  const c = cfg.categories.cumulative;
  const out: Achievement[] = [];

  for (const [stat, spec] of Object.entries(c.rungs)) {
    if (stat.startsWith('_')) continue;
    const value = statTotal(stat, spec.side, spec.unit ?? 1, batting, pitching);
    if (value === null) continue;

    // 級距、門檻與階名都與 career.ts 的里程碑共用一份——同一階在兩張卡上得長成
    // 同一個樣子。**只有分數的算法分家**：這裡是 AP，走線性並封在 ap_max_rungs
    // 階；里程碑那邊是評價分，平方且不封頂。理由見 `ladderAp()`。
    const ap = (v: number) =>
      ladderAp(spec.step, spec.points, c.first_rung[scope], c.ap_max_rungs, v);
    const { top, points } = ap(value);
    if (top === null) continue;

    // 扣掉上一段生涯已經領過的階，只補這一段新爬上來的部分。
    const prev = bestUnlockedRung(unlocked, `${prefix}:${stat}`);
    const taken = prev === null ? 0 : ap(prev).points;

    out.push({
      id: `${prefix}:${stat}:${top}`,
      category: c.name,
      name: joinName(label, rungName(top, spec.name)),
      points: Math.max(0, points - taken),
    });
  }
  return out;
}

/** 養成期的盃賽名單。這是一份有限且寫死的名單，因此「是不是盃賽」認得出來。 */
const AMATEUR_CUPS = new Set(
  Object.values(amateur.cups).flatMap((stage) =>
    typeof stage === 'object' && stage !== null && 'names' in stage
      ? ((stage as { names?: readonly string[] }).names ?? [])
      : [],
  ),
);

/** 把榮譽字串剝掉名次，剩下的就是賽事名。認不出名次時回傳整串。 */
function cupEventOf(honor: string): string {
  for (const rank of Object.keys(cfg.categories.amateur_cup.by_rank)) {
    if (honor.endsWith(rank)) return honor.slice(0, honor.length - rank.length).trim();
  }
  return honor;
}

/**
 * 結算一段生涯的成就。
 *
 * 順序固定：特性 → 養成與國際賽 → 職業獎項 → 累積 → 生涯分級 → 名人堂。顯示
 * 時照這個順序分組，玩家掃下來就是一段生涯的形狀。
 */
export function evaluateAchievements(ctx: AchievementContext): AchievementResult {
  const c = cfg.categories;
  const list: Achievement[] = [];

  // ---- 特性
  for (const id of [...ctx.traits].sort()) {
    const tone = traitTone(id);
    const points =
      c.trait.by_id[id] ?? (tone === null ? c.trait.default : (c.trait.by_tone[tone] ?? c.trait.default));
    const tile = traitTile(id, ctx.traitNames.get(id));
    list.push({ id: tile.id, category: c.trait.name, name: tile.name, points });
  }

  // ---- 養成期與國際賽的榮譽。榮譽字串裡帶著名次，直接比對。
  //
  // **穿中華隊球衣的一律歸國際賽**，不分年齡層：PONY 世界賽的冠軍與經典賽的冠軍
  // 是同一種榮譽的兩個階段，用前綴分類比用賽事名單分類穩——名單會加，前綴不會。
  // 名字在源頭就組好且不帶年份（見 naming.ts），因此這裡不再剝年份。存檔是重播日誌
  // （見 ADR 0002），榮譽字串每次重播都用當下的規則重組，沒有舊字串要相容。
  //
  // **同一項賽事只留最高的名次**：拿了冠軍就自動含亞軍、季軍的點數，清單上只有
  // 一格。同一個賽事拿過兩次不同名次的人，看到的是他最好的那一次。
  const intlPrefix = amateur.international.honor_prefix;
  const cupBest = new Map<string, { index: number; name: string }>();
  const intlBest = new Map<string, { index: number; name: string }>();
  for (const honor of ctx.honors) {
    // **職業的總冠軍不是盃賽。** 它的榮譽字串是「中職總冠軍」，剝掉名次之後剩下
    // 「中職總」——而下面那段只認「字串結尾是不是名次」，於是它被當成一項養成期
    // 的盃賽收進去，同時又以 award:<org>:championship 的身分進了聯盟那一格，一件
    // 事在兩個大標底下各出現一次。盃賽改成認名單：養成期的賽事名是有限且寫死的
    // （見 amateur.json 的 cups[*].names），不在名單上的就不是盃賽。
    if (!honor.startsWith(intlPrefix) && !AMATEUR_CUPS.has(cupEventOf(honor))) continue;
    const isIntl = honor.startsWith(intlPrefix);
    if (isIntl && honor.endsWith('MVP')) {
      list.push({
        id: `intl:mvp:${honor}`,
        category: c.international.name,
        name: honor,
        points: c.international.mvp,
      });
      continue;
    }
    const byRank = isIntl ? c.international.by_rank : c.amateur_cup.by_rank;
    const index = rankIndexOf(byRank, honor);
    if (index < 0) continue;

    const rank = Object.keys(byRank)[index] ?? '';
    const event = honor.slice(0, honor.length - rank.length).trim();
    const best = isIntl ? intlBest : cupBest;
    const prev = best.get(event);
    if (prev === undefined || index < prev.index) best.set(event, { index, name: honor });
  }
  for (const [event, best] of intlBest) {
    list.push({
      id: `intl:${event}`,
      category: c.international.name,
      name: best.name,
      points: ladderPoints(Object.values(c.international.by_rank), best.index),
    });
  }
  for (const [event, best] of cupBest) {
    list.push({
      id: `cup:${event}`,
      category: c.amateur_cup.name,
      name: best.name,
      points: ladderPoints(Object.values(c.amateur_cup.by_rank), best.index),
    });
  }

  // ---- 職業獎項。**每一種獎各算一項，不論拿過幾座**——七座 MVP 是一項成就。
  const seen = new Map<string, string>();
  for (const award of ctx.awards) {
    const key = `${award.org}:${award.code}`;
    if (!seen.has(key)) seen.set(key, award.name);
  }
  for (const [key, name] of [...seen.entries()].sort()) {
    const code = key.split(':')[1] ?? '';
    list.push({
      id: `award:${key}`,
      category: c.award.name,
      name,
      points: c.award.by_code[code] ?? c.award.default,
    });
  }

  // ---- 累積：各聯盟各一份，另外再算一份一軍通算。不計養成與二軍。
  for (const league of ctx.summary.leagues) {
    list.push(
      ...cumulative(
        'league',
        `cum:${league.org}`,
        league.orgName,
        league.batting,
        league.pitching,
        ctx.unlocked,
      ),
    );
  }
  list.push(
    ...cumulative(
      'career',
      'cum:career',
      '生涯',
      ctx.summary.topTotal.batting,
      ctx.summary.topTotal.pitching,
      ctx.unlocked,
    ),
  );

  // ---- 生涯分級。清單上只有最高的那一級，點數是那一級與底下每一級的增量加總，
  // 同樣只補上一段生涯還沒爬到的那幾級。
  const prevTier = bestUnlockedRung(ctx.unlocked, 'tier');
  const takenTier = prevTier === null ? 0 : ladderPoints(c.tier.by_tier, -prevTier);
  const tierPoints = Math.max(0, ladderPoints(c.tier.by_tier, ctx.summary.bestTier) - takenTier);
  if (tierPoints > 0) {
    const label = ctx.summary.representative?.tierLabel ?? '';
    list.push({
      id: `tier:${ctx.summary.bestTier}`,
      category: c.tier.name,
      name: `生涯分級 ${label}`,
      points: tierPoints,
    });
  }

  // ---- 名人堂。可以多座並存。
  for (const hall of ctx.halls) {
    list.push({
      id: `hall:${hall}`,
      category: c.hall.name,
      name: joinName(hall, '名人堂'),
      points: c.hall.default,
    });
  }

  // ---- 姻緣。一位對象一格，id 掛名字所以跨局自動去重。
  for (const spouse of ctx.spouses) {
    list.push({
      id: `marriage:${spouse}`,
      category: c.marriage.name,
      name: spouse,
      points: c.marriage.default,
    });
  }

  // ---- 第 N 段人生：每走完一段就多一階，每階都給 AP，沒有上限。
  //
  // 別的成就同一項只給一次，十段左右就解鎖完了，之後幾乎斷炊；這一條是解鎖完之後
  // 仍然有的保底收入。第幾段從已解鎖過的階數推出來——第一段沿用舊的 `first_career`
  // 這個 id，已經領過的帳號照樣算第一階。
  {
    const lives = [...ctx.unlocked].filter((id) => id === FIRST_LIFE || id.startsWith(LIFE_PREFIX)).length;
    const n = lives + 1;
    list.push({
      id: n === 1 ? FIRST_LIFE : `${LIFE_PREFIX}${n}`,
      category: cfg.first_career_bonus.name,
      name: lifeName(n),
      points: cfg.first_career_bonus.points,
    });
  }

  // 同一項成就只給一次 AP。已經領過的仍然列在清單上（那是這一生做到的事），
  // 但不再計分。
  const seenIds = new Set<string>();
  const newly = list.filter((a) => {
    if (ctx.unlocked.has(a.id) || seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    return true;
  });

  return { list, newly, points: newly.reduce((sum, a) => sum + a.points, 0) };
}
