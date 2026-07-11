import { Injectable } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";

// SM2-encrypted, SM3-integrity, SM2-signed message envelope for connector↔center
// and connector↔connector traffic (data-space-connector spec 2.3).
export interface SealedMessage {
  ciphertext: string; // SM2-encrypted payload (recipient pub key)
  digest: string; // SM3 of plaintext
  signature: string; // sender's SM2 signature over the digest
}

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

@Injectable()
export class SecureChannelService {
  constructor(private readonly gm: GMCryptoService) {}

  seal(
    plaintext: string,
    senderPrivateKey: string,
    recipientPublicKey: string,
  ): SealedMessage {
    const digest = this.gm.sm3Hash(plaintext);
    return {
      ciphertext: this.gm.sm2Encrypt(plaintext, recipientPublicKey),
      digest,
      signature: this.gm.sm2Sign(digest, senderPrivateKey),
    };
  }

  // Decrypts and verifies. Any tamper (ciphertext, digest, or signature) is
  // rejected; the message is dropped rather than processed.
  open(
    msg: SealedMessage,
    recipientPrivateKey: string,
    senderPublicKey: string,
  ): string {
    let plaintext: string;
    try {
      plaintext = this.gm.sm2Decrypt(msg.ciphertext, recipientPrivateKey);
    } catch {
      throw new IntegrityError("解密失败:密文被篡改或密钥不匹配");
    }
    if (this.gm.sm3Hash(plaintext) !== msg.digest) {
      throw new IntegrityError("SM3 完整性校验失败:摘要不匹配");
    }
    let sigOk = false;
    try {
      sigOk = this.gm.sm2Verify(msg.digest, msg.signature, senderPublicKey);
    } catch {
      sigOk = false;
    }
    if (!sigOk) throw new IntegrityError("SM2 签名校验失败");
    return plaintext;
  }
}
