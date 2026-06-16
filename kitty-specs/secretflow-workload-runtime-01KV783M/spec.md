# SecretFlow Workload Runtime Specification

## Summary

Add first-class support for `workloadType = "secretflow"` as a future multimodal confidential training workload in MedTrust. The first release creates the governed task specification, API validation, connector dispatch path, and mock runtime adapter. It does not integrate real SecretFlow, TEEU, HEU, confidential GPUs, DICOM parsing, VCF parsing, or real model training.

## Problem

MedTrust now has a common task discriminator through `ComputeTask.workloadType`. The current code can distinguish `legacy`, `rws`, `federated_learning`, and `secretflow`, but `secretflow` is only a reserved type. The system needs a concrete plan to make `secretflow` tasks governable and executable through the same control-plane/data-plane architecture while preserving the existing RWS connector path.

## Goals

- Define a stable `SecretFlowTaskSpec` for multimodal confidential training tasks.
- Validate `secretflow` tasks at API creation time.
- Route `secretflow` workloads in the connector without coupling them to RWS execution.
- Provide a mock SecretFlow runtime adapter that returns deterministic simulated training results.
- Preserve existing RWS behavior and tests.
- Document the separation between `workloadType` and `method`.

## Non-Goals

- Real SecretFlow Python SDK integration.
- Real TEEU/HEU, threshold key distribution, or remote attestation.
- Real DICOM/PACS or VCF/genomics ETL.
- Real LoRA fine-tuning or encrypted gradient aggregation.
- DID/VC or ODRL governance implementation.

## User Scenarios

### Scenario 1: Create A Governed SecretFlow Task

A researcher submits a `ComputeTask` with:

- `workloadType = "secretflow"`
- `method = "tee"` or `method = "mpc"`
- `algorithmParams.secretflowSpec` containing parties, modalities, model backbone, PEFT strategy, and privacy settings

The API validates the task and stores it as a normal control-plane task record.

### Scenario 2: Connector Receives SecretFlow Dispatch

A connector receives a dispatched task with `workloadType = "secretflow"` and a `secretflowSpec`. The connector routes it to a dedicated SecretFlow runner rather than the RWS executor.

### Scenario 3: Mock Runtime Produces Safe Outputs

The mock SecretFlow adapter simulates a run and returns only safe output metadata:

- LoRA delta hash
- encrypted delta reference
- aggregate metrics
- attestation report hash
- privacy summary

No raw DICOM, raw VCF, patient rows, unencrypted gradients, or embeddings leave the connector.

## Functional Requirements

### FR-001: SecretFlow Task Specification

Status: Proposed

The system MUST define a shared `SecretFlowTaskSpec` with these required sections:

- `parties`: participating institutions and roles
- `modalities`: declared data modalities such as `dicom`, `genomics`, `clinical_text`, `structured_ehr`
- `llmBackbone`: model family and model path
- `peftStrategy`: LoRA configuration
- `privacy`: TEE, HEU, and optional DP-SGD settings
- `outputPolicy`: allowed output artifact kinds

### FR-002: API Validation

Status: Proposed

The API MUST reject invalid `secretflow` tasks with clear `400 Bad Request` messages when:

- `algorithmParams.secretflowSpec` is missing
- no parties are declared
- no modalities are declared
- `llmBackbone` is missing
- `peftStrategy` is missing
- `method` is not `tee` or `mpc`

### FR-003: Connector Workload Routing

Status: Proposed

The connector MUST route workloads by top-level `workloadType`:

- `rws` continues to use the existing RWS runner
- `secretflow` uses a new SecretFlow runner
- unknown workload types fail with a clear unsupported workload error

### FR-004: Mock SecretFlow Runtime

Status: Proposed

The first SecretFlow adapter MUST be a mock adapter. It MUST implement a stable runtime adapter interface:

- `validateEnvironment`
- `prepare`
- `run`
- `cleanup`

It MUST return deterministic structured results that can be tested without external services.

### FR-005: Output Safety

Status: Proposed

SecretFlow output MUST be constrained to metadata and safe artifacts. The first release MUST block or avoid any output shape that resembles raw patient-level data, raw imaging payloads, raw genomic records, unencrypted gradients, or intermediate embeddings.

### FR-006: Documentation

Status: Proposed

The public `/docs` page MUST explain SecretFlow as a future multimodal confidential training runtime and distinguish it from RWS and federated learning workloads.

## Non-Functional Requirements

### NFR-001: Testability

Status: Proposed

SecretFlow MVP tests MUST run without Python SecretFlow, GPU hardware, TEEU, HEU, DICOM parser, or VCF parser dependencies. The connector test suite MUST complete using only Node.js dependencies already present in the monorepo.

### NFR-002: Determinism

Status: Proposed

The mock SecretFlow adapter MUST produce deterministic hashes and result values for the same task id and task spec so tests can assert exact output.

### NFR-003: Backward Compatibility

Status: Proposed

Existing RWS connector tests MUST continue to pass, and existing `workloadType = "rws"` dispatch behavior MUST remain unchanged except for being routed through the new workload boundary.

## Constraints

### C-001: No Real SecretFlow Runtime In MVP

Status: Accepted

The MVP MUST NOT add a real SecretFlow Python SDK, TEEU, HEU, GPU, MONAI, DICOM, or VCF runtime dependency.

### C-002: Preserve `method` Semantics

Status: Accepted

The implementation MUST NOT repurpose `ComputeTask.method`. `workloadType` describes the task family; `method` remains the execution channel.

### C-003: Data Residency

Status: Accepted

The SecretFlow runtime result MUST NOT include raw clinical records, raw DICOM payloads, raw VCF records, unencrypted gradients, or intermediate embeddings.

## Data Model

```ts
type SecretFlowModalityType = 'dicom' | 'genomics' | 'clinical_text' | 'structured_ehr';

interface SecretFlowTaskSpec {
  parties: SecretFlowParty[];
  modalities: SecretFlowModalitySpec[];
  llmBackbone: {
    modelType: string;
    modelNameOrPath: string;
  };
  peftStrategy: {
    type: 'lora';
    r: number;
    alpha: number;
    targetModules: string[];
  };
  fusionBridge?: {
    type: 'linear_projection' | 'perceiver_resampler';
    hiddenSize: number;
    numQueries?: number;
  };
  privacy: {
    teeRequired: boolean;
    heuEnabled: boolean;
    dpSgd?: {
      clipNorm: number;
      noiseMultiplier: number;
      targetEpsilon?: number;
    };
  };
  outputPolicy: {
    allowedArtifacts: Array<'lora_delta_hash' | 'encrypted_delta_ref' | 'aggregate_metrics' | 'attestation_report' | 'model_card'>;
  };
}
```

## Acceptance Criteria

- API accepts valid `secretflow` tasks and rejects invalid task specs with specific 400 errors.
- Connector dispatch supports `secretflow` without regressing existing RWS tests.
- Mock SecretFlow adapter returns a typed result containing safe artifact references and attestation metadata.
- `/docs` describes the SecretFlow workload path and its relationship to `workloadType` and `method`.
- Existing verification commands for database, API build/tests, connector tests, and web build pass or have documented pre-existing failures.
