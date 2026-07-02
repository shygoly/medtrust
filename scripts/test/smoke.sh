#!/usr/bin/env bash
# Post-deploy smoke test — verifies all MedTrust services are reachable and healthy.
# Usage: ./scripts/test/smoke.sh [--prod|--local]
#   --prod   : test against production URLs (default)
#   --local  : test against localhost ports
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/helpers.sh"

MODE="${1:---prod}"

if [ "$MODE" = "--local" ]; then
  API_URL="${API_URL:-http://localhost:5021}"
  CHAIN_URL="${CHAIN_URL:-http://localhost:8090}"
  WEB_URL="${WEB_URL:-http://localhost:5020}"
else
  API_URL="${API_URL:-https://medtrust-api.fly.dev}"
  CHAIN_URL="${CHAIN_URL:-https://medtrust-chain.fly.dev}"
  WEB_URL="${WEB_URL:-https://medtrust-web.fly.dev}"
fi

header "MedTrust Smoke Test ($MODE)"

# ── 1. API Health ──
header "1. API Health"
step "GET $API_URL/api/v1/health"
HEALTH=$(http_get "$API_URL/api/v1/health" || echo '{"status":"error"}')
assert_contains "API overall health returns JSON" '"status"' "$HEALTH"

STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
if [ "$STATUS" = "healthy" ] || [ "$STATUS" = "degraded" ]; then
  ok "API status is healthy/degraded ($STATUS)"
else
  err "API status is $STATUS"
fi

# ── 2. Individual service health endpoints ──
header "2. Service Health Checks"

for svc in blockchain mp-spdz; do
  step "GET $API_URL/api/v1/health/$svc"
  SVC_HEALTH=$(http_get "$API_URL/api/v1/health/$svc" || echo '{}')
  SVC_STATUS=$(echo "$SVC_HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
  if [ "$SVC_STATUS" = "healthy" ]; then
    ok "$svc is healthy"
  else
    err "$svc is $SVC_STATUS"
  fi
done

# ── 3. Chain sidecar endpoints ──
header "3. Chain Sidecar"
step "GET $CHAIN_URL/health"
CHAIN_HEALTH=$(http_get "$CHAIN_URL/health" || echo '{}')
assert_contains "Chain /health returns ok" '"status":"ok"' "$CHAIN_HEALTH"

step "GET $CHAIN_URL/block-number"
BLOCK_NUM=$(http_get "$CHAIN_URL/block-number" || echo '{}')
BN=$(echo "$BLOCK_NUM" | python3 -c "import sys,json; print(json.load(sys.stdin).get('blockNumber',-1))" 2>/dev/null || true)
assert_gt "Chain block number > 0" "${BN:-0}" 0

# ── 4. Auth flow ──
header "4. Auth"
step "POST $API_URL/api/v1/auth/login"
LOGIN=$(http_post "$API_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@huashan-hospital.com","password":"demo123456"}' || echo '{}')
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || true)
if [ -n "$TOKEN" ] && [ "$TOKEN" != "" ]; then
  ok "Login returns access_token"
else
  err "Login failed — no access_token in response"
fi

if [ -n "$TOKEN" ]; then
  step "GET $API_URL/api/v1/auth/profile"
  PROFILE=$(http_get "$API_URL/api/v1/auth/profile" -H "Authorization: Bearer $TOKEN" || echo '{}')
  assert_contains "Profile returns email" "admin@huashan-hospital.com" "$PROFILE"
fi

# ── 5. Blockchain attestation E2E ──
if [ -n "$TOKEN" ]; then
  header "5. Blockchain Attestation E2E"

  step "POST $API_URL/api/v1/blockchain/attest"
  TS=$(date +%s)
  ATTEST=$(http_post "$API_URL/api/v1/blockchain/attest" \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"attestation_type\":\"custom\",\"data_id\":\"smoke-$TS\",\"data\":\"smoke test data $TS\",\"metadata\":{\"source\":\"smoke-test\"}}" || echo '{}')
  ATTEST_ID=$(echo "$ATTEST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
  if [ -n "$ATTEST_ID" ] && [ "$ATTEST_ID" != "" ]; then
    ok "Attestation created (id=$ATTEST_ID)"

    step "Wait for confirmation..."
    for i in $(seq 1 15); do
      sleep 2
      REC=$(http_get "$API_URL/api/v1/blockchain/attestations/$ATTEST_ID" \
        -H "Authorization: Bearer $TOKEN" || echo '{}')
      REC_STATUS=$(echo "$REC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
      if [ "$REC_STATUS" = "confirmed" ]; then
        TX_HASH=$(echo "$REC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('transaction_hash',''))" 2>/dev/null || true)
        BLOCK=$(echo "$REC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('block_number',''))" 2>/dev/null || true)
        ok "Attestation confirmed (tx=$TX_HASH, block=$BLOCK)"
        break
      fi
      if [ "$i" -eq 15 ]; then
        err "Attestation not confirmed within 30s"
      fi
    done

    step "POST $API_URL/api/v1/blockchain/verify"
    VERIFY=$(http_post "$API_URL/api/v1/blockchain/verify" \
      -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -d "{\"data\":\"smoke test data $TS\",\"attestation_id\":$ATTEST_ID}" || echo '{}')
    VALID=$(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('valid',''))" 2>/dev/null || true)
    if [ "$VALID" = "True" ]; then
      ok "Attestation verified on-chain"
    else
      err "Verification returned valid=$VALID"
    fi

  else
    err "Attestation creation failed — no id"
  fi
fi

# ── Summary ──
summary
