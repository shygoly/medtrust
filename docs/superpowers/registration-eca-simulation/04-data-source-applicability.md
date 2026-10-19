# Simulated Data-Source Applicability Report

> **SIMULATION ONLY.** All source names, coverage metrics and agreements are fictional.

## 1. Source roles

| Role | Fictional source | Data product | Simulated contract |
|---|---|---|---|
| Trial | Sponsor trial source | `dp-trial-sim` | `ct-trial-sim` |
| External primary | Site A | `dp-control-a-sim` | `ct-control-a-sim` |
| External secondary | Site B | `dp-control-b-sim` | `ct-control-b-sim` |

No real hospital, sponsor or data product is named.

## 2. Relevance

### Trial source

- Contains the fictional `SIM-MAB-01` exposure and synthetic standard-care history.
- Captures trial eligibility, treatment start, response phenotype and follow-up.
- Simulated field completeness: 98%.

### External primary source

- Contains synthetic standard care and the same outcome phenotype.
- Index date maps to the first qualifying standard-care visit.
- Simulated field completeness: 96%.

### External secondary source

- Independent simulated site with a different historical calendar mix.
- Used for reproduction and heterogeneity, not pooled into the primary result.
- Simulated field completeness: 94%.

## 3. Reliability

Simulated checks:

- immutable snapshot digest recorded before execution;
- direct identifiers excluded from the projection;
- source-specific phenotype version recorded;
- duplicate `linkKey` rejected;
- impossible date ordering rejected;
- outcome ascertainment window and censoring rules checked;
- required fields missing from projection counted, not silently deleted;
- source-specific event rate compared with injected truth.

## 4. Traceability

Every result must trace to:

1. study profile version;
2. protocol and SAP versions/digests;
3. source role and data-product version;
4. contract ID and ContractBundle version;
5. projection digest;
6. logical and physical plan hashes;
7. operator reference and module SM3;
8. TEE attestation and KMS release evidence;
9. C3 result digest;
10. node audit and destruction receipts.

## 5. Missingness

Primary analysis uses a complete synthetic fixture. Separate stress fixtures inject:

- MCAR;
- MAR;
- MNAR;
- loss to follow-up;
- competing-risk events.

The missing pattern, mechanism label, missing fraction and imputed-cell count are published.
No missing value is converted to a negative outcome.

## 6. Source heterogeneity

The simulated external sources intentionally differ in:

- baseline response risk;
- severity distribution;
- calendar year;
- standard-care intensity;
- follow-up completeness.

The primary and secondary source estimates are reported separately. Agreement is not
assumed, and disagreement cannot be hidden by pooling.

## 7. Applicability conclusion

Within the simulation, all three source partitions are relevant, reliable enough for
method testing and traceable to synthetic versions. For a real study, source agreements,
phenotype validation, data provenance, ethics and regulator access must be independently
completed.
