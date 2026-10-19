## 1. OpenSpec and compatibility audit

- [x] 1.1 Create the PostgreSQL-only persistence change set.
- [x] 1.2 Inventory every production SQLite opener and classify runtime vs test-only use.
- [x] 1.3 Update `ARCHITECTURE.md`, `DECISIONS.md`, `DEPLOY.md`, `DOMAIN.md` and `AGENTS.md`
  where they assert SQLite-first production behavior.

## 2. Portable data sources and schema

- [x] 2.1 Make `ControlPlaneDataSource` honor `CONTROL_PLANE_DB_URL` and require PostgreSQL in
  production.
- [x] 2.2 Make `ConnectorDataSource` honor `CONNECTOR_DB_URL` and require PostgreSQL in
  production.
- [x] 2.3 Remove SQLite-only `datetime` declarations from control-plane and connector entities.
- [x] 2.4 Verify TypeORM metadata builds for PostgreSQL without database connection.
- [x] 2.5 Generate/apply PostgreSQL migrations for control-plane and connector schemas.

## 3. Control plane cutover

- [x] 3.1 Add a SQLite-to-PostgreSQL export/import script with table allowlists and dry-run.
- [x] 3.2 Add parity checks for row counts, primary keys, CA public key, contract hashes and
  signatures, grants, MDOP state and receipts.
- [x] 3.3 Rehearse against `medtrust_controlplane_test`.
- [x] 3.4 Back up the ali29 control-plane SQLite volume and pre-change API image.

## 4. Connector-local cutover

- [x] 4.1 Provision independent connector databases and users.
- [x] 4.2 Remove production SQLite dependency from connector images/runtime checks.
- [x] 4.3 Migrate connector A/B/C local contracts, artifacts, nonce and audit state.
- [x] 4.4 Verify network access is limited to each connector's own database.
- [x] 4.5 Verify local contract PEP and long-poll execution after cutover.

## 5. Chat-agent sessions

- [x] 5.1 Add PostgreSQL session repository and configuration.
- [x] 5.2 Remove SQLite session driver from the production image.
- [x] 5.3 Verify create/list/read/delete session parity and production health.

## 6. Build and deployment

- [x] 6.1 Remove better-sqlite3 from production dependency and image paths.
- [x] 6.2 Update ali29 compose/env templates for PostgreSQL URLs and credentials.
- [x] 6.3 Build API, web, chat-agent and connector images tagged for the cutover.
- [x] 6.4 Rehearse the full stack in the isolated test environment.
- [x] 6.5 Deploy to ali29 in dependency order and recreate containers.

## 7. Acceptance and rollback

- [x] 7.1 Control-plane CA public key is unchanged and all existing certificates verify.
- [x] 7.2 Existing active contracts and access grants are reused.
- [x] 7.3 A contract request, provider signature and MDOP job complete on PostgreSQL.
- [x] 7.4 Restart API and connectors; all state persists.
- [x] 7.5 No production container has an open `.db` file.
- [x] 7.6 Run meta, governance, API, connector, chat-agent and web builds/tests.
- [x] 7.7 Preserve and document rollback images, SQLite volumes and restore commands.
