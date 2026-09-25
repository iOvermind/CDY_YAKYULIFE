/**
 * API 路由。
 *
 * 核心的一條是 `POST /api/careers/:id`——**伺服器用同一份引擎重跑重播日誌，
 * 自己算成就與 AP**。客戶端回報的數字只拿來比對，不採信。見 ADR 0007。
 */

// **只從引擎的入口 import**——那份檔案是伺服器被支援的 surface（ADR 0049）。
// 直接點名 engine 內部的路徑，等於把引擎的任何重整變成這裡的執行期風險。
import {
  ALL,
  costOf,
  Game,
  improvedRanks,
  isPitcherRole,
  LADDER_POSITIONS,
  maxLevelOf,
  priceOwned,
  type LadderKey,
} from '../../client/src/engine/index.ts';
import { ladder as ladderCfg, leagues, talents as talentData } from '../../client/src/data/index.ts';
import type {
  CareerResult,
  CareerTicket,
  FinishRequest,
  LadderBoard,
  LadderEntry,
  LadderResponse,
  Me,
} from '../../client/src/api/contract.ts';
import { hashPassword, newCareerId, verifyPassword } from './auth.ts';
import {
  achievementsOf,
  rarityOf,
  balanceOf,
  hasFinishedCareer,
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
  const rarity = await rarityOf();
  const achievements = (await achievementsOf(user.id)).map((a) => {
    const r = rarity.get(a.id);
    return r === undefined ? a : { ...a, rarity: r };
  });
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
    const owned = await achievementsOf(user.id);
    // **結算的配方只有一份**，在引擎裡（`Game.score()`，見 ADR 0049）。這裡只
    // 負責把跨局的進度交給它——那是只有伺服器手上有的東西。
    const score = game.score({
      firstCareer: !(await hasFinishedCareer(user.id)),
      unlocked: new Set(owned.map((a) => a.id)),
    });
    if (score === null) throw new HttpError(400, '這一局還沒有走到結算。');
    const result = score.achievements;
    const improved = improvedRanks(owned, result.list);
    const gained =
      result.points +
      improved.reduce((sum, a) => {
        const before = owned.find((o) => o.id === a.id)?.points ?? 0;
        return sum + ((priceOwned([a]).get(a.id) ?? 0) - before);
      }, 0);

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
      // 同一項賽事拿到更好的名次：id 相同所以不會新增一列，改名之後動態定價就
      // 補上差額（ADR 0053）。
      for (const a of improved) {
        await client.query('UPDATE achievements SET name = $3 WHERE user_id = $1 AND achievement = $2', [
          user.id,
          a.id,
          a.name,
        ]);
      }
      await client.query(
        'UPDATE careers SET log = $1, verified = $2, ap_gained = $3, finished_at = now() WHERE id = $4',
        [JSON.stringify(body.log), verified, gained, careerId],
      );

      // 天梯的原料。**只在 verified 時寫**——規則資料由伺服器送出，玩家改了自己
      // 那份，重跑必然對不上，那一局就不進榜（ADR 0038）。AP 仍然照給：伺服器
      // 算的那份本來就是它自己的數字，不受影響。
      if (verified) {
        for (const row of score.ladder) {
          await client.query(
            `INSERT INTO ladder_rows
               (career_id, user_id, org, position, kind, seasons, batting, pitching,
                defense_runs, win_shares, loss_shares, score, salary,
                qualified_batter, qualified_pitcher, engine_version, player_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
             ON CONFLICT (career_id, org, position, kind) DO NOTHING`,
            [
              careerId,
              user.id,
              row.org,
              row.position,
              row.kind,
              row.seasons,
              row.batting === null ? null : JSON.stringify(row.batting),
              row.pitching === null ? null : JSON.stringify(row.pitching),
              row.defenseRuns,
              row.winShares,
              row.lossShares,
              row.score,
              Math.round(row.salary),
              row.qualifiedBatter,
              row.qualifiedPitcher,
              score.engineVersion,
              score.playerName,
            ],
          );
        }
      }
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
      gained,
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

/**
 * 查一格天梯：聯盟 × 守位 × 累計／單季。
 *
 * **守位決定畫哪幾張表**：跨守位畫野手＋投手＋共通，野手守位畫野手＋共通，投手
 * 定位畫投手＋共通。共通那一張是份額、評價分、薪水——整個球員的數字，不分投打。
 *
 * 率型欄位要過資格（寫入時就算好了），累積欄位一律沒有門檻。
 */
export async function ladder(
  user: UserRow | null,
  key: LadderKey,
  self: boolean,
): Promise<LadderResponse> {
  // 個人天梯一定要有身分；全伺服器天梯不必登入也看得到。
  if (self && user === null) throw new HttpError(401, '請先登入。');

  const params: unknown[] = [key.org, key.position, key.kind];
  let where = 'lr.org = $1 AND lr.position = $2 AND lr.kind = $3';
  if (self && user !== null) {
    params.push(user.id);
    where += ' AND lr.user_id = $4';
  }

  const { rows } = await pool.query<StatRow>(
    `SELECT lr.org, lr.position, lr.kind, lr.seasons, lr.batting, lr.pitching,
            lr.defense_runs, lr.win_shares, lr.loss_shares, lr.score, lr.salary,
            lr.qualified_batter, lr.qualified_pitcher, lr.engine_version,
            lr.player_name, lr.finished_at, u.account
       FROM ladder_rows lr
       JOIN users u ON u.id = lr.user_id
      WHERE ${where}`,
    params,
  );

  const boards: LadderBoard[] = [];
  for (const side of sidesFor(key.position)) {
    for (const column of ladderCfg.columns[side]) {
      const entries = rankOf(rows, side, column);
      // 空的榜不出現——沒有人有資格的欄位畫出來只是一個空框。
      if (entries.length > 0) boards.push({ column: column.key, side, entries });
    }
  }

  return { boards, combos: await combosOf(self ? user : null) };
}

/** 守位選單決定要畫哪幾張表。 */
function sidesFor(position: string): readonly LadderSide[] {
  if (position === ALL) return ['batter', 'pitcher', 'shared'];
  return isPitcherRole(position) ? ['pitcher', 'shared'] : ['batter', 'shared'];
}

type LadderSide = 'batter' | 'pitcher' | 'shared';

/** 資料庫回來的一列。`batting` / `pitching` 是整條成績的 JSONB。 */
interface StatRow {
  org: string;
  position: string;
  kind: string;
  seasons: number;
  batting: Record<string, number> | null;
  pitching: Record<string, number> | null;
  defense_runs: number;
  win_shares: number;
  loss_shares: number;
  score: number;
  /** BIGINT 從 pg 回來是字串。 */
  salary: number | string;
  qualified_batter: boolean;
  qualified_pitcher: boolean;
  engine_version: number;
  player_name: string;
  finished_at: string;
  account: string;
}

/** 一個欄位的前 N 名。 */
function rankOf(
  rows: readonly StatRow[],
  side: LadderSide,
  column: { key: string; rate: boolean; order: string },
): readonly LadderEntry[] {
  const picked: { row: StatRow; value: number }[] = [];
  for (const row of rows) {
    // 率型要有資格；累積型沒有門檻。共通欄位沒有率型。
    if (column.rate && side !== 'shared') {
      if (!(side === 'batter' ? row.qualified_batter : row.qualified_pitcher)) continue;
    }
    const value = valueOf(row, side, column.key);
    if (value === null) continue;
    picked.push({ row, value });
  }
  picked.sort((a, b) => (column.order === 'asc' ? a.value - b.value : b.value - a.value));
  return picked.slice(0, ladderCfg.top_n).map((p, i) => ({
    rank: i + 1,
    name: p.row.player_name,
    account: p.row.account,
    value: p.value,
    seasons: p.row.seasons,
    engineVersion: p.row.engine_version,
    at: new Date(p.row.finished_at).toISOString(),
  }));
}

/**
 * 取一列在某個欄位上的值。
 *
 * 共通欄位（份額、評價分、薪水）是整個球員的，直接讀那幾欄。守備分不在
 * BattingLine 上，它是獨立一欄。那一側整條是 null（例如純投手沒有打擊成績）時回
 * null，那一列就不進這張榜。
 */
function valueOf(row: StatRow, side: LadderSide, key: string): number | null {
  if (side === 'shared') {
    if (key === 'ws') return row.win_shares;
    if (key === 'ls') return row.loss_shares;
    if (key === 'score') return row.score;
    if (key === 'salary') return Number(row.salary);
    return null;
  }
  if (key === 'defenseRuns') return row.batting === null ? null : row.defense_runs;
  const line = side === 'batter' ? row.batting : row.pitching;
  if (line === null) return null;
  const value = line[key];
  return typeof value === 'number' ? value : null;
}

/**
 * 有資料的組合，供畫面的選單用。
 *
 * **選單只列在其他選擇下有資料的選項**——沒去過的聯盟不出現，與成就櫃「未解鎖的
 * 一律不顯示」同一個規矩。個人天梯回他自己打過的，全伺服器天梯回所有人的聯集。
 *
 * 順序固定：聯盟照 `top_league_names`（**不是** `org_names`——後者是「旅日／旅美」
 * 那種體系用語的覆蓋表，韓墨澳不在裡面），跨聯盟放最前；守位照 LADDER_POSITIONS，
 * 跨守位放最前。
 */
async function combosOf(user: UserRow | null): Promise<readonly LadderKey[]> {
  const { rows } = await pool.query<{ org: string; position: string; kind: string }>(
    user === null
      ? 'SELECT DISTINCT org, position, kind FROM ladder_rows'
      : 'SELECT DISTINCT org, position, kind FROM ladder_rows WHERE user_id = $1',
    user === null ? [] : [user.id],
  );
  const orgRank = (org: string) =>
    org === ALL ? -1 : Object.keys(leagues.top_league_names).indexOf(org);
  const posRank = (position: string) =>
    position === ALL ? -1 : LADDER_POSITIONS.indexOf(position);
  return rows
    .filter((r) => r.kind === 'total' || r.kind === 'best')
    .map((r) => ({ org: r.org, position: r.position, kind: r.kind as LadderKey['kind'] }))
    .sort(
      (a, b) =>
        orgRank(a.org) - orgRank(b.org) ||
        posRank(a.position) - posRank(b.position) ||
        a.kind.localeCompare(b.kind),
    );
}
