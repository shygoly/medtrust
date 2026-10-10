# PACK-TRUST-med.md — 医疗包敏感字段册

> **分册规则（D-SPD-1 / P11.4）**：基座敏感字段在 [TRUST.md](TRUST.md)，医疗包字段在本册。
> 控制点编号（CTL-*）与红线清单仍是全空间共用，**不按册拆**。
> `scripts/check-meta-docs.mjs` 对两册的分级表做**并集双向对拍**：
> 装饰器出现而未登记 = 红；登记而装饰器不存在 = 红；跨册重复登记 = 红。

## 敏感字段分级登记

| 字段 | 位置 | 分级 | 机制 | 出域许可 |
|---|---|---|---|---|
| 患者姓名 | `apps/api/src/common/dto/patient.dto.ts#name` | 直接标识 | @Masked("name") | 永不 |
| 患者手机号 | `apps/api/src/common/dto/patient.dto.ts#phoneNumber` | 直接标识 | @Masked("phone") | 永不 |
| 患者身份证 | `apps/api/src/common/dto/patient.dto.ts#idCard` | 直接标识 | @Masked("idCard") | 永不 |
| 患者邮箱 | `apps/api/src/common/dto/patient.dto.ts#email` | 直接标识 | @Masked("email") | 永不 |
| 病历·患者姓名 | `apps/api/src/common/dto/medical-record.dto.ts#patientName` | 直接标识 | @Masked("name") | 永不 |
| 病历·医生姓名 | `apps/api/src/common/dto/medical-record.dto.ts#doctorName` | 直接标识 | @Masked("name") | 永不 |
| 本地主体假名 | `packages/database/src/connector/index.ts#subjectKey` | 假名 | 摄入哈希（CTL-03） | 永不（仅本地关联用） |
| 本地年龄段 | `packages/database/src/connector/index.ts#ageBand` | 准标识 | 摄入粗化（CTL-03） | 仅聚合（过闸门） |
| 本地临床字段 | `packages/database/src/connector/index.ts#clinical` | 去标识临床 | 摄入脱敏（CTL-03） | 仅聚合（过闸门） |
| 金标准·主体假名 | `packages/database/src/connector/index.ts#subjectKey`（local_gold_standard） | 假名 | 仅存连接器本地库（CTL-03 同源假名） | 永不（仅本地与算法输出对拍用） |
| 金标准·判定结论 | `packages/database/src/connector/index.ts#judgment` | 去标识临床（敏感度等同临床诊断） | 仅存连接器本地库（永不出域） | 永不（跨域只出 2×2 混淆矩阵计数） |
| 金标准·诊断依据 | `packages/database/src/connector/index.ts#criteriaText` | 去标识临床 | 仅存连接器本地库 | 永不（§2.6 要求报告的是结论，非依据原文） |

## 说明

- 本册字段一律**永不出域**或**仅聚合（过闸门）**；连接器本地字段即使同文件也只在本册登记一次。
- 新增医疗敏感字段：先在本表登记（分级 + 机制 + 出域许可）→ 加装饰器/脱敏逻辑 → 跑 `pnpm check:meta`。
- 跨包（电力等）新增字段应新建 `PACK-TRUST-<pack>.md`，**不得**写回 TRUST.md。
