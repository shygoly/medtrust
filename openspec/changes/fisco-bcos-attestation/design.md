## Context

MedTrust has completed its security foundation with GM cryptography (SM2/SM3/SM4) and Vault-based key management. The platform now needs blockchain attestation to provide immutable, verifiable proof of medical data operations for regulatory compliance (等保2.0/3.0, 医疗数据安全管理办法).

**Current State:**
- GMCryptoService provides SM3 hashing for data integrity
- AuditModule logs operations in SQLite database (mutable)
- No cryptographic proof of data operations or ownership transfers
- Compliance audits require manual verification of audit logs

**Constraints:**
- Must use national cryptography algorithms (SM2/SM3/SM4)
- Cannot store actual medical data on-chain (privacy requirement)
- Must integrate with existing NestJS backend architecture
- Need to support both development and production blockchain environments

## Goals / Non-Goals

**Goals:**
- Provide immutable, tamper-proof audit trail for critical medical data operations
- Enable cryptographic verification of data integrity and ownership transfers
- Support compliance reporting with blockchain-backed evidence
- Integrate seamlessly with existing GMCryptoService and AuditModule
- Deploy production-ready FISCO BCOS infrastructure

**Non-Goals:**
- Public blockchain deployment (using permissioned FISCO BCOS consortium chain)
- Storing actual medical data or PII on-chain (only cryptographic hashes)
- Real-time synchronous attestation for every database operation (performance trade-off)
- Blockchain-based access control or authentication (handled by existing JWT/Passport)
- Cross-chain interoperability or multi-chain support
- Token economics or cryptocurrency features

## Decisions

### 1. FISCO BCOS as Blockchain Platform

**Decision:** Use FISCO BCOS (微众银行国产联盟链) as the blockchain platform.

**Rationale:**
- Native support for SM2/SM3/SM4 national cryptography algorithms
- Permissioned consortium chain suitable for enterprise medical data use cases
- High performance (10,000+ TPS) compared to public blockchains
- Widely adopted in Chinese financial and healthcare sectors
- Strong regulatory compliance track record
- Active development and enterprise support from WeBank

**Alternatives Considered:**
- Hyperledger Fabric: Lacks native SM crypto support, requires additional integration
- Ethereum: Public chain unsuitable for medical data, high gas costs, no SM crypto
- Custom blockchain: Too high development and maintenance cost

### 2. Asynchronous Attestation Pattern

**Decision:** Implement asynchronous, event-driven attestation for critical operations rather than synchronous blocking.

**Rationale:**
- Blockchain writes are slow (1-3 seconds per transaction) - blocking would degrade API performance
- Not all operations require immediate attestation (e.g., draft records vs finalized records)
- Allows graceful degradation if blockchain node is temporarily unavailable
- Enables batch attestation for efficiency

**Implementation:**
- Emit domain events for attestation-worthy operations (e.g., `PatientRecordFinalized`, `ConsentGranted`)
- AttestationService subscribes to events and processes asynchronously
- Store attestation status in database (`pending`, `attested`, `failed`)
- Retry mechanism for failed attestations

**Alternatives Considered:**
- Synchronous attestation: Would add 1-3s latency to every critical operation, poor UX
- No attestation tracking: Would lose visibility into attestation failures

### 3. Smart Contract Architecture

**Decision:** Deploy a single `MedicalDataAttestation` smart contract with structured attestation records.

**Contract Structure:**
```solidity
struct AttestationRecord {
    bytes32 dataHash;        // SM3 hash of data
    string dataType;         // "patient_record", "consent", "data_sharing"
    address attester;        // Transaction signer address
    uint256 timestamp;       // Block timestamp
    string metadata;         // JSON metadata (entity IDs, operation type)
}
```

**Rationale:**
- Single contract simplifies deployment and management
- Structured records enable efficient querying and verification
- Metadata field provides flexibility for different data types without contract changes
- Address-based attester tracking for accountability

**Alternatives Considered:**
- Multiple contracts per data type: Increases deployment complexity, harder to query across types
- Separate ownership tracking contract: Adds complexity, can be handled in metadata
- On-chain access control: Out of scope, handled by existing backend

### 4. Transaction Signing and Key Management

**Decision:** Use Vault-stored private keys with backend-side transaction signing.

**Rationale:**
- Consistent with existing key management architecture (GMCryptoService uses Vault)
- Backend controls attestation timing and authorization
- Single "platform attestation key" per environment (dev/prod)
- Vault provides audit trail of key access

**Key Rotation Strategy:**
- Generate new attestation key quarterly
- Deploy contract upgrade that recognizes both old and new keys
- Migrate to new key over 30-day period
- Revoke old key after migration complete

**Alternatives Considered:**
- User-controlled keys: Users don't need blockchain keys, platform attests on their behalf
- HSM integration: Overkill for current scale, Vault sufficient for security requirements
- Multi-sig: Adds complexity, single platform key sufficient for consortium chain

### 5. Node Deployment Architecture

**Decision:**
- Development: Single FISCO BCOS node (local or containerized)
- Production: 4-node consortium cluster (1 node per organization/region)

**Rationale:**
- Single dev node simplifies local development and testing
- 4-node production cluster provides Byzantine fault tolerance (tolerates 1 faulty node)
- Consortium model aligns with multi-tenant SaaS architecture
- Each node can represent a different stakeholder (hospital, regulator, platform operator)

**Infrastructure:**
- Docker Compose for dev environment
- Kubernetes deployment for production nodes
- Separate network namespace for blockchain traffic
- Monitoring via FISCO BCOS built-in metrics

**Alternatives Considered:**
- Cloud-hosted blockchain service: Less control, vendor lock-in, may not support SM crypto
- Single production node: No fault tolerance, single point of failure
- 7+ node cluster: Overkill for initial deployment, can scale later

### 6. Integration with Existing Modules

**Decision:** Integrate via event-driven architecture with minimal coupling.

**Pattern:**
```
DataAssetModule → emits DataAssetCreatedEvent
                ↓
AttestationService → subscribes to event
                   → generates SM3 hash via GMCryptoService
                   → submits blockchain transaction
                   → updates attestation status in DB
```

**Rationale:**
- Loose coupling: Existing modules don't need blockchain knowledge
- Testability: Can test modules independently
- Flexibility: Easy to add/remove attestation for different operations
- Graceful degradation: If attestation fails, core operations still succeed

**Database Schema Addition:**
```typescript
@Entity()
class AttestationRecord {
  entityType: string;      // "data_asset", "consent", etc.
  entityId: string;        // UUID of attested entity
  dataHash: string;        // SM3 hash
  txHash: string;          // Blockchain transaction hash
  blockNumber: number;     // Block number
  status: 'pending' | 'attested' | 'failed';
  createdAt: Date;
  attestedAt: Date;
}
```

**Alternatives Considered:**
- Direct coupling: Would make modules dependent on blockchain availability
- Synchronous calls: Would block operations if blockchain is slow/down
- No database tracking: Would lose visibility into attestation status

### 7. Error Handling and Resilience

**Decision:** Implement multi-layer error handling with retry and alerting.

**Strategy:**
- **Node Unavailable:** Retry with exponential backoff (max 5 attempts over 1 hour)
- **Transaction Failed:** Log error, alert ops team, mark attestation as `failed`
- **Contract Error:** Validate data before submission, log contract revert reasons
- **Key Access Failed:** Alert security team immediately, halt attestations

**Monitoring:**
- Track attestation success rate (target: >99.5%)
- Alert if attestation lag exceeds 5 minutes
- Dashboard showing pending/failed attestations
- Weekly report of attestation coverage

**Alternatives Considered:**
- Fail fast: Would lose attestation data permanently
- Infinite retry: Could cause resource exhaustion
- No monitoring: Would miss systematic failures

## Risks / Trade-offs

**[Risk] Blockchain node downtime prevents attestations**
→ **Mitigation:** Asynchronous pattern with retry mechanism ensures operations continue. Failed attestations can be manually resubmitted after node recovery. Monitor node health proactively.

**[Risk] Smart contract bugs could corrupt attestation records**
→ **Mitigation:** Thorough testing on dev chain before production deployment. Contract upgrade mechanism via proxy pattern. Immutability means bugs can't alter past records, only affect new ones.

**[Risk] Performance impact of SM3 hashing and blockchain writes**
→ **Mitigation:** Asynchronous attestation prevents blocking user operations. Batch attestation for high-volume operations. SM3 hashing is fast (~1ms per hash).

**[Risk] Key compromise could allow unauthorized attestations**
→ **Mitigation:** Vault-based key storage with access audit logs. Key rotation every quarter. Blockchain provides immutable record of all attestations for forensic analysis.

**[Risk] Blockchain storage costs grow over time**
→ **Mitigation:** Only store hashes and minimal metadata (not full data). FISCO BCOS has no gas fees (permissioned chain). Archive old blocks if needed.

**[Risk] Regulatory requirements change, requiring contract modifications**
→ **Mitigation:** Metadata field provides flexibility for new requirements without contract changes. Contract upgrade mechanism via proxy pattern if major changes needed.

**[Trade-off] Asynchronous attestation means slight delay (1-5 seconds) before blockchain proof available**
→ **Acceptable:** Compliance audits are not real-time. Users can see "attestation pending" status. Critical for maintaining API performance.

**[Trade-off] Single platform attestation key means all attestations appear from same address**
→ **Acceptable:** Metadata includes actual user/operation details. Platform is the legal attester. Simplifies key management significantly.

## Migration Plan

**Phase 1: Infrastructure Setup (Week 1)**
1. Deploy dev FISCO BCOS node (Docker Compose)
2. Deploy smart contract to dev chain
3. Configure Vault with dev attestation key
4. Set up monitoring and alerting

**Phase 2: Backend Integration (Week 2-3)**
1. Implement BlockchainModule with FISCO BCOS SDK
2. Implement AttestationService with event subscriptions
3. Add attestation database schema
4. Integrate with GMCryptoService for SM3 hashing
5. Add attestation endpoints to API

**Phase 3: Testing (Week 4)**
1. Unit tests for smart contract
2. Integration tests for attestation flow
3. Load testing (1000+ attestations/hour)
4. Failure scenario testing (node down, key unavailable)

**Phase 4: Production Deployment (Week 5)**
1. Deploy 4-node production FISCO BCOS cluster
2. Deploy smart contract to production chain
3. Configure production attestation key in Vault
4. Enable attestation for pilot data types (patient records only)
5. Monitor for 1 week before full rollout

**Phase 5: Full Rollout (Week 6)**
1. Enable attestation for all critical operations
2. Backfill attestations for existing critical records (optional)
3. Train support team on attestation verification
4. Document attestation APIs for compliance team

**Rollback Strategy:**
- Disable event subscriptions to stop new attestations
- Existing attestations remain on-chain (immutable)
- Core operations continue normally (no dependency on blockchain)
- Can re-enable attestation after fixing issues

## Open Questions

1. **Backfill Strategy:** Should we attest existing critical records retroactively? This would provide complete audit trail but requires careful planning to avoid overwhelming the blockchain.

2. **Blockchain Explorer:** Do we need a custom blockchain explorer UI for compliance team, or is CLI-based verification sufficient initially?

3. **Multi-Region:** If we expand to multiple regions, do we need separate blockchain networks per region, or single global network?

4. **Attestation Granularity:** Should we attest individual field changes, or only major state transitions (e.g., "draft → finalized")?

5. **Third-Party Verification:** Do external auditors need direct blockchain access, or can we provide verification APIs/reports?
