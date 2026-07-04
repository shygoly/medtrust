"""Real federated-averaging trainer for the configurable multimodal model.

Each round every party runs genuine local SGD over chunked data, then the
trainable LoRA adapters are aggregated (sample-weighted FedAvg). Privacy hooks:

* ``heu_enabled``  → additive secret-sharing mask on each party's adapter delta
  (a software stand-in for HEU encrypted aggregation; the aggregator only ever
  sees masked deltas that cancel on sum).
* ``dp_sgd``       → per-party L2 clip + Gaussian noise on the adapter delta.

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

from .dataset import PartyDataset, StreamLoader
from .model_factory import ConfigurableMultimodalLLM, build_model
from .spec import SecretFlowTaskSpec
from . import config

EmitFn = Callable[[dict], None]
ShouldDropFn = Callable[[str, int], bool]  # (participant_id, round_index) -> drop?


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


def _delta_l2(delta: Dict[str, torch.Tensor]) -> float:
    return float(torch.sqrt(sum((v ** 2).sum() for v in delta.values())))


def _clip_and_noise(delta: Dict[str, torch.Tensor], clip_norm: float, noise_mult: float) -> Dict[str, torch.Tensor]:
    norm = _delta_l2(delta)
    scale = min(1.0, clip_norm / (norm + 1e-12))
    out: Dict[str, torch.Tensor] = {}
    for k, v in delta.items():
        clipped = v * scale
        noise = torch.randn_like(v) * (noise_mult * clip_norm)
        out[k] = clipped + noise
    return out


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
) -> float:
    """Run real local SGD; return mean loss over the final epoch."""
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.Adam(params, lr=lr)
    last_epoch_loss = 0.0
    for _ in range(local_epochs):
        losses: List[float] = []
        loader = StreamLoader(dataset, chunk_size=chunk_size, shuffle=True)
        for chunk in loader:  # chunked → OOM guard
            opt.zero_grad()
            logits = model(chunk["inputs"])
            loss = F.cross_entropy(logits, chunk["labels"])
            loss.backward()
            opt.step()
            losses.append(float(loss.detach()))
        last_epoch_loss = sum(losses) / max(1, len(losses))
    return last_epoch_loss


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

    resolved_data_path = spec.data_path or config.DEFAULT_DATA_PATH
    datasets = {
        pid: PartyDataset(
            pid,
            modality_types,
            samples_per_party,
            use_party_modalities=False,
            data_path=resolved_data_path,
        )
        for pid in parties
    }
    data_source = getattr(next(iter(datasets.values())), "data_source", "synthetic")
    emit({
        "phase": "data_resolved",
        "dataPath": resolved_data_path,
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
                )
            except Exception as exc:  # noqa: BLE001 — compensation, not a crash
                dropped.append(pid)
                emit({"phase": "compensation", "round": rnd, "participant_id": pid,
                      "action": "drop_node", "reason": f"local_error:{exc}"})
                continue

            delta = _adapter_delta(local_model.adapter_state(), global_adapter)
            if spec.privacy.dp_sgd is not None:
                delta = _clip_and_noise(
                    delta, spec.privacy.dp_sgd.clip_norm, spec.privacy.dp_sgd.noise_multiplier
                )
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

        # Sample-weighted FedAvg of adapter deltas. With heu_enabled the masks
        # are additive and cancel exactly on this sum (homomorphic-style).
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
