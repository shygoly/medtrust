"""Declarative multimodal model factory.

No model class is hard-coded. ``build_model`` reads the parsed
``SecretFlowTaskSpec`` and assembles a real ``torch.nn.Module`` whose encoders
match the declared modalities, whose fusion bridge matches ``fusionBridge``, and
whose trainable LoRA adapter matches ``peftStrategy`` — the data-plane
realisation of the design's ``ConfigurableMultimodalLLM``.

Each modality has a real structured encoder (CNN for imaging, token transformer
for text/genomics, MLP for tabular) emitting a token sequence ``(B, T, hidden)``.
Encoders are pluggable via ``ENCODER_REGISTRY`` — registering a new modality is a
one-liner, no change to training, transport, or settlement. The whole encoder +
fusion stack is a frozen shared backbone; only the LoRA adapter (a projection +
head) trains and is communicated.
"""

from __future__ import annotations

from typing import Callable, Dict, List

import torch
import torch.nn as nn
import torch.nn.functional as F

from .spec import SecretFlowTaskSpec

NUM_CLASSES = 2  # ESRD within 24 months (binary renal endpoint)

# Structural config per modality — drives both the encoder and the synthetic
# data harness (dataset.py imports this). Real deployments keep the same shapes
# but swap encoder internals for MONAI / HF tokenizers.
MODALITY_CONFIG: Dict[str, dict] = {
    "dicom": {"kind": "image", "shape": (1, 16, 16)},      # renal US / biopsy WSI slice
    "genomics": {"kind": "tokens", "vocab": 64, "length": 8},
    "clinical_text": {"kind": "tokens", "vocab": 128, "length": 12},  # nephrology notes
    "structured_ehr": {"kind": "tabular", "dim": 7},     # CKD ehr schema field count
}


class LoRALinear(nn.Module):
    """Linear layer with a frozen base weight and a trainable low-rank adapter.

    Only ``A``/``B`` carry gradients, so the exported "LoRA delta" is the small
    adapter — never the frozen backbone — matching the output policy.
    """

    def __init__(self, in_features: int, out_features: int, r: int, alpha: int):
        super().__init__()
        self.base = nn.Linear(in_features, out_features)
        self.base.weight.requires_grad_(False)
        self.base.bias.requires_grad_(False)
        self.r = max(1, r)
        self.scaling = alpha / self.r
        self.lora_A = nn.Parameter(torch.zeros(self.r, in_features))
        self.lora_B = nn.Parameter(torch.zeros(out_features, self.r))
        nn.init.kaiming_uniform_(self.lora_A, a=5 ** 0.5)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        delta = (x @ self.lora_A.t()) @ self.lora_B.t()
        return self.base(x) + self.scaling * delta


# ----------------------------------------------------------------------------
# Modality encoders — each returns a token sequence (B, T, hidden).
# ----------------------------------------------------------------------------

class ImagePatchEncoder(nn.Module):
    """Conv patchifier for imaging modalities (DICOM stand-in)."""

    def __init__(self, shape, hidden: int):
        super().__init__()
        channels = shape[0]
        self.patch = nn.Conv2d(channels, hidden, kernel_size=4, stride=4)
        self.norm = nn.LayerNorm(hidden)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        feat = self.patch(x)                       # (B, hidden, H/4, W/4)
        tokens = feat.flatten(2).transpose(1, 2)   # (B, T, hidden)
        return self.norm(F.gelu(tokens))


class TokenEncoder(nn.Module):
    """Embedding + a transformer layer for token modalities (text / genomics)."""

    def __init__(self, vocab: int, length: int, hidden: int):
        super().__init__()
        self.embed = nn.Embedding(vocab, hidden)
        self.pos = nn.Parameter(torch.zeros(1, length, hidden))
        nn.init.normal_(self.pos, std=0.02)
        layer = nn.TransformerEncoderLayer(
            d_model=hidden, nhead=4, dim_feedforward=hidden * 2,
            batch_first=True, dropout=0.0,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.embed(x) + self.pos[:, : x.size(1)]
        return self.encoder(h)                     # (B, length, hidden)


class TabularEncoder(nn.Module):
    """MLP for structured EHR; emits a single token (B, 1, hidden)."""

    def __init__(self, dim: int, hidden: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(dim, hidden), nn.GELU(), nn.LayerNorm(hidden),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).unsqueeze(1)            # (B, 1, hidden)


EncoderFactory = Callable[[int], nn.Module]


def _image_factory(shape) -> EncoderFactory:
    return lambda hidden: ImagePatchEncoder(shape, hidden)


def _token_factory(vocab: int, length: int) -> EncoderFactory:
    return lambda hidden: TokenEncoder(vocab, length, hidden)


def _tabular_factory(dim: int) -> EncoderFactory:
    return lambda hidden: TabularEncoder(dim, hidden)


# Pluggable registry: add a modality by registering a factory here (or via
# register_encoder) and a MODALITY_CONFIG entry. Nothing else changes.
ENCODER_REGISTRY: Dict[str, EncoderFactory] = {
    "dicom": _image_factory(MODALITY_CONFIG["dicom"]["shape"]),
    "genomics": _token_factory(MODALITY_CONFIG["genomics"]["vocab"], MODALITY_CONFIG["genomics"]["length"]),
    "clinical_text": _token_factory(MODALITY_CONFIG["clinical_text"]["vocab"], MODALITY_CONFIG["clinical_text"]["length"]),
    "structured_ehr": _tabular_factory(MODALITY_CONFIG["structured_ehr"]["dim"]),
}


def register_encoder(modality: str, factory: EncoderFactory) -> None:
    ENCODER_REGISTRY[modality] = factory


def build_encoders(modalities: List[str], hidden: int) -> nn.ModuleDict:
    return nn.ModuleDict({m: ENCODER_REGISTRY[m](hidden) for m in modalities})


# ----------------------------------------------------------------------------
# Fusion bridges — declared via spec.fusionBridge.type.
# ----------------------------------------------------------------------------

class LinearProjectionFusion(nn.Module):
    """Mean-pool each modality then concat → linear projection."""

    def __init__(self, n_modalities: int, hidden: int):
        super().__init__()
        self.proj = nn.Linear(n_modalities * hidden, hidden)

    def forward(self, token_lists: List[torch.Tensor]) -> torch.Tensor:
        pooled = [t.mean(dim=1) for t in token_lists]   # (B, hidden) each
        return torch.relu(self.proj(torch.cat(pooled, dim=-1)))


class PerceiverResamplerFusion(nn.Module):
    """Learned latent queries cross-attend over all modality tokens."""

    def __init__(self, hidden: int, num_queries: int):
        super().__init__()
        self.queries = nn.Parameter(torch.randn(num_queries, hidden) * 0.02)
        self.attn = nn.MultiheadAttention(hidden, num_heads=4, batch_first=True)
        self.norm = nn.LayerNorm(hidden)

    def forward(self, token_lists: List[torch.Tensor]) -> torch.Tensor:
        tokens = torch.cat(token_lists, dim=1)          # (B, ΣT, hidden)
        b = tokens.size(0)
        q = self.queries.unsqueeze(0).expand(b, -1, -1)  # (B, Q, hidden)
        out, _ = self.attn(q, tokens, tokens)            # (B, Q, hidden)
        return self.norm(out).mean(dim=1)                # (B, hidden)


def build_fusion(fusion_type: str, n_modalities: int, hidden: int, num_queries: int) -> nn.Module:
    if fusion_type == "perceiver_resampler":
        return PerceiverResamplerFusion(hidden, num_queries)
    return LinearProjectionFusion(n_modalities, hidden)


# ----------------------------------------------------------------------------
# Full model.
# ----------------------------------------------------------------------------

class ConfigurableMultimodalLLM(nn.Module):
    """Encoders → fusion bridge (frozen backbone) → LoRA proj + head (adapter)."""

    def __init__(
        self,
        modalities: List[str],
        hidden: int,
        r: int,
        alpha: int,
        fusion_type: str,
        num_queries: int,
    ):
        super().__init__()
        self.modalities = list(modalities)
        self.encoders = build_encoders(self.modalities, hidden)
        self.fusion = build_fusion(fusion_type, len(self.modalities), hidden, num_queries)
        # Frozen scale normalisation so the adapter sees unit-scale features
        # regardless of fusion type — keeps one LR stable across backbones.
        self.pre_norm = nn.LayerNorm(hidden)
        # Trainable LoRA adapter sits on top of the frozen multimodal backbone.
        self.proj = LoRALinear(hidden, hidden, r=r, alpha=alpha)
        self.head = LoRALinear(hidden, NUM_CLASSES, r=r, alpha=alpha)

    def features(self, batch: Dict[str, torch.Tensor]) -> torch.Tensor:
        """Frozen backbone: encoders → fusion → pre-norm. (B, hidden)"""
        tokens = [self.encoders[m](batch[m]) for m in self.modalities]
        return self.pre_norm(self.fusion(tokens))

    def adapter_logits(self, fused: torch.Tensor) -> torch.Tensor:
        """Trainable LoRA adapter on backbone features. Row-wise independent, so
        a single row's gradient is that example's gradient (DP-SGD relies on it)."""
        return self.head(torch.relu(self.proj(fused)))

    def forward(self, batch: Dict[str, torch.Tensor]) -> torch.Tensor:
        return self.adapter_logits(self.features(batch))

    def adapter_state(self) -> Dict[str, torch.Tensor]:
        return {
            "proj.lora_A": self.proj.lora_A.detach().clone(),
            "proj.lora_B": self.proj.lora_B.detach().clone(),
            "head.lora_A": self.head.lora_A.detach().clone(),
            "head.lora_B": self.head.lora_B.detach().clone(),
        }

    def load_adapter_state(self, state: Dict[str, torch.Tensor]) -> None:
        with torch.no_grad():
            self.proj.lora_A.copy_(state["proj.lora_A"])
            self.proj.lora_B.copy_(state["proj.lora_B"])
            self.head.lora_A.copy_(state["head.lora_A"])
            self.head.lora_B.copy_(state["head.lora_B"])

    def freeze_backbone(self) -> None:
        """Freeze encoders + fusion; only the LoRA adapter trains/communicates.

        A shared, frozen backbone is also what makes cross-party FedAvg of
        adapters coherent — every party must share an identical backbone.
        """
        for p in self.encoders.parameters():
            p.requires_grad_(False)
        for p in self.fusion.parameters():
            p.requires_grad_(False)
        for p in self.pre_norm.parameters():
            p.requires_grad_(False)


# Fixed seed so every party instantiates a byte-identical frozen backbone.
BACKBONE_SEED = 20240601


def _fusion_settings(spec: SecretFlowTaskSpec) -> tuple:
    bridge = spec.fusion_bridge
    if bridge is None:
        return "linear_projection", 64, 4
    fusion_type = bridge.type or "linear_projection"
    hidden = bridge.hidden_size or 64
    num_queries = bridge.num_queries or 4
    return fusion_type, hidden, num_queries


def build_model(spec: SecretFlowTaskSpec) -> ConfigurableMultimodalLLM:
    modalities = [m.type for m in spec.modalities]
    fusion_type, hidden, num_queries = _fusion_settings(spec)
    rng_state = torch.get_rng_state()
    torch.manual_seed(BACKBONE_SEED)
    try:
        model = ConfigurableMultimodalLLM(
            modalities=modalities,
            hidden=hidden,
            r=spec.peft_strategy.r,
            alpha=spec.peft_strategy.alpha,
            fusion_type=fusion_type,
            num_queries=num_queries,
        )
    finally:
        torch.set_rng_state(rng_state)
    model.freeze_backbone()
    return model
