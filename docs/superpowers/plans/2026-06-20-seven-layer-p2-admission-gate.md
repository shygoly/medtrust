# 七层解耦架构 P2（L2 裁决闸门接入 admission + 结构校验）实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 P1 的 L2 裁决接进运行时：`SecretFlowOrchestratorService.orchestrate()` 在合约 PEP(`admission.admit`)旁**并联** L2 verdict 闸门（`block`/`manual_review` → fail-closed 拒绝派发，`auto_approve` 放行）；`compute_task` 加 `composition_id` 链接；引擎补一项**轻量结构校验**（风险策略要求的算法须在组合内，对齐 P0 的精选可解析绑定边）。

**Architecture:** 加 `OrchestrateInput.compositionId?`；编排器注入 `ComplianceService`（orchestrator 模块 import `ComplianceModule`），在 `admit()` 后调 `compliance.evaluate(compositionId)`，非 `auto_approve` 即 `ForbiddenException`。引擎 `EvaluationInput` 增 `chosenAlgorithmKeys`，把"required 算法是否在组合内"写入 `structuralIssues`（advisory，沿用 warn-only 哲学；不因松散引用硬阻断）。

**Tech Stack:** TypeScript, NestJS 10, TypeORM, Jest。

**Scope:** 仅 P2。非目标：不做 web(P4)；不把松散描述性引用(64 条)变成硬阻断（仍 warn/structuralIssues）；不重排运行时模块目录（P3）。

**关键决策:** L2 闸门与合约 PEP **并联且都 fail-closed**——两关全过才派发。`manual_review` 在自动编排路径里等同"不可自动派发"（抛 Forbidden，提示走审批工作流）。结构校验只用**可解析的绑定边**（`l2_risk_policy.requiredAlgorithmKeys` → L4 keys，均解析），不碰松散描述边。

---

## Chunk 1: compute_task.composition_id 链接

### Task 1: 加列

**Files:** Modify `packages/database/src/entities/compute-task.entity.ts`

- [ ] **Step 1:** 在 `contractId` 列后加：
```ts
  // 跨层组合引用(P2)。task 的执行由该 composition 投影驱动;L2 裁决挂在它上。
  @Column({ nullable: true, name: 'composition_id' })
  compositionId: string;
```
- [ ] **Step 2:** Run `pnpm --filter @medtrust/database build` → 通过。
- [ ] **Step 3:** Commit `feat(compute-task): add composition_id link (P2)`

---

## Chunk 2: 引擎结构校验（required 算法在组合内）

### Task 2: 扩展 EvaluationInput + 结构校验（TDD）

**Files:**
- Modify `apps/api/src/capability/l2-compliance/engine.types.ts`（`EvaluationInput` 增 `chosenAlgorithmKeys?: string[]`；`LoadedRules.riskPolicies[].requiredAlgorithmKeys` 已有）
- Modify `apps/api/src/capability/l2-compliance/compliance-engine.ts`
- Modify `apps/api/src/capability/l2-compliance/compliance-engine.spec.ts`

- [ ] **Step 1: 加测试（先红）** — 高风险要求 `DP-SGD/DP-Query`，组合只选了 `fedavg` → `structuralIssues` 含缺失项；选了 `dp-sgd,dp-query` → 无该 issue。键比较用大小写不敏感/slug 容忍（引擎内置 `norm`）。
```ts
it('structural: missing required algorithm → structuralIssues', () => {
  const r = evaluateCompliance(
    { scenarioRisk: 'high', chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 0.5 },
      chosenAlgorithmKeys: ['fedavg'], chosenSecurityCapability: 'enhanced', dimensions: {} },
    rules());
  expect(r.structuralIssues.join()).toMatch(/dp-sgd|dp-query/i);
});
it('structural: required algorithms present → no structural issue', () => {
  const r = evaluateCompliance(
    { scenarioRisk: 'high', chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 0.5 },
      chosenAlgorithmKeys: ['DP-SGD', 'DP-Query'], chosenSecurityCapability: 'enhanced', dimensions: {} },
    rules());
  expect(r.structuralIssues).toEqual([]);
});
```
> 既有 7 个用例不传 `chosenAlgorithmKeys`(undefined)——结构校验跳过，保持全绿。

- [ ] **Step 2:** Run `cd apps/api && pnpm test -- compliance-engine` → 新用例 FAIL。
- [ ] **Step 3: 实现** — 在 `evaluateCompliance` 加：
```ts
const norm = (s: string) => s.trim().toLowerCase();
if (input.chosenAlgorithmKeys) {
  const chosen = new Set(input.chosenAlgorithmKeys.map(norm));
  const policy = rules.riskPolicies.find((p) => p.riskLevel === overallRisk);
  for (const req of policy?.requiredAlgorithmKeys ?? []) {
    if (!chosen.has(norm(req))) structuralIssues.push(`缺少风险要求的算法: ${req}`);
  }
}
```
- [ ] **Step 4:** Run → 9/9 绿（含原 7）。
- [ ] **Step 5:** Commit `feat(compliance): structural check for required algorithms (P2)`

### Task 3: ComplianceService 传 chosenAlgorithmKeys

**Files:** Modify `compliance.service.ts`（在 `EvaluationInput` 里传 `chosenAlgorithmKeys: composition.algorithmKeys`）+ spec 补一条断言。
- [ ] 改 `evaluate()` 组装 input 时加 `chosenAlgorithmKeys: composition.algorithmKeys ?? []`；`pnpm test -- compliance.service` 绿；Commit。

---

## Chunk 3: 编排器 L2 闸门（与合约 PEP 并联）

### Task 4: OrchestrateInput.compositionId + 闸门 + 模块接入（TDD）

**Files:**
- Modify `apps/api/src/secretflow-orchestrator/secretflow-orchestrator.service.ts`
- Modify `apps/api/src/secretflow-orchestrator/secretflow-orchestrator.module.ts`（import `ComplianceModule`）
- Modify `apps/api/src/secretflow-orchestrator/types.ts`（`OrchestrationRecord` 增 `complianceEvaluationId?: string`）
- Test: 新增 `secretflow-orchestrator/l2-gate.spec.ts`（聚焦闸门，mock ComplianceService + 其余依赖）

- [ ] **Step 1: 加测试（先红）** — orchestrate 带 `compositionId`：
  - verdict=block → `orchestrate()` rejects `ForbiddenException`，且**未**调用 `agent.submitFLTask`。
  - verdict=manual_review → rejects Forbidden（不可自动派发）。
  - verdict=auto_approve → 继续（agent 被调用）。
  - 无 compositionId → 跳过 L2（保持原行为）。
> mock：`SecretFlowAdmissionService.admit` 返回固定 admitted；`ComplianceService.evaluate` 按用例返回 verdict；`AgentDispatchClient.submitFLTask` 用 jest.fn 断言是否被调；`fsm` 用真实或最小 mock。参考既有 orchestrator spec 的搭法。

- [ ] **Step 2:** Run `cd apps/api && pnpm test -- l2-gate` → FAIL。

- [ ] **Step 3: 实现**
  - `OrchestrateInput` 增 `compositionId?: string`。
  - 构造函数注入 `private readonly compliance: ComplianceService`。
  - `orchestrate()` 在 `const admitted = this.admission.admit(...)` 之后、`fsm.create` 之前（或之后、dispatch 之前）加：
```ts
// L2 合规闸门(与合约 PEP 并联, fail-closed): 仅 auto_approve 可自动派发。
if (input.compositionId) {
  const verdict = await this.compliance.evaluate(input.compositionId);
  record/* 见下 */;
  if (verdict.autoVerdict === 'block') {
    this.fsm.transition(taskId, 'FAILED', `L2 阻断: ${verdict.blockingRulesMatched.join(', ')}`);
    throw new ForbiddenException(`L2 合规阻断: ${verdict.blockingRulesMatched.join(', ')}`);
  }
  if (verdict.autoVerdict === 'manual_review') {
    this.fsm.transition(taskId, 'FAILED', 'L2 需人工审批');
    throw new ForbiddenException('L2 合规需人工审批,不可自动派发(走审批工作流后重试)');
  }
}
```
  > 注意 fsm.create 在 admit 之后调用;把 L2 闸门放在 `record = this.fsm.create(...)` 之后、`VALIDATING` 之前，这样可在 record 上记 `complianceEvaluationId` 并让 FAILED transition 有据可依。实现时按真实顺序微调。
  - `ComplianceModule` 需 `export ComplianceService`(P1 已 export)；orchestrator 模块 `imports: [..., ComplianceModule]`。
  - 在 record 记 `record.complianceEvaluationId = verdict.id`。

- [ ] **Step 4:** Run `cd apps/api && pnpm test -- l2-gate` → 绿；再 `pnpm test -- "orchestrator"` 确认编排既有用例无回归。

- [ ] **Step 5:** `pnpm --filter api build` → 通过；Commit `feat(orchestrator): L2 verdict admission gate parallel to contract PEP (P2)`

---

## P2 完成定义（DoD）

- [ ] `compute_task.composition_id` 列存在；database build 通过。
- [ ] 引擎结构校验：required 算法缺失 → `structuralIssues`；齐全 → 无 issue；原 7 用例无回归。
- [ ] `orchestrate({compositionId})`：block/manual_review → `ForbiddenException` 且不派发；auto_approve → 正常；无 compositionId → 行为不变。
- [ ] orchestrator + compliance 单测全绿；`nest build` 通过；无回归（6 个预存失败 suite 不计）。

## 衔接 P3 / P4

P3：把 `orchestrator/contract/identity/catalog` 机械迁入 `runtime/`（纯移动 + 改 import，独立 PR）。P4：web 三用途（知识库后台 CRUD + 组合向导 + 合规视图）。
