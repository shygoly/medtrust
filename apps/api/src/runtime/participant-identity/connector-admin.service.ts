import {
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
  subjectPublicKey?: string; // 连接器自有 SM2 公钥;缺省则控制面代生成(演示用)
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
  privateKey?: string; // 仅当控制面代生成密钥对时返回
}

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

    let subjectPublicKey = input.subjectPublicKey;
    let privateKey: string | undefined;
    if (!subjectPublicKey) {
      const pair = this.gm.generateSM2KeyPair();
      subjectPublicKey = pair.publicKey;
      privateKey = pair.privateKey;
    }

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

    return { connectorId: input.connectorId, certificate: cert, privateKey };
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

  /** 心跳超时阈值(ms)。超过未上报 → listRegistry 标 offline。 */
  private offlineThresholdMs(): number {
    const n = Number(process.env.CONNECTOR_OFFLINE_MS ?? 60_000);
    return Number.isFinite(n) && n > 0 ? n : 60_000;
  }

  /** P1-9:连接器周期心跳上报(版本/任务状态/资源水位)。 */
  async heartbeat(
    participantId: string,
    body: {
      connectorId?: string;
      version?: string;
      taskStatus?: Record<string, unknown>;
      resources?: Record<string, unknown>;
    },
  ): Promise<CpConnectorRegistry> {
    const row = await this.registry.findOne({ where: { participantId } });
    const lastHeartbeat = {
      connectorId: body.connectorId,
      version: body.version,
      taskStatus: body.taskStatus,
      resources: body.resources,
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
}
