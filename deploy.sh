#!/usr/bin/env bash
#
# 把整台服務架起來。clone 完直接跑，不用先讀任何文件：
#
#     ./deploy.sh
#
# 它做四件事：檢查 Docker、產生 .env（金鑰自動生成）、建好 ./data、起 compose 並
# 等到真的活著為止。**可以重複執行**——已經有的東西不會被覆蓋，所以更新流程就是
# `git pull && ./deploy.sh`。
#
# 常用的幾個：
#
#     ./deploy.sh              起服務（或更新後重啟）
#     ./deploy.sh logs         跟著看記錄
#     ./deploy.sh down         停掉（資料留著）
#     ./deploy.sh reset-db     **清空資料庫**，會先問你一次
#
# 對外怎麼接由你決定（cloudflared、nginx、直接開埠）。預設只綁 127.0.0.1，
# tunnel 跑在同一台主機時這樣就夠了。

set -euo pipefail

# 不管從哪裡呼叫都以這個腳本所在的位置為準。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
DATA_DIR="$ROOT/data"

say()  { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# ── 指令 ──────────────────────────────────────────────────
# **先驗參數再驗環境。** 反過來的話，`./deploy.sh lgos` 這種手誤會撞上 Docker
# 檢查，拿到一句跟他做錯的事完全無關的錯誤訊息。
CMD="${1:-up}"
case "$CMD" in
  up|logs|down|reset-db) ;;
  *) die "不認得的指令：$CMD。可用的是 up（預設）、logs、down、reset-db。" ;;
esac

# ── Docker ────────────────────────────────────────────────
# 分開檢查「有沒有裝」與「跑不跑得動」：daemon 沒起來是最常見的狀況，而它的原始
# 錯誤訊息是一長串 npipe/socket 路徑，看不出要做什麼。
command -v docker >/dev/null 2>&1 || die '找不到 docker。請先安裝 Docker Engine 或 Docker Desktop。'
docker compose version >/dev/null 2>&1 || die '這個 docker 沒有 compose v2。請升級 Docker，或改用 docker-compose 另外處理。'
docker info >/dev/null 2>&1 || die 'Docker 裝了但連不上 daemon。Linux 上試 `sudo systemctl start docker`，桌面版就是把 Docker Desktop 打開。'

compose() { docker compose --env-file "$ENV_FILE" "$@"; }

# up 會自己產生 .env，其餘三個是對「已經架好的服務」下指令——沒有 .env 就代表
# 還沒架過，直接說清楚，不要讓 docker 丟一句 env file not found。
if [ "$CMD" != 'up' ] && [ ! -f "$ENV_FILE" ]; then
  die "找不到 $ENV_FILE，這台還沒架過。先跑 ./deploy.sh"
fi

# ── 子指令 ────────────────────────────────────────────────
case "$CMD" in
  logs)
    exec docker compose --env-file "$ENV_FILE" logs -f "${2:-app}"
    ;;
  down)
    say '停止服務（資料留在 ./data，不會動）'
    exec compose down
    ;;
  reset-db)
    # 清庫是不可逆的，而且這台服務上可能已經有別人的帳號了。
    warn "這會清掉 $DATA_DIR/pg 裡的所有帳號、成就與生涯紀錄，無法復原。"
    read -r -p '確定要清掉嗎？輸入 yes 繼續：' answer
    [ "$answer" = 'yes' ] || die '取消了，什麼都沒動。'
    say '清空資料庫……'
    compose exec -T db psql -U yakyu -d yakyu < server/reset.sql
    say '重建結構並重啟……'
    compose restart app
    say '清完了。'
    exit 0
    ;;
  up) ;;
esac

# ── .env ──────────────────────────────────────────────────
# **已經有就不動它。** 重跑 deploy 不該換掉資料庫密碼——換了之後 Postgres 那顆
# 容器裡的舊密碼不會跟著變，服務會連不上自己的資料庫。
if [ -f "$ENV_FILE" ]; then
  say "沿用既有的 .env（要重產就先把它刪掉）"
else
  say '產生 .env……'
  # openssl 幾乎一定有；沒有的話退回 /dev/urandom，兩者都拿得到夠好的隨機。
  gen() {
    if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
    else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
  }
  cat > "$ENV_FILE" <<EOF
# 由 ./deploy.sh 產生。**不要進版控**（.gitignore 已經擋著）。
#
# 改了 POSTGRES_PASSWORD 之後舊的資料庫連不上——那顆密碼在初始化時就寫進
# ./data/pg 了，要換得先 ./deploy.sh reset-db。
POSTGRES_PASSWORD=$(gen)
SESSION_SECRET=$(gen)

# 對外的埠與綁定位址。預設只綁 127.0.0.1——tunnel 跑在同一台主機時這樣就夠，
# 而綁 0.0.0.0 等於在公網上開一個沒有 TLS 的服務。
APP_PORT=8080
BIND_ADDR=127.0.0.1

# 資料放哪。預設是 repo 底下的 ./data。
DATA_DIR=./data
EOF
  chmod 600 "$ENV_FILE"
  say '金鑰已經產生好了，不必手動填任何東西。'
fi

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# ── 資料目錄 ──────────────────────────────────────────────
# 先建好再交給 Docker：讓 Docker 自己建的話，某些平台上會建成 root 擁有的空目錄，
# Postgres 進去之後才發現寫不了。
mkdir -p "${DATA_DIR:-./data}/pg"

# ── 起服務 ────────────────────────────────────────────────
say '啟動 compose……'
compose up -d

# ── 等它真的活著 ──────────────────────────────────────────
# `up -d` 回來只代表容器建立了。第一次啟動要在容器裡裝依賴並建置前端，那要好幾
# 分鐘——這裡等的是 **HTTP 真的回話**，不是容器狀態。
#
# **以時鐘為準，不以圈數為準。** 一次探測要花多久取決於 curl 在這台機器上多快
# 放棄（實測從幾毫秒到兩秒都有），照圈數算的話「等三分鐘」可能其實是九分鐘，
# 而進度訊息也會對不上真實時間。curl 因此也綁上逾時，讓每一圈都是有界的。
PORT="${APP_PORT:-8080}"
WAIT_SECONDS="${WAIT_SECONDS:-600}"
START="$(date +%s)"
DEADLINE=$((START + WAIT_SECONDS))
NOTED="$START"

say "等服務起來（第一次要裝依賴並建置前端，可能要好幾分鐘）……"
while :; do
  if curl -fsS --connect-timeout 2 --max-time 5 -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    say "起來了：http://127.0.0.1:${PORT}/"
    say '對外請自己接 tunnel／反向代理，指向上面這個位址。'
    exit 0
  fi

  # 容器掛掉就不要再等滿逾時。
  cid="$(compose ps -q app 2>/dev/null || true)"
  if [ -n "$cid" ] && [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo unknown)" = 'false' ]; then
    warn 'app 容器停掉了，記錄如下：'
    compose logs --tail 40 app || true
    die '啟動失敗。'
  fi

  now="$(date +%s)"
  if [ "$now" -ge "$DEADLINE" ]; then
    warn "等了 ${WAIT_SECONDS} 秒還沒回應，記錄如下："
    compose logs --tail 40 app || true
    die "服務沒有在時限內起來。手動看：./deploy.sh logs（要放寬就 WAIT_SECONDS=1200 ./deploy.sh）"
  fi
  # 每半分鐘回報一次，讓人知道它還活著而不是卡死了。
  if [ $((now - NOTED)) -ge 30 ]; then
    say "還在等……（已經 $((now - START)) 秒）"
    NOTED="$now"
  fi
  sleep 2
done
