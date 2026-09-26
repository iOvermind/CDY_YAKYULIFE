

/**
 * 這一季擲出的訓練骰。
 *
 * 已分配的變暗、目前這一顆高亮——玩家看得到「還剩哪幾顆、現在要分配的是幾點」，
 * 而不是只讀到一行文字。6 點用不同顏色標示，那是高標值。
 */
export function DiceRow({ dice }: { dice: { values: readonly number[]; index: number } }) {
  return (
    <div id="dice">
      {dice.values.map((v, i) => (
        <div
          key={i}
          className={`die${i < dice.index ? ' used' : ''}${i === dice.index ? ' active' : ''}${
            v === 6 ? ' six' : ''
          }`}
        >
          {v}
        </div>
      ))}
    </div>
  );
}
