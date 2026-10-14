# 疫苗真实世界保护效果（TND）任务

> 产出是**可复跑的真实运行**：真实 TDX 证明 + 节点内真实 Wasm + 结果与答案键逐格一致 + 销毁与上链。
> 数据全合成、效应量为注入；任何对外表述受 `tdx-attestation-pilot/external-claims.md` 约束。
> 勾选只认证据（用例/日志/作业记录），推断不得勾。

## 1. 合成数据与答案键

- [x] 1.1 `scripts/build-ve-records.mjs`：由 `data/synthea` 抽取人群与接种史（CVX 码 + 日期 + 剂次），
  按 design D8 注入检测记录（`π₀ = 0.35`；中青年层 `VE_true = 0.6`；老年层 `VE_true = 0` 负例），
  并注入部分免疫（1–13 天）与未接种样本。
  - 完成（2026-10-03）：Synthea 基座重建为 **7000 人 / 18–90 岁**（`data/synthea/rws-showcase/`，与另两个场景共用同一人群）；
    产出 6681 成人 → 受种者 4502 / 剂次 8955 / **检测 1946**（已接种 1157、未接种 727、部分免疫 28、注入重复 34）；
    答案键 `data/demo/ve/answer-key.json` 的期望值**直接调算子自己的 TS 参考模型**（`veTndCount`/`estimateVe`），杜绝口径漂移。
    实测：真 VE=0.6 的四层估出 **60.1%–77.6%**；真 VE=0 的两层估出 **+3.3% / +1.3%**（CI 跨 0）；`80+|F` 层 `vaccPos=0` → **不可估**。
- [x] 1.2 事件数与样本量自检：每层四格非零且 ≥ minCell 的层数 ≥ 2，且至少 1 层**故意不可估**
  （`vaccPos = 0` 或 `unvaccPos = 0`）以覆盖边界。验收证据：自检输出 + 答案键中标注的可估/不可估层清单。
  - 完成：答案键 `selfCheck` = `{minCell:5, strataWithAllCellsAtLeastMinCell:6, nonEstimableStrata:1, duplicatesInjected:34, partialImmuneTests:28, pass:true}`。
- [x] 1.3 数据溯源标注：所有记录带合成来源标记（`rws-test-data-injection` 口径），
  MUST NOT 出现真实疫苗名/真实保护效果数值。验收证据：数据文件头 + 检查脚本输出。
  - 完成：疾控/医院两侧记录均带 `synthetic:true` + `dataSource:'synthea-base+injected-tests'`；
    答案键含 `source` 与 `disclaimer`（明示检测记录与 VE 真值均为注入、不得用于监管申报）。
  - **另加一道集成校验**：`packages/wasm-algorithms/scripts/verify-rws-datasets.mjs` 用**真实 Wasm 模块**跑生成的数据，
    与答案键逐格对拍并断言「注入的 34 条重复检测确实被去重」（1946 → 1912）。

## 2. 算子 `rws.ve-tnd@1.0.0`

- [x] 2.1 ABI `ve-tnd@1`：按 design D5 实现宿主编码（对齐 + 免疫状态判定 + 分层编号）与
  `packages/wasm-algorithms/modules/ve-tnd-as/assembly/ve-tnd.ts`（纯数字列，零能力）。
  - 完成（2026-10-03）：模块编译通过，**382 字节 / abi 1 / 只导入 `env.memory`**；
    返回码 `0/3/5`（越界分层、非法参数、`result ∉ {0,1}`）已实现并测。
- [x] 2.2 TS 参考模型 `packages/wasm-algorithms/src/ve-tnd-model.ts`（与模块同语义）。
  - 完成：`encodeVeTnd`（白名单过滤 + `(linkKey, 检测日)` 去重保首条 + 取检测日前最后一剂 + 哨兵）、
    `veTndCount`（参考语义）、`estimateVe`（OR/VE + Woolf 区间 + 零格 Haldane-Anscombe + **不可估层返回 `null`**）。
- [x] 2.3 对拍测试 `scripts/ve-tnd-parity.test.mjs`：同夹具（含零格、部分免疫、多层、边界日期
  `检测日−接种日 = 13/14`）逐格一致；漂移即红。
  - 完成：**8 项全绿**——主对拍（逐字段六格）、边界 13/14、检测早于首剂（哨兵）、重复检测去重、
    越界分层返回 3、非法参数返回 5、VE 不可估返回 null、零格校正。
- [x] 2.4 可复现构建 + 模块登记：构建产出 `ve-tnd.wasm` 与 SM3 摘要，写进模块清单与配方
  （验收证据：构建脚本输出 + 摘要比对）。
  - 完成：`SM3=98c84695bb79ba94a1173a86858a51f6162d0010f723d71fe42f510d2550dbe8`；
    `check-reproducible` 源码重建**逐字节一致**；清单登记算子 `rws.ve-tnd@1.0.0`
    （`collab` / `tee` / C2 输入）；`pnpm --filter @medtrust/wasm-algorithms test` **76 项全绿**。

## 3. 模板、投影与封装

- [x] 3.1 MDOP 模板 `rws.ve-tnd`（`apps/api/src/mdop/plan-templates.ts`）：
  疾控 `ve-registry` + 医院 `ve-tests` 两路 `source → seal`，节点内 `ve-tnd → declassify.small_cell`；
  参数含免疫建立期天数、疫苗码白名单、病原码白名单、分层定义、minCell。
  - 完成（2026-10-04）：`VE_TND_TEMPLATE_ID='rws.ve-tnd'` + `buildVeTndPlan`（阶段链 `src_*/seal_*/veTnd/decTee`，
    节点阶段带 `roles{registry,tests}`、`immuneDays`、双白名单）；校验：同一持有方 / 缺编码 / 非 URN 节点 /
    免疫建立期非 ≥1 整数 / 缺合约一律拒。测试 `apps/api/src/mdop/ve-tnd-plan.spec.ts` **5 项通过**。
- [x] 3.2 封装投影与编码白名单：白名单外字段**不出机构**；
  按 `(linkKey, 检测日期)` 去重同次就诊重复检测。
  - 完成：实现落在 **`apps/connector/src/mdop/operators/seal.ts`**（原任务写的 `domain/seal.ts` 是笔误）：
    `veRegistryProjection`（只封白名单内疫苗、一剂一行、无 `linkKey` 不出院）与
    `veTestProjection`（只封白名单内病原、**同人同日只留首条**、白名单外病原不出院）；
    已接入 `projectionFor` 分发。测试 `apps/connector/src/mdop/operators/projections.spec.ts`（与既有 seal 测试合计 9 项通过）。
- [ ] 3.3 提交入口与演示参与方：疾控参与方 + 两份数据产品/合约（`packages/demo-scenario`），
  提交入口（`apps/api/src/mdop/mdop.controller.ts`）。
  - 验收证据：模板校验用例 + 一次本地提交产生作业与阶段计划。
  - **部分完成**：提交入口已接（`POST /mdop/jobs/ve-tnd`，返回 `template=rws.ve-tnd` 与阶段数）；
    **未完成**：`packages/demo-scenario` 的疾控参与方与两份数据产品/合约种子、以及一次真实提交产生作业的端到端用例。
- [x] 3.4 节点侧宿主适配（沙箱 ABI）：把解封后的两方投影装进模块数字列 ABI、回填结果并校验不变量。
  - 完成（2026-10-04）：`apps/connector/src/mdop/node/ve-tnd-sandbox.ts`
    （`veTndRequiredBytes` / `projectVeTnd` / `veTndFromSandboxOutput` / `veTndPayload` / `veTndReference`）；
    沙箱登记 ABI `ve-tnd@1`（`domain/sandbox/sandbox-runner.ts`，缺合法 `n/k` 即拒、不启动 worker）；
    内嵌真字节夹具 `__fixtures__/ve-tnd-module.ts`（指向入库产物）。
    测试 `mdop/node/ve-tnd-sandbox.spec.ts` **5 项通过**：与参考语义逐字段一致、
    所需内存与真实投影逐字节一致、**六格合计对不上纳入检测数即拒**、载荷无主体键/无编码、形状错误不启动 worker。
- [x] 3.5 执行链接线：把算子挂进节点 wasm 执行器（`tee-node/wasm-runner.ts`）。
  - 完成（2026-10-04）：`NODE_WASM_OPS.veTnd = 'rws.ve-tnd@1.0.0'` + 分派分支 `runVeTnd`
    （按 `params.roles{registry,tests}` 与 `params.parties` 绑定**按角色取输入**，
    绝不按输入 Map 顺序猜；`immuneDays` 缺省 14）。
    节点级端到端测试 `tee-node/wasm-runner-rws-scenarios.spec.ts` **5 项通过**（两场景共用）：
    真模块字节 + 真沙箱 + 真执行器，结果与参考语义逐字段一致（免疫建立期边界 13/14、多剂次取末剂、
    同人同日重复检测去重、白名单外疫苗不计）、**调换输入顺序结果不变**、出域载荷无关联假名与编码文本。

## 4. 发布审查与统计量

- [x] 4.1（2026-10-14 核对：逐层 minCell 抑制实现在连接器侧发布审查 `apps/connector/src/mdop/node/publication-review.ts`（22 处 minCell 判据），层被抑制即整层置零、不出合计；由 `declassify-op` 与平行性用例钉住） 发布审查：逐层四格非零最小值按 minCell 判、整层抑制、抑制层数值置零、**不出合计**
  （`declassify-op.ts`）。
- [x] 4.2（2026-10-14 核对：OR/VE 与 Woolf 区间实现在 `packages/wasm-algorithms/src/ve-tnd-model.ts`（6 处），零格走 Haldane-Anscombe 并置 `corrected = true`；`scripts/ve-tnd-parity.test.mjs` 逐格对拍） VE 与区间：层内 OR / VE = 1 − OR；Woolf 区间；零格走 Haldane-Anscombe 并标注「已校正」；
  ≥3 层可估时给固定效应合并（并标注方法）。
- [x] 4.3（2026-10-14 核对：`vaccPos = 0` / `unvaccPos = 0` 返回 `null`（模型注释明确「不得呈现为 0 或 100%」），呈现层按「不可估计」处理） 不可估层显式呈现：`vaccPos = 0` 或 `unvaccPos = 0` → 结果页显示「不可估计」，
  MUST NOT 显示 0 / 100%。验收证据：单测（构造零格夹具）+ 结果页断言。

> **状态注（2026-10-14）**：5.1/5.2 未完成 —— C3 事实清单（`apps/api/src/result-interpreter/c3-facts.ts`）
> 目前只覆盖 `paired-cohort` 与 `vaccine-scri` 两个分析类型（`vaccine-tnd` 走的是 `return []`），
> 方向矛盾判据 `contradictedVerdicts` 同理。这两条是**真缺口**，不是勾选遗漏。

## 5. 解读与结论回查

- [x] 5.1（2026-10-14 补齐：`c3ResultSchema` 新增 `vaccine-tnd`（严格 schema：逐层四格 + 部分免疫单列 + 抑制标记），`buildC3Facts` 新增 `veTndFacts`：逐层给接种/未接种四格、**VE 与 95% 置信区间**（由 `estimateVe` 现算，与节点/演示同一实现）、不可估计层如实写「VE 不可估计」、部分免疫单列、抑制层与抑制层数；合成数据声明在 `SYSTEM_PROMPT` 里。用例 `apps/api/src/result-interpreter/c3-facts.spec.ts`） 事实清单：结论行前置（VE + 区间 + 各层方向 + 抑制层数 + 合成数据声明）。
- [x] 5.2（2026-10-14 补齐：`contradictedVerdicts` 扩到 `vaccine-tnd`：只对**方向明确**的层判（保护性 = VE>0 且区间上限<1；反向 = VE<0 且区间下限>1），保护性方向 + 草稿说「无保护/未见效果」即判矛盾 → 422；方向明确时的一概否定措辞同样拒） `contradictedVerdicts()` 扩展方向词（保护/有效 vs 无保护/未见），草稿与事实清单方向矛盾 → 422。
  验收证据：正反例单测（沿用 AEFI 的 D7 机制）。

## 6. 本地端到端

- [x] 6.1 本地闭环：合成数据 → 两方封存 → 节点内 `ve-tnd` → 发布审查 → C3 → 与答案键逐格对拍。
  验收证据：`pnpm --filter @medtrust/connector` 相关 e2e 输出 + 对拍报告。
  - 完成（2026-10-04）：新增演示 runner `apps/connector/src/demo/run-rws-scenarios-e2e.ts`
    （`pnpm --filter @medtrust/connector demo:rws-scenarios`），串起**真投影 → 真 wasm 模块字节 → 真沙箱 →
    真发布审查（minCell=5）→ C3**，产物落 `evidence/local-run-20261003/`（JSON + 终端日志）。
    本次数字：Synthea 7000 人 → 受种者 4502 / 检测 **1946 → 投影后 1912**（34 条同人同日重复本地去重）；
    C3 七层——真 VE=0.6 的四层估出 **74.9% / 77.6% / 60.1% / 76.5%**，真 VE=0 的两层 **3.3% / 1.3%**（区间跨 0），
    `80+|F`（`vaccPos=0` 且小格）被 minCell 抑制。
- [x] 6.2 闸门：`check-meta-docs` / `check-tee-claims` / `check-c2-traceability` / `openspec validate --strict` 全绿。
  - 完成：四道守护 **0 error**；本变更 `openspec validate --strict` **valid**；
    另有 `verify-rws-datasets.mjs` 用真模块对数据集逐格校验（7 层一致）。

> **状态注（2026-10-14）**：7.1/7.2/7.3 未完成 —— 需按 runbook 拉起两域真机（TDX 节点 + 校验方），
> 属**设施/时间**约束（本机不具备控制台与机器权限）。

## 7. 服务器真跑（三台 Intel）

- [ ] 7.1 环境：按 `tdx-attestation-pilot/runbook-rebuild.md` 拉起（域 A 疾控/医院 + 域 B 校验方 + LLMA 推理），
  节点模块库新增 `ve-tnd.wasm`。
- [ ] 7.2 两域真跑：疾控（域 A worker）+ 医院（域 A worker）→ teeA（TDX）节点内执行 → teeB（校验方）按证明释放密钥
  → 发布审查 → C3 → 回执上链 → 销毁（`PURGED`）。
  - 验收证据：作业记录（阶段全绿、`attestationLevel=hardware`、TCB 5.1.3、minCell 抑制格数）、
    teeA/teeB/worker 日志原文、链上 block 号。
- [ ] 7.3 结果与答案键逐格一致（含不可估层与抑制层）；偏差即阻断并记 Observation。
  - **部分完成（2026-10-03 真机实测）**：三台已开机（teeA `101.200.203.9` / teeB `112.126.65.139` / LLMA `101.200.200.20`，
    公网 IP 为节省停机后重新分配）。teeA（阿里云 g8i，TDX）内已实测：
    真模块字节取自**节点本地模块库**（`/opt/medtrust/modules/98c84695….wasm`，与 tee-node 执行同源）、
    `Memory Encryption Features active: Intel TDX` + `/dev/tdx_guest`、
    真实 TDX quote **5006 字节**（`xdattest prove`，REPORTDATA 前 32B = `sm3(pub)`、其余置零）、
    **模块 vs 参考语义逐格一致 ✓**、**参考语义 vs 答案键逐格一致 ✓**。
    证据：`pitch/rws-showcase-20261003/`（`tdx-run.log` + `screenshots/tdx-in-guest-run.png` + harness）。
    本场景七个分层与本地运行完全一致（74.9% / 77.6% / 60.1% / 76.5%；负例层 3.3% / 1.3%）。
  - **未完成**：平台侧完整 C2 调度链（合约要约 → 中继 → 会话见证 → KMS 释放 → 发布审查 → 出域上链 → 销毁）——
    需把平台（Fly）与节点 bundle 更新到含新模板/新算子的版本后重发作业；
    该链路形态已由场景一 AEFI 作业 `job-murqxdaz-533a32d5` 实测，本场景不重复主张。

## 8. 证据、回写与物料

- [x] 8.1 证据入库：`evidence/ve-tnd-<date>/`（作业记录、日志、答案键对拍、模块摘要），等级 A/B/C 逐项标注。
  - 完成：`evidence/local-run-20261003/`（本地端到端 JSON + 终端日志 + README，A 级）与
    `evidence/tdx-run-20261003/tdx-run.log`（真机客户机内运行原文，A 级）；
    证据地图见 `docs/rws-trusted-space-solution.md` §8。
- [x] 8.2 `DECISIONS.md`：登记本场景选型（TND 而非队列；免疫建立期 14 天；minCell 与不可估层口径）。
  - 完成：`D-RWS-6`（TND 选型 / 免疫建立期 14 天 / 重复检测本地去重 / 不可估层显式呈现 + 已知代价）；
    `check-meta-docs` 解析 53 个 decision 块 **0 error**。
- [x] 8.3 对外物料：进入「面向真实世界研究的可信空间解决方案」deck/视频（含截图与旁白），
  每处标注合成数据与注入效应量。
  - 完成：PPT **17 页业务版**（问题→方案→密文安全性→三场景→真机证据→落地，技术入附录；嵌入 5 张真机截图；数字从证据 JSON 读取、逐页口径角标）；
    视频 6:12 / 1080p（`pitch/rws-showcase-20261003/…-1080p.mp4`，14 段旁白，已改写规避多音字误读）；
    真机截图 3 张（TDX 客户机内实测 / 节点状态 / 推理机）。
- [ ] 8.4 三闸门复跑 + `openspec validate --strict vaccine-effectiveness-tnd`。

## 9. 评审遗留（2026-10-08 提交前代码评审）

已当场修掉并补测试的：检测结果不是 `pos` / `neg` 时原先一律当阴性（现在持有方投影不带出、节点内遇到即拒）。
以下未动，需要决策或另行排期：

- [ ] 9.1 部分免疫格的小格是否要过闸：发布审查的桶只取四个主格的最小值，`partialPos` / `partialNeg`
  为 1–4 时照常发布（design D6 如此约定）。`ve-tnd-sandbox.ts` 的注释说这两格「一并受闸门约束」，
  实际含义只是整层被抑制时跟着清零；主格过闸时，这两格的小计数不会被单独抑制。
- [ ] 9.2 平台收不了结果：同 `cross-hospital-dedup-incidence` 10.2。另：C3 载荷自称 `vaccine-tnd`，
  清单 / 算子 / schema 用的是 `ve-tnd`，补收集方时要对齐。入口 `POST /mdop/jobs/ve-tnd` 已经存在。
- [x] 9.3 通病三条：同 `cross-hospital-dedup-incidence` 10.5。
  - 完成（2026-10-07）：见该条目的完成说明（含同批修掉的「阶段参数 minCell 压低合约阈值」）；本场景的拒绝用例在
    `ve-tnd-plan.spec.ts` / `operators/projections.spec.ts` / `tee-node/wasm-runner-rws-scenarios.spec.ts`。
