import { describe, expect, it } from 'vitest';
import { Rng, STREAMS, World } from './rng.ts';

describe('World', () => {
  it('同一個種子產生完全相同的序列', () => {
    const a = new World('abc12345');
    const b = new World('abc12345');
    const drawsA = Array.from({ length: 200 }, () => a.stream('genesis').next());
    const drawsB = Array.from({ length: 200 }, () => b.stream('genesis').next());
    expect(drawsA).toEqual(drawsB);
  });

  it('不同種子產生不同序列', () => {
    const a = new World('abc12345');
    const b = new World('abc12346');
    const drawsA = Array.from({ length: 50 }, () => a.stream('genesis').next());
    const drawsB = Array.from({ length: 50 }, () => b.stream('genesis').next());
    expect(drawsA).not.toEqual(drawsB);
  });

  it('六條子序列彼此不同', () => {
    const world = new World('abc12345');
    const firstDraws = STREAMS.map((name) => world.stream(name).next());
    expect(new Set(firstDraws).size).toBe(STREAMS.length);
  });

  it('消耗一條流不影響其他流——這是分流的全部意義', () => {
    const control = new World('abc12345');
    const disturbed = new World('abc12345');

    // 在 disturbed 上大量消耗 events，模擬「事件系統改了、多抽了很多次」
    for (let i = 0; i < 1000; i++) disturbed.stream('events').next();

    // health 的序列必須完全不受影響
    const a = Array.from({ length: 50 }, () => control.stream('health').next());
    const b = Array.from({ length: 50 }, () => disturbed.stream('health').next());
    expect(a).toEqual(b);
  });

  it('同一條流重複取得的是同一個實例，不會重置', () => {
    const world = new World('abc12345');
    const first = world.stream('genesis').next();
    const second = world.stream('genesis').next();
    expect(first).not.toBe(second);
    expect(world.stream('genesis').drawCount).toBe(2);
  });

  it('未知的子序列會丟出錯誤', () => {
    const world = new World('abc12345');
    // @ts-expect-error 故意傳入不存在的流名
    expect(() => world.stream('nope')).toThrow();
  });

  it('drawCounts 回報各流的消耗次數', () => {
    const world = new World('abc12345');
    world.stream('genesis').next();
    world.stream('genesis').next();
    world.stream('season').next();
    expect(world.drawCounts()).toMatchObject({ genesis: 2, season: 1, health: 0 });
  });
});

describe('Rng', () => {
  const fresh = () => new World('test-seed').stream('genesis');

  it('next() 落在 [0, 1)', () => {
    const rng = fresh();
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('next() 大致均勻', () => {
    const rng = fresh();
    const buckets = new Array<number>(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) {
      const b = Math.floor(rng.next() * 10);
      buckets[b] = (buckets[b] ?? 0) + 1;
    }
    // 每一格期望 10%，容許 ±1 個百分點
    for (const count of buckets) {
      expect(count / n).toBeGreaterThan(0.09);
      expect(count / n).toBeLessThan(0.11);
    }
  });

  it('int() 兩端皆含且不越界', () => {
    const rng = fresh();
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5, 6, 7]));
  });

  it('int() 的 min 等於 max 時只會回傳該值', () => {
    const rng = fresh();
    for (let i = 0; i < 20; i++) expect(rng.int(5, 5)).toBe(5);
  });

  it('int() 在 max < min 時丟出錯誤', () => {
    expect(() => fresh().int(7, 3)).toThrow(RangeError);
  });

  it('chance() 的命中率接近指定百分比', () => {
    const rng = fresh();
    const n = 100000;
    let hits = 0;
    for (let i = 0; i < n; i++) if (rng.chance(30)) hits++;
    expect(hits / n).toBeGreaterThan(0.29);
    expect(hits / n).toBeLessThan(0.31);
  });

  it('chance(0) 永不命中、chance(100) 必定命中', () => {
    const rng = fresh();
    for (let i = 0; i < 500; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(100)).toBe(true);
    }
  });

  it('pick() 只回傳陣列內的元素，且每個都取得到', () => {
    const rng = fresh();
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(rng.pick(items));
    expect(seen).toEqual(new Set(items));
  });

  it('pick() 對空陣列丟出錯誤', () => {
    expect(() => fresh().pick([])).toThrow(RangeError);
  });

  it('shuffle() 保留全部元素且消耗 n-1 次抽取', () => {
    const rng = fresh();
    const items = [1, 2, 3, 4, 5];
    const before = rng.drawCount;
    const result = rng.shuffle(items);
    expect(rng.drawCount - before).toBe(items.length - 1);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('shuffle() 在相同種子下產生相同排列', () => {
    const a = new World('x').stream('genesis').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new World('x').stream('genesis').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
  });

  it('Rng 可獨立建構，狀態不共用', () => {
    const a = new Rng('genesis', 12345);
    const b = new Rng('genesis', 12345);
    expect(a.next()).toBe(b.next());
  });
});
