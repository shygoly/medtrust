# 设计：MDOP 协议 v0.3 节点间安全聚合

## D1 路径选择：复用 LoRA 密文增量模式（推荐），不新做节点间中继

D-MDOP-8:1324-1327 给出二选一：
1. **新做节点间中继**：节点直接建立加密通道、交换聚合贡献
2. **复用 LoRA `encrypted_delta_ref` 模式**：平台搬运密文引用，节点下载他院密文后本地解密

**选择 2 的理由**：
- 不新开点对点协议，复用既有基础设施（平台作为密文中继已在 SecretFlow LoRA 中验证）
- 平台只见密文引用（blob 存储句柄），不见明文更新，满足 D-MDOP-8「平台不接收单院模型更新」
- 节点间无需额外防火墙规则或 NAT 穿透
- 迁移期可与旧 LoRA 路径共存（同一密文存储层）

**代价**：
- 密文需经平台中转（增加一跳延迟），不如直连快
- 平台存储需承载密文 blob（按 TTL 清理）

**结论**：选择 2，密文中继模式。如后续需要直连优化，属独立变更。

## D2 聚合阶段的三种消息与状态机

聚合阶段（`system.secure_aggregate`）需要三种消息：

1. **AggregateRequest**（平台 → 各节点）：
   - 下发聚合任务：`jobId` / `stageId` / `aggregationSpec`（聚合算法、参与方列表、超时）
   - 各节点收到后产出本地贡献（加密为密文 blob）

2. **AggregateContribution**（节点 → 平台）：
   - 上传密文贡献：`contributionRef`（密文 blob 存储句柄）/ `contributorId` / `partialSignature`
   - 平台收集全部贡献后，通知各节点下载

3. **AggregateResult**（平台 → 各节点）：
   - 分发他院贡献列表：`contributionRefs[]`（全部密文句柄）
   - 各节点下载、解密、本地聚合，产出 C3 结果

**状态机**（阶段级）：
```
PENDING → (下发 AggregateRequest)
       → AGGREGATING（等待各节点 AggregateContribution）
       → AGGREGATED（收齐贡献，下发 AggregateResult）
       → 各节点产出 C3 → 下游阶段
```

**超时与 partial**：
- 聚合超时 MUST 可配置（缺省 300 秒），由作业提交方在 `AggregateStageSpec` 中声明
- 连接器本地复核时 MUST 检查超时是否在合理范围（60–600 秒），超出则拒绝
- 超时未贡献的节点 → 整个聚合阶段 REJECTED（不做 partial 合并）
- 与 v0.2 的 partial 语义一致：任一方未回执 = 不进入合并

## D3 算子 kind 扩展：`system.secure_aggregate` 的约束

新增第四种算子 kind（与 `wasm` / `oci` / `system` 并列）：

```yaml
kind: system.secure_aggregate
id: "merge.fedavg-secure"
category: aggregation
inputs:
  - label: "local_contribution"
    level: C1  # 密态，同协议参与方间流动
outputs:
  - label: "aggregated"
    level: C3  # 可发布给合约接收方
```

**约束**：
1. **输入必须 C1**：只有密态数据可进入安全聚合
2. **输出声明 C3**：聚合后降为可发布（经各方贡献混合，单院信息已消失）
3. **节点侧执行**：平台不参与聚合计算，只路由密文
4. **参与方列表闭合**：编译期从计划推导，运行时不可变

**标签传播规则补充**：
- 普通算子：输出等级 = 输入等级的最严上界
- `declassify`：显式降级，需满足合约条件
- **`secure_aggregate`**：C1 输入 → C3 输出（由清单声明，编译期校验）

## D4 节点间通道的安全模型

密文中继模式的信任边界：

**平台看到的**：
- 密文 blob 句柄（存储引用，不含明文）
- 参与方列表（从合约推导，已知）
- 聚合完成信号（各节点投递 C3 后）

**平台看不到的**：
- 明文模型更新（LoRA 增量、梯度）
- 解密密钥（各节点本地持有）
- 聚合中间结果（在节点内完成）

**节点间信任**：
- 各节点用合约明示的公钥加密贡献
- 只有参与方能解密（非对称加密 or 秘密共享）
- 平台作恶（篡改密文）→ 解密失败 → 聚合 REJECTED

**与 D-MDOP-2 的关系**：
- 平台仍是「C3 接收方与合并方」（收聚合后总和）
- 但聚合计算在节点内（平台只路由密文），满足 D-MDOP-8

## D5 partial 参与语义的重定义

MDOP v0.2 的 partial 语义（隐含）：任一片段未回执 → 不进入 `RELEASING` → 不产生平台侧结果。

v0.3 **显式**定义，并与旧管线区分：

| | 旧管线（RWS / FL 旧链） | MDOP v0.2/v0.3 |
|---|---|---|
| 单院未回执 | partial 合并其余院，结果标注"部分参与" | 整个作业 REJECTED，无结果 |
| 理由 | 旧设计允许降级交付 | MDOP 凭证链要求各方确认，缺一不成链 |
| 适用 | 已停止迁入 legacy | 所有 MDOP 作业 |

**v0.3 补充**（聚合阶段）：
- 聚合阶段的 `AggregateContribution` 超时 → 整个聚合 REJECTED
- 不做「剩余方聚合」（那会泄露缺席方的边界信息）
- 下游阶段不会收到「部分聚合」的输入

**决策记录**：补充到 D-MDOP-1（绞杀者迁移，新旧语义互斥）。

## D6 LoRA FedAvg 作为第一条应用链路

复用既有 SecretFlow LoRA 的密文路径：

**旧路径**（in-memory 状态）：
```
各院训练 → encrypted_delta（加密增量）
→ platform collects → 各院 download encrypted_deltas
→ 本地解密 FedAvg → 下一轮
```

**MDOP 路径**（持久化凭证链）：
```
source → seal(本地数据) → rws.lora-train@1.0.0（产出 C1 增量）
→ system.secure_aggregate(merge.fedavg-secure)
  ├─ 各院上传密文 blob（AggregateContribution）
  ├─ 平台路由密文句柄（AggregateResult）
  └─ 各院下载、解密、FedAvg（产出 C3 聚合模型）
→ declassify.small_cell → 平台收 C3
```

**关键差异**：
- 旧路径状态在内存（SecretFlow driver 进程）
- MDOP 路径状态持久化（作业/阶段/凭证/回执表）
- 聚合口径一致（FedAvg 样本数加权）

**迁移条件**（批次 1B）：
1. ✅ 本变更（v0.3 协议）
2. ⏳ LoRA 训练算子登记（`rws.lora-train@1.0.0`）
3. ⏳ 平台聚合调度器实现
4. ⏳ 连接器密文上传/下载/解密实现
5. ⏳ 等价性证据（LoRA 旧链 vs MDOP 链）

## D7 风险与缓解

**风险 1：密文中转增加延迟**
- 缓解：密文 blob 走对象存储（非数据库），延迟 < 100ms
- 备选：后续优化为节点直连（独立变更）

**风险 2：密文存储容量**
- 缓解：密文 blob MUST 有大小上限（建议 100 MB），超过则拒绝上传并返回 `E_PAYLOAD_TOO_LARGE`
- 上限由平台配置（环境变量 `MDOP_MAX_CONTRIBUTION_SIZE`）
- TTL 72 小时自动清理，只保留活跃作业的密文
- 监控：blob 存储用量告警

**风险 3：解密失败导致聚合卡住**
- 缓解：解密失败 → 节点拒绝并记录审计 → 聚合 REJECTED（fail-loud）
- 不做静默降级或 partial 合并

**风险 4：v0.3 与 v0.2 作业混跑**
- 缓解：协议版本在作业元数据中声明，路由器按版本分派
- v0.2 作业不会误进聚合分支
