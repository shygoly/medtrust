#!/usr/bin/env bash
set -euo pipefail
###############################################################################
# MedTrust — Synthea diabetes-cohort generator (java -jar, no Docker)
#
# Why not `-m type_2_diabetes`?
#   Empirically that restriction produced 0 T2DM patients. Correct approach:
#   full disease graph + Keep Module (`-k`) retaining Active Condition
#   SNOMED 44054006 (D-DATA-1 / Task 1.1).
#
# Usage:
#   scripts/generate-synthea-diabetes.sh [population] [seed] [output_dir]
#   Defaults: 50 / 42 / data/synthea/diabetes-cohort
###############################################################################

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATIENTS="${1:-50}"
SEED="${2:-42}"
OUT_ARG="${3:-$ROOT/data/synthea/diabetes-cohort}"
mkdir -p "$OUT_ARG"
OUTPUT_DIR="$(cd "$OUT_ARG" && pwd)"
JAR="${SYNTHEA_JAR:-$ROOT/data/synthea/synthea-with-dependencies.jar}"
KEEP_MODULE="$ROOT/data/synthea/modules/keep_diabetes_t2.json"
MIN_AGE="${MIN_AGE:-40}"
MAX_AGE="${MAX_AGE:-80}"
STATE="${STATE:-Massachusetts}"
REF_DATE="${REF_DATE:-20260101}"
VERIFY_PY="$ROOT/scripts/lib/verify-synthea-diabetes.py"

for f in "$JAR" "$KEEP_MODULE" "$VERIFY_PY"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing $f" >&2
    exit 1
  fi
done
if ! command -v java >/dev/null 2>&1; then
  echo "ERROR: java not on PATH" >&2
  exit 1
fi

rm -rf "$OUTPUT_DIR/fhir" "$OUTPUT_DIR/csv" "$OUTPUT_DIR/metadata"

echo "=== MedTrust Synthea diabetes cohort ==="
echo "  Patients: $PATIENTS  seed=$SEED  age=${MIN_AGE}-${MAX_AGE}"
echo "  Keep:     $KEEP_MODULE"
echo "  Output:   $OUTPUT_DIR"
echo ""

ATTEMPTS=$(( PATIENTS * 200 ))
if [[ "$ATTEMPTS" -lt 2000 ]]; then ATTEMPTS=2000; fi

# Isolate cwd so default ./output does not pollute the repo root.
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/medtrust-synthea.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

(
  cd "$WORKDIR"
  java -jar "$JAR" \
    -s "$SEED" \
    -cs "$SEED" \
    -r "$REF_DATE" \
    -p "$PATIENTS" \
    -a "${MIN_AGE}-${MAX_AGE}" \
    -k "$KEEP_MODULE" \
    -o \
    --exporter.baseDirectory="$OUTPUT_DIR/" \
    --exporter.fhir.export=true \
    --exporter.csv.export=true \
    --exporter.fhir.use_shr_extensions=false \
    --generate.max_attempts_to_keep_patient="$ATTEMPTS" \
    "$STATE"
)

# Prefer OUTPUT_DIR; else scoop from workdir/output (Synthea default).
if [[ ! -d "$OUTPUT_DIR/csv" && -d "$WORKDIR/output/csv" ]]; then
  for name in fhir csv metadata; do
    if [[ -d "$WORKDIR/output/$name" ]]; then
      rm -rf "$OUTPUT_DIR/$name"
      cp -R "$WORKDIR/output/$name" "$OUTPUT_DIR/$name"
    fi
  done
fi

if [[ ! -f "$OUTPUT_DIR/csv/conditions.csv" ]]; then
  echo "ERROR: no conditions.csv under $OUTPUT_DIR" >&2
  exit 1
fi

FHIR_COUNT=$(find "$OUTPUT_DIR/fhir" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "=== Verify T2DM + antidiabetic meds ==="
echo "  FHIR bundles: $FHIR_COUNT"
python3 "$VERIFY_PY" "$OUTPUT_DIR"
