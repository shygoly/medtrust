#!/usr/bin/env python3
"""Build connector-local AMR slices from synthetic hospital bundles.

Reads:  data/synthetic/amr/{huashan,ruijin}/{isolates.parquet,episodes.jsonl}
Writes: data/synthetic/amr/connectors/{huashan,ruijin}/records.json
        data/synthetic/amr/connectors/manifest.json

Enriches conditions with resist:{org}:{abx}:{SIR} for Q1 condition-prevalence,
and normalizes adverseEvents to connector shape (organSystem/term/serious).

Usage (repo root):
  python3 scripts/amr/build_amr_connectors.py
  python3 scripts/amr/build_amr_connectors.py --src data/synthetic/amr --out data/synthetic/amr/connectors
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

from lib.emit import write_connector_records_json  # noqa: E402

HOSPITALS = [
    {
        "key": "huashan",
        "participantId": "p-huashan",
        "catalogProductId": "dp-amr-ast-huashan",
        "displayName": "华山医院",
    },
    {
        "key": "ruijin",
        "participantId": "p-ruijin",
        "catalogProductId": "dp-amr-ast-ruijin",
        "displayName": "瑞金医院",
    },
]


def _normalize_ae(raw: list) -> list[dict]:
    out = []
    for e in raw or []:
        if not isinstance(e, dict):
            continue
        term = e.get("term")
        if not term:
            continue
        out.append(
            {
                "organSystem": e.get("organSystem") or "general",
                "term": term,
                "serious": bool(e.get("serious", True)),
            }
        )
    return out


def _enrich_from_isolate(ep: dict, iso: dict | None) -> dict:
    conditions = [c for c in (ep.get("conditions") or []) if not str(c).startswith("resist:")]
    org = ep.get("organism") or (iso or {}).get("organism_whonet")
    if org and f"organism:{org}" not in conditions:
        conditions.insert(0, f"organism:{org}")
    if iso is not None:
        for k, v in iso.items():
            if not str(k).startswith("sir_eucast_"):
                continue
            wh = str(k)[len("sir_eucast_") :]
            sir = v
            if sir is None or (isinstance(sir, float) and pd.isna(sir)) or sir == "ND":
                continue
            label = f"resist:{org}:{wh}:{sir}"
            if label not in conditions:
                conditions.append(label)
        if iso.get("icu") and "icu" not in conditions:
            conditions.append("icu")
        if iso.get("phenotype_cre") and "cre" not in conditions:
            conditions.append("cre")
        if iso.get("phenotype_esbl") and "esbl" not in conditions:
            conditions.append("esbl")
        if iso.get("rare_phenotype") and "rare_colistin_r_aba" not in conditions:
            conditions.append("rare_colistin_r_aba")

    return {
        "subjectKey": ep["subjectKey"],
        "ageBand": ep.get("ageBand") or "未知",
        "sex": ep.get("sex"),
        "conditions": conditions,
        "medications": list(ep.get("medications") or []),
        "adverseEvents": _normalize_ae(ep.get("adverseEvents") or []),
        "followUpDays": ep.get("followUpDays"),
        "eventOccurred": ep.get("eventOccurred"),
        "treated": ep.get("treated"),
        "icuAtBaseline": ep.get("icuAtBaseline"),
        "charlsonIndex": ep.get("charlsonIndex"),
        "specimenType": ep.get("specimenType"),
        "organism": org,
        "timeZero": ep.get("timeZero"),
        "priorAbxExposure90d": ep.get("priorAbxExposure90d"),
        "q4Eligible": ep.get("q4Eligible"),
        "isolate_id": ep.get("isolate_id"),
        "hospital_id": ep.get("hospital_id"),
    }


def build_hospital(src_dir: Path, out_dir: Path, key: str) -> tuple[int, Path]:
    iso_path = src_dir / key / "isolates.parquet"
    ep_path = src_dir / key / "episodes.jsonl"
    if not ep_path.exists():
        # fallback to internal_records.jsonl
        ep_path = src_dir / key / "internal_records.jsonl"
    if not ep_path.exists():
        raise FileNotFoundError(f"missing episodes for {key}: {ep_path}")

    iso_by_id: dict[str, dict] = {}
    if iso_path.exists():
        df = pd.read_parquet(iso_path)
        for row in df.to_dict(orient="records"):
            iso_by_id[str(row["isolate_id"])] = row

    episodes = []
    with ep_path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            ep = json.loads(line)
            iso = iso_by_id.get(str(ep.get("isolate_id") or ""))
            episodes.append(_enrich_from_isolate(ep, iso))

    dest = out_dir / key / "records.json"
    write_connector_records_json(episodes, dest)
    return len(episodes), dest


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--src", type=Path, default=ROOT / "data/synthetic/amr")
    p.add_argument("--out", type=Path, default=ROOT / "data/synthetic/amr/connectors")
    p.add_argument(
        "--q2-unlock-counts",
        action="store_true",
        help="Force rare_colistin_r_aba to 3+4 for merge-then-gate unlock demo",
    )
    args = p.parse_args(argv)

    hospitals_meta = []
    for h in HOSPITALS:
        n, path = build_hospital(args.src, args.out, h["key"])
        print(f"{h['key']}: {n} records → {path}")
        hospitals_meta.append(
            {
                **h,
                "recordCount": n,
                "localDataPath": f"data/synthetic/amr/connectors/{h['key']}",
            }
        )

    if args.q2_unlock_counts:
        from force_q2_unlock_counts import force_rare  # type: ignore

        force_rare(args.out / "huashan" / "records.json", 3)
        force_rare(args.out / "ruijin" / "records.json", 4)
        print("q2-unlock-counts applied (huashan=3, ruijin=4)")

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "amr-synthetic",
        "tool": "scripts/amr/build_amr_connectors.py",
        "hospitals": hospitals_meta,
        "q2UnlockCounts": bool(args.q2_unlock_counts),
        "notes": [
            "records.json is InternalRecord[] for apps/connector LocalDataLoader.",
            "Q1 labels: resist:{organism}:{whonet}:{R|S|I} + organism:{code}.",
            "Catalog product ids are stubs for local/dev wiring (dp-amr-ast-*).",
            "Pass --q2-unlock-counts for both-under rare phenotype (merge-then-gate demo).",
        ],
    }
    man_path = args.out / "manifest.json"
    man_path.parent.mkdir(parents=True, exist_ok=True)
    man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"manifest: {man_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
