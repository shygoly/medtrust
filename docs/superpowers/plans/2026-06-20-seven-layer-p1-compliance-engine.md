# 七层解耦架构 P1（L2 合规引擎 + 组合模型）实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P0 的七层系统对象之上，构建 L2 `ComplianceEngine`：读取 6 张 L2 规则表，对一个"跨层组合"做**结构校验 + 治理裁决**，产出与 spec §6 两段 YAML 一致的 `compliance_evaluation`（verdict + required + warnings）。新增 `composition` / `compliance_evaluation` 实体。

**Architecture:** 引擎核心是**纯函数** `evaluateCompliance(input, rules)`（无 DB 依赖，便于 TDD）；`ComplianceService` 注入 6 个 L2 repo 把规则装载后调用它。规则求值采用**按 `key` 的谓词注册表**（block_rule 的目录/原因存库、判定逻辑在代码——契合"通则+判例"）。引擎做"**已选 vs 要求**"对比：required 由 `l2_risk_policy` + guardrail 阈值算出，chosen 来自 `composition.chosenParams`（所选 k/ε/匿名度）+ 所选协议推出的保障级。**不接 admission**（那是 P2）。

**Tech Stack:** TypeScript, NestJS 10, TypeORM(better-sqlite3), Jest。

**Scope:** 仅 P1。非目标：不接 admission/orchestrator（P2）；不做 web（P4）；不实现"全数据驱动改阈值"（block 判定逻辑暂在代码，阈值读库的增强留后续）。

**关键设计决策:**
1. **谓词注册表**：5 条 block_rule 各对应一个 typed 谓词，按 `block_rule.key` 索引；仅当该规则行在库内才参与。规则的 reason/目录是数据，判定是代码。
2. **纯函数引擎**：`evaluateCompliance(input: EvaluationInput, rules: LoadedRules): EvaluationResult`，repo-free，fixtures 直测。
3. **composition.chosenParams**：组合显式携带所选隐私参数 `{ anonymizationKey?, kAnonymity?, epsilon? }`；保障级由所选 `protocolKeys` 经 `l6_protocol.securityCapabilityLevel` 取最高。
4. **overall_risk = scenario.riskLevel**（P1 不做维度升级；留 TODO）。
5. **验收锚点**：spec §6 的 RWS→`manual_review`、CDSS→`auto_approve` 两段 YAML 是引擎单测的黄金样例。

---

## Chunk 1: composition + compliance_evaluation 实体（packages/database）

### Task 1: 两个实体

**Files:**
- Create: `packages/database/src/capability/composition.entity.ts`
- Create: `packages/database/src/capability/compliance-evaluation.entity.ts`
- Modify: `packages/database/src/capability/index.ts`（导出 + 新增 `compositionEntities` 数组）

- [ ] **Step 1: composition.entity.ts**
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('composition')
export class Composition {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ nullable: true }) computeTaskId!: string; // 关联 compute_task(P2 接入)
  @Column() scenarioKey!: string;                      // → l1_scenario.key
  @Column({ type: 'simple-json', default: '[]' }) modelKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) algorithmKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) operatorKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) protocolKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) infraKeys!: string[];
  // 所选隐私参数(已选,用于"已选 vs 要求"对比)
  @Column({ type: 'simple-json', nullable: true })
  chosenParams!: { anonymizationKey?: string; kAnonymity?: number; epsilon?: number } | null;
  // 风险维度: dataSensitivity/participantCount/dataFlowChain/quasiIdentifierDensity
  //          /humanGeneticResources/crossBorder/approvedByNHCC
  @Column({ type: 'simple-json', nullable: true }) riskDimensions!: Record<string, unknown> | null;
  @CreateDateColumn() createdAt!: Date;
}
```

- [ ] **Step 2: compliance-evaluation.entity.ts**
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('compliance_evaluation')
export class ComplianceEvaluation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() compositionId!: string;
  @Column({ type: 'varchar' }) overallRisk!: 'low' | 'medium' | 'high';
  // required: { anonymization, kAnonymity, lDiversity?, epsilon?, securityCapability, approvalRequired }
  @Column({ type: 'simple-json' }) required!: Record<string, unknown>;
  @Column({ type: 'varchar' }) autoVerdict!: 'auto_approve' | 'manual_review' | 'block';
  @Column({ type: 'simple-json', default: '[]' }) blockingRulesMatched!: string[];
  @Column({ type: 'simple-json', default: '[]' }) warnings!: string[];
  @Column({ type: 'simple-json', default: '[]' }) structuralIssues!: string[];
  @CreateDateColumn() evaluatedAt!: Date;
}
```

- [ ] **Step 3: 导出 + 数组**

在 `packages/database/src/capability/index.ts` 追加 `export * from './composition.entity'` 与 `export * from './compliance-evaluation.entity'`，并新增:
```ts
import { Composition } from './composition.entity';
import { ComplianceEvaluation } from './compliance-evaluation.entity';
export const compositionEntities = [Composition, ComplianceEvaluation];
```
并把这两个并入 `capabilityEntities`（让 P0 的 CLI/自检与 autoload 一并建表）。

- [ ] **Step 4: 构建验证 + Commit**

Run: `pnpm --filter @medtrust/database build` → 通过。
```bash
git add packages/database/src/capability/composition.entity.ts packages/database/src/capability/compliance-evaluation.entity.ts packages/database/src/capability/index.ts
git commit -m "feat(capability): add composition + compliance_evaluation entities (P1)"
```

---

## Chunk 2: ComplianceEngine 纯函数（apps/api）

### Task 2: 引擎类型

**Files:**
- Create: `apps/api/src/capability/l2-compliance/engine.types.ts`

- [ ] **Step 1: 类型**
```ts
export type Risk = 'low' | 'medium' | 'high';
export type SecurityLevel = 'basic' | 'enhanced';

export interface RiskDimensions {
  dataSensitivity?: string;          // 'high'|'deidentified'|...
  participantCount?: number;
  dataFlowChain?: string;            // 'internal'|'long'|...
  quasiIdentifierDensity?: number;
  humanGeneticResources?: boolean;
  crossBorder?: boolean;
  approvedByNHCC?: boolean;
}
export interface ChosenParams { anonymizationKey?: string; kAnonymity?: number; epsilon?: number; }

export interface EvaluationInput {
  scenarioRisk: Risk;                // = l1_scenario.riskLevel
  chosen: ChosenParams;
  chosenSecurityCapability: SecurityLevel | null; // 由所选协议推出
  dimensions: RiskDimensions;
}

// 从 DB 装载的 L2 规则(子集投影,引擎只取所需)
export interface LoadedRules {
  riskPolicies: { riskLevel: Risk; requiredAnonymizationKey: string;
    requiredSecurityCapabilityKey: string; requiredAlgorithmKeys: string[]; approvalRequired: boolean }[];
  guardrails: { key: string; kind: string; thresholds: Record<string, any> | null }[];
  blockRuleKeys: string[];           // 库内启用的 block_rule.key 集合
}

export interface ComplianceRequired {
  anonymization: string; kAnonymity: number; lDiversity?: number;
  epsilon?: number; securityCapability: SecurityLevel; approvalRequired: boolean;
}
export interface EvaluationResult {
  overallRisk: Risk;
  required: ComplianceRequired;
  autoVerdict: 'auto_approve' | 'manual_review' | 'block';
  blockingRulesMatched: string[];
  warnings: string[];
  structuralIssues: string[];
}
```

- [ ] **Step 2: Commit**
```bash
git add apps/api/src/capability/l2-compliance/engine.types.ts
git commit -m "feat(compliance): engine types (P1)"
```

### Task 3: evaluateCompliance 纯函数（TDD，黄金样例）

**Files:**
- Create: `apps/api/src/capability/l2-compliance/compliance-engine.ts`
- Test: `apps/api/src/capability/l2-compliance/compliance-engine.spec.ts`

- [ ] **Step 1: 写测试（先红）—— 锚定 spec §6 两段 YAML + block 规则**

`compliance-engine.spec.ts`（含一个最小 `rulesFixture()`，取 TAXONOMY 子集）:
```ts
import { evaluateCompliance } from './compliance-engine';
import { LoadedRules, EvaluationInput } from './engine.types';

function rules(): LoadedRules {
  return {
    riskPolicies: [
      { riskLevel: 'high', requiredAnonymizationKey: 'adequate_or_complete', requiredSecurityCapabilityKey: 'enhanced', requiredAlgorithmKeys: ['DP-SGD', 'DP-Query'], approvalRequired: true },
      { riskLevel: 'medium', requiredAnonymizationKey: 'partial_or_above', requiredSecurityCapabilityKey: 'enhanced', requiredAlgorithmKeys: [], approvalRequired: false },
      { riskLevel: 'low', requiredAnonymizationKey: 'partial_or_above', requiredSecurityCapabilityKey: 'basic', requiredAlgorithmKeys: [], approvalRequired: false },
    ],
    guardrails: [
      { key: 'k-anonymity', kind: 'privacy_model', thresholds: { medical_general: 5, high_risk: 11 } },
      { key: 'l-diversity', kind: 'privacy_model', thresholds: { threshold: 2 } },
      { key: 'epsilon-differential-privacy', kind: 'crypto_model', thresholds: { medical_guidelines: { aggregated_statistics: { epsilon: 1.0 } } } },
    ],
    blockRuleKeys: ['block-high-partial', 'block-high-not-enhanced', 'block-cross-inst-low-k', 'block-epsilon-too-high', 'block-genetic-no-nhcc'],
  };
}

describe('evaluateCompliance', () => {
  it('RWS high-risk genomic → manual_review (matches spec §6 example 1)', () => {
    const input: EvaluationInput = {
      scenarioRisk: 'high',
      chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 0.5 },
      chosenSecurityCapability: 'enhanced',
      dimensions: { dataSensitivity: 'high', participantCount: 3, dataFlowChain: 'long', quasiIdentifierDensity: 8, humanGeneticResources: true, approvedByNHCC: true },
    };
    const r = evaluateCompliance(input, rules());
    expect(r.overallRisk).toBe('high');
    expect(r.required.securityCapability).toBe('enhanced');
    expect(r.required.kAnonymity).toBe(5);
    expect(r.required.lDiversity).toBe(2);
    expect(r.required.epsilon).toBe(1.0);
    expect(r.required.approvalRequired).toBe(true);
    expect(r.blockingRulesMatched).toEqual([]);
    expect(r.autoVerdict).toBe('manual_review');
    expect(r.warnings.join()).toMatch(/遗传资源|NHCC|基因/);
  });

  it('CDSS low-risk internal → auto_approve (matches spec §6 example 2)', () => {
    const input: EvaluationInput = {
      scenarioRisk: 'low',
      chosen: { anonymizationKey: 'adequate', kAnonymity: 5 },
      chosenSecurityCapability: 'basic',
      dimensions: { dataSensitivity: 'deidentified', participantCount: 1, dataFlowChain: 'internal', quasiIdentifierDensity: 3 },
    };
    const r = evaluateCompliance(input, rules());
    expect(r.overallRisk).toBe('low');
    expect(r.required.securityCapability).toBe('basic');
    expect(r.required.approvalRequired).toBe(false);
    expect(r.required.epsilon).toBeUndefined();
    expect(r.required.lDiversity).toBeUndefined();
    expect(r.autoVerdict).toBe('auto_approve');
    expect(r.blockingRulesMatched).toEqual([]);
  });

  it('block: high risk + partial anonymization', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'high', chosen: { anonymizationKey: 'partial', kAnonymity: 5, epsilon: 0.5 }, chosenSecurityCapability: 'enhanced', dimensions: { humanGeneticResources: false } },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-high-partial');
    expect(r.autoVerdict).toBe('block');
  });

  it('block: high risk + non-enhanced security', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'high', chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 0.5 }, chosenSecurityCapability: 'basic', dimensions: {} },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-high-not-enhanced');
  });

  it('block: cross-institution + k<5', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'medium', chosen: { anonymizationKey: 'adequate', kAnonymity: 3 }, chosenSecurityCapability: 'enhanced', dimensions: { participantCount: 2, dataFlowChain: 'cross' } },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-cross-inst-low-k');
  });

  it('block: epsilon > 8.0', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'medium', chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 9 }, chosenSecurityCapability: 'enhanced', dimensions: {} },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-epsilon-too-high');
  });

  it('block: genetic resources without NHCC approval', () => {
    const r = evaluateCompliance(
      { scenarioRisk: 'high', chosen: { anonymizationKey: 'adequate', kAnonymity: 5, epsilon: 0.5 }, chosenSecurityCapability: 'enhanced', dimensions: { humanGeneticResources: true, approvedByNHCC: false } },
      rules(),
    );
    expect(r.blockingRulesMatched).toContain('block-genetic-no-nhcc');
    expect(r.autoVerdict).toBe('block');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && pnpm test -- compliance-engine`
Expected: FAIL（文件不存在）。

- [ ] **Step 3: 实现 compliance-engine.ts**
```ts
import {
  EvaluationInput, EvaluationResult, LoadedRules, ComplianceRequired, Risk, SecurityLevel,
} from './engine.types';

const ANON_ADEQUATE = new Set(['adequate', 'complete', 'adequate_or_complete']);

// 每条 block 规则 = 一个 typed 谓词;仅当 key 在 LoadedRules.blockRuleKeys 内才参与。
const BLOCK_PREDICATES: Record<string, (i: EvaluationInput) => boolean> = {
  'block-high-partial': (i) =>
    i.scenarioRisk === 'high' && !ANON_ADEQUATE.has(i.chosen.anonymizationKey ?? ''),
  'block-high-not-enhanced': (i) =>
    i.scenarioRisk === 'high' && i.chosenSecurityCapability !== 'enhanced',
  'block-cross-inst-low-k': (i) =>
    (i.chosen.kAnonymity ?? 0) < 5 && (i.dimensions.participantCount ?? 1) > 1,
  'block-epsilon-too-high': (i) => (i.chosen.epsilon ?? 0) > 8.0,
  'block-genetic-no-nhcc': (i) =>
    !!i.dimensions.humanGeneticResources && !i.dimensions.approvedByNHCC,
};

function computeRequired(risk: Risk, rules: LoadedRules): ComplianceRequired {
  const policy = rules.riskPolicies.find((p) => p.riskLevel === risk);
  const k = rules.guardrails.find((g) => g.key === 'k-anonymity');
  const l = rules.guardrails.find((g) => g.key === 'l-diversity');
  const eps = rules.guardrails.find((g) => g.key === 'epsilon-differential-privacy');
  const req: ComplianceRequired = {
    anonymization: policy?.requiredAnonymizationKey ?? 'partial_or_above',
    kAnonymity: (k?.thresholds?.medical_general as number) ?? 5,
    securityCapability: (policy?.requiredSecurityCapabilityKey as SecurityLevel) ?? 'basic',
    approvalRequired: policy?.approvalRequired ?? false,
  };
  // l-diversity 仅在高风险纳入(对齐 §6: RWS 有 l:2, CDSS 无)
  if (risk === 'high' && l) req.lDiversity = (l.thresholds?.threshold as number) ?? 2;
  // ε 仅在风险要求 DP 算法时纳入(high → [DP-SGD,DP-Query])
  if ((policy?.requiredAlgorithmKeys?.length ?? 0) > 0 && eps) {
    req.epsilon = (eps.thresholds?.medical_guidelines?.aggregated_statistics?.epsilon as number) ?? 1.0;
  }
  return req;
}

export function evaluateCompliance(input: EvaluationInput, rules: LoadedRules): EvaluationResult {
  const overallRisk = input.scenarioRisk; // P1: 不做维度升级(TODO)
  const required = computeRequired(overallRisk, rules);

  // 结构问题(P1 轻量: 仅 chosen-vs-required 的非阻断提示;DAG 自洽在 P2 补全)
  const structuralIssues: string[] = [];

  // block 谓词(仅库内启用的规则)
  const blockingRulesMatched = rules.blockRuleKeys.filter(
    (key) => BLOCK_PREDICATES[key]?.(input),
  );

  const warnings: string[] = [];
  if (input.dimensions.humanGeneticResources)
    warnings.push('含基因组/人类遗传资源数据 → 需国家卫健委(NHCC)审批');
  if (input.dimensions.crossBorder)
    warnings.push('数据跨境 → 需通过数据出境安全评估(PIPL/DSL)');

  let autoVerdict: EvaluationResult['autoVerdict'];
  if (blockingRulesMatched.length > 0) autoVerdict = 'block';
  else if (
    required.approvalRequired ||
    (required.epsilon !== undefined && (input.chosen.epsilon ?? 0) > 1.0) ||
    input.dimensions.crossBorder ||
    input.dimensions.humanGeneticResources
  ) autoVerdict = 'manual_review';
  else autoVerdict = 'auto_approve';

  return { overallRisk, required, autoVerdict, blockingRulesMatched, warnings, structuralIssues };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/api && pnpm test -- compliance-engine`
Expected: PASS（两段 YAML 黄金样例 + 5 条 block 用例全绿）。

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/capability/l2-compliance/compliance-engine.ts apps/api/src/capability/l2-compliance/compliance-engine.spec.ts
git commit -m "feat(compliance): pure evaluateCompliance engine (P1, golden-tested vs spec §6)"
```

---

## Chunk 3: ComplianceService + Module + evaluate 端点（apps/api）

### Task 4: ComplianceService（装载规则 + 推保障级 + 调引擎 + 持久化）

**Files:**
- Create: `apps/api/src/capability/l2-compliance/compliance.service.ts`
- Test: `apps/api/src/capability/l2-compliance/compliance.service.spec.ts`

- [ ] **Step 1: 写测试（先红，mock 6 个 L2 repo + composition/evaluation/protocol repo）**

测试要点: `evaluate(composition)` 能装载规则、由 `protocolKeys` 推出 `chosenSecurityCapability`(取最高级)、调 `evaluateCompliance`、把结果存入 `compliance_evaluation`。用 mock repo 返回固定行;断言 verdict 与持久化调用。

- [ ] **Step 2: 运行确认失败** → `cd apps/api && pnpm test -- compliance.service`

- [ ] **Step 3: 实现 service**
要点：
- 注入 `L2RiskPolicy / L2Guardrail / L2BlockRule` repo（装载 `LoadedRules`）、`L6Protocol` repo（推保障级：所选协议里有 `enhanced` 则 enhanced，否则 basic）、`L1Scenario` repo（取 riskLevel）、`Composition` / `ComplianceEvaluation` repo（读组合 + 存评估）。
- `async evaluate(compositionId): Promise<ComplianceEvaluation>`：读 composition → 组装 `EvaluationInput` → `evaluateCompliance` → `save` 评估 → 返回。
- fail-closed：scenario/risk_policy 缺失时 `overallRisk` 视为 high 且 `manual_review`（绝不静默 auto_approve）。

- [ ] **Step 4: 运行确认通过** → `cd apps/api && pnpm test -- compliance.service`

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/capability/l2-compliance/compliance.service.ts apps/api/src/capability/l2-compliance/compliance.service.spec.ts
git commit -m "feat(compliance): ComplianceService loads rules, derives security level, persists evaluation (P1)"
```

### Task 5: ComplianceController + ComplianceModule + 接入 app.module

**Files:**
- Create: `apps/api/src/capability/l2-compliance/compliance.controller.ts`（`POST /compliance/evaluate/:compositionId`、`GET /compliance/evaluation/:compositionId`）
- Create: `apps/api/src/capability/l2-compliance/compliance.module.ts`（`forFeature` 6 张 L2 表 + composition + evaluation + L1Scenario + L6Protocol）
- Modify: `apps/api/src/app.module.ts`（加 `ComplianceModule`）
- Test: `compliance.controller.spec.ts`

- [ ] **Step 1-4: 控制器测试(先红)→实现→模块→接入→`pnpm test -- compliance` 全绿 + `pnpm --filter api build`**

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/capability/l2-compliance/compliance.controller.ts apps/api/src/capability/l2-compliance/compliance.module.ts apps/api/src/app.module.ts apps/api/src/capability/l2-compliance/compliance.controller.spec.ts
git commit -m "feat(compliance): evaluate endpoint + ComplianceModule wired (P1)"
```

---

## P1 完成定义（DoD）

- [ ] `composition` / `compliance_evaluation` 两表建立并导出。
- [ ] `evaluateCompliance` 纯函数：spec §6 两段 YAML 黄金样例 + 5 条 block 规则单测全绿。
- [ ] `ComplianceService` 能装载库内 L2 规则、推保障级、产出并持久化评估；规则缺失 fail-closed。
- [ ] `POST /api/v1/compliance/evaluate/:compositionId` 可用；`api` 单测全绿、`nest build` 通过、无回归。

## 衔接 P2

P2：把 `composition` 与 `compute_task` 关联（加 `composition_id`），在 `SecretFlowAdmissionService.admit()` 旁挂 L2 verdict 闸门（verdict≠block 且 contract PEP 通过才放行），并补全引擎的 DAG 结构自洽校验（用 P0 那 64 条悬空引用清单做精选边清洗）。
