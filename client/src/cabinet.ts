/**
 * 成就櫃的版面：把解鎖清單排成一個個格子與分區。
 *
 * **這是介面的事，不是引擎的事。** 分組、排序、欄位、要不要把聯盟前綴從名字上剝
 * 掉——問的都是「櫃子怎麼畫」，而不是「這一生值多少」。它曾經住在
 * `engine/achievements.ts` 裡，於是那支引擎模組對外的 surface 有一半是給一個
 * React 元件用的，連伺服器的驗證都得把它 import 進去（見 DEVELOPER.md §5 的
 * 單向依賴：介面依賴引擎，引擎依賴資料）。
 *
 * 計分、AP 與天梯階段仍然在 `engine/achievements.ts`——那邊是判斷，這邊是版面。
 */

import { ladderOf } from './engine/achievements.ts';
import {
  achievements as cfg,
  leagues,
  teams as teamsData,
  traits as traitsData,
} from './data/index.ts';

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
  /** 最高那一階的稀有率（百分比）。伺服器沒給就沒有。 */
  readonly rarity?: number;
}

/** 成就櫃需要的最小形狀——伺服器的 `UnlockedAchievement` 正好是它的超集。 */
interface UnlockedLike {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly points: number;
  readonly at: string;
  readonly rarity?: number;
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
      tile: {
        id: key,
        category: a.category,
        name: a.name,
        points,
        at: a.at,
        ...(a.rarity === undefined ? {} : { rarity: a.rarity }),
      },
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

/**
 * 「這串字是哪個體系」的反查表。
 *
 * 三種寫法都要收：頂級聯盟名（中職、大聯盟）、體系別名（旅美、旅日，見
 * `leagues.org_names`）與球隊暱稱。動態命名的三個特性——◯◯歷史級球星、◯◯先生、
 * ◯◯七彩球衣——填進去的就是這三種字串的其中一種，而它們都該落在對應聯盟底下。
 */
const ORG_BY_FILL = new Map<string, string>([
  ...Object.entries(LEAGUE_NAMES).map(([org, name]) => [name, org] as const),
  ...Object.entries(leagues.org_names).map(([org, name]) => [name, org] as const),
  ...Object.entries(teamsData.leagues).flatMap(([org, list]) =>
    (list ?? []).map((team) => [team.nick ?? team.name.slice(-2), org] as const),
  ),
]);

/** 動態命名的特性：識別字串 → 名字裡固定的那一段後綴。 */
const TRAIT_SUFFIX = new Map(
  Object.entries(traitsData.dynamic_names).flatMap(([id, def]) =>
    typeof def === 'object' && def !== null && typeof def.pattern === 'string'
      ? [[id, def.pattern.replace(/\{[a-z_]+\}/g, '')] as const]
      : [],
  ),
);

/** 從「中職歷史級球星」這種組出來的名字裡取回填進去的那一段。 */
function traitFillOf(traitId: string, name: string): string | null {
  const suffix = TRAIT_SUFFIX.get(traitId);
  if (suffix === undefined || suffix === '' || !name.endsWith(suffix)) return null;
  return name.slice(0, name.length - suffix.length);
}

/** 生涯合計不屬於任何聯盟——它是把所有聯盟加起來的那一欄。 */
const CAREER_TOTAL_TITLE = '生涯通算';

/** 這一格屬於哪個職業聯盟；不屬於任何聯盟的回 `null`。 */
function orgOf(id: string): string | null {
  const parts = id.split(':');
  if (parts[0] === 'cum') return parts[1] === 'career' ? null : (parts[1] ?? null);
  if (parts[0] === 'award') return parts[1] ?? null;
  // 名人堂的鍵帶的是聯盟**名字**（見 evaluateAchievements），反查回體系代碼。
  if (parts[0] === 'hall') return ORG_BY_LEAGUE_NAME.get(parts[1] ?? '') ?? null;
  // 動態命名的特性帶著聯盟或球隊：◯◯歷史級球星、◯◯先生、◯◯七彩球衣。它們講的
  // 就是某一個聯盟裡發生的事，沒有理由跟「魔鬼筋肉人」擠在同一個大標底下。
  if (parts[0] === 'trait') {
    const fill = traitFillOf(parts[1] ?? '', parts.slice(2).join(':'));
    return fill === null ? null : (ORG_BY_FILL.get(fill) ?? null);
  }
  return null;
}

/**
 * 名字在源頭就帶了聯盟前綴；進了聯盟大標之後那個前綴就是重複的。
 *
 * 獎項是「中職 MVP」那種帶空格的，動態特性是「中職歷史級球星」那種直接黏著的，
 * 兩種都剝。剝不掉就原樣留著——◯◯先生填的是球隊暱稱，本來就不會是聯盟名。
 */
function stripLeague(name: string, league: string): string {
  if (name.startsWith(`${league} `)) return name.slice(league.length + 1);
  if (name.startsWith(league) && name.length > league.length) return name.slice(league.length);
  return name;
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
          // 小標的順序不能跟著這個聯盟剛好解到什麼而跑——名人堂併進「獎項」之後，
          // 沒拿過獎的聯盟會先插進「累積」，六個聯盟就會排成兩種樣子。一律照分類
          // 表的順序（獎項在累積前）擺，缺哪一堆就少哪一堆。
          groups: [...groups.entries()]
            .sort((a, b) => orderOf(CATEGORY_ORDER, a[0]) - orderOf(CATEGORY_ORDER, b[0]))
            .map(([title, list]) => ({ title, items: list })),
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
