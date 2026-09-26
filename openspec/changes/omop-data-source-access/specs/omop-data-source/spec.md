## ADDED Requirements

### Requirement: 数据库句柄由连接器独占
数据库连接 MUST 只由连接器进程持有。算法模块（Wasm）MUST NOT 获得任何数据访问接口——其导入面 MUST 保持「仅一块宿主提供的有上限内存」；本院其它执行体（如联邦训练 agent）MUST NOT 另行建立到数据源的连接，其所需数据 MUST 由连接器投影后提供。

#### Scenario: Wasm 模块不得获得数据访问接口
- **WHEN** 一个算法模块声明了除宿主内存之外的任何导入（包括数据查询接口）
- **THEN** 静态白名单校验 MUST 失败，模块被拒，且不回退到内置实现

#### Scenario: 其它执行体不得自建连接
- **WHEN** 联邦训练执行体需要院内数据
- **THEN** 数据 MUST 经连接器读取并投影后提供，系统 MUST NOT 为该执行体单独配置数据源凭据

### Requirement: 视图接入契约与双权限域
医院侧 SHALL 以**视图层**向连接器提供 CDM 数据：底表所在 schema MUST NOT 对连接器账号授权；视图 schema 中的视图 MUST 与 CDM 表同名同结构，且 MUST NOT 包含直接标识列。连接器账号的权限 MUST 恰为两个域——CDM 视图**只读**、`results` schema **可建表可写**。仅授予只读权限 MUST 被判定为契约不满足。

#### Scenario: 底表不可达
- **WHEN** 连接器账号尝试读取底表 schema 中的任何表
- **THEN** 数据库 MUST 拒绝该访问，直接标识列对连接器不可达

#### Scenario: 视图不可写
- **WHEN** 连接器账号尝试对 CDM 视图执行写操作
- **THEN** 数据库 MUST 拒绝该操作

#### Scenario: results schema 必须可写
- **WHEN** 接入校验检查 `results` schema 的建表权限
- **THEN** 若不可建表，校验 MUST 失败并明确指出「队列定义需要 results 写权限，纯只读账号不满足契约」

#### Scenario: 医院可单方面切断
- **WHEN** 医院 DBA 撤销连接器账号对视图的权限
- **THEN** 连接器后续查询 MUST 失败，该切断 MUST NOT 依赖平台侧任何配合动作

### Requirement: 三参数配置，不反射表结构
连接器 SHALL 以 `cdmVersion`、schema 名（cdm / vocabulary / results）、`dbms` 方言三项配置定位并生成查询，MUST NOT 依赖对数据库表结构的反射探测。CDM 表结构 SHALL 按 OMOP CDM 规范视为先验已知。

#### Scenario: 不探测表结构即可生成查询
- **WHEN** 连接器为某分析类型生成 CDM 查询
- **THEN** 生成过程 MUST 只依赖上述三项配置与 CDM 规范，MUST NOT 查询 `information_schema` 等结构元数据来决定字段名

#### Scenario: 语义版本必须从库中读取并留痕
- **WHEN** 连接器接入一个数据源
- **THEN** 连接器 MUST 读取 `cdm_source.cdm_version` 与 `vocabulary.vocabulary_version` 并随该数据源与其产出结果一并留痕（`concept_id` 语义依赖词汇表版本）

### Requirement: 投影下推到 SQL
CDM 数据源的最小列投影 SHALL 在 SQL 中完成：连接器 MUST NOT 先把 CDM 表拉进本地再在内存中筛列筛行。查询取回的结果 SHALL 已是该次分析所需的最小列集合，并在此形态上接入既有沙箱投影与输出闸门链路。

#### Scenario: 投影在 SQL 里而非内存里
- **WHEN** 连接器为某分析类型从 CDM 数据源取数
- **THEN** 列裁剪与行过滤 MUST 由 SQL 完成，取回的结果 MUST NOT 包含该次分析不需要的列

#### Scenario: 不得全量拉取
- **WHEN** CDM 表规模达到千万行级
- **THEN** 连接器 MUST NOT 以全表拉取方式取数（该做法既违反数据最小化，工程上亦不可行）

#### Scenario: 汇入既有沙箱链路
- **WHEN** SQL 投影结果送入算法模块
- **THEN** 其 MUST 以既有投影载荷形态（最小整数列）进入沙箱，算法模块的零导入判据 MUST NOT 因数据源类型而改变

### Requirement: 接入一致性校验 fail-closed
数据源在被任何合约引用之前 MUST 通过接入校验：必需 CDM 表（视图）存在、视图不含直接标识列、权限边界符合双权限域、`cdm_source` 与 `vocabulary_version` 可读。任一项不满足 MUST 拒绝接入，且 MUST NOT 降级回退到文件数据源。

#### Scenario: 校验不过即拒绝接入
- **WHEN** 某数据源的视图缺少必需的 CDM 表，或视图中出现直接标识列
- **THEN** 接入校验 MUST 失败，该数据源 MUST NOT 进入可用状态

#### Scenario: 不得静默降级
- **WHEN** 数据源配置存在但校验未通过
- **THEN** 系统 MUST NOT 改用本地文件数据执行任务（否则医院会以为跑的是库里的数据）

#### Scenario: 权限不足与契约不成立需可区分
- **WHEN** 校验因权限被拒而失败
- **THEN** 错误信息 MUST 指明是哪一个权限域不满足，以便医院 DBA 定位

### Requirement: 数据库凭据不出连接器
数据源凭据 MUST 只存在于连接器侧配置，MUST NOT 出现在控制面存储、任务派发载荷、结果回传载荷或审计明文中。

#### Scenario: 控制面不持有院内库凭据
- **WHEN** 检查控制面存储与任务派发内容
- **THEN** 其中 MUST NOT 含有任何数据源连接串或账号口令

### Requirement: SQL 执行通道与方言抽象
连接器 SHALL 提供参数化 SQL 的执行通道，并 SHALL 以方言抽象隔离不同 DBMS。未实现的方言 MUST 在配置或接入校验阶段明确报错，MUST NOT 以近似方言替代执行。

#### Scenario: 未实现方言明确拒绝
- **WHEN** 数据源声明了尚未实现的 `dbms` 方言
- **THEN** 系统 MUST 拒绝接入并说明该方言未实现，MUST NOT 用其它方言的 SQL 尝试执行

#### Scenario: 参数化执行不拼接不可信输入
- **WHEN** 执行带参数的 CDM 查询
- **THEN** 参数 MUST 以参数化方式传入或经白名单校验后代入，MUST NOT 由外部输入直接拼接成 SQL 文本

### Requirement: results schema 中间结果留存治理
写入 `results` schema 的中间结果 MUST 纳入留存约束：任务结束后 SHALL 按合约留存条款清理。接入校验 SHALL 确认该 schema 具备清理所需权限。

#### Scenario: 任务结束清理中间结果
- **WHEN** 一个使用了 `results` schema 的任务结束
- **THEN** 连接器 MUST 按留存条款清理其写入的中间结果，不在医院库中无限堆积
