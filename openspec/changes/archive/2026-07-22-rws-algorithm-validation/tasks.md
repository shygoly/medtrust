## 1. 数据模型与类型

- [x] 1.1 `packages/database` connector-local 新增 `local_gold_standard` 实体（subjectKey / 变量定义标识 / 判定结论 / 标注来源 / 依据诊断标准 / 标注时间），登记进 `connectorEntities`（design D1）
- [x] 1.2 `apps/connector/src/domain/types.ts` 新增 `CodeSet`（编码系统 / 版本 / 编码列表 / 取值来源 / 诊断顺序四要素）与 `IdentificationAlgorithm`（编码集 + 闭合布尔规则 + 评估时间窗 + 版本号）
- [x] 1.3 新增 `ValidationMetrics` 类型（Se / Sp / PPV / NPV，各含点估计 + 95%CI）与 `ConfusionMatrix`（TP/FP/TN/FN）
- [x] 1.4 `RwsArtifactKind` 增 `validation_metrics`；`RwsAnalysisLevel` 增 `L0`；`RwsAnalysis.type` 增 `algorithm-validation`
- [x] 1.5 DOMAIN.md 覆盖矩阵新增 `local_gold_standard`（connector-local），跑 `pnpm check:meta` 确认对拍绿

## 2. 算法求值（连接器）

- [x] 2.1 实现闭合语法校验器：仅允许 `AND`/`OR`/`NOT` + 编码集成员判定 + 时间窗约束；超出构造在求值前拒绝（design D4，usage-control spec）
- [x] 2.2 写校验器负例测试：内联脚本 / 函数调用 / 动态求值构造均被拒且未被求值
- [x] 2.3 实现算法求值器：对本地记录逐主体判定，支持编码系统版本与取值来源（门诊/出院诊断）与诊断顺序约束
- [x] 2.4 编码集要素缺失（缺版本或取值来源）时拒绝任务并报明缺失项

## 3. 金标准比对与指标

- [x] 3.1 实现金标准加载：按变量定义标识取本地标注集；无标注时以明确原因失败（MUST NOT 用算法输出充当金标准）
- [x] 3.2 实现逐主体比对产出 `ConfusionMatrix`，在 TEE 内执行，`attestationLevel` 如实标注
- [x] 3.3 实现 Wilson score interval 计算（design D2），含高比例边界测试：Sp→1 时 CI 上界不越过 1
- [x] 3.4 由混淆矩阵计算四指标 + CI；DOMAIN.md 派生公式区登记指标定义与 CI 方法为唯一出处

## 4. 输出闸门

- [x] 4.1 混淆矩阵套用既有 `DEFAULT_MIN_CELL` 抑制
- [x] 4.2 实现"任一格被抑制则四指标全部不出域"联动（design D3，fail-closed）
- [x] 4.3 抑制结果标注为"因样本量不足抑制"，与"准确性低/算法失败"在返回结构上可区分
- [x] 4.4 抑制动作记入本地审计日志
- [x] 4.5 补 output-gate spec 覆盖上述四条

## 5. 控制面编排与存证

- [x] 5.1 `rws-orchestrator` 增 L0 任务编排；L0 MUST 跳过 `MetaAnalysisService`，按 `providerId` 分列（design D6）
- [x] 5.2 DTO 校验：算法定义结构完整性 + `validation_metrics` 产物白名单 + L0 分级授权（usage-control spec）
- [x] 5.3 验证结果哈希上链存证，绑定三元组（算法版本 / 数据源 / 标注集版本）
- [x] 5.4 算法升版后旧验证结果标记为不适用于新版本；历史结果保留不覆盖
- [x] 5.5 已验证算法的准确性随 L1.5–L4 报告带出；未验证不阻断执行（design D5，rws-compute spec）

## 6. 前端

- [x] 6.1 L0 任务提交界面（算法定义 + 目标变量 + 数据源选择），遵循 DESIGN.md §4 原型与 §9 禁止清单
- [x] 6.2 准确性指标展示（`DataGrid`，按数据源分列，四指标 + CI），空值统一 `—`
- [x] 6.3 抑制态与低准确性态在 UI 上显著区分（design D3 的误读风险缓解）

> **实现说明**：
> - 6.1 在 RWS 提交表单（`apps/web/src/app/(console)/space/tasks/new/rws/page.tsx`）
>   的分析类型下拉中新增 `algorithm-validation`，选中后条件渲染 L0 专属字段：
>   闭合语法 JSON 编辑器（默认填一份 DM2 codeset 示例）+ 变量定义标识 + 金标准集版本。
>   表单提交前在客户端做 JSON 解析校验；合约未授权 `validation_metrics`/`L0` 时
>   在策略预览面板（`ContractPolicyPreview`）显著标注并禁用提交。
> - 6.2 由新组件 `apps/web/src/components/console/orchestration/l0-validation-panel.tsx`
>   承载：`DataGrid` 七列（数据源 / Se / Sp / PPV / NPV / 状态 / 金标准），
>   每行一家数据源（D6 分列）；数字右对齐 `cs-mono tabular-nums`，
>   空值统一 `—`（遵循 DESIGN.md §6）。
> - 6.3 抑制态用红色 `cs-chip` + `ShieldAlert` 图标显著区分；已出具（即便准确性低）
>   用绿色 `cs-chip` + `ShieldCheck`——D3 要求的结构区分在 UI 上落到实处。
> - §7.3 合成数据来源通过顶栏 amber 警告横幅（MUST NOT 用于监管申报）+ 每行金标准列
>   双重展示；标签契约固化于 `apps/web/src/lib/l0-validation-labels.{mjs,test.mjs}`。
> - DESIGN §10 浏览器截图自查：已通过 dev server + Playwright 截取
>   `l0-form-selected.png`（提交表单 L0 态）与 `l0-detail.png`（详情页 L0 结果），
>   两态均绿/红 chip 区分清晰、暗色主题一致。

## 7. 端到端与治理契约收尾

- [x] 7.1 Synthea 合成数据造金标准标注，跑通单院 L0 闭环
- [x] 7.2 双院 e2e：两家医院分列出具准确性，验证 MUST NOT 合并
- [x] 7.3 合成数据来源在 UI 与报告中标注；明确合成结果 MUST NOT 用于申报
- [x] 7.4 `FLOWS.md` 新增 `FLOW-RWS-05` 验证链（本地比对 `raw-local`/`none` → 混淆矩阵 `aggregate-only`/`connector→control` → 存证 `evidence-hash`/`control→chain`）
- [x] 7.5 `TRUST.md` 登记 `local_gold_standard` 敏感分级（判定结论，等同临床诊断）与算法入站载荷的语法校验控制点
- [x] 7.6 `EVIDENCE.md` 覆盖矩阵第 11、12 项转 `已承载`；P-EVD-2 移入 §2 正册为 `EVD-05`（enforcement 指向本 change 落地的符号）
- [x] 7.7 `DOMAIN.md` 术语表增"金标准""混淆矩阵""操作性定义载体"
- [x] 7.8 全量 `pnpm check:meta` 绿 + 受影响 spec 全绿；负向验证：删掉 `EVIDENCE.md` 覆盖矩阵第 11 行的承载字段应报红

> **覆盖说明**：
> - 7.1/7.2 由 `apps/connector/src/domain/algorithm-validation/l0-synthea-e2e.spec.ts`
>   与 `l0-double-hospital-e2e.spec.ts` 实跑（数据存在时跑真实 Synthea 路径，不存在时
>   `describe.skip` 跳过并以 fixture smoke test 兜底）。
> - 7.3 的数据通路（连接器 → 编排器 → `merged.l0Validation`）由
>   `rws-orchestrator.service.spec.ts` 断言；UI 标签契约由
>   `apps/web/src/lib/l0-validation-labels.{mjs,test.mjs}` 固化（前端页面本身仍在 §6 延后范围）。
> - §6 前端页面继续延后；`DataGrid` 已存在于 `apps/web/src/components/console/data.tsx`，
>   后续 change 直接消费 `L0ResultLike` + `l0ResultFootnote` 即可。
