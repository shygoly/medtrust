#!/usr/bin/env bash
set -eu
###############################################################################
# Synthea synthetic patient data generator for MedTrust
#
# Generates realistic FHIR patient bundles with common chronic diseases
# relevant to hospital followup scenarios:
#   - Metabolic syndrome / type-2 diabetes
#   - Cardiovascular disease (post-surgery followup)
#   - Breast / colorectal / lung cancer (post-treatment monitoring)
#   - COPD (chronic respiratory)
#   - CKD (renal function tracking)
#   - Hypertension
#
# Output: data/synthea/output/fhir/*.json (FHIR R4 Bundles)
#
# Usage:
#   scripts/generate-synthea-data.sh [patient_count] [seed]
#   Default: 100 patients, seed 12345
###############################################################################

PATIENTS="${1:-100}"
SEED="${2:-12345}"
MIN_AGE="${3:-40}"
MAX_AGE="${4:-80}"
OUTPUT_DIR="./data/synthea/output"

DISEASE_MODULES=(
  metabolic_syndrome_disease
  cardiovascular_disease
  breast_cancer
  colorectal_cancer
  lung_cancer
  copd
  chronic_kidney_disease
  hypertension
  type_2_diabetes
)

echo "=== MedTrust Synthea Generator ==="
echo "  Patients: $PATIENTS  Seed: $SEED  Age: $MIN_AGE-$MAX_AGE"
echo "  Modules: ${DISEASE_MODULES[*]}"
echo ""

mkdir -p "$OUTPUT_DIR"

# Check if Docker image exists
if ! docker image inspect smartonfhir/synthea:latest &>/dev/null; then
  echo "Pulling Synthea Docker image..."
  docker pull smartonfhir/synthea:latest
fi

# Build module args
MODULE_ARGS=""
for m in "${DISEASE_MODULES[@]}"; do
  MODULE_ARGS="$MODULE_ARGS -m $m"
done

echo "Generating $PATIENTS patients..."
docker run --rm \
  -v "$(pwd)/$OUTPUT_DIR:/output" \
  smartonfhir/synthea:latest \
  -p "$PATIENTS" \
  -cs "$SEED" \
  -a "$MIN_AGE-$MAX_AGE" \
  --exporter.fhir.export true \
  --exporter.csv.export true \
  --exporter.fhir.use_shr_extensions false \
  $MODULE_ARGS

FHIR_COUNT=$(find "$OUTPUT_DIR/fhir" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "=== Done ==="
echo "  FHIR bundles: $FHIR_COUNT files"
echo "  Output:       $OUTPUT_DIR/"
echo ""
echo "Next: pnpm --filter connector ingest-synthea"
