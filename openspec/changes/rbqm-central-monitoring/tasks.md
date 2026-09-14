# Tasks — rbqm-central-monitoring

## 1. 数据模型（packages/database, control-plane 平面）

- [x] 1.1 新增 `control-plane/rbqm.ts`：`KriDefinitionEntity`(cp_kri_definition) / `KriObservationEntity`(cp_kri_observation) / `QtlBreachEntity`(cp_qtl_breach)
- [x] 1.2 在 `control-plane/index.ts` 的 `controlPlaneEntities` 数组注册三张表
- [x] 1.3 DOMAIN.md 覆盖矩阵新增三行（control-plane 平面）+ 「## RBQM 监查」小节

## 2. 连接器：站点级 KRI 聚合（apps/connector, 纯域）

- [x] 2.1 `domain/kri-aggregator.ts`：本地明细 → 站点级 `{numerator, denominator, value}`；复用小格抑制阈值（硬底 5）
- [x] 2.2 `domain/kri-aggregator.spec.ts`：正常聚合 / 小分母抑制 / 不含行级数据 三个用例

## 3. 控制面：RBQM 模块（apps/api/src/runtime/rbqm）

- [x] 3.1 `rbqm.service.ts`：KRI 定义 CRUD（读 + 种子）、观测入库、`evaluateBreach` 越限检测（direction × 分层阈值）、越限上链（复用 AttestationService）、按角色查询
- [x] 3.2 `kri-catalog.ts`：标准 KRI 定义 + 幂等种子数据（`seed:` 前缀）
- [x] 3.3 `rbqm.controller.ts`：GET 定义/观测/越限（compliance/operator 门控）、POST 观测（连接器回传）、POST 越限确认
- [x] 3.4 `rbqm.module.ts` + 挂进 `app.module.ts`
- [x] 3.5 `rbqm.service.spec.ts`：越限检测（higher/lower_worse）、小样本抑制、未越限不产生记录

## 4. Web 监查台（apps/web）

- [x] 4.1 `api/client.ts`：getKriDefinitions / getKriObservations / getQtlBreaches / acknowledgeBreach
- [x] 4.2 `lib/rbqm.ts`：类型 + 站点×KRI 矩阵组织 + riskTier/severity 呈现映射
- [x] 4.3 `app/(console)/space/rbqm/page.tsx`：KRI 定义 / 站点×KRI 热力矩阵 / 越限清单（compliance/operator 门控）
- [x] 4.4 `space-nav.tsx` 合规组新增「RBQM 监查」入口

## 5. 治理契约同步（check-meta-docs 必绿）

- [x] 5.1 DOMAIN.md（见 1.3）
- [x] 5.2 FLOWS.md 新增 FLOW：站点 KRI 聚合回传（crosses `connector-local → control-plane`，payload=aggregate，红线 raw-local 不出现）
- [x] 5.3 TRUST.md：登记控制点 CTL-x（KRI 输出闸门抑制 + 越限存证）

## 6. 验证

- [x] 6.1 `pnpm --filter @medtrust/database build`
- [x] 6.2 connector kri-aggregator spec 绿
- [x] 6.3 api rbqm spec 绿
- [x] 6.4 `node scripts/check-meta-docs.mjs` 不新增 error
