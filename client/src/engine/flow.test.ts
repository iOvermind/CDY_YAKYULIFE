import { describe, expect, it, vi } from 'vitest';
import { esc, Flow } from './flow.ts';

describe('esc', () => {
  it('跳脫會被當成標記的字元', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;');
    expect(esc('a & b')).toBe('a &amp; b');
    expect(esc(`"'`)).toBe('&quot;&#39;');
  });

  it('& 先跳脫，不會二次跳脫', () => {
    expect(esc('&lt;')).toBe('&amp;lt;');
  });

  it('一般文字原樣通過', () => {
    expect(esc('林家正')).toBe('林家正');
  });
});

const yesNo = [
  { id: 'yes', label: '好' },
  { id: 'no', label: '不好' },
];

describe('Flow', () => {
  it('run() 依序執行佇列裡的步驟', () => {
    const flow = new Flow();
    const seen: number[] = [];
    flow.push(
      () => seen.push(1),
      () => seen.push(2),
      () => seen.push(3),
    );
    flow.run();
    expect(seen).toEqual([1, 2, 3]);
    expect(flow.finished).toBe(true);
  });

  it('步驟可以再排入步驟，run() 會一路跑完', () => {
    const flow = new Flow();
    const seen: number[] = [];
    flow.push(() => {
      seen.push(1);
      flow.push(() => {
        seen.push(2);
        flow.push(() => seen.push(3));
      });
    });
    flow.run();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('unshift() 插隊，結束後回到原本進度', () => {
    const flow = new Flow();
    const seen: string[] = [];
    flow.push(
      () => {
        seen.push('a');
        flow.unshift(() => seen.push('插隊'));
      },
      () => seen.push('b'),
    );
    flow.run();
    expect(seen).toEqual(['a', '插隊', 'b']);
  });

  it('run() 遇到 ask() 就停下，不再往下跑', () => {
    const flow = new Flow();
    const seen: string[] = [];
    flow.push(
      () => flow.ask({ options: yesNo }, () => seen.push('answered')),
      () => seen.push('之後的步驟'),
    );
    flow.run();
    expect(flow.prompt?.options).toHaveLength(2);
    expect(seen).toEqual([]);
  });

  it('choose() 之後才繼續推進', () => {
    const flow = new Flow();
    const seen: string[] = [];
    flow.push(
      () => flow.ask({ options: yesNo }, (id) => seen.push(id)),
      () => seen.push('之後的步驟'),
    );
    flow.run();
    flow.choose('yes');
    expect(seen).toEqual(['yes', '之後的步驟']);
    expect(flow.prompt).toBeNull();
    expect(flow.finished).toBe(true);
  });

  it('choose() 把選項 id 寫進重播日誌', () => {
    const flow = new Flow();
    flow.push(() => flow.ask({ options: yesNo }, () => flow.ask({ options: yesNo }, () => {})));
    flow.run();
    flow.choose('yes');
    flow.choose('no');
    expect(flow.choices).toEqual(['yes', 'no']);
  });

  it('choose() 拒絕不在目前提問裡的選項', () => {
    const flow = new Flow();
    flow.push(() => flow.ask({ options: yesNo }, () => {}));
    flow.run();
    expect(() => flow.choose('maybe')).toThrow(/不在目前的提問/);
    // 拒絕之後狀態不變，仍可正常回答
    expect(flow.choices).toEqual([]);
    flow.choose('yes');
    expect(flow.choices).toEqual(['yes']);
  });

  it('沒有待答提問時 choose() 會丟出錯誤', () => {
    const flow = new Flow();
    expect(() => flow.choose('yes')).toThrow(/沒有待答的提問/);
  });

  it('ask() 拒絕空選項與重複 id', () => {
    const flow = new Flow();
    expect(() => flow.ask({ options: [] }, () => {})).toThrow(/沒有任何選項/);
    expect(() =>
      flow.ask({ options: [{ id: 'x', label: 'a' }, { id: 'x', label: 'b' }] }, () => {}),
    ).toThrow(/id 重複/);
  });

  it('上一個提問未回答時再 ask() 會丟出錯誤——那幾乎一定是邏輯錯誤', () => {
    const flow = new Flow();
    flow.ask({ options: yesNo }, () => {});
    expect(() => flow.ask({ options: yesNo }, () => {})).toThrow(/尚未回答/);
  });

  it('card() 與 divider() 依序寫入紀錄', () => {
    const flow = new Flow();
    flow.divider('2026 年');
    flow.card('gold', '入學', '你進了平鎮高中');
    flow.card('info', undefined, '沒有標題的卡片');
    expect(flow.log).toEqual([
      { kind: 'divider', text: '2026 年' },
      { kind: 'card', tone: 'gold', title: '入學', body: '你進了平鎮高中' },
      { kind: 'card', tone: 'info', body: '沒有標題的卡片' },
    ]);
  });

  it('abort() 清空佇列，後續步驟不再執行', () => {
    const flow = new Flow();
    const later = vi.fn();
    flow.push(() => flow.abort(), later);
    flow.run();
    expect(later).not.toHaveBeenCalled();
    expect(flow.finished).toBe(true);
  });

  it('abort() 也會清掉待答的提問', () => {
    const flow = new Flow();
    flow.ask({ options: yesNo }, () => {});
    flow.abort();
    expect(flow.prompt).toBeNull();
    expect(flow.finished).toBe(true);
  });
});
