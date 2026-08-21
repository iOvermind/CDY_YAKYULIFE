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

import { amateur, dataKeys, leagues, season, teams as teamsData } from '../data/index.ts';
import { standardOf, type LeagueStandards } from './league.ts';
import { pathOf } from './pro.ts';
import type { World } from './rng.ts';
import { salaryFor } from './salary.ts';
import { championshipOdds, initLeague, type LeagueTable } from './teams.ts';

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
  /** 這支球隊今年的奪冠機率。簽約金與年限都看它。 */
  readonly odds: number;
  /** 這張約幾年。爭冠的球隊給短約，重建的敢給長約。 */
  readonly years: number;
  /**
   * 目標體系的當季戰力表。
   *
   * **報價要連著它一起帶走**：報價單上寫的奪冠機率必須就是簽下去之後真正面對
   * 的那個聯盟格局。少了這一欄，成交時得重抽一次戰力表，玩家看到的數字與拿到
   * 的球隊會是兩回事。
   */
  readonly table: LeagueTable;
}

/**
 * 每個體系每年只建一次戰力表。
 *
 * 同一年同一個體系開出的每一份報價都必須看同一份格局——分開抽的話，「阪神」
 * 在第一份報價裡爭冠、在第二份裡墊底。
 */
type TableCache = Map<string, LeagueTable>;

function tableFor(world: World, org: string, cache: TableCache): LeagueTable {
  const cached = cache.get(org);
  if (cached !== undefined) return cached;
  const table = initLeague(world, org);
  cache.set(org, table);
  return table;
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
  servedYears = 0,
  approach: Approach = 'recruit',
): string | null {
  const premium = importPremium(org, servedYears, approach);
  let best: string | null = null;
  // pathOf 由低到高，因此最後一個達標的就是最高的那一層。
  for (const level of pathOf(org)) {
    if (overall >= standardOf(standards, level).min + premium) best = level;
  }
  return best;
}

/**
 * 誰主動。外籍加成只在球團主動的那一邊成立——見 ADR 0012。
 *
 * - `recruit`：球團上門找你。挖角、入札、自由市場都是這一種。
 * - `seek`：你上門找容身之處。尋路是這一種。
 */
export type Approach = 'recruit' | 'seek';

/**
 * 這個人在這個體系要不要吃外籍加成。
 *
 * 三種情況不吃：
 *
 * - **回母國。** 外籍加成的理由是「名額有限，球團得證明簽這個人比用本地人
 *   好」，對本地人不成立——一個在日職待不下去的台灣球員回中職，他就是個中職
 *   球員，不必比本地人強四分。
 * - **在當地服務夠久。** 日職的「在籍八年視同本土」是真實規則：待滿之後不再
 *   佔用外籍名額。這個身分**留得住**——離開日職去韓職打幾年再回來，八年還是
 *   那八年，因此年資是累計的而不是連續的。
 * - **是你去找他們。** 那個「得明顯強過本土替代人選」的論證預設了球團在挑人。
 *   被釋出或被下放的人自己找上門時，澳職球團的替代人選不是本土明星，是沒有
 *   人——見 ADR 0012。
 */
export function importPremium(
  org: string,
  servedYears: number,
  approach: Approach = 'recruit',
): number {
  if (approach === 'seek') return 0;
  if (org === cfg.home_org.value) return 0;
  const threshold = orgConfig(org)?.domestic_after_years;
  if (threshold !== undefined && servedYears >= threshold) return 0;
  return cfg.import_premium.value;
}

/**
 * 一軍年資夠不夠格拒絕下放。
 *
 * MLB 的五年年資條款：服務滿五年的球員不能被無條件下放到小聯盟。這是真實規
 * 則，也只有那一個體系有——日職與中職的下放是球團說了算，年資只換來 FA。
 *
 * 年資用的是**這個體系的一軍年份**，與外籍身分同一個計數口徑（`#orgYears`）：
 * 拿的是在那個聯盟站穩了多久，不是在球界混了多久。
 */
export function canRefuseDemotion(org: string, servedYears: number): boolean {
  const threshold = orgConfig(org)?.refuse_demotion_after_years;
  return threshold !== undefined && servedYears >= threshold;
}

/** 落地在頂級聯盟需要的能力。怪物條款與簽約金的 d 值都拿它當基準。 */
function topLandingBar(
  org: string,
  standards: LeagueStandards | null,
  servedYears = 0,
  approach: Approach = 'recruit',
): number {
  const path = pathOf(org);
  const top = path[path.length - 1] ?? '';
  // 與 landingLevel 走同一個加成——先前這裡寫死 import_premium，回母國時門檻
  // 因此被高估四分，簽約金與怪物條款都連帶算錯。
  return standardOf(standards, top).min + importPremium(org, servedYears, approach);
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

/** 簽約金：體系的基礎金額加上 d 值的加給，再乘上球隊處境的倍率。 */
function signingBonus(org: string, d: number, odds: number): number {
  const spec = orgConfig(org)?.signing_bonus;
  if (spec === undefined) return 0;
  const base = spec.base + Math.max(0, d) * spec.per_d;
  return Math.round(base * contentionBonusMult(odds));
}

/**
 * 球隊處境對簽約金的倍率。
 *
 * **爭冠的球隊願意砸錢**——他們的窗口就這一兩年，一個補進來的即戰力值多少
 * 錢是用「今年能不能拿下來」算的，不是用市場行情算的。
 */
function contentionBonusMult(odds: number): number {
  const c = cfg.contention;
  const raw = 1 + (odds - c.reference_odds) * c.bonus.per_odds;
  return clamp(raw, c.bonus.min, c.bonus.max);
}

/**
 * 這支球隊願意給幾年。
 *
 * **符號是反的，這是刻意的。** 爭冠球隊砸錢但給短約：他們買的是今年。重建
 * 球隊給不起大錢，卻敢給年限——他們賭的是三年後你還在，而那時候他們正好起來。
 * 於是「錢多」與「約長」變成兩個要取捨的東西，而不是同一件事的兩種說法。
 */
function contractLength(odds: number): number {
  const c = cfg.contention;
  const base = season.contract.rookie_contract.years;
  const delta = clamp(
    Math.round((c.reference_odds - odds) * c.years.per_odds),
    c.years.min,
    c.years.max,
  );
  return Math.max(1, base + delta);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 在各體系累計的一軍年資，以體系代碼為鍵。
 *
 * 用來判定外籍身分（`importPremium`）。**累計而非連續**——離開再回去，先前
 * 待過的年份仍然算數。
 */
export type ServedYears = ReadonlyMap<string, number>;

const servedIn = (served: ServedYears | undefined, org: string): number => served?.get(org) ?? 0;

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
  /** 各體系的累計年資。日職在籍八年之後不再算外籍。 */
  readonly servedYears?: ServedYears;
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
  const tables: TableCache = new Map();

  for (const org of dataKeys(cfg.orgs)) {
    const spec = orgConfig(org);
    if (spec === undefined || !spec.scouts) continue;
    if (org === ctx.currentOrg) continue;

    // 資格：能力、上季表現、年齡窗口。三者缺一不可。
    const minOverall = spec.scout_min_overall ?? Number.POSITIVE_INFINITY;
    const served = servedIn(ctx.servedYears, org);
    const level = landingLevel(org, ctx.overall, ctx.standards, served);
    const overBar = ctx.overall - topLandingBar(org, ctx.standards, served);
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

    const table = tableFor(world, org, tables);
    const count = rng.int(cfg.scouting.offers_per_org.min, cfg.scouting.offers_per_org.max);
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const team = pickTeam(world, org, null);
      if (team === null || used.has(team)) continue;
      used.add(team);
      const odds = championshipOdds(table, team);
      out.push({
        org,
        orgName: orgLabel(org),
        level,
        levelName: leagues.levels[level]?.name ?? level,
        team,
        bonus: signingBonus(org, overBar, odds),
        homecoming: ctx.playedOrgs.has(org),
        odds,
        years: contractLength(odds),
        table,
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
  /**
   * 只列出落地在該體系**頂級聯盟**的報價。
   *
   * 下放專用。那個處境要問的不是「哪裡的水準比日職二軍高」，而是**「哪裡有
   * 一軍的位置」**——中職一軍的 par 44 確實低於日職二軍的 47，但「回台灣先發」
   * 與「在日本坐農場」對一段生涯是完全不同的兩件事，用 par 去比會把前者濾掉。
   *
   * 反過來也擋掉了沒有意義的平移：不會有人為了從日職二軍換到 2A 而搬家。
   */
  readonly topLevelOnly?: boolean;
  /** 各體系的累計年資。日職在籍八年之後不再算外籍。 */
  readonly servedYears?: ServedYears;
  /**
   * 誰主動。預設是 `seek`——這個函式的主場是釋出與下放。
   *
   * 自由市場借用了同一份名單，但那條路是 `recruit`：**FA 問的是「誰想要你」**，
   * 球團在挑人，外籍名額的競爭仍然成立。見 ADR 0012。
   */
  readonly approach?: Approach;
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
  const tables: TableCache = new Map();
  const approach = ctx.approach ?? 'seek';

  for (const org of dataKeys(cfg.orgs)) {
    if (orgConfig(org) === undefined) continue;
    if (org === ctx.currentOrg) continue;
    const served = servedIn(ctx.servedYears, org);
    const level = landingLevel(org, ctx.overall, ctx.standards, served, approach);
    if (level === null) continue;
    if (ctx.topLevelOnly === true && leagues.levels[level]?.top === undefined) continue;
    if (ctx.minPar !== undefined && standardOf(ctx.standards, level).par < ctx.minPar) continue;

    const table = tableFor(world, org, tables);
    const team = pickTeam(world, org, null);
    if (team === null) continue;
    const odds = championshipOdds(table, team);

    out.push({
      org,
      orgName: orgLabel(org),
      level,
      levelName: leagues.levels[level]?.name ?? level,
      team,
      bonus: signingBonus(
        org,
        ctx.overall - topLandingBar(org, ctx.standards, served, approach),
        odds,
      ),
      homecoming: ctx.playedOrgs.has(org),
      odds,
      years: contractLength(odds),
      table,
    });
  }

  const sorted = out.sort(
    (a, b) => standardOf(ctx.standards, b.level).par - standardOf(ctx.standards, a.level).par,
  );
  return keepHomeOrg(sorted, cfg.fallback.max_offers);
}

/**
 * 取前 n 筆，但**母國體系永遠佔得到一格**。
 *
 * 排序是依落地層級的 par 由高到低，母國因此是最容易被切掉的那一個——中職一軍
 * 的 par 44 低於墨聯 45、韓職 46、日職 47。扣掉現在所在的體系還有五個候選，
 * `max_offers` 4 剛好會把它擠出去。
 *
 * 但落葉歸根不是「第五好的選項」，它是那條**永遠在的**退路：能被下放的人理論
 * 上進得了中職，而「回台灣先發」對一段生涯的意義不是 par 排得出來的。同樣的
 * 道理已經寫在 `topLevelOnly` 上（不比水準高低，只問哪裡有一軍的位置），這裡
 * 是它的延伸——排序仍然用 par，但不讓 par 把家的門關上。
 *
 * 母國沒有進到名單裡（能力不夠、被 `minPar` 濾掉、或人就在母國）時什麼都不做。
 */
function keepHomeOrg(
  sorted: readonly TransferOffer[],
  limit: number,
): readonly TransferOffer[] {
  const head = sorted.slice(0, limit);
  if (limit <= 0) return head;
  if (head.some((o) => o.org === cfg.home_org.value)) return head;
  const home = sorted.find((o) => o.org === cfg.home_org.value);
  if (home === undefined) return head;
  // 擠掉 par 最低的那一個——它排在最後。
  return [...head.slice(0, limit - 1), home];
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
  /** 各體系的累計年資。日職在籍八年之後不再算外籍。 */
  readonly servedYears?: ServedYears;
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

  const served = servedIn(ctx.servedYears, target);
  const level = landingLevel(target, ctx.overall, ctx.standards, served);
  if (level === null || leagues.levels[level]?.top === undefined) return [];

  const overBar = ctx.overall - topLandingBar(target, ctx.standards, served);
  if (roll >= ageGate(target, ctx.age, overBar) * 100) return [];

  const table = tableFor(world, target, new Map());
  const bids: TransferOffer[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const team = pickTeam(world, target, null);
    if (team === null || used.has(team)) continue;
    used.add(team);
    const odds = championshipOdds(table, team);
    bids.push({
      org: target,
      orgName: orgLabel(target),
      level,
      levelName: leagues.levels[level]?.name ?? level,
      team,
      bonus: signingBonus(target, overBar, odds),
      homecoming: ctx.playedOrgs.has(target),
      odds,
      years: contractLength(odds),
      table,
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
 * 高中畢業時的旅外報價。
 *
 * **這是選秀之外的另一個出口**：不經過選秀，直接與海外球團簽育成／國際業餘
 * 合約，從對方體系的低階層級出發。移植自 legacy 的「高中畢業 · 人生的第一個
 * 路口」。
 *
 * 門檻看的是綜合能力的**絕對值**，不是相對聯盟的 d 值——十八歲的業餘球員沒有
 * 所屬聯盟可以相對。落地層級也寫死在資料裡，不走 `landingLevel()`：那條規則
 * 問的是「他現在打得動哪一層」，而育成合約問的是「他值不值得養」，十八歲的人
 * 本來就打不動一軍，那不是拒絕他的理由。
 */
export function amateurOverseasOffers(
  world: World,
  overall: number,
): readonly (TransferOffer & { readonly label: string; readonly note: string })[] {
  const cfg = amateur.amateur_overseas;
  const out: (TransferOffer & { label: string; note: string })[] = [];
  const tables: TableCache = new Map();

  for (const path of cfg.paths) {
    // 抽取一律先做，與資格無關——否則差一分就會讓後面所有判定整串偏移。
    const count = world.stream('career').int(cfg.offers.min, cfg.offers.max);
    if (overall < path.min_overall) continue;

    const upgrade = path.level_upgrade;
    const level =
      upgrade !== undefined && overall >= upgrade.min_overall ? upgrade.level : path.level;
    const base =
      path.signing_bonus.base +
      Math.max(0, overall - path.min_overall) * path.signing_bonus.per_point_over;

    const table = tableFor(world, path.org, tables);
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const team = pickTeam(world, path.org, null);
      if (team === null || used.has(team)) continue;
      used.add(team);
      // 育成合約也吃球隊處境：正在爭冠的球團補起未來也捨得花錢。
      const odds = championshipOdds(table, team);
      out.push({
        org: path.org,
        orgName: orgLabel(path.org),
        level,
        levelName: leagues.levels[level]?.name ?? level,
        team,
        bonus: Math.round(base * contentionBonusMult(odds)),
        homecoming: false,
        odds,
        years: contractLength(odds),
        table,
        label: path.label,
        note: path.note,
      });
    }
  }
  return out;
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
