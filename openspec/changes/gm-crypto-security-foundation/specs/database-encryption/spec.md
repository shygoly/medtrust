# Database Encryption Specification

## ADDED Requirements

### Requirement: Encrypted Column Decorator

The system shall provide a TypeORM decorator that transparently encrypts data on write and decrypts on read.

#### Scenario: Define encrypted column in entity

- **WHEN** an entity property is decorated with `@EncryptedColumn(keyId)`
- **THEN** the decorator configures a TypeORM column with encryption transformer
- **AND** the column type is set to `varchar` to store hex-encoded ciphertext
- **AND** the keyId parameter identifies which encryption key to use from Vault

#### Scenario: Write encrypted data to database

- **WHEN** an entity with encrypted columns is saved to the database
- **THEN** the system retrieves the encryption key from Vault using the keyId
- **AND** the system encrypts the plaintext value using SM4 algorithm
- **AND** the system stores the hex-encoded ciphertext in the database
- **AND** null or empty values are stored as-is without encryption

#### Scenario: Read encrypted data from database

- **WHEN** an entity with encrypted columns is loaded from the database
- **THEN** the system retrieves the decryption key from Vault using the keyId
- **AND** the system decrypts the ciphertext using SM4 algorithm
- **AND** the system returns the original plaintext value to the application
- **AND** null or empty values are returned as-is without decryption

---

### Requirement: Multiple Encryption Keys

The system shall support different encryption keys for different data types or sensitivity levels.

#### Scenario: Use different keys for different columns

- **WHEN** multiple columns use different keyId values
- **THEN** each column is encrypted with its corresponding key from Vault
- **AND** patient ID cards use `patient-id-card-key`
- **AND** medical histories use `patient-medical-history-key`
- **AND** contact information uses `patient-contact-key`
- **AND** keys can be rotated independently per data type

---

### Requirement: Encryption Transparency

The system shall make encryption transparent to application code outside the entity layer.

#### Scenario: Application code reads decrypted values

- **WHEN** application code accesses an encrypted entity property
- **THEN** the value is automatically decrypted
- **AND** the application receives plaintext without calling decrypt methods
- **AND** the application code is unaware of encryption implementation

#### Scenario: Application code writes plaintext values

- **WHEN** application code sets an encrypted entity property
- **THEN** the value is automatically encrypted on save
- **AND** the application provides plaintext without calling encrypt methods
- **AND** the encryption happens transparently in the ORM layer

---

### Requirement: Query Limitations

The system shall document that encrypted columns cannot be used in WHERE clauses or indexes.

#### Scenario: Query encrypted column

- **WHEN** a query attempts to filter by an encrypted column value
- **THEN** the query will not match because the database contains ciphertext
- **AND** the system documentation warns against using encrypted columns in WHERE clauses
- **AND** searchable fields must remain unencrypted or use searchable encryption schemes

---

### Requirement: Error Handling

The system shall handle encryption/decryption errors gracefully.

#### Scenario: Decryption fails due to wrong key

- **WHEN** data is decrypted with an incorrect key (after key rotation)
- **THEN** the system throws a descriptive error
- **AND** the error indicates decryption failure
- **AND** the error does not expose sensitive key material

#### Scenario: Vault is unavailable

- **WHEN** the encryption transformer cannot reach Vault
- **THEN** the system throws a connection error
- **AND** the database operation fails
- **AND** the error message indicates Vault connectivity issue

---

## Implementation Notes

- Use TypeORM's `transformer` option in `@Column()` decorator
- Transformer has `to` (encrypt on write) and `from` (decrypt on read) functions
- Encryption keys are retrieved from Vault service, not hardcoded
- Consider caching decryption keys in memory with TTL to reduce Vault calls
- Encrypted columns should be sufficiently long (e.g., VARCHAR(500)) to store ciphertext
- Document which fields are encrypted in entity comments for developer awareness
