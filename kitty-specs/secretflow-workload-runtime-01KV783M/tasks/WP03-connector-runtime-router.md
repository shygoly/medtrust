---
work_package_id: WP03
title: Connector Runtime Router
dependencies:
- WP01
requirement_refs:
- FR-003
- NFR-003
- C-002
planning_base_branch: feat/federated-data-space-rws
merge_target_branch: feat/federated-data-space-rws
branch_strategy: Planning artifacts for this feature were generated on feat/federated-data-space-rws. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/federated-data-space-rws unless the human explicitly redirects the landing branch.
subtasks:
- T007
- T008
- T009
phase: Phase 3 - Data Plane Dispatch
assignee: ''
agent: ''
history:
- timestamp: '2026-06-16T03:37:56Z'
  agent: cursor
  action: Prompt generated for SecretFlow workload runtime mission.
- timestamp: '2026-06-16T03:58:30Z'
  agent: cursor
  action: Enriched from wps.yaml manifest during tasks-packages.
authoritative_surface: apps/connector/src/domain/
execution_mode: code_change
owned_files:
- apps/connector/src/domain/connector-task-runner.ts
- apps/connector/src/domain/task-puller.ts
- apps/connector/src/domain/secretflow/secretflow-task-runner.ts
- apps/connector/src/domain/secretflow/secretflow-task-runner.spec.ts
tags: []
---

# Work Package Prompt: WP03 - Connector Runtime Router

## Objective

Introduce a clean connector workload routing boundary so RWS and SecretFlow are separate data-plane runtimes.

## Context

- `connector-task-runner.ts` currently validates RWS analysis for non-secretflow paths.
- `task-puller.ts` already carries optional `workloadType` and `secretflowSpec`.
- This WP adds routing only; mock execution lands in WP04.

## Implementation Command

```bash
spec-kitty agent action implement WP03 --agent cursor --mission secretflow-workload-runtime-01KV783M
```

### Subtask T007: Introduce connector workload dispatch boundary

**Purpose**: Centralize routing by top-level `workloadType`.

**Steps**:
1. Refactor `connector-task-runner.ts` to branch on `workloadType`.
2. Default or explicit `rws` continues through existing RWS path.
3. Unknown workload types throw a clear unsupported workload error.

### Subtask T008: Add SecretFlowTaskRunner shell

**Purpose**: Provide a dedicated runner entry point for SecretFlow tasks.

**Steps**:
1. Create `secretflow-task-runner.ts` with a minimal `run` method.
2. Accept `secretflowSpec` from dispatched task payload.
3. In this WP, shell may return a placeholder or delegate stub until WP04 wires the adapter.

### Subtask T009: Add connector routing tests

**Purpose**: Guard RWS regression and prove SecretFlow routing.

**Steps**:
1. Add `secretflow-task-runner.spec.ts` and extend connector tests as needed.
2. Assert existing RWS tests still pass.
3. Assert `workloadType: "secretflow"` reaches `SecretFlowTaskRunner`.

## Definition Of Done

- RWS connector tests pass unchanged.
- SecretFlow dispatch is isolated from RWS executor.
- No real SecretFlow runtime invoked.

## Reviewer Guidance

- Confirm RWS orchestrator still sets `workloadType: 'rws'` explicitly.
- Confirm error text for unknown workloads is stable for operators.
