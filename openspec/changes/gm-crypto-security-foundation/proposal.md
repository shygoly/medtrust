## Why

Medical data platforms in China must comply with 等保2.0/3.0 and 医疗数据安全管理办法, which mandate the use of national cryptography algorithms (SM2/SM3/SM4) for data protection. This foundational security layer is a prerequisite for all subsequent privacy computing features and ensures regulatory compliance from day one.

## What Changes

- Integrate SM2/SM3/SM4 national cryptography algorithms via `sm-crypto` library
- Implement database column-level encryption using SM4 with TypeORM transformers
- Add HashiCorp Vault integration for secure key management and rotation
- Create data masking decorators for sensitive field desensitization (phone, ID card, name)
- Implement envelope encryption pattern (SM2 encrypts SM4 keys, SM4 encrypts data)
- Add crypto service module to NestJS backend with injectable services

## Capabilities

### New Capabilities
- `gm-crypto-algorithms`: SM2 (asymmetric encryption/signing), SM3 (hashing), SM4 (symmetric encryption) implementation with envelope encryption support
- `database-encryption`: TypeORM column-level encryption transformers with automatic encrypt/decrypt on read/write operations
- `key-management`: HashiCorp Vault integration for data encryption keys (DEK), key encryption keys (KEK), and dynamic database credentials
- `data-masking`: Decorator-based field desensitization for API responses (phone: 138****5678, ID card: 110101********1234, name: 张**)

### Modified Capabilities
<!-- No existing capabilities require requirement changes - this is net-new security infrastructure -->

## Impact

**New Code**:
- `apps/api/src/security/crypto/` - GM crypto service module
- `apps/api/src/security/vault/` - Vault service module
- `apps/api/src/security/decorators/` - Encryption and masking decorators
- `packages/database/src/transformers/` - TypeORM encryption transformers

**Dependencies**:
- `sm-crypto` - Chinese national cryptography algorithms
- `node-vault` - HashiCorp Vault client
- `crypto` (Node.js built-in) - Random key generation

**Configuration**:
- Vault connection settings (VAULT_ADDR, VAULT_TOKEN)
- Key identifiers for different data types (patient-id-card-key, medical-history-key)

**Database Entities** (implementation detail, no schema changes):
- Patient, MedicalRecord, User entities will use `@EncryptedColumn()` decorator for sensitive fields
- Existing schema structure remains unchanged - encryption is transparent at application layer
