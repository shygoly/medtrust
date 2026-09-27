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

  **落地补注（2026-09-26，tee-confidential-node）——C2 信封的载荷 AEAD 是对本决策的临时偏离，
  在此登记而非默认成立**：C2 数据信封（`mdop.env/1.0`）的载荷密文目前用的是 **AES-256-GCM**
  （`apps/connector/src/mdop/operators/seal.ts` 的 `aeadSeal`），**不是**国密 AEAD——原因是
  Node 运行时没有原生 SM4-GCM，仓内现有的 SM4 实现是 CBC 且无完整性校验（见 tasks §3.28 的观察）。
  偏离的边界与约束：
  ① 信封 `payload.cipher` MUST 如实写实际算法名（当前 `AES-256-GCM`），MUST NOT 写成 `SM4-GCM`；
  ② AAD 绑定、密钥保管（KMS）、持有方签名（SM2/SM3）、回执与锚定仍全部国密，未偏离；
  ③ **对外表述 MUST NOT 声称「全链国密」或「国密信封」**；
  ④ **收回条件**：引入受审计的 SM4-GCM 实现（或自研并通过安全评审）后，替换 `aeadSeal`/`aeadOpen`
     并把 `cipher` 改为 `SM4-GCM`——换实现不动 AAD 绑定、密钥保管与策略字段（换链不改协议同一思路）。
  在这条偏离收回前，本决策的「通信用国密加密」对 C2 载荷这一环**尚未满足**。
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

  **落地补注（2026-09-25，tee-confidential-node）——两类执行环境的标注口径分开**：
  - **院内连接器**：仍为软件隔离，`attestationLevel` 恒 `software`，**本条不变**；
  - **可信空间节点（C2，尚未落地）**：落地后为**硬件证明**，须在任务/合约/存证中标注具体
    证明类型（`csv` / `tdx` / `sev-snp`）与 TCB 版本，不得笼统写 `tee`；证明摘要与度量
    进入执行凭证的签署范围。
  - 在节点真正落地之前，本仓**没有任何一处**可以标注硬件证明；「设计已定」不等于「已具备」。
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
  补注（2026-09-24）：MDOP（D-MDOP-1）是本条国标连接器接口**之上**的编排 profile，
  不替代、不改写接口形态；算子编排、凭证与流动标签属 MDOP 层，接口仍对齐 NDI-TR/TC609。
references:
  - openspec/changes/archive/2026-07-21-federated-data-space-rws/design.md
  - DECISIONS.md（D-MDOP-1）
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

### D-RWS-5：存证按贡献方带连接器背书（L1 可独立归因，不改共识）

```yaml decision
id: D-RWS-5
title: RWS 存证 payload 按贡献方带连接器对 resultSm3 的 SM2 背书，使链上记录可脱离平台独立归因
status: accepted
date: 2026-09
context: |
  原存证只锚「合并后的单个 resultHash」，连接器签名从不进链（传输层签名
  ts:pid:bodySm3 在 ingress 验一次即弃）。于是链上记录只能证明「平台锚了这个
  哈希」，读链者脱离平台无法确认某条结果确实出自某院 —— 对卖「可信」的数据
  空间，这是存证的实质空缺（存证可信 = 信平台单节点）。
decision: |
  连接器用院内证书私钥对稳定的结果摘要 resultSm3 做**结果级** SM2 签名
  （载荷 `medtrust.result-endorsement.v1:<sm3>`，加前缀做域分离，不复用传输
  签名）；平台按院验签、持久化到派发记录，并把
  `{participantId, resultSm3, sig, certFingerprint}` 随合并 resultHash 一起
  锚链。第三方凭公开的平台 CA 公钥即可离线验证书链 + 验背书签名，医院无需
  运行链节点、无需开入站口。
  边界如实：本决策只防**伪造**（平台没有医院私钥，伪造不出背书），不防
  **遗漏**（平台仍单节点、仍决定锚不锚）——遗漏归 P-CTL-4 的 L2 多节点共识。
  `attestationLevel` 仍恒 software（D-RWS-4 不变）。
  迁移渐进：无签名不破坏任务但记告警；**有签名必须验过**（伪造比缺失更危险）；
  两院连接器升级后由 `RWS_ENDORSEMENT_REQUIRED=true` 切 fail-closed。
references:
  - openspec/changes/connector-endorsement-on-chain/design.md
  - TRUST.md CTL-23 / P-CTL-4
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

  **多语言与第三方准入（D-CN-5 扩展）**：本决策的单一 AssemblyScript 模块扩到 Rust + AS
  源码-only、平台复现构建、第三方两层准入（不设 Tier C）、运行时兜底（OS 隔离）与模块吊销，
  见 D-CN-5 与 P-CTL-7。
references:
  - apps/connector/src/domain/tee.ts
  - apps/connector/src/domain/algorithm-validation/grammar-validator.ts
  - apps/connector/src/domain/sandbox/sandbox-runner.ts
  - apps/connector/src/domain/sandbox/module-verifier.ts
  - packages/wasm-algorithms/modules/disproportionality-as/assembly/disproportionality.ts
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

  **落地补注（2026-09-21，omop-data-source-access）——目标态两处被取代**：
  ① 「Wasm 算法经受限接口（query_omop）查询」**作废**，由 D-CN-6 取代：模块不获得任何
  数据接口（导入面恒为一块有上限内存），查询由连接器执行、把列裁剪与行过滤下推进 SQL，
  模块只拿投影后的整数列。给模块开查询接口会同时废掉零导入、最小列投影与行序不变性差分。
  ② 「只读视图」**不完整**，由 D-CN-7 细化为双权限域：CDM 视图只读 + `results` schema
  可建表可写（队列定义必须写 cohort 表）；纯只读账号判为契约不满足。
  「对齐 OMOP CDM」这一目标本身不变：院内库接入只接 CDM（D-CN-7）；文件数据源仍走
  LocalRecord，两条路径在投影载荷处汇合。
references:
  - packages/database/src/connector/index.ts
  - DOMAIN.md（术语表·OMOP CDM）
  - DECISIONS.md（D-CN-6 / D-CN-7）
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

### D-CN-5：第三方算法模块准入 = 源码-only + 两层准入（不接受不透明二进制）+ 五道闸

```yaml decision
id: D-CN-5
title: 第三方算法模块准入 = 源码-only（Rust/AssemblyScript，平台复现构建）+ 两层准入（不设 Tier C）+ 五道闸 fail-closed
status: accepted
date: 2026-09
context: |
  D-CN-2 建起「签名 Wasm + 合约固定 SM3 + 能力受限沙箱」的执行机制，但只覆盖平台自研
  的单个 AssemblyScript 模块。D-CN-2 真正要防的「外来算法代码」尚无准入路径：第三方
  （药企/学术）无法把自己的分析算法跑到院内数据上，只能提交参数、跑连接器自带代码。
  零能力沙箱里传统病毒（syscall/网络/文件/进程）本就跑不起来，真实威胁是「借合法输出
  通道外泄、资源 DoS、结果造假/引偏、引擎逃逸、供应链身份」五类。
decision: |
  **准入只设两层，源码-only；用「平台复现构建」作排除机制**：
  - Tier A = 平台自研源码；Tier B = 第三方交源码、平台复现构建 + 审查。**不设 Tier C**：
    不透明第三方二进制 MUST NOT 准入。合约固定的模块 SM3 MUST 由平台在锁定工具链里从
    提交源码复现产出——复现不出 SM3 即无法签名/固定，从**机制上**排除不透明二进制，
    而非软性政策拒绝。理由：黑盒二进制无法审「到底干什么」，与「医院审过、同意跑这一份」
    的知情同意自相矛盾，且黑盒测试永不完备（测试数据上乖、真实数据上作恶）。
  - **语言 = Rust + AssemblyScript**（编译到小而静态、确定性好的 Wasm，SM3 = 算法本身）。
    不上「解释器编译进 Wasm + 喂源码」的路子：并未省掉编译，只是把大解释器搬进「被签名 +
    被合约固定 + 被审计」的包里，放大审计面/攻击面、削弱确定性。若确需 Python 体验，另立
    变更走「受限确定性 DSL（Starlark/小 Lisp）+ 解释器与源码双哈希」。
  - **IP = 保密审查通道**：第三方可 NDA 交源码，平台审 + 构建，对医院只公开 SM3 + 审查
    背书；「要源码」不等于「要开源」，连 NDA 都不给源码的排除在外。
  - **五道闸，fail-closed，任一不过即拒且不回退**：①静态白名单（import 只允许有上限内存 +
    窄数据 API，export 签名固定，Wasm 特性白名单禁 threads/共享内存，内存/大小上限）
    ②复现构建 + 平台 SM2 签名（两独立构建器出同一 SM3）③沙箱动态测试（与参考实现逐字段
    一致、跨院确定性、资源上限确实触发、防外泄、模糊）④影子发布（先只算不发结果）
    ⑤运行时常态防护（验签 + SM3 固定 + 零导入 + 过闸 + 存证；OS 层 seccomp/cgroup/断网/
    只读 FS 兜底引擎逃逸；引擎优先 Wasmtime；模块可吊销）。
  - **防外泄是主战场**：零能力沙箱里数据出去的唯一通道是合法输出——宿主只喂最小整数列
    投影（原始标识不进模块）→ 窄低熵输出 schema → 行序不变性差分 → 输出闸门兜底。
  合约固定模块条款增加准入层级（A/B）与平台审查背书，计入合约哈希。
  非目标：不做真 TEE/远程证明（executionIsolation 正交，见 D-CN-2）；不接受 Tier C。

  **落地补注（2026-09-20）——「引擎优先 Wasmtime」这一条按决策不做**：
  Wasmtime 的两项收益要分开看。① **确定性资源裁决**（fuel 指令预算：同输入必在同一条
  指令上断）——**决定不追求**。资源上限本身保留（V8 worker + 超时 terminate + 内存上限，
  闸 3.3 有负例），只是裁决用墙钟、跨院可能不一致；而不一致的唯一后果是**偶发任务失败**，
  方向上是 fail-closed，不会产生错误结果。算法正确性已由闸 2（可复现源码 + 人审）与闸 3.1
  （与独立参考实现逐字段对拍）保证，确定性 fuel 的边际收益不抵代价。② **进程隔离**（防引擎
  逃逸）——仍有价值，继续留在 P-CTL-5 作为待接入，不因本条而注销。
  代价侧的事实：Node 无可用的 Wasmtime 绑定（`@bytecodealliance/wasmtime` 在 npm 不存在，
  社区 `wasmtime` 停在 0.0.2 / 2023-05），真要上须把沙箱 worker 改写成 Rust 独立执行进程，
  等同一个独立变更。逃逸风险当前由 OS 层兜底（seccomp/cap_drop/只读 FS/internal 网络）承担。

  **落地补注（2026-09-21）——闸 1 的「+ 窄数据 API」一语作废**：已实现的静态白名单只允许
  **一块有上限的宿主内存**（`env.memory`），不含任何数据 API；接入院内数据库后亦不放宽
  （D-CN-6，回归测试 `apps/connector/src/domain/data-source/import-surface.spec.ts`）。
  模块需要的数据一律由连接器投影后写进这块内存。
  **落地补注（2026-09-24）——与 MDOP 算子登记的关系**：MDOP 的算子注册中心
  （D-MDOP-5）不新开准入路径。`kind: wasm` 的算子摘要 MUST 来自本条的源码-only 复现构建
  与五道闸；复现不出的摘要一律不登记。`wasm` 算子清单的 `digest` 即模块 SM3，运行时仍走
  本条的零导入沙箱（闸 5 吊销名单在 MDOP 中改由平台节点密钥签名下发，规则不变）。
references:
  - openspec/changes/third-party-wasm-module-admission/
  - apps/connector/src/domain/sandbox/
  - packages/wasm-algorithms/
  - TRUST.md（P-CTL-7 + CTL-09 + CTL-10 + CTL-20 + P-CTL-5/6）
  - DECISIONS.md（D-CN-2、D-MDOP-5）
```

### D-CN-6：院内数据库句柄由连接器独占（模块零数据接口、agent 不自建连接、凭据不出连接器）

```yaml decision
id: D-CN-6
title: 院内数据源的连接与凭据只由连接器进程持有；算法模块零数据接口、其它执行体不自建连接；列裁剪与行过滤下推进 SQL
status: accepted
date: 2026-09
context: |
  连接器要对接医院真实数据库（omop-data-source-access）。总得有一个模块拿到句柄才能分析：
  要么 Wasm 模块，要么连接器，要么 Python agent。行业里 OHDSI（分析包持 JDBC 直连，
  靠人审 + 社区信誉）、vantage6（节点把连接串按 label 注入算法容器，靠镜像摘要白名单）、
  DataSHIELD（服务器持 resource，算法只能调白名单函数）三家，算法拿到的都是「能访问数据
  的句柄」——它们的信任模型是**信任算法**。本平台的承诺是**不信任算法**：PEP、输出闸门、
  审计链都在连接器进程内，数据访问若落在它之外，闸门可被绕过。
decision: |
  - 数据库连接与凭据 MUST 只由连接器进程持有；凭据只以环境变量引用（passwordEnv）存在于
    连接器部署配置，MUST NOT 进控制面存储、任务载荷、回传载荷或审计明文。控制面对一个
    院内库只知道一个 label（数据产品声明 `{type:'omop-cdm', label}`，发布即校验）。
  - Wasm 模块 MUST NOT 获得任何数据接口：导入面恒为一块有上限的宿主内存（取代 D-CN-3
    的 query_omop 目标态、D-CN-5 闸 1 的「窄数据 API」措辞）。
  - Python agent 等其它执行体 MUST NOT 另开数据源连接、MUST NOT 持有数据源凭据
    （启动时发现即拒绝启动；依赖里不得有数据库驱动）。
  - 投影下推：连接器把列裁剪与行过滤写进 SQL，取回即最小列投影，不把表全量拉进内存；
    与文件路径在「投影载荷」处汇合，之后的沙箱 / 输出闸门 / 存证链路不因数据源类型而变。
  否决：按 vantage6 把连接串注入算法容器（信任模型不兼容）；agent 直连跑联邦训练
  （形成第二个数据入口，闸门与守卫要维护两套）。
  代价：连接器承担 SQL 执行与方言（D-CN-7），新增 PostgreSQL 驱动依赖扩大连接器攻击面
  （驱动版本锁定 + 连接器容器加固兜底）。
  - 联邦训练 agent 不自读任何院内数据：连接器按合约的数据产品投影训练切片（特征与标签的
    口径归连接器，`schema` 标版本），随 RunLocalRound 请求给出；任务 spec 不得再指定院内目录
    （控制面与 agent 两处拒收 dataPath）。标签口径从 agent 的「英文原文正则」迁到连接器的
    「规范化术语 ∪ 英文原文」，在演示数据上逐人对拍一致（2026-09-21 用户定夺）。
references:
  - openspec/changes/omop-data-source-access/
  - apps/connector/src/domain/data-source/
  - packages/database/src/control-plane/data-source-declaration.ts
  - apps/agent/src/medtrust_agent/config.py
  - apps/connector/src/domain/fl-round/training-slice.ts
  - apps/agent/src/medtrust_agent/training_slice.py
  - TRUST.md（CTL-25）
```

### D-CN-7：院内库只接 OMOP CDM，经医院视图层 + 双权限域接入

```yaml decision
id: D-CN-7
title: 院内数据库只接 OMOP CDM v5.4（不做通用数据库适配），经医院自建视图层接入，连接器账号恰为「CDM 视图只读 + results 可写」双权限域，接入校验 fail-closed
status: accepted
date: 2026-09
context: |
  通用数据库适配要反射表结构 + 字段映射，工程量与审查面是另一个量级；CDM v5.4 把表名 /
  字段 / 类型 / 主外键定死，结构是规范而非探测结果，研究定义才能跨院复用（联邦网络的前提）。
  实测（PostgreSQL 16 + CDM 子集 + 视图层 + 受限账号）证明「底表不可达 / 视图不可写 /
  results 可建表 / 视图行级过滤」四件事同时成立且互不冲突。
decision: |
  - 只接 OMOP CDM v5.4；以 cdmVersion + schema 名（cdm / vocabulary / results）+ dbms 三项
    配置定位，不反射表结构；语义版本（cdm_source.cdm_version、vocabulary_version）从库里读取
    并留痕（concept_id 的含义依赖词汇表版本）。
  - 医院侧以**视图层**提供数据：底表 schema 不对连接器授权；视图同名同结构、去直接标识、
    可行级过滤。视图层是医院 DBA 完全掌控、随时可 REVOKE 的第零道闸，位于所有软件闸门之外。
  - 连接器账号权限恰为两个域：CDM 视图只读、`results` schema 可建表可写（队列定义要写 cohort
    表）。**「纯只读账号」判为契约不满足**——按只读配置会在首次上线失败。
  - 接入校验 fail-closed、不降级回退到文件数据：账号属性（非超级用户 / 无 BYPASSRLS）、最小
    权限（允许集合外任何关系读不到）、视图存在且可读、视图列不含直接标识、视图不可写、
    results 可建可删、元数据可读——任一不过即不可用，并按权限域给出可定位的原因；周期复核。
  - 方言留接缝，第一版只实现 PostgreSQL；未实现方言明确拒绝，不以近似方言替代执行
    （国产库需单独评估）。
  代价：未做 CDM ETL 的医院接不进来——CDM 化本身就是联邦分析的入场券。
references:
  - openspec/changes/omop-data-source-access/
  - apps/connector/src/domain/data-source/cdm-access-gate.ts
  - docs/omop-cdm-onboarding.md
  - TRUST.md（CTL-25）
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

### D-CMP-2：合规预审两级把关——合约层绑定 + 任务层复核；旧合约无快照不设宽限期

```yaml decision
id: D-CMP-2
title: 合规预审两级把关（合约层绑定裁决快照入哈希 + 任务层按当前规则复核）；旧合约无快照 fail-closed，不设宽限期
status: accepted
date: 2026-09
context: |
  合规预审（L2 裁决）此前是游离页面：合约申请/审批不看它、三类任务准入不看它，
  页面自标「仅供参考」。要让它成为「数据产品 → 数字合约 → 任务」链路上的真闸门，
  须回答两问：裁决在哪一层绑定；规则在签发后收紧、任务真实范围晚于签发才知道，如何处理。
decision: |
  两级把关，全程 fail-closed：
  - **合约层绑定**：药企申请合约必须引用一份属于自己的预审；平台按当前 L2 规则、结合由
    数据产品推导的风险维度（数据敏感度、人类遗传资源）重新裁决；驳回则拒绝生成草稿；
    裁决快照写入合约并计入合约哈希、随合约存证上链；裁决为需审批时医院签发须显式确认并填理由，
    确认记录一并计入哈希。
  - **任务层复核**：RWS、FL 预测、SecretFlow 三类任务创建时，对每份被引用的合约调用同一个
    PreReviewGate——快照须存在；任务分析类型须被预审中至少一个 L3 模型覆盖；用任务层事实
    （实际涉及的医院数）按**当前**规则重评，驳回即拒、需审批仅在合约有医院确认时放行。
  为什么两级都要：合约是授权载体、由医院审批，是需审批的天然承接点；但规则可能签发后收紧，
  任务真实范围也要到建任务时才知道，故任务层一律用当前规则复评。
  - **旧合约**：本变更前签发、无预审快照的合约，可查看、可撤销，但**不能用于创建新任务**
    （fail-closed）；不提供「宽限期」开关，避免临时后门常驻。演示种子合约初始化时自动补配套预审快照。
references:
  - openspec/changes/compliance-pre-review-gate/design.md（D1、D7、D9）
  - openspec/changes/compliance-pre-review-gate/specs/digital-contract/spec.md
  - FLOWS.md（预审 → 合约申请 → 任务准入复核）
  - TRUST.md（CTL-22 L2 合规预审闸门）
```

## MDOP 内核（2026-09-24 用户裁决：全面替换现有编排）

### D-MDOP-1：MDOP = 国标连接器接口之上的编排 profile，绞杀者迁移、新表并行

```yaml decision
id: D-MDOP-1
title: MDOP 是 NDI-TR/TC609 连接器接口之上的编排 profile；全面替换现有三条编排，绞杀者迁移、cp_mdop_* 新表不动旧表
status: accepted
date: 2026-09
context: |
  MDOP（`docs/医疗数据跨节点算子编排协议规范（MDOP）v0.1.md`）要求执行模型统一为
  「注册算子组成的 DAG」、安全性不依赖平台诚实。现存三条编排（RWS 的 cp_rws_*、
  FL 预测的 cp_fl_prediction_*、SecretFlow LoRA 的内存态）互不共享领域模型，共 9 种
  任务实体、8 套状态词汇；执行内容由连接器里按 analysisType 写死的 switch 决定。
  与 D10 的关系要先说清：D10 定的是「接口对齐国标」，MDOP 不改变这一点——它是国标
  连接器接口之上的一层编排 profile，不是另起一套接口体系。
decision: |
  全面替换现有编排，用绞杀者（strangler）方式分期迁移：
  - MDOP 作业使用新表 `cp_mdop_*`（作业、阶段、片段、凭证、签名、句柄、投递、回执、
    算子、发件箱、nonce），**不改动** `cp_rws_*` 与 `cp_fl_prediction_*`。旧记录被链上
    存证引用，只读保留；旧管线在迁移期照常运行。
  - 迁移按分析类型逐个进行，**迁完一类才下线对应的旧路径**；第一期只迁 L1.5 失衡检测。
    其余分析类型的迁移与旧管线下线由后续变更完成。
  - 可复用的机制（出站领取、结果哈希校验、超时重派）按 MDOP 语义**重写**，不直接复用旧代码：
    旧管线的 partial 合并语义与否决语义直接冲突。
  - 传输沿用 D-CN-4 的出站通道：平台→连接器随长轮询下发；连接器→平台分控制面
    （`POST /api/v1/mdop/messages`）与数据面（`POST /api/v1/mdop/deliveries`）两个出口，
    数据面只承载 C3，控制面不得携带数据内容。
  - 开关 `MDOP_ENABLED` 控制，缺省关闭；关闭时旧管线不受影响。
  否决：在 `cp_rws_assignment` 上加 stageId/attempt/依赖字段演进成阶段表——迁移期新旧语义
  混在同一张表里，partial 合并与否决无法共存。
references:
  - docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md
  - openspec/changes/mdop-kernel/design.md（D1、D3）
  - DECISIONS.md（D10、D12、D-CN-4、D-DB-1）
  - ARCHITECTURE.md（双平面与 MDOP 内核）
code_markers:
  - packages/database/src/control-plane/mdop/
  - apps/api/src/mdop/
```

### D-MDOP-2：平台作为合约明示的 C3 接收方与合并方（P1 修订）

```yaml decision
id: D-MDOP-2
title: 平台以「合约明示的 C3 接收方与合并方」身份接收并合并结果；P1 对 C0/C2 仍然严格成立
status: accepted
date: 2026-09
context: |
  MDOP v0.1 的 P1 原则要求数据不默认流向平台。此前平台的编排器天然看过每个节点的中间
  结果，这与 P1 名不副实。跨院合并（如四格表汇总）总得有一个合并方，用户裁决由平台担任。
decision: |
  - 合并方是平台，但这是**合约写明、医院签过名**的接收方身份（D-MDOP-4 的接收方列表），
    不是平台的默认能力：合约接收方列表中没有平台时，C3 结果 MUST NOT 投递给平台。
  - 平台只在数据面接口接收 C3；平台上不存在接收 C0/C1/C2 的任何接口。合并阶段是 `system`
    算子，只接受 C3 输入，输出仍为 C3，经控制台交付给药企。
  - **P1 修订后的边界**：P1 对 C0 与 C2 仍然严格成立——平台上没有任何路径接收本地明文或
    受控流动等级的制品；放宽的只有 C3 与安全聚合后的总和（后者属后续变更）。
  否决：药企部署连接器接收 C3（用户裁决不采用）。
references:
  - docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md（P1 修订、流动等级 C0–C3）
  - openspec/changes/mdop-kernel/design.md（D7、D8）
  - DECISIONS.md（D1、D-MDOP-1）
code_markers:
  - apps/api/src/mdop/delivery/
```

### D-MDOP-3：参与方密钥自持、平台三钥分离、SM2 按 GM/T 0003

```yaml decision
id: D-MDOP-3
title: 参与方私钥一律本地生成；平台 CA 根钥/节点密钥/注册中心密钥三钥分离；全部 SM2 签名按 GM/T 0003（Z_A + DER）
status: accepted
date: 2026-09
context: |
  BREAKING。现状与 MDOP 的信任模型相反：一把明文存库的 CA 根钥同时签证书、任务和算法
  模块；注册时未提交公钥的医院由平台代生成私钥再下发——平台的信任根同时是参与方的信任根。
  SM2 用法也不合国标：不做 Z_A 预处理、签名是原始 r‖s，与外部互通或送检都会卡住。
decision: |
  - **参与方密钥自持**：连接器首次启动（或 `connector keygen`）在本地生成 SM2 密钥对，
    私钥以 0600 保存在本地文件；注册时**只提交公钥**，平台 CA 为其签发证书。删除
    `connector-admin.service.ts` 的代生成私钥路径，注册不带公钥即拒。
  - **平台三钥分离**（用途互斥）：CA 根钥只签/吊销证书；平台节点密钥签信封、执行凭证、
    吊销名单，并以合约一方身份副署合约；注册中心密钥签算子清单（同时承接 P-CTL-6 所说的
    「专用算法签名密钥」）。连接器在部署配置里固定三把公钥，按用途验签，用错密钥的对象一律拒绝。
  - **加密落库**：三把私钥以 SM4 加密后存库，密钥加密密钥来自 `PLATFORM_KEK`（配置 Vault
    则从 Vault 取）；生产环境缺少该密钥时平台拒绝启动。既有 `cp_ca_keypair` 明文迁移为密文。
  - **SM2 国标口径**：GM/T 0003.2 签名，带 Z_A 预处理，缺省用户 ID `1234567812345678`；
    签名值按 GM/T 0009 用 DER 编码；算法标识 `SM2-SM3`；`kid` 为公钥 SM3 的完整 64 位十六进制。
    覆盖证书、任务与信封、算法模块、结果背书、连接器请求签名。旧格式（不做 Z_A、原始 r‖s）
    只保留验签路径给切换前的历史对象（如链上元数据），线上链路 MUST NOT 接受旧格式——否则
    可被降级攻击。
  - 签名实现须与独立国密实现（gmssl 或 Tongsuo 命令行）双向交叉验证一致。
  否决：继续一钥签一切、只把根钥加密——节点密钥因高频使用而泄露会直接等同于 CA 泄露。
references:
  - docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md
  - openspec/changes/mdop-kernel/design.md（D4、D5）
  - openspec/changes/mdop-kernel/specs/participant-identity/spec.md
  - DECISIONS.md（D8、D-CN-2）
  - TRUST.md（CTL-26 平台三钥分离）
code_markers:
  - apps/api/src/runtime/participant-identity/ca.service.ts
  - packages/mdop/src/crypto/
```

### D-MDOP-4：合约由持有方签署并本地留存；旧合约不得用于 MDOP

```yaml decision
id: D-MDOP-4
title: MDOP 合约必须由提供方连接器用本院私钥签署、平台节点密钥副署，连接器本地留存全文；无持有方签名的旧合约 fail-closed
status: accepted
date: 2026-09
context: |
  现状里医院的「批准」只是平台网页上的一次登录操作，合约没有任何一方的密码学签名；
  连接器不存合约，只按平台随任务下发的快照校验，撤销后也看不到。要满足「医院的数据只在
  医院自己签过名的计划下被使用」，合约必须先成为可被本地验证的授权载体。
decision: |
  - 规范化合约（JCS）在现有要素之外增加：接收方列表 `[{party, role: merger|final, jurisdiction}]`
    （平台以 `merger` 身份显式列入）、用途编码、允许的算子摘要、复核方式（`auto|manual`）与时限、
    伦理要求（批件号与有效期）、提供方连接器公钥指纹、平台节点公钥指纹、预审快照哈希。
  - 签署流程：医院网页批准 → 平台发 `ContractOffer` → 连接器本地确认（人工走仅限院内访问的
    端点或 CLI；自动确认须本地策略文件显式允许，签名记录标注 `review=auto(policy)`）→ 连接器
    用本院私钥签 `ContractAgree` → 平台验签后用节点密钥副署并激活。连接器本地库保存全文与双方签名。
  - **复核只认本地副本**：片段要约随附的合约内容一律不采信，与本地副本不符按本地副本判定。
  - **撤销**：医院本地撤销立即生效（本地权威），不以平台是否送达为前提；平台撤销则发
    `ContractTerminate`。两种撤销都让引用该合约且未进终态的 MDOP 作业进入 `ABORTED` 并触发销毁。
  - **旧合约**（无持有方签名）继续服务旧管线，但用于 MDOP 作业报 `E_CONTRACT_UNSIGNED`，
    不设宽限期，与 D-CMP-2 同一 fail-closed 原则。
  - **如实边界**：药企的同意本期仍是平台记录的知悉哈希，不是密码学签名。
references:
  - openspec/changes/mdop-kernel/design.md（D6）
  - openspec/changes/mdop-kernel/specs/digital-contract/spec.md
  - DECISIONS.md（D-CMP-2、D-DC-1、D-MDOP-3）
code_markers:
  - apps/api/src/runtime/digital-contract/contract.service.ts
  - apps/connector/src/mdop/contract-store.ts
```

### D-MDOP-5：算子 kind 三类 + 连接器本地白名单

```yaml decision
id: D-MDOP-5
title: 算子分 wasm/oci/system 三类；分析逻辑只许 wasm|oci；连接器本地白名单缺省为空、平台无权远程修改
status: accepted
date: 2026-09
context: |
  现状里能被合约固定的算子只有 L1.5 一个 Wasm 模块，其余是连接器里按 analysisType 写死的
  内置实现——平台能在同一份合约下换算子，与「合约固定算法」的目标冲突。D-CN-5 建立了第三方
  Wasm 模块的准入，但尚未与执行模型统一。
decision: |
  - 每个算子以清单登记在注册中心，由注册中心密钥签名。`kind` 取 `wasm|oci|system`：
    `wasm` 摘要为模块 SM3（沿用 D-CN-5 的源码复现与五道闸）；`oci` 摘要为镜像 digest，
    **本期不启用**（引用即编译失败）；`system` 是连接器或平台自带的机制，以 `id@version`
    加组件构建版本标识。
  - 承载受托分析逻辑的算子 MUST 是 `wasm` 或 `oci`；`system` 只许属于 `source`、`declassify`、
    合并三类机制，MUST NOT 承载分析逻辑。非 `declassify` 算子的输出规则 MUST 为 `inherit`。
  - **本地白名单**：每个连接器维护自己的白名单存本地表，**缺省为空**；只能由医院在本地用 CLI
    按摘要加入/移除，平台 MUST NOT 有远程修改白名单的途径（平台消息里夹带加白内容一律忽略）。
    复核与执行都要求摘要在白名单内且未被吊销、清单签名有效，否则 `E_OP_NOT_WHITELISTED`。
  - **吊销名单**由平台节点密钥签名、随长轮询下发；连接器验签、落盘、版本单调递增。启动后
    在收到并验过一份有效名单之前，拒绝执行任何 `wasm` 算子。被吊销的算子以 `E_OP_REVOKED` 拒绝。
  - **能力通告**：连接器启动时与每次心跳发送 `CapabilityAdvertise`（运行时、system 算子版本、
    白名单摘要集合、TEE 能力、协同协议版本）；编译器只把阶段放在通告了所需能力的节点上。
  否决：继续以合约固定的 SM3 为准、不设白名单——那样平台能在同一份合约下换算子。
references:
  - openspec/changes/mdop-kernel/design.md（D9）
  - openspec/changes/mdop-kernel/specs/operator-registry/spec.md
  - DECISIONS.md（D-CN-2、D-CN-5）
  - TRUST.md（P-CTL-6、CTL-24）
code_markers:
  - packages/mdop/src/operator/
  - apps/connector/src/mdop/whitelist.ts
```

### D-MDOP-6：C2 与可信空间节点在协议中保留，硬件 TEE 到位前关闭

```yaml decision
id: D-MDOP-6
title: C1/C2 与可信空间节点在协议里保留完整语义，本期编译器一律报能力不符；执行环境如实标注不变（D9）
status: accepted
date: 2026-09
context: |
  流动等级格中 C1（密态）与 C2（受控流动）的语义依赖尚未落地的机制：C1 需要安全聚合/
  同态或 MPC，C2 需要硬件远程证明的可信空间节点。协议若因尚未落地就把它们删掉，后续接入
  会破坏标签格的语义基础；平台又不该假装具备。
decision: |
  - 协议（MDOP v0.2）保留 C1、C2 的完整定义与传播规则：C1 只允许在同一协议实例的参与方
    之间流动；C2 只允许流向通过远程证明且满足合约证明策略的可信空间节点；C1 与 C2 互不可比；
    同时有 C1 与 C2 输入时输出判为 C0。
  - **本期开关**：没有任何节点通告 TEE 能力或协同协议，编译器对 C1/C2 边一律报
    `E_CAPABILITY_MISMATCH`；`E_CAPABILITY_MISMATCH` 在本期也承担「证明度量不符时 KMS 拒绝
    释放密钥」的代偿项，后者随可信空间节点的变更补测。
  - **不改变 D9**：执行环境（`attestationLevel`）仍恒为 software，如实标注；C2 的「可信空间
    节点」不表示本期已具备硬件 TEE，也不得据此宣称 TEE attestation。
  - 身份锚脱离平台（did:web / 国家身份基础设施）与 TLCP 仍属后续。

  **落地补注（2026-09-25，tee-confidential-node）——开启 C2 的方向已定，开关当日仍未打开
  （2026-09-26 已翻转，见下方「开关翻转」）**：
  协议 §4.5 已补出「聚合出域（C3）与可信空间节点（C2）」的适用性对照（可分解性判据 +
  四个典型例子 + 代价对照），业务侧确有四类问题在 C3 上无解（跨节点主体配对、亚组与切点
  重算、非线性/影像模型、受预算约束的探索），且硬件前提（海光 CSV / TDX / SEV-SNP + 证明链）
  已具备。据此**决定开启 C2**，但设三条硬前提，缺一不落地：
  ① **运营方与密钥释放权分离**（见 D-TEE-1）；② **查询预算与发布审查在节点内由被测代码
  强制**（见 D-TEE-2）；③ 不得表述为「数据没有出医院」——换的是信任锚，合规定性为委托处理/
  数据出域（REGULATORY REG-08 已扩展）。
  **实现状态**：本补注只登记方向与前提；本决策正文里「一律报 `E_CAPABILITY_MISMATCH`」的
  开关**仍未打开**，须与内核代码同步翻转（`openspec/changes/tee-confidential-node`）。
  在此之前，任何节点都必须继续如实通告「无 TEE 能力」。

  **开关翻转（2026-09-26，与内核代码同批，tee-confidential-node §1.1b）——翻转的是判定方式，
  不是能力**：本决策正文里「一律报 `E_CAPABILITY_MISMATCH`」的判定已改为「**目标节点的证明登记
  有效、且与合约证明策略相符，才可放置 C2 阶段**」，三段 enforcement 缺任一项仍 fail-closed：
  ① 平台放置判定 `MdopJobsService#assertC2Target` → `MdopAttestationService#assertUsableForC2`
  （无登记/已过期/链型不在策略内/度量不在生效白名单/TCB 低于下限，逐项拒）；
  ② 编译期边校验 `packages/mdop/src/label/lattice.ts#validateEdge` 的 C2 分支（目标未通告 `tee`
  或不在合约策略内即拒）；③ 节点侧能力通告 `apps/connector/src/tee-node/providers.ts#nodeCapabilityAdvertisement`
  **真跑一次证明**得出（不读配置里写的机型）。
  **部署层仍是零**：翻转后没有任何硬件节点时，没有任何节点会通告 `tee{kind}`（软件提供者恒
  `tee: null`），C2 边在任何真实部署里仍被拒。且「**软件实现不得作为 C2 目标**」由三处独立保证：
  背书只接受硬件链型（`packages/mdop/src/attestation/push.ts`，出现 `software` 一律拒）、
  能力通告取自真跑证明（配置写着 `tdx` 也骗不过编译器）、连接器恒通告 `tee: null`
  （数据持有方不是可信空间节点，`apps/connector/src/mdop/operator-whitelist.ts#capabilityAdvertise`）。
  因此「开关已翻转」MUST NOT 被读作「已具备机密计算能力」：D9 的如实标注口径不变，部署前仍须按
  `DEPLOY.md §4.3` 核实硬件证明与 KMS 归属（真实实现未落地，见 TRUST P-CTL-8 转正条件）。
references:
  - docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md
  - openspec/changes/mdop-kernel/design.md（D7、Goals/Non-Goals）
  - DECISIONS.md（D1、D9）
  - TRUST.md（CTL-09、P-CTL-2）
code_markers:
  - packages/mdop/src/label/
```

### D-TEE-1：可信空间节点的运营方与密钥释放权分离

```yaml decision
id: D-TEE-1
title: 可信空间节点运营权与数据密钥释放权必须分离；默认由中立第三方/监管侧运营，平台永不接触数据密钥
status: accepted
date: 2026-09-25
context: |
  C2 把数据送到「通过远程证明的可信空间节点」执行，但 TEE 只解决「运营方看不到内存」，
  不解决「谁有权解密、谁能决定在哪个度量下解密」。若同一个主体既运营节点又持有数据密钥，
  TEE 的隔离收益会被运营方的引导/固件/运维权限吃掉；若平台参与密钥释放，平台就成了绕过
  TEE 的超级节点。医院侧对「药企自建节点」的接受度普遍很低，这一条决定方案能否签下来，
  比技术选型更前置。
decision: |
  - **分离原则**：节点运营权与数据密钥释放权 MUST 分离。平台 MUST NOT 持有、请求或缓存
    数据密钥，MUST NOT 存在绕过 KMS 取解密能力的路径。
  - **默认归属**：节点由**中立第三方或监管侧**运营；药企作为申请方使用算力但不持有密钥；
    KMS 由数据持有方（医院）自建，或与节点运营方共管（门限/双签）。
  - **药企自建节点的门槛**：须医院**书面接受**，且同时满足 ① KMS 归持有方或共管；
    ② 节点运维权限（引导、固件更新、主机 root）纳入合约与审计范围。
  - **密钥释放的判据**（缺一不释放）：证明链到厂商根有效；度量在允许清单（白名单来自注册
    中心，与算子清单同一套签名与吊销）；TCB ≥ 合约 `min_tcb`；证明未过期（缺省 10 分钟、
    每次会话重新证明）；执行凭证签名完整且在有效期；合约未终止；`key_id` 属于本作业片段。
  - 释放一律用证明报告中的**一次性公钥**加密返回；密钥只存在于该实例内存，实例退出即失效。
  - 失败 MUST 返回明确错误码（`E_ATTESTATION_FAILED` / `E_MEASUREMENT_NOT_ALLOWED` /
    `E_TCB_TOO_OLD` / `E_KEY_RELEASE_DENIED`），MUST NOT 回退到明文、旧密钥或跳过校验。
references:
  - docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md（§4.5、§9.3、§9.4）
  - openspec/changes/tee-confidential-node/design.md（D1、D4）
  - TRUST.md（P-CTL-8）
code_markers:
  - packages/mdop/src/label/
```

### D-TEE-3：证明链选型（条件式默认；公开资料推断，未实测）

```yaml decision
id: D-TEE-3
title: C2 证明链选型：有信创硬要求则 CSV 优先、云上机型仅作开发床；否则云上 TDX 先打通、CSV 并行申请
status: accepted
date: 2026-09-25
context: |
  C2 落地必须先定证明链（海光 CSV / Intel TDX / AMD SEV-SNP），它决定能不能买到机器、证明服务怎么接、
  KMS 怎么验、以及未来换链要不要动协议。**试点期内没有拿到机器**，因此本决策只能基于公开资料，
  证据等级在 `openspec/changes/tee-attestation-pilot/design.md` 的「P1 候选矩阵」里逐格标注
  （`[公开资料]` / `[未核实]` / `[需申请]` / `[本仓已验证]`），并附来源清单。
  唯一**本仓已验证**的一格是「换链成本」：三种链的原生 quote 都能映射到同一份证明契约
  （`packages/mdop` 的 `mapVendorQuote` + 用例），换链只换提供者与信任根配置。
  > **补注（2026-09-26，公开资料补检索）**：P1 矩阵的「可获得性」一格已从「云上都有路径」推进到
  > **具体机型代号/区域路径**（阿里云第八代企业级 ECS 集成 Intel TDX；Azure 机密 VM SKU
  > `DCesv5/DCedsv5/ECesv5/ECedsv5` 与新一代 `DCesv6/ECesv6`；GCP Confidential VM on `C3`；
  > SEV-SNP 对应 Azure `DCasv5/ECasv5`；CSV 整机以海光 3/4 号 CPU 为主）。
  > **这不改变本决策的状态**：机器与配额仍要走采购/审批，**开通周期与审批要求仍是 `[需申请]`**，
  > 「院内无外网时证明可达性」**仅当节点部署在院内时**才仍是未落地的工程前置
  > （云上默认形态 collateral 可在线取，2026-09-27 补注）——因此本决策**仍是公开资料推断、不是实测**，
  > 解除条件（拿到机器出一次真实 quote）不变。来源与检索日见 pilot design 的 P1 来源清单。
decision: |
  - **条件式默认**（两条，按甲方/医院是否有信创硬要求切换）：
    ① **有信创/国产化硬要求** → **海光 CSV 优先**；云上 TDX/SEV 机型**仅作开发床**，不得据其下生产结论。
    ② **无信创要求、试点期要快速点亮** → 先用**云上 Intel TDX** 打通端到端（DCAP 校验路径最清晰、有托管校验服务），
       **CSV 作为生产目标并行申请**。
  - **共同前置（缺一不动工）**：① **仅当节点部署在院内时**才是动工前前置：院内无外网是该部署形态的常见约束，必须先解决「证明服务可达性」或「证明凭据的离线核验」——
    **2026-09-25 追加检索后，三家的可自托管路径都已明确**（TDX：PCCS 私有化 + 预取 collateral 完全离线校验；
    CSV：自托管 CoCo trustee `attestation-service` + RVPS 参考值；SEV-SNP：缓存 VCEK→ASK→ARK 后离线验签，证据为非厂商权威），
    但**两条残余项必须在院内部署前落地**：**collateral 新鲜度策略**（CRL/QVL/VCEK 轮换与 TCB 恢复 →
    定离线刷新窗口 + **过期即拒**，KMS 侧真实信任根实现必须带 collateral 有效期）与**厂商根获取程序**（带入院内须留档）。
    **云上默认形态** collateral 可在**线**取（TDX 走 PCCS/Intel PCS；CSV 走厂商证明服务/自托管 trustee；SEV-SNP 走 AMD KDS），
    此时离线预取与离线刷新窗口**不是**共同前置（2026-09-27 补注，与 pilot design §P4 / TRUST P-CTL-8 收齐）；
    ② 运营方与 KMS 归属按 D-TEE-1 定；③ 查询预算与发布审查按 D-TEE-2 在节点内强制。
  - **collateral 新鲜度的判据已落地（2026-09-26 补）**：`AttestationReport.collateral` 进证明契约
    （种类 / 摘要 / 取回时间 / 自身有效期，严格解析）；`TrustedRootWithCollateral` 把「必须随带的种类 +
    离线刷新窗口（分钟）」做成真实信任根的**必填字段**，`createHardwareAttestationVerifier` 产出
    「验 quote + 判材料时效」的校验器——缺料 / 已过 `next_update` / 超出刷新窗口 / 时间倒挂一律拒
    （`E_ATTESTATION_FAILED`，KMS 不释放密钥）。**残余的只是运维动作**：谁多久进院内网刷新一次、
    厂商根怎么带进来并留档（本决策共同前置的第 2 条），代码侧不再有缺口。
  - **解除条件（何时算实测）**：拿到任一候选的机器并出**一次真实 quote**、走通「证明 → KMS 释放 → 节点内执行 → 只出 C3 → 锚定」，
    本决策的对应分支才可标为「已实测」；在那之前，对外只能表述为「基于公开资料的推断」。
  - **保留多链能力**：合约的 `min_tcb` 支持按链给出；**跨链 TCB 版本不可互比**（CSV 年月 vs TDX/SEV 点分数字），
    不可比一律 fail-closed——这一点已由单测钉住，属本仓已定规则而非待定项。
references:
  - openspec/changes/tee-attestation-pilot/design.md（P1 候选矩阵与来源清单）
  - openspec/changes/tee-confidential-node/design.md（D1 运营方与密钥释放权、D3 证明与度量）
  - DECISIONS.md（D-MDOP-6、D9、D-TEE-1、D-TEE-2）
code_markers:
  - packages/mdop/src/attestation/
```

### D-TEE-4：首个 C2 业务场景首选「跨院队列交集」，备选「亚组与切点重算」

```yaml decision
id: D-TEE-4
title: C2 首个场景首选跨院队列交集（需可对齐假名键）；亚组重算仅作备选且不得单独论证 C2；价值项标为推断
status: accepted
date: 2026-09-25
context: |
  Q4 要回答「C2 的第一个真实增量能力做什么」。两个候选：**A 跨院队列交集**（药物警戒：
  A 院只有暴露、B 院只有结局，须按主体把两边接起来）与 **B 亚组与切点重算**（RWS 分层）。
  判定标准不是「哪个好做」，而是**这件事在 C3 上是否真的无解**（协议 §4.5.1 的可分解性判据）：
  能用 C3 解决的，不得使用 C2。本仓已核实的证据：
  - **现有合成数据里没有「同一主体跨院出现」**：`data/rws-test-data/records.json` 的主体键是
    院级作用域（`huashan-syn-*` / `ruijin-syn-*`），两院各 5000 条无一条跨院；
    `data/synthetic/amr/{huashan,ruijin}/episodes.jsonl` 的 subjectKey 交集为 **0**。
    因此 A 的形态必须**专门构造**，且必须配一个「可对齐假名键」方案（跨院 PSI 或全空间共享盐）。
  - **A 可在合成数据上闭环（已跑通）**：`apps/connector/src/mdop/node/c2-session.spec.ts` 用共享假名键
    构造两院队列，跑通「封存 → 证明 → KMS 释放 → 解封 → 节点内配对 → 发布审查 → 只出 C3 →
    回执成链 → 销毁」，并用 `joinableBounds` 断言同一问题只用两院边际计数时**不可判定区间宽度 > 0**
    （即「C3 不是精度不够，而是信息不存在」）。
  - **业务输入不足**：药物警戒岗访谈清单（`rws-analytics-ladder/oq3b-pv-interview.md` 第 10 条）
    明确「个案不跨院，下钻只能在源医院本地」——配对/下钻类需求真实存在但在 C3 上被结构性排除；
    但**未取得业务方对价值的书面确认**，故价值项按推断登记。
decision: |
  - **首选（A）跨院队列交集**：唯一一类 C3 **数学上无解**、C2 才有意义的问题（协议 §4.5.2(1)）。
    落地形态：节点内**主体配对**算子（协议 §5.1 只许 `wasm`/`oci` 承载分析逻辑，category `collab`）
    + 可对齐假名键 + 查询预算约束下的亚组出表。
  - **备选（B）亚组与切点重算**：C3 下须重跑整个作业（编译 → 要约 → 复核 → 凭证），C2 下同会话出表；
    价值在于研究迭代效率，**不是能力增量**——不得用它单独论证 C2 的必要性。它的用处是作为
    「节点内执行 + 预算 + 发布审查」的第一条演示链路（工程量最小、与既有节点能力复用度最高）。
  - **前置条件（缺一不启动真实数据）**：① REG 路径与医院**书面接受**运营方与 KMS 归属（REG-08）；
    ② **可对齐假名键**方案定稿，且医院接受该对齐基础设施（PSI 或共享盐，二者合规复杂度不同）；
    ③ 配对算子的 wasm 模块入库并由注册中心签发清单（本仓已落地语义与会话装配，模块入库待做）；
    ④ 查询预算与发布审查在节点内由被测代码强制（D-TEE-2，已落地并有用例）。
  - **如实边界**：③④ 是代码项（已到「语义 + 装配 + 守卫 + 用例」）；①② 是合规与方案项。
    在 ② 未定之前，**只跑合成数据**，不得据其下真实数据结论。
  - **排期对齐**：A 落在 `tee-confidential-node` 迁移步骤 4（两院 C2 汇聚）与步骤 6（真实数据前合规闸）
    之间；§9.3 的真实数据演练必须排在 ①② 完成之后。
references:
  - openspec/changes/tee-attestation-pilot/design.md（P2：Q4 判据、打分与候选）
  - openspec/changes/tee-confidential-node/design.md（迁移步骤 4/6、D5 首个场景）
  - docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md（§4.5 出域形态的适用性）
  - TRUST.md（P-CTL-8）、REGULATORY.md（REG-08）
code_markers:
  - apps/connector/src/mdop/node/pairing.ts
  - apps/connector/src/mdop/node/node-session.ts
```

### D-TEE-5：可信空间节点接受凭证时签入的是「执行环境快照」

```yaml decision
id: D-TEE-5
title: 可信空间节点的接受签名签入执行环境快照（算子摘要 + 期望 + 本节点当下证明能力），环境漂移即停
status: accepted
date: 2026-09-25
context: |
  协议 §7.5 要求「各持有方在接受时计算本节点快照标识，与凭证核心一起签名」，执行时重算比对，
  不一致即 `E_SNAPSHOT_CHANGED`。这套语义是为**数据持有方**设计的：它签的是数据快照（文件字节 SM3 /
  库快照 id），数据在要约与执行之间变了就必须重新确认。
  可信空间节点成为一等参与方后（它的片段同样要被复核与签名接受，否则平台收不齐签名、凭证签不出来），
  一个问题必须回答清楚：**节点签什么**？节点在要约时刻**没有任何数据**——封存信封要到执行阶段
  才由平台中继送来；签一个恒定值等于放弃这一项校验，签一个凭空的「数据快照」是编造。
decision: |
  - **节点签「执行环境快照」**：`SM3(JCS({ node, stages[{id,op,op_digest}], tee{kind,min_tcb}, expectation{tee,measurement,min_tcb} }))`。
    含义是「本节点在这份片段、这份代码、这条链与这个可信基上接受该计划」——它把**接受签名钉在具体片段与
    期望**上，而不是签一个恒等于自己的值。
  - **执行前用当下的能力通告重算**并比对；对不上即 `E_SNAPSHOT_CHANGED`，作业须重新要约与签发凭证。
    因此**环境漂移会被拦住**：本节点换了链型、可信基变了（固件/微码升级、被救援过的机器）都不再照跑——
    持有方批准的是特定环境下执行，环境变了意味着原先的批准失去依据。宁可让人重新确认一次。
  - **这不是第二道环境闸门**：环境本身由**更强**的一道把关——会话解封时的证明 + KMS 释放凭据
    （`packages/mdop` 的 `verifyC2Execution`：链型 / 度量 / TCB 下限 / 与凭证期望一致 / 凭据未过期）。
    快照这一道是**声明层的绑定**（签名覆盖到片段与期望），两道都要过，谁都不能替代谁。
  - **节点与持有方在复核上的另一处差异**（一并登记，避免后人以为两侧应当逐条相同）：
    `dp_budget` —— 持有方本地无账本，一律拒（`E_BUDGET_EXCEEDED`）；**节点有账本**
    （`node/budget-ledger.ts`，D-TEE-2 要求由被测代码强制），因此**可以接受**预算申请，
    由节点在执行/出口时assert→charge。
references:
  - docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md（§7.4 复核、§7.5 凭证与快照）
  - openspec/changes/tee-confidential-node/tasks.md（§3.17 节点消息处理、§3.12 首个场景）
  - DECISIONS.md（D-TEE-2 预算与发布审查在节点内强制）
code_markers:
  - apps/connector/src/tee-node/fragment-review.ts
  - apps/connector/src/tee-node/node-messages.ts
```

### D-TEE-6：作业之前的证明登记由「校验方推送背书」产生（部署侧接口）

```yaml decision
id: D-TEE-6
title: 作业之前的证明登记＝白名单校验方签名推送背书（平台仍不自己验 quote）；不支持放宽编译期判定
status: accepted
date: 2026-09-25
context: |
  编译期放置 C2 的前置是「目标节点有一份**未过期**的证明登记」（`MdopAttestationService.assertUsableForC2`），
  要约时刻还会再核一次。但本仓**唯一的登记生产者**是节点自己上报的**会话见证**，而见证来自一次
  **作业绑定**的 KMS 密钥释放（`evaluateKeyRelease` 要 job/credential/key_id）——作业还没编译就不存在释放。
  于是除「刚跑完一次会话的窗口内」，**任何**作业都会在编译期被判 `E_ATTESTATION_FAILED`（不只是首个）。
  三个候选：**A 校验方推送**（部署侧接口 + 部署密钥签名）；**B 心跳带校验方背书**（节点转交 KMS 对摘要的签名）；
  **C 放宽编译期判定**（接受「距上次成功会话不超过 X」的旧登记）。
decision: |
  - **选 A（校验方推送）**：部署白名单内的校验方（KMS / 证明服务）对证明摘要签名后推送到平台的
    **部署侧接口**（`POST /api/v1/mdop/attestations`，与其它 mdop 管理接口同守卫），平台用**部署配置的
    KMS 公钥**验签（`MDOP_KMS_PUBKEY`），再走既有 `register`（白名单 / 链型 / 度量清单 / 有效期 / 幂等）。
    共享判据在协议核 `packages/mdop/src/attestation/push.ts`（签名覆盖 `{verifier, endorsement}` 整体）。
  - **为什么不是 B**：B 要往参与方消息表里加一种消息（协议面变大），而 A 复用部署侧已有的管理面与
    已配置的 KMS 公钥——**平台仍不自己验 quote**，§5.1 的分工不变。
  - **为什么 C 被否决**：它把 fail-closed 的放置判定换成「最近看起来还行」，等于用一个时间窗近似
    一份证明。真遇到机器被救援、固件回退、密钥泄露，正是这条近似会放过。
  - **节点这一半**：`tee-node/attestation-probe.ts` —— 真跑一次证明 → 带节点签名交给校验方；
    **校验方回传的背书由节点自己验**（部署配置的校验方公钥），并核对背书绑定的 `node` 与 `quote_digest`
    就是本次这份证明。否则「它说验过了」只是一句无法核对的转述。
  - **效期与节拍**：背书有效期由校验方按部署策略给（分钟～小时级，`expiresAt` 进入签名），
    部署方的探针节拍必须**短于**该有效期，否则作业又会在编译期被拒。两者一起写进 DEPLOY §4.3。
  - **如实边界**：本仓落的是**判据与两侧接口**（协议核 5 条 + 平台 5 条 + 节点探针 6 条用例）；
    真实 KMS / 证明服务未接，因此 `verifier` 目前只是配置里的一个标识、签名由替身密钥产生。
    这不改变「C2 未上线」的结论。
references:
  - openspec/changes/tee-confidential-node/design.md（Open Questions 第 7 条：三候选与取舍）
  - openspec/changes/tee-confidential-node/tasks.md（§5.9）
  - docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md（§9.4 登记与释放）
  - DEPLOY.md §4.3（上线步骤与探针节拍）
code_markers:
  - packages/mdop/src/attestation/push.ts
  - apps/api/src/mdop/mdop-attestation.service.ts
  - apps/connector/src/tee-node/attestation-probe.ts
```

### D-TEE-2：查询预算与发布审查在可信空间节点内由被测代码强制

```yaml decision
id: D-TEE-2
title: C2 节点内的 DP、发布审查与查询预算由被测代码强制，不依赖运营方自觉
status: accepted
date: 2026-09-25
context: |
  C2 让申请方获得了「对一个可解密环境提问」的能力。若没有预算与一次性约束，申请方可以用
  大量各自合法的小统计量反推个体（差分攻击、亚组反复切分）——后果与直接出明细同级，而
  且这条路径看起来完全合规。协议 §10.1/§10.2 已要求预算账本与发布审查，但「由谁强制」在
  C2 场景下是新问题：运营方是既得利益方，不能由它自觉执行。
decision: |
  - 小单元格抑制与二次抑制、差分隐私加噪、查询预算记账与超限拒绝，MUST 在可信空间节点
    **内部执行**，且 MUST 是被测代码（度量进入凭证与证明）的一部分。
  - 预算以「数据集 × 快照版本」计量，上限在合约中约定；账本以**持有方本地账本为准**，
    节点侧副本仅用于执行时判定；亚组与切点重算计入预算。
  - 节点 MUST 检测差分查询（相似条件多次查询）与同一申请方的累计输出，并按合约处置。
  - 出域 MUST 只有经发布审查的 C3；节点内 C0/C1 MUST NOT 回流到原持有方以外的节点。
  - 缺少上述任一机制时，C2 MUST 保持关闭（fail-closed）——「先开通道、后补预算」不被接受。
references:
  - docs/医疗数据跨节点算子编排协议规范（MDOP）v0.2.md（§4.5.4、§10.1、§10.2）
  - openspec/changes/tee-confidential-node/design.md（D6、D8）
  - TRUST.md（P-CTL-3、P-CTL-8）
code_markers:
  - packages/mdop/src/label/
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
