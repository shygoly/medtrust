#!/usr/bin/env python3
"""Independent, stdlib-only reference review for synthetic registration ECA data.

This implementation intentionally does not import the TypeScript or WebAssembly
estimator. It reads the same source partitions and answer key, then performs a
separate logistic propensity fit, overlap trimming and IPTW-ATT calculation.
Synthetic results remain method-validation data only.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


def _read_records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{path} must contain a JSON array")
    return data


def load_cohorts(fixtures: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    trial = _read_records(fixtures / "trial" / "records.json")
    primary = _read_records(fixtures / "control-primary" / "records.json")
    secondary = _read_records(fixtures / "control-secondary" / "records.json")
    answer_key = json.loads((fixtures / "answer-key.json").read_text(encoding="utf-8"))
    controls = primary + secondary
    trial_links = {row["linkKey"] for row in trial}
    control_links = {row["linkKey"] for row in controls}
    if trial_links & control_links:
        raise ValueError("trial/control linkKey partitions overlap")
    if len(trial_links) != len(trial) or len(control_links) != len(controls):
        raise ValueError("duplicate linkKey within a source partition")
    if not trial or not controls:
        raise ValueError("both trial and control cohorts must be non-empty")
    return trial, controls, answer_key


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    n = len(vector)
    a = [matrix[i][:] + [vector[i]] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda row: abs(a[row][col]))
        if abs(a[pivot][col]) < 1e-12:
            raise ValueError("propensity model is singular")
        a[col], a[pivot] = a[pivot], a[col]
        divisor = a[col][col]
        for k in range(col, n + 1):
            a[col][k] /= divisor
        for row in range(n):
            if row == col:
                continue
            factor = a[row][col]
            for k in range(col, n + 1):
                a[row][k] -= factor * a[col][k]
    return [a[i][n] for i in range(n)]


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1 / (1 + math.exp(-value))
    exponent = math.exp(value)
    return exponent / (1 + exponent)


def fit_logistic(design: list[list[float]], labels: list[int]) -> list[float]:
    dimensions = len(design[0])
    beta = [0.0] * dimensions
    for _ in range(30):
        probabilities = [
            _sigmoid(sum(x * b for x, b in zip(row, beta))) for row in design
        ]
        matrix = [[0.0] * dimensions for _ in range(dimensions)]
        vector = [0.0] * dimensions
        for row, label, probability in zip(design, labels, probabilities):
            variance = max(1e-9, probability * (1 - probability))
            for i in range(dimensions):
                vector[i] += row[i] * (label - probability)
                for j in range(dimensions):
                    matrix[i][j] += row[i] * row[j] * variance
        for i in range(dimensions):
            matrix[i][i] += 1e-7
        update = _solve(matrix, vector)
        beta = [old + delta for old, delta in zip(beta, update)]
        if max(abs(value) for value in update) < 1e-8:
            return beta
    raise ValueError("propensity model did not converge")


def _weighted_mean(values: list[float], weights: list[float]) -> float:
    total = sum(weights)
    if total <= 0:
        raise ValueError("weighted mean has zero denominator")
    return sum(value * weight for value, weight in zip(values, weights)) / total


def _weighted_variance(values: list[float], weights: list[float], center: float) -> float:
    total = sum(weights)
    return sum(weight * (value - center) ** 2 for value, weight in zip(values, weights)) / total


def _smd(
    treated_values: list[float],
    control_values: list[float],
    treated_weights: list[float],
    control_weights: list[float],
) -> float:
    treated_mean = _weighted_mean(treated_values, treated_weights)
    control_mean = _weighted_mean(control_values, control_weights)
    treated_variance = _weighted_variance(treated_values, treated_weights, treated_mean)
    control_variance = _weighted_variance(control_values, control_weights, control_mean)
    denominator = math.sqrt(max(1e-12, (treated_variance + control_variance) / 2))
    return (treated_mean - control_mean) / denominator


def analyze(
    trial: list[dict[str, Any]],
    controls: list[dict[str, Any]],
    *,
    covariates: list[str],
    truth_rr: float | None,
    trim_low: float = 0.05,
    trim_high: float = 0.95,
) -> dict[str, Any]:
    rows = [{**row, "_treated": 1} for row in trial] + [
        {**row, "_treated": 0} for row in controls
    ]
    rows = [
        row
        for row in rows
        if row.get("eligibleAtTimeZero") is True
        and row.get("outcome") in {"pos", "neg"}
        and isinstance(row.get("followUpDays"), int)
        and row["followUpDays"] >= 0
    ]
    if not rows:
        raise ValueError("no eligible rows")

    missing: dict[str, int] = {}
    columns: dict[str, list[float]] = {}
    for covariate in covariates:
        observed = [
            float(row[covariate])
            for row in rows
            if isinstance(row.get(covariate), (int, float))
            and math.isfinite(float(row[covariate]))
        ]
        if not observed:
            raise ValueError(f"covariate {covariate} has no observed values")
        missing[covariate] = len(rows) - len(observed)
        center = sum(observed) / len(observed)
        columns[covariate] = [
            float(row[covariate])
            if isinstance(row.get(covariate), (int, float))
            and math.isfinite(float(row[covariate]))
            else center
            for row in rows
        ]

    scales: list[tuple[float, float]] = []
    for covariate in covariates:
        values = columns[covariate]
        center = sum(values) / len(values)
        variance = sum((value - center) ** 2 for value in values) / max(1, len(values) - 1)
        scales.append((center, math.sqrt(variance) or 1.0))
    design = [
        [1.0]
        + [
            (columns[covariate][index] - scales[col][0]) / scales[col][1]
            for col, covariate in enumerate(covariates)
        ]
        for index in range(len(rows))
    ]
    labels = [row["_treated"] for row in rows]
    beta = fit_logistic(design, labels)
    propensity = [
        _sigmoid(sum(value * coefficient for value, coefficient in zip(row, beta)))
        for row in design
    ]
    kept = [
        index
        for index, probability in enumerate(propensity)
        if trim_low <= probability <= trim_high
    ]
    if len(kept) < 20:
        raise ValueError("effective cohort too small after overlap trimming")
    weights = [
        1.0 if rows[index]["_treated"] == 1 else propensity[index] / (1 - propensity[index])
        for index in kept
    ]
    if not any(rows[index]["_treated"] == 1 for index in kept) or not any(
        rows[index]["_treated"] == 0 for index in kept
    ):
        raise ValueError("positivity failure after trimming")

    treated_idx = [index for index in kept if rows[index]["_treated"] == 1]
    control_idx = [index for index in kept if rows[index]["_treated"] == 0]
    treated_weights = [
        1.0 if rows[index]["_treated"] == 1 else propensity[index] / (1 - propensity[index])
        for index in treated_idx
    ]
    control_weights = [propensity[index] / (1 - propensity[index]) for index in control_idx]
    treated_outcomes = [1.0 if rows[index]["outcome"] == "pos" else 0.0 for index in treated_idx]
    control_outcomes = [1.0 if rows[index]["outcome"] == "pos" else 0.0 for index in control_idx]
    risk_treated = sum(treated_outcomes) / len(treated_outcomes)
    risk_control = _weighted_mean(control_outcomes, control_weights)
    risk_ratio = risk_treated / risk_control if risk_control > 0 else None
    risk_difference = risk_treated - risk_control

    crude_risk_treated = sum(
        1 for row in trial if row.get("outcome") == "pos"
    ) / len(trial)
    crude_controls = controls
    crude_risk_control = sum(
        1 for row in crude_controls if row.get("outcome") == "pos"
    ) / len(crude_controls)
    crude_rr = (
        crude_risk_treated / crude_risk_control if crude_risk_control > 0 else None
    )

    balance = []
    for covariate in covariates:
        values = columns[covariate]
        balance.append(
            {
                "covariate": covariate,
                "smdBefore": _smd(
                    [values[index] for index in range(len(rows)) if rows[index]["_treated"] == 1],
                    [values[index] for index in range(len(rows)) if rows[index]["_treated"] == 0],
                    [1.0] * labels.count(1),
                    [1.0] * labels.count(0),
                ),
                "smdAfter": _smd(
                    [values[index] for index in treated_idx],
                    [values[index] for index in control_idx],
                    treated_weights,
                    control_weights,
                ),
            }
        )

    adjusted_error = (
        abs(risk_ratio - truth_rr)
        if risk_ratio is not None and truth_rr is not None
        else None
    )
    crude_error = (
        abs(crude_rr - truth_rr)
        if crude_rr is not None and truth_rr is not None
        else None
    )
    return {
        "syntheticOnly": True,
        "analysisType": "independent-python-review",
        "n": {
            "trial": len(trial),
            "control": len(controls),
            "afterTrim": len(kept),
            "trimmed": len(rows) - len(kept),
        },
        "missing": {
            "cells": sum(missing.values()),
            "byCovariate": missing,
        },
        "propensity": {
            "min": min(propensity),
            "max": max(propensity),
            "trimLow": trim_low,
            "trimHigh": trim_high,
        },
        "weights": {
            "max": max(weights),
            "treatedESS": len(treated_idx),
            "controlESS": sum(control_weights) ** 2
            / sum(weight * weight for weight in control_weights),
        },
        "effect": {
            "riskTreated": risk_treated,
            "riskControl": risk_control,
            "riskRatio": risk_ratio,
            "riskDifference": risk_difference,
        },
        "crude": {
            "riskTreated": crude_risk_treated,
            "riskControl": crude_risk_control,
            "riskRatio": crude_rr,
        },
        "balance": balance,
        "truth": {
            "rr": truth_rr,
            "adjustedAbsoluteError": adjusted_error,
            "crudeAbsoluteError": crude_error,
            "adjustedCloser": (
                adjusted_error is not None
                and crude_error is not None
                and adjusted_error < crude_error
            ),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--trim-low", type=float, default=0.05)
    parser.add_argument("--trim-high", type=float, default=0.95)
    args = parser.parse_args()

    trial, controls, answer_key = load_cohorts(args.fixtures)
    study = answer_key.get("design", {})
    covariates = answer_key.get("params", {}).get(
        "confounders",
        ["age", "severity", "diseaseDuration", "comorbidityIndex", "priorTreatment", "keyBiomarker", "calendarYear"],
    )
    truth_rr = answer_key.get("truth", {}).get("rr")
    report = analyze(
        trial,
        controls,
        covariates=list(covariates),
        truth_rr=truth_rr,
        trim_low=args.trim_low,
        trim_high=args.trim_high,
    )
    report["study"] = study
    text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text, encoding="utf-8")
    print(text, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
