"""Load de-identified Synthea patient JSON from a connector-local directory.

Each file is one patient (see scripts/ingest-synthea.ts). Features are numeric
observation aggregates mapped to structured_ehr tabular input; labels are a
binary kidney-risk proxy derived from condition text (demo endpoint stand-in).
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import List, Optional, Tuple

import torch

from .model_factory import MODALITY_CONFIG, NUM_CLASSES

_KIDNEY_RE = re.compile(
    r"kidney|renal|neph|ckd|esrd|dialysis|glomer|creatinine|eGFR|uacr",
    re.I,
)

# Observation codes we map into the structured_ehr vector (dim=7).
_OBS_KEYS = (
    "Body Height",
    "Body Weight",
    "Body mass index (BMI) [Ratio]",
    "Heart rate",
    "Respiratory rate",
    "Cholesterol [Mass/volume] in Serum or Plasma",
    "Glucose",
)


def resolve_data_dir(data_path: str) -> Optional[Path]:
    p = Path(data_path).expanduser()
    if not p.is_absolute():
        p = Path.cwd() / p
    if p.is_dir() and any(p.glob("patient-*.json")):
        return p
    return None


def _label_from_conditions(conditions: List[str]) -> int:
    text = " ".join(conditions)
    return 1 if _KIDNEY_RE.search(text) else 0


def _obs_features(observations: list) -> List[float]:
    by_code = {}
    for o in observations or []:
        if not isinstance(o, dict):
            continue
        code = o.get("code")
        val = o.get("value")
        if isinstance(code, str) and isinstance(val, (int, float)):
            by_code[code] = float(val)
    return [by_code.get(k, 0.0) for k in _OBS_KEYS]


def _party_slice(files: List[Path], participant_id: str) -> List[Path]:
    """Deterministic per-party subset so multi-party FedAvg sees different slices."""
    seed = int(hashlib.sha256(participant_id.encode()).hexdigest()[:8], 16)
    order = sorted(files, key=lambda f: f.name)
    keyed = sorted(order, key=lambda f: hashlib.sha256(f"{seed}:{f.name}".encode()).hexdigest())
    return keyed


def load_synthea_tensors(
    data_path: str,
    participant_id: str,
    *,
    max_samples: Optional[int] = None,
    local_only: bool = False,
) -> Optional[Tuple[torch.Tensor, torch.Tensor, int]]:
    root = resolve_data_dir(data_path)
    if root is None:
        return None

    files = list(root.glob("patient-*.json"))
    if not files:
        return None
    if not local_only:
        files = _party_slice(files, participant_id)

    dim = MODALITY_CONFIG["structured_ehr"]["dim"]
    rows: List[List[float]] = []
    labels: List[int] = []

    for fp in files:
        try:
            with fp.open(encoding="utf-8") as f:
                rec = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        feats = _obs_features(rec.get("observations") or [])
        if len(feats) < dim:
            feats = feats + [0.0] * (dim - len(feats))
        else:
            feats = feats[:dim]
        rows.append(feats)
        labels.append(_label_from_conditions(rec.get("conditions") or []))
        if max_samples and len(rows) >= max_samples:
            break

    if not rows:
        return None

    features = torch.tensor(rows, dtype=torch.float32)
    label_t = torch.tensor(labels, dtype=torch.long).clamp(0, NUM_CLASSES - 1)
    return features, label_t, len(rows)
