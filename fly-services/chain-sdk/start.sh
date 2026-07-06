#!/bin/sh
# Co-located launcher: ChainMaker node (background) + Java SDK gateway (foreground).
set -e

cd /chainmaker-go/bin
echo "[start] launching ChainMaker node..."
./chainmaker start -c ../config/wx-org-solo/chainmaker.yml &

echo "[start] launching chain-sidecar (connects to localhost RPC, deploys contract)..."
exec java \
  --add-opens java.base/sun.security.util=ALL-UNNAMED \
  --add-opens java.base/java.nio=ALL-UNNAMED \
  --add-exports java.base/jdk.internal.misc=ALL-UNNAMED \
  -jar /app/chain-sidecar.jar
