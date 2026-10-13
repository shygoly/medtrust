# 医疗空间 · 手测用例（M-01…M-18）

> 通用前置见 [README.md](./README.md)（E1–E6、账号 §0.3、空间 §0.4、取 JWT §0.5）。
> 每条用例末行「来源」= 该用例对齐的代码位置，代码变了按它同步。

---

## M-01 登录与 RBAC（提供方）

| 项 | 内容 |
|---|---|
| 前置 | E1–E4 完成 |
| 步骤 | 1. `/login` 点「示范甲医院 · 提供方」<br>2. 看左侧导航分组与左下角身份 |
| 预期 | ① 进入控制台且左下角显示「示范甲医院 / 数据提供方」；② 导航出现**工作台 / 数据与合约 / 研究与任务**；③ **不出现** `合规与监查`（需 operator/compliance）与 `平台`（需 operator/admin）下条目 |
| 记录 | |
| 来源 | `apps/web/src/nav.manifest.json`（entries 的 `roles`） |

## M-02 四种角色的菜单差异

| 项 | 内容 |
|---|---|
| 前置 | M-01 通过 |
| 步骤 | 依次以 `pv@demo-pharma.example`（使用方）、`data-governance@health.gov.cn`（监管方）、`compliance@medtrust.org`（合规方）登录，各看一次导航 |
| 预期 | 使用方看到「发起任务」（`/space/tasks/new`，roles=[consumer]）；监管/合规看到 `合规与监查`（合规总览 / RBQM 监查 / 审计日志 / 存证账本）；非 operator 看不到 `平台` 组 |
| 记录 | |
| 来源 | nav.manifest（`/space/tasks/new`、`/space/compliance`、`/space/rbqm`、`/space/audit`、`/space/admin/*`） |

## M-03 空间切换

| 项 | 内容 |
|---|---|
| 前置 | E1–E9（电力包已授权，用于 M-02 之外的切换验证） |
| 步骤 | 1. 点侧栏顶部**空间切换器**<br>2. 切到「河南电力可信数据空间」<br>3. 看目录/合约是否变化<br>4. 切回默认空间 |
| 预期 | 切换后页面数据按空间隔离（电力空间看不到医疗目录）；切回后恢复；刷新页面保持当前空间 |
| 记录 | |
| 来源 | `apps/web/src/components/console/space-switcher.tsx` |

## M-04 数据产品目录（`/space/catalog`）

| 项 | 内容 |
|---|---|
| 前置 | M-01 |
| 步骤 | 打开 **数据产品**，逐行看：名称、提供方、分级、是否有 `dataPath`（有则行内出现「连接器训练」按钮） |
| 预期 | 列表非空；**CKD 患者结构化随访队列**（`dp-insulin-panc-demohospa`）等产品可见；含 `dataPath` 的产品出现「连接器训练」 |
| 记录 | |
| 来源 | nav.manifest `/space/catalog`（entities `cp_data_product`，flows FLOW-DS-01/FLOW-DC-01）；`docs/demo/federated-e2e-test.md` 阶段 1 |

## M-05 数字合约（`/space/contracts`）

| 项 | 内容 |
|---|---|
| 前置 | M-04；一个使用方账号 + 一个提供方账号 |
| 步骤 | 1. 使用方在目录里对某产品发起申请（含 purpose）<br>2. 提供方在 **数字合约** 中审批/签约<br>3. 回到列表看状态 |
| 预期 | 合约出现且状态为 `active`；双方（providerId/consumerId）正确；合约哈希可查 |
| 记录 | |
| 来源 | nav.manifest flows `FLOW-DC-01`/`FLOW-CMP-01`；`apps/api/src/runtime/digital-contract/` |

## M-06 ★ L1.5 失衡检测：只剩 MDOP 一条通道（本次迁移验收核心）

| 项 | 内容 |
|---|---|
| 前置 | 使用方账号（consumer）；**已有一份覆盖目标医院的 active 合约** |
| 步骤 | 1. `/space/tasks/new` → **发起 RWS 任务** → `/space/tasks/new/rws`<br>2. 分析类型选 **L1.5 失衡信号（PRR/ROR）**<br>3. 填药物 / 队列 / 医院 / 合约，提交<br>4. 记录跳转地址与 jobId |
| 预期 | ① L1.5 面板显示**静态说明**「L1.5 失衡检测统一经 **MDOP 作业**执行（D-MDOP-7…）」，且**没有**「经 MDOP 执行」勾选框；② 提交后跳 **`/space/mdop/jobs/{jobId}`**（不是 `/space/tasks/{id}`）；③ 作业状态推进到 `SUCCEEDED`，可见 C3 合并结果（四格表 + PRR / ROR / χ²Yates / IC + Evans 信号） |
| 记录 | |
| 来源 | `apps/web/src/app/(console)/space/tasks/new/rws/page.tsx`（L1.5 分支，`viaMdop` 已删）；`api.submitMdopL15` → `POST /mdop/jobs/l15`（模板 `rws.l15.disproportionality`） |

## M-07 ★ 旧入口必须被拒（迁移验收核心）

| 项 | 内容 |
|---|---|
| 前置 | 取到 consumer 的 JWT（README §0.5），且该账号有可用合约 |
| 步骤 | 1）L1.5 走旧入口：<br>```bash<br>curl -s -o /tmp/r1 -w '%{http_code}\n' $API/rws/tasks -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \<br>  -d '{"title":"t","purpose":"p","analysis":{"type":"disproportionality","drug":"阿莫西林"},"contractIds":["<合约id>"]}'<br>cat /tmp/r1<br>```<br>2）换一个**未迁移**类型（对照）：把 `type` 换成 `comparative-effect` 重发 |
| 预期 | ① L1.5 → **HTTP 409**，响应含 **`[E_CHANNEL_MDOP]`**（「该类型已切到 MDOP 通道…旧入口不再受理」）；② 对照类型 → **2xx** 且返回 `taskId`（迁移期未拦）；③ 数据库 `cp_rws_task` **没有**新增 L1.5 记录 |
| 记录 | |
| 来源 | `apps/api/src/runtime/rws-orchestrator/rws-orchestrator.controller.ts#submit`（`assertEntryAllowed(key,"legacy")`）；台账 `rws.disproportionality.cutoverAt=2026-10-13` |

## M-08 历史 L1.5 任务只读标注

| 项 | 内容 |
|---|---|
| 前置 | 库里存在 2026-10-13 之前经旧通道产生的 L1.5 任务（老库/生产一定有；本机若没有可跳过并注明） |
| 步骤 | 直达 `/space/tasks/{旧任务id}?workload=rws` |
| 预期 | 页面顶部出现标注：「本任务是**迁移前经旧通道产生**的 L1.5 失衡检测结果，现为**只读历史**。L1.5 已统一由 MDOP 作业执行…」+ 可点链接 **`/space/tasks?channel=mdop`** |
| 记录 | |
| 来源 | `apps/web/src/app/(console)/space/tasks/[id]/page.tsx`（`rwsQuery.data.analysis.type === "disproportionality"` 分支） |

## M-09 RWS 阶梯其余类型（各提交一次，确认仍在旧通道）

| 类型 | 期望关键结果 |
|---|---|
| `condition-prevalence` 慢病/服务谱分布 | 分派到各院 → 合并后详情可见分布桶 |
| `cohort-count` 队列规模（年龄带） | 各院贡献计数 → 合并总数 |
| `adverse-event-signal` 不良反应信号 | 合并信号指标 |
| `comparative-effect` L2 比较效果 | 合并效应量（Meta） |
| `causal-psm` / `causal-survival` L3 因果 | PSM/IPTW 或 Cox/KM 结果 |
| `algorithm-validation` L0 算法验证 | **只出 2×2 混淆矩阵（TP/FP/TN/FN）**，按 provider 分列、不合并；个体金标准永不出域 |

| 项 | 内容 |
|---|---|
| 步骤 | 每个类型在 `/space/tasks/new/rws` 提交一次；完成后进 `/space/tasks/{id}` |
| 预期 | 全部**经旧通道**成功（台账 `channel=legacy`）；除 `disproportionality` 外都不应被 M-07 的 409 拦 |
| 记录 | （逐类型填） |
| 来源 | 台账 `apps/api/src/runtime/orchestration/orchestration.migration.json`；FLOWS `FLOW-RWS-01…05` |

## M-10 MDOP 作业详情（`/space/mdop/jobs/{id}`）

| 项 | 内容 |
|---|---|
| 前置 | M-06 或 M-09 产生过一个 MDOP 作业 |
| 步骤 | 1. `/space/tasks?channel=mdop` 找到作业<br>2. 进 `/space/mdop/jobs/{id}`，逐段看 |
| 预期 | 可见：状态机阶段（`SUBMITTED→COMPILED→NEGOTIATING→TICKETED→RUNNING→RELEASING→SUCCEEDED→PURGED`）、各院片段要约与复核、执行凭证、C3 制品投递与合并结果、销毁回执、链头锚定 |
| 记录 | |
| 来源 | `apps/api/src/mdop/mdop.controller.ts`、`packages/mdop/`、FLOWS `FLOW-MDOP-01` |

## M-11 MDOP 原生四模板（API 提交）

| 项 | 内容 |
|---|---|
| 前置 | JWT（consumer/operator 视守卫）；各模板输入见 `plan-templates.ts` |
| 步骤 | 依次提交并记录 jobId：<br>`POST /mdop/jobs/paired-cohort`、`/mdop/jobs/vaccine-scri`、`/mdop/jobs/ve-tnd`、`/mdop/jobs/dedup-incidence` |
| 预期 | ① 四个都返回 jobId 且作业详情可查；② **paired-cohort 是 C2 链路**：若目标节点没有有效的证明登记，**编译期**即拒（`E_CAPABILITY_MISMATCH`）——这是 D-MDOP-6 的负例，属**预期行为**，请在备注里记下当前部署下是「通过」还是「如期被拒」 |
| 记录 | |
| 来源 | `apps/api/src/mdop/mdop.controller.ts`（5 个模板入口均过 `assertTemplateAllowed`）、`plan-templates.ts` |

## M-12 通用入口必须能归属（本次新增 2.7）

| 项 | 内容 |
|---|---|
| 前置 | JWT |
| 步骤 | 1）提交一个**无法归属**的通用作业：<br>`POST /mdop/jobs`，body 里 `stages` 只有 `source.dataset@1.0.0` + `declassify.small_cell@1.0.0`，且**不带** `analysisKey`<br>2）同一请求加 `"analysisKey":"rws.disproportionality"`<br>3）同一请求改成 `stages` 里带 `merge.disproportionality@1.0.0`（不带 analysisKey） |
| 预期 | ① **409**，消息含 `[E_CHANNEL_UNKNOWN]`；② 接受（返回 jobId）；③ 接受（由算子推导出同一 key） |
| 记录 | |
| 来源 | `apps/api/src/mdop/mdop.controller.ts#submit`（`resolveEntryKey`）、`orchestration.channels.ts`（`ORCHESTRATION_OP_TO_KEY`） |

## M-13 L4 联邦预测

| 项 | 内容 |
|---|---|
| 前置 | 使用方账号 + 覆盖多院合约 |
| 步骤 | 1. `/space/tasks/new` → **发起 L4 联邦预测**<br>2. 填特征/结局/参与方，提交<br>3. 进 `/space/tasks/{id}` 看分派与结果<br>4. 进 `/space/infer/{taskId}` 做本地推理 |
| 预期 | ① 任务创建成功（`cp_fl_prediction_task`）；② 各院分派状态可见；③ 完成后可见聚合指标与模型包；④ 本地推理页可用（`fl_weight_bundle`） |
| 记录 | |
| 来源 | nav.manifest `/space/tasks/new/fl-prediction`、`/space/infer/[taskId]`（FLOW-RWS-04）；`apps/api/src/runtime/fl-orchestrator/` |

## M-14 LoRA FedAvg（连接器训练 → 交付 → 分账）

| 项 | 内容 |
|---|---|
| 前置 | 提供方账号；目录产品含 `dataPath`；connector-a/b 已上线（本机可用 `demo:e2e` 代替） |
| 步骤 | 1. `/space/catalog` 找到 **CKD 患者结构化随访队列**<br>2. 点行内 **连接器训练**<br>3. 观察状态：`签约并派发…` → `训练中…` → **`联邦 LoRA ✓`**<br>4. 打开 `/space/tasks?channel=secretflow` 找同一任务，进详情（旧地址 `/space/federated/{taskId}` 会重定向）<br>5. 换使用方登录，看交付物并下载 |
| 预期 | ① 状态行含 `联邦 LoRA ✓` 与两院标识；② 详情：合并 LoRA 哈希 `LORA:…`、参与 2 方、FedAvg（轮次同步）、贡献各约 50%、分账共 100 CNY；③ 使用方看到**同一** `loraDeltaHash` 与 `ENC:…` 引用，可下载 `.enc.json` |
| 记录 | |
| 来源 | `docs/demo/federated-e2e-test.md`（阶段 1–4，注意其中 `/space/federated`、`/space/deliverables` 已被 nav 重定向到 `/space/tasks?channel=secretflow`） |

## M-15 结算 / 存证 / 审计 / RBQM / 合规

| 项 | 内容 |
|---|---|
| 步骤 | 1. `/space/settlements` 看分账记录<br>2. `/space/attestations` 核对 `ATT:` 哈希<br>3. `/space/audit`（需 operator/compliance）<br>4. `/space/rbqm` 看 KRI 与 QTL 违约（需 operator/compliance）<br>5. `/space/compliance` 合规总览 |
| 预期 | 各页有数据且与 M-14 的金额/哈希对得上；无权限账号访问受限页应被门控（不是白屏） |
| 记录 | |
| 来源 | nav.manifest 对应 entries 的 `roles` / `guards` |

## M-16 ★ 编排迁移台账与守护（工程验收）

| 项 | 内容 |
|---|---|
| 前置 | 仓库根目录 |
| 步骤 | 1. `node scripts/check-orchestration.mjs`<br>2. 把 `apps/api/src/runtime/orchestration/orchestration.migration.json` 里某条 `channel:"legacy"` 改成 `"mdop"`（或把 `legacyBudget` +1）<br>3. 再跑一次<br>4. 改回<br>5. `node --test scripts/check-orchestration.test.mjs` |
| 预期 | ① `0 error(s)`，打印「条目 14 · legacy 9/9」；②③ **报红**（legacy 只减不增 / budget 不得上升）；④ 恢复绿；⑤ 负例 **24/24 通过** |
| 记录 | |
| 来源 | `scripts/check-orchestration.mjs`（O1–O8）、`apps/api/src/runtime/orchestration/orchestration.channels.spec.ts` |

## M-17 无 GUI 的等价链路（CLI，可选）

| 命令 | 覆盖 |
|---|---|
| `pnpm --filter @medtrust/connector demo` | 单院本地闭环（去标识→TEE→输出闸门） |
| `pnpm --filter @medtrust/connector demo:e2e` | 1 药企 + 2 院 端到端 |
| `pnpm --filter @medtrust/connector demo:synthea-e2e` | Synthea 合成数据端到端（打印演示账号） |
| `pnpm --filter @medtrust/connector demo:amr-q1` / `q2` / `q4` / `q3` | AMR 哨兵四个问题（见 `docs/amr-sentinel/`） |
| `pnpm --filter @medtrust/connector demo:he` / `demo:cross` | 同态加密 / 跨空间链路 |

| 项 | 内容 |
|---|---|
| 预期 | 各脚本自行打印阶段并以 0 退出；输出中的哈希/计数与用例记录一致 |
| 记录 | |
| 来源 | `apps/connector/package.json`（scripts） |

## M-18 本机缺医疗演示账号时的处理（**待确认项**）

| 项 | 内容 |
|---|---|
| 说明 | 医疗演示账号（§0.3）由部署侧种子提供；我在仓库里**没有找到**一条明确的本机种子命令（`packages/demo-scenario` 只有 build/dev 脚本）。因此：本机登录页没有快捷按钮时，请用 **ali29** 执行 M 系列，或按 `REAL_DEMO_GUIDE.md` 的账号清单确认现有库。 |
| 预期 | 执行者把「本机是否可种子医疗账号 / 命令是什么」回填到本行备注——**这是本册已知的唯一空档** |
| 记录 | |
| 来源 | `packages/demo-scenario/package.json`（仅 build/dev）、`REAL_DEMO_GUIDE.md` |
