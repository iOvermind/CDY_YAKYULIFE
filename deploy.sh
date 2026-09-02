#!/usr/bin/env bash
#
# 建出這台服務要跑的 image，並備好 compose 需要的 .env。
#
#     ./deploy.sh
#
# **它不啟動任何東西。** 容器的起停交給 compose 或 Dockhand 之類的管理介面
# ——build 與 run 分開，才不會「重啟一下」變成「順手換了一個版本」。
#
# 更新的流程是：
#
#     git pull && ./deploy.sh      # 建出新的 cdy_yakyulife:latest
#     然後在 Dockhand 重新建立 app 這顆容器（或 docker compose up -d app）
#
# 建置的 context 是**專案根目錄**而不是 server/：同一個 image 要同時裝前端與
# 伺服器，而伺服器直接 import client 的引擎原始碼（見 ADR 0007）。
#
# 密碼與金鑰是執行時的環境變數（見 .env.example），不烤進 image 裡。

set -euo pipefail

# 不管從哪裡呼叫都以這個腳本所在的位置為準。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-cdy_yakyulife:latest}"
ENV_FILE="$ROOT/.env"

say()  { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# ── Docker ────────────────────────────────────────────────
# 分開檢查「有沒有裝」與「跑不跑得動」：daemon 沒起來是最常見的狀況，而它的原始
# 錯誤訊息是一長串 npipe/socket 路徑，看不出要做什麼。
command -v docker >/dev/null 2>&1 || die '找不到 docker。請先安裝 Docker Engine 或 Docker Desktop。'
docker info >/dev/null 2>&1 || die 'Docker 裝了但連不上 daemon。Linux 上試 `sudo systemctl start docker`，桌面版就是把 Docker Desktop 打開。'

# ── .env ──────────────────────────────────────────────────
# **已經有就不動它。** 重跑 deploy 不該換掉資料庫密碼——換了之後 Postgres 那顆
# 容器裡的舊密碼不會跟著變，服務會連不上自己的資料庫。
if [ -f "$ENV_FILE" ]; then
  say '沿用既有的 .env（要重產就先把它刪掉）'
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
# ./data/pg 了，要換得先清掉那個目錄重來。
POSTGRES_PASSWORD=$(gen)
SESSION_SECRET=$(gen)

# **這一格要自己填。** Cloudflare Zero Trust → Networks → Tunnels 建立通道後
# 拿到的權杖。沒填的話 cloudflared 起得來但連不上通道，對外就是不通。
TUNNEL_TOKEN=

# 本機驗證用的埠與綁定位址。預設只綁 127.0.0.1——對外走 tunnel，而綁 0.0.0.0
# 等於在公網上開一個沒有 TLS 的服務。
APP_PORT=8080
BIND_ADDR=127.0.0.1

# 資料放哪。預設是 repo 底下的 ./data。
DATA_DIR=./data
EOF
  chmod 600 "$ENV_FILE"
  warn '金鑰已經產生好了，但 TUNNEL_TOKEN 要自己去 Cloudflare 拿並填進 .env。'
fi

# 資料目錄先建好再交給 Docker：讓 Docker 自己建的話，某些平台上會建成 root
# 擁有的空目錄，Postgres 進去之後才發現寫不了。
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
mkdir -p "${DATA_DIR:-./data}/pg"

# ── 建 image ──────────────────────────────────────────────
say "建置 ${IMAGE}（context：${ROOT}）……"
docker build \
  --file "${ROOT}/server/Dockerfile" \
  --tag "${IMAGE}" \
  "${ROOT}"

say "完成：$(docker image inspect "${IMAGE}" --format '{{.Id}} 大小 {{.Size}} bytes')"
echo
say '接下來（擇一）：'
echo '  管理介面（Dockhand）：把這個 compose 專案重新部署一次，讓 app 換上新 image'
echo '  指令列：              docker compose up -d'
echo
say "起來之後在本機驗證：curl http://127.0.0.1:${APP_PORT:-8080}/"
