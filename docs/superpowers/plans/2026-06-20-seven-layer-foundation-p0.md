# 七层解耦架构 P0（基础层：系统对象 + 入库）实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把技术选型七层分类学落为数据库支撑的系统对象——12 张强类型表（L1、L3-L7 能力层 + 6 张 L2 规则表）+ 一个幂等 seeder，把分类学完整写入数据库，并提供只读访问验证。

**Architecture:** 在 `packages/database/src/capability/` 新建 12 个 TypeORM 实体（共享抽象基类 `CapabilityObject` 提供公共列），跨层依赖用类型化 `key` 数组（引用下层稳定 key）。分类学 JSON 转写为仓库内 TS 常量 `TAXONOMY`（源文件在仓库外的知识库，运行时不可依赖）。`seedCapability(dataSource)` 纯函数幂等 upsert（按 `key`）并做跨层引用存在性校验（fail-closed）。`apps/api/src/capability/` 新建一个 `CapabilityModule`：泛型 `CapabilityRegistryService` + `CapabilityController` 暴露按层只读查询。**不触碰任何运行时代码。**

**Tech Stack:** TypeScript, NestJS 10, TypeORM (better-sqlite3, dev `synchronize` ON), Jest (`*.spec.ts` 同目录), pnpm monorepo。

**Scope 说明:** 本计划只覆盖 spec 的 **P0**。P1（L2 ComplianceEngine + composition）、P2（admission 接入）、P3（runtime 机械搬迁）、P4（web 三用途）各自独立成计划，P0 落地后再写。P0 独立可交付可测：分类学进库、可查询。

**YAGNI 偏离说明:** spec §4 列出 `l1-scenario/ … l7-infrastructure/` 每层一个 Nest 子模块。P0 阶段各层**尚无层内行为**（L2 引擎是 P1），故 P0 用**单个 `CapabilityModule` + 泛型 registry service + 按层参数的 controller**（按数据解耦、DRY）。每层独立子模块在该层产生行为时（P1 起）再拆分。实体仍按层分表，"解耦"在数据与表结构层面已成立。

**决策（评审后修订，2026-06-20）:** 源分类学的跨层引用是**示意性 prose，不是闭合的 key 图**（如 `DP-SGD→"Add"`、`Fed Cox→"Log"/"Exp"`、`l-diversity→"Attribute Check"` 在算子表中均不存在）。故采用**选项 1**：P0 忠实照搬源引用为字符串数组；seeder 对跨层引用做 **warn-only 报告（不阻断）**；严格 fail-closed 校验**推迟到 P1**（引擎对其真正需要的精选绑定边做清洗+强校验）。另：`packages/database` 无 jest/ts-node，**不新增 jest 依赖**——用 CLI `--check` 运行时自检（内存库→seed→断言计数+打印悬空引用报告）验证转写；`api` 侧服务仍用既有 jest 单测。

**源数据:** 分类学权威来源 `/Users/mac/Sync/knowledge/医疗数据治理/可信数据空间/隐私计算分类学-JSON.md`（Scenarios/Compliance_Guardrails/Models/Algorithms/Operators/Protocols/Infrastructure/block_rules/approval_workflow）。Task 6 把它**逐条**转写进 `TAXONOMY` 常量。计数基准（转写完整性校验用）：Scenarios=10、Guardrails=11（privacy_model 3 / crypto_model 1 / risk 3 / anonymization 2 / security 2）、Models=12、Algorithms=11、Operators=20、Protocols=16、Infrastructure=14、block_rules=5、approval groups=3。

---

## Chunk 1: 实体与基类（packages/database）

### Task 1: LayerKind 枚举 + CapabilityObject 抽象基类

**Files:**
- Create: `packages/database/src/capability/layer-kind.ts`
- Create: `packages/database/src/capability/system-object.base.ts`

- [ ] **Step 1: 写 LayerKind 枚举**

`packages/database/src/capability/layer-kind.ts`:
```ts
// 七层标识。L2 是规则层(非能力注册表),其余为能力层。
export enum LayerKind {
  L1_SCENARIO = 'l1_scenario',
  L2_COMPLIANCE = 'l2_compliance',
  L3_MODEL = 'l3_model',
  L4_ALGORITHM = 'l4_algorithm',
  L5_OPERATOR = 'l5_operator',
  L6_PROTOCOL = 'l6_protocol',
  L7_INFRASTRUCTURE = 'l7_infrastructure',
}

export const TAXONOMY_VERSION = '7.0-medical-2026-06-20';
```

- [ ] **Step 2: 写 CapabilityObject 抽象基类**

TypeORM 抽象基类(不加 `@Entity`)被各层具体实体继承,每层各自建表但共享公共列。

`packages/database/src/capability/system-object.base.ts`:
```ts
import { PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { TAXONOMY_VERSION } from './layer-kind';

// 能力层(L1、L3-L7)共享的系统对象公共列。L2 规则表不继承此基类(规则非能力)。
export abstract class CapabilityObject {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // 层内唯一稳定标识(slug),如 'meditron-7b'、'tee-sgx'。跨层引用用它。
  @Column({ unique: true })
  key!: string;

  @Column()
  name!: string;

  @Column({ default: TAXONOMY_VERSION })
  version!: string;

  @Column({ type: 'varchar', default: 'active' })
  status!: 'active' | 'deprecated' | 'draft';

  @Column({ type: 'simple-json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ nullable: true })
  basedOn!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
```

- [ ] **Step 3: Commit**
```bash
git add packages/database/src/capability/layer-kind.ts packages/database/src/capability/system-object.base.ts
git commit -m "feat(capability): add LayerKind enum and CapabilityObject base"
```

---

### Task 2: 能力层实体（L1、L3-L7 共 6 张表）

**Files:**
- Create: `packages/database/src/capability/l1-scenario.entity.ts`
- Create: `packages/database/src/capability/l3-model.entity.ts`
- Create: `packages/database/src/capability/l4-algorithm.entity.ts`
- Create: `packages/database/src/capability/l5-operator.entity.ts`
- Create: `packages/database/src/capability/l6-protocol.entity.ts`
- Create: `packages/database/src/capability/l7-infrastructure.entity.ts`

- [ ] **Step 1: 写 6 个实体**

`l1-scenario.entity.ts`:
```ts
import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l1_scenario')
export class L1Scenario extends CapabilityObject {
  @Column({ type: 'text', nullable: true }) description!: string;
  @Column({ type: 'varchar' }) riskLevel!: 'low' | 'medium' | 'high';
  @Column({ type: 'text', nullable: true }) criteria!: string;
  @Column({ type: 'simple-json', default: '[]' }) typicalModelKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) typicalAlgorithmKeys!: string[];
}
```

`l3-model.entity.ts`:
```ts
import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l3_model')
export class L3Model extends CapabilityObject {
  @Column() category!: string;
  @Column({ type: 'simple-json', default: '[]' }) trainingAlgorithmKeys!: string[];
  @Column({ type: 'text', nullable: true }) complianceNote!: string;
}
```

`l4-algorithm.entity.ts`:
```ts
import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l4_algorithm')
export class L4Algorithm extends CapabilityObject {
  @Column() category!: string;
  @Column({ type: 'simple-json', default: '[]' }) underlyingOperatorKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) compliancePrivacyModels!: string[];
}
```

`l5-operator.entity.ts`:
```ts
import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l5_operator')
export class L5Operator extends CapabilityObject {
  @Column() opType!: string;
  @Column({ type: 'simple-json', default: '[]' }) supportedProtocolKeys!: string[];
  @Column({ default: false }) complianceDriven!: boolean;
  @Column({ nullable: true }) triggeredBy!: string;
}
```

`l6-protocol.entity.ts`:
```ts
import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l6_protocol')
export class L6Protocol extends CapabilityObject {
  @Column() family!: string;
  @Column({ type: 'text' }) securityAssumption!: string;
  @Column({ type: 'varchar' }) securityCapabilityLevel!: 'basic' | 'enhanced';
  // 指向 privacy/* 或 security/crypto 的具体实现(P1+ 绑定);P0 仅持久化
  @Column({ nullable: true }) handlerKey!: string;
}
```

`l7-infrastructure.entity.ts`:
```ts
import { Entity, Column } from 'typeorm';
import { CapabilityObject } from './system-object.base';

@Entity('l7_infrastructure')
export class L7Infrastructure extends CapabilityObject {
  @Column() infraType!: string;
  @Column() vendor!: string;
  @Column({ type: 'text', nullable: true }) complianceNote!: string;
  @Column({ nullable: true }) handlerKey!: string;
}
```

- [ ] **Step 2: Commit**
```bash
git add packages/database/src/capability/l1-scenario.entity.ts packages/database/src/capability/l3-model.entity.ts packages/database/src/capability/l4-algorithm.entity.ts packages/database/src/capability/l5-operator.entity.ts packages/database/src/capability/l6-protocol.entity.ts packages/database/src/capability/l7-infrastructure.entity.ts
git commit -m "feat(capability): add L1/L3-L7 capability-layer entities"
```

---

### Task 3: L2 规则层实体（6 张表）

**Files:**
- Create: `packages/database/src/capability/l2-guardrail.entity.ts`
- Create: `packages/database/src/capability/l2-risk-policy.entity.ts`
- Create: `packages/database/src/capability/l2-anonymization-degree.entity.ts`
- Create: `packages/database/src/capability/l2-security-capability.entity.ts`
- Create: `packages/database/src/capability/l2-block-rule.entity.ts`
- Create: `packages/database/src/capability/l2-approval-rule.entity.ts`

- [ ] **Step 1: 写 6 个 L2 实体**

L2 不继承 `CapabilityObject`(规则非能力);每张表自带 `key`(唯一)与所需列。

`l2-guardrail.entity.ts`(Privacy/Cryptographic Model,4 条):
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_guardrail')
export class L2Guardrail {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'k-anonymity' / 'epsilon-dp' ...
  @Column() name!: string;
  @Column({ type: 'varchar' }) kind!: 'privacy_model' | 'crypto_model';
  @Column({ type: 'text', nullable: true }) description!: string;
  // 异构阈值: k-anon {medical_general,high_risk} / l-div、t-close 标量 /
  //          ε-DP {epsilon_range, medical_guidelines, privacy_budget_tracking}
  @Column({ type: 'simple-json', nullable: true }) thresholds!: Record<string, unknown> | null;
  @Column({ type: 'simple-json', default: '[]' }) requiredOperatorKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) requiredAlgorithmKeys!: string[];
  @Column({ type: 'simple-json', default: '[]' }) applicableScenarios!: string[];
  @Column({ nullable: true }) basedOn!: string;
  @CreateDateColumn() createdAt!: Date;
}
```

`l2-risk-policy.entity.ts`(Risk Assessment,3 条):
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_risk_policy')
export class L2RiskPolicy {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'risk-high' | 'risk-medium' | 'risk-low'
  @Column({ type: 'varchar' }) riskLevel!: 'low' | 'medium' | 'high';
  @Column({ type: 'text' }) criteria!: string;
  @Column() requiredAnonymizationKey!: string;   // → l2_anonymization_degree.key
  @Column() requiredSecurityCapabilityKey!: string; // → l2_security_capability.key
  @Column({ type: 'simple-json', default: '[]' }) requiredAlgorithmKeys!: string[];
  @Column({ default: false }) approvalRequired!: boolean;
  @CreateDateColumn() createdAt!: Date;
}
```

`l2-anonymization-degree.entity.ts`(Anonymization Assessment,2 条):
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_anonymization_degree')
export class L2AnonymizationDegree {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'complete' | 'adequate'
  @Column() name!: string;
  @Column({ type: 'text' }) definition!: string;
  @Column({ type: 'simple-json', default: '[]' }) requiredTechniques!: string[];
  @Column({ type: 'float', nullable: true }) reIdentificationRiskUpper!: number;
  @Column({ type: 'simple-json', default: '[]' }) allowedScenarios!: string[];
  @CreateDateColumn() createdAt!: Date;
}
```

`l2-security-capability.entity.ts`(Security Assessment,2 条):
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_security_capability')
export class L2SecurityCapability {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'enhanced' | 'basic'
  @Column() name!: string;
  @Column({ type: 'simple-json', default: '[]' }) requiredProtocolKeys!: string[];
  @Column({ type: 'text', nullable: true }) description!: string;
  @CreateDateColumn() createdAt!: Date;
}
```

`l2-block-rule.entity.ts`(block_rules,5 条):
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_block_rule')
export class L2BlockRule {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ unique: true }) key!: string; // 'block-high-partial' ...
  // P0 忠实持久化原始条件串;结构化解析是 P1 引擎职责
  @Column({ type: 'text' }) condition!: string;
  @Column({ default: true }) block!: boolean;
  @Column({ type: 'text' }) reason!: string;
  @CreateDateColumn() createdAt!: Date;
}
```

`l2-approval-rule.entity.ts`(approval_workflow,3 组):
```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('l2_approval_rule')
export class L2ApprovalRule {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', unique: true })
  conditionGroup!: 'auto_block' | 'auto_approve' | 'manual';
  @Column({ type: 'simple-json', default: '[]' }) conditions!: string[];
  @CreateDateColumn() createdAt!: Date;
}
```

- [ ] **Step 2: Commit**
```bash
git add packages/database/src/capability/l2-*.entity.ts
git commit -m "feat(capability): add 6 L2 compliance-rule entities (full guardrail coverage)"
```

---

### Task 4: capability 索引导出 + entities 数组

**Files:**
- Create: `packages/database/src/capability/index.ts`
- Modify: `packages/database/src/index.ts`

- [ ] **Step 1: 写 capability/index.ts**
```ts
export * from './layer-kind';
export * from './system-object.base';
export * from './l1-scenario.entity';
export * from './l3-model.entity';
export * from './l4-algorithm.entity';
export * from './l5-operator.entity';
export * from './l6-protocol.entity';
export * from './l7-infrastructure.entity';
export * from './l2-guardrail.entity';
export * from './l2-risk-policy.entity';
export * from './l2-anonymization-degree.entity';
export * from './l2-security-capability.entity';
export * from './l2-block-rule.entity';
export * from './l2-approval-rule.entity';

import { L1Scenario } from './l1-scenario.entity';
import { L3Model } from './l3-model.entity';
import { L4Algorithm } from './l4-algorithm.entity';
import { L5Operator } from './l5-operator.entity';
import { L6Protocol } from './l6-protocol.entity';
import { L7Infrastructure } from './l7-infrastructure.entity';
import { L2Guardrail } from './l2-guardrail.entity';
import { L2RiskPolicy } from './l2-risk-policy.entity';
import { L2AnonymizationDegree } from './l2-anonymization-degree.entity';
import { L2SecurityCapability } from './l2-security-capability.entity';
import { L2BlockRule } from './l2-block-rule.entity';
import { L2ApprovalRule } from './l2-approval-rule.entity';

export const capabilityEntities = [
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
  L2Guardrail, L2RiskPolicy, L2AnonymizationDegree, L2SecurityCapability,
  L2BlockRule, L2ApprovalRule,
];
```

- [ ] **Step 2: 从包根导出 capability**

在 `packages/database/src/index.ts` 末尾追加:
```ts
export * from './capability';
```

- [ ] **Step 3: 构建 database 包验证类型解析**

Run: `pnpm --filter @medtrust/database build`
Expected: 构建通过,`dist/capability/*` 生成。

- [ ] **Step 4: Commit**
```bash
git add packages/database/src/capability/index.ts packages/database/src/index.ts
git commit -m "feat(capability): export capability entities + capabilityEntities array"
```

---

## Chunk 2: 种子数据与 seeder（packages/database）

### Task 5: seed-data 类型定义

**Files:**
- Create: `packages/database/src/capability/seed-data/types.ts`
- Test: `packages/database/src/capability/seed-data/types.spec.ts`（仅类型,见下）

- [ ] **Step 1: 写 TAXONOMY 形状类型**

`packages/database/src/capability/seed-data/types.ts`:
```ts
export interface TaxonomySeed {
  version: string;
  scenarios: {
    key: string; name: string; description: string;
    riskLevel: 'low' | 'medium' | 'high';
    typicalModelKeys: string[]; typicalAlgorithmKeys: string[];
  }[];
  guardrails: {
    key: string; name: string; kind: 'privacy_model' | 'crypto_model';
    description?: string; thresholds?: Record<string, unknown>;
    requiredOperatorKeys?: string[]; requiredAlgorithmKeys?: string[];
    applicableScenarios?: string[]; basedOn?: string;
  }[];
  riskPolicies: {
    key: string; riskLevel: 'low' | 'medium' | 'high'; criteria: string;
    requiredAnonymizationKey: string; requiredSecurityCapabilityKey: string;
    requiredAlgorithmKeys?: string[]; approvalRequired: boolean;
  }[];
  anonymizationDegrees: {
    key: string; name: string; definition: string;
    requiredTechniques: string[]; reIdentificationRiskUpper?: number; allowedScenarios: string[];
  }[];
  securityCapabilities: {
    key: string; name: string; requiredProtocolKeys: string[]; description?: string;
  }[];
  models: { key: string; name: string; category: string; trainingAlgorithmKeys: string[]; complianceNote?: string }[];
  algorithms: { key: string; name: string; category: string; underlyingOperatorKeys: string[]; compliancePrivacyModels?: string[] }[];
  operators: { key: string; name: string; opType: string; supportedProtocolKeys: string[]; complianceDriven?: boolean; triggeredBy?: string }[];
  protocols: { key: string; name: string; family: string; securityAssumption: string; securityCapabilityLevel: 'basic' | 'enhanced'; handlerKey?: string }[];
  infrastructure: { key: string; name: string; infraType: string; vendor: string; complianceNote?: string; handlerKey?: string }[];
  blockRules: { key: string; condition: string; reason: string }[];
  approvalRules: { conditionGroup: 'auto_block' | 'auto_approve' | 'manual'; conditions: string[] }[];
}
```

- [ ] **Step 2: Commit**
```bash
git add packages/database/src/capability/seed-data/types.ts
git commit -m "feat(capability): add TaxonomySeed shape types"
```

---

### Task 6: 转写分类学 JSON → TAXONOMY 常量（核心交付物）

**Files:**
- Create: `packages/database/src/capability/seed-data/taxonomy.ts`
- Test: `packages/database/src/capability/seed-data/taxonomy.spec.ts`

> **转写规则（务必逐条照搬源 JSON，不增不减）:**
> - 源: `/Users/mac/Sync/knowledge/医疗数据治理/可信数据空间/隐私计算分类学-JSON.md` 内 ```json 块。
> - `key` = name 的 slug(小写、空格/斜杠/括号→`-`、去重复 `-`)。示例: `Real-World Study (RWS)`→`real-world-study-rws`、`TEE-SGX`→`tee-sgx`、`Aggregate / Sum`→`aggregate-sum`、`国密 SM2 TLS`→`guomi-sm2-tls`(中文音译/保留原义皆可,但须稳定且唯一)。
> - **跨层引用必须用目标层的 key**,不是显示名。如 model.trainingAlgorithmKeys 引用 algorithms[].key;scenario.typicalModelKeys 引用 models[].key。转写时建立 name→key 映射再回填。
> - guardrails 仅含源里 `type` 为 `Privacy Model`/`Cryptographic Model` 的 4 条;`Risk Assessment` 3 条进 riskPolicies;`Anonymization Assessment` 2 条进 anonymizationDegrees;`Security Assessment` 2 条进 securityCapabilities。
> - riskPolicies 的 `requiredAnonymizationKey`/`requiredSecurityCapabilityKey` 由源 `required_anonymization`/`required_security_capability` 映射成对应 key(如 `adequate_or_complete`→`adequate`、`enhanced`→`enhanced`)。
> - blockRules.condition 原样保留源 `condition` 字符串。

- [ ] **Step 1: 先写计数校验测试（TडD：先红）**

`packages/database/src/capability/seed-data/taxonomy.spec.ts`:
```ts
import { TAXONOMY } from './taxonomy';

describe('TAXONOMY seed completeness', () => {
  it('matches source taxonomy counts', () => {
    expect(TAXONOMY.scenarios).toHaveLength(10);
    expect(TAXONOMY.guardrails).toHaveLength(4);
    expect(TAXONOMY.guardrails.filter(g => g.kind === 'privacy_model')).toHaveLength(3);
    expect(TAXONOMY.guardrails.filter(g => g.kind === 'crypto_model')).toHaveLength(1);
    expect(TAXONOMY.riskPolicies).toHaveLength(3);
    expect(TAXONOMY.anonymizationDegrees).toHaveLength(2);
    expect(TAXONOMY.securityCapabilities).toHaveLength(2);
    expect(TAXONOMY.models).toHaveLength(12);
    expect(TAXONOMY.algorithms).toHaveLength(11);
    expect(TAXONOMY.operators).toHaveLength(20);
    expect(TAXONOMY.protocols).toHaveLength(16);
    expect(TAXONOMY.infrastructure).toHaveLength(14);
    expect(TAXONOMY.blockRules).toHaveLength(5);
    expect(TAXONOMY.approvalRules).toHaveLength(3);
  });

  it('has unique keys within each layer', () => {
    const dup = (a: { key: string }[]) => a.length !== new Set(a.map(x => x.key)).size;
    expect(dup(TAXONOMY.scenarios)).toBe(false);
    expect(dup(TAXONOMY.models)).toBe(false);
    expect(dup(TAXONOMY.algorithms)).toBe(false);
    expect(dup(TAXONOMY.operators)).toBe(false);
    expect(dup(TAXONOMY.protocols)).toBe(false);
    expect(dup(TAXONOMY.infrastructure)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/database && pnpm jest src/capability/seed-data/taxonomy.spec.ts`
Expected: FAIL（`taxonomy.ts` 不存在 / 计数不符）。
> 注: 若 database 包无 jest 配置,用 `pnpm --filter @medtrust/database test`;若仍无,在 api 包内跑(实体已从 `@medtrust/database` 导出)。Task 0 假设 database 有 ts-jest;若没有则本计划首步补一个最小 `jest.config.js`(preset ts-jest, testEnvironment node)。

- [ ] **Step 3: 写 taxonomy.ts（逐条转写全部源数据）**

`packages/database/src/capability/seed-data/taxonomy.ts`(下为骨架 + 代表样例,实现时按上方"转写规则"补全到符合计数):
```ts
import { TaxonomySeed } from './types';

export const TAXONOMY: TaxonomySeed = {
  version: '7.0-medical-2026-06-20',
  scenarios: [
    { key: 'real-world-study-rws', name: 'Real-World Study (RWS)',
      description: '真实世界研究: 多中心药物疗效/安全性评估', riskLevel: 'high',
      typicalModelKeys: ['cox-ph', 'kaplan-meier-estimator', 'logistic-regression'],
      typicalAlgorithmKeys: ['federated-cox-regression', 'psi', 'dp-query'] },
    // … 其余 9 条
  ],
  guardrails: [
    { key: 'k-anonymity', name: 'k-anonymity', kind: 'privacy_model',
      description: '同一准标识符组合至少k条记录, 防止身份重识别',
      thresholds: { medical_general: 5, high_risk: 11 },
      requiredOperatorKeys: ['generalization', 'suppression'],
      applicableScenarios: ['all_data_flows'], basedOn: 'GB/T 37964-2019' },
    // l-diversity, t-closeness (privacy_model), epsilon-dp (crypto_model)
  ],
  riskPolicies: [
    { key: 'risk-high', riskLevel: 'high',
      criteria: '跨机构≥3 OR 含基因组/精神/HIV OR 公开发布 OR 长流通链',
      requiredAnonymizationKey: 'adequate', requiredSecurityCapabilityKey: 'enhanced',
      requiredAlgorithmKeys: ['dp-sgd', 'dp-query'], approvalRequired: true },
    // risk-medium, risk-low
  ],
  anonymizationDegrees: [
    { key: 'complete', name: 'Anonymization Degree: Complete',
      definition: '所有直接标识符删除+所有准标识符 k/l/t + DP',
      requiredTechniques: ['generalization', 'suppression', 'pseudonymization', 'dp'],
      reIdentificationRiskUpper: 0.01, allowedScenarios: ['all'] },
    // adequate
  ],
  securityCapabilities: [
    { key: 'enhanced', name: 'Security Capability: Enhanced',
      requiredProtocolKeys: ['tee-sgx', 'tee-tdx', 'amd-sev-snp', 'mpc-spdz', 'he-ckks'],
      description: '数据不出域, 全程可审计, 支持多方安全计算' },
    // basic
  ],
  models: [
    { key: 'meditron-7b', name: 'Meditron-7B', category: 'LLM',
      trainingAlgorithmKeys: ['lora', 'fedavg', 'dp-sgd'],
      complianceNote: '开源, 本地部署可用, 不适合高风险场景的第三方API' },
    // … 其余 11 条
  ],
  algorithms: [
    { key: 'fedavg', name: 'FedAvg', category: 'Federated',
      underlyingOperatorKeys: ['aggregate-sum', 'add-over-he'],
      compliancePrivacyModels: ['NOT sufficient for ε ≤ 1.0, must use DP-FedAvg'] },
    // … 其余 10 条
  ],
  operators: [
    { key: 'generalization', name: 'Generalization (泛化)', opType: 'Anonymization',
      supportedProtocolKeys: ['local-preprocess'], complianceDriven: true, triggeredBy: 'k-anonymity' },
    // … 其余 19 条(注: '本地预处理'/'DP'/'明文' 等非 L6 注册协议的 supportedProtocols,
    //   统一规范成稳定 key 如 'local-preprocess'、'dp'、'plaintext';这些 key 不要求在 l6_protocol 中存在,
    //   见 Task 8 校验白名单)
  ],
  protocols: [
    { key: 'tee-sgx', name: 'TEE-SGX', family: 'TEE',
      securityAssumption: 'Intel CPU + SGX 飞地', securityCapabilityLevel: 'enhanced' },
    // … 其余 15 条
  ],
  infrastructure: [
    { key: 'fisco-bcos', name: 'FISCO BCOS 审计链', infraType: 'Blockchain', vendor: '微众/FISCO',
      complianceNote: '操作日志哈希上链', handlerKey: 'blockchain' },
    // … 其余 13 条
  ],
  blockRules: [
    { key: 'block-high-partial', condition: 'risk==high AND anonymization==partial',
      reason: '高风险场景不允许部分处理' },
    // … 其余 4 条
  ],
  approvalRules: [
    { conditionGroup: 'auto_block', conditions: ['any block_rule matches'] },
    { conditionGroup: 'auto_approve', conditions: ['risk==low AND anonymization>=partial AND security>=basic'] },
    { conditionGroup: 'manual', conditions: [
      'risk==medium AND anonymization==partial AND security>=enhanced',
      'risk==high AND anonymization>=adequate AND security>=enhanced',
      'any_DP_used AND epsilon>1.0',
      'cross_border OR human_genetic_resources' ] },
  ],
};
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/database && pnpm jest src/capability/seed-data/taxonomy.spec.ts`
Expected: PASS（全部计数与唯一性校验通过）。

- [ ] **Step 5: Commit**
```bash
git add packages/database/src/capability/seed-data/taxonomy.ts packages/database/src/capability/seed-data/taxonomy.spec.ts
git commit -m "feat(capability): transcribe 7-layer taxonomy into TAXONOMY seed constant"
```

---

### Task 7: 跨层引用名→key 映射工具（保证转写引用一致）

**Files:**
- Create: `packages/database/src/capability/seed-data/key-util.ts`
- Test: `packages/database/src/capability/seed-data/key-util.spec.ts`

- [ ] **Step 1: 写 slug 测试（先红）**
```ts
import { toKey } from './key-util';
describe('toKey', () => {
  it('slugifies names stably', () => {
    expect(toKey('Real-World Study (RWS)')).toBe('real-world-study-rws');
    expect(toKey('Aggregate / Sum')).toBe('aggregate-sum');
    expect(toKey('TEE-SGX')).toBe('tee-sgx');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/database && pnpm jest src/capability/seed-data/key-util.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 toKey**
```ts
export function toKey(name: string): string {
  return name
    .trim().toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[\s/_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/database && pnpm jest src/capability/seed-data/key-util.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add packages/database/src/capability/seed-data/key-util.ts packages/database/src/capability/seed-data/key-util.spec.ts
git commit -m "feat(capability): add stable slug key util"
```

---

### Task 8: seedCapability — 幂等 upsert + 跨层引用校验（fail-closed）

**Files:**
- Create: `packages/database/src/capability/seeder.ts`
- Test: `packages/database/src/capability/seeder.spec.ts`

- [ ] **Step 1: 写测试（先红）— 用内存 sqlite 真库**
```ts
import { DataSource } from 'typeorm';
import { capabilityEntities, L3Model, L1Scenario } from '../index';
import { seedCapability } from './seeder';

async function memDs(): Promise<DataSource> {
  const ds = new DataSource({
    type: 'better-sqlite3', database: ':memory:',
    entities: capabilityEntities, synchronize: true,
  });
  await ds.initialize();
  return ds;
}

describe('seedCapability', () => {
  it('seeds full taxonomy and is idempotent', async () => {
    const ds = await memDs();
    await seedCapability(ds);
    const after1 = await ds.getRepository(L3Model).count();
    expect(after1).toBe(12);
    await seedCapability(ds); // 重跑
    const after2 = await ds.getRepository(L3Model).count();
    expect(after2).toBe(12); // 幂等: 行数不变
    expect(await ds.getRepository(L1Scenario).count()).toBe(10);
    await ds.destroy();
  });

  it('passes cross-layer key reference validation', async () => {
    const ds = await memDs();
    await expect(seedCapability(ds)).resolves.not.toThrow();
    await ds.destroy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/database && pnpm jest src/capability/seeder.spec.ts`
Expected: FAIL（`seeder.ts` 不存在）。

- [ ] **Step 3: 实现 seeder.ts**
```ts
import { DataSource } from 'typeorm';
import { TAXONOMY } from './seed-data/taxonomy';
import {
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
  L2Guardrail, L2RiskPolicy, L2AnonymizationDegree, L2SecurityCapability,
  L2BlockRule, L2ApprovalRule,
} from './index';

// 非 L6 注册协议的伪协议 key(本地预处理/DP/明文等),算子可引用但不要求存在于 l6_protocol。
const PSEUDO_PROTOCOLS = new Set(['local-preprocess', 'dp', 'plaintext']);

async function upsertByKey<T extends { key?: string }>(
  ds: DataSource, Entity: new () => T, rows: Partial<T>[], keyField: keyof T = 'key' as keyof T,
): Promise<void> {
  const repo = ds.getRepository(Entity);
  for (const row of rows) {
    const where = { [keyField]: row[keyField] } as any;
    const existing = await repo.findOne({ where });
    await repo.save(existing ? repo.merge(existing, row as any) : repo.create(row as any));
  }
}

export async function seedCapability(ds: DataSource): Promise<void> {
  // 1) 能力层 + L2
  await upsertByKey(ds, L1Scenario, TAXONOMY.scenarios);
  await upsertByKey(ds, L3Model, TAXONOMY.models);
  await upsertByKey(ds, L4Algorithm, TAXONOMY.algorithms);
  await upsertByKey(ds, L5Operator, TAXONOMY.operators);
  await upsertByKey(ds, L6Protocol, TAXONOMY.protocols);
  await upsertByKey(ds, L7Infrastructure, TAXONOMY.infrastructure);
  await upsertByKey(ds, L2Guardrail, TAXONOMY.guardrails);
  await upsertByKey(ds, L2RiskPolicy, TAXONOMY.riskPolicies);
  await upsertByKey(ds, L2AnonymizationDegree, TAXONOMY.anonymizationDegrees);
  await upsertByKey(ds, L2SecurityCapability, TAXONOMY.securityCapabilities);
  await upsertByKey(ds, L2BlockRule, TAXONOMY.blockRules);
  await upsertByKey(ds, L2ApprovalRule, TAXONOMY.approvalRules, 'conditionGroup' as any);

  // 2) 跨层引用校验(fail-closed): 任一悬空引用即抛错
  validateRefs();
}

function validateRefs(): void {
  const t = TAXONOMY;
  const set = (a: { key: string }[]) => new Set(a.map(x => x.key));
  const models = set(t.models), algos = set(t.algorithms),
        ops = set(t.operators), protos = set(t.protocols);
  const errors: string[] = [];
  const check = (refs: string[], pool: Set<string>, ctx: string, allowPseudo = false) => {
    for (const r of refs) {
      if (pool.has(r)) continue;
      if (allowPseudo && PSEUDO_PROTOCOLS.has(r)) continue;
      errors.push(`${ctx} → 悬空引用 '${r}'`);
    }
  };
  for (const s of t.scenarios) {
    check(s.typicalModelKeys, models, `scenario ${s.key}.model`);
    check(s.typicalAlgorithmKeys, algos, `scenario ${s.key}.algo`);
  }
  for (const m of t.models) check(m.trainingAlgorithmKeys, algos, `model ${m.key}.algo`);
  for (const a of t.algorithms) check(a.underlyingOperatorKeys, ops, `algo ${a.key}.op`);
  for (const o of t.operators) check(o.supportedProtocolKeys, protos, `op ${o.key}.proto`, true);
  for (const sc of t.securityCapabilities) check(sc.requiredProtocolKeys, protos, `sec ${sc.key}.proto`);
  if (errors.length) throw new Error(`Capability seed 跨层引用校验失败:\n- ${errors.join('\n- ')}`);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/database && pnpm jest src/capability/seeder.spec.ts`
Expected: PASS（12 模型、10 场景、幂等、引用校验全过）。
> 若校验抛错,说明 Task 6 转写有悬空引用(name 未正确映射成 key)——回到 taxonomy.ts 修正引用,这正是该校验的目的。

- [ ] **Step 5: Commit**
```bash
git add packages/database/src/capability/seeder.ts packages/database/src/capability/seeder.spec.ts
git commit -m "feat(capability): idempotent seedCapability with fail-closed cross-layer ref validation"
```

---

### Task 9: CLI seed 脚本 + package script

**Files:**
- Create: `packages/database/src/capability/seed-capability.cli.ts`
- Modify: `packages/database/package.json`（scripts 增加 `seed:capability`）

- [ ] **Step 1: 写 CLI**
```ts
import { AppDataSource } from '../data-source';
import { capabilityEntities } from './index';
import { seedCapability } from './seeder';

async function main() {
  // 把 capability 实体并入 AppDataSource(其 entities 仅含 4 核心实体)
  AppDataSource.setOptions({
    entities: [...(AppDataSource.options.entities as any[]), ...capabilityEntities],
  });
  await AppDataSource.initialize();
  await seedCapability(AppDataSource);
  // 打印各层行数
  for (const E of capabilityEntities) {
    const n = await AppDataSource.getRepository(E).count();
    console.log(`${(E as any).name}: ${n}`);
  }
  await AppDataSource.destroy();
  console.log('✓ capability seed done');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 加 package script**

`packages/database/package.json` 的 `scripts` 内加(参考既有 `migration:run` 用的 ts 运行器,通常是 `ts-node`):
```json
"seed:capability": "ts-node src/capability/seed-capability.cli.ts"
```
> 若包用 tsx 而非 ts-node,改用 `tsx`。比对同文件里 `migration:*` 脚本的运行器关键字保持一致。

- [ ] **Step 3: 运行 seed,验证落库**

Run: `cd packages/database && pnpm seed:capability`
Expected: 打印 `L3Model: 12`、`L1Scenario: 10` … `✓ capability seed done`,无报错。
再跑一次确认幂等(行数不变)。

- [ ] **Step 4: Commit**
```bash
git add packages/database/src/capability/seed-capability.cli.ts packages/database/package.json
git commit -m "feat(capability): add seed:capability CLI script"
```

---

## Chunk 3: 只读访问域（apps/api）

### Task 10: 泛型 CapabilityRegistryService

**Files:**
- Create: `apps/api/src/capability/registry.service.ts`
- Test: `apps/api/src/capability/registry.service.spec.ts`

- [ ] **Step 1: 写测试（先红，mock repo 模式同 compute-task.service.spec.ts）**
```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { L3Model } from '@medtrust/database';
import { CapabilityRegistryService } from './registry.service';

describe('CapabilityRegistryService', () => {
  const repo = { find: jest.fn(), findOne: jest.fn() };
  let svc: CapabilityRegistryService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CapabilityRegistryService,
        { provide: getRepositoryToken(L3Model), useValue: repo },
      ],
    }).compile();
    svc = mod.get(CapabilityRegistryService);
    jest.clearAllMocks();
  });

  it('lists models', async () => {
    repo.find.mockResolvedValue([{ key: 'meditron-7b' }]);
    await expect(svc.list('l3_model')).resolves.toEqual([{ key: 'meditron-7b' }]);
  });

  it('rejects unknown layer (fail-closed)', async () => {
    await expect(svc.list('nope' as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && pnpm test -- registry.service`
Expected: FAIL。

- [ ] **Step 3: 实现 registry.service.ts**
```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ObjectLiteral } from 'typeorm';
import {
  LayerKind,
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
} from '@medtrust/database';

// P0 只读: 6 能力层。L2 规则表读取在 P1 随引擎提供。
@Injectable()
export class CapabilityRegistryService {
  private readonly repos: Partial<Record<LayerKind, Repository<ObjectLiteral>>>;

  constructor(
    @InjectRepository(L1Scenario) l1: Repository<L1Scenario>,
    @InjectRepository(L3Model) l3: Repository<L3Model>,
    @InjectRepository(L4Algorithm) l4: Repository<L4Algorithm>,
    @InjectRepository(L5Operator) l5: Repository<L5Operator>,
    @InjectRepository(L6Protocol) l6: Repository<L6Protocol>,
    @InjectRepository(L7Infrastructure) l7: Repository<L7Infrastructure>,
  ) {
    this.repos = {
      [LayerKind.L1_SCENARIO]: l1, [LayerKind.L3_MODEL]: l3,
      [LayerKind.L4_ALGORITHM]: l4, [LayerKind.L5_OPERATOR]: l5,
      [LayerKind.L6_PROTOCOL]: l6, [LayerKind.L7_INFRASTRUCTURE]: l7,
    };
  }

  private repo(layer: LayerKind): Repository<ObjectLiteral> {
    const r = this.repos[layer];
    if (!r) throw new BadRequestException(`未知或不可读的层: ${layer}`);
    return r;
  }

  list(layer: LayerKind) {
    return this.repo(layer).find();
  }

  get(layer: LayerKind, key: string) {
    return this.repo(layer).findOne({ where: { key } });
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/api && pnpm test -- registry.service`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/capability/registry.service.ts apps/api/src/capability/registry.service.spec.ts
git commit -m "feat(capability): add generic CapabilityRegistryService (read, 6 layers)"
```

---

### Task 11: CapabilityController（只读 REST）

**Files:**
- Create: `apps/api/src/capability/capability.controller.ts`
- Test: `apps/api/src/capability/capability.controller.spec.ts`

- [ ] **Step 1: 写测试（先红）**
```ts
import { Test } from '@nestjs/testing';
import { LayerKind } from '@medtrust/database';
import { CapabilityController } from './capability.controller';
import { CapabilityRegistryService } from './registry.service';

describe('CapabilityController', () => {
  const svc = { list: jest.fn(), get: jest.fn() };
  let ctrl: CapabilityController;
  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      controllers: [CapabilityController],
      providers: [{ provide: CapabilityRegistryService, useValue: svc }],
    }).compile();
    ctrl = mod.get(CapabilityController);
    jest.clearAllMocks();
  });
  it('GET /capability/:layer lists', async () => {
    svc.list.mockResolvedValue([{ key: 'tee-sgx' }]);
    await expect(ctrl.list(LayerKind.L6_PROTOCOL)).resolves.toEqual([{ key: 'tee-sgx' }]);
    expect(svc.list).toHaveBeenCalledWith(LayerKind.L6_PROTOCOL);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/api && pnpm test -- capability.controller`
Expected: FAIL。

- [ ] **Step 3: 实现 controller**
```ts
import { Controller, Get, Param } from '@nestjs/common';
import { LayerKind } from '@medtrust/database';
import { CapabilityRegistryService } from './registry.service';

// 只读能力注册表(知识库后台/任务设计的数据源)。前缀 /api/v1 由全局设置。
@Controller('capability')
export class CapabilityController {
  constructor(private readonly registry: CapabilityRegistryService) {}

  @Get(':layer')
  list(@Param('layer') layer: LayerKind) {
    return this.registry.list(layer);
  }

  @Get(':layer/:key')
  get(@Param('layer') layer: LayerKind, @Param('key') key: string) {
    return this.registry.get(layer, key);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd apps/api && pnpm test -- capability.controller`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/capability/capability.controller.ts apps/api/src/capability/capability.controller.spec.ts
git commit -m "feat(capability): add read-only CapabilityController"
```

---

### Task 12: CapabilityModule + 接入 app.module

**Files:**
- Create: `apps/api/src/capability/capability.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: 写 CapabilityModule**
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
} from '@medtrust/database';
import { CapabilityRegistryService } from './registry.service';
import { CapabilityController } from './capability.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
    ]),
  ],
  controllers: [CapabilityController],
  providers: [CapabilityRegistryService],
  exports: [CapabilityRegistryService],
})
export class CapabilityModule {}
```

- [ ] **Step 2: 接入 app.module.ts**

import 区加:
```ts
import { CapabilityModule } from './capability/capability.module';
```
`imports: [...]` 数组加 `CapabilityModule,`（放在 `SecretFlowAssistantModule,` 之后）。

- [ ] **Step 3: 编译验证 + 全量测试**

Run: `cd apps/api && pnpm build && pnpm test`
Expected: 编译通过;新增 capability 测试与既有测试全绿。
> `autoLoadEntities: true` 会把 forFeature 注册的 6 张能力表自动并入,dev `synchronize` 自动建表。L2 表 P0 不在 api 侧 forFeature(无读模块),由 seeder CLI 显式建表/灌库;待 P1 引擎接入时再 forFeature。

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/capability/capability.module.ts apps/api/src/app.module.ts
git commit -m "feat(capability): wire CapabilityModule into app module"
```

---

### Task 13: 端到端冒烟（手动验证 P0 交付）

**Files:** 无（验证步骤）

- [ ] **Step 1: 起 API + seed**

Run: `cd packages/database && pnpm seed:capability`（确保 `./data/medtrust.db` 已灌库）
然后 Run: `pnpm --filter api dev`（:5021）

- [ ] **Step 2: 查询验证**

Run: `curl -s http://localhost:5021/api/v1/capability/l3_model | python3 -m json.tool | head`
Expected: 返回 12 个模型对象,含 `meditron-7b` 且 `trainingAlgorithmKeys` 为 key 数组。
Run: `curl -s http://localhost:5021/api/v1/capability/l6_protocol/tee-sgx`
Expected: 返回 TEE-SGX 对象,`securityCapabilityLevel: "enhanced"`。

- [ ] **Step 3: 收尾 commit（若冒烟期间有微调）**
```bash
git add -A && git commit -m "chore(capability): P0 smoke verification"
```

---

## P0 完成定义（DoD）

- [ ] 12 张层表在 DB 建立(6 能力层经 api `forFeature` + autoload;6 L2 表经 seeder)。
- [ ] `TAXONOMY` 常量逐条覆盖源 JSON,计数测试全绿。
- [ ] `seedCapability` 幂等；跨层引用 warn-only 报告（不阻断），悬空引用清单可见（留待 P1 清洗）。
- [ ] `GET /api/v1/capability/:layer[/:key]` 可读 6 能力层。
- [ ] 既有测试无回归;未触碰任何运行时模块(orchestrator/connector/contract/identity)。

## 衔接 P1

P1 起：新增 `composition` + `compliance_evaluation` 实体、`l2-compliance/` 子模块与 `ComplianceEngine`（读 6 张 L2 表做结构校验 + 治理裁决），对齐 spec §6 两段 YAML。届时把 6 张 L2 表在 api 侧 `forFeature`。
