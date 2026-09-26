## ADDED Requirements

### Requirement: CDM 数据产品的覆盖元数据由库内统计自动产出
基于 OMOP CDM 数据源的数据产品，其覆盖元数据（CDM 版本、词汇表版本、含数据的表、时间跨度、记录数量级）SHALL 由连接器从数据源统计产出并上报，MUST NOT 仅依赖人工填报。上报内容 MUST 是统计量，MUST NOT 包含任何行级数据。

#### Scenario: 覆盖元数据自动产出
- **WHEN** 一个 CDM 数据源通过接入校验
- **THEN** 连接器 MUST 产出并上报其 CDM 版本、词汇表版本、表覆盖与时间跨度，目录据此登记

#### Scenario: 上报内容仍只是元数据
- **WHEN** 连接器上报覆盖元数据
- **THEN** 其中 MUST 只含统计量与版本标识，MUST NOT 含任何行级记录

#### Scenario: 词汇表版本随数据产品呈现
- **WHEN** 使用方查看一个 CDM 数据产品
- **THEN** 目录 MUST 呈现其词汇表版本（`concept_id` 语义依赖该版本，跨院比较时需可见）

#### Scenario: 元数据陈旧需可识别
- **WHEN** 数据源的 CDM 版本或词汇表版本发生变化
- **THEN** 目录登记的覆盖元数据 MUST 被更新或标记为待刷新，MUST NOT 以陈旧版本继续对外呈现
