---
work_package_id: WP05
title: Safe Output And Attestation Contract
dependencies:
- WP04
requirement_refs:
- FR-005
- C-003
- NFR-002
planning_base_branch: feat/federated-data-space-rws
merge_target_branch: feat/federated-data-space-rws
branch_strategy: Planning artifacts for this feature were generated on feat/federated-data-space-rws. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into feat/federated-data-space-rws unless the human explicitly redirects the landing branch.
subtasks:
- T013
- T014
- T015
phase: Phase 5 - Output Safety
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
- apps/connector/src/domain/secretflow/secretflow-run-result.ts
- apps/connector/src/domain/secretflow/secretflow-output-guard.ts
- apps/connector/src/domain/secretflow/secretflow-output-guard.spec.ts
tags: []
---

# Work Package Prompt: WP05 - Safe Output And Attestation Contract

## Objective

Define and enforce the safe output envelope for mock SecretFlow runs.

## Context

- Builds on mock adapter output from WP04.
- Must satisfy FR-005 and data residency constraint C-003.
- Output may later be stored in `ComputeTask.resultSummary`.

## Implementation Command

```bash
spec-kitty agent action implement WP05 --agent cursor --mission secretflow-workload-runtime-01KV783M
```

### Subtask T013: Define SecretFlowRunResult envelope

**Purpose**: Model only safe artifacts and metadata.

**Steps**:
1. Add `secretflow-run-result.ts` with:
   - `SecretFlowRunResult`
   - `SecretFlowAttestationSummary`
   - `SecretFlowPrivacySummary`
   - optional `SecretFlowModelCardSummary`
2. Include LoRA delta hash, encrypted delta ref, aggregate metrics, attestation hash.

### Subtask T014: Add output guard checks

**Purpose**: Prevent unsafe payloads from leaving the connector.

**Steps**:
1. Add `secretflow-output-guard.ts` with serialization/filter helpers.
2. Reject or strip keys resembling raw DICOM, VCF, patient rows, gradients, embeddings.
3. Integrate guard into mock adapter `run` return path.

### Subtask T015: Add safe output contract tests

**Purpose**: Prove safe shape and absence of forbidden fields.

**Steps**:
1. Add `secretflow-output-guard.spec.ts`.
2. Assert required safe fields exist on mock run results.
3. Assert forbidden field names are absent from JSON output.

## Definition Of Done

- Connector tests pass with output guard enabled.
- Mock run results are safe-metadata-only.
- No patient-level or raw modality payloads in envelope.

## Reviewer Guidance

- Review forbidden key list against spec C-003.
- Confirm guard runs on every mock run path.

## Activity Log

- 2026-06-16T05:51:23Z – unknown – Safe output envelope and guard verified
