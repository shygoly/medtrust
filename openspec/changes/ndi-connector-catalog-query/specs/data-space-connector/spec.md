# Spec Delta

## ADDED Requirements

### Requirement: 连接器只读目录服务

连接器 SHALL 提供只读的数据产品目录检索与详情接口（NDI-TR-2025-05 §6.3.4 / §7.2）：
`GET /connector/catalog/products`（关键词 + 分页）与 `GET /connector/catalog/products/:id`。
检索参数 MUST 限定在白名单内（`q` / `limit` / `offset`），MUST NOT 接受任意表达式或字段投影。

#### Scenario: 登记对端检索到产品
- **WHEN** 目录服务已开启，且请求方令牌有效、`participantId` 在白名单内
- **THEN** 列表 MUST 返回该院可披露产品的元数据条目，并给出总数与分页结果

#### Scenario: 详情按产品标识返回
- **WHEN** 请求方查询本院存在的产品 id
- **THEN** MUST 返回该产品的元数据详情；产品不存在时 MUST 返回 404

#### Scenario: 分页被钳制
- **WHEN** 请求传入 `limit=0` 或 `limit` 超过上限
- **THEN** 服务 MUST 钳制到 `[1, 100]`，MUST NOT 因参数异常返回全量或 500

### Requirement: 目录只回元数据

目录响应 SHALL 只包含字段白名单：产品标识、提供方标识、标题、`profile`、字段清单；
MUST NOT 返回数据行、原始字段值或精确记录数（规模不得通过目录泄露）。

#### Scenario: 响应不含数据行与精确行数
- **WHEN** 产品的元数据登记了 `recordCount` 与行级样本字段
- **THEN** 序列化后的响应 MUST NOT 出现这些值或字段名，且字段清单只保留 `name/type/description`

#### Scenario: 无可用标识时不伪造 NDI 标识
- **WHEN** 平台尚未接入 NDI 标识（`ndi-identifier-alignment` 未落地）
- **THEN** 目录 MUST 继续使用内部产品标识，MUST NOT 编造 `ndi:` 前缀标识

### Requirement: 目录服务缺省关闭

`CONNECTOR_CATALOG_SERVICE` 缺省 MUST 为 off；关闭时目录路由 MUST 表现为 404，
MUST NOT 暴露「接口存在但未启用」的 401/403 语义，也 MUST NOT 影响既有任务链路启动。

#### Scenario: 关闭时路由 404
- **WHEN** `CONNECTOR_CATALOG_SERVICE` 未设置或为 `off`
- **THEN** 目录路由 MUST 返回 404

#### Scenario: 缺配置不阻塞启动
- **WHEN** 开关与对端白名单均未配置
- **THEN** 连接器 MUST 正常启动，目录服务仅处于关闭状态

### Requirement: 目录鉴权失败不降级

目录端点 SHALL 复用连接器令牌守卫：未配置令牌、令牌缺失或错误 MUST 返回 401；
对端未在 `CONNECTOR_CATALOG_PEERS` 白名单内 MUST 返回 403。
任一失败 MUST NOT 回退为匿名只读。

#### Scenario: 未配置令牌
- **WHEN** `CONNECTOR_PULL_TOKEN` 未配置且调用方携带任意令牌
- **THEN** MUST 返回 401（不存在缺省口令）

#### Scenario: 未登记对端
- **WHEN** 令牌有效但 `participantId` 不在白名单内
- **THEN** MUST 返回 403

### Requirement: 目录服务的部署边界

目录服务 MUST NOT 扩大连接器的入站暴露面：`5022` MUST NOT 发布到院内网之外，
开启目录服务 MUST NOT 新增端口或入站规则。

#### Scenario: 院内生产部署
- **WHEN** 按院内生产加固配置部署（`deploy/ali29/compose.hardening.yaml`）
- **THEN** 连接器 MUST NOT 向宿主发布端口，目录服务仍只经院内网络访问

#### Scenario: 参考配置不得当作生产模板
- **WHEN** 使用公开端口的云端参考配置（`fly-services/connector/fly.toml`）
- **THEN** 该配置 MUST 显式关闭目录服务，并标注只用于本地/演示
