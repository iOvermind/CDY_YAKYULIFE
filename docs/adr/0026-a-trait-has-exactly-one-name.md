# ADR 0026: 一個特性只有一個名字

## Status

Accepted

## Context

`docs/problems.txt` #20 說 `client/src/data` 底下帶 `_new` 的檔案是待納入的新資料。
這個前提已經不成立：五個檔案在 commit `b406bca` 就併進主檔並刪除了。逐葉核對過
（abilities 241、events 39、flavor 38、love 58、traits 31 個葉節點），沒有任何內容
遺失——`romance_names` 被拆進 `love.names` 的 school／pro 兩池，三處 `abilities`
差異是 ADR 0008 自己改的。

但「併進檔案」不等於「接進遊戲」。核對**有沒有人讀**的時候掉出四塊死資料，其中
兩塊藏著看得見的損害：

1. `traits.dynamic_names` 沒有任何消費者。`legend` / `mrteam` / `rainbow` 三個特性
   的 `name` 是 null，名字要靠 pattern 組出來。而特性面板有一行
   `.filter((t) => t.name !== null)`——**拿得到卻永遠顯示不出來**。`legend` 是真的
   發得出來的：結算時首輪入選名人堂就給，玩家看得到卡片，然後它在面板上不存在。

2. `love.childhood_sweetheart.trait` 是 `'sweetheart'`，而 `traits.json` 裡**沒有這個
   id**。面板查不到定義就整個跳過，於是「青梅竹馬」也是同一種下場。四十局的取樣裡
   它出現十三次——不是罕見路徑。

3. `abilities.pitch_families` 有四大球系的中文名與球種清單，但 `PITCH_FAMILIES` 手寫
   在 `index.ts:84`。與 ADR 0023 的 `TWO_WAY_REFERENCE_LEVEL` 同一種形狀：資料檔與
   常數各活各的，沒有人比對。

4. `abilities.ability_group_names`（體力／投手／野手）已經被 `display_groups.names`
   取代，是一份會過期的重複標籤表。

第 1、2 兩項的根源是同一件事：**名稱同時活在兩個地方**。`#unlockTrait()` 自己帶一份
字串給卡片，`traits.json` 另有一份給面板，兩份沒有人比對過。配色（`tone`）也是。

（`flavor.placeholders` 也沒有消費者，但那是給讀檔的人看的圖例——`{n}` 與
`{first_hit}` 兩個佔位符本身都有替換。它不是死資料。）

## Decision

**`traits.json` 是特性名稱與配色的唯一來源。**

`#unlockTrait(id, text, fill?)` 不再收 name 與 tone，兩者一律向資料檔要。三個
`dynamic_name` 的特性由呼叫端提供 `fill`——聯盟名、球隊代表詞這種東西寫不進資料檔，
但**只有它們可以缺名字**，缺 `fill` 就丟例外，不生出半截的名字。

解析出來的名字存進 `#traitNames` 並隨狀態送到介面。取得的當下是什麼就永遠是什麼：
後來轉隊了，「猛瑪先生」還是猛瑪先生。

其餘四項：

- `sweetheart` 補進 `traits.json`，`love.json` 那份重複的 `name` 刪掉。
- `mrteam` 與 `rainbow` 補上觸發點。門檻從註解變成真資料（`threshold` / `thresholds`），
  判定在球季結束當下而不是結算——「效力滿十五年」是那一年發生的事，卡片就該落在那
  一年。為此新增 `#teamYears`：`#orgYears` 記的是體系，這兩個特性要的是**球隊**。
  二軍的年份照算，在同一個組織熬十五年就是熬了十五年。
- `PITCH_FAMILIES` 改成 `dataKeys(abilities.pitch_families)`。球種名先不露出。
- `ability_group_names` 刪除。

護欄盯著這一類錯誤，而不只是這幾筆：走訪所有設定檔蒐集 `trait` 欄位，每個被指名
發放的 id 都必須在 `traits.json` 且排進 `categories`；沒有名字的特性必須恰好等於
`dynamic_names` 的鍵。

## Consequences

`sweetheart`、`legend`、`mrteam`、`rainbow` 四個特性從「發得出來但看不見」變成看得見，
其中後兩個是本來就完全沒有觸發點的。特性面板不再有靜默跳過的分支——查不到定義現在
是護欄的紅燈，不是使用者的困惑。

`mrteam` 在自動代理的四十局取樣裡觸發了二十八次。規則照 legacy 實作無誤（同一支球隊
十五年），偏高是因為自動代理從不接受轉會。這是平衡問題不是規則問題，記進 ROADMAP 的
校準批次，不在這裡動。

`_new` 檔案這條線索到此結束：資料早就進來了，真正沒進來的是讀它的那段程式。
