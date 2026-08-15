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
  return rows.map((r) => ({
    id: r.achievement,
    // 舊資料沒有名稱（那兩欄是後補的），退回顯示 id 總比顯示空白好。
    name: r.name === '' ? r.achievement : r.name,
    category: r.category === '' ? '其他' : r.category,
    points: r.points,
    at: r.unlocked_at.toISOString(),
  }));
}

/**
 * AP 餘額。
 *
 * **算出來的，不是存出來的**：賺到的總和減去買天賦花掉的。存一個餘額欄位的話，
 * 它遲早會與那兩張表對不起來，而對不起來的錢是最難查的 bug。
 */
export async function balanceOf(userId: string, spent: number): Promise<{ ap: number; earned: number }> {
  const { rows } = await pool.query<{ earned: string }>(
    'SELECT COALESCE(SUM(points), 0) AS earned FROM achievements WHERE user_id = $1',
    [userId],
  );
  const earned = Number(rows[0]?.earned ?? 0);
  return { ap: earned - spent, earned };
}
