#!/usr/bin/env bash
# Deprecated wrapper — prefer scripts/generate-synthea-diabetes.sh (Keep Module).
# The old `-m module` approach produced 0 T2DM patients (D-DATA-1 / Task 1.1).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "NOTE: generate-synthea-data.sh now delegates to generate-synthea-diabetes.sh" >&2
echo "      (Keep Module -k, not -m). See data/synthea/diabetes-formulary.md" >&2
exec "$ROOT/scripts/generate-synthea-diabetes.sh" "$@"
