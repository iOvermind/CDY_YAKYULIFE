# 0049. 引擎的入口就是伺服器的契約，結算的配方只有一份

日期：2026-09-22

## 狀態

已接受

## 背景

伺服器直接 import client 的引擎原始碼（ADR 0007、0038）——那是刻意的，兩邊永遠是同一份規則，重跑驗證才有意義。但它是**點名內部檔案**在 import：`engine/game.ts`、`engine/achievements.ts`、`engine/ladder.ts`、`engine/hall.ts`、`engine/overlay.ts` 五條深路徑。

兩個後果：

**一、引擎的任何重整都可能在執行期才炸在伺服器上。** 伺服器跑的是 `node --experimental-strip-types`，沒有建置這一關：引擎裡的某支檔案哪天 import 了 `.tsx`、或有人加了一個 enum，client 的建置照樣是綠的，伺服器要到有人送出一段生涯時才失敗。唯一的防線是 DEVELOPER.md §5 的一句話，而沒有任何東西執行它。

**二、「結算一段生涯」的配方被抄了兩份。** `Game` 在引退時組出一個九欄的 `AchievementContext`；伺服器重跑之後，因為那九個欄位是 `Game` 的私有欄位，只能透過 `PlayerState` 投影再補退路：

```ts
awards: state?.awards ?? [],
traits: state?.traits ?? new Set<string>(),
spouses: state?.love.spouses ?? [],
```

那些 `??` 不是保險，是**分歧**：`state` 是 null 時它不會失敗，會靜靜算出另一組看起來很合理的成就。而整條配方（重跑 → 名人堂票選 → 成就 → 天梯列 → 還原覆蓋層）只以散文的形式寫在 `routes.ts` 的註解裡；票選甚至真的跑了兩次——一次在引退流程裡、一次在伺服器上。

## 決策

**一、`client/src/engine/index.ts` 是伺服器唯一被支援的 surface。** 伺服器對 client 的 import 只能走三條線：這份入口、`data/index.ts`（規則資料）、`api/contract.ts`（HTTP 形狀）。一道護欄測試（`engine/index.test.ts`）讀 `server/src` 的原始碼盯著這件事。

**它不是一個把底下全部 re-export 的 barrel。** 那種東西是 pass-through：任何人加一個 export 都自動變成伺服器的依賴，等於沒有畫線。這份檔案要一項一項寫進去，每加一項就是一次「這件事我願意日後不能隨手改」的決定。

**二、結算的配方只有一份：`Game.score(progress)`。** 它回傳成就、天梯要的每一列、球員名與結算當下的引擎版本。客戶端引退時走它，伺服器重跑驗證時也走它，差別只在傳進去的**跨局進度**（第幾段人生、已經解鎖過哪些成就）——那是只有伺服器手上有真的那一份的東西。名人堂票選在引退流程裡跑一次就存下來，`score()` 讀那一份，不再跑第二次。

引擎自己的模組之間照舊直接 import，不必繞入口；這份契約只約束伺服器。

## 後果

- 「我有沒有弄壞伺服器」變成「我有沒有改 `engine/index.ts`」，而且破線會在 `npm test` 就紅，不必等到執行期。
- 那九個欄位的組裝只存在一處，`?? []` 那種退路在型別上寫不出來了：`score()` 讀的是自己的私有欄位。
- 伺服器不再需要知道「結算要做哪幾件事、順序是什麼」。它只做它自己的事：拿進度、比對客戶端宣稱的成就、寫資料庫。
- 代價是多一層間接：要多用引擎的什麼東西，得先在入口寫一行。這是刻意的摩擦——它正是這份檔案存在的理由。
- `ENGINE_VERSION` 與 `fmtAvg` 一併搬出 `game.ts`（`engine/version.ts`、`engine/format.ts`）：畫面為了一個常數或兩行格式化，不該把五千多行的 `Game` 拖進一支 UI 模組。

## 替代方案

- **維持深路徑，只靠文件約定。** 已經試過了：DEVELOPER.md §5 寫了單向依賴，而那兩份抄本仍然長出來，還長得不一樣。
- **把整個 engine re-export 成 barrel。** pass-through，見上。
- **在 `engine/score.ts` 寫一個吃 `Game` 的純函式。** 那樣 `Game` 得把 awards／traits／honors／spouses 全開成 getter——為了收窄一個 interface 而把另一個撐寬，不划算。
- **讓伺服器改用 HTTP 之外的方式共用規則（複製一份、或抽成套件）。** 兩份規則遲早分岔，正是 ADR 0007 拒絕過的東西。
