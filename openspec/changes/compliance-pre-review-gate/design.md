## Context

- **流程现状**：数据产品（`cp_data_product`，医院挂牌）→ 数字合约（药企 `request` 生成草稿 → `acknowledge` 知悉规则 → 医院 `approveDraft` 签发，`canonical()` 后算 SM3，存证上链）→ 任务（RWS、FL 预测、SecretFlow 各有自己的 `admit()`，都按合约准入；连接器端 PEP 再校验一遍）。
- **预审现状**：`composition` 与 `compliance_evaluation` 存在**主库**（与能力注册表同库），合约存在**控制面 SQLite**（`cp_*`）。两者在 DOMAIN 中同属 control-plane 平面，但物理上是两个库。`CreateCompositionDto` 只校验字段类型。引擎（`compliance-engine.ts`）有三个问题：`overallRisk` 直接取场景声明的风险，维度不会上调；保障级只在 high 时强制；`approvalRules` 没有参与判定。只有 SecretFlow 编排器在请求体带 `compositionId` 时才调用引擎，而前端从未传过。
- **可用于推导风险维度的事实**：
  - 数据产品的 `classificationTag`（NDI-TR-2025-06，等级 1–4 + 类别编码）；
  - 一个任务涉及的合约与医院集合；
  - 能力注册表的落地状态（`status`）。
- **约束**：
  - 主库与控制面 SQLite 是两个物理库，不能建外键，只能按值引用；
  - 合约哈希存证后内容不可变，要改只能新建合约；
  - 控制面 SQLite 在 api 容器内，重建即回到种子数据（ali29）。

## Goals / Non-Goals

**Goals:**
- 预审成为流程的一部分：合约层绑定，任务层复核，全程 fail-closed。
- 风险维度以事实为准，并记录来源；引擎语义在作为闸门之前先改正确。
- 裁决快照计入合约哈希，事后可以审计：当时依据的是哪一版规则、哪些维度。

**Non-Goals:**
- 不重写 L2 规则体系，不做通用的审批工作流引擎（需审批由医院签发时确认即可）。
- 不改连接器端 PEP（平台侧准入已经覆盖；连接器侧校验预审留作后续）。
- 不追溯改动已签发的合约：旧合约只是不能再用来创建新任务。

## Decisions

### D1 两级：合约层绑定 + 任务层复核
**合约层绑定：** 药企 `request` 时必须带 `compositionId`。平台做三件事：
- 校验这份预审属于该药企；
- 按当前规则、结合推导维度重新裁决；
- 把裁决快照写进草稿。

裁决为驳回，拒绝生成草稿。医院 `approveDraft` 时看得到快照；如果裁决为需审批，必须显式确认并填写理由。

**任务层复核：** 每类任务的 `admit()` 都对每份合约调用同一个 `PreReviewGate.check(contract, task)`，做三件事：
- 确认合约有快照；
- 检查任务范围；
- 用任务层才知道的事实（实际涉及的医院数）重新评估。

**为什么两级都要：** 合约是授权的载体，由医院审批，天然是需审批的承接点。但规则可能在签发后收紧，任务的真实范围也要到创建任务时才知道。
- **备选：只在任务层把关**。需审批找不到自然的审批人，医院也看不到预审。不采用。
- **备选：只在合约层把关**。挡不住规则变化和越界使用。不采用。

### D2 跨库按值快照，计入合约哈希
合约新增 `preReview`（simple-json）：
```
{ compositionId, evaluationId, verdict, overallRisk, required,
  dimensions: { participantCount, dataSensitivity, humanGeneticResources, crossBorder },
  dimensionSources: { <维度>: "derived" | "declared" },
  dimensionConflicts: [ ... ],   // 自报比推导低风险的维度
  rulesDigest,                    // 当次装载的 L2 规则经 stableStringify 后的 SM3
  evaluatedAt }
```
另有确认字段 `preReviewAck: { by, reason, at } | null`。两者都进 `canonical()`。
- 不建跨库外键。主库里的预审将来即使被删改，合约里的快照仍能说明当时的依据。
- **备选：只存 `compositionId` 外键**。跨库无法建外键，而且无法防止事后篡改。不采用。

### D3 风险维度事实优先，并标注来源
**合约层能推导的维度：**
- `dataSensitivity` ← 数据产品 `classificationTag.level`；
- `humanGeneticResources` ← 类别编码对照表（有对照才推导）。

**任务层能推导的维度：**
- `participantCount` ← 任务涉及的不同医院数。

**规则：**
- 有推导值就用推导值；没有才用自报值，并标为 `declared`。
- 自报值比推导值风险更低时，记入 `dimensionConflicts` 并给出警告（疑似低报）。
- `crossBorder` 暂无事实来源，标为 `declared`。

**备选：继续全部自报**。这等于让申请方自己给自己打分，不采用。

### D4 任务范围检查：分析类型对应能力对象，用数据维护
在能力对象的 `metadata.analysisTypes` 上登记它能支撑哪些分析类型，由种子叠加层写入，运营方可以维护。

规则：任务的分析类型，必须至少被预审里的一个 **L3 模型**覆盖。例如：
- `disproportionality` ← `disproportionality-prr-ror`
- `comparative-effect` ← `mantel-haenszel-or` / `logistic-regression`
- `causal-*` ← `cox-ph` / `kaplan-meier-estimator` / `logistic-regression`
- SecretFlow 训练 ← `federated-learning` 这一类

没有登记对应关系的分析类型一律拒绝（fail-closed），提示「分析类型未登记能力映射」。

**备选：不做范围检查**。一份为比值计数预审的合约，就能被拿去做联邦训练，形成越界。不采用。

### D5 引擎修正：维度上调风险，各级强制保障级
- **维度上调风险**：`overallRisk = max(场景声明风险, 维度风险)`。维度风险按 `risk-high` 的判定标准写成代码谓词：参与机构 ≥ 3、含人类遗传资源 → high。判定标准的原文仍然作为数据里的说明。
- **保障级强制**：新增阻断规则 `block-security-below-required`，所选协议推出的保障级低于该风险等级要求时，一律阻断，不再只限于 high。
- **`approvalRules`**：这次不接入。它的条件已经被阻断谓词和 `approvalRequired` 覆盖，登记为数据说明即可。

**保障级口径已按 D-CMP-1 确定**：新增 `federated`（数据不出域 + 输出闸门 + 全程审计），low → basic、medium → federated、high → enhanced。

### D6 需审批的确认
- `approveDraft` 增加入参 `preReviewAck: { reason }`。快照裁决为 `manual_review` 时必须提供，否则返回 400；裁决为 `auto_approve` 时不接受这个入参。
- 确认人就是签发合约的医院参与方，记入确认记录并计入哈希。

### D7 旧合约与演示种子
- 没有 `preReview` 的合约：可以查看、可以撤销，但**不能用于创建新任务**（fail-closed）。
- 演示种子合约在初始化时，为每份种子合约生成配套的种子预审并写入快照，保证 ali29 重建后（本来就会回到种子数据）演示链路仍然可用。
- 不提供「宽限期」开关，避免临时后门变成常驻后门。

### D8 SecretFlow 闸门改为从合约取预审
- 删掉请求体里的 `compositionId` 入口（前端从未使用），改为对每个 provider 方的合约调用同一个 `PreReviewGate`。三类任务只走同一条路径。

### D9 规则摘要与复评
- 每次裁决记录 `rulesDigest`。
- 任务层复评一律用当前规则：规则收紧立即生效，放宽也立即生效。
- 快照保留签发时的依据，供审计时比对。

## Risks / Trade-offs

- [强制保障级会导致所有真实任务被驳回] → 已按 D-CMP-1 采用 federated 口径：medium 由已落地的「联邦就地计算 + 输出闸门」满足；high 仍需 enhanced，在 enhanced 协议接入线上之前如实驳回。
- [参与机构 ≥ 3 升为 high 后，三院及以上的研究在没有 DP 和 enhanced 协议的情况下必然被驳回] → 这是规则的如实结果。上线前告知业务方，最终由 enhanced 协议和 DP 落地来解决。
- [主库预审被删除后，`compositionId` 指向不存在的记录] → 合约只依赖按值保存的快照，悬空的 ID 只影响回看原始组合。
- [旧合约不可用，打断用户已有流程] → 线上只有种子合约，种子会自动补快照；用户自建的合约需要重新申请，界面给出明确提示。
- [自报维度仍可能被低报，例如跨境] → 标为 `declared` 并留痕；等有了参与方注册地这类事实后改为推导。

## Migration Plan

1. 先改治理文档：FLOWS、DOMAIN、TRUST、DECISIONS（Q1 已登记为 D-CMP-1）。
2. 引擎与预审服务：服务端校验能力对象、维度推导、维度上调风险；强制保障级按 D-CMP-1 实现。
3. 合约：申请时带预审、快照计入哈希、需审批须确认、种子补快照。
4. 准入：抽出 `PreReviewGate`，接入 RWS、FL、SecretFlow 三处 `admit()`；删掉 SecretFlow 的 `compositionId` 入口。
5. 前端：预审页、申请合约、医院审批、任务创建页。
6. 演示结束后上线。重建 API 会回到种子数据，种子已带快照。**回滚**：换回上一版 API 和 web 镜像；新增的列都可为空，旧版代码会直接忽略。

## Open Questions

- **Q1 保障级口径 —— 已决（2026-09-19，采用 (b)，登记为 DECISIONS D-CMP-1）**：
  - (a) 按现行规则强制：在 CKKS 等 enhanced 协议接入线上之前，所有 medium 和 high 任务都会被驳回；
  - (b) **推荐**：新增介于 basic 和 enhanced 之间的保障级 `federated`，含义是「数据不出域 + 输出闸门 + 全程审计」，以一个代表「联邦就地计算 + 输出闸门」的已落地 L6 对象来满足；然后改为 medium 要求 `federated`、high 要求 `enhanced`。这是规则数据的变更，需要合规口径确认；
  - (c) 维持 medium 不强制：裁决与「合规要求」继续自相矛盾，不推荐。
- **Q2 需审批的确认人**：医院单独确认，还是医院加平台合规官双签？
- **Q3 人类遗传资源的推导来源**：需要 NDI-TR-2025-06 类别编码与人类遗传资源的对照表。拿到之前，该维度继续按自报处理并标注。
- **Q4 跨境维度的事实来源**：参与方注册地或数据出境申报记录。
