# Simulated Cohort Sufficiency Report

> **SIMULATION ONLY.** Counts and performance assumptions below are planning values for
> a fictional study. They are not estimates from real patients.

## What “cohort” means here

A **cohort** is the group of people who satisfy the same pre-specified eligibility rules,
are aligned to the same time-zero definition and are followed under the same outcome and
censoring rules. In this study it means:

1. adults with the frozen synthetic diagnosis;
2. no prior fictional index-class treatment;
3. observed from time zero through the week-24 outcome window;
4. assigned to the trial strategy or the external standard-care strategy.

The trial arm and external-control arm are two source partitions of the target trial
population definition, not two unrelated datasets.

## What “cohort sufficiency” means

**Cohort sufficiency** means that the available cohort can support the planned estimate and
its diagnostics. A large raw population is not automatically sufficient. The platform checks:

- enough eligible participants in each arm;
- enough events for the binary outcome;
- adequate overlap between trial and external-control propensity distributions;
- enough participants in key age/sex/severity/calendar strata;
- acceptable missingness and censoring;
- enough remaining effective sample size after trimming and weighting;
- enough candidates to support the optional second external source.

## Simulated power assumptions

| Parameter | Value |
|---|---:|
| Two-sided alpha | 0.05 |
| Power | 80% |
| Control response risk | 0.35 |
| Simulated truth RR | 0.65 |
| Trial response risk | 0.2275 |
| Required per arm before attrition | 211 |
| Trial target after 10% attrition | 240 |
| Primary external-control target | 5000 candidates |
| Optional second control target | 2500 candidates |
| Planned Synthea-style population | 50000 |

The normal-approximation planning calculation gives approximately 211 participants per arm
for the stated binary risks. This is a planning illustration, not a guarantee of achieved
power after weighting, missingness and overlap.

## Simulated source allocation

| Partition | Target | Purpose |
|---|---:|---|
| Trial | 240 | Primary single-arm cohort |
| External primary | 2500 | Primary ATT comparator |
| External secondary | 2500 | Independent reproduction/heterogeneity |
| Holdout/calibration | 44760 | Generator calibration and negative controls |
| Total planned population | 50000 | Synthetic generation input |

## Simulated sufficiency gates

| Gate | Pass criterion | Simulated planning result |
|---|---|---|
| Eligible trial participants | ≥ 240 | 240 planned |
| Primary controls | ≥ 2500 | 2500 planned |
| Secondary controls | ≥ 2500 | 2500 planned |
| Primary response events | ≥ 50 per arm | Expected to pass under injected risks |
| Propensity overlap | > 90% retained after trimming | Planning assumption |
| Post-weight SMD | ≤ 0.10 for key covariates | Planning assumption |
| Weight limit | max ≤ 20 and P99 ≤ 10 | Must be observed in generated run |
| Missing core variables | ≤ 20% | Primary fixture complete; stress files vary |
| Effective sample size | Configured minimum | Must be observed in generated run |

## Stop rules

The simulated study stops or reports “not estimable” when:

- the trial or primary external-control arm is empty;
- key strata have no compatible controls;
- more than 10% must be removed for positivity;
- extreme weights exceed the pre-specified limits;
- missingness exceeds 20%;
- the outcome is zero in either arm;
- the propensity model does not converge;
- the generated target diagnosis count is zero.

## Reproducible generation command

```bash
scripts/generate-synthea-registration-cohort.sh \
  --population 50000 \
  --seed 20261017 \
  --age 18-80 \
  --state Massachusetts \
  --reference-date 20261001 \
  --keep-module data/synthea/modules/keep_registration_indication.json \
  --output data/synthea/registration-20261017
```

The generated directory contains `generation-manifest.json`,
`data-quality-report.json`, source partitions and `answer-key.json`.
