# Spec Delta

## Purpose

定义控制台编排/联邦任务详情页体的呈现：以分析结果与交付结论为先，执行进度与合规审计分层展示，使研究者在作业走完后能扫读指标与信号，而不被运维技术细节淹没。与 `task-browse`（列表与页头/侧栏）正交。

## ADDED Requirements

### Requirement: 详情页体结论优先
MDOP 作业详情（及本能力覆盖的同等详情）的主内容区 SHALL 将**分析结果 / C3 交付结论**置于执行运维细节之前。阶段表、片段哈希、执行凭证度量、会话见证、回执链等运维信息 MUST NOT 以与结论同等的默认优先级抢占首屏主阅读路径。

#### Scenario: 有合并结果时结论在运维表之前
- **WHEN** 作业详情能取得平台侧合并结果（C3），且用户打开该详情
- **THEN** 页面主阅读路径上 MUST 先呈现结果/结论区，MUST NOT 要求用户先滚过完整阶段表与片段哈希才看到结论

#### Scenario: 运维细节可次级访问
- **WHEN** 作业详情包含阶段、片段哈希或回执链等运维信息
- **THEN** 这些信息 MAY 保留在详情中，但 MUST 处于次级分区（折叠、分页签或明确置于结论区之后），不得与结论区同权默认全开

### Requirement: 失衡类合并结果展开关键指标
当合并结果的分析类型为失衡/L1.5（如 `disproportionality`）且 payload 含分层或信号字段时，详情结果区 SHALL 以可读表格或等价结构展示关键指标（至少包括结局键、计数，以及 payload 中已有的 PRR/ROR 或其置信区间、信号标志），MUST NOT 仅用「N 行四格表 a=…」类单行摘要作为唯一展示。

#### Scenario: 含 PRR/ROR/signal 的 C3 可读展开
- **WHEN** 平台合并结果为 `disproportionality`，且某 bucket 含 `prr`/`ror` 与 `signal`
- **THEN** 结果区 MUST 展示该结局的可读指标行（含信号是否成立的可见表达），MUST NOT 隐藏已有 PRR/ROR/信号而只显示 count

### Requirement: 分析类型可读名
详情结果区展示的分析类型 SHALL 使用登记的中文或产品可读名（例如失衡信号 / L1.5），MUST NOT 以英文枚举（如 `disproportionality`）作为对研究者的唯一主文案；技术枚举 MAY 作为次要提示。

#### Scenario: disproportionality 不裸奔
- **WHEN** `result.analysisType` 为 `disproportionality`
- **THEN** 结果区主文案 MUST 为可读分析类型名，MUST NOT 仅显示 `disproportionality` 字符串

### Requirement: 正文状态与浏览四态一致并解释销毁
详情正文中的作业状态呈现 SHALL 与 `task-browse` 归一四态徽章一致。当原始状态为 `PURGED` 时，界面 MUST 说明中间制品已销毁；若仍有 C3 合并结果，MUST 仍展示该结果，MUST NOT 因 `PURGED` 暗示「无结论」或「已取消」而不展示可得的结果。

#### Scenario: PURGED 且有 C3 仍展示结果
- **WHEN** 作业 `status` 为 `PURGED` 且详情接口返回非空合并结果
- **THEN** 结果区 MUST 展示该合并结果，且状态叙事 MUST NOT 将作业表述为无结论的取消

#### Scenario: 正文不用裸 PURGED 冒充唯一状态
- **WHEN** 用户查看已归一为「已完成」的已销毁成功作业详情
- **THEN** 正文状态区 MUST 体现与页头一致的已完成语义（或等价四态），原始 `PURGED` 若展示 MUST 为次要说明而非唯一主状态文案

### Requirement: 参与方与节点可读名
详情页体中面向用户的参与方/连接器节点标识 SHALL 优先显示登记显示名；不可用时再回退 id。MUST NOT 在显示名可得时仍以完整 URN 作为唯一主文案。

#### Scenario: 阶段表节点可读
- **WHEN** 阶段表列出节点且该节点有登记显示名
- **THEN** 主文案 MUST 为显示名（id/URN MAY 次要展示）

### Requirement: 结果区内阅读顺序固定
当存在合并结果时，结果区内部 SHALL 按固定骨架组织：**结论摘要**（可读分析类型、队列/关键规模、信号或关键结论一句）→ **指标表**（按分析类型）→ **发布审查**（有则展示、无则如实说明）→ **结果解读入口**（支持的分析类型才显示）。MUST NOT 把解读入口或审查说明插在摘要之前导致主结论后置。

#### Scenario: 解读在指标之后
- **WHEN** 作业同时具备可展示的合并指标与结果解读入口
- **THEN** 解读入口 MUST 出现在结论摘要与指标表之后

### Requirement: 无结果与加载态完备
作业详情 MUST 处理加载中、读取失败、以及尚无合并结果三种状态。无结果时 MUST 区分「尚未合并/未交付」与「已终态但无 C3」的说明，MUST NOT 用空白主区冒充成功无数据。

#### Scenario: 无 result 时有说明
- **WHEN** 详情接口成功返回但 `result` 为空
- **THEN** 页面 MUST 显示明确空态说明，MUST NOT 仅省略结果区且无任何提示
