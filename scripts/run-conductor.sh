#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: scripts/run-conductor.sh [--silent|--quiet] <workflow.yaml> [conductor args...]" >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel)"
OPENCODE_CONFIG="$ROOT/opencode.json"
GLOBAL_FLAG=""
if [ "$1" = "--silent" ] || [ "$1" = "--quiet" ]; then
  GLOBAL_FLAG="$1"
  shift
fi

if [ "$#" -lt 1 ]; then
  echo "usage: scripts/run-conductor.sh [--silent|--quiet] <workflow.yaml> [conductor args...]" >&2
  exit 2
fi

WORKFLOW="$1"
shift

if [ ! -f "$OPENCODE_CONFIG" ]; then
  echo "opencode config not found: $OPENCODE_CONFIG" >&2
  exit 1
fi

VISIONCODER_KEY="$(node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(c.provider?.visioncoder?.options?.apiKey || '')" "$OPENCODE_CONFIG")"

if [ -z "$VISIONCODER_KEY" ]; then
  echo "visioncoder apiKey missing in $OPENCODE_CONFIG" >&2
  exit 1
fi

export COPILOT_PROVIDER_API_KEY="$VISIONCODER_KEY"

if [ -n "$GLOBAL_FLAG" ]; then
  exec conductor "$GLOBAL_FLAG" run "$WORKFLOW" "$@"
fi
exec conductor run "$WORKFLOW" "$@"
