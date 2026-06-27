## 1. Entity model + datasource wiring (foundation)

- [x] 1.1 Reconcile `packages/database/src/control-plane/index.ts`: add `DataProduct` (replaces `DatasetMetadata`), `DigitalContract` entity (replaces `UsagePolicy`), `SettlementRecord` + `SettlementLine` (1—N), `FederationTrust` + `RemoteCatalogEntry`, `CaKeypair`, `ParticipantIdentity` (revive `Participant`), `Certificate` (revive as issued-cert registry with a `revoked` flag); keep `AttestationRef`; drop `DatasetMetadata`/`UsagePolicy`. Cross-plane refs as plain id columns, intra-plane as FK relations (D3, D4).
- [x] 1.2 Update `controlPlaneEntities` export; verify zero `apps/api/src` references to the removed `DatasetMetadata`/`UsagePolicy` before deleting (re-grep).
- [x] 1.3 Keep the shared TS interfaces (`DataProduct`, `DigitalContract`, …) as DTO/transport types; export both entity and interface.
- [x] 1.4 Build `@medtrust/database` (`pnpm --filter @medtrust/database build`) so `dist/` types resolve.
- [x] 1.5 Wire a second named connection in `apps/api/src/app.module.ts`: `TypeOrmModule.forRootAsync({ name: 'controlplane', useFactory: () => ({ ...ControlPlaneDataSource.options }) })` (D1). Confirm `control-plane.db` is created on boot.

## 2. Catalog persistence

- [x] 2.1 `catalog.module`: `TypeOrmModule.forFeature([DataProduct], 'controlplane')`.
- [x] 2.2 Rewrite `catalog.service` from `products` Map to `@InjectRepository(DataProduct, 'controlplane')`; keep `list/get/publish` signatures + DTO shape unchanged.
- [x] 2.3 Verify: publish a product → restart API → `GET /catalog` still returns it (spec: *Published product survives restart*); read is served from DB (spec: *Catalog read is served from the database*).

## 3. Digital-contract persistence

- [x] 3.1 `digital-contract.module`: `forFeature([DigitalContract], 'controlplane')`.
- [x] 3.2 Rewrite `contract.service` (and `attestation.service` consumers) Map→repo; preserve SM3 `hash` on persist.
- [x] 3.3 Verify: create contract → restart → retrievable with same hash; status transition persisted and observed on next read (spec scenarios under *Durable digital contracts*).

## 4. Settlement persistence

- [x] 4.1 `settlement.module`: `forFeature([SettlementRecord, SettlementLine], 'controlplane')`.
- [x] 4.2 Rewrite `settlement.service` Map→repo; persist record + N lines; append-only (no in-place amount mutation) (D3, spec *Durable settlement ledger*).
- [x] 4.3 Verify: create record with N lines → restart → all N lines retrievable with identical amounts/contributions.

## 5. Federation persistence

- [x] 5.1 `federation.module`: `forFeature([FederationTrust, RemoteCatalogEntry], 'controlplane')`.
- [x] 5.2 Rewrite `federation.service` (`trust` + `remoteCatalog` Maps)→repos.
- [x] 5.3 Verify: establish trust + cache remote catalog → restart → CA key and cached catalog still present (spec *Durable federation trust and remote catalog*).

## 6. Participant registry + CA persistence (identity)

- [x] 6.1 `participant-identity.module`: `forFeature([CaKeypair, ParticipantIdentity, Certificate], 'controlplane')`.
- [x] 6.2 `CaService`: on bootstrap, load the CA SM2 keypair for its `spaceId` from `CaKeypair` repo, or generate-and-persist if absent (stop regenerating per boot); `issue()` records the issued `Certificate`; `revoke(fingerprint)` sets that row's `revoked` flag; `verify()` checks the persisted flag.
- [x] 6.3 `ParticipantRegistryService`: `admit()` / `registerConnector()` persist the `ParticipantIdentity` (org + dual-auth state) and its issued `Certificate` (write-through; keep the existing gate validations).
- [x] 6.4 Verify: admit participant + issue cert → restart → both retrievable and cert verifies; revoke → restart → still revoked (spec *Durable participant registry and CA*).

## 7. Auth user persistence (default connection)

- [x] 7.1 Rewrite `auth.service` `users` Map → existing `User` repository on the **default** connection (D2); map current in-memory user shape onto `User` (email/passwordHash/participantId/participantRole).
- [x] 7.2 Verify: register a user → restart → same credentials still authenticate (spec *Durable user accounts*).

## 8. JWT hardening + refresh tokens

- [x] 8.1 Add a `getJwtSecret()` helper; replace the three `JWT_SECRET || 'default-secret'` sites (`auth.service`, `auth.module`, `jwt.strategy`). Production throws at startup if unset; dev uses a logged ephemeral secret (D6).
- [x] 8.2 Verify: boot with `NODE_ENV=production` and no `JWT_SECRET` → startup aborts with a clear error (spec *Production boot without a secret fails fast*).
- [x] 8.3 Add `RefreshToken` entity on the default connection (hash + userId + expiry + revoked); register via `forFeature`.
- [x] 8.4 Issue access (short TTL) + refresh (bounded TTL) on login; add `POST /auth/refresh` that rotates (new pair, invalidate presented token) and `logout` that revokes (specs under *Refresh-token rotation*, *Bounded and revocable sessions*).
- [x] 8.5 Verify: refresh returns new pair + rejects reused refresh token; logout blocks further refresh; expired refresh requires re-login.

## 9. Idempotent seeding

- [x] 9.1 Move constructor seeds (demo data products, demo users) to an `onApplicationBootstrap` upsert keyed on natural key (product `urn`, user `email`); insert-if-absent, never overwrite (D5).
- [x] 9.2 Verify: boot twice against seeded DB → no duplicate rows; modify a seeded row → reboot → modification preserved (specs under *Idempotent demo seeding*).

## 10. Migrations + ops

- [ ] 10.1 Add a TypeORM CLI datasource file + `migrations` config for `ControlPlaneDataSource`; generate the initial control-plane migration.
- [ ] 10.2 Generate the core migration for `RefreshToken`.
- [ ] 10.3 Update ops docs / `mem:suggested_commands`: `CONTROL_PLANE_DB_URL`, `JWT_SECRET` required in prod, control-plane migration command.

## 11. Verification

- [x] 11.1 `cd apps/api && pnpm test` (unit/spec for the rewired services + auth refresh) and `pnpm lint`.
- [x] 11.2 Full restart smoke: publish product / sign contract / record settlement / register participant → restart API → all survive; control-plane tables hold metadata only, no raw rows (spec *Control plane stores metadata only*).
- [x] 11.3 `openspec validate persist-federated-control-plane` passes; run `openspec verify` workflow before archiving.
