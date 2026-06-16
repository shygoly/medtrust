---
work_package_id: WP04
title: Mock SecretFlow Adapter
dependencies:
- WP03
requirement_refs:
- FR-004
- NFR-001
- NFR-002
- C-001
planning_base_branch: feat/federated-data-space-rws
merge_target_branch: feat/federated-data-space-rws
branch_strategy: Planning artifacts for this feature were generated on feat/federated-data-space-rws. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/federated-data-space-rws unless the human explicitly redirects the landing branch.
subtasks:
- T010
- T011
- T012
phase: Phase 4 - Mock Runtime
assignee: ''
agent: ''
history:
- timestamp: '2026-06-16T03:37:56Z'
  agent: cursor
  action: Prompt generated for SecretFlow workload runtime mission.
- timestamp: '2026-06-16T03:58:30Z'
  agent: cursor
  action: Enriched from wps.yaml manifest during tasks-packages.
authoritative_surface: apps/connector/src/domain/secretflow/
execution_mode: code_change
owned_files:
- apps/connector/src/domain/secretflow/secretflow-runtime-adapter.ts
- apps/connector/src/domain/secretflow/mock-secretflow-adapter.ts
- apps/connector/src/domain/secretflow/mock-secretflow-adapter.spec.ts
tags: []
---

# Work Package Prompt: WP04 - Mock SecretFlow Adapter

## Objective

Provide a deterministic mock runtime adapter for SecretFlow tasks so the control-plane/data-plane loop can be exercised without external services.

## Context

- Depends on WP03 routing into `SecretFlowTaskRunner`.
- MVP must not import Python SecretFlow or GPU/TEEU/HEU tooling.
- Deterministic outputs required for NFR-002.

## Implementation Command

```bash
spec-kitty agent action implement WP04 --agent cursor --mission secretflow-workload-runtime-01KV783M
```

### Subtask T010: Define SecretFlowRuntimeAdapter interface

**Purpose**: Establish the runtime lifecycle contract.

**Steps**:
1. Add `secretflow-runtime-adapter.ts` with interface methods:
   - `validateEnvironment`
   - `prepare`
   - `run`
   - `cleanup`
2. Define input/output types using WP01 spec types where possible.

### Subtask T011: Implement MockSecretFlowAdapter

**Purpose**: Simulate a confidential training run with stable hashes.

**Steps**:
1. Implement `MockSecretFlowAdapter` in `mock-secretflow-adapter.ts`.
2. Derive hashes from `taskId` and canonical spec JSON.
3. Return structured prepared/run state without network I/O.

### Subtask T012: Add mock adapter unit tests

**Purpose**: Lock deterministic behavior and lifecycle coverage.

**Steps**:
1. Test environment validation success path.
2. Test prepare/run/cleanup sequence.
3. Assert identical inputs produce identical hashes.

## Definition Of Done

- `pnpm --filter @medtrust/connector test` passes.
- Mock adapter completes without external services.
- SecretFlowTaskRunner delegates to mock adapter.

## Reviewer Guidance

- Confirm no subprocess or Python invocation.
- Confirm hash derivation is stable across test runs.

## Activity Log

- 2026-06-16T05:44:55Z – unknown – Mock adapter lifecycle and deterministic outputs
