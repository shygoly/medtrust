#!/usr/bin/env python3
"""Verify Synthea diabetes cohort + write diabetes-formulary.json (Task 1.1/1.2)."""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


def main() -> int:
    out = Path(sys.argv[1])
    cond_csv = out / "csv" / "conditions.csv"
    med_csv = out / "csv" / "medications.csv"
    if not cond_csv.is_file() or not med_csv.is_file():
        print(f"ERROR: missing csv under {out}", file=sys.stderr)
        return 1

    dm: set[str] = set()
    with cond_csv.open(newline="") as f:
        for r in csv.DictReader(f):
            if r["CODE"] == "44054006":
                dm.add(r["PATIENT"])

    met = ins = 0
    counts: dict[str, int] = {}
    names: dict[str, str] = {}
    want = {"860975", "106892", "311034"}
    with med_csv.open(newline="") as f:
        for r in csv.DictReader(f):
            code = r["CODE"]
            if code == "860975":
                met += 1
            if code in ("106892", "311034"):
                ins += 1
            if code in want or r.get("REASONCODE") == "44054006":
                counts[code] = counts.get(code, 0) + 1
                names[code] = r["DESCRIPTION"]

    print(f"  Unique T2DM patients: {len(dm)}  (SNOMED 44054006)")
    print(f"  Metformin dispenses:  {met}  (RxNorm 860975)")
    print(f"  Insulin dispenses:    {ins}  (RxNorm 106892/311034)")

    payload = {
        "snomed_t2dm": {
            "code": "44054006",
            "display": "Diabetes mellitus type 2 (disorder)",
        },
        "arms": {
            "comparator": {
                "name": "metformin",
                "rxnorm": "860975",
                "role": "first-line oral antidiabetic (Synthea diabetes module)",
            },
            "exposure": {
                "name": "insulin",
                "rxnorm": "106892",
                "alt_rxnorm": ["311034"],
                "role": "escalation / injectable antidiabetic (Synthea diabetes module)",
            },
        },
        "observed_in_run": [
            {
                "rxnorm": c,
                "description": names[c],
                "dispenses": counts[c],
            }
            for c in sorted(counts, key=lambda x: -counts[x])
        ],
        "cohort_patients": len(dm),
        "note": "Map DEFAULT_INJECTION comparatorDrug=metformin, exposureDrug=insulin.",
    }
    inv = out / "diabetes-formulary.json"
    inv.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  Formulary inventory:  {inv}")

    if len(dm) < 1:
        print("ERROR: 0 patients with SNOMED 44054006", file=sys.stderr)
        return 2
    if met < 1 and ins < 1:
        print("ERROR: no metformin/insulin MedicationRequest", file=sys.stderr)
        return 3
    print("=== Done ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
