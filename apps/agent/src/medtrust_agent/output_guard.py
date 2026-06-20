"""Output gate for SecretFlow runs.

Produces the same safe envelope shape as the TypeScript
``SecretFlowRunResult`` and asserts that nothing outside the spec's
``allowedArtifacts`` policy — and nothing resembling raw data, unencrypted
gradients, or embeddings — is ever emitted.
"""

from __future__ import annotations

import hashlib
import json
from typing import Dict, List

import torch

from .fed_trainer import FedTrainingResult
from .spec import SecretFlowTaskSpec

# Keys that must NEVER appear in an output envelope (defence in depth).
_FORBIDDEN_KEYS = {
    "raw", "rows", "patients", "dicom", "vcf", "pixels", "image", "embedding",
    "embeddings", "gradient", "gradients", "features", "dataset",
}


def _sm3_like(prefix: str, payload: str) -> str:
    # SM3 isn't in the Python stdlib; sha256 stands in and is clearly prefixed
    # so the hash family is auditable. The control plane records its own SM3.
    return f"{prefix}:{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]}"


def _adapter_fingerprint(adapter: Dict[str, torch.Tensor]) -> str:
    flat = torch.cat([v.flatten() for v in sorted_tensors(adapter)])
    rounded = torch.round(flat * 1e4) / 1e4
    return hashlib.sha256(rounded.numpy().tobytes()).hexdigest()


def sorted_tensors(adapter: Dict[str, torch.Tensor]) -> List[torch.Tensor]:
    return [adapter[k] for k in sorted(adapter)]


class OutputPolicyViolation(RuntimeError):
    pass


def build_safe_result(
    task_id: str,
    spec: SecretFlowTaskSpec,
    training: FedTrainingResult,
    runtime: str,
    spec_hash: str,
) -> dict:
    fingerprint = _adapter_fingerprint(training.final_adapter)
    allowed = set(spec.allowed_artifacts)

    # Always-safe metadata (not a model artifact): identity + privacy posture +
    # accounting. Contributions are relative shares (Σ=1), not absolute cohort
    # sizes — enough to drive settlement without leaking dataset volumes.
    result = {
        "taskId": task_id,
        "roundsCompleted": training.rounds_completed,
        "privacySummary": {
            "teeRequired": spec.privacy.tee_required,
            "heuEnabled": spec.privacy.heu_enabled,
            "dpSgdEnabled": spec.privacy.dp_sgd is not None,
            "droppedParties": training.dropped_parties,
            "safeOutputOnly": True,
        },
        "contributions": [
            {"participantId": pid, "share": share}
            for pid, share in sorted(training.contributions.items())
        ],
    }

    # outputPolicy.allowedArtifacts is a whitelist that *shapes* the output:
    # disallowed artifacts are simply omitted, never emitted-then-rejected.
    if "aggregate_metrics" in allowed:
        result["metrics"] = {k: round(float(v), 6) for k, v in training.metrics.items()}
    if "lora_delta_hash" in allowed:
        result["loraDeltaHash"] = _sm3_like("LORA", fingerprint)
    if "encrypted_delta_ref" in allowed:
        result["encryptedDeltaRef"] = _sm3_like("ENC", f"{fingerprint}:delta")
    if "attestation_report" in allowed:
        result["attestation"] = {
            "reportHash": _sm3_like("ATT", f"{spec_hash}:{fingerprint}:report"),
            "runtime": runtime,
            "specHash": spec_hash,
        }
    if "model_card" in allowed:
        result["modelCard"] = {
            "modelType": spec.llm_backbone.model_type,
            "modelNameOrPath": spec.llm_backbone.model_name_or_path,
            "peftType": spec.peft_strategy.type,
        }

    _assert_safe(result, spec.allowed_artifacts)
    return result


def _assert_safe(result: dict, allowed_artifacts: List[str]) -> None:
    # 1. No forbidden keys anywhere in the envelope.
    def walk(node) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if k.lower() in _FORBIDDEN_KEYS:
                    raise OutputPolicyViolation(f"forbidden output key: {k}")
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(result)

    # 2. Artifacts present must be covered by policy.
    if "lora_delta_hash" not in allowed_artifacts and result.get("loraDeltaHash"):
        raise OutputPolicyViolation("loraDeltaHash emitted but not in allowedArtifacts")
    if "encrypted_delta_ref" not in allowed_artifacts and result.get("encryptedDeltaRef"):
        raise OutputPolicyViolation("encryptedDeltaRef emitted but not in allowedArtifacts")
    if "attestation_report" not in allowed_artifacts and result.get("attestation"):
        raise OutputPolicyViolation("attestation emitted but not in allowedArtifacts")

    # 3. Serialisable (no tensors / objects leaked through).
    json.dumps(result)
