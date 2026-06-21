# 三面合一控制台(IA 统一)实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/atlas` 并入 `/space` 统一控制台,补齐 space 缺的 3 个联邦页(数据产品目录 / 数字合约 / 审计日志),退役旧 `/dashboard`,形成"声明面 + 运行面 + 审计"一体的可信数据空间控制台。

**Architecture:** 纯前端(`apps/web`,Next 16 App Router)。atlas 三页 `git mv` 进 `(console)` 组成 `/space/atlas*`,复用 `AuthGate + SpaceNav` 外壳;`QueryClientProvider` 上提到 console 组 layout 覆盖全部 `/space/*`;3 个新页用 cs primitives + 真实控制面 API;`SpaceNav` 分组重排;`/dashboard/*` 服务端重定向到 `/space`;landing 入口改指 `/space`。

**Tech Stack:** Next 16 / React 19 / Tailwind v4 / shadcn / TanStack Query / lucide;cs "Vital Ink" 设计语言(`app/(console)/console.css` + `components/console/ui.tsx`)。

**验证方式(无 web 测试框架):** 每个 chunk 用 `pnpm --filter web build`(类型/编译 + 预渲染)+ `eslint` + **对运行栈的人工/curl 冒烟**(Vault+API+web 已起;API :5021,web :5020)。无 jest/RTL 任务。

**Scope:** 仅本 IA 统一。非目标:不改造现有 space mock 页(总览/连接器/任务/存证/结算)为真实 API;compose 不自动建任务;不动后端。

**前置状态:** 工作区在 `master`,含上一轮 atlas 重皮成 cs 的**未提交改动**;本计划实现期应**先开分支**(`feat/unified-console-ia`)再动手,把这些改动一并纳入。

---

## 文件结构(改动总览)

- `app/(console)/providers.tsx` — 新建:客户端 `QueryClientProvider`(console 组共享)。
- `app/(console)/layout.tsx` — 改:用 `ConsoleProviders` 包裹 `SpaceNav + main`。
- `app/(console)/space/atlas/{page,[layer]/page,compose/page}.tsx` — 由 `app/(atlas)/atlas/*` `git mv` 入;改内部链接 `/atlas*`→`/space/atlas*`。
- `app/(console)/space/atlas/layout.tsx` — 新建:`.codex` + Plex 字体包裹 div + 引 `atlas.css`(不含 provider)。
- `app/(console)/space/atlas/fonts.ts`、`atlas.css` — 由 `app/(atlas)/` 迁入。
- `components/atlas/{verdict-seal,object-editor}.tsx` — 改:`codexFontVars` 导入路径。
- `components/console/space-nav.tsx` — 改:分组重排 + 新增 atlas/compose/catalog/contracts/audit 项。
- `app/(console)/space/{catalog,contracts,audit}/page.tsx` — 新建:3 个联邦页。
- `app/(console)/space/tasks/page.tsx` — 改:加"去编排"链接。
- `app/(landing)/page.tsx` — 改:"控制台"→`/space`、密算入口→`/space/atlas/compose`、footer。
- `app/dashboard/layout.tsx` — 改:服务端 `redirect('/space')`。
- 删除:`app/(atlas)/`(layout/providers/atlas.css 迁出后)、`components/atlas/atlas-nav.tsx`。

---

## Chunk 1: P1 — atlas 并入 space 外壳 + 统一导航 + 互链 + landing

### Task 1: console 组共享 QueryClientProvider

**Files:** Create `app/(console)/providers.tsx`;Modify `app/(console)/layout.tsx`

- [ ] **Step 1:** 写 `providers.tsx`
```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
export function ConsoleProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
```
- [ ] **Step 2:** 在 `layout.tsx` 用 `ConsoleProviders` 包裹 `AuthGate` 内的 `flex` 容器(SpaceNav + main 一并包入)。import `ConsoleProviders`。
- [ ] **Step 3:** `pnpm --filter web build` → 通过(现有 /space 页不使用 query,provider 惰性无影响)。
- [ ] **Step 4:** Commit `feat(console): shared QueryClientProvider at console layout`

### Task 2: 迁移 atlas 三页进 /space/atlas

**Files:** `git mv` `app/(atlas)/atlas/*` → `app/(console)/space/atlas/*`;迁 `fonts.ts`、`atlas.css`;新建 `space/atlas/layout.tsx`;删 `app/(atlas)/{layout,providers}.tsx`

- [ ] **Step 1:** `git mv`:
```bash
mkdir -p "app/(console)/space/atlas"
git mv "app/(atlas)/atlas/page.tsx" "app/(console)/space/atlas/page.tsx"
git mv "app/(atlas)/atlas/[layer]/page.tsx" "app/(console)/space/atlas/[layer]/page.tsx"
git mv "app/(atlas)/atlas/compose/page.tsx" "app/(console)/space/atlas/compose/page.tsx"
git mv "app/(atlas)/fonts.ts" "app/(console)/space/atlas/fonts.ts"
git mv "app/(atlas)/atlas.css" "app/(console)/space/atlas/atlas.css"
git rm "app/(atlas)/layout.tsx" "app/(atlas)/providers.tsx"
```
- [ ] **Step 2:** 新建 `app/(console)/space/atlas/layout.tsx`(无 provider;只提供 .codex 作用域 + 字体 + atlas.css):
```tsx
import "./atlas.css";
import { codexFontVars } from "./fonts";
import { cn } from "@/lib/utils";
export default function AtlasSectionLayout({ children }: { children: React.ReactNode }) {
  return <div className={cn(codexFontVars, "codex")}>{children}</div>;
}
```
- [ ] **Step 3:** 改链接 `/atlas*` → `/space/atlas*`(三页内 `href`:overview 的 `Stratum` `/atlas/${layer}`→`/space/atlas/${layer}`、治理带 `/atlas/compose`→`/space/atlas/compose`;`[layer]` 返回链接 `/atlas`→`/space/atlas`;compose 无外链或同改)。`grep -rn "\"/atlas" app/(console)/space/atlas` 核对清零。
- [ ] **Step 4:** 改 `codexFontVars` 导入路径:`components/atlas/verdict-seal.tsx`、`components/atlas/object-editor.tsx`、`space/atlas/compose/page.tsx` 中 `@/app/(atlas)/fonts` → `@/app/(console)/space/atlas/fonts`。
- [ ] **Step 5:** `pnpm --filter web build` → 通过;`/space/atlas`、`/space/atlas/compose` 出现在路由表。
- [ ] **Step 6:** Commit `feat(console): move atlas into /space/atlas shell`

### Task 3: 删除 atlas 顶栏 + 重排 SpaceNav 分组

**Files:** Delete `components/atlas/atlas-nav.tsx`;Modify `components/console/space-nav.tsx`

- [ ] **Step 1:** `git rm components/atlas/atlas-nav.tsx`(已无引用)。
- [ ] **Step 2:** `space-nav.tsx`:links 改为分组结构 + 新项(import `Layers,Gavel,FileBox,FileSignature,ScrollText` 等 lucide)。三组:
  - 声明面:`{/space/atlas, 能力图谱, Layers}`、`{/space/atlas/compose, 任务编排, Gavel}`
  - 运行面:空间总览/连接器/`{/space/catalog,数据产品,FileBox}`/`{/space/contracts,数字合约,FileSignature}`/RWS任务/存证/结算
  - 审计:`{/space/audit, 审计日志, ScrollText}`
  渲染时按组加一个 `cs-label` 小标题分隔。active 逻辑保持 `startsWith`(注意 `/space` 用精确匹配,`/space/atlas` 与 `/space/atlas/compose` 会双高亮——可接受,或对 compose 用精确)。
- [ ] **Step 3:** `pnpm --filter web build` → 通过。
- [ ] **Step 4:** 冒烟:`curl -s -o /dev/null -w "%{http_code}" http://localhost:5020/space/atlas` → 200;`/space/atlas/compose` → 200。
- [ ] **Step 5:** Commit `feat(console): unified grouped SpaceNav incl. atlas/compose`

### Task 4: tasks↔compose 互链 + landing/footer 改指

**Files:** Modify `app/(console)/space/tasks/page.tsx`、`app/(landing)/page.tsx`

- [ ] **Step 1:** tasks 页头部加一个 `cs-btn-ghost` 链接 `<Link href="/space/atlas/compose">去编排 →</Link>`(放在 PageHeader 的 action 或页内显眼处)。compose 页已有"待裁决"区,加一句 `<Link href="/space/tasks">查看运行中的任务</Link>`。
- [ ] **Step 2:** landing:`/dashboard`→`/space`(第 516 行"控制台");`/dashboard/secretflow`→`/space/atlas/compose`(第 352、521 行"打开密算编排控制台");其余 `/dashboard*` 入口同步。`grep -n "/dashboard" app/(landing)/page.tsx` 核对。
- [ ] **Step 3:** `pnpm --filter web build` → 通过;`grep -rn "/dashboard" app/(landing)` 仅剩有意保留项(无)。
- [ ] **Step 4:** Commit `feat(web): cross-link tasks↔compose; point landing to /space`

---

## Chunk 2: P2 — 三个联邦原生页(真实 API)

> 统一用 cs primitives(`PageHeader`/`Panel`/`Stat`,`@/components/console/ui`)+ TanStack Query(`useQuery`)+ `@/api/client` 的 `api`。错误态参考 atlas:cs-panel + `var(--cs-red)`。

### Task 5: 数据产品目录 /space/catalog

**Files:** Create `app/(console)/space/catalog/page.tsx`

- [ ] **Step 1:** 写页面("use client"):`useQuery(['catalog'], () => api.getDataAssets())` → 列表(`title/name`、`classification`、`recordCount`、`rightsConfirmed`);头部 `PageHeader` + 复用 `PublishProductButton`(`@/components/console/publish-product-button`,内部 invalidate 可改为 `queryClient.invalidateQueries(['catalog'])` 或保留其原刷新);空/错误态;文案注明"原始数据留连接器,中心仅登记元数据"。表格用 `cs-row`。
- [ ] **Step 2:** `pnpm --filter web build` → 通过。
- [ ] **Step 3:** 冒烟:启 web,登录后访问 `/space/catalog`,列表应来自真实 `/catalog`(后端已 seed:`curl http://localhost:5021/api/v1/catalog`)。
- [ ] **Step 4:** Commit `feat(console): /space/catalog data-product registry (real API)`

### Task 6: 数字合约 /space/contracts(接入审核)

**Files:** Create `app/(console)/space/contracts/page.tsx`

- [ ] **Step 1:** 写页面:`useQuery(['contracts'], () => api.getAccessRequests())` → 列表(`purpose`、`status`、`consumer`/`provider`);状态用 cs 色(active/approved→green,expired/revoked→faint/red);`useMutation` 调 `api.approveAccessRequest(id)`(=attest)按需;头部 PageHeader。空/错误态。
- [ ] **Step 2:** `pnpm --filter web build` → 通过。
- [ ] **Step 3:** 冒烟:`/space/contracts` 列表来自 `/contracts`(`curl http://localhost:5021/api/v1/contracts`)。
- [ ] **Step 4:** Commit `feat(console): /space/contracts digital-contract page (real API)`

### Task 7: 审计日志 /space/audit

**Files:** Create `app/(console)/space/audit/page.tsx`

- [ ] **Step 1:** 写页面:`useQuery(['audit', filter], () => api.getAuditLogs(filter))` → `{logs,total}`;列:`timestamp`/`action`/`resource`/`user`;可选 action/resource 过滤输入(`cs-input`);头部 PageHeader,加一句"完整审计;上链存证见 存证账本"链接到 `/space/attestations`。空/错误态。
- [ ] **Step 2:** `pnpm --filter web build` → 通过。
- [ ] **Step 3:** 冒烟:`/space/audit` 来自 `/audit`(`curl "http://localhost:5021/api/v1/audit?limit=5"`)。
- [ ] **Step 4:** Commit `feat(console): /space/audit log viewer (real API)`

---

## Chunk 3: P3 — 退役 dashboard

### Task 8: dashboard 服务端重定向到 /space

**Files:** Modify `app/dashboard/layout.tsx`

- [ ] **Step 1:** 把 `app/dashboard/layout.tsx` 整体替换为服务端重定向(移除原客户端 nav):
```tsx
import { redirect } from "next/navigation";
export default function DashboardLayout(): never {
  redirect("/space");
}
```
> 覆盖所有 `/dashboard/*`。旧 dashboard 页文件暂保留一版本周期(不再可达),后续清理。
- [ ] **Step 2:** `pnpm --filter web build` → 通过(dashboard 路由仍构建但 layout 重定向)。
- [ ] **Step 3:** 冒烟:`curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:5020/dashboard` → 307/308 → `/space`。
- [ ] **Step 4:** Commit `feat(web): retire /dashboard — redirect to /space`

---

## 完成定义(DoD)

- [ ] 登录落 `/space`;侧栏三组(声明/运行/审计)导航齐全可达。
- [ ] `/space/atlas*` 在 console 外壳内正常(七层 CRUD + compose 裁决印记),数据真实。
- [ ] `/space/catalog`、`/space/contracts`、`/space/audit` 列表来自真实 API。
- [ ] tasks ↔ compose 互链;landing"控制台"进 `/space`;`/dashboard/*` 重定向 `/space`。
- [ ] `pnpm --filter web build` 通过;无 lint 错误;旧 `/space` mock 页不受影响。

## 衔接(后续,非本计划)

- 现有 space mock 页(总览/连接器/任务/存证/结算)→ 真实 API 改造。
- 删除遗留 `app/dashboard/**` 页文件。
- compose→RWS 任务的数据级联动(verdict 闸门建任务)。
