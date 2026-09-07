# data-service-catalog

数据产品目录与数据服务目录在同一目录下按 `productType` 区分，服务类产品复用发布/申请/合约全链路。

## ADDED Requirements

### Requirement: 产品类型区分
数据产品记录 SHALL 携带 `productType`（`data` | `service`），缺省为 `data`。

#### Scenario: 发布服务类产品
- **WHEN** provider 以 `productType=service` 发布目录项
- **THEN** 该目录项 `productType` 为 `service`，且可被 `GET /catalog?type=service` 检索到。

#### Scenario: 存量数据产品缺省类型
- **WHEN** 发布时未指定 `productType`
- **THEN** 该目录项 `productType` 为 `data`。

### Requirement: 按类型出示目录
系统 SHALL 支持按 `productType` 过滤目录，分别出示「数据产品目录」与「数据服务目录」两个列表。

#### Scenario: 过滤数据服务
- **WHEN** 调用 `GET /catalog?type=service`
- **THEN** 仅返回 `productType=service` 的目录项，不返回数据产品项。

#### Scenario: 服务类产品走合约全流程
- **WHEN** 消费方对 `productType=service` 的目录项发起申请
- **THEN** 该申请复用数字合约 draft → approve 全链路，与服务产品同构。
