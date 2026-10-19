#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# MedTrust registration-study synthetic cohort generator.
#
# Synthetic data only. The output must never be presented as evidence of a
# real product's efficacy or safety. The study indication is an engineering
# placeholder until a real protocol and SAP are frozen.
#
# Example:
#   scripts/generate-synthea-registration-cohort.sh \
#     --population 100000 --seed 20261017 --age 18-80 \
#     --state Massachusetts --reference-date 20261001 \
#     --keep-module data/synthea/modules/keep_registration_indication.json \
#     --output data/synthea/registration-20261017
###############################################################################

MEDTRUST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRATION_POPULATION=100000
REGISTRATION_SEED=20261017
REGISTRATION_AGE=18-80
REGISTRATION_STATE=Massachusetts
REGISTRATION_REFERENCE_DATE=20261001
REGISTRATION_KEEP_MODULE="$MEDTRUST_ROOT/data/synthea/modules/keep_registration_indication.json"
REGISTRATION_OUTPUT="$MEDTRUST_ROOT/data/synthea/registration-20261017"
REGISTRATION_JAR="$MEDTRUST_ROOT/data/synthea/synthea-with-dependencies.jar"
REGISTRATION_PINS="$MEDTRUST_ROOT/data/synthea/registration-inputs.json"

usage() {
  sed -n '10,21p' "$0" >&2
}

need_value() {
  if [[ $# -lt 2 || -z "$2" ]]; then
    echo "ERROR: $1 requires a value" >&2
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --population)
      need_value "$@"; REGISTRATION_POPULATION="$2"; shift 2 ;;
    --seed)
      need_value "$@"; REGISTRATION_SEED="$2"; shift 2 ;;
    --age)
      need_value "$@"; REGISTRATION_AGE="$2"; shift 2 ;;
    --state)
      need_value "$@"; REGISTRATION_STATE="$2"; shift 2 ;;
    --reference-date)
      need_value "$@"; REGISTRATION_REFERENCE_DATE="$2"; shift 2 ;;
    --keep-module)
      need_value "$@"; REGISTRATION_KEEP_MODULE="$2"; shift 2 ;;
    --output)
      need_value "$@"; REGISTRATION_OUTPUT="$2"; shift 2 ;;
    --jar)
      need_value "$@"; REGISTRATION_JAR="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

for registration_file in \
  "$REGISTRATION_JAR" \
  "$REGISTRATION_KEEP_MODULE" \
  "$REGISTRATION_PINS"; do
  if [[ ! -f "$registration_file" ]]; then
    echo "ERROR: missing pinned input: $registration_file" >&2
    exit 1
  fi
done

if ! command -v java >/dev/null 2>&1; then
  echo "ERROR: java is required" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required" >&2
  exit 1
fi
if [[ ! "$REGISTRATION_POPULATION" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: population must be a positive integer" >&2
  exit 2
fi
if [[ ! "$REGISTRATION_SEED" =~ ^[0-9]+$ ]]; then
  echo "ERROR: seed must be an integer" >&2
  exit 2
fi

REGISTRATION_JAR_ABS="$(cd "$(dirname "$REGISTRATION_JAR")" && pwd)/$(basename "$REGISTRATION_JAR")"
REGISTRATION_MODULE_ABS="$(cd "$(dirname "$REGISTRATION_KEEP_MODULE")" && pwd)/$(basename "$REGISTRATION_KEEP_MODULE")"

node "$MEDTRUST_ROOT/scripts/verify-synthea-registration-inputs.mjs" \
  --pins "$REGISTRATION_PINS" \
  --jar "$REGISTRATION_JAR_ABS" \
  --keep-module "$REGISTRATION_MODULE_ABS"

mkdir -p "$REGISTRATION_OUTPUT"
REGISTRATION_OUTPUT_ABS="$(cd "$REGISTRATION_OUTPUT" && pwd)"

# Generated products are replaceable. Remove only known output subdirectories.
for registration_generated_dir in csv fhir metadata fixtures; do
  if [[ -d "$REGISTRATION_OUTPUT_ABS/$registration_generated_dir" ]]; then
    rm -rf "$REGISTRATION_OUTPUT_ABS/$registration_generated_dir"
  fi
done

REGISTRATION_ATTEMPTS=$(( REGISTRATION_POPULATION * 200 ))
if (( REGISTRATION_ATTEMPTS < 2000 )); then
  REGISTRATION_ATTEMPTS=2000
fi

REGISTRATION_WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/medtrust-registration-synthea.XXXXXX")"
registration_cleanup() {
  rm -rf "$REGISTRATION_WORKDIR"
}
trap registration_cleanup EXIT

echo "=== MedTrust synthetic registration cohort ==="
echo "  synthetic only; not a clinical or regulatory result"
echo "  population=$REGISTRATION_POPULATION seed=$REGISTRATION_SEED age=$REGISTRATION_AGE"
echo "  state=$REGISTRATION_STATE reference-date=$REGISTRATION_REFERENCE_DATE"
echo "  output=$REGISTRATION_OUTPUT_ABS"

(
  cd "$REGISTRATION_WORKDIR"
  java -jar "$REGISTRATION_JAR_ABS" \
    -s "$REGISTRATION_SEED" \
    -cs "$REGISTRATION_SEED" \
    -r "$REGISTRATION_REFERENCE_DATE" \
    -p "$REGISTRATION_POPULATION" \
    -a "$REGISTRATION_AGE" \
    -k "$REGISTRATION_MODULE_ABS" \
    -o \
    --exporter.baseDirectory="$REGISTRATION_OUTPUT_ABS/" \
    --exporter.fhir.export=true \
    --exporter.csv.export=true \
    --exporter.fhir.use_shr_extensions=false \
    --generate.max_attempts_to_keep_patient="$REGISTRATION_ATTEMPTS" \
    "$REGISTRATION_STATE"
)

# Some Synthea builds ignore exporter.baseDirectory when `-o` is used and
# write under the temporary workdir instead. Copy only the known products.
if [[ ! -f "$REGISTRATION_OUTPUT_ABS/csv/patients.csv" && -d "$REGISTRATION_WORKDIR/output" ]]; then
  for registration_generated_dir in csv fhir metadata; do
    if [[ -d "$REGISTRATION_WORKDIR/output/$registration_generated_dir" ]]; then
      rm -rf "$REGISTRATION_OUTPUT_ABS/$registration_generated_dir"
      cp -R "$REGISTRATION_WORKDIR/output/$registration_generated_dir" \
        "$REGISTRATION_OUTPUT_ABS/$registration_generated_dir"
    fi
  done
fi

if [[ ! -f "$REGISTRATION_OUTPUT_ABS/csv/patients.csv" || ! -f "$REGISTRATION_OUTPUT_ABS/csv/conditions.csv" ]]; then
  echo "ERROR: Synthea did not produce patients.csv and conditions.csv" >&2
  exit 1
fi

node "$MEDTRUST_ROOT/scripts/build-registration-eca-fixtures.mjs" \
  --synthea "$REGISTRATION_OUTPUT_ABS/csv" \
  --out "$REGISTRATION_OUTPUT_ABS/fixtures" \
  --population "$REGISTRATION_POPULATION" \
  --seed "$REGISTRATION_SEED" \
  --age "$REGISTRATION_AGE" \
  --state "$REGISTRATION_STATE" \
  --reference-date "$REGISTRATION_REFERENCE_DATE" \
  --keep-module "$REGISTRATION_MODULE_ABS" \
  --jar "$REGISTRATION_JAR_ABS" \
  --pins "$REGISTRATION_PINS"

cp "$REGISTRATION_OUTPUT_ABS/fixtures/generation-manifest.json" \
  "$REGISTRATION_OUTPUT_ABS/generation-manifest.json"

echo "Synthetic generation complete: $REGISTRATION_OUTPUT_ABS"
