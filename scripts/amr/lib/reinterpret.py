"""Experiment C: reinterpret MIC under EUCAST vs native (synthetic CLSI-like) breakpoints."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import yaml

from .mic import Breakpoint, BreakpointTable, interpret_mic

DEFAULT_NATIVE = Path(__file__).resolve().parents[1] / "priors" / "native_breakpoint_offsets.yaml"


@dataclass(frozen=True)
class RateRow:
    organism: str
    drug: str
    n: int
    r_eucast: int
    r_native: int
    rate_eucast: float
    rate_native: float
    delta_pp: float


class NativeBreakpointTable:
    """Hospital-assumed alternate MIC breakpoints (synthetic offsets, not CLSI M100)."""

    def __init__(self, path: Path = DEFAULT_NATIVE):
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        self.profile = str(raw.get("profile") or "native")
        self.version = str(raw.get("version") or "0")
        self.note = str(raw.get("note") or "").strip()
        self._map: dict[tuple[str, str], Breakpoint] = {}
        for org, drugs in (raw.get("offsets") or {}).items():
            for abx, thr in drugs.items():
                self._map[(str(org), str(abx))] = Breakpoint(
                    s=float(thr["s"]) if thr.get("s") is not None else None,
                    r=float(thr["r"]) if thr.get("r") is not None else None,
                    antibiotic=f"native:{org}:{abx}",
                )

    def get(self, organism: str, whonet: str) -> Breakpoint | None:
        return self._map.get((organism, whonet))

    def pairs(self) -> list[tuple[str, str]]:
        return sorted(self._map.keys())


def resistance_rates(
    isolates: pd.DataFrame,
    *,
    eucast: BreakpointTable,
    native: NativeBreakpointTable,
    pairs: list[tuple[str, str]] | None = None,
) -> list[RateRow]:
    """Compute R% under EUCAST vs native for selected organism×drug pairs."""
    pairs = pairs or native.pairs()
    rows: list[RateRow] = []
    org_col = "organism_whonet" if "organism_whonet" in isolates.columns else "organism"
    for org, drug in pairs:
        mic_col = f"mic_{drug}"
        if mic_col not in isolates.columns:
            continue
        sub = isolates[isolates[org_col] == org]
        mics = sub[mic_col].dropna()
        if mics.empty:
            continue
        bp_e = eucast.get(org, drug)
        bp_n = native.get(org, drug)
        if bp_n is None:
            continue
        n = 0
        r_e = 0
        r_n = 0
        for mic in mics.astype(float):
            se = interpret_mic(mic, bp_e)
            sn = interpret_mic(mic, bp_n)
            if se == "ND" and sn == "ND":
                continue
            n += 1
            if se == "R":
                r_e += 1
            if sn == "R":
                r_n += 1
        if n == 0:
            continue
        re = r_e / n
        rn = r_n / n
        rows.append(
            RateRow(
                organism=org,
                drug=drug,
                n=n,
                r_eucast=r_e,
                r_native=r_n,
                rate_eucast=round(re, 4),
                rate_native=round(rn, 4),
                delta_pp=round((re - rn) * 100, 2),
            )
        )
    return rows


def require_breakpoint_metadata(meta: dict, *, require_native_profile: bool = False) -> None:
    """Fail-closed: federated AMR tasks must declare breakpoint system + version."""
    system = meta.get("breakpoint_system") or meta.get("breakpointSystem")
    version = meta.get("breakpoint_version") or meta.get("breakpointVersion")
    if not system or not version:
        raise ValueError(
            "breakpoint_system and breakpoint_version are required "
            "(Experiment C / AlignAgent contract metadata)"
        )
    if require_native_profile and "native" not in str(system).lower() and str(system).upper() != "EUCAST":
        # allow EUCAST or native_* profiles only
        raise ValueError(f"unsupported breakpoint_system: {system}")


def rates_to_dicts(rows: list[RateRow]) -> list[dict]:
    return [
        {
            "organism": r.organism,
            "drug": r.drug,
            "n": r.n,
            "r_eucast": r.r_eucast,
            "r_native": r.r_native,
            "rate_eucast": r.rate_eucast,
            "rate_native": r.rate_native,
            "delta_pp": r.delta_pp,
        }
        for r in rows
    ]
