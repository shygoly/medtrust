import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import vault from "node-vault";
import { CachedKey, VaultConfig } from "./vault.config";

@Injectable()
export class VaultService implements OnModuleInit {
  private readonly logger = new Logger(VaultService.name);
  private vaultClient: any;
  private keyCache = new Map<string, CachedKey>();
  private config: VaultConfig;
  private readonly DEFAULT_CACHE_TTL = 300;

  constructor(private configService: ConfigService) {
    this.config = {
      address: this.configService.get<string>(
        "VAULT_ADDR",
        "http://localhost:8200",
      ),
      token: this.configService.get<string>("VAULT_TOKEN", ""),
      cacheTTLSeconds: this.configService.get<number>(
        "KEY_CACHE_TTL_SECONDS",
        this.DEFAULT_CACHE_TTL,
      ),
    };
  }

  async onModuleInit() {
    try {
      this.vaultClient = vault({
        apiVersion: "v1",
        endpoint: this.config.address,
        token: this.config.token,
      });

      await this.vaultClient.health();
      this.logger.log("Vault client initialized successfully");
    } catch (error) {
      // In production Vault is mandatory; in dev it's optional infra (docker).
      // Degrade gracefully so the app boots without Vault running locally.
      if (process.env.NODE_ENV === "production") {
        this.logger.error("Failed to initialize Vault client", error);
        throw new Error("Vault initialization failed");
      }
      this.logger.warn(
        "Vault unavailable — continuing in degraded mode (dev only); key operations will fail until Vault is reachable.",
      );
    }
  }

  async getDataKey(keyId: string): Promise<string> {
    const cached = this.getCachedKey(keyId);
    if (cached) {
      this.logger.debug(`Cache hit for key: ${keyId}`);
      return cached;
    }

    this.logger.debug(`Cache miss for key: ${keyId}, fetching from Vault`);

    try {
      const result = await this.readFromVault(keyId);
      const key = result.data.data.key;

      if (!key) {
        throw new Error(`Key not found in Vault: ${keyId}`);
      }

      this.cacheKey(keyId, key);
      this.auditLog("KEY_ACCESS", keyId, "success");

      return key;
    } catch (error) {
      this.logger.error(`Failed to retrieve key ${keyId} from Vault`, error);
      this.auditLog("KEY_ACCESS", keyId, "failed");
      throw new Error(`Failed to retrieve key: ${keyId}`);
    }
  }

  private getCachedKey(keyId: string): string | null {
    const cached = this.keyCache.get(keyId);

    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expiresAt) {
      this.logger.debug(`Cache expired for key: ${keyId}`);
      this.keyCache.delete(keyId);
      return null;
    }

    return cached.key;
  }

  private cacheKey(keyId: string, key: string): void {
    const ttlMs =
      (this.config.cacheTTLSeconds || this.DEFAULT_CACHE_TTL) * 1000;
    const expiresAt = Date.now() + ttlMs;

    this.keyCache.set(keyId, { key, expiresAt });
    this.logger.debug(
      `Cached key: ${keyId}, expires at: ${new Date(expiresAt).toISOString()}`,
    );
  }

  private async readFromVault(keyId: string, retries = 3): Promise<any> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await this.vaultClient.read(`secret/data/medical/${keyId}`);
      } catch (error) {
        this.logger.warn(
          `Vault read attempt ${attempt}/${retries} failed for key: ${keyId}`,
        );

        if (attempt === retries) {
          throw error;
        }

        await this.delay(Math.pow(2, attempt) * 100);
      }
    }
  }

  async getDatabaseCredentials(
    role: string = "medtrust-app",
  ): Promise<{ username: string; password: string }> {
    try {
      const result = await this.vaultClient.read(`database/creds/${role}`);

      this.auditLog("DB_CREDS_ACCESS", role, "success");

      return {
        username: result.data.username,
        password: result.data.password,
      };
    } catch (error) {
      this.logger.error(
        `Failed to retrieve database credentials for role: ${role}`,
        error,
      );
      this.auditLog("DB_CREDS_ACCESS", role, "failed");
      throw new Error(`Failed to retrieve database credentials: ${role}`);
    }
  }

  async encryptDEK(
    plaintext: string,
    keyName: string = "medtrust-kek",
  ): Promise<string> {
    try {
      const result = await this.vaultClient.write(
        `transit/encrypt/${keyName}`,
        {
          plaintext: Buffer.from(plaintext).toString("base64"),
        },
      );

      this.auditLog("DEK_ENCRYPT", keyName, "success");
      return result.data.ciphertext;
    } catch (error) {
      this.logger.error(`Failed to encrypt DEK with key: ${keyName}`, error);
      this.auditLog("DEK_ENCRYPT", keyName, "failed");
      throw new Error(`Failed to encrypt DEK: ${keyName}`);
    }
  }

  async decryptDEK(
    ciphertext: string,
    keyName: string = "medtrust-kek",
  ): Promise<string> {
    try {
      const result = await this.vaultClient.write(
        `transit/decrypt/${keyName}`,
        {
          ciphertext,
        },
      );

      this.auditLog("DEK_DECRYPT", keyName, "success");
      return Buffer.from(result.data.plaintext, "base64").toString();
    } catch (error) {
      this.logger.error(`Failed to decrypt DEK with key: ${keyName}`, error);
      this.auditLog("DEK_DECRYPT", keyName, "failed");
      throw new Error(`Failed to decrypt DEK: ${keyName}`);
    }
  }

  invalidateCache(keyId?: string): void {
    if (keyId) {
      this.keyCache.delete(keyId);
      this.logger.log(`Cache invalidated for key: ${keyId}`);
    } else {
      this.keyCache.clear();
      this.logger.log("All cache entries invalidated");
    }
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.keyCache.size,
      keys: Array.from(this.keyCache.keys()),
    };
  }

  private auditLog(action: string, resource: string, status: string): void {
    const auditEnabled = this.configService.get<boolean>(
      "AUDIT_LOG_UNMASKED_ACCESS",
      true,
    );

    if (auditEnabled) {
      this.logger.log({
        action,
        resource,
        status,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
