"""DP-SGD (Abadi et al., 2016) on the trainable LoRA adapter.

What the task spec's ``privacy.dpSgd {clipNorm C, noiseMultiplier z}`` means here,
applied at **every local optimizer step**:

1. per-example gradient of the adapter, clipped to L2 norm ≤ C;
2. summed over the batch, plus ONE draw of N(0, (z·C)² I);
3. divided by the batch size — that is the gradient the optimizer applies.

The protected unit is a single training example (a patient record). The round's
adapter delta is NOT noised again afterwards: noising the whole delta with the
same (z, C) is a different mechanism whose noise, on a ~6k-dim adapter, is ~60×
the clipped signal and wrecks the model.

No privacy accounting (ε) is done here; nothing in the result claims an ε.
"""

from __future__ import annotations

import secrets
from typing import List

import torch
import torch.nn.functional as F
from torch.func import functional_call, grad, vmap


def fresh_noise_generator() -> torch.Generator:
    """Noise source for one training run, seeded from OS entropy.

    Never a fixed seed: noise that can be regenerated can be subtracted, and
    then the "privacy" is gone.
    """
    return torch.Generator().manual_seed(secrets.randbits(63))


class _AdapterView(torch.nn.Module):
    """Lets ``functional_call`` drive ``model.adapter_logits`` with swapped-in parameters."""

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, fused: torch.Tensor) -> torch.Tensor:
        return self.model.adapter_logits(fused)


def trainable_parameters(model) -> List[torch.nn.Parameter]:
    """The adapter parameters, in the order the flat gradient is laid out."""
    return [p for p in model.parameters() if p.requires_grad]


def dp_sgd_gradient(
    model,
    feats: torch.Tensor,
    labels: torch.Tensor,
    *,
    clip_norm: float,
    noise_multiplier: float,
    generator: torch.Generator,
) -> torch.Tensor:
    """Flat noisy mean gradient over ``trainable_parameters(model)`` for one batch.

    ``feats`` are the frozen backbone's outputs (no grad needed through them);
    ``model.adapter_logits`` is row-wise independent, so vmapping the gradient over
    rows yields exact per-example gradients in one batched pass.
    """
    if clip_norm <= 0:
        raise ValueError("dpSgd.clipNorm must be positive")
    if noise_multiplier < 0:
        raise ValueError("dpSgd.noiseMultiplier must be non-negative")
    view = _AdapterView(model)
    params = {f"model.{n}": p.detach() for n, p in model.named_parameters() if p.requires_grad}

    def example_loss(ps, x, y):
        logits = functional_call(view, ps, (x.unsqueeze(0),))
        return F.cross_entropy(logits, y.unsqueeze(0))

    per_example_by_name = vmap(grad(example_loss), in_dims=(None, 0, 0))(params, feats, labels)
    b = feats.size(0)
    per_example = torch.cat([per_example_by_name[k].reshape(b, -1) for k in params], dim=1)  # (B, d)
    scale = torch.clamp(per_example.norm(dim=1, keepdim=True) / clip_norm, min=1.0)
    clipped_sum = (per_example / scale).sum(dim=0)
    noise = torch.randn(clipped_sum.shape, generator=generator) * (noise_multiplier * clip_norm)
    return (clipped_sum + noise) / b


def assign_flat_grad(params: List[torch.nn.Parameter], flat: torch.Tensor) -> None:
    offset = 0
    for p in params:
        n = p.numel()
        p.grad = flat[offset : offset + n].view_as(p).clone()
        offset += n
