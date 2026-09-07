"""Emit WHONET-wide CSV, InternalRecord JSONL, parquet, manifest."""
from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .priors import PANELS


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def isolates_to_dataframe(isolates: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(isolates)


def write_whonet_csv(isolates: list[dict], path: Path) -> None:
    """Wide WHONET-like export: demographics + MIC/SIR columns."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not isolates:
        path.write_text("", encoding="utf-8")
        return
    # stable column order
    base = [
        "isolate_id",
        "patient_hash",
        "hospital_id",
        "sex",
        "age_band",
        "ward",
        "icu",
        "specimen_code",
        "sample_date",
        "organism_whonet",
        "chinet_rate_group",
        "phenotype_mrsa",
        "phenotype_esbl",
        "phenotype_cre",
        "rare_phenotype",
        "breakpoint_system",
        "breakpoint_version",
    ]
    abx = sorted({k[4:] for row in isolates for k in row if k.startswith("mic_")})
    mic_cols = [f"mic_{a}" for a in abx]
    sir_cols = [f"sir_eucast_{a}" for a in abx]
    fieldnames = base + mic_cols + sir_cols
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in isolates:
            w.writerow(row)


def episode_to_internal_record(ep: dict) -> dict:
    """Strip to connector InternalRecord (+ harmless extensions)."""
    return {
        "subjectKey": ep["subjectKey"],
        "ageBand": ep["ageBand"],
        "sex": ep["sex"],
        "conditions": list(ep["conditions"]),
        "medications": list(ep["medications"]),
        "adverseEvents": list(ep.get("adverseEvents", [])),
        "followUpDays": ep["followUpDays"],
        "eventOccurred": ep["eventOccurred"],
        "treated": ep["treated"],
        "icuAtBaseline": ep.get("icuAtBaseline"),
        "charlsonIndex": ep.get("charlsonIndex"),
        "specimenType": ep.get("specimenType"),
        "organism": ep.get("organism"),
        "timeZero": ep.get("timeZero"),
        "priorAbxExposure90d": ep.get("priorAbxExposure90d"),
        "q4Eligible": ep.get("q4Eligible"),
        "isolate_id": ep.get("isolate_id"),
        "hospital_id": ep.get("hospital_id"),
    }


def write_internal_records(episodes: list[dict], path: Path) -> None:
    """Connector-facing InternalRecord-compatible JSONL."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for ep in episodes:
            f.write(json.dumps(episode_to_internal_record(ep), ensure_ascii=False) + "\n")


def write_connector_records_json(episodes: list[dict], path: Path) -> None:
    """LocalDataLoader prefers records.json (JSON array of InternalRecord)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    records = [episode_to_internal_record(ep) for ep in episodes]
    path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")


def write_hospital_bundle(
    out_dir: Path,
    hospital_id: str,
    isolates: list[dict],
    episodes: list[dict],
) -> dict[str, Path]:
    hdir = out_dir / hospital_id
    hdir.mkdir(parents=True, exist_ok=True)
    paths = {
        "isolates_parquet": hdir / "isolates.parquet",
        "whonet_csv": hdir / "whonet_isolates.csv",
        "episodes_jsonl": hdir / "episodes.jsonl",
        "internal_records_jsonl": hdir / "internal_records.jsonl",
    }
    df = isolates_to_dataframe(isolates)
    df.to_parquet(paths["isolates_parquet"], index=False)
    write_whonet_csv(isolates, paths["whonet_csv"])
    write_internal_records(episodes, paths["internal_records_jsonl"])
    # full episode dump (includes q4Eligible etc.)
    with paths["episodes_jsonl"].open("w", encoding="utf-8") as f:
        for ep in episodes:
            f.write(json.dumps(ep, ensure_ascii=False) + "\n")
    return paths


def write_connector_hospital_bundle(
    connectors_root: Path,
    hospital_id: str,
    episodes: list[dict],
) -> dict[str, Path]:
    """Write data/synthetic/amr/connectors/{hospital}/records.json for LocalDataLoader."""
    hdir = connectors_root / hospital_id
    hdir.mkdir(parents=True, exist_ok=True)
    records_path = hdir / "records.json"
    write_connector_records_json(episodes, records_path)
    return {"records_json": records_path}


def write_manifest(
    out_dir: Path,
    *,
    seed: int,
    hospitals: list[str],
    n_per_hospital: int,
    q4_preset: str | None,
    q4_prior_path: Path,
    chinet_path: Path,
    breakpoints_path: Path,
    hospital_paths: dict[str, dict[str, Path]],
    validation: dict,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tool": "scripts/amr/generate_synthetic.py",
        "seed": seed,
        "hospitals": hospitals,
        "n_per_hospital": n_per_hospital,
        "q4_preset": q4_preset,
        "inputs": {
            "chinet_baseline": str(chinet_path),
            "chinet_sha256": _file_sha256(chinet_path) if chinet_path.exists() else None,
            "breakpoints": str(breakpoints_path),
            "breakpoints_sha256": _file_sha256(breakpoints_path) if breakpoints_path.exists() else None,
            "q4_prior": str(q4_prior_path),
            "q4_prior_sha256": _file_sha256(q4_prior_path) if q4_prior_path.exists() else None,
        },
        "outputs": {
            hid: {k: str(p) for k, p in paths.items()} for hid, paths in hospital_paths.items()
        },
        "panels": PANELS,
        "validation": validation,
        "notes": [
            "Synthetic isolate-level AST calibrated to CHINET 2024 resistance rates.",
            "MIC drawn on twofold grid then labeled with EUCAST v16.1 breakpoints.",
            "T1 episodes emit InternalRecord-compatible JSONL for connector RWS path.",
            "WHONET-wide CSV is for hospital alignment / Agent 2 demos.",
        ],
    }
    path = out_dir / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
