/**
 * 確定性亂數層。見 docs/adr/0002-deterministic-rng-and-replay-log.md。
 *
 * PRNG 沿用 index_legacy.html:373-374 的 mulberry32 變體，逐位元移植。
 *
 * 引擎中任何影響遊戲結果的隨機都必須經過這裡，禁止呼叫原生 Math.random()。
 * 純視覺用途（例如擲骰動畫的數字跳動）不在此限，但顯示的數字與實際採用的
 * 數值必須來自同一個 Rng。
 */

/** 六條子序列。一次抽取歸屬於執行它的領域，不歸屬於呼叫者。 */
export const STREAMS = [
  /** 開局生成：初始能力、潛力天花板、出身高中 */
  'genesis',
  /** 訓練骰、蓄力槽、能力成長與衰退 */
  'growth',
  /** 事件卡的抽取與好壞判定 */
  'events',
  /** 傷病判定、TJ 量表 */
  'health',
  /** 賽季模擬與成績結算 */
  'season',
  /** 選秀、合約、交易、國際賽、感情、名人堂票選 */
  'career',
] as const;

export type StreamName = (typeof STREAMS)[number];

/**
 * 把任意字串雜湊成 32 位元狀態。移植自 index_legacy.html:373 的 seedInit。
 */
function hashSeed(str: string): number {
  let s = 1779033703;
  for (let i = 0; i < str.length; i++) {
    s = Math.imul(s ^ str.charCodeAt(i), 3432918353);
    s = (s << 13) | (s >>> 19);
  }
  return s;
}

/** 一條子序列。抽取會推進內部狀態，因此同一條流的取用順序有意義。 */
export class Rng {
  readonly stream: StreamName;
  #state: number;
  #drawCount = 0;

  constructor(stream: StreamName, state: number) {
    this.stream = stream;
    this.#state = state;
  }

  /** 已消耗的抽取次數。除錯與重播比對用，不參與遊戲邏輯。 */
  get drawCount(): number {
    return this.#drawCount;
  }

  /** [0, 1) 均勻分佈。移植自 index_legacy.html:374 的 R()。 */
  next(): number {
    this.#drawCount++;
    let s = this.#state | 0;
    s = (s + 0x6d2b79f5) | 0;
    this.#state = s;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max] 的整數，兩端皆含。對應 legacy 的 ri()。 */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`int(${min}, ${max}): max 小於 min`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** percent 為 0-100 的百分比。對應 legacy 的 chance()。 */
  chance(percent: number): boolean {
    return this.next() * 100 < percent;
  }

  /** 從陣列均勻挑一個。對應 legacy 的 pick()。 */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick(): 空陣列');
    const chosen = items[Math.floor(this.next() * items.length)];
    // items.length > 0 且索引在範圍內，所以 chosen 一定存在；
    // 這個檢查是為了滿足 noUncheckedIndexedAccess，不是真的會發生。
    if (chosen === undefined) throw new Error('pick(): 索引越界');
    return chosen;
  }

  /**
   * 依權重挑一個鍵。權重不必加總為 100，只看相對比例。
   * 一律先把鍵排序，確保同一份資料在不同的物件走訪順序下結果相同。
   */
  weighted<K extends string>(weights: Readonly<Partial<Record<K, number>>>): K {
    const entries = (Object.entries(weights) as [K, number | undefined][])
      .filter((e): e is [K, number] => typeof e[1] === 'number' && e[1] > 0)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (entries.length === 0) throw new RangeError('weighted(): 沒有任何正權重');

    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [key, weight] of entries) {
      roll -= weight;
      if (roll < 0) return key;
    }
    // 浮點誤差可能讓迴圈跑完，退回最後一個鍵。
    const last = entries[entries.length - 1];
    if (last === undefined) throw new Error('weighted(): 不可能到達');
    return last[0];
  }

  /**
   * 加權洗牌：權重越高的項目越可能排在前面。
   *
   * 作法是不放回的加權抽樣（每次依剩餘權重挑一個），因此排名前段由權重主導，
   * 但任何項目都有機會排到任何位置——這正是「專精者仍然專精，但不封死任何
   * 一條路」需要的性質。
   *
   * 權重缺漏或非正數者一律視為 fallbackWeight。
   */
  weightedShuffle<T extends string>(
    items: readonly T[],
    weights: Readonly<Record<string, number>>,
    fallbackWeight: number,
  ): T[] {
    const pool = items.map((item) => {
      const w = weights[item];
      return { item, weight: typeof w === 'number' && w > 0 ? w : fallbackWeight };
    });

    const order: T[] = [];
    while (pool.length > 0) {
      const total = pool.reduce((sum, e) => sum + e.weight, 0);
      let roll = this.next() * total;
      let index = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        const entry = pool[i];
        if (entry === undefined) continue;
        roll -= entry.weight;
        if (roll < 0) {
          index = i;
          break;
        }
      }
      const chosen = pool[index];
      if (chosen === undefined) throw new Error('weightedShuffle(): 索引越界');
      order.push(chosen.item);
      pool.splice(index, 1);
    }
    return order;
  }

  /**
   * 就地洗牌（Fisher-Yates）。移植自 index_legacy.html:580。
   * 會消耗 items.length - 1 次抽取。
   */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const a = items[i];
      const b = items[j];
      if (a === undefined || b === undefined) throw new Error('shuffle(): 索引越界');
      items[i] = b;
      items[j] = a;
    }
    return items;
  }
}

/**
 * 一局遊戲的完整亂數來源。六條子序列各自從主種子衍生，互不干擾。
 *
 * 分流的目的不是保護舊種子（生涯一旦分岔，後續一切都會不同），而是受控實驗：
 * 固定傷病序列、只變動另一個系統，才能在重新校準數值時分離出單一變因。
 */
export class World {
  readonly seed: string;
  readonly #streams: ReadonlyMap<StreamName, Rng>;

  constructor(seed: string) {
    this.seed = seed;
    const streams = new Map<StreamName, Rng>();
    for (const name of STREAMS) {
      // 每條流用「主種子:流名」衍生，確保換一條流就換一組序列。
      streams.set(name, new Rng(name, hashSeed(`${seed}:${name}`)));
    }
    this.#streams = streams;
  }

  /** 取得指定子序列。領域函式應在自己的入口取一次，不要逐次呼叫。 */
  stream(name: StreamName): Rng {
    const rng = this.#streams.get(name);
    if (!rng) throw new Error(`未知的子序列：${name}`);
    return rng;
  }

  /** 各條流已消耗的抽取次數。除錯與重播比對用。 */
  drawCounts(): Record<StreamName, number> {
    const counts = {} as Record<StreamName, number>;
    for (const name of STREAMS) counts[name] = this.stream(name).drawCount;
    return counts;
  }
}

/** 產生一個新的世界種子。這是唯一允許使用 Math.random() 的地方。 */
export function newSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}
