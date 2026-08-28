/**
 * 平衡護欄。
 *
 * 這**不是**校準——校準用 `npm run calibrate`，跑幾千局、輸出報表、由人決定
 * 數字。這裡只跑一百多局，斷言結果落在**很寬鬆**的區間內，用途單一：防止有人
 * 把平衡改到天翻地覆而沒有任何測試變紅。
 *
 * 因此區間刻意鬆到不會因為正常的調參而閃紅。它抓的是「名人堂變成人人有獎」
 * 或「全部球員都是過客」這種等級的崩壞，不是幾個百分點的漂移。
 *
 * 每一條斷言都附上「為什麼是這個區間」——沒有理由的護欄，下次紅了只會被人
 * 直接改寬。
 */

import { describe, expect, it } from 'vitest';
import {
  abilities,
  amateur as amateurCfg,
  awards as awardsCfg,
  dataKeys,
  flavor,
  hallOfFame,
  injury as injuryCfg,
  leagues as leaguesData,
  love as loveCfg,
  PITCH_FAMILIES,
  season as seasonCfg,
  achievements,
  teams as teamsData,
  traitOf,
  traits as traitsData,
} from '../src/data/index.ts';
import { baselineOps, proBaseline } from '../src/engine/metrics.ts';
import { Game, type GameSetup } from '../src/engine/game.ts';
import type { CareerSummary } from '../src/engine/career.ts';

/**
 * 與校準腳本的 balanced 策略一致——護欄與校準必須看同一種玩家。
 *
 * **必須依起始守位分兩份**。自從養成期依起始守位鎖側（見 ADR 0009）之後，P 起點
 * 的玩家只加得動 `sta`，其餘五項全被擋下、點數等於丟掉。在鎖側之前這個破洞是靜
 * 悄悄的：P 起點照樣把點加進 con/rng/pow/fld，畢業時野手側較高，`lockedSide` 判
 * 成野手——也就是說這套取樣**從來沒產生過投手**，校準報表上「投手 目標 35%／實際
 * 0.0%」就是這麼來的。鎖側只是把靜靜地變成野手，換成明顯地跑不到職業。
 */
const BALANCED_FIELDER = ['sta', 'con', 'rng', 'pow', 'fld', 'eye'];
const BALANCED_PITCHER = ['sta', 'vel', 'ctl', 'swp', 'drp'];

const RUNS = 120;

function runCareer(seed: string, startPosition: GameSetup['startPosition']): CareerSummary | null {
  const game = new Game({ seed, name: '護欄', startPosition, throws: 'R', bats: 'R' }).start();
  let guard = 0;
  let cursor = 0;
  const balanced = startPosition === 'P' ? BALANCED_PITCHER : BALANCED_FIELDER;
  while (game.flow.prompt !== null && guard++ < 8000) {
    const options = game.flow.prompt.options;
    const rotated = [...balanced.slice(cursor % balanced.length), ...balanced];
    // 與校準腳本的策略必須一致——護欄與校準要看同一種玩家。
    const pick =
      // **身體開口的那一年就掛靴**——與校準腳本同一條規則。這裡原本漏了它，於是
      // 代理一路硬撐到年齡上限，生涯長度中位數 27 個球季。生涯評價分是累積 Win
      // Shares，打三十年當然進名人堂：名人堂帶因此虛胖成 16.7%，補上這條之後是
      // 8.3%，與校準報表的 8.1% 對得上。護欄與校準必須看同一種玩家。
      (options.some((o) => o.id === 'retire:push')
        ? options.find((o) => o.id === 'retire:quit')
        : undefined) ??
      options.find((o) => o.id === 'retire:stay') ??
      options.find((o) => o.id === 'transfer:stay') ??
      options.find((o) => o.id === 'term:long') ??
      options.find((o) => o.id === 'term:short') ??
      options.find((o) => o.id === 'fa:stay') ??
      options.find((o) => o.id === 'fa:crawl') ??
      options.find((o) => o.id === 'demote:accept') ??
      options.find((o) => o.id === 'fallback:0') ??
      rotated.map((k) => options.find((o) => o.id === `alloc:${k}`)).find((o) => o !== undefined) ??
      options.find((o) => o.id === 'alloc:confirm') ??
      options.find((o) => o.id === 'draft:accept') ??
      options.find((o) => o.disabled !== true && o.id !== 'alloc:undo') ??
      options[0];
    if (pick === undefined) break;
    if (pick.id.startsWith('alloc:') && pick.id !== 'alloc:confirm') cursor++;
    game.choose(pick.id);
  }
  return game.summary;
}

const POSITIONS = ['SS', 'CF', 'C', '1B', 'P'] as const;

const summaries = Array.from({ length: RUNS }, (_, i) =>
  runCareer(`guard-${i}`, POSITIONS[i % POSITIONS.length]!),
).filter((s): s is CareerSummary => s !== null);

const withPro = summaries.filter((s) => s.leagues.length > 0);
const share = (tier: number) =>
  withPro.filter((s) => s.bestTier === tier).length / Math.max(1, withPro.length);

/**
 * 聯盟的基準環境。
 *
 * 這幾條看的是「這個聯盟像不像棒球」——它們不隨玩法變動，因此可以定得比
 * 分佈那幾條緊得多。
 */
describe('聯盟基準環境', () => {
  const base = proBaseline('CPBL1');

  it('聯盟平均 OPS 落在 .700–.800', () => {
    expect(baselineOps(base)).toBeGreaterThanOrEqual(0.7);
    expect(baselineOps(base)).toBeLessThanOrEqual(0.8);
  });

  it('聯盟平均防禦率落在 3.5–4.5', () => {
    expect(base.era).toBeGreaterThanOrEqual(3.5);
    expect(base.era).toBeLessThanOrEqual(4.5);
  });

  /**
   * 封閉聯盟裡「全聯盟得分 = 全聯盟失分」。打線推導出來的每場得分，換算成
   * 自責分之後必須與設定的聯盟平均防禦率相當——否則分數會憑空生出或消失，
   * ERA+ 與投手的份額全部會偏。
   */
  it('打線產出的分數與聯盟平均防禦率對得起來', () => {
    const runsPerGame = base.runsCreatedPerPa * seasonCfg.advanced.shares.team_pa_per_game;
    const impliedEra = runsPerGame / seasonCfg.pitching.runs_per_earned_run.value;
    expect(Math.abs(impliedEra - base.era)).toBeLessThan(0.5);
  });

  it('聯盟平均打擊率落在合理範圍', () => {
    expect(base.avg).toBeGreaterThan(0.23);
    expect(base.avg).toBeLessThan(0.3);
  });
});

/**
 * 介面用的能力分組必須是引擎分組的重新分割——同樣的能力，不多不少。
 *
 * 兩份資料並存是刻意的（引擎看投手側／野手側，介面要把打擊與守備分開），
 * 但並存就會漂：加了新能力卻忘記讓它出現在介面上，玩家就永遠加不到那一項。
 */
describe('顯示分組與引擎分組一致', () => {
  const engine = abilities.ability_groups;
  const display = abilities.display_groups;

  const sorted = (keys: readonly string[]) => [...keys].sort();

  it('顯示分組涵蓋全部能力，不多不少', () => {
    const all = sorted([...engine.shared, ...engine.pitcher, ...engine.fielder]);
    const shown = sorted(display.order.flatMap((g) => display.members[g] ?? []));
    expect(shown).toEqual(all);
  });

  it('沒有能力被重複列在兩組裡', () => {
    const shown = display.order.flatMap((g) => display.members[g] ?? []);
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('投手側的顯示分組與引擎的投手組完全相同', () => {
    expect(sorted(display.members['pitching'] ?? [])).toEqual(sorted(engine.pitcher));
  });

  it('打擊與守備合起來就是引擎的野手組', () => {
    const fielderSide = [...(display.members['batting'] ?? []), ...(display.members['fielding'] ?? [])];
    expect(sorted(fielderSide)).toEqual(sorted(engine.fielder));
  });

  it('每一組都有名字', () => {
    for (const g of display.order) expect(display.names[g]).toBeTruthy();
  });
});

describe('平衡護欄', () => {
  it('每一局都跑得完並產出總結', () => {
    expect(summaries).toHaveLength(RUNS);
  });

  /**
   * 名人堂要稀有到值得截圖，但不能稀有到跑一百局都碰不到。
   *
   * 這條線曾為了 `#grantPoints()` 暫放到 13%，現已收回 12%——當時的破線其實是
   * 取樣策略的毛病（代理從不引退、且沒有真正的投手樣本），修好之後是 8.3%。
   *
   * 8.3% 對「目標 2%」仍然偏高，但那是**分級門檻**的事（現行 191/146/104/41，
   * 校準建議 274/217/154/64），不是護欄的事。護欄只擋崩壞，不擋漂移。
   * 見 ROADMAP.md「最後批次：校準與分級門檻」。
   */
  it('名人堂的比例落在 0–12%', () => {
    expect(share(0)).toBeLessThanOrEqual(0.12);
  });

  /** 反過來的崩壞：門檻訂太高，沒有人爬得上前兩帶。 */
  it('前兩帶合計不會是 0——門檻不該高到沒人構得到', () => {
    expect(share(0) + share(1)).toBeGreaterThan(0);
  });

  /** 「浮沉為大宗」：中間三帶要撐得起分佈，不能兩極化。 */
  it('中間三帶合計超過三成', () => {
    expect(share(1) + share(2) + share(3)).toBeGreaterThan(0.3);
  });

  /** 評價分要有離散度，否則分級只是把同一批人硬切五段。 */
  it('評價分的最高與最低差距明顯', () => {
    const scores = withPro.map((s) => s.leagues[0]?.score ?? 0);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(50);
  });

  /** 替代水準的定義：卡在留隊邊緣的人原地踏步，因此負分必須是可能的。 */
  it('存在評價分為負的生涯——低於替代水準會倒扣', () => {
    const scores = withPro.map((s) => s.leagues[0]?.sharePoints ?? 0);
    expect(Math.min(...scores)).toBeLessThan(Math.max(...scores));
  });

  it('分級標籤與門檻數量對得起來', () => {
    expect(hallOfFame.tier_thresholds.labels).toHaveLength(
      hallOfFame.tier_thresholds.values.length + 1,
    );
  });

  /**
   * grinder 的門檻曾經被手設在 620，而真實的潛力總和分布落在 830–880——
   * 那個特性因此永遠不會觸發，而且沒有任何測試會發現。
   */
  it('grinder 的門檻落在實際的潛力分布之內', () => {
    const sums = Array.from({ length: 20 }, (_, i) => {
      const probe = new Game({
        seed: `grinder-probe-${i}`,
        name: '護欄',
        startPosition: 'SS',
        throws: 'R',
        bats: 'R',
      }).start();
      return Object.values(probe.state?.origin.potential ?? {}).reduce((a, b) => a + b, 0);
    }).sort((a, b) => a - b);

    const threshold = hallOfFame.settlement_traits.grinder.provisional_sum;
    expect(threshold).toBeGreaterThan(sums[0]!);
    expect(threshold).toBeLessThan(sums.at(-1)!);
  });
});

/**
 * 球隊清單以**體系代碼**為鍵，不是層級代碼。
 *
 * 曾經發生過：美職的清單鍵與 `leagues.paths` 的體系代碼對不起來，結果是美職
 * 一份轉會報價都發不出來——抽不到球隊就不會 push，**靜默失敗**，而且真的
 * 轉過去會讓 initLeague 直接炸掉。
 */
describe('球隊清單涵蓋所有體系', () => {
  it('每個體系都有球隊', () => {
    for (const org of dataKeys(leaguesData.paths)) {
      expect(teamsData.leagues[org], `${org} 沒有球隊清單`).toBeDefined();
      expect((teamsData.leagues[org] ?? []).length).toBeGreaterThan(0);
    }
  });

  it('沒有多餘的清單掛在層級代碼上', () => {
    const orgs = new Set(dataKeys(leaguesData.paths));
    for (const key of dataKeys(teamsData.leagues)) {
      expect(orgs.has(key), `${key} 不是體系代碼`).toBe(true);
    }
  });

  it('每個體系的球隊數足夠抽出多份報價', () => {
    for (const org of dataKeys(leaguesData.paths)) {
      expect((teamsData.leagues[org] ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });
});

/**
 * **所有以體系代碼為鍵的設定表，鍵都必須是 `leagues.paths` 裡的體系。**
 *
 * 這個坑踩過不只一次。美職的體系代碼一度是 `MiLB`，而頂級層級叫 `MLB`——於是
 * 每一張 org-keyed 表的作者都很自然地寫成 `MLB`，六張表同時查不到，而且**全部
 * 靜默 fallback**，沒有一行錯誤：
 *
 * - `top_league_names` → 玩家看到「MiLB 明星賽」「MiLB 全壘打王」這種不存在的獎，
 *   成就櫃也分不出美職那一區。
 * - `hall_of_fame.halls` → `runBallot` 回 null，**美國棒球名人堂永遠進不去**。
 * - `hall_of_fame.representative_league.check_order` → `indexOf` 回 -1，旅美生涯
 *   被排到最後才檢查，而它本該第一個。
 * - `traits.rainbow.thresholds` → `limit === undefined` 直接 continue，**旅美永遠
 *   拿不到七彩球衣**。
 * - `awards.aliases` → 賽揚獎與漢克阿倫獎顯示成預設名。
 * - `flavor.retire_scenes` → 整組大聯盟引退場景（Curtain Call）一次都沒播過。
 *
 * 體系代碼現已統一為「該體系頂級聯盟的代碼」，但那只是把當下的資料修對。這條
 * 護欄擋的是下一次——新增聯盟時漏掉某一張表，或又有人拿層級代碼當鍵。
 */
describe('org-keyed 設定表的鍵都是體系代碼', () => {
  const orgs = new Set(dataKeys(leaguesData.paths));
  const rainbow = traitOf('rainbow');

  /**
   * 表名 → 鍵集合。`required` 為真的表，每個體系都必須到齊；為假的表允許只涵蓋
   * 一部分體系（例如獎項別名本來就只有幾個聯盟有），但寫進去的鍵不能是錯的。
   */
  const tables: readonly {
    name: string;
    keys: readonly string[];
    required: boolean;
    /** 刻意不是體系代碼的鍵——每一個都要在這裡寫明理由，否則就是打錯字。 */
    extra?: readonly string[];
  }[] = [
    { name: 'leagues.top_league_names', keys: dataKeys(leaguesData.top_league_names), required: true },
    { name: 'teams.leagues', keys: dataKeys(teamsData.leagues), required: true },
    { name: 'leagues.org_names', keys: dataKeys(leaguesData.org_names), required: false },
    { name: 'hallOfFame.halls', keys: dataKeys(hallOfFame.halls), required: false },
    {
      name: 'hallOfFame.representative_league.check_order',
      keys: hallOfFame.representative_league.check_order,
      required: true,
    },
    {
      name: 'hallOfFame.first_ballot.multiplier',
      keys: dataKeys(hallOfFame.first_ballot.multiplier),
      required: false,
    },
    { name: 'awards.aliases', keys: dataKeys(awardsCfg.aliases), required: false },
    {
      name: 'flavor.retire_scenes',
      keys: dataKeys(flavor.retire_scenes),
      required: false,
      // `minor` 不是體系，是「沒打過頂級聯盟」那一格：見 game.ts 的 #retireScene。
      extra: ['minor'],
    },
    { name: 'traits.rainbow.thresholds', keys: dataKeys(rainbow?.thresholds ?? {}), required: false },
  ];

  for (const table of tables) {
    it(`${table.name} 沒有不存在的體系代碼`, () => {
      const allowed = new Set([...orgs, ...(table.extra ?? [])]);
      for (const key of table.keys) {
        expect(allowed.has(key), `${table.name} 的 ${key} 不是體系代碼`).toBe(true);
      }
    });
  }

  for (const table of tables.filter((t) => t.required)) {
    it(`${table.name} 涵蓋每一個體系`, () => {
      const keys = new Set(table.keys);
      for (const org of orgs) {
        expect(keys.has(org), `${table.name} 少了 ${org}`).toBe(true);
      }
    });
  }

  /**
   * 上面那些表全是「查不到就 fallback」，因此漏掉不會報錯。這條把最貴的一張
   * 單獨釘死：**每個頂級聯盟都要有名人堂**，否則那個聯盟的生涯終點是空的。
   */
  it('每個體系都有名人堂', () => {
    for (const org of orgs) {
      expect(hallOfFame.halls[org], `${org} 沒有名人堂`).toBeDefined();
    }
  });
});

/**
 * 特性的名稱通道。
 *
 * `sweetheart` 曾經在 `love.json` 裡被指名發放，`traits.json` 卻沒有這個 id——
 * 玩家看得到「隱藏特性：青梅竹馬」的卡片，特性面板卻永遠不顯示它，因為那裡
 * 查不到定義就默默跳過。同一個時期 `legend` 也因為 `name` 是 null 被濾掉。
 *
 * 兩件事的根源一樣：**發放端與顯示端各有一份名單，沒有人比對過。**
 */
describe('特性資料', () => {
  /** 走訪任何 JSON，蒐集所有 `trait` 欄位——那就是「會被發出來的 id」。 */
  function referencedIds(node: unknown, out: string[] = []): readonly string[] {
    if (Array.isArray(node)) {
      for (const v of node) referencedIds(v, out);
    } else if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'trait' && typeof v === 'string') out.push(v);
        else referencedIds(v, out);
      }
    }
    return out;
  }

  const referenced = new Set(
    [amateurCfg, awardsCfg, hallOfFame, injuryCfg, loveCfg, seasonCfg].flatMap((cfg) =>
      referencedIds(cfg),
    ),
  );

  it('每個被資料指名發放的特性都在 traits.json 裡', () => {
    expect([...referenced].filter((id) => traitOf(id) === undefined)).toEqual([]);
  });

  it('每個特性都排進了顯示分類，不多不少', () => {
    const cats = [...traitsData.categories.positive, ...traitsData.categories.negative].sort();
    expect(cats).toEqual(traitsData.traits.map((t) => t.id).sort());
  });

  it('沒有名字的特性一定有組名規則，反之亦然', () => {
    const nameless = traitsData.traits.filter((t) => t.name === null).map((t) => t.id);
    expect(nameless.sort()).toEqual(dataKeys(traitsData.dynamic_names).sort());
  });
});

/**
 * 球系常數與資料檔。
 *
 * 常數一度手寫在 `index.ts`，於是資料檔裡四個系的中文名與球種清單躺了很久
 * 沒人讀，也沒有任何測試會發現兩份不一致。
 */
describe('球系', () => {
  it('球系常數就是資料檔的鍵', () => {
    expect([...PITCH_FAMILIES]).toEqual(dataKeys(abilities.pitch_families));
  });

  it('每個球系都是一項投手能力', () => {
    for (const f of PITCH_FAMILIES) expect(abilities.ability_groups.pitcher).toContain(f);
  });
});

/**
 * 累積成就與生涯里程碑吃同一份 `score` 表，所以資料本身要撐住兩邊的約定。
 *
 * 這裡擋的是三種真的發生過的漂移：級距分岔（聯盟盜壘 50、生涯 350，中間那段
 * 玩家什麼都拿不到）、封頂（打到 3500 安卻只顯示 3000）、以及漏項（中繼成功
 * 整項不存在，後援投手的生涯等於白打）。
 */
describe('累積級距', () => {
  const c = achievements.categories.cumulative;
  const rungs = Object.entries(c.rungs).filter(([k]) => !k.startsWith('_'));

  it('該有的累積數據一項都不能少', () => {
    const keys = new Set(rungs.map(([k]) => k));
    for (const stat of ['hits', 'hr', 'rbi', 'sb', 'wins', 'so', 'outs', 'saves', 'holds']) {
      expect(keys.has(stat), `少了 ${stat}`).toBe(true);
    }
  });

  for (const [stat, spec] of rungs) {
    describe(stat, () => {
      it('有級距表——沒有的話這項不會出現在成就櫃上', () => {
        expect(spec.score).toBeDefined();
      });

      it('沒有 max 之類的封頂欄位', () => {
        expect('max' in spec || 'step' in spec).toBe(false);
      });

      for (const scope of ['league', 'career'] as const) {
        it(`${scope} 由低到高遞增`, () => {
          const list = spec.score![scope];
          expect(list.length).toBeGreaterThan(0);
          for (let i = 1; i < list.length; i++) {
            expect(list[i]![0]).toBeGreaterThan(list[i - 1]![0]);
          }
        });

        // 階梯上不封頂，表格外的門檻是拿最後兩階的差往上長的。級距不勻的話，
        // 那個「往上長的步幅」等於偷偷由最後兩階決定——3600 安該顯示 3500
        // 還是 4000 就變成資料排版的意外，不是設計。
        it(`${scope} 級距等寬——最後一階之後就是照這個寬度往上長`, () => {
          const list = spec.score![scope];
          if (list.length < 3) return;
          const step = list[1]![0] - list[0]![0];
          for (let i = 1; i < list.length; i++) {
            expect(list[i]![0] - list[i - 1]![0], `${scope} 第 ${i} 段級距與第一段不同`).toBe(step);
          }
        });
      }

      it('生涯門檻一律高於同名次的聯盟門檻', () => {
        const { league, career } = spec.score!;
        expect(career[0]![0]).toBeGreaterThan(league[0]![0]);
      });
    });
  }
});
