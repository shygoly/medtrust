# 标识编码对齐 NDI-TR-2025-04（统一目录标识）

> 上游：NDI-TR-2025-04《数据基础设施 标识管理规范》；NDI-TR-2025-06（目录元数据引用标识）；D10（接口对齐 NDI-TR 系列）
> 关联：「三统一」中的**统一目录标识**

## Why

现状标识是自定的：

- 数据产品：`urn:tds:<spaceId>:<productId>`（`DECISIONS.md` D10、`packages/demo-scenario`、`packages/database`）
- 参与方/节点：`urn:tds:<space>:participant:<id>`（`apps/chat-agent`、内嵌于 MDOP 计划）

NDI-TR-2025-04 规定了数据资源、数据产品、接入连接器、业务节点、区域/行业功能节点、全域功能节点的**标识生成规则**。「三统一」里这是第一项，也是目录同步、标识解析、跨节点检索的前置条件：编码不一致，对方无法解析，互认与目录同步就只能靠自定义映射。

**不做的代价**：目录推送虽已实现（`/admin/interop/silk-road/push-catalog`），但对方无法按 04 解析我们的 URN；送检时 §8.1 标识和鉴别判缺项。

## What Changes

1. **标识映射层**（新增，内核级）：
   - 输入：内部 URN（保持不变，避免全库迁移）
   - 输出：NDI 标识（对象类型 + 前缀/机构码 + 序列/校验位，按 04 生成规则）
   - 双向：`toNdi(id)` / `fromNdi(id)`，非法编码 fail-closed 抛错，不做模糊匹配
2. **落点（对外边界）**：
   - 目录推送（`runtime/silk-road`）改用 NDI 标识
   - 连接器注册与身份上报（`ndi-platform-state-report`）携带 NDI 标识
   - 审计/存证元数据中同时记两套（内部 URN 用于回溯，NDI 标识用于对外）
3. **配置化机构码**：`NDI_ORG_CODE` / `NDI_ID_SCHEME_VERSION`，未配置时对外接口 **fail-closed**（不猜默认值）。
4. **存量兼容**：数据库保留 URN 主键；新增 `ndi_id` 列（可空，唯一），由迁移脚本按 04 补齐；读路径优先 NDI，写路径双写。

## 不做（范围外）

- 不做标识解析服务（那是区域节点的能力，见 TC609-6-2025-11）。
- 不改 MDOP 计划与凭证里的 URN（协议内部标识，不对外）。

## 离线可用性（外部未对接时必须成立）

> 现网尚未对接丝路数港。本变更不得把基线抬高为「必须有外部才能跑」。总闸见 [`ndi-external-absent-e2e`](../ndi-external-absent-e2e/proposal.md)。

- **内部一律继续用 URN**：`ndi_id` 仅用于对外报文；内部读路径（目录、合约、任务、UI）禁止调用映射层，加断言测试防误用。
- **列必须 nullable**：迁移只加列（可空、唯一），不与数据回填同批执行；PostgreSQL/SQLite 对多 NULL 唯一约束均允许。
- **对外 fail-closed、本地照常**：`NDI_ORG_CODE` 未配置时只让对外推送报错，本地目录/任务/存证不受影响。
- **启动不失败**：缺配置只 `warn`。

## Impact

- 代码：`packages/database`（新增列 + 迁移）、`packages/mdop`（新增 `identifier` 模块，领域中立）、`apps/api/src/runtime/silk-road`、`apps/connector`（注册载荷）。
- 数据：存量迁移脚本 + 回滚脚本；迁移期间对外推送只发新标识。
- 风险：04 正式文本的校验位算法若与试行版不同，映射层需按版本号并存（`NDI_ID_SCHEME_VERSION`）。

## 验收

- [ ] 目录推送报文中的标识全部为 NDI 编码，且能被 `fromNdi` 还原到内部对象
- [ ] 未配置机构码时，对外推送端点返回明确错误（不静默降级为 URN）
- [ ] 非法编码（长度/字符/校验位）有负向用例
- [ ] 存量迁移后 `ndi_id` 唯一且非空；回滚可在一次事务内完成
