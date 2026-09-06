# ADR 0040: 資料路徑不是秘密

`compose.yaml` 原本把資料庫的位置寫成 `${DATA_DIR:-./data}/pg`，`deploy.sh` 產生的
`.env` 會填上絕對路徑，檔案裡還留了一段註解提醒「DATA_DIR 請填絕對路徑」——因為
相對路徑是相對於 compose 檔案所在的目錄，管理介面把 compose 複製走再跑就會指錯地方。

註解預告的事真的發生了，而且比註解寫的更歪一層。

Dockhand 把 `compose.yaml` 複製到自己的 stack 目錄，那份 `.env` 只有三個 key
（`POSTGRES_PASSWORD`、`SESSION_SECRET`、`TUNNEL_TOKEN`），沒有 `DATA_DIR`，於是
`./data` 這個退路生效。接著是關鍵的一步：**解析那個相對路徑的 compose 跑在 Dockhand
的容器裡**，它算出的是容器視角的 `/app/data/stacks/CDY-DOCKHAND/cdy_yakyulife/data/pg`，
然後把這個字串交給宿主機上的 daemon。daemon 照字面在**宿主機的根目錄**建了一個 `/app`。

結果是三份 `pg` 目錄：repo 底下那份停在某個下午之後就沒再動過，`~/cdy_yakyulife/pg`
是更早一次同類意外留下的空殼，而真正活著的資料躺在 `/app` ——一個沒有語意、沒有人
會去備份、`du` 進去還會被權限擋下來的地方。三份都存在，沒有任何一份是錯的，只是沒有
人知道哪一份是對的。

## 決定

**資料庫路徑寫死在 `compose.yaml` 裡的絕對路徑，不走環境變數。**

```yaml
volumes:
  - /home/overmind/docker/CDY_YAKYULIFE/data/pg:/var/lib/postgresql/data
```

分界線是：**只有秘密走環境變數。** 密碼、金鑰、權杖每台機器不同、不能進版控，它們
必須是變數。資料庫放在哪個資料夾不是秘密，是這個專案的結構事實——它該和服務名稱、
埠號、image 名稱躺在同一個地方，也就是版控裡。

`deploy.sh` 因此不再產生 `DATA_DIR`，`.env.example` 也拿掉那一格。同一件事有兩個
來源，遲早會有一邊說謊。

## 代價

這份 `compose.yaml` 從此綁在特定的路徑上。別人 clone 下來、或搬到另一台機器，第一件
事是改那一行。

這個代價是刻意付的，因為兩種失敗的形狀不一樣：

- **改那一行** 是在 clone 之後、跑起來之前發生的，會失敗得很大聲（路徑不存在，
  Postgres 起不來），而且改動 commit 得起來，下一個人看得到。
- **忘記貼一個環境變數** 是在半年後的某次「用管理介面重新部署一下」發生的，會**安靜地
  成功**：容器起來了、healthcheck 綠的、服務通的，只是所有帳號都不見了。

第二種比第一種貴得多。可攜性換掉的是一整類「安靜地指到錯地方」的故障。

## 不加 `:?` 的原因還在

`POSTGRES_PASSWORD` 這些秘密仍然不加 `${VAR:?...}` 的必填檢查——加了的話管理介面在
還沒給值之前連檔案都解析不開。那個取捨沒有變，變的只是資料路徑已經不在這個取捨的
範圍裡了：它根本不再是變數。
