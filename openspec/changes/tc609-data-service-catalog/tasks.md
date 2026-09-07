## 1. 实体

- [x] 1.1 `DataProduct` 增加 `productType`（`ProductType = 'data' | 'service'`，默认 `data`）。
- [x] 1.2 `pnpm --filter @medtrust/database build`。

## 2. 目录服务/控制器/DTO

- [x] 2.1 `catalog.service`：`publish` 接受 `productType`（缺省 `data`）；`list(productType?)` 按类型过滤。
- [x] 2.2 `catalog.controller`：`GET /catalog?type=data|service` 透传过滤。
- [x] 2.3 `publish-data-product.dto`：`productType` 字段（`@IsIn(['data','service'])`）。
- [x] 2.4 `catalog.service.spec.ts`：新增类型过滤用例。

## 3. Web

- [x] 3.1 `api/client.ts` `getDataAssets(type?)` 支持类型过滤。
- [x] 3.2 目录页增加「数据产品 / 数据服务」tab。
- [x] 3.3 发布按钮增加类型选择，payload 携带 `productType`。

## 4. 治理同步与验证

- [x] 4.1 `DOMAIN.md` 目录小节登记 `productType` 状态词汇。
- [x] 4.2 `node scripts/check-meta-docs.mjs` 无新增 [ERR]。
- [x] 4.3 `openspec validate tc609-data-service-catalog` 通过。
- [ ] 4.4 更新差距矩阵 6.3 数据服务目录状态（❌→✅）。
