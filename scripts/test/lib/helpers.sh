#!/usr/bin/env bash
# Shared test utilities — colored output, assertions, HTTP helpers.
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
START_TS=$(date +%s)

# ---- output helpers ----

header()  { printf "\n${BLUE}=== %s ===${NC}\n" "$*"; }
step()    { printf "${BLUE}  → %s${NC}\n" "$*"; }
ok()      { PASS=$((PASS+1)); printf "  ${GREEN}✓${NC} %s\n" "$*"; }
err()     { FAIL=$((FAIL+1)); printf "  ${RED}✗${NC} %s\n" "$*"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then ok "$label"; else err "$label (expected '$expected', got '$actual')"; fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then ok "$label"; else err "$label (string does not contain '$needle')"; fi
}

assert_gt() {
  local label="$1" a="$2" b="$3"
  if [ "$a" -gt "$b" ]; then ok "$label"; else err "$label ($a is not > $b)"; fi
}

# ---- HTTP helpers ----

http_get() {
  curl -fsS --connect-timeout 10 --max-time 15 "$@"
}

http_post() {
  curl -fsS --connect-timeout 10 --max-time 15 -X POST "$@"
}

# ---- summary ----

summary() {
  local elapsed=$(($(date +%s) - START_TS))
  local total=$((PASS + FAIL))
  printf "\n${BLUE}─── Results ───${NC}\n"
  printf "  Total: %d  ${GREEN}Pass: %d${NC}  ${RED}Fail: %d${NC}  Time: %ds\n" "$total" "$PASS" "$FAIL" "$elapsed"
  if [ "$FAIL" -eq 0 ]; then
    printf "${GREEN}  All checks passed.${NC}\n"
    return 0
  else
    printf "${RED}  %d check(s) failed.${NC}\n" "$FAIL"
    return 1
  fi
}
