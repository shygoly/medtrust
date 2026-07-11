import { ValueTransformer } from "typeorm";

let vaultServiceInstance: any;
let cryptoServiceInstance: any;

export function setEncryptionServices(
  vaultService: any,
  cryptoService: any,
): void {
  vaultServiceInstance = vaultService;
  cryptoServiceInstance = cryptoService;
}

export class EncryptionTransformer implements ValueTransformer {
  private keyCache: string | null = null;

  constructor(private readonly keyId: string) {}

  to(value: string | null): string | null {
    if (!value || value === "") {
      return value;
    }

    try {
      if (!cryptoServiceInstance || !vaultServiceInstance) {
        throw new Error("Encryption services not initialized");
      }

      const key = this.getKey();
      return cryptoServiceInstance.sm4Encrypt(value, key, "cbc");
    } catch (error) {
      throw new Error(
        `Encryption failed for keyId ${this.keyId}: ${error.message}`,
      );
    }
  }

  from(value: string | null): string | null {
    if (!value || value === "") {
      return value;
    }

    try {
      if (!cryptoServiceInstance || !vaultServiceInstance) {
        throw new Error("Encryption services not initialized");
      }

      const key = this.getKey();
      return cryptoServiceInstance.sm4Decrypt(value, key, "cbc");
    } catch (error) {
      throw new Error(
        `Decryption failed for keyId ${this.keyId}: ${error.message}`,
      );
    }
  }

  private getKey(): string {
    if (this.keyCache) {
      return this.keyCache;
    }

    const cached = vaultServiceInstance.getCachedKey?.(this.keyId);
    if (cached) {
      this.keyCache = cached;
      return cached;
    }

    throw new Error(
      `Key not available in cache: ${this.keyId}. Ensure keys are preloaded.`,
    );
  }
}

export function createEncryptionTransformer(
  keyId: string,
): EncryptionTransformer {
  return new EncryptionTransformer(keyId);
}
