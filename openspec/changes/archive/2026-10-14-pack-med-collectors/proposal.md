# 提案：医疗包接管平台侧聚合收集器（TD-12 第二刀）

## Why

- **TD-12 是真实偏差且已可度量**：基座目录内行业词实测 **246 处 / 25 文件**（棘轮已锁，只减不增）。
- **「直接搬文件」不成立**（2026-10-14 勘察）：行业实现与其调用方**都住在基座目录里**——`collect-paired-cohort.ts`(21) 与
  `collect-vaccine-scri.ts`(12) 的唯一调用点是基座文件 `apps/api/src/mdop/mdop-merge.service.ts:26-27`。直接搬会把
  「行业词违规」换成**依赖方向违规**（基座 import 行业包），所以必须先做**注册表反转**。
- **正规缝隙已有一半**：`@medtrust/space-kernel-spi` 已定义 `OperatorPack`；`@medtrust/domain-med` 的 manifest 已声明
  `operators: [disproportionality, paired-cohort, vaccine-scri]`，但其 `declareOperators()` 仍返回空集（fail-closed）。
  本变更补的是**平台侧聚合**那一半，并立下「基座不认识具体分析类型」的先例。

## What Changes

1. **SPI**：**S2 算子包**扩展**可选**成员 `declareCollectors?(ctx)`（配 `AggregationCollector` 与
   `AggregationCollectorRegistry` 两个接口）——**不新开缝**：SPI 是**机检的六根 S1–S6**（KERNEL.md §3、
   `scripts/conformance/check-pack.mjs` 按缝名对拍），新开第七根会把改动面扩散到治理文档与一致性套件；
   而「分析算子」本就同时有节点侧（`declareOperators`）与平台侧（本成员）两半。`OperatorPack` 名字不变，
   且两份治理文档只列接口名不列成员，故**无治理文档改动**。
2. **基座**：新增 `apps/api/src/mdop/operators/collector-registry.ts`（域中立：注册/解析 + 未知类型 fail-closed）；
   `mdop-merge.service` 改为**经注册表解析**，删除对具体分析类型的静态 import 与 `analysisType` 三元分派。
3. **行业包**：`collect-*.ts`（两个纯叶子，零内部依赖）搬进 `industries/med/src/collectors/`；包导出 `registerMedCollectors(registry)`。
4. **组装根**：`apps/api/src/app.module.ts`（**非基座**）注册医疗包收集器；`apps/api` 增加 `@medtrust/domain-med` 依赖。
5. **测试**：基座 spec 显式注册（jest setup 或逐 spec）；补「未知分析类型 fail-closed」与「注册表解析」用例。

## 本期不做

- 连接器侧 4 个 sandbox（`tee-node/wasm-runner.ts` 引用，24 处）与 `plan-templates.ts`（49 处）——同一套路，留给下一刀。
- 不动 wasm 算子登记：`medOperators.declareOperators()` 保持空集（摘要 MUST 取自 `packages/wasm-algorithms` 复现构建清单）。
- **不改合并口径**：搬移的是同一函数体，`mergeFlPartyResults` 与各收集器算法逐字节不变。

## Capabilities

- `kernel-spi`：基座只经 SPI 解析聚合实现；基座 MUST NOT import 行业包。
- `mdop-aggregation`：平台合并经注册表解析、未知类型 fail-closed、口径不因搬移改变。

## Impact

- **代码**：`packages/space-kernel-spi`（缝隙）、`industries/med`（实现+注册）、`apps/api`（注册表、merge 服务、组装根、依赖）、相关 spec。
- **验收双闸**：① 等价性——`mdop-collect-paired.spec.ts`、`c2-multi-node-e2e.spec.ts`、`l4-fl-node-e2e.spec.ts` 逐字段通过；
  ② 棘轮——`check-kernel-purity --ratchet` 当前计数从 **246 降到 ≤213**（基线随之重生成）。
- **风险**：落点是 2026-10-14 在**真实 TDX 节点**上跑通的合并分派路径（`evidence/rerun-20261014/`），
  所以只做「解析方式」的改变，不碰算法；每步独立可验，避免半截反转。
- **治理**：SPI/PACK/KERNEL 契约同步；TD-12 计数下降并更新。
