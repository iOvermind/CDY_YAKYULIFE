/**
 * 事件卡：抽卡、成功率、解算。
 *
 * 移植自 index_legacy.html 的 drawEvents() / evOdds() / resolveEvent()。
 * 本模組的抽取一律走 events 子序列（見 ADR 0002 的歸屬規則）。
 *
 * 與舊版最大的差別：效果的幅度改為「事件的效果值 × 應對方式的倍率」。舊版只
 * 取效果值的正負號、幅度全由應對方式決定，因此稀有事件無法比常見事件更重
 * ——那讓「神秘的營養品」和「打擊機特訓」一樣輕。
 */

import eventsJson from '../data/events.json';
import { type AbilityKey } from '../data/index.ts';
import type { World } from './rng.ts';

/** 玩家對事件的三種應對方式。 */
export type EventMode = 'safe' | 'normal' | 'bold';

export interface GameEvent {
  readonly id: string;
  readonly name: string;
  readonly for: string;
  readonly good_text: string;
  readonly bad_text: string;
  readonly good_effects?: Readonly<Record<string, number | boolean>>;
  readonly bad_effects?: Readonly<Record<string, number | boolean>>;
  readonly good_ceiling?: Readonly<Record<AbilityKey, number>>;
  readonly bad_ceiling?: Readonly<Record<AbilityKey, number>>;
  /** 抽取權重；未指定時視為 100，即常見事件。 */
  readonly weight?: number;
}

interface EventsData {
  readonly audience_codes: Readonly<Record<string, string>>;
  readonly magnitude: {
    readonly safe: number;
    readonly normal: number;
    readonly bold: number;
    readonly clutch_bold: { readonly good: number; readonly bad: number };
  };
  readonly injury_magnitude: Readonly<Record<string, number>>;
  readonly good_result_chance: {
    readonly base: number;
    readonly boosted: number;
    readonly boost_traits: readonly string[];
    readonly fail_penalty: { readonly trait: string; readonly add_fail_percent: number };
    readonly mode_modifier: {
      readonly safe: number;
      readonly normal: number;
      readonly bold: number;
      readonly bold_immune_trait: string;
      readonly cap: number;
    };
  };
  readonly events: readonly GameEvent[];
  /** 每年抽幾張事件卡，鍵為階段代碼（含 PRO）。 */
  readonly cards_per_year: Readonly<Record<string, number>>;
}

const data = eventsJson as unknown as EventsData;

/**
 * 這個階段每年抽幾張事件卡。
 *
 * legacy 是「職業 3 張、養成 2 張」；這裡再把國中拆出來——十三歲的一年裡不會
 * 發生那麼多事，而高中開始密度就該上來了。
 */
export function cardsPerYear(stage: string): number {
  return data.cards_per_year[stage] ?? data.cards_per_year['default'] ?? 1;
}

/** 預設抽取權重。未標 weight 的事件都是常見事件。 */
const DEFAULT_WEIGHT = 100;

export interface EventContext {
  /** 起始守位。用於判斷投手限定與野手限定的事件。 */
  readonly startPosition: string;
  /** 是否已進入職業階段。 */
  readonly professional: boolean;
  readonly traits: ReadonlySet<string>;
}

/** 這位球員這個階段抽得到的事件。 */
export function eventPool(ctx: EventContext): readonly GameEvent[] {
  const isPitcher = ctx.startPosition === 'P';
  return data.events.filter((e) => {
    switch (e.for) {
      case '*':
        return true;
      case 'P':
        return isPitcher;
      // A 與 B 在舊版是冗餘的，兩者都只判斷「非投手」。
      case 'A':
      case 'B':
        return !isPitcher;
      case 'PRO':
        return ctx.professional;
      default:
        return false;
    }
  });
}

/** 依權重抽一張事件卡。 */
export function drawEvent(world: World, ctx: EventContext): GameEvent {
  const pool = eventPool(ctx);
  if (pool.length === 0) throw new Error('drawEvent(): 這個階段沒有任何可抽的事件');
  const weights: Record<string, number> = {};
  for (const e of pool) weights[e.id] = e.weight ?? DEFAULT_WEIGHT;
  const id = world.stream('events').weighted(weights);
  const chosen = pool.find((e) => e.id === id);
  if (chosen === undefined) throw new Error(`drawEvent(): 抽到不存在的事件 ${id}`);
  return chosen;
}

/** 三種應對方式各自的成功率（百分比）。 */
export function successChances(traits: ReadonlySet<string>): Record<EventMode, number> {
  const cfg = data.good_result_chance;
  const mod = cfg.mode_modifier;

  let base = cfg.boost_traits.some((t) => traits.has(t)) ? cfg.boosted : cfg.base;
  if (traits.has(cfg.fail_penalty.trait)) base -= cfg.fail_penalty.add_fail_percent;

  const boldPenalty = traits.has(mod.bold_immune_trait) ? 0 : mod.bold;
  return {
    safe: Math.min(mod.cap, base + mod.safe),
    normal: base + mod.normal,
    bold: base + boldPenalty,
  };
}

/** 這次應對的效果倍率。 */
export function magnitudeFactor(
  mode: EventMode,
  good: boolean,
  traits: ReadonlySet<string>,
): number {
  const m = data.magnitude;
  if (mode === 'bold' && traits.has('clutch')) {
    return good ? m.clutch_bold.good : m.clutch_bold.bad;
  }
  return m[mode];
}

/** 這次應對造成的受傷機率增幅。 */
export function injuryMagnitude(mode: EventMode, traits: ReadonlySet<string>): number {
  if (mode === 'bold' && traits.has('clutch')) return data.injury_magnitude['clutch_bold'] ?? 0;
  return data.injury_magnitude[mode] ?? 0;
}

/** 一項能力的變化量。 */
export interface AbilityDelta {
  readonly key: AbilityKey;
  readonly points: number;
}

export interface EventOutcome {
  readonly event: GameEvent;
  readonly mode: EventMode;
  readonly good: boolean;
  /** 敘事文字。 */
  readonly text: string;
  /** 能力增減，已套用倍率。 */
  readonly deltas: readonly AbilityDelta[];
  /** 上限提升，已套用倍率。 */
  readonly ceilings: readonly AbilityDelta[];
  /** 受傷機率增幅；沒有 inj 效果時為 0。 */
  readonly injury: number;
  /** 非能力的特殊效果，原樣傳出交由呼叫端處理（禁賽、聲望、觸發特性等）。 */
  readonly special: Readonly<Record<string, number | boolean>>;
}

/** 已知的特殊效果鍵。其餘鍵一律視為能力代碼。 */
const SPECIAL_KEYS = new Set([
  'inj',
  'rand',
  'pitch',
  'suspension',
  'respect',
  'ban',
  'yips',
  'tj_countdown',
  'clutch',
]);

/**
 * 解算一張事件卡。
 *
 * 純計算：回傳這次事件造成的變化，不改動任何狀態。套用交給呼叫端，因為能力
 * 成長要經過成本曲線與蓄力槽，那是 growth 模組的事。
 */
export function resolveEvent(
  world: World,
  event: GameEvent,
  mode: EventMode,
  ctx: EventContext,
  applicableAbilities: readonly AbilityKey[],
  pitchFamilies: readonly AbilityKey[],
): EventOutcome {
  const rng = world.stream('events');
  const chances = successChances(ctx.traits);
  const good = rng.chance(chances[mode]);
  const factor = magnitudeFactor(mode, good, ctx.traits);

  const effects = (good ? event.good_effects : event.bad_effects) ?? {};
  const ceilingEffects = (good ? event.good_ceiling : event.bad_ceiling) ?? {};

  const deltas: AbilityDelta[] = [];
  const special: Record<string, number | boolean> = {};
  let injury = 0;

  // 鍵的走訪順序必須穩定——rand 與 pitch 會抽亂數，順序一變結果就變。
  for (const key of Object.keys(effects).sort()) {
    const raw = effects[key];
    if (raw === undefined) continue;

    if (key === 'inj') {
      injury = injuryMagnitude(mode, ctx.traits);
      continue;
    }
    if (typeof raw === 'boolean') {
      special[key] = raw;
      continue;
    }
    if (key === 'rand') {
      deltas.push({ key: rng.pick(applicableAbilities), points: scale(raw, factor) });
      continue;
    }
    if (key === 'pitch') {
      deltas.push({ key: rng.pick(pitchFamilies), points: scale(raw, factor) });
      continue;
    }
    if (SPECIAL_KEYS.has(key)) {
      special[key] = raw;
      continue;
    }
    deltas.push({ key, points: scale(raw, factor) });
  }

  const ceilings: AbilityDelta[] = [];
  for (const key of Object.keys(ceilingEffects).sort()) {
    const raw = ceilingEffects[key];
    if (raw !== undefined) ceilings.push({ key, points: scale(raw, factor) });
  }

  return {
    event,
    mode,
    good,
    text: good ? event.good_text : event.bad_text,
    deltas,
    ceilings,
    injury,
    special,
  };
}

/**
 * 套用倍率。四捨五入後保底 1 點（依原本的正負方向）——倍率 0.5 不該讓
 * 效果值 1 的事件完全沒有作用。
 */
function scale(value: number, factor: number): number {
  const scaled = Math.round(Math.abs(value) * factor);
  const magnitude = Math.max(1, scaled);
  return value < 0 ? -magnitude : magnitude;
}
