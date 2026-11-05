# Tasks

- [ ] 平台侧连接器状态聚合：`connector_state` 视图（在线/离线、版本、任务数与阶段、资源水位），离线判定 3 个心跳周期（可配置）
- [ ] 对外聚合快照：`{connectorId, ndiId, status, lastSeenAt, version, load}`，供上报告与系统状态页共用
- [ ] 新增 `runtime/region-reporting`：`RegionStateReporter`（endpoint/鉴权可配置，未配置返回 `unconfigured`，不影响主链路）
- [ ] 上报周期 `REGION_STATE_REPORT_INTERVAL_MS`（缺省 5000）登记 DEPLOY.md 与样例
- [ ] 载荷：平台自身状态 + 连接器聚合快照 + 空间标识（NDI 编码）；鉴权随接口文档到位后接（对拍表 §4）
- [ ] 系统状态页展示 `regionReporting` 状态与最近一次上报结果
- [ ] 连接器心跳载荷补 `connectorId` 的 NDI 标识（与 `ndi-identifier-alignment` 联合验收）
- [ ] 文档：注册单元 = 平台（业务节点）；医院侧节点为空间内部节点，不单独注册为接入连接器
- [ ] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §1 C6 与 §2 平台行
- [ ] 明确不得把「区域节点未配置」表述为「已上报区域节点」

## 离线可用性（必过）

- [ ] 装配 `NoopRegionReporter`（缺 endpoint 时），只 warn、不抛、不计错误率
- [ ] 上报循环独立定时器 + 单次 ≤5s 超时 + 退避熔断；压测确认不影响长轮询领任务
- [ ] API 启动在外部未配置时正常完成（只 warning）
- [ ] 加用例：外部 endpoint 返回 500/超时，主链路与连接器任务不受影响
