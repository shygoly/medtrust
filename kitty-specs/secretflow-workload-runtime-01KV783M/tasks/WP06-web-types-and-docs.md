---
work_package_id: WP06
title: Web Types And Docs
dependencies:
- WP01
requirement_refs:
- FR-006
- NFR-003
planning_base_branch: feat/federated-data-space-rws
merge_target_branch: feat/federated-data-space-rws
branch_strategy: Planning artifacts for this feature were generated on feat/federated-data-space-rws. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/federated-data-space-rws unless the human explicitly redirects the landing branch.
subtasks:
- T016
- T017
- T018
phase: Phase 6 - Documentation And UX Alignment
assignee: ''
agent: ''
history:
- timestamp: '2026-06-16T03:37:56Z'
  agent: cursor
  action: Prompt generated for SecretFlow workload runtime mission.
- timestamp: '2026-06-16T03:58:30Z'
  agent: cursor
  action: Enriched from wps.yaml manifest during tasks-packages.
authoritative_surface: apps/web/src/
execution_mode: code_change
owned_files:
- apps/web/src/types/compute-task.types.ts
- apps/web/src/app/docs/page.tsx
tags: []
---

# Work Package Prompt: WP06 - Web Types And Docs

## Objective

Align frontend types and public docs with the SecretFlow workload runtime MVP.

## Context

- Depends on WP01 spec shapes for type alignment.
- No full SecretFlow task creation UI in this mission.
- `/docs` already documents workload types; extend with SecretFlow runtime details.

## Implementation Command

```bash
spec-kitty agent action implement WP06 --agent cursor --mission secretflow-workload-runtime-01KV783M
```

### Subtask T016: Extend web SecretFlow task types

**Purpose**: Give frontend clients optional SecretFlow spec typing.

**Steps**:
1. Extend `compute-task.types.ts` with `SecretFlowTaskSpec` or a narrowed client view.
2. Keep `workloadType: 'secretflow'` documented alongside existing types.
3. Avoid importing server-only modules into the web bundle.

### Subtask T017: Update /docs SecretFlow section

**Purpose**: Explain SecretFlow as future multimodal confidential training runtime.

**Steps**:
1. Update `apps/web/src/app/docs/page.tsx` with SecretFlow MVP section.
2. Document mock adapter, safe outputs, and `workloadType` vs `method`.
3. Note future stages: CLI/Python adapter, then TEEU/HEU adapter.
4. Preserve existing RWS and federated learning documentation.

### Subtask T018: Verify web build

**Purpose**: Confirm docs route still compiles.

**Steps**:
1. Run `pnpm --filter web build`.
2. Fix any type or lint issues introduced by type additions.

## Definition Of Done

- `pnpm --filter web build` passes.
- `/docs` renders SecretFlow MVP explanation.
- No task creation form added in this mission.

## Reviewer Guidance

- Confirm docs distinguish SecretFlow from RWS and federated learning.
- Confirm MVP limitations are clearly stated.

## Activity Log

- 2026-06-16T05:55:50Z – unknown – Web types + /docs MVP section; build passes
