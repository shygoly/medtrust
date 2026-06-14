import { Injectable, Optional } from '@nestjs/common';
import { GMCryptoService } from '../security/crypto/gm-crypto.service';

// SM2 certificate issued by the central CA to a connector (NDI-TR-2025-03).
export interface Certificate {
  spaceId: string; // which space's CA issued this cert (cross-domain recognition)
  connectorId: string;
  participantId: string;
  subjectPublicKey: string; // the connector's own SM2 public key
  validUntil: string; // ISO timestamp
  fingerprint: string; // SM3 digest of the payload, "SM2:<hex>"
  signature: string; // CA's SM2 signature over the payload
}

export interface CertVerification {
  valid: boolean;
  reason?: string;
}

// 中心 CA (2.1): 用 SM2 签发/吊销连接器证书。
@Injectable()
export class CaService {
  private readonly caKeyPair: { publicKey: string; privateKey: string };
  private readonly revoked = new Set<string>();
  readonly spaceId: string;

  constructor(private readonly gm: GMCryptoService, @Optional() spaceId?: string) {
    this.spaceId = spaceId || process.env.SPACE_ID || 'sh-med';
    this.caKeyPair = this.gm.generateSM2KeyPair();
  }

  get caPublicKey(): string {
    return this.caKeyPair.publicKey;
  }

  issue(connectorId: string, participantId: string, subjectPublicKey: string, validDays = 365): Certificate {
    const validUntil = new Date(Date.now() + validDays * 86_400_000).toISOString();
    const base = { spaceId: this.spaceId, connectorId, participantId, subjectPublicKey, validUntil };
    const payload = this.payload(base);
    return {
      ...base,
      fingerprint: 'SM2:' + this.gm.sm3Hash(payload).slice(0, 16).toUpperCase(),
      signature: this.gm.sm2Sign(payload, this.caKeyPair.privateKey),
    };
  }

  verify(cert: Certificate): CertVerification {
    const r = this.verifyWith(cert, this.caKeyPair.publicKey);
    if (!r.valid) return r;
    if (this.revoked.has(cert.fingerprint)) return { valid: false, reason: '证书已吊销' };
    return r;
  }

  // Verify a certificate against a GIVEN CA public key — used for cross-domain
  // recognition of certs issued by another space's CA (9.2). Checks signature +
  // expiry (revocation is the issuing CA's concern).
  verifyWith(cert: Certificate, caPublicKey: string): CertVerification {
    const payload = this.payload(cert);
    let signatureOk = false;
    try {
      signatureOk = this.gm.sm2Verify(payload, cert.signature, caPublicKey);
    } catch {
      signatureOk = false;
    }
    if (!signatureOk) return { valid: false, reason: '证书签名无效(非该 CA 签发或被篡改)' };
    if (new Date(cert.validUntil).getTime() < Date.now()) return { valid: false, reason: '证书已过期' };
    return { valid: true };
  }

  revoke(fingerprint: string): void {
    this.revoked.add(fingerprint);
  }

  private payload(c: Omit<Certificate, 'fingerprint' | 'signature'>): string {
    return JSON.stringify({
      spaceId: c.spaceId,
      connectorId: c.connectorId,
      participantId: c.participantId,
      subjectPublicKey: c.subjectPublicKey,
      validUntil: c.validUntil,
    });
  }
}
