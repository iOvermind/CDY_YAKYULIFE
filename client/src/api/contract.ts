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
  /**
   * 稀有率（百分比，0–100）：這台服務上拿過這項成就的玩家 ÷ 打完過至少一段生涯的
   * 玩家。伺服器算不出來（例如沒有任何玩家）時省略。
   */
  readonly rarity?: number;
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

/**
 * 天梯上的一列。
 *
 * 個人天梯與全伺服器天梯共用這個形狀——差別只在查詢時限不限 `user_id`，不在
 * 資料本身（見 ADR 0038）。
 */
export interface LadderEntry {
  /** 名次，從 1 起算。 */
  readonly rank: number;
  /** 那一段生涯的球員姓名。 */
  readonly name: string;
  /** 帳號名。個人天梯上永遠是自己，全伺服器天梯上才有鑑別力。 */
  readonly account: string;
  /** 榜上的那個數字。率型已經是算好的比率，累積型是整數。 */
  readonly value: number;
  /** 這個組合內的球季數。用來讓玩家看出這是幾年打出來的；單季是 1。 */
  readonly seasons: number;
  /**
   * 結算當下的引擎版本。
   *
   * 與目前版本不同的列是**舊規則的產物**，畫面上要標出來——榜單是歷史，不是
   * 同一把尺（ADR 0038）。
   */
  readonly engineVersion: number;
  /** 結算的真實時間（ISO 字串）。 */
  readonly at: string;
}

/**
 * 查哪一格天梯：聯盟 × 守位 × 累計／單季。`*` 是跨聯盟、跨守位。
 *
 * 第四個選單（我的／所有玩家）不在這裡——它決定的是查誰的列，不是查哪一格。
 */
export interface LadderQuery {
  readonly org: string;
  readonly position: string;
  readonly kind: 'total' | 'best';
}

/**
 * 一整張榜：一個組合下的一個欄位。
 *
 * `side` 是它屬於哪一張表：野手、投手，或投打共通（份額、評價分、薪水）。
 */
export interface LadderBoard {
  /** 欄位代碼，對應 ladder.json 的 `columns[side][].key`。 */
  readonly column: string;
  readonly side: 'batter' | 'pitcher' | 'shared';
  readonly entries: readonly LadderEntry[];
}

/** 查榜的回應。 */
export interface LadderResponse {
  /** 這個組合下的每一張榜。空的榜（沒有任何人有資格）不會出現。 */
  readonly boards: readonly LadderBoard[];
  /**
   * 有資料的組合，供畫面的選單用。
   *
   * **選單只列在其他選擇下有資料的選項**——沒去過墨聯就沒有墨聯，與成就櫃「未解鎖
   * 的一律不顯示」同一個規矩。個人天梯回的是自己打過的，全伺服器天梯回的是所有
   * 玩家的聯集。
   */
  readonly combos: readonly LadderQuery[];
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
  /**
   * 天梯。聯盟與守位給 `*` 就是跨聯盟、跨守位；`self=1` 是個人天梯，否則是全伺服器。
   */
  ladder: (q: LadderQuery, self: boolean) =>
    `/api/ladder?org=${encodeURIComponent(q.org)}&position=${encodeURIComponent(q.position)}` +
    `&kind=${q.kind}${self ? '&self=1' : ''}`,
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
  /** 查一格天梯。`self` 為真時只看自己打過的生涯。 */
  ladder(q: LadderQuery, self: boolean): Promise<LadderResponse>;
  /** 開局登記：凍結當下的天賦組合。 */
  startCareer(): Promise<CareerTicket>;
  /** 結算：上傳重播日誌，伺服器重跑驗證。 */
  finishCareer(careerId: string, body: FinishRequest): Promise<CareerResult>;
  /**
   * 把天賦設到指定級數。`0` 等於退光，全額退還 AP。
   *
   * 送的是**想要的結果**而不是動作，所以重送同一個級數不會多扣一次；差價一律由
   * 伺服器算，客戶端只負責問。
   */
  setTalent(id: string, level: number): Promise<Me>;
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
 * 功能」——例如只開了 `npm run dev`、沒開伺服器的時候。兩者在畫面上要說不同的話。
 */
export const OFFLINE = 0;

export const isOffline = (e: unknown): boolean => e instanceof ApiError && e.status === OFFLINE;
