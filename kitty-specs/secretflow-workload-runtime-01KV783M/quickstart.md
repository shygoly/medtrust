# SecretFlow Workload Runtime Quickstart

## Purpose

This quickstart describes how to validate the SecretFlow workload runtime MVP once implemented. The MVP uses a mock adapter and does not require real SecretFlow, TEEU, HEU, GPU, DICOM, or VCF tooling.

## 1. Build Shared Packages

```bash
pnpm --filter @medtrust/database build
pnpm --filter @medtrust/api build
```

## 2. Run API Validation Tests

```bash
pnpm --filter @medtrust/api test -- secretflow
```

Expected behavior:

- Valid `workloadType = "secretflow"` task specs are accepted.
- Missing `algorithmParams.secretflowSpec` returns a 400 error.
- Missing parties, modalities, model backbone, or PEFT strategy returns a 400 error.
- `method = "fl"` returns a 400 error for SecretFlow workloads.

## 3. Run Connector Tests

```bash
pnpm --filter @medtrust/connector test
```

Expected behavior:

- Existing RWS tests pass.
- SecretFlow dispatch reaches `SecretFlowTaskRunner`.
- `MockSecretFlowAdapter` returns deterministic safe outputs.
- Unsupported workload types fail clearly.

## 4. Example SecretFlow Task Payload

```json
{
  "name": "Multimodal lymphoma LoRA mock run",
  "method": "tee",
  "workloadType": "secretflow",
  "contractId": "contract-secretflow-001",
  "algorithmParams": {
    "secretflowSpec": {
      "parties": [
        {
          "participantId": "cn-demohospa",
          "role": "provider",
          "connectorId": "cn-demohospa",
          "dataResidency": "hospital-local"
        },
        {
          "participantId": "research-consumer",
          "role": "consumer"
        }
      ],
      "modalities": [
        {
          "type": "dicom",
          "manifestUri": "local://pacs/lymphoma-study-list.json",
          "count": 1200
        },
        {
          "type": "genomics",
          "manifestUri": "local://genomics/variants.manifest.json",
          "count": 1200
        }
      ],
      "llmBackbone": {
        "modelType": "huggingface/decoder_only",
        "modelNameOrPath": "Qwen/Qwen2-7B-Instruct"
      },
      "peftStrategy": {
        "type": "lora",
        "r": 16,
        "alpha": 32,
        "targetModules": ["q_proj", "v_proj"]
      },
      "fusionBridge": {
        "type": "perceiver_resampler",
        "hiddenSize": 4096,
        "numQueries": 64
      },
      "privacy": {
        "teeRequired": true,
        "heuEnabled": true,
        "dpSgd": {
          "clipNorm": 1,
          "noiseMultiplier": 0.8,
          "targetEpsilon": 8
        }
      },
      "outputPolicy": {
        "allowedArtifacts": [
          "lora_delta_hash",
          "encrypted_delta_ref",
          "aggregate_metrics",
          "attestation_report",
          "model_card"
        ]
      }
    }
  }
}
```

## 5. Build Web Docs

```bash
pnpm --filter web build
```

Expected behavior:

- `/docs` builds as a static route.
- The docs explain SecretFlow as the future multimodal confidential runtime and call out MVP mock execution.
