## Purpose

定义连接器对空间提供的一等对象——数据产品（元数据、schema、分级分类、确权状态、质量描述），其原始数据始终留在连接器本地。目录只登记元数据，RWS 输出亦按数据产品管理。对齐《可信数据空间 技术架构》连接器「数据产品管理」功能。
## Requirements
### Requirement: 连接器对外提供数据产品而非裸数据集
连接器对空间提供的 SHALL 是数据产品(data product),而非可直接读取的原始数据集。数据产品 MUST 包含元数据(标题、schema、分级分类、确权状态、质量描述),其原始数据留在连接器本地(对齐《可信数据空间 技术架构》连接器"数据产品管理"功能)。

#### Scenario: 目录只登记数据产品元数据
- **WHEN** 数据提供方将一份数据发布到空间
- **THEN** 中心目录 MUST 只登记其数据产品元数据,不登记任何原始行级数据

#### Scenario: 未确权/未分类不可发布
- **WHEN** 一份数据产品缺少确权或分级分类标签
- **THEN** 系统 MUST 拒绝其发布到目录

### Requirement: RWS 输出作为数据产品管理
RWS 任务通过输出闸门的聚合结果 SHALL 作为数据产品交付给使用方,并 MUST 关联其来源数字合约与存证记录。

#### Scenario: 聚合结果可溯源
- **WHEN** 使用方获取一份 RWS 聚合结果
- **THEN** 该结果 MUST 可关联到授权它的数字合约哈希与上链存证

### Requirement: 在架目录列表顺序稳定
控制面数据产品目录列表 SHALL 按稳定键排序返回；默认 MUST 为最近更新优先，并以产品 id 作为并列次序键。客户端 MUST NOT 依赖数据库默认物理顺序。

#### Scenario: 两次列表次序一致
- **WHEN** 在同一空间、同一过滤条件下连续两次请求在架目录列表且中间无写入
- **THEN** 两次返回的产品 id 序列 MUST 相同

#### Scenario: 更新后上浮
- **WHEN** 提供方更新某一在架产品并再次打开目录列表
- **THEN** 该产品 MUST 按其新的更新时间参与排序

### Requirement: 目录浏览数据源摘要口径一致
在架目录列表与数据产品详情的数据源/类型摘要 SHALL 使用同一套基于已登记元数据的推导规则，MUST NOT 读取原始行级数据。存在可识别的 CDM `dataSource`、`resourceType` 或服务规格时，任一表面 MUST NOT 显示「未声明」。

#### Scenario: 列表上 ImagingStudy 有摘要
- **WHEN** 使用方在目录列表看到 `fhirSchema.resourceType` 为 `ImagingStudy` 的产品（如肾活检病理全切片影像）
- **THEN** 该行 MUST 显示影像/ImagingStudy 类摘要

#### Scenario: 详情上 ImagingStudy 不误报未声明
- **WHEN** 使用方打开同一 ImagingStudy 产品的详情
- **THEN** 数据源行 MUST 显示同类影像摘要，MUST NOT 显示「未声明」

#### Scenario: 列表与详情文案口径一致
- **WHEN** 同一在架产品同时出现在列表与详情
- **THEN** 两侧数据源摘要 MUST 属于同一规则闭集（允许详情更冗长，但不得一个有类型、一个报未声明）

#### Scenario: CDM 摘要与覆盖可并存
- **WHEN** 产品声明 `dataSource.type` 为 `omop-cdm`
- **THEN** 列表与详情 MUST 显示 OMOP CDM 摘要；覆盖元数据可以同屏呈现，但 MUST NOT 替代摘要义务

#### Scenario: 真正缺少声明时可识别
- **WHEN** 产品既无 dataSource、也无 resourceType、也非可识别服务规格
- **THEN** 列表与详情 MUST 以明确的未声明类文案提示

### Requirement: 目录浏览提供方显示名
目录列表与详情的提供方呈现 SHALL 以参与方登记显示名为主文案；MUST NOT 将前端演示硬编码表作为唯一名称来源。登记名不可用时 MAY 回退为 `providerId`；详情 MUST 仍能核对原始 id。

#### Scenario: 列表有登记名时主文案为机构名
- **WHEN** 提供方已有登记机构名称且产品出现在目录列表
- **THEN** 列表主文案 MUST 显示该机构名称

#### Scenario: 详情有登记名时主文案为机构名
- **WHEN** 用户打开同一产品详情
- **THEN** 提供方主文案 MUST 为该机构名称

#### Scenario: 无登记名时回退
- **WHEN** 无法解析提供方显示名
- **THEN** 列表与详情 MUST 回退显示 `providerId`，且 MUST NOT 因解析失败而隐藏整行或整页关键字段

### Requirement: 目录浏览分级优先结构化标签
列表分级徽章与详情分级字段 SHALL 优先根据 `classificationTag` 映射为统一可读文案；仅当标签缺失时 MUST 回退 `classification` 自由文本。详情 MUST NOT 让英文 `level/code/version` 拼串成为唯一可读形式。

#### Scenario: 有 classificationTag
- **WHEN** 产品带有 `classificationTag.level` 与 `categoryCode`
- **THEN** 列表徽章与详情分级 MUST 按标签映射呈现

#### Scenario: 仅有自由文本
- **WHEN** 产品没有 `classificationTag` 但有 `classification`
- **THEN** 列表与详情 MUST 显示该自由文本

### Requirement: 目录浏览规模文案区分口径
列表与详情的规模展示 SHALL 使用同一口径：服务用容量，CDM 在有人数数量级时用人数量级，其它数据产品用行数，并带可区分单位。

#### Scenario: 普通数据产品显示行数
- **WHEN** 非服务、非 CDM 人数口径的产品 `recordCount` 为 12640
- **THEN** 列表与详情规模文案 MUST 带「行」单位，MUST NOT 标成「人」或「容量」

#### Scenario: 数据服务显示容量
- **WHEN** `productType` 为 `service`
- **THEN** 列表与详情规模文案 MUST 使用服务容量口径，MUST NOT 用 `recordCount` 冒充行数

### Requirement: 默认在架目录不展示恒真确权徽章
当目录列表查询条件已限制为仅返回已确权在架产品时，列表行 SHALL NOT 再展示「已确权」徽章。仅当结果集可能包含未确权或非在架产品时，列表 MAY 展示确权状态徽章。详情页仍可展示确权字段。

#### Scenario: 默认数据产品目录无确权 chip
- **WHEN** 使用方打开默认的数据产品目录（仅在架且已确权）
- **THEN** 列表行 MUST NOT 显示「已确权」徽章

#### Scenario: 含未确权结果时可见
- **WHEN** 打开可能包含未确权产品的目录视图
- **THEN** 未确权行 MUST 能通过徽章或等价状态提示被区分

### Requirement: 目录列表不把 UUID 产品 id 当作主浏览文案
目录列表主列 SHALL NOT 默认展示完整 UUID 形态的产品 `id`。可读短 id MAY 作为次要提示；完整 id 与 URN 的权威展示保留在详情。

#### Scenario: UUID 产品不刷屏
- **WHEN** 产品 `id` 为 UUID 形态且出现在目录列表
- **THEN** 列表主列 MUST NOT 以完整 UUID 作为提供方旁的默认副文案

#### Scenario: 详情仍可核对标识
- **WHEN** 使用方打开该产品详情
- **THEN** 详情 MUST 仍能展示 `id` 与 `urn`

### Requirement: 详情页状态与上架范围可读
详情页的产品状态与上架范围 SHALL 以登记过的可读标签呈现，MUST NOT 仅输出未解释的英文枚举码作为唯一文案。

#### Scenario: 在架状态可读
- **WHEN** 产品 `status` 为 `active`
- **THEN** 详情状态字段 MUST 显示可读标签（例如「在架」）

#### Scenario: 本空间上架范围可读
- **WHEN** 产品 `listingScope` 为 `internal`
- **THEN** 上架范围字段 MUST 显示可读标签（例如「本空间」）

### Requirement: 详情页空元数据不制造噪音
当 `productRoles`、`provenance` 等可选元数据为空时，详情页 SHALL NOT 以成组的空「—」行作为默认主信息架构的固定占位；空信息 MUST 省略或放入次要/折叠区域。

#### Scenario: 无角色与 provenance 时主面板精简
- **WHEN** 产品 `productRoles` 为空且无 `provenance`
- **THEN** 详情主信息区 MUST NOT 同时固定展示「角色标签 —」与「参与方区间 —」两行空占位

### Requirement: 详情字段契约使用控制台表格组件
非服务类数据产品详情中的字段契约列表 SHALL 使用控制台设计系统的表格组件呈现，SHALL NOT 使用未纳入设计系统的裸 HTML `<table>` 作为最终实现。

#### Scenario: 有 fields 时用登记表格
- **WHEN** 产品 `fhirSchema.fields` 非空且用户打开详情
- **THEN** 字段列表 MUST 以控制台表格样式呈现（如 `DataGrid`），背景与文字来自 `--cs-*` 令牌

### Requirement: 详情可核对空间与时间元数据
数据产品详情 SHALL 能核对所属空间与创建/更新时间（若实体已有对应字段）。时间显示 MUST 使用本地可读格式，对齐控制台日期约定。

#### Scenario: 展示空间与时间
- **WHEN** 用户打开含 `homeSpace` 与时间戳的产品详情
- **THEN** 详情 MUST 呈现所属空间标识，并呈现至少一处创建或更新时间的本地可读时间

