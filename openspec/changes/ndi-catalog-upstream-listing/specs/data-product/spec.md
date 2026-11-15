# Spec Delta

## ADDED Requirements

### Requirement: 上架范围与公开授权留痕

数据产品 SHALL 有上架范围（`internal` 缺省 / `regional` 显式公开）。
转为 `regional` MUST 具备公开授权留痕：授权主体、授权时间、授权依据；签名 MAY 选填。
缺授权留痕 MUST 拒绝转 `regional`。

#### Scenario: 缺授权不能公开
- **WHEN** 发布或更新把 `listingScope` 置为 `regional` 但未给 `listingConsent`
- **THEN** 控制面 MUST 拒绝该请求

#### Scenario: 授权留痕可录入
- **WHEN** 提供方在目录管理页选择 `regional`
- **THEN** 表单 MUST 要求授权主体与依据，并允许录入签名；授权时间由系统冻结

### Requirement: 服务类产品的规格与规模口径

`productType=service` 的产品 MUST 具备服务规格（统计口径、最小样本、闸门），
且 MUST NOT 用 `recordCount` 表达规模。存量服务产品缺少规格时，普通字段更新 MUST 不被误拒（grandfather）。

#### Scenario: 服务缺规格被拒
- **WHEN** 新建服务产品但未给 `serviceSpec`
- **THEN** 控制面 MUST 拒绝

#### Scenario: 存量服务可更新
- **WHEN** 存量服务产品没有 `serviceSpec`，本次更新不涉及服务规格、也不转 `regional`
- **THEN** 更新 MUST 被允许

### Requirement: 目录上报只含元数据与显式公开项

目录上报 MUST 只取 `listingScope=regional` 且在架的产品；
报文 MUST 只含元数据（标识、标题、类型、分级、字段清单、内部提供方 slug），
MUST NOT 含计算结果、数据行或机构登记名。机构码未配置时 MUST fail-closed，不回退内部 URN。

#### Scenario: 默认不外发
- **WHEN** 产品仍为 `internal`（缺省）
- **THEN** 目录上报 MUST NOT 包含该产品

#### Scenario: 缺机构码 fail-closed
- **WHEN** `NDI_ORG_CODE` 未配置
- **THEN** 上报 MUST 失败并给出明确原因，MUST NOT 用内部 URN 充当对外标识

### Requirement: 分类型推送与幂等台账

目录上报 SHALL 按对象类型分派（产品 / 服务），并以 `spaceId + ndiId + 版本` 作为幂等键：
重复推送 MUST 只更新既有台账行，MUST NOT 产生重复条目。
推送台账 MUST 记录尝试次数、状态与最近失败原因，并可按最近更新查询。

#### Scenario: 重复推送
- **WHEN** 对同一产品连续推送两次
- **THEN** 台账行数 MUST 不增加，第二次只更新尝试次数与状态

#### Scenario: 失败可查
- **WHEN** 节点返回错误
- **THEN** 台账 MUST 记 `failed` 与失败原因；本地目录 MUST 保持不变

### Requirement: 本地状态先于外发

推送 MUST 先把本地台账置为 `pending`，再调用外部节点；
外部失败 MUST NOT 回滚本地目录，也 MUST NOT 影响发布/更新操作。

#### Scenario: 顺序
- **WHEN** 触发目录推送
- **THEN** 本地台账写入 MUST 早于外部请求发出

#### Scenario: 失败不影响本地
- **WHEN** 外部推送失败
- **THEN** 产品仍按本地状态可查、可更新
