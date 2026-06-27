## ADDED Requirements

### Requirement: Durable data-product catalog
The system SHALL persist published data products in the database and serve the catalog from
that durable store, so the catalog survives a process restart.

#### Scenario: Published product survives restart
- **WHEN** a provider publishes a data product and the API process is then restarted
- **THEN** `GET /catalog` returns that product after restart with its original metadata
  (title, classification, rightsConfirmed, recordCount, urn)

#### Scenario: Catalog read is served from the database
- **WHEN** `GET /catalog` is called
- **THEN** the response reflects the current database rows, not a process-local in-memory map

### Requirement: Durable digital contracts
The system SHALL persist digital contracts and their status transitions in the database.

#### Scenario: Signed contract survives restart
- **WHEN** a contract is created and the API is restarted
- **THEN** the contract and its current status are still retrievable, and its SM3 hash is
  unchanged

#### Scenario: Status transition is persisted
- **WHEN** a contract transitions (e.g. draft → active → revoked)
- **THEN** the new status is written to the database and observed by the connector PEP on its
  next read

### Requirement: Durable settlement ledger
The system SHALL persist settlement records and their per-provider contribution lines as an
append-only ledger.

#### Scenario: Settlement record survives restart
- **WHEN** a settlement record with N contribution lines is created and the API is restarted
- **THEN** the record and all N lines are retrievable with identical amounts and contributions

#### Scenario: Ledger entries are not mutated in place
- **WHEN** a settlement record exists
- **THEN** the system does not overwrite its amounts; corrections are represented as new
  ledger entries

### Requirement: Durable federation trust and remote catalog
The system SHALL persist federation trust (per-space CA public key) and cached remote-catalog
metadata in the database.

#### Scenario: Federation trust survives restart
- **WHEN** trust is established with a remote space and the API is restarted
- **THEN** the remote space's CA public key and its cached remote catalog are still present

### Requirement: Durable participant registry and CA
The system SHALL persist registered participants (with dual-auth state) and the certificates
issued to them, plus the central CA's SM2 root keypair (per space) loaded on boot rather than
regenerated, so participants, issued certificates, and revocations all survive a restart.

#### Scenario: Registered participant and its certificate survive restart
- **WHEN** a participant is admitted and a certificate is issued to it, then the API restarts
- **THEN** the participant (with its dual-auth state) and the issued certificate are still
  retrievable from the registry

#### Scenario: Issued certificate still verifies after restart
- **WHEN** the CA issues a connector certificate and the API is restarted
- **THEN** that certificate still verifies against the (persisted) CA public key

#### Scenario: Revocation survives restart
- **WHEN** a certificate is revoked and the API is restarted
- **THEN** that certificate is still marked revoked in the registry and fails verification

### Requirement: Durable user accounts
The system SHALL persist auth user accounts in the database rather than in-memory.

#### Scenario: Registered user survives restart
- **WHEN** a user registers and the API is restarted
- **THEN** that user can authenticate with the same credentials after restart

### Requirement: Idempotent demo seeding
On bootstrap the system SHALL seed demo data via idempotent upsert keyed on a stable
identifier, so restarting never duplicates seed rows nor overwrites user-modified rows.

#### Scenario: Seeding twice does not duplicate
- **WHEN** the API boots a second time against a database that already contains the demo seed
- **THEN** no duplicate demo rows are created

#### Scenario: Seeding does not clobber user edits
- **WHEN** a demo-seeded row has been modified by a user and the API reboots
- **THEN** the seed does not overwrite the user's modification

### Requirement: Control plane stores metadata only
The control-plane store SHALL contain only metadata (catalog, identity, contract, settlement,
attestation index) and SHALL NOT contain raw medical records, preserving the data-not-leaving-
domain invariant.

#### Scenario: No raw records in control-plane tables
- **WHEN** any control-plane entity is persisted
- **THEN** it carries identifiers, schema, and metadata only — raw patient rows remain in the
  connector-local store
