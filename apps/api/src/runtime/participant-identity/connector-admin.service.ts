import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  Certificate as CertificateEntity,
  CpConnectorRegistry,
} from "@medtrust/database";
import { CaService } from "./ca.service";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";

export interface RegisterConnectorInput {
  connectorId: string;
  participantId: string;
  /**
   * 连接器自有的 SM2 公钥（未压缩点 `04‖x‖y`）。
   * **必填**：参与方密钥一律由参与方自己生成，平台 MUST NOT 代生成（D-MDOP-3）。
   */
  subjectPublicKey: string;
  capabilities?: string[];
}

export interface RegisterConnectorResult {
  connectorId: string;
  certificate: {
    spaceId: string;
    connectorId: string;
    participantId: string;
    subjectPublicKey: string;
    validUntil: string;
    fingerprint: string;
    signature: string;
  };
}

/** 连接器离线阈值缺省：3 × 心跳周期（心跳 60s）。 */
export const DEFAULT_CONNECTOR_OFFLINE_MS = 180_000;

// 连接器注册/注销(6.2)。复用 CaService 签发/吊销 + CpConnectorRegistry 注册表,
// 不新写密码学核心逻辑。
@Injectable()
export class ConnectorAdminService {
  constructor(
    private readonly ca: CaService,
    private readonly gm: GMCryptoService,
    @InjectRepository(CertificateEntity, "controlplane")
    private readonly certs: Repository<CertificateEntity>,
    @InjectRepository(CpConnectorRegistry, "controlplane")
    private readonly registry: Repository<CpConnectorRegistry>,
  ) {}

  async register(
    input: RegisterConnectorInput,
  ): Promise<RegisterConnectorResult> {
    const existing = await this.certs.findOne({
      where: { connectorId: input.connectorId },
    });
    if (existing) throw new ConflictException("连接器已注册");

    // 参与方密钥自持：没有公钥就拒绝注册，绝不代为生成、更不把私钥发回去。
    const subjectPublicKey = input.subjectPublicKey?.trim();
    if (!subjectPublicKey) {
      throw new BadRequestException(
        "注册必须携带连接器自有的 SM2 公钥（subjectPublicKey）；平台不代生成参与方密钥",
      );
    }
    this.assertWellFormedPublicKey(subjectPublicKey);

    const cert = await this.ca.issue(
      input.connectorId,
      input.participantId,
      subjectPublicKey,
    );

    // 写入连接器注册表(以 participantId 为自然键,一个参与方一个连接器入口)。
    const row = await this.registry.findOne({
      where: { participantId: input.participantId },
    });
    if (row) {
      row.certificateHash = cert.fingerprint;
      row.capabilities = input.capabilities ?? [];
      await this.registry.save(row);
    } else {
      await this.registry.save(
        this.registry.create({
          participantId: input.participantId,
          certificateHash: cert.fingerprint,
          capabilities: input.capabilities ?? [],
          healthStatus: "unknown",
        }),
      );
    }

    return { connectorId: input.connectorId, certificate: cert };
  }

  async deregister(connectorId: string): Promise<{ deregistered: boolean }> {
    const cert = await this.certs.findOne({ where: { connectorId } });
    if (!cert) throw new NotFoundException("连接器未注册");

    await this.ca.revoke(cert.sm2Fingerprint);
    await this.registry.delete({ participantId: cert.participantId });
    return { deregistered: true };
  }

  list(): Promise<CertificateEntity[]> {
    return this.certs.find();
  }

  /**
   * 心跳超时阈值(ms)。超过未上报 → listRegistry 标 offline。
   *
   * ndi-platform-state-report：缺省从「1 个心跳周期」放宽到**3 个**（连接器显式心跳 60s 一次，
   * 见 `connector-worker.service.ts` 的 HEARTBEAT_INTERVAL_MS）。一次丢包不再直接判离线，
   * 与区域节点上报聚合口径一致。显式配置 `CONNECTOR_OFFLINE_MS` 仍优先。
   */
  private offlineThresholdMs(): number {
    const n = Number(
      process.env.CONNECTOR_OFFLINE_MS ?? DEFAULT_CONNECTOR_OFFLINE_MS,
    );
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_CONNECTOR_OFFLINE_MS;
  }

  /** P1-9:连接器周期心跳上报(版本/任务状态/资源水位)。 */
  async heartbeat(
    participantId: string,
    body: {
      connectorId?: string;
      version?: string;
      taskStatus?: Record<string, unknown>;
      resources?: Record<string, unknown>;
      /**
       * mdop-kernel（任务 6.5）：连接器的**能力通告**——运行时、system 算子版本、
       * 白名单摘要、TEE 能力、协同协议版本。编译器据此决定能不能把阶段放在该节点。
       */
      mdop?: Record<string, unknown>;
    },
  ): Promise<CpConnectorRegistry> {
    const row = await this.registry.findOne({ where: { participantId } });
    const lastHeartbeat = {
      connectorId: body.connectorId,
      version: body.version,
      taskStatus: body.taskStatus,
      resources: body.resources,
      ...(body.mdop ? { mdop: body.mdop } : {}),
    };
    const data: Partial<CpConnectorRegistry> = {
      participantId,
      healthStatus: "online",
      lastSeen: new Date(),
      lastHeartbeat,
      capabilities: row?.capabilities ?? [],
    };
    if (row) {
      // 用 participantId 更新,避免 mock/缺 id 时 save 再插一行。
      await this.registry.update({ participantId }, data);
    } else {
      await this.registry.save(this.registry.create(data));
    }
    const saved = await this.registry.findOne({ where: { participantId } });
    return this.withEffectiveHealth(saved!);
  }

  /**
   * 只刷新在线状态（长轮询每次请求调用），不覆盖 lastHeartbeat 明细。
   */
  async touch(participantId: string): Promise<void> {
    await this.registry.update(
      { participantId },
      { healthStatus: "online", lastSeen: new Date() },
    );
  }

  /** P1-9:平台聚合连接器节点状态(超时未心跳 → offline)。 */
  async listRegistry(): Promise<CpConnectorRegistry[]> {
    const rows = await this.registry.find({ order: { lastSeen: "DESC" } });
    return rows.map((r) => this.withEffectiveHealth(r));
  }

  private withEffectiveHealth(row: CpConnectorRegistry): CpConnectorRegistry {
    const last = row.lastSeen ? new Date(row.lastSeen).getTime() : 0;
    const online = last > 0 && Date.now() - last <= this.offlineThresholdMs();
    return {
      ...row,
      healthStatus: online ? "online" : row.lastSeen ? "offline" : "unknown",
    };
  }

  /** 查询连接器证书(供签名验证)。 */
  async findCertificate(
    fingerprint: string,
  ): Promise<CertificateEntity | null> {
    return this.certs.findOne({ where: { sm2Fingerprint: fingerprint } });
  }

  /** 公钥形态校验：未压缩点 `04‖x‖y`（130 hex）或 `x‖y`（128 hex）。 */
  private assertWellFormedPublicKey(publicKey: string): void {
    const hex = publicKey.toLowerCase().startsWith("04")
      ? publicKey.slice(2)
      : publicKey;
    if (!/^[0-9a-f]{128}$/.test(hex.toLowerCase())) {
      throw new BadRequestException(
        "subjectPublicKey 必须是 64 字节 SM2 未压缩公钥（x‖y，可选 04 前缀）",
      );
    }
  }
}
