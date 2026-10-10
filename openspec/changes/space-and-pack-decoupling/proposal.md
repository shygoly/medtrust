## Why

需求演进：平台要支撑**多领域（医疗 / 电力）可信空间**，基座未来**开源**、按**插件**装载，且**部分插件不开源**。经三轮评审，确认现有一份多空间分析（DOC1）与一份基座解耦方案（DOC2）各只覆盖一条轴，合起来存在三处硬冲突：

1. **装配机制是部署级**：DOC2 用 `SPACE_PACKS=med|power` 启动读 env，等于"一进程一行业"，与"一个平台承载多领域、多空间"直接矛盾；
2. **六根 SPI 不是插件边界**：DOC2 的 SPI 是编译期**进程内** TypeScript 接口，没有版本 / 隔离 / 生命周期 / 许可边界，无法满足"部分插件不开源"；
3. **估值引擎被放进开源内核**：DOC2 把报告核心（Shapley / 互信息 / ε-效用 / 定价）列为内核必修组件，与开源策略冲突。

同时实测确认三条硬阻碍：全仓 `process.env.SPACE_ID` 命中 **57 处 / 32 文件**；`cp_participant.org` 为全局唯一索引；`cp_space` 只有元数据（无成员、无品牌），而 `cp_module_admission` / `cp_module_revocation` / `cp_connector_registry` **均无 `spaceId`**。

本变更把**三条轴一次定死**，并给出可直接落地的装配、分层与隔离方案。

## What Changes

- **三轴定死**：空间（隔离与治理）· 能力包（领域逻辑）· 分发边界（开源 / 闭源）正交；**空间 = 治理与行业边界**，场景下移为空间内的「协作」。
- **空间语义收窄**：`cp_space` 从"顶层容器"收窄为"治理边界"，承载 ① 独立信任根（CA / 密钥）② 独立策略与代码集（pack 绑定 + 合规 profile + 出域模板 + 准入白名单）③ 独立成员与可见性域。空间是**逻辑**边界，不是物理库边界（不违 `D7`）。
- **装配机制改向**：`SPACE_PACKS` 从启动 env 降为**部署白名单**；真正的绑定是**空间运行期启用集**（`space.enabledPacks`）。连接器为**多空间 × 多包**并存。
- **闭源准入公理 + 三层**：一个环节可闭源，当且仅当 (a) 不接触原始数据 (b) 不决定数据放行 (c) 输出可被开源侧独立复核。据此分 **T0 内核机制（必开源）/ T1 可审声明式（必开源）/ T2 聚合后算子与估值（可闭源）**。
- **六根缝分层归属**：S3 出域策略、S5 合规 profile、S6 去标识代码 → **T1 强制开源**；S2 算子、S4 计量 / 估值 → T2 可闭源；S1 接口与投影语义 → T1，实现可在数据持有方侧闭源。
- **估值引擎不开源**：移出内核，作为 T2 插件经开放的 `MeteringProvider` 接入；内核保留开放兜底口径，无插件时走兜底并**如实标注**（禁止静默假装）；记录 `meter id/version/digest` 并强制与兜底口径对拍。
- **闭源插件只接受 Wasm / OCI**：沿用 `D-CN-2` / `D-CN-5`（源码-only + 五道闸 + 可吊销 + NDA 保密审查通道）。**保密只保护 IP，不保证行为** → 强制靠许可 + 存证 + 合约条款。
- **请求级空间上下文**：`SpaceGuard` + `AsyncLocalStorage` + 仓储层强制注入，替换全仓 `process.env.SPACE_ID`；过渡期保留环境变量为默认空间并加弃用告警。
- **成员两层**：`机构↔空间`（权威，资质审批 + 域内角色）+ `人↔空间`（由机构派生 + 个人直接受邀）。`User.participant_id` 单值改为多空间成员集合。
- **`cp_participant` 保持全局**：**不采用** `(spaceId, org)` 联合唯一（该做法会分裂机构身份、重复资质与配额）；跨域关系放成员表；域内角色从 `cp_participant` 移出。DOC1 硬阻碍 #1 因此改判为"不需要"。只有**域内活动表**需要 `spaceId`。
- **`Tenant` 与 `cp_participant` 合一**：`cp_participant` 为机构身份权威；`Tenant` 降级为商业属性（资质 / 配额 / 订阅 / 财务）的 1:1 扩展。
- **入域 = 邀请 + 审批（不开放）**：同一状态机 `invited → pending → active → suspended | rejected`；邀请一次性 + 有期 + 不可枚举 + 绑定被邀主体；审批限 `operator`；资质腿复用 `cp_org_certification_application`。
- **协作（场景）作用域**：轻量对象，聚合合约 / 数据产品 / 成员并提供**可见性作用域**（同空间内竞争方互不可见）；**不承载隔离、无独立 CA**。
- **空间品牌与主题**：级联 = 平台默认（`DESIGN.md` Vital Ink）→ 实例品牌（部署配置兜底 + admin 设置页）→ 空间主题（受约束 `--cs-*` token 覆盖白名单）。**不可覆盖**状态语义色映射、功能层、能力层。术语由 pack 提供且受守护，空间不可自造。联邦远端只展示标识、**不注入 CSS**。
- **准入空间化**：准入 / 吊销 / 连接器注册加 `spaceId`，范围 = `global`（平台签名）| `per-space`（第三方）。
- **基座纯度守护**：新增 `scripts/check-kernel-purity.mjs`（denylist + 依赖方向）+ 负例自检，P0 先以候选目录基线报红。
- **开源治理与许可卫生**：全仓无 LICENSE（仅 `apps/api/package.json` 有 `license` 字段）→ 定内核许可 + SPDX 头；查 `vendor/ai-factory` 许可；清 demo 数据与真实机构名；核对词典许可（如 SNOMED CT）；建三方 conformance kit。

## Capabilities

### New Capabilities
- `space-context`：请求级空间上下文（解析 / 守卫 / 载体 / 仓储强制注入 / 切换）。
- `space-isolation`：空间作为治理与行业边界（CA 根、pack 绑定、合规 profile、出域模板、准入白名单、审计分离；隔离强度与实例拓扑正交）。
- `space-membership`：两层成员关系、邀请（一次性有期不可枚举）、审批、多空间与切换。
- `space-branding`：实例品牌与空间主题的受约束覆盖层、级联、术语边界、联邦标识边界。
- `collaboration-scope`：空间内的协作（场景）对象与可见性作用域。
- `pack-binding`：能力包注册、部署白名单 + 空间运行期启用集、SPI 分层（T0 / T1 / T2）、闭源准入公理、基座纯度。

### Modified Capabilities
None。`space-management`（tc609-space-management）的三条 Requirement（空间实体持久化 / operator 门控 / 默认空间幂等种子）在本变更后**仍然成立**；空间的语义收窄与新增字段（`enabledPacks` / `branding`）由本变更的新 capability 表达，待 tc609 归档时同步并入 `space-management` 基线规格。

## Impact

- **Schema**：`cp_space` 增 `enabledPacks` / `branding`；新增 `cp_space_member` / `cp_space_invitation` / `cp_collaboration`；`cp_module_admission` / `cp_module_revocation` / `cp_connector_registry` 增 `spaceId`；域内活动表（合约 / 结算 / MDOP / 证书 / CA / 联邦信任 / 数据产品 / 审计）增 `space_id`；`cp_participant` **不动**；`Tenant` 收敛为参与方商业属性。
- **API**：新增 `GET /spaces/:id/theme`、`POST /auth/switch-space`、成员 / 邀请 / 协作端点；既有端点全部接入 `SpaceGuard`。
- **Connector**：多空间 × 多包装配；密钥 / 证书分空间；本地策略按空间重算；准入按空间校验。
- **Governance**：八件套分册（`KERNEL.md` / `PACK.md` 新增，`DOMAIN.md` / `FLOWS.md` / `TRUST.md` 分级表按册拆）；`DESIGN.md` §1.1 由"唯一主题"改为"默认主题 + 受约束覆盖层"；新增 `check-kernel-purity`；`DECISIONS.md` 登记 `D-SPD-1% … `D-SPD-19`。
- **Risk**：中高。S1（请求上下文）与 S5（数据隔离）互相依赖，必须同批；S5（连接器多栈）不能晚于交付，否则会先用"共用密钥 + 单栈"糊过去，形成跨空间密钥复用这一事后极难纠正的安全债。
