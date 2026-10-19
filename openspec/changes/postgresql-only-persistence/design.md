## Context

There are four persistence boundaries:

1. `AppDataSource`: already supports `DATABASE_URL` PostgreSQL.
2. `ControlPlaneDataSource`: hardcoded `better-sqlite3`.
3. `ConnectorDataSource`: hardcoded `better-sqlite3`; each hospital connector owns one instance.
4. Chat-agent session repository: optional SQLite TypeORM store.

D7 requires physical separation between the control plane and participant-local stores. Moving
all stores to PostgreSQL MUST preserve that boundary. A shared control-plane database for
connectors is forbidden.

## Goals

- No production process opens or creates a `.db` file.
- Control-plane state survives API replacement and supports PostgreSQL transactions/backups.
- Each connector has an independent PostgreSQL database and credential pair.
- Existing state is migrated without losing cryptographic identity.
- Cutover is rehearsed against the isolated `medtrust-test` stack before production.

## Non-Goals

- Sharing a single PostgreSQL schema among connectors.
- Moving raw medical rows into the control plane.
- Removing in-memory or test-only SQLite fixtures in the same change.
- Introducing cross-database foreign keys.

## Decisions

### D1: PostgreSQL is mandatory in production

`CONTROL_PLANE_DB_URL` and `CONNECTOR_DB_URL` MUST match `postgres://` or `postgresql://`.
When `NODE_ENV=production`, file paths and `better-sqlite3` are rejected at startup. Development
may use PostgreSQL too; using SQLite locally requires an explicit test-only override that is not
shipped in production compose.

### D2: D7 isolation becomes database isolation

Use one PostgreSQL server on ali29 for the demo stack with separate databases and users:

- `medtrust_controlplane`
- `medtrust_connector_a`
- `medtrust_connector_b`
- `medtrust_connector_c`
- `medtrust_chat_agent`

Each connector network is granted access only to its own database. Connector credentials do not
appear in another connector's environment. Production hospital deployments may point their
connector at a hospital-owned PostgreSQL instance instead of ali29.

### D3: Preserve cryptographic state exactly

`cp_ca_keypair`, `cp_digital_contract`, `cp_mdop_*`, certificates and connector-local contract
rows are copied without normalization of encrypted fields, signatures, hashes or timestamps.
Migration validates:

- row counts by table;
- primary-key sets;
- `cp_ca_keypair.publicKey`;
- contract IDs, hashes, `mdopStatus`, `holderSignature`, `platformCountersignature`;
- grant IDs and statuses;
- connector-local contract IDs and digests.

Any mismatch aborts before the traffic switch.

### D4: Schema portability

SQLite-only `datetime` declarations are replaced by portable TypeORM date mappings. JSON-like
columns remain `simple-json` only where TypeORM serializes them consistently. PostgreSQL
reserved words require explicit column names or quoted identifiers in raw migration queries.

### D5: Session persistence

Chat-agent session storage becomes `CHAT_AGENT_DB=postgres` with
`CHAT_AGENT_DATABASE_URL`. `memory` remains available for tests and keyless demo fallback.
The SQLite session driver is removed from production builds.

### D6: Migration execution

Add `scripts/migrate-sqlite-to-postgres.mjs` with table allowlists and dry-run support. It reads
SQLite through the backup/read-only API and writes PostgreSQL inside transactions. The script
never deletes SQLite source data.

### D7: Rollout

1. Build and validate PostgreSQL-capable images without switching.
2. Provision empty databases and matching credentials.
3. Back up PostgreSQL business data, SQLite control plane and all connector volumes.
4. Run the migration against the isolated test stack.
5. Switch production in dependency order: API control plane → connectors → chat-agent.
6. Verify CA/certificate continuity, authorization reuse, contract signing and a new MDOP job.
7. Keep SQLite volumes and pre-change images for rollback.

### D8: Migration-only schema after bootstrap

Production sets `DB_SYNCHRONIZE=false`. Control-plane, connector and chat-agent schemas each
have one explicit PostgreSQL initial migration. The initial migration checks for its sentinel
table first: empty databases are created normally; databases bootstrapped by the pre-cutover
`synchronize` path are adopted and registered without rewriting data.

The legacy main-business `AppDataSource` keeps its existing deployment-managed PostgreSQL
schema and does not scan the obsolete SQLite-era migration directory. Those historical files
contain non-timestamp class names that TypeORM 0.3 rejects and are unrelated to the three
converted persistence boundaries.

### D9: Submitted job windows are authoritative

The job's `not_after` is persisted as `deadline`. Compile and ticket issuance use that deadline
instead of silently applying a 30-day default, so a job cannot receive a ticket that outlives a
short contract.

## Risks

- A shared database would violate D7. Mitigation: separate databases/users and network tests.
- PostgreSQL type incompatibilities may surface only at startup. Mitigation: metadata build and
  test-stack boot before production.
- CA key mismatch invalidates every connector certificate. Mitigation: byte/field parity gate.
- Active MDOP jobs can span cutover. Mitigation: cut over only with no critical running jobs.
- Rollback can lose writes after cutover. Mitigation: freeze writes before final parity check and
  document the rollback point.
