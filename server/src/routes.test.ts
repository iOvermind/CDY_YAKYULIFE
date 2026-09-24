/**
 * 路由的測試。
 *
 * 跑在假資料庫上（`fakedb.ts`），因此**不需要 Postgres 也驗得到跟錢有關的邏輯**：
 * AP 的加減、「同一項成就只給一次」、開局凍結的天賦是不是真的被拿去重跑。
 *
 * 這裡不測 HTTP 那一層——路由函式收的是使用者物件，不是請求物件，所以直接叫它們
 * 就好。
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { useDb } from './db.ts';
import { FakeDb } from './fakedb.ts';
import { ALL, Game, isPitcherRole, type ReplayLog } from '../../client/src/engine/index.ts';
import {
  finishCareer,
  HttpError,
  ladder,
  login,
  meOf,
  setTalent,
  register,
  startCareer,
} from './routes.ts';

let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
  useDb(db);
});

/** 直接發一筆成就給某個人，讓他有 AP 可以花。 */
function grant(userId: string, id: string, points: number): void {
  db.achievements.push({
    user_id: userId,
    achievement: id,
    name: id,
    category: '測試',
    points,
    unlocked_at: new Date(),
  });
}

/** 打完一整段生涯，回傳重播日誌。永遠選第一個選項。 */
function playToEnd(talents: Record<string, number> = {}): ReplayLog {
  const game = new Game({
    seed: 'test-seed-1',
    name: '測試員',
    startPosition: 'P',
    throws: 'R',
    bats: 'R',
    talents,
  }).start();
  try {
    while (game.flow.prompt !== null) {
      const pick = game.flow.prompt.options[0];
      if (pick === undefined) throw new Error('提問沒有選項');
      game.choose(pick.id);
    }
    return game.toReplayLog();
  } finally {
    game.dispose();
  }
}

/**
 * 打完一局，而且**真的打上頂級聯盟**。
 *
 * `playToEnd()` 一律選第一個選項，也就是把點數全投進體力——那種球員上不了
 * 一軍，天梯一列都不會寫（那是對的，不是漏算）。天梯的測試需要一個有頂級
 * 聯盟成績的樣本，所以這裡把點數投進真正影響評價的能力。
 *
 * 種子由 `playSeed` 依序試出來：第一個打上頂級聯盟的就是它。
 *
 * **連 `claimed` 一起回傳**：那是客戶端真正會送的東西（`App.tsx` 送的是
 * `game.achievements.list` 的 id）。傳空陣列的話 `verified` 必然是 false，
 * 而天梯只收 verified 的生涯——測試就會量到一個假的失敗。
 */
function playStrong(): { log: ReplayLog; claimed: string[] } {
  // **種子不寫死**：引擎一改抽取順序，原本挑好的那一顆就可能打不上頂級聯盟（ADR 0002
  // 跨版本不保證重現）。依序試，第一個打上去的就是它——結果仍然是確定的。
  for (let i = 0; i < 50; i++) {
    const played = playSeed(`srv-${i}`);
    if (played !== null) return played;
  }
  throw new Error('五十顆種子沒有一顆打上頂級聯盟');
}

function playSeed(seed: string): { log: ReplayLog; claimed: string[] } | null {
  const game = new Game({
    seed,
    name: '測試員',
    startPosition: 'SS',
    throws: 'R',
    bats: 'R',
  }).start();
  try {
    while (game.flow.prompt !== null) {
      const usable = game.flow.prompt.options.filter(
        (o) => o.disabled !== true && o.id !== 'alloc:undo',
      );
      const pick =
        ['con', 'pow', 'eye', 'spd', 'rng', 'fld']
          .map((k) => usable.find((o) => o.id === `alloc:${k}`))
          .find((o) => o !== undefined) ??
        usable.find((o) => o.id === 'alloc:confirm') ??
        usable[0];
      if (pick === undefined) throw new Error('提問沒有選項');
      game.choose(pick.id);
    }
    if ((game.summary?.leagues.length ?? 0) === 0) return null;
    return {
      log: game.toReplayLog(),
      claimed: (game.achievements?.list ?? []).map((a) => a.id),
    };
  } finally {
    game.dispose();
  }
}

describe('註冊', () => {
  it('註冊即通過，不驗證任何東西', async () => {
    const user = await register('Overmind', 'hunter2');
    assert.equal(user.account, 'Overmind');
    // 存進去的一定是雜湊。
    assert.ok(!user.password_hash.includes('hunter2'));
  });

  it('帳號不能重複，而且大小寫算同一個', async () => {
    await register('Overmind', 'hunter2');
    await assert.rejects(() => register('overmind', 'other'), (e: HttpError) => e.status === 409);
  });

  it('太短的帳號與密碼擋下', async () => {
    await assert.rejects(() => register('a', 'hunter2'), (e: HttpError) => e.status === 400);
    await assert.rejects(() => register('someone', '123'), (e: HttpError) => e.status === 400);
  });
});

describe('登入', () => {
  it('帳號不存在與密碼錯誤回同一句話——分開講等於送人一份帳號清單', async () => {
    await register('Overmind', 'hunter2');
    const wrongPassword = await login('Overmind', 'nope').catch((e: HttpError) => e);
    const noSuchUser = await login('nobody', 'nope').catch((e: HttpError) => e);
    assert.equal((wrongPassword as HttpError).message, (noSuchUser as HttpError).message);
    assert.equal((wrongPassword as HttpError).status, 401);
  });

  it('大小寫不同也登得進去', async () => {
    await register('Overmind', 'hunter2');
    assert.equal((await login('OVERMIND', 'hunter2')).account, 'Overmind');
  });
});

describe('天賦', () => {
  it('AP 不夠買不下去', async () => {
    const user = await register('Overmind', 'hunter2');
    await assert.rejects(() => setTalent(user, 'gifted', 1), (e: HttpError) => e.status === 409);
  });

  it('買下去會扣掉 AP，餘額是算出來的', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 100);
    assert.equal((await meOf(user)).ap, 100);

    const after = await setTalent(user, 'gifted', 1); // 第一級 10 點
    assert.equal(after.talents['gifted'], 1);
    assert.equal(after.ap, 90);
    // 賺過多少不會因為花掉而變少。
    assert.equal(after.apEarned, 100);
  });

  it('每一級各收各的價，不是重收一次全部', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 100);
    await setTalent(user, 'gifted', 1); // Lv1：10
    const after = await setTalent(user, 'gifted', 2); // Lv2 再收 24，累積 34
    assert.equal(after.talents['gifted'], 2);
    assert.equal(after.ap, 100 - 34);
  });

  it('一次跳兩級收的是累積價，跟一級一級點一樣', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 100);
    const after = await setTalent(user, 'gifted', 2);
    assert.equal(after.talents['gifted'], 2);
    assert.equal(after.ap, 100 - 34);
  });

  it('重送同一個級數不會再扣一次', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 100);
    await setTalent(user, 'gifted', 2);
    const again = await setTalent(user, 'gifted', 2);
    assert.equal(again.talents['gifted'], 2);
    assert.equal(again.ap, 100 - 34);
  });

  it('降級退的是差價，不是全部', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 100);
    await setTalent(user, 'gifted', 2); // 花掉 34
    const down = await setTalent(user, 'gifted', 1); // 退回 Lv2 的 24
    assert.equal(down.talents['gifted'], 1);
    assert.equal(down.ap, 90);
  });

  it('點滿之後買不下去', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 999);
    await setTalent(user, 'gifted', 3); // 三級滿
    await assert.rejects(() => setTalent(user, 'gifted', 4), (e: HttpError) => e.status === 409);
  });

  it('級數不是零或正整數就回 400', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 999);
    await assert.rejects(() => setTalent(user, 'gifted', -1), (e: HttpError) => e.status === 400);
    await assert.rejects(() => setTalent(user, 'gifted', 1.5), (e: HttpError) => e.status === 400);
    await assert.rejects(() => setTalent(user, 'gifted', NaN), (e: HttpError) => e.status === 400);
  });

  it('不存在的天賦回 404，不是默默寫進去', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 999);
    await assert.rejects(() => setTalent(user, '不存在', 1), (e: HttpError) => e.status === 404);
  });

  it('退到零是全額，而且退完可以再買一次', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 100);
    await setTalent(user, 'gifted', 2); // 花掉 10 + 24 = 34

    const refunded = await setTalent(user, 'gifted', 0);
    assert.equal(refunded.ap, 100);
    assert.equal(refunded.talents['gifted'], undefined);

    assert.equal((await setTalent(user, 'gifted', 1)).ap, 90);
  });
});

describe('開局登記', () => {
  it('凍結當下的天賦組合', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 30);
    await setTalent(user, 'gifted', 1);

    const ticket = await startCareer(user);
    assert.deepEqual(ticket.talents, { gifted: 1 });

    // 登記之後退掉天賦，凍結的那一份不受影響——否則玩家可以開局帶著天賦、
    // 中途退掉換 AP，兩邊都拿。
    await setTalent(user, 'gifted', 0);
    assert.deepEqual(db.careers[0]?.talents, { gifted: 1 });
  });
});

describe('結算', () => {
  it('伺服器重跑之後成就與 AP 才入帳', async () => {
    const user = await register('Overmind', 'hunter2');
    const ticket = await startCareer(user);
    const log = playToEnd();

    const result = await finishCareer(user, ticket.careerId, { log, claimed: [] });

    assert.ok(result.unlocked.length > 0, '一段完整的生涯至少該解鎖一項成就');
    assert.equal(
      result.gained,
      result.unlocked.reduce((sum, a) => sum + a.points, 0),
    );
    assert.equal(result.ap, result.gained);
    // 客戶端回報的是空的，伺服器算出來的不是——因此比對不通過。
    assert.equal(result.verified, false);
    // 名稱與分類要存下來，前端才有東西可以顯示。
    assert.ok(db.achievements.every((a) => a.name !== '' && a.category !== ''));
  });

  it('客戶端算的與伺服器一致時標記為已驗證', async () => {
    const user = await register('Overmind', 'hunter2');
    const ticket = await startCareer(user);
    const log = playToEnd();

    // 客戶端的算法與伺服器同一份，因此照著跑一次就會得到同一組 id。
    const local = Game.replay(log);
    const claimed = (local.achievements?.list ?? []).map((a) => a.id);
    local.dispose();

    const result = await finishCareer(user, ticket.careerId, { log, claimed });
    assert.equal(result.verified, true);
  });

  it('同一項成就只給一次 AP——第二段生涯不會重複入帳', async () => {
    const user = await register('Overmind', 'hunter2');

    const first = await finishCareer(user, (await startCareer(user)).careerId, {
      log: playToEnd(),
      claimed: [],
    });
    assert.ok(first.gained > 0);

    // 同一顆種子、同一串選擇＝同一段人生，因此成就完全一樣。
    const second = await finishCareer(user, (await startCareer(user)).careerId, {
      log: playToEnd(),
      claimed: [],
    });
    assert.equal(second.gained, 0);
    assert.equal(second.unlocked.length, 0);
    assert.equal(second.ap, first.ap);
  });

  it('同一局不能結算兩次', async () => {
    const user = await register('Overmind', 'hunter2');
    const ticket = await startCareer(user);
    const log = playToEnd();
    await finishCareer(user, ticket.careerId, { log, claimed: [] });
    await assert.rejects(
      () => finishCareer(user, ticket.careerId, { log, claimed: [] }),
      (e: HttpError) => e.status === 409,
    );
  });

  it('別人的局結算不了', async () => {
    const owner = await register('Overmind', 'hunter2');
    const thief = await register('Someone', 'hunter2');
    const ticket = await startCareer(owner);
    await assert.rejects(
      () => finishCareer(thief, ticket.careerId, { log: playToEnd(), claimed: [] }),
      (e: HttpError) => e.status === 404,
    );
  });

  it('用登記時凍結的天賦重跑，不是日誌裡寫的那一組', async () => {
    const user = await register('Overmind', 'hunter2');
    grant(user.id, 'test:rich', 100);
    await setTalent(user, 'gifted', 3); // 凍結 Lv3，累積 84
    const ticket = await startCareer(user);

    // 客戶端謊報成「我沒有天賦」，伺服器仍該用 Lv3 重跑。
    await finishCareer(user, ticket.careerId, {
      log: { ...playToEnd({ gifted: 3 }), setup: { ...playToEnd().setup, talents: {} } },
      claimed: [],
    });
    const stored = db.careers[0];
    assert.deepEqual(stored?.talents, { gifted: 3 });
    assert.equal(stored?.finished_at !== null, true);
  });

  it('壞掉的日誌不入帳，而是回 400', async () => {
    const user = await register('Overmind', 'hunter2');
    const ticket = await startCareer(user);
    const log = playToEnd();
    const broken: ReplayLog = { ...log, choices: [...log.choices, '不存在的選項'] };

    await assert.rejects(
      () => finishCareer(user, ticket.careerId, { log: broken, claimed: [] }),
      (e: HttpError) => e.status === 400,
    );
    assert.equal(db.achievements.length, 0);
  });
});

describe('天梯', () => {
  /** 打完一局並結算，回傳那一局的 id。 */
  async function finish(account: string) {
    const user = await register(account, 'hunter2');
    const ticket = await startCareer(user);
    const played = playStrong();
    await finishCareer(user, ticket.careerId, played);
    return user;
  }

  /** 跨聯盟、跨守位、累計——一段打過頂級聯盟的生涯一定有這一格。 */
  const TOTAL = { org: ALL, position: ALL, kind: 'total' } as const;

  it('結算會寫下每個打過的組合', async () => {
    const user = await finish('Overmind');
    const mine = db.ladderRows.filter((r) => r.user_id === user.id);
    assert.ok(mine.length > 0, '一列都沒寫');
    assert.ok(mine.some((r) => r.org === ALL && r.position === ALL && r.kind === 'total'));
    assert.ok(mine.some((r) => r.org === ALL && r.position === ALL && r.kind === 'best'));
    // 每一列都帶著引擎版本與姓名，榜上才寫得出這是誰、哪一版的規則。
    for (const row of mine) {
      assert.ok(row.engine_version > 0);
      assert.equal(row.player_name, '測試員');
    }
  });

  it('驗證失敗的生涯不進榜', async () => {
    const user = await register('Overmind', 'hunter2');
    const ticket = await startCareer(user);
    // 客戶端謊報成就清單，伺服器算出來的與它對不上 → verified = false。
    await finishCareer(user, ticket.careerId, {
      log: playStrong().log,
      claimed: ['這個成就不存在'],
    });
    assert.equal(db.careers[0]?.verified, false);
    assert.equal(db.ladderRows.length, 0);
  });

  it('個人天梯只看自己，全伺服器天梯看所有人', async () => {
    const a = await finish('Overmind');
    await finish('Someone');
    assert.ok(db.ladderRows.some((r) => r.user_id !== a.id), '第二個人沒有寫進去');

    const mine = await ladder(a, TOTAL, true);
    const all = await ladder(a, TOTAL, false);
    const accountsOf = (r: Awaited<ReturnType<typeof ladder>>) =>
      new Set(r.boards.flatMap((b) => b.entries.map((e) => e.account)));

    assert.deepEqual([...accountsOf(mine)], ['Overmind']);
    assert.ok(accountsOf(all).has('Someone'));
  });

  it('沒登入也看得到全伺服器天梯，但個人天梯要有身分', async () => {
    await finish('Overmind');
    const all = await ladder(null, TOTAL, false);
    assert.ok(all.boards.length > 0);
    await assert.rejects(
      () => ladder(null, TOTAL, true),
      (e: HttpError) => e.status === 401,
    );
  });

  it('名次從 1 起算，而且照欄位的方向排', async () => {
    await finish('Overmind');
    const res = await ladder(null, TOTAL, false);
    for (const board of res.boards) {
      assert.deepEqual(
        board.entries.map((e) => e.rank),
        board.entries.map((_, i) => i + 1),
      );
    }
  });

  /**
   * **守位決定畫哪幾張表**：跨守位畫野手、投手與共通三張，野手守位只畫野手與共通，
   * 投手定位只畫投手與共通。共通那一張是份額、評價分、薪水。
   */
  it('跨守位有三張表，指定守位只有那一側與共通', async () => {
    const user = await finish('Overmind');
    const sides = (r: Awaited<ReturnType<typeof ladder>>) => new Set(r.boards.map((b) => b.side));

    const whole = sides(await ladder(user, TOTAL, true));
    assert.ok(whole.has('shared'));

    const fielding = db.ladderRows.find((r) => r.position !== ALL && !isPitcherRole(r.position));
    if (fielding !== undefined) {
      const got = sides(await ladder(user, { org: fielding.org, position: fielding.position, kind: 'total' }, true));
      assert.ok(!got.has('pitcher'), '野手守位不該畫投手表');
      assert.ok(got.has('shared'));
    }
  });

  it('共通那一張排得出評價分與薪水', async () => {
    const user = await finish('Overmind');
    const res = await ladder(user, TOTAL, true);
    const columns = new Set(res.boards.filter((b) => b.side === 'shared').map((b) => b.column));
    for (const key of ['ws', 'ls', 'score', 'salary']) assert.ok(columns.has(key), `少了 ${key}`);
    // 跨聯盟跨守位累計的薪水是生涯淨收入——一段打過職業的生涯不會是 0。
    const salary = res.boards.find((b) => b.side === 'shared' && b.column === 'salary');
    assert.ok((salary?.entries[0]?.value ?? 0) > 0);
  });

  it('組合清單只列寫過的——不多也不少', async () => {
    const user = await finish('Overmind');
    const res = await ladder(user, TOTAL, true);
    const key = (c: { org: string; position: string; kind: string }) => `${c.org}|${c.position}|${c.kind}`;
    const written = new Set(db.ladderRows.filter((r) => r.user_id === user.id).map(key));
    const listed = new Set(res.combos.map(key));
    assert.deepEqual([...listed].sort(), [...written].sort());
  });

  /**
   * **去過的聯盟一個都不能漏**。
   *
   * 範圍清單曾經拿 `leagues.org_names` 的鍵去排序過濾，而那張表是「旅日／旅美」這種
   * 體系用語的**覆蓋表**，韓職、墨聯、澳職不在裡面——成績有寫進去，玩家卻永遠看不
   * 到。順序改讀 `top_league_names`，跨聯盟放最前。
   */
  it('韓職、墨聯、澳職也在組合清單裡，而且跨聯盟排最前', async () => {
    const user = await finish('Overmind');
    // 直接補幾列：走完整局才進得了那三個聯盟，而這裡要測的是清單怎麼算出來的。
    const seed = db.ladderRows[0];
    assert.ok(seed !== undefined);
    for (const org of ['KBO', 'LMB', 'ABL']) db.ladderRows.push({ ...seed, org, position: ALL, kind: 'total' });

    const res = await ladder(user, TOTAL, true);
    for (const org of ['KBO', 'LMB', 'ABL']) {
      assert.ok(res.combos.some((c) => c.org === org), `少掉了 ${org}`);
    }
    assert.equal(res.combos[0]?.org, ALL);
  });
});
