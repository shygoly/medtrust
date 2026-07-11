"""OpenSpec rws-analytics-ladder 组7.1 — agent 侧 L3 scenario 覆盖."""

from __future__ import annotations

import json

from medtrust_agent.psm_iptw import estimate_iptw
from medtrust_agent.cox_km import fit_cox_ph, kaplan_meier_binned
from medtrust_agent.rws_causal_runtime import run_local_causal


def _cohort(n: int = 80):
    rows = []
    for i in range(n):
        treated = i % 2 == 0
        rows.append(
            {
                "ageBand": "50-59",
                "sex": "M" if i % 3 else "F",
                "treated": treated,
                "eventOccurred": (i % 5 == 0),
                "followUpDays": 200 + (i % 400),
            }
        )
    return rows


def test_l3_psm_outputs_ate_only():
    """Scenario: L3 因果仅出站点效应量 — PSM/IPTW path."""
    out = run_local_causal("iptw", "{}", json.dumps(_cohort()))
    assert out["analysisType"] == "causal-psm"
    assert out["effectEstimate"]["measure"] == "ate"
    assert "subjectKey" not in json.dumps(out)


def test_l3_cox_outputs_hr_and_binned_km():
    """Scenario: L3 Cox — HR + KM 分箱,无行级."""
    out = run_local_causal("cox", "{}", json.dumps(_cohort()))
    assert out["analysisType"] == "causal-survival"
    assert out["effectEstimate"]["measure"] == "log_hr"
    assert out["kmCurve"]["bins"]
    assert "subjectKey" not in json.dumps(out)


def test_psm_kernel_finite():
    cohort = _cohort(120)
    est = estimate_iptw(cohort, ["ageBand", "sex"])
    assert est["standard_error"] > 0


def test_cox_kernel_finite():
    cohort = _cohort(60)
    hr = fit_cox_ph(cohort)
    assert hr["standard_error"] > 0
    bins = kaplan_meier_binned(cohort, bin_width_days=30, min_at_risk=5)
    assert bins[0]["t"] == 0
