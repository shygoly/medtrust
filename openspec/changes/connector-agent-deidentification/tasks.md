# Tasks

## Phase 1：规格 + agent 内置算子（结构化字段）

- [x] `packages/proto/deidentify.proto`：双向流 `DeidentificationAgent.RunDeidentification`（受限投影块 → 脱敏块 + 回执，字段白名单）
- [x] DeidSpec schema 落 `packages/mdop/src/schema/deid.ts`（领域中立）：算子枚举、参数上界（`k≥5`、`maxDays≤30`、`outLen≤64`）、`denyIfTransformMissing`；5 条正反例用例
- [x] 平台签发：`apps/api` 规格生成/签名/版本表（`cp_deid_spec`）、随任务下发；复用注册中心用途密钥（`runtime/deid-spec/`，`cp_deid_spec` 实体 + 迁移，批次字段 `deidSpecs`/`deidRevocations`）
- [x] 连接器：`apps/connector/src/domain/deid/` —— 取规格、验签、SM3、版本单调、吊销检查、**降级检测**（与合约条款比对）（`spec-package.ts` / `downgrade.ts` / `deid-mode.ts` / `deid-runner.ts`，20 条负例）
- [x] 连接器：gRPC client（沿用 `AGENT_GRPC_URL` + `x-agent-token`）与回执校验（`input_digest`/`output_digest`/`spec_sm3`）（`agent-deid-client.ts` + `deid-runner.ts#verifyReceipt`；输出摘要按收到的**字节**重算）
- [x] agent：`deidentify_servicer.py` + 内置算子（drop/keep/generalize/hmac_pseudonym/date_shift/bucketize/truncate/suppress/text_rules）
- [x] agent：将 `medtrust_agent.deid_spec.parse_deid_spec` 接入 gRPC 服务，规格**再校验**（不信任连接器转发）+ 通过本地 salt-provider seam 按 `salt_ref` 取盐，缺失即 DENIED（真实 KMS/Vault adapter 待接入）
- [x] agent：本地审计链 + `agent_receipt`；响应不含数据行/样本（`deid_audit.py`，SM3 前向链接、拒绝也留痕；错误消息去掉字段值，只留字段名）
- [x] 开关 `CONNECTOR_DEID_MODE=builtin|agent`（缺省 builtin）；`agent` 模式下禁止绕过（`deid-mode.ts#assertNoBuiltinBypass`，非法值不静默回落）
- [x] 负例：规格非法/盐缺失/超 `row_limit` → fail-closed 且不退回弱脱敏（9 个 Python 用例）
- [x] golden corpus 一致性回归（builtin vs agent，结构化字段逐字段比对）（`golden-corpus.spec.ts` + `apps/agent/scripts/deid_golden.py`；假名只比性质不比字节——HMAC vs 裸摘要是有意差异）
- [x] TRUST.md 登记控制点：脱敏有效性（直接标识零残留、准标识 k 阈值、降级拒绝）（CTL-32；DOMAIN.md INV-DEID-02/03；DECISIONS D-CN-9）

## Phase 2：自由文本

- [x] `text_rules`：手机号/身份证/地址/人名的正则 + 词典（含中文姓名表版本 `dictionaryRef`）（词表**内容留院**、平台只签摘要：`cp_deid_dictionary` + `deidDictionarySignaturePayload`；`person_name` 必须绑 `dictionaryRef`（mdop/py 双侧校验），连接器验签清单→agent 读本院文件自算 SM3 比对，缺失/不符即 DENIED）
- [x] 残留检测：变换后再扫一遍直接标识，命中即 FAILED（不把残留带进本地库）（`assert_no_residual_identifiers`：手机号/身份证/邮箱/地址/词表姓名；命中行**不发出**，消息只带字段名与类别）
- [ ] 可选 NER 插件：签名 Python 包 + 进程隔离（无网络、只读挂载、资源限额、seccomp），复用模块准入（SM3/签名/吊销/白名单）—— **前置条件未满足**：真隔离需要 Linux（seccomp/cgroup/只读 bind mount），在 macOS 开发机上只能做出「看起来隔离」的假件，故不做
- [x] 重识别评估脚本（准标识组合 + 自由文本残留），产出可附评测材料的报告（`apps/agent/scripts/deid_reidentification_report.py`：直接标识残留 / k 匿名性 / 敏感列多样性粗口径；输出 JSON + Markdown，报告不出任何字段值，明确不宣称匿名）

## Phase 3：跨院对齐（独立决策）

- [x] 可对齐假名方案评审：OPRF vs 医院共管 HMAC 密钥 vs 可信第三方对齐服务（`phase3-alignment-pseudonym.md`，结论 = 共管 HMAC-SM3 + 用途分域 + kid 轮换；OPRF 列升级路径并给出四条切换判据；TTP 否决。决策 D-CN-10 / 控制点 CTL-33 / 不变量 INV-DEID-05）
- [x] 与 `cross-hospital-dedup-incidence` / `rws.paired-cohort` 的衔接（对齐键在 C1/C2 链路中的位置）（评审 §4：派生在连接器、linkKey 只在 seal 投影里出现、C2 只见 linkKey+白名单编码、平台不见；顺手修掉两处「拿 subjectKey 冒充 linkKey」：`wire-mdop-rws` 的 L1.5 投影与本地 demo）
- [ ] 衔接（续）：跨院投影构造器的派生接线 —— `LocalDataLoader` 已接 `AlignmentLinker`（文件路径）；**待接入**：`apps/connector/src/domain/data-source/cdm-projection.ts`（CDM 路径需把主索引列纳入本地投影后再派生）、`apps/connector/src/mdop/operators/seal.ts` 三个跨院投影的调用方（dedup / paired / scri 的 plan 组装处）、以及 demo 数据里注入跨院重复患者时用同一把钥派生 `linkKey`

## 文档

- [x] `docs/deploy/部署硬件需求-v2.md` §4.5.1：agent 侧大表脱敏的内存/CPU 需求与拆库建议（块级流式：内存不随总行数增长，瓶颈在 CPU；>500 万行先按 §4.5.2 拆库）
- [x] `docs/omop-cdm-onboarding.md`：数据源 label → 连接器受限投影字段的对应关系（agent 不接收数据源引用）（新增 §6.1 投影字段表 + 盐/词表交接）
- [x] DECISIONS 新条目：脱敏规格由平台签发、执行在院内、盐归医院（与 D-CN-6 同向）（D-CN-9）
