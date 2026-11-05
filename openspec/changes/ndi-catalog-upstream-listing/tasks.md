# Tasks

## 第 1 步：目录模型与发布校验（无外部依赖）

- [ ] `packages/database` `DataProduct` 增加 `listingScope`（默认 `internal`）、`listingConsent`、`serviceSpec`、`serviceCapacity`、`provenance`；迁移只加字段
- [ ] 发布校验：`productType='service'` 必须有 `serviceSpec`；`listingScope='regional'` 必须有 `listingConsent` + NDI 标识
- [ ] `serviceSpec` 校验：`minSample > 0`、`gate.minCell ∈ [5,20]`、`gate.minCellRare ≥ minCell`
- [ ] 服务类禁止用 `recordCount` 表达规模（改为 `serviceCapacity` 或留空），UI/API 同步
- [ ] web 目录管理页：公开授权录入（授权人/时间/依据/签名）、披露粒度选择、服务规格表单
- [ ] 用例：无授权不能设 regional；服务类缺 spec 发布被拒；`namedParties` 为空不影响上架

## 第 2 步：分类型推送与幂等（部分依赖 06 附录）

- [ ] `runtime/silk-road` 拆分 `pushResources` / `pushProducts` / `pushServices`（或按 `objectType` 分派）
- [ ] 字段映射 NDI-TR-2025-06 表 A.x（资源表 / 产品表），未映射字段显式列清单留档
- [ ] 幂等键 `spaceId + ndiId + version`；失败重试 + 死信；推送结果落表（最近成功/失败原因可查）
- [ ] 撤回：`listingScope` 回退或下架时发撤回；接口不支持撤回时标状态 + 人工对账清单
- [ ] 上报报文使用 NDI 标识（消费 `ndi-identifier-alignment`）
- [ ] 用例：重复推送不产生重复条目；下架后撤回生效或状态可核对

## 第 3 步：登记 → 审核 → 上架状态机（依赖节点接口文档）

- [ ] 本地状态机 `draft → submitted → approved/rejected → listed → withdrawn`，含非法迁移拒绝
- [ ] 回读审核结果与驳回原因，目录管理页展示
- [ ] 对账任务：区域节点目录 ↔ 本空间在架目录差异清单（定时 + 手动触发）

## 文档与决策

- [ ] 四个待拍板项落定后写入 `DECISIONS.md`（授权主体 / 披露粒度 / 计算结果能否挂牌 / 上报节奏）
- [ ] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §2「数据服务目录」与 §5 清单
- [ ] 明确对外口径：目录只报**元数据**，不报计算结果、不报数据行、默认不报机构名

## 离线可用性（必过）

- [ ] 存量 `productType=service` 产品 grandfather（回填默认 spec 或 `legacy` 跳过校验），保证更新不被误拒
- [ ] 加列迁移与回填分两次执行；回填可重跑、可回滚
- [ ] 推送失败只记状态：本地目录可见性与发布/更新操作不受影响（用例）
- [ ] 本地状态先落库，再触发推送（顺序断言）
