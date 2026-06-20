#!/usr/bin/env bash
# Generate Python gRPC stubs from the shared proto into the agent package.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(dirname "$HERE")"
PROTO_DIR="$(cd "$AGENT_DIR/../../packages/proto" && pwd)"
OUT_DIR="$AGENT_DIR/src/medtrust_agent/generated"

mkdir -p "$OUT_DIR"
touch "$OUT_DIR/__init__.py"

python3 -m grpc_tools.protoc \
  -I "$PROTO_DIR" \
  --python_out="$OUT_DIR" \
  --grpc_python_out="$OUT_DIR" \
  secretflow.proto

# The grpc plugin emits a top-level `import secretflow_pb2`; rewrite it to a
# package-relative import so the stubs work as `medtrust_agent.generated.*`.
GRPC_FILE="$OUT_DIR/secretflow_pb2_grpc.py"
python3 - "$GRPC_FILE" <<'PY'
import sys
path = sys.argv[1]
with open(path) as f:
    src = f.read()
src = src.replace("import secretflow_pb2 as", "from . import secretflow_pb2 as")
with open(path, "w") as f:
    f.write(src)
PY

echo "Generated stubs in $OUT_DIR"
