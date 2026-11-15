# Tasks

- [ ] 取 NDI-TR-2025-06 正式字典，确认数据资源/数据产品字段清单（06 附录表 A.3）
      **阻塞**：正式文本未取得（仓内只有对拍表摘要）；未取得前不得按猜测字段映射送检
- [x] 新增 `GET /connector/catalog/products`（分页检索，`q/limit/offset`）与 `GET /connector/catalog/products/:id`（详情）
- [x] 字段白名单：`productId/providerId/title/profile/fields[]`；断言不含数据行与精确记录数
- [x] 不返回记录数（连接器侧无该数据，宁缺不假）
- [x] 复用 `ConnectorTokenGuard`（未配置令牌即 401）+ `CONNECTOR_CATALOG_PEERS` 对端白名单（403）
- [x] `CONNECTOR_CATALOG_SERVICE` 开关（默认 off），关闭时路由返回 404（用例）
- [x] 明确部署边界：仅院内内网可达，`5022` 不得发布到院内网之外（写入 `docs/医院连接器独立部署准备.md` §2.3 + 检查清单）
- [ ] 标识与字段字典接 `ndi-identifier-alignment`
      **阻塞**：依赖 `ndi-identifier-alignment` 的 `ndi_id`（其自身待 NDI-TR-2025-04 正式文本）；当前目录面只回内部 id，未冒充 NDI 标识
- [x] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §1 C7/C9/C14 判定与证据

## 离线可用性（必过）

- [x] 默认 `CONNECTOR_CATALOG_SERVICE=off`，关闭时路由 404（用例断言）
- [x] 部署检查项：`5022` 不发布到院内网之外（compose/fly 配置核对；`deploy/ali29/compose.hardening.yaml` `ports: !reset []`，参考 `fly.toml` 标为演示专用并关目录服务）
- [x] 鉴权失败 401，不回退匿名只读（负向用例）
