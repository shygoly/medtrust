#!/usr/bin/env bash
# web.szchada.top 恢复：先诊断，按层归因；必要时只重启 TLS 层 / web 容器。
#
#   ./scripts/recover-web.sh            # 只诊断，不改任何东西
#   ./scripts/recover-web.sh --fix      # 诊断 + 按层修复（web 容器仅在 5020 不通时重启；TLS 层重启 szchada-web）
#
# 刻意不做的事：
#   · 不 restart / recreate api、postgres、connector —— 重建 api 会把合约 / 任务 / 结算打回种子状态。
#   · 不 down compose、不删容器、不动数据卷、不自动重建镜像。
#   · restart szchada-web 会短暂中断所有 *.szchada.top 的 TLS（2—3 秒），脚本会先提示。
#
# 拓扑：
#   浏览器 → Cloudflare → origin.szchada.top:443 → szchada-web(TLS nginx) → 172.17.0.1:80(medtrust-nginx) → medtrust-web:5020
set -uo pipefail

HOST="${HOST:-ali29}"
DOMAIN="${DOMAIN:-web.szchada.top}"
FIX=0
case "${1:-}" in
  --fix) FIX=1 ;;
  -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
  "") ;;
  *) echo "未知参数：$1"; exit 2 ;;
esac

hr() { printf '%s\n' "────────────────────────────────────────────────────────────"; }
edge_ip() { dig +short "$DOMAIN" 2>/dev/null | grep -E '^[0-9.]+$' | head -1; }

# ── ① 分层探针：DNS / 边缘 / 源站 80 / 源站 443 ──────────────
hr; echo "① 分层探针"
EDGE="$(edge_ip)"
echo "  DNS  $DOMAIN → ${EDGE:-（无解析）}"

CODE_EDGE=000
for i in 1 2 3; do   # 本机出站偶发抖动：探三次，取最后一次结果
  c="$(curl -sS -k -m 20 ${EDGE:+--resolve "$DOMAIN:443:$EDGE"} -o /dev/null -w '%{http_code}' "https://$DOMAIN/" 2>/dev/null)"
  [ -n "$c" ] || c=000
  CODE_EDGE="$c"
  [ "$c" != "000" ] && break
  sleep 2
done
echo "  边缘  https://$DOMAIN/ → HTTP $CODE_EDGE"

ORIGIN="$(dig +short "${ORIGIN_DOMAIN:-origin.szchada.top}" 2>/dev/null | grep -E '^[0-9.]+$' | head -1)"
echo "  源站  ${ORIGIN_DOMAIN:-origin.szchada.top} → ${ORIGIN:-（无解析）}"
if [ -n "$ORIGIN" ]; then
  C80="$(curl -sS -m 15 --resolve "$DOMAIN:80:$ORIGIN" -o /dev/null -w '%{http_code}' "http://$DOMAIN/" 2>/dev/null)"; [ -n "${C80:-}" ] || C80=000
  C443="$(curl -sS -k -m 20 --resolve "$DOMAIN:443:$ORIGIN" -o /dev/null -w '%{http_code}' "https://$DOMAIN/" 2>/dev/null)"; [ -n "${C443:-}" ] || C443=000
else
  C80=000; C443=000
fi
echo "  源站  http://…:80 → HTTP ${C80}      https://…:443 → HTTP ${C443}"

echo
if [ "${C80}" = "200" ] && [ "${C443}" != "200" ]; then
  echo "  → 源站 80 正常、443 异常：问题在 TLS 层 szchada-web（CF 表现为 520）"
  echo "     1) grep -n \"server_name web.szchada.top\" /opt/sites/szchada.com/nginx/site.conf"
  echo "     2) 没了按 DEPLOY.md §4.6.1 补回去（本脚本第 ④ 节有现成命令）"
  echo "     3) 配置在但行为不变 → docker restart szchada-web（bind mount 按 inode 读）"
elif [ "${C80}" = "200" ] && [ "${C443}" = "200" ]; then
  echo "  ✓ 源站 80 / 443 都通；浏览器仍打不开则是边缘或本地问题（边缘返回 ${CODE_EDGE}）"
elif [ "${C80}" = "000" ]; then
  echo "  → 源站 80 也不通：看第 ② 步 uptime / docker / 磁盘；整机没起来先在控制台开机"
else
  echo "  → 源站 80 返回 ${C80}：应用层异常，看第 ② 步容器日志与 5020 自检"
fi
[ "${CODE_EDGE}" = "000" ] && echo "  （边缘探针 3 次均失败，多半是本机出站受限，不代表站点状态）"

# ── ② 源站：主机 / 容器 / 端口 / nginx 配置 ─────────────────
hr; echo "② ${HOST}：主机与容器（只读）"
ssh -o ConnectTimeout=8 -o BatchMode=yes "$HOST" 'bash -s' <<'EOS'
set -u
echo "  时间 $(date '+%F %T')   负载$(uptime | sed 's/.*load average//')"
echo "  磁盘 $(df -h / | awk 'NR==2{print $4" 可用，"$5" 已用"}')   内存 $(free -m | awk '/^Mem:/{print $3"/"$2"MB，可用 "$7"MB"}')"
echo "  docker $(systemctl is-active docker 2>/dev/null)"
echo
docker ps -a --format '   {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | grep -E 'web|nginx|api|chat|postgres' || echo "   （列不出来）"
echo
WEB="$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E '(^|-)web$' | grep -v test | head -1)"
if [ -n "${WEB:-}" ]; then
  echo "  ${WEB}: 重启 $(docker inspect -f '{{.RestartCount}}' "$WEB" 2>/dev/null) 次，退出码 $(docker inspect -f '{{.State.ExitCode}}' "$WEB" 2>/dev/null)"
  echo -n "  容器内 5020："; docker exec "$WEB" sh -c 'wget -qO- -T 4 http://127.0.0.1:5020/ >/dev/null 2>&1 && echo OK' 2>/dev/null || echo FAIL
fi
echo
for N in medtrust-nginx szchada-web; do
  if docker ps --format '{{.Names}}' | grep -qx "$N"; then
    echo -n "  ${N} nginx -t："; docker exec "$N" nginx -t 2>&1 | tr '\n' ' ' | sed 's/  */ /g'; echo
    echo -n "  ${N} 最近日志："; docker logs --tail 6 "$N" 2>&1 | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-240; echo
  else
    echo "  ${N}：未运行"
  fi
done
echo -n "  源站回环 172.17.0.1:80（Host: web.szchada.top）："
curl -s -o /dev/null -m 8 -w 'HTTP %{http_code}\n' -H 'Host: web.szchada.top' http://172.17.0.1/ 2>/dev/null || echo 连不上
EOS

# ── ③ 按层修复 ─────────────────────────────────────────────
if [ "$FIX" = "1" ]; then
  hr; echo "③ 修复（web 容器只在 5020 不通时重启；TLS 层 szchada-web 会重启，约 2—3 秒中断所有 *.szchada.top）"
  ssh -o ConnectTimeout=8 "$HOST" 'bash -s' <<'EOS'
set -u
WEB="$(docker ps -a --format '{{.Names}}' | grep -E '(^|-)web$' | grep -v test | head -1)"
up_web=0
[ -n "${WEB:-}" ] && docker exec "$WEB" sh -c 'wget -qO- -T 4 http://127.0.0.1:5020/ >/dev/null 2>&1' && up_web=1

if [ "$up_web" = "0" ] && [ -n "${WEB:-}" ]; then
  echo "  · ${WEB} 的 5020 不通 → docker restart ${WEB}"
  docker restart "$WEB" >/dev/null
  for i in $(seq 1 10); do
    sleep 2
    docker exec "$WEB" sh -c 'wget -qO- -T 3 http://127.0.0.1:5020/ >/dev/null 2>&1' && { echo "    ✓ 5020 已应答（${i}0 秒内）"; break; }
    [ "$i" = 10 ] && echo "    ！20 秒仍未应答，看 docker logs ${WEB}"
  done
else
  echo "  · web 容器 5020 正常，不动它"
fi

if docker ps --format '{{.Names}}' | grep -qx szchada-web; then
  echo "  · TLS 层配置检查："
  docker exec szchada-web nginx -t 2>&1 | sed 's/^/    /'
  echo "  · docker restart szchada-web（让 bind mount 的新文件生效）"
  docker restart szchada-web >/dev/null
  sleep 3
  docker exec szchada-web nginx -t 2>&1 | sed 's/^/    /'
else
  echo "  ！szchada-web 未运行：docker start szchada-web 后复检 443"
  docker start szchada-web >/dev/null 2>&1 || true
fi

docker ps --format '{{.Names}}' | grep -qx medtrust-nginx && { echo "  · reload medtrust-nginx"; docker exec medtrust-nginx nginx -s reload 2>&1 | sed 's/^/    /'; }
EOS

  echo; echo "  复检："
  E="$(edge_ip)"
  R1="$(curl -sS -k -m 20 ${E:+--resolve "$DOMAIN:443:$E"} -o /dev/null -w '%{http_code}' "https://$DOMAIN/" 2>/dev/null)"; [ -n "$R1" ] || R1=000
  echo "    边缘 https://$DOMAIN/ → HTTP $R1"
  if [ -n "$ORIGIN" ]; then
    R2="$(curl -sS -k -m 20 --resolve "$DOMAIN:443:$ORIGIN" -o /dev/null -w '%{http_code}' "https://$DOMAIN/" 2>/dev/null)"; [ -n "$R2" ] || R2=000
    echo "    源站 https://…:443 → HTTP $R2"
  fi
  [ "$R1" = "200" ] && echo "    ✓ 已恢复" || echo "    仍未恢复：看 szchada-web 日志与证书文件（/etc/nginx/certs/fullchain.pem）"
fi

# ── ④ 与 DEPLOY.md §4.6.1 同款的 443 vhost 排查 ────────────
hr; cat <<'NOTE'
④ 这个症状与 DEPLOY.md §4.6.1 记录的一致：CF 520 + 源站 80 直测 200
   → 多半是 szchada-web 里「web.szchada.top 的 443 server 块」又没了，
     请求落到 default_server 的 return 444（空响应），Cloudflare 判 520。

   在 ali29 上按顺序执行（都是可粘贴的）：

   1) 443 vhost 还在不在
      grep -n "server_name web.szchada.top" /opt/sites/szchada.com/nginx/site.conf

   2) 不在了就补回去（先备份，再原地追加；原地写才保得住 bind mount 的 inode）
      cp -p /opt/sites/szchada.com/nginx/site.conf \
            /opt/sites/szchada.com/nginx/site.conf.bak-$(date +%Y%m%d-%H%M)
      cat >> /opt/sites/szchada.com/nginx/site.conf <<'NGINX'

      map $http_x_service $medtrust_service { default $http_x_service; "" web; }
      map $http_upgrade $medtrust_conn { default upgrade; "" ""; }

      server {
          listen 443 ssl;
          server_name web.szchada.top origin.szchada.top;
          ssl_certificate     /etc/nginx/certs/fullchain.pem;
          ssl_certificate_key /etc/nginx/certs/privkey.pem;
          location / {
              proxy_pass http://172.17.0.1:80;         # medtrust-nginx 的 web vhost
              proxy_http_version 1.1;
              proxy_set_header Host web.szchada.top;
              proxy_set_header X-Service $medtrust_service;
              proxy_set_header Upgrade $http_upgrade;
              proxy_set_header Connection $medtrust_conn;
              proxy_read_timeout 3600s;
          }
      }
      NGINX

   3) 校验并生效
      docker exec szchada-web nginx -t && docker exec szchada-web nginx -s reload
      # 若 reload 后行为不变（容器仍读旧 inode）：docker restart szchada-web

   4) 复检（必须同时满足两条，这是 §4.6.1 的发布自检）
      curl -sI https://web.szchada.top/ | head -1                     # 期望 200
      curl -s  https://web.szchada.top/ | wc -c                      # 期望 > 20KB，且不等 30s

   5) 只有 web 镜像本身反复崩（日志是代码/依赖错误）才需要重建，且只重建 web：
      cd /opt/medtrust
      docker build -f fly-services/web/Dockerfile \
        --build-arg NEXT_PUBLIC_API_URL=/api/v1 \
        --build-arg NEXT_PUBLIC_WS_URL= \
        --build-arg NEXT_PUBLIC_CHAT_AGENT_URL=/chat-agent/api/v1 \
        -t medtrust-web:local .
      docker compose up -d --no-deps web

   注意：重建 api 会把合约、任务、结算打回种子状态（pitch/演示脚本-20260919）。
NOTE
