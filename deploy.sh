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
# **CHANGELOG.md 的 [Unreleased] 有東西，就順便發一版**（見 DEVELOPER.md §7）：
#
#     1. 工作目錄有沒 commit 的改動 → 列出來問一次，要出貨就先 commit，不要就停
#     2. client 與 server 的測試、型別檢查全過才往下
#     3. 依 [Unreleased] 的類別算新版號（VERSION_RULES §4.1，client/scripts/release.mjs）
#     4. 改 client/package.json 的版號、把 [Unreleased] 轉成版本區塊
#     5. 建 image——**成功才 commit 與打 tag v<版號>**，失敗就把那幾個檔案還原
#     6. 推到 GitHub 之前問一次（預設不推）
#
# [Unreleased] 是空的就只建 image，不動版號。
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
EOF
  chmod 600 "$ENV_FILE"
  warn '金鑰已經產生好了，但 TUNNEL_TOKEN 要自己去 Cloudflare 拿並填進 .env。'
fi

# ── 資料目錄 ──────────────────────────────────────────────
# 資料庫的路徑寫死在 compose.yaml 裡（見 ADR 0040），這裡不需要也不該再產生一個
# DATA_DIR 環境變數——同一件事有兩個來源，遲早會有一邊說謊。
#
# 目錄先建好再交給 Docker：讓 Docker 自己建的話，某些平台上會建成 root 擁有的
# 空目錄，Postgres 進去之後才發現寫不了。
mkdir -p "$ROOT/data/pg"

# ── 發版前：工作目錄 ──────────────────────────────────────
# image 是用工作目錄建的。有沒 commit 的改動卻照樣打 tag 的話，tag 指的 commit 就
# 不是實際出貨的東西——所以先決定這些改動要不要一起出貨。
command -v git >/dev/null 2>&1 || die '找不到 git。'
interactive=false
[ -t 0 ] && interactive=true

if [ -n "$(git status --porcelain)" ]; then
  warn '工作目錄有還沒 commit 的改動：'
  git status --short
  $interactive || die '沒有互動終端機，無法確認要不要出貨這些改動。先 commit 或還原再部署。'
  read -r -p '這些改動要一起出貨嗎？先 commit 它們 [y/N] ' answer
  case "$answer" in
    y|Y)
      read -r -p 'commit 訊息：' message
      [ -n "$message" ] || die 'commit 訊息不能是空的。'
      git add -A
      git commit -q -m "$message"
      say "已 commit：$(git log -1 --format='%h %s')"
      ;;
    *) die '沒有出貨。改動留在工作目錄裡。' ;;
  esac
fi

# ── 發版前：測試 ──────────────────────────────────────────
# 發佈門檻要求「建置成功、基本功能實測通過」（RELEASE_RULES §4.1）。壞掉的規則
# 不該拿到一個正式版號。
command -v node >/dev/null 2>&1 || die '找不到 node，跑不了測試。'
say '跑測試與型別檢查（client、server）……'
run_quiet() {
  local label="$1"; shift
  local log; log="$(mktemp)"
  if ! "$@" >"$log" 2>&1; then
    tail -40 "$log" >&2
    rm -f "$log"
    die "$label 沒過，不發版也不建 image。"
  fi
  rm -f "$log"
}
run_quiet 'client 測試' npm --prefix client test
run_quiet 'client 型別檢查' npm --prefix client run typecheck
run_quiet 'server 測試' npm --prefix server test
run_quiet 'server 型別檢查' npm --prefix server run typecheck
# pretest 會重產 changelog.json／wiki.json；它們應該跟 commit 裡的一模一樣。
[ -z "$(git status --porcelain)" ] || die '跑完測試之後工作目錄變了（產生的資料檔跟 commit 的不一致）。先把它們 commit 了再部署。'

# ── 發版：算版號 ──────────────────────────────────────────
plan="$(node client/scripts/release.mjs plan)"
release=''
if [ "$plan" = 'none' ]; then
  say 'CHANGELOG 的 [Unreleased] 是空的：不發版，只建 image。'
else
  bump="${plan%% *}"
  release="${plan##* }"
  current="$(node -p "require('./client/package.json').version")"
  git rev-parse -q --verify "refs/tags/v${release}" >/dev/null && die "tag v${release} 已經存在——版號不能重複使用（VERSION_RULES §4.4）。"
  say "發版：${current} → ${release}（${bump}）"
  RELEASE_FILES=(client/package.json client/package-lock.json CHANGELOG.md client/src/data/changelog.json)
  # 建置失敗、或中途按了 Ctrl-C，都把改過的檔案還原：版號沒有真的發出去，就不該
  # 留在工作目錄裡等著下一次被當成已經發過。
  rollback() { git checkout -- "${RELEASE_FILES[@]}"; warn "已還原版號與 CHANGELOG（v${release} 沒有發出去）。"; }
  trap 'rollback; exit 1' INT TERM
  npm --prefix client version "$release" --no-git-tag-version >/dev/null
  node client/scripts/release.mjs apply "$release" "$(date +%F)"
  node client/scripts/changelog.mjs >/dev/null
fi

# ── 建 image ──────────────────────────────────────────────
say "建置 ${IMAGE}（context：${ROOT}）……"
if ! docker build \
  --file "${ROOT}/server/Dockerfile" \
  --tag "${IMAGE}" \
  "${ROOT}"; then
  [ -n "$release" ] && rollback
  die 'image 沒有建成。'
fi

# ── 發版：commit、tag、推送 ────────────────────────────────
if [ -n "$release" ]; then
  trap - INT TERM
  git add "${RELEASE_FILES[@]}"
  git commit -q -m "release: v${release}"
  git tag -a "v${release}" -m "Release v${release}"
  say "已發版 v${release}：$(git log -1 --format='%h')，tag v${release}"
  # 推送是對外的動作，問一次、預設不推。沒有互動終端機就不推。
  if $interactive; then
    read -r -p "推到 GitHub（目前分支與 tag v${release}）？[y/N] " answer
    case "$answer" in
      y|Y) git push origin HEAD && git push origin "v${release}" && say '已推送。' ;;
      *) say "沒有推送。之後要推：git push origin HEAD && git push origin v${release}" ;;
    esac
  else
    say "沒有互動終端機，沒有推送。之後要推：git push origin HEAD && git push origin v${release}"
  fi
fi

say "完成：$(docker image inspect "${IMAGE}" --format '{{.Id}} 大小 {{.Size}} bytes')"
echo
say '接下來（擇一）：'
echo '  管理介面（Dockhand）：把這個 compose 專案重新部署一次，讓 app 換上新 image'
echo '  指令列：              docker compose up -d'
echo
say "起來之後在本機驗證：curl http://127.0.0.1:${APP_PORT:-8080}/"
