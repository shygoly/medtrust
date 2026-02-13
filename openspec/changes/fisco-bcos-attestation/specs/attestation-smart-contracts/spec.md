## ADDED Requirements

### Requirement: MedicalDataAttestation smart contract

The system SHALL deploy a Solidity smart contract that stores attestation records with cryptographic hashes and metadata.

#### Scenario: Deploy contract to blockchain
- **WHEN** system deploys MedicalDataAttestation contract
- **THEN** contract is deployed to FISCO BCOS blockchain
- **THEN** contract address is recorded in configuration
- **THEN** contract is initialized with deployer as owner

#### Scenario: Contract supports SM2/SM3 operations
- **WHEN** contract is deployed to FISCO BCOS
- **THEN** contract uses FISCO BCOS native SM2 signature verification
- **THEN** contract accepts SM3 hashes (bytes32) as input
- **THEN** contract validates hash format before storage

### Requirement: Store attestation record

The smart contract SHALL provide a function to store attestation records with hash, data type, and metadata.

#### Scenario: Store new attestation
- **WHEN** backend calls storeAttestation(dataHash, dataType, metadata)
- **THEN** contract validates dataHash is not zero
- **THEN** contract validates dataType is not empty
- **THEN** contract creates AttestationRecord with hash, type, attester address, timestamp, and metadata
- **THEN** contract emits AttestationStored event
- **THEN** contract returns attestation ID

#### Scenario: Prevent duplicate attestation
- **WHEN** backend attempts to store attestation with existing dataHash
- **THEN** contract checks if hash already exists
- **THEN** contract reverts transaction with error "Attestation already exists"

#### Scenario: Store attestation with empty metadata
- **WHEN** backend calls storeAttestation with empty metadata string
- **THEN** contract accepts empty metadata
- **THEN** contract stores attestation record successfully

### Requirement: Retrieve attestation record

The smart contract SHALL provide functions to retrieve attestation records by hash or attestation ID.

#### Scenario: Query attestation by hash
- **WHEN** backend calls getAttestationByHash(dataHash)
- **THEN** contract returns AttestationRecord struct with all fields
- **THEN** contract returns attester address, timestamp, dataType, and metadata

#### Scenario: Query non-existent attestation
- **WHEN** backend queries attestation for hash that doesn't exist
- **THEN** contract returns empty AttestationRecord with zero values
- **THEN** contract does not revert

#### Scenario: Query attestation by ID
- **WHEN** backend calls getAttestationById(attestationId)
- **THEN** contract returns AttestationRecord for that ID
- **THEN** contract includes all attestation details

### Requirement: Verify data integrity

The smart contract SHALL provide a function to verify if a given hash matches a stored attestation.

#### Scenario: Verify matching hash
- **WHEN** backend calls verifyAttestation(dataHash)
- **THEN** contract checks if attestation exists for hash
- **THEN** contract returns true and attestation timestamp

#### Scenario: Verify non-matching hash
- **WHEN** backend calls verifyAttestation with hash not on-chain
- **THEN** contract returns false and zero timestamp

### Requirement: Query attestations by attester

The smart contract SHALL support querying all attestations created by a specific attester address.

#### Scenario: Get attestations by platform address
- **WHEN** backend calls getAttestationsByAttester(attesterAddress)
- **THEN** contract returns array of attestation IDs created by that address
- **THEN** contract returns IDs in chronological order

#### Scenario: Query attestations for address with no attestations
- **WHEN** backend queries attestations for unused address
- **THEN** contract returns empty array

### Requirement: Attestation event emission

The smart contract SHALL emit events for all attestation operations to enable off-chain monitoring.

#### Scenario: Emit AttestationStored event
- **WHEN** contract stores new attestation
- **THEN** contract emits AttestationStored event with attestationId, dataHash, dataType, attester, and timestamp
- **THEN** event is indexed by dataHash and attester for efficient querying

#### Scenario: Subscribe to events off-chain
- **WHEN** backend subscribes to AttestationStored events
- **THEN** backend receives event notifications in real-time
- **THEN** backend can filter events by attester address or data type

### Requirement: Access control

The smart contract SHALL implement access control to restrict certain operations to authorized addresses.

#### Scenario: Only owner can pause contract
- **WHEN** non-owner address calls pause()
- **THEN** contract reverts with "Ownable: caller is not the owner"

#### Scenario: Owner pauses contract
- **WHEN** owner calls pause()
- **THEN** contract enters paused state
- **THEN** storeAttestation function is disabled
- **THEN** query functions remain available

#### Scenario: Anyone can store attestation when not paused
- **WHEN** any address calls storeAttestation
- **THEN** contract accepts attestation from any caller
- **THEN** contract records caller address as attester

### Requirement: Contract upgradeability

The smart contract SHALL support upgradeability through proxy pattern to allow bug fixes and feature additions.

#### Scenario: Deploy upgradeable proxy
- **WHEN** system deploys contract using proxy pattern
- **THEN** proxy contract is deployed with implementation address
- **THEN** all calls are delegated to implementation contract
- **THEN** storage remains in proxy contract

#### Scenario: Upgrade implementation
- **WHEN** owner upgrades contract to new implementation
- **THEN** proxy updates implementation address
- **THEN** existing attestation data is preserved
- **THEN** new implementation functions become available

### Requirement: Gas optimization

The smart contract SHALL optimize gas usage for storage and retrieval operations (note: FISCO BCOS has no gas fees, but efficiency still matters).

#### Scenario: Efficient storage layout
- **WHEN** contract stores attestation record
- **THEN** contract uses packed storage for struct fields
- **THEN** contract minimizes storage slots used
- **THEN** contract uses bytes32 for hashes instead of string

#### Scenario: Batch attestation support
- **WHEN** backend calls storeAttestationBatch with array of attestations
- **THEN** contract processes all attestations in single transaction
- **THEN** contract emits events for each attestation
- **THEN** contract returns array of attestation IDs

### Requirement: Attestation metadata structure

The smart contract SHALL store metadata as JSON string to support flexible attestation information.

#### Scenario: Store structured metadata
- **WHEN** backend stores attestation with metadata JSON
- **THEN** contract stores metadata string as-is
- **THEN** contract does not validate JSON structure
- **THEN** off-chain systems parse metadata for compliance reporting

#### Scenario: Metadata includes entity information
- **WHEN** attestation metadata includes entityType and entityId
- **THEN** contract stores complete metadata string
- **THEN** backend can reconstruct entity reference from metadata

### Requirement: Attestation immutability

The smart contract SHALL ensure attestation records cannot be modified or deleted after creation.

#### Scenario: Attempt to modify attestation
- **WHEN** contract does not provide update function
- **THEN** stored attestations remain immutable
- **THEN** only new attestations can be added

#### Scenario: Attempt to delete attestation
- **WHEN** contract does not provide delete function
- **THEN** attestations persist permanently on blockchain
- **THEN** historical audit trail is preserved

### Requirement: Contract deployment scripts

The system SHALL provide deployment scripts for deploying and configuring smart contracts on FISCO BCOS.

#### Scenario: Deploy to development network
- **WHEN** developer runs deployment script for dev environment
- **THEN** script compiles Solidity contract
- **THEN** script deploys contract to local FISCO BCOS node
- **THEN** script saves contract address to configuration file

#### Scenario: Deploy to production network
- **WHEN** operator runs deployment script for production
- **THEN** script prompts for confirmation
- **THEN** script deploys contract to production consortium
- **THEN** script verifies deployment by calling contract methods
- **THEN** script updates production configuration with contract address

### Requirement: Contract verification

The system SHALL provide tools to verify deployed contract bytecode matches source code.

#### Scenario: Verify contract deployment
- **WHEN** operator verifies deployed contract
- **THEN** system compiles source code with same compiler version
- **THEN** system compares deployed bytecode with compiled bytecode
- **THEN** system confirms bytecode matches or reports differences

### Requirement: Contract testing

The system SHALL include comprehensive test suite for smart contract functionality.

#### Scenario: Unit test attestation storage
- **WHEN** test suite runs contract tests
- **THEN** tests verify storeAttestation creates record correctly
- **THEN** tests verify events are emitted
- **THEN** tests verify retrieval functions return correct data

#### Scenario: Test access control
- **WHEN** test suite runs access control tests
- **THEN** tests verify only owner can pause contract
- **THEN** tests verify paused contract rejects attestations
- **THEN** tests verify unpause restores functionality

#### Scenario: Test edge cases
- **WHEN** test suite runs edge case tests
- **THEN** tests verify behavior with zero hash
- **THEN** tests verify behavior with empty metadata
- **THEN** tests verify behavior with maximum length metadata
