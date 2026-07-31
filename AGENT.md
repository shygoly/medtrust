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

## 1. 四条硬规矩

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
| `plane` | `control-plane` | 只碰元数据 / 策略 / 规格；允许 |
| | ~~`connector-local`~~ | **第一版禁止**（R1），校验红 |
| `data-access` | `none` | 只处理用户输入文本，不取任何系统数据 |
| | `metadata-only` | 可读目录/合约等控制面元数据，不触达连接器 |
| | `via-pep` | 经 PEP 取数（必须配 `identity: own-cert`） |
| `identity` | `none` | 仅当 `data-access: none` |
| | `own-cert` | 持自有证书与权限集（R2） |
| `serves` | `consumer` / `compliance` / `operator` / `provider` | **说明性字段，无强制语义** |
| `vendor` | `none` / 供应商名 | 非 none 时必须有 `control→external` flow（R4） |

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

## 附录：格式契约

check-meta-docs.mjs 按以下契约解析本文件：

1. **agent 块**：围栏 info-string 恰为 `yaml agent`。必填字段 `id` / `name` / `plane` /
   `serves` / `data-access` / `identity` / `vendor` / `enforcement` / `spec`。
2. **id 格式**：`AGT-<NN>`，全册唯一。
3. **R1**：`plane` 只许 `control-plane`；`connector-local` ⇒ ERR。
4. **R2**：`data-access ≠ none` ⇒ `identity` 必须为 `own-cert`。
5. **R3**：`data-access: via-pep` ⇒ `enforcement` 必须含 PEP token
   （路径含 `policy-enforcement`）。
6. **R4**：`vendor ≠ none` ⇒ 必填 `flow`，且该 id 必须在 FLOWS.md 中存在。
7. **反向对拍**：全仓（`apps/`）扫描 LLM 客户端实例化（`new OpenAI(` / `new Anthropic(` /
   供应商 API 域名），命中文件必须出现在某 agent 的 `enforcement` 中；
   命中文件若在 `apps/connector/` 或 `apps/agent/` ⇒ ERR（R1）。`.spec.ts` 不计。
8. `enforcement` token 语法同 DOMAIN 附录；`ts:` 做符号级存在性校验。
