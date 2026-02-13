## ADDED Requirements

### Requirement: FISCO BCOS SDK integration

The system SHALL integrate the FISCO BCOS JavaScript SDK to enable blockchain connectivity and transaction submission.

#### Scenario: Initialize SDK connection
- **WHEN** application starts
- **THEN** system initializes FISCO BCOS SDK with node endpoint configuration
- **THEN** system establishes connection to blockchain node
- **THEN** system verifies connection by querying chain ID and block number

#### Scenario: SDK initialization failure
- **WHEN** blockchain node is unreachable during startup
- **THEN** system logs connection error
- **THEN** system continues application startup
- **THEN** system marks blockchain service as unavailable

### Requirement: Blockchain node connectivity

The system SHALL maintain persistent connection to FISCO BCOS nodes with automatic reconnection on failure.

#### Scenario: Connect to development node
- **WHEN** running in development environment
- **THEN** system connects to single local FISCO BCOS node
- **THEN** system uses development chain ID and group ID
- **THEN** system verifies node is running and responsive

#### Scenario: Connect to production cluster
- **WHEN** running in production environment
- **THEN** system connects to 4-node FISCO BCOS consortium cluster
- **THEN** system uses production chain ID and group ID
- **THEN** system load balances requests across available nodes

#### Scenario: Automatic reconnection
- **WHEN** connection to blockchain node is lost
- **THEN** system detects disconnection within 30 seconds
- **THEN** system attempts reconnection with exponential backoff
- **THEN** system restores connection and resumes operations

### Requirement: Transaction signing

The system SHALL sign blockchain transactions using SM2 private keys stored in HashiCorp Vault.

#### Scenario: Sign transaction with platform key
- **WHEN** system needs to submit attestation transaction
- **THEN** system retrieves attestation private key from Vault
- **THEN** system signs transaction using SM2 algorithm
- **THEN** system submits signed transaction to blockchain

#### Scenario: Key retrieval failure
- **WHEN** Vault is unavailable during transaction signing
- **THEN** system logs key retrieval error
- **THEN** system marks transaction as failed
- **THEN** system sends security alert to operations team

### Requirement: Transaction submission

The system SHALL submit signed transactions to FISCO BCOS blockchain and handle transaction lifecycle.

#### Scenario: Submit attestation transaction
- **WHEN** AttestationService submits transaction
- **THEN** system sends signed transaction to blockchain node
- **THEN** system receives transaction hash immediately
- **THEN** system waits for transaction confirmation (1-3 seconds)
- **THEN** system retrieves transaction receipt with block number

#### Scenario: Transaction timeout
- **WHEN** transaction confirmation exceeds 10 seconds
- **THEN** system marks transaction as timed out
- **THEN** system queries transaction status by hash
- **THEN** system retries submission if transaction not found on-chain

#### Scenario: Transaction revert
- **WHEN** smart contract reverts transaction
- **THEN** system receives revert reason from transaction receipt
- **THEN** system logs revert details
- **THEN** system marks attestation as failed with error message

### Requirement: Smart contract interaction

The system SHALL provide Web3 interface for calling smart contract methods and querying contract state.

#### Scenario: Call contract method
- **WHEN** system needs to store attestation on-chain
- **THEN** system encodes contract method call with parameters
- **THEN** system creates transaction with contract address and encoded data
- **THEN** system submits transaction and waits for receipt

#### Scenario: Query contract state
- **WHEN** system needs to retrieve attestation record
- **THEN** system calls contract view method with entity hash
- **THEN** system receives attestation data without submitting transaction
- **THEN** system decodes returned data into structured format

### Requirement: Chain configuration management

The system SHALL support multiple blockchain network configurations for different environments.

#### Scenario: Load development configuration
- **WHEN** application starts in development mode
- **THEN** system loads development blockchain configuration
- **THEN** system uses local node endpoint (http://localhost:8545)
- **THEN** system uses development chain ID and group ID
- **THEN** system uses development attestation key from Vault

#### Scenario: Load production configuration
- **WHEN** application starts in production mode
- **THEN** system loads production blockchain configuration
- **THEN** system uses production node endpoints (load balanced)
- **THEN** system uses production chain ID and group ID
- **THEN** system uses production attestation key from Vault

#### Scenario: Configuration validation
- **WHEN** system loads blockchain configuration
- **THEN** system validates required fields (node URL, chain ID, group ID)
- **THEN** system validates Vault key path exists
- **THEN** system fails startup if configuration is invalid

### Requirement: Transaction monitoring

The system SHALL monitor blockchain transactions and provide visibility into transaction status and errors.

#### Scenario: Track pending transactions
- **WHEN** transaction is submitted
- **THEN** system records transaction hash and submission time
- **THEN** system monitors transaction status until confirmed
- **THEN** system updates attestation record with confirmation details

#### Scenario: Detect stuck transactions
- **WHEN** transaction remains pending for more than 60 seconds
- **THEN** system logs stuck transaction warning
- **THEN** system queries node for transaction status
- **THEN** system alerts operations team if transaction is lost

### Requirement: Gas and resource management

The system SHALL manage blockchain resources efficiently for permissioned FISCO BCOS network (no gas fees).

#### Scenario: Submit transaction without gas
- **WHEN** system submits transaction to FISCO BCOS
- **THEN** system does not include gas price or gas limit
- **THEN** transaction is processed by consortium nodes without fees
- **THEN** system tracks transaction count for monitoring

#### Scenario: Rate limiting
- **WHEN** system submits multiple transactions rapidly
- **THEN** system enforces rate limit of 100 transactions per second
- **THEN** system queues excess transactions
- **THEN** system processes queued transactions as capacity allows

### Requirement: Blockchain event listening

The system SHALL listen to blockchain events emitted by smart contracts for real-time updates.

#### Scenario: Subscribe to attestation events
- **WHEN** system starts
- **THEN** system subscribes to AttestationStored events from contract
- **THEN** system receives event notifications when attestations are stored
- **THEN** system processes events to update internal state

#### Scenario: Handle missed events
- **WHEN** system reconnects after downtime
- **THEN** system queries historical events from last processed block
- **THEN** system processes missed events in order
- **THEN** system updates to current block height

### Requirement: Node health monitoring

The system SHALL continuously monitor blockchain node health and availability.

#### Scenario: Health check
- **WHEN** system performs periodic health check (every 30 seconds)
- **THEN** system queries node for latest block number
- **THEN** system verifies block number is increasing
- **THEN** system marks node as healthy if responsive

#### Scenario: Unhealthy node detection
- **WHEN** node fails to respond to health check
- **THEN** system marks node as unhealthy
- **THEN** system switches to backup node if available
- **THEN** system alerts operations team

#### Scenario: Node lag detection
- **WHEN** node's block number is more than 10 blocks behind
- **THEN** system detects node is lagging
- **THEN** system switches to up-to-date node
- **THEN** system logs lag warning
