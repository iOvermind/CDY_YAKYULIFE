/**
 * 流程編排：卡片佇列與選擇驅動的推進。
 *
 * 對應 index_legacy.html 的 stepQ / card() / choose()，但形狀不同。舊版用
 * callback 串接流程，流程狀態散在閉包鏈裡；本版改為**選擇驅動的狀態機**：
 * 引擎自行推進，跑到需要玩家決定的地方就停下，玩家的選擇是唯一的外部輸入。
 *
 * 這個形狀是 ADR 0002 要的——既然外部輸入只有選擇，那麼「種子＋選擇序列」
 * 就足以重建整段生涯，不需要狀態快照。
 */

/**
 * 把字串轉為安全的 HTML 文字。
 *
 * 卡片內文允許少量行內 HTML（`<b class="hl">` 之類的高光），這是與舊版文案
 * 相容所必需的，因此介面層是用 innerHTML 渲染它。代價是**任何來自玩家的
 * 字串在放進卡片之前都必須經過這裡**——球員姓名是自由輸入的文字，直接內插
 * 就是一個 XSS。
 *
 * 規則很簡單：卡片內文裡的 HTML 只能由程式碼寫死，變數一律先 esc()。
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 卡片的語氣，對應 app.css 的 .card.good / .bad / .info / .gold。 */
export type Tone = 'info' | 'good' | 'bad' | 'gold';

/** 一則敘事輸出。純展示，不影響任何運算。 */
export interface Card {
  readonly tone: Tone;
  readonly title?: string;
  /** 允許少量行內 HTML（<b class="hl"> 之類的高光），與舊版文案相容。 */
  readonly body: string;
}

/** 年度分隔線，開啟新的年度區塊。 */
export interface Divider {
  readonly kind: 'divider';
  readonly text: string;
}

export type LogEntry = ({ kind: 'card' } & Card) | Divider;

export interface Option {
  /** 穩定的識別字串。這是寫進重播日誌的東西，**不得隨介面文案更動**。 */
  readonly id: string;
  readonly label: string;
  readonly note?: string;
  readonly role?: 'main' | 'warn';
}

export interface Prompt {
  readonly title?: string;
  readonly options: readonly Option[];
}

/** 一個流程步驟。由引擎推進時呼叫，可再往佇列推入更多步驟。 */
export type Step = () => void;

/**
 * 選擇驅動的流程佇列。
 *
 * 用法：領域邏輯呼叫 push() 排入步驟、card() 產生敘事、ask() 停下來等玩家。
 * 外部只呼叫 run() 與 choose()。
 */
export class Flow {
  #queue: Step[] = [];
  #log: LogEntry[] = [];
  #prompt: Prompt | null = null;
  #handler: ((optionId: string) => void) | null = null;
  #choices: string[] = [];

  /** 目前的敘事紀錄，由舊到新。 */
  get log(): readonly LogEntry[] {
    return this.#log;
  }

  /** 目前等待玩家回答的提問；null 表示流程已跑完或尚未開始。 */
  get prompt(): Prompt | null {
    return this.#prompt;
  }

  /** 重播日誌：玩家至今做過的選擇，依序記錄。 */
  get choices(): readonly string[] {
    return this.#choices;
  }

  /** 流程是否已經跑完（佇列空且沒有待答的提問）。 */
  get finished(): boolean {
    return this.#prompt === null && this.#queue.length === 0;
  }

  /** 把步驟排到佇列尾端。 */
  push(...steps: Step[]): void {
    this.#queue.push(...steps);
  }

  /**
   * 把步驟插到佇列最前面，插隊執行。
   * 對應舊版流程中「某個選擇會展開一段子流程，結束後回到原本進度」的情況。
   */
  unshift(...steps: Step[]): void {
    this.#queue.unshift(...steps);
  }

  /** 產生一則敘事卡片。 */
  card(tone: Tone, title: string | undefined, body: string): void {
    this.#log.push(title === undefined ? { kind: 'card', tone, body } : { kind: 'card', tone, title, body });
  }

  /** 開啟一個新的年度區塊。 */
  divider(text: string): void {
    this.#log.push({ kind: 'divider', text });
  }

  /**
   * 停下來等玩家決定。handler 會在 choose() 時以選項 id 呼叫。
   *
   * 同一個步驟內只能 ask 一次——第二次會覆蓋第一次，那幾乎一定是邏輯錯誤。
   */
  ask(prompt: Prompt, handler: (optionId: string) => void): void {
    if (prompt.options.length === 0) throw new Error('ask(): 提問沒有任何選項');
    const ids = new Set(prompt.options.map((o) => o.id));
    if (ids.size !== prompt.options.length) throw new Error('ask(): 選項 id 重複');
    if (this.#prompt !== null) throw new Error('ask(): 上一個提問尚未回答');
    this.#prompt = prompt;
    this.#handler = handler;
  }

  /**
   * 推進到下一個提問為止，或直到佇列跑完。
   *
   * 步驟本身可以再 push 更多步驟，所以這是一個迴圈而非固定次數。
   */
  run(): void {
    while (this.#prompt === null) {
      const step = this.#queue.shift();
      if (step === undefined) return;
      step();
    }
  }

  /**
   * 回答目前的提問，並繼續推進。
   *
   * 選項 id 會寫進重播日誌。給定相同的種子與相同的 id 序列，整段流程必定
   * 產生相同結果——這正是 ADR 0002 的重播機制所依賴的性質。
   */
  choose(optionId: string): void {
    const prompt = this.#prompt;
    const handler = this.#handler;
    if (prompt === null || handler === null) throw new Error('choose(): 目前沒有待答的提問');
    if (!prompt.options.some((o) => o.id === optionId)) {
      throw new Error(`choose(): 選項 ${optionId} 不在目前的提問中`);
    }

    this.#choices.push(optionId);
    this.#prompt = null;
    this.#handler = null;
    handler(optionId);
    this.run();
  }

  /** 清空佇列並結束流程。用於引退這類「後續步驟不再有意義」的情況。 */
  abort(): void {
    this.#queue = [];
    this.#prompt = null;
    this.#handler = null;
  }
}
