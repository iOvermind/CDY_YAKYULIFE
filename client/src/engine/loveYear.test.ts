/**
 * 感情的一年：**順序與守衛**。
 *
 * 這些規則從前只活在 `game.ts` 的巢狀 callback 裡，一條測試都碰不到——要驗
 * 「被抓到之後那一年就結束了」得打完一整段生涯，還得剛好抽中那條路。現在它是
 * 一台可以直接餵答案的步驟機（ADR 0050）。
 *
 * 公式（分手機率、風波機率、生子機率…）在 `love.test.ts`，這裡不重測。
 */

import { describe, expect, it } from 'vitest';
import { love as cfg } from '../data/index.ts';
import { newLoveState, type LoveState } from './love.ts';
import {
  loveCheckpoint,
  loveOverseas,
  loveYear,
  type LoveAsk,
  type LoveFlow,
  type LoveStep,
  type LoveYearContext,
} from './loveYear.ts';
import { World } from './rng.ts';

const ctx = (over: Partial<LoveYearContext> = {}): LoveYearContext => ({
  age: 28,
  year: 2035,
  pro: true,
  bestRank: null,
  earnings: 1_000_000,
  ...over,
});

const state = (over: Partial<LoveState> = {}): LoveState => ({ ...newLoveState(), ...over });

/** 把一台步驟機跑完，照 `answer` 回答每一個提問。回傳走過的每一步。 */
function drive(flow: LoveFlow, answer: (ask: LoveAsk) => string): readonly LoveStep[] {
  const steps: LoveStep[] = [];
  let result = flow.next();
  let guard = 0;
  while (result.done !== true) {
    const step = result.value;
    steps.push(step);
    if (guard++ > 50) throw new Error('步驟機沒有停下來');
    result = step.kind === 'ask' ? flow.next(answer(step)) : flow.next('');
  }
  return steps;
}

const ids = (steps: readonly LoveStep[]): readonly string[] => steps.map((s) => s.id as string);

/**
 * 掃種子，直到跑出一條包含某一步的年份為止。
 *
 * **掃不到就丟例外**，不是靜靜地綠掉——那種「六十顆種子都沒中也算過」的測試等
 * 於沒有測。
 */
function findYear(
  want: string,
  build: () => LoveState,
  answer: (ask: LoveAsk) => string,
  options: { readonly tries?: number; readonly ctx?: Partial<LoveYearContext> } = {},
): { readonly steps: readonly LoveStep[]; readonly love: LoveState } {
  const tries = options.tries ?? 400;
  for (let i = 0; i < tries; i++) {
    const love = build();
    const steps = drive(loveYear(new World(`seed-${want}-${i}`), love, ctx(options.ctx)), answer);
    if (ids(steps).includes(want)) return { steps, love };
  }
  throw new Error(`${tries} 顆種子都沒有跑出 ${want}`);
}

/** 照選項清單挑：給哪一個 id 就挑哪一個，沒有就挑第一個。 */
const prefer =
  (...wanted: readonly string[]) =>
  (ask: LoveAsk): string =>
    wanted.find((w) => ask.options.includes(w)) ?? ask.options[0] ?? '';

describe('一年的順序', () => {
  it('年紀不到就什麼都不會發生', () => {
    const love = state();
    const steps = drive(loveYear(new World('young'), love, ctx({ age: cfg.gate.min_age - 1 })), prefer());
    expect(steps).toEqual([]);
    expect(love.status).toBe('single');
  });

  it('沒輪到感情事件的那一年也是空的，但劈腿的懲罰年數照樣遞減', () => {
    // 抽不中 cadence 的年份：單身的機率不是 100%，掃到一顆沒中的種子。
    for (let i = 0; i < 200; i++) {
      const love = state({ cheatPenaltyYears: 2 });
      const steps = drive(loveYear(new World(`cad-${i}`), love, ctx()), prefer());
      if (steps.length > 0) continue;
      expect(love.cheatPenaltyYears).toBe(1);
      return;
    }
    throw new Error('兩百顆種子都輪到了感情事件');
  });

  /**
   * **這一條就是這次重整的理由。**
   *
   * 被抓到之後那一年就結束了：外遇那一段可能以分手收場，而求婚接在它後面——
   * 沒有這道守衛的話，同一年會出現「劈腿曝光、她提分手」然後立刻「要不要求婚」，
   * 對著一個已經走了的人跪下去。
   */
  it('劈腿被抓並分手之後，同一年不會再問要不要求婚', () => {
    const { steps, love } = findYear(
      'affair-caught',
      () => state({ status: 'dating', partner: '何雨蓁', datingYears: 6 }),
      prefer('love:affair', 'love:accept'),
    );
    expect(ids(steps)).toContain('breakup');
    expect(ids(steps)).not.toContain('proposal');
    expect(love.status).toBe('single');
  });

  it('道歉成功的話關係還在，求婚仍然接在後面', () => {
    for (let i = 0; i < 400; i++) {
      const love = state({ status: 'dating', partner: '何雨蓁', datingYears: 6 });
      const steps = drive(
        loveYear(new World(`apo-${i}`), love, ctx()),
        prefer('love:affair', 'love:apologise', 'love:later'),
      );
      if (!ids(steps).includes('apology-accepted')) continue;
      expect(ids(steps)).toContain('proposal');
      expect(love.status).toBe('dating');
      return;
    }
    throw new Error('四百顆種子都沒有道歉成功過');
  });

  it('風波選擇結束的那一年，後面的外遇與求婚都不會再問', () => {
    const { steps, love } = findYear(
      'turmoil',
      () => state({ status: 'dating', partner: '蔡宜庭', datingYears: 6, cracks: 4 }),
      prefer('love:leave'),
    );
    expect(ids(steps)).toContain('breakup');
    expect(ids(steps)).not.toContain('affair');
    expect(ids(steps)).not.toContain('proposal');
    expect(love.status).toBe('single');
  });

  it('生了孩子的那一年不會再跑外遇或日常', () => {
    const { steps } = findYear(
      'childbirth',
      () => state({ status: 'married', partner: '溫語彤', marriedYear: 2030 }),
      prefer(),
    );
    expect(ids(steps)).not.toContain('affair');
    expect(ids(steps)).not.toContain('flavour');
  });
});

describe('三人行的兩條路', () => {
  it('鹿鼎公：兩位一起在身邊，外遇的誘惑不再出現', () => {
    const love = state({
      status: 'married',
      partner: '何雨蓁',
      partner2: '蔡宜庭',
      open: 'harem',
      marriedYear: 2030,
      kids: 4,
      kids2: 4,
    });
    // 孩子都滿了，所以只要輪得到感情事件就會走到日常那一步。
    for (let i = 0; i < 50; i++) {
      const steps = drive(loveYear(new World(`harem-${i}`), { ...love }, ctx()), prefer('love:swallow'));
      const flavour = steps.find((s) => s.id === 'flavour');
      if (flavour === undefined || flavour.kind !== 'tell') continue;
      expect(ids(steps)).not.toContain('affair');
      // 兩位各擲各的骰：當季狀態有兩份。
      expect(flavour.effects).toHaveLength(2);
      return;
    }
    throw new Error('五十顆種子都沒有跑到日常那一步');
  });

  it('縮頭烏龜：每年的感情回報是倒扣的', () => {
    const love = state({ status: 'married', partner: '何雨蓁', open: 'cuckold', kids: 4 });
    for (let i = 0; i < 50; i++) {
      const steps = drive(loveYear(new World(`cuck-${i}`), { ...love }, ctx()), prefer('love:decline'));
      const flavour = steps.find((s) => s.id === 'flavour');
      if (flavour === undefined || flavour.kind !== 'tell') continue;
      expect(flavour.effects).toHaveLength(1);
      const effect = flavour.effects[0];
      expect(effect?.kind === 'bonus' ? effect.points : 0).toBeLessThan(0);
      return;
    }
    throw new Error('五十顆種子都沒有跑到日常那一步');
  });

  it('縮頭烏龜的唯一出口：自己出軌被抓就直接結束，沒有道歉也沒有三人行', () => {
    const { steps, love } = findYear(
      'affair-caught',
      () => state({ status: 'married', partner: '何雨蓁', open: 'cuckold', marriedYear: 2030, kids: 4 }),
      prefer('love:affair'),
    );
    expect(ids(steps)).not.toContain('caught');
    expect(ids(steps)).toContain('breakup');
    expect(love.status).toBe('divorced');
    // 她先外遇的事實不會因為你後來也外遇而消失：錢是往你這邊流的。
    const breakup = steps.find((s) => s.id === 'breakup');
    expect(breakup?.kind === 'tell' && breakup.id === 'breakup' ? breakup.money : 0).toBeGreaterThan(0);
  });
});

describe('婚禮', () => {
  it('三人行是兩位一起進禮堂，姻緣那一刻記兩筆', () => {
    const love = state({ status: 'dating', partner: '何雨蓁', partner2: '蔡宜庭', open: 'harem', datingYears: 3 });
    for (let i = 0; i < 200; i++) {
      const one = { ...love, spouses: [] };
      const steps = drive(loveYear(new World(`wed-${i}`), one, ctx()), prefer('love:propose'));
      if (!ids(steps).includes('wedding')) continue;
      expect(one.status).toBe('married');
      expect(one.spouses).toEqual(['何雨蓁', '蔡宜庭']);
      expect(one.marriedYear).toBe(2035);
      return;
    }
    throw new Error('兩百顆種子都沒有走到婚禮');
  });
});

describe('關卡與旅外', () => {
  it('關卡拆散的那一次，理由寫的是關卡不是分手', () => {
    for (let i = 0; i < 200; i++) {
      const love = state({ status: 'dating', partner: '何雨蓁', fromSchool: true });
      const steps = drive(loveCheckpoint(new World(`cp-${i}`), love, '高中畢業'), prefer());
      if (steps.length === 0) continue;
      const step = steps[0];
      expect(step?.kind === 'tell' && step.id === 'breakup' ? step.reason.id : '').toBe('checkpoint');
      expect(love.status).toBe('single');
      expect(love.partner).toBeNull();
      return;
    }
    throw new Error('兩百顆種子都沒有在關卡拆散過');
  });

  it('沒有伴的話旅外不必問', () => {
    const steps = drive(loveOverseas(state(), ctx(), '大聯盟'), prefer());
    expect(steps).toEqual([]);
  });

  it('帶她走要付安家費，而且記一筆榮銜', () => {
    const love = state({ status: 'married', partner: '賴品瑄', marriedYear: 2030 });
    const steps = drive(loveOverseas(love, ctx(), '大聯盟'), prefer('love:bring'));
    expect(ids(steps)).toEqual(['overseas', 'overseas-bring']);
    expect(love.overseas).toBe('bring');
    const tell = steps[1];
    const kinds = tell?.kind === 'tell' ? tell.effects.map((e) => e.kind) : [];
    expect(kinds).toEqual(['money', 'honor']);
  });

  it('不拖累她就是分手，而且婚姻史不會被抹掉', () => {
    const love = state({
      status: 'married',
      partner: '賴品瑄',
      marriedYear: 2030,
      spouses: ['賴品瑄'],
    });
    drive(loveOverseas(love, ctx(), '大聯盟'), prefer('love:end'));
    expect(love.status).toBe('divorced');
    expect(love.partner).toBeNull();
    // 走過紅毯的名字活得比那段關係長——姻緣成就數的是不同的對象。
    expect(love.spouses).toEqual(['賴品瑄']);
  });
});

describe('確定性', () => {
  it('同一顆種子配同一串答案，走出同一串步驟', () => {
    const run = () => {
      const love = state({ status: 'dating', partner: '何雨蓁', datingYears: 6 });
      return ids(drive(loveYear(new World('same'), love, ctx()), prefer('love:affair', 'love:accept')));
    };
    expect(run()).toEqual(run());
  });

  it('抽取與狀態無關地先做——沒輪到的那一年也照樣動過骰子', () => {
    const a = new World('stream');
    drive(loveYear(a, state(), ctx()), prefer());
    const b = new World('stream');
    drive(loveYear(b, state({ status: 'married', partner: '何雨蓁' }), ctx()), prefer());
    // 兩種狀態走的是同一條 career 子序列，第一次抽取的位置相同。
    expect(a.stream('career').next()).not.toBe(b.stream('career').next());
  });
});
