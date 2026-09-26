// on-chain-provider-endorsement — 独立核验通道(task 4.1 / 4.2 / 4.3)。
//
// 本控制器的存在目的是**让别人不需要它**:它把独立核验所需的信任锚(平台 CA 公钥)
// 与连接器证书目录公开出去,任何第三方拿到链上的 `{resultSm3, sig, certFingerprint}`
// 后即可离线完成两步验证:
//   ① 用平台 CA 公钥验连接器证书签名(证书链)
//   ② 用证书里的连接器公钥验 `medtrust.result-endorsement.v1:<resultSm3>` 的签名
// `POST verify-endorsement` 只是同样两步的便利实现,不是信任来源。
//
// 如实边界(design D4):本能力让**已锚的**记录可独立归因 —— 平台无法伪造某院背书
// (没有该院私钥);但链仍单节点平台运营,「遗漏/不锚」不在 L1 射程内(归 P-CTL-4 的 L2)。
import { Controller, Get, Post, Body, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Certificate as CertificateEntity } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";
import {
  RESULT_ENDORSEMENT_PAYLOAD_PREFIX,
  resultEndorsementPayload,
} from "../rws-orchestrator/result-endorsement";

export interface VerifyEndorsementRequest {
  resultSm3?: string;
  sig?: string;
  certFingerprint?: string;
  participantId?: string;
}

export interface VerifyEndorsementResponse {
  valid: boolean;
  /** 逐步结果 —— 失败时能指出是证书链断还是背书签名不符。 */
  steps: {
    certificateFound: boolean;
    certificateChainValid: boolean;
    certificateActive: boolean;
    participantMatches: boolean;
    endorsementSignatureValid: boolean;
  };
  participantId?: string;
  reason?: string;
  /**
   * 命中的背书签名格式：`SM2-SM3` = 国标口径（切换后），
   * `SM2-legacy-raw` = 切换前上链的历史记录。核验者据此判断记录年代。
   */
  signatureAlg?: string;
}

@ApiTags("attestation-verification")
@Controller("attestation")
export class EndorsementVerificationController {
  constructor(
    private readonly ca: CaService,
    private readonly gm: GMCryptoService,
    @InjectRepository(CertificateEntity, "controlplane")
    private readonly certs: Repository<CertificateEntity>,
  ) {}

  @Get("trust-anchor")
  @ApiOperation({
    summary:
      "公开平台 CA 公钥与背书载荷口径（第三方独立核验存证背书的唯一信任锚）",
  })
  trustAnchor() {
    return {
      spaceId: this.ca.spaceId,
      algorithm: "SM2",
      hash: "SM3",
      caPublicKey: this.ca.caPublicKey,
      // 三钥分离（D-MDOP-3）：连接器在部署配置里固定这三把中的对应一把，按用途验签。
      platformNodePublicKey: this.ca.platformNodePublicKey,
      registryPublicKey: this.ca.registryPublicKey,
      keyPurposes: {
        caPublicKey: "只验证书链（CA 根钥）",
        platformNodePublicKey: "验任务信封、执行凭证、吊销名单、合约副署",
        registryPublicKey:
          "验算子清单与算法模块签名（P-CTL-6 专用算法签名密钥）",
      },
      // 核验者按此口径重建被签消息，无需向平台请求任何东西。
      endorsementPayloadPrefix: RESULT_ENDORSEMENT_PAYLOAD_PREFIX,
      endorsementPayloadFormat: `${RESULT_ENDORSEMENT_PAYLOAD_PREFIX}<resultSm3 小写 64 hex>`,
      certificatePayloadFields: [
        "spaceId",
        "connectorId",
        "participantId",
        "subjectPublicKey",
        "validUntil",
      ],
      note:
        "链为平台单节点运营（D-RWS-4，attestationLevel=software）。" +
        "本机制保证已上链记录可独立归因到贡献医院，不保证平台不遗漏记录。",
    };
  }

  @Get("certificates")
  @ApiOperation({
    summary: "公开连接器证书目录（指纹 → 公钥 + CA 签名），供离线验证书链",
  })
  async certificates(
    @Query("participantId") participantId?: string,
    @Query("fingerprint") fingerprint?: string,
  ) {
    const where: Record<string, string> = {};
    if (participantId) where.participantId = participantId;
    if (fingerprint) where.sm2Fingerprint = fingerprint;
    const rows = await this.certs.find({
      where: Object.keys(where).length > 0 ? where : {},
    });
    return {
      spaceId: this.ca.spaceId,
      caPublicKey: this.ca.caPublicKey,
      certificates: rows.map((row) => {
        const cert = this.ca.exportCertificate(row);
        return {
          fingerprint: cert.fingerprint,
          participantId: cert.participantId,
          connectorId: cert.connectorId,
          spaceId: cert.spaceId,
          subjectPublicKey: cert.subjectPublicKey,
          validUntil: cert.validUntil,
          revoked: row.revoked,
          caSignature: cert.signature,
        };
      }),
    };
  }

  @Post("verify-endorsement")
  @ApiOperation({
    summary: "核验某院对某结果哈希的连接器背书（与离线核验同一两步，便利实现）",
  })
  async verifyEndorsement(
    @Body() body: VerifyEndorsementRequest,
  ): Promise<VerifyEndorsementResponse> {
    const steps = {
      certificateFound: false,
      certificateChainValid: false,
      certificateActive: false,
      participantMatches: false,
      endorsementSignatureValid: false,
    };
    const resultSm3 = (body.resultSm3 ?? "").trim().toLowerCase();
    const sig = (body.sig ?? "").trim();
    const fingerprint = (body.certFingerprint ?? "").trim();
    if (!/^[0-9a-f]{64}$/.test(resultSm3)) {
      return { valid: false, steps, reason: "resultSm3 须为 64 位小写 hex" };
    }
    if (!sig || !fingerprint) {
      return { valid: false, steps, reason: "缺少 sig 或 certFingerprint" };
    }

    const row = await this.certs.findOne({
      where: { sm2Fingerprint: fingerprint },
    });
    if (!row) return { valid: false, steps, reason: "证书指纹不在目录中" };
    steps.certificateFound = true;

    const cert = this.ca.exportCertificate(row);
    const chain = this.ca.verifyWith(cert, this.ca.caPublicKey);
    steps.certificateChainValid = chain.valid;
    if (!chain.valid) {
      return { valid: false, steps, reason: chain.reason };
    }
    steps.certificateActive = !row.revoked;
    if (row.revoked) {
      return { valid: false, steps, reason: "证书已吊销" };
    }
    steps.participantMatches =
      !body.participantId || row.participantId === body.participantId;
    if (!steps.participantMatches) {
      return { valid: false, steps, reason: "证书归属方与声称的贡献方不符" };
    }

    let sigCheck: { valid: boolean; alg: string | null } = {
      valid: false,
      alg: null,
    };
    try {
      // 背书是**历史对象**：切换前上链的背书是旧格式，故按「先国标、后历史」核验，
      // 并在响应里如实标注命中的格式；线上消息不走这条路径（只接受国标）。
      sigCheck = this.gm.sm2VerifyHistorical(
        resultEndorsementPayload(resultSm3),
        sig,
        cert.subjectPublicKey,
      );
    } catch {
      sigCheck = { valid: false, alg: null };
    }
    steps.endorsementSignatureValid = sigCheck.valid;
    return {
      valid: sigCheck.valid,
      steps,
      participantId: row.participantId,
      ...(sigCheck.valid && sigCheck.alg ? { signatureAlg: sigCheck.alg } : {}),
      ...(sigCheck.valid
        ? {}
        : { reason: "背书签名与该 resultSm3 不符（结果或签名被篡改）" }),
    };
  }
}
