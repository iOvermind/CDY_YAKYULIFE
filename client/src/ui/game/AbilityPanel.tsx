import { useEffect, useRef } from 'react';
import { abilities } from '../../data/index.ts';
import type { Option } from '../../engine/flow.ts';
import type { PlayerState } from '../../engine/game.ts';
import { abilityCost, carryGauge, growthCurve } from '../../engine/growth.ts';
import { isSideVisible } from '../../engine/rating.ts';
import { useElementWidth } from '../common/useElementWidth.ts';
import styles from './AbilityPanel.module.css';

export function AbilityPanel({
  state,
  allocatable,
  repeatable,
  onChoose,
}: {
  state: PlayerState;
  allocatable: Map<string, Option>;
  repeatable: boolean;
  onChoose: (optionId: string) => void;
}) {
  const display = abilities.display_groups;
  const common = { state, allocatable, repeatable, onChoose };

  return (
    <>
      {display.order.map((group) => {
        const keys = display.members[group] ?? [];
        // 另一側整組收起來，不是變灰。留著一組永遠動不了的數字只會佔版面，也會
        // 讓玩家一直以為還有機會補回來。體力兩側共用，永遠顯示。
        // 用 visibleSide 而非 lockedSide：起始守位一選定就該收起來，不必等畢業。
        if (!isSideVisible(keys[0] ?? '', state.visibleSide)) return null;
        return (
          <AbilityBlock
            key={group}
            title={display.names[group] ?? group}
            keys={keys}
            {...common}
          />
        );
      })}
    </>
  );
}

function AbilityBlock({
  title,
  keys,
  state,
  allocatable,
  repeatable,
  onChoose,
}: {
  title: string;
  keys: readonly string[];
  state: PlayerState;
  allocatable: Map<string, Option>;
  repeatable: boolean;
  onChoose: (optionId: string) => void;
}) {
  return (
    <>
      <p className={styles.divider}>{title}</p>
      {keys.map((key) => (
        <AbilityRow
          key={key}
          abilityKey={key}
          state={state}
          option={allocatable.get(key)}
          repeatable={repeatable}
          onChoose={onChoose}
        />
      ))}
    </>
  );
}

function AbilityRow({
  abilityKey,
  state,
  option,
  repeatable,
  onChoose,
}: {
  abilityKey: string;
  state: PlayerState;
  option: Option | undefined;
  /** 長按可以連續加點。骰子分配是一顆一顆按的，不適用。 */
  repeatable: boolean;
  onChoose: (optionId: string) => void;
}) {
  // 連發要綁在「這一列現在還能不能點」上。放掉手指時這一列可能已經因為加點
  // 而變成不可點（沒有 option 了），pointerup 就落在一個沒有 handler 的
  // element 上，計時器會活過整個階段，下一輪骰子一發出來全灌進這條能力
  // （problems #55）。
  const repeat = useHold(option !== undefined && option.disabled !== true);
  const current = state.ability[abilityKey] ?? 0;
  const carry = state.carry[abilityKey] ?? 0;
  const bonus = state.ceilingBonus[abilityKey] ?? 0;
  // 天花板一律問引擎要。這裡曾經拿 origin.potential 自己加 ceilingBonus，漏掉了
  // 「天生神力」那類天賦加成（最高 +10），於是收錢按 80 收、畫面卻寫 70
  // （玩家回報 #56）。合成規則歸引擎，前端只負責畫。
  const ceiling = state.ceiling[abilityKey] ?? 0;
  // 天花板被事件頂過量表上限的那幾項（最多 +5，見 abilities.json 的
  // max_ceiling_bonus）。刻度不為它們伸縮，改用底色與 marker 標示。
  const overScale = ceiling > abilities.scale.max;
  // 與舊版一致的表達方式：蓄力／這一級所需點數，例如 0/2。成本 1 點時不顯示。
  // 欠點另外標一個「欠」字：分母跟著換成退一級退回來的錢，只寫負號會讀成
  // 「存了 -1 點」。
  const curve = growthCurve(state.traits.has('two_way'), state.age, abilityKey);
  const gauge = carryGauge(current, ceiling, carry, curve);
  const cost = abilityCost(current, ceiling, curve);

  // 量表刻度固定 20–80，**任何情況都不伸縮**。尾端會跟著上限提升而變長的話，
  // 同一條能力在事件前後長度不同、十幾條之間也互相對不齊，玩家沒辦法一眼橫著
  // 掃完一整欄。破 80 的部分寧可畫成滿條，由分母的數字去講完剩下的事。
  const head = abilities.scale.min;
  const tail = abilities.scale.max;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - head) / (tail - head)) * 100));

  // 已達上限的能力是「看得到、按不動」：仍然列在那裡（玩家要能看見自己的
  // 天花板），但不掛任何點擊或長按。之前只看 option 存不存在，於是滿級的列
  // 照樣可以按下去，engine 那邊 choose() 對 disabled 選項是丟例外的——畫面
  // 沒有任何反應，點數也不會少，看起來就是「卡在同一步」。
  const allocating = option !== undefined && option.disabled !== true;

  const [barRef, barWidth] = useElementWidth<HTMLSpanElement>();
  const markerStyle =
    barWidth > 0
      ? { left: `${Math.round((pct(ceiling) / 100) * barWidth)}px` }
      : { left: `${pct(ceiling)}%` };

  const row = (
    <>
      <span className={styles.nm}>{abilities.abilities[abilityKey] ?? abilityKey}</span>
      <span className={styles.bar} ref={barRef}>
        <i style={{ width: `${pct(current)}%` }} />
        {/* 位置取整到整數像素，否則 2px 的線會被抹在三欄上，看起來忽粗忽細。
            還沒量到寬度時先退回百分比——第一幀糊一下，好過整條線不見。 */}
        <em style={markerStyle} />
      </span>
      <span className={styles.val} style={{ lineHeight: 1.1 }}>
        {current}
        {/* 分母是這一項真正的天花板。原本固定寫 80，於是所有能力看起來都一樣有
            前途，玩家得靠 marker 的位置目測自己的潛力——而那道線只有兩像素。
            分子超過分母（例如 74/70）就是已經踩進加價區，那個寫法本身就是提示，
            不再另外上色。 */}
        <small style={{ opacity: 0.5 }} title={`潛力 ${ceiling}`}>
          /{ceiling}
        </small>
        {cost > 1 && (
          <span
            style={{ display: 'block', opacity: 0.5, fontSize: 10.5, letterSpacing: 1, marginTop: -2 }}
          >
            {gauge.points}/{gauge.need}
          </span>
        )}
      </span>
    </>
  );

  if (!allocating) {
    return (
      <div
        className={`${styles.abrow}${option !== undefined ? ` ${styles.capped}` : ''}${overScale ? ` ${styles.over}` : ''}`}
        // 分配中卻不能點的列，把 engine 給的理由（已達上限）直接掛上去，
        // 不要退回那條泛用的量表說明。
        title={option?.note ?? `${head}–${tail}${bonus > 0 ? `（上限已提升 +${bonus}）` : ''}`}
      >
        {row}
      </div>
    );
  }

  return (
    <div
      className={`${styles.abrow} ${styles.pickable}${overScale ? ` ${styles.over}` : ''}`}
      role="button"
      tabIndex={0}
      title={option.note}
      onClick={() => onChoose(option.id)}
      // 一次 100 點的大賽點數按一百下不是遊戲，是勞動。長按接管重複的部分：
      // 首次的 +1 仍由 onClick 發出（放開手才算數），按住超過門檻才開始連發。
      onPointerDown={() => repeatable && repeat.start(() => onChoose(option.id))}
      onPointerUp={repeat.stop}
      onPointerLeave={repeat.stop}
      onPointerCancel={repeat.stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChoose(option.id);
        }
      }}
    >
      {row}
    </div>
  );
}

/**
 * 長按連發。
 *
 * 按住 400ms 後開始，每 90ms 一次——比游標移開就停，因為手指滑出按鈕範圍是
 * 玩家想停下來的意思。計時器掛在 ref 上並在卸載時清掉：加點會讓整條能力列
 * 重繪，若計時器留在舊的閉包裡就會變成停不下來的連發。
 *
 * `active` 轉 false 也停：見 problems #55——放手時那一列可能已經沒有
 * handler 了，光靠 pointerup 收不乾淨。
 */
function useHold(
  active = true,
  delay = 400,
  every = 90,
): { start: (fn: () => void) => void; stop: () => void } {
  const timers = useRef<{ start?: number; tick?: number }>({});

  const stop = () => {
    window.clearTimeout(timers.current.start);
    window.clearInterval(timers.current.tick);
    timers.current = {};
  };

  useEffect(() => stop, []);
  // 元件還在、但已經不該連發了（選項消失或反灰）也要收掉：卸載不是唯一的
  // 結束方式，這一列多半是原地重繪的。
  useEffect(() => {
    if (!active) stop();
  }, [active]);

  return {
    start: (fn: () => void) => {
      stop();
      timers.current.start = window.setTimeout(() => {
        timers.current.tick = window.setInterval(fn, every);
      }, delay);
    },
    stop,
  };
}
