## Why

The federated control-plane — the project's strategic layer (data-product catalog, digital
contracts, value settlement, cross-space federation, participant identity) — plus auth users
run entirely on in-memory `Map`s (`apps/api/src/runtime/*/*.service.ts`,
`apps/api/src/auth/auth.service.ts`). All of it resets on every process restart: published
data products, signed contracts, settlement ledgers, federation trust, and registered
participants are lost.

The control-plane *does* have scaffolding, but it is **orphaned and misaligned**:
`packages/database/src/control-plane/index.ts` defines TypeORM entities
(`Participant`, `Certificate`, `DatasetMetadata`, `UsagePolicy`, `AttestationRef`) plus a
dedicated `ControlPlaneDataSource` — yet **nothing in `apps/api/src` references either**
(zero imports of `controlPlaneEntities`/`ControlPlaneDataSource`). The running `AppDataSource`
registers only `Tenant`, `User`, `ComputeTask`, `AuditLog`. Worse, the services consume the
*interfaces* from that same file (e.g. `DigitalContract`, `DataProduct`) as in-memory shapes,
while the *entities* model a different, older split (`DatasetMetadata`/`UsagePolicy` instead of
`DataProduct`/`DigitalContract`), and there is **no entity at all** for settlement records or
federation trust. So no federated service injects a repository.

This is an inversion: the deprecated-direction modules (audit, compute-task, capability,
flower, privacy, blockchain) persist correctly through TypeORM, while the strategic federated
layer the project is migrating *toward* does not. The frontend console
(`/space/{catalog,contracts,settlements,connectors}`) already consumes these endpoints as if
they were durable. For an 等保/可信数据空间 system, an ephemeral control-plane also breaks
auditability and the settlement ledger's integrity claims.

## What Changes

- Reconcile and complete the control-plane entity model in
  `packages/database/src/control-plane/` so entities match the services' real shapes:
  `DataProduct`, `DigitalContract`, `SettlementRecord` + `SettlementLine`, `FederationTrust` +
  `RemoteCatalogEntry`, `ParticipantIdentity`/`Certificate` — replacing/aligning the orphaned
  `DatasetMetadata`/`UsagePolicy` pair and adding the missing settlement/federation entities.
  Keep the shared TS interfaces as the DTO/transport shape.
- Wire the control-plane entities into the API's running connection (fold
  `controlPlaneEntities` into `AppDataSource`, or connect the dedicated `ControlPlaneDataSource`
  — decided in design.md), retiring the orphaned/unreferenced scaffolding.
- Rewire the in-memory services (catalog, digital-contract, settlement, federation,
  participant-identity, auth) to read/write through repositories. The DB becomes the single
  system of record. Public REST contracts (endpoints + DTOs) stay identical.
- Convert constructor seeding into **idempotent upsert** seeds (demo data products / demo
  users) so dev demos keep working without clobbering real rows on restart.
- Register the new control-plane entities under the project's split-registration convention
  and add **migrations** for production (`synchronize` is dev-only).
- **JWT hardening (附带):** remove the `'default-secret'` hardcoded fallback (fail-fast when
  `JWT_SECRET` is unset in production), and add refresh-token issuance + rotation with bounded
  access/refresh expiry. **BREAKING (ops):** production deploys must set `JWT_SECRET`.

## Capabilities

### New Capabilities
- `control-plane-persistence`: the federated control-plane (data products, digital contracts,
  settlement records, federation trust + remote catalog, participant identities) and auth
  identities are durably stored via TypeORM, are the system of record, survive process
  restart, and are seeded idempotently.
- `auth-session-hardening`: the JWT signing secret is required (no insecure fallback;
  fail-fast in production) and sessions support refresh-token rotation with bounded expiry.

### Modified Capabilities
None. There is no archived `openspec/specs/` directory yet; the federated capabilities
(`data-product`, `digital-contract`, `value-settlement`, `space-interconnect`,
`participant-identity`) currently exist only inside the `federated-data-space-rws` change and
are not yet archived, so they are referenced as context rather than modified here.

## Impact

- **Code:** `apps/api/src/runtime/{catalog,settlement,federation,digital-contract,participant-identity}`,
  `apps/api/src/auth/*`; `packages/database/src/control-plane/index.ts` (reconcile entities) +
  `data-source.ts` / `data-sources.ts` (wire control-plane into the API connection,
  retire orphaned scaffolding); `apps/api/src/app.module.ts`; new migration files.
- **Data:** introduces real control-plane tables; demo seed becomes upsert. SQLite dev
  auto-syncs (`synchronize` on); prod requires the new migrations.
- **APIs:** external REST contracts unchanged (same routes/DTOs); behavior shifts from
  ephemeral → durable. Auth gains a `POST /auth/refresh` endpoint.
- **Risk:** seed idempotency must not overwrite user-modified rows; settlement and federation
  hold relational/derived data needing FK modeling; JWT change requires an ops checklist
  (`JWT_SECRET` must be set) to avoid a prod boot failure being mistaken for a regression.
