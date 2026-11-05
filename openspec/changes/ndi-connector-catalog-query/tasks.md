# Tasks

- [ ] 取 NDI-TR-2025-06 正式字典，确认数据资源/数据产品字段清单（06 附录表 A.3）
- [ ] 新增 `GET /connector/catalog/products`（分页检索，参数白名单）与 `GET /connector/catalog/products/:id`（详情）
- [ ] 响应 DTO 字段白名单：标识、标题、类型、分级、数量级、字段清单、驻留位置、可用状态；断言无数据行
- [ ] 精确记录数改为数量级（如 `1k-5k`），避免元数据反推
- [ ] 复用证书鉴权（`tc609-p1-connector-cert-auth`），叠加对端标识白名单；未鉴权 401
- [ ] `CONNECTOR_CATALOG_SERVICE` 开关（默认 off），关闭时不注册路由
- [ ] 明确部署边界：仅院内内网可达，`5022` 不得发布到院内网之外（写入 `docs/医院连接器独立部署准备.md`）
- [ ] 标识与字段字典接 `ndi-identifier-alignment`
- [ ] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §1 C7/C9/C14 判定与证据

## 离线可用性（必过）

- [ ] 默认 `CONNECTOR_CATALOG_SERVICE=off`，关闭时路由 404（用例断言）
- [ ] 部署检查项：`5022` 不发布到院内网之外（compose/fly 配置核对）
- [ ] 鉴权失败 401，不回退匿名只读（负向用例）
