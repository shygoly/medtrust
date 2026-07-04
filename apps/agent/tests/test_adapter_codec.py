"""Tests for adapter tensor codec."""

from __future__ import annotations

import torch

from medtrust_agent.adapter_codec import decode_adapter, encode_adapter


def test_adapter_roundtrip():
    adapter = {
        "proj.lora_A": torch.randn(8, 16),
        "proj.lora_B": torch.randn(16, 8),
    }
    restored = decode_adapter(encode_adapter(adapter))
    for key in adapter:
        assert torch.allclose(adapter[key], restored[key], atol=1e-6)
