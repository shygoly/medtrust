"""Local PSM / IPTW estimators for L3 causal tasks (5.2)."""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

import numpy as np


def _feature_matrix(cohort: Sequence[Dict[str, Any]], covariates: Sequence[str]) -> np.ndarray:
    rows: List[List[float]] = []
    age_order = ["0-17", "18-29", "30-39", "40-49", "50-59", "60-69", "70+"]
    for row in cohort:
        feats: List[float] = []
        for cov in covariates:
            val = row.get(cov, "")
            if cov == "ageBand":
                feats.append(float(age_order.index(val) if val in age_order else len(age_order) // 2))
            elif cov == "sex":
                feats.append(1.0 if val == "M" else 0.0)
            else:
                feats.append(float(abs(hash(str(val))) % 100) / 100.0)
        rows.append(feats)
    return np.array(rows, dtype=float)


def _outcome_vector(cohort: Sequence[Dict[str, Any]]) -> np.ndarray:
    return np.array([1.0 if row.get("eventOccurred") else 0.0 for row in cohort], dtype=float)


def _treated_vector(cohort: Sequence[Dict[str, Any]]) -> np.ndarray:
    return np.array([1.0 if row.get("treated") else 0.0 for row in cohort], dtype=float)


def estimate_iptw(
    cohort: Sequence[Dict[str, Any]],
    covariates: Optional[Sequence[str]] = None,
    *,
    _bootstrap: bool = True,
) -> Dict[str, float]:
    from sklearn.linear_model import LogisticRegression

    covariates = list(covariates or ["ageBand", "sex"])
    if len(cohort) < 10:
        return {"ate": 0.0, "standard_error": 0.1}

    X = _feature_matrix(cohort, covariates)
    T = _treated_vector(cohort)
    Y = _outcome_vector(cohort)

    lr = LogisticRegression(max_iter=500, solver="lbfgs")
    lr.fit(X, T)
    ps = np.clip(lr.predict_proba(X)[:, 1], 0.05, 0.95)
    w = np.where(T > 0.5, 1.0 / ps, 1.0 / (1.0 - ps))
    w /= w.mean()

    treated_mask = T > 0.5
    control_mask = ~treated_mask
    treated_mean = float(np.average(Y[treated_mask], weights=w[treated_mask])) if treated_mask.any() else 0.0
    control_mean = float(np.average(Y[control_mask], weights=w[control_mask])) if control_mask.any() else 0.0
    ate = treated_mean - control_mean

    if not _bootstrap:
        return {"ate": ate, "standard_error": max(abs(ate) * 0.2, 0.05)}

    rng = np.random.default_rng(42)
    boots: List[float] = []
    n = len(cohort)
    for _ in range(50):
        idx = rng.integers(0, n, n)
        sub = [cohort[i] for i in idx]
        try:
            boots.append(estimate_iptw(sub, covariates, _bootstrap=False)["ate"])
        except Exception:
            pass
    se = float(np.std(boots, ddof=1)) if len(boots) > 5 else max(abs(ate) * 0.2, 0.05)
    return {"ate": ate, "standard_error": se}


def estimate_psm(
    cohort: Sequence[Dict[str, Any]],
    covariates: Optional[Sequence[str]] = None,
) -> Dict[str, float]:
    from sklearn.linear_model import LogisticRegression

    covariates = list(covariates or ["ageBand", "sex"])
    if len(cohort) < 10:
        return {"ate": 0.0, "standard_error": 0.1}

    X = _feature_matrix(cohort, covariates)
    T = _treated_vector(cohort)
    Y = _outcome_vector(cohort)

    lr = LogisticRegression(max_iter=500, solver="lbfgs")
    lr.fit(X, T)

    treated_idx = np.where(T > 0.5)[0]
    control_idx = np.where(T <= 0.5)[0]
    matched_y_t: List[float] = []
    matched_y_c: List[float] = []
    used_c: set[int] = set()
    for ti in treated_idx:
        candidates = [cj for cj in control_idx if cj not in used_c]
        if not candidates:
            break
        cj = min(candidates, key=lambda c: float(np.linalg.norm(X[ti] - X[c])))
        used_c.add(cj)
        matched_y_t.append(float(Y[ti]))
        matched_y_c.append(float(Y[cj]))

    if not matched_y_t:
        return {"ate": 0.0, "standard_error": 0.1}

    ate = float(np.mean(matched_y_t) - np.mean(matched_y_c))
    diff = np.array(matched_y_t) - np.array(matched_y_c)
    se = float(np.std(diff, ddof=1) / math.sqrt(len(diff))) if len(diff) > 1 else 0.1
    return {"ate": ate, "standard_error": se}
