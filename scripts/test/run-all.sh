#!/usr/bin/env bash
# Run all MedTrust tests: unit → build → smoke → e2e
# Usage: ./scripts/test/run-all.sh [--prod|--local]
#   --prod   : run unit locally, then smoke+e2e against production (default)
#   --local  : all tests against localhost (requires docker-compose up)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || dirname "$SCRIPT_DIR/../..")"
source "$SCRIPT_DIR/lib/helpers.sh"

MODE="${1:---prod}"

header "MedTrust Full Test Suite"
step "Mode: $MODE"

# ── Phase 1: Pre-deploy checks ──
header "Phase 1: Unit Tests + Build"
step "pnpm test (unit tests)"
if (cd "$ROOT" && pnpm --filter api test --passWithNoTests 2>&1 | tail -5); then
  ok "Unit tests passed"
else
  err "Unit tests failed"
fi

step "pnpm build"
if (cd "$ROOT" && pnpm build 2>&1 | tail -5); then
  ok "Build succeeded"
else
  err "Build failed"
fi

# ── Phase 2: Post-deploy verification ──
header "Phase 2: Post-Deploy Smoke Test"
bash "$SCRIPT_DIR/smoke.sh" "$MODE" && ok "Smoke test passed" || err "Smoke test failed"

# ── Phase 3: End-to-End flow ──
header "Phase 3: E2E Flow Test"
bash "$SCRIPT_DIR/e2e-flow.sh" "$MODE" && ok "E2E flow test passed" || err "E2E flow test failed"

# ── Summary ──
summary
