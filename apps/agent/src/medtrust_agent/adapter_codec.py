"""Serialize LoRA adapter tensors for gRPC round-sync FedAvg."""

from __future__ import annotations

import base64
import json
from typing import Dict

import numpy as np
import torch


def encode_adapter(adapter: Dict[str, torch.Tensor]) -> str:
    payload: dict[str, dict] = {}
    for key in sorted(adapter.keys()):
        tensor = adapter[key].detach().cpu().float()
        payload[key] = {
            "shape": list(tensor.shape),
            "data": base64.b64encode(tensor.numpy().astype(np.float32).tobytes()).decode("ascii"),
        }
    return json.dumps(payload, separators=(",", ":"))


def decode_adapter(raw: str) -> Dict[str, torch.Tensor]:
    if not raw:
        return {}
    payload = json.loads(raw)
    out: Dict[str, torch.Tensor] = {}
    for key, meta in payload.items():
        buf = base64.b64decode(meta["data"])
        arr = np.frombuffer(buf, dtype=np.float32).reshape(meta["shape"])
        out[key] = torch.from_numpy(arr.copy())
    return out
