## Why

TC609-6-2025-16 基础级评测项 6.3「数据服务目录管理」在代码核查中判为 ❌ 未实现：全库无
"数据服务"概念，只有数据产品目录（且无更新/下架）。这是整改计划（`docs/TC609-6-2025-16-整改计划.md`）
P0-2 的硬缺口。

## What Changes

- `cp_data_product` 增加 `productType`（`'data' | 'service'`，默认 `data`）——倾向前者方案：
  服务目录复用发布/申请/合约全链路，仅在目录层按类型区分（避免新建一套 service catalog 表）。
- 发布端点支持 `productType`；目录查询按类型过滤（`GET /catalog?type=service`）。
- Web 目录页区分「数据产品 / 数据服务」两个 tab；发布按钮增加类型选择。
- 同步 `DOMAIN.md` 目录与数据产品小节，登记 `productType` 状态词汇。

## Capabilities

### New Capabilities
- `data-service-catalog`: 数据产品与数据服务在统一目录下按 `productType` 区分，
  服务类产品可走发布 → 申请 → 合约全流程，目录可按类型分别出示两个列表。

### Modified Capabilities
- `data-product`（既有）：`DataProduct` 增加 `productType` 字段与按类型过滤的 `list`。

## Impact

- **Code:** `packages/database/src/control-plane/index.ts`（`DataProduct.productType`）、
  `apps/api/src/runtime/catalog/*`（service/controller/dto）、`apps/web`（catalog page + publish button + api client）。
- **Data:** `cp_data_product` 新增 `productType` 列（默认 `data`，向后兼容存量行）。
- **APIs:** `POST /catalog` 接受 `productType`；`GET /catalog?type=data|service` 过滤。
- **Risk:** 低。存量行缺省 `data`，不影响既有数据产品；过滤参数可选，不破坏现有调用。
