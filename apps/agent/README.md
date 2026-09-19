# MedTrust Local Data Agent (`apps/agent`)

The **data-plane** half of the SecretFlow declarative-orchestration system. A
Python service deployed inside each participant's network. It is the
participant's **院内计算后端**: it is called gRPC **only by that hospital's own
connector** (the platform never dials it — outbound-longpoll-agent-auth D1), runs
real multimodal-LoRA federated averaging one round at a time, and returns the
round result to the connector. Every call must carry the shared credential
(metadata `x-agent-token` = `AGENT_SHARED_TOKEN`); with no configured credential
the agent rejects everything. Only output-gated, attested metadata ever leaves
the participant.

```
Control plane (NestJS)            Connector (院内, NestJS)      Local Data Agent (this, Python)
  POST /api/v1/secretflow/tasks
   ├─ NodeCapabilityService  ─┐   长轮询领轮次任务
   ├─ SecretFlowTranspiler    ├──▶ GET /connector/tasks/pending ─┐
   ├─ OrchestratorFsm         │   ├ 验签 + PEP 校验              │ gRPC RunLocalRound
   └─ FlRoundQueueService ────┘   └ 携带 x-agent-token ──────────▶ ├─ spec.parse_spec
                                                                      ├─ model_factory.build_model
                                                                      ├─ dataset.StreamLoader (chunked)
  /ws/secretflow ◀── 每轮指标(编排器广播) ◀── 轮次结果回传 ◀──────────┴─ fed_trainer.train_federated (FedAvg)
       (browser)                                             └─ output_guard.build_safe_result
```

## Runtime selection (best available wins, all import-guarded)

1. `secretflow` PYU/HEU/TEEU on SGX/TEE hardware → confidential path.
2. `ray` distributed actors → distributed PyTorch FedAvg.
3. plain `torch` sequential party loop → portable real FedAvg (the default here).

`secretflow`/`ray` are Linux/SGX-only; the agent falls back to a **real**
PyTorch FedAvg loop that produces genuine loss curves on any host.

## Install & run

```bash
cd apps/agent
python3 -m pip install -e .            # torch, grpcio, websockets, pyyaml
bash scripts/gen_proto.sh              # regenerate gRPC stubs from ../../packages/proto
PYTHONPATH=src python3 -m medtrust_agent.main
# Local Data Agent up — runtime=torch gRPC=0.0.0.0:5024 ws=0.0.0.0:5023
```

Ports (env-overridable): gRPC `AGENT_GRPC_PORT=5024`, WS `AGENT_WS_PORT=5023`.

## Auth & the log stream

- **`AGENT_SHARED_TOKEN`（必填）**：院内共享凭证（≥32 字节随机值）。未配置时 gRPC 一律返回
  `UNAUTHENTICATED`（fail-closed）。连接器侧同名变量。
- **`AGENT_WS_ENABLED`（缺省 `false`）**：训练日志 WS 通道。控制面不再连入 agent，
  联邦训练进度改由连接器回传的每轮经 `/ws/secretflow` 推给前端；该通道只作本地调试用。
- **监听面**：agent 只应在参与方内部网络监听（`AGENT_GRPC_HOST`），部署时不得发布到院内之外。

## Test

```bash
PYTHONPATH=src python3 -m pytest tests -q
# test_data_plane.py   — spec, model factory, real FedAvg, output safety, compensation
# test_agent_server.py — end-to-end gRPC dispatch + WS log stream + safe result
```

## L3 causal (RWS worker → this gRPC)

NestJS connector dials `RunLocalCausal` on `:5024` when `AGENT_GRPC_URL` is set.
Local: `AGENT_GRPC_URL=127.0.0.1:5024`. Fly workers use
`medtrust-connector-{a,b}.internal:5024`. Unset → worker fail-closed.
Runtime errors return `ack_status=FAILED` (no Echo placeholder HR).

## End-to-end with the control plane

```bash
# 1. agent (this service)               → :5024 / :5023
# 2. cd apps/api && pnpm build && PORT=5021 node dist/main.js
# 3. cross-language smoke:
cd apps/api && npx ts-node scripts/e2e-secretflow.ts      # direct gRPC+WS
cd apps/api && API_PORT=5021 npx ts-node scripts/e2e-api-gateway.ts  # through the HTTP API + browser gateway
# 4. UI: web dashboard → 密算编排 (/dashboard/secretflow)
```

## Multimodal model (declarative, pluggable)

`model_factory.build_model(spec)` assembles a real `torch.nn.Module` from the
declared modalities + `fusionBridge` + `peftStrategy` — no hard-coded model:

- **Encoders** (one per declared modality, real structured nets):
  `dicom` → Conv patchifier, `clinical_text`/`genomics` → embedding + transformer
  layer, `structured_ehr` → MLP. Each emits a token sequence `(B, T, hidden)`.
  Add a modality with `register_encoder("modality", factory)` + a `MODALITY_CONFIG`
  entry — nothing else changes (transport, FSM, settlement are model-agnostic).
- **Fusion bridge** from `spec.fusionBridge.type`: `linear_projection` (pool +
  concat + linear) or `perceiver_resampler` (learned queries cross-attend over
  all modality tokens).
- **LoRA adapter** = a projection + head (`peftStrategy.r/alpha`). The encoder +
  fusion stack is a **frozen shared backbone**; only the adapter trains and is
  communicated, so the exported delta is small and the backbone never leaks.

Encoders use synthetic-but-structurally-faithful tensors. To use a real backbone
(MONAI ViT, HF LLM + `peft`), swap the encoder factories + `llmBackbone` loading
— the FedAvg loop, output gate, gRPC/WS, and settlement are unchanged.

## Safety invariants

- `output_guard` filters the result to `outputPolicy.allowedArtifacts` and
  fail-closes on any forbidden key (raw rows, DICOM/VCF payloads, unencrypted
  gradients, embeddings). A completed run is **shaped** by policy, never failed.
- `StreamLoader` reads data in fixed chunks (default 64) — the §5.2 OOM guard for
  scarce TEE memory.
- A party that times out / errors is **dropped** from the round (compensation),
  never stalling the whole job.
