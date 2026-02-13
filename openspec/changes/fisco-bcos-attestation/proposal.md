## Why

Medical data platforms require immutable audit trails and tamper-proof evidence for data sharing transactions to meet regulatory compliance (等保2.0/3.0, 医疗数据安全管理办法). With the security foundation now complete (SM2/SM3/SM4 encryption, Vault key management), blockchain attestation provides the next critical layer: verifiable proof of data integrity, ownership transfers, and access authorization that cannot be altered or disputed.

## What Changes

- Integrate FISCO BCOS (微众银行国产联盟链) with full SM2/SM3/SM4 support
- Implement data attestation service that stores cryptographic hashes on-chain
- Deploy Solidity smart contracts for medical data attestation and verification
- Create verification APIs to prove data integrity and audit trail queries
- Add blockchain node infrastructure (dev and production environments)
- Integrate with existing GMCryptoService for SM3 hash generation
- Implement event-driven attestation for critical data operations (patient records, consent forms, data sharing agreements)

## Capabilities

### New Capabilities
- `blockchain-attestation`: Core attestation functionality for storing data hashes on-chain, verifying data integrity, and creating immutable audit trails for medical data operations
- `fisco-bcos-integration`: FISCO BCOS SDK integration, node connectivity, transaction management, and Web3 interface for blockchain operations
- `attestation-smart-contracts`: Solidity smart contracts for data attestation storage, ownership tracking, and verification logic with national cryptography support
- `audit-trail-queries`: Query and retrieve historical attestation records, transaction history, and blockchain-based audit logs for compliance reporting

### Modified Capabilities
<!-- No existing capabilities require requirement changes - this is net-new blockchain infrastructure -->

## Impact

**New Code**:
- `apps/api/src/blockchain/` - FISCO BCOS service module
- `apps/api/src/blockchain/contracts/` - Solidity smart contracts
- `apps/api/src/blockchain/attestation/` - Attestation service and APIs
- `scripts/blockchain/` - Node deployment and contract deployment scripts

**Dependencies**:
- `fisco-bcos-browser-sdk` - FISCO BCOS JavaScript SDK
- `web3` - Web3 utilities for contract interaction
- `solc` - Solidity compiler for smart contracts

**Infrastructure**:
- FISCO BCOS nodes (1 node for dev, 4-node cluster for production)
- Smart contract deployment pipeline
- Blockchain explorer integration (optional)

**Integration Points**:
- Uses `GMCryptoService.sm3Hash()` for data hashing
- Integrates with `AuditModule` for comprehensive audit trails
- Extends `DataAssetModule` and `AccessRequestModule` with attestation
- Adds attestation metadata to database entities

**Configuration**:
- Blockchain node endpoints (FISCO_NODE_URL)
- Chain ID and group ID configuration
- Contract addresses for deployed attestation contracts
- Private key management for transaction signing (via Vault)

**API Changes**:
- New endpoints: `POST /attestation/store`, `GET /attestation/verify`, `GET /attestation/history`
- Existing endpoints enhanced with optional attestation (e.g., `POST /data-assets` can trigger automatic attestation)
