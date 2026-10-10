import { currentSpaceId } from "../space-context/space-id.util";
import { Injectable, Logger, Optional, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import {
  CaKeypair,
  Certificate as CertificateEntity,
} from "@medtrust/database";
import {
  PLATFORM_KEY_PURPOSES,
  assertKekAvailable,
  encryptStoredKey,
  isEncryptedStoredKey,
  looksLikePlaintextPrivateKey,
  readPrivateKey,
  type PlatformKeyPurpose,
} from "./platform-key-store";

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
  /**
   * 命中的签名格式（`SM2-SM3` = 国标口径，`SM2-legacy-raw` = 切换前的历史对象）。
   * 只在历史核验面出现，便于审计判断记录年代。
   */
  alg?: string;
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
  private readonly logger = new Logger(CaService.name);
  /**
   * 三把用途互斥的平台密钥（D-MDOP-3）：
   *  - `certificate`：CA 根钥，**只**签发/吊销证书；
   *  - `platform-node`：签 MDOP 信封、执行凭证、吊销名单，并以合约一方身份副署合约；
   *  - `registry`：签算子清单与算法模块（P-CTL-6 的「专用算法签名密钥」）。
   * 内存里才有明文私钥；落库的列一律是 SM4 密文。
   */
  private platformKeys!: Record<
    PlatformKeyPurpose,
    { publicKey: string; privateKey: string }
  >;
  readonly spaceId: string;

  constructor(
    private readonly gm: GMCryptoService,
    @InjectRepository(CaKeypair, "controlplane")
    private readonly keys: Repository<CaKeypair>,
    @InjectRepository(CertificateEntity, "controlplane")
    private readonly certs: Repository<CertificateEntity>,
    @Optional() spaceId?: string,
  ) {
    this.spaceId = spaceId || currentSpaceId();
  }

  // 开机加载三把用途互斥的平台密钥:缺失则生成、历史明文则原地加密(不再每次重生)。
  async onModuleInit(): Promise<void> {
    const existing = await this.keys.findOne({
      where: { spaceId: this.spaceId },
    });
    // 生产环境缺 KEK 直接抛错拒绝启动（规格「生产环境缺少密钥加密密钥」）。
    const kek = assertKekAvailable(process.env, this.logger);

    this.platformKeys = {} as Record<
      PlatformKeyPurpose,
      { publicKey: string; privateKey: string }
    >;
    const row: CaKeypair =
      existing ?? this.keys.create({ spaceId: this.spaceId });
    const changed = this.loadOrGenerate(row, "certificate", kek);
    const changedNode = this.loadOrGenerate(row, "platform-node", kek);
    const changedRegistry = this.loadOrGenerate(row, "registry", kek);

    if (!existing || changed || changedNode || changedRegistry) {
      await this.keys.save(this.keys.create({ ...row, spaceId: this.spaceId }));
    }
  }

  /**
   * 读一个用途的密钥；缺就生成、明文就迁移成密文。返回是否写回了行。
   */
  private loadOrGenerate(
    row: CaKeypair,
    purpose: PlatformKeyPurpose,
    kek: string,
  ): boolean {
    const pubField =
      purpose === "certificate"
        ? "publicKey"
        : `${this.fieldPrefix(purpose)}PublicKey`;
    const privField =
      purpose === "certificate"
        ? "privateKey"
        : `${this.fieldPrefix(purpose)}PrivateKey`;
    const anyRow = row as unknown as Record<string, string | null | undefined>;
    const storedPriv = anyRow[privField];
    const storedPub = anyRow[pubField];

    if (!storedPriv) {
      const pair = this.gm.generateSM2KeyPair();
      this.platformKeys[purpose] = pair;
      anyRow[pubField] = pair.publicKey;
      anyRow[privField] = encryptStoredKey(pair.privateKey, kek, this.gm);
      return true;
    }

    // 历史明文（本变更之前 CA 根钥就是明文 text 列）→ 原地迁移为密文。
    let plaintext: string;
    let changed = false;
    if (looksLikePlaintextPrivateKey(storedPriv)) {
      plaintext = storedPriv.trim().toLowerCase();
      anyRow[privField] = encryptStoredKey(plaintext, kek, this.gm);
      changed = true;
    } else {
      plaintext = readPrivateKey(storedPriv, kek, this.gm)!;
    }

    const publicKey =
      storedPub?.trim() || this.gm.publicKeyFromPrivateKey(plaintext);
    if (publicKey !== storedPub) {
      anyRow[pubField] = publicKey;
      changed = true;
    }
    this.platformKeys[purpose] = { publicKey, privateKey: plaintext };
    return changed;
  }

  private fieldPrefix(purpose: PlatformKeyPurpose): string {
    return purpose === "platform-node" ? "platformNode" : "registry";
  }

  /** 按用途取公钥（连接器在部署配置里固定这三把中的对应一把）。 */
  publicKeyFor(purpose: PlatformKeyPurpose): string {
    return this.platformKeys[purpose].publicKey;
  }

  /** 按用途签名 —— 用错密钥签出的对象会被连接器按用途拒绝。 */
  signWith(purpose: PlatformKeyPurpose, message: string): string {
    const key = this.platformKeys[purpose];
    return this.gm.sm2Sign(message, key.privateKey, {
      publicKey: key.publicKey,
    });
  }

  /** 按用途对**对象**签名（JCS + SM3；清单/吊销名单等协议对象用这个）。 */
  signObjectWith(purpose: PlatformKeyPurpose, value: unknown) {
    const key = this.platformKeys[purpose];
    return this.gm.signObject(value, key.privateKey, key.publicKey);
  }

  /** 按用途验对象签名（用错用途的公钥一律 false）。 */
  verifyObjectWith(
    purpose: PlatformKeyPurpose,
    value: unknown,
    signature: unknown,
  ): boolean {
    const key = this.platformKeys[purpose];
    if (
      typeof signature !== "object" ||
      signature === null ||
      typeof (signature as { value?: unknown }).value !== "string"
    )
      return false;
    return this.gm.verifyObject(
      value,
      signature as { alg: string; kid: string; value: string },
      key.publicKey,
    );
  }

  /** CA 根钥公钥：只用于验证书链。 */
  get caPublicKey(): string {
    return this.platformKeys.certificate.publicKey;
  }

  /** 平台节点密钥公钥：连接器用它验信封/凭证/吊销名单/合约副署。 */
  get platformNodePublicKey(): string {
    return this.platformKeys["platform-node"].publicKey;
  }

  /** 注册中心密钥公钥：连接器用它验算子清单与算法模块签名。 */
  get registryPublicKey(): string {
    return this.platformKeys.registry.publicKey;
  }

  /**
   * 三把私钥在库里的形态（供测试与运维核对：MUST 全是密文）。
   * 不回传任何私钥材料。
   */
  async keyStorageReport(): Promise<
    Record<PlatformKeyPurpose, "encrypted" | "plaintext" | "missing">
  > {
    const row = await this.keys.findOne({ where: { spaceId: this.spaceId } });
    const report = {} as Record<
      PlatformKeyPurpose,
      "encrypted" | "plaintext" | "missing"
    >;
    for (const purpose of PLATFORM_KEY_PURPOSES) {
      const privField =
        purpose === "certificate"
          ? "privateKey"
          : `${this.fieldPrefix(purpose)}PrivateKey`;
      const stored = (row as unknown as Record<string, string | undefined>)?.[
        privField
      ];
      report[purpose] = !stored
        ? "missing"
        : isEncryptedStoredKey(stored)
          ? "encrypted"
          : "plaintext";
    }
    return report;
  }

  /**
   * algorithm-sandbox:对算法模块 SM3 做 SM2 签名 —— 平台对"这份模块字节"的审计背书。
   * 与合约固定 SM3 两项独立校验:签名证明模块出自平台,固定值证明院方同意这一份代码。
   * (专用算法签名密钥与 CA 根密钥分离见 TRUST P-CTL-6。)
   */
  signModuleDigest(sm3: string): string {
    // 专用算法签名密钥 = 注册中心密钥（P-CTL-6），不再与 CA 根钥共用。
    return this.signWith("registry", moduleSignaturePayload(sm3));
  }

  /**
   * outbound-longpoll-agent-auth(D4):对下发任务摘要(任务规范化内容的 SM3)做 SM2 签名。
   * 连接器用部署固定的平台 CA 公钥验签,因此经过代理/nginx 的任务内容无法被篡改。
   */
  signTaskDigest(sm3: string): string {
    // 任务信封由平台节点密钥签（D-MDOP-3），连接器按用途用对应公钥验。
    return this.signWith("platform-node", taskSignaturePayload(sm3));
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
      // 证书只由 CA 根钥签（D-MDOP-3 用途互斥）。
      signature: this.signWith("certificate", payload),
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
        // on-chain-provider-endorsement:签名随证书入库,供信任目录对外发布,
        // 第三方才能独立验证书链(task 4.2)。
        caSignature: cert.signature,
      }),
    );
    return cert;
  }

  /**
   * on-chain-provider-endorsement(task 4.2)——把注册表行还原成可对外发布的完整证书。
   *
   * 证书载荷完全由存储字段决定,因此旧行(caSignature 为空)可当场重新签发补齐:
   * 同一 CA 对同一载荷的任何一个有效签名,证明力等同(SM2 签名本身带随机数,
   * 本来就不是字节唯一的)。
   */
  exportCertificate(row: {
    sm2Fingerprint: string;
    spaceId: string;
    connectorId: string;
    participantId: string;
    subjectPublicKey: string;
    validUntil: Date | string;
    caSignature?: string | null;
  }): Certificate {
    const base = {
      spaceId: row.spaceId,
      connectorId: row.connectorId,
      participantId: row.participantId,
      subjectPublicKey: row.subjectPublicKey,
      validUntil: new Date(row.validUntil).toISOString(),
    };
    return {
      ...base,
      fingerprint: row.sm2Fingerprint,
      signature:
        row.caSignature ?? this.signWith("certificate", this.payload(base)),
    };
  }

  async verify(cert: Certificate): Promise<CertVerification> {
    const r = this.verifyWith(cert, this.platformKeys.certificate.publicKey);
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
  //
  // 证书是**历史对象**：本变更之前签发的证书是旧格式（不做 Z_A、原始 r‖s），
  // 故这里按「先国标、后历史」核验；线上消息（信封、请求、任务）不走这条路径。
  verifyWith(cert: Certificate, caPublicKey: string): CertVerification {
    const payload = this.payload(cert);
    let check: { valid: boolean; alg: string | null } = {
      valid: false,
      alg: null,
    };
    try {
      check = this.gm.sm2VerifyHistorical(payload, cert.signature, caPublicKey);
    } catch {
      check = { valid: false, alg: null };
    }
    if (!check.valid)
      return { valid: false, reason: "证书签名无效(非该 CA 签发或被篡改)" };
    if (new Date(cert.validUntil).getTime() < Date.now())
      return { valid: false, reason: "证书已过期" };
    // 如实标注签名格式：`SM2-legacy-raw` 说明这是切换前签发、且由 CA 根钥直签的证书。
    return { valid: true, ...(check.alg ? { alg: check.alg } : {}) };
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
