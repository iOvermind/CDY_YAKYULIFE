#!/usr/bin/env bash
#
# 建出 cdy_yakyulife:latest。
#
#     ./build-image.sh
#
# 只做建置，不啟動任何東西——部署交給外面處理。資料庫連線、session 金鑰那些
# 都是執行時的環境變數（見 server/.env.example），不烤進 image 裡。
#
# 建置的 context 是**專案根目錄**而不是 server/：同一個 image 要同時裝前端與
# 伺服器，而伺服器直接 import client 的引擎原始碼（見 ADR 0007）。

set -euo pipefail

IMAGE="${IMAGE:-cdy_yakyulife:latest}"
# 不管從哪裡呼叫都以這個腳本所在的位置為準。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "建置 ${IMAGE}（context：${ROOT}）"
docker build \
  --file "${ROOT}/server/Dockerfile" \
  --tag "${IMAGE}" \
  "${ROOT}"

echo
echo "完成：${IMAGE}"
docker image inspect "${IMAGE}" --format '大小 {{.Size}} bytes．建於 {{.Created}}'
echo
echo "執行時需要的環境變數："
echo "  DATABASE_URL    postgres://使用者:密碼@主機:5432/資料庫"
echo "  SESSION_SECRET  沒設會用隨機金鑰，重啟後所有人被登出"
echo "  PORT            預設 8080"
