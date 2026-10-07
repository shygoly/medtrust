## Context

- `AdminController` 整个控制器是 `@ParticipantRoles("operator")`，admin 自己调用不了；`AdminService.updateUser` 直接写入 DTO 里的角色，`resetPassword` 不看目标是谁。
- `SEED_DEMO_USERS` 播种提供方、使用方、运营方、合规方四类账号，没有 admin。
- 审计日志是按租户的 SM3 链式哈希，由运行中的 API 进程内的 `AuditService` 顺序追加。
- 登录时把角色写进 JWT；`JwtStrategy` 每次校验账号是否可用，但角色取自令牌。

## Goals / Non-Goals

**Goals:**

- 运营方无法通过任何控制台接口获得或接管 admin 权限。
- 有一条明确的、只有服务器权限才能走的 admin 授予与撤销路径。

**Non-Goals:**

- 让 admin 在控制台里管理用户或其他 admin（维护者未选此方案）。
- 首个 admin 的自动引导。部署后由运维执行一次命令。
- 令牌即时吊销机制。

## Decisions

### 1. 规则放在服务层，不看调用方角色

接口的调用方只可能是运营方，所以规则写成无条件的：目标是 admin → 拒绝；要设成 admin → 拒绝；改自己的角色 → 拒绝。全部返回 403 并说明原因。控制器只负责把当前用户 ID 传给服务。DTO 的角色枚举保留 `admin`（它仍是合法角色值，且 `check-nav` 的 N5 要求枚举与清单一致），由服务层拒绝。

### 2. 服务器侧命令直连数据库，不启动应用

`admin-role.cli.ts` 用 `@medtrust/database` 的数据源配置（关闭 `synchronize`）直连数据库，逻辑在可单测的 `admin-role.ts` 里。编译后随 API 镜像一起分发：

```
node dist/admin/admin-role.cli.js grant <email>
node dist/admin/admin-role.cli.js revoke <email> --role=<provider|consumer|operator|compliance>
```

授予与撤销都会吊销该用户的刷新令牌，迫使其重新登录以取得新角色。

备选：启动一个 Nest 应用上下文来复用 `AuditService`。否决，因为 `AuditService` 在初始化时有演示数据播种的副作用，且会与运行中的 API 同时向同一条哈希链追加。

### 3. 该命令不写审计链

链式审计日志只应由运行中的 API 单进程追加；第二个进程并发追加可能读到同一个链尾而使链分叉，破坏完整性校验。因此命令不写 `audit_logs`，而是把一条结构化记录（时间、目标、前后角色、执行的系统用户）打到标准输出，由运维留存。授予结果本身在用户管理列表里对运营方与合规方可见。

## Risks / Trade-offs

- 授予动作不在链式审计里 → 标准输出记录由运维留存；如需入链，后续可在 API 启动时比对角色变更并补记，本次不做。
- 被撤销的 admin 在其访问令牌到期前仍带着旧角色 → 刷新令牌已吊销，窗口不超过访问令牌有效期；需要立即生效时同时把账号禁用（`JwtStrategy` 会在 60 秒内拒绝）。
- 上线后若线上还没有任何 admin，系统状态与基础设施页面将无人可进，直到执行一次授予命令 → 上线步骤里写明。
- 运营方原先可在界面上给自己改角色，现在不行 → 由另一名运营方操作。

## Migration Plan

1. 部署前确认线上是否已有 admin 账号；没有则在部署后立即执行一次 `grant`。
2. 部署 API 与 web。
3. 回滚 = 回退提交；已授予的角色不受影响。

## Open Questions

无。
