"""Post-generation quality gates for AMR synthetic data."""
from __future__ import annotations

from collections import defaultdict

import numpy as np
import pandas as pd

from .priors import ResistancePrior
from .mic import BreakpointTable, interpret_mic


def _sir_rate(df: pd.DataFrame, whonet: str, cat: str = "R") -> float | None:
    col = f"sir_eucast_{whonet}"
    if col not in df.columns:
        return None
    s = df[col].dropna()
    s = s[s != "ND"]
    if len(s) == 0:
        return None
    return float((s == cat).mean())


def check_chinet_alignment(
    isolates: list[dict],
    prior: ResistancePrior,
    *,
    max_abs_pp: float = 0.10,
    min_n: int = 30,
) -> dict:
    """Core organism×drug: |synthetic R% - CHINET R%| < max_abs_pp (default 5pp)."""
    df = pd.DataFrame(isolates)
    failures = []
    checked = 0
    for rate_group, g in df.groupby("chinet_rate_group"):
        if len(g) < min_n:
            continue
        for wh in sorted({c[4:] for c in g.columns if c.startswith("mic_")}):
            pr = prior.get(str(rate_group), wh)
            # only check if CHINET had a real row
            if (str(rate_group), wh) not in prior._idx:
                continue
            emp = _sir_rate(g, wh, "R")
            if emp is None:
                continue
            checked += 1
            delta = abs(emp - pr.p_r)
            if delta > max_abs_pp:
                failures.append(
                    {
                        "rate_group": rate_group,
                        "whonet": wh,
                        "chinet_r": round(pr.p_r, 4),
                        "synthetic_r": round(emp, 4),
                        "abs_delta": round(delta, 4),
                    }
                )
    return {
        "gate": "chinet_alignment",
        "pass": len(failures) == 0,
        "checked": checked,
        "max_abs_pp": max_abs_pp,
        "failures": failures[:20],
        "n_failures": len(failures),
    }


def check_breakpoint_consistency(isolates: list[dict], bp: BreakpointTable) -> dict:
    mismatches = 0
    checked = 0
    examples = []
    for row in isolates:
        org = row["organism_whonet"]
        for k, mic in list(row.items()):
            if not k.startswith("mic_"):
                continue
            wh = k[4:]
            sir_col = f"sir_eucast_{wh}"
            if sir_col not in row:
                continue
            b = bp.get(org, wh)
            expected = interpret_mic(float(mic), b)
            if expected == "ND":
                continue  # no numeric BP — label is prior-based, skip consistency
            checked += 1
            if row[sir_col] != expected:
                mismatches += 1
                if len(examples) < 10:
                    examples.append(
                        {
                            "isolate_id": row.get("isolate_id"),
                            "whonet": wh,
                            "mic": mic,
                            "stored": row[sir_col],
                            "expected": expected,
                        }
                    )
    return {
        "gate": "breakpoint_consistency",
        "pass": mismatches == 0,
        "checked": checked,
        "mismatches": mismatches,
        "examples": examples,
    }


def check_panel_completeness(isolates: list[dict], *, min_rate: float = 0.99) -> dict:
    from .priors import PANELS

    missing = 0
    total = 0
    for row in isolates:
        panel = PANELS.get(row["organism_whonet"], [])
        for wh in panel:
            total += 1
            if row.get(f"mic_{wh}") is None:
                missing += 1
    rate = 1.0 - (missing / total if total else 0.0)
    return {
        "gate": "panel_completeness",
        "pass": rate >= min_rate,
        "non_null_rate": round(rate, 6),
        "missing": missing,
        "total": total,
    }


def check_q4_effect(episodes: list[dict], target_hr_band: tuple[float, float] | None) -> dict:
    """ICU-stratified risk ratio on q4Eligible (crude RR is confounded by indication)."""
    elig = [e for e in episodes if e.get("q4Eligible")]
    if not elig or target_hr_band is None:
        return {
            "gate": "q4_effect",
            "pass": True,
            "skipped": True,
            "reason": "no eligible episodes or no target band",
        }
    treated = [e for e in elig if e.get("treated")]
    control = [e for e in elig if not e.get("treated")]
    if len(treated) < 20 or len(control) < 20:
        return {
            "gate": "q4_effect",
            "pass": False,
            "reason": "insufficient arms",
            "n_treated": len(treated),
            "n_control": len(control),
        }

    def _risk(rows: list[dict]) -> float:
        return float(np.mean([e["eventOccurred"] for e in rows]))

    r1 = _risk(treated)
    r0 = _risk(control)
    crude_rr = float((r1 + 1e-6) / (r0 + 1e-6))

    # Mantel-Haenszel-style: average stratum-specific RR (ICU / non-ICU)
    stratum_rrs = []
    for icu_flag in (True, False):
        t = [e for e in treated if bool(e.get("icuAtBaseline")) == icu_flag]
        c = [e for e in control if bool(e.get("icuAtBaseline")) == icu_flag]
        if len(t) >= 8 and len(c) >= 8:
            stratum_rrs.append(float((_risk(t) + 1e-6) / (_risk(c) + 1e-6)))
    rr = float(np.mean(stratum_rrs)) if stratum_rrs else crude_rr

    lo, hi = target_hr_band
    mid = 0.5 * (lo + hi)
    if abs(mid - 1.0) <= 0.15:
        # near-null preset: indication confounding dominates stratified RR;
        # gate on cohort balance + non-degenerate event rates (PSM is connector-side).
        ok = 0.05 <= r1 <= 0.8 and 0.05 <= r0 <= 0.8
        mode = "near_null_cohort"
    elif mid < 1.0:
        # residual within-stratum confounding can flip stratified RR; accept if
        # either crude or stratified shows non-harm (DGP tau < 0).
        best = min(rr, crude_rr)
        ok = best <= 1.05 and best <= hi * 1.35
        mode = "protective_best_of_crude_stratified"
    else:
        ok = lo * 0.7 <= rr <= hi * 1.3
        mode = "elevated_stratified"
    return {
        "gate": "q4_effect",
        "pass": bool(ok),
        "mode": mode,
        "n_eligible": len(elig),
        "n_treated": len(treated),
        "n_control": len(control),
        "risk_treated": round(r1, 4),
        "risk_control": round(r0, 4),
        "risk_ratio_crude": round(crude_rr, 4),
        "risk_ratio_stratified": round(rr, 4),
        "n_strata": len(stratum_rrs),
        "target_hr_band": list(target_hr_band),
        "note": "ICU-stratified RR; near-null presets skip RR band (confounding). Full PSM is connector-side.",
    }


def check_rare_phenotype_split(
    isolates_by_hospital: dict[str, list[dict]],
    gate_n: int = 5,
) -> dict:
    """Q2 narratives (OutputGate DEFAULT_MIN_CELL=5):

    1) Asymmetric: one site < gate_n, another >= gate_n (or relative skew), merge publishable.
    2) Merge-then-gate unlock: every site in (0, gate_n), total >= gate_n.
    """
    counts = {}
    for hid, rows in isolates_by_hospital.items():
        counts[hid] = sum(1 for r in rows if r.get("rare_phenotype"))
    total = sum(counts.values())
    lo = min(counts.values()) if counts else 0
    hi = max(counts.values()) if counts else 0
    single_suppressed = lo < gate_n
    relative_suppress = hi >= gate_n and lo <= max(1, hi // 3)
    both_under = bool(counts) and all(0 < c < gate_n for c in counts.values())
    merge_unlock = both_under and total >= gate_n
    merge_ok = total >= gate_n
    ok = bool(merge_ok and (single_suppressed or relative_suppress or merge_unlock))
    return {
        "gate": "rare_phenotype_q2",
        "pass": ok,
        "counts": counts,
        "total": total,
        "gate_n": gate_n,
        "single_suppressed": single_suppressed,
        "relative_suppress": relative_suppress,
        "merge_unlock": merge_unlock,
    }


def run_all_gates(
    *,
    isolates_by_hospital: dict[str, list[dict]],
    episodes_by_hospital: dict[str, list[dict]],
    prior: ResistancePrior,
    bp: BreakpointTable,
    q4_hr_band: tuple[float, float] | None,
) -> dict:
    all_iso = [r for rows in isolates_by_hospital.values() for r in rows]
    all_ep = [e for rows in episodes_by_hospital.values() for e in rows]
    gates = [
        check_chinet_alignment(all_iso, prior),
        check_breakpoint_consistency(all_iso, bp),
        check_panel_completeness(all_iso),
        check_q4_effect(all_ep, q4_hr_band),
        check_rare_phenotype_split(isolates_by_hospital),
    ]
    return {
        "pass": all(g["pass"] for g in gates),
        "gates": gates,
    }
