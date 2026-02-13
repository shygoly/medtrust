# MedTrust 开发任务清单

## 任务总览

基于功能差异分析，将剩余功能分解为可管理的开发任务。

---

## Phase 1: 完善基础功能 (优先级: P0)

### Task 1.1: ComputeTask 模块完整实现
- [x] 创建 ComputeTask Entity
- [x] 创建 ComputeTaskService (CRUD + 状态管理)
- [x] 创建 ComputeTaskController (REST API)
- [x] 创建计算任务状态机 (pending -> running -> completed/failed)
- [x] 添加任务结果存储
**Status**: `completed`
**Assignee**: manual
**Estimate**: 2h
**Completed**: 2026-02-11

### Task 1.2: Audit 模块完整实现
- [x] 创建 AuditService (日志记录)
- [x] 创建 AuditController (查询API)
- [x] 实现操作日志自动记录 (Interceptor)
- [x] 添加审计日志查询接口
**Status**: `completed`
**Assignee**: manual
**Estimate**: 2h
**Completed**: 2026-02-11

### Task 1.3: 前端表单页面
- [x] 创建租户新建页面
- [x] 创建租户详情/编辑页面 (简化版)
- [x] 创建计算任务列表页面
- [x] 创建审计日志页面
**Status**: `completed`
**Assignee**: manual
**Estimate**: 3h
**Completed**: 2026-02-11

---

## Phase 2: 隐私计算集成 (优先级: P0)

### Task 2.1: Flower 联邦学习集成
- [ ] 设计 Flower 集成架构
- [ ] 创建 Flower 客户端配置
- [ ] 实现计算任务提交到 Flower
- [ ] 添加计算进度监控
**Status**: `pending`
**Assignee**: claude
**Estimate**: 4h

### Task 2.2: 计算任务管理页面
- [ ] 创建 /dashboard/compute 页面
- [ ] 计算任务列表展示
- [ ] 计算任务提交表单
- [ ] 计算结果展示
**Status**: `pending`
**Assignee**: claude
**Estimate**: 3h

---

## Phase 3: 可信机制 (优先级: P1)

### Task 3.1: 审计日志实现
- [ ] 审计日志记录中间件
- [ ] 审计日志查询页面 /dashboard/audit
- [ ] 日志导出功能
**Status**: `pending`
**Assignee**: claude
**Estimate**: 3h

### Task 3.2: 区块链存证 (FISCO BCOS)
- [ ] 设计区块链集成方案
- [ ] 实现数据哈希上链
- [ ] 添加存证查询接口
**Status**: `pending`
**Assignee**: claude
**Estimate**: 4h

---

## Phase 4: 商业功能 (优先级: P1)

### Task 4.1: 计费模块
- [ ] 创建 Billing Entity
- [ ] 创建 BillingService
- [ ] 创建 BillingController
- [ ] 实现用量统计
**Status**: `pending`
**Assignee**: claude
**Estimate**: 3h

### Task 4.2: 结算页面
- [ ] 创建 /dashboard/billing 页面
- [ ] 费用明细展示
- [ ] 账单导出
**Status**: `pending`
**Assignee**: claude
**Estimate**: 2h

---

## 任务统计

| Phase | 任务数 | 预估工时 | 状态 |
|-------|--------|---------|------|
| Phase 1 | 3 | 7h | ✅ 已完成 |
| Phase 2 | 2 | 7h | 待开发 |
| Phase 3 | 2 | 7h | ⚠️ 部分完成 |
| Phase 4 | 2 | 5h | 待开发 |
| **总计** | **9** | **26h** | 3/9 完成 |

---

## 开发顺序

1. **Task 1.1** → ComputeTask 模块 (后端)
2. **Task 1.2** → Audit 模块 (后端)
3. **Task 1.3** → 前端表单页面
4. **Task 2.1** → Flower 集成 (后端)
5. **Task 2.2** → 计算任务页面 (前端)
6. **Task 3.1** → 审计日志实现
7. **Task 3.2** → 区块链存证
8. **Task 4.1** → 计费模块
9. **Task 4.2** → 结算页面
