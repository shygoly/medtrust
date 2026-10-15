# 任务：MDOP 协议 v0.3 节点间安全聚合扩展

> 每个任务组按 proposal/design 的顺序收口；协议文档先行、schema 次之、平台与连接器实现并行、
> 应用链路（LoRA）最后。本变更只做协议与基础设施，LoRA 迁移属 `mdop-fl-migration` 批次 1B。

## 1. 治理与协议文档

- [x] 1.1 DECISIONS.md 补充：
  - D-MDOP-1 补注：partial 参与语义（MDOP 任一方未回执 = 整个作业 REJECTED，与旧管线互斥）
  - D-MDOP-8 补注：本变更落地节点间安全聚合的协议层，应用留给批次 1B
  - 引用关系：本变更实现 D-MDOP-8:1321-1323 的协议前置
- [x] 1.2 协议 v0.3 修订稿（`docs/医疗数据跨节点算子编排协议规范（MDOP）v0.3.md`）：
  - 开头修订说明表：v0.2 → v0.3 的改动清单（聚合阶段、算子 kind、partial 语义、节点间通道）
  - 新增 §7 节点间安全聚合：聚合阶段定义、三种消息（AggregateRequest / Contribution / Result）、状态机、超时规则
  - 算子 kind 扩展：补充 `system.secure_aggregate`（与 wasm/oci/system 并列）
  - 标签传播规则补充：`secure_aggregate` 的 C1 → C3 路径
  - partial 参与语义显式定义：任一方未回执 = 不进入合并（与旧管线区分）
  - 节点间通道：写明密文中继模式（平台搬运密文引用，不见明文）
- [x] 1.3 `node scripts/check-meta-docs.mjs` 为 0 error

## 2. 协议核心扩展（`packages/mdop`）

- [x] 2.1 聚合阶段 schema：
  - `AggregateStageSpec`（聚合算法、参与方列表、超时）
  - `AggregateRequest` / `AggregateContribution` / `AggregateResult` 消息类型
  - 消息信封的 `msg_type` 枚举补充聚合三型
- [x] 2.2 算子清单扩展：
  - `OperatorManifest` 的 `kind` 补充 `"secure_aggregate"`（与 `"wasm"` / `"oci"` / `"system"` 并列）
  - 算子注册表 schema 补充聚合算子字段（参与方、加密方式）
- [x] 2.3 标签传播规则补充：
  - `propagateLabels` 函数识别 `secure_aggregate` 算子
  - 校验：C1 输入 → C3 输出（由清单声明，编译期强制）
  - 违规边返回 `E_LABEL_VIOLATION` 并指明边
- [x] 2.4 测试：
  - 聚合消息序列化/反序列化
  - 算子 kind 枚举覆盖
  - 标签传播：C1 → secure_aggregate → C3（正例）；C0 输入 → 拒绝（反例）
  - `pnpm --filter @medtrust/mdop test` 全绿

## 3. 平台侧实现

- [x] 3.1 编译器识别聚合阶段：
  - `apps/api/src/mdop/compiler/` 补充聚合阶段识别逻辑
  - 从计划推导参与方列表（所有持有数据的节点）
  - 生成聚合子计划片段（每个节点：本地贡献 → 上传密文）
  - 编译期校验：聚合算子的输入必须 C1、输出必须 C3
- [x] 3.2 调度器聚合状态机：
  - `apps/api/src/mdop/scheduler/` 新增聚合阶段状态
  - `PENDING` → `AGGREGATING`（下发 AggregateRequest）→ 等待各节点 Contribution
  - 收齐贡献 → `AGGREGATED`（下发 AggregateResult，含全部密文句柄）→ 等待各节点产出 C3
  - 超时未贡献 → `REJECTED`（不做 partial 合并）
- [x] 3.3 密文路由端点：
  - `POST /api/v1/mdop/aggregate/contributions`（节点上传密文 blob）
  - 存储密文句柄（对象存储引用，不存明文）
  - TTL 72 小时自动清理
  - 返回 `contributionRef`（blob 存储句柄）
- [x] 3.4 聚合结果分发：
  - 收齐全部贡献后，构造 `AggregateResult` 消息
  - 分发给各参与方：`contributionRefs[]`（全部密文句柄）
  - 各节点收到后下载、解密、本地聚合
- [x] 3.5 测试：
  - 编译器识别聚合阶段并生成子计划（单测）
  - 调度器聚合状态机：正常流（收齐贡献）+ 超时流（REJECTED）
  - 密文上传/下载端点（集成测试，用测试替身模拟密文 blob）
  - `pnpm --filter @medtrust/api test -- mdop` 全绿

## 4. 连接器侧实现

- [x] 4.1 节点间通道（密文上传/下载）：
  - `apps/connector/src/mdop/aggregation/` 新增聚合模块
  - 上传本地贡献：加密为密文 blob → 调用平台 `/aggregate/contributions`
  - 下载他院贡献：从平台获取 `contributionRefs[]` → 下载密文 blob → 解密
- [x] 4.2 聚合算子执行器：
  - `MdopStageExecutor` 注册 `secure_aggregate` 处理器
  - 本地聚合实现：解密各方贡献 → FedAvg（样本数加权）→ 产出 C3
  - 聚合失败（解密失败/格式不符）→ 拒绝并记录审计
- [x] 4.3 密文加密/解密：
  - 复用既有密码服务（`GMCryptoService`）
  - 加密：用各参与方公钥分别加密（每方一份密文）
  - 解密：用本节点私钥解密本方密文
  - 聚合：解密后明文 FedAvg
- [x] 4.4 测试：
  - 密文加密/解密往返（单测）
  - 聚合执行器：两节点贡献 → 本地聚合 → 产出 C3（单测）
  - 解密失败 → 拒绝（边界测试）
  - `pnpm --filter @medtrust/connector test -- mdop` 全绿

## 5. 端到端验证

- [x] 5.1 聚合阶段端到端（测试替身）：
  - 用测试替身驱动完整流程：
    1. 平台下发 `AggregateRequest`
    2. 两节点各自产出密文贡献 → 上传
    3. 平台收齐后下发 `AggregateResult`
    4. 各节点下载、解密、聚合 → 产出 C3
    5. 平台收 C3 → 作业 `SUCCEEDED`
  - 断言：聚合结果与各方明文直接 FedAvg 一致
  - 路径：`apps/api/src/mdop/aggregation-e2e.spec.ts`
- [x] 5.2 超时与拒绝流：
  - 单节点超时未贡献 → 聚合 `REJECTED`
  - 解密失败 → 节点拒绝 → 聚合 `REJECTED`
  - 不做 partial 合并（用例显式钉住）
- [x] 5.3 与 v0.2 作业隔离：
  - v0.2 作业（无聚合阶段）仍走原路径
  - v0.3 作业（含聚合阶段）走聚合分支
  - 用例：同时提交 L1.5（v0.2）+ LoRA（v0.3），互不干扰

## 6. 治理同步

- [x] 6.1 ARCHITECTURE 更新：
  - §9 协议版本：v0.2 → v0.3
  - 补充聚合阶段状态机图
  - 节点间通道说明（密文中继模式）
- [x] 6.2 DOMAIN 补充：
  - 聚合阶段实体（`AggregateStage`）
  - 密文贡献实体（`AggregateContribution`）
  - 状态词汇：`AGGREGATING` / `AGGREGATED`
- [x] 6.3 TRUST 更新：
  - CTL-27 补充：聚合阶段的解密失败拒绝（节点本地验证）
  - CTL-28 补充：密文 blob TTL 清理（平台侧）
- [x] 6.4 FLOWS 补充（若需要）：
  - FLOW-MDOP-04：节点间安全聚合流（AggregateRequest → Contribution → Result → C3）。FLOW-MDOP-02 已是 C2 可信空间链路，聚合流单独编号。

## 7. 文档与收口

- [x] 7.1 协议 v0.3 发布：
  - `docs/医疗数据跨节点算子编排协议规范（MDOP）v0.3.md` 定稿
  - 修订说明表完整（v0.2 → v0.3 的每一项改动）
- [x] 7.2 迁移指南（若需要）：
  - v0.2 作业如何升级到 v0.3（聚合阶段是可选的，不强制升级）
  - LoRA FedAvg 迁移前置条件检查清单
- [x] 7.3 `openspec validate --strict mdop-protocol-v03-aggregation` 通过
- [x] 7.4 `pnpm test` 退出码 0：API / 连接器 / mdop 包全绿

## 8. 后续接口（留给批次 1B）

本变更只做协议与基础设施，以下留给 `mdop-fl-migration` 批次 1B：
- LoRA 训练算子登记（`rws.lora-train@1.0.0`）
- LoRA 计划模板（`buildLoraFedAvgPlan`）
- 连接器 LoRA 训练实现接入聚合算子
- LoRA 等价性证据（旧 SecretFlow 链 vs MDOP 链）
- 台账 `fl.lora-fedavg` 从 `in-migration` → `mdop` / `migrated`
- web 入口与作业详情页

**本变更的验收标准**：
- 协议 v0.3 文档定稿
- `packages/mdop` 聚合 schema 与标签规则就位
- 平台编译器/调度器/密文路由实现
- 连接器聚合执行器实现
- 端到端测试（测试替身驱动）通过
- 治理文档同步，`check-meta-docs` 0 error
