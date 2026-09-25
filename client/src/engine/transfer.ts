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
import { leagueStandardOf, personalStandardOf, type LeagueStandards } from './league.ts';
import type { HandednessTier } from './handedness.ts';
import { pathOf } from './pro.ts';
import type { World } from './rng.ts';
import { salaryFor } from './salary.ts';
import { averageChampionshipOdds, championshipOdds, initLeague, type LeagueTable } from './teams.ts';

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
  /**
   * 是不是**回到**曾經效力過的體系。落葉歸根的敘述要看它。
   *
   * 單位是體系不是聯盟：待過 1A 之後被 3A 找上不算回鄉，那從頭到尾都是同一個
   * 體系；離開美職幾年之後再收到 3A 的邀約才算。人還在這個體系裡的時候一律
   * 為 false——沒離開過就沒有回來這回事。
   */
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

/**
 * 這個體系的中文名。**這裡要的是體系，不是體系裡最高的那一層。**
 *
 * 轉會的句子講的是「你在哪個體系」——2A 的球員收到留隊詢問時，「留在旅美」是對
 * 的，「留在大聯盟」是假的。所以先查 `org_names`（旅日／旅美），沒有才退回最高
 * 層級的名字（韓職、墨聯、澳職這種單一聯盟的體系兩者本來就同名）。
 *
 * 獎項與里程碑的前綴走的是另一條路（見 career.ts 的 orgNameOf）：那裡的成績只在
 * 頂級聯盟才拿得到，冠的就該是「大聯盟」。
 */
export function orgLabel(org: string): string {
  return leagues.org_names[org] ?? leagues.top_league_names[org] ?? org;
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
    if (age > tier.max_age) continue;
    // **窗口之內再加一道能力加成。** 這取代了舊的「怪物條款」——那一條是關窗之後
    // 給一個固定的小機率，既分辨不出 35 歲與 45 歲，也分辨不出超出門檻 5 分與 20
    // 分。改成連續的加成之後，34 歲而能力超出門檻 10 分的人是 15% + 30% = 45%。
    const bonus = (window.per_over_landing_bar ?? 0) * Math.max(0, overLandingBar);
    return Math.min(window.max ?? 1, tier.value + bonus);
  }

  // 窗口之外是硬關：加成不適用。年紀到了就是到了。
  return window.default;
}

/**
 * 這個能力在這個體系落得到哪一層。
 *
 * 取能力達得到門檻（`landingBar`）的**最高**層級——被挖角不代表到了那邊
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
  tier: HandednessTier = 'none',
): string | null {
  let best: string | null = null;
  // pathOf 由低到高，因此最後一個達標的就是最高的那一層。
  // 簽不簽得下是關卡，吃個人尺——見 CONTEXT.md「個人尺 / 聯盟真尺」。
  for (const level of pathOf(org)) {
    if (overall >= landingBar(org, level, standards, servedYears, approach, tier)) best = level;
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
 * 加成本身逐體系寫在 `leagues.json`（日職、韓職 2，其餘 0——大聯盟沒有外籍
 * 名額，墨聯與澳職是退路聯盟）。三種情況不吃：
 *
 * - **回母國。** 外籍加成的理由是「名額有限，球團得證明簽這個人比用本地人
 *   好」，對本地人不成立——一個在日職待不下去的台灣球員回中職，他就是個中職
 *   球員，不必比本地人強。
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
  const spec = orgConfig(org);
  const threshold = spec?.domestic_after_years;
  if (threshold !== undefined && servedYears >= threshold) return 0;
  return spec?.import_premium ?? 0;
}

/**
 * 落在某一層需要的能力。
 *
 * - **球團主動**：該層的 par——跨海挖人，挖的是上得了場的人。一軍再加外籍加成
 *   （名額只限一軍，二軍與小聯盟不分國籍）。
 * - **自己找上門，或退路聯盟**：該層的 min，不加任何東西（ADR 0012）。墨聯與澳職
 *   收的是掉下來的人，球團不是在挑人。
 *
 * 落地看 par、每年留任看 min（見 `evaluateMovement`），中間的三分讓剛簽進來的人
 * 不會隔年一退步就被擠下去。
 */
function landingBar(
  org: string,
  level: string,
  standards: LeagueStandards | null,
  servedYears: number,
  approach: Approach,
  tier: HandednessTier,
): number {
  const standard = personalStandardOf(standards, level, tier);
  if (approach === 'seek' || orgConfig(org)?.fallback_league === true) return standard.min;
  const top = leagues.levels[level]?.top !== undefined;
  return standard.par + (top ? importPremium(org, servedYears, approach) : 0);
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
  tier: HandednessTier = 'none',
): number {
  const path = pathOf(org);
  const top = path[path.length - 1] ?? '';
  // 與 landingLevel 走同一條門檻——先前這裡寫死 import_premium，回母國時門檻
  // 因此被高估四分，簽約金與怪物條款都連帶算錯。
  return landingBar(org, top, standards, servedYears, approach, tier);
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
  return leagueStandardOf(standards, path[path.length - 1] ?? '').par;
}

/**
 * 值不值得為這份報價動身。
 *
 * **只有平移與下降需要加薪。** 往更強的聯盟去本來就可能先減薪換舞台——中職
 * 球員被大聯盟看上、落地 3A 領小聯盟薪水，那是真實會發生也應該發生的事。
 * 但韓職來挖一個正在日職打球的人卻不加薪，那在現實裡不會發生。
 *
 * 平移與下降要過**兩關，而且是兩種不同的錢**：
 *
 * 1. **年薪**要比現在高出 `min_raise`。跨聯盟移動伴隨語言、家庭與適應成本，
 *    薪水只是打平的話沒有人會走。
 * 2. **簽約金**不能比留在原體系少。這一關是後來補的：年薪那一關只看得到
 *    `salaryFor`，而它吃的是落地層級的 d——一個大聯盟中等水準的球員在日職一軍
 *    是 d +9，年薪投影因此輕鬆過關，可是報價單上寫的是簽約金，而日職的簽約金
 *    表整整比大聯盟小一截。於是玩家在大聯盟看到日職與韓職的邀請，錢還更少。
 *    **要來挖一個在更強的體系站穩的人，錢就得真的更多。**
 *
 * 簽約金比的是**不含球隊處境倍率的底價**：那個倍率是逐隊的運氣，不該決定一個
 * 體系提不提得出口。
 *
 * 目前年薪是 0（還沒領過薪水的年份）時年薪那一關一律放行——那不是加薪不足，
 * 是沒有東西可以比。
 */
function worthMoving(org: string, level: string, overBar: number, ctx: ScoutContext): boolean {
  if (orgPar(org, ctx.standards) > orgPar(ctx.currentOrg, ctx.standards)) return true;

  if (ctx.salary > 0) {
    const projected = salaryFor(
      level,
      ctx.overall - personalStandardOf(ctx.standards, level, ctx.tier).par,
    );
    if (projected < ctx.salary * cfg.scouting.min_raise) return false;
  }

  const hereBar = topLandingBar(
    ctx.currentOrg,
    ctx.standards,
    servedIn(ctx.servedYears, ctx.currentOrg),
    'recruit',
    ctx.tier,
  );
  return baseSigningBonus(org, overBar) >= baseSigningBonus(ctx.currentOrg, ctx.overall - hereBar);
}

/**
 * 一支球隊的處境：它的奪冠機率，以及**它所在聯盟的平均**。
 *
 * 兩個數字要一起帶。條件看的是「這支球隊比聯盟裡一般的球隊更接近冠軍嗎」，而
 * 那個「一般」是隊數的倒數——拿一個寫死的常數去比，六隊的中職會變成每一支都
 * 在爭冠、三十隊的大聯盟會變成每一支都在重建。
 */
interface Contention {
  readonly odds: number;
  readonly reference: number;
}

function contentionOf(table: LeagueTable, team: string): Contention {
  return { odds: championshipOdds(table, team), reference: averageChampionshipOdds(table) };
}

/** 簽約金：體系的基礎金額加上 d 值的加給，再乘上球隊處境的倍率。 */
function signingBonus(org: string, d: number, at: Contention): number {
  return Math.round(baseSigningBonus(org, d) * contentionBonusMult(at));
}

/** 簽約金的底價：不含球隊處境的倍率。體系之間要比的是這個。 */
function baseSigningBonus(org: string, d: number): number {
  const spec = orgConfig(org)?.signing_bonus;
  if (spec === undefined) return 0;
  return spec.base + Math.max(0, d) * spec.per_d;
}

/**
 * 球隊處境對簽約金的倍率。
 *
 * **爭冠的球隊願意砸錢**——他們的窗口就這一兩年，一個補進來的即戰力值多少
 * 錢是用「今年能不能拿下來」算的，不是用市場行情算的。
 */
function contentionBonusMult(at: Contention): number {
  const c = cfg.contention;
  const raw = 1 + (at.odds - at.reference) * c.bonus.per_odds;
  return clamp(raw, c.bonus.min, c.bonus.max);
}

/**
 * 這支球隊願意給幾年。
 *
 * **符號是反的，這是刻意的。** 爭冠球隊砸錢但給短約：他們買的是今年。重建
 * 球隊給不起大錢，卻敢給年限——他們賭的是三年後你還在，而那時候他們正好起來。
 * 於是「錢多」與「約長」變成兩個要取捨的東西，而不是同一件事的兩種說法。
 */
function contractLength(at: Contention): number {
  const c = cfg.contention;
  const base = season.contract.rookie_contract.years;
  const delta = clamp(
    Math.round((at.reference - at.odds) * c.years.per_odds),
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

/**
 * 落葉歸根：待過、而且**現在不在**那裡。
 *
 * 「現在不在」這一條是必要的——同一個體系裡換層級（1A 升 3A）會讓
 * `playedOrgs.has()` 為真，但那不是回鄉，人根本沒走。
 */
function homecomingTo(
  playedOrgs: ReadonlySet<string>,
  currentOrg: string | null,
  org: string,
): boolean {
  return org !== currentOrg && playedOrgs.has(org);
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
  /** 慣用手檔次。簽約是關卡，門檻與待遇都吃他自己的那把尺。 */
  readonly tier: HandednessTier;
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
    // 機率是 0 的體系（沒買〈國際認證〉第 3 階的墨聯、澳職）連骰子都不擲。
    if (spec === undefined || !spec.scouts || (spec.scout_chance ?? 0) <= 0) continue;
    if (org === ctx.currentOrg) continue;
    // 滿了就不再擲。宣告順序讓墨聯、澳職排在最後。
    if (out.length >= cfg.scouting.max_offers) break;

    // 資格：能力、上季表現、年齡窗口。三者缺一不可。
    const minOverall = spec.scout_min_overall ?? Number.POSITIVE_INFINITY;
    const served = servedIn(ctx.servedYears, org);
    const level = landingLevel(org, ctx.overall, ctx.standards, served, 'recruit', ctx.tier);
    const overBar = ctx.overall - topLandingBar(org, ctx.standards, served, 'recruit', ctx.tier);
    const gate = ageGate(org, ctx.age, overBar);

    // 機率一律先抽，不管有沒有資格——抽取次數必須與資格無關，否則同一個種子
    // 會因為某年差一分而讓後面所有判定整串偏移。
    const roll = rng.next() * 100;
    const chance = (spec.scout_chance ?? 0) * gate;

    if (level === null) continue;
    if (ctx.overall < minOverall) continue;
    if (ctx.lastWinPct < cfg.scouting.min_win_pct.value) continue;
    if (roll >= chance) continue;
    // **挖角必須加薪，而且兩種錢都要。** 年薪要比現在高出 min_raise，簽約金
    // 也不能比留在原體系少——往下走的人得看到真的更多的錢才會動身。
    if (!worthMoving(org, level, overBar, ctx)) continue;

    const table = tableFor(world, org, tables);
    const count = rng.int(cfg.scouting.offers_per_org.min, cfg.scouting.offers_per_org.max);
    const used = new Set<string>();
    for (let i = 0; i < count && out.length < cfg.scouting.max_offers; i++) {
      const team = pickTeam(world, org, null);
      if (team === null || used.has(team)) continue;
      used.add(team);
      const at = contentionOf(table, team);
    const odds = at.odds;
      out.push({
        org,
        orgName: orgLabel(org),
        level,
        levelName: leagues.levels[level]?.name ?? level,
        team,
        bonus: signingBonus(org, overBar, at),
        homecoming: homecomingTo(ctx.playedOrgs, ctx.currentOrg, org),
        odds,
        years: contractLength(at),
        table,
      });
    }
  }

  // 依落地層級的水準由高到低——玩家評估報價時看的就是「哪個舞台比較高」，
  // 資料的宣告順序對他沒有意義。同一個體系的兩份報價維持抽出來的順序。
  return out.sort(
    (a, b) => leagueStandardOf(ctx.standards, b.level).par - leagueStandardOf(ctx.standards, a.level).par,
  );
}

export interface FallbackContext {
  readonly overall: number;
  readonly currentOrg: string;
  readonly currentTeam: string;
  readonly playedOrgs: ReadonlySet<string>;
  readonly standards: LeagueStandards | null;
  /** 慣用手檔次。簽約是關卡，門檻與待遇都吃他自己的那把尺。 */
  readonly tier: HandednessTier;
  /**
   * 落地層級的水準下限。低於它的報價不列出。
   *
   * 這一項區分了兩種很不一樣的處境：
   *
   * - **被釋出**時不設下限——你已經沒有球隊了，有人要就不錯了。
   * - **自己跳出合約**測試自由市場時也不設下限：那是玩家自己選的路，墨聯與澳職
   *   本來就該是桌上的選項——設了下限的話，從大聯盟出來的人一輩子選不到它們。
   * - 其餘被動的報價（球團上門挖角）照舊只列不比現在差的舞台。
   */
  readonly minPar?: number;
  /** 最多列幾筆。省略時照 `fallback.max_offers`；自由市場要全部攤開。 */
  readonly limit?: number;
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
    const level = landingLevel(org, ctx.overall, ctx.standards, served, approach, ctx.tier);
    if (level === null) continue;
    if (ctx.topLevelOnly === true && leagues.levels[level]?.top === undefined) continue;
    if (ctx.minPar !== undefined && leagueStandardOf(ctx.standards, level).par < ctx.minPar) continue;

    const table = tableFor(world, org, tables);
    // 同一個聯盟可以有 1～2 隊來問，跟挖角同一個範圍（2026-09-25，以前只有 1 隊）。
    const count = world.stream('career').int(cfg.scouting.offers_per_org.min, cfg.scouting.offers_per_org.max);
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const team = pickTeam(world, org, null);
      if (team === null || used.has(team)) continue;
      used.add(team);
      const at = contentionOf(table, team);
      const odds = at.odds;

      out.push({
        org,
        orgName: orgLabel(org),
        level,
        levelName: leagues.levels[level]?.name ?? level,
        team,
        bonus: signingBonus(
          org,
          ctx.overall - topLandingBar(org, ctx.standards, served, approach, ctx.tier),
          at,
        ),
        homecoming: homecomingTo(ctx.playedOrgs, ctx.currentOrg, org),
        odds,
        years: contractLength(at),
        table,
      });
    }
  }

  const sorted = out.sort(
    (a, b) => leagueStandardOf(ctx.standards, b.level).par - leagueStandardOf(ctx.standards, a.level).par,
  );
  // 自由市場要的是整份名單——它會跟同聯盟的報價併在一起再挑（見 curateOffers）。
  if (ctx.limit === Number.POSITIVE_INFINITY) return sorted;
  return curateOffers(world, sorted, cfg.home_org.value, ctx.standards, ctx.limit ?? cfg.fallback.max_offers);
}

/**
 * 從一份報價名單裡挑出要擺上桌的那幾筆。
 *
 * **每個聯盟最多一筆、總共最多 `limit` 筆**，而且有兩格是保留的：
 *
 * - **錨點聯盟**一定有一格（有它的報價的話）。自由市場的錨點是現在所在的聯盟——
 *   合約到期卻只剩海外球團打電話，那不叫自由球員；下放與釋出時錨點是母國（落葉
 *   歸根是那條永遠在的退路，不是「第五好的選項」）。
 * - **最強的那個聯盟**一定有一格：符合報價標準的最高舞台不能被抽籤抽掉。
 *
 * 其餘的格子**隨機抽**，不再依強弱排——依強弱排的話，名單一長墨聯與澳職就永遠
 * 排不上，從大聯盟出來的人一輩子選不到它們。錨點本身就是最強的那個時，剩下的
 * 全部隨機。擺上桌的順序仍然由強到弱，讀起來比較好比。
 */
export function curateOffers<T extends { readonly org: string; readonly level: string }>(
  world: World,
  offers: readonly T[],
  anchorOrg: string,
  standards: LeagueStandards | null,
  limit: number = cfg.fallback.max_offers,
): readonly T[] {
  const parOf = (o: T) => leagueStandardOf(standards, o.level).par;
  // 每個聯盟最多留 per_org 筆：同聯盟裡層級高的優先（同一層就取先到的）。以前只留
  // 一筆、最多 4 隊（2026-09-25 改成 2 筆、6 隊）。
  const perOrg = new Map<string, T[]>();
  for (const o of offers) {
    const list = perOrg.get(o.org) ?? [];
    list.push(o);
    perOrg.set(o.org, list);
  }
  for (const [org, list] of perOrg) {
    perOrg.set(org, [...list].sort((a, b) => parOf(b) - parOf(a)).slice(0, cfg.fallback.per_org));
  }
  const pool = [...perOrg.values()].flat();
  if (pool.length === 0 || limit <= 0) return [];

  const picked: T[] = [];
  const take = (o: T | undefined) => {
    if (o !== undefined && !picked.includes(o) && picked.length < limit) picked.push(o);
  };
  take(perOrg.get(anchorOrg)?.[0]);
  take([...pool].sort((a, b) => parOf(b) - parOf(a))[0]);
  const rest = world.stream('career').shuffle(pool.filter((o) => !picked.includes(o)));
  for (const o of rest) take(o);
  return picked.sort((a, b) => parOf(b) - parOf(a));
}

/** 上下文：自由球員在**自己這個體系**裡的市場。 */
export interface DomesticFaContext {
  readonly org: string;
  /** 目前的層級。同體系的報價一律開在這一層——FA 只在頂級聯盟發生。 */
  readonly level: string;
  readonly currentTeam: string;
  readonly overall: number;
  /** 相對聯盟的水準（綜合能力 − 聯盟 par）。有幾支球隊上門看它。 */
  readonly d: number;
  readonly standards: LeagueStandards | null;
  readonly tier: HandednessTier;
  /**
   * 該體系當季的戰力表。
   *
   * **由呼叫端傳進來，不在這裡重抽。** 人還待在這個聯盟裡，格局已經是既成
   * 事實——重抽等於讓同一年的同一個聯盟在報價單上與記分板上長成兩個樣子。
   */
  readonly table: LeagueTable;
}

/** 今年有幾支同體系的球隊上門。由高到低取第一個符合的 d 值級距。 */
function suitorSpec(d: number) {
  for (const tier of cfg.free_agency.suitors.tiers) {
    if (d >= tier.min_d) return tier;
  }
  return cfg.free_agency.suitors.default;
}

/**
 * 自由球員的國內市場：**同體系的其他球隊**。
 *
 * 合約到期卻只有海外球團打電話來，那不叫自由球員，那叫被迫出走。同聯盟的
 * 競爭對手本來就是 FA 市場的主體——他們看了你三年，最清楚你打得怎麼樣，也
 * 最不必賭。
 *
 * 與跨體系那一半（`fallbackOffers`）的差別在**問的問題不同**：跨體系問「哪裡
 * 收得下你」，要過落地門檻；同體系問「誰想要你」，門檻你早就過了——人就在
 * 那一層打球。因此這裡唯一的旋鈕是**有幾支球隊上門**，而它看 d 值。
 *
 * 落地層級不動、體系不動，因此簽下去**不算換體系**：服務年資與掌控期的帳都
 * 照舊，只有球衣換了。
 */
export function domesticFaOffers(
  world: World,
  ctx: DomesticFaContext,
): readonly TransferOffer[] {
  const rng = world.stream('career');
  const spec = suitorSpec(ctx.d);

  // 抽取一律先做，與結果無關——少抽一次會讓後面所有判定整串偏移。
  const asked = rng.chance(spec.chance ?? 100);
  const count = rng.int(spec.min, spec.max);
  if (!asked) return [];

  const pool = (teamsData.leagues[ctx.org] ?? [])
    .map((t) => t.name)
    .filter((name) => name !== ctx.currentTeam);
  if (pool.length === 0) return [];

  const picked = rng.shuffle(pool).slice(0, Math.min(count, pool.length));
  const bar = personalStandardOf(ctx.standards, ctx.level, ctx.tier).min;
  const levelName = leagues.levels[ctx.level]?.name ?? ctx.level;

  return picked.map((team) => {
    const at = contentionOf(ctx.table, team);
    const odds = at.odds;
    return {
      org: ctx.org,
      orgName: orgLabel(ctx.org),
      level: ctx.level,
      levelName,
      team,
      bonus: signingBonus(ctx.org, ctx.overall - bar, at),
      // 沒離開過就沒有回來這回事——同體系內換隊永遠不是落葉歸根。
      homecoming: false,
      odds,
      years: contractLength(at),
      table: ctx.table,
    };
  });
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
  readonly tier: HandednessTier;
}): boolean {
  const target = postingTarget(options.org);
  if (target === null) return false;
  const level = landingLevel(target, options.overall, options.standards, 0, 'recruit', options.tier);
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
  /** **目前**所屬體系。入札與海外 FA 都是從這裡出去的。 */
  readonly org: string;
  readonly overall: number;
  readonly age: number;
  readonly playedOrgs: ReadonlySet<string>;
  readonly standards: LeagueStandards | null;
  /** 慣用手檔次。簽約是關卡，門檻與待遇都吃他自己的那把尺。 */
  readonly tier: HandednessTier;
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
  const level = landingLevel(target, ctx.overall, ctx.standards, served, 'recruit', ctx.tier);
  if (level === null || leagues.levels[level]?.top === undefined) return [];

  const overBar = ctx.overall - topLandingBar(target, ctx.standards, served, 'recruit', ctx.tier);
  if (roll >= overseasBidChance(ctx) * 100) return [];

  const table = tableFor(world, target, new Map());
  const bids: TransferOffer[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const team = pickTeam(world, target, null);
    if (team === null || used.has(team)) continue;
    used.add(team);
    const at = contentionOf(table, team);
    const odds = at.odds;
    bids.push({
      org: target,
      orgName: orgLabel(target),
      level,
      levelName: leagues.levels[level]?.name ?? level,
      team,
      bonus: signingBonus(target, overBar, at),
      homecoming: homecomingTo(ctx.playedOrgs, ctx.org, target),
      odds,
      years: contractLength(at),
      table,
    });
  }
  return bids;
}

/**
 * 目標體系會不會有人出價，0 到 1。
 *
 * **問得到的人才問。** 入札的流程是「球員申請 → 母隊同意 → 球團出價」，而年齡
 * 窗口管的是最後那一關。窗口硬關之後這個數字是 0——那時候不該再跳出「要不要
 * 申請入札」，那一問的每一個答案都通往同一個結果。
 *
 * 「點頭了卻沒有人出手」仍然存在，而且仍然該存在：那是機率落空，不是規則擋下。
 * 這裡擋的只有規則那一半。
 */
export function overseasBidChance(ctx: OverseasContext): number {
  const target = postingTarget(ctx.org);
  if (target === null) return 0;
  const served = servedIn(ctx.servedYears, target);
  const level = landingLevel(target, ctx.overall, ctx.standards, served, 'recruit', ctx.tier);
  if (level === null || leagues.levels[level]?.top === undefined) return 0;
  const overBar = ctx.overall - topLandingBar(target, ctx.standards, served, 'recruit', ctx.tier);
  return ageGate(target, ctx.age, overBar);
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
 * 所屬聯盟可以相對。
 *
 * **落地層級是地板與實力取高。** 資料裡的 `level` 是地板：育成合約問的是「他
 * 值不值得養」，十八歲的人本來就打不動一軍，那不是拒絕他的理由。但能力夠的人
 * 不必從最底層磨——`landingLevel()` 問的是「他現在打得動哪一層」，而且吃外籍
 * 加成（海外球團簽的是外籍球員），兩者取高：打得動 3A 就從 3A 出發、打得動日職
 * 一軍就直接上一軍。
 */
export function amateurOverseasOffers(
  world: World,
  overall: number,
  standards: LeagueStandards | null = null,
  tier: HandednessTier = 'none',
  age: number = amateur.amateur_overseas.age_penalty.from_age,
): readonly (TransferOffer & { readonly label: string; readonly note: string })[] {
  const cfg = amateur.amateur_overseas;
  // 大學生旅外：年紀越大門檻越高、簽約金越少。高中畢業的年齡不扣。
  const yearsOver = Math.max(0, age - cfg.age_penalty.from_age);
  const gateRaise = Math.floor(yearsOver / cfg.age_penalty.years_per_point);
  const out: (TransferOffer & { label: string; note: string })[] = [];
  const tables: TableCache = new Map();

  for (const path of cfg.paths) {
    // 抽取一律先做，與資格無關——否則差一分就會讓後面所有判定整串偏移。
    const count = world.stream('career').int(cfg.offers.min, cfg.offers.max);
    const minOverall = path.min_overall + gateRaise;
    if (overall < minOverall) continue;

    const level = higherLevel(
      path.org,
      path.level,
      landingLevel(path.org, overall, standards, 0, 'recruit', tier),
    );
    const cut = cfg.age_penalty.by_org[path.org];
    const floor =
      cut === undefined
        ? path.signing_bonus.base
        : Math.max(cut.min_bonus, path.signing_bonus.base - cut.bonus_per_year * yearsOver);
    const base = floor + Math.max(0, overall - path.min_overall) * path.signing_bonus.per_point_over;

    const table = tableFor(world, path.org, tables);
    const used = new Set<string>();
    for (let i = 0; i < count; i++) {
      const team = pickTeam(world, path.org, null);
      if (team === null || used.has(team)) continue;
      used.add(team);
      // 育成合約也吃球隊處境：正在爭冠的球團補起未來也捨得花錢。
      const at = contentionOf(table, team);
    const odds = at.odds;
      out.push({
        org: path.org,
        orgName: orgLabel(path.org),
        level,
        levelName: leagues.levels[level]?.name ?? level,
        team,
        bonus: Math.round(base * contentionBonusMult(at)),
        homecoming: false,
        odds,
        years: contractLength(at),
        table,
        label: path.label,
        note: path.note,
      });
    }
  }
  return out;
}

/** 同一個體系裡兩個層級取高。`null` 代表「哪一層都站不上」，那就是地板。 */
function higherLevel(org: string, floor: string, candidate: string | null): string {
  if (candidate === null) return floor;
  const path = pathOf(org);
  return path.indexOf(candidate) > path.indexOf(floor) ? candidate : floor;
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
