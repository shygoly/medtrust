# AI 助手与传统流程集成 - 完整合规方案

## 📋 问题陈述

**当前状况**：
- ✅ AI 助手可以快速配置任务
- ❌ 跳过了数据合约创建流程
- ❌ 缺少权限验证环节
- ❌ 与现有的"数据 → 合约 → MDOP → 任务"流程脱节

**目标**：
将 AI 助手无缝集成到现有合规流程中，保持快速便捷的同时满足数据治理要求。

## 🎯 设计原则

1. **合规优先**：不能为了便捷性牺牲数据治理
2. **渐进式体验**：根据用户已有的合约/权限决定流程长度
3. **透明可审计**：所有操作留痕，用户清楚每一步
4. **智能简化**：能自动化的不让用户手动操作

## 🏗️ 架构设计

### 核心组件

```
┌─────────────────────────────────────────────────┐
│              AI Chat Agent                      │
│  ┌──────────────────────────────────────────┐  │
│  │  ConversationController                  │  │
│  │  - 接收用户消息                           │  │
│  │  - 调用 PiAgent                          │  │
│  │  - 返回 Card Message                     │  │
│  └──────────┬───────────────────────────────┘  │
│             │                                    │
│  ┌──────────▼───────────────────────────────┐  │
│  │  ComplianceOrchestrator (新增)            │  │
│  │  - 权限检查                               │  │
│  │  - 合约状态查询                           │  │
│  │  - 合约创建编排                           │  │
│  │  - 审批流程管理                           │  │
│  └──────────┬───────────────────────────────┘  │
│             │                                    │
│  ┌──────────▼───────────────────────────────┐  │
│  │  Agent Tools                             │  │
│  │  - check_data_access                     │  │
│  │  - check_contract_status                 │  │
│  │  - create_contract_draft                 │  │
│  │  - submit_mdop_job                       │  │
│  └──────────┬───────────────────────────────┘  │
└─────────────┼───────────────────────────────────┘
              │
    ┌─────────┴─────────┬────────────────┬──────────┐
    ▼                   ▼                ▼          ▼
┌────────┐      ┌────────────┐   ┌───────────┐  ┌──────┐
│ Space  │      │ Contract   │   │   MDOP    │  │ Audit│
│ Kernel │      │ Service    │   │  Service  │  │ Log  │
└────────┘      └────────────┘   └───────────┘  └──────┘
```

### 数据流

```
用户消息
  ↓
[1] Agent 识别场景
  ↓
[2] ComplianceOrchestrator.checkPrerequisites()
  ├─ 检查用户权限（Space Member/Admin）
  ├─ 检查数据产品访问权限
  └─ 检查数据合约状态
  ↓
[3] 分支决策
  │
  ├─ 情况 A: 已有合约 ───────────────────────┐
  │                                          │
  ├─ 情况 B: 无合约但可自动创建 ──────────┐ │
  │   └─ 创建临时合约草稿                  │ │
  │   └─ 返回 [合约审批 Card]             │ │
  │                                         │ │
  └─ 情况 C: 无合约且需管理员审批 ────┐   │ │
      └─ 返回 [申请合约 Card]          │   │ │
                                       │   │ │
  ┌────────────────────────────────────┘   │ │
  │  ┌───────────────────────────────────┘ │
  │  │  ┌──────────────────────────────────┘
  ▼  ▼  ▼
[4] 返回 [配置任务 Card]
  ↓
[5] 用户填写参数
  ↓
[6] submit_mdop_job (带 contractId)
  ↓
[7] 任务执行
  ↓
[8] 返回结果
```

## 📐 详细设计

### 1. 权限检查层级

```typescript
// apps/chat-agent/src/compliance/permission-checker.ts

export class PermissionChecker {
  /**
   * 检查用户是否有权限使用 AI 助手配置任务
   */
  async checkChatPermission(userId: string, spaceId: string): Promise<CheckResult> {
    const membership = await this.spaceMembershipService.get(userId, spaceId);

    return {
      allowed: membership && ['member', 'admin'].includes(membership.role),
      reason: !membership ? 'Not a space member' :
              membership.role === 'viewer' ? 'Viewer role cannot submit tasks' : null
    };
  }

  /**
   * 检查用户是否有权访问特定数据产品
   */
  async checkDataProductAccess(
    userId: string,
    participantId: string,
    dataProductId: string
  ): Promise<CheckResult> {
    // 查询 Space Kernel: 用户是否有该参与方的数据访问权限
    const hasAccess = await this.spaceKernelClient.checkDataAccess({
      userId,
      participantId,
      dataProductId,
      operation: 'read'
    });

    return {
      allowed: hasAccess,
      reason: !hasAccess ? `No access to data product ${dataProductId}` : null
    };
  }
}
```

### 2. 合约状态查询

```typescript
// apps/chat-agent/src/compliance/contract-checker.ts

export class ContractChecker {
  /**
   * 查询两方之间是否存在有效合约
   */
  async findActiveContract(
    partyA: string,
    partyB: string,
    purpose?: string
  ): Promise<Contract | null> {
    const contracts = await this.contractService.query({
      parties: [partyA, partyB],
      status: 'active',
      purpose: purpose ? { contains: purpose } : undefined
    });

    return contracts[0] || null;
  }

  /**
   * 判断是否可以自动创建合约
   */
  async canAutoCreateContract(
    userId: string,
    partyA: string,
    partyB: string
  ): Promise<boolean> {
    // 规则：
    // 1. 用户是 partyA 或 partyB 的管理员
    // 2. 双方已建立互信关系（pre-approved partners）
    // 3. 数据用途在白名单内（如"研究分析"）

    const isAdminOfA = await this.isParticipantAdmin(userId, partyA);
    const isAdminOfB = await this.isParticipantAdmin(userId, partyB);
    const areTrustedPartners = await this.checkTrustRelation(partyA, partyB);

    return (isAdminOfA || isAdminOfB) && areTrustedPartners;
  }
}
```

### 3. 合规编排器

```typescript
// apps/chat-agent/src/compliance/compliance-orchestrator.ts

export class ComplianceOrchestrator {
  constructor(
    private permissionChecker: PermissionChecker,
    private contractChecker: ContractChecker,
    private contractService: ContractService
  ) {}

  /**
   * 检查提交任务的先决条件
   */
  async checkPrerequisites(params: TaskParams, context: ToolContext): Promise<PrerequisiteResult> {
    // 1. 检查 Space 权限
    const chatPermission = await this.permissionChecker.checkChatPermission(
      context.userId,
      context.spaceId
    );
    if (!chatPermission.allowed) {
      return {
        status: 'blocked',
        reason: chatPermission.reason,
        action: 'show_permission_error'
      };
    }

    // 2. 检查数据产品访问权限
    const trialAccess = await this.permissionChecker.checkDataProductAccess(
      context.userId,
      params.trial.participantId,
      params.trial.dataProductId
    );
    if (!trialAccess.allowed) {
      return {
        status: 'blocked',
        reason: `No access to trial data: ${trialAccess.reason}`,
        action: 'show_data_access_error'
      };
    }

    const controlsAccess = await this.permissionChecker.checkDataProductAccess(
      context.userId,
      params.controls.participantId,
      params.controls.dataProductId
    );
    if (!controlsAccess.allowed) {
      return {
        status: 'blocked',
        reason: `No access to controls data: ${controlsAccess.reason}`,
        action: 'show_data_access_error'
      };
    }

    // 3. 检查合约状态
    const existingContract = await this.contractChecker.findActiveContract(
      params.trial.participantId,
      params.controls.participantId,
      'external-control'
    );

    if (existingContract) {
      // 情况 A: 已有合约，直接进入任务配置
      return {
        status: 'ready',
        contractId: existingContract.id,
        action: 'show_task_config'
      };
    }

    // 4. 判断是否可自动创建合约
    const canAutoCreate = await this.contractChecker.canAutoCreateContract(
      context.userId,
      params.trial.participantId,
      params.controls.participantId
    );

    if (canAutoCreate) {
      // 情况 B: 可自动创建，返回合约草稿待用户确认
      const draft = await this.contractService.createDraft({
        parties: [params.trial.participantId, params.controls.participantId],
        purpose: '单臂试验外部对照分析',
        dataProducts: [
          { participantId: params.trial.participantId, id: params.trial.dataProductId },
          { participantId: params.controls.participantId, id: params.controls.dataProductId }
        ],
        expiresIn: '30d',
        autoApprove: true
      });

      return {
        status: 'needs_contract_approval',
        contractDraft: draft,
        action: 'show_contract_approval_card'
      };
    }

    // 情况 C: 需要管理员审批
    return {
      status: 'needs_admin_approval',
      reason: 'Contract requires administrator approval',
      action: 'show_contract_request_card'
    };
  }

  /**
   * 创建并激活合约
   */
  async createAndActivateContract(draftId: string, userId: string): Promise<Contract> {
    const draft = await this.contractService.getDraft(draftId);

    // 审计日志
    await this.auditLog.record({
      action: 'contract.create_via_ai_assistant',
      userId,
      contractDraft: draftId,
      timestamp: new Date()
    });

    // 激活合约
    const contract = await this.contractService.activate(draftId);

    return contract;
  }
}
```

### 4. Agent Tools 扩展

```typescript
// apps/chat-agent/src/agent/tools/compliance.tools.ts

export const complianceTools: Tool[] = [
  {
    name: 'check_data_access',
    description: '检查用户对数据产品的访问权限',
    parameters: {
      type: 'object',
      properties: {
        participantId: { type: 'string', description: '参与方 ID' },
        dataProductId: { type: 'string', description: '数据产品 ID' }
      },
      required: ['participantId', 'dataProductId']
    },
    execute: async (params, context) => {
      const checker = getPermissionChecker();
      const result = await checker.checkDataProductAccess(
        context.userId,
        params.participantId,
        params.dataProductId
      );

      return {
        success: result.allowed,
        data: { hasAccess: result.allowed },
        error: result.reason
      };
    }
  },

  {
    name: 'check_contract_status',
    description: '检查两个参与方之间的合约状态',
    parameters: {
      type: 'object',
      properties: {
        partyA: { type: 'string', description: '参与方 A' },
        partyB: { type: 'string', description: '参与方 B' },
        purpose: { type: 'string', description: '合约用途（可选）' }
      },
      required: ['partyA', 'partyB']
    },
    execute: async (params, context) => {
      const checker = getContractChecker();
      const contract = await checker.findActiveContract(
        params.partyA,
        params.partyB,
        params.purpose
      );

      return {
        success: true,
        data: {
          hasContract: !!contract,
          contractId: contract?.id,
          status: contract?.status,
          expiresAt: contract?.expiresAt
        }
      };
    }
  },

  {
    name: 'create_contract_draft',
    description: '创建数据合约草稿',
    parameters: {
      type: 'object',
      properties: {
        parties: {
          type: 'array',
          items: { type: 'string' },
          description: '参与方 ID 列表'
        },
        purpose: { type: 'string', description: '合约用途' },
        dataProducts: {
          type: 'array',
          description: '涉及的数据产品'
        },
        expiresInDays: { type: 'number', description: '有效期（天）' }
      },
      required: ['parties', 'purpose', 'dataProducts']
    },
    execute: async (params, context) => {
      const service = getContractService();
      const draft = await service.createDraft({
        ...params,
        createdBy: context.userId,
        expiresIn: `${params.expiresInDays}d`
      });

      return {
        success: true,
        data: {
          draftId: draft.id,
          status: 'draft',
          requiresApproval: draft.autoApprove === false
        }
      };
    }
  },

  {
    name: 'activate_contract',
    description: '激活合约草稿',
    parameters: {
      type: 'object',
      properties: {
        draftId: { type: 'string', description: '合约草稿 ID' }
      },
      required: ['draftId']
    },
    execute: async (params, context) => {
      const orchestrator = getComplianceOrchestrator();
      const contract = await orchestrator.createAndActivateContract(
        params.draftId,
        context.userId
      );

      return {
        success: true,
        data: {
          contractId: contract.id,
          status: contract.status,
          activatedAt: contract.activatedAt
        }
      };
    }
  }
];
```

### 5. System Prompt 更新

```markdown
<!-- apps/chat-agent/src/agent/prompts/system.md -->

# MedTrust 可信空间 AI 助手

你是 MedTrust 可信空间的 AI 助手，帮助用户配置和提交多方安全计算任务。

## 合规流程

在帮助用户配置任务时，必须遵循以下合规流程：

### 1. 权限检查
- 用户必须是 Space 的 Member 或 Admin
- 用户必须有权访问涉及的数据产品

### 2. 数据合约检查
在配置任务参数前，必须确认：
- 参与方之间是否存在有效的数据合约
- 如果没有合约，是否可以自动创建

**工作流程**：
```
用户提出需求
  ↓
调用 check_contract_status 检查合约
  ↓
情况 A: 有合约 → 直接返回配置表单 Card
情况 B: 无合约但可自动创建 → 返回合约审批 Card
情况 C: 无合约且需审批 → 返回合约申请 Card
```

### 3. 合约审批 Card

当需要用户确认创建合约时，返回：

```json
{
  "type": "contract_approval",
  "title": "数据合约审批",
  "description": "创建临时数据合约以进行外部对照分析",
  "contract": {
    "parties": ["p-sponsor", "p-hosp-a"],
    "purpose": "单臂试验外部对照分析",
    "dataProducts": [...],
    "expiresIn": "30天",
    "autoApprove": true
  },
  "actions": [
    {"label": "同意并创建", "type": "approve"},
    {"label": "取消", "type": "cancel"}
  ]
}
```

### 4. 任务配置 Card

只有在合约就绪后，才返回任务配置 Card。

在 Card 的 metadata 中包含 contractId：
```json
{
  "type": "form",
  "title": "单臂试验外部对照配置",
  "metadata": {
    "contractId": "ct-12345"
  },
  "fields": [...]
}
```

### 5. 任务提交

提交任务时，必须包含 contractId：
```
submit_mdop_job({
  ...params,
  contractId: "ct-12345"
})
```

## 示例对话

**用户**: 我想做单臂对照分析

**助手**:
1. 调用 check_contract_status(partyA: "p-sponsor", partyB: "p-hosp-a")
2. 发现无合约，但可自动创建
3. 调用 create_contract_draft(...)
4. 返回合约审批 Card

**用户**: [点击"同意并创建"]

**助手**:
1. 调用 activate_contract(draftId: "draft-123")
2. 获得 contractId: "ct-12345"
3. 返回任务配置 Card（包含 contractId）

**用户**: [填写并提交任务配置]

**助手**:
1. 调用 submit_mdop_job({..., contractId: "ct-12345"})
2. 返回任务状态 Card
```

### 6. Card Message 类型定义

```typescript
// packages/chat-cards/src/types.ts

export type CardType = 'form' | 'status' | 'result' | 'contract_approval' | 'contract_request';

export interface ContractApprovalCard extends BaseCard {
  type: 'contract_approval';
  contract: {
    draftId: string;
    parties: string[];
    purpose: string;
    dataProducts: Array<{
      participantId: string;
      dataProductId: string;
      name: string;
    }>;
    expiresIn: string;
    autoApprove: boolean;
  };
  actions: CardAction[];
}

export interface ContractRequestCard extends BaseCard {
  type: 'contract_request';
  message: string;
  contactAdmin: {
    name: string;
    email: string;
  };
}
```

### 7. Card Renderer 扩展

```tsx
// packages/chat-cards/src/cards/ContractApprovalCard.tsx

export function ContractApprovalCard({ card, onSubmit }: ContractApprovalCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>📜 {card.title}</CardTitle>
        <CardDescription>{card.description}</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">参与方</h4>
            <ul>
              {card.contract.parties.map(party => (
                <li key={party}>• {party}</li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-2">用途</h4>
            <p>{card.contract.purpose}</p>
          </div>

          <div>
            <h4 className="font-semibold mb-2">涉及数据产品</h4>
            <ul>
              {card.contract.dataProducts.map(dp => (
                <li key={dp.dataProductId}>
                  • {dp.name} ({dp.participantId})
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-yellow-50 p-3 rounded">
            <p className="text-sm">
              ⚠️ 此合约有效期 {card.contract.expiresIn}，
              {card.contract.autoApprove ? '创建后立即生效' : '需要对方审批后生效'}
            </p>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex gap-2">
        <Button
          variant="default"
          onClick={() => onSubmit({ action: 'approve', draftId: card.contract.draftId })}
        >
          同意并创建
        </Button>
        <Button
          variant="outline"
          onClick={() => onSubmit({ action: 'cancel' })}
        >
          取消
        </Button>
      </CardFooter>
    </Card>
  );
}
```

## 🗂️ 实施计划

### Phase 1: 基础权限检查（Week 1-2）

**目标**：确保 AI 助手不会绕过基本权限

**任务**：
- [ ] 1.1 创建 PermissionChecker 服务
  - Space 成员权限检查
  - 数据产品访问权限检查
- [ ] 1.2 在 MDOP Tools 中集成权限检查
  - submit_external_control 前置检查
  - 无权限时返回友好错误
- [ ] 1.3 添加 check_data_access Tool
  - 供 Agent 主动检查权限
- [ ] 1.4 更新 System Prompt
  - 添加权限检查指南
- [ ] 1.5 单元测试
  - 权限检查逻辑
  - 错误处理

**验收标准**：
- ✅ 用户必须是 Space Member 才能使用 AI 助手
- ✅ 用户必须有数据产品访问权限
- ✅ 无权限时显示清晰的错误信息

### Phase 2: 合约状态查询（Week 3-4）

**目标**：Agent 能够查询和展示合约状态

**任务**：
- [ ] 2.1 创建 ContractChecker 服务
  - 查询两方之间的合约
  - 判断合约有效性
- [ ] 2.2 添加 check_contract_status Tool
  - 返回合约 ID、状态、有效期
- [ ] 2.3 更新 System Prompt
  - 先检查合约，再配置任务
- [ ] 2.4 添加合约信息展示
  - 在任务配置前展示现有合约
- [ ] 2.5 集成测试
  - 有合约 → 直接配置
  - 无合约 → 提示需要合约

**验收标准**：
- ✅ Agent 在配置前检查合约状态
- ✅ 有合约时显示合约信息
- ✅ 无合约时提示用户

### Phase 3: 自动创建合约（Week 5-7）

**目标**：支持自动创建临时合约（需用户确认）

**任务**：
- [ ] 3.1 创建 ComplianceOrchestrator
  - checkPrerequisites 编排逻辑
  - 判断是否可自动创建合约
- [ ] 3.2 添加 create_contract_draft Tool
  - 创建合约草稿
  - 返回草稿 ID
- [ ] 3.3 添加 activate_contract Tool
  - 激活合约
  - 记录审计日志
- [ ] 3.4 实现 ContractApprovalCard
  - 展示合约详情
  - 用户确认按钮
- [ ] 3.5 更新 CardRenderer
  - 支持 contract_approval 类型
- [ ] 3.6 更新 System Prompt
  - 合约创建流程指南
- [ ] 3.7 集成测试
  - 完整的合约创建流程

**验收标准**：
- ✅ 无合约时自动创建草稿
- ✅ 用户确认后激活合约
- ✅ 合约信息完整展示
- ✅ 审计日志记录完整

### Phase 4: 合约审批流程（Week 8-10）

**目标**：支持需要管理员审批的合约请求

**任务**：
- [ ] 4.1 实现 ContractRequestCard
  - 展示合约申请信息
  - 联系管理员提示
- [ ] 4.2 创建合约审批通知
  - 通知管理员有新合约申请
  - 邮件/站内信
- [ ] 4.3 管理员审批界面
  - 合约申请列表
  - 审批/拒绝操作
- [ ] 4.4 审批状态跟踪
  - 用户可查询审批进度
  - Agent 可提示审批状态
- [ ] 4.5 完整流程测试
  - 申请 → 审批 → 激活 → 任务配置

**验收标准**：
- ✅ 需审批时创建申请
- ✅ 管理员收到通知
- ✅ 审批后用户可继续配置任务
- ✅ 拒绝时用户收到说明

### Phase 5: 审计与监控（Week 11-12）

**目标**：完整的审计追踪和监控

**任务**：
- [ ] 5.1 审计日志扩展
  - 记录所有合约操作
  - 记录权限检查结果
  - 记录任务提交（含合约 ID）
- [ ] 5.2 监控指标
  - 合约创建成功率
  - 权限拒绝次数
  - 任务提交成功率（按合约状态分类）
- [ ] 5.3 审计报表
  - 合约使用统计
  - 数据访问审计
- [ ] 5.4 合规报告导出
  - 按时间段导出审计日志
  - CSV/PDF 格式

**验收标准**：
- ✅ 所有操作可追溯
- ✅ 监控指标完整
- ✅ 审计报告可导出

### Phase 6: E2E 测试更新（Week 13-14）

**目标**：更新演示流程，展示完整合规流程

**任务**：
- [ ] 6.1 更新 E2E 测试脚本
  - 添加合约审批步骤
  - 验证合约创建
- [ ] 6.2 新增测试场景
  - 有合约的快速流程
  - 无合约的完整流程
  - 权限不足的拒绝流程
- [ ] 6.3 更新文档
  - 完整流程说明
  - 截图更新
- [ ] 6.4 演示视频录制
  - 完整流程演示
  - 各种边界情况

**验收标准**：
- ✅ E2E 测试覆盖完整流程
- ✅ 文档更新完整
- ✅ 演示效果清晰

## 📊 里程碑

| 里程碑 | 完成时间 | 主要交付 |
|--------|----------|----------|
| M1: 权限检查 | Week 2 | 基本权限验证 |
| M2: 合约查询 | Week 4 | Agent 可查询合约 |
| M3: 自动创建合约 | Week 7 | 支持临时合约 |
| M4: 审批流程 | Week 10 | 完整审批流程 |
| M5: 审计监控 | Week 12 | 审计追踪完整 |
| M6: 生产就绪 | Week 14 | E2E 测试完整 |

## 🎯 成功指标

### 功能指标
- ✅ 100% 的任务提交都有关联合约
- ✅ 权限检查覆盖率 100%
- ✅ 合约创建成功率 > 95%
- ✅ 审批响应时间 < 24 小时

### 体验指标
- ✅ 有合约时：3 步完成任务配置
- ✅ 无合约但可自动创建：5 步完成
- ✅ 需审批：明确告知等待时长

### 合规指标
- ✅ 审计日志覆盖率 100%
- ✅ 数据访问可追溯
- ✅ 合约有效期管理

## 🔒 风险与缓解

### 风险 1: 流程变复杂，用户体验下降
**缓解**：
- 智能判断，能自动化的不让用户操作
- 清晰的进度提示
- 预创建常用合约模板

### 风险 2: 合约审批延迟
**缓解**：
- 支持自动审批（互信伙伴）
- 审批 SLA 监控
- 紧急情况的快速通道

### 风险 3: 权限模型复杂
**缓解**：
- 分层权限设计
- 默认最小权限
- 清晰的错误提示

### 风险 4: 与现有系统集成
**缓解**：
- 复用现有 Contract Service
- 复用现有 Space Kernel
- 逐步迁移，不破坏现有流程

## 📚 相关文档

- [AI Chat Agent 设计](../../../../openspec/changes/ai-chat-agent/design.md)
- [合约服务 API](../../../api/src/contracts/)
- [Space Kernel 权限模型](../../../packages/space-kernel/docs/permissions.md)
- [审计日志规范](../../../docs/audit-log-spec.md)
- [2026-10-17 统一入口、角色助手与场景化合约预检计划 TODOLIST](./plans/2026-10-17-contract-preflight-implementation-todolist.md)

---

**创建日期**: 2024-10-16
**维护者**: MedTrust AI Chat Team
**状态**: Draft - 待审核
