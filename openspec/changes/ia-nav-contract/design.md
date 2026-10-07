## Context

现状（2026-10-07 对照代码复核）：

- 菜单写死在 `components/console/space-nav.tsx`，按组做角色过滤；31 个 `page.tsx` 中 9 个不在菜单，其中 `/space/infer/[taskId]` 是 `FLOWS.md` 登记的 FLOW-RWS-04 终点 actor。
- 页面级门控四种写法并存：`RoleGate`、手写 `ALLOWED`、`role !== "consumer"` 早返回、完全没有。`audit` 与 5 个 `admin/*` 页零门控。
- 服务端鉴权完备且 fail-closed，`@ParticipantRoles` 绝大多数是**方法级**（14 个带角色的控制器里只有 3 个是类级）。
- `/space` 总览全部来自 `@medtrust/demo-scenario` 静态数据，`components/console/ui.tsx` 连 `TaskStatus` 类型都从 mock 取。
- 仓库既有范式是"元语 + 守护 + 负例自检"，守护是零依赖 `.mjs`，挂在根 `pnpm test`。

约束：`DESIGN.md` 是 UI 唯一事实源；决策须登记 `DECISIONS.md`；本阶段不改菜单分组和路由地址。

## Goals / Non-Goals

**Goals:**

- 菜单、路由、角色、流程 actor 由一份清单互相对拍，漂移即红。
- 角色门控只有一处实现，新页面不会漏。
- 审计 P0 列出的断链、mock、死代码清零。

**Non-Goals:**

- 侧栏重组、面包屑、⌘K、标签与页头统一（阶段 1）。
- 列表与详情去重、路由合并与重定向（阶段 2）。
- 角色化工作台、atlas 设计语言收口（阶段 3）。
- 改服务端鉴权。`/space/infer` 无 index 页不补：没有任何入口链接到它。

## Decisions

### 1. 清单是 JSON，不是 TS

`apps/web/src/nav.manifest.json` 存数据，`apps/web/src/lib/nav.ts` 提供类型与访问函数。

理由：根目录守护是零依赖 node 脚本，直接 `JSON.parse` 即可；若清单是 TS，守护要么引入 tsx，要么正则解析 TS，两者都比读 JSON 脆。JSON 也便于其他工具和 agent 读取。代价是清单内不能写注释，形状校验放到守护里做。

备选：TS 清单 + 守护用 `node --import tsx` 加载。否决，因为会让根 `pnpm test` 的守护链依赖 web 工作区的 devDependency。

### 2. 清单条目模型

```
顶层：roles[]、groups[{id,label}]、entries[]、waivers.duplicateList[]
条目：route      App Router 路径模式，与 page.tsx 一一对应
      label      中文名
      entry      menu | contextual
      group      所属菜单组 id
      viewLayer  list | detail | form | ledger | dashboard
      entities[] 该页呈现的领域对象；非领域视图用 view: 前缀
      roles[]    可见角色，省略 = 全部角色
      parent     非菜单条目必填，指向另一条目的 route
      flows[]    把该页登记为 actor 的 FLOW-x
      guards[]   该页主要依赖的服务端端点
      icon / en  仅菜单条目
```

`entities` 用数组而非单值：`/space/tasks` 同时列 RWS、FL 预测、SecretFlow 三类任务，单值会让"重复列表"规则查不出 `/space/federated` 与它重叠。

计划文档里的 `internal` 入口类型去掉：仓库里没有这种页面。

### 3. 门控放在布局层

新增 `components/console/route-guard.tsx`，挂在 `(console)/layout.tsx` 的 `main` 内。按 pathname 匹配清单条目，角色不符时渲染统一无权限卡片。页面内整页门控全部删除；按角色切换列、按钮的条件渲染保留，优先用 `RoleGate`。

备选：给 8 个缺门控的页面逐个加 `RoleGate`。否决，因为它保留了"每个新页面都要记得加"的漏洞，并且让写法继续分散。

这仍是 UX 层门控，角色来自本地会话。安全边界仍是服务端守卫。

### 4. 服务端对拍按端点声明

条目的 `guards` 写成 `<控制器相对路径>#<METHOD> <子路径>`（省略 `#` 之后表示取类级角色），例如 `audit/audit.controller.ts#GET`、`runtime/silk-road/silk-road.controller.ts#GET admin/interop/silk-road/subjects`。守护在控制器源码里定位路由装饰器，取同一方法上的 `@ParticipantRoles(...)`，没有则回落类级，再没有视为全部角色。

规则：声明了 `guards` 的条目，其 `roles` 必须**等于**各 guard 角色的并集。比并集小是"有能力无入口"（丝路数港互认现状），比并集大是"看得到页面但主功能必然被拒"。

局限：守护不知道页面实际调了哪些端点，`guards` 靠人声明。未声明 `guards` 的条目不做对拍。

### 5. 重复列表用豁免名单做棘轮

规则：两个 `entry: menu` 且 `viewLayer` 相同的条目，`entities` 有交集即为重复。现存重复写进 `waivers.duplicateList`，每条带 `reason` 与 `until`（负责消除它的 change 名）。名单里出现不再成立的豁免也算错误，保证名单只减不增。阶段 2 清空它。

### 6. 标签同源规则推迟到阶段 1

计划文档原定本阶段带豁免启用"菜单 label 与 `PageHeader` title 同源"。现状是 11 个页面不在 `page.tsx` 里直接用 `PageHeader`，启用它需要 15 条以上豁免，而阶段 1 会把页头标题改为从清单取，届时规则变成一句"标题不得写字面量"。本阶段不做。

### 7. 角色枚举以清单为准，对拍三处

清单 `roles` 必须与以下三处完全一致：`apps/web/src/lib/auth.ts` 的 `AuthUser.role` 联合类型、`apps/api/src/admin/dto/update-user.dto.ts` 的 `@IsIn` 列表、`DESIGN.md §8`"角色定义"行里的反引号词。用户管理页的下拉直接从 `lib/nav.ts` 取角色，不再自带枚举。

### 8. 总览只留可测量的指标

`/space` 改为客户端组件，复用真实查询：任务用新抽出的 `hooks/use-orchestration-tasks.ts`（与任务页同一 queryKey），连接器用 `api.listConnectorStatus()`，存证用 `api.getBlockchainAttestations()`。保留参与方、在线、活跃任务、上链存证 4 个指标；去掉"本地数据 434k 行"（写死的字面量）和"原始数据出域 0 行"（架构不变量，不是测量值，页头描述与侧栏底部已有同一表述）。拓扑图的节点改由连接器状态生成，不再写死医院名与行数。

## Risks / Trade-offs

- 正则扫描控制器与页面源码，写法变化可能漏检或误报 → 守护核心是纯函数，每条规则配负例与合法样例；定位不到 guard 指向的端点时报错而不是放行。
- `guards` 靠人声明，漏声明则不对拍 → 首版接受；阶段 1 评估由页面的 `api.*` 调用反推。
- 总览少了两个展示性指标，拓扑图不再有固定医院名 → 对外演示材料若引用旧截图需重截；本变更上线避开演示前一周。
- 用户管理下拉出现 `admin` 后，运营方可在界面上授予 `admin`。服务端 `AdminService.updateUser` 本来就不限制可授予的角色，界面只是把已有能力显示出来 → 是否收紧属服务端决策，不在本变更范围，单独提出。
- 无权限卡片是通用文案，原交付页"运营方请去联邦密算"的定向提示消失 → 卡片显示该页面向的角色与返回总览入口。

## Migration Plan

纯前端与脚本改动，无数据迁移。按 tasks 分组顺序提交；守护在门控与文档修完前是红的，属预期。回滚 = 回退提交。

## Open Questions

- 运营方能否授予 `admin` 角色，需要你定是否在服务端收紧。
