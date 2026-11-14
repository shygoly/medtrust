#!/usr/bin/env bash
# 把材料（PPT / PDF）发布到 ali29 —— web.szchada.top 的源站。
#
#   ./scripts/deploy-deck.sh <文件>                   # 只上传到服务器私有目录 /root/materials
#   ./scripts/deploy-deck.sh <文件> --web             # 同时放进 web 容器，公网可下载
#   ./scripts/deploy-deck.sh <文件> --web --web-path /downloads/2026-11
#
# 说明：
#   · 需要本机能 `ssh ali29`（见 ~/.ssh/config）。
#   · --web 是「运行时投放」：直接写进 web 容器的 /repo/apps/web/public，
#     立即生效，但容器重建（重新部署镜像）后会消失。
#   · 要长期保留，把文件同时放进仓库 apps/web/public/downloads/ 再重建 web 镜像。
set -euo pipefail

HOST="${DECK_HOST:-ali29}"
FILE="${1:-}"
[ -n "$FILE" ] || { echo "用法：$0 <文件> [--web] [--web-path /downloads]"; exit 2; }
shift || true

WEB=0
WEB_PATH="/downloads"
while [ $# -gt 0 ]; do
  case "$1" in
    --web) WEB=1; shift ;;
    --web-path) WEB_PATH="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "未知参数：$1"; exit 2 ;;
  esac
done

[ -f "$FILE" ] || { echo "找不到文件：$FILE"; exit 2; }
NAME="$(basename "$FILE")"
SIZE="$(du -h "$FILE" | cut -f1)"

echo "→ 上传 ${NAME}（${SIZE}）到 ${HOST}:/root/materials/"
ssh "$HOST" 'mkdir -p /root/materials'
scp -q "$FILE" "${HOST}:/root/materials/${NAME}"
ssh "$HOST" "ls -lh /root/materials/$(printf '%q' "$NAME") | awk '{print \"  ✓ 服务器：\", \$5, \$9}'"

if [ "$WEB" = "1" ]; then
  CONTAINER="$(ssh "$HOST" "docker ps --format '{{.Names}}' | grep -E 'web' | grep -v test | head -1")"
  [ -n "$CONTAINER" ] || { echo "！没找到生产 web 容器（docker ps | grep web）"; exit 1; }
  echo "→ 投放到容器 ${CONTAINER}:/repo/apps/web/public${WEB_PATH}/"
  ssh "$HOST" "docker exec ${CONTAINER} mkdir -p /repo/apps/web/public${WEB_PATH}"
  ssh "$HOST" "docker cp /root/materials/${NAME} ${CONTAINER}:/repo/apps/web/public${WEB_PATH}/${NAME}"
  ssh "$HOST" "docker exec ${CONTAINER} chmod 644 /repo/apps/web/public${WEB_PATH}/${NAME}"
  ssh "$HOST" "docker exec ${CONTAINER} ls -l /repo/apps/web/public${WEB_PATH}/${NAME}"
  echo
  echo "✓ 公网地址：https://web.szchada.top${WEB_PATH}/${NAME}"
  echo "  自检：curl -sI 'https://web.szchada.top${WEB_PATH}/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$NAME")' | head -1"
  echo "  注意：容器重建后该文件会消失；长期保留请同时放进 apps/web/public${WEB_PATH}/ 再重建镜像。"
fi
