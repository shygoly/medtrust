#!/usr/bin/env python3
"""Curate rare_colistin_r_aba counts for the Q2 small-cell narratives.

Default generator boosts are stochastic; this post-step forces a deterministic,
**asymmetric** state accepted by BOTH the control-plane e2e (示范甲抑制、示范乙可发)
and the connector e2e (asymmetric branch):
  demohospa=3 (< minCell=5 → suppressed), demohospb=6 (>= minCell=5 → publishable)
For the merge-then-gate "both-under" demo instead, pass --demohospb 4 (both <5, merged >=5).

Usage (after build_amr_connectors.py):
  python3 scripts/amr/force_q2_unlock_counts.py            # asymmetric (default)
  python3 scripts/amr/force_q2_unlock_counts.py --demohospb 4 # both-under unlock demo
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / "data/synthetic/amr/connectors"


def force_rare(path: Path, target: int) -> int:
    rows = json.loads(path.read_text(encoding="utf-8"))
    for r in rows:
        r["conditions"] = [c for c in r.get("conditions", []) if c != "rare_colistin_r_aba"]
    candidates: list[tuple[int, int]] = []
    for i, r in enumerate(rows):
        conds = r.get("conditions", [])
        if any(str(c).startswith("organism:aba") for c in conds):
            score = 2 if any("resist:aba:CL:R" in str(c) for c in conds) else 1
            candidates.append((score, i))
    candidates.sort(reverse=True)
    if len(candidates) < target:
        raise SystemExit(f"{path}: only {len(candidates)} aba candidates, need {target}")
    for _, i in candidates[:target]:
        rows[i]["conditions"].append("rare_colistin_r_aba")
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return sum(1 for r in rows if "rare_colistin_r_aba" in r["conditions"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--connectors", type=Path, default=DEFAULT)
    ap.add_argument("--demohospa", type=int, default=3)
    ap.add_argument("--demohospb", type=int, default=6)
    args = ap.parse_args()
    h = force_rare(args.connectors / "demohospa" / "records.json", args.demohospa)
    r = force_rare(args.connectors / "demohospb" / "records.json", args.demohospb)
    print(f"demohospa rare={h} demohospb rare={r} merged={h + r}")
    print(
        "Q2 rare counts curated"
        + (" (asymmetric: demohospa<5 suppressed, demohospb>=5 publishable)" if r >= 5
           else " (both-under: <5 each, merged>=5)")
    )


if __name__ == "__main__":
    main()
