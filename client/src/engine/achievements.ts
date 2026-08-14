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

import { achievements as cfg, traits as traitsData } from '../data/index.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import type { AwardRecord } from './awards.ts';
import type { CareerSummary } from './career.ts';

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
 * 累積成就：每跨過一階算一項。
 *
 * **階梯前段密、後段疏**——打到 300 安就引退的人也該拿得到東西，那是一段真實
 * 發生過的生涯，而且新玩家的前幾局多半長那樣。
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
    const total = (line as unknown as Record<string, number>)[stat] ?? 0;

    // 只列**最高的那一階**，點數則是跨過的階數——清單才不會被同一項數據洗版。
    const passed = spec.values.filter((v) => total >= v);
    const top = passed[passed.length - 1];
    if (top === undefined) continue;

    // 出局數存的是出局，顯示要換回局數——玩家看的是「300 局」不是「900 出局」。
    const shown = top / (spec.display_divisor ?? 1);
    out.push({
      id: `${prefix}:${stat}:${top}`,
      category: c.name,
      name: `${label} ${spec.name} ${shown}`,
      points: passed.length * c.points_per_rung,
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
  // **id 一律去掉年份**：2030 年的經典賽冠軍與 2034 年的是同一項成就，不然每一
  // 局都會被當成新解鎖，AP 就無限刷了。顯示的名稱保留年份——那是這一生的紀錄。
  for (const honor of ctx.honors) {
    const bare = honor.replace(/^\d{4}\s*/, '');
    const isIntl = /經典賽|12強/.test(bare);
    if (isIntl) {
      if (bare.endsWith('MVP')) {
        list.push({
          id: `intl:mvp:${bare}`,
          category: c.international.name,
          name: honor,
          points: c.international.mvp,
        });
        continue;
      }
      const rank = Object.keys(c.international.by_rank).find((r) => bare.endsWith(r));
      if (rank !== undefined) {
        list.push({
          id: `intl:${bare}`,
          category: c.international.name,
          name: honor,
          points: c.international.by_rank[rank] ?? c.international.default,
        });
      }
      continue;
    }
    const cupRank = Object.keys(c.amateur_cup.by_rank).find((r) => bare.endsWith(r));
    if (cupRank !== undefined) {
      list.push({
        id: `cup:${bare}`,
        category: c.amateur_cup.name,
        name: honor,
        points: c.amateur_cup.by_rank[cupRank] ?? c.amateur_cup.default,
      });
    }
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

  // ---- 生涯分級。只給最高的那一級。
  const tierPoints = c.tier.by_tier[ctx.summary.bestTier] ?? 0;
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
      name: `${hall}名人堂`,
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
