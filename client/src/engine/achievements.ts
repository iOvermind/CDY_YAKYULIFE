/**
 * 成就與成就點數（AP）。
 *
 * **AP 與生涯評價分是兩件事。** 評價分問「這一生多強」（局內，決定名人堂分級）；
 * AP 問「下一局能買什麼」（跨局，見 CONTEXT.md 的「成就點數」與「天賦商店」）。
 * 同一件事可以同時給兩者，也可以只給其中一種——每 500 安只給 AP，2000 安則兩者
 * 都給。
 *
 * **成就是推導出來的，不是一份手寫清單。** 每一個取得過的隱藏特性、每一座職業
 * 獎項、每一次大賽與國際賽的前三名，都自動成為一項成就。這樣新增一個特性或獎項
 * 時不必記得回來補一筆——那種兩份清單遲早會分岔。
 *
 * 本模組是純函式：同一段生涯一定得到同一份成就清單。
 */

import { achievements as cfg, amateur, leagues, traits as traitsData } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
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
  /** 養成期與國際賽的榮譽字串。前三名才在裡面。 */
  readonly honors: readonly string[];
  /** 名人堂入選的聯盟。 */
  readonly halls: readonly string[];
  /** 這是不是玩家的第一段生涯。 */
  readonly firstCareer: boolean;
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

/** 這個特性的名稱。 */
function traitName(id: string): string {
  for (const t of traitsData.traits) {
    if (t.id === id) return t.name ?? id;
  }
  return id;
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
 * 名次階梯：從榮譽字串的結尾認出名次，回傳它在階梯上的位置。
 *
 * 找不到回傳 -1——十六強不是成就，不該被硬塞進最後一階。
 */
function rankIndexOf(byRank: Readonly<Record<string, number>>, honor: string): number {
  return Object.keys(byRank).findIndex((r) => honor.endsWith(r));
}

/**
 * 累積成就的階梯。等寬級距，第 n 階（1 起算）的增量是 `min(ceil(n/2), cap)`。
 *
 * 前段密而便宜、後段疏而貴：1,1,2,2,3,3,3…。`cap` 讓一項數據不會無限長高——
 * 一個只會累積安打的球員不該靠同一件事把 AP 拿光。
 */
function rungIncrements(count: number, cap: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.min(Math.ceil((i + 1) / 2), cap));
}

/**
 * 累積成就：一項數據只佔清單裡的一格，顯示跨過的**最高階**，點數是每一階加總。
 *
 * **第一階刻意拉高**——打 300 安就引退的人跨不過任何一階。那不是漏掉了他，是
 * 這個系統要說的話：養出一個廢物不該有回報。
 */
function cumulative(
  prefix: string,
  label: string,
  batting: BattingLine | null,
  pitching: PitchingLine | null,
): Achievement[] {
  const c = cfg.categories.cumulative;
  const out: Achievement[] = [];

  for (const [stat, spec] of Object.entries(c.rungs)) {
    if (stat.startsWith('_')) continue;
    const line = spec.side === 'batter' ? batting : pitching;
    if (line === null) continue;
    const raw = (line as unknown as Record<string, number>)[stat] ?? 0;

    // 投球局數存的是出局數，級距寫的是玩家看得到的局數——先換算再切階。
    const total = raw / (spec.unit ?? 1);
    const rungs = Math.min(Math.floor(total / spec.step), Math.floor(spec.max / spec.step));
    if (rungs <= 0) continue;

    const top = rungs * spec.step;
    out.push({
      id: `${prefix}:${stat}:${top}`,
      category: c.name,
      name: joinName(label, spec.name, top),
      points: rungIncrements(rungs, c.increment_cap).reduce((sum, v) => sum + v, 0),
    });
  }
  return out;
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
    list.push({ id: `trait:${id}`, category: c.trait.name, name: traitName(id), points });
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
    list.push(...cumulative(`cum:${league.org}`, league.orgName, league.batting, league.pitching));
  }
  list.push(
    ...cumulative('cum:career', '生涯', ctx.summary.topTotal.batting, ctx.summary.topTotal.pitching),
  );

  // ---- 生涯分級。清單上只有最高的那一級，點數是那一級與底下每一級的增量加總。
  const tierPoints = ladderPoints(c.tier.by_tier, ctx.summary.bestTier);
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

  // ---- 第一段人生
  if (ctx.firstCareer) {
    list.push({
      id: 'first_career',
      category: cfg.first_career_bonus.name,
      name: cfg.first_career_bonus.name,
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

/* ------------------------------------------------------------------ 成就櫃 */

/**
 * 成就櫃裡的一格。
 *
 * **一座階梯只佔一格**：500／1000／1500 安是同一件事的三個刻度，不是三件事。
 * 玩家跨生涯慢慢往上爬，櫃子不該因此長出三排一模一樣的名字（見 ADR 0031）。
 */
export interface AchievementTile {
  /** 階梯鍵——同一座階梯的所有階共用它。 */
  readonly id: string;
  readonly category: string;
  /** 已經爬到的**最高**一階的名字。 */
  readonly name: string;
  /** 這座階梯累積領到的 AP 總和。 */
  readonly points: number;
  /** 最高階是什麼時候拿到的。 */
  readonly at: string;
}

/** 成就櫃需要的最小形狀——伺服器的 `UnlockedAchievement` 正好是它的超集。 */
interface UnlockedLike {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly points: number;
  readonly at: string;
}

/**
 * 分類的**固定**先後。
 *
 * 排序固定是刻意的：玩家開櫃子多半是要確認某一格在不在，而「在不在」只有在
 * 位置不動時才問得出來。用最新解鎖的排前面會讓每次打開都長得不一樣。
 */
const CATEGORY_ORDER: readonly string[] = [
  cfg.categories.trait.name,
  cfg.categories.amateur_cup.name,
  cfg.categories.international.name,
  cfg.categories.award.name,
  cfg.categories.cumulative.name,
  cfg.categories.tier.name,
  cfg.categories.hall.name,
  cfg.first_career_bonus.name,
];

/** 累積成就的聯盟順序，生涯合計永遠排在所有單一聯盟之後。 */
const LEAGUE_ORDER: readonly string[] = Object.keys(leagues.top_league_names);
const STAT_ORDER: readonly string[] = Object.keys(cfg.categories.cumulative.rungs);

function orderOf(list: readonly string[], key: string): number {
  const i = list.indexOf(key);
  return i < 0 ? list.length : i;
}

/**
 * 拆出階梯鍵與階數。
 *
 * `cum:<org>:<stat>:<top>` 與 `tier:<n>` 是階梯；其他成就（獎項、國際賽、名人堂）
 * 本來就一格一件事，鍵就是 id 自己。
 */
function ladderOf(id: string): { readonly key: string; readonly rung: number } {
  const parts = id.split(':');
  if (parts[0] === 'cum' && parts.length === 4) {
    return { key: parts.slice(0, 3).join(':'), rung: Number(parts[3]) };
  }
  // 生涯分級的數字愈小愈高階（0 是最強），翻過來才能跟「愈大愈高」對齊。
  if (parts[0] === 'tier' && parts.length === 2) {
    return { key: 'tier', rung: -Number(parts[1]) };
  }
  return { key: id, rung: 0 };
}

/** 同一格之內的排序鍵——先聯盟、再項目，其餘照 id。 */
function sortKeyOf(key: string): readonly [number, number, string] {
  const parts = key.split(':');
  if (parts[0] === 'cum') {
    const org = parts[1] ?? '';
    // 生涯合計沒有聯盟，排在所有聯盟之後。
    const league = org === 'career' ? LEAGUE_ORDER.length : orderOf(LEAGUE_ORDER, org);
    return [league, orderOf(STAT_ORDER, parts[2] ?? ''), key];
  }
  return [0, 0, key];
}

/**
 * 把伺服器給的解鎖清單收斂成成就櫃要畫的格子。
 *
 * 兩件事：**階梯收斂成一格**（留最高階的名字、加總點數），以及**順序固定**。
 * 空的分類不會出現——沒解鎖的東西不佔位置，玩家不需要看見一整面灰色。
 */
export function cabinetTiles(unlocked: readonly UnlockedLike[]): readonly AchievementTile[] {
  const best = new Map<string, { readonly rung: number; readonly tile: AchievementTile }>();
  for (const a of unlocked) {
    const { key, rung } = ladderOf(a.id);
    const prev = best.get(key);
    const points = (prev?.tile.points ?? 0) + a.points;
    if (prev !== undefined && prev.rung >= rung) {
      best.set(key, { rung: prev.rung, tile: { ...prev.tile, points } });
      continue;
    }
    best.set(key, {
      rung,
      tile: { id: key, category: a.category, name: a.name, points, at: a.at },
    });
  }

  return [...best.values()]
    .map((b) => b.tile)
    .sort((a, b) => {
      const byCat = orderOf(CATEGORY_ORDER, a.category) - orderOf(CATEGORY_ORDER, b.category);
      if (byCat !== 0) return byCat;
      const ka = sortKeyOf(a.id);
      const kb = sortKeyOf(b.id);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
    });
}
