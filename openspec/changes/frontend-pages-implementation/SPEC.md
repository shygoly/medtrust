# 前端页面功能完善

## 背景

当前部署的 MedTrust Lite 版本虽然已经包含了基本的前端界面框架，但各功能页面的数据是静态写死的，缺乏与后端 API 的真实数据交互。本变更旨在完善仪表板、机构入驻、数据资产、申请审批、区块链存证等核心功能页面，实现真实的数据展示和交互。

## 目标

1. **仪表板**: 对接 API 获取实时统计数据
2. **机构入驻**: 实现机构列表和详情展示
3. **数据资产**: 实现资产列表、详情、申请功能
4. **申请审批**: 实现审批工作流的可视化操作
5. **区块链存证**: 对接真实 FISCO BCOS 查询

## 技术方案

### API 端点

```typescript
// 统计
GET /api/stats                    // 获取平台统计数据

// 机构
GET /api/tenants                  // 获取机构列表
GET /api/tenants/:id              // 获取机构详情
POST /api/tenants                 // 机构入驻申请

// 数据资产
GET /api/assets                   // 获取资产列表
GET /api/assets/:id               // 获取资产详情
POST /api/assets                  // 上架资产
POST /api/assets/:id/apply        // 申请使用资产

// 申请审批
GET /api/access-requests          // 获取申请列表
GET /api/access-requests/:id      // 获取申请详情
POST /api/access-requests         // 提交申请
PUT /api/access-requests/:id/approve  // 审批申请

// 区块链
GET /api/blockchain/stats         // 获取链上统计
GET /api/blockchain/blocks        // 获取区块列表
GET /api/blockchain/blocks/:number    // 获取区块详情
GET /api/blockchain/transactions/:hash  // 查询交易
POST /api/blockchain/verify       // 验证存证
```

### 页面功能清单

#### 1. 仪表板页面
- [ ] 统计数据实时刷新
- [ ] 数据资产趋势图表
- [ ] 计算任务状态监控
- [ ] 最近活动日志

#### 2. 机构入驻页面
- [ ] 机构列表分页
- [ ] 机构详情弹窗
- [ ] 入驻申请表单
- [ ] 审核状态追踪

#### 3. 数据资产页面
- [ ] 资产列表筛选（按类型、提供方）
- [ ] 资产详情页
- [ ] 数据Schema展示
- [ ] 申请使用表单

#### 4. 申请审批页面
- [ ] 申请列表（按状态筛选）
- [ ] 审批详情页
- [ ] 三级审批流程可视化
- [ ] 审批操作按钮

#### 5. 区块链存证页面
- [ ] 链上统计数据
- [ ] 区块浏览器
- [ ] 交易查询
- [ ] 存证验证

## 数据模型

```typescript
// 机构
interface Tenant {
  id: number;
  name: string;
  type: 'provider' | 'consumer' | 'regulator';
  description: string;
  level: string;           // 医院等级
  securityLevel: number;   // 等保等级
  status: 'pending' | 'verified' | 'rejected';
  verifiedAt: string;
  contactInfo: {
    name: string;
    phone: string;
    email: string;
  };
}

// 数据资产
interface DataAsset {
  id: number;
  tenantId: number;
  tenant: Tenant;
  name: string;
  type: 'EMR' | 'IMAGING' | 'LAB' | 'GENOMIC' | 'PRESCRIPTION' | 'FOLLOWUP';
  description: string;
  recordCount: number;
  price: number;
  level: 'L1' | 'L2' | 'L3' | 'L4';
  status: 'draft' | 'reviewing' | 'published' | 'offline';
  schema: DataSchema;
  usagePolicy: UsagePolicy;
  publishedAt: string;
}

// 申请
interface AccessRequest {
  id: string;
  requesterId: number;
  requester: Tenant;
  assetId: number;
  asset: DataAsset;
  purpose: string;
  expectedDuration: number;
  status: 'pending' | 'platform_approved' | 'hospital_approved' | 'regulator_approved' | 'rejected' | 'completed';
  approvals: Approval[];
  createdAt: string;
}

// 审批记录
interface Approval {
  level: 'platform' | 'hospital' | 'regulator';
  approverId: number;
  status: 'pending' | 'approved' | 'rejected';
  comment: string;
  approvedAt: string;
}
```

## 实现计划

### Phase 1: API 完善
- [ ] 实现 `/api/stats` 端点
- [ ] 实现 `/api/tenants` 端点
- [ ] 实现 `/api/assets` 端点
- [ ] 实现 `/api/access-requests` 端点
- [ ] 实现 `/api/blockchain` 端点

### Phase 2: 仪表板完善
- [ ] 对接 stats API
- [ ] 添加数据可视化图表
- [ ] 实现实时刷新

### Phase 3: 机构管理
- [ ] 机构列表页面
- [ ] 机构详情弹窗
- [ ] 入驻申请表单

### Phase 4: 数据资产
- [ ] 资产列表筛选
- [ ] 资产详情页
- [ ] 申请使用流程

### Phase 5: 审批流程
- [ ] 申请列表
- [ ] 审批操作
- [ ] 流程可视化

### Phase 6: 区块链
- [ ] 区块浏览器
- [ ] 交易查询
- [ ] 存证验证

## 验收标准

- [ ] 所有页面都能加载真实数据
- [ ] 数据加载有 loading 状态
- [ ] 操作有成功/失败提示
- [ ] 错误有友好提示
- [ ] 移动端适配良好

## 相关文件

- `fly-services/lite/web/index.html` - 前端页面
- `fly-services/lite/Dockerfile.api` - API 服务
- `openspec/changes/research-compliance-integration/SPEC.md` - 合规流程设计
