#!/usr/bin/env bash
# Generate Python gRPC stubs from the shared proto into the agent package.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(dirname "$HERE")"
PROTO_DIR="$(cd "$AGENT_DIR/../../packages/proto" && pwd)"
OUT_DIR="$AGENT_DIR/src/medtrust_agent/generated"

mkdir -p "$OUT_DIR"
touch "$OUT_DIR/__init__.py"

for proto in secretflow.proto rws_causal.proto; do
  python3 -m grpc_tools.protoc \
    -I "$PROTO_DIR" \
    --python_out="$OUT_DIR" \
    --grpc_python_out="$OUT_DIR" \
    "$proto"
done

# The grpc plugin emits top-level `import *_pb2`; rewrite to package-relative imports.
for grpc_file in "$OUT_DIR"/*_pb2_grpc.py; do
  base="$(basename "$grpc_file" _grpc.py)"
  python3 - "$grpc_file" "$base" <<'PY'
import sys
path, base = sys.argv[1], sys.argv[2]
with open(path) as f:
    src = f.read()
src = src.replace(f"import {base} as", f"from . import {base} as")
with open(path, "w") as f:
    f.write(src)
PY
done

echo "Generated stubs in $OUT_DIR"
