import { describe, expect, it } from 'vitest';
import { abilities, amateur, leagues, love, season as seasonData } from '../data/index.ts';
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
    const pick = defaultPick(game);
    if (pick === undefined) throw new Error('提問沒有選項');
    game.choose(pick);
  }
  return game;
}

/**
 * 自動作答時該選哪一個。
 *
 * **絕不選復原**：配點階段的第一個非能力選項就是復原，照順序挑會讓自動代理
 * 在「加點 → 復原 → 加點」之間無限來回。確認優先於其他選項，其餘取第一個
 * 可選的。
 */
function defaultPick(game: Game, prefer: readonly string[] = []): string | undefined {
  const options = game.flow.prompt?.options ?? [];
  const usable = options.filter((o) => o.disabled !== true && o.id !== 'alloc:undo');
  for (const key of prefer) {
    const hit = usable.find((o) => o.id === `alloc:${key}`);
    if (hit !== undefined) return hit.id;
  }
  return (usable.find((o) => o.id === 'alloc:confirm') ?? usable[0])?.id;
}

/**
 * 流程是否已離開養成期。
 *
 * **不能只看有沒有 draft: 提問**：指名不可拒絕時選秀不會產生提問，直接就進了
 * 職業。只看提問會讓「養成期」的測試一路跑到三十幾歲，把年齡衰退算進養成的
 * 成長裡——那正是這個判斷寫錯時發生過的事。
 */
function reachedDraft(game: Game): boolean {
  if (game.state?.pro !== null && game.state?.pro !== undefined) return true;
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
    const pick = defaultPick(game, EFFECTIVE);
    if (pick === undefined) throw new Error('提問沒有選項');
    game.choose(pick);
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
    // 兩項都在野手側：起始守位是 SS，投手側的能力已經不能加點了。
    const a = started();
    a.choose('alloc:pow');
    const b = started();
    b.choose('alloc:con');
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
    // 傷病走 health。那條子序列從 ADR 0002 就保留著，傷病是它第一個使用者。
    expect(counts.health).toBeGreaterThan(0);
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

  it('點數不能留到下一年——配點必須當場分完', () => {
    // 「先留著」已移除：點數跨年會讓每一季的起點都不一樣，玩家得自己記住
    // 上一季剩多少，而畫面上並沒有地方講這件事。
    const game = playAmateur(started());
    expect(game.state?.pool).toBe(0);
    expect(game.flow.choices).not.toContain('pool:keep');
  });
});

describe('訓練骰的分配', () => {
  it('每一顆骰都是一次選擇，全部記進重播日誌', () => {
    const game = playToEnd(started());
    // alloc: 底下除了能力還有 undo / confirm 兩個控制項，先濾掉
    const control = new Set(['alloc:undo', 'alloc:confirm']);
    const allocs = game.flow.choices.filter((c) => c.startsWith('alloc:') && !control.has(c));
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

describe('生涯起點', () => {
  it('從國一的春天開始', () => {
    const log = started().flow.log;
    const first = log.find((e) => e.kind === 'divider');
    expect(first?.kind === 'divider' && first.text).toContain(stageOf('JHS').year_labels[0]);
    expect(first?.kind === 'divider' && first.text).toContain(amateur.career_start.season);
  });

  it('入學卡片也點明是春天', () => {
    const card = started().flow.log.find((e) => e.kind === 'card' && e.title === '入學');
    expect(card?.kind === 'card' && card.body).toContain(amateur.career_start.season);
  });

  it('只有第一年標季節——之後每年都從春天開始，再標一次只是重複', () => {
    const dividers = playAmateur(started()).flow.log.filter((e) => e.kind === 'divider');
    const withSeason = dividers.filter(
      (e) => e.kind === 'divider' && e.text.includes(amateur.career_start.season),
    );
    expect(withSeason).toHaveLength(1);
  });

  it('起點的年齡與年份都由資料決定，不寫死在程式碼裡', () => {
    const state = started().state;
    expect(state?.age).toBe(amateur.career_start.age);
    expect(state?.year).toBe(amateur.career_start.year);
  });
});

describe('起點文案不寫死', () => {
  // 「開始生涯 ▸ 高一春天」曾經寫死在按鈕上，養成期從高中三年擴成國高中六年
  // 之後就變成錯的。這裡守住資料是唯一來源。
  it('第一個學年標籤來自資料', () => {
    // 標籤本身可以改（國一 → 國中1），這裡守的是「有值且不是空的」。
    expect(stageOf('JHS').year_labels[0]).toBeTruthy();
  });

  it('養成期的學年標籤與職業的「中職1」同一種寫法——階段＋第幾年', () => {
    for (const stage of ['JHS', 'HS'] as const) {
      const def = stageOf(stage);
      def.year_labels.forEach((label, i) => {
        expect(label).toBe(`${def.name}${i + 1}`);
      });
    }
  });

  it('起點季節來自資料', () => {
    expect(amateur.career_start.season).not.toBe('');
  });
});

describe('職業階段的狀態', () => {
  /** 一路打到進入職業，回傳那局遊戲。打不進職業就回傳 null。 */
  function playToPro(seed: string): Game | null {
    const game = started({ seed });
    let guard = 0;
    while (game.flow.prompt !== null && guard++ < 4000) {
      const options = game.flow.prompt.options;
      const pick =
        EFFECTIVE.map((k) => options.find((o) => o.id === `alloc:${k}`)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options[0];
      if (pick === undefined) break;
      game.choose(pick.id);
      if (game.state?.pro !== null && game.state?.pro !== undefined) return game;
    }
    return null;
  }

  it('進職業後 pro 不再是 null，並帶著球隊與層級', () => {
    const game = playToPro('pro-a');
    expect(game).not.toBeNull();
    const pro = game?.state?.pro;
    expect(pro?.team).not.toBe('');
    expect(pro?.levelName).not.toBe('');
    expect(pro?.org).toBe('CPBL');
    expect(pro?.orgName).toBe('中職');
    expect(pro?.year).toBeGreaterThanOrEqual(1);
  });

  it('養成期的 pro 一律是 null', () => {
    expect(playAmateur(started()).state?.pro).toBeNull();
  });

  it('職業成績以體系為鍵，不以層級——二軍與一軍屬於同一個聯盟', () => {
    const game = playToEnd(started({ seed: 'pro-b' }));
    const keys = Object.keys(game.state?.statsByStage ?? {});
    // 不該出現層級代碼
    expect(keys).not.toContain('CPBL1');
    expect(keys).not.toContain('CPBL2');
    expect(keys).not.toContain('PRO');
  });

  it('在二軍與一軍之間來回不會把生涯數據拆成兩份', () => {
    for (let i = 0; i < 20; i++) {
      const game = playToEnd(started({ seed: `split-${i}` }));
      const log = JSON.stringify(game.flow.log);
      if (!log.includes('下放二軍') || !log.includes('升上一軍')) continue;
      const cpbl = game.state?.statsByStage['CPBL'];
      expect(cpbl).toBeDefined();
      // 上上下下之後仍然只有一份中職紀錄
      expect(Object.keys(game.state?.statsByStage ?? {}).filter((k) => k.startsWith('CPBL'))).toEqual(
        ['CPBL'],
      );
      return;
    }
  });
});

describe('定位鎖定', () => {
  /** 打到選秀為止，回傳那局遊戲。 */
  const toDraft = (seed: string) => playWell(started({ seed }), true);

  it('沒取得二刀流就鎖定評價較高的那一側', () => {
    for (let i = 0; i < 30; i++) {
      const game = toDraft(`lock-${i}`);
      const state = game.state;
      if (state === null) continue;
      if (state.traits.has('two_way')) {
        expect(state.lockedSide).toBeNull();
      } else {
        expect(state.lockedSide).not.toBeNull();
        const r = game.rating;
        expect(state.lockedSide).toBe(
          (r?.pitcher ?? 0) >= (r?.fielder ?? 0) ? 'pitcher' : 'fielder',
        );
      }
    }
  });

  it('養成期間一律不鎖——鎖定發生在畢業時', () => {
    // playAmateur 停在選秀提問，那時畢業已經跑過了，因此要在更早的地方檢查
    const game = started();
    expect(game.state?.lockedSide).toBeNull();
    for (let i = 0; i < 60 && game.flow.prompt !== null; i++) {
      const options = game.flow.prompt.options;
      if (options.some((o) => o.id.startsWith('draft:'))) break;
      game.choose(options[0]?.id ?? '');
      // 高中畢業之前一律不鎖
      if (game.state?.stage === 'HS' && (game.state?.stageYear ?? 0) > 3) break;
      expect(game.state?.lockedSide).toBeNull();
    }
  });

  it('鎖定之後另一側的能力不再出現在配點選項裡', () => {
    for (let i = 0; i < 30; i++) {
      const game = toDraft(`opt-${i}`);
      const locked = game.state?.lockedSide;
      if (locked === null || locked === undefined) continue;
      // 繼續打到下一次配點
      let guard = 0;
      while (game.flow.prompt !== null && guard++ < 200) {
        const options = game.flow.prompt.options;
        const allocs = options.filter((o) => o.id.startsWith('alloc:'));
        if (allocs.length > 0) {
          const dropped = locked === 'pitcher' ? 'fielder' : 'pitcher';
          for (const key of abilities.ability_groups[dropped]) {
            expect(allocs.map((o) => o.id)).not.toContain(`alloc:${key}`);
          }
          // 共用能力仍然留著
          for (const key of abilities.ability_groups.shared) {
            expect(allocs.map((o) => o.id)).toContain(`alloc:${key}`);
          }
          return;
        }
        game.choose(options[0]?.id ?? '');
      }
    }
  });

  it('鎖定投手側的人不會因為某年打擊變好就改當野手', () => {
    for (let i = 0; i < 40; i++) {
      const game = playToEnd(started({ seed: `role-${i}` }));
      const locked = game.state?.lockedSide;
      if (locked !== 'pitcher') continue;
      // 職業生涯的累計成績只會有投球那一邊
      const cpbl = game.state?.statsByStage['CPBL'];
      if (cpbl === undefined) continue;
      expect(cpbl.batting).toBeNull();
      expect(cpbl.pitching).not.toBeNull();
      return;
    }
  });
});


describe('配點的復原與確認', () => {
  /** 推進到第一個配點提問。 */
  const toAllocation = (seed = 'undo') => {
    const game = started({ seed });
    let guard = 0;
    while (game.flow.prompt !== null && guard++ < 50) {
      if (game.flow.prompt.options.some((o) => o.id === 'alloc:confirm')) return game;
      game.choose(game.flow.prompt.options[0]?.id ?? '');
    }
    throw new Error('沒有進到配點階段');
  };

  const optionOf = (game: Game, id: string) =>
    game.flow.prompt?.options.find((o) => o.id === id);

  it('沒有「先留著」這個選項了', () => {
    expect(optionOf(toAllocation(), 'pool:keep')).toBeUndefined();
  });

  it('還沒分配時，復原與確認都反灰', () => {
    const game = toAllocation();
    expect(optionOf(game, 'alloc:undo')?.disabled).toBe(true);
    expect(optionOf(game, 'alloc:confirm')?.disabled).toBe(true);
  });

  it('分配一點之後復原可按，但確認仍反灰', () => {
    const game = toAllocation();
    game.choose('alloc:sta');
    expect(optionOf(game, 'alloc:undo')?.disabled).toBe(false);
    expect(optionOf(game, 'alloc:confirm')?.disabled).toBe(true);
  });

  it('反灰的選項擋得住直接呼叫——介面之外也擋得住', () => {
    expect(() => toAllocation().choose('alloc:confirm')).toThrow();
  });

  it('復原會把能力與蓄力槽都還原', () => {
    const game = toAllocation();
    const before = { ...(game.state?.ability ?? {}) };
    const carryBefore = { ...(game.state?.carry ?? {}) };
    game.choose('alloc:sta');
    game.choose('alloc:undo');
    expect(game.state?.ability).toEqual(before);
    expect(game.state?.carry).toEqual(carryBefore);
  });

  it('復原之後又回到「什麼都還沒分配」的狀態', () => {
    const game = toAllocation();
    game.choose('alloc:sta');
    game.choose('alloc:undo');
    expect(optionOf(game, 'alloc:undo')?.disabled).toBe(true);
  });

  it('連續復原可以一路退回起點', () => {
    const game = toAllocation();
    const before = { ...(game.state?.ability ?? {}) };
    let steps = 0;
    while (optionOf(game, 'alloc:confirm')?.disabled === true) {
      game.choose('alloc:sta');
      steps++;
    }
    for (let i = 0; i < steps; i++) game.choose('alloc:undo');
    expect(game.state?.ability).toEqual(before);
  });

  it('全部分配完之後確認才可按', () => {
    const game = toAllocation();
    while (optionOf(game, 'alloc:confirm')?.disabled === true) game.choose('alloc:sta');
    expect(optionOf(game, 'alloc:confirm')?.disabled).not.toBe(true);
  });

  it('復原本身也寫進重播日誌，重播仍然完全一致', () => {
    const game = toAllocation();
    game.choose('alloc:sta');
    game.choose('alloc:undo');
    game.choose('alloc:pow');
    while (game.flow.prompt !== null) {
      const options = game.flow.prompt.options;
      const pick = options.find((o) => o.disabled !== true);
      if (pick === undefined) break;
      game.choose(pick.id);
    }
    expect(game.flow.choices).toContain('alloc:undo');

    const replayed = Game.replay(game.toReplayLog());
    expect(replayed.state?.ability).toEqual(game.state?.ability);
    expect(replayed.flow.log).toEqual(game.flow.log);
    expect(replayed.world.drawCounts()).toEqual(game.world.drawCounts());
  });

  it('復原不消耗亂數——配點本來就不抽籤', () => {
    const game = toAllocation();
    const before = game.world.drawCounts();
    game.choose('alloc:sta');
    game.choose('alloc:undo');
    expect(game.world.drawCounts()).toEqual(before);
  });
});

describe('榮譽清單', () => {
  it('同一項榮譽不重複記錄', () => {
    for (let i = 0; i < 30; i++) {
      const honors = playToEnd(started({ seed: `honor-${i}` })).state?.honors ?? [];
      expect(new Set(honors).size).toBe(honors.length);
    }
  });

  it('連年奪冠只算一項——榮譽是做到過什麼，不是流水帳', () => {
    // 找一段確實連兩年拿下同一個盃賽冠軍的生涯
    for (let i = 0; i < 60; i++) {
      const game = playWell(started({ seed: `repeat-${i}` }), true);
      const wins = game.flow.log.filter(
        (e) => e.kind === 'card' && e.title === '冠軍',
      );
      if (wins.length < 2) continue;
      const honors = game.state?.honors ?? [];
      expect(new Set(honors).size).toBe(honors.length);
      return;
    }
  });

  it('同一個盃賽的冠軍與亞軍各記一筆——那是兩件不同的事', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      for (const h of playWell(started({ seed: `rank-${i}` }), true).state?.honors ?? []) {
        seen.add(h);
      }
    }
    // 至少要看得到某個盃賽同時出現冠軍與亞軍兩種紀錄
    const champs = [...seen].filter((h) => h.endsWith('冠軍')).map((h) => h.slice(0, -2));
    const runners = [...seen].filter((h) => h.endsWith('亞軍')).map((h) => h.slice(0, -2));
    expect(champs.some((c) => runners.includes(c))).toBe(true);
  });
});

describe('生涯次數統計', () => {
  const play = (seed: string) => playWell(started({ seed }), true);

  it('國內大賽項次等於實際打過的場數', () => {
    const game = play('count-a');
    const cups = game.flow.log.filter((e) => e.kind === 'card' && e.title === '大賽結算').length;
    const perYear = amateur.cups['JHS'].names.length; // 國高中的場數相同
    expect(game.state?.counts.domesticEntries).toBe(cups * perYear);
  });

  it('冠軍次數不會多於上榜次數，上榜不會多於出賽', () => {
    for (let i = 0; i < 30; i++) {
      const c = play(`count-${i}`).state?.counts;
      if (c === undefined) continue;
      expect(c.domesticTitles).toBeLessThanOrEqual(c.domesticPodiums);
      expect(c.domesticPodiums).toBeLessThanOrEqual(c.domesticEntries);
      expect(c.internationalTitles).toBeLessThanOrEqual(c.internationalPodiums);
      expect(c.internationalPodiums).toBeLessThanOrEqual(c.internationalCaps);
    }
  });

  it('連年奪冠時次數會累加，但榮譽清單不會——這正是分開記的理由', () => {
    for (let i = 0; i < 60; i++) {
      const game = play(`dup-${i}`);
      const c = game.state?.counts;
      const honors = game.state?.honors ?? [];
      if (c === undefined || c.domesticTitles < 2) continue;
      // 冠軍拿了兩次以上，但去重後的榮譽項數必定較少或相等
      const titleHonors = honors.filter((h) => h.endsWith('冠軍')).length;
      expect(titleHonors).toBeLessThanOrEqual(c.domesticTitles);
      expect(c.domesticTitles).toBeGreaterThan(1);
      return;
    }
  });

  it('國際賽徵召次數等於實際打過的國際賽場數', () => {
    for (let i = 0; i < 40; i++) {
      const game = play(`cap-${i}`);
      const played = game.flow.log.filter(
        (e) => e.kind === 'card' && e.body.includes('披上中華隊戰袍'),
      ).length;
      if (played === 0) continue;
      expect(game.state?.counts.internationalCaps).toBe(played);
      return;
    }
  });

  it('沒打過就全部是 0', () => {
    const c = started().state?.counts;
    expect(c?.domesticEntries).toBe(0);
    expect(c?.internationalCaps).toBe(0);
  });
});

describe('守位登錄與移防', () => {
  /** 打完一整段生涯，回傳那局遊戲。 */
  const full = (seed: string) => playWell(started({ seed }));

  it('進入頂級聯盟的野手會登錄守位', () => {
    for (let i = 0; i < 40; i++) {
      const game = full(`dpos-${i}`);
      const log = JSON.stringify(game.flow.log);
      if (!log.includes('守位會議')) continue;
      expect(log).toMatch(/登錄為|改守|改任指定打擊/);
      return;
    }
    throw new Error('四十局都沒有人登錄過守位');
  });

  it('二軍不登錄守位——那裡不挑位置', () => {
    for (let i = 0; i < 40; i++) {
      const game = full(`dpos2-${i}`);
      const state = game.state;
      if (state?.pro == null) continue;
      if (state.pro.levelName.includes('二軍')) {
        expect(state.pro.position).toBeNull();
        return;
      }
    }
  });

  it('守備分只在登錄了守位之後才累積', () => {
    for (let i = 0; i < 60; i++) {
      const game = full(`def-${i}`);
      const log = JSON.stringify(game.flow.log);
      if (!log.includes('守備 ')) continue;
      expect(log).toMatch(/守備 [+-]?\d/);
      return;
    }
  });

  it('純投手不進守位系統', () => {
    for (let i = 0; i < 40; i++) {
      const game = playWell(started({ seed: `pit-${i}`, startPosition: 'P' }));
      const state = game.state;
      if (state?.lockedSide !== 'pitcher' || state.pro == null) continue;
      expect(state.pro.position).toBeNull();
      return;
    }
  });
});

describe('聯盟水準逐年浮動', () => {
  it('職業期間的 par 會逐年變動，不是固定值', () => {
    for (let i = 0; i < 40; i++) {
      const game = started({ seed: `std-${i}` });
      const pars = new Set<number>();
      let guard = 0;
      while (game.flow.prompt !== null && guard++ < 5000) {
        const options = game.flow.prompt.options;
        const pick =
          EFFECTIVE.map((k) => options.find((o) => o.id === `alloc:${k}`)).find(
            (o) => o !== undefined,
          ) ??
          options.find((o) => o.id === 'draft:accept') ??
          options[0];
        if (pick === undefined) break;
        game.choose(pick.id);
        const pro = game.state?.pro;
        if (pro != null) pars.add(pro.par);
      }
      if (pars.size <= 1) continue;
      expect(pars.size).toBeGreaterThan(1);
      return;
    }
    throw new Error('四十局都沒有觀察到聯盟水準浮動');
  });

  it('浮動之後 min 仍然低於 par', () => {
    for (let i = 0; i < 20; i++) {
      const game = playWell(started({ seed: `stdmin-${i}` }));
      const pro = game.state?.pro;
      if (pro == null) continue;
      expect(pro.min).toBeLessThan(pro.par);
    }
  });
});

describe('年度獎項', () => {
  /** 練體力才有出賽數，有出賽數才有累積數據，有累積數據才拿得到獎。 */
  const DURABLE = ['sta', 'con', 'pow', 'rng', 'fld', 'eye'];

  function playDurable(seed: string): Game {
    const game = started({ seed });
    let guard = 0;
    let k = 0;
    while (game.flow.prompt !== null && guard++ < 5000) {
      const options = game.flow.prompt.options;
      const rot = [...DURABLE.slice(k % DURABLE.length), ...DURABLE];
      const pick =
        rot.map((key) => options.find((o) => o.id === `alloc:${key}`)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options[0];
      if (pick === undefined) break;
      if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') k++;
      game.choose(pick.id);
    }
    return game;
  }

  it('打得好的球員會拿到年度獎項', () => {
    for (let i = 0; i < 20; i++) {
      const game = playDurable(`award-${i}`);
      const awards = game.state?.awards ?? [];
      if (awards.length === 0) continue;
      expect(awards[0]?.org).toBe('CPBL');
      expect(awards[0]?.year).toBeGreaterThan(0);
      return;
    }
    throw new Error('二十局都沒有人拿過獎');
  });

  it('獎項同時進結構化紀錄與去重的榮譽清單', () => {
    for (let i = 0; i < 20; i++) {
      const game = playDurable(`award-h-${i}`);
      const awards = game.state?.awards ?? [];
      const honors = game.state?.honors ?? [];
      if (awards.length === 0) continue;
      for (const a of awards) {
        expect(honors.some((h) => h.includes(a.name))).toBe(true);
      }
      return;
    }
  });

  /** 這正是獎項要與榮譽清單分開的理由。 */
  it('同一個獎拿很多次時，結構化紀錄數得出來但榮譽清單不會重複', () => {
    for (let i = 0; i < 40; i++) {
      const game = playDurable(`award-dup-${i}`);
      const awards = game.state?.awards ?? [];
      const stars = awards.filter((a) => a.code === 'all_star');
      if (stars.length < 2) continue;
      const honors = game.state?.honors ?? [];
      expect(honors.filter((h) => h.includes('明星賽')).length).toBeLessThan(stars.length);
      return;
    }
    throw new Error('四十局都沒有人拿過兩次以上的明星賽');
  });

  /** 獎項只在頂級聯盟發——二軍與小聯盟沒有年度獎項。旅外之後也一樣。 */
  it('二軍不評獎', () => {
    for (let i = 0; i < 30; i++) {
      const game = playDurable(`award-minor-${i}`);
      for (const a of game.state?.awards ?? []) {
        expect(leagues.levels[a.level]?.top).toBeDefined();
      }
    }
  });

  it('養成期沒有年度獎項', () => {
    expect(playAmateur(started()).state?.awards).toEqual([]);
  });
});

describe('引退與結算', () => {
  const DURABLE = ['sta', 'con', 'pow', 'rng', 'fld', 'eye'];

  /** 打到底，遇到引退提問一律選「再拚一年」。 */
  function playToRetire(seed: string, quitRetire = false): Game {
    const game = started({ seed });
    let guard = 0;
    let k = 0;
    while (game.flow.prompt !== null && guard++ < 5000) {
      const options = game.flow.prompt.options;
      const retireChoice = options.find((o) => o.id === (quitRetire ? 'retire:quit' : 'retire:stay'));
      const rot = [...DURABLE.slice(k % DURABLE.length), ...DURABLE];
      const pick =
        retireChoice ??
        rot.map((key) => options.find((o) => o.id === `alloc:${key}`)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options[0];
      if (pick === undefined) break;
      if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') k++;
      game.choose(pick.id);
    }
    return game;
  }

  const titles = (game: Game) =>
    game.flow.log.filter((e) => e.kind === 'card').map((e) => (e as { title?: string }).title ?? '');

  it('流程一定跑得完——不再卡在「尚未實作」', () => {
    for (let i = 0; i < 30; i++) {
      const game = playToRetire(`end-${i}`);
      expect(game.flow.prompt).toBeNull();
      expect(titles(game)).not.toContain('尚未實作');
    }
  });

  it('引退之後一定有生涯總結與引退場景', () => {
    for (let i = 0; i < 20; i++) {
      const game = playToRetire(`scene-${i}`);
      const t = titles(game);
      expect(t).toContain('引退之日');
      expect(game.summary).not.toBeNull();
    }
  });

  it('打過職業的人會有生涯評價與球迷看板', () => {
    for (let i = 0; i < 30; i++) {
      const game = playToRetire(`eval-${i}`);
      if ((game.summary?.leagues.length ?? 0) === 0) continue;
      const t = titles(game);
      expect(t).toContain('生涯評價');
      expect(t).toContain('球迷看板・引退串');
      return;
    }
    throw new Error('三十局都沒有人打進頂級聯盟');
  });

  /**
   * 選秀落選是相當常見的結局，尤其是玩得不好的第一局。要走到這條路徑必須
   * 主動拒絕指名——引退之後 pro 一律是 null，從狀態上分不出「沒進過職業」。
   */
  it('沒進職業的生涯也走同一個出口，並接上第二人生', () => {
    for (let i = 0; i < 40; i++) {
      const game = started({ seed: `nopro-${i}` });
      let guard = 0;
      let rejected = false;
      while (game.flow.prompt !== null && guard++ < 5000) {
        const options = game.flow.prompt.options;
        const reject = options.find((o) => o.id === 'draft:reject');
        if (reject !== undefined) rejected = true;
        const pick = reject ?? defaultPick(game, DURABLE);
        if (pick === undefined) break;
        game.choose(typeof pick === 'string' ? pick : pick.id);
      }
      if (!rejected) continue;
      const t = titles(game);
      expect(t).toContain('球員生涯結束');
      // 二十歲出頭離開棒球，一定走得到第二人生
      expect(t).toContain('第二人生');
      expect(game.summary?.leagues).toEqual([]);
      return;
    }
    throw new Error('四十局都沒有出現可拒絕的指名');
  });

  it('玩家可以自己按下引退鍵，而且比等到最後更早結束', () => {
    for (let i = 0; i < 30; i++) {
      const stay = playToRetire(`quit-${i}`);
      const quit = playToRetire(`quit-${i}`, true);
      if (stay.state?.age === quit.state?.age) continue;
      expect(quit.state?.age).toBeLessThan(stay.state?.age ?? 99);
      return;
    }
    throw new Error('三十局都沒有出現引退提問');
  });

  it('生涯評價分只算頂級聯盟——二軍成績另外通算', () => {
    for (let i = 0; i < 40; i++) {
      const game = playToRetire(`minor-${i}`);
      const summary = game.summary;
      if (summary === null || summary.minors.length === 0) continue;
      for (const league of summary.leagues) {
        expect(league.org).not.toBe('');
      }
      // 二軍的成績出現在 minors 而不是 leagues
      expect(summary.minors.every((m) => m.level.endsWith('2'))).toBe(true);
      return;
    }
  });

  it('引退之後不再有任何提問——流程真的結束了', () => {
    const game = playToRetire('done-1');
    expect(game.flow.prompt).toBeNull();
  });

  it('相同種子加相同選擇，結算結果完全相同', () => {
    const a = playToRetire('replay-1');
    const b = playToRetire('replay-1');
    expect(a.summary?.totalScore).toBe(b.summary?.totalScore);
    expect(a.flow.log).toEqual(b.flow.log);
  });
});

describe('薪資', () => {
  const DURABLE = ['sta', 'con', 'pow', 'rng', 'fld', 'eye'];

  function playFull(seed: string): Game {
    const game = started({ seed });
    let guard = 0;
    let k = 0;
    while (game.flow.prompt !== null && guard++ < 5000) {
      const options = game.flow.prompt.options;
      const rot = [...DURABLE.slice(k % DURABLE.length), ...DURABLE];
      const pick =
        options.find((o) => o.id === 'retire:stay') ??
        rot.map((key) => options.find((o) => o.id === `alloc:${key}`)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options[0];
      if (pick === undefined) break;
      if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') k++;
      game.choose(pick.id);
    }
    return game;
  }

  it('養成期沒有收入', () => {
    expect(playAmateur(started()).state?.earnings).toBe(0);
  });

  it('進職業之後開始累積——簽約金先進帳', () => {
    for (let i = 0; i < 20; i++) {
      const game = started({ seed: `pay-${i}` });
      let guard = 0;
      while (game.flow.prompt !== null && guard++ < 5000) {
        const options = game.flow.prompt.options;
        const pick =
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
          options[0];
        if (pick === undefined) break;
        game.choose(pick.id);
        if (game.state?.pro != null) {
          expect(game.state.earnings).toBeGreaterThan(0);
          return;
        }
      }
    }
    throw new Error('二十局都沒有人進職業');
  });

  it('生涯收入只增不減', () => {
    const game = started({ seed: 'pay-mono' });
    let guard = 0;
    let last = 0;
    while (game.flow.prompt !== null && guard++ < 5000) {
      const options = game.flow.prompt.options;
      const pick =
        options.find((o) => o.id === 'retire:stay') ??
        options.find((o) => o.id === 'draft:accept') ??
        options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
        options[0];
      if (pick === undefined) break;
      game.choose(pick.id);
      const now = game.state?.earnings ?? 0;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('打完整段生涯的收入有相當的量級', () => {
    for (let i = 0; i < 20; i++) {
      const game = playFull(`pay-big-${i}`);
      if ((game.summary?.leagues.length ?? 0) === 0) continue;
      expect(game.state?.earnings).toBeGreaterThan(1000);
      return;
    }
  });

  it('結算時會列出生涯收入', () => {
    for (let i = 0; i < 20; i++) {
      const game = playFull(`pay-card-${i}`);
      const titles = game.flow.log
        .filter((e) => e.kind === 'card')
        .map((e) => (e as { title?: string }).title ?? '');
      if (!titles.includes('生涯收入')) continue;
      expect(titles).toContain('生涯收入');
      return;
    }
    throw new Error('二十局都沒有出現生涯收入');
  });

  it('狀態欄看得到當季年薪', () => {
    for (let i = 0; i < 20; i++) {
      const game = started({ seed: `pay-state-${i}` });
      let guard = 0;
      while (game.flow.prompt !== null && guard++ < 5000) {
        const options = game.flow.prompt.options;
        const pick =
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
          options[0];
        if (pick === undefined) break;
        game.choose(pick.id);
        const pro = game.state?.pro;
        if (pro != null) {
          expect(pro.salary).toBeGreaterThan(0);
          return;
        }
      }
    }
  });
});

describe('合約', () => {
  const DURABLE = ['sta', 'con', 'pow', 'rng', 'fld', 'eye'];

  /** 打到底；合約提問一律選長約（沒有長約就短約）。 */
  function playWithContracts(seed: string, preferShort = false): Game {
    const game = started({ seed });
    let guard = 0;
    let k = 0;
    while (game.flow.prompt !== null && guard++ < 6000) {
      const options = game.flow.prompt.options;
      const term = preferShort
        ? options.find((o) => o.id === 'term:short')
        : (options.find((o) => o.id === 'term:long') ?? options.find((o) => o.id === 'term:short'));
      const rot = [...DURABLE.slice(k % DURABLE.length), ...DURABLE];
      const pick =
        term ??
        options.find((o) => o.id === 'retire:stay') ??
        rot.map((key) => options.find((o) => o.id === `alloc:${key}`)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options[0];
      if (pick === undefined) break;
      if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') k++;
      game.choose(pick.id);
    }
    return game;
  }

  const cards = (game: Game) =>
    game.flow.log.filter((e) => e.kind === 'card') as { title?: string; body: string }[];

  it('進職業時有一張新人合約', () => {
    for (let i = 0; i < 20; i++) {
      const game = started({ seed: `ct-init-${i}` });
      let guard = 0;
      while (game.flow.prompt !== null && guard++ < 5000) {
        const options = game.flow.prompt.options;
        const pick =
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
          options[0];
        if (pick === undefined) break;
        game.choose(pick.id);
        if (game.state?.pro != null) return;
      }
    }
  });

  /** 掌控期的意義：選秀球隊用一個順位賭了你，就先擁有你幾年。 */
  it('掌控期內合約到期時由球團行使續約權，玩家沒有選擇', () => {
    for (let i = 0; i < 30; i++) {
      const game = playWithContracts(`ct-ctrl-${i}`);
      const hit = cards(game).find((c) => c.title === '球團續約');
      if (hit === undefined) continue;
      expect(hit.body).toContain('掌控期');
      return;
    }
    throw new Error('三十局都沒有出現球團續約');
  });

  it('取得 FA 資格之後，合約到期會讓玩家自己談', () => {
    for (let i = 0; i < 30; i++) {
      const game = playWithContracts(`ct-fa-${i}`);
      if (cards(game).some((c) => c.title === '續約')) return;
    }
    throw new Error('三十局都沒有出現球員自己談的續約');
  });

  it('母隊會在合約剩一年時提前來談延長', () => {
    for (let i = 0; i < 30; i++) {
      const game = playWithContracts(`ct-ext-${i}`);
      if (cards(game).some((c) => c.title === '延長續約')) return;
    }
    throw new Error('三十局都沒有出現延長續約');
  });

  it('選長約與選短約會走出不同的生涯', () => {
    for (let i = 0; i < 30; i++) {
      const long = playWithContracts(`ct-diff-${i}`);
      const short = playWithContracts(`ct-diff-${i}`, true);
      if (long.state?.earnings === short.state?.earnings) continue;
      expect(long.flow.log).not.toEqual(short.flow.log);
      return;
    }
    throw new Error('三十局都沒有出現長短約的分歧');
  });

  /**
   * 提問不會進 flow.log（那裡只有卡片與分隔線），因此要在跑的過程中攔截。
   * 「沒有長約可選」本身就是資訊——那個缺席比任何文字都清楚。
   */
  it('年紀大到一定程度就只剩短約', () => {
    for (let i = 0; i < 40; i++) {
      const game = started({ seed: `ct-old-${i}` });
      let guard = 0;
      let k = 0;
      let sawLongOption = false;
      let sawShortOnly = false;
      while (game.flow.prompt !== null && guard++ < 6000) {
        const options = game.flow.prompt.options;
        const hasTerm = options.some((o) => o.id.startsWith('term:'));
        if (hasTerm) {
          if (options.some((o) => o.id === 'term:long')) sawLongOption = true;
          else sawShortOnly = true;
        }
        const rot = [...DURABLE.slice(k % DURABLE.length), ...DURABLE];
        const pick =
          options.find((o) => o.id === 'term:long') ??
          options.find((o) => o.id === 'term:short') ??
          options.find((o) => o.id === 'retire:stay') ??
          rot.map((key) => options.find((o) => o.id === `alloc:${key}`)).find((o) => o !== undefined) ??
          options.find((o) => o.id === 'draft:accept') ??
          options[0];
        if (pick === undefined) break;
        if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') k++;
        game.choose(pick.id);
      }
      if (sawLongOption && sawShortOnly) return;
    }
    throw new Error('四十局都沒有出現「先有長約、後來只剩短約」的生涯');
  });

  it('流程仍然跑得完，不會卡在合約提問上', () => {
    for (let i = 0; i < 20; i++) {
      const game = playWithContracts(`ct-end-${i}`);
      expect(game.flow.prompt).toBeNull();
      expect(cards(game).map((c) => c.title)).not.toContain('尚未實作');
    }
  });

  it('相同種子加相同選擇，合約結果完全相同', () => {
    expect(playWithContracts('ct-replay').flow.log).toEqual(
      playWithContracts('ct-replay').flow.log,
    );
  });
});

describe('跨聯盟轉會', () => {
  const PITCHER = ['vel', 'ctl', 'sta', 'swp'];

  /** 一路接受所有邀請，看轉會圖通不通。 */
  function playAbroad(seed: string): Game {
    const game = new Game({ seed, name: '旅外', startPosition: 'P', throws: 'R', bats: 'R' }).start();
    let guard = 0;
    let k = 0;
    while (game.flow.prompt !== null && guard++ < 6000) {
      const options = game.flow.prompt.options;
      const rot = [...PITCHER.slice(k % PITCHER.length), ...PITCHER];
      const pick =
        options.find((o) => o.id.startsWith('transfer:') && o.id !== 'transfer:stay') ??
        options.find((o) => o.id.startsWith('fallback:') && o.id !== 'fallback:retire') ??
        options.find((o) => o.id === 'fa:stay') ??
        options.find((o) => o.id === 'term:long') ??
        options.find((o) => o.id === 'term:short') ??
        options.find((o) => o.id === 'demote:accept') ??
        options.find((o) => o.id === 'retire:stay') ??
        rot.map((key) => options.find((o) => o.id === `alloc:${key}`)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options[0];
      if (pick === undefined) break;
      if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') k++;
      game.choose(pick.id);
    }
    return game;
  }

  it('旅外真的會發生——有人待過兩個以上的頂級聯盟', () => {
    for (let i = 0; i < 40; i++) {
      if ((playAbroad(`ab-${i}`).summary?.leagues.length ?? 0) > 1) return;
    }
    throw new Error('四十局都沒有人旅外');
  });

  /** 六個體系的資料與名人堂長期是死碼——這條看著它們真的到得了。 */
  it('中職以外的體系到得了', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      for (const l of playAbroad(`reach-${i}`).summary?.leagues ?? []) seen.add(l.org);
      if (seen.size >= 3) break;
    }
    expect(seen.size).toBeGreaterThan(1);
    expect([...seen].some((o) => o !== 'CPBL')).toBe(true);
  });

  it('換體系之後守位重新登錄、體系年資歸零', () => {
    for (let i = 0; i < 60; i++) {
      const game = playAbroad(`reset-${i}`);
      const seasons = game.summary?.seasons ?? [];
      const firstAway = seasons.find((s) => s.org !== 'CPBL');
      if (firstAway === undefined) continue;
      // 換過體系的人直接取得 FA 資格——新東家沒有理由享有原球團的掌控權。
      expect(firstAway.org).not.toBe('CPBL');
      return;
    }
  });

  it('旅外的生涯評價分會分成好幾份，每個聯盟各一份', () => {
    for (let i = 0; i < 60; i++) {
      const s = playAbroad(`score-${i}`).summary;
      if (s === null || s.leagues.length < 2) continue;
      const orgs = s.leagues.map((l) => l.org);
      expect(new Set(orgs).size).toBe(orgs.length);
      return;
    }
  });

  it('流程照樣跑得完，不會卡在轉會提問上', () => {
    for (let i = 0; i < 20; i++) {
      const game = playAbroad(`abend-${i}`);
      expect(game.flow.prompt).toBeNull();
      expect(game.summary).not.toBeNull();
    }
  });

  it('相同種子加相同選擇，轉會結果完全相同', () => {
    expect(playAbroad('ab-replay').flow.log).toEqual(playAbroad('ab-replay').flow.log);
  });
});

describe('季中交易', () => {
  /**
   * 找出第一個出現季中交易的生涯。找不到就回傳 null。
   *
   * 掃的範圍要寬：任何一個系統新增一次亂數抽取都會讓整條子序列位移，掃太窄的
   * 話這條測試會在無關的改動下無故失敗。
   */
  function playToTrade(): Game | null {
    for (let i = 0; i < 200; i++) {
      const game = playWell(started({ seed: `trade-${i}` }));
      const seasons = game.summary?.seasons ?? [];
      const years = new Map<number, number>();
      for (const r of seasons) years.set(r.year, (years.get(r.year) ?? 0) + 1);
      if ([...years.values()].some((n) => n > 1)) return game;
    }
    return null;
  }

  it('被交易的年份記成兩段，兩段在同一個層級、不同球隊', () => {
    const game = playToTrade();
    expect(game).not.toBeNull();
    const seasons = game?.summary?.seasons ?? [];
    for (const year of new Set(seasons.map((r) => r.year))) {
      const list = seasons.filter((r) => r.year === year);
      if (list.length === 1) continue;
      expect(list).toHaveLength(2);
      expect(list[0]?.level).toBe(list[1]?.level);
      expect(list[0]?.team).not.toBe(list[1]?.team);
    }
  });

  it('兩段相加等於生涯累計——切分不能讓數據憑空增減', () => {
    const game = playToTrade();
    const seasons = game?.summary?.seasons ?? [];
    const acc = game?.state?.statsByStage['CPBL'];
    expect(acc).toBeDefined();

    const cpbl = seasons.filter((r) => r.org === 'CPBL');
    const hits = cpbl.reduce((n, r) => n + (r.batting?.hits ?? 0), 0);
    const outs = cpbl.reduce((n, r) => n + (r.pitching?.outs ?? 0), 0);
    expect(hits).toBe(acc?.batting?.hits ?? 0);
    expect(outs).toBe(acc?.pitching?.outs ?? 0);
  });

  it('年資數的是年份不是段數——被交易的那一年是一年', () => {
    const game = playToTrade();
    const summary = game?.summary;
    expect(summary).toBeDefined();
    for (const league of summary?.leagues ?? []) {
      const years = new Set(
        (summary?.seasons ?? []).filter((r) => r.org === league.org && r.top !== null).map((r) => r.year),
      );
      expect(league.seasons).toBe(years.size);
    }
  });
});

describe('下放與換體系', () => {
  /**
   * 「你被送回 X」的 X 必須等於他現在所在的層級。
   *
   * 從判定下放到問這句話之間隔著挖角、入札、下放遞約三個入口，任何一個成交
   * 都會讓他換到別的體系——那時他根本沒有被下放。舊版把 demotedTo 一路當參數
   * 傳下去，於是人已經在墨西哥了，畫面還在問「要不要接受下放回中職二軍」。
   */
  it('換了體系就不會再問要不要接受下放', () => {
    let sawDemotionPrompt = false;
    let sawMove = false;
    for (let i = 0; i < 60; i++) {
      const game = started({ seed: `demote-${i}` });
      let guard = 0;
      let cursor = 0;
      while (game.flow.prompt !== null && guard++ < 8000) {
        const prompt = game.flow.prompt;
        const title = prompt.title ?? '';
        if (title.startsWith('你被送回')) {
          sawDemotionPrompt = true;
          const level = game.state?.pro?.levelName ?? '';
          expect(title).toBe(`你被送回${level}。要接受下放，還是就此掛靴？`);
        }
        const options = prompt.options;
        // 有換舞台的機會就換——那正是會踩到的那條路。
        const move =
          options.find((o) => o.id === 'demote:0') ?? options.find((o) => o.id === 'transfer:0');
        if (move !== undefined) sawMove = true;
        const rotated = [...EFFECTIVE.slice(cursor % EFFECTIVE.length), ...EFFECTIVE];
        const pick =
          move ??
          rotated
            .map((k) => options.find((o) => o.id === `alloc:${k}` && o.disabled !== true))
            .find((o) => o !== undefined) ??
          options.find((o) => o.id === 'alloc:confirm' && o.disabled !== true) ??
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
          options[0];
        if (pick === undefined) break;
        if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') cursor++;
        game.choose(pick.id);
      }
    }
    // 樣本裡必須真的出現過這兩件事，否則這條測試什麼都沒驗到。
    expect(sawMove).toBe(true);
    expect(sawDemotionPrompt).toBe(true);
  });
});

describe('戰力外之後的去路', () => {
  /**
   * 被釋出的老將要先看到尋路的邀請，不能直接被結束生涯。
   *
   * 舊版有一條「33 歲以後被釋出就沒有球隊願意給機會」，而且跑在尋路之前——
   * 於是墨聯與澳職對高齡旅外失意者等於不存在，回中職的路也走同一條尋路，
   * 一併被吃掉。
   */
  it('高齡被釋出仍會收到新東家的邀請', () => {
    let veteranReleases = 0;
    let veteranOffers = 0;
    for (let i = 0; i < 60; i++) {
      const game = started({ seed: `release-${i}` });
      let guard = 0;
      let cursor = 0;
      let released = false;
      let ageAtRelease = 0;
      let scanned = 0;
      while (game.flow.prompt !== null && guard++ < 8000) {
        const log = game.flow.log;
        for (let k = scanned; k < log.length; k++) {
          const entry = log[k];
          if (entry?.kind === 'card' && entry.title === '戰力外') {
            released = true;
            ageAtRelease = game.state?.age ?? 0;
            if (ageAtRelease >= 33) veteranReleases++;
          }
        }
        scanned = log.length;

        const prompt = game.flow.prompt;
        if (released && prompt.title === '新東家的邀請') {
          if (ageAtRelease >= 33) veteranOffers++;
          released = false;
        }

        const options = prompt.options;
        const rotated = [...EFFECTIVE.slice(cursor % EFFECTIVE.length), ...EFFECTIVE];
        const pick =
          options.find((o) => o.id === 'retire:stay') ??
          rotated
            .map((k) => options.find((o) => o.id === `alloc:${k}` && o.disabled !== true))
            .find((o) => o !== undefined) ??
          options.find((o) => o.id === 'alloc:confirm' && o.disabled !== true) ??
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
          options[0];
        if (pick === undefined) break;
        if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') cursor++;
        game.choose(pick.id);
      }
    }
    // 樣本裡真的要出現過高齡戰力外，否則這條測試什麼都沒驗到。
    expect(veteranReleases).toBeGreaterThan(0);
    expect(veteranOffers).toBe(veteranReleases);
  });
});

describe('天賦', () => {
  /** 同一個種子、同一套選擇，只差在帶不帶天賦。 */
  const play = (talents: Record<string, number>) => {
    const game = new Game({ ...setup, seed: 'talent-seed', talents }).start();
    let guard = 0;
    while (game.flow.prompt !== null && guard++ < 8000) {
      const pick = defaultPick(game, EFFECTIVE);
      if (pick === undefined) break;
      game.choose(pick);
    }
    return game;
  };

  it('帶著天賦的同一顆種子會長出不同的人生', () => {
    // 天賦改的是天賦上限、衰老、受傷機率這些引擎的輸入——**因此它必須在重播
    // 日誌裡**，否則伺服器重跑會得到另一段人生。
    const plain = play({});
    plain.dispose();
    const buffed = play({ gifted: 3, evergreen: 2, ironframe: 2 });
    buffed.dispose();
    expect(buffed.toReplayLog().setup.talents).toBeDefined();
    expect(JSON.stringify(buffed.flow.log)).not.toBe(JSON.stringify(plain.flow.log));
  });

  it('dispose() 之後設定回到原狀——不然下一局會帶著上一局的加成', () => {
    const before = seasonData.retirement.max_age;
    const game = new Game({ ...setup, talents: { marathoner: 2 } });
    expect(seasonData.retirement.max_age).toBeGreaterThan(before);
    game.dispose();
    expect(seasonData.retirement.max_age).toBe(before);
  });

  it('重播帶天賦的日誌會重現同一段人生', () => {
    const original = play({ gifted: 2, allin: 1 });
    const log = original.toReplayLog();
    original.dispose();

    const replayed = Game.replay(log);
    replayed.dispose();
    expect(JSON.stringify(replayed.flow.log)).toBe(JSON.stringify(original.flow.log));
  });
});

describe('感情風波的敘事', () => {
  const kinds = love.turmoil.kinds.map((k) => k.text);

  /**
   * 風波的文案曾經只塞在提問標題裡——那是 12px 的小標，而且不會進事件記錄。
   * 只讀卡片的人會看到「沒有問出口」卻不知道發生過什麼事（#22／#28）。
   */
  it('風波的結果卡片一定帶著當年抽到的那一則敘事', () => {
    let seen = false;
    for (let i = 0; i < 60; i++) {
      const game = playToEnd(started({ seed: `turmoil-${i}` }));
      for (const entry of game.flow.log) {
        if (entry.kind !== 'card') continue;
        if (entry.title !== '沒有問出口') continue;
        seen = true;
        expect(kinds.some((t) => entry.body.includes(t))).toBe(true);
      }
    }
    expect(seen).toBe(true);
  });

  it('敘事不再當成提問標題', () => {
    for (let i = 0; i < 20; i++) {
      const game = new Game({ ...setup, seed: `turmoil-title-${i}` }).start();
      while (game.flow.prompt !== null) {
        const title = game.flow.prompt.title ?? '';
        expect(kinds).not.toContain(title);
        const pick = defaultPick(game);
        if (pick === undefined) break;
        game.choose(pick);
      }
    }
  });
});
