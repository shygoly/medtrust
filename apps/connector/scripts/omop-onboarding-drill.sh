#!/bin/sh
# omop-data-source-access 8.3 —— 按接入手册在**干净环境**走一遍：
#   ① 起一个全新的 PostgreSQL（127.0.0.1:5028，演练完即删）
#   ② 灌一个「医院既有 CDM 库」（完整 v5.4 列 + 医院自加的身份证号 / 姓名列）
#   ③ 以医院 DBA 身份**原样**执行 docs/omop-cdm-onboarding.sql（手册里的那份，不另写一份）
#   ④ 连接器以手册建的账号接入：校验通过 → 跑真实查询 → 验证医院可单方面切断
#
# 用法：sh apps/connector/scripts/omop-onboarding-drill.sh      （KEEP=1 保留容器便于排查）
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
CONNECTOR_DIR=$(cd "$HERE/.." && pwd)
REPO_ROOT=$(cd "$CONNECTOR_DIR/../.." && pwd)
NAME=medtrust-omop-drill
PORT=5028

cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=admin -e POSTGRES_DB=hospital \
  -p "127.0.0.1:$PORT:5432" postgres:16-alpine >/dev/null
i=0
until docker exec "$NAME" pg_isready -U postgres -d hospital >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { echo "PostgreSQL 未就绪" >&2; exit 1; }; sleep 1
done
sleep 1

echo "── ② 医院既有 CDM 库"
docker exec -i "$NAME" psql -q -U postgres -d hospital -v ON_ERROR_STOP=1 \
  < "$CONNECTOR_DIR/src/domain/data-source/__fixtures__/hospital-cdm-v54.sql"

echo "── ③ 医院 DBA 原样执行接入手册 SQL"
docker exec -i "$NAME" psql -q -U postgres -d hospital \
  -v base_schema=omop -v view_schema=medtrust_cdm -v results_schema=medtrust_results \
  -v connector_role=medtrust_connector -v connector_password=drill-connector-pw \
  < "$REPO_ROOT/docs/omop-cdm-onboarding.sql"
# 手册 SQL 可重复执行（幂等）：再跑一遍不得报错。
docker exec -i "$NAME" psql -q -U postgres -d hospital \
  -v base_schema=omop -v view_schema=medtrust_cdm -v results_schema=medtrust_results \
  -v connector_role=medtrust_connector -v connector_password=drill-connector-pw \
  < "$REPO_ROOT/docs/omop-cdm-onboarding.sql"

echo "── ④ 连接器接入与真实查询"
cd "$CONNECTOR_DIR"
CDM_DRILL_DATABASE_URL="postgres://postgres:admin@127.0.0.1:$PORT/hospital" \
  npx jest src/domain/data-source/onboarding-drill --runInBand
