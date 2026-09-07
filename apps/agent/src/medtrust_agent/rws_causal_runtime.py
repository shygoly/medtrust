"""Dispatch L3 causal methods to PSM/IPTW/Cox kernels (tasks 5.2/5.3)."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

from .cox_km import fit_cox_ph, kaplan_meier_binned
from .psm_iptw import estimate_iptw, estimate_psm

log = logging.getLogger("medtrust_agent.rws_causal_runtime")

_FORBIDDEN_RESULT_KEYS = {"rows", "subjectKey", "patientId"}


def _ci95(effect: float, se: float) -> list[float]:
    margin = 1.96 * se
    return [effect - margin, effect + margin]


def _guard_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    blob = json.dumps(payload)
    for key in _FORBIDDEN_RESULT_KEYS:
        if key in blob:
            raise ValueError(f"unsafe causal result contains {key}")
    return payload


def run_local_causal(method: str, spec_json: str, cohort_json: str) -> Dict[str, Any]:
    cohort = json.loads(cohort_json) if cohort_json else []
    spec = json.loads(spec_json) if spec_json else {}
    tte = spec.get("tte") or {}
    covariates = tte.get("matchingCovariates") or ["ageBand", "sex"]
    n = len(cohort)
    if n == 0:
        raise ValueError("empty causal cohort")

    if method in ("psm", "iptw"):
        est = estimate_psm(cohort, covariates) if method == "psm" else estimate_iptw(cohort, covariates)
        ate = float(est["ate"])
        se = float(est["standard_error"])
        return _guard_payload(
            {
                "analysisType": "causal-psm",
                "cohortSize": n,
                "buckets": [],
                "effectEstimate": {
                    "measure": "ate",
                    "beta": ate,
                    "standardError": se,
                    "ci95": _ci95(ate, se),
                },
            }
        )

    if method == "cox":
        cox = fit_cox_ph(cohort)
        log_hr = float(cox["log_hr"])
        se = float(cox["standard_error"])
        return _guard_payload(
            {
                "analysisType": "causal-survival",
                "cohortSize": n,
                "buckets": [],
                "effectEstimate": {
                    "measure": "log_hr",
                    "beta": log_hr,
                    "standardError": se,
                    "ci95": _ci95(log_hr, se),
                },
                "kmCurve": {
                    "binWidthDays": 30,
                    "bins": kaplan_meier_binned(cohort, bin_width_days=30, min_at_risk=5),
                },
            }
        )

    raise ValueError(f"unsupported causal method: {method}")
