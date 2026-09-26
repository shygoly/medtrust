# CURSOR TASKS — C2 机密计算加固（无需硬件，仓内可完成）

> **给 Cursor 的工作单。** 依据：`docs/tee-two-changes-audit-2026-09-26.md` 的收口结论 +
> `TRUST.md` P-CTL-8 + 一次针对「软 TEE → 硬 TEE 迁移」的代码勘查。
> **本单只含不需要硬件、不需要医院决策的仓内欠账**；被外部前置卡住的 12 条不在本单。
>
> 生成日：2026-09-26 · 基线提交：`8dd3810`（`master`）
> 前置阅读（按需切片读，勿全文加载）：`AGENT-OPS.md`（**必读**）· `TRUST.md` P-CTL-2/P-CTL-8 ·
> `DECISIONS.md` D9 / D-TEE-1 / D-TEE-3 · `openspec/changes/tee-attestation-pilot/design.md` §P3 发现 1–7

---

## 0. 为什么是这七个任务（一句话）

硬件到位前，仓里有**四条会让硬件接入失败的前置**没做——其中最致命的一条是：
`ephemeral_public_key` 被当作普通字段校验，**从未绑定进硬件签名的 quote**（全仓 `packages/mdop`
里 `report_data` 零命中），因此 KMS 用它对数据密钥加密**在密码学上是空的**，攻击者可换成自己的公钥。
这一条不做，**硬件到了整个「证明绑定密钥释放」链也不成立**。

---

## 1. 治理前置（**开工前必须落定，否则本单全部违规**）

`AGENT-OPS.md` 是本仓的强制契约。以下不是建议，是前置。

### 1.1 T0（先做，属治理动作）— 确定 Cursor 的血缘 role id

`AGENT-OPS.md` §1 能力注册表是**闭集**，明文规定「尚未落地的不得预登记（MS-37）；
新增角色 = 改本表 + 落代码，**同一提交**」。

现状：`.agent-runs/` 里出现过的 role 是 `research` / `impl` / `test`，**没有 `cursor`**。

**两条路，选一条，不要默认跳过：**

| 选项 | 做法 | 代价 |
|---|---|---|
| **A（推荐）** | Cursor 复用已注册的 `claude-code-session` 角色——其登记形态正是「单 agent 串行 · 读写工作区文件 · 跑 shell 命令 · 网络检索 · 最高 L2」，与 Cursor 完全吻合 | 零改动；但 id 名带 "claude" 语义不贴 |
| B | 新增 `cursor` 角色行 | 改 `AGENT-OPS.md` §1 表格 = **L2 契约表格**，须与「落代码」同一提交，且人放行 |

> **如果选 B，注意 §7 附录格式契约**：§1 首列须为反引号角色 id、至少一行、最高动作等级为 L0/L1/L2；
> **任一契约表解析为 0 行 = 红**（`pnpm governance`）。

### 1.2 本单所有任务的等级 = **L2（强制人工放行）**

按 §2 归级规则（AG-14 fail-closed）：

| 触达路径 | 等级 | 依据 |
|---|---|---|
| `apps/connector/src/domain/**` | **L2** | §2 明文列出（含 output-gate/PEP/守卫，"改它不会报错，会静默削弱出域闸"） |
| `packages/mdop/src/**` | **L2** | 未匹配任何路径面 → fail-closed 归 L2 |
| `apps/connector/src/tee-node/**` | **L2** | 同上 |
| `apps/api/src/privacy/tee/**` | **L2** | 同上（L1 只覆盖 `apps/api/src/**/*.spec.ts`） |
| 元语的**契约表格/yaml 块**、`package.json`、`scripts/check-meta-docs.mjs` | **L2** | §2 明文列出 |
| `openspec/**`、`docs/**` | **L2** | 未匹配 → fail-closed |

**含义**：每个任务开工前须有**具名放行人**；血缘记录 `human_release` **不得为空**（AG-9）。
无放行人时**停下来问**，不要以"改动很小"为由自行降级——§2 明文「不按改动规模分级」（AG-4）。

### 1.3 每次会话必须落血缘（append-only）

`.agent-runs/<UTC 日期>/<run_id>.json`，§4.1 的 **12 个必填字段**：

`run_id` · `started_at` · `ended_at` · `agent{role,model}` · `goal` · `action_level` ·
`files` · `declares` · `gates` · `human_release` · `iterations` · `cost`

硬要求：
- **append-only**：写错了**新增更正记录指向原记录，不改原件**（AG-7）；
- **失败与中止的会话同样落血缘**（AG-2）——只记成功是有偏采样；
- `files` 含 L2 路径面 → `human_release` 非空（AG-9）；
- `cost` 空值语义：**0 是断言（没有花费），`null` 是事实（未测量）**（AG-8）——未知填 `null`；
- `declares` 填本单附录 B 的约束 ID（须在册）。

### 1.4 护栏（§5，超限行为是"升级给人"，不是静默重试）

| 护栏 | 取值 | 超限 |
|---|---|---|
| 单任务迭代上限 | **25** | **升级给人，不静默重试**（AG-10） |
| 单任务 token 预算 | 200000 | 中止 + 落血缘 |
| 单任务计算分钟预算 | 30 | 中止 + 落血缘 |

> 本单每个任务都按「单任务」计。若一个任务预计超 200k tokens，**说明它该拆**（§5 原文）。

### 1.5 硬规矩（§6，违反 = bug）

| id | 规矩 |
|---|---|
| `AO-1` | 能用确定性规则表达的，禁止交给模型 |
| `AO-2` | **元语说的和代码做的不一致时，停下说明冲突，不要单方面改任一侧** |
| `AO-3` | 治理只诊断、不自动改。校验器无 `--fix` |
| `AO-4` | 看到测试红，**先在干净基线复跑做归属判断**，再动手 |
| `AO-5` | 改 `apps/connector/src/domain/**` 或 `packages/database/src/migrations/**` 后**必须跑 `pnpm check:meta`** |

### 1.6 L3 禁令（§3，**不提供人工放行档**）

| # | 禁令 | 与本单的关系 |
|---|---|---|
| `F-1` | 修改**已应用**的数据迁移 | 本单不应触碰 migrations |
| `F-2` | 削弱 output-gate / PEP 的 fail-closed，或给不变量测试加**跳过标记** | **本单 T2/T3 的意图与 F-2 同向（加强 fail-closed）**；任何"为了过测试而 skip"= 违规 |
| `F-3` | 修改或删除已写入的血缘记录 | 见 §1.3 append-only |
| `F-4` | 把真实密钥写进**入库文件** | T1/T5 涉及密钥形状——**只用测试夹具的假密钥** |
| `F-5` | 在 `apps/connector/` 或 `apps/agent/` 平面引入 LLM 调用 | T6 新算子**不得**引入任何 LLM 调用 |

---

## 2. 任务清单

> 执行顺序见 §3。每个任务都给了「验收证据」——**没有证据不算完成**。

---

### T1 — 一次性公钥必须绑定进 quote 的 `report_data`（**最高优先，P0**）

**等级**：L2 ｜ **改动面**：`packages/mdop/src/attestation/**`、`openspec/changes/tee-confidential-node/**`
**约束**：D-TEE-1（运营方与密钥释放权分离）· D-TEE-3 · P-CTL-8 · CTL-09

**问题（已核实，非推测）**：
- `AttestationReport.ephemeral_public_key` 只被校验「存在且形状合法」（`provider.ts:379`、`:498`、`:576-581`），
  `mapVendorQuote` 原样搬运（`provider.ts:508`）；
- `LocalDevKms` 用它算 `ephemeral_key_digest` 并把释放凭据绑到它（`kms.ts:186-189`、`:281-291`）；
- **但全仓 `packages/mdop` 里 `report_data` 零命中**——`VendorQuote`（`provider.ts:472-485`）根本没有
  `report_data` 字段，**绑定关系无法表达**。
- 后果：提供者可返回一个**未进 quote** 的任意公钥 → KMS 把 DEK 加密给攻击者指定的密钥 →
  「证明绑定密钥释放」在密码学上是空的。

**该做的**：
1. **先回写 design（不是就地加字段）**。本仓有明确先例与规则：`tee-attestation-pilot/design.md`
   §P3 发现 7 写着「若接入某条链时发现既有契约装不下，**MUST 记录为设计缺陷并回写设计文档，
   MUST NOT 直接就地扩展字段**」；`collateral` 就是这么加的。照此办理。
2. 契约扩展：`VendorQuote` 与 `AttestationReport` 表达 `report_data`（或等价的一次性公钥绑定字段），
   并让 `mapVendorQuote` **校验**「公钥的派生值 == report_data 中的绑定值」；
   缺绑定或不符 → `E_ATTESTATION_FAILED`（沿用本仓已有措辞「**不得产生半份证明**」）。
3. `verifyAttestationClaims` 对**硬件实现必填并校验绑定**（现状只校验"必填"）。
4. 走通 `evaluateKeyRelease`：绑定不成立即不释放（fail-closed，**不回退**）。
5. 用例（正负各一，负例是重点）：
   - 负：`ephemeral_public_key` 形状合法但**未进 `report_data`** → 拒；
   - 负：`report_data` 与公钥派生值**不符** → 拒；
   - 正：绑定成立 → 过。
6. `openspec/changes/tee-confidential-node/specs/**` 加场景并**钉进 `traceability.md`**。

**验收证据**：
- 新增用例名 + `pnpm --filter @medtrust/mdop test` 通过输出；
- `node scripts/check-c2-traceability.mjs` → 0 error，场景数从 **104 上升**（并说明新值）；
- `node scripts/check-tee-claims.mjs` → 0 error；
- design.md 里有本次字段扩展的登记段（含"为什么既有字段装不下"）。

**停下来问人的点**：字段命名与形状（`report_data` vs `ephemeral_key_binding`）——这属协议级决定，**先给方案再动手**。

---

### T2 — 拆掉 API 侧 fail-open 的 SGX mock（P0）

**等级**：L2 ｜ **改动面**：`apps/api/src/privacy/tee/**`
**约束**：CTL-09 · D9 · P-CTL-8

**问题（已核实）**：
- `apps/api/src/privacy/tee/adapters/alibaba-cloud-sgx.adapter.ts:104-119` 的 `verifyAttestation`
  **无条件 `return true`**——**fail-open**；
- `getAttestationReport` 返回 `mock-sgx-quote`（`:92-97`）；
- **该模块已挂进运行中的控制面**：`apps/api/src/app.module.ts:15` 与 `:91` 导入并注册 `TeeModule`；
- 且用 **SGX 口径**，而 D9 已明确目标是非 SGX（海光 CSV），与 `packages/mdop` 的真实证明契约是**两套并存**。

**该做的（最小且无歧义的一步）**：
1. 把 `verifyAttestation` 改为 **fail-closed**：未接真实校验实现时**返回 false / 抛错**，
   **不得**保留 `return true`——这是纯加强，符合 F-2 的方向；
2. 在类与 DTO 上**如实标注**「未接入，恒拒绝」，避免任何"看起来有 TEE"的表述；
3. 补负例用例：未接真实实现时校验**必须失败**。

**不要在本任务里做的事**：彻底删除该通道 / 把它接到 `packages/mdop` 的 `AttestationReport` +
`evaluateKeyRelease`——**那是产品决定，列为 T2b，等人拍**（先给方案：删 or 改造，含影响面）。

**验收证据**：`cd apps/api && pnpm test` 通过；负例用例存在于仓库；grep 证明 `verifyAttestation`
不再有 `return true` 的无条件路径。

---

### T3 — 堵住生产环境下 `SoftwareTee` 的静默降级（P0）

**等级**：L2 ｜ **改动面**：`apps/connector/src/domain/tee.ts`、4 处调用点、`apps/connector/src/app.module.ts`
**约束**：D9 · CTL-09 · D-CN-2

**问题（已核实）**：4 处**硬编码默认值**会在硬件化后**静默继续用软件 TEE**：
- `domain/rws-executor.ts:50`
- `domain/causal/causal-executor.ts:13`
- `domain/algorithm-validation-executor.ts:41`（还带 `@Optional()`）
- `domain/algorithm-validation/confusion-matrix.ts:53`

而 `check-tee-claims.mjs` 的三条规则（R1/R2/R3）只查 `level:'hardware'` / `isolation:'hardware-enclave'`
**字面量出现的目录**，**不查"装配用的是不是软件实现"**——所以这个降级**没有任何守护**。

**该做的**：
1. 让 `SoftwareTee` 在**生产环境不可实例化**（构造即抛错），例如以 `NODE_ENV === 'production'` 为判据；
2. 把 4 处默认值改为**显式注入/显式 opt-in**；软件实现的启用必须是**显式**的（开发/测试专用开关）；
3. 保留 `TeeEnclave` 契约不变（`seal`/`run` 签名**不动**——那是既定的可插拔抽象，D9）；
4. 补用例：生产判据下构造软件实现**必须抛错**；开发判据下仍可用；
   **并确认既有 ~10 处 `new SoftwareTee()` 的 spec 用法不受影响**（它们走开发/测试判据）。

**注意**：`app.module.ts:90` 现在是 Nest provider，`:94` 的 `useFactory` 注入它。改动须保证
连接器在开发配置下**照常启动**（`apps/connector` 有大量 e2e）。

**验收证据**：`cd apps/connector && pnpm test` 通过（当前基线 110 suites / 678 tests）；
新负例用例；`python3`/`node` 任一方式证明生产判据下抛错；
**必跑 `node scripts/check-meta-docs.mjs`**（AG-5：改了 `apps/connector/src/domain/**`）。

---

### T4 — `TeeAttestation` 与 `AttestationReport` 形状归一（P1，**先出方案**）

**等级**：L2 ｜ **改动面**：`apps/connector/src/domain/tee.ts` + `packages/mdop` + design 回写
**约束**：D9 · D-TEE-3

**问题（已核实）**：两个真相源形状不一致——
- `apps/connector/src/domain/tee.ts:12-20` 的 `TeeAttestation` 只有
  `{enclave, measurement, level, isolation}`；
- `packages/mdop/src/attestation/provider.ts:73-102` 的 `AttestationReport` 有
  `measurement` / `quote_digest` / `tcb` / `ephemeral_public_key` / `node` / `collateral` / 两个时间戳。
- 硬件级度量应是**硬件签发的整机镜像度量**（TDX MRTD/RTMR、CSV launch measurement、SEV-SNP measurement），
  而现状是 `'sm3:' + sm3Hex(fn.toString())`（分析函数源码 SM3，`tee.ts:62`）——**语义要整体重写**。

**该做的（**本任务第一步只出方案，不改代码**）**：
1. 按 T1 同一条规则（装不下即回写 design，MUST NOT 就地扩展）产出**方案**：
   是让 `TeeEnclave` 的返回统一到 `AttestationReport`，还是给 `TeeAttestation` 补字段？
2. 方案须回答：`measurement` 在硬件级下**具体度量什么**（运行时 + 模块？整机镜像？）；
   `enclave` 字段在 VM 级 CC 下的对应物是什么；
3. 交出方案后**停下来等人拍**，再实施。

**验收证据（本任务）**：一份写进 design 的方案段 + 影响面清单（哪些调用点/用例要改）。

---

### T5 — `seal` 改为证明绑定的封装（P1，**先出方案**）

**等级**：L2 ｜ **改动面**：`apps/connector/src/domain/tee.ts` + design
**约束**：D-TEE-1 · D-TEE-5

**问题（已核实）**：`tee.ts:40` 用 `randomBytes(32)` 生成**进程内密钥**，`seal` 与 `run` 在同一进程里
加密又解密（`tee.ts:45-59`），密钥**不来自 KMS**——因此 `seal` 目前是**装饰性**的，
与 `AttestationReport.ephemeral_public_key`、`KeyReleaseWarrant` 那条真实释放链**没有连接**。

**该做的（同样先方案后实施）**：
1. 方案：`seal` 应使用**报告里那把一次性公钥**（或 KMS 释放的 DEK）封装；
   `SealedInput{iv,ciphertext,tag}`（`tee.ts:6-10`）形状够不够、要不要加"用哪把公钥封的"绑定点；
2. 与 T1 的绑定字段对齐（两者是同一条链的两端，**不要各定一套**）；
3. 停下来等人拍，再实施。

**验收证据（本任务）**：方案段写进 design + 影响面清单。

---

### T6 — 新增 wasm 算子：分位数 / 中位数 / 去重人数（P1，**较大，建议再拆**）

**等级**：L2 ｜ **改动面**：`packages/wasm-algorithms/**`、算子注册、节点接线
**约束**：D-CN-2 · D-CN-5 · CTL-20 · CTL-24 · INV-GATE-01

**背景**：这对应能力表第①行「分位数/中位数/去重人数/集合交并 —— 很勉强」。
C2 下数据在同一节点内，联邦化的"不可分解"约束**确实消失**；缺的是**算子**：
全仓 grep `quantile|median|percentile|distinctCount` **零命中**（唯一命中是 `omop-view-benchmark.mjs` 基准脚本）。

**必须先知道的硬约束（已核实）**：
- 执行器只支持 `wasm` 与 `system`；**`system` 只许 `source`/`declassify`/`merge`**，
  **分析逻辑只许 `wasm`/`oci`**（`apps/api/src/mdop/operator-registry.service.ts:20-35`）；
- **`oci` 本期编译期不使用、执行器直接拒**（`mdop-executor.ts` else 分支「算子类型 … 本期未启用」）；
- ⇒ **唯一路径是写 `wasm` 模块**，走 `third-party-wasm-module-admission` 的既有五道准入
  （该变更 41/41 已落地）：源码-only、平台锁定工具链**复现构建**、静态白名单、沙箱动态测试、
  影子发布、吊销名单；
- 目录约定与既有先例：`packages/wasm-algorithms/modules/{disproportionality-as,disproportionality-rust,pairing-as}`；
  产物按 SM3 命名入 `packages/wasm-algorithms/build/`（`.gitignore` 已为它开例外，`D-CN-2`）；
- 节点侧接线点：`apps/connector/src/tee-node/wasm-runner.ts` 的 `NODE_WASM_OPS`（现只有
  `rws.paired-cohort@1.0.0`），新增一种要**同时**加白名单与分派；模块字节由
  `tee-node/module-library.ts` 按摘要从本地库取。

**建议拆分**：**先只做「去重人数（distinct count）」**——它是最简的、且输出形态与既有计数类一致（`minCell` 保护有效）。
分位数/中位数**单独一个任务**，因为：
**中位数/分位数是强泄露向量**（中位数可被单个记录拉动），`minCell` 对小单元格的保护**不适用于它**，
需要**专门的输出策略**（截断/加噪/区间化），而那属 EVIDENCE/TRUST 层决定，**不是写个模块就完了**。

**验收证据**：模块源码 + 复现构建通过的输出（`packages/wasm-algorithms/scripts/check-reproducible.mjs`）；
准入闸测试；注册中心登记；节点侧用例（含"模块摘要与清单不符即拒"的既有负例口径）；
`node scripts/check-c2-traceability.mjs` 0 error。

**停下来问人的点**：分位数/中位数**先不要做**，等输出策略定案。

---

### T7 — 回写 design：C2 节点在云上 ⇒ collateral 免离线（P2，纯文档）

**等级**：L2 ｜ **改动面**：`openspec/changes/tee-attestation-pilot/design.md`（§P4）、`TRUST.md` P-CTL-8
**约束**：D-TEE-3

**问题**：`tee-attestation-pilot/design.md` §P4 把「院内无外网 → collateral 必须离线预取校验」
列为**三家共同前置**。但 **C2 节点是运营方/监管侧在云上运营的**，云上节点有外网，
collateral 可直接在线取（TDX 走 PCCS/Intel PCS；CSV 走厂商证明服务；SEV-SNP 走 AMD KDS）。
「院内无外网」只约束**医院连接器**，而连接器**本来就不需要证明**（它只做长轮询出站 + 本地计算）。

**该做的**：把 P4 与该前置的**适用范围写清**，明确它是「若节点部署在院内」的前提，
而非云上节点的前提。**这直接影响排期**（能砍掉一大块用不上的离线校验工程）。

**验收证据**：design §P4 与 P-CTL-8 的措辞更新；`node scripts/check-meta-docs.mjs` → 0 error。

**注意**：`TRUST.md` 的 P-CTL 表是**契约表格**（L2，且是校验器解析目标）——
**改表不许破坏格式**（`AGENT-OPS.md` §7 附录：任一契约表解析为 0 行 = 红）。

---

## 3. 执行顺序与闸门

```
T0（角色定案）→ 必须最先
  ↓
T1（report_data 绑定）  ← 最高价值；决定释放链是否成立
T2（API 侧 fail-open）  ← 独立，可并行
T3（SoftwareTee 生产降级）← 独立，可并行
  ↓
T4 / T5 出方案 → 停下等人拍 → 再实施
  ↓
T6 只做「去重人数」；分位数/中位数等输出策略定案
T7 纯文档，随时可做
```

**每个任务收尾必跑**（缺一不算完成）：

```bash
pnpm lint                 # 必须 0 error（注：apps/api 的 lint 带 --fix，会重排格式）
pnpm test                 # 全链；约 10 分钟
# 单独复跑四道守护（快）：
node scripts/check-meta-docs.mjs
node scripts/check-c2-traceability.mjs
node scripts/check-protocol-error-codes.mjs
node scripts/check-tee-claims.mjs
node scripts/check-crypto-imports.mjs
node --test scripts/check-*.test.mjs    # 负例自检
```

**基线（`8dd3810` 实测，用于 AG-4 归属判断）**：
`check-meta-docs` 0 error / 14 warning · `check-c2-traceability` 0 error（104 场景 / 上游 22）·
`check-protocol-error-codes` 0 error（25 码）· `check-tee-claims` 0 error（981 TS）·
`check-crypto-imports` 0 error（9 文件：白名单 6 / 在册偏离 3）· 负例自检 32/32 ·
`pnpm test` exit 0（connector 110 suites / 678 tests，42 skipped）。

> **看到测试红时**：先在**干净基线**（`git stash` 或另开 worktree 于 `8dd3810`）复跑做归属判断，
> **再**动手（AO-4）。不要默认自己是唯一变量。

---

## 4. 提交要求

- **不要** `git commit --no-verify` 绕过 husky（`.husky/pre-commit` 跑 `pnpm lint`）；
- 提交信息用 Conventional Commits + 中文，与仓库既有风格一致（见 `git log`）；
- **每个任务一个提交**，便于回滚；
- 提交前 `git status` 确认**没有把生成物带进去**——本仓刚做过一次清理：
  `/output/`（Synthea 生成物）、`.agent-runs/`、`.dsh-verify/`、`.workbuddy/`、`/screenshots/`
  已在 `.gitignore` 中；**`data/normalized/`（含 61MB `literature.parquet`）、`pitch/`、`research/`、
  根目录 `.pptx/.docx/.pdf` 仍未跟踪，不要顺手 `git add -A`**；
- 血缘记录**随提交入库**（§4 明文：血缘目录入库、不 gitignore）。

---

## 5. 本单**明确不做**的事

| 不做 | 为什么 |
|---|---|
| 把 C2 说成"已具备"或把 `attestationLevel` 改写成 `hardware` | `check-tee-claims` R1 会判红；且与 D9/CTL-09 的如实口径冲突。硬件未接入前**恒为 `software`** |
| 把影像/病理/文本多模态塞进 C2 | 设计上刻意不解：**最小投影是硬要求** + **侧信道不在 TDX/SEV-SNP 防护范围**（design §D5、Risks） |
| 为交互式探索给 C2 开口子 | 被**刻意挡住**：计划编译期冻结 + D8 查询预算（`budget-ledger.ts` 注释原文「防把远程终端交给申请方」） |
| 给不变量测试加 skip、或削弱任何 fail-closed | `F-2`，**不设放行档** |
| 在 `apps/connector/` 或 `apps/agent/` 引入 LLM 调用 | `F-5`，**不设放行档** |
| 改 `.keel/`、`pitch/`、`research/`、业务文档 | 归属未定，等人工决定（见 §4） |
| 自行实现 SM4-GCM 并宣称"收回国密信封" | 本仓已登记为**偏离**（D8 落地补注）：C2 信封载荷是 **AES-256-GCM**，对外**禁止**称"国密信封/全链国密" |

---

## 附录 A — 证据索引（本单所有"已核实"结论的代码位置）

| 结论 | 位置 |
|---|---|
| `run(sealed, fn)` 契约（闭包） | `apps/connector/src/domain/tee.ts:29-32` |
| `SoftwareTee` 进程内密钥 / software 度量 | `apps/connector/src/domain/tee.ts:40`、`:45-59`、`:60-65` |
| 4 处 `new SoftwareTee()` 默认值 | `rws-executor.ts:50`、`causal/causal-executor.ts:13`、`algorithm-validation-executor.ts:41`、`algorithm-validation/confusion-matrix.ts:53` |
| `ephemeral_public_key` 只校验存在、不校验绑定 | `packages/mdop/src/attestation/provider.ts:379`、`:498`、`:508`、`:576-581` |
| `VendorQuote` 无 `report_data` 字段 | `packages/mdop/src/attestation/provider.ts:472-485` |
| KMS 用一次性公钥算摘要并绑定凭据 | `packages/mdop/src/attestation/kms.ts:186-189`、`:211`、`:281-291` |
| **`report_data` 在 `packages/mdop` 零命中** | 全仓 grep 仅命中 `apps/api/src/privacy/tee/adapters/alibaba-cloud-sgx.adapter.ts:20,94` |
| SGX 适配器 `verifyAttestation` 恒 true（fail-open） | `alibaba-cloud-sgx.adapter.ts:104-119` |
| `TeeModule` 已挂进控制面 | `apps/api/src/app.module.ts:15`、`:91` |
| `TeeAttestation` 缺 tcb/collateral/quote_digest | `apps/connector/src/domain/tee.ts:12-20` vs `provider.ts:73-102` |
| 分析逻辑只许 wasm/oci；system 只许三类 | `apps/api/src/mdop/operator-registry.service.ts:20-35` |
| `oci` 本期执行器拒绝 | `apps/connector/src/mdop/mdop-executor.ts:74-90` else 分支 |
| 节点 wasm 算子白名单（现仅 1 个） | `apps/connector/src/tee-node/wasm-runner.ts:29-31` |
| 节点 system 算子（现仅 declassify） | `apps/connector/src/tee-node/declassify-op.ts:24` |
| 分位数/中位数实现零命中 | 全仓 grep `quantile|median|percentile|distinctCount` |
| 查询预算反"远程终端" | `apps/connector/src/mdop/node/budget-ledger.ts` 注释 |
| 最小投影是硬要求 + 侧信道不在防护范围 | `tee-confidential-node/design.md` §D5、Risks |
| 「装不下即回写 design，MUST NOT 就地扩展」规则 + `collateral` 先例 | `tee-attestation-pilot/design.md` §P3 发现 7 |
| 12 条未勾任务与解锁三段式 | `tee-confidential-node/tasks.md`、`tee-attestation-pilot/tasks.md`；`docs/tee-two-changes-audit-2026-09-26.md` §5 |

## 附录 B — `declares` 可填的约束 ID（须在册）

`D9` · `D-CN-2` · `D-CN-5` · `D-TEE-1` · `D-TEE-3` · `D-TEE-5` ·
`CTL-09` · `CTL-20` · `CTL-24` · `INV-GATE-01` · `P-CTL-2` · `P-CTL-5` · `P-CTL-8`
（`AGENT-OPS.md` §4.1：`declares` 须为**在册**约束 ID；不在册的 ID 不要填。）
