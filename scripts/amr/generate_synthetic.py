#!/usr/bin/env python3
"""AMR synthetic isolate/episode generator (CHINET prior + EUCAST MIC + Q4 presets).

Per docs/amr-sentinel/DATA-ACQUISITION.md §7 and PROPOSAL.md Q1–Q4.

Examples:
  python scripts/amr/generate_synthetic.py --n-per-hospital 2000 --seed 42
  python scripts/amr/generate_synthetic.py --q4-preset merino_superior --n-per-hospital 5000
  python scripts/amr/generate_synthetic.py --hospitals huashan,ruijin --with-t1
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import (  # noqa: E402
    AmrEpisodeGenerator,
    BreakpointTable,
    GeneratorConfig,
    MicEngine,
    PROFILES,
    ResistancePrior,
    load_q4_presets,
    run_all_gates,
    write_hospital_bundle,
    write_manifest,
)
from lib.emit import write_connector_hospital_bundle  # noqa: E402

DEFAULT_CHINET = ROOT / "data/normalized/chinet_baseline.parquet"
DEFAULT_BP = ROOT / "data/normalized/breakpoints.parquet"
DEFAULT_Q4 = ROOT / "scripts/amr/priors/q4_effect.yaml"
DEFAULT_OUT = ROOT / "data/synthetic/amr"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--hospitals", default="huashan,ruijin", help="comma-separated hospital ids")
    p.add_argument("--n-per-hospital", type=int, default=5000)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--q4-preset", default=None, help="merino_superior | bli_noninferior (default from YAML)")
    p.add_argument("--with-t1", action=argparse.BooleanOptionalAction, default=True)
    p.add_argument("--chinet", type=Path, default=DEFAULT_CHINET)
    p.add_argument("--breakpoints", type=Path, default=DEFAULT_BP)
    p.add_argument("--q4-prior", type=Path, default=DEFAULT_Q4)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--fail-on-gate", action=argparse.BooleanOptionalAction, default=True)
    args = p.parse_args(argv)

    hospitals = [h.strip() for h in args.hospitals.split(",") if h.strip()]
    for h in hospitals:
        if h not in PROFILES:
            print(f"unknown hospital '{h}', choose from {list(PROFILES)}", file=sys.stderr)
            return 2

    presets, default_name = load_q4_presets(args.q4_prior)
    preset_name = args.q4_preset or default_name
    if preset_name not in presets:
        print(f"unknown q4 preset '{preset_name}', choose from {list(presets)}", file=sys.stderr)
        return 2
    q4 = presets[preset_name] if args.with_t1 else None

    print(f"loading priors: CHINET={args.chinet}  EUCAST={args.breakpoints}")
    prior = ResistancePrior(args.chinet)
    bp = BreakpointTable(args.breakpoints)
    mic = MicEngine(bp)

    isolates_by: dict[str, list] = {}
    episodes_by: dict[str, list] = {}
    hospital_paths: dict[str, dict] = {}
    connector_paths: dict[str, dict] = {}
    connectors_root = args.out / "connectors"

    for hid in hospitals:
        profile = PROFILES[hid]
        # distinct seed stream per hospital
        cfg = GeneratorConfig(
            n_isolates=args.n_per_hospital,
            seed=args.seed,
            with_t1=args.with_t1,
            q4_preset=q4,
        )
        gen = AmrEpisodeGenerator(prior, mic, profile, cfg)
        print(f"generating {hid} n={args.n_per_hospital} q4={preset_name if args.with_t1 else 'off'} …")
        isolates, episodes = gen.generate()
        isolates_by[hid] = isolates
        episodes_by[hid] = episodes
        hospital_paths[hid] = write_hospital_bundle(args.out, hid, isolates, episodes)
        connector_paths[hid] = write_connector_hospital_bundle(connectors_root, hid, episodes)
        print(f"  isolates={len(isolates)} episodes={len(episodes)} connector={connector_paths[hid]['records_json']}")

    validation = run_all_gates(
        isolates_by_hospital=isolates_by,
        episodes_by_hospital=episodes_by,
        prior=prior,
        bp=bp,
        q4_hr_band=q4.target_hr_band if q4 else None,
    )
    manifest = write_manifest(
        args.out,
        seed=args.seed,
        hospitals=hospitals,
        n_per_hospital=args.n_per_hospital,
        q4_preset=preset_name if args.with_t1 else None,
        q4_prior_path=args.q4_prior,
        chinet_path=args.chinet,
        breakpoints_path=args.breakpoints,
        hospital_paths=hospital_paths,
        validation=validation,
    )

    print(json.dumps({g["gate"]: g["pass"] for g in validation["gates"]}, ensure_ascii=False))
    print(f"manifest: {manifest}")
    print(f"overall: {'PASS' if validation['pass'] else 'FAIL'}")

    if args.fail_on_gate and not validation["pass"]:
        # print failing gate details
        for g in validation["gates"]:
            if not g["pass"]:
                print(json.dumps(g, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
