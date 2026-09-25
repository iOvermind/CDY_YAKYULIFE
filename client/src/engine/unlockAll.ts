/**
 * 管理用：一個帳號能拿到的**全部**成就（`unlock-all.sh` 用）。
 *
 * 成就是推導出來的、沒有靜態目錄（見 `achievements.ts` 開頭），所以這裡不另寫一份
 * 清單——那份清單遲早會跟正式規則分岔。做法是**餵給正式的 `evaluateAchievements`
 * 一連串「什麼都做到了」的生涯**，把每一輪新解鎖的收起來：名字、分類、點數與
 * 「已經領過的階只補差額」全部走同一條路。
 *
 * 範圍：
 * - 特性全開。名字隨生涯變的三個：◯◯先生每支球隊、歷史級球星每座名人堂的聯盟、
 *   七彩球衣每個有門檻的聯盟。
 * - 每個聯盟實際會頒的每一種獎（白金手套只有大聯盟），名字用該聯盟的叫法。
 * - 養成盃賽、青少年國際賽、職業國際賽都開冠軍那一階，職業國際賽另開 MVP。
 * - 累積成績開到 **AP 封頂的那一階**，各聯盟與生涯通算各一份；每個聯盟的生涯分級
 *   開到名人堂級，每個聯盟的名人堂入選也都開。
 * - 每位對象的姻緣、每一條第二人生。
 * - **第 N 段人生不開**——那是走完一段生涯才有的東西。
 */

import {
  achievements as cfg,
  amateur,
  dataKeys,
  awards as awardsCfg,
  flavor,
  hallOfFame,
  leagues,
  love,
  teams,
  traitName,
  traits as traitsData,
} from '../data/index.ts';
import { evaluateAchievements, ladderOf, lifeIndex, type Achievement } from './achievements.ts';
import type { BattingLine, PitchingLine } from './amateurStats.ts';
import { awardName, type AwardRecord } from './awards.ts';
import type { CareerSummary } from './career.ts';
import { tierLabel } from './career.ts';
import { joinName } from './naming.ts';
import { teamNick } from './teams.ts';
import { orgLabel } from './transfer.ts';

/** 頂級聯盟的體系代碼，照 `top_league_names` 的順序。 */
const ORGS = Object.keys(leagues.top_league_names);

/** 每座名人堂的聯盟名。設定檔裡夾著 `_note` 之類的註解欄，只收有 league 的。 */
const HALL_LEAGUES = Object.entries(hallOfFame.halls)
  .filter(([k, h]) => !k.startsWith('_') && typeof h === 'object' && h !== null && 'league' in h)
  .map(([, h]) => h.league);

/** 累積成就 AP 封頂那一階要的數字：`scope` 的起算階再往上 ap_max_rungs − 1 階。 */
function cappedLines(scope: 'league' | 'career'): { batting: BattingLine; pitching: PitchingLine } {
  const c = cfg.categories.cumulative;
  const top = c.first_rung[scope] + c.ap_max_rungs - 1;
  const batting: Record<string, number> = {};
  const pitching: Record<string, number> = {};
  for (const [stat, spec] of Object.entries(c.rungs)) {
    if (stat.startsWith('_')) continue;
    const value = top * spec.step * (spec.unit ?? 1);
    (spec.side === 'batter' ? batting : pitching)[stat] = value;
  }
  return { batting: batting as unknown as BattingLine, pitching: pitching as unknown as PitchingLine };
}

/** 每個聯盟實際會頒的獎，名字用那個聯盟的叫法。 */
function everyAward(): AwardRecord[] {
  const a = awardsCfg;
  const codes: { code: string; name: string; orgs?: readonly string[] }[] = [
    // 這兩個的名字寫在 awards.ts 的發獎處，資料檔裡沒有。
    { code: 'all_star', name: '明星賽' },
    { code: 'rookie_of_year', name: '新人王' },
    { code: a.mvp.code, name: a.mvp.name },
    { code: a.batter_of_year.code, name: a.batter_of_year.name },
    { code: a.pitcher_of_year.code, name: a.pitcher_of_year.name },
    { code: a.championship.code, name: a.championship.name },
    ...a.titles.list,
    ...a.fielding.list,
  ];
  const out: AwardRecord[] = [];
  for (const org of ORGS) {
    for (const { code, name, orgs } of codes) {
      if (orgs !== undefined && !orgs.includes(org)) continue;
      out.push({ year: 0, org, level: org, code, name: awardName(org, code, name), side: 'both' });
    }
  }
  return out;
}

/** 盃賽與國際賽的冠軍，以及職業國際賽的 MVP。 */
function everyHonor(): string[] {
  const champion = Object.keys(cfg.categories.amateur_cup.by_rank)[0] ?? '';
  const intlChampion = Object.keys(cfg.categories.international.by_rank)[0] ?? '';
  const out: string[] = [];
  for (const stage of Object.values(amateur.cups)) {
    if (typeof stage !== 'object' || stage === null || !('names' in stage)) continue;
    for (const cup of (stage as { names?: readonly string[] }).names ?? []) out.push(joinName(cup, champion));
  }
  // 走 dataKeys 而不是 Object.values：賽事表裡夾著 `_note` 註解，當成一項賽事的話
  // 組出來的是少了賽事名的「中華隊 冠軍」「中華隊 MVP」（2026-09-26 修正）。
  const youth = amateur.amateur_international;
  for (const t of dataKeys(youth.tournaments).map((k) => youth.tournaments[k]!)) {
    out.push(joinName(youth.honor_prefix, t.name, intlChampion));
  }
  const pro = amateur.international;
  for (const t of dataKeys(pro.tournaments).map((k) => pro.tournaments[k]!)) {
    out.push(joinName(pro.honor_prefix, t.name, intlChampion));
    out.push(joinName(pro.honor_prefix, t.name, pro.mvp.suffix));
  }
  return out;
}

/** 名字隨生涯變的三個特性，每一種可能的名字。 */
function dynamicTraitNames(): Map<string, string[]> {
  const allTeams = Object.values(teams.leagues).flatMap((list) => list.map((t) => t.name));
  const rainbow = traitsData.traits.find((t) => t.id === 'rainbow')?.thresholds ?? {};
  return new Map([
    ['mrteam', [...new Set(allTeams.map((t) => traitName('mrteam', teamNick(t))))]],
    ['legend', HALL_LEAGUES.map((l) => traitName('legend', l))],
    ['rainbow', Object.keys(rainbow).map((org) => traitName('rainbow', orgLabel(org)))],
  ]);
}

/**
 * `unlocked` 這個帳號還沒拿過、而且拿得到的全部成就。點數已經扣掉領過的階。
 *
 * 回傳的每一項就是要寫進成就表的一列。
 */
export function unlockEverything(unlocked: ReadonlySet<string>): readonly Achievement[] {
  const owned = new Set(unlocked);
  const out: Achievement[] = [];

  const league = cappedLines('league');
  const career = cappedLines('career');
  const summary = {
    leagues: ORGS.map((org) => ({
      org,
      orgName: leagues.top_league_names[org] ?? org,
      batting: league.batting,
      pitching: league.pitching,
      tier: 0,
      tierLabel: tierLabel(0),
    })),
    topTotal: { batting: career.batting, pitching: career.pitching },
    bestTier: 0,
    representative: { tierLabel: tierLabel(0) },
  } as unknown as CareerSummary;

  const plainTraits = traitsData.traits.filter((t) => t.dynamic_name !== true).map((t) => t.id);
  const dynamic = dynamicTraitNames();
  const rounds = Math.max(
    1,
    flavor.second_life.stories.length,
    ...[...dynamic.values()].map((names) => names.length),
  );

  // 一輪只能帶一個第二人生、每個動態特性一個名字，所以跑到最長的那一份為止。
  // 每一輪把新解鎖的併進 owned，下一輪就不會重複給。
  for (let i = 0; i < rounds; i++) {
    const traitNames = new Map<string, string>();
    for (const [id, names] of dynamic) {
      const name = names[i % names.length];
      if (name !== undefined) traitNames.set(id, name);
    }
    const result = evaluateAchievements({
      summary,
      awards: everyAward(),
      traits: new Set([...plainTraits, ...traitNames.keys()]),
      traitNames,
      honors: everyHonor(),
      halls: HALL_LEAGUES,
      firstCareer: false,
      // 每一位可能的對象：學生時期、職業時期與保底名單。
      spouses: [...new Set([...love.names.school, ...love.names.pro, ...love.names.safe])],
      secondLife: flavor.second_life.stories[i % flavor.second_life.stories.length]?.title ?? null,
      unlocked: owned,
    });
    for (const a of result.newly) {
      if (lifeIndex(a.id) !== null || owned.has(a.id)) continue;
      // 階梯上已經有更高一階的人，這一階是 0 點的空列，不寫。
      if (a.points <= 0 && ladderOf(a.id).key !== a.id) continue;
      owned.add(a.id);
      out.push(a);
    }
  }
  return out;
}
