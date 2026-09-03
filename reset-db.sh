#!/usr/bin/env bash
#
# 清空資料庫並重建結構。
#
#     ./reset-db.sh          問過一次才動手
#     ./reset-db.sh -y       不問（給腳本或自動化用）
#
# **這會清掉這台服務上所有人的帳號、成就、AP 與生涯紀錄，不可復原。** 動手之前
# 會先把現有的筆數印出來，讓你確認自己清的是哪一台。
#
# 清庫不是部署腳本的子指令，所以它自己一個檔案：`./deploy.sh` 只建 image，容器
# 的起停交給管理介面，而這個是「把資料倒掉」——三件事互不相干，混在一個入口裡
# 只會讓人在想按 A 的時候按到 B。

set -euo pipefail

# 不管從哪裡呼叫都以這個腳本所在的位置為準。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

say()  { printf '\033[36m[reset-db]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[reset-db]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[reset-db]\033[0m %s\n' "$*" >&2; exit 1; }

ASSUME_YES=false
case "${1:-}" in
  '')      ;;
  -y|--yes) ASSUME_YES=true ;;
  *)       die "不認得的參數：$1。可用的只有 -y（不問直接清）。" ;;
esac

command -v docker >/dev/null 2>&1 || die '找不到 docker。'
docker compose version >/dev/null 2>&1 || die '這個 docker 沒有 compose v2。'

# db 沒跑就沒得清。分開講清楚——`docker compose exec` 對著沒起來的服務丟的錯誤
# 訊息看不出要做什麼。
docker compose ps --status running --services 2>/dev/null | grep -qx db \
  || die 'db 沒有在跑。先把這個 compose 專案起起來（docker compose up -d db，或在管理介面上啟動）。'

# `exec -T` 會把這個腳本的 stdin 整個交給容器裡的 psql。**查詢一律把 stdin 關掉**
# ——不然 `echo no | ./reset-db.sh` 的那個 "no" 會先被 psql 吃掉，後面的 read 讀到
# EOF，腳本在 set -e 底下靜悄悄地結束，看起來像什麼都沒發生。
psql()  { docker compose exec -T db psql -U yakyu -d yakyu "$@" < /dev/null; }
# 餵 .sql 檔進去的那一種，stdin 就是檔案本身。
psqlf() { docker compose exec -T db psql -U yakyu -d yakyu; }

# ── 先報現況 ──────────────────────────────────────────────
# 讓人看到自己要清掉的是什麼。表還不存在時（沒起過服務、或已經清過）就跳過，
# 那不是錯誤。
say '目前的資料：'
if ! psql -c "select
    (select count(*) from users)        as 帳號,
    (select count(*) from careers)      as 生涯,
    (select count(*) from achievements) as 成就,
    (select count(*) from talents)      as 天賦;" 2>/dev/null; then
  warn '（讀不到那幾張表，可能還沒建立過或已經清空——照樣可以往下跑。）'
fi

# ── 問一次 ────────────────────────────────────────────────
if [ "$ASSUME_YES" != true ]; then
  warn '這會清掉上面所有的帳號、成就、AP 與生涯紀錄，無法復原。'
  # 讀不到輸入（管線、cron、CI）要講清楚是怎麼回事。不講的話它只會安靜地結束，
  # 而「沒有清成功」與「清完了」在畫面上會長得一模一樣。
  if ! read -r -p '確定要清掉嗎？輸入 yes 繼續：' answer; then
    die '讀不到輸入——非互動環境請改用 ./reset-db.sh -y。什麼都沒動。'
  fi
  [ "$answer" = 'yes' ] || die '取消了，什麼都沒動。'
fi

# ── 清 ────────────────────────────────────────────────────
# 兩步都要：reset.sql 只 DROP，不建。少了第二步，服務要等下一次重啟跑
# schema.sql 才活得過來——而那中間任何一個請求都會踩到不存在的表。
say '清空資料表……'
psqlf < server/reset.sql > /dev/null
say '重建結構……'
psqlf < server/schema.sql > /dev/null

say '清完了。現在的資料：'
psql -c "select
    (select count(*) from users)        as 帳號,
    (select count(*) from careers)      as 生涯,
    (select count(*) from achievements) as 成就,
    (select count(*) from talents)      as 天賦;"
