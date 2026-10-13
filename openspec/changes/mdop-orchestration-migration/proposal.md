# MDOP 逐步接替既有编排：迁移台账 + 批次 0（L1.5 下线）与批次 1（FL）闸门

## Why

2026-09-24 已裁决（D-MDOP-1）：MDOP 全面替换现有三条编排，用绞杀者方式**按分析类型逐类迁移，迁完一类才下线对应的旧路径**。第一期 `mdop-kernel` 已落地内核骨架，并迁走 **L1.5 失衡检测**一条链路。

但第一期收官后留下一个**没有事实源的空档**：

- 「哪些分析类型已迁、哪些还在旧管线、下一批迁谁、旧路径何时可删」只散落在 proposal 的「本期不做」文字里，不是可校验的状态；
- 「两套表并存」目前靠人自觉：没有守护阻止新功能继续写旧表，也没有路由单点阻止同一分析类型被两条通道各执行一次；
- 旧表（`cp_rws_*`、`cp_fl_prediction_*`）与 `cp_mdop_*` 并存，很容易被读成「两种并列的产品能力」——前端已经有 L1.5 双通道两套详情的先例（`docs/前端信息架构审计与导航重构提案.md` A2：`orchestration-task-detail.tsx` vs `mdop/jobs/[id]`，两者自述逐字段一致）。

本变更把**「迁移」本身**变成有单一事实源、有守护、有下线闸门的工程对象：兑现第一个下线（L1.5 旧路径），并为用户点名的下一批——**联邦学习（L4 联邦预测 / LoRA FedAvg）**——先锁定契约与闸门，确保它不能绕过台账被顺手迁掉。

## What Changes

- **迁移台账（唯一事实源）**：新增 `apps/api/src/runtime/orchestration/orchestration.migration.json`（JSON 而非表：不动旧表结构、零依赖守护可直接读，沿用 `nav.manifest.json` 先例）。逐分析类型登记 `key`、`channel`（`mdop` | `legacy`，**单值**）、`legacyTables`、`mdopTemplate`、`state`（`pending` | `in-migration` | `migrated` | `legacy-removed`）、`equivalenceEvidence`、`sunset`。台账是「哪条通道在执行」的唯一来源；代码里不得再出现按分析类型硬编码的通道分支。
- **通道解析单点 + fail-closed**：`resolveChannel(analysisType)` 一处解析，控制器不得自行判断。平台 `MDOP_ENABLED`（总开关，语义不变）与台账逐类 `channel` **同时**满足才走 MDOP；只满足其一时拒绝作业并给错误码，**MUST NOT 静默回落到旧通道**——静默回落等于双通道并行。
- **并存的合法状态（三条硬规矩）**：
  1. **不双写**：一个作业只落一套表。走 MDOP 的分析类型 MUST NOT 再写 `cp_rws_*` / `cp_fl_prediction_*`；反向同理。
  2. **不过桥**：不跨通道续跑（旧作业不得切 MDOP 重跑，MDOP 作业不得从旧表 resume）；重试与幂等键只在各自通道内成立。
  3. **旧数据只读保留**：下线的是**代码路径**，不是历史数据。旧记录被链上存证引用，删除归既有留存策略，不在本迁移内。
- **下线闸门（删除旧路径的前置，六条全绿）**：① 台账 `channel=mdop` 且等价性证据在册；② 旧表零写入（守护 + 运行时断言）；③ 旧路由/页面/端点零引用（`check:orchestration` + `check:nav`）；④ 生产切至 MDOP 后连续稳定运行满 **5 天**（2026-10-13 裁决）；⑤ 回滚演练通过（观察窗内把 `channel` 切回 `legacy` 仍可用）；⑥ 治理同步完成（DOMAIN / FLOWS / DECISIONS / TRUST / ARCHITECTURE）。
- **批次 0：L1.5 旧路径下线**。按闸门删除 `analysisType=disproportionality` 的旧执行分支、旧端点与旧详情页，台账记 `legacy-removed`。这是「迁完才下线」的第一次兑现，也把 A2 的双通道详情收敛成一页。
- **批次 1：联邦学习登记为 `in-migration`（本期只锁契约与闸门，不实现）**。用户裁决**先迁 L4 联邦预测**（`cp_fl_prediction_*`、`apps/api/src/runtime/fl-orchestrator/`、`/space/federated`、`/space/infer/[taskId]`），**后迁 LoRA FedAvg**（SecretFlow 内存态 + 结算/贡献计量）——两者定位不同，顺序见 design §6。**形态：节点间安全聚合**（2026-10-13 裁决）：各院在节点内聚合，平台 MUST NOT 接收单院模型更新，只收聚合后总和；该形态需要新增 **D-MDOP-8** 与协议 **v0.3** 扩展，并拉到「节点间通道」前置（design D5）。实现另立变更，本变更只保证它绕不过台账。
- **守护**：新增 `scripts/check-orchestration.mjs` 与负例 `.test.mjs`，接入根 `pnpm test`。不变式：**legacy 条目只减不增**（新增 legacy 能力 = 红，与 `check-nav` 的「豁免名单只减不增」同构）；每个 `key` 恰好一条通道；`legacy-removed` 不得残留代码引用；`mdop` 条目必须有等价性证据。
- **治理**：DECISIONS 新增 **D-MDOP-7**（迁移台账为唯一事实源、legacy 只减不增、单通道执行）与 **D-MDOP-8**（FL 家族走节点间安全聚合；平台只收聚合后总和，与 D-MDOP-2 互链）；DOMAIN 标注旧表在迁移期的只读地位；FLOWS 给旧 FLOW 标注 deprecated 并在每批次下线时改写；`docs/tech-debt.md` 记 A2 的收敛路径。

**本期不做**：

- 不实现 FL 的安全聚合与模型参数出域（批次 1 的算法实现另立变更）；
- 不迁 RWS 阶梯 L0/L1/L2/L3、不改 compose 页为计划编辑器（**批次 2 已裁决包含 compose 转计划编辑器**，但另立变更）；
- 不删任何旧表或旧数据；不改 `cp_rws_*` / `cp_fl_prediction_*` 表结构（D-MDOP-1「不动旧表」）；
- 不做跨通道的作业迁移/续跑（规矩 2 明确禁止）。

## Capabilities

### New Capabilities

（无。迁移机制归入既有 `orchestration-kernel`，不另开能力，避免与内核重复定义。）

### Modified Capabilities

- `orchestration-kernel`：新增「分析类型迁移台账为唯一事实源」「通道解析单点与 fail-closed」「并存三规矩」「下线闸门与回滚窗口」。
- `rws-compute`：新增「L1.5 只剩 MDOP 通道（旧路径下线）」「未迁移分析类型继续走旧通道并按台账逐类切换」。

## Impact

- **代码**：
  - 新增 `apps/api/src/runtime/orchestration/`（台账读取、`resolveChannel`、运行时断言）；
  - 收敛 L1.5：`apps/api/src/runtime/rws-orchestrator/disproportionality*` 的旧执行分支、`rws-analytics-ladder` 的 L1.5 旧入口、旧端点；
  - 前端：L1.5 双通道合一，任务详情/列表的通道标注改为读台账（沿用 `ia-task-surface` 的适配层，不新增第二套列表）；
  - 守护：`scripts/check-orchestration.mjs` + `.test.mjs` + `package.json` 的 `test` 链。
- **数据**：不动任何表结构；台账是文件不是表；旧表迁移期只读。
- **部署**：新增可观测项（台账版本 + 每类 channel 的运行时快照）；`MDOP_ENABLED` 语义不变。
- **合规**：迁移 MUST NOT 新增出域路径；每条通道的 payload 分级沿用 TRUST / FLOWS 既有声明，闸门⑥强制同步。
