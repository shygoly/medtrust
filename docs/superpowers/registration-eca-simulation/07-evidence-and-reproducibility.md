# Simulated Evidence and Reproducibility Package

> **SIMULATION ONLY.** Hashes below identify the current simulated engineering
> artifacts. They are not regulatory submission hashes.

## 1. Version index

| Artifact | Identifier |
|---|---|
| Study profile | `registration-eca/1.0.0` |
| Simulation packet | `registration-eca-simulation/1.0.0` |
| Protocol | `reference-protocol-1` |
| SAP | `reference-sap-1` |
| Operator | `rws.external-control-registration@1.0.0` |
| Result schema | `rws.external-control-registration/1.0` |
| Evidence schema | `medtrust.registration-evidence/v1` |

## 2. Artifact hashes

| Artifact | SHA-256 |
|---|---|
| Study profile | `45ef36e80256be8323bd618292b75623113419e52ae57bdee4e1fe6dafcb604b` |
| Synthea generator | `103fb60cc788abf9fa34a6556dbc8cb043b7988b1b1288a091ef6ec972bd5e4f` |
| Fixture builder | `206149e2812d7bd104cf1032db048601707083187b18ca52b98b7bdaa0844eba` |
| TypeScript reference | `ae754e87b9895c276613d21225ecc0f38fe228deda41d2414c64a88d99d3ade6` |
| WASM source | `f17c6066abf988c477177a6859f5b4278d179e3f8c5eb97b8c3dbb64a6faf5b4` |
| Python independent program | `d4fcd421cdca76828c491b9d6a61cf7dae08cec3d4da0dff006e546bd9251bf3` |
| SAP | `fc3fe8e2200cdc473319a16c1c137b49ce598a52acdea733ea14779b8994dcae` |

The registered WASM module digest is generated into
`packages/wasm-algorithms/build/manifest.json`; execution checks the manifest digest against
the module bytes and the stage declaration. A reproducible build test reconstructs every
platform module and checks byte equality.

## 3. Reproduction sequence

```bash
# 1. Check pinned Synthea JAR and Keep Module
scripts/verify-synthea-registration-inputs.mjs

# 2. Generate synthetic cohort and fixtures
scripts/generate-synthea-registration-cohort.sh \
  --population 50000 \
  --seed 20261017 \
  --age 18-80 \
  --state Massachusetts \
  --reference-date 20261001 \
  --keep-module data/synthea/modules/keep_registration_indication.json \
  --output data/synthea/registration-20261017

# 3. Build algorithms and verify TS/WASM parity
pnpm --filter @medtrust/wasm-algorithms test

# 4. Run the independent statistical implementation
python3 scripts/statistical-reference/registration_eca_review.py \
  --fixtures data/synthea/registration-20261017/fixtures \
  --out data/synthea/registration-20261017/independent-review.json

# 5. Run platform tests and governance
pnpm test
```

## 4. Evidence package contents

A real execution would package:

1. study profile;
2. protocol and digest;
3. SAP and digest;
4. DSL and digest;
5. source roles, participant/data-product/contract IDs;
6. ContractBundle version and effective policy;
7. operator reference and module SM3;
8. logical plan hash and physical plan hash;
9. TEE attestation and KMS release evidence;
10. aggregate result and C3 digest;
11. balance/overlap/weight/missing/censoring diagnostics;
12. sensitivity and truth-recovery summary;
13. execution receipts;
14. purge receipts;
15. chain anchors and offline verification references.

## 5. C2/C3 boundary

- Raw rows remain inside the source/trusted node.
- C2 envelopes can only move to an attested node allowed by the member contract.
- A node-local publication review applies `minCell` and the strictest combined policy.
- Only C3 aggregate output is delivered to the platform.
- The job enters `PURGED` only after required node destruction receipts are collected.
- Receipt chains can be verified offline.

## 6. Current limitations

- Deterministic mean imputation is used in the simulation; it is not presented as
  registration-grade multiple imputation.
- The second external source is a separate replication source, not a pooled primary arm.
- Complete production equivalence for every real source schema remains a data-onboarding
  validation task.
- No actual regulator access, ethics approval or source-data agreement exists.
