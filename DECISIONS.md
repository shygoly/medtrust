# DECISIONS.md — 架构决策登记册

> **机器可校验的决策登记**。代码里的决策标记——`(D<n>)` 括号引用（方向决策）与词边界
> `D-<AREA>-<NN>[-<sub>]`（落地决策）——必须在此在册，校验由 `node scripts/check-meta-docs.mjs`
> 强制（接入根 `pnpm check:meta`）。
> 本册是**登记索引 + 对拍点**，不是决策过程档案：方向决策 D1–D12 全文在
> `openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md`，落地决策 D-XX-n 全文在
> `docs/deepreq/04-技术选型-架构级决策点.md`，两处原文不动、不降级。
> **命名空间约定**：`D-x` = 架构决策（本册）；`INV-x` = 不变量（`DOMAIN.md`）；
> `CTL-x` = 信任控制点（`TRUST.md`）；`FLOW-x` = 流程链（`FLOWS.md`）；
> `TD-x` = 技术债（`docs/tech-debt.md`，不入本册）。五者正交，禁止混用前缀。
> 新增不可逆架构选择一律 `D-<AREA>-<NN>` 递增（AREA ∈ RWS/DC/UC/CN/ID/VS/DB/ENV/CHAIN…）。

## 方向决策（D1–D12，openspec design.md 收编）

### D1：联邦连接器架构，而非中心化汇聚 + 隐私计算

```yaml decision
id: D1
title: 两平面架构——中心控制面只持元数据，原始数据永久留在参与方本地连接器
status: accepted
date: 2026-05
context: |
  原形态是中心化多租户平台（原始数据上传汇聚）。医院对"原始数据不出院"是
  信任前提，不可妥协；把隐私计算挂在中心化汇聚之上，数据已经出院。
decision: |
  中心控制面只持有元数据（目录/身份/合约/存证索引）；原始数据永久留在各
  参与方本地连接器。这是"可信数据空间"与"数据中台"的分水岭。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
```

### D2：连接器为独立可部署单元

```yaml decision
id: D2
title: 连接器是独立应用，不复用控制面 apps/api
status: accepted
date: 2026-05
context: |
  连接器部署在医院内网，信任边界、依赖、发布节奏都与中心不同；
  模块开关方案会让中心化假设继续渗透。
decision: |
  独立应用承载连接器（现为 apps/connector 规格参考 + apps/agent 生产，
  见 D-CN-1），强制划清"哪些代码能碰原始数据"。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
code_markers:
  - apps/api/src/auth/auth.module.ts
```

### D3：RWS 第一版只走 TEE 通道

```yaml decision
id: D3
title: 第一通道 = 本地 TEE 内算聚合，FL 后置为第二通道
status: accepted
date: 2026-05
context: |
  RWS 信号检测/队列统计本质是"在本地算一个聚合"；首版即上 FL 会增加
  多院同步与建模复杂度，推迟闭环验证。
decision: |
  药企提交分析逻辑 → 医院连接器本地 TEE 内对脱敏数据执行 → 仅输出聚合。
  （后续 L4 联邦学习已作为阶梯上层实现，不改变"TEE 通道为第一通道"。）
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
```

### D4：Usage Control 取代一次性访问审批

```yaml decision
id: D4
title: 授权产物是可强制执行的策略，由连接器 PEP 每次计算时校验
status: accepted
date: 2026-05
context: |
  一次性审批模型无法约束数据流转后的用法，不满足"授权后全程可控"。
decision: |
  策略含目的限定/留存/输出形态/有效期，下发到连接器策略执行点（PEP）
  强制校验。后按 TC609-6-2025-15 细化为数字合约（载体）+ 使用控制（执行）。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
```

### D5：输出闸门在连接器侧强制

```yaml decision
id: D5
title: 计算输出必须过连接器侧输出闸门（DP / 小单元格抑制）才能出域
status: accepted
date: 2026-05
context: |
  聚合结果也可能被重标识；TEE 保护计算过程，但不防止"把原始数据当结果导出"。
decision: |
  连接器侧对输出做差分隐私 / 小单元格抑制（n<5），只有过闸门的聚合/信号/
  模型参数才能离开；原始行级数据物理上无出口。
  2026-07 补充：闸门参数（minCell / 制品白名单）由合约 outputPolicy 绑定（D-DC-2）；
  DP ε 仍属 P-CTL-3 待接入。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
code_markers:
  - apps/connector/src/domain/output-gate.ts
  - packages/database/src/control-plane/output-policy.ts
```

### D6：上链只存证据，不存数据

```yaml decision
id: D6
title: 链上内容 = 各类哈希/指纹/时间戳，链上无任何医疗数据
status: accepted
date: 2026-05
context: |
  链是审计/不可抵赖层，不是存储层（对齐医保试点"全流程日志上链"）。
decision: |
  上链内容 = 任务定义哈希、参与方、授权策略哈希、输入数据指纹、输出结果
  哈希、时间戳。实现 = 长安链 ChainMaker（见 D-RWS-3）。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
  - docs/migration-chainmaker.md
code_markers:
  - apps/api/src/runtime/digital-contract/attestation.service.ts
  - packages/database/src/control-plane/index.ts
```

### D7：数据库拆分，中心库不再汇聚原始数据

```yaml decision
id: D7
title: packages/database 拆为控制面元数据 schema 与连接器本地 schema
status: accepted
date: 2026-05
context: |
  共用一个 DataSource 会再次诱导数据汇聚。
decision: |
  控制面 schema（目录/合约/身份/存证索引，packages/database/src/control-plane/）
  与连接器本地 schema（本地数据+本地审计，packages/database/src/connector/）
  物理隔离；一张表出现在两个平面即违规（DOMAIN.md 覆盖矩阵机检）。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
code_markers:
  - packages/database/src/control-plane/index.ts
```

### D8：国密用于连接器信任链

```yaml decision
id: D8
title: 连接器身份 SM2 证书 + 通信 SM2/SM3 加密签名，禁用非国密替代
status: accepted
date: 2026-05
context: |
  等保/国密合规要求 + 复用现有 security/crypto 储备。
decision: |
  连接器身份用 SM2 证书（中心 CA 签发）；连接器↔中心、连接器↔连接器
  通信用国密加密 + SM3 完整性 + 签名。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
```

### D9：TEE = 软件机密计算先行，硬件目标海光 CSV

```yaml decision
id: D9
title: 软件机密计算先跑通闭环；硬件首选海光 CSV（非 SGX）；表述必须如实
status: accepted
date: 2026-06
context: |
  真实硬件 TEE 难获取难运维；信创"应替尽替"（2027）；海光 CSV x86 兼容
  且内置国密加速。Intel SGX 为境外方案不作首选。
decision: |
  可插拔 TEE 抽象层，软件隔离先行；attestationLevel 字段贯穿任务/存证/
  合约，如实标注 software（信任表述细则见 D-RWS-4 与 TRUST.md）。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
code_markers:
  - apps/connector/src/domain/tee.ts
```

### D10：连接器协议对齐国家数据基础设施标准

```yaml decision
id: D10
title: 接口对齐 NDI-TR-2025 系列与 TC609-6-2025 系列，不自创、不照搬 IDS
status: accepted
date: 2026-06
context: |
  国家数标委（TC609）正式标准已齐：连接器技术要求 NDI-TR-2025-05、
  互联互通 NDI-TR-2025-02/03、目录 NDI-TR-2025-06、使用控制 TC609-6-2025-15。
decision: |
  连接器与中心、连接器与功能节点接口对齐上述国标；第一版实现接口形态，
  第三方互操作检测后置。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
```

### D11：跨空间互联 = 身份/目录/合约的跨空间版，数据仍不出源

```yaml decision
id: D11
title: 互联 = 全局 URN + CA 信任清单互认 + 目录联邦，不引入新范式
status: accepted
date: 2026-06
context: |
  对齐 NDI-TR-2025-02/03 统一身份/目录/接口；复用既有 CA 与数字合约。
decision: |
  数据产品全局 URN（urn:tds:<space>:<product>）+ 联邦信任清单 + 只读目录
  联邦；跨空间任务仍在源连接器本地算，只回传聚合/密文。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
```

### D12：价值共创 = 数字合约计价 + 编排器贡献计量 + 上链清算

```yaml decision
id: D12
title: 合约 pricing + perNode.cohortSize 贡献计量 + 结算台账上链
status: accepted
date: 2026-06
context: |
  对齐"数据二十条"按贡献决定报酬；贡献数据由编排器产出，不可由使用方
  单方声明。
decision: |
  数字合约加 pricing（按任务/按记录/订阅）；任务完成后按 cohortSize 计量
  各院贡献并分账；结算台账上链；先不接真实支付。计量口径见 D-VS-1。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
```

## 落地决策（deepreq 04 收编）

### D-RWS-2：RWS 切口 = 信号检测先行

```yaml decision
id: D-RWS-2
title: 不成比例分析（PRR/ROR 信号检测）先行，analysisType 字段预留队列疗效
status: accepted
date: 2026-06
context: |
  信号检测（四格表聚合）对输出闸门与任务 schema 的要求最简，且贴药物
  警戒真实需求；队列疗效细节待真实药企 PV 岗访谈。
decision: |
  第一切口 = 信号检测；任务定义带 analysisType 预留升级（后续 L2/L3/L4
  阶梯已按此扩展）。
references:
  - docs/deepreq/04-技术选型-架构级决策点.md
```

### D-RWS-3：存证链迁移长安链 ChainMaker（弃 FISCO BCOS）

```yaml decision
id: D-RWS-3
title: 存证链 = 长安链 ChainMaker + Java sidecar；FISCO BCOS 因 SDK JNI 死结放弃
status: accepted
date: 2026-06
sub_ids: [D-RWS-3-a, D-RWS-3-b]
context: |
  FISCO BCOS v3.6 Java SDK 的 JNI native 层 WS-over-TLS 每请求被节点
  socket 读超时丢弃，非应用层可修。
decision: |
  fly-services/chain-sdk（Sidecar.java，纯 Java SDK 无 JNI）真实部署 EVM
  合约 MedicalDataAttestation.sol 并 storeAttestation 写入，保持原 HTTP
  契约（/attest /block-number /health），上层 NestJS adapter 零改动。
  残留风险（生产前必须治理）：
  - D-RWS-3-a：sidecar 从文件系统读证书/私钥 + 硬编码 mysql 口令，须入 Vault。
  - D-RWS-3-b：solo 单节点共识 = 中心化背书，生产需多节点。
references:
  - docs/deepreq/04-技术选型-架构级决策点.md
  - docs/migration-chainmaker.md
```

### D-RWS-4：TEE 软件 fallback 的信任表述

```yaml decision
id: D-RWS-4
title: attestationLevel 字段贯穿任务/存证/合约，当前只能如实标注 software
status: accepted
date: 2026-06
context: |
  apps/agent 跑 torch 进程隔离，无硬件远程证明；向医院声称硬件级机密
  计算即欺骗，摧毁信任产品的根基。
decision: |
  attestationLevel 字段贯穿任务记录 + 上链证据 + 合约表述；海光 CSV 可用
  前值恒为 software。红线 grep 见 TRUST.md。
references:
  - docs/deepreq/04-技术选型-架构级决策点.md
```

### D-DC-2：出域闸门参数属合约，不属于任务

```yaml decision
id: D-DC-2
title: 出域闸门参数（preset / minCell / 制品白名单）绑定数字合约，任务不得另开开关
status: accepted
date: 2026-07
context: |
  合约出域若仅有「聚合 + 模型参数」自由文本，监管无法审严格性；若把 minCell
  等开关放在任务表单，使用方可绕过院方授权放宽出口。
decision: |
  人话层保留三个粗预设（仅聚合 / 仅模型增量 / 聚合+模型参数）；其下结构化
  outputPolicy（allowedArtifacts + minCell∈[5,20] + dp 预留）写入合约并进入
  SM3 哈希与 assignment 快照。PEP 校验制品类/层级；OutputGate 读合约 minCell。
  任务侧只消费快照，不暴露闸门配置。行级永禁不可配。真实 DP 加噪另见 P-CTL-3。
references:
  - DOMAIN.md（数字合约 / INV-PEP-01）
  - TRUST.md CTL-14
code_markers:
  - packages/database/src/control-plane/output-policy.ts
  - apps/api/src/runtime/digital-contract/contract.service.ts
  - apps/connector/src/domain/policy-enforcement.ts
  - apps/connector/src/domain/output-gate.ts
```

### D-DC-1：合约撤销对在途任务 = 立即中止

```yaml decision
id: D-DC-1
title: revoke 立即中止在途任务（fail-closed），复用 FSM compensation
status: accepted
date: 2026-06
context: |
  "完成当前批"窗口内数据继续被用，违背使用控制承诺；PEP 每 step 前校验
  合约 active，长 step 由"关键义务出域前完成"（D-UC-2）兜底。
decision: |
  ContractService.revoke() → 事件到编排器 → 对 in-flight 任务注入
  COMPENSATE(partyId)；全 party 被撤 → FAILED，部分 → COMPENSATED 出
  剩余院结果。
references:
  - docs/deepreq/04-技术选型-架构级决策点.md
```

### D-UC-2：出域义务失败分类处理

```yaml decision
id: D-UC-2
title: 出域前关键义务同步 fail-closed；出域后留痕义务异步 fail-open + 补偿队列
status: accepted
date: 2026-06
context: |
  结果一旦出域不可撤回（数据主权），因此义务必须按"决定能否出域"与
  "事后留痕"分两类。
decision: |
  出域前（闸门校验、ε/n<5、白名单塑形）同步 fail-closed，任一失败结果不
  出域；出域后（上链、结算台账、通知）异步 + 重试 + 补偿队列，不得反向
  阻断已出域结果。审计须能区分"已出域已上链"与"已出域待上链"。
references:
  - docs/deepreq/04-技术选型-架构级决策点.md
```

### D-CN-1：两套连接器收敛定位

```yaml decision
id: D-CN-1
title: 连接器双实现分工：NestJS connector 以 rws-worker 上生产（L1.5–L3 计算 + L4 轮询），Python agent 承担重计算
status: accepted
date: 2026-07
context: |
  connector（NestJS）先建为完整域规格与离线 demo；agent（Python）为真 FL/
  因果内核而生。2026-06 曾定位"connector 不接控制面、纯规格参考"，后被现实
  超越：connector 长出 ControlPlaneClient/TaskPuller 出站轮询，以
  medtrust-rws-worker-a/b 部署上 Fly（Dockerfile.connector，按院烘焙
  Synthea 数据）。本条 2026-07-21 按 fly e2e 实测拓扑修订。
decision: |
  三角分工（以 docs/demo/rws-analytics-ladder-fly-e2e.md 拓扑为准）：
  - rws-worker-a/b（NestJS connector）= L1.5–L3 本地 TEE 计算 + 输出闸门
    + L4 出站轮询转发；保留离线 demo（demo / demo:e2e）。
  - connector-a/b（Python agent）= gRPC 重计算节点：L3 统计内核
    （PSM/IPTW、Cox/KM）+ L4 torch 训练 + SecretFlow 安全信封
    （output_guard.build_safe_result）。
  - 重叠域规格（守卫/脱敏/PEP/闸门语义）仍以 DOMAIN.md / FLOWS.md 的
    ts:/py: 双锚点对齐，不强求跨语言代码共享。
references:
  - docs/deepreq/04-技术选型-架构级决策点.md
  - docs/demo/rws-analytics-ladder-fly-e2e.md
  - fly-services/connector/fly.rws-worker-a.toml
  - apps/connector/src/domain/control-plane-client.ts
```

### D-CN-2：算法执行 = 签名 Wasm 模块 + 能力受限沙箱

```yaml decision
id: D-CN-2
title: 连接器算法执行 = 签名 .wasm + 能力受限沙箱（起步 V8 WebAssembly，目标 Wasmtime）
status: accepted
date: 2026-07
context: |
  连接器执行来自消费方的分析逻辑，是"唯一能碰原始数据的部件上跑外来代码"
  这一注入面的核心（同 CTL-10 的关切）。目标态是把算法作为签名 Wasm 模块，
  在 Wasmtime 沙箱内运行——无网络/无文件系统/无进程创建/无系统调用，仅开放
  受限接口（如 query_omop(sql) 返回聚合），配算法包静态审计 + 签名校验。
decision: |
  **起步实现（已落地，2026-09-18）= Node 自带 WebAssembly + 独立 worker 线程**：
  - 执行：每次运行为一个 `worker_threads` Worker（`env: {}`、`execArgv: []`、`resourceLimits`），
    模块宿主提供唯一一块有上限的内存并注入；**模块只允许导入这一块内存**，其他任何导入
    （函数、表、全局量、WASI）一律拒绝，因此无网络/文件/进程/系统调用能力。
    执行有超时（`CONNECTOR_SANDBOX_TIMEOUT_MS`）与内存上限（`CONNECTOR_SANDBOX_MAX_MEMORY_MB`），
    超限即 terminate 并判任务失败，**不回退到内置实现**。
  - 信任锚：平台 CA 对模块 SM3 做 SM2 签名；数字合约固定"分析类型 → 模块 SM3"。
    连接器运行前做**两项独立校验**（SM3 等于合约固定值 + 签名用部署配置里固定的平台
    公钥验过），任一失败即拒绝执行。公钥只从 `CONNECTOR_PLATFORM_CA_PUBKEY` 读，不从
    控制面任务通道取（避免控制面被攻破时连模块带公钥一起伪造）。
  - 首个 Wasm 化分析类型 = L1.5 失衡检测（`packages/wasm-algorithms`，AssemblyScript
    锁定版本、可复现构建；连接器按 SM3 从控制面分发接口取模块）。
  - **如实标注**：沙箱与连接器同一进程，`wasm-sandbox` 只表示"代码能力受限"，
    不表示进程隔离或保密；未固定模块的分析仍走内置 TS 实现并标注 `executionIsolation: none`。
  - 升级路径：**Wasmtime 独立进程**（有 fuel 计量、隔离更强）+ 专用算法签名密钥
    （与 CA 根密钥分离，见 TRUST P-CTL-5/6）；接口保持不变（`SandboxRunner` 抽象）。
  与 D9（软件 TEE → 海光 CSV）同型：方向已定，实现分期，表述如实。

  **`executionIsolation` 与 `attestationLevel` 正交（勿混）**：
  - `executionIsolation ∈ {none, wasm-sandbox}` 描述**算法代码的能力**是否受限；
  - `attestationLevel ∈ {software, hardware}` 描述**执行环境**是否有硬件远程证明。
  - 沙箱落地**不改变** `attestationLevel`：海光 CSV（D9）可用前恒为 `software`。
  - 标注写在聚合结果**内部**（`aggregate.execution`），在输出闸门之后、规范化与算 SM3
    之前写入，因此被结果哈希覆盖 —— 篡改即验哈希失败；控制面按每家医院的派发记录入库，
    任务级取最弱的一级，并写入存证元数据。

  **沙箱 ≠ TEE（防虚标护栏，与 D9/D-RWS-4/CTL-09 正交互补）**：
  - Wasm 沙箱是**代码约束**机制（宿主不信任代码，防算法偷数据/乱来），
    **不提供远程证明（remote attestation）**；TEE 是**执行环境证明**机制
    （远端不信任宿主，硬件签名向远端证明"原样跑过"）。两者防相反方向的威胁、
    保护相反的当事人，正交不可互替。理想是沙箱跑在 TEE 内。
  - **谁依赖 attestationLevel = 药企 / 监管 / 医院三方**，各取不同保证：药企
    （结果可信 + 算法 IP 免被医院窥取）、监管（审计级"到底执行了什么"证明）、
    医院（本方 data-in-use 即便宿主组件被攻破仍受保护，据以放心运行外来算法并
    放行 DP 后结果）。remote attestation 的"向远端证明"特性因**医院是运行方**而
    对药企/监管最吃重（医院无需向自己远程证明）；但医院既是"被证明诚实"的宿主，
    也是依赖该声明的一方——它对"输出不夹带原始数据"的信任靠沙箱+闸门+模块签名
    （P-CTL-6）打底，attestation 再加一层"未被篡改地在真飞地跑过"。虚标欺骗的是
    **全部三方**，非仅远端。
  - 故沙箱落地**不改变** `attestationLevel`：海光 CSV 远程证明（D9）可用前恒为
    `software`。**任何"沙箱=TEE / 已具备机密计算"的对外表述即虚标**，其受害者
    正是 attestation 本该保护的远端验证方（药企/监管）——见 CTL-09 红线。
  - P-CTL-6 的算法包签名是**模块完整性证明**（证"是这段算法"），非**执行环境证明**
    （证"在真飞地里跑过"），亦不得当作 TEE attestation 表述。
references:
  - apps/connector/src/domain/tee.ts
  - apps/connector/src/domain/algorithm-validation/grammar-validator.ts
  - apps/connector/src/domain/sandbox/sandbox-runner.ts
  - apps/connector/src/domain/sandbox/module-verifier.ts
  - packages/wasm-algorithms/assembly/disproportionality.ts
  - TRUST.md（CTL-10 + CTL-09 + P-CTL-5/6）
```

### D-CN-3：本地数据模型对齐 OMOP CDM（目标）

```yaml decision
id: D-CN-3
title: 连接器本地数据模型目标对齐 OMOP CDM 只读/脱敏视图；当前 = LocalRecord 自由 JSON
status: accepted
date: 2026-07
context: |
  RWD 主动监测的研究设计与统计（EVIDENCE 对齐的药监指导原则）默认数据已标准化；
  OMOP CDM 是真实世界数据事实标准，受限接口按 CDM 视图暴露可让算法可移植、
  可跨院对拍。与选 SM2（D8）/ ChainMaker（D-RWS-3）同类的标准对齐决策。
decision: |
  目标：连接器对本地数据访问接口层暴露 OMOP CDM 只读视图 + 脱敏视图，
  Wasm 算法经受限接口（query_omop）查询、只回聚合。
  **当前如实标注为过渡态**：connector-local 用 LocalRecord.clinical
  （Record<string,unknown> 自由 JSON），非 OMOP CDM。升级需 ingest 侧映射到
  CDM + 接口层改造，属后置。
references:
  - packages/database/src/connector/index.ts
  - DOMAIN.md（术语表·OMOP CDM）
```

### D-CN-4：院内唯一出站组件 = 连接器（长轮询下发 + 双向签名）

```yaml decision
id: D-CN-4
title: 平台只与连接器通信：任务下发用长轮询，下发任务带平台签名，院内计算后端只受本院连接器调用
status: accepted
date: 2026-09
context: |
  连接器规格要求「只能主动出站，不得要求参与方开放入站端口」。此前实现违反该要求：
  联邦训练的每一轮，控制面都通过 gRPC 直接调用各院 Python agent，训练日志也由控制面连入
  agent 的 WS（5023）；两条通道都是明文且无鉴权（agent 用 add_insecure_port，控制面用
  createInsecure）。部署到真实医院就意味着医院要为平台开一个谁都能调用的入站端口。
  连接器信道也只用静态令牌，代码里还写死了一个缺省令牌。
decision: |
  **院内唯一出站组件 = 连接器**（设计 D1）：
  - 平台只与连接器通信；Python agent 退为**院内计算后端**，只在参与方内部网络监听，
    MUST NOT 对平台暴露端口。控制面删除对 agent 的远程调用（gRPC 派发）与日志桥，
    `AGENT_GRPC_ROUTING` 随之下线。
  - **联邦训练轮次经连接器中转**：控制面按轮为每家医院生成轮次任务（入队 → 唤醒长轮询 →
    等回传），连接器领到后在院内调用本院 agent 的 RunLocalRound 并回传结果（含结果 SM3 与
    连接器 SM2 签名）。每轮设时限，未按时回传的医院踢出本轮（沿用既有补偿语义），下一轮可
    重新参与；每轮指标经既有 /ws/secretflow 推给前端，取代原先的 agent 日志桥。
  - **任务下发用长轮询**：`GET /api/v1/connector/tasks/pending?waitMs=`（服务端上限 25 秒）
    一次返回该院的 RWS / FL 预测 / 联邦训练轮次三类待办；无待办时挂起请求，出现面向该院的
    任务立即返回。连接器收到响应立刻发起下一次请求；显式心跳降为 60 秒一次，每次长轮询
    顺带刷新在线状态。旧的两条 pending 接口在迁移期保留并标为废弃。
  - **双向可信**：平台对每个下发任务签名（规范化内容含目标参与方/任务类型/任务 ID/签发时间/
    任务内容 → SM3 → 平台 CA 的 SM2），连接器用部署固定的平台 CA 公钥验签并检查目标参与方、
    时效（10 分钟）、taskId 去重；连接器信道的每个请求都必须带平台 CA 签发证书的 SM2 签名，
    带请求体的上报签名覆盖请求体 SM3。代码中 MUST NOT 存在缺省令牌：令牌方式只在显式开启
    `CONNECTOR_TOKEN_AUTH_ALLOWED=true` 且显式配置令牌值时可用（本地 e2e/测试用）。
  - **院内调用鉴权**：连接器调用本院 agent 必须带共享凭证（元数据 `x-agent-token`）；agent
    未配置共享凭证即拒绝一切调用（fail-closed）。日志 WS 缺省关闭（`AGENT_WS_ENABLED`）。
  - **前置条件**：控制面库（CA 根密钥所在）必须先挂卷持久化，否则重建 API 会重新生成根密钥，
    令已签发证书、固定公钥、算法模块签名与任务签名全部失效（分阶段上线见 D8 与 TRUST CTL-21）。
  非目标：不做国密 TLS（TLCP，需 Tongsuo）；不做 API 多实例（等待者登记在进程内存，
  多实例需改发布订阅）；连接器与 agent 之间第一版用共享凭证 + 网络隔离，不做 mTLS。
references:
  - apps/api/src/runtime/connector-tasks/connector-tasks.controller.ts
  - apps/api/src/runtime/secretflow-orchestrator/fl-round-queue.service.ts
  - apps/connector/src/domain/connector-task-signature.ts
  - apps/connector/src/domain/fl-round/fl-round-executor.ts
  - apps/agent/src/medtrust_agent/grpc_server.py
  - TRUST.md（CTL-21 + CTL-20 + CTL-09）
```

### D-ID-1：跨空间信任清单 = 静态清单 + 拉模式吊销

```yaml decision
id: D-ID-1
title: 第一版信任清单静态维护，CRL 拉模式传播吊销
status: accepted
date: 2026-07
context: |
  跨空间互认靠"本空间信任的其他空间 CA 集合"；推模式吊销需要跨空间消息
  通道，第一版过重。
decision: |
  静态信任清单 + 拉模式 CRL 吊销先行。
references:
  - docs/deepreq/04-技术选型-架构级决策点.md
```

### D-ID-2：西安节点身份对接走「三方应用集成」，不替代本地身份体系

```yaml decision
id: D-ID-2
title: 以三方应用身份接入西安节点能力中心的用户同步与可信免登，本地 email/password 与 SM2 CA 连接器身份保持不变
status: accepted
date: 2026-08
context: |
  西安节点《三方应用集成方案》只定义能力中心→三方应用的用户同步与免登两个接口，
  不是 OIDC/政务身份源。MedTrust 作为被集成应用，新增开放接口接收同步用户并
  签发本地会话，本地 JWT 体系与连接器 SM2 证书体系不被替换。
decision: |
  新增 runtime/xian-integration 模块实现 PDF 的 userSyncEndpoint 与 loginEndpoint；
  免登经一次性 SSO ticket 兑换本地 JWT 会话。本地登录保留为兜底。
references:
  - docs/国家数据流通利用基础设施西安节点_三方应用集成方案.pdf
  - docs/丝路数港-身份对接可行性评估.md
code_markers:
  - apps/api/src/runtime/xian-integration/xian-integration.module.ts
```

### D-VS-1：贡献度口径 = cohortSize 代理先行

```yaml decision
id: D-VS-1
title: cohortSize 样本量代理计量贡献；CI/GTG-Shapley 为升级路径
status: accepted
date: 2026-07
context: |
  Shapley 类算力成本高；cohortSize 由编排器产出、不可由使用方单方声明，
  抗刷性可接受。
decision: |
  分账按各院 cohortSize 占比；升级路径 CI/GTG-Shapley 预留。
references:
  - docs/deepreq/04-技术选型-架构级决策点.md
```

### D-CMP-1：L2 保障级新增 federated，medium 要求 federated、high 要求 enhanced

```yaml decision
id: D-CMP-1
title: L2 保障级新增 federated（数据不出域 + 输出闸门 + 全程审计）；medium 要求 federated，high 要求 enhanced
status: accepted
date: 2026-09
context: |
  合规预审要成为合约与任务的真闸门（compliance-pre-review-gate），闸门必须对每个风险等级
  强制所需保障级。现行 L2 风险策略中 medium 要求 enhanced（TEE / MPC / 同态加密），
  而 2026-09-18 落地审计表明这些在线上链路无一落地：原样强制会驳回全部真实任务，
  维持不强制则裁决与页面展示的合规要求自相矛盾。平台真实具备的是架构性保护——
  原始数据不出院、院内就地计算、输出闸门（行级拦截 + 小格抑制）、合约 PEP 与全程审计存证，
  介于 basic（传输/存储加密 + 访问控制）与 enhanced（密码学多方计算 / 硬件可信执行）之间。
decision: |
  新增保障级 federated = 数据不出域 + 输出闸门 + 全程可审计（不含密码学多方计算、不含硬件
  可信执行），由一个代表「联邦就地计算 + 输出闸门」的已落地 L6 对象满足。
  保障级序 basic < federated < enhanced。风险策略改为 low → basic、medium → federated、
  high → enhanced；只改 L2 规则数据，不改引擎结构。enhanced 定义不变：high 风险在 enhanced
  协议（如 CKKS 聚合）接入线上之前仍会被驳回，如实。
references:
  - openspec/changes/compliance-pre-review-gate/design.md（D5、Q1）
  - TRUST.md（CTL-09；P-CTL-2 / P-CTL-5）
  - packages/database/src/capability/seed-data/landing.ts（落地状态叠加层）
```

## 既成决策补登（历史上从未登记）

### D-DB-1：中心元数据库 SQLite 先行

```yaml decision
id: D-DB-1
title: 控制面数据库 SQLite（better-sqlite3, WAL）先行；生产前迁 Postgres
status: accepted
date: 2026-06
context: |
  中心只存元数据、量小；docker-compose 定义了 Postgres 但从未启用，
  README 长期误导"在用 Postgres"。
decision: |
  dev 与当前 prod 均 SQLite（DATABASE_URL 或 ./data/medtrust.db，
  NODE_ENV !== 'production' 时 synchronize 开）；生产多方场景前控制面迁
  Postgres，连接器本地库由医院环境决定（D7）。
references:
  - packages/database/src/data-source.ts
  - ARCHITECTURE.md
```

### D-ENV-1：端口段 5020–5029

```yaml decision
id: D-ENV-1
title: 本仓所有本地服务固定 5020–5029 端口段
status: accepted
date: 2026-05
context: |
  3000 被本机另一项目占用；多服务（web/api/connector/chain/agent）需要
  稳定可记忆的段位。
decision: |
  web=5020、api+WS=5021、connector=5022、agent WS=5023、agent gRPC=5024，
  新服务从 5025–5029 取。配置点：apps/web/package.json、
  apps/api/src/main.ts、apps/web/src/api/{client,websocket}.ts。
references:
  - CLAUDE.md
```

### D-AI-1：任务设计助手用外部 LLM 供应商，且只送提示词文本

```yaml decision
id: D-AI-1
title: AI 助手调外部 LLM（DeepSeek）而非自建模型；出域内容严格限于 prompt-text
status: accepted
date: 2026-07
context: |
  自然语言任务设计助手需要通用语言理解能力，自建/本地部署模型在当前阶段
  成本与效果都不划算。但调用外部 API 意味着内容离开本空间信任边界，
  供应商的留存与再训练策略不受治理，且可能触发数据出境合规问题——
  这与"数据不出域"（D1）是同一类问题的另一条边。
decision: |
  接受外部 LLM 供应商（DeepSeek，OpenAI SDK 兼容，env DEEPSEEK_API_KEY），
  但把这条边纳入 FLOWS 红线机制：新增 crosses 值 control→external，
  该边 payload 只许 prompt-text 或 none。任何患者衍生内容
  （raw-local / aggregate-only / 目录真实 schema）流向供应商 = 校验红。
  未在 FLOWS 登记的外部 AI 调用视为未受治理，审计以在册流程为准。
  升级路径：本地/私有化模型可用时切换，届时该边降为 crosses: none。
references:
  - FLOWS.md（FLOW-AI-01 + 跨域边与数据分级表）
  - TRUST.md（CTL-11）
  - apps/api/src/secretflow-assistant/secretflow-assistant.service.ts
```

### D-UI-1：Form 栈 = react-hook-form + zod

```yaml decision
id: D-UI-1
title: 复杂表单用 react-hook-form + zod；不再手写 useState 状态机
status: accepted
date: 2026-07
context: |
  DESIGN.md §4「已知缺口」曾标注 Form 栈未定（缺 react-hook-form + zod）。
  rws-study-protocol-spec §6 把研究方案提交表单推到 14+ 字段 + 动态数组
  （敏感性分析 useFieldArray）+ 客户端校验需与后端 Phase-2 validator 同步，
  手写 useState 会产生 18+ 独立 state 与重复校验代码，维护负担与回归风险
  都不可接受。这是该缺口的硬触发点。
decision: |
  选 react-hook-form（uncontrolled、性能稳定、useFieldArray 成熟）+ zod
  （schema 即类型，与后端 validateRwsAnalysisLadder 语义可对照）+ @hookform/resolvers
  做桥接。新复杂表单一律此栈；简短一次性输入（如登录）可继续用受控 useState。
  FormField / FormLayout 等分子按需在后续抽取，不在本决策预建。
references:
  - DESIGN.md §4（Form 原型 + 已知缺口）
  - apps/web/src/lib/rws-protocol-schema.ts（zod schema）
  - apps/web/src/app/(console)/space/tasks/new/rws/page.tsx（首个 rhf 表单）
```

### D-DATA-1：RWS 测试数据 = Synthea 基座 + TS 注入真值信号

```yaml decision
id: D-DATA-1
title: RWS 阶梯测试数据用 Synthea 人口基座 + 可单测的 TS 注入层；弃 FAERS/GMF
status: accepted
date: 2026-07
context: |
  实测确认现有 Synthea 数据不合格：胰腺炎=0、无药→AE 因果、连接器 loader 拿
  共病冒充不良事件。演示"阶梯复原已知信号"需一份带已知真值的数据。三条备选：
  ① FAERS（真实但只 L1.5 形状、需另集成）② Synthea GMF 注入模块（据 Meeker 2022
  需迭代 6 版、只单变量、真值藏 FHIR）③ Synthea 基座 + TS 注入层。
decision: |
  选 ③：Synthea 只产真实人口基座，信号（暴露臂/胰腺炎/时间/编码噪声/混杂）由
  独立 TS 注入层在基座上注入。理由：验证"数据合格"需精确知道注入真值并断言复原，
  TS 层可 jest 单测、精确控 HR/Se/Sp、真值显式落 answer key（apps/connector/src/
  testdata/signal-injection.ts）。FAERS 留作"真实信号"升级触发，不在首版。
  拔高的注入发病率（3–7%）靠合成溯源标注兜底，MUST NOT 当真实流行病学读。
references:
  - openspec/changes/rws-test-data-signal-injection/design.md（D1/D2）
  - apps/connector/src/testdata/signal-injection.ts
```

## 附录：格式契约（标记语法与校验）

check-meta-docs.mjs 按以下契约解析本文件与代码：

| 命名空间 | 含义 | 出处 |
|---|---|---|
| `D-x` | 架构决策（本册在册） | DECISIONS.md |
| `INV-x` | 不变量 | DOMAIN.md |
| `CTL-x` | 信任控制点 | TRUST.md |
| `FLOW-x` | 流程链 | FLOWS.md |
| `TD-x` | 技术债（不入本册） | docs/tech-debt.md |

1. **decision 块**：围栏 info-string 恰为 `yaml decision`。必填字段 `id` / `title` /
   `status` / `date` / `context` / `decision` / `references`；可选 `sub_ids`（子决策编号
   数组）、`code_markers`（代码标记所在文件，供人查阅，校验器不据此限定扫描范围）。
2. **id 格式**：`D<1-99>`（方向决策，历史保留）或 `D-<AREA>-<NN>`；`sub_ids` 元素为
   `D-<AREA>-<NN>-<a-z>`。全册唯一。
3. **代码标记扫描**（apps/ packages/ scripts/ fly-services/ 下 .ts .js .mjs .py .java .sol，
   排除 node_modules/dist/.next）：
   - `(D<n>)` 括号引用 → 须有对应 `D<n>` 在册；
   - 词边界 `D-<AREA>-<NN>[-<sub>]`（非 `TD-` 前缀）→ 须在册（含 sub_ids）。
4. 新增决策：不可逆选择才入册（可逆的做法写代码注释即可）；编号取该 AREA 下一号。
5. 解析空转兜底（MS-8）：decision 块解析为 0 行 = 格式契约破坏 = 红（防"块被改成散文后静默通过"）。
