"""Load the canonical CKD demo scenario from packages/demo-scenario."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

_REPO_ROOT = Path(__file__).resolve().parents[4]
_SCENARIO_PATH = _REPO_ROOT / "packages" / "demo-scenario" / "src" / "ckd-scenario.json"


@lru_cache(maxsize=1)
def load_ckd_scenario() -> Dict[str, Any]:
    with _SCENARIO_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def default_secretflow_spec() -> Dict[str, Any]:
    return load_ckd_scenario()["secretflowSpec"]


def party_modality_map() -> Dict[str, List[str]]:
    return {
        p["participantId"]: list(p.get("modalities") or [])
        for p in load_ckd_scenario()["participants"]
    }


def party_modalities_for(participant_id: str, fallback: List[str]) -> List[str]:
    mapped = party_modality_map().get(participant_id)
    if mapped:
        return mapped
    return list(fallback)


def endpoint_label() -> str:
    return load_ckd_scenario()["endpoint"]["label"]
