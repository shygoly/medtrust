# Design: GM Crypto Security Foundation

## Context

The MedTrust platform currently has basic authentication (JWT) but lacks data-at-rest encryption and compliance with Chinese national cryptography standards. Medical data platforms operating in China must comply with 等保2.0/3.0 and 医疗数据安全管理办法, which mandate:

- Use of SM2/SM3/SM4 national cryptography algorithms
- Encryption of sensitive personal information (PII) at rest
- Secure key management with rotation capabilities
- Data desensitization for non-privileged access

This design establishes the foundational security layer that all subsequent features (federated learning, MPC, blockchain attestation) will build upon.

**Current State**:
- NestJS 10 backend with TypeORM + SQLite
- Basic JWT authentication
- No data encryption at rest
- No key management infrastructure

**Target State**:
- SM2/SM3/SM4 crypto services available throughout the application
- Transparent database column encryption for sensitive fields
- HashiCorp Vault integration for key management
- Automatic data masking in API responses based on user roles

---

## Goals / Non-Goals

### Goals

1. **Regulatory Compliance**: Implement SM2/SM3/SM4 algorithms to meet 等保2.0/3.0 requirements
2. **Transparent Encryption**: Encrypt sensitive database columns without changing application logic
3. **Secure Key Management**: Use Vault for key storage, rotation, and audit logging
4. **Privacy by Default**: Automatically mask sensitive fields in API responses
5. **Developer Experience**: Make security features easy to use via decorators and services

### Non-Goals

1. **Searchable Encryption**: Encrypted columns cannot be queried (future enhancement)
2. **End-to-End Encryption**: This design covers data-at-rest, not client-to-server encryption
3. **Hardware Security Modules (HSM)**: Using software-based Vault, not HSM integration
4. **Key Rotation Automation**: Manual key rotation process (automation in future phase)
5. **Field-Level Access Control**: Role-based masking only, not fine-grained field permissions

---

## Decisions

### Decision 1: Use sm-crypto Library for National Cryptography

**Options Considered**:
- `sm-crypto` (npm package, pure JavaScript)
- `gmssl` (C++ binding, higher performance)
- Custom implementation

**Choice**: `sm-crypto`

**Rationale**:
- Pure JavaScript, no native dependencies (easier deployment)
- Well-maintained, 1M+ weekly downloads
- Sufficient performance for our use case (not high-frequency trading)
- Simpler integration with NestJS/TypeScript

**Trade-offs**:
- Slightly slower than C++ implementations
- Acceptable for medical data platform (not latency-critical)

---

### Decision 2: Column-Level Encryption via TypeORM Transformers

**Options Considered**:
- Database-level Transparent Data Encryption (TDE)
- Application-level column encryption
- Separate encrypted storage service

**Choice**: Application-level column encryption with TypeORM transformers

**Rationale**:
- **Granular Control**: Encrypt only sensitive fields, not entire database
- **Key Flexibility**: Different keys for different data types (patient ID vs medical history)
- **SQLite Compatibility**: SQLite doesn't support TDE natively
- **Portability**: Works across any database backend

**Trade-offs**:
- Cannot query encrypted columns in WHERE clauses
- Slight performance overhead on every read/write
- Application must handle encryption (not transparent to DB)

**Implementation Pattern**:
```typescript
@EncryptedColumn('patient-id-card-key')
idCard: string;
```

The decorator wraps TypeORM's `@Column()` with a transformer that:
- `to`: Encrypts plaintext → ciphertext before INSERT/UPDATE
- `from`: Decrypts ciphertext → plaintext after SELECT

---

### Decision 3: HashiCorp Vault for Key Management

**Options Considered**:
- Environment variables (insecure, no rotation)
- AWS KMS / Aliyun KMS (cloud vendor lock-in)
- HashiCorp Vault (self-hosted or cloud)
- Kubernetes Secrets (limited features)

**Choice**: HashiCorp Vault

**Rationale**:
- **Industry Standard**: Widely adopted for secrets management
- **Key Rotation**: Built-in versioning and rotation support
- **Audit Logging**: Comprehensive access logs for compliance
- **Dynamic Secrets**: Can generate short-lived database credentials
- **Transit Engine**: Encrypt-as-a-service for envelope encryption
- **Vendor Neutral**: Can run on-premises or any cloud

**Trade-offs**:
- Additional infrastructure to manage
- Requires Vault server setup and maintenance
- Network dependency (mitigated by caching)

**Deployment**:
- Development: Vault in dev mode via Docker Compose
- Production: Vault cluster with HA (3+ nodes)

---

### Decision 4: In-Memory Key Caching with TTL

**Problem**: Every database read would require a Vault API call (high latency)

**Solution**: Cache encryption keys in-memory with 5-minute TTL

**Rationale**:
- **Performance**: Reduces Vault API calls by ~99%
- **Availability**: Application can survive brief Vault outages
- **Security**: Keys expire automatically, limiting exposure window
- **Rotation Support**: Cache invalidation on key rotation events

**Implementation**:
```typescript
private keyCache = new Map<string, { key: string; expiresAt: number }>();
```

**Trade-offs**:
- Keys remain in memory (acceptable risk for 5 minutes)
- Cache invalidation complexity on key rotation
- Memory usage scales with number of unique keys

---

### Decision 5: Decorator-Based Data Masking

**Options Considered**:
- Manual masking in each controller
- Interceptor-based masking (global)
- Decorator-based masking (per-field)

**Choice**: Decorator-based masking on DTO properties

**Rationale**:
- **Declarative**: Clear which fields are masked
- **Reusable**: Same DTO can be used across endpoints
- **Type-Safe**: TypeScript decorators with metadata
- **Flexible**: Can specify masking type per field

**Implementation Pattern**:
```typescript
export class PatientDTO {
  @Masked('name') name: string;
  @Masked('phone') phoneNumber: string;
  @Masked('idCard') idCard: string;
}
```

**Conditional Masking**:
- Use NestJS interceptor to check user role
- Skip masking for admin users or data owners
- Log unmasked access for audit trail

---

### Decision 6: Envelope Encryption for Large Data

**Problem**: SM2 (asymmetric) is slow for large data

**Solution**: Envelope encryption pattern
1. Generate random SM4 key (DEK - Data Encryption Key)
2. Encrypt data with SM4 DEK (fast symmetric encryption)
3. Encrypt DEK with SM2 public key (small payload)
4. Store both encrypted data and encrypted DEK

**Rationale**:
- **Performance**: SM4 is 100x faster than SM2 for bulk data
- **Security**: DEK is unique per encryption operation
- **Standard Pattern**: Used by AWS KMS, Google Cloud KMS

**Use Cases**:
- Encrypting medical images or large documents
- Encrypting data before sending to external systems

---

## Architecture

### Module Structure

```
apps/api/src/
├── security/
│   ├── security.module.ts          # Exports all security services
│   │
│   ├── crypto/
│   │   ├── crypto.module.ts
│   │   ├── gm-crypto.service.ts    # SM2/SM3/SM4 operations
│   │   └── gm-crypto.service.spec.ts
│   │
│   ├── vault/
│   │   ├── vault.module.ts
│   │   ├── vault.service.ts        # Vault client, key retrieval, caching
│   │   ├── vault.config.ts         # Configuration interface
│   │   └── vault.service.spec.ts
│   │
│   ├── decorators/
│   │   ├── encrypted-column.decorator.ts  # @EncryptedColumn()
│   │   ├── masked.decorator.ts            # @Masked()
│   │   └── index.ts
│   │
│   └── interceptors/
│       └── masking.interceptor.ts   # Applies masking based on user role
│
└── shared/
    └── transformers/
        └── encryption.transformer.ts  # TypeORM transformer factory
```

### Service Dependencies

```
┌─────────────────────────────────────────────────────┐
│                  Application Layer                   │
│  (Controllers, Services using encrypted entities)    │
└────────────────────┬────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ TypeORM Entity   │    │  Masking         │
│ with @Encrypted  │    │  Interceptor     │
│ Column           │    │                  │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ Encryption       │    │  Masking         │
│ Transformer      │    │  Utilities       │
└────────┬─────────┘    └──────────────────┘
         │
         ▼
┌──────────────────┐
│  GMCryptoService │ ◄──────┐
│  (SM2/SM3/SM4)   │        │
└──────────────────┘        │
                            │
┌──────────────────┐        │
│  VaultService    │────────┘
│  (Key Mgmt)      │
└──────────────────┘
         │
         ▼
┌──────────────────┐
│  HashiCorp Vault │
│  (External)      │
└──────────────────┘
```

### Data Flow: Encrypted Column Write

```
1. Application sets entity.idCard = "110101199001011234"
2. TypeORM calls transformer.to(plaintext)
3. Transformer calls VaultService.getDataKey('patient-id-card-key')
4. VaultService checks cache → miss → calls Vault API
5. Vault returns SM4 key, VaultService caches it
6. Transformer calls GMCryptoService.sm4Encrypt(plaintext, key)
7. GMCryptoService returns ciphertext (hex)
8. TypeORM stores ciphertext in database
```

### Data Flow: Encrypted Column Read

```
1. TypeORM loads entity from database (ciphertext)
2. TypeORM calls transformer.from(ciphertext)
3. Transformer calls VaultService.getDataKey('patient-id-card-key')
4. VaultService checks cache → hit → returns cached key
5. Transformer calls GMCryptoService.sm4Decrypt(ciphertext, key)
6. GMCryptoService returns plaintext
7. Application receives entity.idCard = "110101199001011234"
```

---

## Implementation Plan

### Phase 1: Core Crypto Services (Week 1)

**Tasks**:
1. Install dependencies: `sm-crypto`, `node-vault`
2. Create `GMCryptoService` with SM2/SM3/SM4 methods
3. Write unit tests for all crypto operations
4. Create `VaultService` with connection and key retrieval
5. Implement in-memory key caching with TTL
6. Write integration tests with Vault dev server

**Deliverables**:
- `apps/api/src/security/crypto/gm-crypto.service.ts`
- `apps/api/src/security/vault/vault.service.ts`
- Unit tests with >90% coverage

---

### Phase 2: Database Encryption (Week 1-2)

**Tasks**:
1. Create `EncryptedColumn` decorator
2. Implement TypeORM transformer factory
3. Update Patient entity with encrypted columns
4. Test encryption/decryption round-trip
5. Document query limitations (no WHERE on encrypted columns)

**Deliverables**:
- `apps/api/src/security/decorators/encrypted-column.decorator.ts`
- `apps/api/src/shared/transformers/encryption.transformer.ts`
- Updated entity definitions

---

### Phase 3: Data Masking (Week 2)

**Tasks**:
1. Implement masking utility functions (phone, idCard, name, email)
2. Create `@Masked()` decorator for DTOs
3. Create masking interceptor with role-based logic
4. Add audit logging for unmasked access
5. Write tests for all masking patterns

**Deliverables**:
- `apps/api/src/security/decorators/masked.decorator.ts`
- `apps/api/src/security/interceptors/masking.interceptor.ts`
- Masking utility functions

---

### Phase 4: Integration & Documentation (Week 2)

**Tasks**:
1. Set up Vault in Docker Compose for development
2. Create Vault initialization script (create keys, policies)
3. Update environment configuration
4. Write developer documentation
5. Create example entities and DTOs
6. End-to-end integration tests

**Deliverables**:
- `docker-compose.yml` with Vault service
- `scripts/vault-init.sh`
- Developer guide in `docs/security/`

---

## Configuration

### Environment Variables

```bash
# Vault Configuration
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=dev-token-12345

# Key Cache Configuration
KEY_CACHE_TTL_SECONDS=300  # 5 minutes

# Audit Logging
AUDIT_LOG_UNMASKED_ACCESS=true
```

### Vault Secrets Structure

```
secret/
└── data/
    └── medical/
        ├── patient-id-card-key       # SM4 key for ID cards
        ├── patient-medical-history-key  # SM4 key for medical history
        ├── patient-contact-key       # SM4 key for contact info
        └── ...
```

---

## Security Considerations

1. **Key Rotation**: Document manual rotation process, plan automation for Phase 2
2. **Vault Token Security**: Use AppRole authentication in production, not static tokens
3. **Cache Security**: Keys in memory are vulnerable to memory dumps (acceptable risk)
4. **Audit Logging**: Log all key access and unmasked data access
5. **Error Messages**: Don't expose key material or detailed crypto errors to clients
6. **Null Handling**: Gracefully handle null/empty values without errors

---

## Testing Strategy

1. **Unit Tests**: All crypto operations, masking functions, transformers
2. **Integration Tests**: Vault connectivity, key caching, entity encryption
3. **E2E Tests**: Full flow from API request to encrypted database storage
4. **Performance Tests**: Measure encryption overhead, cache hit rate
5. **Security Tests**: Verify encrypted data is not readable, keys are not exposed

---

## Rollout Plan

1. **Development**: Deploy Vault in dev mode, test with sample data
2. **Staging**: Deploy Vault cluster, migrate test data with encryption
3. **Production**:
   - Deploy Vault HA cluster
   - Encrypt new data immediately
   - Background job to encrypt existing data (if any)
   - Monitor performance and error rates

---

## Future Enhancements

1. **Searchable Encryption**: Use deterministic encryption or tokenization for queryable fields
2. **Automatic Key Rotation**: Scheduled rotation with background re-encryption
3. **HSM Integration**: Use hardware security modules for KEK storage
4. **Field-Level Access Control**: Fine-grained permissions per field
5. **Homomorphic Encryption**: Enable computation on encrypted data (for MPC/FL)

---

*Design complete. Ready for implementation.*
