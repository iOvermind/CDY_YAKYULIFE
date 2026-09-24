/**
 * 季中交易。
 *
 * 交易大限落在球季中段，因此**一年可以有兩段成績**——這是逐段紀錄唯一的
 * 使用者，一年兩隊的逐年表要靠它才會出現。
 *
 * 三條路徑，差別在球員有多少話語權：
 *
 * - **烏鴉**不必問。球團受夠了休息室的氣氛，直接打包。
 * - **明星**有否決權。留下來要付代價，但那件球衣他留住了。
 * - **其他人**只有抱怨或沉默。那個差別本身就是資訊——夠強的人才有得選。
 *
 * 還有一條不會動的：重案組之虎與球隊代名詞是城市的象徵，他隊來問，高層連會議
 * 都不開。
 */
import { season as cfg, teams as teamsData } from '../data/index.ts';
import type { BattingLine } from './amateurStats.ts';
import type { World } from './rng.ts';
import type { ProPitchingLine } from './season.ts';

const trade = cfg.trade;

/** 被交易的機率。特性把它推高——毒瘤與我不是針對你都是球團想清掉的人。 */
export function tradeChance(traits: ReadonlySet<string>): number {
  let p = trade.chance.base;
  for (const [id, bonus] of Object.entries(trade.chance.trait_bonus)) {
    if (traits.has(id)) p += bonus;
  }
  return p;
}

/** 明星嗎。看的是**當年**的聯盟平均，不是基準值。 */
export function isStar(overall: number, par: number): boolean {
  return overall >= par + trade.star_margin.value;
}

/** 非賣品。一人一城的兩個特性，球團絕不放人。 */
export function isUntouchable(traits: ReadonlySet<string>): boolean {
  return trade.untouchable_traits.value.some((t) => traits.has(t));
}

/**
 * 交易的對手。同體系內換隊，因此排除的只有現在這一隊。
 *
 * 走訪順序照 teams.json 的宣告順序，否則同一個種子會抽出不同結果。
 */
export function tradeTarget(world: World, org: string, current: string): string | null {
  const pool = (teamsData.leagues[org] ?? []).filter((t) => t.name !== current);
  if (pool.length === 0) return null;
  return pool[world.stream('career').int(0, pool.length - 1)]?.name ?? null;
}

/** 交易大限落在球季的哪個位置。回傳舊隊的出賽比例。 */
export function tradeSplit(world: World): number {
  const r = world.stream('career').next();
  return trade.split.min + r * (trade.split.max - trade.split.min);
}

/**
 * 把一季的成績切成兩段。
 *
 * **第二段是相減出來的，不是各自四捨五入。** 兩段相加必須精確等於全季，
 * 否則生涯累積與逐年表會對不起來——2000 安差一支就是另一個故事。
 */
export function splitBatting(line: BattingLine, ratio: number): readonly [BattingLine, BattingLine] {
  // 累計欄位一次列完。**用鍵去切而不是十四個位置參數**——加一個欄位就得數位置的
  // 寫法，遲早會有人把 sb 填進 cs 的格子裡。
  const COUNTS = [
    'games',
    'starts',
    'pa',
    'ab',
    'runs',
    'hits',
    'double',
    'triple',
    'hr',
    'rbi',
    'bb',
    'ibb',
    'so',
    'sb',
    'cs',
    'hbp',
    'sac',
  ] as const;

  const first: Record<string, number> = {};
  const second: Record<string, number> = {};
  for (const key of COUNTS) {
    const whole = line[key];
    const cut = Math.round(whole * ratio);
    first[key] = cut;
    // 第二段是相減出來的，不是各自四捨五入——兩段相加必須精確等於全季，否則
    // 生涯累積與逐年表會對不起來，2000 安差一支就是另一個故事。
    second[key] = whole - cut;
  }

  const build = (c: Record<string, number>): BattingLine => {
    const single = (c['hits'] ?? 0) - (c['double'] ?? 0) - (c['triple'] ?? 0) - (c['hr'] ?? 0);
    const bases = single + (c['double'] ?? 0) * 2 + (c['triple'] ?? 0) * 3 + (c['hr'] ?? 0) * 4;
    const ab = c['ab'] ?? 0;
    const pa = c['pa'] ?? 0;
    const obpDen = Math.max(0, pa - (c['sac'] ?? 0));
    return {
      ...(c as unknown as Omit<BattingLine, 'avg' | 'obp' | 'slg'>),
      // 率是導出的，必須用這一段自己的分母重算——沿用全季的率會讓兩段看起來
      // 打得一模一樣。
      avg: ab === 0 ? 0 : (c['hits'] ?? 0) / ab,
      obp:
        obpDen === 0
          ? 0
          : ((c['hits'] ?? 0) + (c['bb'] ?? 0) + (c['ibb'] ?? 0) + (c['hbp'] ?? 0)) / obpDen,
      slg: ab === 0 ? 0 : bases / ab,
    };
  };

  return [build(first), build(second)];
}

/** 一次出賽最多換到的決定。搬移時從後面往前搬——中繼最不像「那一場的主角」。 */
const DECISIONS = ['holds', 'saves', 'losses', 'wins'] as const;

/** 投球成績的切分。出局數是整數的原子單位，切起來精確。 */
export function splitPitching(
  line: ProPitchingLine,
  ratio: number,
): readonly [ProPitchingLine, ProPitchingLine] {
  const cut = (v: number): readonly [number, number] => {
    const first = Math.round(v * ratio);
    return [first, v - first];
  };
  // 累計欄位一次列完，用鍵去切——十四個位置參數的寫法，加一個欄位就得數位置。
  const COUNTS = [
    'games',
    'starts',
    'wins',
    'losses',
    'saves',
    'holds',
    'outs',
    'hits',
    'hr',
    'runs',
    'er',
    'bb',
    'so',
  ] as const;

  const first: Record<string, number> = {};
  const second: Record<string, number> = {};
  for (const key of COUNTS) {
    const whole = line[key];
    const c = cut(whole);
    first[key] = c[0];
    second[key] = c[1];
  }

  // **各欄分開四捨五入會讓一段的決定數超過那一段的出賽**：九場拆成 5／4，救援
  // 九次也拆成 5／4、中繼一次拆成 1／0，前半段就是 G5 5SV 1HLD。整季本來就守得住
  // 「先發 ≤ 出賽」「勝敗救援中繼 ≤ 出賽」，所以哪一段超出，就把超出的量搬到另一段
  // ——總數不變，另一段也不可能因此超出。
  const settle = (from: Record<string, number>, to: Record<string, number>): void => {
    const move = (key: string, n: number): number => {
      const k = Math.min(n, from[key] ?? 0);
      from[key] = (from[key] ?? 0) - k;
      to[key] = (to[key] ?? 0) + k;
      return n - k;
    };
    move('starts', Math.max(0, (from['starts'] ?? 0) - (from['games'] ?? 0)));
    let over = DECISIONS.reduce((n, k) => n + (from[k] ?? 0), 0) - (from['games'] ?? 0);
    for (const key of DECISIONS) if (over > 0) over = move(key, over);
  };
  settle(first, second);
  settle(second, first);

  const build = (c: Record<string, number>): ProPitchingLine => ({
    role: line.role,
    ...(c as unknown as Omit<ProPitchingLine, 'role' | 'era'>),
    // 防禦率用這一段自己的局數重算。
    era: (c['outs'] ?? 0) === 0 ? 0 : ((c['er'] ?? 0) * 27) / (c['outs'] ?? 1),
  });

  return [build(first), build(second)];
}
