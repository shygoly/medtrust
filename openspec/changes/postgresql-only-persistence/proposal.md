## Why

Production persistence still depends on three independent SQLite stores:

- the API control-plane metadata and cryptographic key registry;
- each connector's local contract, artifact, nonce and audit state;
- optional chat-agent session persistence.

SQLite was accepted as a single-node bootstrap choice (D-DB-1), but it complicates
multi-instance API deployment, backup consistency, online migrations and connector fleet
operations. The current ali29 deployment stores the CA private-key material and all governance
state in a 39 MB SQLite volume while the business database already runs on PostgreSQL.

## What Changes

- Make PostgreSQL the only production persistence engine.
- Convert the named `controlplane` TypeORM connection to PostgreSQL.
- Convert each connector-local TypeORM database to PostgreSQL. Each connector MUST use its own
  database and credentials; connectors MUST NOT share a central database or network credentials.
- Replace chat-agent SQLite sessions with PostgreSQL sessions when persistence is enabled.
- Keep in-memory test doubles. In-memory SQLite may remain test-only where no PostgreSQL service
  is available, but no production process may open a SQLite file.
- Add a deterministic one-time migration from the current SQLite control-plane and connector
  volumes into PostgreSQL, including `cp_ca_keypair`, contracts, signatures, grants, jobs,
  receipts, connector-local contracts and audit state.
- Add schema compatibility for PostgreSQL (`timestamp`, JSON, UUID/text and reserved words).
- Update ali29 compose to provision separate control-plane, connector-A, connector-B and
  connector-C databases on the existing PostgreSQL service, with isolated credentials and
  network access.
- Update deployment, backup, rollback and validation documentation.

## Capabilities

### New Capabilities

- `postgresql-only-persistence`: production processes use PostgreSQL exclusively; SQLite files
  are rejected at startup and connector persistence remains locally isolated.
- `postgresql-data-cutover`: existing SQLite state is migrated with row/hash parity and a tested
  rollback path.

### Modified Capabilities

- `control-plane-persistence`: its PostgreSQL-ready physical separation is retained, but
  production SQLite is removed.

## Impact

- Code: `packages/database`, `apps/api`, `apps/connector`, `apps/chat-agent`, runtime checks and
  Dockerfiles.
- Deployment: `deploy/ali29`, compose, env templates and PostgreSQL database provisioning.
- Data: control-plane SQLite, three connector-local SQLite volumes and optional chat sessions.
- Security: CA keys, signatures and contract state are copied byte-for-byte; any mismatch blocks
  cutover.
- Rollback: the previous images and SQLite volumes remain untouched until post-cutover health and
  parity checks pass.
