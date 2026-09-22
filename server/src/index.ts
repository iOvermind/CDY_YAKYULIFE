/**
 * HTTP 伺服器：同一個行程服務靜態前端與 `/api`。
 *
 * **同源**是刻意的（見 ADR 0007）：沒有 CORS，session 可以走 HttpOnly cookie，
 * 而且前端與伺服器端的引擎永遠是同一份建置——ADR 0002 說「跨版本不保證重現」，
 * 這個架構讓那個風險不存在。
 *
 * 用 `node:http` 而不是框架：路由只有七條，一個框架換不到東西，卻多一個會過期的
 * 相依。
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { API } from '../../client/src/api/contract.ts';
import { readCookie, readSession, sessionCookie, signSession } from './auth.ts';
import { migrate, pool, type UserRow } from './db.ts';
import { CAREER_SCOPE } from '../../client/src/engine/index.ts';
import {
  finishCareer,
  HttpError,
  ladder,
  login,
  meOf,
  register,
  setTalent,
  startCareer,
} from './routes.ts';

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = process.env.STATIC_DIR ?? join(process.cwd(), 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res: ServerResponse, status: number, body: unknown, cookie?: string): void {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (cookie !== undefined) headers['set-cookie'] = cookie;
  res.writeHead(status, headers);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // 重播日誌可以很長（一段生涯上千個選擇），但也不該無上限。
    if (size > 4_000_000) throw new HttpError(413, '資料太大了。');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, '請求的格式不對。');
  }
}

/** 目前登入的使用者。沒登入回 null。 */
async function currentUser(req: IncomingMessage): Promise<UserRow | null> {
  const userId = readSession(readCookie(req.headers.cookie, 'session'));
  if (userId === null) return null;
  const { rows } = await pool.query<UserRow>(
    'SELECT id, account, password_hash FROM users WHERE id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

/** 需要登入的路由統一走這裡。 */
async function requireUser(req: IncomingMessage): Promise<UserRow> {
  const user = await currentUser(req);
  if (user === null) throw new HttpError(401, '請先登入。');
  return user;
}

/**
 * 重跑驗證的序列化閘門。
 *
 * **覆蓋層是全域可變狀態**（見 ADR 0007）：同一時間只能有一局套著天賦覆蓋。
 * 這個 Promise 鏈讓結算請求一個一個來——這個規模不需要更聰明的東西，而少了它
 * 兩個同時結算的請求會互相污染對方的規則資料。
 */
let verifyQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = verifyQueue.then(task, task);
  verifyQueue = run.catch(() => undefined);
  return run;
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === API.register && method === 'POST') {
    const body = await readBody(req);
    const user = await register(String(body.account ?? ''), String(body.password ?? ''));
    send(res, 200, await meOf(user), sessionCookie(signSession(user.id)));
    return;
  }
  if (path === API.login && method === 'POST') {
    const body = await readBody(req);
    const user = await login(String(body.account ?? ''), String(body.password ?? ''));
    send(res, 200, await meOf(user), sessionCookie(signSession(user.id)));
    return;
  }
  if (path === API.logout && method === 'POST') {
    send(res, 204, undefined, sessionCookie(null));
    return;
  }
  if (path === API.me && method === 'GET') {
    send(res, 200, await meOf(await requireUser(req)));
    return;
  }
  if (path === API.careers && method === 'POST') {
    send(res, 200, await startCareer(await requireUser(req)));
    return;
  }
  if (path.startsWith('/api/careers/') && method === 'POST') {
    const user = await requireUser(req);
    const id = path.slice('/api/careers/'.length);
    const body = await readBody(req);
    send(
      res,
      200,
      await serialize(() =>
        finishCareer(user, id, {
          log: body.log as never,
          claimed: (body.claimed as string[]) ?? [],
        }),
      ),
    );
    return;
  }
  // 天梯。**全伺服器天梯不必登入也看得到**——它是這台服務的門面；個人天梯要有身分。
  if (path === '/api/ladder' && method === 'GET') {
    const scope = url.searchParams.get('scope') ?? CAREER_SCOPE;
    const self = url.searchParams.get('self') === '1';
    send(res, 200, await ladder(await currentUser(req), scope, self));
    return;
  }
  if (path.startsWith('/api/talents/')) {
    const user = await requireUser(req);
    const id = path.slice('/api/talents/'.length);
    if (method === 'PUT') {
      const body = await readBody(req);
      send(res, 200, await setTalent(user, id, Number(body.level)));
      return;
    }
  }
  throw new HttpError(404, '沒有這個路徑。');
}

/** 靜態檔。找不到就回 index.html——單頁應用的慣例。 */
function serveStatic(res: ServerResponse, pathname: string): void {
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(STATIC_DIR, rel);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('找不到前端檔案。請先建置 client 並把 dist 放到 STATIC_DIR。');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) {
    serveStatic(res, url.pathname);
    return;
  }
  api(req, res, url).catch((e: unknown) => {
    if (e instanceof HttpError) {
      send(res, e.status, { error: e.message });
      return;
    }
    console.error('[api]', e);
    send(res, 500, { error: '伺服器出了點問題。' });
  });
});

await migrate();
server.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`));
