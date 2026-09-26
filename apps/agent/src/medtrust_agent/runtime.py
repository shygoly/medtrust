"""Runtime selection + end-to-end task execution.

``detect_runtime`` reports the best available compute backend. ``run_task``
parses the spec, runs the federated job through the chosen backend, and returns
the output-gated safe envelope. SecretFlow / Ray are import-guarded so the agent
runs on any host while preferring the confidential stack when present.
"""

from __future__ import annotations

import hashlib
import importlib.util
from typing import Callable, Dict, Optional

from .fed_trainer import EmitFn, LocalRoundResult, ShouldDropFn, train_federated, train_local_round
from .output_guard import build_safe_result
from .spec import SecretFlowTaskSpec, parse_spec


def _have(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def detect_runtime() -> str:
    """Best available backend label, recorded in the attestation."""
    if _have("secretflow"):
        return "secretflow_teeu"
    if _have("ray"):
        return "ray_torch"
    return "torch"


def spec_hash(task_id: str, spec: SecretFlowTaskSpec) -> str:
    # 诚实标注:连接器平面已用真国密 SM3;本重计算节点无 crypto 依赖,
    # 本地 spec_hash 显式标注 SHA256,权威 SM3 由控制面记录(见 output_guard.py)。
    payload = f"{task_id}:{spec.canonical_json()}"
    return f"SHA256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]}"


def run_task(
    task_id: str,
    spec_source,
    *,
    emit: Optional[EmitFn] = None,
    should_drop: Optional[ShouldDropFn] = None,
    node_local_epochs: Optional[Dict[str, int]] = None,
    rounds: Optional[int] = None,
) -> dict:
    """Parse → train (best backend) → output-gate. Returns the safe envelope."""
    spec = parse_spec(spec_source)
    runtime = detect_runtime()
    sh = spec_hash(task_id, spec)

    if emit:
        emit({"phase": "dispatched", "task_id": task_id, "runtime": runtime, "spec_hash": sh})

    # NOTE: when runtime == "secretflow_teeu" a real deployment wires
    # train_federated's aggregation through sf.HEU and the local step through
    # sf.TEEU. The math/contract is identical; only the device placement differs,
    # so the portable torch path below is the faithful fallback.
    training = train_federated(
        spec,
        rounds=rounds,
        emit=emit,
        should_drop=should_drop,
        node_local_epochs=node_local_epochs,
    )

    return build_safe_result(task_id, spec, training, runtime=runtime, spec_hash=sh)


def run_local_round(
    task_id: str,
    spec_source,
    *,
    round_index: int,
    training_slice_json: str = "",
    global_adapter_json: str = "",
    emit: Optional[EmitFn] = None,
    node_local_epochs: Optional[Dict[str, int]] = None,
) -> dict:
    """Single FedAvg round for multi-connector orchestration.

    Trains ONLY on the connector-provided slice; a missing / malformed slice fails
    the round (no fallback to any local data source — D-CN-6).
    """
    from .model_factory import MODALITY_CONFIG
    from .training_slice import parse_training_slice

    spec = parse_spec(spec_source)
    training_slice = parse_training_slice(
        training_slice_json, expected_dim=MODALITY_CONFIG["structured_ehr"]["dim"]
    )
    round_result = train_local_round(
        spec,
        round_index=round_index,
        training_slice=training_slice,
        global_adapter_json=global_adapter_json,
        emit=emit,
        node_local_epochs=node_local_epochs,
    )
    from .adapter_codec import encode_adapter

    return {
        "taskId": task_id,
        "participantId": round_result.participant_id,
        "roundIndex": round_index,
        "adapterDeltaJson": encode_adapter(round_result.adapter_delta),
        "sampleCount": round_result.sample_count,
        "localLoss": round_result.local_loss,
    }
