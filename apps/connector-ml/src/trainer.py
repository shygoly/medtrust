"""Local party tabular FL training for connector-ml sidecar."""

from __future__ import annotations

import hashlib
from typing import Any

from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import numpy as np


def digest(prefix: str, value: str) -> str:
    digest_hex = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
    return f"{prefix}:{digest_hex}"


def _mock_metrics(spec_hash: str, participant_id: str, sample_count: int, rounds: int) -> dict[str, Any]:
    seed = f"{spec_hash}:{participant_id}"
    base = 0.68 + (len(seed) % 12) / 100
    return {
        "taskId": "",
        "participantId": participant_id,
        "roundsCompleted": rounds,
        "sampleCount": sample_count,
        "localModelHash": digest("LOCAL", f"{spec_hash}:{participant_id}"),
        "localMetrics": {
            "auc": round(base + 0.06, 4),
            "f1": round(base - 0.03, 4),
            "precision": round(base - 0.02, 4),
            "recall": round(base + 0.01, 4),
        },
    }


def _encode_features(
    rows: list[dict[str, Any]],
    feature_columns: list[dict[str, Any]],
    target_column: str,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    names = [col["name"] for col in feature_columns]
    x_rows: list[list[float]] = []
    y_rows: list[Any] = []

    for row in rows:
        if target_column not in row:
            continue
        features: list[float] = []
        skip = False
        for col in feature_columns:
            name = col["name"]
            raw = row.get(name)
            if raw is None:
                skip = True
                break
            dtype = col.get("dtype", "numeric")
            if dtype == "boolean":
                features.append(1.0 if raw else 0.0)
            elif dtype == "categorical":
                categories = col.get("categories") or []
                if categories and raw in categories:
                    features.append(float(categories.index(raw)))
                else:
                    features.append(float(hash(str(raw)) % 997) / 997.0)
            else:
                features.append(float(raw))
        if skip:
            continue
        x_rows.append(features)
        y_rows.append(row[target_column])

    if len(x_rows) < 8:
        raise ValueError("insufficient labeled rows for local training")

    y_array = np.array(y_rows)
    if np.unique(y_array).size < 2:
        raise ValueError("target column needs at least two classes")

    label_encoder = LabelEncoder()
    y_encoded = label_encoder.fit_transform(y_array)
    return np.array(x_rows, dtype=float), y_encoded, names


def _build_estimator(model_type: str):
    if model_type == "logistic_regression":
        return LogisticRegression(max_iter=500)
    if model_type == "random_forest":
        return RandomForestClassifier(n_estimators=50, max_depth=6, random_state=42)
    if model_type == "xgboost":
        try:
            from xgboost import XGBClassifier  # type: ignore

            return XGBClassifier(
                n_estimators=80,
                max_depth=4,
                learning_rate=0.08,
                eval_metric="logloss",
                random_state=42,
            )
        except ImportError:
            pass
    return RandomForestClassifier(n_estimators=100, max_depth=4, random_state=42)


def train_local_party(
    *,
    task_id: str,
    participant_id: str,
    spec_hash: str,
    sample_count: int,
    spec: dict[str, Any],
    tabular_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    rounds = int(spec.get("rounds") or 1)
    model_type = str(spec.get("modelType") or "xgboost")
    target_column = str(spec.get("targetColumn") or "")
    feature_columns = list(spec.get("featureColumns") or [])

    rows = tabular_rows or []
    effective_count = len(rows) if rows else sample_count

    if len(rows) >= 8 and target_column and feature_columns:
        try:
            x, y, feature_names = _encode_features(rows, feature_columns, target_column)
            x_train, x_test, y_train, y_test = train_test_split(
                x, y, test_size=0.25, random_state=42, stratify=y
            )
            estimator = _build_estimator(model_type)
            estimator.fit(x_train, y_train)
            if hasattr(estimator, "predict_proba"):
                proba = estimator.predict_proba(x_test)[:, 1]
                auc = float(roc_auc_score(y_test, proba))
            else:
                auc = float(accuracy_score(y_test, estimator.predict(x_test)))
            preds = estimator.predict(x_test)
            metrics = {
                "auc": round(auc, 4),
                "f1": round(float(f1_score(y_test, preds, average="binary")), 4),
                "precision": round(float(precision_score(y_test, preds, average="binary")), 4),
                "recall": round(float(recall_score(y_test, preds, average="binary")), 4),
                "accuracy": round(float(accuracy_score(y_test, preds)), 4),
            }
            model_hash = digest(
                "LOCAL",
                f"{spec_hash}:{participant_id}:{','.join(feature_names)}:{model_type}",
            )
            return {
                "taskId": task_id,
                "participantId": participant_id,
                "roundsCompleted": rounds,
                "sampleCount": effective_count,
                "localModelHash": model_hash,
                "localMetrics": metrics,
                "trainingMode": "sklearn",
            }
        except (ValueError, TypeError):
            pass

    mocked = _mock_metrics(spec_hash, participant_id, effective_count, rounds)
    mocked["taskId"] = task_id
    mocked["trainingMode"] = "mock"
    return mocked
