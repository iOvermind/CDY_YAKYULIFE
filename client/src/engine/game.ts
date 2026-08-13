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
  type Hand,
  type SchoolStage,
} from '../data/index.ts';
import {
  academyUnlocked,
  nextStageOf,
  playCups,
  playYouthTournament,
  qualifiedTournaments,
  schoolTiersOf,
  stageOf,
  type CupSeason,
} from './amateur.ts';
import {
  addBatting,
  addPitching,
  playAmateurStats,
  type BattingLine,
  type PitchingLine,
} from './amateurStats.ts';
import { canRejectOffer, qualifiesAsTwoWay, runDraft, TWO_WAY_TRAIT } from './draft.ts';
import {
  drawEvent,
  resolveEvent,
  successChances,
  type EventContext,
  type EventMode,
  type GameEvent,
} from './events.ts';
import { esc, Flow, type Option } from './flow.ts';
import { assignSchool, createPlayer, type NewPlayer } from './genesis.ts';
import { championshipDice, growthCurve, raiseCeiling, rollTrainingDice, train } from './growth.ts';
import { applyAging, evaluateMovement, pathOf, proDiceCount, shouldRetire } from './pro.ts';
import { levelOf, playSeason, positionName } from './season.ts';
import { rate, ratingPosition } from './rating.ts';
import { World } from './rng.ts';



/** 一局遊戲的開局設定。與重播日誌合起來即可完整重建一段生涯。 */
export interface GameSetup {
  readonly seed: string;
  readonly name: string;
  readonly startPosition: NewPlayer['startPosition'];
  /** 投球慣用手。由玩家選擇，不是擲出來的。 */
  readonly throws: Hand;
  /** 打擊慣用手。 */
  readonly bats: Hand;
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
  /** 目前的養成階段。 */
  readonly stage: SchoolStage;
  /** 目前階段的第幾年，從 1 起算。 */
  readonly stageYear: number;
  /** 目前就讀的學校。 */
  readonly school: string;
  /** 學校的隱藏強度分級。 */
  readonly schoolTier: number;
  /** 生涯榮譽。 */
  readonly honors: readonly string[];
  /** 尚未分配的能力點。 */
  readonly pool: number;
  /** 各項能力被提升的上限點數。 */
  readonly ceilingBonus: Readonly<Record<AbilityKey, number>>;
  /** 本季累積的受傷機率增幅。 */
  readonly injuryRisk: number;
  /** 當年成績。尚未打完大賽時為 null。 */
  readonly seasonBatting: BattingLine | null;
  readonly seasonPitching: PitchingLine | null;
  /** 各階段的累計成績。鍵為階段代碼（JHS / HS / …）。 */
  readonly statsByStage: Readonly<
    Record<string, { batting: BattingLine | null; pitching: PitchingLine | null }>
  >;
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
  #stage: SchoolStage = 'JHS';
  #stageYear = 1;
  #school = '';
  #schoolTier = 2;
  #honors: string[] = [];
  #pool = 0;
  #ceilingBonus: Record<AbilityKey, number> = {};
  #injuryRisk = 0;
  #dice: { values: readonly number[]; index: number } | null = null;
  /** 這一季的大賽結果。國際賽的直通資格要看它，因此必須留著。 */
  #lastCupSeason: CupSeason | null = null;
  /**
   * 上一季奪下的冠軍種類，供**隔季**的訓練骰加成使用。
   *
   * 只保留一季——加成不累積到再下一季，否則強校球員會滾雪球到失控。
   */
  #lastChampionships: string[] = [];
  #seasonBatting: BattingLine | null = null;
  #seasonPitching: PitchingLine | null = null;
  #statsByStage: Record<string, { batting: BattingLine | null; pitching: PitchingLine | null }> =
    {};
  /**
   * 職業狀態。尚未進職業時為 null——用它而不是用 stage 判斷是否在職業階段，
   * 因為 stage 是養成階段的代碼，硬塞一個 'PRO' 進去會讓學校、學年那些欄位
   * 全部失去意義。
   */
  #pro: {
    level: string;
    team: string;
    /** 在最低層級連續待了幾季，供戰力外的寬限期判定。 */
    yearsAtBottom: number;
    /** 職業第幾年，從 1 起算。 */
    year: number;
  } | null = null;

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
      stage: this.#stage,
      stageYear: this.#stageYear,
      school: this.#school,
      schoolTier: this.#schoolTier,
      honors: this.#honors,
      pool: this.#pool,
      ceilingBonus: this.#ceilingBonus,
      injuryRisk: this.#injuryRisk,
      seasonBatting: this.#seasonBatting,
      seasonPitching: this.#seasonPitching,
      statsByStage: this.#statsByStage,
    };
  }

  /**
   * 這一季擲出的訓練骰與分配進度，供介面畫出骰面。
   * 不在分配階段時為 null。
   */
  get dice(): { readonly values: readonly number[]; readonly index: number } | null {
    return this.#dice;
  }

  /** 事件系統需要的情境。 */
  get #eventContext(): EventContext {
    return {
      startPosition: this.#player?.startPosition ?? 'UTIL',
      professional: this.#pro !== null,
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
    const player = createPlayer(this.world, this.setup.name, this.setup.startPosition, {
      throws: this.setup.throws,
      bats: this.setup.bats,
    });
    this.#player = player;
    this.#ability = { ...player.ability };
    this.#carry = Object.fromEntries(ALL_ABILITIES.map((k) => [k, 0]));
    this.#ceilingBonus = Object.fromEntries(ALL_ABILITIES.map((k) => [k, 0]));
    this.#age = player.age;
    this.#year = player.year;
    this.#school = player.school;
    this.#schoolTier = player.schoolTier;

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

  /** 一個年度：分隔線 → 季初訓練 → 事件卡 → 大賽 → 國際賽 → 分配點數 → 年度結束。 */
  #startYear(): void {
    const def = stageOf(this.#stage);
    const label = def.year_labels[this.#stageYear - 1] ?? `${def.name}第 ${this.#stageYear} 年`;
    this.flow.divider(`${this.#year} 年 · ${this.#age} 歲 · ${label}`);
    this.flow.push(
      () => this.#springTraining(),
      () => this.#drawEventCard(),
      () => this.#cups(),
      () => this.#youthTournament(),
      () => this.#endYear(),
    );
  }

  /**
   * 養成期的國際賽。
   *
   * 判定方式是「贏下掛著代表權的國內大賽」，因此必須排在大賽之後。敘事上
   * 一律寫成入選國家隊——現實中打好國內盃賽本來就是入選的主要依據。
   */
  #youthTournament(): void {
    const season = this.#lastCupSeason;
    if (season === null) return;
    const overall = this.rating?.overall ?? 0;

    const honorRanks = new Set(amateur.amateur_international.honor_ranks.values);
    for (const code of qualifiedTournaments(this.#stage, season)) {
      const result = playYouthTournament(this.world, code, overall);
      const prefix = amateur.amateur_international.honor_prefix;

      // 國際賽與國內大賽的榮譽各自獨立——贏下謝國城盃是一項成就，代表台灣
      // 打 LLB 拿冠軍是另一項。
      if (honorRanks.has(result.rank)) {
        this.#honors.push(`${prefix}${result.tournament}${result.rank}`);
      }
      this.#pool += result.points;
      if (result.rankIndex === 0) this.#lastChampionships.push('international');

      this.flow.card(
        result.rankIndex <= 1 ? 'gold' : 'good',
        result.tournament,
        `這一年的表現讓你入選國家隊，披上中華隊戰袍。` +
          `最終 <b class="hl">${esc(result.rank)}</b>` +
          `（${result.games} 場・+${result.points} 點）。`,
      );

      // 國際賽的出賽同樣計入成績。
      const rating = this.rating;
      const line = playAmateurStats(this.world, this.#stage, this.#ability, result.games, {
        better: rating?.better ?? 'fielder',
        twoWay: this.isTwoWay,
      });
      this.#seasonBatting = addBatting(this.#seasonBatting, line.batting);
      this.#seasonPitching = addPitching(this.#seasonPitching, line.pitching);
      this.#accumulate(line.batting, line.pitching);
    }
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
    // 上一季的冠軍在這裡兌現，兌現後即清空——加成只延續一季。
    const bonus = championshipDice(this.#lastChampionships);
    const earnedBy = this.#lastChampionships;
    this.#lastChampionships = [];

    const dice = rollTrainingDice(this.world, this.#traits, { bonusDice: bonus });

    this.#dice = { values: dice.values, index: 0 };

    let msg = `自主訓練擲出 <b class="hl">${dice.values.length}</b> 顆骰：` +
      dice.values.map((v) => `<b class="hl">${v}</b>`).join('、');
    if (dice.sixes > 0) msg += `，其中 ${dice.sixes} 顆是高標值。`;
    if (bonus > 0) {
      msg += `<br>去年的冠軍（${esc(earnedBy.join('、'))}）帶來更好的練習環境，` +
        `多擲 <b class="hl">${bonus}</b> 顆骰。`;
    }
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
      stage: this.#stage,
      ability: this.#ability,
      position: ratingPosition(player.startPosition),
      traits: this.#traits,
      schoolTier: this.#schoolTier,
    });

    const lines = season.results
      .map(
        (r) =>
          `${esc(r.cup)}：<b class="hl">${esc(r.rank)}</b>` +
          `（${r.games} 場・+${r.points} 點）`,
      )
      .join('<br>');
    this.flow.card('info', '大賽結算', lines);

    // 成績依主要角色產生；二刀流投打都算。
    const rating = this.rating;
    const line = playAmateurStats(this.world, this.#stage, this.#ability, season.games, {
      better: rating?.better ?? 'fielder',
      twoWay: this.isTwoWay,
    });
    this.#seasonBatting = line.batting;
    this.#seasonPitching = line.pitching;
    this.#accumulate(line.batting, line.pitching);

    const statLines: string[] = [];
    if (line.pitching !== null) {
      const p = line.pitching;
      statLines.push(
        `投球 ${p.games} 場 ${p.ip} 局・${p.so} K・防禦率 <b class="hl">${p.era.toFixed(2)}</b>`,
      );
    }
    if (line.batting !== null) {
      const b = line.batting;
      statLines.push(
        `打擊 ${b.ab} 打數 ${b.hits} 安打 ${b.hr} 轟 ${b.rbi} 打點・` +
          `打擊率 <b class="hl">${fmtAvg(b.avg)}</b>`,
      );
    }
    if (statLines.length > 0) this.flow.card('good', '個人成績', statLines.join('<br>'));

    // 只有名次夠好才計入成就，且不帶年份——六年下來會累積出一長串「八強」，
    // 把真正的榮譽淹掉。其餘名次照樣給能力點。
    for (const h of season.honors) this.#honors.push(`${h.cup}${h.rank}`);
    if (season.championships.length > 0) {
      this.flow.card(
        'gold',
        '冠軍',
        `拿下 <b class="hl">${esc(season.championships.join('、'))}</b> 的冠軍。`,
      );
    }

    if (academyUnlocked(this.#stage, season)) this.#traits.add(amateur.cups.academy_trigger.trait);

    this.#lastCupSeason = season;
    if (season.championships.length > 0) this.#lastChampionships.push(this.#stage);
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

  /** 年度結束：推進年齡與年份；同階段還有下一年就繼續，否則升學或畢業。 */
  #endYear(): void {
    this.#age++;
    this.#year++;
    this.#stageYear++;

    if (this.#stageYear <= stageOf(this.#stage).years) {
      this.flow.push(() => this.#startYear());
      return;
    }

    const next = nextStageOf(this.#stage);
    if (next === null) {
      this.flow.push(() => this.#graduate());
      return;
    }
    this.flow.push(() => this.#advanceStage(next));
  }

  /** 升學：換階段、重新分發學校。 */
  #advanceStage(next: SchoolStage): void {
    const from = stageOf(this.#stage);
    this.#stage = next;
    this.#stageYear = 1;

    // 升學分發走 career 流——這是生涯事件，不是開局生成。
    const assigned = assignSchool(this.world, next, 'career');
    this.#school = assigned.school;
    this.#schoolTier = assigned.tier;

    const tiers = schoolTiersOf(next);
    const label = tiers?.tiers[String(assigned.tier)]?.label ?? '';
    this.flow.divider(`${this.#year} 年 · ${this.#age} 歲 · ${from.name}畢業`);
    this.flow.card(
      'gold',
      `${stageOf(next).name}入學`,
      `${esc(from.name)}三年結束，你進了<b class="hl">${esc(assigned.school)}</b>` +
        `${label ? `（${esc(label)}）` : ''}。`,
    );
    this.flow.push(() => this.#startYear());
  }

  /** 高中畢業：結算三年、判定二刀流，然後進選秀。 */
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

    // 二刀流的判定在選秀之前——它會影響球團怎麼評估你。
    if (r !== null && qualifiesAsTwoWay(r)) {
      this.#traits.add(TWO_WAY_TRAIT);
      this.flow.card(
        'gold',
        '隱藏天賦：二刀流',
        '投得動也打得開。球探報告上多了一行少見的註記——' +
          '<b class="hl">兩邊都值得投資</b>。從今以後，投打兩側的成長都不再像專精者那樣陡。',
      );
    }

    this.flow.push(() => this.#draft());
  }

  /** 中華職棒選秀。 */
  #draft(): void {
    const overall = this.rating?.overall ?? 0;
    const result = runDraft(this.world, { overall, age: this.#age });

    if (result.undrafted) {
      this.flow.card(
        'bad',
        '選秀落榜',
        `唱名一輪又一輪，始終沒有你的名字。` +
          `（綜合 ${overall}｜年齡加權後評價 ${result.score}）`,
      );
      this.flow.push(() => this.#careerOver('落榜'));
      return;
    }

    const accept = () => {
      this.flow.card(
        'gold',
        '中華職棒選秀會',
        `第 <b class="hl">${result.round}</b> 輪獲 <b class="hl">${esc(result.team ?? '')}</b> 指名！` +
          `簽約金 <b class="hl">${result.bonus} 萬</b>。` +
          (result.level === amateur.draft.first_round_direct_promotion.level
            ? '即戰力評價，直接放入一軍名單。'
            : '先從二軍出發。'),
      );
      this.flow.push(() => this.#professionalStart(result.level ?? '', result.team ?? ''));
    };

    if (!canRejectOffer(result, this.#age)) {
      accept();
      return;
    }

    this.flow.ask(
      {
        title: `中華職棒選秀會 · 第 ${result.round} 輪獲 ${result.team} 指名`,
        options: [
          {
            id: 'draft:accept',
            label: '接受指名，加盟球隊',
            note: `簽約金 ${result.bonus} 萬｜從${
              result.level === amateur.draft.first_round_direct_promotion.level ? '一軍' : '二軍'
            }出發`,
            role: 'main',
          },
          {
            id: 'draft:reject',
            label: '重返校園，再拚一年',
            note: '放棄本次指名，明年重新參加選秀',
            role: 'warn',
          },
        ],
      },
      (choice) => {
        if (choice === 'draft:accept') {
          accept();
          return;
        }
        this.flow.card(
          'info',
          '重返校園',
          '看到被選到的輪次，雙眼發黑。你握緊拳頭，決定再磨一年——' +
            '這一次，你一定要在前段輪次被叫到名字。',
        );
        this.flow.push(() => this.#careerOver('重返校園'));
      },
    );
  }

  /** 進入職業。目前只跑 CPBL 主軸——旅外體系的轉會與尋路尚未實作。 */
  #professionalStart(level: string, team: string): void {
    this.#pro = { level, team, yearsAtBottom: 0, year: 1 };
    this.#seasonBatting = null;
    this.#seasonPitching = null;
    this.flow.push(() => this.#proYear());
  }

  /** 職業的一個年度：分隔線 → 季初訓練 → 事件卡 → 球季 → 年度結束。 */
  #proYear(): void {
    const pro = this.#pro;
    if (pro === null) return;
    const info = levelOf(pro.level);

    this.flow.divider(
      `${this.#year} 年 · ${this.#age} 歲 · ${pro.team} · ${info.name}（職業第 ${pro.year} 年）`,
    );
    this.flow.push(
      () => this.#proSpringTraining(),
      () => this.#drawEventCard(),
      () => this.#proSeason(),
      () => this.#proEndYear(),
    );
  }

  /**
   * 職業的季初訓練。
   *
   * 骰數比養成期少——職業球員的時間被球季佔滿，能自主訓練的空間有限。奪冠
   * 加成仍然生效，接上養成期的同一套機制。
   */
  #proSpringTraining(): void {
    const bonus = championshipDice(this.#lastChampionships);
    const earnedBy = this.#lastChampionships;
    this.#lastChampionships = [];

    const count = proDiceCount(this.world, this.#age) + bonus;
    const rng = this.world.stream('growth');
    const values = Array.from({ length: count }, () => rng.int(1, 6));

    this.#dice = { values, index: 0 };

    let msg =
      `自主訓練擲出 <b class="hl">${values.length}</b> 顆骰：` +
      values.map((v) => `<b class="hl">${v}</b>`).join('、');
    if (bonus > 0) {
      msg += `<br>去年的冠軍（${esc(earnedBy.join('、'))}）帶來更好的訓練資源，多擲 <b class="hl">${bonus}</b> 顆骰。`;
    }
    this.flow.card('info', '季初訓練', msg);

    // 與養成期同理：必須 unshift，否則配點會跑到球季之後。
    this.flow.unshift(
      ...values.map((value, index) => () => this.#allocate(value, index, values.length)),
    );
  }

  /** 打完一季，並把成績記進生涯累計。 */
  #proSeason(): void {
    const pro = this.#pro;
    const player = this.#player;
    const r = this.rating;
    if (pro === null || player === null || r === null) return;

    const position = ratingPosition(player.startPosition);
    const line = playSeason(this.world, {
      level: pro.level,
      ability: this.#ability,
      position,
      overall: r.overall,
      better: r.pitcher >= r.fielder ? 'pitcher' : 'fielder',
      twoWay: this.isTwoWay,
    });

    this.#seasonBatting = line.batting;
    this.#seasonPitching = line.pitching;
    this.#accumulate(line.batting, line.pitching);

    const parts: string[] = [];
    if (line.pitching !== null) {
      const p = line.pitching;
      parts.push(
        `<b>投手</b>（${p.role === 'SP' ? '先發' : '後援'}）｜${p.games} 場` +
          `${p.starts > 0 ? `・先發 ${p.starts}` : ''}・${p.ip.toFixed(1)} 局` +
          `・${p.wins} 勝 ${p.losses} 敗${p.saves > 0 ? ` ${p.saves} 救援` : ''}` +
          `・防禦率 <b class="hl">${p.era.toFixed(2)}</b>・奪三振 ${p.so}`,
      );
    }
    if (line.batting !== null) {
      const b = line.batting;
      parts.push(
        `<b>打者</b>（${esc(positionName(position))}）｜${b.games} 場・${b.pa} 打席` +
          `・打擊率 <b class="hl">${fmtAvg(b.avg)}</b>／${fmtAvg(b.obp)}／${fmtAvg(b.slg)}` +
          `・${b.hr} 轟 ${b.rbi} 打點${b.sb > 0 ? `・盜壘 ${b.sb}` : ''}` +
          `${b.ibb > 0 ? `・故意四壞 ${b.ibb}` : ''}`,
      );
    }

    this.flow.card('info', `${levelOf(pro.level).name} 球季成績`, parts.join('<br>'));
  }

  /**
   * 職業年度結束：老化 → 升降級 → 引退判定。
   *
   * 順序不能換。老化先跑，因為升降級看的是**這一季結束後**的能力；引退最後
   * 跑，因為被釋出是引退判定的輸入之一。
   */
  #proEndYear(): void {
    const pro = this.#pro;
    if (pro === null) return;

    this.#age++;
    this.#year++;
    pro.year++;

    // ---- 老化
    const aging = applyAging(this.world, this.#ability, this.#age);
    this.#ability = { ...aging.ability };
    if (aging.changes.size > 0) {
      const lines = [...aging.changes.entries()]
        .map(([k, v]) => `${esc(abilities.abilities[k as AbilityKey] ?? k)} ${v > 0 ? '+' : ''}${v}`)
        .join('｜');
      this.flow.card(
        aging.phase === 'decline' ? 'bad' : 'good',
        aging.phase === 'decline' ? '歲月' : '成長',
        aging.phase === 'decline'
          ? `身體開始誠實了。${lines}`
          : `還在往上走。${lines}`,
      );
    }

    // ---- 升降級
    const r = this.rating;
    const move = evaluateMovement(this.world, {
      level: pro.level,
      overall: r?.overall ?? 0,
      yearsAtBottom: pro.yearsAtBottom,
    });

    let released = false;
    if (move.movement === 'release') {
      released = true;
      this.flow.card('bad', '戰力外', `球團通知你不再續約——${esc(move.reason)}。`);
    } else if (move.level !== null && move.level !== pro.level) {
      const to = levelOf(move.level);
      this.flow.card(
        move.movement === 'promote' ? 'gold' : 'bad',
        move.movement === 'promote' ? '升上一軍' : '下放二軍',
        `${esc(move.reason)}，${move.movement === 'promote' ? '被叫上' : '被送回'}<b class="hl">${esc(to.name)}</b>。`,
      );
      pro.level = move.level;
    }

    // 只有待在體系最底層才累計寬限期——升上去就歸零。
    pro.yearsAtBottom = pathOf(levelOf(pro.level).org)[0] === pro.level ? pro.yearsAtBottom + 1 : 0;

    // ---- 引退
    const retire = shouldRetire(this.world, { age: this.#age, released });
    if (retire.retire || released) {
      this.flow.push(() => this.#retire(retire.retire ? retire.reason : move.reason));
      return;
    }
    this.flow.push(() => this.#proYear());
  }

  /** 引退：結算生涯。 */
  #retire(reason: string): void {
    const pro = this.#pro;
    const total = this.#statsByStage['PRO'];
    this.flow.divider(`${this.#year} 年 · ${this.#age} 歲 · 引退`);

    const lines: string[] = [];
    if (total?.pitching != null) {
      const p = total.pitching;
      lines.push(
        `投手：${p.games} 場・${p.ip.toFixed(1)} 局・防禦率 <b class="hl">${p.era.toFixed(2)}</b>・奪三振 ${p.so}`,
      );
    }
    if (total?.batting != null) {
      const b = total.batting;
      lines.push(
        `打者：${b.games} 場・${b.hits} 安打・${b.hr} 全壘打・${b.rbi} 打點` +
          `・生涯打擊率 <b class="hl">${fmtAvg(b.avg)}</b>`,
      );
    }

    this.flow.card(
      'gold',
      '引退',
      `${esc(reason)}。在<b class="hl">${esc(pro?.team ?? '')}</b>結束了 ${pro?.year ?? 0} 年的職業生涯。` +
        (lines.length > 0 ? `<br>${lines.join('<br>')}` : '') +
        (this.#honors.length > 0 ? `<br>生涯榮譽：${esc(this.#honors.join('、'))}` : ''),
    );
    this.flow.card(
      'info',
      '尚未實作',
      '名人堂、生涯獎項與二週目繼承還沒做。流程到這裡為止。',
    );
    this.#pro = null;
  }

  /** 生涯在進入職業之前結束。 */
  #careerOver(reason: string): void {
    this.flow.card(
      'info',
      '尚未實作',
      `${esc(reason)}之後的流程還沒做——大學、業餘成棒與隔年重新參加選秀都待實作。` +
        '流程到這裡為止。',
    );
  }

  /** 分配一顆訓練骰。 */
  #allocate(value: number, index: number, total: number): void {
    this.flow.ask(
      {
        title: `第 ${index + 1}／${total} 顆骰：${value} 點要加在哪？`,
        options: ALL_ABILITIES.map((key) => this.#abilityOption(key, value)),
      },
      (choice) => {
        this.#applyPoints(choice.slice('alloc:'.length), value);
        if (this.#dice !== null) {
          this.#dice = { values: this.#dice.values, index: index + 1 };
          // 最後一顆分配完就收起骰面——後面的提問（事件卡、大賽點數）與骰子無關。
          if (index + 1 >= total) this.#dice = null;
        }
      },
    );
  }

  /** 把一段成績累加到目前階段。各階段分開累計，介面才能分開呈現。 */
  #accumulate(batting: BattingLine | null, pitching: PitchingLine | null): void {
    // 職業的成績全部記在 PRO 之下——分層級記錄要等轉會系統做完才有意義。
    const key = this.#pro === null ? this.#stage : 'PRO';
    const current = this.#statsByStage[key] ?? { batting: null, pitching: null };
    this.#statsByStage[key] = {
      batting: addBatting(current.batting, batting),
      pitching: addPitching(current.pitching, pitching),
    };
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

/** 打擊率的棒球慣例寫法：去掉個位數的 0，例如 .333。 */
export function fmtAvg(avg: number): string {
  return avg.toFixed(3).replace(/^0/, '');
}

function handLabel(hand: string): string {
  return hand === 'S' ? '雙' : hand === 'L' ? '左' : '右';
}
