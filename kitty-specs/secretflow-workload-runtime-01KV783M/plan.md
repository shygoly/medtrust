# Implementation Plan: SecretFlow Workload Runtime

**Branch**: `feat/federated-data-space-rws` | **Date**: 2026-06-16 | **Spec**: `kitty-specs/secretflow-workload-runtime-01KV783M/spec.md`
**Input**: Feature specification from `kitty-specs/secretflow-workload-runtime-01KV783M/spec.md`

## Summary

Add a first-class SecretFlow workload runtime shell for `workloadType = "secretflow"`. The implementation will validate SecretFlow task specs in the API, route SecretFlow dispatches through a dedicated connector runtime, return deterministic mock safe-output artifacts, and document the MVP boundaries. Real SecretFlow, TEEU, HEU, DICOM/VCF parsing, and GPU execution remain out of scope.

## Branch Contract

- Current branch at plan start: `feat/federated-data-space-rws`
- Planning/base branch: `feat/federated-data-space-rws`
- Final merge target: `feat/federated-data-space-rws`
- Branch matches target: `true`

## Technical Context

**Language/Version**: TypeScript, Node 20, NestJS 10, Next.js 16, TypeORM  
**Primary Dependencies**: Existing workspace packages only; no real SecretFlow dependency in MVP  
**Storage**: Existing `ComputeTask.algorithmParams.secretflowSpec` and `ComputeTask.resultSummary`  
**Testing**: Jest for API/connector, TypeScript builds, Next.js production build  
**Target Platform**: MedTrust monorepo on branch `feat/federated-data-space-rws`  
**Project Type**: Multi-app pnpm monorepo with API, connector, web, and database package  
**Performance Goals**: Mock adapter completes deterministically in unit tests without external services  
**Constraints**: No Python SecretFlow, TEEU, HEU, GPU, MONAI, DICOM parser, or VCF parser in MVP  
**Scale/Scope**: One workload runtime shell plus validation, routing, mock output, and docs

## Charter Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Skipped. Spec Kitty reported no charter at `.kittify/charter/charter.md`.

## Project Structure

### Documentation (this feature)

```
kitty-specs/[###-feature]/
├── plan.md              # This file (/spec-kitty.plan command output)
├── research.md          # Phase 0 output (/spec-kitty.plan command)
├── data-model.md        # Phase 1 output (/spec-kitty.plan command)
├── quickstart.md        # Phase 1 output (/spec-kitty.plan command)
├── contracts/           # Phase 1 output (/spec-kitty.plan command)
└── tasks.md             # Phase 2 output (/spec-kitty.tasks command - NOT created by /spec-kitty.plan)
```

### Source Code (repository root)

```
apps/api/src/compute-task/
├── compute-task.service.ts
├── dto/create-compute-task.dto.ts
└── dto/secretflow-task-spec.ts

apps/connector/src/domain/
├── connector-task-runner.ts
├── task-puller.ts
└── secretflow/
    ├── secretflow-task-spec.ts
    ├── secretflow-task-runner.ts
    ├── secretflow-runtime-adapter.ts
    ├── mock-secretflow-adapter.ts
    └── *.spec.ts

apps/web/src/
├── types/compute-task.types.ts
└── app/docs/page.tsx
```

**Structure Decision**: Keep API validation and connector runtime code separate. The API owns request validation; the connector owns runtime execution and safe output. If API and connector type shapes drift later, move stable types into a shared package.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Phase 0 Research

Research is captured in `kitty-specs/secretflow-workload-runtime-01KV783M/research.md`.

Key decisions:

- Build a mock SecretFlow runtime first.
- Keep SecretFlow separate from RWS.
- Validate SecretFlow structurally at the API boundary.
- Restrict mock runtime output to safe artifacts.

## Phase 1 Design And Contracts

Data model is captured in `kitty-specs/secretflow-workload-runtime-01KV783M/data-model.md`.

Contracts:

- `kitty-specs/secretflow-workload-runtime-01KV783M/contracts/secretflow-compute-task.openapi.yaml`

Quickstart:

- `kitty-specs/secretflow-workload-runtime-01KV783M/quickstart.md`

## Implementation Phases

### Phase 1: SecretFlow Spec Types

Create `SecretFlowTaskSpec` and related types for parties, modalities, model backbone, PEFT, fusion bridge, privacy, and output policy.

### Phase 2: API Validation

Extend `ComputeTaskService.validateWorkloadSpec()` so `WorkloadType.SECREFLOW` tasks require `algorithmParams.secretflowSpec`, parties, modalities, backbone, PEFT strategy, and `method` in `tee | mpc`.

### Phase 3: Connector Runtime Router

Introduce a connector workload dispatch boundary and route `secretflow` to `SecretFlowTaskRunner` while preserving RWS behavior.

### Phase 4: Mock SecretFlow Adapter

Add `SecretFlowRuntimeAdapter` and `MockSecretFlowAdapter` with deterministic mock environment, prepare, run, and cleanup behavior.

### Phase 5: Safe Output Contract

Define `SecretFlowRunResult` with safe artifacts only and tests proving unsafe fields are absent.

### Phase 6: Web Types And Docs

Update web types and `/docs` to describe SecretFlow as the future multimodal confidential training runtime and document MVP limitations.

## Verification Commands

```bash
pnpm --filter @medtrust/database build
pnpm --filter @medtrust/api build
pnpm --filter @medtrust/api test
pnpm --filter @medtrust/connector test
pnpm --filter web build
```

## Post-Design Charter Check

Skipped. No charter file exists.
