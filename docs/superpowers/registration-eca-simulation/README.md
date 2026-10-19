# Simulated Registration External-Control Study Dossier

> **SIMULATION ONLY / 仅用于平台与方法学演练**
>
> 本文件包中的产品、适应症、疗效、安全性、机构、人员、日期、审批、监管沟通和统计结果均为虚构或注入参数。
> 不得将本文件包作为真实药品/器械的临床证据、注册申报材料、监管承诺或医疗决策依据。

## Reference identity

| Item | Simulated value |
|---|---|
| Study | `REG-ECA-001` |
| Product | `SIM-MAB-01` — fictional investigational monoclonal antibody |
| Indication | `SIM-DERM-01` — fictional chronic inflammatory dermatologic condition |
| Design | Single-arm trial with historical external controls |
| Objective | Superiority |
| Estimand | ATT |
| Estimator | IPTW-ATT |
| Time zero | First qualifying treatment/index visit |
| Follow-up | 24 weeks |
| Primary outcome | Week-24 binary response |
| Synthetic truth | Response risk ratio `RR = 0.65` |
| Data boundary | Synthea-style synthetic population plus explicit injected structure |

## Dossier index

1. [P0 decision record](./00-p0-decision-record.md)
2. [Protocol](./01-protocol.md)
3. [Statistical Analysis Plan](./02-sap.md)
4. [Cohort sufficiency and power](./03-cohort-sufficiency.md)
5. [Data source applicability](./04-data-source-applicability.md)
6. [Regulatory communication simulation](./05-regulatory-communication.md)
7. [Independent statistical review](./06-independent-statistical-review.md)
8. [Evidence and reproducibility](./07-evidence-and-reproducibility.md)

## Machine-readable reference

- [Registration study profile](../../../data/synthea/registration-reference-study.json)
- [Pinned Synthea inputs](../../../data/synthea/registration-inputs.json)
- [Synthetic generator](../../../scripts/generate-synthea-registration-cohort.sh)
- [Fixture and answer-key builder](../../../scripts/build-registration-eca-fixtures.mjs)
- [Independent Python review](../../../scripts/statistical-reference/registration_eca_review.py)

## Completion rule

This dossier completes the **engineering simulation**. It does not complete a real
registration study. Before any real execution, humans must replace every fictional
field, approve the protocol/SAP, execute source agreements, verify data suitability,
and conduct regulator communication.
