/**
 * 前端與伺服器之間的契約。
 *
 * **兩邊都 import 這一個檔案**——伺服器把引擎打包進去時一併帶走它，因此請求與
 * 回應的形狀不可能各做各的。見 ADR 0007。
 *
 * 這裡只有型別與路徑常數，沒有任何實作：實作在 `http.ts`（前端）與 `server/`
 * （伺服器）。
 */

import type { ReplayLog } from '../engine/game.ts';
import type { TalentLevels } from '../engine/overlay.ts';

/**
 * 一項已經解鎖的成就。
 *
 * 名稱與分類**存在伺服器上**，不是前端從 id 查來的——成就是從生涯推導出來的，
 * 沒有一份靜態目錄可以查。
 */
export interface UnlockedAchievement {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly points: number;
  /** 解鎖的**真實時間**（ISO 字串），不是局內年份——局內時間是循環的。 */
  readonly at: string;
}

/** 目前登入的玩家。未登入時整個物件是 null。 */
export interface Me {
  readonly account: string;
  /** 可花用的 AP 餘額。 */
  readonly ap: number;
  /** 生涯累積拿過的 AP。退款不會減少它——那是「賺過多少」，不是「還剩多少」。 */
  readonly apEarned: number;
  /** 已解鎖的成就，最新的在前。**伺服器是唯一真相**，客戶端算的只拿來顯示。 */
  readonly achievements: readonly UnlockedAchievement[];
  /** 目前買下的天賦與層級。 */
  readonly talents: TalentLevels;
}

/** 開局登記的回應。 */
export interface CareerTicket {
  readonly careerId: string;
  /**
   * 伺服器凍結的天賦組合。
   *
   * **客戶端必須用這一組開局**，不是自己手上那一組——天賦可以退款，兩者會分岔，
   * 而伺服器驗證時用的是凍結的這一組。
   */
  readonly talents: TalentLevels;
}

/** 結算的回應。 */
export interface CareerResult {
  /** 伺服器重跑之後真正認可的新解鎖成就。 */
  readonly unlocked: readonly { readonly id: string; readonly name: string; readonly points: number }[];
  /** 這一局實得的 AP。 */
  readonly gained: number;
  /** 結算後的餘額。 */
  readonly ap: number;
  /**
   * 伺服器重跑的結果與客戶端回報是否一致。
   *
   * 不一致時仍然以伺服器為準，但值得記一筆——那通常代表版本不同步，偶爾代表有人
   * 在改東西。
   */
  readonly verified: boolean;
}

/** 結算的請求。 */
export interface FinishRequest {
  readonly log: ReplayLog;
  /** 客戶端自己算出來的成就 id，只用來比對，不採信。 */
  readonly claimed: readonly string[];
}

/** API 的路徑。前端與伺服器共用，不各寫一份字串。 */
export const API = {
  register: '/api/register',
  login: '/api/login',
  logout: '/api/logout',
  me: '/api/me',
  careers: '/api/careers',
  career: (id: string) => `/api/careers/${id}`,
  talent: (id: string) => `/api/talents/${id}`,
} as const;

/**
 * 進度存放處。
 *
 * 前端只透過這個介面說話，因此換掉實作（HTTP、測試用的假物件、日後的單機版
 * SQLite）不必動介面層。
 */
export interface ProgressStore {
  me(): Promise<Me | null>;
  register(account: string, password: string): Promise<Me>;
  login(account: string, password: string): Promise<Me>;
  logout(): Promise<void>;
  /** 開局登記：凍結當下的天賦組合。 */
  startCareer(): Promise<CareerTicket>;
  /** 結算：上傳重播日誌，伺服器重跑驗證。 */
  finishCareer(careerId: string, body: FinishRequest): Promise<CareerResult>;
  /** 買一級天賦。買不起就丟錯。 */
  buyTalent(id: string): Promise<Me>;
  /** 退掉一個天賦，全額返還 AP。 */
  refundTalent(id: string): Promise<Me>;
}

/** API 回傳的錯誤。訊息是給玩家看的，因此後端要用人話寫。 */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

/**
 * 「根本沒有伺服器」的狀態碼。
 *
 * 與 401（沒登入）**必須分開**：沒登入是「去登入」，連不上是「這個部署沒有帳號
 * 功能」——例如 GitHub Pages 上的純前端版本。兩者在畫面上要說不同的話。
 */
export const OFFLINE = 0;

export const isOffline = (e: unknown): boolean => e instanceof ApiError && e.status === OFFLINE;
