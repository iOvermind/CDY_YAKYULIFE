import { describe, expect, it } from 'vitest';
import { amateur } from '../data/index.ts';
import { stageOf } from './amateur.ts';
import { ENGINE_VERSION, Game, type GameSetup } from './game.ts';

const setup: GameSetup = {
  seed: 'test-seed',
  name: '王小明',
  startPosition: 'SS',
  throws: 'R',
  bats: 'R',
};

const started = (over: Partial<GameSetup> = {}) => new Game({ ...setup, ...over }).start();

describe('Game', () => {
  it('start() 產生球員並推進到第一個提問', () => {
    const game = started();
    expect(game.player).not.toBeNull();
    expect(game.player?.name).toBe('王小明');
    expect(game.flow.prompt).not.toBeNull();
  });

  it('start() 之前沒有球員', () => {
    expect(new Game(setup).player).toBeNull();
  });

  it('開局會寫下入學卡片與第一年的分隔線', () => {
    const game = started();
    const log = game.flow.log;
    expect(log[0]).toMatchObject({ kind: 'card', tone: 'gold', title: '入學' });
    expect(log.some((e) => e.kind === 'divider')).toBe(true);
    // 入學卡片必須提到實際分發到的高中
    const school = game.player?.school ?? '';
    expect(JSON.stringify(log)).toContain(school);
  });

  it('相同設定產生完全相同的球員', () => {
    expect(started().player).toEqual(started().player);
  });

  it('不同種子產生不同球員', () => {
    expect(started().player).not.toEqual(started({ seed: 'other' }).player);
  });
});

describe('卡片內文的跳脫', () => {
  // 介面層用 innerHTML 渲染卡片（高光標記需要），因此玩家輸入的字串必須跳脫。
  const evil = '<script>alert(1)</script>';

  it('球員姓名裡的 HTML 會被跳脫，不會變成標記', () => {
    const game = started({ name: evil });
    const body = JSON.stringify(game.flow.log);
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
  });

  it('跳脫不影響球員資料本身——只有卡片內文需要', () => {
    expect(started({ name: evil }).player?.name).toBe(evil);
  });
});

/** 把目前提問的第一個選項選下去，直到流程結束。 */
function playToEnd(game: Game, stopAtDraft = false): Game {
  while (game.flow.prompt !== null) {
    // 養成期的斷言必須在選秀前收手——流程接上職業之後會一路跑到引退，
    // 三十幾歲的能力早已被年齡曲線壓下去，拿它來驗證養成期的成長會失真。
    if (stopAtDraft && reachedDraft(game)) break;
    const first = game.flow.prompt.options[0];
    if (first === undefined) throw new Error('提問沒有選項');
    game.choose(first.id);
  }
  return game;
}

/** 流程是否已推進到選秀。 */
function reachedDraft(game: Game): boolean {
  return game.flow.prompt?.options.some((o) => o.id.startsWith('draft:')) === true;
}

/** 一路打到高中畢業為止，不進職業。 */
function playAmateur(game: Game): Game {
  return playToEnd(game, true);
}

/**
 * 把點數投進真正影響評價的能力，直到流程結束。
 *
 * playToEnd() 永遠選第一個選項，也就是體力——而體力在野手側的打擊計算裡不佔
 * 權重，那等於三年把點數倒進一個沒用的地方。要驗證成長相關的行為必須用這個。
 */
const EFFECTIVE = ['con', 'pow', 'eye', 'spd', 'rng', 'fld'];
function playWell(game: Game, stopAtDraft = false): Game {
  while (game.flow.prompt !== null) {
    if (stopAtDraft && reachedDraft(game)) break;
    const options = game.flow.prompt.options;
    const pick =
      EFFECTIVE.map((k) => options.find((o) => o.id === `alloc:${k}`)).find((o) => o !== undefined) ??
      options[0];
    if (pick === undefined) throw new Error('提問沒有選項');
    game.choose(pick.id);
  }
  return game;
}

describe('重播', () => {
  it('相同設定與相同選擇必定重現同一段生涯', () => {
    const a = playToEnd(started());

    const b = Game.replay(a.toReplayLog());

    expect(b.player).toEqual(a.player);
    expect(b.flow.log).toEqual(a.flow.log);
    expect(b.flow.choices).toEqual(a.flow.choices);
    expect(b.world.drawCounts()).toEqual(a.world.drawCounts());
    // 能力與蓄力槽都必須一致——重播重建的是完整狀態，不只是敘事
    expect(b.state?.ability).toEqual(a.state?.ability);
    expect(b.state?.carry).toEqual(a.state?.carry);
  });

  it('不同的選擇走出不同的能力分佈', () => {
    const a = started();
    a.choose('alloc:pow');
    const b = started();
    b.choose('alloc:ctl');
    expect(a.state?.ability).not.toEqual(b.state?.ability);
  });

  it('重播日誌帶著引擎版本', () => {
    expect(started().toReplayLog().engineVersion).toBe(ENGINE_VERSION);
  });

  it('跨版本一律拒絕重播，不嘗試相容', () => {
    const log = { ...started().toReplayLog(), engineVersion: ENGINE_VERSION + 1 };
    expect(() => Game.replay(log)).toThrow(/跨版本不保證重現/);
  });

  it('重播日誌只含設定與選擇——沒有任何狀態快照', () => {
    const game = playToEnd(started());
    const log = game.toReplayLog();

    // 重播日誌的價值不在體積——養成期每一點配點都是一次選擇，日誌其實可能比
    // 狀態快照還大。價值在於它是**最小的完整表述**且無法偽造：裡面沒有任何
    // 結果，只有輸入，所以伺服器能靠重跑驗證成績，而玩家改不出一個好成績。
    expect(Object.keys(log).sort()).toEqual(['choices', 'engineVersion', 'setup']);
    const serialised = JSON.stringify(log);
    expect(serialised).not.toContain('ability');
    expect(serialised).not.toContain('potential');
    expect(serialised).not.toContain('honors');
  });

  it('尚未做出任何選擇時也能重播', () => {
    const a = started();
    const b = Game.replay(a.toReplayLog());
    expect(b.player).toEqual(a.player);
    expect(b.flow.prompt).toEqual(a.flow.prompt);
  });
});

describe('子序列歸屬', () => {
  it('每個系統各走自己的子序列', () => {
    const counts = playToEnd(started()).world.drawCounts();
    expect(counts.genesis).toBeGreaterThan(0);
    expect(counts.growth).toBeGreaterThan(0);
    expect(counts.season).toBeGreaterThan(0);
    expect(counts.events).toBeGreaterThan(0);
    expect(counts.career).toBeGreaterThan(0);
    // 傷病判定還沒實作，這條流必須是零
    expect(counts.health).toBe(0);
  });
});

describe('步驟順序', () => {
  it('季初訓練的分配排在事件卡之前', () => {
    // 這是 unshift 與 push 的差別。用 push 會讓分配跑到事件卡與大賽之後，
    // 因為佇列裡已經排著本年度後續的步驟。
    const game = started();
    expect(game.flow.prompt?.options[0]?.id.startsWith('alloc:')).toBe(true);
  });

  it('一個年度的順序是：訓練 → 事件卡 → 大賽 → 分配大賽點數', () => {
    const game = started();
    const seen: string[] = [];
    while (game.flow.prompt !== null && seen.length < 40) {
      const title = game.flow.prompt.title ?? '';
      if (title.includes('顆骰')) seen.push('訓練');
      else if (title.startsWith('事件')) seen.push('事件');
      else if (title.includes('大賽點數')) seen.push('大賽點數');
      const first = game.flow.prompt.options[0];
      if (first === undefined) break;
      game.choose(first.id);
    }
    const order = seen.filter((s, i) => s !== seen[i - 1]);
    expect(order.slice(0, 3)).toEqual(['訓練', '事件', '大賽點數']);
  });
});

describe('養成六年（國中三年 + 高中三年）', () => {
  const totalYears = stageOf('JHS').years + stageOf('HS').years;

  it('跑完六年後畢業，年齡與年份都推進了六年', () => {
    const game = playAmateur(started());
    const origin = game.state?.origin;
    expect(game.state?.age).toBe((origin?.age ?? 0) + totalYears);
    expect(game.state?.year).toBe((origin?.year ?? 0) + totalYears);
  });

  it('每一年都有自己的分隔線，加上國中畢業與高中畢業各一條', () => {
    const dividers = playAmateur(started()).flow.log.filter((e) => e.kind === 'divider');
    expect(dividers).toHaveLength(totalYears + 2);
  });

  it('六年都打了大賽', () => {
    const cards = playToEnd(started()).flow.log.filter(
      (e) => e.kind === 'card' && e.title === '大賽結算',
    );
    expect(cards).toHaveLength(totalYears);
  });

  it('國中畢業後會換到高中，並重新分發學校', () => {
    const game = started();
    const jhs = game.state?.school ?? '';
    expect(Object.keys(amateur.junior_high.schools)).toContain(jhs);

    playToEnd(game);
    expect(game.state?.stage).toBe('HS');
    expect(Object.keys(amateur.high_school.schools)).toContain(game.state?.school ?? '');
  });

  it('能力在三年後明顯成長', () => {
    const game = playAmateur(started());
    const origin = game.state?.origin.ability ?? {};
    const now = game.state?.ability ?? {};
    const before = Object.values(origin).reduce((a, b) => a + b, 0);
    const after = Object.values(now).reduce((a, b) => a + b, 0);
    expect(after).toBeGreaterThan(before);
  });

  it('大賽冠軍的榮譽紀錄與敘事一致', () => {
    // 奪冠罕見，因此不斷言一定會發生，改為驗證兩者一致——這樣不依賴稀有事件
    // 也能抓到記錄漏掉或重複的錯誤。
    // 榮譽同時包含選秀輪次與國際賽名次（後者也以「冠軍」結尾），因此以大賽
    // 名稱精確比對，不能只看結尾。
    const cupNames = [...amateur.cups.JHS.names, ...amateur.cups.HS.names];
    for (let i = 0; i < 40; i++) {
      const game = playWell(started({ seed: `champ-${i}` }));
      const championCards = game.flow.log.filter(
        (e) => e.kind === 'card' && e.title === '冠軍',
      ).length;
      const honors = (game.state?.honors ?? []).filter((h) =>
        cupNames.some((cup) => h.endsWith(`${cup}冠軍`)),
      ).length;
      if (championCards === 0) expect(honors).toBe(0);
      else expect(honors).toBeGreaterThan(0);
    }
  });

  it('有效配點的成長明顯優於亂配', () => {
    const ovr = (g: Game) => g.rating?.overall ?? 0;
    let effective = 0;
    let naive = 0;
    for (let i = 0; i < 20; i++) {
      effective += ovr(playWell(started({ seed: `cmp-${i}` })));
      naive += ovr(playToEnd(started({ seed: `cmp-${i}` })));
    }
    expect(effective).toBeGreaterThan(naive);
  });

  it('大賽點數可以留著不分配', () => {
    const game = started();
    // 一路選「先留著」，點數應該累積起來
    while (game.flow.prompt !== null) {
      const keep = game.flow.prompt.options.find((o) => o.id === 'pool:keep');
      const first = game.flow.prompt.options[0];
      const pick = keep ?? first;
      if (pick === undefined) throw new Error('沒有選項');
      game.choose(pick.id);
    }
    expect(game.state?.pool).toBeGreaterThan(0);
  });
});

describe('訓練骰的分配', () => {
  it('每一顆骰都是一次選擇，全部記進重播日誌', () => {
    const game = playToEnd(started());
    const allocs = game.flow.choices.filter((c) => c.startsWith('alloc:'));
    expect(allocs.length).toBeGreaterThanOrEqual(2);
    // 分配的目標必須都是實際存在的能力
    for (const c of allocs) {
      expect(game.state?.ability).toHaveProperty(c.slice('alloc:'.length));
    }
  });

  it('能力總和在三年後上升——訓練的效果大於事件卡的損失', () => {
    // 個別能力可能因為事件卡的壞結果下降，因此比總和而非逐項比較。
    let rose = 0;
    const n = 20;
    for (let i = 0; i < n; i++) {
      const game = playWell(started({ seed: `sum-${i}` }), true);
      const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
      if (sum(game.state?.ability ?? {}) > sum(game.state?.origin.ability ?? {})) rose++;
    }
    expect(rose).toBe(n);
  });

  it('投入的點數不會憑空消失——不是變成能力就是留在蓄力槽', () => {
    const game = started();
    const before = { ...(game.state?.ability ?? {}) };
    const first = game.flow.prompt?.options[0];
    if (first === undefined) throw new Error('沒有提問');
    game.choose(first.id);

    const key = first.id.slice('alloc:'.length);
    const gained = (game.state?.ability[key] ?? 0) - (before[key] ?? 0);
    const carry = game.state?.carry[key] ?? 0;
    expect(gained > 0 || carry > 0).toBe(true);
  });
});

describe('國際賽冠軍的訓練骰加成', () => {
  // 加成只給國際賽。國內盃賽的回報已經是大賽點數與成就紀錄，再給訓練骰等於
  // 同一件事獎勵兩次——而且名門學校的球員本來就容易橫掃國內盃賽。
  const bonusCards = (game: Game) =>
    game.flow.log.filter(
      (e) => e.kind === 'card' && e.title === '季初訓練' && e.body.includes('國際賽冠軍'),
    );

  it('拿下國內盃賽冠軍不會多擲骰', () => {
    for (let i = 0; i < 40; i++) {
      const game = playAmateur(started({ seed: `dom-${i}` }));
      const log = game.flow.log;
      const wonDomestic = log.some(
        (e) => e.kind === 'card' && e.title === '大賽結算' && e.body.includes('的冠軍'),
      );
      const wonIntl = log.some(
        (e) => e.kind === 'card' && e.body.includes('最終 <b class="hl">冠軍</b>'),
      );
      // 只贏國內、沒贏國際的年份，不該出現加成提示
      if (wonDomestic && !wonIntl) expect(bonusCards(game)).toHaveLength(0);
    }
  });

  it('加成提示只在國際賽奪冠之後出現', () => {
    for (let i = 0; i < 60; i++) {
      const game = playAmateur(started({ seed: `intl-${i}` }));
      if (bonusCards(game).length === 0) continue;
      // 有加成就一定有國際賽冠軍
      expect(
        game.flow.log.some(
          (e) => e.kind === 'card' && e.body.includes('最終 <b class="hl">冠軍</b>'),
        ),
      ).toBe(true);
      return;
    }
  });
});
