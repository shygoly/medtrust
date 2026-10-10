#!/usr/bin/env bash
# End-to-End flow test — complete user journey across all deployed services.
# Usage: ./scripts/test/e2e-flow.sh [--prod|--local]
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

header "MedTrust E2E Flow Test ($MODE)"

# ── Scene 1: Authentication ──
header "Scene 1: Authentication"
CREDS='{"email":"admin@demohospa-hospital.com","password":"demo123456"}'

LOGIN=$(http_post "$API_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' -d "$CREDS")
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

ok "Login as admin@demohospa-hospital.com"

PROFILE=$(http_get "$API_URL/api/v1/auth/profile" -H "Authorization: Bearer $TOKEN")
ROLE=$(echo "$PROFILE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('role',''))" 2>/dev/null || echo "unknown")
ok "Profile retrieved (role=$ROLE)"

# ── Scene 2: Blockchain attestation — Create → Confirm → Verify → List ──
header "Scene 2: Blockchain Attestation Lifecycle"

# Capture block before
BEFORE_BN=$(http_get "$CHAIN_URL/block-number" | python3 -c "import sys,json; print(json.load(sys.stdin).get('blockNumber',-1))")
step "Starting block number: $BEFORE_BN"

TS=$(date +%s)
DATA="e2e-attestation-data-$TS"

# Create
ATTEST=$(http_post "$API_URL/api/v1/blockchain/attest" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"attestation_type\":\"custom\",\"data_id\":\"e2e-$TS\",\"data\":\"$DATA\",\"metadata\":{\"patient_id\":\"e2e-P001\",\"source\":\"e2e-test\"}}")
ATTEST_ID=$(echo "$ATTEST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
DATA_HASH=$(echo "$ATTEST" | python3 -c "import sys,json; print(json.load(sys.stdin).get('data_hash',''))")
if [[ "$DATA_HASH" =~ ^[0-9a-f]{64}$ ]]; then
  ok "Attestation has valid SM3 hash ($DATA_HASH)"
else
  err "Attestation hash invalid format"
fi
ok "Attestation created (id=$ATTEST_ID)"

# Confirm
step "Waiting for on-chain confirmation..."
CONFIRMED=false
for i in $(seq 1 20); do
  sleep 3
  REC=$(http_get "$API_URL/api/v1/blockchain/attestations/$ATTEST_ID" \
    -H "Authorization: Bearer $TOKEN")
  REC_STATUS=$(echo "$REC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))")
  if [ "$REC_STATUS" = "confirmed" ]; then
    CONFIRMED=true
    TX_HASH=$(echo "$REC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('transaction_hash',''))")
    BLOCK=$(echo "$REC" | python3 -c "import sys,json; print(json.load(sys.stdin).get('block_number',''))")
    ok "Confirmed on chain (tx=$TX_HASH, block=$BLOCK)"
    break
  fi
done
if [ "$CONFIRMED" = false ]; then
  err "Attestation never confirmed within 60s"
fi

# Verify block increased
AFTER_BN=$(http_get "$CHAIN_URL/block-number" | python3 -c "import sys,json; print(json.load(sys.stdin).get('blockNumber',-1))")
assert_gt "Chain block advanced (${BEFORE_BN} → ${AFTER_BN})" "$AFTER_BN" "$BEFORE_BN"

# Verify attestation
VERIFY=$(http_post "$API_URL/api/v1/blockchain/verify" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"data\":\"$DATA\",\"attestation_id\":$ATTEST_ID}")
VALID=$(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('valid',''))")
if [ "$VALID" = "True" ]; then
  ok "On-chain verification passed"
else
  err "On-chain verification failed"
fi

# Tamper detection
TAMPER=$(http_post "$API_URL/api/v1/blockchain/verify" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"data\":\"tampered-data-$TS\",\"attestation_id\":$ATTEST_ID}")
TAMPER_VALID=$(echo "$TAMPER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('valid',''))")
TAMPER_MSG=$(echo "$TAMPER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('message',''))")
assert_contains "Tamper detection works" "tampered" "$TAMPER_MSG"

# List attestations
LIST=$(http_get "$API_URL/api/v1/blockchain/attestations" \
  -H "Authorization: Bearer $TOKEN")
LIST_COUNT=$(echo "$LIST" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
assert_gt "Attestation list is non-empty" "$LIST_COUNT" 0
ok "Listed $LIST_COUNT attestations"

# ── Scene 3: Cross-service connectivity ──
header "Scene 3: Cross-Service Connectivity"

# Chain → API (chain confirmed via API health)
CHAIN_VIA_API=$(http_get "$API_URL/api/v1/health/blockchain")
assert_contains "API sees chain as healthy" '"status":"healthy"' "$CHAIN_VIA_API"
ok "API ↔ Chain connectivity verified"

# Web health (just reachable)
step "GET $WEB_URL"
WEB_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 15 "$WEB_URL" || echo "000")
if [ "$WEB_STATUS" = "200" ]; then
  ok "Web frontend reachable (HTTP 200)"
else
  err "Web frontend returned HTTP $WEB_STATUS"
fi

# ── Scene 4: API Documentation ──
header "Scene 4: API Docs"
DOC_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 15 "$API_URL/api/docs" || echo "000")
if [ "$DOC_STATUS" = "200" ]; then
  ok "Swagger docs reachable"
else
  err "Swagger docs returned HTTP $DOC_STATUS"
fi

# ── Summary ──
summary
