/**
 * 帳號與 session。
 *
 * **零第三方相依**：密碼用 `node:crypto` 的 scrypt（記憶體困難的 KDF，正是密碼
 * 該用的東西），session 用 HMAC 簽章的 cookie。argon2 更好，但要編譯原生模組；
 * scrypt 是內建的、規格明確的，而且對這個規模綽綽有餘。
 *
 * **絕不用 SHA-256 存密碼**——它快到可以每秒試幾十億次。
 */

import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

/** scrypt 的參數。N 越大越慢也越安全；16384 是常見的下限。 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

/**
 * `promisify(scrypt)` 會挑到不帶 options 的多載，因此自己包一層——那些參數正是
 * 這個函式的重點，不能讓型別把它們吃掉。
 */
function scryptAsync(password: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, SCRYPT, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** session 的有效期。 */
const SESSION_DAYS = 30;

/** 雜湊一個密碼，回傳可以直接存進資料庫的字串。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, SCRYPT.keylen);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

/**
 * 驗證密碼。
 *
 * 用 `timingSafeEqual` 比對——一般的 `===` 會在第一個不同的位元組就回傳，那個
 * 時間差可以被拿來一個位元組一個位元組地猜。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || hex === undefined) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * session 的簽章金鑰。
 *
 * 沒有設環境變數時**隨機產生一把**——那會讓伺服器重啟後所有人被登出，但那遠好過
 * 內建一把寫死的金鑰：寫死的金鑰等於任何讀過原始碼的人都能偽造 session。
 */
const SECRET = process.env.SESSION_SECRET ?? randomBytes(32).toString('hex');
if (process.env.SESSION_SECRET === undefined) {
  console.warn('[auth] 沒有設定 SESSION_SECRET，本次啟動使用隨機金鑰——重啟後所有人會被登出。');
}

/** 簽一張 session。內容只有使用者 id 與到期時間，沒有任何機密。 */
export function signSession(userId: string): string {
  const payload = `${userId}.${Date.now() + SESSION_DAYS * 86400_000}`;
  const mac = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

/** 驗一張 session，回傳使用者 id；無效或過期回 null。 */
export function readSession(token: string | undefined): string | null {
  if (token === undefined) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [userId, expiry] = payload.split('.');
  if (userId === undefined || expiry === undefined) return null;
  if (Number(expiry) < Date.now()) return null;
  return userId;
}

/**
 * session cookie。
 *
 * **HttpOnly**：頁面上的 JavaScript 讀不到，XSS 偷不走。
 * **SameSite=Lax**：擋掉跨站送出的請求。
 * **Secure**：只走 HTTPS（本機開發時關掉）。
 */
export function sessionCookie(token: string | null): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  if (token === null) {
    return `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
  }
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

/** 從 Cookie 標頭裡挑出 session。 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

export const newCareerId = (): string => randomUUID();
