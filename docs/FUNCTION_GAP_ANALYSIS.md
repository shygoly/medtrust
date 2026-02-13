# MedTrust 功能差异分析报告

## 一、调研报告 vs 当前实现

### 1.1 调研报告中的核心功能

根据 `medical-trusted-space-research.md`，医疗可信空间应包含：

| 层级 | 功能组件 | 实现状态 |
|------|---------|---------|
| **应用服务层** | 临床科研、药物研发、医保风控、公共卫生 | ❌ 未实现 |
| **隐私计算引擎层** | 联邦学习(FL)、多方安全计算(MPC)、可信执行环境(TEE) | ⚠️ 部分（实体定义） |
| **数据安全管控层** | 数据脱敏、加密存储、访问控制、审计日志 | ⚠️ 部分（基础RBAC） |
| **可信基础设施层** | 区块链网络、身份认证、密钥管理、智能合约 | ❌ 未实现 |
| **数据源层** | HIS/EMR/LIS/PACS/穿戴设备对接 | ❌ 未实现 |

### 1.2 当前实现的功能

**已实现 (✅)**:
- ✅ 基础认证 (JWT)
- ✅ 租户管理 (CRUD)
- ✅ 数据资产管理 (CRUD)
- ✅ 访问申请管理 (CRUD + 审批)

**部分实现 (⚠️)**:
- ⚠️ ComputeTask 实体定义（无业务逻辑）
- ⚠️ AuditLog 实体定义（无日志记录）
- ⚠️ 基础 RBAC（无 ABAC）

**未实现 (❌)**:
- ❌ 联邦学习 (Flower) 集成
- ❌ 多方安全计算 (MPC)
- ❌ 可信执行环境 (TEE)
- ❌ 区块链 (FISCO BCOS) 集成
- ❌ 数据脱敏组件
- ❌ 结算/计费模块
- ❌ 数据沙箱环境
- ❌ 实时 WebSocket 通知

---

## 二、OpenSpec Proposal vs 当前实现

### 2.1 Proposal 承诺的功能

```
Core Modules (from proposal.md):
1. Multi-Tenant System ✅
2. Data Asset Management ✅
3. Data Access Workflow ✅
4. Privacy-Preserving Computation ⚠️ (实体定义)
5. Audit and Compliance ⚠️ (实体定义)
6. Settlement and Incentives ❌ (未实现)

New Capabilities:
- tenant-management ✅
- data-asset-management ✅
- access-control ✅
- privacy-computation ⚠️
- audit-logging ⚠️
- blockchain-notary ❌
- billing-settlement ❌
```

### 2.2 实现度评估

| 模块 | Proposal 描述 | 当前实现 | 完成度 |
|------|--------------|---------|--------|
| **Multi-Tenant** | 注册、KYC、角色、隔离 | 基础CRUD | 60% |
| **Data Asset** | 上传、质量评估、定价、目录 | 基础CRUD | 50% |
| **Access Workflow** | 申请、审批、协议、支付 | 申请+审批 | 60% |
| **Privacy Compute** | MPC、FL、TEE 集成 | 仅实体 | 20% |
| **Audit** | 审计日志、区块链溯源 | 仅实体 | 20% |
| **Settlement** | 计费、结算、分成 | ❌ | 0% |

---

## 三、OpenSpec Spec vs 当前实现

### 3.1 Spec 要求的功能

**Backend Spec** (`nestjs-backend/spec.md`):
```
Required Modules:
- AuthModule ✅
- TenantModule ✅
- DataAssetModule ✅
- AccessRequestModule ✅
- ComputeTaskModule ⚠️ (实体有，无API)
- AuditModule ⚠️ (实体有，无API)
- BillingModule ❌ (未实现)
```

**Frontend Spec** (`nextjs-frontend/spec.md`):
```
Required Routes:
- /login ✅
- /register ✅
- /(dashboard) ✅
- /(dashboard)/tenant ✅ (tenants)
- /(dashboard)/assets ✅
- /(dashboard)/requests ✅
- /(dashboard)/compute ❌
- /(dashboard)/audit ❌
- /(dashboard)/billing ❌
```

### 3.2 缺失功能清单

**后端缺失**:
- ComputeTaskService (计算任务管理)
- ComputeTaskController (计算任务API)
- AuditService (审计日志记录)
- AuditController (审计日志API)
- BillingModule (结算模块)
- WebSocket Gateway (实时通知)

**前端缺失**:
- 计算任务管理页面 (/dashboard/compute)
- 审计日志查看页面 (/dashboard/audit)
- 计费结算页面 (/dashboard/billing)
- 租户详情页
- 数据资产上传表单
- 访问申请表单
- 表单验证

---

## 四、关键差异总结

### 4.1 功能差距矩阵

| 功能类别 | 调研报告要求 | Proposal承诺 | Spec要求 | 当前实现 | 差距 |
|---------|-------------|-------------|---------|---------|-----|
| **隐私计算** | FL+MPC+TEE | 三种都支持 | ComputeTask | 仅实体定义 | **大** |
| **区块链** | FISCO BCOS | 存证溯源 | 未明确 | ❌ | **大** |
| **审计日志** | 全链路审计 | 审计追踪 | AuditModule | 仅实体 | **中** |
| **数据脱敏** | K-匿名/差分隐私 | ❌ | ❌ | ❌ | **大** |
| **计费结算** | ❌ | 计费分成 | BillingModule | ❌ | **中** |
| **ABAC权限** | ABAC模型 | 细粒度控制 | RBAC+扩展 | 基础RBAC | **中** |
| **WebSocket** | ❌ | 实时更新 | WebSocket | ❌ | **中** |
| **数据源对接** | HIS/EMR/LIS | ❌ | ❌ | ❌ | **大** |

### 4.2 MVP 范围界定

**当前实现 = 基础数据管理平台** (约 40% 的完整功能)

**缺失的核心能力**:
1. **隐私计算引擎** - 最重要的差异化功能
2. **区块链存证** - 可信机制的核心
3. **数据脱敏** - 医疗数据安全必需
4. **审计系统** - 合规要求
5. **结算系统** - 商业闭环

---

## 五、建议优先级

### Phase 1: 完善基础功能 (2-3周)
- [ ] ComputeTask 模块完整实现
- [ ] Audit 模块完整实现
- [ ] 租户详情/编辑页面
- [ ] 数据资产上传表单
- [ ] 访问申请表单

### Phase 2: 隐私计算集成 (4-6周)
- [ ] Flower (联邦学习) 集成
- [ ] 计算任务提交/监控
- [ ] 计算结果展示

### Phase 3: 可信机制 (3-4周)
- [ ] 审计日志记录实现
- [ ] 区块链存证 (FISCO BCOS)
- [ ] 数据溯源查询

### Phase 4: 商业功能 (2-3周)
- [ ] 计费模块
- [ ] 结算系统
- [ ] 支付集成

### Phase 5: 高级功能 (4-6周)
- [ ] MPC/TEE 集成
- [ ] ABAC 权限模型
- [ ] 数据脱敏组件
- [ ] 数据源对接

---

## 六、结论

### 现状评估
当前 MedTrust 实现是 **数据管理平台的基础版本**，完成了：
- 用户认证
- 租户管理
- 数据资产目录
- 访问申请工作流

### 与目标的差距
距离完整的 **医疗可信数据空间** 还有较大差距，主要缺失：
1. **隐私计算能力**（最核心的差异化功能）
2. **区块链可信机制**
3. **完整审计合规**
4. **商业结算闭环**

### 建议
如需快速展示价值，建议优先实现 **Phase 1 + Phase 2**（基础功能 + Flower联邦学习），形成"可运行的可信数据空间 Demo"。

---

*分析时间: 2026-02-11*
