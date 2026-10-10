from trainer import digest, train_local_party


def test_digest_format():
    assert digest("LOCAL", "abc").startswith("LOCAL:")


def test_mock_train_without_rows():
    spec = {
        "modality": "structured_ehr",
        "modelType": "xgboost",
        "targetColumn": "esrd_event",
        "featureColumns": [{"name": "egfr", "dtype": "numeric"}],
        "rounds": 5,
    }
    result = train_local_party(
        task_id="t1",
        participant_id="p-demohospa",
        spec_hash="FL:deadbeef",
        sample_count=59,
        spec=spec,
        tabular_rows=[],
    )
    assert result["participantId"] == "p-demohospa"
    assert result["localMetrics"]["auc"] > 0


def test_sklearn_train_with_ckd_rows():
    spec = {
        "modality": "structured_ehr",
        "modelType": "logistic_regression",
        "targetColumn": "esrd_event",
        "featureColumns": [
            {"name": "egfr", "dtype": "numeric"},
            {"name": "scr", "dtype": "numeric"},
            {"name": "uacr", "dtype": "numeric"},
            {"name": "ckd_stage", "dtype": "categorical", "categories": ["G1", "G2", "G3", "G4", "G5"]},
            {"name": "bp_systolic", "dtype": "numeric"},
        ],
        "rounds": 5,
    }
    rows = []
    for i in range(48):
        stage = 1 + (i % 5)
        rows.append(
            {
                "egfr": 110 - stage * 18 + (i % 7),
                "scr": 70 + stage * 22,
                "uacr": 20 + stage * 40,
                "ckd_stage": f"G{stage}",
                "bp_systolic": 115 + stage * 5,
                "esrd_event": stage >= 5 or (stage >= 4 and i % 3 == 0),
            }
        )
    result = train_local_party(
        task_id="t-ckd",
        participant_id="p-demohospa",
        spec_hash="FL:ckd",
        sample_count=48,
        spec=spec,
        tabular_rows=rows,
    )
    assert result["trainingMode"] == "sklearn"
    assert result["sampleCount"] == 48
    assert result["localMetrics"]["auc"] > 0.5


def test_sklearn_train_with_rows():
    spec = {
        "modality": "structured_ehr",
        "modelType": "logistic_regression",
        "targetColumn": "label",
        "featureColumns": [
            {"name": "f1", "dtype": "numeric"},
            {"name": "f2", "dtype": "numeric"},
        ],
        "rounds": 3,
    }
    rows = []
    for i in range(40):
        rows.append({"f1": i % 5, "f2": (i * 2) % 7, "label": i % 2})
    result = train_local_party(
        task_id="t2",
        participant_id="p-demohospb",
        spec_hash="FL:abc",
        sample_count=40,
        spec=spec,
        tabular_rows=rows,
    )
    assert result["sampleCount"] == 40
    assert "accuracy" in result["localMetrics"] or "auc" in result["localMetrics"]
