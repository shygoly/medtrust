# 协议 v0.3 验收清单

## 1. 协议文档 ✅

- [x] 核心章节完整（§7.6 安全聚合、§7.7 密文路由、§8.4 拒绝消息、§11 错误码）
- [x] 密文大小上限明确（100 MB 缺省）
- [x] 治理文档校验通过（`check-meta-docs` 0 error）

验证：
```bash
node scripts/check-meta-docs.mjs
# 输出：0 error(s)
```

## 2. 协议核心扩展（packages/mdop）✅

### 2.1 聚合阶段 schema
- [x] `AggregateStageSpec` / `AggregateRequest` / `AggregateResponse`（`packages/mdop/src/schema/aggregate.ts`）
- [x] 解析器与校验器（`parseAggregateBinding`）

### 2.2 算子 kind 枚举
- [x] `OPERATOR_KINDS` 补充 `secure_aggregate`（`packages/mdop/src/schema/operator.ts:24`）

### 2.3 标签传播规则
- [x] C1→C3 固定路径（`packages/mdop/src/label/lattice.ts:235-240`）

### 2.4 错误码
- [x] `E_PAYLOAD_TOO_LARGE` / `E_DECRYPTION_FAILED` / `E_INVALID_CONTRIBUTION`
- [x] 可重试标记与描述文本（`packages/mdop/src/errors.ts`）

## 3. 平台侧密文路由（apps/api）✅

### 3.1 聚合控制器
- [x] `POST /mdop/aggregate/contributions` 上传密文（`apps/api/src/mdop/aggregate/aggregate.controller.ts`）
- [x] `GET /mdop/aggregate/contributions/:ref` 下载密文
- [x] 密文大小上限校验（`MDOP_MAX_CONTRIBUTION_SIZE`）

### 3.2 存储层
- [x] `MdopAggregateContribution` 实体（`apps/api/src/mdop/aggregate/mdop-aggregate-contribution.entity.ts`）
- [x] 数据库迁移（`cp_mdop_aggregate_contribution` 表）

### 3.3 调度器集成
- [x] `AggregateSchedulerService` 分发 contribution_refs（`apps/api/src/mdop/scheduler/aggregate-scheduler.service.ts`）

## 4. 连接器侧执行器（apps/connector）✅

### 4.1 聚合处理器
- [x] `createSecureAggregateHandler`（`apps/connector/src/mdop/aggregation/handler.ts`）
- [x] 注册到 `MdopStageExecutor`

### 4.2 密码学原语
- [x] `sealContribution`：各方公钥加密（`apps/connector/src/mdop/aggregation/ciphertext.ts`）
- [x] `openOwnShare`：本节点私钥解密
- [x] `fedAvg`：样本数加权聚合
- [x] 解密失败返回 `E_DECRYPTION_FAILED` / `E_INVALID_CONTRIBUTION`

### 4.3 平台通道
- [x] `httpAggregateClient` 上传/下载密文（`apps/connector/src/mdop/aggregation/channel.ts`）

## 5. 端到端测试 ✅

- [x] 各方公钥加密后只有对应私钥能解开（`apps/connector/src/mdop/aggregation/aggregation.spec.ts`）
- [x] 两方贡献按样本量加权聚合成 C3
- [x] 解密失败拒绝并记审计
- [x] 密文格式不符返回 `E_INVALID_CONTRIBUTION`
- [x] 密文里缺少本节点份额返回 `E_INVALID_CONTRIBUTION`
- [x] 未注册 `secure_aggregate` 时拒绝执行
- [x] 上传和下载走平台聚合端点

验证：
```bash
pnpm --filter @medtrust/connector test -- aggregation.spec
# 输出：7 passed
```

## 6. 治理文档同步 ✅

### 6.1 DEPLOY.md
- [x] `MDOP_MAX_CONTRIBUTION_SIZE` 环境变量登记（缺省 100 MB）

### 6.2 DOMAIN.md
- [x] `cp_mdop_aggregate_contribution` 表覆盖说明（第 250 行）
- [x] 聚合阶段与密文贡献状态词汇（第 276-278 行）

### 6.3 ARCHITECTURE.md
- [x] 协议 v0.3 节点间安全聚合描述（第 157 行）

### 6.4 DECISIONS.md
- [x] D-MDOP-8 决策记录（FL 家族采用安全聚合）

## 7. 验收标准

### 7.1 功能完整性
- [x] 节点能上传加密贡献到平台
- [x] 节点能下载其他方密文并解开自己的份额
- [x] 聚合算子产出 C3 标签数据
- [x] 解密失败时拒绝并返回明确错误码

### 7.2 安全性
- [x] 平台只存密文 blob，看不到明文
- [x] 各方只能解密自己的份额
- [x] 密文大小有上限（防 DoS）
- [x] 错误码不泄露本地策略细节

### 7.3 可观测性
- [x] 解密失败记入审计日志
- [x] 错误码区分格式错误 vs 解密失败

### 7.4 向后兼容
- [x] 不含 `secure_aggregate` 的作业仍按协议 v0.2 执行
- [x] 旧错误码（`E_RUNTIME` 等）仍有效

## 8. 遗留事项

### 8.1 性能优化（非阻塞）
- [ ] 并行下载多个密文贡献
- [ ] 密文压缩（当前 base64 膨胀 33%）

### 8.2 运维增强（非阻塞）
- [ ] 密文贡献 TTL 与垃圾回收
- [ ] 聚合失败时的诊断指标

## 9. 签署

**协议 v0.3 已完成核心功能，通过端到端测试，满足验收标准。**

完成日期：2026-10-15  
验收人：Claude Opus 5
