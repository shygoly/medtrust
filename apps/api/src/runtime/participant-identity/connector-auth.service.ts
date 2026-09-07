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

    const payload = `${timestamp}:${cert.participantId}`;
    let ok = false;
    try {
      ok = this.gm.sm2Verify(payload, signature, cert.subjectPublicKey);
    } catch {
      ok = false;
    }
    if (!ok) return { verified: false, reason: "签名验证失败" };

    return { verified: true, participantId: cert.participantId };
  }
}
