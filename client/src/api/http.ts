/**
 * 契約的 HTTP 實作。
 *
 * 前端與 API **同源**（見 ADR 0007），因此不必處理 CORS，session 也走
 * HttpOnly cookie——那是唯一頁面上的 JavaScript 讀不到的存法，XSS 偷不走。
 * `credentials: 'same-origin'` 是預設值，這裡寫出來是為了讓那個決定看得見。
 */

import {
  API,
  ApiError,
  type CareerResult,
  type CareerTicket,
  type Me,
  type ProgressStore,
} from './contract.ts';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> =
    init.body === undefined ? {} : { 'content-type': 'application/json' };
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', headers, ...init });
  } catch {
    throw new ApiError(0, '連不上伺服器。');
  }
  if (res.status === 204) return undefined as T;

  /**
   * 沒有 API 的部署（例如 GitHub Pages）會把 `/api/*` 交給單頁應用的 fallback，
   * 於是回傳 200 與一整份 index.html。**不檢查型別的話那份 HTML 會被當成登入
   * 成功的回應**，畫面就會顯示成登入了卻什麼都沒有。
   */
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new ApiError(0, '這個版本沒有連上伺服器，帳號與成就功能無法使用。');
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body !== null && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : '伺服器沒有回應，請稍後再試。';
    throw new ApiError(res.status, message);
  }
  return body as T;
}

const post = <T>(path: string, data?: unknown): Promise<T> =>
  call<T>(path, data === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(data) });

export const httpProgress: ProgressStore = {
  /** 未登入時伺服器回 401，那不是錯誤，是「還沒登入」。 */
  async me(): Promise<Me | null> {
    try {
      return await call<Me>(API.me);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  register: (account, password) => post<Me>(API.register, { account, password }),
  login: (account, password) => post<Me>(API.login, { account, password }),
  logout: () => post<void>(API.logout),
  startCareer: () => post<CareerTicket>(API.careers),
  finishCareer: (careerId, body) => post<CareerResult>(API.career(careerId), body),
  setTalent: (id, level) =>
    call<Me>(API.talent(id), { method: 'PUT', body: JSON.stringify({ level }) }),
};
