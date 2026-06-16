# SecretFlow Workload Runtime Research

## Research Goal

Determine the minimum implementation path for supporting `workloadType = "secretflow"` in MedTrust without disrupting the existing RWS connector path or requiring real SecretFlow/TEEU/HEU infrastructure.

## Context

MedTrust now has a platform task discriminator:

- `workloadType`: platform workload kind (`legacy`, `rws`, `federated_learning`, `secretflow`)
- `method`: execution channel (`mpc`, `fl`, `tee`, `sandbox`)

The current code supports RWS execution in `apps/connector/src/domain/` and legacy/privacy compute flows in `apps/api/src/compute-task/`, `apps/api/src/privacy/`, and `apps/api/src/flower/`. `secretflow` is reserved but not implemented.

## Decisions

### Decision 1: Build A Mock SecretFlow Runtime First

Use a mock runtime adapter before integrating real SecretFlow.

Rationale:

- Real SecretFlow introduces Python runtime, cluster orchestration, device abstractions, and environment setup.
- The current project needs a control-plane/data-plane contract first.
- Mock execution lets us test validation, dispatch, output safety, and docs without GPU/TEE blockers.

Evidence:

- `apps/connector/src/domain/connector-task-runner.ts` already supports a workload discriminator but only executes RWS.
- `apps/connector/src/domain/rws-orchestrator.ts` shows the pattern for local execution plus safe aggregate returns.
- Current API adapter stacks for Flower/FATE/MPC/TEE are parallel services, not a unified SecretFlow data-plane runtime.

### Decision 2: Keep SecretFlow Separate From RWS

Introduce a sibling `SecretFlowTaskRunner` instead of adding SecretFlow logic to `RwsExecutor`.

Rationale:

- RWS is structured cohort/aggregate analysis.
- SecretFlow is multimodal confidential training with parties, modalities, PEFT, privacy, and output artifacts.
- Combining them would overload `RwsAnalysis.type` and obscure output safety rules.

Evidence:

- `apps/connector/src/domain/types.ts` defines RWS-specific analysis recipes.
- `apps/connector/src/domain/rws-executor.ts` branches on RWS analysis types.
- SecretFlow needs model and modality specifications unrelated to RWS analysis recipes.

### Decision 3: Validate SecretFlow Structurally At API Boundary

The API should validate task shape but not real dataset availability in MVP.

Rationale:

- Dataset availability belongs to connector-local data plane and future catalog metadata.
- Control plane can enforce required task fields and allowed `method` values early.
- Structural validation prevents malformed jobs from entering the task table.

Evidence:

- `apps/api/src/compute-task/compute-task.service.ts` already performs minimal RWS validation.
- `packages/database/src/entities/compute-task.entity.ts` is the common persisted task record.

### Decision 4: Restrict SecretFlow MVP Outputs To Safe Artifacts

SecretFlow mock results should only contain hashes, references, aggregate metrics, attestation summaries, privacy summaries, and model card summaries.

Rationale:

- The product invariant is data does not leave provider domains.
- Multimodal data such as DICOM and VCF is highly sensitive.
- Safe output contracts can be tested before real execution exists.

Evidence:

- `apps/connector/src/domain/output-gate.ts` enforces RWS small-cell and row-level output controls.
- `apps/connector/src/domain/local-store.ts` protects local data residency.
- `/docs` already describes no raw medical data leaving provider domains.

## Alternatives Considered

### Alternative A: Integrate Real SecretFlow Immediately

Rejected for MVP. It would require Python runtime management, SecretFlow deployment, HEU/TEEU configuration, data adapters, and likely hardware assumptions before control-plane semantics are proven.

### Alternative B: Model SecretFlow As `method = fl`

Rejected. `method` is the execution channel. SecretFlow is a workload/runtime family that can use TEE and MPC/HE concepts. Encoding it as `fl` would blur the separation created by `workloadType`.

### Alternative C: Add `type = secretflow`

Rejected. The codebase already uses `type` for RWS analysis and FL task types. `workloadType` avoids naming collisions.

## Open Questions

- Should SecretFlow types be duplicated in API/connector for isolation, or moved into a shared package once stable?
- Should `method = tee` or `method = mpc` be the default for SecretFlow MVP examples?
- Should future catalog metadata declare supported modalities before task creation?
- Should attestation be represented as a connector-local proof first or as a control-plane chain anchoring event?

## Recommended Next Step

Implement WP01 first: define SecretFlow task spec types and validation helpers. Then WP02 can add API validation, and WP03/WP04 can build the connector routing plus mock adapter.
