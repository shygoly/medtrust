#!/usr/bin/env python3
"""AMR Sentinel — Experiment C: breakpoint reinterpretation sensitivity (PAPER §5.4).

Same MIC grid → EUCAST v16.1 vs native_clsi_like_v0 (synthetic offsets, not CLSI M100).
Reports per-hospital and federated ΔR% (percentage points).

Prereq:
  python3 scripts/amr/generate_synthetic.py --n-per-hospital 5000 --seed 42

Usage (repo root):
  python3 scripts/amr/run_exp_c_breakpoint_sens.py
  python3 scripts/amr/run_exp_c_breakpoint_sens.py --out data/synthetic/amr/reports/exp_c.json

Exit non-zero if fewer than --min-discordant organism×drug pairs have |ΔR%| > 0.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.mic import BreakpointTable  # noqa: E402
from lib.reinterpret import (  # noqa: E402
    NativeBreakpointTable,
    rates_to_dicts,
    require_breakpoint_metadata,
    resistance_rates,
)

DEFAULT_BP = ROOT / "data/normalized/breakpoints.parquet"
DEFAULT_SRC = ROOT / "data/synthetic/amr"
DEFAULT_OUT = ROOT / "data/synthetic/amr/reports/exp_c_breakpoint_sens.json"
HOSPITALS = ("huashan", "ruijin")


def load_hospital(src: Path, key: str) -> pd.DataFrame:
    path = src / key / "isolates.parquet"
    if not path.exists():
        raise FileNotFoundError(
            f"Missing {path}. Run: python3 scripts/amr/generate_synthetic.py --n-per-hospital 5000"
        )
    return pd.read_parquet(path)


def main() -> int:
    p = argparse.ArgumentParser(description="Experiment C — breakpoint sensitivity")
    p.add_argument("--breakpoints", type=Path, default=DEFAULT_BP)
    p.add_argument("--src", type=Path, default=DEFAULT_SRC)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--min-discordant", type=int, default=3, help="min |delta_pp|>0 pairs (merged)")
    p.add_argument(
        "--contract-meta",
        default='{"breakpoint_system":"EUCAST","breakpoint_version":"16.1"}',
        help="JSON metadata that must include breakpoint_system + version (fail-closed)",
    )
    args = p.parse_args()

    meta = json.loads(args.contract_meta)
    require_breakpoint_metadata(meta)

    eucast = BreakpointTable(args.breakpoints)
    native = NativeBreakpointTable()

    print("=== AMR Sentinel · 实验 C（折点重判读敏感性）===\n")
    print(f"EUCAST table: {args.breakpoints}")
    print(f"Native profile: {native.profile} v{native.version}")
    print(f"Contract meta: breakpoint_system={meta['breakpoint_system']} "
          f"version={meta.get('breakpoint_version') or meta.get('breakpointVersion')}")
    print(f"Note: {native.note[:80]}…\n" if len(native.note) > 80 else f"Note: {native.note}\n")

    per_site: dict[str, list] = {}
    frames: list[pd.DataFrame] = []
    for hid in HOSPITALS:
        df = load_hospital(args.src, hid)
        frames.append(df)
        rows = resistance_rates(df, eucast=eucast, native=native)
        per_site[hid] = rates_to_dicts(rows)
        print(f"--- {hid} (n_isolates={len(df)}) ---")
        for r in rows:
            flag = "★" if abs(r.delta_pp) > 0 else " "
            print(
                f"  {flag} {r.organism}/{r.drug}: n={r.n}  "
                f"R%_EUCAST={r.rate_eucast*100:.1f}%  R%_native={r.rate_native*100:.1f}%  "
                f"Δ={r.delta_pp:+.2f}pp"
            )
        print()

    merged_df = pd.concat(frames, ignore_index=True)
    merged_rows = resistance_rates(merged_df, eucast=eucast, native=native)
    discordant = [r for r in merged_rows if abs(r.delta_pp) > 0]

    print(f"--- federated merge (n_isolates={len(merged_df)}) ---")
    for r in merged_rows:
        flag = "★" if abs(r.delta_pp) > 0 else " "
        print(
            f"  {flag} {r.organism}/{r.drug}: n={r.n}  "
            f"R%_EUCAST={r.rate_eucast*100:.1f}%  R%_native={r.rate_native*100:.1f}%  "
            f"Δ={r.delta_pp:+.2f}pp"
        )

    report = {
        "experiment": "C",
        "title": "breakpoint_reinterpretation_sensitivity",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "eucast": {"system": "EUCAST", "version": "16.1", "path": str(args.breakpoints)},
        "native": {
            "system": native.profile,
            "version": native.version,
            "note": native.note,
        },
        "contract_meta": meta,
        "per_site": per_site,
        "merged": rates_to_dicts(merged_rows),
        "discordant_merged_count": len(discordant),
        "min_discordant_required": args.min_discordant,
        "pass": len(discordant) >= args.min_discordant,
        "disclaimer": (
            "CHINET-prior synthetic isolates; ΔR% is simulation sensitivity, "
            "not real hospital epidemiology. Native profile is not CLSI M100."
        ),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {args.out}")
    print(f"Discordant pairs (merged |Δ|>0): {len(discordant)} (need ≥{args.min_discordant})")

    if not report["pass"]:
        print("实验 C FAIL — insufficient discordance")
        return 1

    # Hard gate: missing metadata must fail (self-check)
    try:
        require_breakpoint_metadata({})
        print("实验 C FAIL — metadata guard did not raise")
        return 1
    except ValueError:
        pass

    print("\n叙事核对: EUCAST vs native 双列 R% ✓ · |Δ|>0 组合数达标 ✓ · 元数据强制 ✓")
    print("实验 C PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
