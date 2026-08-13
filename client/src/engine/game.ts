/**
 * 一局遊戲：把亂數層、規則資料與流程編排綁在一起。
 *
 * 開局設定（種子、姓名、起始守位）是**參數**，不是流程中的選擇——它們在
 * 進入流程之前就決定了，與舊版的開局畫面一致。進入流程之後，玩家的選擇是
 * 唯一的外部輸入。
 *
 * 因此「開局設定＋選擇序列」就是一段生涯的完整表述，見 ADR 0002。
 */

import { abilities } from '../data/index.ts';
import { esc, Flow } from './flow.ts';
import { createPlayer, type NewPlayer } from './genesis.ts';
import { World } from './rng.ts';

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

export class Game {
  readonly setup: GameSetup;
  readonly world: World;
  readonly flow = new Flow();

  #player: NewPlayer | null = null;

  constructor(setup: GameSetup) {
    this.setup = setup;
    this.world = new World(setup.seed);
  }

  /** 目前的球員。流程開始前為 null。 */
  get player(): NewPlayer | null {
    return this.#player;
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

    const tier = ['', '名門', '中堅', '弱旅'][player.schoolTier] ?? '';
    const startName = abilities.start_positions[player.startPosition];

    this.flow.divider(`${player.year} 年 · ${player.age} 歲 · 高中一年級`);
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

    this.flow.push(() => this.#firstSpring());
  }

  /** 高一春天。目前是流程的終點，後續系統尚未實作。 */
  #firstSpring(): void {
    this.flow.ask(
      {
        title: '高一春天，你要怎麼開始？',
        options: [
          { id: 'spring:train', label: '跟著球隊練', note: '照表操課', role: 'main' },
          { id: 'spring:extra', label: '自主加練', note: '練得更兇，但容易累積疲勞' },
        ],
      },
      (choice) => {
        this.flow.card(
          'info',
          '尚未實作',
          `你選了「${choice === 'spring:extra' ? '自主加練' : '跟著球隊練'}」。` +
            '訓練與成長系統還沒做，流程到這裡為止——' +
            '這一頁目前只驗證流程編排與重播機制可用。',
        );
      },
    );
  }
}

function handLabel(hand: string): string {
  return hand === 'S' ? '雙' : hand === 'L' ? '左' : '右';
}
