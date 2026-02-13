# GM Crypto Algorithms Specification

## ADDED Requirements

### Requirement: SM2 Key Pair Generation

The system shall generate SM2 (国密2号算法) public/private key pairs for asymmetric encryption and digital signatures.

#### Scenario: Generate new SM2 key pair

- **WHEN** a service requests a new SM2 key pair
- **THEN** the system returns a hex-encoded public key (130 characters)
- **AND** the system returns a hex-encoded private key (64 characters)
- **AND** the key pair is cryptographically valid for SM2 operations

---

### Requirement: SM2 Encryption and Decryption

The system shall encrypt and decrypt data using SM2 public-key cryptography with C1C3C2 mode.

#### Scenario: Encrypt data with SM2 public key

- **WHEN** plaintext data is encrypted with a valid SM2 public key
- **THEN** the system returns a hex-encoded ciphertext
- **AND** the ciphertext can be decrypted using the corresponding private key
- **AND** decryption recovers the original plaintext exactly

#### Scenario: Decrypt data with SM2 private key

- **WHEN** SM2-encrypted ciphertext is decrypted with the correct private key
- **THEN** the system returns the original plaintext
- **AND** decryption with an incorrect private key fails with an error

---

### Requirement: SM2 Digital Signatures

The system shall create and verify digital signatures using SM2 algorithm.

#### Scenario: Sign data with SM2 private key

- **WHEN** data is signed with a valid SM2 private key
- **THEN** the system returns a hex-encoded signature
- **AND** the signature can be verified using the corresponding public key

#### Scenario: Verify SM2 signature

- **WHEN** a signature is verified with the correct SM2 public key
- **THEN** the system returns true for valid signatures
- **AND** the system returns false for invalid or tampered signatures
- **AND** verification fails if the data has been modified

---

### Requirement: SM3 Hashing

The system shall compute SM3 (国密3号算法) cryptographic hash values for data integrity verification.

#### Scenario: Compute SM3 hash

- **WHEN** data is hashed using SM3 algorithm
- **THEN** the system returns a 64-character hex-encoded hash
- **AND** identical input data produces identical hash values
- **AND** different input data produces different hash values (collision resistance)

---

### Requirement: SM4 Symmetric Encryption

The system shall encrypt and decrypt data using SM4 (国密4号算法) block cipher in ECB or CBC mode.

#### Scenario: Encrypt data with SM4 in ECB mode

- **WHEN** plaintext is encrypted with a 128-bit SM4 key in ECB mode
- **THEN** the system returns hex-encoded ciphertext
- **AND** the ciphertext can be decrypted with the same key
- **AND** decryption recovers the original plaintext

#### Scenario: Encrypt data with SM4 in CBC mode

- **WHEN** plaintext is encrypted with a 128-bit SM4 key and IV in CBC mode
- **THEN** the system returns hex-encoded ciphertext
- **AND** the ciphertext can be decrypted with the same key and IV
- **AND** decryption with incorrect IV fails or produces garbage

---

### Requirement: Envelope Encryption

The system shall implement envelope encryption pattern where SM2 encrypts SM4 keys, and SM4 encrypts data.

#### Scenario: Envelope encrypt sensitive data

- **WHEN** data is envelope-encrypted with an SM2 public key
- **THEN** the system generates a random 128-bit SM4 data encryption key (DEK)
- **AND** the system encrypts the data with the SM4 DEK
- **AND** the system encrypts the SM4 DEK with the SM2 public key
- **AND** the system returns both encrypted data and encrypted DEK
- **AND** the algorithm identifier is "SM2-with-SM4"

#### Scenario: Envelope decrypt sensitive data

- **WHEN** envelope-encrypted data is decrypted with the SM2 private key
- **THEN** the system decrypts the encrypted DEK using SM2 private key
- **AND** the system decrypts the data using the recovered SM4 DEK
- **AND** the system returns the original plaintext

---

## Implementation Notes

- Use `sm-crypto` npm package for all SM2/SM3/SM4 operations
- SM2 uses elliptic curve cryptography (ECC) with Chinese national curve
- SM4 key length is fixed at 128 bits (16 bytes)
- Envelope encryption provides better performance for large data (symmetric encryption is faster)
- All keys and ciphertext should be hex-encoded for storage and transmission
