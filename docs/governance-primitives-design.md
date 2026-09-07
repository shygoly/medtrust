# MedTrust 治理元语体系设计（六件套）

> **状态：已落地（2026-07-21），本文件降级为历史设计参考。** 六件套 + `scripts/check-meta-docs.mjs` 已按 §9 的 P0–P3 全部落地并通过负向验证；入口路由见 CLAUDE.md「治理根契约」节与 ARCHITECTURE.md §10。
> 落地时相对本设计的偏差：crosses 枚举增补 `participant→control` / `control→participant` / `cross-space`，payload 增补 `credential` / `catalog-meta`；TRUST.md 新增「待接入控制点」表（P-CTL-x），收录了盘点中发现的规格超前于代码的项（attestationLevel 字段缺失、DP ε 预算未实现）。
>
> **后续演进：2026-07-21 增设第七根契约 [EVIDENCE.md](../EVIDENCE.md)（研究效度，`EVD-x`）**，对齐药监《RWD 支持药品安全性主动监测的研究设计和分析指导原则》。判据同 §5 的四标准（独立漂移轴 / 独立读者 / 可机检对拍点 / 规模）——四条全中故独立成文，而非并入 TRUST：TRUST 的 threat 轴是"泄露·重识别·虚标"，EVIDENCE 的 risk 轴是"偏倚·混杂·p-hacking·选择性报告"，混册会污染 threat 字段的语义一致性。守护点 = 规范要素 ↔ `TteSpec`/`RwsAnalysis` 字段覆盖矩阵对拍。

---

## 0. 结论（30 秒）

| 用户问的 | 结论 |
|---|---|
| 五个元语怎么落 | ARCHITECTURE.md / DESIGN.md **已存在且形态达标**（微调）；DOMAIN.md / FLOWS.md / DECISIONS.md **新建**（DECISIONS 主要是收编现有散落决策，不是新写） |
| 要不要安全元语、合规元语 | **要，但合并为一个根契约 `TRUST.md`**。本项目"信任即产品"，安全/合规有独立漂移轴、独立读者（compliance 角色）、可机检对拍点，够格做根契约；拆成两个会导致同一闸门双重登记 |
| 智能合约元语算不算同层 | **不算**。数字合约是领域聚合（归 DOMAIN + FLOWS），链上合约部署是不可逆决策（归 DECISIONS），存证 payload 是信任控制点（归 TRUST）。规模不够立顶层文件（YAGNI），登记升级触发器（§5） |
| 范式的核心是什么 | 不是"写五份文档"，是**每份文档配一个校验器**：单一 `scripts/check-meta-docs.mjs` 对拍文档 ↔ 代码 ↔ spec，接入根 `pnpm test`，违反 = 红 |

---

## 1. 参照范式解剖：followup-ruoyi 五元语的作用、深度、范式

| 元语 | 作用 | 深度形态 | 守护方式 |
|---|---|---|---|
| `FLOWS.md`（198 行） | 调度总表 + 业务线步骤链 | cron 表达式精确到分钟；每步 actor 精确到 `service.ts#method`；produces/consumes 精确到表与列值 | cron 三向对拍（FLOWS 表 ↔ registry jobKey ↔ 代码 `@Cron(name:)`）+ `dead_edge_check` 防"产出无人消费"死边 |
| `DOMAIN.md`（540 行） | 领域本体：表关系 / 不变量 / 公式 / 状态词汇 / 术语 | 每条关系带**强制点 token**（`db-fk:` / `prisma` / `service:路径#符号` / `ui:` / `none`+理由）；每条 INV-x 带 trigger / enforcement / spec 三链 | 覆盖矩阵 ↔ schema 全表对拍；enforcement 路径与符号存在性检查；`spec:` 与测试文件互指；附录"格式契约"让文档自描述可解析 |
| `DECISIONS.md`（242 行） | 不可逆架构决策登记（D-x） | `yaml decision` 块：context / decision / references / code_markers | 代码里的 `D-x` 标记（词边界）必须在册，反向对拍 |
| `DESIGN.md`（283 行） | UI 唯一事实源 | token 表带 hex 与角色；组件封闭集；Do/Don't；内嵌 agent prompt | 禁止清单条条可 grep（裸 hex、fixed overlay、gradient）；新 token 必须登记 |
| ARCHITECTURE（由 CLAUDE.md 模块布局节承担） | 分层与依赖方向 | 表格化分层职责 | **eslint 强制单向依赖**（application → domain → infrastructure），守护在 lint 不在文档 |

**六条元范式**（比五个文件本身更重要）：

1. **机器可校验**：`npm run test` 先跑 `check:domain` + `check:meta` 再跑 jest。文档漂移 = 测试红。
2. **围栏块结构化**：`yaml flow` / `yaml invariant` / `yaml decision` 让 markdown 可被零依赖脚本解析。
3. **双向对拍**：文档引用的符号必须在代码存在；代码里的标记（D-x）必须在文档在册。
4. **切片读取**：覆盖矩阵 + 按聚合分节；入口文件（CLAUDE/AGENTS）强制"只读对应 `##` 小节，勿全文加载"。
5. **正交命名空间**：`D-x`（决策）/ `INV-x`（不变量）/ `TD-x`（技术债）/ `FLOW-x`（流程），同一设计点可同时有多个编号但互不混用。
6. **单一权威 + 降级旧档**：每个轴只有一个权威文件，旧文档显式声明"以彼为准"。

---

## 2. medtrust 的三点结构差异（决定变形方向）

**差异 1：双平面 + 双实现，元语是跨语言对齐的唯一载体。**
followup 是单 Nx 仓单语言，类型系统本身能对齐前后端；medtrust 是控制面（TS/NestJS）+ `apps/agent`（Python 生产节点）+ `apps/connector`（NestJS 规格参考），D-CN-1 已明文承诺"两者共享规格，以文档/spec 对齐，不强求代码共享"。**但这份"文档"至今不存在**——DOMAIN/FLOWS 就是它。因此 medtrust 的 enforcement token 必须支持多语言多路径（`ts:` / `py:` 前缀）。

**差异 2：无 cron 中枢，对拍轴要换。**
followup 的 FLOWS 靠 cron 三向对拍锚定；medtrust 的流程由 API 事件与任务状态机驱动。替代对拍轴：① 任务/合约 **FSM 迁移表**（doc ↔ 状态机代码）② **闸门链顺序**（PEP → executor → output-gate → attest）③ **跨域边的数据分级**（见 §4.4，这是 medtrust 独有的、比 cron 更值钱的校验维度）。

**差异 3：信任即产品，安全合规从"章节"升为"根契约"。**
followup 的安全是 D-6 触达闸门等散点；medtrust 的核心不变量（"没有一条线把原始行级数据带出医院"）、义务分类（fail-closed / fail-open，D-UC-2）、TEE 如实表述（D9）本身就是产品价值。DESIGN.md §8 里 `compliance` 是四个一等角色之一——合规审计员是元语的直接读者。

**漂移现场证据**（为什么必须要 checker）：CLAUDE.md 写模块在 `apps/api/src/participant-identity/`，实际已迁至 `apps/api/src/runtime/participant-identity/`；ARCHITECTURE.md §5 仍写"FISCO BCOS attestation (Solidity)"语境的安全中枢描述由 CLAUDE.md 继承，而链已换长安链。无校验的路径引用平均寿命只有几周。

---

## 3. 元语拓扑总表

| # | 元语 | 文件 | 现状 | 命名空间 | 核心对拍 / 守护 |
|---|---|---|---|---|---|
| 1 | 架构 | `ARCHITECTURE.md`（根） | ✅ 已存在，微调 | 引用 D-x | 引用路径存在性检查（checker v1） |
| 2 | 设计 | `DESIGN.md`（根） | ✅ 已存在，不动 | — | 禁止清单 grep（v2）；§2 状态色表 ↔ `task-status.types.ts`（v2） |
| 3 | 领域 | `DOMAIN.md`（根） | 🆕 新建 | `INV-<AREA>-<NN>` | 覆盖矩阵 ↔ `@Entity()` 全表对拍；enforcement/spec 路径符号存在性 |
| 4 | 流程 | `FLOWS.md`（根） | 🆕 新建 | `FLOW-<AREA>-<NN>` | actor 符号存在性；dead_edge_check；**crosses × payload 分级红线** |
| 5 | 决策 | `DECISIONS.md`（根） | 🆕 新建（收编为主） | `D-<AREA>-<NN>`（兼容存量 D1–D12） | 代码 `D-x` 标记必须在册（反向对拍） |
| 6 | 信任 | `TRUST.md`（根，安全∪合规） | 🆕 新建 | `CTL-<NN>` | 敏感字段登记 ↔ `@EncryptedColumn`/`@Masked` 装饰器对拍；红线 grep |

统一由 `scripts/check-meta-docs.mjs`（仓库根，零依赖 node）守护，接入根 `package.json` 的 `test` 脚本前置。

---

## 4. 各元语设计

### 4.1 ARCHITECTURE.md（存量，微调）

现有文件已具备金标要素（§0 决策摘要、§7 ADR、§9 状态总表、旧档降级）。只做三处：

1. §0 决策表补"登记号"列，指向 DECISIONS.md 条目（表成为 DECISIONS 的视图，不再是第二事实源）。
2. 新增 §10「治理元语路由」：一张表列六件套 + 各自校验命令。
3. 修正随代码漂移的路径（`runtime/` 前缀）。**守护**：checker v1 对 ARCHITECTURE.md 里所有 `` `路径` `` 形式的仓内引用做存在性检查。

### 4.2 DESIGN.md（存量，不动）

已是六条元范式的完整体现（状态→色唯一注册表 = followup 状态词汇表的 UI 镜像；四类页面原型封闭集；十条禁止清单）。唯一欠的是守护自动化，登记两条进 checker v2：

- 禁止清单 1/2/8 可 grep（裸 hex / 裸 `<table>` / 新页面用 legacy 浅色变量）。
- §2 状态注册表 ↔ `apps/web/src/types/task-status.types.ts` 对拍——**等该文件按 §2 迁移到 `--cs-*` token 后再上**，先上必红。

### 4.3 DOMAIN.md（新建）——双平面领域本体

**作用**：实体关系 / 不变量 / 公式 / 状态词汇 / 术语的唯一权威；同时是 D-CN-1 要求的 agent(Python) ↔ connector(NestJS) 跨语言规格载体。

**medtrust 特有形态：覆盖矩阵带"平面"列。** 每张表必须声明归属，`双平面` 是非法值——一张表出现在两个平面即违反 D7：

```markdown
| 实体表 | 平面 | 小节 |
|---|---|---|
| digital_contract | control-plane | 数字合约 |
| participant / participant_certificate | control-plane | 参与方身份 |
| catalog_product | control-plane | 目录与数据产品 |
| settlement_ledger | control-plane | 结算 |
| attestation_index | control-plane | 存证 |
| compute_task / tee_computation / mpc_session | control-plane | 计算任务 |
| flower_* (4 表) | control-plane | 联邦学习 |
| tenant / user / refresh_token / audit_log | control-plane | 租户与审计 |
| local_record / local_dataset ... | connector-local | 连接器本地 |
```

（以 `packages/database/src/control-plane/index.ts`、`connector/index.ts`、`entities/` 的 `@Entity('...')` 实际清单为准，checker 全表对拍，多一张少一张都红。）

**小节结构**（每聚合）：覆盖表 → 关系表 → 状态词汇 → 不变量。关系表强制点 token 适配本项目：SQLite + `synchronize` 环境下 `db-fk` 稀缺，主力是 `service:` / `guard:` / `gate:`，且支持跨语言前缀：

```
强制点 token := db-fk:<名> | typeorm | ts:<路径>#<符号> | py:<路径>#<符号> | ui:<路径> | none(备注必填理由)
```

**不变量样例**（本项目第一条应该登记的就是核心不变量）：

```yaml invariant
id: INV-GATE-01
tables: [local_record, compute_task]
desc: 任何跨域出站结果必须先过输出闸门（DP + 小单元格 n<5 抑制），任一校验失败则整体不出域（fail-closed，D-UC-2）
trigger: 连接器任务执行完成、结果回传前
enforcement:
  - ts:apps/connector/src/domain/output-gate.ts#OutputGate
  - py:apps/agent（对应实现，路径待落地时填实）
db: none
spec: apps/connector/src/domain/output-gate.spec.ts
```

**全局节**（followup 同构，内容换血）：
- **跨聚合级联表**：合约 revoke → 在途任务中止（fail-closed 补偿，D-DC-1）；证书吊销 → 通道拒绝；任务完成 → 存证 + 结算。
- **派生公式与单位约定**：PRR/ROR 四格表（a/b/c/d 语义）、DerSimonian-Laird 权重、PSM caliper + Cox HR、DP ε 预算口径、n<5 阈值唯一出处、cohortSize 分账公式。每条公式给 `ts:`/`py:` 双实现锚点——**这正是双实现漂移风险最高的地方**。
- **状态词汇表**：`compute_task` 状态（以 `apps/web/src/types/task-status.types.ts` 现状收编起点：pending/running/completed/failed/cancelled）、`ContractStatus`（draft/active/expired/revoked，`control-plane/index.ts` 已定义）、证书状态、连接器节点状态（与 DESIGN §2 色表互指）。
- **术语表**：出域 / 聚合结果 / 四格表 / attestationLevel / 数字合约 vs 链上合约（两个词必须在此分家）/ 使用控制 / 贡献度。

### 4.4 FLOWS.md（新建）——跨域任务链

**作用**：声明控制面 ↔ 连接器 ↔ 链之间的步骤链。medtrust 的 flow 不锚 cron，锚**跨域边**。

**范式变形（本设计最重要的一处）**：每步在 followup 的 actor/produces/consumes 之外，强制两个新字段：

```
crosses:  none | control→connector | connector→control | control→chain | connector→local
payload:  task-spec | policy | aggregate-only | evidence-hash | raw-local
```

**红线（checker v1 强制）**：`payload: raw-local` 的步骤，`crosses` 必须为 `none` 或 `connector→local`。任何 raw 级数据出现在跨域边上 = 文档层面直接红。这把 ARCHITECTURE §3 的"核心不变量"从一句话变成每条流程边上的机检属性。

**首批流程清单**：

| id | 名称 | 链路要点 |
|---|---|---|
| `FLOW-RWS-01..04` | RWS 阶梯 L1.5/L2/L3/L4 | 提交 → 准入门（身份/合约/分级）→ 下发 → 本地计算（raw-local, crosses:none）→ 输出闸门 → 聚合回传（aggregate-only）→ 合并 → 存证（evidence-hash）→ 结算 |
| `FLOW-DC-01` | 数字合约生命周期 | draft → 双方签署 → active → revoke（立即中止 + FSM 补偿关停在途任务，D-DC-1） |
| `FLOW-ID-01` | 参与方准入 | CSR → 双认证/分级分类门 → SM2 签发 → 信任清单 → CRL 拉取吊销 |
| `FLOW-SETTLE-01` | 贡献结算 | 任务完成 → cohortSize 计量 → 台账 → 上链（异步 fail-open + 补偿队列） |
| `FLOW-FED-01` | 跨空间互认 | 全局 URN → CA 信任清单互认（最小实现） |

**dead_edge_check 照搬**（例：合约 revoke 产出的"中止指令"必须有连接器侧 PEP 消费者；输出闸门产出的 blocked 记录必须有审计消费者）。

**样例**（节选，路径均为真实符号）：

```yaml flow
id: FLOW-RWS-01
name: L1.5 失衡信号检测（PRR/ROR）
trigger: 药企经控制台提交分析任务
steps:
  - actor: ts:apps/api/src/runtime/digital-contract/contract.service.ts#(准入校验入口)
    crosses: none
    payload: task-spec
    produces: [compute_task(status=pending)]
    consumes: [digital_contract(status=active)]
  - actor: ts:apps/connector/src/domain/connector-task-runner.ts#run
    crosses: control→connector
    payload: task-spec
    produces: [本地四格表 a/b/c/d]
    consumes: [local_record]
    note: 本地计算步 payload=raw-local 时 crosses 必须 none —— 拆为两步声明
  - actor: ts:apps/connector/src/domain/output-gate.ts#OutputGate
    crosses: connector→control
    payload: aggregate-only
    produces: [聚合计数回传]
    consumes: [本地四格表]
  - actor: ts:apps/api/src/runtime/digital-contract/attestation.service.ts#(存证)
    crosses: control→chain
    payload: evidence-hash
    produces: [attestation_index, 链上哈希]
    consumes: [合并结果]
dead_edge_check:
  - producer: output-gate 放行 → 聚合回传
    consumer: 控制面合并 + 存证
  - producer: output-gate 拦截 → blocked 记录
    consumer: audit_log（拦截必须留痕，见 TRUST CTL-01）
```

### 4.5 DECISIONS.md（新建 = 收编，不是新写）

**现状问题**：决策散落三处且无对拍——方向决策 D1–D12 在 `openspec/changes/federated-data-space-rws/design.md`，落地决策 D-CN-1 / D-UC-2 / D-RWS-2/3/4 / D-DC-1 / D-VS-1 / D-ID-1 在 `docs/deepreq/`，ARCHITECTURE §0 是手工抄的第三份。

**设计**：DECISIONS.md 成为唯一登记册；每条 `yaml decision` 的 `references` 指回原始出处（openspec/deepreq 原文不动、不降级——它们是过程档案，DECISIONS 是登记索引 + 代码标记对拍点）。存量编号原样收编（D1–D12、D-XX-n 两族并存），**新增决策一律 `D-<AREA>-<NN>`**。另立三条历史上从未登记的既成决策：数据库 SQLite 先行（Postgres 生产前迁）、长安链替换 FISCO（含 SDK JNI 死结 context）、端口段 5020–5029。

**守护**：代码中词边界 `D-x` / `D-XX-n` 标记必须在册（followup 同款反向对拍）；`TD-x` 归 `docs/tech-debt.md`（空册先立），`INV-x` 归 DOMAIN，`CTL-x` 归 TRUST，四命名空间正交。

### 4.6 TRUST.md（新建）——安全 ∪ 合规合并的根契约

**为什么合并而不是两个文件**：安全（机制视角：闸门/国密/密钥/脱敏）与合规（规范视角：条款→证据）登记的是**同一批控制点**。拆两个文件，输出闸门要在两处重复登记，必漂移。合并后每个控制点一条 `CTL-x`，四链齐备：`norm`（合规锚点）+ `enforcement`（机制）+ `spec`（测试）+ `evidence`（审计证据落点）。合规条款写不出 enforcement 的，进"待接入控制点"表而不是正文——这是硬度红线在合规域的应用。

**结构**：

1. **控制点登记册（CTL-x）**——主体。规范锚点轴：TC609-6-2025（可信数据空间技术架构）、NDI-TR-2025（连接器协议）、数据安全法、个人信息保护法、等保 2.0、人类遗传资源条例。样例：

```yaml control
id: CTL-01
title: 输出闸门小单元格抑制 + DP，fail-closed
norm: [TC609-6-2025 使用控制, 个保法·匿名化, D-UC-2]
threat: 聚合结果反推个体（小格重识别）
enforcement:
  - ts:apps/connector/src/domain/output-gate.ts#OutputGate
db: none
spec: apps/connector/src/domain/output-gate.spec.ts
evidence: audit_log(拦截事件) + attestation_index(出域结果哈希)
```

2. **敏感字段分级登记表**——字段 → 分级（直接标识/准标识/去标识）→ 机制（`@EncryptedColumn('<key-id>')` / `@Masked('<type>')` / hash-only）→ 出域许可（永不 / 仅聚合 / 仅哈希）。**守护（checker v1）**：grep 全仓两个装饰器的每一处使用（现存于 `packages/database/src/entities/patient.entity.example.ts`、`apps/api/src/common/dto/{user,medical-record,patient}.dto.ts`），装饰器出现而未登记 = 红；登记而字段不存在 = 红。
3. **红线清单（grep 守护）**：① `sm-crypto` 只许在 `apps/api/src/security/crypto/` 内 import（其余经 GmCryptoService）② `attestationLevel` 必须出现在存证 payload 构造点且当前值只能 `software`（D9，防"说谎式营销"回潜）③ 信任链禁用非国密套件（§7.3 既有约定，落为 grep 目标清单）。
4. **威胁模型摘要**：按拓扑三边（控制面/连接器/链）各列 top 威胁 → 指回 CTL-x，一页以内，不写成论文。

**读者切片**：compliance 角色只读 §1 登记册 + §2 分级表即可出审计底稿；开发者改闸门前只读对应 CTL 条目。

---

## 5. 智能合约：不设顶层元语的判定与拆解

判定标准（一个关切够格成为根契约需同时满足）：**① 独立漂移轴 ② 独立读者/切片场景 ③ 可机检对拍点 ④ 规模**。链上关切满足 ①③ 但不满足 ②④——当前链上只做证据存储（D6：只存哈希/指纹/时间戳），无独立读者群，条目量撑不起一个文件。拆解归属：

| 关切 | 归属 | 形态 |
|---|---|---|
| 数字合约（usage control，TC609 语义） | DOMAIN 数字合约聚合 + FLOW-DC-01 | FSM + 策略 schema + PEP 强制点 |
| 链上合约部署/升级（不可逆） | DECISIONS | 每次部署一条 D-CHAIN-n（链上不可变 = D-x 定义的教科书案例） |
| 存证 payload 结构（哈希/attestationLevel/时间戳，**永不含数据**） | TRUST CTL-x + FLOWS `payload: evidence-hash` | 机检红线 |
| sidecar 接口（api/blockchain ↔ Java sidecar） | FLOWS 存证链 + checker 符号存在性 | 对拍 |

**升级触发器**（登记为待决策 P-2）：结算清算逻辑真实上链、或链上合约 ≥3 份需版本治理时，立 `CHAIN.md` 为第七根契约。

---

## 6. 校验器设计：`scripts/check-meta-docs.mjs`

零依赖 node 脚本，followup 的 `check-meta-docs.mjs` + `check-domain-doc.mjs` 合并变形。接入：根 `package.json` `"check:meta": "node scripts/check-meta-docs.mjs"`，并前置进根 `test` 脚本。

**v1（与元语同批落地）**：

| 规则 | 对拍双方 | 级别 |
|---|---|---|
| 覆盖矩阵全表对拍 | DOMAIN 矩阵 ↔ `packages/database/src/**` 的 `@Entity('...')` | E |
| 平面唯一性 | 每表恰好一个平面；connector-local 表不得被控制面模块 import | E |
| invariant/flow/decision/control 块格式 | id 唯一、格式合法、字段齐备 | E |
| enforcement/actor/spec 存在性 | `ts:路径#符号` 文件存在且符号可检索；`py:` v1 只查文件存在 | E（`TODO` 降级 W） |
| **crosses × payload 红线** | `raw-local` 不得出现在跨域边 | E |
| dead_edge_check 配对 | producer/consumer 与 steps 的 produces/consumes 匹配 | E |
| 代码 D-x 标记在册 | 全仓词边界 `D-x`（排除 TD-x）↔ DECISIONS | E |
| 装饰器 ↔ 分级表 | `@EncryptedColumn/@Masked` 使用点 ↔ TRUST §2 | E |
| ARCHITECTURE 路径引用存在 | 反引号仓内路径 | W |

**v2（后置）**：`py:` 符号级检索；DESIGN 禁止清单 grep；DESIGN §2 ↔ `task-status.types.ts`（等其迁移后）；feature 模块自注册实体纳入矩阵；TRUST 红线 grep 全量。

---

## 7. 入口路由改造（CLAUDE.md）

CLAUDE.md 收缩为路由，新增 META RULE 块（followup AGENTS.md 同型）：

```markdown
**META RULE**：六份根契约（均机器校验，node scripts/check-meta-docs.mjs）：
- 改实体/关系/公式/状态词汇 → 先读 DOMAIN.md 对应 `##` 小节（切片读，勿全文），改动必须同步该小节
- 改跨域流程/闸门顺序/新增任务链 → 先读 FLOWS.md 对应 flow；crosses/payload 必须如实声明
- 不可逆选择 → DECISIONS.md 登记 D-<AREA>-<NN>；代码标记必须在册
- 碰敏感字段/闸门/国密/存证 payload → 先读 TRUST.md 对应 CTL；新敏感字段先登记分级表
- 架构结构与阶段 → ARCHITECTURE.md；UI → DESIGN.md（不变）
```

同时修正 CLAUDE.md 已漂移的模块路径（`runtime/` 前缀），此修正由 checker 的路径检查固化。

---

## 8. 决策表

### 已锁定（由存量决策约束，本设计直接继承）

| 条目 | 出处 |
|---|---|
| 数据不出域是最高不变量 → FLOWS 必须携带 crosses/payload 轴 | D1/D2，ARCHITECTURE §3 |
| 出域义务 fail-closed / 留痕义务 fail-open → CTL 与 flow 的分类字段 | D-UC-2 |
| agent=生产、connector=规格参考 → DOMAIN/FLOWS 即跨语言对齐载体，enforcement 双前缀 | D-CN-1 |
| 链上只存证据 → 链关切不设顶层元语 | D6 |
| attestationLevel 如实标注 software → TRUST 红线 ② | D9/D-RWS-4 |
| OpenSpec 流程不变，DECISIONS 是登记索引非替代 | ARCHITECTURE §7.1 |

### 待定（采纳时定，均不阻塞 P0）

| # | 议题 | 当前倾向 |
|---|---|---|
| P-1 | 第六契约命名：TRUST.md vs SECURITY.md | TRUST.md（涵盖合规与信任表述，不止攻防） |
| P-2 | CHAIN.md 升级触发器阈值 | 结算上链 或 链上合约 ≥3 份 |
| P-3 | `py:` enforcement 对拍深度 | v1 文件级，v2 符号级 |
| P-4 | DESIGN §2 ↔ task-status.types.ts 对拍时机 | 随该文件迁 `--cs-*` 同批 |
| P-5 | `docs/tech-debt.md`（TD-x）即刻立册？ | 是，随 DECISIONS 同批立空册 |
| P-6 | checker 接入点 | 根 `pnpm test` 前置；CI 存在则加 gate |

---

## 9. 落地顺序（每期一句主叙事 + DoD）

| 期 | 内容 | DoD |
|---|---|---|
| **P0** | DECISIONS.md 收编（D1–D12 + deepreq D-XX-n + 3 条未登记既成决策）+ checker 骨架（decision 块 + D-x 反向对拍 + 路径存在检查）+ CLAUDE.md META RULE + 路径纠偏 | `pnpm check:meta` 绿；故意在代码埋一个未登记 `D-TEST-99` 标记能红 |
| **P1** | DOMAIN.md（双平面矩阵 + 各聚合关系/INV + 公式区 + 状态词汇表）+ checker 覆盖矩阵/invariant 规则 | 矩阵与 `@Entity` 全量对拍绿；删任一实体登记行能红 |
| **P2** | FLOWS.md（首批 8 条 flow）+ crosses/payload 红线 + dead_edge_check | 把任一 raw-local 步改成跨域边能红 |
| **P3** | TRUST.md（CTL 登记 + 分级表 + 红线）+ 装饰器对拍 | 新增一个未登记 `@Masked` 字段能红 |

每期 DoD 都含一次"故意破坏能红"的负向验证——checker 不红过，等于没有 checker。

---

*设计参照：`~/projects/followup-ruoyi/{FLOWS,DOMAIN,DECISIONS}.md`、`followup-nx/apps/web-frontend/DESIGN.md`、`followup-nx/scripts/check-meta-docs.mjs`；本仓 `ARCHITECTURE.md`、`DESIGN.md`、`packages/database/src/{control-plane,connector,entities}/`、`apps/api/src/runtime/`、`apps/connector/src/domain/`。*
