# Tasks

- [x] 平台侧连接器状态聚合：复用 `ConnectorAdminService.listRegistry`，离线阈值缺省 3 × 心跳周期（`DEFAULT_CONNECTOR_OFFLINE_MS=180_000`，可配置）
- [ ] 对外聚合快照：`{connectorId, ndiId, status, lastSeenAt, version, load}`，供上报告与系统状态页共用
- [x] 新增 `runtime/region-reporting`：`NoopRegionStateReporter` / `HttpRegionStateReporter`（单次 ≤5s），未配置时 `unconfigured`
- [x] 上报周期 `REGION_STATE_REPORT_INTERVAL_MS`（缺省 5000，钳制 1s–300s）；DEPLOY.md 登记待补
- [ ] 载荷：平台自身状态 + 连接器聚合快照 + 空间标识（NDI 编码）；鉴权随接口文档到位后接（对拍表 §4）
- [x] `GET /admin/interop/region-reporting/status` + `POST /report`（operator/admin）
- [ ] 连接器心跳载荷补 `connectorId` 的 NDI 标识（与 `ndi-identifier-alignment` 联合验收）
- [ ] 文档：注册单元 = 平台（业务节点）；医院侧节点为空间内部节点，不单独注册为接入连接器
- [ ] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §1 C6 与 §2 平台行
- [ ] 明确不得把「区域节点未配置」表述为「已上报区域节点」

## 离线可用性（必过）

- [ ] 装配 `NoopRegionReporter`（缺 endpoint 时），只 warn、不抛、不计错误率
- [ ] 上报循环独立定时器 + 单次 ≤5s 超时 + 退避熔断；压测确认不影响长轮询领任务
- [ ] API 启动在外部未配置时正常完成（只 warning）
- [x] 用例：未配置 → noop 且无外部调用；500 → 记录失败；`reportNow` 不抛（7 条）
