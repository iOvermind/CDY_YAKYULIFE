/**
 * 一局遊戲：把亂數層、規則資料與流程編排綁在一起。
 *
 * 開局設定（種子、姓名、起始守位）是**參數**，不是流程中的選擇——它們在
 * 進入流程之前就決定了，與舊版的開局畫面一致。進入流程之後，玩家的選擇是
 * 唯一的外部輸入。
 *
 * 因此「開局設定＋選擇序列」就是一段生涯的完整表述，見 ADR 0002。
 */

import {
  abilities,
  ALL_ABILITIES,
  amateur,
  PITCH_FAMILIES,
  type AbilityKey,
} from '../data/index.ts';
import { academyUnlocked, playCups } from './amateur.ts';
import {
  drawEvent,
  resolveEvent,
  successChances,
  type EventContext,
  type EventMode,
  type GameEvent,
} from './events.ts';
import { esc, Flow, type Option } from './flow.ts';
import { createPlayer, type NewPlayer } from './genesis.ts';
import { growthCurve, raiseCeiling, rollTrainingDice, train } from './growth.ts';
import { rate, ratingPosition } from './rating.ts';
import { World } from './rng.ts';

/** 高中的年數。之後會由聯盟階梯資料提供。 */
const HIGH_SCHOOL_YEARS = 3;
const YEAR_LABELS = ['高一', '高二', '高三'];

/** 一局遊戲的開局設定。與重播日誌合起來即可完整重建一段生涯。 */
export interface GameSetup {
  readonly seed: string;
  readonly name: string;
  readonly startPosition: NewPlayer['startPosition'];
}

/** 目前引擎版本。重播日誌帶著它，跨版本一律拒絕重播（ADR 0002）。 */
export const ENGINE_VERSION = 1;

/** 一段可重播的生涯紀錄。 */
export interface ReplayLog {
  readonly engineVersion: number;
  readonly setup: GameSetup;
  readonly choices: readonly string[];
}

/** 球員的可變狀態。genesis 產出的是起點，之後由訓練與衰退推移。 */
export interface PlayerState {
  /** 開局時擲出的不變資料：姓名、潛力天花板、慣用手、出身。 */
  readonly origin: NewPlayer;
  /** 目前能力值。 */
  readonly ability: Readonly<Record<AbilityKey, number>>;
  /** 蓄力槽：每項能力未滿一級的點數。 */
  readonly carry: Readonly<Record<AbilityKey, number>>;
  /** 已取得的隱藏特性。 */
  readonly traits: ReadonlySet<string>;
  readonly age: number;
  readonly year: number;
  /** 目前階段的第幾年，從 1 起算。 */
  readonly stageYear: number;
  /** 生涯榮譽。 */
  readonly honors: readonly string[];
  /** 尚未分配的能力點。 */
  readonly pool: number;
  /** 各項能力被提升的上限點數。 */
  readonly ceilingBonus: Readonly<Record<AbilityKey, number>>;
  /** 本季累積的受傷機率增幅。 */
  readonly injuryRisk: number;
}

export class Game {
  readonly setup: GameSetup;
  readonly world: World;
  readonly flow = new Flow();

  #player: NewPlayer | null = null;
  #ability: Record<AbilityKey, number> = {};
  #carry: Record<AbilityKey, number> = {};
  #traits = new Set<string>();
  #age = 0;
  #year = 0;
  #stageYear = 1;
  #honors: string[] = [];
  #pool = 0;
  #ceilingBonus: Record<AbilityKey, number> = {};
  #injuryRisk = 0;

  constructor(setup: GameSetup) {
    this.setup = setup;
    this.world = new World(setup.seed);
  }

  /** 目前的球員。流程開始前為 null。 */
  get player(): NewPlayer | null {
    return this.#player;
  }

  /** 目前的球員狀態。流程開始前為 null。 */
  get state(): PlayerState | null {
    if (this.#player === null) return null;
    return {
      origin: this.#player,
      ability: this.#ability,
      carry: this.#carry,
      traits: this.#traits,
      age: this.#age,
      year: this.#year,
      stageYear: this.#stageYear,
      honors: this.#honors,
      pool: this.#pool,
      ceilingBonus: this.#ceilingBonus,
      injuryRisk: this.#injuryRisk,
    };
  }

  /** 事件系統需要的情境。 */
  get #eventContext(): EventContext {
    return {
      startPosition: this.#player?.startPosition ?? 'UTIL',
      professional: false,
      traits: this.#traits,
    };
  }

  /** 目前的綜合能力評價。 */
  get rating() {
    if (this.#player === null) return null;
    return rate(this.#ability, {
      position: ratingPosition(this.#player.startPosition),
      traits: this.#traits,
    });
  }

  /** 是否已取得二刀流天賦。決定成長曲線走哪一條。 */
  get isTwoWay(): boolean {
    return this.#traits.has('two_way');
  }

  /** 開始這局遊戲，推進到第一個需要玩家決定的地方。 */
  start(): this {
    this.flow.push(() => this.#genesis());
    this.flow.run();
    return this;
  }

  /** 回答目前的提問。 */
  choose(optionId: string): this {
    this.flow.choose(optionId);
    return this;
  }

  /** 匯出重播日誌。 */
  toReplayLog(): ReplayLog {
    return {
      engineVersion: ENGINE_VERSION,
      setup: this.setup,
      choices: [...this.flow.choices],
    };
  }

  /**
   * 從重播日誌重建一段生涯。
   *
   * 跨版本一律拒絕，不嘗試相容——抽取順序在版本之間沒有保證，硬跑只會得到
   * 一段看似合理但完全不同的人生（ADR 0002）。
   */
  static replay(log: ReplayLog): Game {
    if (log.engineVersion !== ENGINE_VERSION) {
      throw new Error(
        `重播日誌的引擎版本為 ${log.engineVersion}，目前為 ${ENGINE_VERSION}。` +
          `跨版本不保證重現，因此拒絕重播。`,
      );
    }
    const game = new Game(log.setup).start();
    for (const choice of log.choices) game.choose(choice);
    return game;
  }

  // ---------------------------------------------------------------- 流程

  /** 開局：擲出球員，並交代他的出身。 */
  #genesis(): void {
    const player = createPlayer(this.world, this.setup.name, this.setup.startPosition);
    this.#player = player;
    this.#ability = { ...player.ability };
    this.#carry = Object.fromEntries(ALL_ABILITIES.map((k) => [k, 0]));
    this.#ceilingBonus = Object.fromEntries(ALL_ABILITIES.map((k) => [k, 0]));
    this.#age = player.age;
    this.#year = player.year;

    const tier = ['', '名門', '中堅', '弱旅'][player.schoolTier] ?? '';
    const startName = abilities.start_positions[player.startPosition];

    // 卡片內文的 HTML 只能由程式碼寫死，變數一律先 esc()——姓名是自由輸入的。
    this.flow.card(
      'gold',
      '入學',
      `<b class="hl">${esc(player.name)}</b>進了<b class="hl">${esc(player.school)}</b>` +
        `${tier ? `（${esc(tier)}）` : ''}，在球隊裡的位置是<b class="hl">${esc(startName)}</b>。` +
        `投${handLabel(player.throws)}打${handLabel(player.bats)}。`,
    );
    this.flow.card(
      'info',
      undefined,
      '起始守位只決定你的天賦往哪邊長，不決定你只能練那一邊——' +
        '投打俱佳的人，在選秀前有機會取得二刀流。',
    );

    this.flow.push(() => this.#startYear());
  }

  /** 一個年度：分隔線 → 季初訓練 → 大賽 → 分配大賽點數 → 年度結束。 */
  #startYear(): void {
    const label = YEAR_LABELS[this.#stageYear - 1] ?? `第 ${this.#stageYear} 年`;
    this.flow.divider(`${this.#year} 年 · ${this.#age} 歲 · ${label}`);
    this.flow.push(
      () => this.#springTraining(),
      () => this.#drawEventCard(),
      () => this.#cups(),
      () => this.#endYear(),
    );
  }

  /** 抽一張事件卡並讓玩家決定怎麼應對。 */
  #drawEventCard(): void {
    const event = drawEvent(this.world, this.#eventContext);
    const chances = successChances(this.#traits);

    this.flow.ask(
      {
        title: `事件｜${event.name} — 你要怎麼應對？`,
        options: [
          {
            id: 'event:bold',
            label: '全力一搏',
            note: `成功率 ${chances.bold}%｜幅度最大，受傷風險也最高`,
            role: 'warn',
          },
          { id: 'event:normal', label: '照常執行', note: `成功率 ${chances.normal}%`, role: 'main' },
          { id: 'event:safe', label: '保守應對', note: `成功率 ${chances.safe}%｜幅度最小` },
        ],
      },
      (choice) => this.#resolveEventCard(event, choice.slice('event:'.length) as EventMode),
    );
  }

  /** 解算事件卡並套用結果。 */
  #resolveEventCard(event: GameEvent, mode: EventMode): void {
    const outcome = resolveEvent(
      this.world,
      event,
      mode,
      this.#eventContext,
      ALL_ABILITIES,
      PITCH_FAMILIES,
    );

    const lines: string[] = [];

    for (const delta of outcome.deltas) {
      const name = abilities.abilities[delta.key] ?? delta.key;
      if (delta.points >= 0) {
        const before = this.#ability[delta.key] ?? 0;
        this.#applyPoints(delta.key, delta.points, { silent: true });
        const after = this.#ability[delta.key] ?? 0;
        lines.push(
          after > before
            ? `${esc(name)} <span class="up">+${after - before}</span>`
            : `${esc(name)}：點數進了蓄力槽，未滿一級`,
        );
      } else {
        const before = this.#ability[delta.key] ?? 0;
        this.#ability[delta.key] = Math.max(
          abilities.scale.hard_floor,
          before + delta.points,
        );
        lines.push(
          `${esc(name)} <span class="dn">${(this.#ability[delta.key] ?? 0) - before}</span>`,
        );
      }
    }

    for (const raise of outcome.ceilings) {
      const name = abilities.abilities[raise.key] ?? raise.key;
      const before = this.#ceilingBonus[raise.key] ?? 0;
      this.#ceilingBonus[raise.key] = raiseCeiling(before, raise.points);
      const gained = (this.#ceilingBonus[raise.key] ?? 0) - before;
      lines.push(
        gained > 0
          ? `${esc(name)} 上限 <span class="up">+${gained}</span>`
          : `${esc(name)} 的上限已經到頂`,
      );
    }

    if (outcome.injury > 0) {
      this.#injuryRisk += outcome.injury;
      lines.push(`本季受傷機率 <span class="dn">+${outcome.injury}%</span>`);
    }

    // 非能力的特殊效果目前只實作觸發特性；禁賽、聲望等要等對應系統做出來。
    for (const key of Object.keys(outcome.special).sort()) {
      if (key === 'yips' || key === 'clutch') this.#traits.add(key);
    }

    const tag = mode === 'safe' ? '（保守應對）' : mode === 'bold' ? '（全力一搏）' : '';
    const verdict =
      mode === 'bold'
        ? outcome.good
          ? '<b class="hl">豪賭成功！</b>'
          : '<b class="dn">豪賭失敗……</b>'
        : '';
    this.flow.card(
      outcome.good ? 'good' : 'bad',
      `事件卡｜${event.name}${tag}`,
      `${esc(outcome.text)}。${verdict}<br>${lines.join('｜') || '（沒有明顯的變化）'}`,
    );
  }

  /** 季初的自主訓練：擲骰，逐顆分配。 */
  #springTraining(): void {
    const dice = rollTrainingDice(this.world, this.#traits);

    let msg = `自主訓練擲出 <b class="hl">${dice.values.length}</b> 顆骰：` +
      dice.values.map((v) => `<b class="hl">${v}</b>`).join('、');
    if (dice.sixes > 0) msg += `，其中 ${dice.sixes} 顆是高標值。`;
    this.flow.card('info', '季初訓練', msg);

    // 每一顆骰都是一次選擇——重播日誌因此記下「哪顆骰加在哪」。
    // 必須 unshift 而非 push：佇列裡已經排著本年度後續的步驟，push 會讓分配
    // 跑到事件卡與大賽之後。
    this.flow.unshift(
      ...dice.values.map(
        (value, index) => () => this.#allocate(value, index, dice.values.length),
      ),
    );
  }

  /** 這一季的大賽。 */
  #cups(): void {
    const player = this.#player;
    if (player === null) return;

    const season = playCups(this.world, {
      stage: 'HS',
      ability: this.#ability,
      position: ratingPosition(player.startPosition),
      traits: this.#traits,
      schoolTier: player.schoolTier,
    });

    const lines = season.results
      .map((r) => `${esc(r.cup)}：<b class="hl">${esc(r.rank)}</b>（+${r.points} 點）`)
      .join('<br>');
    this.flow.card('info', '大賽結算', lines);

    for (const cup of season.championships) {
      this.#honors.push(`${this.#year} ${cup}冠軍`);
    }
    if (season.championships.length > 0) {
      this.flow.card(
        'gold',
        '冠軍',
        `拿下 <b class="hl">${esc(season.championships.join('、'))}</b> 的冠軍。`,
      );
    }

    if (academyUnlocked('HS', season)) this.#traits.add(amateur.cups.academy_trigger.trait);

    this.#pool += season.points;
    // 同樣要插隊——年度結束的步驟已經排在佇列裡了。
    this.flow.unshift(() => this.#spendPool());
  }

  /**
   * 分配大賽得到的能力點，一次一點。
   *
   * 每一點都是獨立的選擇，因此重播日誌完整記下配點路徑。玩家可以隨時停手，
   * 剩下的點數留到下一年——與訓練骰不同，大賽點數不會過期。
   */
  #spendPool(): void {
    if (this.#pool <= 0) return;

    const options: Option[] = ALL_ABILITIES.map((key) => this.#abilityOption(key, 1));
    options.push({ id: 'pool:keep', label: '先留著', note: '剩下的點數留到之後再分配' });

    this.flow.ask(
      { title: `大賽點數還有 ${this.#pool} 點`, options },
      (choice) => {
        if (choice === 'pool:keep') return;
        this.#applyPoints(choice.slice('alloc:'.length), 1);
        this.#pool--;
        // 還有點數就再問一次，直到分完或玩家喊停。
        this.flow.unshift(() => this.#spendPool());
      },
    );
  }

  /** 年度結束：推進年齡與年份，還有下一年就繼續，否則畢業。 */
  #endYear(): void {
    this.#age++;
    this.#year++;
    this.#stageYear++;

    if (this.#stageYear <= HIGH_SCHOOL_YEARS) {
      this.flow.push(() => this.#startYear());
      return;
    }
    this.flow.push(() => this.#graduate());
  }

  /** 高中畢業。目前是流程的終點，選秀尚未實作。 */
  #graduate(): void {
    const r = this.rating;
    this.flow.divider(`${this.#year} 年 · ${this.#age} 歲 · 高中畢業`);
    this.flow.card(
      'gold',
      '高中畢業',
      `三年結束，綜合能力 <b class="hl">${r?.overall ?? 0}</b>` +
        `（投手側 ${r?.pitcher ?? 0}／野手側 ${r?.fielder ?? 0}）。` +
        (this.#honors.length > 0 ? `<br>生涯榮譽：${esc(this.#honors.join('、'))}` : ''),
    );
    this.flow.card(
      'info',
      '尚未實作',
      '選秀、二刀流判定與職業生涯都還沒做，流程到這裡為止。' +
        '目前可用的是開局生成、訓練骰與蓄力槽、大賽結算與年度循環，' +
        '以及流程編排與重播機制。',
    );
  }

  /** 分配一顆訓練骰。 */
  #allocate(value: number, index: number, total: number): void {
    this.flow.ask(
      {
        title: `第 ${index + 1}／${total} 顆骰：${value} 點要加在哪？`,
        options: ALL_ABILITIES.map((key) => this.#abilityOption(key, value)),
      },
      (choice) => this.#applyPoints(choice.slice('alloc:'.length), value),
    );
  }

  /** 這項能力目前的潛力天花板，含事件提升的部分。 */
  #ceilingOf(key: AbilityKey): number {
    const base = this.#player?.potential[key] ?? abilities.scale.max;
    return base + (this.#ceilingBonus[key] ?? 0);
  }

  /** 把點數投進一項能力，並產生對應的敘事。 */
  #applyPoints(key: AbilityKey, points: number, options: { silent?: boolean } = {}): void {
    const before = this.#ability[key] ?? 0;
    const result = train(
      before,
      points,
      this.#ceilingOf(key),
      this.#carry[key] ?? 0,
      growthCurve(this.isTwoWay),
      this.#ceilingBonus[key] ?? 0,
    );
    this.#ability[key] = result.value;
    this.#carry[key] = result.carry;
    if (options.silent === true) return;

    const name = abilities.abilities[key] ?? key;
    if (result.gained > 0) {
      this.flow.card(
        'good',
        undefined,
        `<b class="hl">${esc(name)}</b> ${before} → <b class="hl">${result.value}</b>`,
      );
    } else {
      this.flow.card(
        'info',
        undefined,
        `<b class="hl">${esc(name)}</b> 還沒突破，${points} 點存進蓄力槽（目前 ${result.carry} 點）。`,
      );
    }
  }

  /** 產生一個能力的分配選項，附上目前值、天花板與這一級的成本。 */
  #abilityOption(key: AbilityKey, value: number): Option {
    const current = this.#ability[key] ?? 0;
    const ceiling = this.#ceilingOf(key);
    const carry = this.#carry[key] ?? 0;
    const result = train(
      current,
      value,
      ceiling,
      carry,
      growthCurve(this.isTwoWay),
      this.#ceilingBonus[key] ?? 0,
    );

    const name = abilities.abilities[key] ?? key;
    const note =
      result.gained > 0
        ? `${current} → ${result.value}（上限 ${ceiling}）`
        : `${current}／上限 ${ceiling}・蓄力 ${carry} → ${result.carry}`;

    return { id: `alloc:${key}`, label: name, note };
  }

}

function handLabel(hand: string): string {
  return hand === 'S' ? '雙' : hand === 'L' ? '左' : '右';
}
