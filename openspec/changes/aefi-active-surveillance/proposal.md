## Why

Intel 演示原场景（两院胰腺炎配对队列）能跑通，但讲不清「为什么非 TEE 不可」：两院各自算、只出聚合，协同计算也能做。疫苗接种后不良事件（AEFI）主动监测是公共卫生里协同计算做不到、TEE 能做到的典型：**暴露（接种日期）在疾控，结局（就诊日期）在医院**，判断「事件是否落在接种后风险期」必须把同一个人两边的**日期**放在一起逐人相减，任何一方单独都算不出风险期/对照期计数；而 MPC 做逐人日期差 + 跨机构连接在万级剂次上代价过高，联邦学习不适用于逐人连接计数。

## What Changes

- 新增算子 `rws.vaccine-scri@1.0.0`：自身对照风险期（SCRI）设计的计数，在可信空间节点（TDX）内执行，AssemblyScript Wasm 模块（`vaccine-scri.wasm`，SM3 `d7dd3848…ab4e5a`，可复现构建）。输出逐分层 `{doses, riskEvents, controlEvents}`，不输出合计（合计减未抑制分层可反推被抑制层）。
- 新增 MDOP 模板 `vaccine-scri` 与提交入口 `POST /mdop/jobs/vaccine-scri`：疾控（接种登记）+ 医院（就诊事件）各 `source → seal`，节点内 `scri → declassify.small_cell`。封装阶段按投影名（`scri-registry` / `scri-events`）+ 编码白名单（CVX / ICD-10）只封最小必要字段。
- 发布审查：SCRI 分层按「风险期与对照期中较小的非零计数」判小单元格，任一格偏小整层抑制；被抑制分层的全部数值字段置零。
- 结果解读：新增 SCRI 事实清单（相对发生率 + Clopper-Pearson 精确 95% CI，服务端确定性计算）；**结论行前置**；新增**结论一致性回查**（数字都对、结论说反的草稿拒收）。
- 演示数据：`scripts/build-aefi-records.mjs` 由 Synthea 合成人群（接种史）+ 注入的心肌炎/心包炎合成信号生成两方数据与答案键；新增演示参与方「区疾控中心（演示）」与两份数据产品/合约。
- 修复（整体测试中暴露、两场景共有）：
  - 节点/语料销毁回执改用协议规范签名（`signCanonicalObject`），此前平台验签恒失败、作业到不了 `PURGED`；
  - 会话见证转发对象补上**数据持有方**（合约提供方）——此前只按合约接收方转发，C2 合约里持有方不在接收方中，D13「持有方自己验」从未发生；
  - 作业视图「应上报见证的节点」只取凭证里冻结了执行环境期望的可信空间节点（此前把持有方也列为「未上报见证」）。

## Capabilities

### New Capabilities
- `vaccine-safety-surveillance`: 跨机构（疾控 × 医院）疫苗接种后不良事件 SCRI 主动监测——模板、节点内算子、最小投影封装、分层发布审查、事实清单与解读回查。

### Modified Capabilities
<!-- 见证转发、销毁回执签名属 tdx-attestation-pilot / mdop-kernel 在途变更的实现缺陷修复，不改需求；不在 openspec/specs 主规格范围内。 -->

## Impact

- 代码：`packages/wasm-algorithms`（模块 + `scri-model.ts` + 对拍测试 + 配方）、`apps/connector`（`scri-sandbox.ts`、`wasm-runner.ts`、`sandbox-runner.ts` 的 `scri@1` ABI、`seal.ts` 投影、`declassify-op.ts`、`node-artifacts.ts` / `corpus-store.ts` 签名）、`apps/api`（`plan-templates.ts`、`mdop.controller.ts`、`collect-vaccine-scri.ts`、`mdop-merge.service.ts`、`mdop-messages.controller.ts`、`mdop-contract.service.ts`、`result-interpreter/*`、`contract.service.ts` 种子）、`apps/web`（作业页时间窗 + 分层表、解读载荷）、`packages/demo-scenario`（疾控参与方/产品）。
- 部署（ali29 + 北京 TDX 试点）：新增 `rws-worker-c`（疾控，`hosp_c` 网络 172.27.0.0/16）、`kms-tunnel` 增加 `HOSP_C_GW`；api 镜像 `rel-20261003h`；teeA 节点 bundle 与模块库新增 `vaccine-scri.wasm`。
- 对外物料：Intel 演示方案主场景由「胰腺炎配对队列」改为「mRNA 疫苗 × 心肌炎/心包炎 SCRI」，受 `tdx-attestation-pilot/external-claims.md` 红线约束（合成数据、注入信号、不代表任何疫苗真实风险）。
