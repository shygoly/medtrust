import { Injectable, Optional, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import {
  CaKeypair,
  Certificate as CertificateEntity,
} from "@medtrust/database";

// SM2 certificate issued by the central CA to a connector (NDI-TR-2025-03).
// DTO/transport shape; the issued-cert registry is the Certificate entity.
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

// 中心 CA (2.1): 用 SM2 签发/吊销连接器证书。CA 根密钥对 + 已签发证书注册表
// 持久化在 control-plane 库,跨重启保持(否则重启会让旧证书全部验不过)。
@Injectable()
export class CaService implements OnModuleInit {
  private caKeyPair!: { publicKey: string; privateKey: string };
  readonly spaceId: string;

  constructor(
    private readonly gm: GMCryptoService,
    @InjectRepository(CaKeypair, "controlplane")
    private readonly keys: Repository<CaKeypair>,
    @InjectRepository(CertificateEntity, "controlplane")
    private readonly certs: Repository<CertificateEntity>,
    @Optional() spaceId?: string,
  ) {
    this.spaceId = spaceId || process.env.SPACE_ID || "sh-med";
  }

  // 开机加载 CA 根密钥对;缺失则生成并持久化(不再每次重生)。
  async onModuleInit(): Promise<void> {
    const existing = await this.keys.findOne({
      where: { spaceId: this.spaceId },
    });
    if (existing) {
      this.caKeyPair = {
        publicKey: existing.publicKey,
        privateKey: existing.privateKey,
      };
      return;
    }
    this.caKeyPair = this.gm.generateSM2KeyPair();
    await this.keys.save(
      this.keys.create({
        spaceId: this.spaceId,
        publicKey: this.caKeyPair.publicKey,
        privateKey: this.caKeyPair.privateKey,
      }),
    );
  }

  get caPublicKey(): string {
    return this.caKeyPair.publicKey;
  }

  async issue(
    connectorId: string,
    participantId: string,
    subjectPublicKey: string,
    validDays = 365,
  ): Promise<Certificate> {
    const validUntil = new Date(
      Date.now() + validDays * 86_400_000,
    ).toISOString();
    const base = {
      spaceId: this.spaceId,
      connectorId,
      participantId,
      subjectPublicKey,
      validUntil,
    };
    const payload = this.payload(base);
    const cert: Certificate = {
      ...base,
      fingerprint: "SM2:" + this.gm.sm3Hash(payload).slice(0, 16).toUpperCase(),
      signature: this.gm.sm2Sign(payload, this.caKeyPair.privateKey),
    };
    // 写入已签发证书注册表(以指纹为主键,幂等)。
    await this.certs.save(
      this.certs.create({
        sm2Fingerprint: cert.fingerprint,
        participantId,
        connectorId,
        spaceId: this.spaceId,
        subjectPublicKey,
        validUntil: new Date(validUntil),
        revoked: false,
      }),
    );
    return cert;
  }

  async verify(cert: Certificate): Promise<CertVerification> {
    const r = this.verifyWith(cert, this.caKeyPair.publicKey);
    if (!r.valid) return r;
    const row = await this.certs.findOne({
      where: { sm2Fingerprint: cert.fingerprint },
    });
    if (row?.revoked) return { valid: false, reason: "证书已吊销" };
    return r;
  }

  // Verify a certificate against a GIVEN CA public key — used for cross-domain
  // recognition of certs issued by another space's CA (9.2). Checks signature +
  // expiry (revocation is the issuing CA's concern). No DB → stays synchronous.
  verifyWith(cert: Certificate, caPublicKey: string): CertVerification {
    const payload = this.payload(cert);
    let signatureOk = false;
    try {
      signatureOk = this.gm.sm2Verify(payload, cert.signature, caPublicKey);
    } catch {
      signatureOk = false;
    }
    if (!signatureOk)
      return { valid: false, reason: "证书签名无效(非该 CA 签发或被篡改)" };
    if (new Date(cert.validUntil).getTime() < Date.now())
      return { valid: false, reason: "证书已过期" };
    return { valid: true };
  }

  async revoke(fingerprint: string): Promise<void> {
    await this.certs.update({ sm2Fingerprint: fingerprint }, { revoked: true });
  }

  private payload(c: Omit<Certificate, "fingerprint" | "signature">): string {
    return JSON.stringify({
      spaceId: c.spaceId,
      connectorId: c.connectorId,
      participantId: c.participantId,
      subjectPublicKey: c.subjectPublicKey,
      validUntil: c.validUntil,
    });
  }
}
