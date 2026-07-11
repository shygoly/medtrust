import { Injectable, Logger } from "@nestjs/common";
import { sm2, sm3, sm4 } from "sm-crypto";
import { randomBytes } from "crypto";

export interface SM2KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface EnvelopeEncryptionResult {
  encryptedData: string;
  encryptedDEK: string;
}

@Injectable()
export class GMCryptoService {
  private readonly logger = new Logger(GMCryptoService.name);

  generateSM2KeyPair(): SM2KeyPair {
    try {
      const keypair = sm2.generateKeyPairHex();
      return {
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
      };
    } catch (error) {
      this.logger.error("Failed to generate SM2 key pair", error);
      throw new Error("SM2 key generation failed");
    }
  }

  sm2Encrypt(plaintext: string, publicKey: string): string {
    try {
      return sm2.doEncrypt(plaintext, publicKey, 1);
    } catch (error) {
      this.logger.error("SM2 encryption failed", error);
      throw new Error("SM2 encryption failed");
    }
  }

  sm2Decrypt(ciphertext: string, privateKey: string): string {
    try {
      return sm2.doDecrypt(ciphertext, privateKey, 1);
    } catch (error) {
      this.logger.error("SM2 decryption failed", error);
      throw new Error("SM2 decryption failed");
    }
  }

  sm2Sign(message: string, privateKey: string): string {
    try {
      return sm2.doSignature(message, privateKey);
    } catch (error) {
      this.logger.error("SM2 signing failed", error);
      throw new Error("SM2 signing failed");
    }
  }

  sm2Verify(message: string, signature: string, publicKey: string): boolean {
    try {
      return sm2.doVerifySignature(message, signature, publicKey);
    } catch (error) {
      this.logger.error("SM2 verification failed", error);
      throw new Error("SM2 verification failed");
    }
  }

  sm3Hash(message: string): string {
    try {
      return sm3(message);
    } catch (error) {
      this.logger.error("SM3 hashing failed", error);
      throw new Error("SM3 hashing failed");
    }
  }

  sm4Encrypt(
    plaintext: string,
    key: string,
    mode: "ecb" | "cbc" = "cbc",
    iv?: string,
  ): string {
    try {
      if (mode === "ecb") {
        return sm4.encrypt(plaintext, key);
      } else {
        const ivHex = iv || randomBytes(16).toString("hex");
        const encrypted = sm4.encrypt(plaintext, key, {
          mode: "cbc",
          iv: ivHex,
        });
        return `${ivHex}:${encrypted}`;
      }
    } catch (error) {
      this.logger.error(`SM4 ${mode.toUpperCase()} encryption failed`, error);
      throw new Error(`SM4 ${mode.toUpperCase()} encryption failed`);
    }
  }

  sm4Decrypt(
    ciphertext: string,
    key: string,
    mode: "ecb" | "cbc" = "cbc",
  ): string {
    try {
      if (mode === "ecb") {
        return sm4.decrypt(ciphertext, key);
      } else {
        const [ivHex, encrypted] = ciphertext.split(":");
        if (!ivHex || !encrypted) {
          throw new Error("Invalid CBC ciphertext format");
        }
        return sm4.decrypt(encrypted, key, { mode: "cbc", iv: ivHex });
      }
    } catch (error) {
      this.logger.error(`SM4 ${mode.toUpperCase()} decryption failed`, error);
      throw new Error(`SM4 ${mode.toUpperCase()} decryption failed`);
    }
  }

  envelopeEncrypt(
    plaintext: string,
    publicKey: string,
  ): EnvelopeEncryptionResult {
    try {
      const dek = randomBytes(16).toString("hex");
      const encryptedData = this.sm4Encrypt(plaintext, dek, "cbc");
      const encryptedDEK = this.sm2Encrypt(dek, publicKey);

      return {
        encryptedData,
        encryptedDEK,
      };
    } catch (error) {
      this.logger.error("Envelope encryption failed", error);
      throw new Error("Envelope encryption failed");
    }
  }

  envelopeDecrypt(
    encryptedData: string,
    encryptedDEK: string,
    privateKey: string,
  ): string {
    try {
      const dek = this.sm2Decrypt(encryptedDEK, privateKey);
      return this.sm4Decrypt(encryptedData, dek, "cbc");
    } catch (error) {
      this.logger.error("Envelope decryption failed", error);
      throw new Error("Envelope decryption failed");
    }
  }
}
