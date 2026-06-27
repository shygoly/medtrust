## Context

The federated control-plane services (`catalog`, `digital-contract`, `settlement`,
`federation`, `participant-identity`) and `auth` hold all state in process-local `Map`s.
`packages/database` already ships a dedicated `ControlPlaneDataSource`
(`better-sqlite3` → `control-plane.db`, `synchronize` in dev) and a `controlPlaneEntities`
set — but both are **orphaned** (zero references from `apps/api/src`), and the entity model
(`DatasetMetadata`/`UsagePolicy`/`Participant`/`Certificate`/`AttestationRef`) predates and
diverges from the shapes the services actually use (`DataProduct`, `DigitalContract`,
`SettlementRecord`, federation trust). The running API wires only the default `AppDataSource`
(`Tenant`/`User`/`ComputeTask`/`AuditLog`); notably a `User` entity already exists there with
`email`/`passwordHash`/`participantId`/`participantRole`, yet `auth.service` ignores it.

Constraint: per the chosen strategy, the control-plane persists to its **own datasource**
(D7 physical separation), wired as a second named TypeOrm connection in the single API process.

## Goals / Non-Goals

**Goals:**
- Federated control-plane state + auth users are durable and survive restart (see
  `control-plane-persistence`, `auth-session-hardening` specs).
- Control-plane metadata lives in the dedicated `ControlPlaneDataSource` (`control-plane.db`).
- REST contracts (routes + DTOs) are unchanged; only persistence changes.
- Demo seed is idempotent.

**Non-Goals:**
- No move off SQLite; no Postgres.
- No change to the connector-local store or to raw-data handling.
- No full multi-process/multi-host D7 deployment — only the separate datasource + connection
  inside the existing API process.
- No REST API/DTO redesign.

## Decisions

### D1 — Two named TypeOrm connections
Keep the default connection for core entities; add a **named `'controlplane'` connection** from
`ControlPlaneDataSource.options`. `app.module.ts` gains a second
`TypeOrmModule.forRootAsync({ name: 'controlplane', … })`. Federated feature modules register
`TypeOrmModule.forFeature([...], 'controlplane')` and services inject
`@InjectRepository(Entity, 'controlplane')`.
*Alternative considered:* fold control-plane entities into `AppDataSource` (one connection) —
simpler, but abandons D7's physical isolation; rejected per the chosen strategy.

### D2 — Auth users on the **default** connection, not control-plane
Auth user accounts map onto the existing `User` entity in `AppDataSource` (fields already
present). `auth.service` is rewired from its `Map` to the `User` repository on the default
connection. Only **federated** identities (`ParticipantIdentity` + `Certificate`) live in the
control-plane datasource.
*Rationale:* users/tenants are core platform identity, already modeled and registered; the
control-plane datasource is for federated metadata. Avoids a needless cross-DB move.

### D3 — Reconcile the control-plane entity model
In `packages/database/src/control-plane/`, align entities to service shapes:
- `DataProduct` (replaces `DatasetMetadata`): title, urn, providerId, classification,
  rightsConfirmed, recordCount, fhirSchema (json).
- `DigitalContract` (replaces `UsagePolicy`; the file already notes this split): dataProductId,
  providerId, consumerId, purpose, retention, output, validUntil, status, hash.
- `SettlementRecord` 1—N `SettlementLine` (new): the per-provider 按贡献 ledger.
- `FederationTrust` + `RemoteCatalogEntry` (new): per-space CA key + cached remote catalog.
- `CaKeypair` (new): the central CA's own SM2 root keypair, persisted per `spaceId` so it is
  loaded-or-created on boot instead of regenerated — otherwise every restart invalidates all
  previously issued certificates.
- `ParticipantIdentity` (revive the orphaned `Participant`): registered participants + dual-auth
  state (org, role, region, subjectVerified, dataVerified).
- `Certificate` (revive the orphaned `Certificate`, used as an **issued-cert registry**):
  participantId, connectorId, sm2Fingerprint, validUntil, `revoked` flag, issuedAt. Revocation =
  setting `revoked` (no separate CRL entity).
- Keep `AttestationRef`. Drop only the superseded `DatasetMetadata`/`UsagePolicy`.
NOTE: this ADDS write-through persistence to two methods that are currently pure gates —
`CaService.issue()` records the issued cert; `ParticipantRegistryService.admit()`/
`registerConnector()` record the participant + cert. New public read endpoints
(e.g. `GET /participants`) are out of scope here (follow-up; the connectors page still uses mock).
The shared TS `interface`s (`DataProduct`, `DigitalContract`, …) remain the **DTO/transport**
shape; services map entity ↔ DTO at the boundary so controllers/REST stay identical.

### D4 — Cross-plane references are soft (no DB FK across datasources)
`DigitalContract.consumerId`/`providerId` point at users/participants that may live in a
different datasource. Model these as plain id columns (string), enforced in the app layer — not
TypeORM relations. Intra-datasource relations (SettlementRecord→Line, Certificate→Participant)
use real FKs.

### D5 — Idempotent seeding via bootstrap upsert
Replace constructor seeding with an `onApplicationBootstrap` seed that upserts on a **stable
natural key** (product `urn`, user `email`, participant id) and only inserts when absent — never
overwrites existing rows. Dev demo data is preserved without duplication across restarts.

### D6 — JWT hardening
- A single `getJwtSecret()` helper replaces the three `JWT_SECRET || 'default-secret'` sites
  (`auth.service`, `auth.module`, `jwt.strategy`). In production a missing secret throws at
  startup; in dev it may use a clearly-logged ephemeral secret.
- Add refresh tokens: login returns access (short TTL) + refresh (bounded TTL). `POST
  /auth/refresh` rotates (issues new pair, invalidates the presented refresh token). Refresh
  state is persisted as a `RefreshToken` entity on the **default** connection (hash + userId +
  expiry + revoked); logout revokes.

### D7 — Migrations
Dev relies on `synchronize` on both datasources (no manual step). For production, add a
`migrations` set for `ControlPlaneDataSource` (its own TypeORM CLI datasource file, since the
CLI is path-relative) and a core migration for the new `RefreshToken`. Document in
`mem:suggested_commands` once landed.

## Risks / Trade-offs

- **Cross-datasource integrity** → can't FK a contract to a user across DBs. Mitigation: soft id
  refs + app-layer validation (D4).
- **Two connections / two db files** → more wiring + a second migration set. Accepted as the
  cost of D7 physical isolation.
- **Seed clobbering user edits** → mitigated by insert-if-absent on natural keys (D5).
- **Orphaned-entity removal** → replacing `DatasetMetadata`/`UsagePolicy` is safe only because
  nothing references them; verified zero API imports. Re-grep before deleting.
- **JWT prod break** → removing the fallback makes an unset `JWT_SECRET` fail boot. Mitigation:
  ship an ops checklist + clear startup error; it is intentional (**BREAKING**).
- **No Map fallback after switch** → rollback = redeploy previous build; control-plane.db is
  separate and can be dropped without touching the core db.

## Migration Plan

1. Land entity reconciliation + datasource wiring behind no API change; dev auto-syncs.
2. Switch each service Map→repo incrementally (catalog → contract → settlement → federation →
   participant-identity → auth), with its spec scenarios as tests.
3. Add JWT refresh + secret fail-fast; set `JWT_SECRET` in all envs.
4. Prod: provision `CONTROL_PLANE_DB_URL`, run control-plane + core migrations, deploy.
Rollback: redeploy prior build; drop `control-plane.db` if needed.

## Open Questions

- Refresh-token store: proposed `RefreshToken` entity on default connection — confirm vs a
  stateless rotating-jti scheme.
- Remove `DatasetMetadata`/`UsagePolicy`/`AttestationRef` outright vs keep deprecated — proposed
  remove the first two (orphaned), keep `AttestationRef` (attestation index).
