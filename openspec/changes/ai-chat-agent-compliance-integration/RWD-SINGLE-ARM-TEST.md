# RWD 单臂药物注册 · 完整测试流程

> 适用：验证「AI 助手 + 合规闸 + 合约 + MDOP 作业」这条链路在 RWD 单臂外部对照场景下的行为。
> 两条路线：**A 浏览器级自动化（确定性、开箱即跑）** 与 **B 真实环境手工（要连接器签名）**。
> 文中账号、产品、合约状态、ACL 判定均为 **2026-10-17 实测**结果，不是设想。

---

## 0. 一句话结论

- **路线 A 现在就能跑完整流程**（真 web + 真 chat-agent，控制面用桩扮演连接器），`12/12` 通过。
- **路线 B 的合规与签约链已打通**：药企从 chat-agent 提交成功，计划同时携带两份已双签合约；
  `job-mvc3iq33-6caebc0d` 已进入控制面。
- **路线 B 的执行仍被真实硬件拦住**：本机没有 TDX/SEV-SNP/CSV，A/B 节点只能以软件证明运行，
  编译期如实拒绝 C2（`E_ATTESTATION_FAILED`）。提交成功不等于作业执行成功，两者必须分开看。

> **2026-10-17 生产入口复跑（覆盖上方本机路线 B 的旧边界）**：
> `job-mvcdfgik-bb304af4` 已在 ali29 生产入口完整执行并 **PURGED**。
> 试验臂 460 人、对照池 5600 人；四个分层全部匹配，`unmatched=0`，
> 发布审查 `suppressedTotal=0`，使用 `tee-node-a` 的真实 TDX 证明。

---

## 1. 环境与端口

| 组件 | 端口 | 启动 |
|---|---|---|
| PostgreSQL | 5432 | 已运行（`DATABASE_URL=postgres://mac@localhost:5432/medtrust`） |
| 控制面 API | 5021 | `cd apps/api && pnpm build && node dist/main.js`（读 `apps/api/.env`） |
| 控制台 Web | 5020 | `pnpm --filter web build && pnpm --filter web start` |
| AI 助手 | 5032 | `cd apps/chat-agent && pnpm build && MEDTRUST_API_URL=http://localhost:5021 node dist/main.js` |

LLM 选择（`apps/chat-agent/.env` 或命令行覆盖）：

```bash
LLM_PROVIDER=rule-based     # 确定性回退，不外发任何文本（测试/演示首选）
LLM_PROVIDER=deepseek DEEPSEEK_MODEL=deepseek-chat   # 真模型；不要用思考模型（见 §7）
```

> 重要：`apps/api/.env` **没有** `JWT_SECRET` → API 用临时开发密钥，**重启即掉登录**。
> 要稳定会话，加一行固定值：`JWT_SECRET=$(openssl rand -hex 32)` 写进 `apps/api/.env` 后重启 API。

---

## 2. 账号（密码统一 `demo123456`，均已实测登录）

| 账号 | 名称 | 角色 | 参与方 | 空间 | 用途 |
|---|---|---|---|---|---|
| `research@meddata-inst.edu.cn` | 研究院研究员 | consumer | `p-meddata` | `sh-med` | 另一使用方：真实环境里可用于发起申请（其 ACL 已由脚本授予） |
| `admin@demohospa-hospital.com` | 示范甲医院管理员 | provider | `p-demohospa` | `sh-med` | **提供方**：签发合约、授予访问权 |
| `admin@rjh.com.cn` | 瑞金医院管理员 | provider | `p-ruijin` | `sh-med` | **生产实际连接器为 `p-ruijin`**，不要假定它是 `p-demohospb` |
| `pv@demo-pharma.example` | 创新药企 PV 研究员 | consumer | `pharma-demo` | `sh-med` | **RWD 单臂的发起方（E2E 登录这个账号）** |
| `data-governance@health.gov.cn` | 区域卫健委监管员 | operator | `p-health-gov` | `sh-med` | **连接器注册**（仅 operator） |

登录页：http://localhost:5020/login （验证码是页面上的图，演示可走登录页的"快速选择演示账号"）。

**角色分工（谁该在 AI 助手里发起需求）**

| 角色 | 该做什么 | 不该做什么 |
|---|---|---|
| **药企 / 研究院（consumer）** | 提研究需求、在 AI 助手配置并提交作业、发起合约申请 | 不替医院签发合约 |
| **医院（provider）** | 上架数据、在 `/space/contracts` 签发/驳回合约、授予产品访问权 | 不作为"研究需求发起人"（医院自己发起研究是另一回事，但不是本演示的角色设定） |
| **operator** | 注册连接器、平台运维 | 不参与具体研究 |

AI 助手本身没有按角色做硬闸（医院也可能对自己的数据发起分析），所以演示时**由使用方账号发起**是业务约定，而不是系统强制。

---

## 3. 数据：RWD 单臂用哪一份、怎么生成

### 3.1 现成数据（已生成，可直接用）

**单臂外部对照必须用专用试验/对照数据，不能把两份医院胰岛素队列分别当 trial/control。**
`sponsor-trial` 投影要求 `linkKey / ageBand / sex / indexDate / outcome`；普通医院队列没有
试验索引日与结局字段，节点内会报“trial 侧输入为空”。生产复跑使用的专用数据：

| 侧 | 本地源文件 | 规模 | 生产数据产品 / 提供方 |
|---|---|---|---|
| 单臂试验 | `data/demo/external-control/sponsor/records.json` | 460 | `40ff788a-89e7-4601-9981-9b9b962d509e` / `p-huashan` |
| 历史对照 | `data/demo/external-control/hospital/records.json` | 5600 | `99bd8b08-6a69-457f-8063-2bde919ea413` / `p-ruijin` |

两个文件已放入生产连接器卷：
`/repo/apps/connector/data/ext-control-sponsor.json` 与
`/repo/apps/connector/data/ext-control-hospital.json`。记录在交给基座加载器前补了空的
`conditions / medications / adverseEvents` 数组。

本数据真实分层键只有四个：
`18-39|M, 18-39|F, 40-64|M, 40-64|F`。

| 产物 | 位置 | 规模 |
|---|---|---|
| 分医院 FHIR | `data/synthea/hospitals/{demohospa,demohospb}/fhir/` | 140 / 150 个切片 |
| 连接器本地切片 | `data/synthea/connectors/{demohospa,demohospb}/` + `manifest.json` | 每患者一个 JSON |
| 目录产品（两家医院各一份） | `dp-insulin-panc-demohospa`（示范甲 5000）<br>`dp-insulin-panc-demohospb`（示范乙 5000） | provider 分别为 `p-demohospa` / `p-demohospb` |

这组数据来自 Synthea 糖尿病队列 + 胰岛素暴露/胰腺炎信号注入（`data/synthea/diabetes-formulary.md`）。

### 3.2 从零重新生成（需要 Java，jar 已就位）

```bash
# 1) 生成 Synthea 糖尿病队列（默认 50 人；这里写 200 人、输出到 output/ 供下一步切分）
scripts/generate-synthea-diabetes.sh 200 42 data/synthea/output

# 2) 切成两家医院（40 + 60 名患者；可改参数）
npx tsx scripts/split-synthea-hospitals.ts --demohospa 40 --demohospb 60

# 3) 生成连接器本地切片（manifest 里登记 participantId 与 catalogProductId）
npx tsx scripts/build-synthea-connectors.ts

# 4)（可选）把临床文本装进 dp-neph-text 形态
npx tsx scripts/ingest-synthea.ts
```

注意：切分脚本固定读 `data/synthea/output/fhir`，所以第 1 步的输出目录要写 `data/synthea/output`（不是默认的 `diabetes-cohort`）。

### 3.3 连接器本地闭环（不依赖控制面，验证"数据不出域"）

```bash
pnpm --filter @medtrust/connector demo:synthea-e2e   # 前置：3.2 的第 1、2 步
```

---

## 4. 路线 A：浏览器级自动化（**现在就能全绿**）

```bash
cd apps/chat-agent
pnpm test:e2e                       # 全套 12 条
pnpm test:e2e -- test/e2e/scenarios/rwd-single-arm-demo.spec.ts   # 只跑 RWD 单臂演示
```

RWD 单臂用例（`rwd-single-arm-demo.spec.ts`）做的事：

1. 用 **药企** `pv@demo-pharma.example` / `demo123456` 登录真实登录页（认证接口在浏览器侧打桩）——
   单臂外部对照是药企的注册研究诉求，医院只会在签发环节出现（见 `contract-compliance-flow.spec.ts`）；
2. 进 `/space/chat`，说「我想做单臂试验的外部对照」；
3. 出配置卡 → 选试验方 `p-sponsor`、对照方 `p-hosp-a`、填分层键/卡尺/比例；
4. 提交 → 拿到 `job-e2e-1` 状态卡；
5. 另有「拒绝场景」：试验方=对照方 → 失败卡 + 预填回卡。

链路真实度：**浏览器 → web（真生产构建）→ chat-agent（真服务）**；只有控制面是 `test/stub-control-plane.mjs`（桩扮演目录/合约/签名）。桩刻意镜像真控制面的准入判据（合约可用性、ACL fail-closed、自动推进前置），否则会假绿。

同套件还覆盖：无合约→申请→医院签发→再提交；Phase 3 预授权自动创建；ACL 拒绝后授予；权限不足拒绝；只读查询不出合约卡。产物见 [`screenshots/`](./screenshots) 与 [`demo/`](./demo)。

---

## 5. 路线 B：真实环境手工（需要连接器签名）

### 5.1 准备与体检（幂等）

```bash
node scripts/rwd-demo/prepare.mjs --dry-run   # 只读：产品 / 合约 / 签名 / ACL 现状
node scripts/rwd-demo/prepare.mjs             # 缺授权时由医院授予 compute（幂等）
```

实测输出（2026-10-16）：

- 两个产品对研究机构可见；
- 11 份合约 **全部 `mdopStatus=unsigned`、`签名=否`** → 都不可用于 MDOP 作业；
- ACL 初始 `no-grant` → 脚本让示范甲/乙分别授予 `compute` 后变 `allowed=true`（grant `5700eb71` / `5a6731c2`）。

### 5.1b 合规预审（D-CMP-2，合约申请的硬前置）

**先确认能力注册表已灌种子**（本环境的坑：`l1_scenario` 等表原本是空的，任何 scenarioKey 都会报
"能力对象不存在"）：

```bash
# 必须与 API 用同一个库；packages/database 不会自动读 apps/api/.env
DATABASE_URL='postgres://mac@localhost:5432/medtrust' pnpm --filter @medtrust/database seed
```

**预审最小可过配置**（实测 `auto_approve`；只填 scenarioKey 会因高风险缺匿名化/安全能力被判 block）：

```json
{
  "scenarioKey": "multi-center-clinical-research",
  "protocolKeys": ["federated-local-compute"],
  "chosenParams": { "anonymizationKey": "partial", "kAnonymity": 5 },
  "riskDimensions": { "participantCount": 2 }
}
```

创建并裁决（用**发起方**账号的 token）：

```bash
POST /api/v1/composition                # 上文的 JSON
POST /api/v1/compliance/evaluate/<id>    # 期望 autoVerdict=auto_approve
```

> UI 现状：`/space/atlas/pre-review` 会重定向到 `/space/atlas/compose`（计划编辑器），**还没有"创建组合"界面**；
> 目前用 API 或 `scripts/rwd-demo/prepare.mjs`（会自动检测/创建 auto_approve 预审）。

本环境已创建并通过的预审：

| 发起方 | 预审 id | 裁决 |
|---|---|---|
| 药企 `pharma-demo` | `c4b4e0e0-e4c9-4c07-b7b2-3d2f1396274a` | auto_approve（medium） |
| 研究院 `p-meddata` | `15967401-9a9d-4e72-8b0f-25b84b6e2129` | auto_approve（medium） |

研究院账号下还有若干**历史 manual_review（high）**预审（seed 合约挂的），所以 agent 列出多份时
要选上表里 `auto_approve` 的那份；药企账号只有一份，会自动引用。

### 5.2 合约：两个数据源各签一份

`assertUsableForJob` 的判定是：**存在 → 持有方已签名 → `mdopStatus=active` → 未过期 → 用途相符**。
所以 seed 合约（医院→`p-meddata`，未签名）无法直接支撑作业。

外部对照有试验臂与对照臂两个数据源，agent 会按
**「提供方 + 数据产品」逐项匹配合约**，不再错误地要求一份合约同时覆盖两家医院。
每份合约仍逐条通过签名、MDOP active、有效期与用途校验。

2026-10-17 生产入口实测已由药企发起、两家医院连接器分别签名并完成平台副署：

| 数据产品 | 合约 id | 提供方 | 使用方 | 状态 |
|---|---|---|---|---|
| `40ff788a-89e7-4601-9981-9b9b962d509e`（单臂试验） | `f4c9f9e9-8376-434e-973d-18eefbbd3fbf` | `p-huashan` | `pharma-demo` | `active / active`，有效至 2027-02-14 |
| `99bd8b08-6a69-457f-8063-2bde919ea413`（历史对照） | `660c951d-0e87-4a4c-b824-7adc5fba3d88` | `p-ruijin` | `pharma-demo` | `active / active`，有效至 2027-02-14 |

提交计划时必须**同时携带两份合约**，并由模板把各自合约绑定到对应数据源的 seal 阶段：
`contractsByParticipant = { p-huashan: …, p-ruijin: … }`。

旧胰岛素队列合约 `c204feab-…` / `0dcd4e14-…` 已因 30 天有效期短于作业窗口而撤销，
不得继续复用。作业窗口必须完整落在合约有效期内，否则医院连接器会拒绝
`E_CONTRACT_EXPIRED: 凭证终点晚于合约有效期`。

### 5.3 若要补齐真实签名（连接器）

签名只能由**持有方连接器**给出（D-MDOP-4），平台不代签：

```bash
# 1) 院内生成 SM2 私钥（0600），输出公钥与 kid
node apps/connector/scripts/keygen.mjs --out data/connector-demohospa.key

# 2) 用 operator 账号注册连接器（公钥必填；平台不代生成）
#    POST /api/v1/connectors/register
#    { "connectorId": "conn-demohospa", "participantId": "p-demohospa", "subjectPublicKey": "04..." }

# 3) 起连接器（两家医院各一个进程/端口；关键 env 见 DEPLOY.md §2）
CONNECTOR_PARTICIPANT_ID=p-demohospa \
CONTROL_PLANE_URL=http://localhost:5021/api/v1 \
CONNECTOR_PORT=5022 \
CONNECTOR_CERT_FINGERPRINT=SM2:0DBAE81BB82E38AD \
MDOP_ENABLED=true \
CONNECTOR_MDOP_CONTRACT_POLICY_FILE=./data/connector-demohospa.policy.json \
pnpm --filter @medtrust/connector start
```

示范乙同理：`CONNECTOR_PARTICIPANT_ID=p-demohospb`、`CONNECTOR_PORT=5023`、
独立的 `CONNECTOR_DB_URL`、私钥与证书记录，以及自己的本地策略文件。
`MDOP_ENABLED` 漏设时连接器仍会长轮询，但**不会处理 ContractOffer**；表现是平台发件箱已投递、
本地待确认表为空，必须补开并重启。

连接器的合约确认策略**缺省人工**；要预授权自动签，写本地策略文件（院内维护、平台改不到）：

```json
{
  "review": "auto",
  "autoConfirmContractIds": [],
  "autoConfirmRules": [
    {
      "label": "RWD 单臂外部对照",
      "dataProductId": "dp-insulin-panc-demohospa",
      "consumerId": "pharma-demo",
      "purpose": "对话式任务配置（AI Chat Agent）",
      "maxValidDays": 90,
      "minMinCell": 5
    }
  ],
  "note": "RWD 单臂演示"
}
```

之后流程：使用方在 `/space/chat` 发起申请 → 医院在 `/space/contracts` 点「签发」→ 平台发 `ContractOffer` → 连接器签 `ContractAgree` → 合约 `mdopStatus=active` + 持有方签名 → 作业可提交。

### 5.3b TEE A/B 的本机边界

A/B 节点已可用本机演练 KMS 常驻启动（`TEE_NODE_DEV_KMS_KEY_FILE`），但当前机器没有
TDX/SEV-SNP/CSV 硬件，证明提供者仍是 `software`，能力通告如实为 `tee:null`。
这意味着：

- A/B 可以完成注册、心跳、长轮询与消息处置的接线验证；
- **不能**执行本场景的 C2 阶段。合约未声明证明策略时，编译期会以
  `E_ATTESTATION_FAILED: 合约未声明证明策略，不得把 C2 制品流向任何节点` 失败；
- 这只是正确的 fail-closed，不是可以绕过的配置缺口。要真正执行 RWD 外部对照，必须换到有真实
  厂商证明链的 TDX/SEV-SNP/CSV 节点，并让签约条款携带可验证的 `attestationPolicy`。

### 5.4 提交与核验

1. https://web.szchada.top/space/chat ，登录**药企**账号 `pv@demo-pharma.example`（提交才会带你的 Authorization）；
2. 说「我想做单臂试验的外部对照」→ 填 trial / controls / 分层键 / 卡尺 / 比例；
3. 提交 → 状态卡带 `jobId`；被拦时会出合约/授权引导卡（不会静默失败）；
4. 核验：
   - `/space/tasks`（或 `/space/mdop/jobs/<id>`）看任务状态与结果；
   - `/space/contracts` 看合约 `已生效/已签发`；
   - 工作台「待处理通知」看申请/签发/驳回（站内信，D-NOTIF-1）；
   - `GET /api/v1/audit?resource=contract`（合规/运营）与 `/audit/export` 看审计链；
   - AI 指标：`curl -s localhost:5032/api/v1/metrics | grep -E "compliance_decisions|job_submissions|contract_auto_offer"`。

生产本次填写值：

- trial：`p-huashan` / `40ff788a-89e7-4601-9981-9b9b962d509e`
- controls：`p-ruijin` / `99bd8b08-6a69-457f-8063-2bde919ea413`
- teeNode：`urn:tds:sh-med:participant:tee-node-a`
- strataKeys：`18-39|M, 18-39|F, 40-64|M, 40-64|F`
- caliperDays：`30`；ratioK：`2`；minCell：`5`

---

## 6. 演示脚本（截图/录屏）

```bash
cd apps/chat-agent
RECORD_VIDEO=1 SLOWMO=150 npx playwright test test/e2e/scenarios/contract-compliance-flow.spec.ts
```

产物：`test-results/compliance-0*.png` 与 `test-results/<case>/video.webm`；
仓库里已固化一份到 [`screenshots/`](./screenshots) 与 [`demo/`](./demo)（含复跑说明）。

---

## 7. 已知限制与排错

| 现象 | 原因/处置 |
|---|---|
| `无法连接 /notifications` | ① API 是旧进程（未含新端点）→ 重建重启；② 或登录态已失效（见下） |
| 重启 API 后被踢回登录页 | `JWT_SECRET` 未设 → 临时密钥，重启即失效；设固定 `JWT_SECRET` 或重新登录 |
| `E_CONTRACT_UNSIGNED` / 作业被拒 | 合约没有持有方签名；按 §5.3 起连接器签约（平台不代签） |
| `reasoning_content ... must be passed back` | DeepSeek **思考模型**多轮工具调用；用 `DEEPSEEK_MODEL=deepseek-chat` 或 `LLM_PROVIDER=rule-based` |
| 页面 500 / chunk 加载失败 | 旧 `next start` 还在跑而 `.next` 已重建 → 重启 web |
| 5020/5032 端口被占 | `lsof -nP -iTCP:5020 -sTCP:LISTEN` 查旧进程；Playwright 的 `reuseExistingServer` 会复用旧服务 |
| 登录 429 | 演示环境按 IP 限流；等 1 分钟再试（`prepare.mjs` 自带 20s 重试） |
| 电力空间表单候选是医疗参与方 | `/public/catalog` 端点不接 `spaceId`（已知缺陷，另修） |

---

## 8. 清理

```bash
# 停掉手工起的服务（按实际 PID）
lsof -nP -iTCP:5020 -iTCP:5032 -sTCP:LISTEN

# 撤销演示授予（可选；授权是追加式回收，不删行）
# POST /api/v1/data-access/grants/<id>/revoke  { "reason": "演示结束" }
```
