# 任务：RWS 阶梯迁入 MDOP + compose 页改计划编辑器

> 每型按 design D2 的**五件套**（台账 / 模板 / 收集器 / 入口 / 对拍证据）逐型收口；
> 缺任一不算迁完。旧接线删除一律受 O7 日期闸与观察窗约束（design D4）。

## 1. 编辑器组（先做：确定「计划」的单一表示）

- [ ] 1.1 compose 页的页面状态改为 `LogicalPlanDraft`（阶段 / 算子 / `at` / 合约 / 时间窗），不再维护第二套编排模型
- [ ] 1.2 向导（七个模板）与自由编辑产出**同一形状**：模板产出落进编辑器后与手改无差别
- [ ] 1.3 即时提示只做「可解释的提示」，判定（数据就近 / C2 证明策略 / 排序契约 / 阶段 id 唯一）一律留给编译期
- [ ] 1.4 提交路径收敛：编辑器 → `POST /mdop/jobs`（通用入口）或对应模板入口，二者共用同一份校验
- [ ] 1.5 用例：非法计划（缺合约 / 重名阶段 / 引用未注册算子）在页面上给出可读原因，且后端仍 fail-closed

## 2. 平台侧合并组（L0/L1 三型）

- [ ] 2.1 `rws.cohort-count`：台账 + 模板 + 收集器（各院计数相加）+ 入口 + 对拍证据
- [ ] 2.2 `rws.condition-prevalence`：同上五件套（注意分母口径：人年还是人数，须与旧链逐字段一致）
- [ ] 2.3 `rws.adverse-event-signal`：同上五件套（信号判定阈值/口径与旧链一致，不得悄悄换判据）
- [ ] 2.4 三型的 web 收敛：旧入口标 deprecated + 预计下线日；新入口落 `/space/mdop/jobs/<id>`

## 3. 站点效应量组（L2 / L3 / validation 四型）

- [ ] 3.1 `rws.comparative-effect`：站内效应量 + 标准误出域；平台随机效应合并（复用既有 meta 合并）+ 三闸门呈现
- [ ] 3.2 `rws.causal-psm`：站内 PSM/IPTW **只在站内**完成；出域仅 ATE + 标准误
- [ ] 3.3 `rws.causal-survival`：站内局部 Cox；生存曲线按高阶闸门**分箱 + 在险人数过阈值**后才出域
- [ ] 3.4 `rws.algorithm-validation`：站点级校验指标（AUC / 校准 / 决策曲线）+ 平台汇总
- [ ] 3.5 四型各自的「高阶统计量输出闸门」复核：效应量分层样本量低于阈值即抑制该效应量

## 4. 守护、台账与收尾

- [ ] 4.1 每型迁完：台账 `channel=mdop`、`state=migrated`（或 `verification` + 未过期 `expires`），附 O3 要求的证据
- [ ] 4.2 `check:orchestration` 全绿且 legacy 计数**逐项下降**；`legacyBudget` 同步下调
- [ ] 4.3 逐型删旧接线（`legacyRefs` 精确到「文件留着、这一段删掉」），受 O7 日期闸；`retained` 条目 MUST NOT 删
- [ ] 4.4 回滚演练留证：`ORCHESTRATION_FORCE_CHANNEL=<key>=legacy` 在非生产跑一次（**不改台账**）
- [ ] 4.5 收尾：`openspec validate --strict mdop-rws-ladder-migration` + `pnpm test` 全绿
