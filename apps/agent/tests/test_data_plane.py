"""Data-plane tests: spec parsing, model factory, real FedAvg, output safety."""

import math

import pytest

from medtrust_agent.scenario import default_secretflow_spec
from medtrust_agent.spec import parse_spec, SpecValidationError
from medtrust_agent.model_factory import build_model
from medtrust_agent.dataset import PartyDataset, StreamLoader
from medtrust_agent.runtime import run_task, detect_runtime


def _ckd_test_spec() -> dict:
    base = default_secretflow_spec()
    privacy = {k: v for k, v in base["privacy"].items() if k != "dpSgd"}
    return {
        **base,
        "privacy": privacy,
        "parties": [
            {"participantId": "hospital-huashan", "role": "provider"},
            {"participantId": "hospital-ruijin", "role": "provider"},
            {"participantId": "pharma-hengrui", "role": "consumer"},
        ],
        "modalities": [{"type": "dicom"}, {"type": "structured_ehr"}],
        "epochs": 4,
    }


VALID_SPEC = _ckd_test_spec()
VALID_SPEC.pop("fusionBridge", None)


def test_parse_valid_spec():
    spec = parse_spec(VALID_SPEC)
    assert [p.participant_id for p in spec.parties] == [
        "hospital-huashan",
        "hospital-ruijin",
        "pharma-hengrui",
    ]
    assert [m.type for m in spec.modalities] == ["dicom", "structured_ehr"]
    assert spec.peft_strategy.r == 8


def test_parse_yaml_snake_case():
    yaml_src = """
parties:
  - participant_id: hospital-huashan
    role: provider
modalities:
  - type: structured_ehr
llm_backbone:
  model_type: llama
  model_name_or_path: meditron-7b
peft_strategy:
  type: lora
  r: 4
  alpha: 8
  target_modules: [q_proj]
privacy:
  tee_required: false
  heu_enabled: false
output_policy:
  allowed_artifacts: [lora_delta_hash]
"""
    spec = parse_spec(yaml_src)
    assert spec.parties[0].participant_id == "hospital-huashan"
    assert spec.llm_backbone.model_type == "llama"


@pytest.mark.parametrize("mutate", [
    lambda d: d.pop("parties"),
    lambda d: d.update(parties=[]),
    lambda d: d.update(modalities=[{"type": "xray"}]),
    lambda d: d.pop("llmBackbone"),
    lambda d: d.update(peftStrategy={"type": "lora", "r": 0, "alpha": 1, "targetModules": ["x"]}),
])
def test_invalid_spec_rejected(mutate):
    d = {k: (v.copy() if isinstance(v, (list, dict)) else v) for k, v in VALID_SPEC.items()}
    mutate(d)
    with pytest.raises(SpecValidationError):
        parse_spec(d)


def test_model_built_from_modalities():
    spec = parse_spec(VALID_SPEC)
    model = build_model(spec)
    assert set(model.encoders.keys()) == {"structured_ehr", "dicom"}
    trainable = [n for n, p in model.named_parameters() if p.requires_grad]
    # Only the LoRA adapter (proj + head) trains; encoders + fusion are frozen.
    assert trainable and all("lora_" in n for n in trainable)
    assert all(not n.startswith("encoders") and not n.startswith("fusion") for n in trainable)


def test_encoder_registry_covers_all_modalities():
    from medtrust_agent.model_factory import ENCODER_REGISTRY, register_encoder

    assert {"dicom", "genomics", "clinical_text", "structured_ehr"} <= set(ENCODER_REGISTRY)
    # Registry is pluggable: a new modality is a one-liner.
    register_encoder("dummy", lambda hidden: __import__("torch").nn.Identity())
    assert "dummy" in ENCODER_REGISTRY


def test_perceiver_resampler_fusion_trains():
    d = {k: (v.copy() if isinstance(v, (list, dict)) else v) for k, v in VALID_SPEC.items()}
    d["modalities"] = [{"type": "dicom"}, {"type": "clinical_text"}, {"type": "structured_ehr"}]
    d["fusionBridge"] = {"type": "perceiver_resampler", "hiddenSize": 64, "numQueries": 4}
    result = run_task("task-perceiver", d, emit=lambda _e: None)
    assert result["roundsCompleted"] == d["epochs"]
    assert result["metrics"]["lossReduction"] > 0.05


def test_stream_loader_chunks_bounded():
    ds = PartyDataset("hospital-huashan", ["structured_ehr", "dicom"], num_samples=200)
    loader = StreamLoader(ds, chunk_size=64)
    sizes = [len(c["labels"]) for c in loader]
    assert max(sizes) <= 64
    assert sum(sizes) == 200
    assert loader.num_chunks == 4


def test_federated_training_reduces_loss_and_is_safe():
    events = []
    result = run_task("task-1", VALID_SPEC, emit=events.append)

    assert result["roundsCompleted"] == 4
    # Real learning signal: loss should drop meaningfully over rounds.
    assert result["metrics"]["lossReduction"] > 0.05
    assert result["metrics"]["trainLoss"] < result["metrics"]["initialLoss"]

    # Safe envelope: hashes present, no raw payloads.
    assert result["loraDeltaHash"].startswith("LORA:")
    assert result["privacySummary"]["safeOutputOnly"] is True
    assert result["attestation"]["runtime"] == detect_runtime()

    # Contribution shares for settlement sum to 1 (providers only).
    shares = {c["participantId"]: c["share"] for c in result["contributions"]}
    assert set(shares) == {"hospital-huashan", "hospital-ruijin"}
    assert abs(sum(shares.values()) - 1.0) < 1e-3

    # Streamed real progress events exist.
    phases = {e["phase"] for e in events}
    assert {"preparing", "training", "round_complete", "done"} <= phases


def test_determinism_same_spec_same_hash():
    r1 = run_task("task-det", VALID_SPEC, emit=lambda _e: None)
    r2 = run_task("task-det", VALID_SPEC, emit=lambda _e: None)
    assert r1["attestation"]["specHash"] == r2["attestation"]["specHash"]


def test_compensation_drops_timed_out_party():
    events = []
    result = run_task(
        "task-drop",
        VALID_SPEC,
        emit=events.append,
        should_drop=lambda pid, rnd: pid == "hospital-ruijin" and rnd == 0,
    )
    assert "hospital-ruijin" in result["privacySummary"]["droppedParties"]
    assert any(e.get("action") == "drop_node" for e in events)
    # A node dropped for a round earns a smaller contribution share.
    shares = {c["participantId"]: c["share"] for c in result["contributions"]}
    assert shares["hospital-ruijin"] < shares["hospital-huashan"]


def test_output_policy_filters_disallowed_artifacts():
    # A narrower policy shapes the output: disallowed artifacts are omitted,
    # not emitted-then-rejected (a completed run must never fail on policy).
    d = {k: (v.copy() if isinstance(v, (list, dict)) else v) for k, v in VALID_SPEC.items()}
    d["outputPolicy"] = {"allowedArtifacts": ["aggregate_metrics"]}  # no lora_delta_hash
    result = run_task("task-policy", d, emit=lambda _e: None)
    assert "metrics" in result
    assert "loraDeltaHash" not in result
    assert "encryptedDeltaRef" not in result
    assert "attestation" not in result
    # Privacy metadata is always present and safe.
    assert result["privacySummary"]["safeOutputOnly"] is True
