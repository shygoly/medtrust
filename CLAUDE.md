# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MedTrust（医疗可信数据空间）— a multi-tenant medical data exchange platform with privacy-preserving computation. Tenants act as data providers, data consumers, platform operators, or technology providers. Built spec-first via OpenSpec.

## 治理根契约（八件套，机器校验，必读）

改代码前按对象路由到对应契约，**只读对应 `##` 小节（切片读，勿全文加载）**；改动必须同步契约并跑 `node scripts/check-meta-docs.mjs`（已前置进根 `pnpm test`，违反 = 红）：

- **[DOMAIN.md](./DOMAIN.md)** — 实体/关系/公式/状态词汇。改任何实体、`runtime/` 服务、connector/agent 域逻辑前必读；覆盖矩阵与 `@Entity` 全表对拍，双平面（control-plane / connector-local）一表一平面。
- **[FLOWS.md](./FLOWS.md)** — 跨域任务链。每步声明 `crosses`（跨域边）× `payload`（数据分级）；红线：`raw-local` 不得出现在任何跨域边。
- **[DECISIONS.md](./DECISIONS.md)** — 不可逆决策登记（D1–D12 + D-AREA-NN）；代码里的决策标记必须在册。
- **[TRUST.md](./TRUST.md)** — 安全∪合规控制点（CTL-x）+ 敏感字段分级表（与 `@EncryptedColumn`/`@Masked` 双向对拍）+ 红线清单。碰敏感字段/闸门/国密/存证前必读。
- **[EVIDENCE.md](./EVIDENCE.md)** — 研究效度契约（EVD-x），对齐药监《RWD 支持药品安全性主动监测的研究设计和分析指导原则》。改 RWS 任务规格字段（`TteSpec`/`RwsAnalysis`）前必读 §1 覆盖矩阵对应行。**与 TRUST 分工**：TRUST 管数据可信（泄露/虚标），EVIDENCE 管结论可信（偏倚/p-hacking）。
- **[AGENT.md](./AGENT.md)** — 智能体治理（AGT-x）。**按平面划分，不按角色**：新增任何 agent 或 LLM 调用点前必读五条硬规矩；连接器平面 agent 一律禁止（R1），LLM 客户端调用点未登记 = 红；仓外运行时（`external-runtime`）反向对拍失效，须补 R5 三件套。
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — 结构/边界/部署唯一权威；**[DESIGN.md](./DESIGN.md)** — UI 唯一事实源。
- 技术债 `TD-x` 归 `docs/tech-debt.md`；命名空间 `D-x` / `INV-x` / `CTL-x` / `EVD-x` / `FLOW-x` / `AGT-x` / `TD-x` 正交，禁止混用。

## Commands

pnpm monorepo (workspaces: `apps/*`, `packages/*`). Run from repo root unless noted.

> **运行时基线：Node 20**（`.node-version` = 20.20.1；`fly-services/*/Dockerfile*` 与 `.github/workflows` 同为 20）。
> `better-sqlite3` 是原生模块，ABI 与 Node 版本绑定，换 Node 后必须重新 `pnpm install`。
> `pnpm dev` / `pnpm build` 前置跑 `pnpm check:runtime`（R1 engines.node、R2 真实 dlopen），不符即给修法。

```bash
pnpm install                       # install all workspaces
pnpm dev                           # run api + web in parallel
pnpm --filter api dev              # NestJS watch mode  → :5021 (prefix /api/v1, docs at /api/docs)
pnpm --filter web dev              # Next.js dev        → :5020
pnpm build / pnpm test / pnpm lint # fan out to every workspace

# Database (packages/database) — TypeORM CLI is path-relative, so cd in first:
cd packages/database && pnpm migration:run
cd packages/database && pnpm migration:generate <name>

# API tests (Jest, *.spec.ts colocated under src/)
cd apps/api && pnpm test
cd apps/api && pnpm test -- auth.service          # single file / pattern
cd apps/api && pnpm test:e2e

# Local infra
docker-compose up -d vault         # HashiCorp Vault (dev token: dev-token-12345) → :8200
```

**Port convention: 5020–5029.** Port 3000 is taken by another local project, so this repo uses the 5020–5029 range. Frontend = **5020**, backend API + WS = **5021**. Pick from 5022–5029 for any additional services (connectors, chain nodes, etc.). Configured in `apps/web/package.json` (`next dev -p 5020`), `apps/api/src/main.ts` (`PORT || 5021`, CORS origin `localhost:5020`), and the web→API defaults in `apps/web/src/api/{client,websocket}.ts`.

## Architecture

Three workspaces:
- `apps/api` — NestJS 10 backend (the federated **control plane**). Every domain is a self-contained Nest module wired into `apps/api/src/app.module.ts`: `auth`, `tenant`, `compute-task`, `audit`, `flower`, `security`, `privacy/{fl,mpc,tee}`, `blockchain`, `fhir`, `health`, plus the federated modules under `src/runtime/`: `participant-identity` (SM2 CA / dual-auth), `digital-contract` (+`catalog` data products), `rws-orchestrator` / `fl-orchestrator`（RWS/FL 阶梯编排）, `settlement` (按贡献分账), `federation` (cross-space). Module folders hold `*.controller.ts` / `*.service.ts` / `dto/`.
- `apps/web` — Next.js (App Router) + React + Tailwind v4 + shadcn/ui + TanStack Query + Zustand. Dashboard routes under `src/app/(dashboard)/`.
- `apps/connector` — NestJS connector deployed on each participant (hospital/pharma) **local** side (port 5022). Holds the de-identified local data; raw rows never leave it. Pure domain services under `src/domain/`: `fhir-gateway`, `deidentifier`, `local-store` (data-not-leaving-domain guard), `rws-executor` (runs in-`tee`), `output-gate` (small-cell suppression + row-level block), `policy-enforcement` (PEP), `retention`, `connector-task-runner`, `rws-orchestrator`. Runnable proofs: `pnpm --filter @medtrust/connector demo` (single-hospital loop) and `demo:e2e` (1 pharma + 2 hospitals).
- `packages/database` (`@medtrust/database`) — TypeORM entities + `AppDataSource`. The API imports `AppDataSource.options` directly in `app.module.ts`, so DB config lives here, not in the API. Also exports the federated **control-plane** entities (`control-plane/`) + **connector-local** entities (`connector/`) and their `ControlPlaneDataSource` / `ConnectorDataSource` (see `data-sources.ts`). Build it (`pnpm --filter @medtrust/database build`) so `dist/` types resolve for ts-jest/consumers.

### Architecture direction: federated data space (in migration)

The project is mid-pivot from a **centralized multi-tenant platform** to a **federated 可信数据空间** (data never leaves the source; only aggregates flow). Authoritative spec: OpenSpec change `openspec/changes/archive/2026-07-21-federated-data-space-rws/`. What's built and tested:
- **Connector** (`apps/connector`) — the local node; data-not-leaving-domain guard + in-TEE compute + output gate.
- **Identity** (`apps/api/src/participant-identity/`) — SM2 CA, secure channel (SM2+SM3+sign), dual-auth/rights/classification admission gates.
- **Digital contract + usage control** (`apps/api/src/digital-contract/`) — contract generation/status + hash attestation; the connector's PEP enforces contracts.

The **old centralized modules have been removed** (`data-asset` aggregation + `access-request` one-shot approval, tasks 8.1/8.2 done). Authorization is the federated path: `catalog` (data products) + `digital-contract` (digital contracts enforced by the connector PEP). `compute-task` keeps a vestigial `requestId` column but no relation to the removed entities. New work follows the connector/contract model.

**主库按 `DATABASE_URL` 二选一**：`postgres(ql)://` 前缀 → Postgres（生产 ali29 与本机对齐生产时都是这条），否则 better-sqlite3 文件（默认 `./data/medtrust.db`）。`packages/database` 另有两个**固定 SQLite** 的连接：`ControlPlaneDataSource`（`./data/control-plane.db`，生产也在用）与 `ConnectorDataSource`（`./data/connector-local.db`，数据不出域）。`synchronize` 在 `NODE_ENV !== 'production'` 时为 ON —— 生产镜像恰好是 `NODE_ENV=development`，schema 也靠它同步；`migrations/` 目前为空。

**本机 env 文件是 `apps/api/.env`**（`process.cwd()/.env`），由 `apps/api/src/load-env.ts` 在 `app.module.ts` 的**第一个 import** 处用 dotenv 加载 —— 必须早于 `@medtrust/database`（它在模块导入期就把 `DATABASE_URL` 冻结进 `DataSource.options`，晚了就静默退回 SQLite）。dev / e2e / `admin-role.cli` 都覆盖这一处。

**Entity registration is split**: `packages/database/src/data-source.ts` registers only the 6 core entities (Tenant, User, DataAsset, DataAccessRequest, ComputeTask, AuditLog). The flower / privacy / blockchain entities exist as files and are loaded by their own feature modules. When adding a core entity, register it in `data-source.ts`; for feature entities, follow the pattern in that feature's module.

### Security (国密 / 等保 compliance)
`apps/api/src/security/` is central:
- `crypto/gm-crypto.service.ts` — SM2/SM3/SM4 (China national crypto standards) via `sm-crypto`.
- `vault/` — HashiCorp Vault key management with 5-min key cache.
- `decorators/` — `@EncryptedColumn('<key-id>')` for column-level encryption at rest, `@Masked('<type>')` for automatic API-response masking. Apply these on entity/DTO fields rather than encrypting/masking by hand.

### Privacy computing
- `privacy/fl` + `flower/` — Flower federated learning (external FATE/Flower services).
- `privacy/mpc` — secure multi-party computation (MP-SPDZ gateway).
- `privacy/tee` — trusted execution.
- `blockchain/` — 长安链 ChainMaker attestation（Java sidecar `fly-services/chain-sdk`；原 FISCO BCOS 已弃，见 DECISIONS D-RWS-3）.

## OpenSpec workflow

This repo is spec-driven. Specs and change sets live in `openspec/` (`proposal.md`, `changes/<change-name>/`, `config.yaml` with `schema: spec-driven`). Before implementing a feature, check for a matching change set in `openspec/changes/`. Use the `openspec-*` / `opsx:*` skills (new-change, apply-change, verify-change, archive-change) to drive the lifecycle rather than editing specs ad hoc.

## Deployment

Deployed to Fly.io as **medtrust-lite** (https://medtrust-lite.fly.dev), sin region. The lite stack and per-service Dockerfiles/toml are under `fly-services/lite/` (`deploy.sh`, `Dockerfile.api`, mpc/fate/fisco variants). See `DEPLOYMENT_RESULT.md` for live service URLs and demo accounts.

## Notes / known discrepancies

> **架构权威以 [ARCHITECTURE.md](./ARCHITECTURE.md) 为准，UI 以 [DESIGN.md](./DESIGN.md) 为准。**
> 下述 discrepancies 中，"The Fly deployment is NOT this codebase"（称 Fly 全是 mock）已过时——real services 栈（medtrust-web/api/chain/connector-a/b 等）已上线，lite 栈已下线，详见 ARCHITECTURE.md §6。其余条目仍有效。

Docs in this repo drifted from the code. Trust the code:

Docs in this repo drifted from the code. Trust the code:

- **The Fly deployment is NOT this codebase.** `medtrust-lite` does not run `apps/api` (NestJS) or `apps/web` (Next.js). `fly-services/lite/Dockerfile.api` embeds a ~950-line inline Express **mock** server (heredoc into `/app/index.js`, faker-generated data) that serves the static demo at `fly-services/lite/web/index.html`. README/DEPLOYMENT_RESULT describe this as "the frontend/API" — it is a standalone demo, independent of the real apps.
- ~~**`apps/api/src/main.ts:16` calls `app.useGlobalPipe(...)`**~~ —— **已作废（2026-10-12 实测）**：第 16 行是 `bodyParser: false`，全局管道在 `main.ts:46` 用的是 `useGlobalPipes`（复数）。`pnpm --filter api build` 通过，服务可启动（`Nest application successfully started`，`GET /api/v1/health` = 200）。
- README references `packages/shared` (`@medtrust/shared`) — it does not exist. Only `packages/database` is present.
- README lists Next 14 / React 18, but `apps/web` runs Next 16 / React 19.
- `apps/web` carries its own `package-lock.json` (npm artifact) inside the pnpm workspace — install/build web through pnpm from root.
- `docker-compose.yml` 里的 Postgres 服务没人用：生产主库是容器内的 Postgres（`DATABASE_URL`），而 `ControlPlaneDataSource` / `ConnectorDataSource` 仍是 SQLite 文件。
