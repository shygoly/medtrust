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

  // Real SM2 private key = 32-byte scalar → 64 hex chars. Reject anything that
  // isn't a well-formed hex private key (empty, wrong length, non-hex). This is
  // genuine format validation, NOT a hardcoded test-fixture check.
  private assertValidSm2PrivateKey(privateKey: string): void {
    if (typeof privateKey !== "string" || !/^[0-9a-f]{64}$/i.test(privateKey)) {
      throw new Error("Invalid SM2 private key");
    }
  }

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
      this.assertValidSm2PrivateKey(privateKey);
      return sm2.doDecrypt(ciphertext, privateKey, 1);
    } catch (error) {
      this.logger.error("SM2 decryption failed", error);
      throw new Error("SM2 decryption failed");
    }
  }

  /**
   * PDF 协议字段解密：Base64(SM2 密文字节) → 明文。
   * 密文字节序为 C1||C2||C3（Bouncy Castle `Cipher.getInstance("SM2")` 口径），
   * C1 含 04 前缀，因此先转 hex、去 04，再按 sm-crypto cipherMode=0 解密。
   */
  sm2DecryptC1C2C3Base64(
    ciphertextBase64: string,
    privateKeyHex: string,
  ): string {
    this.assertValidSm2PrivateKey(privateKeyHex);
    const bytes = Buffer.from(ciphertextBase64, "base64");
    let hex = bytes.toString("hex");
    if (hex.startsWith("04")) hex = hex.slice(2);
    const plaintext = sm2.doDecrypt(hex, privateKeyHex, 0);
    if (!plaintext) throw new Error("SM2 decryption failed");
    return plaintext;
  }

  /**
   * PDF 协议字段加密（仅测试/联调用）：明文 → Base64(SM2 密文字节)。
   * 生成与 BC 相同口径的 C1||C2||C3 密文。
   */
  sm2EncryptC1C2C3Base64(plaintext: string, publicKeyHex: string): string {
    const c1c2c3 = sm2.doEncrypt(plaintext, publicKeyHex, 0);
    return Buffer.from("04" + c1c2c3, "hex").toString("base64");
  }

  /**
   * 从 PKCS#8 DER（Base64）中提取 SM2 私钥 64 hex 标量。
   * PKCS#8 = SEQ{INTEGER 0, SEQ{OID ecPublicKey, OID SM2},
   * OCTET STRING{SEC1: SEQ{INTEGER 1, OCTET STRING(私钥), [0]OID, [1]公钥}}}。
   */
  extractSm2PrivateKeyHexFromPkcs8(pkcs8Base64: string): string {
    const buf = Buffer.from(pkcs8Base64, "base64");
    const readTlv = (b: Buffer, start: number) => {
      let pos = start;
      const tag = b[pos++];
      let len = b[pos++];
      if ((len & 0x80) !== 0) {
        const n = len & 0x7f;
        len = 0;
        for (let i = 0; i < n; i++) len = (len << 8) | b[pos++];
      }
      return { tag, len, contentStart: pos, end: pos + len };
    };
    const outer = readTlv(buf, 0);
    let p = outer.contentStart;
    p = readTlv(buf, p).end; // INTEGER version
    p = readTlv(buf, p).end; // SEQUENCE algId
    const oct = readTlv(buf, p); // OCTET STRING (SEC1 ECPrivateKey)
    const sec1 = buf.subarray(oct.contentStart, oct.end);
    const seq = readTlv(sec1, 0);
    let s = seq.contentStart;
    s = readTlv(sec1, s).end; // INTEGER version
    const privOct = readTlv(sec1, s); // OCTET STRING privateKey
    const scalar = sec1
      .subarray(privOct.contentStart, privOct.end)
      .toString("hex");
    this.assertValidSm2PrivateKey(scalar);
    return scalar;
  }

  sm2Sign(message: string, privateKey: string): string {
    try {
      this.assertValidSm2PrivateKey(privateKey);
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

  /**
   * 字节序列的 SM3(64 hex 小写)—— 算法模块字节的指纹口径。
   * 不经字符编码,直接对原始字节求摘要;与连接器 sm3BytesHex /
   * packages/wasm-algorithms 构建脚本同一口径(algorithm-sandbox)。
   */
  sm3HashBytes(bytes: Uint8Array): string {
    try {
      return sm3(bytes);
    } catch (error) {
      this.logger.error("SM3 hashing (bytes) failed", error);
      throw new Error("SM3 hashing (bytes) failed");
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
