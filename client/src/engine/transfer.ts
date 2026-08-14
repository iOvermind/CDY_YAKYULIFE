/**
 * 跨體系轉會：挖角與尋路。
 *
 * **邊由資料推導，不逐條列出。** 一個體系只要在 `leagues.json` 的 `transfer`
 * 填好門檻與年齡窗口，就自動接上轉會圖——新增聯盟不必寫新的分支。見 ADR 0004。
 *
 * 方向由聯盟水準決定：
 *
 * - **挖角**往上。能力達到目標體系的門檻、上季打得夠好、年齡窗口未關，那個
 *   體系就可能來要人。不限一階——中職的頂尖球員可以直接被大聯盟挖走。
 * - **尋路**往下。被釋出或被下放時，掃描收得下你的體系。**不看年齡**，因為
 *   那正是墨聯與澳職存在的意義：當所有頂級聯盟都關門時，還有地方打球。
 *
 * 抽取一律走 career 子序列——轉會是生涯層級的事件。
 */

import { dataKeys, leagues, teams as teamsData } from '../data/index.ts';
import { standardOf, type LeagueStandards } from './league.ts';
import { pathOf } from './pro.ts';
import type { World } from './rng.ts';
import { salaryFor } from './salary.ts';

const cfg = leagues.transfer;

/** 一份轉會報價。 */
export interface TransferOffer {
  readonly org: string;
  readonly orgName: string;
  /** 落地層級代碼。 */
  readonly level: string;
  readonly levelName: string;
  readonly team: string;
  /** 簽約金，單位萬元。 */
  readonly bonus: number;
  /** 是不是回到曾經效力過的體系。落葉歸根的敘述要看它。 */
  readonly homecoming: boolean;
}

/** 這個體系的轉會設定。沒有設定的體系不參與轉會圖。 */
function orgConfig(org: string) {
  return cfg.orgs[org];
}

/** 這個體系的中文名。 */
export function orgLabel(org: string): string {
  return leagues.top_league_names[org] ?? leagues.org_names[org] ?? org;
}

/**
 * 年齡窗口的通過率。
 *
 * 沒有設定窗口的體系一律回傳 1——那不是疏漏，是**墨聯與澳職不看年齡**這件事
 * 本身。三十幾歲、在頂級聯盟待不下去的球員，正是它們的客戶。
 */
export function ageGate(org: string, age: number, overLandingBar: number): number {
  const window = orgConfig(org)?.age_window;
  if (window === undefined || window === null) return 1;

  for (const tier of window.tiers) {
    if (age <= tier.max_age) return tier.value;
  }

  // 關窗之後的怪物條款：能力遠超落地門檻的即戰力仍有微弱機會。
  const monster = window.monster;
  if (monster !== undefined && overLandingBar >= monster.over_landing_bar) return monster.value;
  return window.default;
}

/**
 * 這個能力在這個體系落得到哪一層。
 *
 * 取能力達得到 `min + import_premium` 的**最高**層級——被挖角不代表到了那邊
 * 還是一軍球員。一個中職綜合 57 的球員被大聯盟看上，落地是 3A，得自己再打
 * 上去。
 *
 * 回傳 null 表示這個體系連最低層級都收不下他。
 */
export function landingLevel(
  org: string,
  overall: number,
  standards: LeagueStandards | null = null,
): string | null {
  const premium = cfg.import_premium.value;
  let best: string | null = null;
  // pathOf 由低到高，因此最後一個達標的就是最高的那一層。
  for (const level of pathOf(org)) {
    if (overall >= standardOf(standards, level).min + premium) best = level;
  }
  return best;
}

/** 落地在頂級聯盟需要的能力。怪物條款要拿它當基準。 */
function topLandingBar(org: string, standards: LeagueStandards | null): number {
  const path = pathOf(org);
  const top = path[path.length - 1] ?? '';
  return standardOf(standards, top).min + cfg.import_premium.value;
}

/** 抽一支球隊。走訪順序照 teams.json 的宣告順序，否則同一個種子會抽出不同結果。 */
function pickTeam(world: World, org: string, exclude: string | null): string | null {
  const list = teamsData.leagues[org] ?? [];
  const pool = list.filter((t) => t.name !== exclude);
  if (pool.length === 0) return null;
  return pool[world.stream('career').int(0, pool.length - 1)]?.name ?? null;
}

/** 這個體系頂級聯盟的當年水準。比較兩個體系誰強看它。 */
function orgPar(org: string, standards: LeagueStandards | null): number {
  const path = pathOf(org);
  return standardOf(standards, path[path.length - 1] ?? '').par;
}

/**
 * 值不值得為這份報價動身。
 *
 * **只有平移與下降需要加薪。** 往更強的聯盟去本來就可能先減薪換舞台——中職
 * 球員被大聯盟看上、落地 3A 領小聯盟薪水，那是真實會發生也應該發生的事。
 * 但韓職來挖一個正在日職打球的人卻不加薪，那在現實裡不會發生。
 *
 * 目前年薪是 0（還沒領過薪水的年份）時一律放行——那不是加薪不足，是沒有
 * 東西可以比。
 */
function worthMoving(
  org: string,
  level: string,
  ctx: ScoutContext,
): boolean {
  if (ctx.salary <= 0) return true;
  if (orgPar(org, ctx.standards) > orgPar(ctx.currentOrg, ctx.standards)) return true;
  const projected = salaryFor(level, ctx.overall - standardOf(ctx.standards, level).par);
  return projected >= ctx.salary * cfg.scouting.min_raise;
}

/** 簽約金：體系的基礎金額加上 d 值的加給。 */
function signingBonus(org: string, d: number): number {
  const spec = orgConfig(org)?.signing_bonus;
  if (spec === undefined) return 0;
  return Math.round(spec.base + Math.max(0, d) * spec.per_d);
}

export interface ScoutContext {
  readonly overall: number;
  readonly age: number;
  /** 上一季的勝率（勝利份額佔責任額）。球探是看了去年的表現才來的。 */
  readonly lastWinPct: number;
  readonly currentOrg: string;
  readonly currentTeam: string;
  /** 待過的體系。回到其中之一算落葉歸根。 */
  readonly playedOrgs: ReadonlySet<string>;
  readonly standards: LeagueStandards | null;
  /** 目前的年薪。挖角要加薪才提得出口，見 scouting.min_raise。 */
  readonly salary: number;
}

/**
 * 這一年有哪些體系來挖人。
 *
 * 每個體系各自擲一次，命中的全部回傳——呼叫端把它們併成同一張報價單。走訪
 * 順序照 `transfer.orgs` 的宣告順序，因為每次判定都會消耗抽取。
 */
export function scoutingOffers(world: World, ctx: ScoutContext): readonly TransferOffer[] {
  const rng = world.stream('career');
  const out: TransferOffer[] = [];

  for (const org of dataKeys(cfg.orgs)) {
    const spec = orgConfig(org);
    if (spec === undefined || !spec.scouts) continue;
    if (org === ctx.currentOrg) continue;

    // 資格：能力、上季表現、年齡窗口。三者缺一不可。
    const minOverall = spec.scout_min_overall ?? Number.POSITIVE_INFINITY;
    const level = landingLevel(org, ctx.overall, ctx.standards);
    const overBar = ctx.overall - topLandingBar(org, ctx.standards);
    const gate = ageGate(org, ctx.age, overBar);

    // 機率一律先抽，不管有沒有資格——抽取次數必須與資格無關，否則同一個種子
    // 會因為某年差一分而讓後面所有判定整串偏移。
    const roll = rng.next() * 100;
    const chance = (spec.scout_chance ?? 0) * gate;

    if (level === null) continue;
    if (ctx.overall < minOverall) continue;
    if (ctx.lastWinPct < cfg.scouting.min_win_pct.value) continue;
    if (roll >= chance) continue;
    // **挖角必須加薪。** 沒有這一關，韓職會來挖一個正在日職打球的人——跨聯盟
    // 移動本來就伴隨語言、家庭與適應成本，薪水只是打平的話沒有人會走。
    if (!worthMoving(org, level, ctx)) continue;

    const count = rng.int(cfg.scouting.offers_per_org.min, cfg.scouting.offers_per_org.max);
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const team = pickTeam(world, org, null);
      if (team === null || used.has(team)) continue;
      used.add(team);
      out.push({
        org,
        orgName: orgLabel(org),
        level,
        levelName: leagues.levels[level]?.name ?? level,
        team,
        bonus: signingBonus(org, overBar),
        homecoming: ctx.playedOrgs.has(org),
      });
    }
  }

  // 依落地層級的水準由高到低——玩家評估報價時看的就是「哪個舞台比較高」，
  // 資料的宣告順序對他沒有意義。同一個體系的兩份報價維持抽出來的順序。
  return out.sort(
    (a, b) => standardOf(ctx.standards, b.level).par - standardOf(ctx.standards, a.level).par,
  );
}

export interface FallbackContext {
  readonly overall: number;
  readonly currentOrg: string;
  readonly currentTeam: string;
  readonly playedOrgs: ReadonlySet<string>;
  readonly standards: LeagueStandards | null;
  /**
   * 落地層級的水準下限。低於它的報價不列出。
   *
   * 這一項區分了兩種很不一樣的處境：
   *
   * - **被釋出**時不設下限——你已經沒有球隊了，有人要就不錯了。
   * - **自由球員**時下限是目前的層級。FA 問的是「誰想要你」，端出一堆降級的
   *   選項只會讓人誤以為那是市場行情；真的沒有人開價，那才叫市場冷。
   */
  readonly minPar?: number;
}

/**
 * 被釋出或被下放時，其他體系的邀請。
 *
 * **不看年齡、不看上季表現、不看挖角門檻**——這裡問的不是「誰想要你」，而是
 * 「哪裡還收得下你」。墨聯與澳職只出現在這條路上，那正是它們的價值。
 *
 * 依落地層級的水準由高到低排序：先給最好的那條退路。
 */
export function fallbackOffers(world: World, ctx: FallbackContext): readonly TransferOffer[] {
  const out: TransferOffer[] = [];

  for (const org of dataKeys(cfg.orgs)) {
    if (orgConfig(org) === undefined) continue;
    if (org === ctx.currentOrg) continue;
    const level = landingLevel(org, ctx.overall, ctx.standards);
    if (level === null) continue;
    if (ctx.minPar !== undefined && standardOf(ctx.standards, level).par < ctx.minPar) continue;

    const team = pickTeam(world, org, null);
    if (team === null) continue;

    out.push({
      org,
      orgName: orgLabel(org),
      level,
      levelName: leagues.levels[level]?.name ?? level,
      team,
      bonus: signingBonus(org, ctx.overall - topLandingBar(org, ctx.standards)),
      homecoming: ctx.playedOrgs.has(org),
    });
  }

  return out
    .sort(
      (a, b) => standardOf(ctx.standards, b.level).par - standardOf(ctx.standards, a.level).par,
    )
    .slice(0, cfg.fallback.max_offers);
}

/**
 * 入札的目的地。這個體系沒有入札制度時回傳 null。
 *
 * 入札是**體系自己的屬性**，不是寫死日職——真實世界裡日職與韓職都有對大聯盟
 * 的入札制度，中職沒有。
 */
export function postingTarget(org: string): string | null {
  return orgConfig(org)?.posting?.to ?? null;
}

/**
 * 申請得了入札嗎。
 *
 * 資格只有一條：**落地層級等於目標體系的頂級聯盟**。那筆錢買的就是即戰力，
 * 沒有人會花入札金買一個要去小聯盟磨的人。因此門檻不另外設數字——它就是
 * 落地規則的 `min + import_premium`，而那與 legacy 的 60 完全一致。
 */
export function canRequestPosting(options: {
  readonly org: string;
  readonly overall: number;
  readonly standards: LeagueStandards | null;
}): boolean {
  const target = postingTarget(options.org);
  if (target === null) return false;
  const level = landingLevel(target, options.overall, options.standards);
  if (level === null) return false;
  return leagues.levels[level]?.top !== undefined;
}

/**
 * 母隊同意放人的機率。
 *
 * 看**年資**與**入札金**：待越久越沒有理由留你（也是對忠誠的回報），你越強
 * 那筆錢越可觀。被拒絕不是挫折，是還沒到時候。
 */
export function postingConsentChance(options: {
  readonly serviceYears: number;
  readonly fee: number;
}): number {
  const c = cfg.posting.consent;
  const raw =
    c.base +
    options.serviceYears * c.per_service_year +
    (options.fee / c.fee_unit) * c.per_fee_unit;
  return Math.max(c.clamp.min, Math.min(c.clamp.max, raw));
}

export interface OverseasContext {
  readonly org: string;
  readonly overall: number;
  readonly age: number;
  readonly playedOrgs: ReadonlySet<string>;
  readonly standards: LeagueStandards | null;
}

/**
 * 目標體系頂級聯盟的報價。入札與海外 FA 共用同一批球團。
 *
 * 年齡窗口影響的是**有沒有人出價**，不是母隊同不同意。點頭了卻沒有球團出手，
 * 那是另一種失落——而它是真實會發生的事。
 *
 * 落地一律是頂級聯盟：那筆錢（或那個年資）買的就是即戰力。
 */
function overseasOffers(world: World, ctx: OverseasContext): readonly TransferOffer[] {
  const target = postingTarget(ctx.org);
  const rng = world.stream('career');

  // 抽取次數必須與資格無關，否則同一個種子會因為某年差一分而讓後面所有判定
  // 整串偏移——與挖角同樣的理由。
  const roll = rng.next() * 100;
  const count = rng.int(cfg.posting.bidders.min, cfg.posting.bidders.max);
  if (target === null) return [];

  const level = landingLevel(target, ctx.overall, ctx.standards);
  if (level === null || leagues.levels[level]?.top === undefined) return [];

  const overBar = ctx.overall - topLandingBar(target, ctx.standards);
  if (roll >= ageGate(target, ctx.age, overBar) * 100) return [];

  const bids: TransferOffer[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const team = pickTeam(world, target, null);
    if (team === null || used.has(team)) continue;
    used.add(team);
    bids.push({
      org: target,
      orgName: orgLabel(target),
      level,
      levelName: leagues.levels[level]?.name ?? level,
      team,
      bonus: signingBonus(target, overBar),
      homecoming: ctx.playedOrgs.has(target),
    });
  }
  return bids;
}

/** 入札的競標。母隊點頭之後才會走到這裡。 */
export function postingBids(world: World, ctx: OverseasContext): readonly TransferOffer[] {
  return overseasOffers(world, ctx);
}

/**
 * 取得海外 FA 資格了嗎。
 *
 * 在同一個體系待滿指定年資之後，合約到期時**不需母隊同意**即可轉往目標體系。
 * 與入札的差別是「要嘛求球團放你走，要嘛熬到不需要求人」。
 */
export function hasOverseasFreeAgency(org: string, serviceYears: number): boolean {
  if (postingTarget(org) === null) return false;
  return serviceYears >= cfg.posting.overseas_fa_years.value;
}

/**
 * 海外 FA 的報價。年資不足時沒有這條路。
 *
 * 與入札走同一批球團，差別只在不必經過母隊，也不必付入札金——年資本身就是
 * 對價。
 */
export function overseasFaOffers(
  world: World,
  ctx: OverseasContext & { readonly serviceYears: number },
): readonly TransferOffer[] {
  if (!hasOverseasFreeAgency(ctx.org, ctx.serviceYears)) return [];
  return overseasOffers(world, ctx);
}

/**
 * 這一年球探的關注度，給敘述用。
 *
 * **講觀察到的現象，不講機率**——「美國那邊的球探今年沒有再出現」比「窗口
 * 剩 15%」有味道得多，而且它不會把系統的底牌攤開。回傳 null 表示這年沒什麼
 * 好說的。
 */
export function scoutingNote(ctx: ScoutContext): string | null {
  const closing: string[] = [];
  for (const org of dataKeys(cfg.orgs)) {
    const spec = orgConfig(org);
    if (spec === undefined || !spec.scouts || org === ctx.currentOrg) continue;
    if (ctx.overall < (spec.scout_min_overall ?? Number.POSITIVE_INFINITY)) continue;

    const overBar = ctx.overall - topLandingBar(org, ctx.standards);
    const now = ageGate(org, ctx.age, overBar);
    const before = ageGate(org, ctx.age - 1, overBar);
    // 只在「今年比去年差」的那一刻說一次。年年重複同一句是雜訊。
    if (now < before) {
      closing.push(
        now <= 0
          ? `${orgLabel(org)}的球探今年沒有再出現。`
          : `${orgLabel(org)}的關注還在，但明顯不如前兩年。`,
      );
    }
  }
  return closing.length === 0 ? null : closing.join('');
}
