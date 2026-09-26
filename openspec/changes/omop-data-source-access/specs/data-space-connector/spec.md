## MODIFIED Requirements

### Requirement: 本地数据网关与脱敏
连接器 SHALL 通过适配层接入参与方源系统,并在数据进入计算前于本地完成脱敏(去标识)。适配层 SHALL 支持两类数据源:**FHIR/文件**(映射为内部统一模型后存入本地存储)与 **OMOP CDM 数据库**(经医院提供的视图层只读接入,按查询取用而非全量拉取)。数据源类型 MUST 在配置中显式声明,连接器按类型分派,MUST NOT 在某一类不可用时静默改用另一类。

#### Scenario: FHIR 接入
- **WHEN** 连接器从医院 HIS/FHIR 端点拉取数据
- **THEN** 连接器 MUST 将其映射为内部统一模型并存入本地存储

#### Scenario: CDM 数据库接入
- **WHEN** 连接器接入一个 OMOP CDM 数据源
- **THEN** 连接器 MUST 仅通过医院提供的视图层读取,且 MUST NOT 将 CDM 表全量拉取到本地——取用的列与行 MUST 限于该次分析所需

#### Scenario: 数据源类型不得静默切换
- **WHEN** 已声明为 CDM 数据源的数据产品，其数据源不可用或接入校验未通过
- **THEN** 任务 MUST 失败,连接器 MUST NOT 改用本地文件数据执行

#### Scenario: 计算前脱敏
- **WHEN** 一个计算任务即将在连接器本地执行
- **THEN** 参与计算的数据 MUST 已完成直接标识符去除/脱敏

## ADDED Requirements

### Requirement: 连接器是院内数据访问的唯一出口
院内数据源的访问凭据与连接 MUST 只由连接器持有。算法模块与本院其它执行体 MUST NOT 直接访问数据源；它们所需的数据 MUST 经连接器读取、投影并过闸后提供。

#### Scenario: 单一数据入口
- **WHEN** 院内任一执行体（算法模块 / 联邦训练 agent）需要数据
- **THEN** 该数据 MUST 由连接器提供，系统 MUST NOT 为其配置第二套数据源凭据

#### Scenario: 数据访问与守卫同进程边界
- **WHEN** 数据被读取并送入计算
- **THEN** 该读取 MUST 发生在承载 PEP、输出闸门与审计链的连接器进程边界内，使闸门无法被绕过
