# ADR 0024: 啦啦隊殺手在戀情結束時才判定

## Status

Accepted

## Context

`docs/problems.txt` #7：「閨中蜜友觸發條件不對，結了婚的應該不能算在裡面，否則一直出現。」

`confidante`／啦啦隊殺手的意思寫在 `love.json` 裡：「我愛上了你，你卻只把我當好姊妹。」
它要說的是**一個從來沒把任何一段感情走到婚姻的人**。原本的實作是：

```ts
// #startDating() 裡
if (love.datedTimes >= loveCfg.dating.confidante.dated_times && love.kids === 0) {
  this.#unlockTrait('confidante', '啦啦隊殺手', '第三段戀情，還是走到了同樣的結局。…');
}
```

兩件事壞了。

1. **判定寫在戀情開始的那一刻。** `#startDating()` 是兩個人剛在一起的時候。在那個瞬間，
   「這段有沒有走到婚姻」根本還沒發生，所以條件退化成「只要開始第三段戀情就給」，
   而卡片還當場宣告「還是走到了同樣的結局」——人家昨天才答應你。資料的 `_note` 寫
   的是「仍未走到婚姻時觸發」，程式沒有實作那句話。

2. **結過婚的人算在裡面。** `#startDating()` 只從 `#singleYear()` 進得來，而
   `afterBreakup()` 讓離婚的人回到 `'divorced'`，照樣走單身那條路。於是「交往 A →
   結婚 → 離婚 → 交往 B → 交往 C」的人湊到三段，一樣領到啦啦隊殺手。條件只擋了
   `kids === 0`，沒有擋婚姻本身。

回報說的「一直出現」不是字面上的重複發卡：`#unlockTrait()` 第一行就是
`if (this.#traits.has(id)) return;`，而且全檔沒有任何地方刪特性。真正的現象是
**門檻鬆到幾乎每一局都拿得到**。

## Decision

**判定時機搬到戀情結束的那一刻，條件改成「三段戀情都以分手收場，而且從未結過婚」。**

條件收在 `love.ts` 的純函式裡：

```ts
export function earnsConfidante(love: LoveState): boolean {
  if (love.divorces > 0) return false;
  return love.datedTimes >= cfg.dating.confidante.dated_times;
}
```

呼叫點是 `game.ts` 的兩條分手路徑，都在發完分手卡之後：

- `#breakup()`——**只在 `!wasMarried` 時呼叫**。離婚不是分手，那一條要排除。
- `#loveCheckpoint()`——養成期身分轉換的「各奔東西」。分手就是分手，不因為發生在
  高中就不算。

`divorces === 0` 就是「從未結過婚」的完整判準：婚姻只有 `#breakup()` 一個出口，而
那裡必定累加 `divorces`。

**`kids === 0` 那一條刪掉。** `love.kids` 只在 `#marriedYear()` 的生產分支累加，
沒結婚本身就擋掉了小孩——多寫一條就是把同一件事講兩遍，而重複的判準遲早會有一邊
先腐爛。

## Consequences

拿得到的人少很多，而且拿到的時候文案是對的：第三次分手、從未結婚、身邊沒有人。
這正是這個稱號想描述的那種生涯。

離過婚的人永久失格。他失敗過，但他不是那個「只被當成好姊妹」的人——他有過婚姻，
那是另一個故事，不該共用同一個稱號。

`dated_times: 3` 這個旋鈕的意思也跟著變了：以前是「開始第三段」，現在是「第三次
分手」。同一個數字，嚴格得多。

養成期就可能達成。三段青春期的戀情都無疾而終，也算數——`datedTimes` 記的是交往
段數，不是職業生涯的交往段數。
