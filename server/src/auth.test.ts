/**
 * 帳號與 session 的測試。
 *
 * 走 Node 內建的測試執行器——伺服器只有一個相依（`pg`），不值得為了測試再拉一個
 * 框架進來。
 *
 *     npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hashPassword,
  readCookie,
  readSession,
  sessionCookie,
  signSession,
  verifyPassword,
} from './auth.ts';

describe('密碼', () => {
  it('雜湊裡不會出現明文', async () => {
    const stored = await hashPassword('hunter2');
    assert.ok(!stored.includes('hunter2'));
    assert.ok(stored.startsWith('scrypt$'));
  });

  it('正確的密碼通過，錯的擋下', async () => {
    const stored = await hashPassword('hunter2');
    assert.equal(await verifyPassword('hunter2', stored), true);
    assert.equal(await verifyPassword('hunter3', stored), false);
    assert.equal(await verifyPassword('', stored), false);
  });

  it('同一個密碼每次的雜湊都不同——salt 是隨機的', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('same', a), true);
    assert.equal(await verifyPassword('same', b), true);
  });

  it('不認得的雜湊格式一律不通過，而不是拋錯', async () => {
    // 舊資料或被改過的資料不該讓整個登入流程炸掉。
    assert.equal(await verifyPassword('x', 'sha256$aa$bb'), false);
    assert.equal(await verifyPassword('x', '亂寫的東西'), false);
    assert.equal(await verifyPassword('x', ''), false);
  });
});

describe('session', () => {
  it('簽出來的讀得回來', () => {
    assert.equal(readSession(signSession('42')), '42');
  });

  it('被竄改的簽章擋下——不然任何人都能假冒別的帳號', () => {
    const token = signSession('42');
    assert.equal(readSession(token.slice(0, -2) + 'xx'), null);
    // 換掉 payload 裡的使用者 id，簽章就對不上。
    const forged = token.replace(/^42\./, '43.');
    assert.equal(readSession(forged), null);
  });

  it('缺席或亂寫都回 null，不拋錯', () => {
    assert.equal(readSession(undefined), null);
    assert.equal(readSession('亂寫'), null);
    assert.equal(readSession(''), null);
  });

  it('過期的擋下', () => {
    // 直接偽造一個過期的 payload——簽章對得上，但時間過了。
    const expired = signSession('42').replace(/\.\d+\./, '.1.');
    assert.equal(readSession(expired), null);
  });
});

describe('cookie', () => {
  it('從一串 Cookie 標頭裡挑得出來', () => {
    assert.equal(readCookie('a=1; session=abc; b=2', 'session'), 'abc');
    assert.equal(readCookie('a=1', 'session'), undefined);
    assert.equal(readCookie(undefined, 'session'), undefined);
  });

  it('一定是 HttpOnly 與 SameSite——XSS 偷不走才是重點', () => {
    const cookie = sessionCookie('token');
    assert.ok(cookie.includes('HttpOnly'));
    assert.ok(cookie.includes('SameSite=Lax'));
  });

  it('登出會把 cookie 清掉', () => {
    assert.ok(sessionCookie(null).includes('Max-Age=0'));
  });
});
