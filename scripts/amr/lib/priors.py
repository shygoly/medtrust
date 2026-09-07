"""Resistance priors from CHINET + Q4 effect YAML."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import yaml

# CHINET 药名 → WHONET（仅 dict/antibiotic.csv 核心面板）
CHINET_ABX_TO_WHONET = {
    "Penicillin G": "PEN",
    "Oxacillin": "OXA",
    "Ampicillin": "AMP",
    "Amoxicillin-clavulanic acid": "AMC",
    "Piperacillin-tazobactam": "TZP",
    "Cefoxitin": "FOX",
    "Ceftriaxone": "CRO",
    "Ceftazidime": "CAZ",
    "Cefepime": "FEP",
    "Meropenem": "MEM",
    "Imipenem": "IPM",
    "Amikacin": "AK",
    "Gentamicin": "CN",
    "Ciprofloxacin": "CIP",
    "Levofloxacin": "LVX",
    "Trimethoprim-sulfamethoxazole": "SXT",
    "Vancomycin": "VA",
    "Linezolid": "LZD",
    "Tigecycline": "TGC",
    "Colistin": "CL",
}

# 菌种默认药敏面板（WHONET 码）
PANELS: dict[str, list[str]] = {
    "eco": ["AMP", "AMC", "TZP", "FOX", "CRO", "CAZ", "FEP", "IPM", "MEM", "AK", "CN", "CIP", "LVX", "SXT"],
    "kpn": ["AMC", "TZP", "CRO", "CAZ", "FEP", "IPM", "MEM", "AK", "CN", "CIP", "LVX", "SXT"],
    "pae": ["TZP", "CAZ", "FEP", "IPM", "MEM", "AK", "CN", "CIP", "LVX", "CL"],
    "aba": ["TZP", "CAZ", "FEP", "IPM", "MEM", "AK", "CN", "CIP", "LVX", "SXT", "TGC", "CL"],
    "sau": ["PEN", "OXA", "CN", "CIP", "LVX", "SXT", "VA", "LZD", "TGC"],
    "efm": ["AMP", "CN", "VA", "LZD", "TGC"],
    "efa": ["AMP", "CN", "VA", "LZD", "TGC"],
}


@dataclass(frozen=True)
class SirPrior:
    p_r: float
    p_s: float

    @property
    def p_i(self) -> float:
        return max(0.0, 1.0 - self.p_r - self.p_s)


class ResistancePrior:
    """Lookup CHINET R/S rates by (rate_group, whonet_code)."""

    def __init__(self, baseline_path: Path):
        raw = pd.read_parquet(baseline_path)
        rows = []
        for (group, abx), g in raw.groupby(["group", "antibiotic"]):
            wh = CHINET_ABX_TO_WHONET.get(str(abx))
            if not wh:
                continue
            r = g.loc[g.indicator == "R", "value_pct"]
            s = g.loc[g.indicator == "S", "value_pct"]
            if r.empty and s.empty:
                continue
            p_r = float(r.iloc[0]) / 100.0 if len(r) and pd.notna(r.iloc[0]) else 0.0
            p_s = float(s.iloc[0]) / 100.0 if len(s) and pd.notna(s.iloc[0]) else max(0.0, 1.0 - p_r)
            # clip / normalize if R+S > 1 (known 1-cell misalign in CHINET extract)
            if p_r + p_s > 1.0:
                tot = p_r + p_s
                p_r, p_s = p_r / tot, p_s / tot
            rows.append({"rate_group": group, "whonet": wh, "p_r": p_r, "p_s": p_s})
        self._df = pd.DataFrame(rows)
        self._idx = {(r.rate_group, r.whonet): SirPrior(r.p_r, r.p_s) for r in self._df.itertuples()}

    def get(self, rate_group: str, whonet: str, default_r: float = 0.1) -> SirPrior:
        hit = self._idx.get((rate_group, whonet))
        if hit:
            return hit
        # fallback: mild resistance so panel stays filled
        return SirPrior(p_r=default_r, p_s=max(0.0, 1.0 - default_r - 0.05))

    def frame(self) -> pd.DataFrame:
        return self._df.copy()


@dataclass(frozen=True)
class Q4Preset:
    name: str
    label: str
    description: str
    tau: float
    intercept: float
    target_hr_band: tuple[float, float]
    target_risk_diff_band: tuple[float, float]
    covariates: dict[str, float]


def load_q4_presets(path: Path) -> tuple[dict[str, Q4Preset], str]:
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    presets: dict[str, Q4Preset] = {}
    for name, body in doc["presets"].items():
        presets[name] = Q4Preset(
            name=name,
            label=body["label"],
            description=body.get("description", "").strip(),
            tau=float(body["tau"]),
            intercept=float(body["intercept"]),
            target_hr_band=tuple(body["target_hr_band"]),
            target_risk_diff_band=tuple(body["target_risk_diff_band"]),
            covariates={k: float(v) for k, v in body["covariates"].items()},
        )
    return presets, str(doc.get("default_preset", "bli_noninferior"))
