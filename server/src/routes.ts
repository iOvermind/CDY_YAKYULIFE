/**
 * API 路由。
 *
 * 核心的一條是 `POST /api/careers/:id`——**伺服器用同一份引擎重跑重播日誌，
 * 自己算成就與 AP**。客戶端回報的數字只拿來比對，不採信。見 ADR 0007。
 */

import { evaluateAchievements } from '../../client/src/engine/achievements.ts';
import { Game } from '../../client/src/engine/game.ts';
import { runBallots } from '../../client/src/engine/hall.ts';
import { costOf, maxLevelOf } from '../../client/src/engine/overlay.ts';
import { talents as talentData } from '../../client/src/data/index.ts';
import type { CareerResult, CareerTicket, FinishRequest, Me } from '../../client/src/api/contract.ts';
import { hashPassword, newCareerId, verifyPassword } from './auth.ts';
import {
  achievementsOf,
  balanceOf,
  createUser,
  findUser,
  pool,
  talentsOf,
  type UserRow,
} from './db.ts';

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 花在天賦上的 AP 總額。退款是全額，因此它永遠等於「目前擁有的層級的價格總和」。 */
function spentOn(levels: Record<string, number>): number {
  return Object.entries(levels).reduce((sum, [id, level]) => sum + costOf(id, level), 0);
}

export async function meOf(user: UserRow): Promise<Me> {
  const levels = await talentsOf(user.id);
  const achievements = await achievementsOf(user.id);
  const { ap, earned } = await balanceOf(user.id, spentOn(levels));
  return {
    account: user.account,
    ap,
    apEarned: earned,
    achievements,
    talents: levels,
  };
}

export async function register(account: string, password: string): Promise<UserRow> {
  const name = account.trim();
  if (name.length < 2 || name.length > 20) throw new HttpError(400, '帳號長度要在 2 到 20 個字之間。');
  if (password.length < 4) throw new HttpError(400, '密碼至少要 4 個字。');
  if (await findUser(name)) throw new HttpError(409, '這個帳號已經有人用了。');
  // 註冊即通過，不驗證任何東西——這是刻意的（見 ADR 0007）。
  return createUser(name, await hashPassword(password));
}

export async function login(account: string, password: string): Promise<UserRow> {
  const user = await findUser(account.trim());
  // 帳號不存在與密碼錯誤回同一句話——分開講等於送給對方一份帳號清單。
  const ok = user !== null && (await verifyPassword(password, user.password_hash));
  if (!ok || user === null) throw new HttpError(401, '帳號或密碼不對。');
  return user;
}

/**
 * 開局登記：凍結當下的天賦組合。
 *
 * **天賦可以退款**，因此「玩家現在擁有什麼」與「這一局帶著什麼」是兩件事。沒有
 * 這道登記，一個中途退掉天賦的玩家會讓自己所有的歷史紀錄永久驗證失敗。
 */
export async function startCareer(user: UserRow): Promise<CareerTicket> {
  const levels = await talentsOf(user.id);
  const careerId = newCareerId();
  await pool.query('INSERT INTO careers (id, user_id, talents) VALUES ($1, $2, $3)', [
    careerId,
    user.id,
    JSON.stringify(levels),
  ]);
  return { careerId, talents: levels };
}

/**
 * 結算：伺服器重跑驗證。
 *
 * 客戶端上傳重播日誌，這裡用**登記時凍結的天賦**重建整段生涯，自己算成就。
 * 客戶端宣稱的成就只拿來比對，不影響結果——AP 是跨局累積並換成永久強化的貨幣，
 * 它一旦可以偽造，整個 Meta-progression 就沒有意義。
 */
export async function finishCareer(
  user: UserRow,
  careerId: string,
  body: FinishRequest,
): Promise<CareerResult> {
  const { rows } = await pool.query<{ talents: Record<string, number>; finished_at: string | null }>(
    'SELECT talents, finished_at FROM careers WHERE id = $1 AND user_id = $2',
    [careerId, user.id],
  );
  const career = rows[0];
  if (career === undefined) throw new HttpError(404, '找不到這一局。');
  if (career.finished_at !== null) throw new HttpError(409, '這一局已經結算過了。');

  // **用凍結的那組天賦重跑**，不是客戶端在日誌裡寫的那組。
  const log = { ...body.log, setup: { ...body.log.setup, talents: career.talents } };

  let game: Game;
  try {
    game = Game.replay(log);
  } catch (e) {
    throw new HttpError(400, `重播失敗，這一局不算：${(e as Error).message}`);
  }
  try {
    const summary = game.summary;
    if (summary === null) throw new HttpError(400, '這一局還沒有走到結算。');

    const owned = await achievementsOf(user.id);
    const ballots = summary.leagues.length > 0 ? runBallots(game.world, summary.leagues) : [];
    const state = game.state;
    const result = evaluateAchievements({
      summary,
      awards: state?.awards ?? [],
      traits: state?.traits ?? new Set<string>(),
      honors: state?.honors ?? [],
      halls: ballots.filter((b) => b.inducted).map((b) => b.leagueName),
      firstCareer: owned.length === 0,
      spouses: state?.love.spouses ?? [],
      unlocked: new Set(owned.map((a) => a.id)),
    });

    // 客戶端算的與伺服器算的一不一樣。不一樣仍以伺服器為準，但記一筆——那通常
    // 代表版本不同步，偶爾代表有人在改東西。
    const claimed = new Set(body.claimed);
    const verified =
      claimed.size === result.list.length && result.list.every((a) => claimed.has(a.id));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const a of result.newly) {
        await client.query(
          `INSERT INTO achievements (user_id, achievement, name, category, points)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, achievement) DO NOTHING`,
          [user.id, a.id, a.name, a.category, a.points],
        );
      }
      await client.query(
        'UPDATE careers SET log = $1, verified = $2, ap_gained = $3, finished_at = now() WHERE id = $4',
        [JSON.stringify(body.log), verified, result.points, careerId],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const levels = await talentsOf(user.id);
    const { ap } = await balanceOf(user.id, spentOn(levels));
    return {
      unlocked: result.newly.map((a) => ({ id: a.id, name: a.name, points: a.points })),
      gained: result.points,
      ap,
      verified,
    };
  } finally {
    // **一定要還原覆蓋層**——它是全域可變狀態，漏掉的話下一個請求會帶著這一局的
    // 天賦跑。見 ADR 0007 的負面後果。
    game.dispose();
  }
}

/**
 * 把一個天賦設到指定的級數。**要的是結果，不是動作**——升一級、降兩級、退到底，
 * 都是同一句話。差價由伺服器自己算，客戶端不必（也不可以）幫忙算錢。
 *
 * 這樣寫的理由是重送安全：網路重試同一個 `level = 2` 不會變成點兩級。動作型的
 * API（`POST` 買一級）沒有這個性質。
 */
export async function setTalent(user: UserRow, id: string, level: number): Promise<Me> {
  if (!talentData.talents.some((t) => t.id === id)) throw new HttpError(404, '沒有這個天賦。');
  if (!Number.isInteger(level) || level < 0) throw new HttpError(400, '級數要是零或正整數。');
  if (level > maxLevelOf(id)) throw new HttpError(409, '這個天賦沒有這麼多級。');

  const levels = await talentsOf(user.id);
  const current = levels[id] ?? 0;
  if (level === current) return meOf(user); // 已經是這樣了，什麼都不用做。

  // 差價＝兩個級數的累積成本相減。降級為負，等於退錢。
  const cost = costOf(id, level) - costOf(id, current);
  const { ap } = await balanceOf(user.id, spentOn(levels));
  if (ap < cost) throw new HttpError(409, `成就點數不夠，還差 ${cost - ap} 點。`);

  if (level === 0) {
    await pool.query('DELETE FROM talents WHERE user_id = $1 AND talent = $2', [user.id, id]);
  } else {
    await pool.query(
      `INSERT INTO talents (user_id, talent, level) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, talent) DO UPDATE SET level = EXCLUDED.level`,
      [user.id, id, level],
    );
  }
  return meOf(user);
}
