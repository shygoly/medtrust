# Simulated Study Protocol

> **SIMULATION ONLY.** `SIM-MAB-01` and `SIM-DERM-01` are fictional identifiers.

## 1. Study identity

| Field | Value |
|---|---|
| Protocol | `REG-ECA-001 / reference-protocol-1` |
| Study profile | `registration-eca/1.0.0` |
| SAP | `reference-sap-1` |
| Design | Single-arm trial with historical external controls |
| Objective | Superiority |
| Evidence role | Supportive within the simulation |

## 2. Target trial

The target trial is a hypothetical randomized comparison between:

- **Trial strategy:** `SIM-MAB-01` plus synthetic standard care.
- **External-control strategy:** synthetic standard care without `SIM-MAB-01`.

The external controls are used to emulate the randomized comparator under pre-specified
eligibility, time zero, follow-up, outcome and intercurrent-event rules.

## 3. Eligibility

Participants must satisfy all criteria at time zero:

1. Age 18–80 years in the synthetic source.
2. Active synthetic `SIM-DERM-01` diagnosis using the frozen phenotype.
3. No prior use of the fictional index treatment class.
4. Eligible for synthetic standard care.
5. At least 24 weeks of observable follow-up unless administratively censored.
6. No missing core time-zero variable after the pre-specified imputation rule.

## 4. Time zero

- Trial participants: first administration of `SIM-MAB-01`.
- Primary external controls: first qualifying standard-care/index visit.
- Secondary external controls: the same semantic mapping.
- Measurements used as confounders must occur on or before time zero.
- Outcomes are identified only after time zero.

## 5. Treatment strategies and intercurrent events

The primary estimand uses a **treatment-policy** strategy:

- Discontinuation does not remove a participant from the assigned strategy.
- Rescue therapy remains in the assigned strategy and is recorded.
- Death or a synthetic competing risk is retained as an intercurrent event and described
  separately; it is not silently treated as ordinary censoring.

## 6. Outcome

**Primary outcome:** week-24 binary response, defined by the same frozen synthetic
phenotype in trial and external-control sources.

Response is positive when all simulated criteria are met:

- improvement threshold achieved;
- no rescue-related disqualification under the treatment-policy rule;
- observation reaches the week-24 assessment window.

Administrative censoring occurs after the week-24 assessment. Loss to follow-up before
that point is reported and handled according to the SAP.

## 7. Treatment groups and source allocation

| Role | Simulated source | Strategy |
|---|---|---|
| Trial | Fictional sponsor single-arm source | `SIM-MAB-01` + standard care |
| External primary | Fictional site A historical cohort | Standard care |
| External secondary | Fictional site B historical cohort | Standard care |

The three source partitions are mutually exclusive by `linkKey`. Duplicate or overlapping
link keys fail the build.

## 8. Confounders

Pre-specified confounders:

- age;
- sex;
- calendar year;
- severity;
- disease duration;
- comorbidity index;
- prior treatment;
- key biomarker.

No adaptive confounder selection is allowed after outcome inspection.

## 9. Bias controls

- Target-trial alignment of eligibility, time zero, follow-up and outcome.
- Explicit source exclusion counts.
- Propensity-score overlap and positivity diagnostics.
- Pre-specified IPTW-ATT trimming and weight limits.
- Weighted SMD before/after adjustment.
- Missingness, censoring and competing-risk reports.
- Negative-control outcome.
- Alternative time-zero window and trimming sensitivity analyses.
- Independent second statistical implementation.
- Synthetic answer-key recovery.

## 10. Reporting boundary

The simulated results may demonstrate pipeline correctness and bias behavior. They must
not be described as evidence that `SIM-MAB-01` works in real patients or that a real
regulatory submission would succeed.
