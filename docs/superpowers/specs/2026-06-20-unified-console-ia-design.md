# 设计规格:三面合一的可信数据空间控制台(IA 统一)

- 状态:待评审 / 待实现
- 日期:2026-06-20
- 关联:`apps/web`(`(console)` / `(atlas)` / `dashboard` / `(landing)`)、控制面 API(`/catalog` `/contracts` `/audit` `/capability` `/compliance`)

---

## 1. 背景与关系厘清

前端现有三个面,分属"两代范式 + 一个治理层":

- **`/dashboard`** — 旧的**中心化多租户平台** UI(蓝白通用风,接真实 API:租户/资产/请求/计算/密算/审计)。CLAUDE.md 明确项目正从中心化多租户**迁出**。→ **遗留**。
- **`/space`** — 新的**联邦可信数据空间运行时控制台**(`(console)` 组,cs "Vital Ink" 深色主题,登录后落点,目前 **mock 数据**:总览/连接器/RWS 任务/存证/结算)。→ **运行面**。
- **`/atlas`** — **七层能力 + L2 合规 + 编排**(已重皮成 cs 视觉,真实数据)。→ **声明面**。

**关系链**:`atlas(声明:能力 + 合规裁决) → space(运行:任务/连接器/存证/结算)`。`dashboard` 与 `space` 在"计算/密算/审计"概念重叠但属旧范式。

**现状问题**:atlas 与 space 现同为 cs 视觉却是**两个独立外壳**(atlas 顶栏 vs space 侧栏)、零互链;space 是 mock、atlas 真实;landing 的"控制台"仍指向旧 `/dashboard`。

### dashboard → 联邦范式 覆盖现状(取舍依据)

| dashboard 功能 | 联邦对应 | space 现状 |
|---|---|---|
| 租户 tenants | 参与方 participant-identity | `connectors` 页 ≈ 参与方,部分覆盖 |
| 资产/上传数据 assets | 数据产品 catalog(原始数据留连接器) | `connectors` 页有"发布数据产品"按钮;**无目录页** |
| 接入审核 requests | 数字合约 digital-contract(签发=授权) | **无合约 UI 页**(API `/contracts` 已有) |
| 计算 compute | RWS 任务 | `tasks` 覆盖 |
| 密算 secretflow | secretflow 编排 | `tasks` + `atlas/compose`,部分 |
| 管理日志 audit | 审计日志 + 上链存证 | **仅 `attestations`(存证子集)**;无完整审计页(API `/audit` 已有) |

**结论**:space 尚缺 **3 个联邦原生页**(数据产品目录 / 数字合约 / 审计日志)才能取代 dashboard。

## 2. 目标与范围

**做**:把 atlas 并入 space 统一外壳;补齐上述 3 页(对位替换 dashboard);atlas↔运行面导航互链;退役 dashboard(重定向)并修正 landing 入口。

**不做(非目标)**:不把现有 space mock 页(总览/连接器/任务/存证/结算)改造为真实 API(独立后续);不改动 P0–P4 已交付的后端;compose 不自动建任务(仅导航互链)。

## 3. 设计

### ① 统一外壳

- atlas 三页迁入 `(console)` 组:`app/(console)/space/atlas/page.tsx`、`.../atlas/[layer]/page.tsx`、`.../atlas/compose/page.tsx`(路由 `/space/atlas*`)。复用 console 的 `AuthGate` + `SpaceNav` 侧栏;删除 atlas 自有顶栏 `components/atlas/atlas-nav.tsx`。
- **`QueryClientProvider` 放在 console 组 layout**(`app/(console)/layout.tsx`,客户端 provider 包裹 `SpaceNav` + children),使**所有 `/space/*` 页**(atlas + ② 的 catalog/contracts/audit)共享同一 query client。`(console)` 此前无 app 级 provider。
- atlas 内容的 shadcn token 主题:沿用其 `.codex` 作用域(token 已映射为 cs 值)+ Plex 字体变量。这两者作为**包裹 atlas 页内容的 div** 提供(可在 `space/atlas/layout.tsx` 或直接在各 atlas 页根 div),不再承担 provider 职责。atlas 保留 shadcn 组件。
- 删除原 `app/(atlas)/` 路由组;`atlas.css` 迁入 `(console)` 下(供 `.codex` 作用域类使用)。
- `components/console/space-nav.tsx` 分组重排:**声明面**[能力图谱 `/space/atlas` · 任务编排 `/space/atlas/compose`] / **运行面**[空间总览 · 连接器 · 数据产品 `/space/catalog` · 数字合约 `/space/contracts` · RWS 任务 · 存证 · 结算] / **审计**[审计日志 `/space/audit`]。

### ② 三个联邦原生页(cs 风格 + 真实 API)

复用 cs primitives(`PageHeader`/`Panel`/`Stat`/`cs-*`,见 `components/console/ui.tsx`)。

- `app/(console)/space/catalog/page.tsx` — 数据产品目录:列表 `api.getDataAssets()`(GET `/catalog`)+ 复用 `PublishProductButton`(POST `/catalog`,provider 角色门控)。文案说明"原始数据留连接器,中心仅登记元数据"。← 替 `dashboard/assets`。
- `app/(console)/space/contracts/page.tsx` — 数字合约(接入审核):列表 `api.getAccessRequests()`(GET `/contracts`)+ 签发(POST `/contracts`);状态/attest 操作。← 替 `dashboard/requests`。
- `app/(console)/space/audit/page.tsx` — 审计日志:`api.getAuditLogs()`(GET `/audit`),与 `attestations`(上链存证)互补。← 替 `dashboard/audit`。
- 这三页用 TanStack Query → 由 ① 放在 console 组 layout 的共享 `QueryClientProvider` 覆盖(`/space/*` 全覆盖)。

### ③ 互链(仅导航)

- `/space/tasks` 页加"去编排"入口 → `/space/atlas/compose`;compose 页加"去运行面"提示 → `/space/tasks`。**不做** composition 自动建任务(跨 mock/真实边界,留后续)。

### ④ 退役 dashboard + 修 landing

- `app/dashboard/*` → 重定向到 `/space`(对应功能已在 space)。实现:`dashboard/layout.tsx` 或各 `page` 顶层 `redirect('/space')`(Next `redirect`),或保留壳但首页跳转。
- `app/(landing)/page.tsx`:"控制台" `href` 由 `/dashboard` → `/space`;"打开密算编排控制台" `/dashboard/secretflow` → `/space/atlas/compose`;footer 同步。
- `app/login/page.tsx` 已 `router.push('/space')`,无需改。

### ⑤ 已知 / 暂不在范围

- 现有 space 页仍为 mock(`@/lib/space-mock`);本设计新页用真实 API。**mock→real 改造为独立后续**。
- dashboard 代码退役后可保留一版本周期再删(先重定向)。

## 4. 数据流

```
登录 → /space(运行面落点)
侧栏:
  声明面 → /space/atlas(七层注册表 CRUD) · /space/atlas/compose(组合 → L2 裁决印记)
  运行面 → 连接器 / 数据产品(catalog) / 数字合约(contracts) / RWS 任务 / 存证 / 结算
  审计   → 审计日志(/audit)
互链:tasks ↔ atlas/compose(仅跳转)
landing「控制台」→ /space;dashboard/* → 重定向 /space
```

## 5. 错误处理

- 新页 API 失败 → cs 风格错误态(参考 atlas 现有"无法连接 API"面板)。
- 写操作(发布产品/签发合约)沿用服务端角色门控(provider/operator),前端按 `useAuth().role` 显隐入口,失败显式报错。

## 6. 测试 / 验证

- `pnpm --filter web build` 通过,新路由(`/space/atlas*`、`/space/catalog`、`/space/contracts`、`/space/audit`)出现且预渲染/动态正确;`/dashboard` 重定向到 `/space`。
- 起栈(Vault + seed + API + web)后人工走查:登录落 `/space`;侧栏三组导航可达;catalog 列表来自真实 `/catalog`;contracts 列表来自 `/contracts`;audit 来自 `/audit`;atlas 在 space 外壳内正常;tasks ↔ compose 互链;landing"控制台"进 `/space`。

## 7. 落地分期

- **P1** atlas 并入 space 外壳 + 统一分组 `SpaceNav` + tasks↔compose 互链 + landing/footer 改指 `/space`。(不删 dashboard)
- **P2** 三个联邦页:`/space/catalog`、`/space/contracts`、`/space/audit`(真实 API)。
- **P3** `dashboard/*` 重定向 `/space`,退役遗留。

## 8. 决策记录

| 决策点 | 选择 |
|---|---|
| atlas 与 space 外壳 | 并入 /space 统一控制台(声明面 + 运行面 + 审计一体) |
| dashboard 去留 | 补齐 3 个联邦页后退役、重定向到 /space |
| compose ↔ 运行面 | 仅导航互链,不自动建任务 |
| space mock→real | 不在本次范围(独立后续) |
| 视觉 | 统一 cs "Vital Ink";atlas 保留 shadcn(token 映射为 cs) |
