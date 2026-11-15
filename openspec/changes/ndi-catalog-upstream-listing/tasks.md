# Tasks

## 第 1 步：目录模型与发布校验（无外部依赖）

- [x] `packages/database` `DataProduct` 增加 `listingScope`（默认 `internal`）、`listingConsent`、`serviceSpec`、`serviceCapacity`、`provenance`；Postgres 迁移只加列（`1762400000000`）
- [x] 发布校验：`service` 必须有 `serviceSpec`；转 `regional` 必须有 `listingConsent`（NDI 标识在推送时校验）
- [x] `serviceSpec` 校验：`statistic` 非空、`minSample > 0`、`gate.minCell ∈ [5,20]`、`gate.minCellRare ≥ minCell`
- [x] 服务类禁止用 `recordCount` 表达规模（API 校验；UI 待接）
- [x] web 目录管理页：公开授权录入（授权人/时间/依据/签名）、披露粒度选择、服务规格表单（`catalog-product-form.tsx`，本次补授权签名输入）
- [x] 用例：无授权不能设 regional；服务类缺 spec 被拒；grandfather 允许存量更新；spec 越界被拒（8 条）

## 第 2 步：分类型推送与幂等（部分依赖 06 附录）

- [x] `runtime/silk-road` 按 `objectType` 分派（product / service；资源类对象本空间暂无，不虚报）
- [ ] 字段映射 NDI-TR-2025-06 表 A.x（资源表 / 产品表），未映射字段显式列清单留档
- [x] 幂等键 `spaceId + ndiId + version`；推送结果落表（`cp_interop_push_record`，最近成功/失败原因可查；重复推送只更新既有行）
- [ ] 失败自动重试 + 死信调度（当前为「手动再次推送、幂等去重」；无后台重试队列）
- [x] 推送范围收窄：只推 `listingScope='regional'` 的在架产品（存量 internal 不外发，有用例）
- [x] 上报报文使用 NDI 标识（消费 `@medtrust/mdop` 的 draft-1 编码；缺机构码 fail-closed）
- [x] 用例：重复推送不产生重复条目（同幂等键不新增台账行）
- [ ] 下架后撤回生效或状态可核对（依赖节点接口的撤回语义，待接口文档）

## 第 3 步：登记 → 审核 → 上架状态机（依赖节点接口文档）

- [ ] 本地状态机 `draft → submitted → approved/rejected → listed → withdrawn`，含非法迁移拒绝
- [ ] 回读审核结果与驳回原因，目录管理页展示
- [ ] 对账任务：区域节点目录 ↔ 本空间在架目录差异清单（定时 + 手动触发）

## 文档与决策

- [ ] 四个待拍板项落定后写入 `DECISIONS.md`（授权主体 / 披露粒度 / 计算结果能否挂牌 / 上报节奏）
- [x] 更新 `docs/NDI-TR-2025-连接器与平台标准差距.md` §2「数据服务目录」与 §5 清单
- [x] 明确对外口径：目录只报**元数据**，不报计算结果、不报数据行、默认不报机构名（差距文档 §3 口径硬规则）

## 离线可用性（必过）

- [x] 存量 `productType=service` 产品 grandfather（回填默认 spec 或 `legacy` 跳过校验），保证更新不被误拒（`catalog.service.spec.ts` grandfather 用例）
- [x] 加列迁移与回填分两次执行；回填可重跑、可回滚（`1762400000000` 只 `ADD COLUMN IF NOT EXISTS` + DEFAULT 'internal' 即时回填，可重跑；`down` 可回滚）
- [x] 推送失败只记状态：本地目录可见性与发布/更新操作不受影响（台账记 failed+原因，本地目录不动；推送是独立运营动作）
- [x] 本地状态先落库，再触发推送（顺序断言：`pushes.save` 先于 `client.pushCatalog`）
