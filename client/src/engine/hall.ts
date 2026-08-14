/**
 * 名人堂票選。
 *
 * 引退之後才跑，而且**可多聯盟並存**——三個聯盟的名人堂是三件事，一個人可以
 * 同時進入中職名人堂與日本野球殿堂。
 *
 * 分級決定結果：名人堂帶的人入選，明星帶的人年復一年入圍卻跨不過門檻（差一點
 * 的人比差很多的人更難受，這是名人堂敘事裡最有重量的一種），其餘的人連候選都
 * 進不了。
 *
 * 抽取走 career 子序列——票選是生涯層級的事件。
 */

import { hallOfFame as cfg } from '../data/index.ts';
import type { LeagueCareer } from './career.ts';
import type { World } from './rng.ts';

/** 一個聯盟的票選結果。 */
export interface BallotResult {
  readonly org: string;
  /** 名人堂的正式名稱，例如「中華職棒名人堂」。 */
  readonly hallName: string;
  /** 聯盟的簡稱，例如「中職」。 */
  readonly leagueName: string;
  readonly inducted: boolean;
  /** 首輪入選。只有 inducted 為 true 時才有意義。 */
  readonly firstBallot: boolean;
  /** 引退後幾年進入候選。 */
  readonly waitYears: number;
  /** 第幾年的投票當選；落選時是入圍過的年數。 */
  readonly ballotYear: number;
  /** 得票率。 */
  readonly percent: number;
  /** 得票數。落選時為 0——票數只在當選時有意義。 */
  readonly votes: number;
  /** 帽徽：入殿時代表的球隊。 */
  readonly capTeam: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 跑一個聯盟的票選。
 *
 * 沒有資格（分級低於明星）時回傳 null——連候選名單都進不去的人不該產生一行
 * 「落選」的敘述，那會把「從來沒被討論過」寫成「差一點就上」。
 */
export function runBallot(world: World, career: LeagueCareer): BallotResult | null {
  const rng = world.stream('career');
  const hall = cfg.halls[career.org];
  if (hall === undefined) return null;

  const base = {
    org: career.org,
    hallName: hall.name,
    leagueName: hall.league,
    waitYears: hall.wait_years,
    capTeam: career.capTeam,
  };

  // 名人堂帶：入選。差別只在第幾年。
  if (career.tier === 0) {
    const threshold = cfg.tier_thresholds.values[0] ?? 0;
    const multiplier = cfg.first_ballot.multiplier[career.org] ?? cfg.first_ballot.default_multiplier;
    const firstBallot = threshold > 0 && career.score >= threshold * multiplier;
    const wait = cfg.first_ballot.wait_if_not_first;
    const ballotYear = firstBallot ? 1 : rng.int(wait.min, wait.max);

    const v = cfg.vote_percent;
    const over = threshold > 0 ? ((career.score - threshold) / threshold) * v.over_threshold_factor : 0;
    const percent = clamp(
      v.base + over + rng.next() * v.random_max - (ballotYear - 1) * v.wait_penalty_per_year,
      v.floor,
      v.cap,
    );

    return {
      ...base,
      inducted: true,
      firstBallot,
      ballotYear,
      percent,
      votes: Math.round((hall.total_voters * percent) / 100),
    };
  }

  // 明星帶：年年入圍，年年差一點。
  if (career.tier === 1) {
    const n = cfg.near_miss;
    const percent = n.pct.min + rng.next() * (n.pct.max - n.pct.min);
    return {
      ...base,
      inducted: false,
      firstBallot: false,
      ballotYear: rng.int(n.tries.min, n.tries.max),
      percent,
      votes: 0,
    };
  }

  return null;
}

/**
 * 跑完所有聯盟的票選。
 *
 * 順序照 `representative_league.check_order`，因為每次判定都會消耗抽取——順序
 * 變了，同一個種子就會給出不同的結果。
 */
export function runBallots(
  world: World,
  careers: readonly LeagueCareer[],
): readonly BallotResult[] {
  const order = cfg.representative_league.check_order;
  const sorted = [...careers].sort((a, b) => {
    const ia = order.indexOf(a.org);
    const ib = order.indexOf(b.org);
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib);
  });

  const out: BallotResult[] = [];
  for (const career of sorted) {
    const result = runBallot(world, career);
    if (result !== null) out.push(result);
  }
  return out;
}
