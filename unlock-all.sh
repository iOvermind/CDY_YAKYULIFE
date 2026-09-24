#!/usr/bin/env bash
#
# 把一個帳號的成就開滿，AP 跟著進帳。管理用，**不是遊戲功能**。
#
#     ./unlock-all.sh
#
# 邊打邊列出開頭符合的帳號（不分大小寫），選定之後印出會新增幾項、多少 AP，
# 輸入 yes 才寫。第 N 段人生不開；累積成績開到 AP 封頂那一階；已經有的階只補差額。
# 可以重跑：開滿的帳號再跑一次什麼都不會加。
#
# 名單由引擎算（client/src/engine/unlockAll.ts），本體在 server/scripts/unlock-all.ts。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

die() { printf '\033[31m[unlock-all]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die '找不到 docker。'
command -v node >/dev/null 2>&1 || die '找不到 node。'
docker compose ps --status running --services 2>/dev/null | grep -qx db \
  || die 'db 沒有在跑。先把這個 compose 專案起起來（docker compose up -d db，或在管理介面上啟動）。'

exec node --experimental-strip-types --no-warnings server/scripts/unlock-all.ts
