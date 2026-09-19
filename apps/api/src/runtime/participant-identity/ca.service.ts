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

/**
 * algorithm-sandbox:平台 CA 对**算法模块 SM3** 的签名载荷口径。
 * 连接器侧用同一串验签(apps/connector/src/domain/sandbox/module-verifier.ts
 * 的 moduleSignaturePayload)—— 两处改动必须同步。
 */
export const MODULE_SIGNATURE_PAYLOAD_PREFIX = "medtrust.algorithm-module.v1:";

export function moduleSignaturePayload(sm3: string): string {
  return `${MODULE_SIGNATURE_PAYLOAD_PREFIX}${sm3.toLowerCase()}`;
}

/**
 * outbound-longpoll-agent-auth(D4):平台对**下发任务摘要**的签名载荷口径。
 * 连接器侧同串(apps/connector/src/domain/connector-task-signature.ts)——两处改动必须同步。
 */
export const TASK_SIGNATURE_PAYLOAD_PREFIX = "medtrust.connector-task.v1:";

export function taskSignaturePayload(sm3: string): string {
  return `${TASK_SIGNATURE_PAYLOAD_PREFIX}${sm3.toLowerCase()}`;
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

  /**
   * algorithm-sandbox:对算法模块 SM3 做 SM2 签名 —— 平台对"这份模块字节"的审计背书。
   * 与合约固定 SM3 两项独立校验:签名证明模块出自平台,固定值证明院方同意这一份代码。
   * (专用算法签名密钥与 CA 根密钥分离见 TRUST P-CTL-6。)
   */
  signModuleDigest(sm3: string): string {
    return this.gm.sm2Sign(
      moduleSignaturePayload(sm3),
      this.caKeyPair.privateKey,
    );
  }

  /**
   * outbound-longpoll-agent-auth(D4):对下发任务摘要(任务规范化内容的 SM3)做 SM2 签名。
   * 连接器用部署固定的平台 CA 公钥验签,因此经过代理/nginx 的任务内容无法被篡改。
   */
  signTaskDigest(sm3: string): string {
    return this.gm.sm2Sign(
      taskSignaturePayload(sm3),
      this.caKeyPair.privateKey,
    );
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
