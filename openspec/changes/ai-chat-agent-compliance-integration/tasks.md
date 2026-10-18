# AI 助手合规集成 - 实施任务与状态

> **来源**：[`plan.md`](./plan.md)（Phase 1-6）。
> **读法**：本文件记录**实际落地**的形态与证据，不复制 plan 的设想。
> 与 plan 不一致的地方集中在文末「偏差登记」，按 `AGENT-OPS.md` AO-2：
> **两侧不一致时登记冲突，不单方面改任一侧**。
>
> 口径：只写**跑过、可复跑**的事实。未跑的（真实控制面 HTTP、真实 LLM、浏览器级演示）一律标注"未跑"。

## 状态总览（2026-10-16）

| Phase | 目标 | 状态 | 说明 |
|---|---|---|---|
| 1 权限检查 | 不绕过基本权限 | ✅ 已完成 | 成员身份 + **产品级访问授权（独立授权表 + 授予/回收，D-ACL-1）** + 合约可用性 |
| 2 合约查询 | Agent 能查/展示合约状态 | ✅ 已完成 | 逐条镜像 `assertUsableForJob`，并区分 draft（待签发） |
| 3 自动创建合约 | 无合约时自动创建并生效 | ✅ 完成（形态改写：预授权自动推进 + 院内自动签） | 平台按 ACL 预授权自动发要约（不代签）；签不签由医院本地策略的条款谓词决定（D-MDOP-9） |
| 4 审批流程 | 申请卡 + 进度跟踪 + 通知 | ✅ 完成 | 申请卡/引导卡 + draft 进度 + 管理员界面（复用既有）+ **站内信收件箱**（D-NOTIF-1）+ 24h SLA 进度查询 |
| 5 审计与监控 | 判定与合约操作可追溯 | ✅ 完成 | 写入控制面审计链 + 三类指标；报表/导出复用既有端点（并修掉一个让"按资源筛不出来"的平台缺陷） |
| 6 E2E | 覆盖完整合规流程 | ✅ 完成 | HTTP 级 + 浏览器级（人工签发 / 自动创建 / ACL 拒绝 / 权限拒绝 / 只读查询）+ 截图与录屏产物 |

## Phase 1 · 权限检查（Week 1-2）

- [x] 1.1 权限检查服务 —— 形态是 `src/compliance/compliance.ts` 的纯函数
  （`checkMembership` / `checkContractGate` / `evaluatePrerequisites`），不是 `PermissionChecker` 类：
  无状态、无 DI、可直接单测（`compliance.spec.ts`）。
- [x] 1.2 在提交工具里前置检查 —— `buildSubmitTool` 打控制面前跑 `evaluatePrerequisites`；
  被拦时**不调用控制面**并回 `data.compliance`（含控制面原错误码）
  与 `data.values`（供预填回卡）。
- [x] 1.3 `check_data_access` —— **已实现**（维护者决定要「真·产品级 ACL」，见 D-ACL-1）：
  控制面新增独立授权表 `cp_data_access_grant` 与端点 `GET /data-access/check`、
  `GET/POST /data-access/grants`、`POST /data-access/grants/:id/revoke`；
  agent 侧 `check_data_access` 工具与提交前闸都调它。**授权与合约两层正交**：
  授权回答「能不能碰这个数据产品」，合约回答「以什么条款执行」，两层都过才放行；
  fail-closed（无 active 授权即拒），回收追加式留痕（置 revoked + 原因，不删行）。
- [x] 1.4 System Prompt 权限指南。
- [x] 1.5 单元测试：`src/compliance/compliance.spec.ts`、`src/agent/tools/compliance.tools.spec.ts`。

**验收（plan）**：用户须是 Member 才能用 AI 助手 —— 部分成立：当前是"不属于该空间即拦"，
角色层面的拒绝由控制面裁决（agent 侧只报判定与原因，不替控制面做角色裁决）。

## Phase 2 · 合约状态查询（Week 3-4）

- [x] 2.1 `ContractChecker` —— `evaluateContract()` 逐条镜像 `assertUsableForJob` 五条判据
  （存在 → 持有方签名 → `mdopStatus=active` → 未过期 → 用途编码相符），失败时**点明是哪一条**。
- [x] 2.2 `check_contract_status` 工具：回 `status / contractId / contractStatus / fix`，
  不可用时附带 `data.card`（现成的卡，模型只负责原样输出）。
- [x] 2.3 System Prompt：先查合约再配置；不可用不反复重试提交。
- [x] 2.4 合约信息展示 —— 提交成功后结果卡与工具 `data` 带 `contractId`（确定性）；
  配置卡的 `metadata.contractId` 由提示词引导模型填（非确定性，见偏差 D-4）。
- [x] 2.5 集成测试：有合约 → 直接提交且载荷带 contractId；无合约 → 拦下并出申请卡。

**新增（plan 未写但必要）**：待签发的草稿（`status=draft`）也算候选，否则用户刚提交的申请
在 agent 眼里等于不存在，"可跟踪进度"落不了地。

## Phase 3 · 自动创建合约（Week 5-7）

- [x] 3.1 `ComplianceOrchestrator` —— 形态是 `evaluatePrerequisites()` + `buildContractGateCard()`，
  不是类；编排逻辑 = 成员 → 合约 → 出卡/放行。
- [x] 3.2 `create_contract_draft` → 落地为 **`request_contract`** 工具
  （`src/agent/tools/contract.tools.ts`）：`POST /contracts/requests`，用调用者 token；
  缺 `compositionId` 时先查 `GET /compositions`（0 份 → 引导建预审；多份 → 让用户选；1 份 → 自动引用）。
- [x] 3.3 `activate_contract` —— **已落地，形态改写为"预授权自动推进"**（D-MDOP-9）：
  平台端点 `POST /contracts/:id/auto-offer`（前置=提供方已按 ACL 预授权 + 预审非「需审批」）把申请
  定稿并发要约；**平台不产生任何签名**，签不签由持有方连接器按**院内本地策略**决定——
  策略新增条款谓词 `autoConfirmRules`（产品/使用方/用途/最长有效期/最小单元格），命中即自动签。
  端到端效果：用户确认后合约自动生效、可直接提交作业（浏览器级用例覆盖，全程无医院点击）。
- [x] 3.4 `ContractApprovalCard`（`packages/chat-cards/src/cards/ContractApprovalCard.tsx`）：
  展示参与方/用途/数据产品/有效期；按钮文案"同意并提交申请"（不是"创建"），`autoApprove` 恒 false。
- [x] 3.5 `CardRenderer` 支持 `contract_approval` / `contract_request`，缺字段时退化不白屏。
- [x] 3.6 System Prompt 合约流程指南（含"工具自带卡原样输出"）。
- [x] 3.7 集成测试：工具层 11 条（含自动生效 / 已发要约待签 / 未预授权三条）+ HTTP 级
  "无合约 → 审批卡 → 回灌 → 自动生效 → 直接提交成功"全链 + 浏览器级同类用例。
- [x] 3.8（补）审计：合约申请写结构化审计日志（`ComplianceAudit`），成功/缺预审/失败都记；
  自动推进额外在**平台审计链**记 `UPDATE / contract`（含 grantId / offerId），合约上留
  `autoOfferGrantId` / `autoOfferedAt` 供事后对账。

**验收（plan）改写**：无合约时**代用户发起申请**（不是"自动创建并生效"）；
用户确认后提交申请；合约信息完整展示；审计记录完整。

## Phase 4 · 合约审批流程（Week 8-10）

- [x] 4.1 `ContractRequestCard`：给原因 + 步骤，**不给**提交按钮（给了也只会失败）。
- [x] 4.2 审批通知 —— **落地为站内信**（D-NOTIF-1）：表 `cp_notification` + 端点
  `GET /notifications`、`GET /notifications/unread-count`、`POST /notifications/:id/read`、
  `POST /notifications/read-all`；写入点是合约生命周期（申请→通知提供方；签发/驳回→通知使用方；
  预授权自动推进→通知提供方）。工作台新增「未读通知」瓷贴 + 待办面板（可直接标记已读/去处理）。
  **邮件/短信/Webhook 未做**：本仓没有生产邮件通道（`auth/mail.service.ts` 是重置验证码的开发桩），
  在它上面加通知会得到"看起来发过、实际没发"的路径（见偏差 D-6）。
- [x] 4.3 管理员审批界面 —— **复用既有实现，已核对**：
  `apps/web/src/app/(console)/space/contracts/page.tsx` 自述"药企提交申请（draft）→ 医院在
  列表行内签发（active），仅合约提供方可见签发按钮"，操作走 `POST /contracts/:id/approve` /
  `:id/reject`（`ContractRowActions` / `IssueContractButton`）。AI 代发的 draft 就是同一张表里
  的一行，对提供方天然可见，无需新界面。
- [x] 4.4 审批状态跟踪 —— 两处：
  ① `check_contract_status` 把 `draft`（申请中/待签发）报为 `not-usable + fix=await_provider_approval`；
  ② 新工具 `list_contract_requests` 逐条给出状态、**等待时长**与 **24h SLA 超时**提示
  （用户问"我的申请到哪了/还要等多久"时用），测试见 `contract.tools.spec.ts`。
- [x] 4.5 完整流程测试：**申请 → 签发 → 再提交成功**，两层都有：
  HTTP 级（`chat.e2e.spec.ts` 用 `api.issueContract()` 扮演医院签发 → 再提交 → 载荷带签发后的合约）；
  浏览器级**走真实界面**（`test/e2e/scenarios/contract-compliance-flow.spec.ts`）：
  药企账号在 AI 助手里发起申请 → **另一个浏览器里登录医院账号**（`admin@demohospa-hospital.com`，
  `participantId=p-hosp-a`）→ 打开 `/space/contracts` 看到「待审批」的那一行 → 点**行内「签发」**
  → 状态翻「已生效」→ 回药企侧重新配置并提交成功。
  桩只扮演**连接器**那一步（用本院私钥签 ContractAgree，D-MDOP-4），人的交互是真的；
  原先的测试后门 `__test__/issue` 已删除（能走真实路径就不留绕道）。
- [x] 4.6（补）多数据源合约：外部对照改为按「提供方 + 数据产品」逐项匹配，
  计划同时携带多份合约，模板把每份合约绑定到对应 seal 阶段。2026-10-17 实测两家医院
  连接器分别签署、平台分别副署，chat-agent 提交成功。

## Phase 5 · 审计与监控（Week 11-12）

- [x] 5.1 审计扩展 —— 落在**平台审计链**上（不另起一套）：`POST /api/v1/audit`，用调用者 token
  → 条目归属用户与租户（SM3 链由控制面维护）。写入点：
  作业提交成功 → `COMPUTE / rws-task`（含 `jobId` + `contractId`）；
  被闸拦下 → `READ / compliance-gate`（含 verdict / fix）；
  合约申请 → `CREATE / contract`（成功）/ `READ / contract`（前置条件不满足）；
  AI 来源记在 `details.source = 'ai-chat-agent'`。服务端结构化日志（`event: compliance_audit`）保留：
  日志给人看，审计链给合规导出。**不含**用户原话与载荷取值。
- [x] 5.1b（**顺带修掉的平台缺陷**）控制面审计通道的读写列名对不上：DTO 字段是 `resource`、
  实体列是 `resourceType`，`create()` 直接展开 DTO → `resource` 被静默丢弃（`resource_type` 恒 null）；
  而 `findAll()` / `getStats()` 过滤与分组用的是**表里不存在**的 `audit.resource`。
  于是"按资源筛合约操作"永远筛不出来（审计链照写、页面照开，只是筛不到）。
  已修 + 新增 `apps/api/src/audit/audit.service.spec.ts`（**先写用例复现两个症状，再修**）。
- [x] 5.2 监控指标 —— `contract_auto_offer_total{result}`（合约创建成功率分项：ready/offered/skipped）、
  `compliance_decisions_total{verdict,scenario}`、
  `job_submissions_total{outcome,contract}`（提交成功率按是否关联合约分类）、
  `compliance_audit_write_total{outcome}`（审计写入结果，含 failed / skipped_no_token）；
  均在 Prometheus 文本端点有断言；审批时延由签发通知/审计条目的 `waitSeconds` 承载（唯一口径）。
- [x] 5.3 审计报表 —— **复用控制面既有端点**：`GET /audit?startDate&endDate&resource&action`
  （按时间段/资源/动作查）、`GET /audit/stats`（动作/资源/近 7 天统计）、`GET /audit/integrity`（SM3 链校验）。
- [x] 5.4 合规报告导出 —— `GET /audit/export`（JSON 报告 + 链校验结论）、
  `GET /audit/evidence-package`（ZIP 证据包，内含可打印报告）；
  **CSV 本轮补上**：`GET /audit/export.csv`（同一套筛选；含 BOM，Excel 打开中文不乱码），
  转义契约与端点接线都有用例（`audit-csv.spec.ts` / `audit.controller.spec.ts`）。
  **PDF 未做**：证据包里已有可打印报告，引 PDF 依赖是一个独立决定（见 D-3）。
  plan 引用的 `docs/audit-log-spec.md` 在本仓**不存在**，故以既有端点 + SM3 链口径为准。

## Phase 6 · E2E（Week 13-14）

- [x] 6.1 / 6.2 HTTP 级 e2e（`src/api/chat/chat.e2e.spec.ts` 新增「合规流程」describe）：
  ① 有合约 → 提交成功 + contractId + 指标 ready；② 无合约 → 拦下 + 审批卡 + 回灌后 pending 申请；
  ③ 无预审 → 引导卡且**未**产生假申请；④ 非成员 → 拦在权限上且不误报成合约问题；
  ⑤ Phase 3 自动创建（预授权 + 院内自动签 → 直接提交）；⑥ 产品级 ACL 拒绝 → 开权限后通过。
  浏览器级同样覆盖 ④⑤⑥（外加"合约未签发时的引导"与"只读查询不出合约卡"）。
- [x] 6.1（补）**浏览器级用例**：`test/e2e/scenarios/contract-compliance-flow.spec.ts`（4 条：无合约→申请→签发→
  提交成功 / 有合约无感知 / 未签发如实说明 / 只查询不出合约卡）+ 共享装置
  `test/e2e/support/chat-demo.ts`；控制面桩扩了 `GET /compositions`、`POST /contracts/requests`、
  `POST /audit`、`POST /contracts/:id/approve|reject` 与仅供测试的 `__test__/state`（重置用）。
  装置支持**双账号**（医院 `p-hosp-a` / 药企 `p-sponsor`），并把 Web 侧的 `/contracts`
  转发到同一个桩进程——否则 chat-agent 与页面看到的是两份不同的合约状态。
  断言落在 `data-card-type` / `data-tone` / `data-job-id` 等数据属性上，不查文案。
- [x] 6.3 文档与截图：`DEVELOPER-GUIDE.md` §6 + 本 change 的 tasks；**RWD 单臂完整测试流程见 [`RWD-SINGLE-ARM-TEST.md`](./RWD-SINGLE-ARM-TEST.md)**（账号/数据生成/两条路线/连接器前置/排错），一键体检脚本 `node scripts/rwd-demo/prepare.mjs`；
  截图 6 张落在 [`screenshots/`](./screenshots)（用例内固定产出，可复跑）。
- [x] 6.4 演示录屏：`RECORD_VIDEO=1` 打开 Playwright 录制，产物两条落在 [`demo/`](./demo)
  （人工签发全链 / Phase 3 自动创建），复跑命令写在 `demo/README.md`。
- [x] 6.5（补）**测试环境隔离**：e2e 固定 `LLM_PROVIDER=rule-based`，否则本地 `.env` 里的真实 key
  会让用例真打外部模型（超时、烧钱、不可复现）——这是加合规测试前发现的红色基线成因之一。

## 偏差登记（需人决策）

| # | plan 的设想 | 代码/控制面的实际 | 处置 |
|---|---|---|---|
| D-1 | `check_data_access`（数据产品级访问检查） | **已按维护者决定补齐**：原判断"控制面没有该端点"成立，但结论改为**新增**产品级 ACL（表 + 端点 + 授予/回收），见 D-ACL-1 | 1.3 落地；判定由控制面给出，agent 只做提前告知与拦截。控制台页未做（授予/回收目前只有 API） |
| D-2 | 自动创建合约 + `autoApprove` + `activate_contract` | **已按 D-MDOP-9 落地（形态改写）**：平台侧 `autoApprove` 仍然不成立（那会伪造医院同意），改为"平台按 ACL 预授权自动发要约 + 持有方连接器按院内本地策略自动签"；「需审批」预审仍必须医院逐条确认（D-CMP-2） | 3.3 完成；`autoApprove` 字段仍恒 false（卡片不得承诺平台代签）。谓词不含出域预设维度（合约 schema 没这个字段） |
| D-3 | 审计报表 + CSV/PDF 导出 | **纠错**：本仓**有**审计存储与导出端点（`GET /audit`、`/audit/export`、`/audit/evidence-package`）；原判断错在"没有审计存储" | 复用既有端点 + **补 `GET /audit/export.csv`**（见 5.3/5.4、5.1b）。PDF 未做：证据包内已有可打印报告，引 PDF 依赖需单独决定 |
| D-4 | 配置卡展示现有合约 | 配置卡由模型生成，`metadata.contractId` 只能靠提示词引导 | 提交结果卡/工具返回值**确定性**带 contractId；卡片附注为提示词引导（非确定性） |
| D-5 | 14 周排期 / 里程碑 M1-M6 | 本仓无排期概念，只有可复跑事实 | 以本文件与 STATUS.md 的验证结果替代里程碑表 |
| D-6 | 审批通知（邮件/站内信） | **站内信已落地**（D-NOTIF-1：表 + 端点 + 工作台收件箱）；邮件/短信仍无生产通道（唯一邮件类是重置验证码的开发桩） | 通知到机构已达成；要加邮件/短信需先定通道与生产配置（不假装已发送） |

## 后续计划

- 2026-10-17 生产复测暴露场景化合约预检缺口，并补充统一入口与六类角色助手规划。后续实施与验收清单见
  [`plans/2026-10-17-contract-preflight-implementation-todolist.md`](./plans/2026-10-17-contract-preflight-implementation-todolist.md)。
