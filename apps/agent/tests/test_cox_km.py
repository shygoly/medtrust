"""Cox + KM binned tests (task 5.3)."""

from __future__ import annotations

import numpy as np
import pytest

from medtrust_agent.cox_km import fit_cox_ph, kaplan_meier_binned

lifelines = pytest.importorskip("lifelines")
pd = pytest.importorskip("pandas")
from lifelines import CoxPHFitter


def _synthetic_survival(n: int = 120, seed: int = 1):
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        treated = rng.random() < 0.5
        hazard = 0.002 * (0.7 if treated else 1.0)
        duration = int(rng.exponential(1.0 / hazard))
        event = duration < 800
        rows.append(
            {
                "followUpDays": min(duration, 800),
                "eventOccurred": bool(event),
                "treated": bool(treated),
            }
        )
    return rows


def test_cox_log_hr_on_synthetic():
    cohort = _synthetic_survival()
    out = fit_cox_ph(cohort)
    assert 0.2 < np.exp(out["log_hr"]) < 2.0
    assert out["standard_error"] > 0


def test_cox_matches_lifelines_reference():
    cohort = _synthetic_survival(n=200, seed=2)
    df = pd.DataFrame(
        {
            "duration": [r["followUpDays"] for r in cohort],
            "event": [1 if r["eventOccurred"] else 0 for r in cohort],
            "treated": [1 if r["treated"] else 0 for r in cohort],
        }
    )
    cph = CoxPHFitter()
    cph.fit(df, duration_col="duration", event_col="event")
    ours = fit_cox_ph(cohort)
    assert abs(ours["log_hr"] - float(cph.params_["treated"])) < 1e-6


def test_km_bins_minimum_width():
    cohort = _synthetic_survival()
    bins = kaplan_meier_binned(cohort, bin_width_days=30, min_at_risk=5)
    assert bins[0]["t"] == 0
    for b in bins[-3:]:
        assert b["atRisk"] >= 5 or b.get("suppressed")
