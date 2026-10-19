# Simulated Independent Statistical Review

> **SIMULATION ONLY.** The reviewer identity and sign-off are fictional.

## 1. Review scope

- protocol and estimand;
- target-trial time zero;
- eligibility and intercurrent-event handling;
- propensity model and trimming;
- IPTW-ATT implementation;
- missingness and censoring;
- balance/overlap diagnostics;
- effect and uncertainty calculation;
- sensitivity and truth-recovery tests;
- independence from the TypeScript/WASM implementation.

## 2. Independent implementations

| Implementation | Role |
|---|---|
| TypeScript/WASM operator | Production-path execution and C3 generation |
| stdlib-only Python program | Independent analysis and answer-key recovery |

The Python program does not import the TypeScript or WebAssembly estimator.

## 3. Simulated review findings

### Finding S-1 — target-trial alignment

The trial and external controls use semantically aligned time-zero definitions. A real
study must validate index-date availability separately in each source.

### Finding S-2 — positivity

The operator fails closed when trimming exceeds 10%, effective sample size is too small,
weights exceed configured limits or either arm becomes empty.

### Finding S-3 — residual confounding

Post-weight SMD is published per covariate. A post-weight SMD above 0.1 remains visible and
prevents a blanket “balanced” statement.

### Finding S-4 — missing data

The simulation engine uses deterministic mean imputation for core numeric covariates and
declares this limitation. Registration-grade multiple imputation is not claimed.

### Finding S-5 — synthetic truth recovery

The independent Python test demonstrates that the adjusted RR is closer to the injected
truth than the crude RR and that weighted SMD falls below 0.1 in the reference fixture.

### Finding S-6 — source heterogeneity

Primary and secondary sources are reported separately. The second source is not pooled
into the primary ATT estimate.

## 4. Simulated sign-off

| Role | Decision |
|---|---|
| Fictional independent statistician | Reviewed for simulation; no real-study approval |
| Fictional sponsor statistician | SAP and code frozen for simulation |
| Fictional data steward | Synthetic source versions and projections accepted for simulation |

## 5. Required real-world review

Before real execution:

- a named independent statistician must review the unblinded code and SAP;
- a second statistical environment must reproduce the primary result;
- every protocol/SAP deviation must be timestamped and justified;
- the independent reviewer must not be the author of the production estimator;
- results must remain blinded until the analysis is locked.
