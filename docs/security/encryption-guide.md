# Encryption Guide

## Overview

MedTrust uses Chinese national cryptography algorithms (SM2/SM3/SM4) for data-at-rest encryption, complying with 等保2.0/3.0 requirements.

## Quick Start

### 1. Using Encrypted Columns

Apply the `@EncryptedColumn` decorator to entity fields that need encryption:

```typescript
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { EncryptedColumn } from '../security/decorators';

@Entity()
export class Patient {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @EncryptedColumn('patient-id-card-key')
  idCard: string;

  @EncryptedColumn('patient-medical-history-key', { length: 1000 })
  medicalHistory: string;

  @EncryptedColumn('patient-contact-key')
  phoneNumber: string;
}
```

### 2. How It Works

- **Transparent Encryption**: Data is automatically encrypted when saved and decrypted when loaded
- **SM4 Algorithm**: Uses SM4 CBC mode for symmetric encryption
- **Key Management**: Encryption keys are stored in HashiCorp Vault
- **Key Caching**: Keys are cached in memory for 5 minutes to reduce Vault API calls

### 3. Key Naming Convention

Keys should follow the pattern: `{entity}-{field}-key`

Examples:
- `patient-id-card-key`
- `patient-medical-history-key`
- `user-password-key`
- `medical-record-diagnosis-key`

## Configuration

### Environment Variables

```bash
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=your-vault-token
KEY_CACHE_TTL_SECONDS=300
```

### Creating Keys in Vault

```bash
vault kv put secret/medical/patient-id-card-key \
  key="0123456789abcdeffedcba9876543210" \
  description="SM4 key for patient ID card encryption"
```

**Important**: Keys must be 32 hex characters (128 bits) for SM4.

## Usage Examples

### Saving Encrypted Data

```typescript
const patient = new Patient();
patient.name = 'Zhang San';
patient.idCard = '110101199001011234'; // Will be encrypted
patient.phoneNumber = '13812345678'; // Will be encrypted

await patientRepository.save(patient);
// Database stores encrypted ciphertext
```

### Reading Encrypted Data

```typescript
const patient = await patientRepository.findOne({ where: { id: 1 } });
console.log(patient.idCard); // '110101199001011234' (automatically decrypted)
```

### Querying Encrypted Columns

**⚠️ Important Limitation**: You cannot query encrypted columns in WHERE clauses.

```typescript
// ❌ This will NOT work
const patient = await patientRepository.findOne({
  where: { idCard: '110101199001011234' }
});

// ✅ Use non-encrypted fields for queries
const patients = await patientRepository.find({
  where: { name: 'Zhang San' }
});
```

## Column Configuration

### Custom Column Length

Encrypted data is larger than plaintext. Adjust column length accordingly:

```typescript
@EncryptedColumn('key-id', { length: 1000 })
largeTextField: string;
```

**Rule of thumb**: Encrypted size ≈ plaintext size × 1.5 + 50 bytes (for IV and padding)

### Nullable Columns

```typescript
@EncryptedColumn('key-id', { nullable: true })
optionalField: string | null;
```

## Security Best Practices

1. **Key Rotation**: Plan for periodic key rotation (manual process currently)
2. **Vault Access**: Use AppRole authentication in production, not static tokens
3. **Audit Logging**: Monitor key access via Vault audit logs
4. **Backup Keys**: Securely backup Vault data - lost keys = lost data
5. **Network Security**: Use TLS for Vault communication in production

## Troubleshooting

### Error: "Encryption services not initialized"

**Cause**: SecurityModule not imported or services not available.

**Solution**: Ensure `SecurityModule` is imported in `AppModule`:

```typescript
@Module({
  imports: [SecurityModule, ...],
})
export class AppModule {}
```

### Error: "Key not available in cache"

**Cause**: Key not preloaded from Vault.

**Solution**: Ensure Vault is running and keys exist:

```bash
vault kv get secret/medical/your-key-id
```

### Error: "SM4 decryption failed"

**Cause**: Data corrupted or wrong key used.

**Solution**:
- Verify the correct key ID is used
- Check if data was encrypted with a different key
- Ensure database column is large enough to store ciphertext

## Performance Considerations

- **Encryption Overhead**: ~5-10ms per operation
- **Cache Hit Rate**: >95% with default 5-minute TTL
- **Vault Latency**: ~20-50ms per key fetch (when cache misses)

## Migration Guide

### Encrypting Existing Data

```typescript
// 1. Add @EncryptedColumn decorator
// 2. Create migration to update column type
// 3. Run data migration script

const patients = await patientRepository.find();
for (const patient of patients) {
  // Re-save to trigger encryption
  await patientRepository.save(patient);
}
```

### Changing Encryption Keys

```typescript
// 1. Create new key in Vault
// 2. Decrypt with old key, encrypt with new key
// 3. Update decorator to use new key ID
```

## API Reference

### GMCryptoService

```typescript
class GMCryptoService {
  sm4Encrypt(plaintext: string, key: string, mode: 'ecb' | 'cbc'): string;
  sm4Decrypt(ciphertext: string, key: string, mode: 'ecb' | 'cbc'): string;
  sm3Hash(message: string): string;
  // ... more methods
}
```

### VaultService

```typescript
class VaultService {
  getDataKey(keyId: string): Promise<string>;
  invalidateCache(keyId?: string): void;
  getCacheStats(): { size: number; keys: string[] };
}
```

## Further Reading

- [SM4 Algorithm Specification](https://tools.ietf.org/html/draft-ribose-cfrg-sm4-10)
- [HashiCorp Vault Documentation](https://www.vaultproject.io/docs)
- [等保2.0 Compliance Requirements](https://www.tc260.org.cn/)
