## Why

平台已经建成两样别人没有的资产:**机器可校验的研究效度契约**([EVIDENCE.md](../../../EVIDENCE.md),对齐药监 RWD 主动监测指导原则)与**信任控制点**([TRUST.md](../../../TRUST.md))。但它们目前只对"改代码的人"可见(`pnpm check:meta` 报红),对**药企/合规方**——平台真正的用户——是隐形的。

药企提交研究方案时最痛的是"不知道会不会过审、哪里不合规";合规方审方案时最痛的是"逐条对照指导原则手工查"。这两个痛点是同一份规则的两面,而那份规则**已经在册、已经可机检**。一个合规审查 agent 把它包成自然语言体验,等于把治理护城河变成产品界面——**这是本平台的 agent 能力最该展示的样子:AI 建在治理之上,且碰不到原始数据**(R1 天然满足,见 AGENT.md)。

现在做的理由:这是**最短路径的高价值 demo**。审查逻辑的硬核部分(EVD/CTL 规则)已存在,agent 只需 wrap + 解释 + 加判断,不是从零造智能,也不是假装聪明——它解释的是真实护栏。

## What Changes

- **新增 `compliance-review-agent` 能力**:输入一份研究方案 spec(草稿或已提交),输出结构化的合规体检报告——逐条对照药监指导原则要素(EVIDENCE 覆盖矩阵)+ 信任红线(TRUST CTL),标注**通过/警告/阻断**并解释**为什么 + 引用在册条目**。
- **登记为 AGT-02**(control-plane,见下"平面与 R1")。它是 AGT-01(任务设计助手,起草 spec)的下游:草稿 → 审查,构成"设计 → 体检"流水线。
- **审查项(第一版,全部已有机检规则可依托)**:
  - 结局定义独立于暴露(P-EVD-1 / EVD 覆盖矩阵)——结构化引用时可判定,自由文本时降级为提醒。
  - 研究设计类型与选型理由是否声明(designType + rationale)。
  - SAP 按层级是否齐备(L2/L3/L4 必填;多重比较须声明 α 校正)。
  - 缺失值机制 + 填补策略是否成对声明。
  - 分析产物是否越出预先指定范围(EVD-01 / allowedArtifacts)。
  - 因果方法是否在册值域(EVD-02 / CausalMethod),并提示其假设与局限。
  - TEE 表述是否虚标(CTL-09):`attestationLevel` 非 hardware 时不得声称硬件级/机密计算。
  - 识别算法是否有 L0 验证(EVD-05):引用未验证算法时提示错分偏倚风险。
- **边界(硬约束,写进 spec)**:
  - agent MUST NOT 裁决方法学**是否科学合理**——只查"是否声明、是否形式合规、是否触红线",科学性由研究者与伦理审查负责(同 rws-study-protocol-spec 的"系统只判形式"边界)。
  - agent MUST NOT 触达任何患者衍生数据;要核对的数据事实(如"数据源是否含某变量")一律**委托给既有 gated 计算任务**(L0 验证 / 目录元数据查询),agent 自己不下沉(AGENT.md §4 "编排而非下沉"原则)。
  - agent 输出是**建议**,不自动改 spec、不自动放行/驳回;人类署名后方可提交(呼应 P-EVD-10)。

## Capabilities

### New Capabilities
- `compliance-review-agent`: 对研究方案 spec 做合规体检,产出逐条对照指导原则要素 + 信任红线的结构化报告(通过/警告/阻断 + 理由 + 在册引用)。control-plane,只读 spec/合约/目录元数据 + 静态治理规则,不接触患者数据;输出为建议,不自动改 spec 或放行。

### Modified Capabilities
（无。本 change 新增独立能力,不改既有 spec 行为。审查所依据的 EVD/CTL 规则由 EVIDENCE/TRUST 承载,本能力只消费不修改。）

## 平面与 R1（回答"云上还是 connector"）

- **AGT-02 = control-plane,运行在 apps/api(云/中心控制面),不在 connector。** 这不是偏好,是 **AGENT.md R1 强制**:它读 spec/合约/目录元数据,全是控制面元数据,零患者数据;放 connector 端即数据平面 LLM agent = R1 红。
- **v1 `data-access: none`**(只审查提交的 spec 文本对照静态治理规则,同 AGT-01),`identity: none`,`vendor: deepseek`,`flow: FLOW-AI-02`。
- **升级路径 `data-access: metadata-only`**(交叉核对活合约/目录,如"方案声称变量 X 但数据产品 schema 无 X"):按 **R2** 必须 `identity: own-cert`(不借用户 token 读合约),届时重登记。

## Impact

- **代码**
  - `apps/api` — 新增 `compliance-review-agent` 模块(controller/service/prompt/schema,参照既有 `secretflow-assistant` 结构);复用 `check-meta-docs` 的规则逻辑(抽出可被服务调用的纯函数,或以规则清单喂 LLM)。
  - `apps/web` — 审查报告展示(通过/警告/阻断分色,遵循 DESIGN §2 状态色 + §4 原型);接在 RWS 提交表单旁作"提交前体检"。
  - 外部 LLM = DeepSeek(同 AGT-01,env `DEEPSEEK_API_KEY`)。
- **治理契约(必须同步,`pnpm check:meta` 强制)**
  - `FLOWS.md` — 新增 `FLOW-AI-02`(合规审查链):`consumer→control` 提交 spec(payload prompt-text)→ `control→external` 送 DeepSeek(payload **prompt-text**,红线:不得附带患者衍生内容)→ schema 校验产出报告。结构同 FLOW-AI-01。
  - `AGENT.md` — **AGT-02 的 §2 正式登记是本 change 的收尾任务,gated on 实现落地**(同"只登记已存在实现"的硬度红线:enforcement 须指向真实符号,否则 checker 红)。当前 §4 平面预判表已把"合规智能体"列为 control-plane,本 change 落地时移入 §2。
  - `TRUST.md` — 确认 FLOW-AI-02 的外部边受 CTL-11(外部 AI 供应商出域闸)覆盖;审查读取合约/目录时的授权范围(升级到 metadata-only 时)登记。
  - `EVIDENCE.md` — 审查引用的 EVD 条目为**只读消费**,无需改;P-EVD-10(LLM 草稿须人类署名)在本 change 的"输出是建议"边界中被间接强化。
- **依赖**:审查规则与机检逻辑的复用方式(抽纯函数 vs 规则清单喂 LLM)需在 design 定。
- **非目标**:不做自动修复 spec;不做方法学科学性判断;不做跨方案的横向比对(如"这批研究有没有系统性偏倚")——那是运营/监管视角,另议。
