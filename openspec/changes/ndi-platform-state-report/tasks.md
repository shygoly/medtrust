# Tasks

- [x] 平台侧连接器状态聚合：复用 `ConnectorAdminService.listRegistry`，离线阈值缺省 3 × 心跳周期（`DEFAULT_CONNECTOR_OFFLINE_MS=180_000`，可配置）
- [x] 对外聚合快照：`{connectorId, ndiId, status, lastSeenAt, version, load}`，供上报告与系统状态页共用（`GET /admin/interop/region-reporting/snapshot`，与上报告同源）
- [x] 新增 `runtime/region-reporting`：`NoopRegionStateReporter` / `HttpRegionStateReporter`（单次 ≤5s），未配置时 `unconfigured`
- [x] 上报周期 `REGION_STATE_REPORT_INTERVAL_MS`（缺省 5000，钳制 1s–300s）；DEPLOY.md 登记待补
- [x] 载荷：平台自身状态 + 连接器聚合快照 + 空间标识（NDI 编码，draft-1 空间→业务节点）；鉴权仍随接口文档到位后接（对拍表 §4）
- [x] `GET /admin/interop/region-reporting/status` + `POST /report`（operator/admin）
- [x] 连接器心跳载荷补 `connectorId` 与 NDI 标识（机构码缺省即省略；平台侧心跳字段同批入库，快照优先采用心跳自报值）
- [x] 文档：注册单元 = 平台（业务节点）；医院侧节点为空间内部节点，不单独注册为接入连接器（差距文档 §3.1 已有，本次在 C6/§2 交叉引用）
- [x] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §1 C6 与 §2 平台行
- [x] 明确不得把「区域节点未配置」表述为「已上报区域节点」（差距文档 §3 表述口径硬规则 + 状态接口 `regionReporting=unconfigured`）

## 离线可用性（必过）

- [x] 装配 `NoopRegionReporter`（缺 endpoint 时），只 warn、不抛、不计错误率
- [x] 上报循环独立定时器 + 单次 ≤5s 超时 + 退避熔断（指数退避上限 60s，窗口内定时器跳过、手动 `POST /report` 强制）
- [ ] 压测：真实区域节点联调时确认上报循环不影响长轮询领任务（当前只有单测，无外部节点可压）
- [x] API 启动在外部未配置时正常完成（只 warning）
- [x] 用例：未配置 → noop 且无外部调用；500 → 记录失败；`reportNow` 不抛（7 条）
