# 目录上报：医院公开数据集 + 平台计算数据服务

> 上游：NDI-TR-2025-06（数据目录描述规范，资源表/产品表字段字典）；TC609-6-2025-11/12（登记 → 审核 → 上架 → 目录）；NDI-TR-2025-04（标识）
> 前序：`tc609-data-service-catalog`（已落地 `productType: 'data' | 'service'`）、`tc609-p1-catalog-lifecycle`（更新/下架）、`docs/丝路数港-接口对拍表.md` §2（目录同步）
> 裁决来源：2026-11-05 产品决策——医院等数据提供方的**公开数据集**、以及平台汇集多院后**经计算的数据服务**，上报到丝路数港国家区域节点。

## Why

现在只推了「产品目录」的最薄一层：`runtime/silk-road#pushCatalog` 把 `status=active` 的产品以 6 个字段推给区域节点（`urn / title / providerId / productType / classification / recordCount`），推完即忘。

这挡住了三类真实需求：

- 医院愿意公开的数据集需要一个「公开」的授权与留痕，现在只有 `rightsConfirmed`（确权），它不等于允许对外公开；
- 平台汇集多院算出来的**数据服务**（队列统计、联邦预测等）应当在区域节点可见，但现在目录里没有服务描述，对方看到的只是一个名字；
- 区域节点的流程是「登记 → 审核 → 上架」，我方是 fire-and-forget，读不到审核结果，也无法撤回。

**必须区分三样东西**（否则会出事）：

| 对象 | 态度 |
|---|---|
| 医院的公开数据集 | 上报，作为数据资源/产品；**公开的授权必须由医院给** |
| 平台汇集多院算出的**数据服务**（能力） | 上报；目录里要写清口径与约束 |
| **具体的计算结果**（某次统计值/模型指标） | **不上报**（默认）。它是买家交付物，且汇总值仍可能被反推；如要挂牌须过合约 `outputPolicy` + 阈值抑制 + 显式授权，另立项 |

## What Changes

### 第 1 步：目录模型补字段（不依赖外部文档，可立即做）

`packages/database` 的 `DataProduct` 增加：

- `listingScope: 'internal' | 'regional'`：是否对外上报区域节点；默认 `internal`。
- `listingConsent`：公开授权留痕 `{ grantedBy, grantedAt, basis, signature }`；`internal → regional` 迁移时必填，缺失则拒绝发布。
- `serviceSpec`（仅 `productType='service'`）：`{ inputSchema, outputSchema, statistic, minSample, gate: { minCell, minCellRare }, allowedPurposes }`。
- `serviceCapacity`：服务容量/历史任务数，替代服务类无意义的 `recordCount`（并禁止服务类填 0 当作真实统计）。
- `provenance`：参与方披露 `{ participantCountBand: '≥3' | '≥5', namedParties?: string[] }`；`namedParties` 只在各参与方书面同意时出现。

发布校验：`productType='service'` 必须带 `serviceSpec`；`listingScope='regional'` 必须带 `listingConsent` 与 NDI 标识（见 `ndi-identifier-alignment`）。

### 第 2 步：分类型推送与幂等（部分依赖 NDI-TR-2025-06 正式附录）

- `pushCatalog` 拆成 `pushResources` / `pushProducts` / `pushServices`（或同一端点按 `objectType` 分派），字段映射 06 表 A.x。
- 每条带幂等键（`spaceId + ndiId + version`），失败重试 + 死信；推送结果落表，可查询最近一次成功/失败原因。
- 撤回：`listingScope` 回退或产品下架时，推送撤回指令（若接口不支持则以状态标注 + 人工对账）。

### 第 3 步：登记 → 审核 → 上架状态机（依赖节点接口文档）

- 本地状态：`draft → submitted → approved / rejected → listed → withdrawn`；
- 回读审核结果与驳回原因，展示在目录管理页；
- 对账：区域节点目录 ↔ 本空间在架目录的差异清单。

## 待拍板（提案期内确认，未确认前按推荐值实现）

| # | 决策 | 推荐默认 |
|---|---|---|
| 1 | 公开数据集的授权主体 | **医院逐项勾选**（平台只做通道），留痕进 `listingConsent` |
| 2 | 参与方披露粒度 | **只报数量区间**，机构名需各参与方书面同意 |
| 3 | 计算结果是否允许挂牌 | **默认不允许**；合约显式允许再分发才可，且另立项 |
| 4 | 上报节奏 | **上架即自动推、下架即撤回**，手动推送保留为兜底 |

## 不做（范围外）

- 不上报数据行、字段值样本、精确记录数（只给数量级）。
- 不实现区域节点侧的目录审核界面（节点能力）。
- 不做「计算结果目录项」——除非决策 3 改判并单独立项。

## 离线可用性（外部未对接时必须成立）

> 现网尚未对接丝路数港。本变更不得把基线抬高为「必须有外部才能跑」。总闸见 [`ndi-external-absent-e2e`](../ndi-external-absent-e2e/proposal.md)。

- **默认不外发**：`listingScope` 默认 `internal`，存量产品不自动转 `regional`。
- **存量数据 grandfather**：新增发布校验不得让存量 `productType=service` 产品无法更新——迁移时回填默认 `serviceSpec` 或标 `legacy` 跳过校验，UI 提示补全。
- **推送是副作用**：先落本地状态再推送；推送失败只记状态与原因，本地目录可见性与业务不受影响。
- **迁移与回填分离**：加列与回填分两次执行，回填脚本可重跑、可回滚。

## Impact

- 代码：`packages/database`（字段+迁移）、`apps/api/src/runtime/catalog`（发布校验）、`apps/api/src/runtime/silk-road`（分类型推送/幂等/撤回）、web 目录管理页（授权与披露字段）。
- 数据：存量产品默认 `internal`，不自动外发；迁移脚本只加字段不改语义。
- 依赖：06 正式字典（字段名/枚举）、04 标识（`ndi-identifier-alignment`）、审核回读接口（`docs/丝路数港-接口对拍表.md` §2）。
- 风险：`provenance` 若默认披露机构名，等于泄露合作网络——默认必须只给区间。

## 验收

- [ ] 产品无 `listingConsent` 时不能被设为 `regional`（负向用例）
- [ ] 服务类产品缺 `serviceSpec` 时发布被拒；目录详情可展示口径、最小样本、闸门参数
- [ ] 服务类不使用 `recordCount` 表达规模，UI 与报文一致
- [ ] 推送带幂等键，重复推送不产生重复条目；失败可见且可重试
- [ ] 撤回路径可用：下架后区域节点侧不再可见（或状态标为已撤回）
- [ ] 参与方披露为数量区间，`namedParties` 为空时不影响上架
- [ ] 上报报文全部使用 NDI 标识（04 编码）
