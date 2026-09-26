/**
 * PostgreSQL 存取。
 *
 * 只有一個相依（`pg`）——密碼雜湊、session、HTTP 全部用 Node 內建的東西做，
 * 相依越少，這個一年才動一次的服務就越不會因為某個套件棄用而爛掉。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { UnlockedAchievement } from '../../client/src/api/contract.ts';
import { priceOwned } from '../../client/src/engine/index.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** 資料庫需要的最小介面。測試用的假物件只要實作這兩個方法。 */
export interface Queryable {
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<unknown>;
    release(): void;
  }>;
}

/**
 * 真正的連線池。**延遲建立**——沒有 DATABASE_URL 的情境（例如跑測試）不該因為
 * 載入這個模組就去連一個不存在的資料庫。
 */
let real: pg.Pool | null = null;
let current: Queryable | null = null;

/** 換掉資料庫。只有測試會用它。 */
export function useDb(fake: Queryable | null): void {
  current = fake;
}

function db(): Queryable {
  if (current !== null) return current;
  real ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  return real as unknown as Queryable;
}

/**
 * 對外仍然長得像一個連線池。
 *
 * 用轉接物件而不是直接匯出 `pg.Pool`，是為了讓測試能抽換底層——否則每一條路由
 * 都得多帶一個參數，而那個參數在正式環境永遠是同一個值。
 */
export const pool: Queryable = {
  query: (text, values) => db().query(text, values),
  connect: () => db().connect(),
};

/** 建表。每次啟動都跑一次——`IF NOT EXISTS` 讓它是冪等的。 */
export async function migrate(): Promise<void> {
  const sql = readFileSync(join(here, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export interface UserRow {
  id: string;
  account: string;
  password_hash: string;
}

export async function findUser(account: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, account, password_hash FROM users WHERE account_key = lower($1)',
    [account],
  );
  return rows[0] ?? null;
}

export async function createUser(account: string, hash: string): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    'INSERT INTO users (account, password_hash) VALUES ($1, $2) RETURNING id, account, password_hash',
    [account, hash],
  );
  return rows[0]!;
}

/** 帳號上的外觀設定，原樣回傳（驗證交給呼叫的人）。沒設過是 null。 */
export async function appearanceOf(userId: string): Promise<unknown> {
  const { rows } = await pool.query<{ appearance: unknown }>('SELECT appearance FROM users WHERE id = $1', [userId]);
  return rows[0]?.appearance ?? null;
}

export async function saveAppearance(userId: string, appearance: unknown): Promise<void> {
  await pool.query('UPDATE users SET appearance = $2 WHERE id = $1', [userId, JSON.stringify(appearance)]);
}

export async function talentsOf(userId: string): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ talent: string; level: number }>(
    'SELECT talent, level FROM talents WHERE user_id = $1',
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.talent, r.level]));
}

/** 已解鎖的成就，最新的在前——面板要先讓玩家看到剛拿到的那幾項。 */
export async function achievementsOf(userId: string): Promise<UnlockedAchievement[]> {
  const { rows } = await pool.query<{
    achievement: string;
    name: string;
    category: string;
    points: number;
    unlocked_at: Date;
  }>(
    `SELECT achievement, name, category, points, unlocked_at FROM achievements
     WHERE user_id = $1 ORDER BY unlocked_at DESC, achievement`,
    [userId],
  );
  // **點數依現行規則重新定價**，不讀解鎖當下凍結的 points 欄（ADR 0053）。
  // 認不出的舊成就在啟動時就刪掉了（`pruneAchievements`）；萬一還有漏網的算 0。
  const prices = priceOwned(rows.map((r) => ({ id: r.achievement, name: r.name })));
  return rows.map((r) => ({
    id: r.achievement,
    // 舊資料沒有名稱（那兩欄是後補的），退回顯示 id 總比顯示空白好。
    name: r.name === '' ? r.achievement : r.name,
    category: r.category === '' ? '其他' : r.category,
    points: prices.get(r.achievement) ?? 0,
    at: r.unlocked_at.toISOString(),
  }));
}

/**
 * 刪掉現行規則認不出的成就。**每次啟動跑一次**，跟 schema.sql 同一個時間點——
 * 規則改版一定伴隨一次部署，刪除就跟著那次部署發生，出錯時看得到是哪一版。
 *
 * 認不出的是舊規則留下的：特性被拿掉、獎項代碼消失、id 格式改過。刪掉就收回了
 * 它的 AP；餘額因此可能變負，那是刻意的（見 ADR 0053）。每刪一列記一行。
 */
export async function pruneAchievements(): Promise<number> {
  const { rows } = await pool.query<{ user_id: string; achievement: string; name: string }>(
    'SELECT user_id, achievement, name FROM achievements',
  );
  const byUser = new Map<string, { id: string; name: string }[]>();
  for (const r of rows) {
    const list = byUser.get(String(r.user_id)) ?? [];
    list.push({ id: r.achievement, name: r.name });
    byUser.set(String(r.user_id), list);
  }
  let removed = 0;
  for (const [userId, owned] of byUser) {
    for (const [id, price] of priceOwned(owned)) {
      if (price !== null) continue;
      await pool.query('DELETE FROM achievements WHERE user_id = $1 AND achievement = $2', [userId, id]);
      console.warn(`[achievements] 使用者 ${userId} 的舊成就 ${id} 現行規則認不出，已刪除。`);
      removed++;
    }
  }
  return removed;
}

/** 這個帳號有沒有結算過任何一局。「第一段生涯」看它，不看成就表是不是空的。 */
export async function hasFinishedCareer(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ one: number }>(
    'SELECT 1 AS one FROM careers WHERE user_id = $1 AND finished_at IS NOT NULL LIMIT 1',
    [userId],
  );
  return rows.length > 0;
}

/**
 * 各項成就的稀有率（百分比）。分母是**打完過至少一段生涯**的玩家——也就是成就表
 * 裡出現過的帳號；只註冊沒玩過的人不算，否則每一項成就都會被灌成很稀有。
 */
export async function rarityOf(): Promise<ReadonlyMap<string, number>> {
  const players = await pool.query<{ players: string | number }>(
    `SELECT COUNT(DISTINCT user_id) AS players FROM achievements`,
  );
  const total = Number(players.rows[0]?.players ?? 0);
  if (total === 0) return new Map();
  const { rows } = await pool.query<{ achievement: string; holders: string | number }>(
    `SELECT achievement, COUNT(DISTINCT user_id) AS holders FROM achievements GROUP BY achievement`,
  );
  return new Map(rows.map((r) => [r.achievement, (Number(r.holders) / total) * 100]));
}

/**
 * AP 餘額。
 *
 * **算出來的，不是存出來的**：每項成就依現行規則的點數加總，減去買天賦花掉的。
 * 存一個餘額欄位的話，它遲早會與那兩張表對不起來，而對不起來的錢是最難查的 bug。
 *
 * **餘額可以是負的。** 規則改版讓成就變便宜、或舊成就被刪掉之後，花掉的可能比
 * 現在值的多。不自動修正——把餘額夾成 0 會讓玩家的天賦憑空消失，而把 spent 歸零
 * 等於送 AP。天賦照常生效，只是買不了新的，直到新的成就把它補回來（ADR 0053）。
 */
export async function balanceOf(userId: string, spent: number): Promise<{ ap: number; earned: number }> {
  const earned = (await achievementsOf(userId)).reduce((sum, a) => sum + a.points, 0);
  return { ap: earned - spent, earned };
}
