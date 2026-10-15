# MDOP 协议 v0.3：节点间安全聚合扩展

> 上游：`mdop-kernel`（v0.2 已收口）、D-MDOP-8（已落册，要求节点间安全聚合）。
> 本变更扩展 MDOP 协议到 v0.3，新增聚合阶段、`system.secure_aggregate` 算子 kind、
> 节点间通道与 partial 参与语义，解除 LoRA FedAvg 迁移（`mdop-fl-migration` 批次 1B）的阻塞。

## Why

D-MDOP-8（2026-10-13 落册）裁决：FL 家族采用节点间安全聚合，平台 MUST NOT 接收单院模型更新，
只收聚合后总和。理由：
- L4 联邦预测的中间量是模型更新（系数/梯度），比 L1.5 四格表敏感一档
- 若平台逐院收更新再合并，平台就成了能反推单院数据的合并方
- 节点间聚合让平台只见 C3 总和，符合 D-MDOP-2 的「平台作为 C3 接收方」定位

**当前阻塞**：
- `fl.lora-fedavg` 在台账中为 `channel=legacy` / `state=in-migration` / `blockedBy="D-MDOP-8 + 协议 v0.3"`
- D-MDOP-8:1321-1323 明确要求：协议 v0.3 聚合扩展未完成前，LoRA FedAvg 的通道切换 MUST NOT 开工
- 协议 v0.2（`mdop-kernel` 已收口）只覆盖 C0–C3 标签、消息信封、计划/凭证/句柄/回执 schema，
  **没有**聚合阶段、节点间通道或 `system.secure_aggregate` kind

**不扩展的代价**：
- LoRA FedAvg 永远停在 legacy（SecretFlow 状态只在内存、无法迁入 MDOP 作业生命周期）
- 每增加一个 FL 能力都要维护两套编排（MDOP 与 SecretFlow），且无法复用 MDOP 的凭证/回执/销毁机制

## What Changes

1. **协议 v0.3 修订稿**（`docs/医疗数据跨节点算子编排协议规范（MDOP）v0.3.md`）：
   - 新增聚合阶段与消息类型：`AggregateRequest` / `AggregateContribution` / `AggregateResult`
   - 新增算子 kind: `system.secure_aggregate`（节点侧执行、平台不参与取值、只路由密文）
   - 重定义 partial 参与语义：节点未回执时**不进入合并**（与旧管线的"partial 合并缺失方"互斥）
   - 节点间通道：二选一路径（① 新做节点间中继；② 复用 LoRA `encrypted_delta_ref` 密文模式）

2. **`packages/mdop` 协议核心扩展**：
   - 聚合阶段 schema：`AggregateStageSpec` / `AggregateRequest` / `AggregateContribution` / `AggregateResult`
   - 算子清单新增 `kind: "secure_aggregate"`（与 `wasm` / `oci` / `system` 并列）
   - 消息类型枚举补充聚合三型
   - 标签传播规则补充：`secure_aggregate` 算子的输出等级由清单声明，且 MUST 满足 C1 输入 → C3 输出

3. **平台编译器与调度器**：
   - 编译器识别 `secure_aggregate` 阶段，生成节点间聚合子计划片段
   - 调度器新增聚合阶段状态机：`PENDING` → `AGGREGATING`（等待各节点贡献）→ `AGGREGATED`（聚合完成）→ 下游阶段
   - 平台只路由密文贡献，不解密、不参与聚合计算

4. **连接器运行时扩展**：
   - 节点间通道：接收其他节点的密文贡献、本地解密与聚合
   - 聚合算子执行器：调用节点本地的安全聚合实现（MPC / 同态加密 / 秘密共享）
   - 聚合结果投递：经 `declassify` 降为 C3 后投递平台

5. **第一条应用链路：LoRA FedAvg**（复用既有 `encrypted_delta_ref` 模式）：
   - 各院产出 LoRA 增量 → 加密为密文 blob → 平台只搬运密文引用 → 各院下载他院密文 → 本地解密与 FedAvg → C3 聚合模型
   - 平台从不见明文增量，满足 D-MDOP-8

6. **台账推进**：`fl.lora-fedavg` 从 `in-migration` → `mdop` / `migrated`（前置是本变更完成 + 批次 1B 实现）

## 本期不做

- **L4 联邦预测改造**：L4（批次 1A）按合约 `allowedArtifacts` 出域，平台直接合并明文效应量；
  若要覆盖 L4，需另立变更修改 D-MDOP-8 适用范围
- **点对点中继基础设施**：本期复用 LoRA 既有的密文模式（平台搬运密文引用），不新开节点间直连通道
- **ε 预算账本**：差分隐私预算管理属独立能力，不在协议扩展范围
- **C1 协议实例**：C1（同协议参与方间流动）在 v0.2 已定义，应用留给后续

## Capabilities

### New Capabilities
- `mdop-secure-aggregation`：节点间安全聚合——聚合阶段、`system.secure_aggregate` 算子 kind、
  节点间密文贡献、平台只路由不参与取值、partial 参与语义。

### Modified Capabilities
- `mdop-protocol`：新增聚合消息类型、算子 kind 扩展、partial 语义重定义（v0.2 → v0.3）。
- `orchestration-kernel`：编译器识别聚合阶段、调度器支持聚合状态机、平台密文路由。
- `data-space-connector`：节点间通道、聚合算子执行器、密文解密与本地聚合。

## Impact

- **协议文档**：`docs/医疗数据跨节点算子编排协议规范（MDOP）v0.3.md`（v0.2 基础上修订）
- **协议核心**：`packages/mdop/src/`（聚合 schema、消息类型、算子 kind、标签规则）
- **平台侧**：`apps/api/src/mdop/`（编译器聚合阶段识别、调度器聚合状态机、密文路由端点）
- **连接器侧**：`apps/connector/src/mdop/`（节点间通道、聚合执行器、密文解密）
- **治理**：DECISIONS（D-MDOP-8 引用）、ARCHITECTURE（协议版本更新）、DOMAIN（聚合阶段实体）

## 前置条件与依赖

- ✅ D-MDOP-8 已落册（2026-10-13）
- ✅ `mdop-kernel`（v0.2）已完成
- ⏳ 本变更完成后，`mdop-fl-migration` 批次 1B（LoRA FedAvg）可启动
