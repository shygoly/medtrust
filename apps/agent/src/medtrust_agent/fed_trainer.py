"""Real federated-averaging trainer for the configurable multimodal model.

Each round every party runs genuine local SGD over chunked data, then the
trainable LoRA adapters are aggregated (sample-weighted FedAvg). Privacy hooks:

* ``dp_sgd``       → DP-SGD inside every local optimizer step (see ``dp_sgd.py``):
  per-example clipping to ``clipNorm``, one N(0, (z·C)²) draw on the clipped sum,
  averaged over the batch. The round delta itself is not noised again.
* ``heu_enabled``  → carried into the privacy posture only. This torch runtime does
  NOT mask or encrypt deltas; ``heuEnabled: true`` must not be read as "masked".

Compensation (§5.1): a party whose ``should_drop`` predicate fires — or whose
local step raises — is excluded from that round's aggregate instead of stalling
the whole job.
"""

from __future__ import annotations

import copy
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

import torch
import torch.nn.functional as F

from .adapter_codec import decode_adapter
from .dataset import PartyDataset, StreamLoader
from .dp_sgd import assign_flat_grad, dp_sgd_gradient, fresh_noise_generator, trainable_parameters
from .model_factory import ConfigurableMultimodalLLM, build_model
from .spec import DpSgd, SecretFlowTaskSpec
from .training_slice import TrainingSlice
from . import config

EmitFn = Callable[[dict], None]
ShouldDropFn = Callable[[str, int], bool]  # (participant_id, round_index) -> drop?


@dataclass
class LocalRoundResult:
    participant_id: str
    adapter_delta: Dict[str, torch.Tensor]
    sample_count: int
    local_loss: float


@dataclass
class FedTrainingResult:
    rounds_completed: int
    final_adapter: Dict[str, torch.Tensor]
    metrics: Dict[str, float]
    per_round_loss: List[float]
    dropped_parties: List[str]
    # Normalized per-party contribution share (Σ = 1) — drives settlement.
    # Weighted by data volume × rounds actually participated, so a frequently
    # dropped node earns a smaller share.
    contributions: Dict[str, float]


def _adapter_delta(after: Dict[str, torch.Tensor], before: Dict[str, torch.Tensor]) -> Dict[str, torch.Tensor]:
    return {k: after[k] - before[k] for k in after}


@torch.no_grad()
def _eval_global_loss(
    spec: SecretFlowTaskSpec,
    adapter: Dict[str, torch.Tensor],
    datasets: Dict[str, PartyDataset],
    chunk_size: int,
) -> float:
    """Mean cross-entropy of the *global* model (current adapter) across parties.

    A clean, deterministic measure of the federated model's quality — this is the
    curve the dashboard plots, not the noisy in-flight local-training loss.
    """
    model = build_model(spec)
    model.load_adapter_state(adapter)
    model.eval()
    total_loss, total_n = 0.0, 0
    for ds in datasets.values():
        for chunk in StreamLoader(ds, chunk_size=chunk_size, shuffle=False):
            logits = model(chunk["inputs"])
            n = len(chunk["labels"])
            total_loss += float(F.cross_entropy(logits, chunk["labels"])) * n
            total_n += n
    return total_loss / max(1, total_n)


def _local_train(
    model: ConfigurableMultimodalLLM,
    dataset: PartyDataset,
    local_epochs: int,
    chunk_size: int,
    lr: float,
    dp: Optional[DpSgd] = None,
) -> float:
    """Run real local SGD (DP-SGD when ``dp`` is set); return mean loss over the final epoch."""
    params = trainable_parameters(model)
    opt = torch.optim.Adam(params, lr=lr)
    noise_gen = fresh_noise_generator() if dp is not None else None
    last_epoch_loss = 0.0
    for _ in range(local_epochs):
        losses: List[float] = []
        loader = StreamLoader(dataset, chunk_size=chunk_size, shuffle=True)
        for chunk in loader:  # chunked → OOM guard
            opt.zero_grad()
            if dp is None:
                loss = F.cross_entropy(model(chunk["inputs"]), chunk["labels"])
                loss.backward()
                losses.append(float(loss.detach()))
            else:
                # The backbone is frozen: compute its features once, then take
                # per-example gradients only through the small adapter.
                with torch.no_grad():
                    feats = model.features(chunk["inputs"])
                    losses.append(float(F.cross_entropy(model.adapter_logits(feats), chunk["labels"])))
                assign_flat_grad(
                    params,
                    dp_sgd_gradient(
                        model,
                        feats,
                        chunk["labels"],
                        clip_norm=dp.clip_norm,
                        noise_multiplier=dp.noise_multiplier,
                        generator=noise_gen,
                    ),
                )
            opt.step()
        last_epoch_loss = sum(losses) / max(1, len(losses))
    return last_epoch_loss


def train_local_round(
    spec: SecretFlowTaskSpec,
    *,
    round_index: int,
    training_slice: TrainingSlice,
    global_adapter_json: str = "",
    local_epochs: int = 2,
    chunk_size: int = 64,
    samples_per_party: int = 256,
    lr: float = 0.02,
    emit: Optional[EmitFn] = None,
    node_local_epochs: Optional[Dict[str, int]] = None,
) -> LocalRoundResult:
    """Run one local SGD round for the connector's party; return adapter delta.

    The data is the connector-provided ``training_slice`` — never a path the
    agent reads itself (omop-data-source-access 4.3, D-CN-6).
    """
    emit = emit or (lambda _e: None)
    local_party = config.resolved_local_party()
    if not local_party:
        parties = [p.participant_id for p in spec.parties if p.role == "provider"]
        if len(parties) != 1:
            raise ValueError("AGENT_LOCAL_PARTY required for multi-connector FedAvg rounds")
        local_party = parties[0]

    node_local_epochs = node_local_epochs or {}
    modality_types = list(dict.fromkeys(m.type for m in spec.modalities))
    dataset = PartyDataset(
        local_party,
        modality_types,
        samples_per_party,
        use_party_modalities=False,
        training_slice=training_slice,
    )

    global_adapter = decode_adapter(global_adapter_json)
    model = build_model(spec)
    if global_adapter:
        model.load_adapter_state(global_adapter)
        baseline = copy.deepcopy(global_adapter)
    else:
        baseline = model.adapter_state()

    loss = _local_train(
        model,
        dataset,
        local_epochs=node_local_epochs.get(local_party, local_epochs),
        chunk_size=chunk_size,
        lr=lr,
        dp=spec.privacy.dp_sgd,
    )
    delta = _adapter_delta(model.adapter_state(), baseline)

    emit({
        "phase": "training",
        "round": round_index,
        "participant_id": local_party,
        "epoch": round_index + 1,
        "loss": loss,
        "attestation": f"att:{local_party}:{round_index}",
    })
    return LocalRoundResult(
        participant_id=local_party,
        adapter_delta=delta,
        sample_count=len(dataset),
        local_loss=loss,
    )


def train_federated(
    spec: SecretFlowTaskSpec,
    *,
    rounds: Optional[int] = None,
    local_epochs: int = 2,
    chunk_size: int = 64,
    samples_per_party: int = 256,
    lr: float = 0.02,
    emit: Optional[EmitFn] = None,
    should_drop: Optional[ShouldDropFn] = None,
    node_local_epochs: Optional[Dict[str, int]] = None,
) -> FedTrainingResult:
    """Run FedAvg across the spec's parties and return a safe result bundle."""
    emit = emit or (lambda _e: None)
    rounds = rounds if rounds is not None else spec.epochs
    modality_types = list(dict.fromkeys(m.type for m in spec.modalities))
    parties = [p.participant_id for p in spec.parties if p.role == "provider"]
    local_party = config.resolved_local_party()
    if local_party:
        parties = [local_party]
    node_local_epochs = node_local_epochs or {}

    emit({"phase": "preparing", "parties": parties, "modalities": modality_types, "rounds": rounds})

    # 单进程多方仿真：不接触任何院内数据（院内真实训练只走 train_local_round + 连接器切片）。
    datasets = {
        pid: PartyDataset(
            pid,
            modality_types,
            samples_per_party,
            use_party_modalities=False,
        )
        for pid in parties
    }
    data_source = getattr(next(iter(datasets.values())), "data_source", "synthetic")
    emit({
        "phase": "data_resolved",
        "dataSource": data_source,
        "localParty": local_party,
        "sampleCount": len(next(iter(datasets.values()))),
    })
    global_model = build_model(spec)
    global_adapter = global_model.adapter_state()

    initial_loss = _eval_global_loss(spec, global_adapter, datasets, chunk_size)
    per_round_loss: List[float] = []
    dropped: List[str] = []
    contribution_weight: Dict[str, float] = {pid: 0.0 for pid in parties}
    started = time.time()
    emit({"phase": "baseline", "global_loss": initial_loss})

    for rnd in range(rounds):
        round_deltas: List[Dict[str, torch.Tensor]] = []
        round_weights: List[int] = []
        party_losses: Dict[str, float] = {}

        for pid in parties:
            if should_drop and should_drop(pid, rnd):
                dropped.append(pid)
                emit({"phase": "compensation", "round": rnd, "participant_id": pid,
                      "action": "drop_node", "reason": "status_timeout"})
                continue

            local_model = build_model(spec)
            local_model.load_adapter_state(copy.deepcopy(global_adapter))
            try:
                loss = _local_train(
                    local_model,
                    datasets[pid],
                    local_epochs=node_local_epochs.get(pid, local_epochs),
                    chunk_size=chunk_size,
                    lr=lr,
                    dp=spec.privacy.dp_sgd,
                )
            except Exception as exc:  # noqa: BLE001 — compensation, not a crash
                dropped.append(pid)
                emit({"phase": "compensation", "round": rnd, "participant_id": pid,
                      "action": "drop_node", "reason": f"local_error:{exc}"})
                continue

            delta = _adapter_delta(local_model.adapter_state(), global_adapter)
            round_deltas.append(delta)
            round_weights.append(len(datasets[pid]))
            contribution_weight[pid] += len(datasets[pid])
            party_losses[pid] = loss
            emit({"phase": "training", "round": rnd, "participant_id": pid,
                  "epoch": rnd + 1, "loss": loss,
                  "attestation": f"att:{pid}:{rnd}"})

        if not round_deltas:
            emit({"phase": "failed", "round": rnd, "reason": "all_parties_dropped"})
            break

        # Sample-weighted FedAvg of adapter deltas (plaintext in this runtime —
        # see the module docstring on heu_enabled).
        total_w = sum(round_weights)
        agg: Dict[str, torch.Tensor] = {k: torch.zeros_like(v) for k, v in global_adapter.items()}
        for delta, w in zip(round_deltas, round_weights):
            for k in agg:
                agg[k] += delta[k] * (w / total_w)
        global_adapter = {k: global_adapter[k] + agg[k] for k in global_adapter}

        global_loss = _eval_global_loss(spec, global_adapter, datasets, chunk_size)
        per_round_loss.append(global_loss)
        emit({"phase": "round_complete", "round": rnd, "epoch": rnd + 1,
              "global_loss": global_loss, "participants": list(party_losses.keys()),
              "elapsed_seconds": round(time.time() - started, 3)})

    final_loss = per_round_loss[-1] if per_round_loss else initial_loss
    metrics = {
        "trainLoss": final_loss,
        "initialLoss": initial_loss,
        "lossReduction": initial_loss - final_loss,
        "partyCount": float(len(parties) - len(set(dropped))),
        "elapsedSeconds": round(time.time() - started, 3),
    }
    total_weight = sum(contribution_weight.values())
    contributions = {
        pid: round(contribution_weight[pid] / total_weight, 6) if total_weight else 0.0
        for pid in parties
    }
    emit({"phase": "done", "rounds_completed": len(per_round_loss),
          "metrics": metrics, "contributions": contributions})

    return FedTrainingResult(
        rounds_completed=len(per_round_loss),
        final_adapter=global_adapter,
        metrics=metrics,
        per_round_loss=per_round_loss,
        dropped_parties=list(set(dropped)),
        contributions=contributions,
    )
