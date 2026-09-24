/**
 * 感情的一年：**一台步驟機**。
 *
 * 這條線與棒球那些一算到底的規則不同——它中間夾著玩家的決定，而那些決定會改變
 * 後面的走向。所以它不是一個純函式，是一個 generator：每走到一個決定點就
 * `yield` 出「這一步是什麼」，等驅動端把玩家選的**選項 id** 送回來再往下走。
 *
 * ## 誰擁有什麼
 *
 * **這裡擁有**：一年的順序、每一道守衛、`LoveState` 的所有變更、感情的所有抽取，
 * 以及**選項 id**——那些 id 會寫進重播日誌，它們是協定，不是文案（ADR 0002）。
 *
 * **驅動端（`game.ts`）擁有**：卡片與選項的文字（ADR 0025 的分工），以及把
 * `effects` 兌現成能力、金錢、特性與榮銜——感情不必認識能力表、蓄力槽與硬上限。
 *
 * ## 為什麼順序是承重的
 *
 * 「被抓到之後那一年就結束了」這種守衛，是這一區真正的 bug 種類：沒有它，同一年
 * 會出現「劈腿曝光、她提分手」然後立刻「要不要求婚」，對著一個已經走了的人跪下
 * 去。它從前散在 `game.ts` 的四個私有方法裡、一條測試都碰不到；在這裡它是可以
 * 直接跑的程式（見 [ADR 0050](../../../docs/adr/0050-domains-that-ask-the-player-are-step-machines.md)）。
 *
 * **抽取一律在這裡發生、位置不動**：驅動端在收到步驟的當下兌現 effects，所以它
 * 那幾次抽取（隨機挑一項能力）仍落在原本的位置上。
 */

import { love as cfg, type AbilityKey } from '../data/index.ts';
import {
  afterBreakup,
  alimony,
  breakupChance,
  cadenceChance,
  canPropose,
  childbirthChance,
  confessionChance,
  divorceCost,
  earnsConfidante,
  hasPartner,
  isChildhoodSweetheart,
  partnerBonusKeys,
  partnerOf,
  partnerTier,
  pickPartner,
  recordSpouse,
  turmoilChance,
  type LoveState,
} from './love.ts';
import type { World } from './rng.ts';

/**
 * 一步的副作用：**感情只說意圖，兌現在驅動端**。
 *
 * 感情不該認識蓄力槽、硬上限與「這一側的能力有哪些」。它說的是「給接觸 +1」或
 * 「隨機扣一項 3 點」，怎麼落地是 `game.ts` 的事。
 */
export type LoveEffect =
  /**
   * 當季暫時能力，加在對象側寫的兩項之一。點數可以是負的（縮頭烏龜每年倒扣）。
   * 挑哪一項由驅動端抽：只抽球員在用那一側的（issue #15）。
   */
  | { readonly kind: 'bonus'; readonly choices: readonly AbilityKey[]; readonly points: number }
  /** 隨機挑一項在用的能力加當季狀態。挑哪一項由驅動端抽——它才知道哪些在用。 */
  | { readonly kind: 'bonus-random'; readonly points: number }
  /** 隨機扣一項在用的能力。 */
  | { readonly kind: 'ability-loss'; readonly points: number }
  /** 全能力重扣（花樣年華）。 */
  | { readonly kind: 'all-ability-loss'; readonly points: number }
  /** 金錢。正的是收（贍養費），負的是付（財產分配、安家費）。 */
  | { readonly kind: 'money'; readonly amount: number }
  /** 解鎖一個隱藏特性。 */
  | { readonly kind: 'trait'; readonly id: string }
  /** 記一筆榮銜。 */
  | { readonly kind: 'honor'; readonly name: string };

/** 分手／離婚的由來。驅動端照它挑那句話。 */
export type BreakupReason =
  | { readonly id: 'waited-too-long'; readonly years: number }
  | { readonly id: 'turmoil-leave'; readonly kindId: string }
  | { readonly id: 'apology-failed' }
  | { readonly id: 'accept' }
  | { readonly id: 'cuckold-exit' }
  | { readonly id: 'overseas-end' }
  | { readonly id: 'checkpoint'; readonly label: string };

/** 平淡那一年的六種樣子。 */
export type FlavourVariant = 'cuckold' | 'harem' | 'married-kids' | 'married' | 'school' | 'pro';

/**
 * 只報告發生了什麼，不必回答。
 *
 * `effects` 在敘事**之前**兌現（扣的點數要寫進同一張卡片裡），`after` 在**之後**
 * ——特性解鎖自己會發一張卡，而它該排在婚禮或分手那張卡的後面。
 */
export type LoveTell = {
  readonly kind: 'tell';
  readonly effects: readonly LoveEffect[];
  readonly after: readonly LoveEffect[];
} & (
  | { readonly id: 'confess-skipped' }
  | { readonly id: 'confess-rejected'; readonly partner: string }
  | { readonly id: 'scandal'; readonly partner: string; readonly divorced: boolean }
  | { readonly id: 'scandal-faded' }
  | { readonly id: 'scandal-denied' }
  | { readonly id: 'dating-started'; readonly partner: string; readonly fromSchool: boolean }
  | { readonly id: 'proposal-later' }
  | { readonly id: 'wedding'; readonly partner: string; readonly partner2: string | null }
  | { readonly id: 'childbirth'; readonly partner: string; readonly nth: number; readonly total: number }
  | { readonly id: 'turmoil-swallow'; readonly kindId: string; readonly cracks: number }
  | { readonly id: 'cuckold'; readonly kindId: string }
  | { readonly id: 'harem'; readonly partner: string; readonly other: string; readonly married: boolean }
  | { readonly id: 'affair-declined' }
  | { readonly id: 'affair-escaped'; readonly married: boolean }
  | { readonly id: 'affair-caught'; readonly married: boolean; readonly scum: boolean }
  | { readonly id: 'apology-accepted'; readonly partner: string }
  | {
      readonly id: 'breakup';
      readonly reason: BreakupReason;
      readonly ex: string;
      readonly ex2: string | null;
      readonly wasMarried: boolean;
      readonly kids: number;
      /** 財產分配的金額。正的是你收到（縮頭烏龜的贍養費），負的是你付出去。 */
      readonly money: number;
    }
  | { readonly id: 'flavour'; readonly variant: FlavourVariant; readonly partner: string; readonly partner2: string | null }
  | { readonly id: 'overseas-bring'; readonly cost: number }
  | { readonly id: 'overseas-apart' }
);

/** 要玩家回答的一步。`options` 是選項 id，順序就是顯示順序。 */
export type LoveAsk = { readonly kind: 'ask'; readonly options: readonly string[] } & (
  | { readonly id: 'confess'; readonly partner: string; readonly chance: number; readonly rank: string | null }
  | { readonly id: 'public-confirm'; readonly partner: string }
  | { readonly id: 'proposal'; readonly partner: string; readonly partner2: string | null; readonly years: number }
  | { readonly id: 'turmoil'; readonly kindId: string; readonly openable: boolean }
  | { readonly id: 'affair'; readonly other: string; readonly married: boolean }
  | { readonly id: 'caught'; readonly other: string; readonly married: boolean; readonly openable: boolean }
  | { readonly id: 'overseas'; readonly orgName: string; readonly partner: string; readonly cost: number }
);

export type LoveStep = LoveTell | LoveAsk;

/** 步驟機：`yield` 出一步，`next(選項 id)` 送回答案。 */
export type LoveFlow = Generator<LoveStep, void, string>;

/** 這一年感情之外的事實。感情看得到它們，但不會去改它們。 */
export interface LoveYearContext {
  readonly age: number;
  readonly year: number;
  readonly pro: boolean;
  /** 今年最好的大賽名次。校園告白的成功率看它。 */
  readonly bestRank: string | null;
  /** 生涯總收入。離婚分財產與旅外安家費按比例從它切。 */
  readonly earnings: number;
}

/**
 * 兩個小工具，只為了讓每一步寫起來像一句話。
 *
 * 泛型不是裝飾：`LoveStep` 是一個聯集，`Omit<聯集>` 會把各分支的欄位壓成交集，
 * 於是 `partner` 那種只屬於某幾步的欄位會被判成「不存在的屬性」。
 */
const tell = <T extends { readonly id: LoveTell['id'] }>(
  step: T & { effects?: readonly LoveEffect[]; after?: readonly LoveEffect[] },
): LoveTell => ({ kind: 'tell', effects: [], after: [], ...step }) as unknown as LoveTell;

const ask = <T extends { readonly id: LoveAsk['id']; readonly options: readonly string[] }>(
  step: T,
): LoveAsk => ({ kind: 'ask', ...step }) as unknown as LoveAsk;

/**
 * 感情事件給的當季狀態。
 *
 * 鹿鼎公是**兩位各擲各的骰**（各自走自己側寫的那兩項能力），縮頭烏龜則是倒扣。
 * 挑哪一項由驅動端抽（它才知道哪些能力在用），這裡只交出候選。
 */
function rewardEffects(love: LoveState, points: number): readonly LoveEffect[] {
  if (love.open === 'cuckold') {
    return [
      {
        kind: 'bonus',
        choices: partnerBonusKeys(love.partner),
        points: -cfg.threesome.cuckold.reward_points,
      },
    ];
  }
  const out: LoveEffect[] = [
    { kind: 'bonus', choices: partnerBonusKeys(love.partner), points },
  ];
  if (love.partner2 !== null) {
    out.push({ kind: 'bonus', choices: partnerBonusKeys(love.partner2), points });
  }
  return out;
}

/**
 * 感情的一年。
 *
 * 抽取一律先做，**與狀態無關**——否則某一年的狀態差異會讓後面所有判定整串偏移。
 */
export function* loveYear(world: World, love: LoveState, ctx: LoveYearContext): LoveFlow {
  love.turmoilThisYear = false;
  if (ctx.age < cfg.gate.min_age) return;

  const rng = world.stream('career');
  const runs = rng.chance(cadenceChance(love));
  if (love.cheatPenaltyYears > 0) love.cheatPenaltyYears--;
  if (love.overseas !== 'none') love.overseasYears++;
  if (!runs) return;

  switch (love.status) {
    case 'dating':
      yield* datingYear(world, love, ctx);
      return;
    case 'married':
      yield* marriedYear(world, love, ctx);
      return;
    default:
      yield* singleYear(world, love, ctx);
  }
}

/** 單身或離婚：認識一個人。校園看球場上的表現，職業看緋聞。 */
function* singleYear(world: World, love: LoveState, ctx: LoveYearContext): LoveFlow {
  const partner = pickPartner(world, ctx.pro ? 'pro' : 'school', null);

  if (!ctx.pro) {
    const chance = confessionChance(ctx.bestRank);
    const choice = yield ask({
      id: 'confess',
      options: ['love:confess', 'love:wait'],
      partner,
      chance,
      rank: ctx.bestRank,
    });
    if (choice !== 'love:confess') {
      yield tell({ id: 'confess-skipped' });
      return;
    }
    if (!world.stream('career').chance(chance)) {
      yield tell({ id: 'confess-rejected', partner });
      return;
    }
    yield* startDating(love, partner, true);
    return;
  }

  yield tell({ id: 'scandal', partner, divorced: love.divorces > 0 });
  const choice = yield ask({ id: 'public-confirm', options: ['love:admit', 'love:dodge'], partner });
  if (choice !== 'love:admit') {
    yield tell({ id: 'scandal-faded' });
    return;
  }
  if (!world.stream('career').chance(cfg.dating.public_confirm.chance)) {
    yield tell({ id: 'scandal-denied' });
    return;
  }
  yield* startDating(love, partner, false);
}

/** 開始交往。 */
function* startDating(
  love: LoveState,
  partner: string,
  fromSchool: boolean,
): LoveFlow {
  love.status = 'dating';
  love.partner = partner;
  love.fromSchool = fromSchool;
  love.datingYears = 0;
  love.datedTimes++;
  yield tell({
    id: 'dating-started',
    partner,
    fromSchool,
    effects: [{ kind: 'bonus', choices: partnerBonusKeys(love.partner), points: 1 }],
  });
}

/** 交往中的一年：風波 → 分手判定 → 插曲 → 求婚。 */
function* datingYear(world: World, love: LoveState, ctx: LoveYearContext): LoveFlow {
  const propose = canPropose({ pro: ctx.pro, age: ctx.age });
  if (propose) love.datingYears++;

  yield* turmoil(world, love, ctx);
  if (love.status !== 'dating') return;

  if (world.stream('career').chance(breakupChance(love, { canPropose: propose }))) {
    yield* breakup(love, ctx, { id: 'waited-too-long', years: love.datingYears });
    return;
  }
  if (!propose) {
    yield* datingFlavour(love, ctx);
    return;
  }

  yield* affairOrFlavour(world, love, ctx);
  // **被抓到之後那一年就結束了。** 外遇那一段可能以分手收場，而求婚接在它後面
  // ——沒有這道檢查的話，同一年會出現「劈腿曝光、她提分手」然後立刻「要不要求
  // 婚」，對著一個已經走了的人跪下去。與上面風波那一段同一個守衛。
  if (love.status !== 'dating') return;
  yield* proposalAsk(love, ctx);
}

/** 求婚。**十五歲的人不會在主場本壘板後方跪下來**，因此它有職業與年齡的門檻。 */
function* proposalAsk(love: LoveState, ctx: LoveYearContext): LoveFlow {
  const choice = yield ask({
    id: 'proposal',
    options: ['love:propose', 'love:later'],
    partner: love.partner ?? '',
    partner2: love.partner2,
    years: love.datingYears,
  });
  if (choice !== 'love:propose') {
    yield tell({ id: 'proposal-later' });
    return;
  }

  const partner = love.partner ?? '';
  const partner2 = love.partner2;
  love.status = 'married';
  love.kids = 0;
  love.kids2 = 0;
  love.datingYears = 0;
  love.marriedYear = ctx.year;
  // 三人行是**兩位一起進禮堂**，姻緣成就那一刻記兩筆——成就數的是不同的對象，
  // 而這一天確實有兩個人走過紅毯。
  recordSpouse(love, partner);
  recordSpouse(love, partner2);

  const after: LoveEffect[] = isChildhoodSweetheart(love)
    ? [{ kind: 'trait', id: cfg.childhood_sweetheart.trait }]
    : [];
  yield tell({ id: 'wedding', partner, partner2, effects: rewardEffects(love, 2), after });
}

/** 已婚的一年：風波 → 生子 → 外遇或日常。 */
function* marriedYear(world: World, love: LoveState, ctx: LoveYearContext): LoveFlow {
  yield* turmoil(world, love, ctx);
  if (love.status !== 'married') return;

  // 生子**一位一擲**：機率是逐胎遞減的，兩位得各自從第一胎算起。一年兩邊都中
  // 就是兩個孩子，那是三人行真正的形狀。
  let born = 0;
  born += yield* childbirth(world, love, love.partner, 'first');
  born += yield* childbirth(world, love, love.partner2, 'second');
  if (born > 0) return;

  yield* affairOrFlavour(world, love, ctx);
}

/**
 * 一位對象的生子判定。生了回 1，沒生回 0。
 *
 * **兩位對象各記各的孩子數**：生子機率逐胎遞減，共用一個計數器的話，第二位的第
 * 一胎會直接吃到第一位生完之後的低機率——那不是同一件事。
 */
function* childbirth(
  world: World,
  love: LoveState,
  partner: string | null,
  slot: 'first' | 'second',
): Generator<LoveStep, number, string> {
  if (partner === null) return 0;
  const kids = slot === 'first' ? love.kids : love.kids2;
  if (kids >= cfg.marriage.max_kids) return 0;
  if (!world.stream('career').chance(childbirthChance(kids, partner))) return 0;

  if (slot === 'first') love.kids++;
  else love.kids2++;
  yield tell({
    id: 'childbirth',
    partner,
    nth: kids + 1,
    total: love.kids + love.kids2,
    effects: [{ kind: 'bonus-random', points: 2 }],
  });
  return 1;
}

/**
 * 感情風波。
 *
 * **這是整條感情線唯一沒有正確答案的地方**——外遇算得出來該拒絕，這條算不出來。
 * 吞下去是慢性、分手是重擊：斷乾淨的人痛一次，忍下來的人被慢慢消耗。
 */
function* turmoil(world: World, love: LoveState, ctx: LoveYearContext): LoveFlow {
  const rng = world.stream('career');
  const hit = rng.chance(turmoilChance(love));
  const kinds = cfg.turmoil.kinds;
  // 抽哪一張卡**不吃 hit**：命不命中都要抽，否則後面的判定會整串偏移。
  const kind = kinds[rng.int(0, kinds.length - 1)];
  if (!hit || kind === undefined || !hasPartner(love)) return;

  love.turmoilThisYear = true;
  // **她出軌的那張卡，低機率多一條路。** 抽不中就只有原本兩條——那個選項根本
  // 不會出現，所以它是隱藏事件而不是一個每次都要重新拒絕的誘惑。
  const openable =
    kind.id === 'cheated' && love.open === 'none' && rng.chance(cfg.threesome.chance);

  const choice = yield ask({
    id: 'turmoil',
    options: openable
      ? ['love:swallow', 'love:leave', 'love:open']
      : ['love:swallow', 'love:leave'],
    kindId: kind.id,
    openable,
  });

  if (choice === 'love:open') {
    love.open = 'cuckold';
    yield tell({
      id: 'cuckold',
      kindId: kind.id,
      effects: [{ kind: 'trait', id: cfg.threesome.cuckold.trait }],
    });
    return;
  }
  if (choice === 'love:swallow') {
    love.cracks++;
    yield tell({ id: 'turmoil-swallow', kindId: kind.id, cracks: love.cracks });
    return;
  }
  yield* breakup(love, ctx, { id: 'turmoil-leave', kindId: kind.id }, [
    { kind: 'ability-loss', points: cfg.turmoil.leave.ability_loss },
  ]);
}

/** 外遇的誘惑，或平淡的一年。 */
function* affairOrFlavour(world: World, love: LoveState, ctx: LoveYearContext): LoveFlow {
  const rng = world.stream('career');
  // 鹿鼎公不再收到誘惑——你已經有兩位了，那張卡沒有東西可以拿來誘惑你。
  if (love.open === 'harem' || !rng.chance(cfg.affair.chance)) {
    yield* datingFlavour(love, ctx);
    return;
  }

  const other = pickPartner(world, ctx.pro ? 'pro' : 'school', love.partner, true);
  const married = love.status === 'married';
  const choice = yield ask({
    id: 'affair',
    options: ['love:affair', 'love:decline'],
    other,
    married,
  });

  if (choice !== 'love:affair') {
    yield tell({ id: 'affair-declined', effects: rewardEffects(love, cfg.affair.reward.refused) });
    return;
  }

  love.affairs++;
  if (world.stream('career').chance(cfg.affair.escape_chance)) {
    yield tell({
      id: 'affair-escaped',
      married,
      effects: [
        {
          kind: 'bonus',
          choices: partnerBonusKeys(love.partner),
          points: cfg.affair.reward.escaped,
        },
      ],
    });
    return;
  }
  yield* affairCaught(world, love, ctx, other);
}

/** 被抓到。第二次起解鎖花樣年華，而那個量級與一次大傷相同——是刻意的。 */
function* affairCaught(
  world: World,
  love: LoveState,
  ctx: LoveYearContext,
  other: string,
): LoveFlow {
  const c = cfg.affair.caught;
  love.caught++;
  love.turmoilThisYear = true;
  love.cheatPenaltyYears = cfg.affair.dating_breakup_penalty.years;

  const scum = love.caught >= c.scum.caught_times;
  const effects: LoveEffect[] = [{ kind: 'ability-loss', points: c.single_ability_loss }];
  if (scum) {
    effects.push({ kind: 'trait', id: c.scum.trait });
    effects.push({ kind: 'all-ability-loss', points: c.scum.all_ability_loss });
  }
  const married = love.status === 'married';
  yield tell({ id: 'affair-caught', married, scum, effects });

  // **縮頭烏龜的唯一出口。** 那段關係走不掉，除非你自己也出軌——而一旦出軌被
  // 抓，兩邊都破了，沒有道歉也沒有三人行，直接結束。
  if (love.open === 'cuckold') {
    yield* breakup(love, ctx, { id: 'cuckold-exit' });
    return;
  }

  // **三人行：劈腿唯一的好結局，而且低機率才看得到。**
  const openable = love.open === 'none' && world.stream('career').chance(cfg.threesome.chance);
  const choice = yield ask({
    id: 'caught',
    options: openable
      ? ['love:apologise', 'love:accept', 'love:open']
      : ['love:apologise', 'love:accept'],
    other,
    married,
    openable,
  });

  if (choice === 'love:open') {
    yield* enterHarem(love, other);
    return;
  }
  if (choice === 'love:apologise') {
    if (world.stream('career').chance(c.apology_success)) {
      love.cracks++;
      yield tell({ id: 'apology-accepted', partner: love.partner ?? '' });
      return;
    }
    yield* breakup(love, ctx, { id: 'apology-failed' }, [
      { kind: 'ability-loss', points: c.apology_failed_loss },
    ]);
    return;
  }
  yield* breakup(love, ctx, { id: 'accept' });
}

/**
 * 進入三人行（鹿鼎公）：你外遇被抓，她反而把那個人請上檯面。
 *
 * **第二位是真的第二位**：她有自己的側寫，往後每年的感情回報與生子都各擲各的骰。
 */
function* enterHarem(love: LoveState, other: string): LoveFlow {
  const partner = love.partner ?? '';
  const married = love.status === 'married';
  love.open = 'harem';
  love.partner2 = other;
  love.kids2 = 0;
  // 被抓的分手加成沒有意義了——那件事已經有了另一個結局。
  love.cheatPenaltyYears = 0;
  if (married) recordSpouse(love, other);
  yield tell({
    id: 'harem',
    partner,
    other,
    married,
    effects: [{ kind: 'trait', id: cfg.threesome.harem.trait }],
  });
}

/** 分手或離婚。離婚要分財產——**一個只會增加的數字不是資產，是計分板**。 */
function* breakup(
  love: LoveState,
  ctx: LoveYearContext,
  reason: BreakupReason,
  before: readonly LoveEffect[] = [],
): LoveFlow {
  const ex = love.partner ?? '';
  const ex2 = love.partner2;
  const wasMarried = love.status === 'married';
  const kids = love.kids + love.kids2;

  let money = 0;
  if (wasMarried) {
    love.divorces++;
    money =
      love.open === 'cuckold'
        ? // **她先外遇的事實不會因為你後來也外遇而消失**，所以錢是往你這邊流的。
          alimony(ctx.earnings)
        : // 三人行破局是兩份一起賠——好處放大的那一段，就是在這裡還的。
          -divorceCost(ctx.earnings, kids, love.partner, love.partner2);
  }

  love.status = afterBreakup(love);
  love.partner = null;
  // 三人行破局是**兩位一起走**：那段關係本來就是一個整體，沒有留下一位的走法。
  love.partner2 = null;
  love.open = 'none';
  love.datingYears = 0;
  love.kids = 0;
  love.kids2 = 0;
  love.fromSchool = false;
  love.cracks = 0;
  love.overseas = 'none';
  love.overseasYears = 0;
  love.turmoilThisYear = true;

  const effects: LoveEffect[] = [...before];
  if (money !== 0) effects.push({ kind: 'money', amount: money });
  // 啦啦隊殺手只在**戀情**結束的那一刻判定，離婚那條要排除（ADR 0024）。它排在
  // 分手那張卡之後——那個稱號是這段關係的註腳，不是它的過程。
  const after: LoveEffect[] =
    !wasMarried && earnsConfidante(love)
      ? [{ kind: 'trait', id: cfg.dating.confidante.trait }]
      : [];

  yield tell({ id: 'breakup', reason, ex, ex2, wasMarried, kids, money, effects, after });
}

/** 平淡但溫暖的一年。感情線多數的年份都是這種。 */
function* datingFlavour(love: LoveState, ctx: LoveYearContext): LoveFlow {
  const effects = rewardEffects(love, 1);
  const variant: FlavourVariant =
    love.open === 'cuckold'
      ? 'cuckold'
      : love.open === 'harem'
        ? 'harem'
        : love.status === 'married'
          ? love.kids > 0
            ? 'married-kids'
            : 'married'
          : ctx.pro
            ? 'pro'
            : 'school';
  yield tell({
    id: 'flavour',
    variant,
    partner: love.partner ?? '',
    partner2: love.partner2,
    effects,
  });
}

/**
 * 升學或進職業的關卡。
 *
 * **還不能求婚的人不該因為沒結婚而被拆散**，因此學生時期不累計「婚期一延再延」
 * 的風險，改成身分轉換各擲一次。撐過去的對象會延續到職業生涯。
 *
 * 天賦「絕對真愛」乘的是**撐過去的機率**而不是分手機率（見 ADR 0033）。
 */
export function* loveCheckpoint(world: World, love: LoveState, label: string): LoveFlow {
  const rng = world.stream('career');
  const cp = cfg.amateur.checkpoint;
  const survive = (100 - cp.break_chance) * cp.talent_survive_multiplier;
  const broke = rng.chance(Math.max(0, 100 - survive));
  if (love.status !== 'dating' || !broke) return;

  const ex = love.partner ?? '';
  love.status = afterBreakup(love);
  love.partner = null;
  love.datingYears = 0;
  love.fromSchool = false;

  const after: LoveEffect[] = earnsConfidante(love)
    ? [{ kind: 'trait', id: cfg.dating.confidante.trait }]
    : [];
  yield tell({
    id: 'breakup',
    reason: { id: 'checkpoint', label },
    ex,
    ex2: null,
    wasMarried: false,
    kids: 0,
    money: 0,
    after,
  });
}

/**
 * 旅外時的安排。
 *
 * **帶她走與遠距離都會壞，只是壞的形狀不同**——沒有代價的選項不是選擇，是儀式。
 */
export function* loveOverseas(
  love: LoveState,
  ctx: LoveYearContext,
  orgName: string,
): LoveFlow {
  if (!hasPartner(love)) return;

  // 舉家旅外要養家，而養多少錢跟她習慣怎麼過日子有關——與離婚那一筆同一條軸。
  const cost = Math.round(
    ctx.earnings * cfg.overseas.bring.cost_ratio * partnerTier(love.partner, 'spending'),
  );
  const choice = yield ask({
    id: 'overseas',
    options: ['love:bring', 'love:apart', 'love:end'],
    orgName,
    partner: love.partner ?? '',
    cost,
  });

  if (choice === 'love:end') {
    yield* breakup(love, ctx, { id: 'overseas-end' });
    return;
  }

  love.overseasYears = 0;
  if (choice === 'love:bring') {
    love.overseas = 'bring';
    yield tell({
      id: 'overseas-bring',
      cost,
      effects: [
        { kind: 'money', amount: -cost },
        { kind: 'honor', name: cfg.overseas.bring.achievement },
      ],
    });
    return;
  }
  love.overseas = 'apart';
  yield tell({ id: 'overseas-apart' });
}

/** 對象的側寫。驅動端要把它寫進提問的提示裡——**選擇之前拿不到的資訊不構成選擇**。 */
export function partnerProfile(name: string | null): string {
  return partnerOf(name)?.desc ?? '';
}
