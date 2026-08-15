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

const here = dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
});

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

export async function achievementsOf(userId: string): Promise<{ id: string; points: number }[]> {
  const { rows } = await pool.query<{ achievement: string; points: number }>(
    'SELECT achievement, points FROM achievements WHERE user_id = $1',
    [userId],
  );
  return rows.map((r) => ({ id: r.achievement, points: r.points }));
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
