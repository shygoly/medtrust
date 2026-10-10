"""omop-data-source-access 4.3 —— agent 只用连接器给的训练切片，不自行读取院内数据。"""

import json

import pytest

from medtrust_agent.spec import SpecValidationError, parse_spec
from medtrust_agent.training_slice import TrainingSliceError, parse_training_slice

DIM = 7


def _slice(n=6, **overrides):
    body = {
        "schema": "esrd-proxy@1",
        "featureKeys": [f"f{i}" for i in range(DIM)],
        "rows": [[float(i + j) for j in range(DIM)] for i in range(n)],
        "labels": [i % 2 for i in range(n)],
    }
    body.update(overrides)
    return json.dumps(body)


def _spec(**extra):
    spec = {
        "parties": [{"participantId": "p-demohospa", "role": "provider"}],
        "modalities": [{"type": "structured_ehr"}],
        "llmBackbone": {"modelType": "tiny", "modelNameOrPath": "tiny"},
        "peftStrategy": {"type": "lora", "r": 4, "alpha": 8, "targetModules": ["q"]},
        "privacy": {"teeRequired": False, "heuEnabled": False},
        "outputPolicy": {"allowedArtifacts": ["lora_delta_hash"]},
        "epochs": 1,
    }
    spec.update(extra)
    return spec


# ── 结构校验（不依赖 torch）───────────────────────────────────────────────────


def test_valid_slice_parses():
    s = parse_training_slice(_slice(), expected_dim=DIM)
    assert len(s) == 6 and s.schema == "esrd-proxy@1" and s.labels[:2] == [0, 1]


def test_missing_slice_fails_closed():
    for raw in ("", "   "):
        with pytest.raises(TrainingSliceError, match="未提供训练切片"):
            parse_training_slice(raw, expected_dim=DIM)


def test_slice_rejects_anything_beyond_features_and_labels():
    body = json.loads(_slice())
    body["subjectKeys"] = ["sk_1"] * 6
    with pytest.raises(TrainingSliceError, match="不允许的字段"):
        parse_training_slice(json.dumps(body), expected_dim=DIM)


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"featureKeys": ["a", "b"]}, "维数"),
        ({"rows": []}, "没有任何记录"),
        ({"labels": [0, 1]}, "等长"),
        ({"rows": [[1.0] * DIM, ["x"] * DIM], "labels": [0, 1]}, "有限数值"),
        ({"rows": [[1.0] * DIM, [float("nan")] * DIM], "labels": [0, 1]}, "有限数值"),
        ({"rows": [[1.0] * DIM], "labels": [2]}, "0 或 1"),
        ({"rows": [[1.0] * DIM], "labels": [True]}, "0 或 1"),
        ({"schema": ""}, "schema"),
    ],
)
def test_malformed_slices_rejected(overrides, message):
    # json.dumps 把 nan 写成 NaN、json.loads 又读回 nan——有限性检查必须自己兜住。
    with pytest.raises(TrainingSliceError, match=message):
        parse_training_slice(_slice(**overrides), expected_dim=DIM)


def test_spec_may_not_steer_agent_to_a_data_path():
    parse_spec(_spec())  # 正常 spec 可解析
    for key in ("dataPath", "data_path"):
        with pytest.raises(SpecValidationError, match="dataPath 已废弃"):
            parse_spec(_spec(**{key: "/data/synthea/ingested"}))


def test_agent_no_longer_ships_a_file_loader():
    import importlib.util

    assert importlib.util.find_spec("medtrust_agent.synthea_loader") is None


# ── 训练路径（依赖 torch）─────────────────────────────────────────────────────


def test_dataset_built_from_slice_only():
    torch = pytest.importorskip("torch")
    from medtrust_agent.dataset import PartyDataset

    s = parse_training_slice(_slice(n=10), expected_dim=DIM)
    ds = PartyDataset("p-demohospa", ["structured_ehr", "clinical_text"], 4, use_party_modalities=False, training_slice=s)
    assert len(ds) == 4  # 采样上限照旧由 agent 施加
    assert ds.data_source == "connector-slice:esrd-proxy@1"
    assert torch.equal(ds.features["structured_ehr"][1], torch.tensor([1.0 + j for j in range(DIM)]))
    assert ds.labels.tolist() == [0, 1, 0, 1]


def _round_spec() -> str:
    # 与 test_data_plane 同法取真实场景的模型配置，只改参与方与模态。
    from medtrust_agent.scenario import default_secretflow_spec

    base = default_secretflow_spec()
    privacy = {k: v for k, v in base["privacy"].items() if k != "dpSgd"}
    spec = {
        **base,
        "privacy": privacy,
        "parties": [{"participantId": "p-demohospa", "role": "provider"}],
        "modalities": [{"type": "structured_ehr"}, {"type": "clinical_text"}],
        "epochs": 1,
    }
    spec.pop("fusionBridge", None)
    return json.dumps(spec)


def test_local_round_trains_on_slice_and_fails_without_it(monkeypatch):
    pytest.importorskip("torch")
    from medtrust_agent.runtime import run_local_round

    monkeypatch.setenv("AGENT_LOCAL_PARTY", "p-demohospa")
    spec = _round_spec()
    out = run_local_round("t::p-demohospa", spec, round_index=0, training_slice_json=_slice(n=12))
    assert out["sampleCount"] == 12
    assert out["adapterDeltaJson"]

    with pytest.raises(TrainingSliceError, match="未提供训练切片"):
        run_local_round("t::p-demohospa", spec, round_index=0, training_slice_json="")
