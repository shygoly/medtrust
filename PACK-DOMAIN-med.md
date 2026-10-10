# PACK-DOMAIN-med.md — 医疗包实体册

> **分册规则（D-SPD-1 / P11.4）**：基座实体在 [DOMAIN.md](DOMAIN.md)，行业专属实体在本册。
> **一张表只许出现在一册**——`scripts/check-meta-docs.mjs` 对两册做并集与重复校验：
> 重复登记、平面非法、小节标题缺失都是红。
> 术语与平面语义见 [DOMAIN.md](DOMAIN.md) 术语表；医疗包的证据/合规契约见
> [EVIDENCE.md](EVIDENCE.md) / [REGULATORY.md](REGULATORY.md)。

## 覆盖矩阵

| 实体表 | 平面 | 小节 |
|---|---|---|
| cp_rws_task | control-plane | RWS 编排（医疗包） |
| cp_rws_assignment | control-plane | RWS 编排（医疗包） |
| cp_fl_prediction_task | control-plane | RWS 编排（医疗包） |
| cp_fl_prediction_assignment | control-plane | RWS 编排（医疗包） |
| cp_kri_definition | control-plane | RBQM 监查（医疗包） |
| cp_kri_observation | control-plane | RBQM 监查（医疗包） |
| cp_qtl_breach | control-plane | RBQM 监查（医疗包） |
| local_record | connector-local | 连接器本地（医疗包） |
| local_gold_standard | connector-local | 连接器本地（医疗包） |
| local_data_source_status | connector-local | 连接器本地（医疗包） |

## RWS 编排（医疗包）

医疗包专属：真实世界研究（RWS）阶梯与 L4 联邦预测任务的编排实体。基座侧的编排机制
（MDOP 作业 / 阶段 / 凭证）在 DOMAIN.md 的「MDOP 内核」小节，与行业无关。

## RBQM 监查（医疗包）

关键风险指标（KRI）定义、观测与质量容忍限（QTL）越限。该「站点级聚合三元组 → 闸门 →
越限判定 → 存证」是**可复用模式**，但 KRI 定义与阈值属医疗领域，故实体归本册。

## 连接器本地（医疗包）

院内本地记录 / 金标准 / 数据源状态。**永不出域**（D1）；平面为 `connector-local`，
与基座连接器实体（审计、MDOP 本地表）同平面但不同册。
