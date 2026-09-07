# AGENT.md — 智能体治理契约

> **机器可校验的 agent 契约**。校验由 `node scripts/check-meta-docs.mjs` 强制。
>
> **核心设计原则：按平面划分，不按角色划分。**
> "这个 agent 是给药企的"写不出守护方式；"这个 agent 在哪个平面、碰不碰原始数据"
> 可以 grep、可以对拍。服务对象只作说明性字段（`serves`），**不承担任何强制语义**。
> 这是 D1（两平面）在智能体时代的延伸。
>
> **与其他契约的分工**：TRUST 管数据出域闸（CTL-11 是本册 R4 的落点）；FLOWS 管
> 那条外部边的载荷分级（`control→external`）；EVIDENCE 管 LLM 产出物进入研究规格的
> 效度风险（P-EVD-10）。本册只管 **agent 本身的权限边界与登记**。
>
> **命名空间**：`AGT-x`（本册）与 `D-x` / `INV-x` / `CTL-x` / `EVD-x` / `FLOW-x` / `TD-x` 正交。

---

## 1. 五条硬规矩

### R1 — 平面登记；连接器平面 agent 一律禁止

每个 agent MUST 在 §2 登记并声明 `plane`。**`plane: connector-local` 在第一版是非法值——
校验直接红**。理由：连接器是唯一能触达原始数据的部件（D1/D2/D5），在其上运行由自然语言
驱动、行为不完全可预测的 agent，等于给数据不出域这条最高不变量开了一个语义无法穷举的口子。
提示词注入（prompt injection）在此的后果不是"答错话"，而是**原始数据出域**。

**守护**：全仓扫描 LLM 客户端实例化点；命中文件必须在某个 agent 的 `enforcement` 中在册；
命中文件若位于 `apps/connector/` 或 `apps/agent/` ⇒ 直接红（那按定义就是连接器平面 agent）。

### R2 — agent 是非人类身份，MUST NOT 继承调用者权限

凡 `data-access ≠ none` 的 agent，MUST 持有自己的身份与权限集（`identity: own-cert`），
MUST NOT 借用调用者的 token 或 participantId 去取数。理由：继承式权限会让 agent 成为
**权限放大器**——用户能问的问题范围一旦超出其本人权限，越权就发生在 agent 内部而非边界上，
事后审计只看得到"agent 取了数"，看不到"替谁、凭什么"。对齐行业共识：把 agent 当作
受管的非人类身份（NHI）/"数字员工"，有明确归属、最小权限与可持续审计。

**守护**：`data-access ≠ none` 而 `identity: none` ⇒ 红。

### R3 — 工具调用走 PEP，输出走输出闸门，不开旁路

凡需要触达数据的 agent，其工具调用 MUST 经既有策略执行点（PEP），输出 MUST 经既有输出闸门。
**MUST NOT 为 agent 新开任何绕过闸门的数据通路。** 理由：闸门链是本仓已验证的单一强制点；
外部实践同样指向"最小权限 + 工具调用走单一强制点 + 输出到达使用者前被检查"三者结合。
agent 不是新的数据通道，只是既有通道的新调用者。

**守护**：`data-access: via-pep` 的 agent，其 `enforcement` MUST 含 PEP token。

### R4 — 供应商与模型登记，出站受网络白名单约束

凡调用外部 AI 供应商的 agent，MUST 登记 `vendor` / `model` / `env`，且 MUST 在 FLOWS.md
有对应的 `control→external` 流程（受 `payload ∈ {prompt-text, none}` 红线约束）。
文档层红线之外，**部署层应叠加网络白名单**（专用 internal 网络 + 仅放行供应商 API 的
出站规则，参考 `~/projects/pubmedclaw/docs/agent-code-sandbox-design.md` 的
`--internal` + iptables 方案）——文档说"只许提示词出去"，网络说"只许这一个目标出去"，
两层叠起来才是防线。

**守护**：`vendor ≠ none` ⇒ `flow` 字段必须指向 FLOWS.md 中真实存在的 flow id。

### R5 — 外部运行时平面：登记册是唯一账本，产物入链必须过校验

R1–R4 的守护力全部建立在一个前提上：**agent 的代码在本仓，反向对拍能扫到它**。
一旦 agent 跑在本仓之外的运行时里（自带 loop / 文件系统 / 工具的 agent 宿主，
如部署在公有云上的 OpenClaw 实例），第 7 条反向对拍失效——扫描只走 `apps/`，
扫不到的东西不会报红，**沉默地绕过整个守护体系**。

因此 `plane: external-runtime` 换来的自由度，必须用三件事赎回：

1. **`runtime` 必填** — 部署标识（如 `fly:amr-openclaw`）。代码扫不到，登记册就是唯一账本；
   没有部署标识，事后无从定位"这个 agent 到底跑在哪、还在不在跑"。
2. **`egress` 必填** — 出站白名单域名。R4 的网络白名单对本仓 agent 可以靠单一供应商收口，
   对外部运行时必须逐条列出。**注意白名单是实例级的**：把用途不同的 agent 塞进同一个
   运行时实例，白名单只能取并集，等于没有白名单——所以出站面差异大的 agent 应分实例部署。
3. **`outputs-verified-by` 必填** — 产物进入主链路的校验点（`ts:` 符号级可查）。
   R3 说"输出走输出闸门，不开旁路"；反过来同样成立：**agent 的产物也不是可信输入**。
   外部运行时读的是互联网上的任意内容（文献、网页），提示词注入的落点就是它的产物。
   知识图谱、映射表这类产物必须经确定性校验器才能进入主链路，不得被下游直接信任。

**`data-access: via-pep` 在本平面禁止。** PEP 是本仓内的强制点，"经由 PEP"对仓外代码
无法做符号级证明；声明了也验不了，验不了的声明就是假合规。外部运行时要取数，
必须把取数动作交回控制面 agent，自己只接收结果。

**守护**：`plane: external-runtime` ⇒ 必填 `runtime` / `egress` / `outputs-verified-by`；
`data-access: via-pep` ⇒ ERR。

---

## 2. Agent 登记册（AGT-x）

> **只登记已存在的实现。** 愿景图的 11 类智能体中，本仓当前有 1 个真实实现；
> 其余属愿景，见 ARCHITECTURE §11 边界表，不入册。

```yaml agent
id: AGT-01
name: 任务设计助手（自然语言 → SecretFlow spec 草稿）
plane: control-plane
serves: [consumer]
data-access: none
identity: none
vendor: deepseek
model: env:SECRETFLOW_ASSISTANT_MODEL（默认 deepseek 系列）
env: DEEPSEEK_API_KEY
flow: FLOW-AI-01
enforcement:
  - ts:apps/api/src/secretflow-assistant/secretflow-assistant.service.ts
  - ts:apps/api/src/secretflow-assistant/secretflow-assistant.module.ts
  - ext:FLOWS.md·FLOW-AI-01（control→external 边，payload 仅 prompt-text）
  - ext:TRUST.md·CTL-11（外部 AI 供应商出域闸）
spec: apps/api/src/secretflow-assistant/secretflow-assistant.service.spec.ts
```

**为何 `data-access: none`**：该助手只消费用户输入的自由文本（研究意图 + 目的），
不读目录真实 schema、不读数据产品内容、不读任何患者衍生数据。这也是它能安全地
调用外部供应商的前提——一旦它需要读目录或数据，就必须先升级为
`data-access: via-pep` + `identity: own-cert`，并重新评估其外部调用是否还能成立。

---

## 3. 平面与权限值域

| 字段 | 值域 | 语义 |
|---|---|---|
| `plane` | `control-plane` | 实现在本仓，只碰元数据 / 策略 / 规格；反向对拍可扫到 |
| | `external-runtime` | **实现在本仓之外**的 agent 宿主（自带 loop/文件系统/工具）。反向对拍失效，须补 R5 三件套 |
| | ~~`connector-local`~~ | **第一版禁止**（R1），校验红 |
| `data-access` | `none` | 只处理用户输入文本，不取任何系统数据 |
| | `metadata-only` | 可读目录/合约等控制面元数据，不触达连接器 |
| | `via-pep` | 经 PEP 取数（必须配 `identity: own-cert`）；**`external-runtime` 禁用**（R5） |
| `identity` | `none` | 仅当 `data-access: none` |
| | `own-cert` | 持自有证书与权限集（R2） |
| `serves` | `consumer` / `compliance` / `operator` / `provider` | **说明性字段，无强制语义** |
| `vendor` | `none` / 供应商名 | 非 none 时必须有 `control→external` flow（R4） |
| `runtime` | 部署标识，如 `fly:<app>` / `fly:<app>#ws:<workspace>` | **仅 `external-runtime` 必填**（R5）。代码扫不到，登记册即唯一账本 |
| `egress` | 出站白名单域名列表 | **仅 `external-runtime` 必填**（R5）。白名单是实例级的，出站面差异大的 agent 应分实例 |
| `outputs-verified-by` | `ts:` 校验点列表 | **仅 `external-runtime` 必填**（R5）。agent 产物进入主链路前的确定性校验器 |

> `external-runtime` 不是 `control-plane` 的宽松版本，而是**换了一套守护方式**：
> 前者靠代码扫描证明，后者靠登记 + 出站收口 + 产物校验证明。两条路都不通的 agent，
> 不该存在。

---

## 4. 待建 agent 的平面预判（不入册，仅供设计参考）

按 R1 预先判断哪些愿景 agent 天然合法、哪些天然违规——**避免设计到一半才发现越线**。

| 愿景 agent | 预判平面 | 备注 |
|---|---|---|
| 合规智能体（政策理解/合规检查） | control-plane | 读合约与策略，不读数据 |
| 场景编排智能体 | control-plane | 即 AGT-01 的扩展方向 |
| 科研智能体（文献检索/生成） | control-plane | 外部文献，不碰本地数据 |
| 流程监控智能体 | control-plane | 读任务状态与审计日志 |
| 数据治理 / 脱敏智能体 | **connector-local ⇒ R1 禁止** | 必须落为连接器内的**确定性规则**，不得由 LLM 驱动 |
| 智能问数 / SQL 生成智能体 | **connector-local ⇒ R1 禁止** | 自然语言直接查本地数据 = 数据不出域的语义缺口 |
| 模型训练智能体 | **connector-local ⇒ R1 禁止** | 训练在连接器内，须走既有 FL 编排而非 agent |

> 被 R1 挡住的那三类**不是不能做**，而是**不能做成 agent**：它们应落为连接器内的
> 确定性能力（规则引擎 / 既有编排），由控制面 agent 去**编排**它们，而不是让 agent
> 本身下沉到数据平面。这条区分是本册最重要的设计后果。

---

## 5. 登记草稿（未实现，不入册）

> **围栏 info-string 为 `yaml agent-draft`，校验器不解析**（只解析 `yaml agent`）。
> 这是为了守住 §2 的"只登记已存在的实现"：草稿可以先写、先评审、先对齐边界，
> 但在实现落地前不占据登记册、不产生虚假的合规信号。
> **晋级动作**：实现完成后把围栏改为 `yaml agent`，并补齐下方"晋级前置"全部条目。

以下两个草稿来自 AMR 项目（`docs/amr-sentinel/`）。它们之所以要走 `external-runtime`
而不是 `control-plane`，是因为二者都需要长跑 agent loop + 文件系统 + 工具重试，
这类形态在 NestJS 请求生命周期里做不出来。

### AGT-02（草稿）· 文献与公开耐药知识挖掘

```yaml agent-draft
id: AGT-02
name: 文献与公开耐药知识挖掘（PubMed/CARD/MicroBIGG-E → 耐药知识图谱）
plane: external-runtime
serves: consumer
data-access: none
identity: none
vendor: deepseek
model: env:AMR_PAPERMINER_MODEL
env: DEEPSEEK_API_KEY
flow: FLOW-AI-02
runtime: fly:amr-openclaw
egress:
  - eutils.ncbi.nlm.nih.gov
  - ftp.ncbi.nlm.nih.gov
  - www.ebi.ac.uk
  - card.mcmaster.ca
  - bigquery.googleapis.com
  - api.deepseek.com
outputs-verified-by:
  - ts:apps/api/src/runtime/amr-knowledge/kb-import.validator.ts
enforcement:
  - ext:amr-openclaw·workspace projects/amr-papermine（实现不在本仓）
  - ext:FLOWS.md·FLOW-AI-02（control→external 边，payload 仅 prompt-text）
  - ext:TRUST.md·CTL-11（外部 AI 供应商出域闸）
spec: TODO
```

**为何 `data-access: none`**：全程只消费公开数据（文献、公共数据库），不读目录 schema、
不读数据产品内容、不触达任何连接器。与 AGT-01 同理，这也是它能安全调用外部供应商的前提。

**为何 `outputs-verified-by` 在此不可省**：本 agent 读取互联网上的任意论文全文——
**这是全系统提示词注入面最大的一点**。抽取出的知识图谱最终会成为临床建议的引用来源，
若不经确定性校验（本体约束、菌种/药物必须命中统一字典、置信度与来源可回溯）直接入库，
一篇构造过的文献就能污染下游的用药建议。

**为何 `runtime` 单独一个实例**：`egress` 白名单是实例级的。本 agent 需要放行
NCBI/EBI/CARD/BigQuery，而 AGT-01 只需要放行 DeepSeek；混部会让白名单被迫取并集，
等于没有白名单（R5）。**不要复用已有的 `diabetes-openclaw` 实例**。

**晋级前置**：
- [ ] FLOWS.md 登记 `FLOW-AI-02`（`control→external`，`payload: prompt-text`）
- [ ] 实现 `kb-import.validator.ts` 并补 `spec` 路径
- [ ] 运行时落地 `egress` iptables 白名单（R4 的部署层）
- [ ] 围栏改为 `yaml agent`

### AGT-03（草稿）· 术语与折点对齐

```yaml agent-draft
id: AGT-03
name: 术语与折点对齐（医院码表 → 统一本体映射契约草案）
plane: external-runtime
serves: provider
data-access: metadata-only
identity: own-cert
vendor: deepseek
model: env:AMR_ALIGN_MODEL
env: DEEPSEEK_API_KEY
flow: FLOW-AI-03
runtime: fly:amr-openclaw#ws:amr-align-<tenantId>
egress:
  - api.deepseek.com
  - eutils.ncbi.nlm.nih.gov
outputs-verified-by:
  - ts:apps/api/src/runtime/amr-alignment/mapping-contract.validator.ts
enforcement:
  - ext:amr-openclaw·workspace projects/amr-align-<tenantId>（实现不在本仓，每租户一 workspace）
  - ext:FLOWS.md·FLOW-AI-03（provider→control→external 边）
  - ext:TRUST.md·CTL-11（外部 AI 供应商出域闸）
spec: TODO
```

**它只产映射表，不产判读结果。** 这是本草稿最关键的一条边界：MIC / 抑菌圈 →
S/I/R 的重判读**必须**是连接器内的确定性折点引擎，不得由 LLM 执行。依据是 §4 的结论——
数据治理类能力"应落为连接器内的确定性能力，由控制面 agent 去**编排**它们"。
本 agent 产出的是映射契约（本院编码 → 统一本体），经人工确认并冻结后，由连接器
确定性地套用。LLM 碰码表，不碰测量值。

**为何 `identity: own-cert`**：`data-access: metadata-only ≠ none`，按 R2 必须持自有
身份与权限集，不得借用上传码表那位租户管理员的 token。

**为何每租户一个 workspace**：对齐工作天然 per-hospital。A 院把商品名"泰能"映射到
亚胺培南，这条别名不应污染 B 院的映射表。workspace 隔离在这里是实质隔离，不是整洁性偏好。

**数据边界（硬红线）**：本 agent 只接收**码表 / 字段名 / 折点体系与版本**这类元数据，
**任何行级数据、任何 MIC 测量值、任何患者标识都不得进入该 workspace**。理由有两层：
FLOWS.md 的 `raw-local` 不得出现在任何跨域边；以及运行时若部署在境外区域，
行级健康数据入境即构成数据出境。**部署前须确认 `runtime` 所在区域与码表的数据分级相容**
（码表属组织级敏感信息，分级参照 TRUST CTL-11 对 FLOW-AI-01 的处理）。

**晋级前置**：
- [ ] FLOWS.md 登记 `FLOW-AI-03`（含 `provider→control` 码表上传边，`payload` 须为元数据级）
- [ ] TRUST.md 补充"医院码表"的敏感字段分级
- [ ] 实现 `mapping-contract.validator.ts` 并补 `spec` 路径
- [ ] 确认 `runtime` 部署区域符合码表分级
- [ ] 围栏改为 `yaml agent`

> **不走本平面的两个**：FedAnalyst（自然语言 → `RwsAnalysisSpec`）与 ClinicalAdvisor
> （用药建议）的产物直接进入**研究结论**与**临床决策**，必须确定性、可复现、可冻结
> （见 `SapPlan.sapVersion` / `frozenAt` / `modelSignature`）。带文件系统状态、可反复
> 重跑的 agent loop 在此是自动化 p-hacking 装置。二者应作为 AGT-01 的扩展方向留在
> `control-plane`，效度风险归 EVIDENCE P-EVD-10 管辖。

---

## 附录：格式契约

check-meta-docs.mjs 按以下契约解析本文件：

1. **agent 块**：围栏 info-string 恰为 `yaml agent`。必填字段 `id` / `name` / `plane` /
   `serves` / `data-access` / `identity` / `vendor` / `enforcement` / `spec`。
2. **id 格式**：`AGT-<NN>`，全册唯一。
3. **R1**：`plane` 只许 `control-plane` | `external-runtime`；`connector-local` ⇒ ERR。
4. **R2**：`data-access ≠ none` ⇒ `identity` 必须为 `own-cert`。
5. **R3**：`data-access: via-pep` ⇒ `enforcement` 必须含 PEP token
   （路径含 `policy-enforcement`）。
6. **R4**：`vendor ≠ none` ⇒ 必填 `flow`，且该 id 必须在 FLOWS.md 中存在。
7. **R5**：`plane: external-runtime` ⇒ 必填 `runtime` / `egress` / `outputs-verified-by`；
   `outputs-verified-by` 的每个 token 走路径校验；`data-access: via-pep` ⇒ ERR。
8. **反向对拍**：全仓（`apps/`）扫描 LLM 客户端实例化（`new OpenAI(` / `new Anthropic(` /
   供应商 API 域名），命中文件必须出现在某 agent 的 `enforcement` 中；
   命中文件若在 `apps/connector/` 或 `apps/agent/` ⇒ ERR（R1）。`.spec.ts` 不计。
   **本条对 `external-runtime` 天然失效**（其代码不在 `apps/`）——这正是 R5 三件套
   存在的理由，不要误以为该平面已被扫描覆盖。
9. `enforcement` / `outputs-verified-by` token 语法同 DOMAIN 附录；`ts:` 做符号级存在性校验。
   `ext:` 不校验，供指向仓外实现与其他契约条目。
10. **草稿块**：围栏 info-string 为 `yaml agent-draft` 的块**不被解析**，用于未实现 agent
    的边界评审（§5）。晋级时改为 `yaml agent` 即进入全量校验。`spec: TODO` 是被接受的
    哨兵值，`spec` 为其他值时做路径存在性校验。
