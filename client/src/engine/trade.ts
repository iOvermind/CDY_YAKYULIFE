/**
 * 季中交易。
 *
 * 交易大限落在球季中段，因此**一年可以有兩段成績**——這是逐段紀錄唯一的
 * 使用者，一年兩隊的逐年表要靠它才會出現。
 *
 * 三條路徑，差別在球員有多少話語權：
 *
 * - **更衣室毒瘤**不必問。球團受夠了休息室的氣氛，直接打包。
 * - **明星**有否決權。留下來要付代價，但那件球衣他留住了。
 * - **其他人**只有抱怨或沉默。那個差別本身就是資訊——夠強的人才有得選。
 *
 * 還有一條不會動的：神主牌與球隊代名詞是城市的象徵，他隊來問，高層連會議
 * 都不開。
 */
import { season as cfg, teams as teamsData } from '../data/index.ts';
import type { BattingLine } from './amateurStats.ts';
import type { World } from './rng.ts';
import type { ProPitchingLine } from './season.ts';

const trade = cfg.trade;

/** 被交易的機率。特性把它推高——毒瘤與氣氛大師都是球團想清掉的人。 */
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
  const cut = (v: number): readonly [number, number] => {
    const first = Math.round(v * ratio);
    return [first, v - first];
  };
  const [g1, g2] = cut(line.games);
  const [pa1, pa2] = cut(line.pa);
  const [ab1, ab2] = cut(line.ab);
  const [r1, r2] = cut(line.runs);
  const [h1, h2] = cut(line.hits);
  const [d1, d2] = cut(line.double);
  const [t1, t2] = cut(line.triple);
  const [hr1, hr2] = cut(line.hr);
  const [rbi1, rbi2] = cut(line.rbi);
  const [bb1, bb2] = cut(line.bb);
  const [ibb1, ibb2] = cut(line.ibb);
  const [so1, so2] = cut(line.so);
  const [sb1, sb2] = cut(line.sb);
  const [cs1, cs2] = cut(line.cs);

  const build = (
    games: number,
    pa: number,
    ab: number,
    runs: number,
    hits: number,
    double: number,
    triple: number,
    hr: number,
    rbi: number,
    bb: number,
    ibb: number,
    so: number,
    sb: number,
    cs: number,
  ): BattingLine => {
    const single = hits - double - triple - hr;
    const bases = single + double * 2 + triple * 3 + hr * 4;
    return {
      games,
      pa,
      ab,
      runs,
      hits,
      double,
      triple,
      hr,
      rbi,
      bb,
      ibb,
      so,
      sb,
      cs,
      // 率是導出的，必須用這一段自己的分母重算——沿用全季的率會讓兩段看起來
      // 打得一模一樣。
      avg: ab === 0 ? 0 : hits / ab,
      obp: pa === 0 ? 0 : (hits + bb) / pa,
      slg: ab === 0 ? 0 : bases / ab,
    };
  };

  return [
    build(g1, pa1, ab1, r1, h1, d1, t1, hr1, rbi1, bb1, ibb1, so1, sb1, cs1),
    build(g2, pa2, ab2, r2, h2, d2, t2, hr2, rbi2, bb2, ibb2, so2, sb2, cs2),
  ];
}

/** 投球成績的切分。出局數是整數的原子單位，切起來精確。 */
export function splitPitching(
  line: ProPitchingLine,
  ratio: number,
): readonly [ProPitchingLine, ProPitchingLine] {
  const cut = (v: number): readonly [number, number] => {
    const first = Math.round(v * ratio);
    return [first, v - first];
  };
  const [g1, g2] = cut(line.games);
  const [s1, s2] = cut(line.starts);
  const [w1, w2] = cut(line.wins);
  const [l1, l2] = cut(line.losses);
  const [sv1, sv2] = cut(line.saves);
  const [hd1, hd2] = cut(line.holds);
  const [o1, o2] = cut(line.outs);
  const [h1, h2] = cut(line.hits);
  const [r1, r2] = cut(line.runs);
  const [er1, er2] = cut(line.er);
  const [bb1, bb2] = cut(line.bb);
  const [so1, so2] = cut(line.so);

  const build = (
    games: number,
    starts: number,
    wins: number,
    losses: number,
    saves: number,
    holds: number,
    outs: number,
    hits: number,
    runs: number,
    er: number,
    bb: number,
    so: number,
  ): ProPitchingLine => ({
    role: line.role,
    games,
    starts,
    wins,
    losses,
    saves,
    holds,
    outs,
    hits,
    runs,
    er,
    bb,
    so,
    era: outs === 0 ? 0 : (er * 27) / outs,
  });

  return [
    build(g1, s1, w1, l1, sv1, hd1, o1, h1, r1, er1, bb1, so1),
    build(g2, s2, w2, l2, sv2, hd2, o2, h2, r2, er2, bb2, so2),
  ];
}
