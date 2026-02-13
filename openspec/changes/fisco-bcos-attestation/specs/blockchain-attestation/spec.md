## ADDED Requirements

### Requirement: Store data hash on blockchain

The system SHALL generate SM3 cryptographic hashes of critical medical data and store them on the FISCO BCOS blockchain with associated metadata.

#### Scenario: Attest patient record creation
- **WHEN** a patient record is finalized
- **THEN** system generates SM3 hash of the record data
- **THEN** system submits attestation transaction to blockchain with hash, data type "patient_record", and entity ID
- **THEN** system stores attestation record in database with status "pending"

#### Scenario: Attest consent form
- **WHEN** a patient grants data sharing consent
- **THEN** system generates SM3 hash of the consent document
- **THEN** system submits attestation transaction with hash, data type "consent", and consent ID
- **THEN** system updates attestation status to "attested" after blockchain confirmation

#### Scenario: Attest data sharing agreement
- **WHEN** a data sharing agreement is executed
- **THEN** system generates SM3 hash of the agreement terms
- **THEN** system submits attestation transaction with hash, data type "data_sharing", and agreement ID
- **THEN** system records blockchain transaction hash and block number

### Requirement: Verify data integrity

The system SHALL provide verification functionality to prove that data has not been tampered with by comparing current hash against blockchain-stored hash.

#### Scenario: Verify unmodified data
- **WHEN** user requests verification of a patient record
- **THEN** system generates SM3 hash of current record data
- **THEN** system retrieves attestation record from blockchain
- **THEN** system compares hashes and returns verification status "valid"

#### Scenario: Detect tampered data
- **WHEN** user requests verification of modified data
- **THEN** system generates SM3 hash of current data
- **THEN** system retrieves original hash from blockchain
- **THEN** system detects hash mismatch and returns verification status "invalid" with timestamp of original attestation

#### Scenario: Verify non-attested data
- **WHEN** user requests verification of data without attestation
- **THEN** system checks for attestation record
- **THEN** system returns verification status "not_attested"

### Requirement: Asynchronous attestation processing

The system SHALL process attestations asynchronously using event-driven architecture to avoid blocking user operations.

#### Scenario: Non-blocking attestation
- **WHEN** user creates a patient record
- **THEN** system completes the creation operation immediately
- **THEN** system emits DataAssetCreatedEvent
- **THEN** AttestationService processes attestation in background within 5 seconds

#### Scenario: Attestation failure does not block operations
- **WHEN** blockchain node is unavailable during attestation
- **THEN** system marks attestation as "failed" in database
- **THEN** user operation completes successfully
- **THEN** system retries attestation with exponential backoff

### Requirement: Attestation retry mechanism

The system SHALL automatically retry failed attestations with exponential backoff up to 5 attempts over 1 hour.

#### Scenario: Successful retry after transient failure
- **WHEN** attestation fails due to network timeout
- **THEN** system schedules retry after 1 minute
- **THEN** system retries attestation
- **THEN** system updates status to "attested" on success

#### Scenario: Permanent failure after max retries
- **WHEN** attestation fails 5 times
- **THEN** system marks attestation as "failed" permanently
- **THEN** system logs error details
- **THEN** system sends alert to operations team

### Requirement: Attestation status tracking

The system SHALL maintain attestation status in the database for all attested entities with transaction details.

#### Scenario: Track pending attestation
- **WHEN** attestation is submitted to blockchain
- **THEN** system creates AttestationRecord with status "pending"
- **THEN** system records entity type, entity ID, and data hash
- **THEN** system records creation timestamp

#### Scenario: Update status on confirmation
- **WHEN** blockchain transaction is confirmed
- **THEN** system updates AttestationRecord status to "attested"
- **THEN** system records transaction hash and block number
- **THEN** system records attestation timestamp

#### Scenario: Query attestation status
- **WHEN** user queries attestation status for an entity
- **THEN** system retrieves AttestationRecord by entity type and ID
- **THEN** system returns status, transaction hash, block number, and timestamps

### Requirement: Integration with GMCryptoService

The system SHALL use GMCryptoService for SM3 hash generation to ensure consistency with existing cryptographic operations.

#### Scenario: Generate SM3 hash for attestation
- **WHEN** AttestationService needs to hash data
- **THEN** system calls GMCryptoService.sm3Hash() with data payload
- **THEN** system receives 64-character hex-encoded SM3 hash
- **THEN** system uses hash for blockchain attestation

### Requirement: Attestation metadata

The system SHALL include structured metadata in attestation records to support compliance reporting and audit queries.

#### Scenario: Include operation metadata
- **WHEN** system attests a data operation
- **THEN** system includes entity type (e.g., "patient_record")
- **THEN** system includes entity ID (UUID)
- **THEN** system includes operation type (e.g., "created", "updated", "shared")
- **THEN** system includes user ID who performed the operation
- **THEN** system includes timestamp of the operation

#### Scenario: Include compliance metadata
- **WHEN** system attests a consent operation
- **THEN** system includes consent type (e.g., "data_sharing", "research")
- **THEN** system includes patient ID
- **THEN** system includes authorized party ID
- **THEN** system includes consent expiration date

### Requirement: Attestation API endpoints

The system SHALL provide REST API endpoints for storing attestations, verifying data integrity, and querying attestation history.

#### Scenario: Store attestation via API
- **WHEN** client sends POST /attestation/store with entity type, entity ID, and data
- **THEN** system generates SM3 hash
- **THEN** system submits attestation to blockchain
- **THEN** system returns attestation ID and status "pending"

#### Scenario: Verify data via API
- **WHEN** client sends GET /attestation/verify/:entityType/:entityId with current data
- **THEN** system generates hash of provided data
- **THEN** system retrieves blockchain attestation
- **THEN** system returns verification result with status "valid" or "invalid"

#### Scenario: Query attestation history via API
- **WHEN** client sends GET /attestation/history/:entityType/:entityId
- **THEN** system retrieves all attestation records for the entity
- **THEN** system returns array of attestations with timestamps, hashes, and transaction details
