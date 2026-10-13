# 设计：MDOP 编排迁移（台账、单通道、闸门）

## 1. 目标与不变量

目标：让「旧管线逐步被 MDOP 接替」成为**可校验的状态机**，而不是文档里的承诺。迁移期结束后，每条分析类型恰好有一条执行通道，旧通道的代码被删除。

四条不变量（守护与评审都以此判红）：

- **I1 单通道**：任一分析类型在执行时刻恰好一条通道。不存在「先试 MDOP，失败回落旧通道」的运行时行为。
- **I2 只减不增**：`legacy` 条目数单调不增。任何变更想让某分析类型回到旧通道，等于新增 legacy = 红。
- **I3 一个作业一套表**：不双写、不过桥；旧表在迁移期只读。
- **I4 不新增出域**：迁移不改变任何 payload 分级与出域边（TRUST / FLOWS 既有声明为准）。

## 2. 先摆出要避免的形态

反面教材（本设计逐条封死）：

1. 「MDOP 开着就走 MDOP，否则走旧的」——两条通道同时可执行，同一研究可能被平台执行两次，链上存证无法判定哪条是结论来源；
2. MDOP 作业顺带在 `cp_rws_task` 落一行「兼容」记录——两套状态各自演进，partial/否决语义冲突（D-MDOP-1 已否决把 stageId 演进到 `cp_rws_assignment`）；
3. 前端把「旧通道」「MDOP 通道」并列成两个菜单项/两个详情页——A2 的现状，用户读到的是两种产品能力；
4. 为了对拍长期双跑——等价性验证是**一次性证据**，不是运行模式。

## 3. 决策

### D1 台账是文件，不是表

`apps/api/src/runtime/orchestration/orchestration.migration.json`，结构：

```json
{
  "schemaVersion": 1,
  "updated": "2026-10-13",
  "channels": [
    {
      "key": "rws.disproportionality",
      "label": "L1.5 失衡检测",
      "channel": "mdop",
      "state": "migrated",
      "mdopTemplate": "rws.l15.disproportionality",
      "legacyTables": ["cp_rws_task", "cp_rws_assignment"],
      "legacyRefs": [],
      "equivalenceEvidence": "openspec/changes/mdop-kernel/evidence/l15-equivalence-*",
      "sunset": "2026-10-13"
    },
    {
      "key": "rws.l4.fl-prediction",
      "label": "L4 联邦预测（FL）",
      "channel": "legacy",
      "state": "in-migration",
      "mdopTemplate": null,
      "legacyTables": ["cp_fl_prediction_task", "cp_fl_prediction_assignment"],
      "legacyRefs": ["apps/api/src/runtime/fl-orchestrator", "apps/web/src/app/(console)/space/federated"],
      "equivalenceEvidence": null,
      "sunset": null
    }
  ]
}
```

理由：① D-MDOP-1 明确「不动旧表」，给旧表加 `channel` 列会破坏该裁决；② 零依赖守护（`check-orchestration.mjs`）要能直接读，JSON 与 `nav.manifest.json` 同构；③ 迁移态本身是短期状态，文件在迁移结束后连同守护一起删除，不留长期表结构债。

否决：① 给 `cp_rws_task` / `cp_fl_prediction_task` 加 `channel` 列——改动旧表，且旧数据无法可靠回填；② 新建 `cp_orchestration_channel` 表——为迁移期引入长期 schema，且需要迁移工具链。

### D2 单通道执行，fail-closed

`resolveChannel(analysisType)` 是唯一解析点；平台 `MDOP_ENABLED` **且** 台账 `channel=mdop` **且** 该作业的合约/算子前置就绪，才走 MDOP；任一不满足即拒绝（错误码区分 `E_MDOP_DISABLED` / `E_CHANNEL_LEGACY`），MUST NOT 自动回落。回落 = I1 破。

否决：`MDOP_ENABLED=false` 时自动走旧通道。这在迁移期看着"方便"，实际让两条通道都可执行，且掩盖了开关误配。

### D3 等价性验证是临时态，不是运行模式

对拍通过 `state: verification` 表达：仅允许在非生产环境、只读输入、同一份固定数据上分别跑两条通道，逐字段比对，产出证据落在 `openspec/changes/<change>/evidence/`（`vaccine-effectiveness-tnd` 的 evidence 先例）。该状态 MUST 带 `expires` 与 `sunset`，到期未推进即守护报红——防止"永久对拍"变成事实上的双跑。

L1.5 的等价性判据已在 `mdop-kernel/specs/rws-compute` 立好（四格表与 PRR/ROR/IC 逐字段一致），本变更把同一判据升为**每批次的前置要求**。

### D4 下线闸门与回滚窗口

- **切换可逆**：`channel` 从 `legacy` 切到 `mdop` 后，在观察窗内可切回（回滚演练是闸门⑤，必须真的演练一次并留证据）。
- **删除不可逆**：一旦 `state=legacy-removed` 并删除代码，回滚只能是"向前修"，所以闸门①②③必须在同一个变更里同时满足，不接受"先删页面后补证据"。
- **观察窗长度**由部署决定（见 §6 未定问题），写入台账 `sunset` 字段而不是散在文档里。

### D5 FL 迁入 MDOP 的形态：节点间安全聚合（2026-10-13 用户裁决）

L1.5 是「各院算四格表 → 降密 → 平台合并」，没有模型；FL 的中间量是**模型更新（系数/梯度）**，比四格表敏感一档。用户已裁决：**FL 家族采用节点间安全聚合**——各院在节点内完成聚合，**平台 MUST NOT 接收任何单院模型更新**，只收聚合后的总和（C3）。

这与 D-MDOP-2 的关系要写清：D-MDOP-2 的 P1 修订原文已预留「放宽的只有 C3 与**安全聚合后的总和**（后者属后续变更）」。本次裁决就是那个"后续变更"，因此：

- MUST 新增决策 **D-MDOP-8**（FL 家族走节点间安全聚合；平台的合并方身份在 FL 链上收窄为"只收聚合后总和"），并在 DECISIONS 里与 D-MDOP-2 互链；
- MUST 扩协议到 **v0.3**：新增聚合阶段/消息与对应 `kind`（建议 `system.secure_aggregate`，节点侧执行、平台不参与取值），并说明部分参与（`partial`）在安全聚合下的语义——旧管线的 `partial` 语义恰是 D-MDOP-1 否决复用的那一条；
- **前置依赖（必须在 tasks 里显式列出）**：节点间安全聚合需要**节点间通道**，而 `mdop-kernel` 把「点对点中继」留在了后续变更。两条可选路径，需在 FL 实现变更里定：① 新做节点间中继（协议扩展最大）；② 复用旧 LoRA 已有的 `encrypted_delta_ref` 模式——**平台只做密文增量的搬运与合并**，明文更新始终不出节点（改动最小，且不违背本次裁决的"平台不见单院更新"）。**建议②**，它把 D-MDOP-2 的平台合并方身份保留在密文层，不新开点对点协议。

其余三点不变：

2. **多轮**：FedAvg 有轮次与部分参与，轮次幂等与超时重派必须按 MDOP 语义重写；
3. **可选产出**：L4 的产出是「聚合指标 + 模型参数」（`aggregate_and_model`），模型是否出节点由合约 `outputPolicy.allowedArtifacts` 决定，迁移必须保持同一口径——注意在安全聚合下，出域的"模型参数"只能是**聚合后**的参数；
4. **结算/贡献计量**：旧链在结算与存证上被引用（**A4/A5**：结算 5 处、存证 5 处），迁移要保证分账输入不因换通道而变。

### D6 UI/IA：一个对象只有一个入口与一个详情

沿用 `ia-task-surface`（已完成）：任务列表按通道分面、详情按视图合并。本变更只加两条：① 通道标注改读台账（不再硬编码分析类型名）；② 旧通道在 UI 上标 `deprecated` 并显示下线日期，**不并列**成第二个入口。旧详情页在 `legacy-removed` 时删除，旧地址在 `nav.manifest.json` 的 `redirects` 里做永久重定向（`check:nav` 守护）。

## 4. 与既有决策的关系

- **D-MDOP-1**（绞杀者、`cp_mdop_*` 新表不动旧表、逐类迁移）：本变更是它的执行机制层，不改变任何一条结论。
- **D-MDOP-2**（平台是合约明示的 C3 接收与合并方）：FL 批次必须遵守；合约接收方列表没有平台时，参数 MUST NOT 投递平台。
- **D-CN-4**（出站通道）：迁移不新增传输通道，复用长轮询 + 两个投递出口。
- **D10 / TC609**（接口对齐国标）：MDOP 是接口**之上**的编排 profile，迁移不改接口形态（D10 补注已有明文）。
- **D-UI-2**（导航清单唯一事实源）：旧入口的消失必须同时体现在清单里。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 迁移期被当成"两种产品能力"（用户认知） | UI 标 deprecated + 台账单调性 + 文档口径统一（本变更同步 DECISIONS/FLOWS） |
| 某个分析类型迁移中被静默降级回旧通道 | I1 fail-closed + 守护 + 运行时断言（闸门②） |
| 旧表被新功能继续写 | 守护扫代码引用 + 运行时断言（写旧表即抛） |
| 对拍变成长期双跑 | `verification` 态带 `expires`，到期红 |
| FL 迁移把模型参数误当普通 C3 | 合约 `allowedArtifacts` + D-MDOP-2 接收方列表 + TRUST 控制点复核 |

## 6. L4 联邦预测 vs LoRA FedAvg：定位与批次顺序

用户已裁决**先迁 L4**。两者不是同类东西，顺序不是偏好问题，而是迁移成本排序：

| 维度 | **L4 联邦预测** | **LoRA FedAvg（SecretFlow）** |
|---|---|---|
| 问题类型 | 造**可用、可解释的预测模型**（风险分层/预后） | 把**大模型表征能力**搬到院内数据上（参数高效微调） |
| 数据面 | 只消费 `structured_ehr` **表格列**（numeric/categorical/boolean） | `dicom` / `genomics` / `clinical_text` / `structured_ehr` **多模态**，有 fusion bridge（linear_projection / perceiver_resampler） |
| 模型 | 经典 ML：`logistic_regression` / `xgboost` / `random_forest`（水平联邦 HFL） | 预训练 backbone（`modelNameOrPath`）+ LoRA（r / alpha / targetModules） |
| 聚合 | FedAvg 或 SecureBoost；**LR + FedAvg 可完全在连接器内闭环**（无 ML sidecar，`local-logistic.ts`） | 逐轮 FedAvg，**经连接器中转**（每院每轮一个任务：`fl-round-queue` + `fed-adapter-merge` + FSM） |
| 出域产物 | 指标族（auc / f1 / precision / recall / calibration_curve / feature_importance / aggregate_metrics）+ `model_weights`（系数包，供使用方本地推理） | `lora_delta_hash` / `encrypted_delta_ref`（**加密增量引用**）/ aggregate_metrics / `model_card` |
| 隐私机制 | DP gate + 输出闸门 + 小单元格抑制 | 以上 + `teeRequired` / `heuEnabled` / **DP-SGD**（clipNorm、noiseMultiplier、targetEpsilon） |
| 轮次 | 单次或少量轮次，连接器内闭环 | **多轮是一等公民**（轮次队列、事件网关、逐轮幂等） |
| 适用场景 | 表格式 EHR 上的风险预测/分诊/预后（如 CKD→ESRD）；要**可解释**（系数、特征重要性、校准曲线）；各院特征 schema 一致、样本不同；算力/样本有限要快速出模型 | 影像/基因组/临床文本 → 报告生成、表型抽取、多模态风险；已有 backbone，想用**少量院内标注**微调；可接受多轮训练与 TEE/HEU/DP-SGD 的工程成本 |
| 交付形态 | 系数包 + 指标，使用方在本地推理 | LoRA 适配器（或加密增量）+ 模型卡，配合 backbone 使用 |
| 迁入 MDOP 的难度 | **低**：链路短、`aggregate_and_model` 口径已存在、连接器内可闭环 | **高**：多轮 + 加密增量 + FSM + 安全聚合前置 |

一句话选型：**「要一个能落地、能解释的预测模型」→ L4；「要把大模型能力搬到院内多模态数据上」→ LoRA。**

顺序理由：L4 的等价性对拍（指标 + 样本数 + 模型哈希）能在**现有连接器内**闭环完成，不需要先解决节点间安全聚合；LoRA 的迁移则**被 D-MDOP-8 的安全聚合前置挡住**（见 D5）。先 L4 可以先把台账、闸门、下线流程在一条真链路上跑通，再动安全聚合。

## 7. 决策回填（2026-10-13 用户裁决）

1. **批次顺序**：**先 L4 联邦预测**，后 LoRA FedAvg（理由见 §6）。
2. **观察窗**：**5 天**。闸门④ 固定为「切至 MDOP 后连续稳定运行 ≥5 天」，回滚演练（闸门⑤）在这 5 天内完成；RWS 与 FL 各批次同用 5 天。
3. **安全聚合形态**：**节点间安全聚合**。→ 触发 D-MDOP-8 新增、协议 v0.3 扩展、节点间通道前置（见 D5）；FL 实现变更在 D-MDOP-8 落册前 MUST NOT 开工。
4. **L1.5 旧详情页**：~~直接删除 + 永久重定向~~ → **实施枚举后修正（2026-10-13）**：旧分支实际跳 `/space/tasks/<id>?workload=rws`，那是 **8 个 RWS 类型共用的详情页**（页内无 L1.5 专属渲染），且历史 L1.5 任务（在 `cp_rws_task` 里）**没有对应 MDOP 作业可跳**，重定向目标不存在。故改为：**不删共用页、不加重定向**；去掉 `viaMdop` 开关让 L1.5 不再产生旧通道新任务，历史任务在该页**只读**呈现并标注「已迁至 MDOP」。理由：并存规矩 3「旧数据只读保留」要求历史结果仍可见，且删共用页会连带弄坏另外 7 个类型。
5. **批次 2**：**包含** compose 页改为计划编辑器。
6. **保留实现（实施时新增，2026-10-13）**：台账新增 `retained` 字段 + 守护 O6。两类实现 MUST NOT 当下线目标：`shared-runtime`（MDOP 合并算子 import 旧通道的 `mergeDisproportionalityAggregates`）、`test-reference`（`disproportionalityTables` 是 wasm 一致性闸的独立参考实现）。前者删了 MDOP 一起坏，后者删了对照控制失效。
