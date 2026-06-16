---
work_package_id: WP01
title: Shared SecretFlow Task Spec
dependencies: []
requirement_refs:
- FR-001
- C-001
- C-002
planning_base_branch: feat/federated-data-space-rws
merge_target_branch: feat/federated-data-space-rws
branch_strategy: Planning artifacts for this feature were generated on feat/federated-data-space-rws. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/federated-data-space-rws unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
phase: Phase 1 - Specification Shell
assignee: ''
agent: ''
history:
- timestamp: '2026-06-16T03:37:56Z'
  agent: cursor
  action: Prompt generated for SecretFlow workload runtime mission.
- timestamp: '2026-06-16T03:58:30Z'
  agent: cursor
  action: Enriched from wps.yaml manifest during tasks-packages.
authoritative_surface: apps/api/src/compute-task/dto/
execution_mode: code_change
owned_files:
- apps/api/src/compute-task/dto/secretflow-task-spec.ts
- apps/api/src/compute-task/dto/secretflow-task-spec.spec.ts
- apps/connector/src/domain/secretflow/secretflow-task-spec.ts
- apps/connector/src/domain/secretflow/secretflow-task-spec.spec.ts
tags: []
---

# Work Package Prompt: WP01 - Shared SecretFlow Task Spec

## Objective

Define the TypeScript structures that describe a SecretFlow multimodal confidential training task and keep them compatible with `algorithmParams.secretflowSpec`.

## Context

- Spec: `kitty-specs/secretflow-workload-runtime-01KV783M/spec.md` (FR-001)
- Data model: `kitty-specs/secretflow-workload-runtime-01KV783M/data-model.md`
- MVP constraint: no Python SecretFlow, GPU, TEEU, HEU, DICOM, or VCF dependencies (C-001)

## Implementation Command

```bash
spec-kitty agent action implement WP01 --agent cursor --mission secretflow-workload-runtime-01KV783M
```

### Subtask T001: Define SecretFlowTaskSpec and related domain types

**Purpose**: Create shared TypeScript interfaces for the SecretFlow task envelope.

**Steps**:
1. Add `apps/api/src/compute-task/dto/secretflow-task-spec.ts` with:
   - `SecretFlowModalityType`
   - `SecretFlowParty`, `SecretFlowModalitySpec`
   - `SecretFlowModelBackbone`, `SecretFlowPeftStrategy`, `SecretFlowFusionBridge`
   - `SecretFlowPrivacySpec`, `SecretFlowOutputPolicy`
   - `SecretFlowTaskSpec`
2. Mirror connector types in `apps/connector/src/domain/secretflow/secretflow-task-spec.ts`.
3. Keep shapes aligned with `data-model.md` and OpenAPI contract.

**Files**: API and connector spec type files (~120 lines total)

### Subtask T002: Add structural validation predicates

**Purpose**: Provide narrow helpers for required-section checks without heavy runtime coupling.

**Steps**:
1. Add predicates such as `isSecretFlowTaskSpec`, `hasRequiredParties`, `hasRequiredModalities`.
2. Keep helpers pure and side-effect free.
3. Export only what WP02 and connector routing need.

**Validation**: Predicates return false for empty parties/modalities and true for minimal valid specs.

### Subtask T003: Add spec shape tests

**Purpose**: Lock the spec contract with unit tests.

**Steps**:
1. Add `secretflow-task-spec.spec.ts` beside API and/or connector spec files.
2. Cover valid minimal spec and invalid missing-section cases.
3. Do not require database or Nest bootstrap.

## Definition Of Done

- TypeScript compiles for API and connector packages.
- Spec types match `algorithmParams.secretflowSpec` storage shape.
- No external SecretFlow or medical parser dependencies added.

## Risks

- API/connector type drift — mitigate by keeping shapes identical in this WP.

## Reviewer Guidance

- Confirm modality enum values match spec.
- Confirm no raw clinical payload fields appear in spec types.

## Activity Log

- 2026-06-16T04:02:42Z – unknown – SecretFlow spec types, predicates, and tests implemented
