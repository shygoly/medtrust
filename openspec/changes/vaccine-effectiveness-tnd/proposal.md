# 疫苗真实世界保护效果（检测阴性设计 × 可信空间）

## Why

疫苗**真实世界保护效果（VE）**是 RWS 的核心问题之一，也是 AEFI 主动监测的天然续问：前者问「接种后有没有害」，
本场景问「接种后有没有用」。它比 AEFI 更难在数据不出域下做，因为判定「这次检测时点是否已处于免疫建立期」
需要把**疾控的接种日期**与**医院的检测日期**放在同一个人的时间轴上逐人相减：

- 疾控只有接种史，没有检测结果；医院只有检测结果，没有接种史；
- 任一方单独都判不出「检测日 − 接种日 ≥ 14 天」这一纳入条件，只能交换**行级日期**（C0，越线）；
- 联邦学习不适用（不是训练问题，是逐人连接 + 分层计数）；MPC 做「万级接种史 × 万级检测记录」的
  隐私连接 + 逐对日期比较，电路规模与轮次在试点资源下不可接受，且换设计就要重写电路；
- TEE（C2）可以：两方只封最小投影（关联假名 + 日期 + 白名单编码）进 TDX，节点内连接并计数，只出过闸聚合（C3）。

设计上选**检测阴性设计（test-negative design, TND）**：在「因该病就诊并做了检测」的人群内，
比较检测阳性者与阴性者的接种比例，VE = 1 − OR。它把**就医行为**（是否去看病、是否被采样）
在阳性/阴性两组间对齐，避免用全人群做分母时最常见的就医倾向混杂——这是疫苗有效性观察性研究的通行做法。

## What Changes

- 新增算子 **`rws.ve-tnd@1.0.0`**：TND 分层 2×2 计数，在可信空间节点（TDX）内执行，
  AssemblyScript Wasm 模块（`ve-tnd.wasm`，SM3 摘要随构建产出，可复现构建）。
  输出逐分层 `{vaccinatedPositive, vaccinatedNegative, unvaccinatedPositive, unvaccinatedNegative}`，
  **不输出合计**（合计减未抑制层可反推被抑制层）。
- 新增 MDOP 模板 **`ve-tnd`** 与提交入口：疾控（接种登记）+ 医院（检测记录）各 `source → seal`，
  节点内 `ve-tnd → declassify.small_cell`。
- 封装阶段按投影名（`ve-registry` / `ve-tests`）+ 编码白名单（CVX 疫苗码 / 病原检测码）**只封最小必要字段**。
- **接种状态判定在节点内完成**：检测日前 ≥14 天完成接种 = 已接种；不足 14 天 = 部分免疫（单列，不计入主分析）；
  剂次（1 剂 / 2 剂及以上）与年龄组 × 性别分层。
- 发布审查：逐层取四个格中**非零最小值**按 minCell 判；任一格偏小整层抑制，抑制层数值字段置零。
- 结果解读：事实清单前置**确定性结论行**（VE + 95% CI + 各层方向），沿用 AEFI 的**结论一致性回查**（数字对、结论说反的草稿 422 拒收）。
- 演示数据：`scripts/build-ve-records.mjs` 由 Synthea 人群（接种史复用 AEFI 抽取）+ **注入检测结局**
  （按设定的真 VE 生成阳性概率）产出两方数据与答案键；新增演示参与方（疾控）与数据产品/合约。
- 对外物料：本场景进入「面向真实世界研究的可信空间解决方案」deck/视频，受
  `tdx-attestation-pilot/external-claims.md` 红线约束（合成数据 + 注入效应量，不代表任何疫苗真实保护效果）。

**本期不做**：不做真实 VE 结论；不做 Waning/随时间变化的 VE、不做疫苗株匹配、不做多病原合并；
不做倾向评分加权与负对照校正；不做机密推理。

## Capabilities

### New Capabilities
- `vaccine-effectiveness`：跨机构（疾控 × 医院）检测阴性设计下的疫苗真实世界保护效果估计——
  模板、节点内 2×2 计数算子、最小投影封装、分层发布审查、VE 与区间确定性计算、事实清单与解读回查。

### Modified Capabilities
<!-- 无。算子 ABI 与发布审查沿用既有框架，不改需求。 -->

## Impact

- 代码：`packages/wasm-algorithms`（`ve-tnd` 模块 + `ve-tnd-model.ts` + 对拍测试 + 构建配方）、
  `apps/connector`（`ve-tnd-sandbox.ts`、`wasm-runner.ts` / `sandbox-runner.ts` 的 `ve-tnd@1` ABI、`seal.ts` 投影、
  `declassify-op.ts`）、`apps/api`（`plan-templates.ts` 模板、提交入口、合并与 VE 统计量、`result-interpreter/*`）、
  `apps/web`（结果页：2×2 分层表、VE 与 CI、免疫状态标注）、`packages/demo-scenario`（疾控参与方/产品）。
- 数据：`data/synthea/` 现有 6892 人基座可复用；新增检测结局注入与答案键（D-DATA-1 口径：Synthea 基座 + TS 注入层）。
- 部署：沿用两域拓扑（域 A 疾控/医院、域 B 校验方）与 TDX 节点；节点模块库新增 `ve-tnd.wasm`。
- 合规：数据全合成，结果 MUST 标注「合成数据 + 注入效应量」；`attestationLevel` 表述口径不变（D9 / CTL-09）。
