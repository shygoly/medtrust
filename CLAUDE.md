# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MedTrust（医疗可信数据空间）— a multi-tenant medical data exchange platform with privacy-preserving computation. Tenants act as data providers, data consumers, platform operators, or technology providers. Built spec-first via OpenSpec.

## Commands

pnpm monorepo (workspaces: `apps/*`, `packages/*`). Run from repo root unless noted.

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
- `apps/api` — NestJS 10 backend (the federated **control plane**). Every domain is a self-contained Nest module wired into `apps/api/src/app.module.ts`: `auth`, `tenant`, `compute-task`, `audit`, `flower`, `security`, `privacy/{fl,mpc,tee}`, `blockchain`, `fhir`, `health`, plus the federated modules `participant-identity` (SM2 CA / dual-auth), `digital-contract` (+`catalog` data products), `settlement` (按贡献分账), `federation` (cross-space). Module folders hold `*.controller.ts` / `*.service.ts` / `dto/`.
- `apps/web` — Next.js (App Router) + React + Tailwind v4 + shadcn/ui + TanStack Query + Zustand. Dashboard routes under `src/app/(dashboard)/`.
- `apps/connector` — NestJS connector deployed on each participant (hospital/pharma) **local** side (port 5022). Holds the de-identified local data; raw rows never leave it. Pure domain services under `src/domain/`: `fhir-gateway`, `deidentifier`, `local-store` (data-not-leaving-domain guard), `rws-executor` (runs in-`tee`), `output-gate` (small-cell suppression + row-level block), `policy-enforcement` (PEP), `retention`, `connector-task-runner`, `rws-orchestrator`. Runnable proofs: `pnpm --filter @medtrust/connector demo` (single-hospital loop) and `demo:e2e` (1 pharma + 2 hospitals).
- `packages/database` (`@medtrust/database`) — TypeORM entities + `AppDataSource`. The API imports `AppDataSource.options` directly in `app.module.ts`, so DB config lives here, not in the API. Also exports the federated **control-plane** entities (`control-plane/`) + **connector-local** entities (`connector/`) and their `ControlPlaneDataSource` / `ConnectorDataSource` (see `data-sources.ts`). Build it (`pnpm --filter @medtrust/database build`) so `dist/` types resolve for ts-jest/consumers.

### Architecture direction: federated data space (in migration)

The project is mid-pivot from a **centralized multi-tenant platform** to a **federated 可信数据空间** (data never leaves the source; only aggregates flow). Authoritative spec: OpenSpec change `openspec/changes/federated-data-space-rws/`. What's built and tested:
- **Connector** (`apps/connector`) — the local node; data-not-leaving-domain guard + in-TEE compute + output gate.
- **Identity** (`apps/api/src/participant-identity/`) — SM2 CA, secure channel (SM2+SM3+sign), dual-auth/rights/classification admission gates.
- **Digital contract + usage control** (`apps/api/src/digital-contract/`) — contract generation/status + hash attestation; the connector's PEP enforces contracts.

The **old centralized modules have been removed** (`data-asset` aggregation + `access-request` one-shot approval, tasks 8.1/8.2 done). Authorization is the federated path: `catalog` (data products) + `digital-contract` (digital contracts enforced by the connector PEP). `compute-task` keeps a vestigial `requestId` column but no relation to the removed entities. New work follows the connector/contract model.

**Database is SQLite** (`better-sqlite3`, file at `DATABASE_URL` or `./data/medtrust.db`). `synchronize` is ON whenever `NODE_ENV !== 'production'` — schema auto-syncs in dev; migrations only matter for prod. Note `docker-compose.yml` also defines Postgres, but the running DataSource is SQLite.

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
- `blockchain/` — FISCO BCOS attestation (Solidity contracts compiled with `solc`).

## OpenSpec workflow

This repo is spec-driven. Specs and change sets live in `openspec/` (`proposal.md`, `changes/<change-name>/`, `config.yaml` with `schema: spec-driven`). Before implementing a feature, check for a matching change set in `openspec/changes/`. Use the `openspec-*` / `opsx:*` skills (new-change, apply-change, verify-change, archive-change) to drive the lifecycle rather than editing specs ad hoc.

## Deployment

Deployed to Fly.io as **medtrust-lite** (https://medtrust-lite.fly.dev), sin region. The lite stack and per-service Dockerfiles/toml are under `fly-services/lite/` (`deploy.sh`, `Dockerfile.api`, mpc/fate/fisco variants). See `DEPLOYMENT_RESULT.md` for live service URLs and demo accounts.

## Notes / known discrepancies

Docs in this repo drifted from the code. Trust the code:

- **The Fly deployment is NOT this codebase.** `medtrust-lite` does not run `apps/api` (NestJS) or `apps/web` (Next.js). `fly-services/lite/Dockerfile.api` embeds a ~950-line inline Express **mock** server (heredoc into `/app/index.js`, faker-generated data) that serves the static demo at `fly-services/lite/web/index.html`. README/DEPLOYMENT_RESULT describe this as "the frontend/API" — it is a standalone demo, independent of the real apps.
- **`apps/api/src/main.ts:16` calls `app.useGlobalPipe(...)`** — the real method is `useGlobalPipes` (plural). This won't compile/run; the real API has apparently never been booted (the Fly stack uses the mock above instead). Fix before relying on the NestJS app locally.
- README references `packages/shared` (`@medtrust/shared`) — it does not exist. Only `packages/database` is present.
- README lists Next 14 / React 18, but `apps/web` runs Next 16 / React 19.
- `apps/web` carries its own `package-lock.json` (npm artifact) inside the pnpm workspace — install/build web through pnpm from root.
- `docker-compose.yml` defines Postgres, but the active `AppDataSource` is SQLite (Postgres is unused).
