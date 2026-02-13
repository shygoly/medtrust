## 1. Project Setup and Dependencies

- [x] 1.1 Add FISCO BCOS SDK dependencies (fisco-bcos-browser-sdk, web3, solc) to package.json
- [x] 1.2 Create blockchain module directory structure (apps/api/src/blockchain/)
- [x] 1.3 Create smart contracts directory (apps/api/src/blockchain/contracts/)
- [x] 1.4 Create attestation service directory (apps/api/src/blockchain/attestation/)
- [x] 1.5 Create blockchain deployment scripts directory (scripts/blockchain/)
- [x] 1.6 Add blockchain configuration to environment variables (.env.example)

## 2. Smart Contract Development

- [x] 2.1 Write MedicalDataAttestation.sol contract with AttestationRecord struct
- [x] 2.2 Implement storeAttestation function with validation and event emission
- [x] 2.3 Implement getAttestationByHash view function
- [x] 2.4 Implement getAttestationById view function
- [x] 2.5 Implement verifyAttestation function
- [x] 2.6 Implement getAttestationsByAttester function
- [x] 2.7 Implement storeAttestationBatch function for batch operations
- [x] 2.8 Add Ownable access control with pause/unpause functionality
- [ ] 2.9 Implement upgradeable proxy pattern for contract upgradeability
- [ ] 2.10 Write Solidity unit tests for all contract functions
- [ ] 2.11 Write tests for access control and edge cases
- [x] 2.12 Create contract compilation script
- [x] 2.13 Create contract deployment script for dev environment
- [x] 2.14 Create contract deployment script for production environment

## 3. Infrastructure Setup (Development)

- [ ] 3.1 Create Docker Compose configuration for single FISCO BCOS dev node
- [ ] 3.2 Configure FISCO BCOS node with SM2/SM3/SM4 support
- [ ] 3.3 Generate development attestation key pair (SM2)
- [ ] 3.4 Store development attestation private key in Vault
- [ ] 3.5 Deploy MedicalDataAttestation contract to dev node
- [ ] 3.6 Verify contract deployment and test basic operations
- [ ] 3.7 Document dev node setup and usage in README

## 4. Backend Blockchain Module

- [x] 4.1 Create BlockchainModule with NestJS module structure
- [x] 4.2 Implement BlockchainConfigService to load configuration from environment
- [x] 4.3 Implement FiscoBcosService for SDK initialization and connection management
- [x] 4.4 Add connection health check and automatic reconnection logic
- [x] 4.5 Implement transaction signing using Vault-stored SM2 keys
- [ ] 4.6 Implement transaction submission with timeout handling
- [ ] 4.7 Implement transaction receipt retrieval and confirmation waiting
- [ ] 4.8 Add support for multiple node endpoints with load balancing
- [ ] 4.9 Implement ContractService for smart contract interaction
- [ ] 4.10 Add contract method encoding and decoding utilities
- [ ] 4.11 Implement event subscription and listening functionality
- [ ] 4.12 Add node health monitoring with periodic checks
- [ ] 4.13 Implement rate limiting for transaction submission (100 tx/sec)
- [ ] 4.14 Add comprehensive error handling and logging
- [ ] 4.15 Write unit tests for BlockchainModule services

## 5. Attestation Service

- [ ] 5.1 Create AttestationService with event-driven architecture
- [ ] 5.2 Define domain events (DataAssetCreatedEvent, ConsentGrantedEvent, DataSharingExecutedEvent)
- [ ] 5.3 Implement event subscribers for attestation-worthy operations
- [ ] 5.4 Implement attestation workflow: hash generation → transaction submission → status tracking
- [ ] 5.5 Integrate with GMCryptoService for SM3 hash generation
- [ ] 5.6 Implement asynchronous attestation processing with job queue
- [ ] 5.7 Add retry mechanism with exponential backoff (max 5 attempts over 1 hour)
- [ ] 5.8 Implement attestation status tracking (pending → attested → failed)
- [ ] 5.9 Add metadata generation for attestation records (entity info, operation type, user ID)
- [ ] 5.10 Implement batch attestation support for high-volume operations
- [ ] 5.11 Add error handling for node unavailable, transaction failed, key access failed
- [ ] 5.12 Implement alerting for failed attestations and key access errors
- [ ] 5.13 Write unit tests for AttestationService
- [ ] 5.14 Write integration tests for end-to-end attestation flow

## 6. Database Schema and Migrations

- [ ] 6.1 Create AttestationRecord entity with TypeORM
- [ ] 6.2 Add fields: entityType, entityId, dataHash, txHash, blockNumber, status, metadata
- [ ] 6.3 Add timestamps: createdAt, attestedAt
- [ ] 6.4 Create database indexes on (entityType, entityId) for fast lookups
- [ ] 6.5 Create index on attestedAt for date range queries
- [ ] 6.6 Create index on txHash for transaction lookups
- [ ] 6.7 Create index on status for operational monitoring
- [ ] 6.8 Generate and test database migration
- [ ] 6.9 Add AttestationRecord repository with custom query methods

## 7. API Endpoints

- [ ] 7.1 Create AttestationController with REST endpoints
- [ ] 7.2 Implement POST /attestation/store endpoint
- [ ] 7.3 Implement GET /attestation/verify/:entityType/:entityId endpoint
- [ ] 7.4 Implement GET /attestation/history/:entityType/:entityId endpoint
- [ ] 7.5 Add query parameters for filtering (dateFrom, dateTo, status)
- [ ] 7.6 Implement pagination for history endpoint (default 100, max 1000)
- [ ] 7.7 Implement GET /attestation/search endpoint with multiple filters
- [ ] 7.8 Implement GET /attestation/transaction/:txHash endpoint
- [ ] 7.9 Add authentication and authorization guards to endpoints
- [ ] 7.10 Implement POST /attestation/reports endpoint for compliance reports
- [ ] 7.11 Add request validation with DTOs
- [ ] 7.12 Add API documentation with Swagger decorators
- [ ] 7.13 Write API integration tests

## 8. Integration with Existing Modules

- [ ] 8.1 Update DataAssetModule to emit DataAssetCreatedEvent on finalization
- [ ] 8.2 Update ConsentModule to emit ConsentGrantedEvent
- [ ] 8.3 Update DataSharingModule to emit DataSharingExecutedEvent
- [ ] 8.4 Add attestation status field to relevant entities (optional)
- [ ] 8.5 Integrate attestation data with AuditModule for unified audit trail
- [ ] 8.6 Add blockchain verification badge to audit log UI
- [ ] 8.7 Update entity detail pages to show attestation status and timeline
- [ ] 8.8 Test event emission and attestation flow for each module

## 9. Query and Reporting Features

- [ ] 9.1 Implement attestation history query service with filtering
- [ ] 9.2 Implement date range filtering for compliance reporting periods
- [ ] 9.3 Implement status filtering (pending, attested, failed)
- [ ] 9.4 Implement transaction hash lookup functionality
- [ ] 9.5 Add attestation statistics calculation (success rate, latency, volume)
- [ ] 9.6 Implement CSV export for attestation data
- [ ] 9.7 Implement JSON export for attestation data
- [ ] 9.8 Implement blockchain verification bundle export
- [ ] 9.9 Create compliance report generator (monthly/annual)
- [ ] 9.10 Add entity-specific audit trail report generation
- [ ] 9.11 Implement attestation timeline visualization data endpoint
- [ ] 9.12 Add caching for frequently accessed attestations and reports
- [ ] 9.13 Write tests for query and reporting features

## 10. Blockchain Verification

- [ ] 10.1 Implement on-chain verification service
- [ ] 10.2 Add function to verify attestation exists on blockchain by transaction hash
- [ ] 10.3 Add function to compare current data hash with on-chain hash
- [ ] 10.4 Implement blockchain reorganization detection
- [ ] 10.5 Add independent verification tools for auditors
- [ ] 10.6 Write verification documentation for compliance team

## 11. Monitoring and Alerting

- [ ] 11.1 Implement attestation success rate tracking (target >99.5%)
- [ ] 11.2 Add alerting for attestation lag exceeding 5 minutes
- [ ] 11.3 Create dashboard endpoint for pending/failed attestations
- [ ] 11.4 Implement node health monitoring with alerts
- [ ] 11.5 Add metrics for attestation latency (p50, p95, p99)
- [ ] 11.6 Implement attestation volume tracking and anomaly detection
- [ ] 11.7 Add security alerts for key access failures
- [ ] 11.8 Create weekly attestation coverage report
- [ ] 11.9 Set up logging for all blockchain operations
- [ ] 11.10 Configure monitoring dashboards (Grafana/similar)

## 12. Testing

- [ ] 12.1 Write unit tests for all blockchain services (target 80% coverage)
- [ ] 12.2 Write integration tests for attestation flow
- [ ] 12.3 Write E2E tests for API endpoints
- [ ] 12.4 Test failure scenarios (node down, key unavailable, transaction timeout)
- [ ] 12.5 Test retry mechanism with various failure patterns
- [ ] 12.6 Test batch attestation with high volume (1000+ attestations/hour)
- [ ] 12.7 Test concurrent attestation submissions
- [ ] 12.8 Test attestation verification with tampered data
- [ ] 12.9 Test event-driven integration with existing modules
- [ ] 12.10 Test pagination and filtering for large result sets
- [ ] 12.11 Perform load testing on dev environment
- [ ] 12.12 Test contract upgrade mechanism

## 13. Documentation

- [ ] 13.1 Document blockchain module architecture and design decisions
- [ ] 13.2 Document smart contract interface and functions
- [ ] 13.3 Document API endpoints with request/response examples
- [ ] 13.4 Create attestation workflow diagram
- [ ] 13.5 Document event-driven integration pattern
- [ ] 13.6 Write operations runbook (node management, troubleshooting)
- [ ] 13.7 Document attestation verification process for auditors
- [ ] 13.8 Create compliance reporting guide
- [ ] 13.9 Document key rotation procedure
- [ ] 13.10 Write developer setup guide for local blockchain development

## 14. Production Infrastructure

- [ ] 14.1 Design 4-node FISCO BCOS consortium cluster architecture
- [ ] 14.2 Create Kubernetes deployment manifests for production nodes
- [ ] 14.3 Configure network namespace and security for blockchain traffic
- [ ] 14.4 Set up node monitoring with FISCO BCOS built-in metrics
- [ ] 14.5 Generate production attestation key pair (SM2)
- [ ] 14.6 Store production attestation private key in production Vault
- [ ] 14.7 Deploy 4-node production cluster
- [ ] 14.8 Verify cluster consensus and Byzantine fault tolerance
- [ ] 14.9 Deploy MedicalDataAttestation contract to production chain
- [ ] 14.10 Verify production contract deployment
- [ ] 14.11 Configure production blockchain endpoints in application
- [ ] 14.12 Set up production monitoring and alerting
- [ ] 14.13 Create backup and disaster recovery procedures

## 15. Pilot Deployment

- [ ] 15.1 Enable attestation for patient records only (pilot phase)
- [ ] 15.2 Monitor attestation success rate and latency for 1 week
- [ ] 15.3 Review and address any issues found during pilot
- [ ] 15.4 Collect feedback from operations and compliance teams
- [ ] 15.5 Optimize performance based on pilot results

## 16. Full Rollout

- [ ] 16.1 Enable attestation for consent operations
- [ ] 16.2 Enable attestation for data sharing agreements
- [ ] 16.3 Enable attestation for all critical operations
- [ ] 16.4 Implement optional backfill for existing critical records
- [ ] 16.5 Train support team on attestation verification
- [ ] 16.6 Train compliance team on audit report generation
- [ ] 16.7 Announce blockchain attestation feature to users
- [ ] 16.8 Monitor system performance and attestation coverage
- [ ] 16.9 Create post-deployment report with metrics and lessons learned
