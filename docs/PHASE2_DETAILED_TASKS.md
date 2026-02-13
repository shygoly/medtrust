# MedTrust Phase 2 详细任务分解

## 任务总览

**目标**: 完成 Flower 联邦学习集成 + 计算任务管理页面
**预估工作量**: 7-9 小时
**涉及文件**: 40+ 个文件

---

## 第一部分：Flower 联邦学习后端集成

### 1.1 核心服务层 (Backend Service Layer)

| 序号 | 文件路径 | 功能描述 | 复杂度 | 依赖 |
|------|---------|---------|--------|------|
| 1.1.1 | `apps/api/src/flower/flower-client.service.ts` | Flower HTTP 客户端，管理连接池、超时、重试 | 高 | - |
| 1.1.2 | `apps/api/src/flower/flower-config.service.ts` | Flower 配置管理，支持多服务器配置 | 中 | 1.1.1 |
| 1.1.3 | `apps/api/src/flower/flower-task.service.ts` | 任务生命周期管理（提交→监控→完成） | 高 | 1.1.1, 1.1.2 |
| 1.1.4 | `apps/api/src/flower/flower-monitor.service.ts` | 实时任务状态监控，轮询+WebSocket | 高 | 1.1.1 |
| 1.1.5 | `apps/api/src/flower/flower-result.service.ts` | 结果获取、解析、存储到本地 | 中 | 1.1.1 |
| 1.1.6 | `apps/api/src/flower/flower-error.handler.ts` | Flower 错误分类和处理策略 | 中 | - |

**验收标准**:
- [ ] 能成功连接到 Flower 服务器 (http://localhost:8080)
- [ ] 支持任务提交、状态查询、结果获取完整流程
- [ ] 连接失败自动重试（最多3次）
- [ ] 任务状态变更自动更新到 ComputeTask 表

---

### 1.2 DTO 和类型定义 (DTOs & Types)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 1.2.1 | `apps/api/src/flower/dto/submit-fl-task.dto.ts` | 提交任务请求 DTO | 低 |
| 1.2.2 | `apps/api/src/flower/dto/fl-task-config.dto.ts` | 任务配置详细 DTO | 中 |
| 1.2.3 | `apps/api/src/flower/dto/fl-task-response.dto.ts` | 任务提交响应 DTO | 低 |
| 1.2.4 | `apps/api/src/flower/dto/fl-task-status.dto.ts` | 任务状态响应 DTO | 低 |
| 1.2.5 | `apps/api/src/flower/dto/fl-task-result.dto.ts` | 任务结果 DTO | 中 |
| 1.2.6 | `apps/api/src/flower/dto/update-fl-task.dto.ts` | 更新任务 DTO | 低 |
| 1.2.7 | `apps/api/src/flower/types/flower.types.ts` | Flower 类型定义（枚举、接口） | 低 |
| 1.2.8 | `apps/api/src/flower/types/fl-algorithm.types.ts` | 联邦学习算法类型定义 | 中 |

**验收标准**:
- [ ] 所有 DTO 都使用 class-validator 进行验证
- [ ] Swagger 文档自动生成
- [ ] 类型定义覆盖 Flower API 的所有响应格式

---

### 1.3 控制器层 (Controller Layer)

| 序号 | 文件路径 | 功能描述 | 复杂度 | 依赖 |
|------|---------|---------|--------|------|
| 1.3.1 | `apps/api/src/flower/flower.controller.ts` | 主要 REST API 控制器 | 中 | 1.1.x, 1.2.x |
| 1.3.2 | `apps/api/src/flower/flower-webhook.controller.ts` | Flower Webhook 回调处理 | 中 | 1.1.3 |
| 1.3.3 | `apps/api/src/flower/flower-health.controller.ts` | 健康检查和服务器状态 | 低 | 1.1.2 |

**API 端点清单**:
```
POST   /api/v1/flower/tasks              # 提交任务
GET    /api/v1/flower/tasks/:id         # 获取任务详情
GET    /api/v1/flower/tasks/:id/status  # 获取任务状态
GET    /api/v1/flower/tasks/:id/result  # 获取任务结果
POST   /api/v1/flower/tasks/:id/cancel  # 取消任务
POST   /api/v1/flower/webhook           # Flower 回调
GET    /api/v1/flower/health            # 健康检查
GET    /api/v1/flower/servers           # 服务器列表
```

**验收标准**:
- [ ] 所有端点都有 JWT 保护
- [ ] Swagger 文档完整
- [ ] 单元测试覆盖率 > 80%

---

### 1.4 模块和集成 (Module & Integration)

| 序号 | 文件路径 | 功能描述 | 复杂度 | 依赖 |
|------|---------|---------|--------|------|
| 1.4.1 | `apps/api/src/flower/flower.module.ts` | NestJS 模块定义 | 低 | 1.1.x, 1.3.x |
| 1.4.2 | `apps/api/src/compute-task/compute-task-flower.service.ts` | ComputeTask 与 Flower 集成 | 高 | 1.1.3 |
| 1.4.3 | `apps/api/src/compute-task/compute-task.processor.ts` | 任务队列处理器（BullMQ） | 高 | 1.4.2 |
| 1.4.4 | `apps/api/src/app.module.ts` 更新 | 添加 FlowerModule 导入 | 低 | 1.4.1 |

**验收标准**:
- [ ] FlowerModule 正确注册到 AppModule
- [ ] ComputeTask 创建时自动提交到 Flower
- [ ] 任务状态变更触发 WebSocket 通知

---

### 1.5 数据库和实体 (Database & Entities)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 1.5.1 | `packages/database/src/entities/flower-task.entity.ts` | Flower 任务实体扩展 | 中 |
| 1.5.2 | `packages/database/src/entities/flower-server.entity.ts` | Flower 服务器配置实体 | 中 |
| 1.5.3 | `packages/database/src/entities/flower-result.entity.ts` | 任务结果存储实体 | 中 |
| 1.5.4 | `packages/database/src/migrations/xxx-add-flower-tables.ts` | 数据库迁移脚本 | 中 |

**验收标准**:
- [ ] 实体关系正确（ComputeTask ↔ FlowerTask）
- [ ] 迁移脚本可正常执行
- [ ] 支持软删除和审计字段

---

### 1.6 配置和环境 (Configuration)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 1.6.1 | `apps/api/src/config/flower.config.ts` | Flower 配置定义 | 低 |
| 1.6.2 | `.env.example` 更新 | 添加 Flower 环境变量 | 低 |
| 1.6.3 | `apps/api/src/config/validation.ts` 更新 | 配置验证 schema | 低 |

**环境变量清单**:
```bash
# Flower 配置
FLOWER_SERVER_URL=http://localhost:8080
FLOWER_API_KEY=optional_api_key
FLOWER_REQUEST_TIMEOUT=30000
FLOWER_MAX_RETRIES=3
FLOWER_WEBHOOK_SECRET=webhook_secret_for_security
```

---

## 第二部分：计算任务管理前端

### 2.1 页面路由 (Pages)

| 序号 | 文件路径 | 功能描述 | 复杂度 | 依赖 |
|------|---------|---------|--------|------|
| 2.1.1 | `apps/web/src/app/(dashboard)/compute/page.tsx` | 计算任务列表页 | 高 | 2.2.1 |
| 2.1.2 | `apps/web/src/app/(dashboard)/compute/new/page.tsx` | 新建计算任务页 | 中 | 2.2.2 |
| 2.1.3 | `apps/web/src/app/(dashboard)/compute/[id]/page.tsx` | 任务详情页 | 高 | 2.2.4 |
| 2.1.4 | `apps/web/src/app/(dashboard)/compute/[id]/result/page.tsx` | 任务结果展示页 | 高 | 2.2.5 |

**验收标准**:
- [ ] 列表页支持分页、筛选、排序
- [ ] 新建页表单验证完整
- [ ] 详情页实时显示任务状态
- [ ] 结果页支持图表展示

---

### 2.2 组件层 (Components)

| 序号 | 文件路径 | 功能描述 | 复杂度 | 依赖 |
|------|---------|---------|--------|------|
| 2.2.1 | `apps/web/src/components/compute/task-list-table.tsx` | 任务列表表格组件 | 中 | - |
| 2.2.2 | `apps/web/src/components/compute/task-create-form.tsx` | 任务创建表单 | 高 | - |
| 2.2.3 | `apps/web/src/components/compute/task-status-badge.tsx` | 状态标签组件 | 低 | - |
| 2.2.4 | `apps/web/src/components/compute/task-detail-card.tsx` | 任务详情卡片 | 中 | 2.2.3 |
| 2.2.5 | `apps/web/src/components/compute/task-result-viewer.tsx` | 结果展示组件 | 高 | - |
| 2.2.6 | `apps/web/src/components/compute/task-progress-bar.tsx` | 进度条组件 | 中 | - |
| 2.2.7 | `apps/web/src/components/compute/task-filter-panel.tsx` | 筛选面板 | 中 | - |
| 2.2.8 | `apps/web/src/components/compute/task-action-menu.tsx` | 操作菜单（取消/重试） | 低 | - |
| 2.2.9 | `apps/web/src/components/compute/fl-algorithm-selector.tsx` | 联邦学习算法选择器 | 中 | - |
| 2.2.10 | `apps/web/src/components/compute/fl-config-form.tsx` | FL 配置表单 | 高 | - |

**验收标准**:
- [ ] 所有组件都有 TypeScript 类型定义
- [ ] 组件支持 dark mode
- [ ] 移动端响应式适配

---

### 2.3 Hooks 和状态管理 (Hooks & State)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 2.3.1 | `apps/web/src/hooks/use-compute-tasks.ts` | 计算任务列表管理 | 中 |
| 2.3.2 | `apps/web/src/hooks/use-compute-task.ts` | 单个任务详情管理 | 中 |
| 2.3.3 | `apps/web/src/hooks/use-task-websocket.ts` | WebSocket 实时状态 | 高 |
| 2.3.4 | `apps/web/src/hooks/use-task-submission.ts` | 任务提交流程 | 中 |
| 2.3.5 | `apps/web/src/hooks/use-task-result.ts` | 结果获取和缓存 | 中 |
| 2.3.6 | `apps/web/src/hooks/use-flower-servers.ts` | Flower 服务器列表 | 低 |

**验收标准**:
- [ ] Hooks 支持 loading/error 状态
- [ ] WebSocket 自动重连
- [ ] 缓存策略合理（SWR）

---

### 2.4 API 客户端 (API Client)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 2.4.1 | `apps/web/src/api/compute-task.api.ts` | 计算任务 API 封装 | 中 |
| 2.4.2 | `apps/web/src/api/flower.api.ts` | Flower 相关 API 封装 | 中 |
| 2.4.3 | `apps/web/src/api/websocket.ts` | WebSocket 连接管理 | 高 |
| 2.4.4 | `apps/web/src/api/client.ts` 更新 | 添加新 API 方法 | 低 |

**API 方法清单**:
```typescript
// compute-task.api.ts
getComputeTasks(params: QueryParams): Promise<PaginatedResult<ComputeTask>>
getComputeTask(id: string): Promise<ComputeTask>
createComputeTask(data: CreateTaskData): Promise<ComputeTask>
cancelComputeTask(id: string): Promise<void>
getTaskResult(id: string): Promise<TaskResult>

// flower.api.ts
getFlowerServers(): Promise<FlowerServer[]>
getFlowerHealth(serverId: string): Promise<HealthStatus>
submitFLTask(data: FLTaskData): Promise<FLTaskResponse>
```

---

### 2.5 类型定义 (Types)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 2.5.1 | `apps/web/src/types/compute-task.types.ts` | 计算任务类型 | 低 |
| 2.5.2 | `apps/web/src/types/flower.types.ts` | Flower 相关类型 | 低 |
| 2.5.3 | `apps/web/src/types/task-status.types.ts` | 任务状态枚举 | 低 |
| 2.5.4 | `apps/web/src/types/task-result.types.ts` | 任务结果类型 | 中 |

---

### 2.6 导航和布局 (Navigation & Layout)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 2.6.1 | `apps/web/src/app/(dashboard)/layout.tsx` 更新 | 添加计算任务导航 | 低 |
| 2.6.2 | `apps/web/src/components/nav/compute-nav.tsx` | 计算任务子导航 | 低 |
| 2.6.3 | `apps/web/src/components/breadcrumb/compute-breadcrumb.tsx` | 面包屑导航 | 低 |

---

## 第三部分：测试和文档

### 3.1 后端测试 (Backend Tests)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 3.1.1 | `apps/api/src/flower/__tests__/flower.service.spec.ts` | Flower 服务单元测试 | 高 |
| 3.1.2 | `apps/api/src/flower/__tests__/flower.controller.spec.ts` | Controller 单元测试 | 中 |
| 3.1.3 | `apps/api/test/flower.e2e-spec.ts` | E2E 测试 | 高 |
| 3.1.4 | `apps/api/src/flower/__mocks__/flower-server.mock.ts` | Flower 服务器 mock | 中 |

**验收标准**:
- [ ] 单元测试覆盖率 > 80%
- [ ] E2E 测试覆盖主要流程
- [ ] Mock 服务器支持离线测试

---

### 3.2 前端测试 (Frontend Tests)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 3.2.1 | `apps/web/src/components/compute/__tests__/task-list-table.test.tsx` | 列表表格测试 | 中 |
| 3.2.2 | `apps/web/src/components/compute/__tests__/task-create-form.test.tsx` | 创建表单测试 | 中 |
| 3.2.3 | `apps/web/src/hooks/__tests__/use-compute-tasks.test.ts` | Hooks 测试 | 高 |
| 3.2.4 | `apps/web/src/mocks/handlers.ts` 更新 | MSW mock handlers | 中 |

---

### 3.3 文档 (Documentation)

| 序号 | 文件路径 | 功能描述 | 复杂度 |
|------|---------|---------|--------|
| 3.3.1 | `docs/flower-integration-guide.md` | Flower 集成指南 | 中 |
| 3.3.2 | `docs/compute-task-api.md` | 计算任务 API 文档 | 低 |
| 3.3.3 | `docs/flower-deployment.md` | Flower 部署文档 | 中 |
| 3.3.4 | `README.md` 更新 | 项目 README 更新 | 低 |

---

## 开发顺序和依赖关系

```
第一阶段：基础设施 (并行)
├── 1.1.1  Flower HTTP 客户端
├── 1.2.x  DTO 和类型定义
├── 1.5.x  数据库实体
├── 1.6.x  配置文件
└── 2.5.x  前端类型定义

第二阶段：核心服务 (依赖第一阶段)
├── 1.1.2  Flower 配置服务
├── 1.1.3  Flower 任务服务
├── 1.1.4  监控服务
├── 1.4.1  Flower 模块
└── 2.4.x  API 客户端

第三阶段：API 和页面 (依赖第二阶段)
├── 1.3.x  控制器
├── 1.4.2  ComputeTask 集成
├── 2.1.x  页面
├── 2.2.x  组件
└── 2.3.x  Hooks

第四阶段：集成和测试 (依赖第三阶段)
├── 1.4.3  队列处理器
├── 2.3.3  WebSocket
├── 2.6.x  导航
├── 3.1.x  后端测试
├── 3.2.x  前端测试
└── 3.3.x  文档
```

---

## 工作量估算

| 阶段 | 任务数 | 预估工时 | 负责人 |
|------|--------|---------|--------|
| 第一阶段 | 11 | 2.5h | Backend Agent |
| 第二阶段 | 7 | 2h | Backend Agent |
| 第三阶段 | 20 | 3.5h | Frontend Agent |
| 第四阶段 | 11 | 2h | Test Agent |
| **总计** | **49** | **10h** | - |

---

## 验收清单

### 功能验收
- [ ] 能成功提交联邦学习任务到 Flower
- [ ] 任务状态实时更新（WebSocket）
- [ ] 任务结果正确展示
- [ ] 支持任务取消操作
- [ ] 支持多 Flower 服务器配置

### 技术验收
- [ ] 单元测试覆盖率 > 80%
- [ ] E2E 测试通过
- [ ] TypeScript 类型完整
- [ ] Swagger 文档完整
- [ ] 无 ESLint 错误

### 性能验收
- [ ] API 响应时间 < 500ms
- [ ] 页面首屏加载 < 2s
- [ ] WebSocket 重连 < 3s

---

## 风险和对策

| 风险 | 可能性 | 影响 | 对策 |
|------|--------|------|------|
| Flower 服务器不可用 | 中 | 高 | 提供 mock 服务器，支持离线开发 |
| WebSocket 不稳定 | 中 | 中 | 实现自动重连和降级到轮询 |
| 任务状态同步延迟 | 低 | 高 | 使用 BullMQ 队列，确保可靠性 |
| 大数据量结果加载慢 | 中 | 中 | 结果分页加载，支持导出 |
