import styles from './DiceRow.module.css';


/**
 * 這一季擲出的訓練骰。
 *
 * 已分配的變暗、目前這一顆高亮——玩家看得到「還剩哪幾顆、現在要分配的是幾點」，
 * 而不是只讀到一行文字。6 點用不同顏色標示，那是高標值。
 */
export function DiceRow({ dice }: { dice: { values: readonly number[]; index: number } }) {
  return (
    <div id="dice" className={styles.dice}>
      {dice.values.map((v, i) => (
        <div
          key={i}
          className={[styles.die, i < dice.index && styles.used, i === dice.index && styles.active, v === 6 && styles.six]
            .filter(Boolean)
            .join(' ')}
        >
          {v}
        </div>
      ))}
    </div>
  );
}
