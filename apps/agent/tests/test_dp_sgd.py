"""spec 里声明的 dpSgd 必须真是 DP-SGD（Abadi et al., 2016）。

旧实现把噪声 N(0, (z·C)²) 加在每院每轮的**整个适配器增量**上、且不按批量平均：
6160 维适配器上噪声范数 ≈ 0.8·√6160 ≈ 63，而裁剪后的真实增量范数 ≤ 1——模型被噪声淹没，
默认场景（z=0.8, C=1.0）训练后交叉熵到数百上千。DP-SGD 的正确形态是：
逐样本梯度裁剪到 C → 求和 → 加一次 N(0, (z·C)²) → 除以批量，每个优化步都这样做；
轮次增量本身不再额外加噪。
"""

import copy

import pytest

torch = pytest.importorskip("torch")
import torch.nn.functional as F  # noqa: E402

from medtrust_agent.dp_sgd import dp_sgd_gradient, trainable_parameters  # noqa: E402
from medtrust_agent.fed_trainer import train_federated, train_local_round  # noqa: E402
from medtrust_agent.model_factory import build_model  # noqa: E402
from medtrust_agent.scenario import default_secretflow_spec  # noqa: E402
from medtrust_agent.spec import parse_spec  # noqa: E402
from medtrust_agent.training_slice import parse_training_slice  # noqa: E402

import json  # noqa: E402


def _spec(dp=True, epochs=3):
    raw = copy.deepcopy({**default_secretflow_spec(), "epochs": epochs})
    if not dp:
        raw["privacy"] = {k: v for k, v in raw["privacy"].items() if k != "dpSgd"}
    return parse_spec(raw)


def _batch(model, n=16, seed=0):
    g = torch.Generator().manual_seed(seed)
    hidden = model.proj.base.in_features
    feats = torch.randn(n, hidden, generator=g)
    labels = torch.randint(0, 2, (n,), generator=g)
    return feats, labels


def _per_example_grads(model, params, feats, labels):
    """独立参照：逐样本 autograd 循环（实现用 vmap，二者须一致）。"""
    rows = []
    for i in range(feats.size(0)):
        grads = torch.autograd.grad(
            F.cross_entropy(model.adapter_logits(feats[i : i + 1]), labels[i : i + 1]), params
        )
        rows.append(torch.cat([g.reshape(-1) for g in grads]))
    return torch.stack(rows)


def test_default_scenario_with_dp_sgd_still_learns():
    spec = _spec(dp=True)
    assert spec.privacy.dp_sgd is not None and spec.privacy.dp_sgd.noise_multiplier > 0
    res = train_federated(spec)
    assert res.metrics["lossReduction"] > 0.05
    # 适配器不是噪声：旧实现训练后范数 ≈ 0.8·√d ≈ 63
    d = sum(v.numel() for v in res.final_adapter.values())
    norm = float(torch.sqrt(sum((v ** 2).sum() for v in res.final_adapter.values())))
    assert norm < 0.25 * 0.8 * d ** 0.5


def test_clipping_bounds_each_example_and_averages_over_the_batch():
    model = build_model(_spec())
    params = trainable_parameters(model)
    feats, labels = _batch(model)
    per_example = _per_example_grads(model, params, feats, labels)
    clip = 0.05  # 小到每个样本都会被裁
    assert bool((per_example.norm(dim=1) > clip).all())

    g = dp_sgd_gradient(
        model, feats, labels, clip_norm=clip, noise_multiplier=0.0,
        generator=torch.Generator().manual_seed(1),
    )
    expected = (per_example * (clip / per_example.norm(dim=1, keepdim=True))).mean(dim=0)
    assert torch.allclose(g, expected, atol=1e-6)


def test_without_clipping_or_noise_it_is_the_plain_mean_gradient():
    model = build_model(_spec())
    params = trainable_parameters(model)
    feats, labels = _batch(model)
    g = dp_sgd_gradient(
        model, feats, labels, clip_norm=1e9, noise_multiplier=0.0,
        generator=torch.Generator().manual_seed(1),
    )
    plain = torch.autograd.grad(F.cross_entropy(model.adapter_logits(feats), labels), params)
    assert torch.allclose(g, torch.cat([x.reshape(-1) for x in plain]), atol=1e-6)


def test_noise_is_added_once_to_the_sum_then_averaged():
    model = build_model(_spec())
    n = 32
    feats, labels = _batch(model, n=n)
    clip, z = 1.0, 0.8
    clean = dp_sgd_gradient(model, feats, labels, clip_norm=clip, noise_multiplier=0.0,
                            generator=torch.Generator().manual_seed(7))
    noisy = dp_sgd_gradient(model, feats, labels, clip_norm=clip, noise_multiplier=z,
                            generator=torch.Generator().manual_seed(7))
    std = float((noisy - clean).std())
    assert std == pytest.approx(z * clip / n, rel=0.05)  # 每个坐标 z·C/B，d=6160 足够估准


def test_round_delta_is_not_noised_after_the_fact(monkeypatch):
    monkeypatch.setenv("AGENT_LOCAL_PARTY", "p-huashan")
    spec = _spec(dp=True, epochs=1)
    rows = [[float((i * 7 + j) % 11) for j in range(7)] for i in range(64)]
    body = {"schema": "esrd-proxy@1", "featureKeys": [f"f{j}" for j in range(7)],
            "rows": rows, "labels": [i % 2 for i in range(64)]}
    s = parse_training_slice(json.dumps(body), expected_dim=7)
    res = train_local_round(spec, round_index=0, training_slice=s)
    d = sum(v.numel() for v in res.adapter_delta.values())
    norm = float(torch.sqrt(sum((v ** 2).sum() for v in res.adapter_delta.values())))
    assert norm < 0.25 * 0.8 * d ** 0.5  # 旧实现单院单轮增量范数 ≈ 0.8·√d
