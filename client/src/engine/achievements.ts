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

import { achievements as cfg, amateur, leagues, traitName, traits as traitsData } from '../data/index.ts';
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

  // ---- 姻緣。一位對象一格，id 掛名字所以跨局自動去重。
  for (const spouse of ctx.spouses) {
    list.push({
      id: `marriage:${spouse}`,
      category: c.marriage.name,
      name: spouse,
      points: c.marriage.default,
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
  cfg.categories.marriage.name,
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

/* ------------------------------------------------------- 成就櫃的兩層分組 */

/** 大標底下的一個小標。`title` 是 `null` 代表這個大標不再往下分。 */
export interface CabinetGroup {
  readonly title: string | null;
  readonly items: readonly AchievementTile[];
}

/**
 * 成就櫃的一個大標。
 *
 * **職業聯盟自己站一個大標。** 六個聯盟的獎項、累積、名人堂全部倒進同一個
 * 「獎項」「累積」裡的話，玩家看到的是一長串分不出出處的名字——中職的 MVP 和
 * 大聯盟的 MVP 疊在一起，而那正是兩件完全不同重量的事。名人堂併進聯盟底下的
 * 「獎項」，因為單一聯盟的名人堂永遠只有一格，自己撐不起一個小標。
 */
export interface CabinetSection {
  readonly key: string;
  readonly title: string;
  readonly points: number;
  readonly groups: readonly CabinetGroup[];
}

const LEAGUE_NAMES: Readonly<Record<string, string>> = leagues.top_league_names;
const ORG_BY_LEAGUE_NAME = new Map(Object.entries(LEAGUE_NAMES).map(([org, name]) => [name, org]));

/** 生涯合計不屬於任何聯盟——它是把所有聯盟加起來的那一欄。 */
const CAREER_TOTAL_TITLE = '生涯通算';

/** 這一格屬於哪個職業聯盟；不屬於任何聯盟的回 `null`。 */
function orgOf(id: string): string | null {
  const parts = id.split(':');
  if (parts[0] === 'cum') return parts[1] === 'career' ? null : (parts[1] ?? null);
  if (parts[0] === 'award') return parts[1] ?? null;
  // 名人堂的鍵帶的是聯盟**名字**（見 evaluateAchievements），反查回體系代碼。
  if (parts[0] === 'hall') return ORG_BY_LEAGUE_NAME.get(parts[1] ?? '') ?? null;
  return null;
}

/** 名字在源頭就帶了聯盟前綴；進了聯盟大標之後那個前綴就是重複的。 */
function stripLeague(name: string, league: string): string {
  return name.startsWith(`${league} `) ? name.slice(league.length + 1) : name;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

function sumPoints(items: readonly AchievementTile[]): number {
  return items.reduce((sum, a) => sum + a.points, 0);
}

/**
 * 把成就櫃排成「大標＝聯盟／小標＝獎項與累積」的兩層。
 *
 * 順序仍然是固定的（見 `cabinetTiles`）：業餘與國際賽在前，接著六個職業聯盟，
 * 然後才是生涯通算與分級。空的分類不出現。
 */
export function cabinetSections(unlocked: readonly UnlockedLike[]): readonly CabinetSection[] {
  const tiles = cabinetTiles(unlocked);
  const HALL = cfg.categories.hall.name;
  const AWARD = cfg.categories.award.name;
  const CUMULATIVE = cfg.categories.cumulative.name;

  const byLeague = new Map<string, AchievementTile[]>();
  const plain = new Map<string, AchievementTile[]>();
  for (const tile of tiles) {
    const org = orgOf(tile.id);
    // 查不到聯盟就照原本的分類放——寧可多一個大標，也不要讓一格消失。
    if (org !== null && LEAGUE_NAMES[org] !== undefined) push(byLeague, org, tile);
    else push(plain, tile.category, tile);
  }

  const out: CabinetSection[] = [];
  for (const category of CATEGORY_ORDER) {
    // 聯盟整批插在「獎項」原本的位置上。
    if (category === AWARD) {
      for (const org of LEAGUE_ORDER) {
        const items = byLeague.get(org);
        if (items === undefined) continue;
        const name = LEAGUE_NAMES[org] ?? org;
        const groups = new Map<string, AchievementTile[]>();
        for (const tile of items) {
          push(groups, tile.category === HALL ? AWARD : tile.category, {
            ...tile,
            name: stripLeague(tile.name, name),
          });
        }
        out.push({
          key: `league:${org}`,
          title: name,
          points: sumPoints(items),
          groups: [...groups.entries()].map(([title, list]) => ({ title, items: list })),
        });
      }
    }

    const items = plain.get(category);
    if (items === undefined) continue;
    const career = category === CUMULATIVE;
    out.push({
      key: category,
      title: career ? CAREER_TOTAL_TITLE : category,
      points: sumPoints(items),
      groups: [
        {
          title: null,
          items: career ? items.map((t) => ({ ...t, name: stripLeague(t.name, '生涯') })) : items,
        },
      ],
    });
  }
  return out;
}
