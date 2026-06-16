---
work_package_id: WP02
title: API SecretFlow Validation
dependencies:
- WP01
requirement_refs:
- FR-002
- NFR-003
- C-002
planning_base_branch: feat/federated-data-space-rws
merge_target_branch: feat/federated-data-space-rws
branch_strategy: Planning artifacts for this feature were generated on feat/federated-data-space-rws. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/federated-data-space-rws unless the human explicitly redirects the landing branch.
subtasks:
- T004
- T005
- T006
phase: Phase 2 - Control Plane Validation
assignee: ''
agent: ''
history:
- timestamp: '2026-06-16T03:37:56Z'
  agent: cursor
  action: Prompt generated for SecretFlow workload runtime mission.
- timestamp: '2026-06-16T03:58:30Z'
  agent: cursor
  action: Enriched from wps.yaml manifest during tasks-packages.
authoritative_surface: apps/api/src/compute-task/
execution_mode: code_change
owned_files:
- apps/api/src/compute-task/compute-task.service.ts
- apps/api/src/compute-task/compute-task.service.spec.ts
- apps/api/src/compute-task/dto/create-compute-task.dto.ts
tags: []
---

# Work Package Prompt: WP02 - API SecretFlow Validation

## Objective

Make the API accept valid `workloadType = "secretflow"` tasks and reject invalid specs with clear `400 Bad Request` errors.

## Context

- Depends on WP01 spec types and predicates.
- Existing RWS validation in `validateWorkloadSpec` must remain unchanged.
- `method` remains execution channel; only `tee` and `mpc` are allowed for SecretFlow.

## Implementation Command

```bash
spec-kitty agent action implement WP02 --agent cursor --mission secretflow-workload-runtime-01KV783M
```

### Subtask T004: Extend CreateComputeTaskDto for SecretFlow

**Purpose**: Ensure request typing documents `algorithmParams.secretflowSpec`.

**Steps**:
1. Import or reference `SecretFlowTaskSpec` in DTO layer if helpful.
2. Keep `workloadType`, `contractId`, and `dataProductId` optional fields intact.
3. Do not persist `dataProductId` on the entity.

### Subtask T005: Implement API validateWorkloadSpec for SECRETFLOW

**Purpose**: Enforce FR-002 validation rules at task creation.

**Steps**:
1. Extend `validateWorkloadSpec` for `WorkloadType.SECRETFLOW`.
2. Require `algorithmParams.secretflowSpec`, parties, modalities, `llmBackbone`, `peftStrategy`.
3. Restrict `method` to `ComputeMethod.TEE` or `ComputeMethod.MPC`.
4. Throw `BadRequestException` with specific messages per missing section.

### Subtask T006: Add API validation tests

**Purpose**: Prove valid acceptance and invalid rejection paths.

**Steps**:
1. Add or extend `compute-task.service.spec.ts`.
2. Test happy path secretflow task creation.
3. Test missing spec, empty parties, invalid method.

## Definition Of Done

- `pnpm --filter @medtrust/api build` passes.
- Service tests cover valid and invalid SecretFlow creation.
- Legacy, RWS, and federated_learning behavior unchanged.

## Reviewer Guidance

- Verify error messages are actionable for API clients.
- Verify no SecretFlow validation runs for non-secretflow workloads.

## Activity Log

- 2026-06-16T04:16:43Z – unknown – API SecretFlow validation and tests implemented
