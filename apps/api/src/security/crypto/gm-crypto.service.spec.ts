import { Test, TestingModule } from "@nestjs/testing";
import { GMCryptoService } from "./gm-crypto.service";

describe("GMCryptoService", () => {
  let service: GMCryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GMCryptoService],
    }).compile();

    service = module.get<GMCryptoService>(GMCryptoService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("SM2 Key Generation", () => {
    it("should generate a valid SM2 key pair", () => {
      const keyPair = service.generateSM2KeyPair();

      expect(keyPair).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(typeof keyPair.publicKey).toBe("string");
      expect(typeof keyPair.privateKey).toBe("string");
      expect(keyPair.publicKey.length).toBeGreaterThan(0);
      expect(keyPair.privateKey.length).toBeGreaterThan(0);
    });

    it("should generate different key pairs on each call", () => {
      const keyPair1 = service.generateSM2KeyPair();
      const keyPair2 = service.generateSM2KeyPair();

      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
    });
  });

  describe("SM2 Encryption/Decryption", () => {
    it("should encrypt and decrypt data successfully", () => {
      const keyPair = service.generateSM2KeyPair();
      const plaintext = "Hello, MedTrust!";

      const ciphertext = service.sm2Encrypt(plaintext, keyPair.publicKey);
      expect(ciphertext).toBeDefined();
      expect(ciphertext).not.toBe(plaintext);

      const decrypted = service.sm2Decrypt(ciphertext, keyPair.privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it("should handle Chinese characters", () => {
      const keyPair = service.generateSM2KeyPair();
      const plaintext = "医疗数据加密测试";

      const ciphertext = service.sm2Encrypt(plaintext, keyPair.publicKey);
      const decrypted = service.sm2Decrypt(ciphertext, keyPair.privateKey);

      expect(decrypted).toBe(plaintext);
    });

    it("should throw error with invalid private key", () => {
      const keyPair = service.generateSM2KeyPair();
      const plaintext = "test";
      const ciphertext = service.sm2Encrypt(plaintext, keyPair.publicKey);

      expect(() => service.sm2Decrypt(ciphertext, "invalid-key")).toThrow(
        "SM2 decryption failed",
      );
    });
  });

  describe("SM2 Signing/Verification", () => {
    it("should sign and verify message successfully", () => {
      const keyPair = service.generateSM2KeyPair();
      const message = "Important medical record";

      const signature = service.sm2Sign(message, keyPair.privateKey);
      expect(signature).toBeDefined();

      const isValid = service.sm2Verify(message, signature, keyPair.publicKey);
      expect(isValid).toBe(true);
    });

    it("should fail verification with wrong message", () => {
      const keyPair = service.generateSM2KeyPair();
      const message = "Original message";
      const signature = service.sm2Sign(message, keyPair.privateKey);

      const isValid = service.sm2Verify(
        "Tampered message",
        signature,
        keyPair.publicKey,
      );
      expect(isValid).toBe(false);
    });

    it("should fail verification with wrong public key", () => {
      const keyPair1 = service.generateSM2KeyPair();
      const keyPair2 = service.generateSM2KeyPair();
      const message = "Test message";

      const signature = service.sm2Sign(message, keyPair1.privateKey);
      const isValid = service.sm2Verify(message, signature, keyPair2.publicKey);

      expect(isValid).toBe(false);
    });
  });

  describe("SM3 Hashing", () => {
    it("should generate deterministic hash", () => {
      const message = "Test message";

      const hash1 = service.sm3Hash(message);
      const hash2 = service.sm3Hash(message);

      expect(hash1).toBe(hash2);
      expect(hash1).toBeDefined();
      expect(typeof hash1).toBe("string");
    });

    it("should generate different hashes for different messages", () => {
      const hash1 = service.sm3Hash("message1");
      const hash2 = service.sm3Hash("message2");

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty string", () => {
      const hash = service.sm3Hash("");
      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
    });
  });

  describe("SM4 ECB Mode", () => {
    it("should encrypt and decrypt in ECB mode", () => {
      const key = "0123456789abcdeffedcba9876543210";
      const plaintext = "Medical data";

      const ciphertext = service.sm4Encrypt(plaintext, key, "ecb");
      expect(ciphertext).toBeDefined();
      expect(ciphertext).not.toBe(plaintext);

      const decrypted = service.sm4Decrypt(ciphertext, key, "ecb");
      expect(decrypted).toBe(plaintext);
    });

    it("should produce same ciphertext for same plaintext in ECB", () => {
      const key = "0123456789abcdeffedcba9876543210";
      const plaintext = "test";

      const ciphertext1 = service.sm4Encrypt(plaintext, key, "ecb");
      const ciphertext2 = service.sm4Encrypt(plaintext, key, "ecb");

      expect(ciphertext1).toBe(ciphertext2);
    });
  });

  describe("SM4 CBC Mode", () => {
    it("should encrypt and decrypt in CBC mode", () => {
      const key = "0123456789abcdeffedcba9876543210";
      const plaintext = "Patient medical history";

      const ciphertext = service.sm4Encrypt(plaintext, key, "cbc");
      expect(ciphertext).toBeDefined();
      expect(ciphertext).toContain(":");

      const decrypted = service.sm4Decrypt(ciphertext, key, "cbc");
      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext in CBC", () => {
      const key = "0123456789abcdeffedcba9876543210";
      const plaintext = "test";

      const ciphertext1 = service.sm4Encrypt(plaintext, key, "cbc");
      const ciphertext2 = service.sm4Encrypt(plaintext, key, "cbc");

      expect(ciphertext1).not.toBe(ciphertext2);
    });

    it("should use provided IV", () => {
      const key = "0123456789abcdeffedcba9876543210";
      const iv = "fedcba98765432100123456789abcdef";
      const plaintext = "test";

      const ciphertext1 = service.sm4Encrypt(plaintext, key, "cbc", iv);
      const ciphertext2 = service.sm4Encrypt(plaintext, key, "cbc", iv);

      expect(ciphertext1).toBe(ciphertext2);
      expect(ciphertext1).toContain(iv);
    });

    it("should throw error for invalid CBC ciphertext format", () => {
      const key = "0123456789abcdeffedcba9876543210";
      const invalidCiphertext = "invalid-format";

      expect(() => service.sm4Decrypt(invalidCiphertext, key, "cbc")).toThrow();
    });
  });

  describe("Envelope Encryption", () => {
    it("should perform envelope encryption and decryption", () => {
      const keyPair = service.generateSM2KeyPair();
      const plaintext = "Sensitive patient data that needs envelope encryption";

      const result = service.envelopeEncrypt(plaintext, keyPair.publicKey);
      expect(result).toBeDefined();
      expect(result.encryptedData).toBeDefined();
      expect(result.encryptedDEK).toBeDefined();

      const decrypted = service.envelopeDecrypt(
        result.encryptedData,
        result.encryptedDEK,
        keyPair.privateKey,
      );
      expect(decrypted).toBe(plaintext);
    });

    it("should handle large data efficiently", () => {
      const keyPair = service.generateSM2KeyPair();
      const largeData = "x".repeat(10000);

      const result = service.envelopeEncrypt(largeData, keyPair.publicKey);
      const decrypted = service.envelopeDecrypt(
        result.encryptedData,
        result.encryptedDEK,
        keyPair.privateKey,
      );

      expect(decrypted).toBe(largeData);
    });

    it("should generate unique DEK for each encryption", () => {
      const keyPair = service.generateSM2KeyPair();
      const plaintext = "test";

      const result1 = service.envelopeEncrypt(plaintext, keyPair.publicKey);
      const result2 = service.envelopeEncrypt(plaintext, keyPair.publicKey);

      expect(result1.encryptedDEK).not.toBe(result2.encryptedDEK);
      expect(result1.encryptedData).not.toBe(result2.encryptedData);
    });
  });

  describe("Error Handling", () => {
    it("should handle SM2 encryption errors gracefully", () => {
      expect(() => service.sm2Encrypt("test", "invalid-key")).toThrow(
        "SM2 encryption failed",
      );
    });

    it("should handle SM2 decryption errors gracefully", () => {
      expect(() => service.sm2Decrypt("invalid", "invalid-key")).toThrow(
        "SM2 decryption failed",
      );
    });

    it("should handle SM2 signing errors gracefully", () => {
      expect(() => service.sm2Sign("test", "invalid-key")).toThrow(
        "SM2 signing failed",
      );
    });

    it("rejects malformed SM2 private keys by format, not by fixture string", () => {
      // None of these is the literal "invalid-key" — real format validation
      // must reject them because they are not 64-char hex private keys.
      expect(() => service.sm2Sign("test", "deadbeef")).toThrow(
        "SM2 signing failed",
      );
      expect(() => service.sm2Decrypt("ciphertext", "z".repeat(64))).toThrow(
        "SM2 decryption failed",
      );
      const validKey = service.generateSM2KeyPair().privateKey;
      // A genuinely valid key must still pass validation (sign succeeds).
      expect(() => service.sm2Sign("test", validKey)).not.toThrow();
    });

    it("should handle SM4 decryption with invalid format", () => {
      const key = "0123456789abcdeffedcba9876543210";
      expect(() => service.sm4Decrypt("invalid-format", key, "cbc")).toThrow();
    });
  });
});
