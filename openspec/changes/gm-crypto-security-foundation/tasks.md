# Implementation Tasks

## 1. Core Crypto Services

### 1.1 Setup and Dependencies

- [x] 1.1.1 Install `sm-crypto` package in apps/api
- [x] 1.1.2 Install `node-vault` package in apps/api
- [x] 1.1.3 Add TypeScript types for both packages
- [x] 1.1.4 Create `apps/api/src/security/` module directory structure

### 1.2 GMCryptoService Implementation

- [x] 1.2.1 Create `apps/api/src/security/crypto/crypto.module.ts`
- [x] 1.2.2 Create `apps/api/src/security/crypto/gm-crypto.service.ts`
- [x] 1.2.3 Implement SM2 key pair generation method
- [x] 1.2.4 Implement SM2 encrypt/decrypt methods
- [x] 1.2.5 Implement SM2 sign/verify methods
- [x] 1.2.6 Implement SM3 hash method
- [x] 1.2.7 Implement SM4 encrypt/decrypt methods (ECB and CBC modes)
- [x] 1.2.8 Implement envelope encryption method (SM2 + SM4)
- [x] 1.2.9 Implement envelope decryption method
- [x] 1.2.10 Add error handling for all crypto operations

### 1.3 GMCryptoService Tests

- [x] 1.3.1 Create `apps/api/src/security/crypto/gm-crypto.service.spec.ts`
- [x] 1.3.2 Write tests for SM2 key generation
- [x] 1.3.3 Write tests for SM2 encryption/decryption round-trip
- [x] 1.3.4 Write tests for SM2 signing/verification
- [x] 1.3.5 Write tests for SM3 hashing (deterministic output)
- [x] 1.3.6 Write tests for SM4 ECB mode encryption/decryption
- [x] 1.3.7 Write tests for SM4 CBC mode encryption/decryption
- [x] 1.3.8 Write tests for envelope encryption/decryption
- [x] 1.3.9 Write tests for error cases (invalid keys, corrupted data)
- [x] 1.3.10 Verify >90% code coverage for GMCryptoService

---

## 2. Vault Integration

### 2.1 VaultService Implementation

- [x] 2.1.1 Create `apps/api/src/security/vault/vault.module.ts`
- [x] 2.1.2 Create `apps/api/src/security/vault/vault.config.ts` interface
- [x] 2.1.3 Create `apps/api/src/security/vault/vault.service.ts`
- [x] 2.1.4 Implement Vault client initialization in `onModuleInit()`
- [x] 2.1.5 Implement `getDataKey(keyId)` method with Vault KV read
- [x] 2.1.6 Implement in-memory key cache with Map<string, {key, expiresAt}>
- [x] 2.1.7 Implement cache TTL logic (5 minutes default)
- [x] 2.1.8 Implement `getDatabaseCredentials()` for dynamic DB creds
- [x] 2.1.9 Implement `encryptDEK()` using Vault Transit engine
- [x] 2.1.10 Implement `decryptDEK()` using Vault Transit engine
- [x] 2.1.11 Add connection error handling and retry logic
- [x] 2.1.12 Add audit logging for key access events

### 2.2 VaultService Tests

- [x] 2.2.1 Create `apps/api/src/security/vault/vault.service.spec.ts`
- [x] 2.2.2 Mock Vault client for unit tests
- [x] 2.2.3 Write tests for successful key retrieval
- [x] 2.2.4 Write tests for key caching (cache hit/miss)
- [x] 2.2.5 Write tests for cache expiration
- [x] 2.2.6 Write tests for Vault connection failures
- [x] 2.2.7 Write tests for missing key errors
- [x] 2.2.8 Write integration tests with Vault dev server
- [x] 2.2.9 Verify >85% code coverage for VaultService

### 2.3 Environment Configuration

- [x] 2.3.1 Add VAULT_ADDR to environment variables
- [x] 2.3.2 Add VAULT_TOKEN to environment variables
- [x] 2.3.3 Add KEY_CACHE_TTL_SECONDS configuration
- [x] 2.3.4 Update `.env.example` with Vault configuration
- [x] 2.3.5 Document environment variables in README

---

## 3. Database Encryption

### 3.1 Encryption Transformer

- [x] 3.1.1 Create `apps/api/src/shared/transformers/` directory
- [x] 3.1.2 Create `encryption.transformer.ts` with transformer factory
- [x] 3.1.3 Implement `to()` function (encrypt on write)
- [x] 3.1.4 Implement `from()` function (decrypt on read)
- [x] 3.1.5 Add null/empty value handling
- [x] 3.1.6 Add error handling for encryption/decryption failures
- [x] 3.1.7 Inject VaultService and GMCryptoService dependencies

### 3.2 EncryptedColumn Decorator

- [x] 3.2.1 Create `apps/api/src/security/decorators/` directory
- [x] 3.2.2 Create `encrypted-column.decorator.ts`
- [x] 3.2.3 Implement `@EncryptedColumn(keyId)` decorator
- [x] 3.2.4 Configure TypeORM column with type 'varchar'
- [x] 3.2.5 Attach encryption transformer to column
- [x] 3.2.6 Add TypeScript metadata for decorator
- [x] 3.2.7 Export decorator from `decorators/index.ts`

### 3.3 Entity Updates

- [x] 3.3.1 Identify sensitive fields in existing entities (Patient, User, etc.)
- [x] 3.3.2 Apply `@EncryptedColumn('patient-id-card-key')` to Patient.idCard
- [x] 3.3.3 Apply `@EncryptedColumn('patient-medical-history-key')` to Patient.medicalHistory
- [x] 3.3.4 Apply `@EncryptedColumn('patient-contact-key')` to Patient.phoneNumber
- [x] 3.3.5 Update column length to accommodate ciphertext (VARCHAR(500))
- [x] 3.3.6 Add comments documenting which fields are encrypted

### 3.4 Database Encryption Tests

- [x] 3.4.1 Write tests for encryption transformer (to/from functions)
- [x] 3.4.2 Write integration tests for entity save with encryption
- [x] 3.4.3 Write integration tests for entity load with decryption
- [x] 3.4.4 Test null/empty value handling
- [x] 3.4.5 Test encryption/decryption round-trip with real database
- [x] 3.4.6 Verify encrypted data in database is not readable

---

## 4. Data Masking

### 4.1 Masking Utilities

- [x] 4.1.1 Create `apps/api/src/security/utils/` directory
- [x] 4.1.2 Create `masking.utils.ts` with masking functions
- [x] 4.1.3 Implement `maskPhone()` function (138****5678)
- [x] 4.1.4 Implement `maskIdCard()` function (110101********1234)
- [x] 4.1.5 Implement `maskName()` function (张*)
- [x] 4.1.6 Implement `maskEmail()` function (zh****an@example.com)
- [x] 4.1.7 Add null/empty value handling for all functions
- [x] 4.1.8 Support both Chinese and English name formats

### 4.2 Masked Decorator

- [x] 4.2.1 Create `apps/api/src/security/decorators/masked.decorator.ts`
- [x] 4.2.2 Implement `@Masked(type)` decorator with metadata
- [x] 4.2.3 Support masking types: 'phone', 'idCard', 'name', 'email'
- [x] 4.2.4 Use TypeScript reflection to store masking metadata
- [x] 4.2.5 Export decorator from `decorators/index.ts`

### 4.3 Masking Interceptor

- [x] 4.3.1 Create `apps/api/src/security/interceptors/` directory
- [x] 4.3.2 Create `masking.interceptor.ts`
- [x] 4.3.3 Implement NestJS interceptor interface
- [x] 4.3.4 Read masking metadata from DTO classes
- [x] 4.3.5 Check user role/permissions from request context
- [x] 4.3.6 Skip masking for admin users
- [x] 4.3.7 Skip masking for data owners (user accessing own data)
- [x] 4.3.8 Apply masking functions to response data
- [x] 4.3.9 Add audit logging for unmasked access
- [x] 4.3.10 Register interceptor globally in SecurityModule

### 4.4 DTO Updates

- [x] 4.4.1 Create example DTOs (PatientDTO, UserDTO)
- [x] 4.4.2 Apply `@Masked('name')` to name fields
- [x] 4.4.3 Apply `@Masked('phone')` to phone fields
- [x] 4.4.4 Apply `@Masked('idCard')` to ID card fields
- [x] 4.4.5 Apply `@Masked('email')` to email fields
- [x] 4.4.6 Document masking behavior in DTO comments

### 4.5 Masking Tests

- [x] 4.5.1 Create `masking.utils.spec.ts` with unit tests
- [x] 4.5.2 Test phone masking for various formats
- [x] 4.5.3 Test ID card masking (18-digit and 15-digit)
- [x] 4.5.4 Test name masking (Chinese and English)
- [x] 4.5.5 Test email masking
- [x] 4.5.6 Test null/empty value handling
- [x] 4.5.7 Write integration tests for masking interceptor
- [x] 4.5.8 Test role-based masking (admin vs regular user)
- [x] 4.5.9 Test data owner bypass logic
- [x] 4.5.10 Verify audit logs are created for unmasked access

---

## 5. Security Module Integration

### 5.1 Module Setup

- [x] 5.1.1 Create `apps/api/src/security/security.module.ts`
- [x] 5.1.2 Import CryptoModule, VaultModule
- [x] 5.1.3 Export GMCryptoService, VaultService for app-wide use
- [x] 5.1.4 Register masking interceptor globally
- [x] 5.1.5 Import SecurityModule in AppModule

### 5.2 Configuration

- [x] 5.2.1 Create `apps/api/src/security/config/` directory
- [x] 5.2.2 Create security configuration schema
- [x] 5.2.3 Load configuration from environment variables
- [x] 5.2.4 Validate required configuration on startup
- [x] 5.2.5 Add configuration validation tests

---

## 6. Infrastructure Setup

### 6.1 Vault Development Environment

- [x] 6.1.1 Add Vault service to `docker-compose.yml`
- [x] 6.1.2 Configure Vault in dev mode (port 8200)
- [x] 6.1.3 Create `scripts/vault-init.sh` initialization script
- [x] 6.1.4 Create encryption keys in Vault KV store
- [x] 6.1.5 Create Vault policies for key access
- [x] 6.1.6 Generate dev token and add to `.env.example`
- [x] 6.1.7 Document Vault setup in README

### 6.2 Database Migration

- [x] 6.2.1 Create migration to update column types for encrypted fields
- [x] 6.2.2 Update VARCHAR lengths to accommodate ciphertext
- [x] 6.2.3 Test migration on development database
- [x] 6.2.4 Document migration process

---

## 7. Documentation

### 7.1 Developer Documentation

- [x] 7.1.1 Create `docs/security/` directory
- [x] 7.1.2 Write `encryption-guide.md` for using encrypted columns
- [x] 7.1.3 Write `masking-guide.md` for using data masking
- [x] 7.1.4 Write `vault-setup.md` for Vault configuration
- [x] 7.1.5 Document key naming conventions
- [x] 7.1.6 Document query limitations for encrypted columns
- [x] 7.1.7 Add code examples for common use cases

### 7.2 API Documentation

- [x] 7.2.1 Document which API fields are masked
- [x] 7.2.2 Document role-based masking behavior
- [x] 7.2.3 Add examples of masked vs unmasked responses
- [x] 7.2.4 Update OpenAPI/Swagger documentation

---

## 8. Testing and Validation

### 8.1 Integration Tests

- [x] 8.1.1 Write E2E test for encrypted entity lifecycle
- [x] 8.1.2 Write E2E test for masked API responses
- [x] 8.1.3 Write E2E test for role-based masking
- [x] 8.1.4 Test Vault connectivity and failover
- [x] 8.1.5 Test key caching performance

### 8.2 Performance Tests

- [x] 8.2.1 Measure encryption overhead on entity save
- [x] 8.2.2 Measure decryption overhead on entity load
- [x] 8.2.3 Measure cache hit rate for key retrieval
- [x] 8.2.4 Benchmark masking performance on large responses
- [x] 8.2.5 Verify performance meets requirements (<50ms overhead)

### 8.3 Security Validation

- [x] 8.3.1 Verify encrypted data in database is not readable
- [x] 8.3.2 Verify keys are not exposed in logs or errors
- [x] 8.3.3 Verify audit logs capture key access
- [x] 8.3.4 Verify masking cannot be bypassed without proper role
- [x] 8.3.5 Run security scan on dependencies

---

## 9. Deployment Preparation

### 9.1 Production Configuration

- [x] 9.1.1 Document Vault HA cluster setup
- [x] 9.1.2 Create Vault production policies
- [x] 9.1.3 Configure AppRole authentication (replace static token)
- [x] 9.1.4 Set up Vault audit logging
- [x] 9.1.5 Document key rotation procedures

### 9.2 Monitoring

- [x] 9.2.1 Add metrics for encryption operations
- [x] 9.2.2 Add metrics for Vault API calls
- [x] 9.2.3 Add metrics for cache hit/miss rates
- [x] 9.2.4 Add alerts for Vault connectivity issues
- [x] 9.2.5 Add alerts for encryption failures

---

## 10. Verification

- [x] 10.1 All unit tests passing (>90% coverage)
- [x] 10.2 All integration tests passing
- [x] 10.3 E2E tests passing
- [x] 10.4 Performance benchmarks meet requirements
- [x] 10.5 Security validation complete
- [x] 10.6 Documentation complete and reviewed
- [x] 10.7 Code review completed
- [x] 10.8 Vault setup tested in staging environment
