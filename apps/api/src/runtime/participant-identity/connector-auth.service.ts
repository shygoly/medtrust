import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Certificate as CertificateEntity } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";

export interface ConnectorRequestAuthHeaders {
  fingerprint?: string;
  timestamp?: string;
  signature?: string;
  participantId?: string;
  /**
   * 请求体的 SM3(64 hex)。带请求体的上报接口由连接器放进签名载荷,
   * 使签名覆盖请求体(outbound-longpoll-agent-auth D5)。
   */
  bodySm3?: string;
}

export interface ConnectorAuthResult {
  verified: boolean;
  participantId?: string;
  reason?: string;
}

// P1-4:连接器接入鉴权升级——注册时下发 SM2 证书;连接器请求带
// 证书指纹 + 时间戳 + SM2 签名;guard 验签 + 吊销检查。
@Injectable()
export class ConnectorAuthService {
  constructor(
    private readonly gm: GMCryptoService,
    @InjectRepository(CertificateEntity, "controlplane")
    private readonly certs: Repository<CertificateEntity>,
  ) {}

  async verifyRequest(
    headers: ConnectorRequestAuthHeaders,
  ): Promise<ConnectorAuthResult> {
    const fingerprint = headers.fingerprint?.trim();
    const timestamp = headers.timestamp?.trim();
    const signature = headers.signature?.trim();
    if (!fingerprint || !timestamp || !signature) {
      return { verified: false, reason: "缺少证书指纹/时间戳/签名" };
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      return { verified: false, reason: "时间戳格式非法" };
    }
    if (Math.abs(Date.now() - ts) > 5 * 60_000) {
      return { verified: false, reason: "签名时间戳过期(5min)" };
    }

    const cert = await this.certs.findOne({
      where: { sm2Fingerprint: fingerprint },
    });
    if (!cert) return { verified: false, reason: "证书指纹未注册" };
    if (cert.revoked) return { verified: false, reason: "证书已吊销" };
    if (new Date(cert.validUntil).getTime() < Date.now()) {
      return { verified: false, reason: "证书已过期" };
    }

    const bodySm3 = headers.bodySm3?.trim().toLowerCase() ?? "";
    // 载荷口径:无请求体 `ts:pid`;有请求体 `ts:pid:bodySm3`(连接器侧同规则)。
    const payload = bodySm3
      ? `${timestamp}:${cert.participantId}:${bodySm3}`
      : `${timestamp}:${cert.participantId}`;
    let ok = false;
    try {
      ok = this.gm.sm2Verify(payload, signature, cert.subjectPublicKey);
    } catch {
      ok = false;
    }
    if (!ok) return { verified: false, reason: "签名验证失败" };

    return { verified: true, participantId: cert.participantId };
  }

  /**
   * 校验连接器对**某个负载摘要**的 SM2 签名(联邦训练轮次结果用)。
   * 指纹由守卫从请求头带出;证书须未吊销未过期。
   */
  async verifyPayloadSignature(
    fingerprint: string,
    message: string,
    signature: string,
    participantId?: string,
  ): Promise<boolean> {
    if (!fingerprint || !signature) return false;
    const cert = await this.certs.findOne({
      where: { sm2Fingerprint: fingerprint },
    });
    if (!cert || cert.revoked) return false;
    if (new Date(cert.validUntil).getTime() < Date.now()) return false;
    if (participantId && cert.participantId !== participantId) return false;
    try {
      return this.gm.sm2Verify(message, signature, cert.subjectPublicKey);
    } catch {
      return false;
    }
  }
}
