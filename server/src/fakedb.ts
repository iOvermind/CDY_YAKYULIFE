/**
 * 測試用的假資料庫。
 *
 * 只實作路由真正用到的那十來條查詢——**這不是一個 SQL 引擎**，是一張「看到這句
 * 就做這件事」的對照表。查詢字串一改，這裡就要跟著改，那是刻意的：路由偷偷多打
 * 一條 SQL 時，測試會直接炸掉而不是靜靜地回空陣列。
 *
 * 有了它，AP 的加減、「同一項成就只給一次」、開局凍結天賦這些**跟錢有關的邏輯**
 * 不必等到有 Postgres 才驗得到。
 */

import type { Queryable } from './db.ts';

interface AchievementRow {
  user_id: string;
  achievement: string;
  name: string;
  category: string;
  points: number;
  unlocked_at: Date;
}

interface CareerRow {
  id: string;
  user_id: string;
  talents: Record<string, number>;
  log: unknown;
  verified: boolean | null;
  ap_gained: number | null;
  finished_at: Date | null;
}

export class FakeDb implements Queryable {
  users: { id: string; account: string; password_hash: string }[] = [];
  achievements: AchievementRow[] = [];
  talents: { user_id: string; talent: string; level: number }[] = [];
  careers: CareerRow[] = [];
  /** 每一句跑過的 SQL，讓測試可以斷言「真的有寫進去」。 */
  seen: string[] = [];
  /**
   * 下一個使用者編號。
   *
   * 公開是為了讓存檔用的子類別（`devdb.ts`）能把它一起還原——不還原的話，重啟
   * 之後第二個註冊的人會拿到 `1`，撞上磁碟裡已經存在的那個人。
   */
  nextUserId = 1;

  async query<R>(text: string, values: unknown[] = []): Promise<{ rows: R[] }> {
    this.seen.push(text);
    return { rows: this.#run(text, values) as R[] };
  }

  async connect() {
    // 假的交易：沒有 rollback。測試關心的是「寫了什麼」，不是原子性——
    // 原子性由 Postgres 保證，不由這裡。
    return {
      query: async (text: string, values: unknown[] = []) => {
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(text)) return { rows: [] };
        return this.query(text, values);
      },
      release: () => {},
    };
  }

  #run(sql: string, v: unknown[]): unknown[] {
    const s = sql.replace(/\s+/g, ' ').trim();

    // 建表是 Postgres 的事。這裡的資料放在陣列裡，schema 沒有意義。
    if (/^(CREATE|ALTER|--)/i.test(s)) return [];

    if (s.startsWith('SELECT id, account, password_hash FROM users WHERE account_key')) {
      const key = String(v[0]).toLowerCase();
      return this.users.filter((u) => u.account.toLowerCase() === key);
    }
    if (s.startsWith('SELECT id, account, password_hash FROM users WHERE id')) {
      return this.users.filter((u) => u.id === String(v[0]));
    }
    if (s.startsWith('INSERT INTO users')) {
      const row = {
        id: String(this.nextUserId++),
        account: String(v[0]),
        password_hash: String(v[1]),
      };
      this.users.push(row);
      return [row];
    }
    if (s.startsWith('SELECT talent, level FROM talents')) {
      return this.talents.filter((t) => t.user_id === String(v[0]));
    }
    if (s.startsWith('INSERT INTO talents')) {
      const [userId, talent, level] = [String(v[0]), String(v[1]), Number(v[2])];
      const existing = this.talents.find((t) => t.user_id === userId && t.talent === talent);
      if (existing === undefined) this.talents.push({ user_id: userId, talent, level });
      else existing.level = level;
      return [];
    }
    if (s.startsWith('DELETE FROM talents')) {
      this.talents = this.talents.filter(
        (t) => !(t.user_id === String(v[0]) && t.talent === String(v[1])),
      );
      return [];
    }
    if (s.startsWith('SELECT achievement, name, category, points, unlocked_at')) {
      return this.achievements
        .filter((a) => a.user_id === String(v[0]))
        .sort((a, b) => b.unlocked_at.getTime() - a.unlocked_at.getTime());
    }
    if (s.startsWith('SELECT COALESCE(SUM(points)')) {
      const earned = this.achievements
        .filter((a) => a.user_id === String(v[0]))
        .reduce((sum, a) => sum + a.points, 0);
      return [{ earned: String(earned) }];
    }
    if (s.startsWith('INSERT INTO achievements')) {
      const [userId, id] = [String(v[0]), String(v[1])];
      // ON CONFLICT DO NOTHING：**同一項成就只給一次 AP**，這一行就是那個保證。
      if (this.achievements.some((a) => a.user_id === userId && a.achievement === id)) return [];
      this.achievements.push({
        user_id: userId,
        achievement: id,
        name: String(v[2]),
        category: String(v[3]),
        points: Number(v[4]),
        unlocked_at: new Date(),
      });
      return [];
    }
    if (s.startsWith('INSERT INTO careers')) {
      this.careers.push({
        id: String(v[0]),
        user_id: String(v[1]),
        talents: JSON.parse(String(v[2])) as Record<string, number>,
        log: null,
        verified: null,
        ap_gained: null,
        finished_at: null,
      });
      return [];
    }
    if (s.startsWith('SELECT talents, finished_at FROM careers')) {
      return this.careers.filter((c) => c.id === String(v[0]) && c.user_id === String(v[1]));
    }
    if (s.startsWith('UPDATE careers SET')) {
      const career = this.careers.find((c) => c.id === String(v[3]));
      if (career !== undefined) {
        career.log = JSON.parse(String(v[0]));
        career.verified = Boolean(v[1]);
        career.ap_gained = Number(v[2]);
        career.finished_at = new Date();
      }
      return [];
    }
    throw new Error(`假資料庫不認得這句 SQL，請補上：${s}`);
  }
}
