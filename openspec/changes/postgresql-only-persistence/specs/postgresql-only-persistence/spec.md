## ADDED Requirements

### Requirement: Production uses PostgreSQL only
Every production persistence connection SHALL be PostgreSQL. A production process SHALL reject
a file path or SQLite driver configuration at startup.

#### Scenario: SQLite path is rejected
- **WHEN** API, connector or persistent chat-agent starts in production with a `.db` path
- **THEN** startup fails with a configuration error before serving traffic

#### Scenario: PostgreSQL state survives restart
- **WHEN** a control-plane or connector process is restarted
- **THEN** its products, contracts, grants, cryptographic state and execution metadata remain
  available from PostgreSQL

### Requirement: Connector stores remain isolated
Each connector SHALL use its own PostgreSQL database and credential pair and SHALL NOT be able
to read another connector's tables.

#### Scenario: Connector A cannot reach Connector B
- **WHEN** connector A uses its configured credentials against connector B's database
- **THEN** PostgreSQL rejects the connection or access

### Requirement: Existing SQLite data is migrated losslessly
The cutover SHALL preserve cryptographic identity and governance records.

#### Scenario: CA and signatures remain valid
- **WHEN** the control-plane migration completes
- **THEN** `cp_ca_keypair.publicKey`, contract hashes and MDOP signatures equal the source values
  and existing connector certificates verify

#### Scenario: Existing authorization is reusable
- **WHEN** the assistant evaluates an existing active matching contract and access grant after
  cutover
- **THEN** the same authorization is reused without creating a duplicate contract

### Requirement: Rollback is available
The deployment SHALL retain pre-cutover images and SQLite volumes until acceptance passes.

#### Scenario: Failed health gate restores previous stack
- **WHEN** PostgreSQL cutover fails health, CA or contract parity checks
- **THEN** the previous images and SQLite volumes can be restored without regenerating the CA
