# external-control Specification

## Purpose
TBD - created by archiving change external-control-arm. Update Purpose after archive.
## Requirements
### Requirement: 外部对照匹配必须在节点内完成
系统 SHALL 在可信空间节点内，把申办方单臂试验受试者与医院历史对照按关联假名逐人匹配：

- 匹配为**同层（年龄×性别）+ 索引日窗口（|Δ| ≤ caliperDays）**的确定性 1:k 匹配；
- 匹配 MUST 在节点内完成，MUST NOT 由任一参与方单独执行（申办方无医院病例，医院无试验数据）；
- 被匹配的对照 MUST 被消耗（同一对照 MUST NOT 匹配多名受试者）。

#### Scenario: caliper 边界
- **WHEN** 某对照索引日与受试者相差恰为 caliperDays
- **THEN** 该对照 MUST 可被匹配
- **WHEN** 相差 caliperDays + 1
- **THEN** 该对照 MUST NOT 被匹配给该受试者

#### Scenario: 对照消耗
- **WHEN** 一名对照已被某受试者匹配
- **THEN** 该对照 MUST NOT 再匹配后续受试者

### Requirement: 排序契约与拒绝语义
宿主 SHALL 按约定排序供数，模块 SHALL 校验并 fail-closed：

- 两侧均按「分层不降、同层索引日不降」排序；违反时模块 MUST 返回 6（拒绝），MUST NOT 输出悄悄算错的结果；
- 分层编号越界返回 3；caliper<0、ratioK<1、结局非 0/1 返回 5。

#### Scenario: 宿主未排序
- **WHEN** 任一侧同层索引日倒序
- **THEN** 模块 MUST 返回 6，本阶段失败

### Requirement: 计数不变量与不可估呈现
- 每层 MUST 满足：匹配+未匹配=该层受试者数；匹配试验组阳+阴=matched；对照阳+阴 ≤ k×matched；
- 估计（RR/RD + 95% CI）在 matched=0、对照=0 或任一侧零事件时 MUST 呈现「不可估计」，MUST NOT 显示 0 或 ∞；
- 发布审查按 min(matched, 对照人数) 与 minCell 比较，偏小整层抑制。

#### Scenario: 负例层如实呈现
- **WHEN** 某层注入无差异（RR_true = 1）且估计 CI 覆盖 1
- **THEN** 结果 MUST 如实呈现 CI 覆盖 1，MUST NOT 硬造显著

### Requirement: 两方最小投影
- 申办方投影 `sponsor-trial` 与医院投影 `hospital-controls` SHALL 只封
  `{subjectKey: linkKey, ageBand, sex, indexDate, outcome}`；
- 索引日缺失或结局 ∉ {pos, neg} 的行 MUST NOT 出机构；身份标识与白名单外字段 MUST NOT 出现；
- 答案键与任何参考计算 MUST 按投影后形状（subjectKey := linkKey）计算（同日并列的排序决胜一致）。

#### Scenario: 结局缺失的行不出院
- **WHEN** 医院侧某历史病例缺 `outcome` 或 `indexDate`
- **THEN** 该行 MUST NOT 进入 `hospital-controls` 投影（不出机构），且 MUST NOT 计入任何一侧计数

#### Scenario: 参考计算用错形状
- **WHEN** 答案键按院内假名（subjectKey = hos-…）而非投影形状（subjectKey = linkKey）计算同日并列对照的顺序
- **THEN** 与节点输出的对拍 MUST 失败（暴露而非掩盖）——这是 D2 决策固化的校验点

