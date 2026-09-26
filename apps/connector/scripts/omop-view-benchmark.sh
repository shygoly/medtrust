#!/bin/sh
# omop-data-source-access 8.4 —— 视图层（含行级过滤）对索引使用的影响，合成千万行级基准。
# 起一个临时 PostgreSQL（127.0.0.1:5029），灌 100 万人 / 1000 万用药 / 1000 万诊断，
# 对比底表 / 只裁列视图 / 裁列 + 行级过滤视图三种读法。结束即删容器（KEEP=1 保留）。
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
NAME=medtrust-omop-bench
PORT=5029
cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=admin -e POSTGRES_DB=bench \
  -p "127.0.0.1:$PORT:5432" --shm-size=1g postgres:16-alpine \
  -c shared_buffers=1GB -c work_mem=64MB -c max_parallel_workers_per_gather=2 >/dev/null
i=0
until docker exec "$NAME" pg_isready -U postgres -d bench >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { echo "PostgreSQL 未就绪" >&2; exit 1; }; sleep 1
done
sleep 1

echo "── 灌合成数据（约数分钟）"
start=$(date +%s)
docker exec -i "$NAME" psql -q -U postgres -d bench < "$HERE/omop-view-benchmark.sql"
echo "   灌数用时 $(( $(date +%s) - start )) 秒"
docker exec "$NAME" psql -At -U postgres -d bench -c \
  "SELECT 'drug_exposure', count(*) FROM omop.drug_exposure UNION ALL SELECT 'condition_occurrence', count(*) FROM omop.condition_occurrence"

echo "── 三种读法对比（每条查询 5 次取中位，热缓存）"
BENCH_DATABASE_URL="postgres://postgres:admin@127.0.0.1:$PORT/bench" node "$HERE/omop-view-benchmark.mjs"
