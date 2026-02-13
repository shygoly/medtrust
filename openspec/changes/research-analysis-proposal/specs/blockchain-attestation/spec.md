## ADDED Requirements

### Requirement: Submit data attestation

The system SHALL allow authenticated users to submit medical data attestations to the blockchain.

#### Scenario: Attest prescription data
- **WHEN** user submits prescription data with patient_id, drug_name, and doctor_signature
- **THEN** system computes SM3 hash, stores attestation on FISCO BCOS, and returns transaction hash

#### Scenario: Attest medical record
- **WHEN** user submits medical record with record_id and metadata
- **THEN** system creates blockchain attestation with timestamp and returns attestation_id

#### Scenario: Duplicate attestation
- **WHEN** user submits attestation for data that already has blockchain record
- **THEN** system returns 409 error with message "Data already attested" and existing attestation_id

### Requirement: Verify data attestation

The system SHALL allow anyone to verify data attestation against blockchain records.

#### Scenario: Verify valid attestation
- **WHEN** user provides data and attestation_id for verification
- **THEN** system computes hash, queries blockchain, and returns verification result "valid" with timestamp

#### Scenario: Verify tampered data
- **WHEN** user provides modified data with original attestation_id
- **THEN** system detects hash mismatch and returns verification result "invalid"

#### Scenario: Verify non-existent attestation
- **WHEN** user provides attestation_id that does not exist on blockchain
- **THEN** system returns 404 error with message "Attestation not found"

### Requirement: Query attestation history

The system SHALL allow users to query attestation history for specific data or entities.

#### Scenario: Query by patient ID
- **WHEN** user queries attestations for specific patient_id
- **THEN** system returns list of all attestations related to that patient with timestamps and transaction hashes

#### Scenario: Query by date range
- **WHEN** user queries attestations within specific date range
- **THEN** system returns filtered list of attestations with blockchain confirmation status

#### Scenario: Query by attestation type
- **WHEN** user queries attestations of type "prescription"
- **THEN** system returns all prescription attestations with metadata

### Requirement: Support prescription flow tracking

The system SHALL track prescription lifecycle from issuance to dispensing using blockchain attestations.

#### Scenario: Issue prescription
- **WHEN** doctor issues prescription with patient_id, drug_name, and dosage
- **THEN** system creates attestation with status "issued" and returns prescription_id

#### Scenario: Dispense prescription
- **WHEN** pharmacy dispenses prescription with prescription_id
- **THEN** system creates attestation with status "dispensed" and links to original issuance

#### Scenario: Verify prescription not double-dispensed
- **WHEN** pharmacy attempts to dispense already-dispensed prescription
- **THEN** system detects duplicate dispensing and returns 409 error

### Requirement: Support drug traceability

The system SHALL enable drug supply chain traceability using blockchain attestations.

#### Scenario: Record drug manufacturing
- **WHEN** manufacturer records drug batch with batch_id, drug_name, and production_date
- **THEN** system creates attestation with manufacturer signature and returns traceability_id

#### Scenario: Record drug distribution
- **WHEN** distributor records drug shipment with batch_id and destination
- **THEN** system creates attestation linking to manufacturing record

#### Scenario: Query drug origin
- **WHEN** user queries drug batch origin with batch_id
- **THEN** system returns complete supply chain history from manufacturing to current location

### Requirement: Use GM crypto algorithms

The system SHALL use SM2/SM3/SM4 algorithms for all blockchain operations.

#### Scenario: Sign transaction with SM2
- **WHEN** system submits attestation to blockchain
- **THEN** system signs transaction using SM2 private key

#### Scenario: Hash data with SM3
- **WHEN** system computes attestation hash
- **THEN** system uses SM3 algorithm for hash computation

#### Scenario: Encrypt sensitive metadata with SM4
- **WHEN** attestation includes sensitive metadata
- **THEN** system encrypts metadata with SM4 before storing on blockchain

### Requirement: Manage blockchain accounts

The system SHALL manage blockchain accounts for each tenant with secure key storage.

#### Scenario: Create tenant account
- **WHEN** new tenant is registered
- **THEN** system generates SM2 key pair, stores private key encrypted, and registers account on blockchain

#### Scenario: Rotate account keys
- **WHEN** tenant requests key rotation
- **THEN** system generates new key pair, migrates attestations to new account, and revokes old key

#### Scenario: Export account address
- **WHEN** user requests their blockchain account address
- **THEN** system returns public address without exposing private key

### Requirement: Handle blockchain node failures

The system SHALL handle FISCO BCOS node failures with automatic failover.

#### Scenario: Primary node unavailable
- **WHEN** primary blockchain node is unreachable
- **THEN** system automatically switches to backup node and retries transaction

#### Scenario: All nodes unavailable
- **WHEN** all blockchain nodes are unreachable
- **THEN** system queues attestation requests and processes when nodes recover

#### Scenario: Transaction timeout
- **WHEN** blockchain transaction does not confirm within 30 seconds
- **THEN** system retries transaction with higher gas limit

### Requirement: Cache attestation records locally

The system SHALL maintain local cache of attestation records for fast queries.

#### Scenario: Query cached attestation
- **WHEN** user queries recently created attestation
- **THEN** system returns result from local database without blockchain query

#### Scenario: Sync cache with blockchain
- **WHEN** system detects cache inconsistency
- **THEN** system rebuilds cache from blockchain event logs

#### Scenario: Cache invalidation
- **WHEN** blockchain reorganization is detected
- **THEN** system invalidates affected cache entries and re-syncs from blockchain

### Requirement: Audit blockchain operations

The system SHALL maintain audit trail of all blockchain interactions.

#### Scenario: Query transaction history
- **WHEN** user requests their blockchain transaction history
- **THEN** system returns list of all transactions with timestamps, gas costs, and confirmation status

#### Scenario: Export compliance report
- **WHEN** admin requests compliance report for specific period
- **THEN** system exports all attestations with blockchain proof and verification status
