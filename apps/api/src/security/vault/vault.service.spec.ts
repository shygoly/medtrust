import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { VaultService } from "./vault.service";

const mockVaultClient = {
  health: jest.fn().mockResolvedValue({}),
  read: jest.fn(),
  write: jest.fn(),
};

// Mock node-vault: use a lazy factory that defers to the current mock client.
// jest.mock hoists this to the top, but we work around it by reading from a
// mutable reference that the test helpers can update.
let currentVaultClient = mockVaultClient;
jest.mock("node-vault", () => jest.fn(() => currentVaultClient));

describe("VaultService", () => {
  let service: VaultService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset the mock client reference (in case any test replaced it)
    currentVaultClient = mockVaultClient;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VaultService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config = {
                VAULT_ADDR: "http://localhost:8200",
                VAULT_TOKEN: "test-token",
                KEY_CACHE_TTL_SECONDS: 300,
                AUDIT_LOG_UNMASKED_ACCESS: true,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<VaultService>(VaultService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("onModuleInit", () => {
    it("should initialize Vault client successfully", async () => {
      await service.onModuleInit();
      expect(mockVaultClient.health).toHaveBeenCalled();
    });

    it("should throw error if Vault is unreachable", async () => {
      // Scope the NODE_ENV mutation to this test only — leaking it pollutes
      // later specs in the same worker (e.g. encryption.integration decrypt
      // behaviour differs under production), causing order-dependent failures.
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        mockVaultClient.health.mockRejectedValueOnce(
          new Error("Connection refused"),
        );
        await expect(service.onModuleInit()).rejects.toThrow(
          "Vault initialization failed",
        );
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });

  describe("getDataKey", () => {
    const keyId = "patient-id-card-key";
    const mockKey = "0123456789abcdeffedcba9876543210";

    beforeEach(async () => {
      await service.onModuleInit();
      mockVaultClient.read.mockResolvedValue({
        data: {
          data: { key: mockKey },
        },
      });
    });

    it("should retrieve key from Vault successfully", async () => {
      const key = await service.getDataKey(keyId);

      expect(key).toBe(mockKey);
      expect(mockVaultClient.read).toHaveBeenCalledWith(
        `secret/data/medical/${keyId}`,
      );
    });

    it("should cache retrieved key", async () => {
      await service.getDataKey(keyId);
      await service.getDataKey(keyId);

      expect(mockVaultClient.read).toHaveBeenCalledTimes(1);
    });

    it("should return cached key on subsequent calls", async () => {
      const key1 = await service.getDataKey(keyId);
      const key2 = await service.getDataKey(keyId);

      expect(key1).toBe(key2);
      expect(mockVaultClient.read).toHaveBeenCalledTimes(1);
    });

    it("should throw error if key not found", async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: { data: {} },
      });

      await expect(service.getDataKey(keyId)).rejects.toThrow(
        `Failed to retrieve key: ${keyId}`,
      );
    });

    it("should throw error on Vault connection failure", async () => {
      mockVaultClient.read.mockRejectedValue(new Error("Connection timeout"));

      await expect(service.getDataKey(keyId)).rejects.toThrow(
        `Failed to retrieve key: ${keyId}`,
      );
    });
  });

  describe("Cache Management", () => {
    const keyId = "test-key";
    const mockKey = "test-key-value";

    beforeEach(async () => {
      await service.onModuleInit();
      mockVaultClient.read.mockResolvedValue({
        data: { data: { key: mockKey } },
      });
    });

    it("should expire cached keys after TTL", async () => {
      jest.useFakeTimers();

      await service.getDataKey(keyId);
      expect(mockVaultClient.read).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(301000);

      await service.getDataKey(keyId);
      expect(mockVaultClient.read).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it("should invalidate specific key from cache", async () => {
      await service.getDataKey(keyId);
      expect(mockVaultClient.read).toHaveBeenCalledTimes(1);

      service.invalidateCache(keyId);

      await service.getDataKey(keyId);
      expect(mockVaultClient.read).toHaveBeenCalledTimes(2);
    });

    it("should invalidate all keys from cache", async () => {
      await service.getDataKey("key1");
      await service.getDataKey("key2");

      service.invalidateCache();

      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it("should return cache statistics", async () => {
      await service.getDataKey("key1");
      await service.getDataKey("key2");

      const stats = service.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain("key1");
      expect(stats.keys).toContain("key2");
    });
  });

  describe("getDatabaseCredentials", () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it("should retrieve database credentials successfully", async () => {
      mockVaultClient.read.mockResolvedValueOnce({
        data: {
          username: "db_user_123",
          password: "secure_password",
        },
      });

      const creds = await service.getDatabaseCredentials("medtrust-app");

      expect(creds.username).toBe("db_user_123");
      expect(creds.password).toBe("secure_password");
      expect(mockVaultClient.read).toHaveBeenCalledWith(
        "database/creds/medtrust-app",
      );
    });

    it("should throw error on failure", async () => {
      mockVaultClient.read.mockRejectedValueOnce(new Error("Access denied"));

      await expect(
        service.getDatabaseCredentials("invalid-role"),
      ).rejects.toThrow(
        "Failed to retrieve database credentials: invalid-role",
      );
    });
  });

  describe("Transit Engine - DEK Encryption/Decryption", () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it("should encrypt DEK using Transit engine", async () => {
      const plaintext = "0123456789abcdef";
      const ciphertext = "vault:v1:encrypted_data";

      mockVaultClient.write.mockResolvedValueOnce({
        data: { ciphertext },
      });

      const result = await service.encryptDEK(plaintext, "medtrust-kek");

      expect(result).toBe(ciphertext);
      expect(mockVaultClient.write).toHaveBeenCalledWith(
        "transit/encrypt/medtrust-kek",
        {
          plaintext: Buffer.from(plaintext).toString("base64"),
        },
      );
    });

    it("should decrypt DEK using Transit engine", async () => {
      const ciphertext = "vault:v1:encrypted_data";
      const plaintext = "0123456789abcdef";

      mockVaultClient.write.mockResolvedValueOnce({
        data: { plaintext: Buffer.from(plaintext).toString("base64") },
      });

      const result = await service.decryptDEK(ciphertext, "medtrust-kek");

      expect(result).toBe(plaintext);
      expect(mockVaultClient.write).toHaveBeenCalledWith(
        "transit/decrypt/medtrust-kek",
        {
          ciphertext,
        },
      );
    });

    it("should throw error on encryption failure", async () => {
      mockVaultClient.write.mockRejectedValueOnce(
        new Error("Encryption failed"),
      );

      await expect(service.encryptDEK("test", "key")).rejects.toThrow(
        "Failed to encrypt DEK: key",
      );
    });

    it("should throw error on decryption failure", async () => {
      mockVaultClient.write.mockRejectedValueOnce(
        new Error("Decryption failed"),
      );

      await expect(service.decryptDEK("vault:v1:test", "key")).rejects.toThrow(
        "Failed to decrypt DEK: key",
      );
    });
  });

  describe("Retry Logic", () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it("should retry on transient failures", async () => {
      mockVaultClient.read
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValueOnce({
          data: { data: { key: "test-key" } },
        });

      const key = await service.getDataKey("retry-test");
      expect(key).toBe("test-key");
      expect(mockVaultClient.read).toHaveBeenCalledTimes(3);
    });

    it("should fail after max retries", async () => {
      mockVaultClient.read.mockRejectedValue(new Error("Persistent failure"));

      await expect(service.getDataKey("fail-test")).rejects.toThrow();
      expect(mockVaultClient.read).toHaveBeenCalledTimes(3);
    });
  });
});
