import { Test, TestingModule } from '@nestjs/testing';
import { GMCryptoService } from './gm-crypto.service';

describe('GMCryptoService Integration', () => {
  let service: GMCryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GMCryptoService],
    }).compile();

    service = module.get<GMCryptoService>(GMCryptoService);
  });

  describe('SM2 sign/verify round-trip', () => {
    it('should sign and verify a message', () => {
      const keypair = service.generateSM2KeyPair();
      const message = 'medtrust-attestation-payload';

      const signature = service.sm2Sign(message, keypair.privateKey);
      expect(signature).toBeDefined();

      const isValid = service.sm2Verify(message, signature, keypair.publicKey);
      expect(isValid).toBe(true);
    });

    it('should reject tampered message', () => {
      const keypair = service.generateSM2KeyPair();
      const signature = service.sm2Sign('original', keypair.privateKey);
      expect(service.sm2Verify('tampered', signature, keypair.publicKey)).toBe(false);
    });
  });

  describe('SM2 encrypt/decrypt round-trip', () => {
    it('should encrypt and decrypt data', () => {
      const keypair = service.generateSM2KeyPair();
      const plaintext = 'patient-id-card-data-12345';

      const encrypted = service.sm2Encrypt(plaintext, keypair.publicKey);
      expect(encrypted).not.toBe(plaintext);

      const decrypted = service.sm2Decrypt(encrypted, keypair.privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle Chinese text', () => {
      const keypair = service.generateSM2KeyPair();
      const plaintext = '患者张三，身份证号110101199001011234';

      const encrypted = service.sm2Encrypt(plaintext, keypair.publicKey);
      const decrypted = service.sm2Decrypt(encrypted, keypair.privateKey);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('SM3 hash determinism', () => {
    it('should produce same hash for same input', () => {
      const input = 'medtrust-audit-log-entry';
      const hash1 = service.sm3Hash(input);
      const hash2 = service.sm3Hash(input);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should produce different hash for different input', () => {
      const hash1 = service.sm3Hash('entry-a');
      const hash2 = service.sm3Hash('entry-b');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = service.sm3Hash('');
      expect(hash).toHaveLength(64);
    });
  });

  describe('SM4 encrypt/decrypt round-trip', () => {
    it('should encrypt and decrypt with key', () => {
      const key = '0123456789abcdeffedcba9876543210';
      const plaintext = 'sensitive medical record content';

      const encrypted = service.sm4Encrypt(plaintext, key);
      expect(encrypted).not.toBe(plaintext);

      const decrypted = service.sm4Decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should fail with wrong key', () => {
      const key = '0123456789abcdeffedcba9876543210';
      const wrongKey = 'fedcba98765432100123456789abcdef';
      const encrypted = service.sm4Encrypt('data', key);

      expect(() => service.sm4Decrypt(encrypted, wrongKey)).toThrow();
    });

    it('should produce different ciphertext each time (CBC mode IV)', () => {
      const key = '0123456789abcdeffedcba9876543210';
      const plaintext = 'repeatable-test-data';

      const encrypted1 = service.sm4Encrypt(plaintext, key);
      const encrypted2 = service.sm4Encrypt(plaintext, key);
      expect(encrypted1).not.toBe(encrypted2);
      expect(service.sm4Decrypt(encrypted1, key)).toBe(plaintext);
      expect(service.sm4Decrypt(encrypted2, key)).toBe(plaintext);
    });
  });
});
