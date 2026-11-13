# Spec Delta

## Purpose

定义控制台中联邦/编排任务的浏览呈现：统一列表如何显示用户任务标题与状态，以及各通道详情页头与合约侧栏的最小信息架构，使多通道聚合后仍可扫读与核对。

## ADDED Requirements

### Requirement: 任务列表主标题为用户任务标题
统一任务列表的主标题 SHALL 为用户在发起表单中填写的任务标题（经通道持久化后的显示名）。当标题仅作为 MDOP `applicant.project` 等字段保存时，列表 MUST 仍优先用其作为主标题（排除系统默认占位值）。仅当无可用标题时 MAY 回退为研究目的或任务 id。

#### Scenario: MDOP 作业显示表单标题
- **WHEN** 使用方发起 MDOP 路径任务并填写任务标题「肾内科病历文本队列分析」，且该值已写入作业的 `applicant.project`
- **THEN** `/space/tasks` 对应行的主标题 MUST 为「肾内科病历文本队列分析」，MUST NOT 仅显示「MDOP ·」加研究目的而忽略该标题

#### Scenario: 占位 project 不冒充标题
- **WHEN** `applicant.project` 为系统默认占位（如 `rws-l15`、`fl-prediction`）且存在非空研究目的
- **THEN** 列表主标题 MUST 回退为研究目的（或其它更高优先级的真实标题），MUST NOT 把占位串当作用户标题展示

#### Scenario: 旧通道 title 仍可用
- **WHEN** 任务来自仍写入独立 `title` 字段的旧编排通道
- **THEN** 列表主标题 MUST 使用该 `title`（在非空时）

### Requirement: 任务列表状态徽章映射正确且单一
统一任务列表 SHALL 将各通道原始状态映射到闭集浏览徽章（进行中 / 已完成 / 受阻，或登记的等价闭集），且每一行 MUST 只突出一个主状态徽章。已知终态（含 MDOP 的 purged/closed 等）MUST NOT 被映射为进行中。

#### Scenario: PURGED 不是进行中
- **WHEN** MDOP 作业 `status` 为 `PURGED`
- **THEN** 列表主徽章 MUST NOT 显示「进行中」

#### Scenario: 单一主徽章
- **WHEN** 用户查看任务列表某一行
- **THEN** 该行 MUST 有且仅有一个主状态徽章表达归一状态；通道原始状态若展示，MUST 为次要文案而非第二枚对等徽章

### Requirement: MDOP 列表行包含可得的发起方信息
当 MDOP 作业列表数据包含申请方组织标识时，统一任务列表对应行 SHALL 呈现该发起方（显示名或 id），MUST NOT 在组织标识可得时仍显示为空发起方。

#### Scenario: applicant.org 可见
- **WHEN** MDOP 作业带有 `applicant.org`（如 `p-meddata`）
- **THEN** 列表行 MUST 能识别该发起方（显示名或 id），MUST NOT 在发起方位置固定为「—」

### Requirement: 任务列表目的不与主标题重复刷屏
当主标题已等于或明显包含研究目的时，列表 SHALL NOT 再以对等权重重复展示「目的 · {purpose}」类芯片作为默认噪音。

#### Scenario: 标题即目的时不重复
- **WHEN** 行主标题与 `purpose` 相同或主标题仅由目的构成
- **THEN** 列表 MUST NOT 再默认并排一枚内容重复的目的芯片

### Requirement: 任务列表发起方与时间可读
统一任务列表的发起方与创建时间 SHALL 以可读形式呈现：发起方优先登记显示名（不可用则 id）；时间 MUST 为本地可读格式。

#### Scenario: 本地时间
- **WHEN** 任务带有 ISO 创建时间
- **THEN** 列表 MUST 显示本地可读日期时间，MUST NOT 仅以未处理的长 ISO 串作为唯一时间文案

### Requirement: 任务列表页头具备标题
`/space/tasks` 页头 SHALL 包含可读 title（例如「编排任务」），MUST NOT 仅有 kicker 与描述。

#### Scenario: 页头有 title
- **WHEN** 用户打开 `/space/tasks`
- **THEN** 页头 MUST 显示可读标题

### Requirement: 多通道详情共用页头与合约侧栏契约
RWS/L4 任务详情、MDOP 作业详情与 SecretFlow 联邦详情 SHALL 使用同一浏览页头信息契约：显示标题（与列表同一套 displayTitle 规则）、通道、归一状态、发起方、创建时间；合约引用区 SHALL 提供可读摘要，MUST NOT 仅以超长合约 id 作为唯一主文案。

#### Scenario: MDOP 详情标题与列表一致
- **WHEN** 同一 MDOP 作业出现在任务列表且用户打开其详情
- **THEN** 详情页头标题 MUST 与列表主标题使用同一 displayTitle 规则

#### Scenario: 合约侧栏可读
- **WHEN** 详情展示合约引用且能解析到合约目的或产品标题
- **THEN** 侧栏 MUST 显示可读摘要；合约 id MAY 作为次要提示

### Requirement: 旧通道历史任务可识别
对已迁移分析类型、仅作为只读历史保留的旧编排任务，统一任务列表 SHALL 提供可识别的历史标记，避免与现行 MDOP 作业在扫读上无法区分。

#### Scenario: 历史标记可见
- **WHEN** 列表中存在迁移前旧通道产生的 L1.5/L4 类只读任务
- **THEN** 该行 MUST 带有「历史」或登记的等价标记
