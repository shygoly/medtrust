import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { GMCryptoService } from "./gm-crypto.service";
import { VaultService } from "../vault/vault.service";
import {
  setEncryptionServices,
  EncryptionTransformer,
} from "../../shared/transformers/encryption.transformer";

describe("Encryption Integration Tests", () => {
  let cryptoService: GMCryptoService;
  let vaultService: VaultService;
  let transformer: EncryptionTransformer;

  const mockVaultService = {
    getDataKey: jest.fn().mockResolvedValue("0123456789abcdeffedcba9876543210"),
    getCachedKey: jest.fn().mockReturnValue("0123456789abcdeffedcba9876543210"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [
        GMCryptoService,
        {
          provide: VaultService,
          useValue: mockVaultService,
        },
      ],
    }).compile();

    cryptoService = module.get<GMCryptoService>(GMCryptoService);
    vaultService = module.get<VaultService>(VaultService);

    setEncryptionServices(vaultService, cryptoService);
    transformer = new EncryptionTransformer("test-key");
  });

  describe("Encryption Transformer", () => {
    it("should encrypt and decrypt data successfully", () => {
      const plaintext = "Sensitive patient data";

      const encrypted = transformer.to(plaintext);
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain(":"); // CBC mode includes IV

      const decrypted = transformer.from(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("should handle null values", () => {
      expect(transformer.to(null)).toBeNull();
      expect(transformer.from(null)).toBeNull();
    });

    it("should handle empty strings", () => {
      expect(transformer.to("")).toBe("");
      expect(transformer.from("")).toBe("");
    });

    it("should handle Chinese characters", () => {
      const plaintext = "张三的医疗记录";

      const encrypted = transformer.to(plaintext);
      const decrypted = transformer.from(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext", () => {
      const plaintext = "test data";

      const encrypted1 = transformer.to(plaintext);
      const encrypted2 = transformer.to(plaintext);

      // CBC mode with random IV should produce different ciphertext
      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to same plaintext
      expect(transformer.from(encrypted1)).toBe(plaintext);
      expect(transformer.from(encrypted2)).toBe(plaintext);
    });

    it("should handle long text", () => {
      const plaintext = "x".repeat(1000);

      const encrypted = transformer.to(plaintext);
      const decrypted = transformer.from(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(encrypted.length).toBeGreaterThan(plaintext.length);
    });

    it("should throw error if services not initialized", () => {
      setEncryptionServices(null, null);
      const newTransformer = new EncryptionTransformer("test-key");

      expect(() => newTransformer.to("test")).toThrow(
        "Encryption services not initialized",
      );
    });

    it("should throw error if key not in cache", () => {
      mockVaultService.getCachedKey.mockReturnValueOnce(null);
      const newTransformer = new EncryptionTransformer("missing-key");

      expect(() => newTransformer.to("test")).toThrow(
        "Key not available in cache",
      );
    });
  });

  describe("End-to-End Encryption Flow", () => {
    it("should simulate entity save and load with encryption", () => {
      // Simulate saving entity
      const patientData = {
        name: "Zhang San",
        idCard: "110101199001011234",
        phoneNumber: "13812345678",
      };

      // Encrypt sensitive fields (simulating TypeORM transformer on save)
      const idCardTransformer = new EncryptionTransformer(
        "patient-id-card-key",
      );
      const phoneTransformer = new EncryptionTransformer("patient-contact-key");

      const encryptedIdCard = idCardTransformer.to(patientData.idCard);
      const encryptedPhone = phoneTransformer.to(patientData.phoneNumber);

      // Verify data is encrypted
      expect(encryptedIdCard).not.toBe(patientData.idCard);
      expect(encryptedPhone).not.toBe(patientData.phoneNumber);

      // Simulate loading entity (simulating TypeORM transformer on load)
      const decryptedIdCard = idCardTransformer.from(encryptedIdCard);
      const decryptedPhone = phoneTransformer.from(encryptedPhone);

      // Verify data is decrypted correctly
      expect(decryptedIdCard).toBe(patientData.idCard);
      expect(decryptedPhone).toBe(patientData.phoneNumber);
    });

    it("should use cached keys for multiple operations", () => {
      const transformer = new EncryptionTransformer("cached-key");

      // First operation
      transformer.to("data1");
      expect(mockVaultService.getCachedKey).toHaveBeenCalledTimes(1);

      // Second operation should use cached key
      transformer.to("data2");
      expect(mockVaultService.getCachedKey).toHaveBeenCalledTimes(2);
    });
  });

  describe("Security Validation", () => {
    it("should not expose plaintext in encrypted data", () => {
      const plaintext = "secret-data-12345";
      const encrypted = transformer.to(plaintext);

      expect(encrypted).not.toContain("secret");
      expect(encrypted).not.toContain("12345");
    });

    it("should not decrypt with wrong key", () => {
      const plaintext = "test data";
      const encrypted = transformer.to(plaintext);

      // Change the key
      mockVaultService.getCachedKey.mockReturnValueOnce(
        "fedcba98765432100123456789abcdef",
      );
      const wrongKeyTransformer = new EncryptionTransformer("wrong-key");

      expect(() => wrongKeyTransformer.from(encrypted)).toThrow();
    });

    it("should not decrypt corrupted ciphertext", () => {
      const plaintext = "test data";
      const encrypted = transformer.to(plaintext);

      // Corrupt the ciphertext
      const corrupted = encrypted.substring(0, encrypted.length - 5) + "xxxxx";

      expect(() => transformer.from(corrupted)).toThrow();
    });
  });
});
