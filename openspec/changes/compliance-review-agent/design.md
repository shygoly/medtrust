## Context

平台已有两份机器可校验的治理契约——[EVIDENCE.md](../../../EVIDENCE.md)(研究效度,对齐药监指导原则)与 [TRUST.md](../../../TRUST.md)(信任控制点)——但它们只对"改代码的人"可见(`pnpm check:meta` 报红)。药企提交研究方案、合规方审方案,面对的是同一份规则,却只能靠人肉对照。AGT-02 把这份规则包成自然语言体验。

**现有可复用资产**:
- AGT-01(`apps/api/src/secretflow-assistant`)= 已验证的单次 LLM 调用模块骨架(controller/service/prompt/schema + DeepSeek + zod 校验),AGT-02 照此形。
- `scripts/check-meta-docs.mjs` 已实现 EVD/CTL 的确定性校验逻辑,但它是**独立 node 脚本**、面向文档;AGT-02 需要**同一套判定规则作用在运行时的 spec 对象上**。
- `rws-study-protocol-spec` change 已落地大量准入校验(结局-暴露独立性、SAP 分级、缺失值成对、冻结),这些是"提交时"的**硬拒绝**;AGT-02 是"提交前"的**软体检**,判定口径必须与它们**一致**,否则用户会遇到"体检说过、提交被拒"的撕裂。

**约束**:
- AGT-02 是 control-plane、`data-access: none`(v1)、单次调用——它绝不能成为绕过既有准入校验的旁路,也不能自行放行/驳回。
- 判定的可信部分必须确定性,不可交给 LLM 幻觉。

## Goals / Non-Goals

**Goals**
- 把 EVD/CTL 规则做成"提交前"的自然语言体检:逐项 通过/警告/阻断 + 理由 + 在册引用。
- 判定口径与既有准入校验(`rws-study-protocol-spec`)一致,消除"体检-提交"撕裂。
- 可信部分确定性,LLM 只做解释与软判断。

**Non-Goals**
- 不判方法学科学性(只判形式合规与红线)。
- 不自动改 spec、不自动放行/驳回。
- 不触达患者数据;需核对数据事实的委托给 gated 任务。
- 不做跨方案横向比对(运营/监管视角,另议)。
- 不套行为约束沙箱(单次调用,无工具循环——见 D4)。

## Decisions

### D1. 判定规则抽为共享纯函数,checker 与 agent 同源

**选择**:把 EVD/CTL 的确定性判定从 `check-meta-docs.mjs`(文档态)与 `rws-orchestrator` 准入校验(提交态)中,抽出**面向 spec 对象的共享判定函数**(如 `libs`/`apps/api/src/compliance/rules/*`),三方(checker 文档校验、提交准入、AGT-02 体检)调同一实现。

**理由**:这是防"三处判定漂移"的唯一办法。若 AGT-02 自己实现一套"是否有 SAP",迟早与准入校验的口径分叉,产生"体检说缺、提交说够"或反之。同源 = 口径天然一致。

**备选**:AGT-02 用 LLM 判所有规则——否决,LLM 会幻觉出"通过",且口径不可能与确定性准入校验对齐。

**影响**:准入校验(`rws-study-protocol-spec` 落地的)可能需重构为调用共享判定函数;范围在 tasks 评估,不强制一次到位——第一版 AGT-02 可先只读、复用判定逻辑,准入侧重构作为收敛项。

### D2. 三层判定:硬规则(码)/ 软判断(LLM)/ 解释(LLM)

**选择**:
- **硬规则(确定性,码)**:designType/rationale 是否声明、SAP 按层级是否齐备、缺失值是否成对、结局-暴露是否交集(结构化引用时)、产物是否越界、方法是否在册值域、attestationLevel 是否 software、引用算法是否有 L0 验证。→ 二值,`通过/阻断`,**LLM 无权翻案**。
- **软判断(LLM)**:rationale 是真理由还是凑字、自由文本结局是否疑似夹带暴露、SAP 声明是否自相矛盾。→ `警告`,附"建议人工确认"。
- **解释(LLM)**:每条 flag 的通俗理由 + 引用在册 EVD/CTL id。

**理由**:可信=确定性,判断=LLM,两者职责不混。硬规则若交给 LLM,一次幻觉就是一次错误放行。

**影响**:prompt 结构 = 把 spec + **硬规则判定结果** + 相关规则文本喂给 LLM,让它"解释这些结果 + 补软判断",而非"从头判"。

### D3. 报告是建议,判定级别与准入行为解耦

**选择**:AGT-02 输出 `pass | warn | block` 三级**仅为建议**。`block` 不阻止用户提交(提交时另有 `rws-study-protocol-spec` 的硬拒绝把关),`pass` 不代表提交必过。报告 MUST 显式声明"这是提交前体检,非放行"。

**理由**:两套判定物理分离——体检(agent,可能受 LLM 影响)与准入(确定性,fail-closed)。若 agent 的 `pass` 能放行,LLM 幻觉就成了安全漏洞。agent 只降低"提交后被拒"的概率,不接管准入。

**影响**:UI 必须把"体检建议"与"提交准入结果"视觉区分,避免用户误以为体检过=已放行。

### D4. 单次调用,不套行为沙箱;留在 medtrust-api

**选择**:AGT-02 = 单次(必要时少数几次)LLM 调用,`prompt in → 结构化 report out`,无工具循环、不执行生成代码。作为 NestJS 模块编入 `apps/api`,随 medtrust-api 部署,与 AGT-01 并排。

**理由**:它不执行 agent 生成的动作,故不存在"行为约束沙箱"(openclaw/Firecracker 那类)要防的威胁——套沙箱是过度工程。它的唯一出域控制是 FLOW-AI-02 的 `control→external` 红线(仅 prompt-text)。行为沙箱是**将来它若自主化**(工具循环)才需要的层,届时是新决策(独立 Fly Machine + egress 白名单),且仍受 R1 约束(沙箱防动作、不放松数据平面)。

**备选**:一开始就独立 app + 沙箱——否决,YAGNI,给只发 HTTPS 的服务上重甲。

### D5. 出域载荷严格 prompt-text,不带目录真实 schema

**选择**:送 DeepSeek 的只有:用户的 spec 草稿文本 + 硬规则判定结果 + **静态规则文本**。**MUST NOT** 附带数据产品的真实 schema、真实合约内容、任何聚合或患者衍生数据。

**理由**:spec 草稿是研究者自己的输入(元数据级),可出;但目录真实 schema 属提供方资产,合约内容可能含定价等敏感项。v1 `data-access: none` 天然满足;升级到 `metadata-only` 时,交叉核对须在**本地(控制面内)**做,只把"是否匹配"的布尔结论交给 LLM,不把 schema 原文送出。

**影响**:FLOW-AI-02 的 `control→external` 步 payload = `prompt-text`,受 checker 红线守护(带患者衍生载荷即红)。

## Risks / Trade-offs

- **判定漂移(体检 vs 准入)** → D1 共享纯函数;第一版若未完成准入侧重构,tasks 须显式标注"口径来源 = 准入校验,agent 复用其判定",并加一个对拍测试(同一 spec 喂 agent 与准入,硬规则结论必一致)。
- **LLM 幻觉出"通过"** → D2/D3:硬规则不交 LLM;agent 的 pass 不放行。幻觉最多让"警告"不准,不会让"阻断项"漏掉。
- **用户误读体检=放行** → D3 报告声明 + UI 区分。
- **升级 metadata-only 时的授权范围** → 按 R2 持自有证书;读合约须 scope 到该用户可见范围(不跨药企),design 留 Open Question。
- **DeepSeek 不可用** → 硬规则确定性部分可离线出(不依赖 LLM);仅"解释+软判断"降级为"规则原文 + 无软判断",报告标注 LLM 不可用。这反而是韧性优点:核心判定不依赖外部 AI。

## Migration Plan

1. 抽共享判定函数(至少覆盖 8 条硬规则),加单测。
2. 建 `compliance-review-agent` 模块(照 secretflow-assistant 形),service 调共享判定 + DeepSeek 解释。
3. FLOW-AI-02 登记 + `control→external` 红线覆盖确认。
4. 前端体检面板(接 RWS 提交表单旁)。
5. **收尾**:AGT-02 移入 AGENT.md §2 正册(enforcement 指向落地符号);准入侧重构为调用共享判定函数(收敛项,可另 change)。

**回滚**:AGT-02 是独立模块 + 独立端点,停用即回到现状;共享判定函数抽取是纯重构,有单测保护。

## Open Questions

- **共享判定函数的宿主**:放 `apps/api/src/compliance/rules/` 还是抽到可被 checker(node 脚本)也复用的 `packages/`?后者能让 `check-meta-docs` 与运行时真正同源,但引入 packages 依赖。倾向后者,tasks 定。
- **metadata-only 升级的授权 scope**:agent 读合约/目录时如何限定到调用用户的可见范围?依赖 `participant-identity` 的既有 RBAC 对齐。
- **软判断的稳定性**:LLM 软判断(如"rationale 是否凑字")在不同调用间是否稳定?是否需要固定 temperature + 少样本示例?落地时评估。
