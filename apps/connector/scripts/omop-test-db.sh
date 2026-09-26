#!/bin/sh
# 起一个本地 PostgreSQL 并装入测试用 OMOP CDM 夹具（omop-data-source-access）。
# 端口 5025（仓库约定 5022–5029 留给附加服务）。
#
#   sh apps/connector/scripts/omop-test-db.sh          # 起库并装夹具
#   export CDM_TEST_DATABASE_URL=postgres://postgres:admin@127.0.0.1:5025/omop
#   (cd apps/connector && npx jest src/domain/data-source)
#   sh apps/connector/scripts/omop-test-db.sh down     # 删库
set -eu
NAME=medtrust-omop-test
PORT=${OMOP_TEST_PORT:-5025}
HERE=$(cd "$(dirname "$0")" && pwd)
FIXTURE="$HERE/../src/domain/data-source/__fixtures__/omop-cdm-fixture.sql"

if [ "${1:-up}" = "down" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  echo "已删除 $NAME"
  exit 0
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p "127.0.0.1:${PORT}:5432" \
  -e POSTGRES_PASSWORD=admin -e POSTGRES_DB=omop postgres:16-alpine >/dev/null
i=0
until docker exec "$NAME" pg_isready -U postgres -d omop >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -gt 60 ] && { echo "PostgreSQL 未就绪"; exit 1; }; sleep 1
done
# pg_isready 先于 initdb 结束返回，再等一拍确保初始化脚本跑完。
sleep 2
docker cp "$FIXTURE" "$NAME":/tmp/fixture.sql
docker exec "$NAME" psql -v ON_ERROR_STOP=1 -U postgres -d omop -q -f /tmp/fixture.sql
echo "就绪：CDM_TEST_DATABASE_URL=postgres://postgres:admin@127.0.0.1:${PORT}/omop"
