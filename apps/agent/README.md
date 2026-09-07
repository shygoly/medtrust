# MedTrust Local Data Agent (`apps/agent`)

The **data-plane** half of the SecretFlow declarative-orchestration system. A
Python service deployed inside each participant's network. It receives federated
training tasks from the NestJS **Space Orchestrator** over gRPC, runs real
multimodal-LoRA federated averaging, and streams the live training log back over
WebSocket. Only output-gated, attested metadata ever leaves the agent.

```
Space Orchestrator (NestJS)                Local Data Agent (this, Python)
  POST /api/v1/secretflow/tasks
   ├─ NodeCapabilityService  ─┐
   ├─ SecretFlowTranspiler    │  gRPC SubmitFLTask        ┌─ spec.parse_spec
   ├─ OrchestratorFsm         ├────────────────────────▶ ├─ model_factory.build_model
   └─ AgentDispatchClient ────┘                          ├─ dataset.StreamLoader (chunked)
                                                          ├─ fed_trainer.train_federated (FedAvg)
  /ws/secretflow  ◀── WS log stream ◀── ws_server ◀──────┴─ output_guard.build_safe_result
       (browser)        (bridge)        ws://:5023/logs/<taskId>
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
