/**
 * 本機開發用的存檔：把假資料庫寫成一個 JSON 檔。
 *
 * 為什麼是 JSON 而不是 SQLite——因為**這裡本來就沒有在跑 SQL**。`FakeDb` 是一張
 * 「看到這句就做這件事」的對照表，資料放在陣列裡；換成 SQLite 等於要再寫一份
 * 方言與正式環境的 Postgres 對齊，多一個會與 `schema.sql` 悄悄走鐘的地方，還多
 * 一個相依。存檔要的只是「重啟後帳號與 AP 還在」，一個檔案就夠了。
 *
 * **它不是資料庫**：沒有交易、沒有並行控制，每次寫入都整份重寫。正式部署跑的是
 * `index.ts` 接真正的 Postgres，這個檔案不會被載入。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FakeDb } from './fakedb.ts';

/** 磁碟上的樣子。日期存 ISO 字串，讀回來時再變回 `Date`。 */
interface Snapshot {
  users: FakeDb['users'];
  talents: FakeDb['talents'];
  achievements: (Omit<FakeDb['achievements'][number], 'unlocked_at'> & { unlocked_at: string })[];
  careers: (Omit<FakeDb['careers'][number], 'finished_at'> & { finished_at: string | null })[];
  careerStats: (Omit<FakeDb['careerStats'][number], 'finished_at'> & { finished_at: string })[];
  nextUserId: number;
}

export class JsonDb extends FakeDb {
  readonly path: string;

  constructor(path: string) {
    super();
    this.path = path;
    this.#load();
  }

  override async query<R>(text: string, values: unknown[] = []): Promise<{ rows: R[] }> {
    const result = await super.query<R>(text, values);
    // 只有寫入才存檔。SELECT 佔了絕大多數，每一句都重寫整個檔案沒有意義。
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(text)) this.save();
    return result;
  }

  /** 整份重寫。先寫暫存檔再改名——中途被 Ctrl-C 砍掉不會留下半個 JSON。 */
  save(): void {
    const snapshot: Snapshot = {
      users: this.users,
      talents: this.talents,
      achievements: this.achievements.map((a) => ({
        ...a,
        unlocked_at: a.unlocked_at.toISOString(),
      })),
      careers: this.careers.map((c) => ({
        ...c,
        finished_at: c.finished_at === null ? null : c.finished_at.toISOString(),
      })),
      careerStats: this.careerStats.map((r) => ({ ...r, finished_at: r.finished_at.toISOString() })),
      nextUserId: this.nextUserId,
    };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    renameSync(tmp, this.path);
  }

  /** 沒有檔案就是一個空的資料庫——第一次跑不該是一個錯誤。 */
  #load(): void {
    if (!existsSync(this.path)) return;
    const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as Snapshot;
    this.users = snapshot.users;
    this.talents = snapshot.talents;
    this.achievements = snapshot.achievements.map((a) => ({
      ...a,
      unlocked_at: new Date(a.unlocked_at),
    }));
    this.careers = snapshot.careers.map((c) => ({
      ...c,
      finished_at: c.finished_at === null ? null : new Date(c.finished_at),
    }));
    // 舊的存檔沒有這一欄——不存在時當成空的，不要讓它變成一個載入錯誤。
    this.careerStats = (snapshot.careerStats ?? []).map((r) => ({
      ...r,
      finished_at: new Date(r.finished_at),
    }));
    this.nextUserId = snapshot.nextUserId;
  }
}
