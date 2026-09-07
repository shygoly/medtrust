"""MIC sampling on twofold dilution grid + EUCAST S/I/R labeling."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .priors import SirPrior

# EUCAST-style twofold dilution grid (mg/L)
MIC_GRID = np.array(
    [0.001, 0.002, 0.004, 0.008, 0.015, 0.03, 0.06, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
    dtype=float,
)

# organism.csv eucast_group by whonet
ORG_TO_EUCAST = {
    "eco": "Enterobacterales",
    "kpn": "Enterobacterales",
    "pae": "Pseudomonas",
    "aba": "Acinetobacter",
    "sau": "Staphylococcus",
    "efm": "Enterococcus",
    "efa": "Enterococcus",
    "spn": "S.pneumoniae",
    "hin": "H.influenzae",
}


@dataclass(frozen=True)
class Breakpoint:
    s: float | None
    r: float | None
    antibiotic: str


class BreakpointTable:
    def __init__(self, path: Path):
        bp = pd.read_parquet(path)
        mic = bp[(bp.method == "MIC") & (bp.whonet_code.astype(str).str.len() > 0)].copy()
        # Prefer numeric rows; demote meningitis / site-qualified footnotes; then shorter names
        name = mic["antibiotic"].astype(str)
        mic["_has"] = mic["s"].notna() | mic["r"].notna()
        # Keep "indications other than meningitis"; demote true meningitis / Salmonella footnotes
        mic["_demote"] = (
            name.str.contains(r"Salmonella|PK\s*/\s*PD|topical|\bscreen\b", case=False, na=False)
            | (
                name.str.contains(r"meningitis", case=False, na=False)
                & ~name.str.contains(r"other than meningitis", case=False, na=False)
            )
        ).astype(int)
        mic["_len"] = name.str.len()
        mic = mic.sort_values(
            ["organism_group", "whonet_code", "_has", "_demote", "_len"],
            ascending=[True, True, False, True, True],
        )
        mic = mic.drop_duplicates(["organism_group", "whonet_code"], keep="first")
        self._map: dict[tuple[str, str], Breakpoint] = {}
        for r in mic.itertuples():
            self._map[(str(r.organism_group), str(r.whonet_code))] = Breakpoint(
                s=None if pd.isna(r.s) else float(r.s),
                r=None if pd.isna(r.r) else float(r.r),
                antibiotic=str(r.antibiotic),
            )

    def get(self, organism: str, whonet: str) -> Breakpoint | None:
        eg = ORG_TO_EUCAST.get(organism)
        if not eg:
            return None
        return self._map.get((eg, whonet))


def interpret_mic(mic: float, bp: Breakpoint | None) -> str:
    """EUCAST: MIC <= S → S; MIC > R → R; else I. Missing BP → 'ND'."""
    if bp is None or (bp.s is None and bp.r is None):
        return "ND"
    s, r = bp.s, bp.r
    if s is not None and mic <= s:
        return "S"
    if r is not None and mic > r:
        return "R"
    if s is not None and r is not None and s < mic <= r:
        return "I"
    # S==R edge (EUCAST often uses same value): MIC > S → R
    if s is not None and r is not None and s == r:
        return "S" if mic <= s else "R"
    if r is None and s is not None:
        return "S" if mic <= s else "R"
    if s is None and r is not None:
        return "R" if mic > r else "S"
    return "ND"


def _pick_from_mask(rng: np.random.Generator, mask: np.ndarray) -> float:
    idx = np.flatnonzero(mask)
    if len(idx) == 0:
        # fallback whole grid
        idx = np.arange(len(MIC_GRID))
    # prefer mid-band with triangular-ish weights
    w = np.ones(len(idx), dtype=float)
    mid = (len(idx) - 1) / 2
    w *= 1.0 / (1.0 + 0.35 * np.abs(np.arange(len(idx)) - mid))
    w /= w.sum()
    return float(MIC_GRID[int(rng.choice(idx, p=w))])


def sample_mic(rng: np.random.Generator, prior: SirPrior, bp: Breakpoint | None) -> tuple[float, str]:
    """Draw SIR from prior first (calibration anchor), then MIC inside that zone.

    Label is the sampled category (not a post-hoc re-interpret), so marginal R%
    tracks CHINET. MIC is still constrained to the EUCAST zone when breakpoints exist.
    """
    cats = np.array(["R", "S", "I"])
    probs = np.array([prior.p_r, prior.p_s, prior.p_i], dtype=float)
    if probs.sum() <= 0:
        probs = np.array([0.1, 0.85, 0.05])
    probs = probs / probs.sum()
    target = str(rng.choice(cats, p=probs))

    if bp is None or (bp.s is None and bp.r is None):
        mic = float(rng.choice(MIC_GRID[6:14]))  # 0.125–16
        return mic, target

    s, r = bp.s, bp.r
    for _ in range(24):
        if target == "S":
            if s is not None:
                mask = MIC_GRID <= s
                if not mask.any():
                    # EUCAST placeholder S=0.001 etc. — treat lowest grid as S
                    mask = MIC_GRID <= MIC_GRID[0]
            elif r is not None:
                mask = MIC_GRID <= r
            else:
                mask = np.ones(len(MIC_GRID), dtype=bool)
            mic = _pick_from_mask(rng, mask)
        elif target == "R":
            if r is not None:
                mask = MIC_GRID > r
                if not mask.any() and s is not None:
                    mask = MIC_GRID > s
            elif s is not None:
                mask = MIC_GRID > s
            else:
                mask = MIC_GRID >= 16
            if not mask.any():
                mask = MIC_GRID >= MIC_GRID[-3]
            mic = _pick_from_mask(rng, mask)
        else:  # I
            if s is not None and r is not None and r > s:
                mask = (MIC_GRID > s) & (MIC_GRID <= r)
            else:
                # no I zone — fold into S (EUCAST often has S==R)
                return sample_mic(rng, SirPrior(prior.p_r, prior.p_s + prior.p_i), bp)
            if not mask.any():
                return sample_mic(rng, SirPrior(prior.p_r, prior.p_s + prior.p_i), bp)
            mic = _pick_from_mask(rng, mask)

        got = interpret_mic(mic, bp)
        if got == target:
            return mic, target
        # EUCAST S==R edge: I unavailable; accept R/S remap only if target was I (handled above)
    # last resort: keep category, snap MIC to zone center
    if target == "S":
        if s is not None:
            below = MIC_GRID[MIC_GRID <= s]
            if len(below) == 0:
                below = MIC_GRID[MIC_GRID <= max(s, MIC_GRID[0])]
                if len(below) == 0:
                    below = MIC_GRID[:1]
            mic = float(below[len(below) // 2])
        else:
            mic = float(MIC_GRID[6])
    elif target == "R":
        thr = r if r is not None else s
        if thr is not None:
            above = MIC_GRID[MIC_GRID > thr]
            mic = float(above[min(1, len(above) - 1)]) if len(above) else float(MIC_GRID[-1])
        else:
            mic = float(MIC_GRID[-2])
    else:
        mic = float(rng.choice(MIC_GRID[8:12]))
    return mic, target


class MicEngine:
    def __init__(self, breakpoints: BreakpointTable):
        self.bp = breakpoints

    def sample_panel(
        self,
        rng: np.random.Generator,
        organism: str,
        rate_group: str,
        panel: list[str],
        prior_get,
        resistance_tilt: float = 1.0,
        latent_cre: bool = False,
        latent_esbl: bool = False,
        mrsa: bool = False,
    ) -> dict[str, dict]:
        """Return {whonet: {mic, sir_eucast}} with simple phenotype coupling."""
        out: dict[str, dict] = {}
        for wh in panel:
            pr = prior_get(rate_group, wh)
            # apply hospital tilt on R
            p_r = min(0.99, pr.p_r * resistance_tilt)
            p_s = max(0.0, pr.p_s * (1.0 - (p_r - pr.p_r) * 0.5))
            if p_r + p_s > 1.0:
                p_s = max(0.0, 1.0 - p_r)
            pr = SirPrior(p_r=p_r, p_s=p_s)

            if latent_cre and wh in ("IPM", "MEM", "ETP"):
                pr = SirPrior(p_r=min(0.98, max(pr.p_r, 0.85)), p_s=max(0.0, 1.0 - max(pr.p_r, 0.85) - 0.02))
            if latent_esbl and wh in ("CRO", "CAZ", "FEP", "AMC"):
                pr = SirPrior(p_r=min(0.95, max(pr.p_r, 0.70)), p_s=max(0.0, 1.0 - max(pr.p_r, 0.70) - 0.05))
            if mrsa and wh == "OXA":
                pr = SirPrior(p_r=1.0, p_s=0.0)
            if (not mrsa) and organism == "sau" and wh == "OXA":
                pr = SirPrior(p_r=0.0, p_s=1.0)

            bp = self.bp.get(organism, wh)
            mic, sir = sample_mic(rng, pr, bp)
            out[wh] = {"mic": mic, "sir_eucast": sir}
        return out
