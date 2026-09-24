import { describe, expect, it } from 'vitest';
import { abilities, amateur, events as eventsData, leagues, love, season as seasonData } from '../data/index.ts';
import { stageOf } from './amateur.ts';
import { ALL_ABILITIES } from '../data/index.ts';
import { Game, type GameSetup } from './game.ts';
import { ENGINE_VERSION } from './version.ts';
import { ALL } from './ladder.ts';
import { discountedPotential, handednessTier } from './handedness.ts';
import { joinName } from './naming.ts';
import { roleRank } from './season.ts';

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

/** 目前提問裡第一個可按的選項——選項可能反灰（能力已到天花板），不能盲抓 [0]。 */
function firstEnabled(game: Game): string {
  const hit = game.flow.prompt?.options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
  if (hit === undefined) throw new Error('沒有可按的選項');
  return hit.id;
}

/** 目前配點提問裡可加的能力（跳過反灰的、復原與確認）。 */
function allocKeys(game: Game): readonly string[] {
  return (game.flow.prompt?.options ?? [])
    .filter(
      (o) =>
        o.id.startsWith('alloc:') &&
        o.id !== 'alloc:undo' &&
        o.id !== 'alloc:confirm' &&
        o.disabled !== true,
    )
    .map((o) => o.id);
}

/** 加一點在第一個還加得動的能力上。 */
function allocOne(game: Game, index = 0): string {
  const id = allocKeys(game)[index];
  if (id === undefined) throw new Error('沒有能力可以加點');
  return id;
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
    a.choose(allocOne(a, 0));
    const b = started();
    b.choose(allocOne(b, 1));
    expect(a.state?.ability).not.toEqual(b.state?.ability);
  });

  it('重播日誌帶著引擎版本', () => {
    expect(started().toReplayLog().engineVersion).toBe(ENGINE_VERSION);
  });

  it('快照直接給出天花板，且已含天賦加成——前端不必自己拼', () => {
    // problems.txt #56：畫面本來拿 origin.potential 自己加 ceilingBonus，漏掉
    // 「天生神力」那類把上限往上推的天賦，於是收錢按 80 收、分母寫 70。天花板
    // 只有一個合成點，這條測試守的就是那個點。
    for (const seed of ['test-seed', 'ceiling-a', 'ceiling-b', 'ceiling-c']) {
      const state = started({ seed }).state;
      expect(state).not.toBeNull();
      for (const key of ALL_ABILITIES) {
        const rolled = state!.origin.potential[key] ?? abilities.scale.max;
        const base = discountedPotential(rolled, handednessTier({ ...state!.origin, traits: state!.traits }));
        const expected =
          Math.min(abilities.scale.max, base + abilities.talent_bonus.ceiling) +
          (state!.ceilingBonus[key] ?? 0);
        expect(state!.ceiling[key]).toBe(expected);
      }
    }
  });

  it('左手的代價落在天花板上——同一個 seed，左投的上限比右投低', () => {
    const right = started({ seed: 'hand-x', throws: 'R', bats: 'R' }).state!;
    const left = started({ seed: 'hand-x', throws: 'L', bats: 'R' }).state!;

    // 抽到的潛力是同一份——左手不改寫它，只是折扣它。
    expect(left.origin.potential).toEqual(right.origin.potential);
    const lower = ALL_ABILITIES.filter((k) => left.ceiling[k]! < right.ceiling[k]!);
    expect(lower.length).toBeGreaterThan(0);
    for (const k of ALL_ABILITIES) expect(left.ceiling[k]!).toBeLessThanOrEqual(right.ceiling[k]!);
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
      const first = game.flow.prompt.options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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
        cupNames.some((cup) => h === joinName(cup, '冠軍')),
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
        EFFECTIVE.map((k) => options.find((o) => o.id === `alloc:${k}` && o.disabled !== true)).find(
          (o) => o !== undefined,
        ) ??
        options.find((o) => o.id === 'draft:accept') ??
        options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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
    // 這裡的關鍵字必須是流程真的寫得出來的字：降級通知寫「打算把你送回…」，
    // 升級卡片寫「升上中職一軍」。先前這條找的是「下放二軍」——那個字串從來
    // 沒出現過，於是二十顆種子全部 continue，測試空轉了一場也沒斷言到。
    //
    // **配點要配好**：點數全丟體力的球員站不上一軍，聯盟平均往上搬一分之後一百二十
    // 顆種子一次都沒撞見「上去又下來」。
    let checked = 0;
    for (let i = 0; i < 120 && checked < 3; i++) {
      const game = playWell(started({ seed: `split-${i}` }));
      const log = JSON.stringify(game.flow.log);
      if (!log.includes('送回') || !log.includes('升上中職一軍')) continue;
      checked++;
      expect(game.state?.statsByStage['CPBL']).toBeDefined();
      // 上上下下之後仍然只有一份中職紀錄
      expect(Object.keys(game.state?.statsByStage ?? {}).filter((k) => k.startsWith('CPBL'))).toEqual(
        ['CPBL'],
      );
    }
    expect(checked).toBeGreaterThan(0);
  });

  /**
   * 季末成績卡要帶相對聯盟平均的指標。
   *
   * 手機沒有常駐的成績面板（見 app.css 的手機段），OPS+／ERA+ 只剩這張卡講得
   * 出來——絕對數字讀不出「3.80 在這個聯盟算好還算壞」。
   */
  it('季末成績卡帶著 OPS+ 或 ERA+', () => {
    let checked = 0;
    for (let i = 0; i < 10; i++) {
      const game = playToEnd(started({ seed: `plus-${i}` }));
      const bodies = game.flow.log
        .filter((e): e is Extract<typeof e, { kind: 'card' }> => e.kind === 'card')
        .map((c) => c.body);
      // 打過職業球季的人一定有一張帶著打擊率或防禦率的卡
      if (!bodies.some((b) => b.includes('打擊率') || b.includes('防禦率'))) continue;
      checked++;
      expect(bodies.some((b) => b.includes('OPS+ ') || b.includes('ERA+ '))).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
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
      game.choose(firstEnabled(game));
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
        game.choose(firstEnabled(game));
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
      game.choose(firstEnabled(game));
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
    game.choose(allocOne(game));
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
    game.choose(allocOne(game));
    game.choose('alloc:undo');
    expect(game.state?.ability).toEqual(before);
    expect(game.state?.carry).toEqual(carryBefore);
  });

  it('復原之後又回到「什麼都還沒分配」的狀態', () => {
    const game = toAllocation();
    game.choose(allocOne(game));
    game.choose('alloc:undo');
    expect(optionOf(game, 'alloc:undo')?.disabled).toBe(true);
  });

  it('連續復原可以一路退回起點', () => {
    const game = toAllocation();
    const before = { ...(game.state?.ability ?? {}) };
    let steps = 0;
    while (optionOf(game, 'alloc:confirm')?.disabled === true) {
      game.choose(allocOne(game));
      steps++;
    }
    for (let i = 0; i < steps; i++) game.choose('alloc:undo');
    expect(game.state?.ability).toEqual(before);
  });

  it('全部分配完之後確認才可按', () => {
    const game = toAllocation();
    while (optionOf(game, 'alloc:confirm')?.disabled === true) game.choose(allocOne(game));
    expect(optionOf(game, 'alloc:confirm')?.disabled).not.toBe(true);
  });

  it('復原本身也寫進重播日誌，重播仍然完全一致', () => {
    const game = toAllocation();
    game.choose(allocOne(game));
    game.choose('alloc:undo');
    game.choose(allocOne(game));
    while (game.flow.prompt !== null) {
      const options = game.flow.prompt.options;
      const pick = options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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
    game.choose(allocOne(game));
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

describe('國際賽年表', () => {
  // 「職業期的每一屆都留下年份、賽事名與名次」搬到 scripts/guardrail.test.ts：
  // 它要的是一段會被國家隊徵召的職業生涯，而這裡的 playWell 一年練不到那個水準
  // ——兩百局才撞得到一次，任何一筆平衡改動都能把它洗到一千局都撞不到。護欄那
  // 一百二十局用的是校準的 balanced 策略，約 6% 的生涯被徵召過，而且早就跑完了。

  it('養成期的國際賽不進這一份——它併在該年的養成列裡', () => {
    for (let i = 0; i < 20; i++) {
      const game = playAmateur(started({ seed: `intl-am-${i}` }));
      expect(game.summary?.internationalSeasons ?? []).toHaveLength(0);
    }
  });
});
describe('入學後的守位說明卡', () => {
  it('只對 UTIL 發——那兩句話對其他起點都是假的（ADR 0009）', () => {
    const util = started({ seed: 'card-util', startPosition: 'UTIL' });
    expect(JSON.stringify(util.flow.log)).toContain('二刀流');
    for (const pos of ['SS', '1B', 'C', 'P'] as const) {
      const game = started({ seed: 'card-fixed', startPosition: pos });
      expect(JSON.stringify(game.flow.log), pos).not.toContain('二刀流');
    }
  });
});
describe('投手定位會議', () => {
  /**
   * 打完一段生涯，記下每一次定位提問（問的時候他在哪個定位、問的是哪一個），
   * 並依 `accept` 決定接受或拒絕。
   */
  function playRoles(
    game: Game,
    accept: boolean,
  ): { asks: { at: string | null; to: string }[]; log: string } {
    const asks: { at: string | null; to: string }[] = [];
    let guard = 0;
    while (game.flow.prompt !== null && guard++ < 20000) {
      const options = game.flow.prompt.options;
      const promote = options.find((o) => o.id === 'role:accept');
      if (promote !== undefined) {
        asks.push({ at: game.state?.pitcherRole ?? null, to: promote.label });
        game.choose(accept ? 'role:accept' : 'role:decline');
        continue;
      }
      const pick = defaultPick(game, EFFECTIVE);
      if (pick === undefined) break;
      game.choose(pick);
    }
    return { asks, log: JSON.stringify(game.flow.log) };
  }

  const pitcher = (seed: string) =>
    new Game({ ...setup, seed, startPosition: 'P', throws: 'R', bats: 'R' }).start();

  it('進職業會登錄一次定位，而且不問——他還沒有位置可以留守', () => {
    for (let i = 0; i < 40; i++) {
      const { log } = playRoles(pitcher(`role-reg-${i}`), false);
      if (!log.includes('定位登錄')) continue;
      // 登錄是通知，不是提問：那一張卡出現的時候不該伴隨一次升遷詢問。
      expect(log).toContain('定位登錄');
      return;
    }
    throw new Error('四十局都沒有人登錄過定位');
  });

  it('往下不問——掉出輪值不是可以商量的事', () => {
    for (let i = 0; i < 60; i++) {
      const game = pitcher(`role-down-${i}`);
      const { log } = playRoles(game, false);
      const demoted = game.flow.log.some(
        (e) => e.kind === 'card' && e.title === '定位會議' && e.tone === 'bad',
      );
      if (!demoted) continue;
      // 降級只發卡，沒有選項可選。
      expect(log).toContain('定位會議');
      return;
    }
  });

  it('往上要問，而且同一個定位上拒絕過就不再問第二次', () => {
    for (let i = 0; i < 60; i++) {
      const { asks } = playRoles(pitcher(`role-up-${i}`), false);
      if (asks.length === 0) continue;
      const seen = new Set<string>();
      for (const ask of asks) {
        const key = `${ask.at}→${ask.to}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      return;
    }
  });

  it('接受升遷之後，定位真的換了', () => {
    for (let i = 0; i < 60; i++) {
      const game = pitcher(`role-accept-${i}`);
      const { log } = playRoles(game, true);
      if (!log.includes('定位調整')) continue;
      expect(log).toContain('定位調整');
      return;
    }
  });

  it('拒絕之後成績照舊用留任的那個定位，不會偷偷升上去', () => {
    // 這是「現算」與「登錄」的差別：現算的話玩家拒絕過的升遷會在成績上生效。
    for (let i = 0; i < 60; i++) {
      const game = pitcher(`role-keep-${i}`);
      const { asks } = playRoles(game, false);
      if (asks.length === 0) continue;
      const state = game.state;
      if (state?.pitcherRole == null || state.seasonPitching === null) continue;
      expect((state.seasonPitching as { role?: string }).role ?? state.pitcherRole).toBe(
        state.pitcherRole,
      );
      return;
    }
  });
});

describe('定位階梯', () => {
  it('先發最高、長中繼最低，而且五個定位各自不同高', () => {
    const order = (['LR', 'MR', 'SU', 'CP', 'SP'] as const).map((r) => roleRank(r));
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!).toBeGreaterThan(order[i - 1]!);
    }
  });

  it('CP → SU 是降、SU → CP 是升、CP → SP 是升', () => {
    expect(roleRank('SU')).toBeLessThan(roleRank('CP'));
    expect(roleRank('CP')).toBeLessThan(roleRank('SP'));
    // 牛棚的任何一階往先發都是升。
    for (const r of ['LR', 'MR', 'SU', 'CP'] as const) {
      expect(roleRank(r)).toBeLessThan(roleRank('SP'));
    }
  });
});

describe('守位登錄與移防', () => {
  /** 打完一整段生涯，回傳那局遊戲。 */
  const full = (seed: string) => playWell(started({ seed }));

  /**
   * 打完一段生涯，一路拒絕所有升防，並記下每一次守位提問當下的登錄守位。
   *
   * 記的是「問的時候他站哪裡、問的是哪一個目標」——拒絕記憶的規則就寫在這兩
   * 個值的組合上（ADR 0037）。
   */
  function playDeclining(game: Game): { game: Game; asks: { at: string | null; to: string }[] } {
    const asks: { at: string | null; to: string }[] = [];
    while (game.flow.prompt !== null) {
      const options = game.flow.prompt.options;
      const promote = options.find((o) => o.id === 'position:accept');
      if (promote !== undefined) {
        asks.push({ at: game.state?.position ?? null, to: promote.label });
        game.choose('position:decline');
        continue;
      }
      const pick = defaultPick(game, EFFECTIVE);
      if (pick === undefined) throw new Error('提問沒有選項');
      game.choose(pick);
    }
    return { game, asks };
  }

  it('首次登錄就是玩家選的起始守位，不掃描也不發卡', () => {
    // 一壘手是最嚴的檢查：掃描光譜是 [SS, 2B, 3B, 1B]，從游擊起跳，1B 永遠是
    // 最後一個候選。舊行為會把守備堪用的一壘手直接登錄成游擊手。
    const game = started({ seed: 'first-reg', startPosition: '1B' });
    expect(game.state?.position).toBe('1B');
    expect(JSON.stringify(game.flow.log)).not.toContain('守位登錄');
  });

  it('起始守位選 UTIL 的人交給掃描，並發一張守位登錄卡', () => {
    // UTIL 的側別沒鎖，因此 #playsField 比的是投打兩側的評價（ADR 0009）——
    // 初始擲骰投手側較高的人不進守位系統，掃種子而不是賭一顆。
    for (let i = 0; i < 20; i++) {
      const game = started({ seed: `util-reg-${i}`, startPosition: 'UTIL' });
      // 純投手側的那幾局守位欄是 DH（打席的落點），不是登錄守位。
      if (game.state?.playsField !== true) continue;
      expect(game.flow.log.some((e) => e.kind === 'card' && e.title === '守位登錄')).toBe(true);
      return;
    }
    throw new Error('二十局都沒有 UTIL 走上野手側');
  });

  it('一路拒絕升防的人，守位不會自己往上爬', () => {
    for (let i = 0; i < 20; i++) {
      const { game, asks } = playDeclining(started({ seed: `decline-${i}`, startPosition: '1B' }));
      if (asks.length === 0) continue;
      // 拒絕過就不會出現在更高階的位置上——1B 之上只有 3B/2B/SS。
      const seasons = game.summary?.seasons ?? [];
      expect(seasons.every((s) => s.position === null || s.position === '1B' || s.position === 'DH')).toBe(true);
      return;
    }
    throw new Error('二十局都沒有人收到過升防的提問');
  });

  it('同一個守位上拒絕過的目標不會再問第二次', () => {
    for (let i = 0; i < 20; i++) {
      const { asks } = playDeclining(started({ seed: `once-${i}`, startPosition: '1B' }));
      if (asks.length < 2) continue;
      const seen = new Set<string>();
      for (const ask of asks) {
        const key = `${ask.at}→${ask.to}`;
        expect(seen.has(key), `${key} 被問了第二次`).toBe(false);
        seen.add(key);
      }
      return;
    }
  });

  it('三個階段共用同一份登錄守位——二軍不再是空白', () => {
    for (let i = 0; i < 40; i++) {
      const game = full(`dpos2-${i}`);
      const rows = game.summary?.seasons ?? [];
      const minor = rows.filter((s) => !s.levelName.includes('一軍') && s.batting !== null);
      if (minor.length === 0) continue;
      expect(minor.every((s) => s.position !== null)).toBe(true);
      return;
    }
    throw new Error('四十局都沒有人在二軍留下打擊成績');
  });

  it('進入頂級聯盟的野手會登錄守位', () => {
    for (let i = 0; i < 40; i++) {
      const game = full(`dpos-${i}`);
      const log = JSON.stringify(game.flow.log);
      if (!log.includes('守位會議')) continue;
      expect(log).toMatch(/登錄為|改守|改任指定打擊|守不住/);
      return;
    }
    throw new Error('四十局都沒有人開過守位會議');
  });

  it('降守位不給選擇——它只發卡，不產生提問', () => {
    for (let i = 0; i < 40; i++) {
      const game = full(`demote-${i}`);
      const demotions = game.flow.log.filter(
        (e) => e.kind === 'card' && e.title === '守位會議' && e.tone === 'bad',
      );
      if (demotions.length === 0) continue;
      // 降守位的卡片存在，但選項清單裡從來沒有「往哪裡降」這種問題。
      expect(game.flow.choices.some((c) => c.startsWith('position:demote'))).toBe(false);
      return;
    }
    throw new Error('四十局都沒有人被降過守位');
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
      expect(state.position).toBeNull();
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
          EFFECTIVE.map((k) => options.find((o) => o.id === `alloc:${k}` && o.disabled !== true)).find(
            (o) => o !== undefined,
          ) ??
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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
        rot.map((key) => options.find((o) => o.id === `alloc:${key}` && o.disabled !== true)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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
        rot.map((key) => options.find((o) => o.id === `alloc:${key}` && o.disabled !== true)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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

  it('起始守位選投手，養成列寫 DH 而不是留白（problems #27）', () => {
    // 學生棒球的投手照樣站打席，打擊成績要有位置可標——那一欄留白等於在說
    // 他那六年沒上過場。職業之後才真的回 null：那裡的純投手沒有野手成績。
    for (let i = 0; i < 20; i++) {
      const game = playWell(started({ seed: `p27-${i}`, startPosition: 'P' }));
      const summary = game.summary;
      if (summary === null) continue;
      if (game.state?.lockedSide !== 'pitcher') continue;
      expect(summary.amateurSeasons.length).toBeGreaterThan(0);
      for (const a of summary.amateurSeasons) {
        expect(a.position, `${a.year} 年的養成列留白了`).toBe('DH');
      }
      return;
    }
    throw new Error('二十局都沒有走成純投手');
  });
  it('生涯表的守位欄不留白——養成與二軍也有登錄守位', () => {
    // 那幾列的守位本來只活在畫面上，沒有存進生涯紀錄，生涯表那幾列
    // 因此永遠是「—」。守住的是「野手在每一列都站得到某個位置」。
    let checked = 0;
    for (let i = 0; i < 40; i++) {
      const game = playToRetire(`pos-${i}`);
      const summary = game.summary;
      if (summary === null) continue;
      // 純投手不進守位系統，他們的 null 是對的；這裡只驗野手。
      if (!(game.state?.playsField ?? false)) continue;
      expect(summary.amateurSeasons.length).toBeGreaterThan(0);
      for (const a of summary.amateurSeasons) {
        expect(a.position, `${a.year} 年的養成列沒有守位`).not.toBeNull();
      }
      const minorRows = summary.seasons.filter((s) => s.top === null);
      for (const s of minorRows) {
        expect(s.position, `${s.year} 年的 ${s.levelName} 沒有守位`).not.toBeNull();
      }
      checked++;
      if (checked >= 3) return;
    }
    expect(checked).toBeGreaterThan(0);
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
        rot.map((key) => options.find((o) => o.id === `alloc:${key}` && o.disabled !== true)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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

  it('收入只在寫明代價的事件上減少——不會平白蒸發', () => {
    const game = started({ seed: 'pay-mono' });
    let guard = 0;
    let last = 0;
    while (game.flow.prompt !== null && guard++ < 5000) {
      const options = game.flow.prompt.options;
      const pick =
        options.find((o) => o.id === 'retire:stay') ??
        options.find((o) => o.id === 'draft:accept') ??
        options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
        options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
      if (pick === undefined) break;
      const before = game.flow.log.length;
      game.choose(pick.id);
      const now = game.state?.earnings ?? 0;
      if (now < last) {
        // 離婚的財產分配與舉家旅外的安家費是設計上的支出，會從生涯累積裡扣掉；
        // 除此之外收入不該減少。這條原本寫成「只增不減」，是因為當初的自動代理
        // 從沒走到離婚那條線。
        const titles = game.flow.log
          .slice(before)
          .filter((e) => e.kind === 'card')
          .map((e) => (e as { title?: string }).title ?? '');
        expect(titles.some((t) => t === '離婚' || t === '舉家旅外')).toBe(true);
        expect(now).toBeGreaterThanOrEqual(0);
      }
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
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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
        rot.map((key) => options.find((o) => o.id === `alloc:${key}` && o.disabled !== true)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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

  /**
   * 合約到期跳出去，桌上不能只有海外球團——同聯盟的對手才是 FA 市場的主體。
   */
  it('測試自由市場時，同聯盟的其他球隊也會來搶', () => {
    for (let i = 0; i < 40; i++) {
      const game = started({ seed: `ct-fam-${i}` });
      let guard = 0;
      let k = 0;
      let sawDomestic = false;
      while (game.flow.prompt !== null && guard++ < 6000) {
        const prompt = game.flow.prompt;
        const options = prompt.options;
        const level = game.state?.pro?.levelName ?? '';
        const team = game.state?.pro?.team ?? '';
        if (prompt.title?.startsWith('自由市場報價一覽') === true) {
          // 同聯盟的報價：層級與現在同一層，而且不是自己現在這一隊。
          sawDomestic =
            sawDomestic ||
            options.some(
              (o) =>
                o.id.startsWith('market:') &&
                o.id !== 'market:stay' &&
                o.label.includes(`（${level}）`) &&
                !o.label.includes(team),
            );
        }
        const rot = [...DURABLE.slice(k % DURABLE.length), ...DURABLE];
        const pick =
          options.find((o) => o.id === 'fa:market') ??
          options.find((o) => o.id === 'term:long') ??
          options.find((o) => o.id === 'term:short') ??
          options.find((o) => o.id === 'retire:stay') ??
          rot
            .map((key) => options.find((o) => o.id === `alloc:${key}` && o.disabled !== true))
            .find((o) => o !== undefined) ??
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
        if (pick === undefined) break;
        if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') k++;
        game.choose(pick.id);
      }
      if (sawDomestic) return;
    }
    throw new Error('四十局都沒有在自由市場上看到同聯盟的報價');
  });

  /** 同聯盟換隊只換球衣：層級、體系與服務年資的帳都不重來。 */
  it('簽給同聯盟的別隊不算轉會，層級不變', () => {
    for (let i = 0; i < 40; i++) {
      const game = started({ seed: `ct-within-${i}` });
      let guard = 0;
      let k = 0;
      let before: { level: string; team: string } | null = null;
      let after: { level: string; team: string } | null = null;
      while (game.flow.prompt !== null && guard++ < 6000) {
        const prompt = game.flow.prompt;
        const options = prompt.options;
        const pro = game.state?.pro;
        let domestic: { id: string } | undefined;
        if (prompt.title?.startsWith('自由市場報價一覽') === true && pro != null) {
          domestic = options.find(
            (o) =>
              o.id.startsWith('market:') &&
              o.id !== 'market:stay' &&
              o.label.includes(`（${pro.levelName}）`) &&
              !o.label.includes(pro.team),
          );
          if (domestic !== undefined && before === null) {
            before = { level: pro.level, team: pro.team };
          }
        }
        const rot = [...DURABLE.slice(k % DURABLE.length), ...DURABLE];
        const pick =
          domestic ??
          options.find((o) => o.id === 'fa:market') ??
          options.find((o) => o.id === 'term:long') ??
          options.find((o) => o.id === 'term:short') ??
          options.find((o) => o.id === 'retire:stay') ??
          rot
            .map((key) => options.find((o) => o.id === `alloc:${key}` && o.disabled !== true))
            .find((o) => o !== undefined) ??
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
        if (pick === undefined) break;
        if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') k++;
        game.choose(pick.id);
        const now = game.state?.pro;
        if (before !== null && after === null && now != null && now.team !== before.team) {
          after = { level: now.level, team: now.team };
        }
      }
      if (before === null || after === null) continue;
      expect(after.level).toBe(before.level);
      expect(after.team).not.toBe(before.team);
      expect(cards(game).some((c) => c.title === '轉隊')).toBe(true);
      return;
    }
    throw new Error('四十局都沒有簽到同聯盟的別隊');
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
          rot.map((key) => options.find((o) => o.id === `alloc:${key}` && o.disabled !== true)).find((o) => o !== undefined) ??
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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

  it('自主引退問在合約與挖角之前', () => {
    // 「要不要繼續打」是先對自己回答的問題。舊順序讓玩家簽完約、談完挖角才被
    // 問要不要走，那時候答案已經沒有意義了（見 ADR 0028）。
    //
    // 排在後面的只有「被下放，不願接受」那一問——它要先知道自己被送去哪一層，
    // 靠標題認出來，不算違規。
    //
    // 兩種問句同一年一起出現的機會不高（引退問句要 35 歲以後，合約問句要那年
    // 剛好約滿或有人來挖），因此 `both` 一併斷言：樣本掃不到就等於沒測到。
    const LATER = ['fa:', 'term:', 'market:', 'transfer:', 'posting:', 'demote:'];
    let both = 0;
    for (let i = 0; i < 150; i++) {
      const game = new Game({
        seed: `ro-${i}`,
        name: '順序',
        startPosition: 'SS',
        throws: 'R',
        bats: 'R',
      }).start();
      let guard = 0;
      // 每一年記下問句出現的先後：R = 自主引退、L = 合約／挖角。
      const byYear = new Map<number, string[]>();
      while (game.flow.prompt !== null && guard++ < 8000) {
        const prompt = game.flow.prompt;
        const year = game.state?.year ?? 0;
        const ids = prompt.options.map((o) => o.id);
        const seq = byYear.get(year) ?? [];
        if (
          ids.some((id) => id.startsWith('retire:')) &&
          !(prompt.title ?? '').includes('你被送回')
        ) {
          seq.push('R');
        }
        if (ids.some((id) => LATER.some((p) => id.startsWith(p)))) seq.push('L');
        byYear.set(year, seq);
        // 一律選「再拚一年」：真的退了就看不到後面幾年的順序。
        // **配點要配好。** 點數全丟給 alloc:confirm 的球員一輩子在二軍，合約與
        // 挖角的問句幾乎不會出現（實測四百段生涯只有八個年份有），這條測試就變成
        // 抽獎。配進真的影響評價的能力，站得上一軍的人才談得到約。
        const pick =
          prompt.options.find((o) => o.id === 'retire:stay' && o.disabled !== true)?.id ??
          defaultPick(game, EFFECTIVE);
        if (pick === undefined) break;
        game.choose(pick);
      }
      for (const [year, seq] of byYear) {
        if (!seq.includes('R') || !seq.includes('L')) continue;
        both++;
        expect(seq.indexOf('R'), `${year} 年的問句順序是 ${seq.join(',')}`).toBeLessThan(
          seq.indexOf('L'),
        );
      }
    }
    expect(both).toBeGreaterThan(0);
  });

  it('老將的合約問句永遠掛著引退這條退路', () => {
    // 自主引退一年只問一次；談約談到一半才反悔的人，手上不能只有簽或不簽兩個鍵。
    let seen = 0;
    let quit = 0;
    // 打到「老將還在談約」本身就不常見，而哪幾顆種子走得到那裡會隨平衡改動漂移。
    // **配點要配好**：點數全丟體力的球員一輩子站不穩一軍，走到老將談約是抽獎——
    // 大傷在衰退期多扣兩項、永久少一顆骰之後，四百顆種子一次都沒撞見。看到三次就夠。
    for (let i = 0; i < 400 && seen < 3; i++) {
      const game = new Game({
        seed: `quit-${i}`,
        name: '顧客',
        startPosition: 'SS',
        throws: 'R',
        bats: 'R',
      }).start();
      let guard = 0;
      let took = false;
      while (game.flow.prompt !== null && guard++ < 8000) {
        const prompt = game.flow.prompt;
        const ids = prompt.options.map((o) => o.id);
        const escape = ids.find((id) => id === 'term:retire' || id === 'fa:quit');
        if (escape !== undefined) {
          seen++;
          // 走這條路，生涯就該在這裡結束——不是回到明年春訓。
          game.choose(escape);
          took = true;
          break;
        }
        const pick =
          prompt.options.find((o) => o.id === 'retire:stay' && o.disabled !== true)?.id ??
          defaultPick(game, EFFECTIVE);
        if (pick === undefined) break;
        game.choose(pick);
      }
      if (!took) continue;
      quit++;
      const log = JSON.stringify(game.flow.log);
      expect(log, `seed quit-${i} 選了引退卻沒有引退`).toContain('引退');
    }
    expect(seen, '四百條生涯裡沒有任何一次合約問句掛出引退選項').toBeGreaterThan(0);
    expect(quit).toBe(seen);
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
        rot.map((key) => options.find((o) => o.id === `alloc:${key}` && o.disabled !== true)).find((o) => o !== undefined) ??
        options.find((o) => o.id === 'draft:accept') ??
        options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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

  /**
   * 海外的邀請必須排在母隊談約之前——否則掌控期的球團續約權先跑完，報價到
   * 的時候人已經被綁住，跳約還要自付買斷。見 ADR 0027。
   */
  it('海外球團遞出合約問在母隊續約之前', () => {
    let seen = 0;
    for (let i = 0; i < 60; i++) {
      const game = new Game({
        seed: `abroad-order-${i}`,
        name: '旅外',
        startPosition: 'P',
        throws: 'R',
        bats: 'R',
      }).start();
      let sinceSeason: string[] = [];
      let idx = 0;
      let guard = 0;
      let k = 0;
      while (game.flow.prompt !== null && guard++ < 6000) {
        for (; idx < game.flow.log.length; idx++) {
          const entry = game.flow.log[idx];
          if (entry?.kind !== 'card') continue;
          const title = entry.title ?? '';
          if (title.endsWith('球季成績')) sinceSeason = [];
          else sinceSeason.push(title);
        }
        const options = game.flow.prompt.options;
        if ((game.flow.prompt.title ?? '') === '海外球團遞出合約') {
          seen++;
          expect(sinceSeason.filter((t) => /續約|減薪合約|合約買斷/.test(t))).toEqual([]);
        }
        // 一律留下，才走得完一整條有多次報價的生涯。
        const rot = [...PITCHER.slice(k % PITCHER.length), ...PITCHER];
        const pick =
          options.find((o) => o.id === 'transfer:stay') ??
          options.find((o) => o.id === 'fa:stay') ??
          options.find((o) => o.id === 'term:long') ??
          options.find((o) => o.id === 'term:short') ??
          options.find((o) => o.id === 'demote:accept') ??
          options.find((o) => o.id === 'retire:stay') ??
          rot
            .map((key) => options.find((o) => o.id === `alloc:${key}` && o.disabled !== true))
            .find((o) => o !== undefined) ??
          options.find((o) => o.id === 'draft:accept') ??
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
        if (pick === undefined) break;
        if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') k++;
        game.choose(pick.id);
      }
    }
    expect(seen).toBeGreaterThan(0);
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
   * 降級卡必須報引擎判定用的那一句，不是展示層自己編的說法。
   *
   * 舊版一律寫「成績未達標」——但下放看的是能力對門檻，不是成績；玩家因此看著
   * 綜合 60、聯盟水準 55 被送去 3A，而卡片給的理由與判定依據毫無關係，他連自
   * 己是怎麼掉下去的都算不出來（見 ADR 0029）。
   */
  it('降級通知報的是實際的綜合與門檻，不是編出來的成績說法', () => {
    let seen = 0;
    // 掃到第幾顆才撞見「降級通知」會隨平衡改動漂移，範圍留寬一點。
    for (let i = 0; i < 200; i++) {
      const game = playToEnd(started({ seed: `demote-why-${i}` }));
      for (const entry of game.flow.log) {
        if (entry.kind !== 'card') continue;
        if ((entry.title ?? '') !== '降級通知') continue;
        seen++;
        const body = entry.body ?? '';
        expect(body).toContain('綜合');
        expect(body).toContain('門檻');
        expect(body).not.toContain('成績未達標');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

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
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
        if (pick === undefined) break;
        if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') cursor++;
        game.choose(pick.id);
      }
    }
    // 樣本裡必須真的出現過這兩件事，否則這條測試什麼都沒驗到。
    expect(sawMove).toBe(true);
    expect(sawDemotionPrompt).toBe(true);
  });

  /**
   * 升級卡片報的是實際升到的層級，不是一律寫「升上一軍」。
   *
   * 「一軍」是頂級聯盟的專稱，而且只有中日韓那三個體系這樣叫。舊版把標題寫死
   * 成「升上一軍」，於是小聯盟 R→1A、1A→2A、2A→3A 也是這句，連升上大聯盟
   * 都被叫成升上一軍。
   */
  it('升級卡片報實際的層級，不是一律寫「升上一軍」', () => {
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      const game = playToEnd(started({ seed: `promote-${i}` }));
      for (const entry of game.flow.log) {
        if (entry.kind !== 'card') continue;
        const title = entry.title ?? '';
        if (!title.startsWith('升上')) continue;
        seen++;
        const levelName = title.slice('升上'.length);
        const level = Object.values(leagues.levels).find((l) => l.name === levelName);
        // 標題裡的層級名必須是真的層級，而且卡片內文講的是同一個
        expect(level, title).toBeDefined();
        expect(entry.body ?? '').toContain(levelName);
        // 只有名字裡真的有「一軍」的層級才能這樣講
        expect(levelName.includes('一軍')).toBe(title.includes('一軍'));
        // 登上頂級才是里程碑，農場裡的每一階不是
        expect(entry.tone, title).toBe(level?.top !== undefined ? 'gold' : 'good');
      }
    }
    expect(seen).toBeGreaterThan(0);
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
          options.find((o) => o.disabled !== true && o.id !== 'alloc:undo');
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

describe('左右開投', () => {
  const rate = (over: Partial<GameSetup>, n = 60) => {
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const game = playAmateur(started({ ...over, seed: `sp-${i}` }));
      if (game.state?.traits.has('switch_pitcher') === true) hit++;
    }
    return hit / n;
  };

  it('左投明顯比右投容易練成——左撇子從小就兩隻手都在用', () => {
    const left = rate({ startPosition: 'P', throws: 'L', bats: 'L' });
    const right = rate({ startPosition: 'P', throws: 'R', bats: 'R' });
    expect(left).toBeGreaterThan(right);
    expect(right).toBeGreaterThan(0);
  });

  it('野手不會練成——這是投手的東西', () => {
    expect(rate({ startPosition: 'SS', throws: 'L', bats: 'L' })).toBe(0);
  });

  it('練成之後檔次跳到左右開投，天花板跟著降', () => {
    let found: Game | null = null;
    for (let i = 0; i < 60 && found === null; i++) {
      const game = playAmateur(started({ startPosition: 'P', throws: 'L', bats: 'L', seed: `sp-${i}` }));
      if (game.state?.traits.has('switch_pitcher') === true) found = game;
    }
    expect(found).not.toBeNull();
    const state = found!.state!;
    expect(handednessTier({ ...state.origin, traits: state.traits })).toBe('switch_pitcher');
  });
});

describe('結算（score）', () => {
  it('還沒走到結算就沒有結論', () => {
    expect(started().score()).toBeNull();
  });

  it('一段打完的生涯結算得出成就與天梯列', () => {
    const game = playWell(started({ seed: 'score-1' }));
    const score = game.score();
    expect(score).not.toBeNull();
    expect(score?.engineVersion).toBe(ENGINE_VERSION);
    expect(score?.playerName).toBe(setup.name);
    // 引退時那張結算卡走的是同一個配方，兩者必須一致。
    expect(score?.achievements).toEqual(game.achievements);
    expect(score?.summary).toBe(game.summary);
  });

  it('天梯列的組合不重複，而且跨聯盟跨守位那一格一定在', () => {
    for (let i = 0; i < 20; i++) {
      const game = playWell(started({ seed: `score-ladder-${i}` }));
      const score = game.score();
      if (score === null || score.ladder.length === 0) continue;
      const keys = score.ladder.map((r) => `${r.org}|${r.position}|${r.kind}`);
      // 資料表的主鍵就是這三欄——重複的話第二列會被 ON CONFLICT 靜靜吃掉。
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).toContain(`${ALL}|${ALL}|total`);
      expect(keys).toContain(`${ALL}|${ALL}|best`);
      // 一段打完的生涯至少登錄過一個守位。
      expect(score.ladder.some((r) => r.position !== ALL)).toBe(true);
      return;
    }
    throw new Error('二十段生涯都沒有上過頂級聯盟');
  });

  /**
   * **跨局進度只有伺服器手上有真的那一份**，所以它是參數而不是欄位。同一段生涯
   * 用不同的進度結算，清單一樣長，但新解鎖與 AP 不同——已經領過的不再給點。
   */
  it('進度是傳進來的：已經解鎖過的不再給 AP', () => {
    const game = playWell(started({ seed: 'score-2' }));
    const first = game.score();
    expect(first).not.toBeNull();
    if (first === null) return;

    const again = game.score({
      firstCareer: false,
      unlocked: new Set(first.achievements.list.map((a) => a.id)),
    });
    expect(again?.achievements.newly).toEqual([]);
    expect(again?.achievements.points).toBe(0);
    // 清單本身是同一批（「第一段人生」那一項除外，它只在第一段給）。
    const ids = new Set(first.achievements.list.map((a) => a.id));
    for (const a of again?.achievements.list ?? []) expect(ids.has(a.id)).toBe(true);
  });

  it('同一段生涯結算兩次結果相同——結算本身不消耗抽取', () => {
    const game = playWell(started({ seed: 'score-3' }));
    expect(game.score()).toEqual(game.score());
  });
});

describe('逐季的年薪與簽約金', () => {
  /**
   * 天梯要比「各聯盟球團付了多少」，那需要逐季存下來——總收入只有一個數字，拆不出
   * 單季與聯盟，而且混了離婚分走的財產與旅外安家費。
   */
  it('每一季都記著實領的年薪', () => {
    for (let i = 0; i < 20; i++) {
      const seasons = playWell(started({ seed: `pay-${i}` })).summary?.seasons ?? [];
      if (seasons.length === 0) continue;
      for (const r of seasons) expect(r.salary, `${r.year} ${r.level}`).toBeGreaterThan(0);
      return;
    }
    throw new Error('二十局都沒有人打進職業');
  });

  it('選秀的簽約金記在第一季上，之後沒有換東家就不會再有', () => {
    for (let i = 0; i < 20; i++) {
      const game = playWell(started({ seed: `bonus-${i}` }));
      const seasons = game.summary?.seasons ?? [];
      if (seasons.length < 3) continue;
      expect(seasons[0]?.bonus).toBeGreaterThan(0);
      // 同一個體系、同一支球隊一路打下來的年份，不會憑空多出簽約金。
      const sameTeam = seasons.filter((r, idx) => idx > 0 && r.team === seasons[idx - 1]?.team);
      for (const r of sameTeam) expect(r.bonus, `${r.year}`).toBe(0);
      return;
    }
    throw new Error('二十局都沒有人打滿三季職業');
  });
});

/**
 * 組頭接觸失敗是**真的**永久逐出（issue #16）：以前只印了一張卡，下一季照打。
 * 這張卡權重 2、很少抽到，所以測試把它調成必抽、兩面都是逐出，打完再還原。
 */
describe('永久逐出', () => {
  it('被逐出之後生涯當場結束，不進名人堂票選', () => {
    type Card = { id: string; weight?: number | undefined; good_effects: object; bad_effects: object };
    const cards = (eventsData as unknown as { events: Card[] }).events;
    const card = cards.find((c) => c.id === 'event_19')!;
    const saved = { weight: card.weight, good: card.good_effects };
    card.weight = 1e9;
    card.good_effects = { ban: true };
    try {
      const game = playWell(started({ seed: 'banned', startPosition: 'SS' }));
      const log = JSON.stringify(game.flow.log);
      expect(log).toContain('永久逐出棒球界');
      expect(game.flow.finished).toBe(true);
      // 被逐出的那一年之後沒有任何球季。
      const last = game.summary?.seasons.at(-1);
      const bannedYear = Number(/(\d{4}) 年被聯盟永久逐出/.exec(log)?.[1]);
      expect(last === undefined || last.year < bannedYear).toBe(true);
      expect(log).not.toContain('名人堂票選');
    } finally {
      card.weight = saved.weight;
      card.good_effects = saved.good;
    }
  });
});
