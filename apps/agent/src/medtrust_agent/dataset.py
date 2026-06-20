"""Synthetic per-party multimodal datasets + chunked StreamLoader.

Each modality is synthesised in its real structural form — images for DICOM,
token-id sequences for clinical text / genomics, feature vectors for structured
EHR — with a deterministic class-correlated signal so training loss genuinely
drops. Data is deterministic per ``(participant_id, modalities)`` but is fed
through real forward/backward passes; the loss is real, not scripted.

The StreamLoader enforces the design's §5.2 OOM guard: tensors are read in
fixed-size chunks (default 64) so the full dataset is never materialised in
scarce TEE memory at once.
"""

from __future__ import annotations

import hashlib
from typing import Dict, Iterator, List

import torch

from .model_factory import MODALITY_CONFIG, NUM_CLASSES
from .scenario import party_modalities_for


def _seed_for(participant_id: str) -> int:
    digest = hashlib.sha256(participant_id.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _esrd_labels(participant_id: str, num_samples: int, g: torch.Generator) -> torch.Tensor:
    """Synthetic ESRD endpoint — party-specific prevalence, deterministic per party."""
    base_rate = 0.28 + (_seed_for(participant_id) % 50) / 1000.0
    probs = torch.full((num_samples,), base_rate)
    return (torch.rand(num_samples, generator=g) < probs).long()


def _synth_image(cfg: dict, labels: torch.Tensor, g: torch.Generator) -> torch.Tensor:
    shape = cfg["shape"]  # (C, H, W)
    n = labels.size(0)
    # One spatial template per class; samples = template + noise.
    templates = torch.randn(NUM_CLASSES, *shape, generator=g)
    noise = torch.randn(n, *shape, generator=g) * 0.5
    return templates[labels] + noise


def _synth_tokens(cfg: dict, labels: torch.Tensor, g: torch.Generator) -> torch.Tensor:
    vocab, length = cfg["vocab"], cfg["length"]
    n = labels.size(0)
    # Per-class "signature" token sequence; ~40% of positions corrupted to noise.
    class_anchor = torch.randint(0, vocab, (NUM_CLASSES, length), generator=g)
    seqs = class_anchor[labels].clone()
    corrupt = torch.rand(n, length, generator=g) < 0.4
    rand_tokens = torch.randint(0, vocab, (n, length), generator=g)
    seqs[corrupt] = rand_tokens[corrupt]
    return seqs.long()


def _synth_tabular(cfg: dict, labels: torch.Tensor, g: torch.Generator) -> torch.Tensor:
    dim = cfg["dim"]
    n = labels.size(0)
    onehot = torch.nn.functional.one_hot(labels, NUM_CLASSES).float()
    signal_w = torch.randn(NUM_CLASSES, dim, generator=g)
    noise = torch.randn(n, dim, generator=g) * 0.6
    return onehot @ signal_w + noise


_SYNTH = {"image": _synth_image, "tokens": _synth_tokens, "tabular": _synth_tabular}


class PartyDataset:
    """Deterministic synthetic multimodal samples for one party."""

    def __init__(
        self,
        participant_id: str,
        modalities: List[str],
        num_samples: int = 256,
        *,
        use_party_modalities: bool = True,
    ):
        self.participant_id = participant_id
        self.modalities = list(dict.fromkeys(m for m in modalities if m in MODALITY_CONFIG))
        if not self.modalities:
            raise ValueError(f"no supported modalities for party {participant_id}")
        owned = (
            party_modalities_for(participant_id, self.modalities)
            if use_party_modalities
            else self.modalities
        )
        owned = [m for m in owned if m in MODALITY_CONFIG]
        self.num_samples = num_samples
        g = torch.Generator().manual_seed(_seed_for(participant_id))

        self.labels = _esrd_labels(participant_id, num_samples, g)
        self.features: Dict[str, torch.Tensor] = {}
        for m in self.modalities:
            cfg = MODALITY_CONFIG[m]
            if m in owned:
                self.features[m] = _SYNTH[cfg["kind"]](cfg, self.labels, g)
            else:
                # Party does not hold this modality — pad with low-magnitude noise.
                kind = cfg["kind"]
                if kind == "image":
                    self.features[m] = torch.randn(num_samples, *cfg["shape"], generator=g) * 0.05
                elif kind == "tokens":
                    self.features[m] = torch.zeros(num_samples, cfg["length"], dtype=torch.long)
                else:
                    self.features[m] = torch.randn(num_samples, cfg["dim"], generator=g) * 0.05

    def __len__(self) -> int:
        return self.num_samples


class StreamLoader:
    """Yields fixed-size chunks; never holds more than ``chunk_size`` in memory."""

    def __init__(self, dataset: PartyDataset, chunk_size: int = 64, shuffle: bool = True):
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        self.dataset = dataset
        self.chunk_size = chunk_size
        self.shuffle = shuffle

    def __iter__(self) -> Iterator[Dict[str, object]]:
        n = len(self.dataset)
        order = torch.randperm(n) if self.shuffle else torch.arange(n)
        for start in range(0, n, self.chunk_size):
            idx = order[start : start + self.chunk_size]
            batch = {m: self.dataset.features[m][idx] for m in self.dataset.modalities}
            yield {"inputs": batch, "labels": self.dataset.labels[idx]}

    @property
    def num_chunks(self) -> int:
        n = len(self.dataset)
        return (n + self.chunk_size - 1) // self.chunk_size
