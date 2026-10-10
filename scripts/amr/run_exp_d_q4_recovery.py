#!/usr/bin/env python3
"""AMR Sentinel — Experiment D: Q4 causal injection recovery (PAPER §5.5).

Recovers ICU-stratified / crude risk ratios on q4Eligible episodes under the
CHINET-prior synthetic DGP. Supports both YAML presets by reading --src tree
(manifest q4_preset) or regenerating under --out-root.

PAPER §8 ban: never phrase results as clinical efficacy — simulation recovery only.

Prereq (bli_noninferior, default):
  python3 scripts/amr/generate_synthetic.py --n-per-hospital 5000 --seed 42

Optional second preset tree:
  python3 scripts/amr/generate_synthetic.py --n-per-hospital 5000 --seed 42 \\
    --q4-preset merino_superior --out data/synthetic/amr-merino

Usage:
  python3 scripts/amr/run_exp_d_q4_recovery.py
  python3 scripts/amr/run_exp_d_q4_recovery.py --src data/synthetic/amr-merino --expect-preset merino_superior
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.validate import check_q4_effect  # noqa: E402

DEFAULT_SRC = ROOT / "data/synthetic/amr"
DEFAULT_Q4 = ROOT / "scripts/amr/priors/q4_effect.yaml"
DEFAULT_OUT = ROOT / "data/synthetic/amr/reports/exp_d_q4_recovery.json"
HOSPITALS = ("demohospa", "demohospb")


def load_episodes(src: Path, hid: str) -> list[dict]:
    path = src / hid / "episodes.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"Missing {path}")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_preset_band(q4_yaml: Path, name: str) -> tuple[float, float]:
    raw = yaml.safe_load(q4_yaml.read_text(encoding="utf-8"))
    preset = (raw.get("presets") or {}).get(name)
    if not preset:
        raise KeyError(f"unknown q4 preset: {name}")
    band = preset.get("target_hr_band")
    if not band or len(band) != 2:
        raise ValueError(f"preset {name} missing target_hr_band")
    return float(band[0]), float(band[1])


def main() -> int:
    ap = argparse.ArgumentParser(description="Experiment D — Q4 effect recovery")
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--q4-yaml", type=Path, default=DEFAULT_Q4)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument(
        "--expect-preset",
        default=None,
        help="If set, must match manifest q4_preset (fail otherwise)",
    )
    args = ap.parse_args()

    manifest_path = args.src / "manifest.json"
    if not manifest_path.exists():
        print(f"Missing {manifest_path}", file=sys.stderr)
        return 1
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    preset_name = manifest.get("q4_preset") or "bli_noninferior"
    if args.expect_preset and args.expect_preset != preset_name:
        print(
            f"preset mismatch: manifest={preset_name} expect={args.expect_preset}",
            file=sys.stderr,
        )
        return 1

    band = load_preset_band(args.q4_yaml, preset_name)

    print("=== AMR Sentinel · 实验 D（Q4 注入效应回收）===\n")
    print(f"src={args.src}")
    print(f"preset={preset_name}  target_hr_band={list(band)}")
    print("disclaimer: simulation recovery only — NOT clinical efficacy\n")

    per_site: dict[str, dict] = {}
    all_eps: list[dict] = []
    for hid in HOSPITALS:
        eps = load_episodes(args.src, hid)
        all_eps.extend(eps)
        gate = check_q4_effect(eps, band)
        per_site[hid] = gate
        print(f"--- {hid} ---")
        print(
            f"  eligible={gate.get('n_eligible')} treated={gate.get('n_treated')} "
            f"control={gate.get('n_control')}"
        )
        print(
            f"  risk_carb={gate.get('risk_treated')} risk_BLI={gate.get('risk_control')} "
            f"RR_crude={gate.get('risk_ratio_crude')} RR_strat={gate.get('risk_ratio_stratified')}"
        )
        print(f"  gate_pass={gate.get('pass')} mode={gate.get('mode')}")
        print()

    merged = check_q4_effect(all_eps, band)
    print("--- federated pool (synthetic-only; not row egress) ---")
    print(
        f"  eligible={merged.get('n_eligible')} RR_crude={merged.get('risk_ratio_crude')} "
        f"RR_strat={merged.get('risk_ratio_stratified')} pass={merged.get('pass')}"
    )

    ok = bool(merged.get("pass")) and all(per_site[h].get("pass") for h in HOSPITALS)
    report = {
        "experiment": "D",
        "title": "q4_injection_recovery",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "preset": preset_name,
        "target_hr_band": list(band),
        "per_site": per_site,
        "merged": merged,
        "pass": ok,
        "disclaimer": (
            "CHINET-prior synthetic episodes; recovery of injected tau / risk band. "
            "Do NOT report as clinical efficacy (PAPER §8)."
        ),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote {args.out}")

    if not ok:
        print("实验 D FAIL")
        return 1
    print("\n叙事核对: 双院 gate ✓ · 合并回收 ✓ · 无疗效话术 ✓")
    print("实验 D PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
