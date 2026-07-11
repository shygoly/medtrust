"""PSM/IPTW golden tests (task 5.2)."""

from __future__ import annotations

import numpy as np

from medtrust_agent.psm_iptw import estimate_iptw, estimate_psm


def _synthetic_cohort(n: int = 400, true_ate: float = 0.15, seed: int = 0):
    rng = np.random.default_rng(seed)
    bands = ["40-49", "50-59", "60-69"]
    cohort = []
    for _ in range(n):
        age = rng.choice(bands)
        sex = rng.choice(["M", "F"])
        age_idx = bands.index(age)
        treated = rng.random() < (0.3 + 0.15 * age_idx)
        base_risk = 0.1 + 0.05 * age_idx
        event = rng.random() < (base_risk + true_ate * treated)
        cohort.append(
            {
                "ageBand": age,
                "sex": sex,
                "treated": bool(treated),
                "eventOccurred": bool(event),
                "followUpDays": int(rng.integers(180, 800)),
            }
        )
    return cohort


def test_iptw_ate_matches_hand_calculation():
    cohort = _synthetic_cohort()
    result = estimate_iptw(cohort, covariates=["ageBand", "sex"])
    assert abs(result["ate"] - 0.15) < 0.08
    assert result["standard_error"] > 0


def test_psm_returns_finite_ate():
    cohort = _synthetic_cohort(n=200)
    result = estimate_psm(cohort, covariates=["ageBand", "sex"])
    assert -1.0 < result["ate"] < 1.0
    assert result["standard_error"] > 0
