import { randomBytes, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CpConnectorEnrollment } from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { ConnectorAdminService } from "./connector-admin.service";
import { connectorEnrollPayload } from "./connector-enrollment";

const ENROLL_WINDOW_MS = 5 * 60_000;

export interface SubmitEnrollmentInput {
  connectorId: string;
  participantId: string;
  subjectPublicKey: string;
  timestamp: string;
  signature: string;
}

@Injectable()
export class ConnectorEnrollmentService {
  constructor(
    @InjectRepository(CpConnectorEnrollment, "controlplane")
    private readonly enrollments: Repository<CpConnectorEnrollment>,
    private readonly admin: ConnectorAdminService,
    private readonly gm: GMCryptoService,
  ) {}

  async submit(input: SubmitEnrollmentInput): Promise<CpConnectorEnrollment> {
    const connectorId = input.connectorId?.trim();
    const participantId = input.participantId?.trim();
    const subjectPublicKey = input.subjectPublicKey?.trim();
    const timestamp = input.timestamp?.trim();
    const signature = input.signature?.trim();
    if (
      !connectorId ||
      !participantId ||
      !subjectPublicKey ||
      !timestamp ||
      !signature
    ) {
      throw new BadRequestException(
        "入网申请缺少连接器编号、参与方、公钥、时间戳或签名",
      );
    }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > ENROLL_WINDOW_MS) {
      throw new BadRequestException("入网签名时间戳超出 5 分钟");
    }
    const payload = connectorEnrollPayload({
      timestamp,
      connectorId,
      participantId,
      subjectPublicKey,
    });
    let ok = false;
    try {
      ok = this.gm.sm2Verify(payload, signature, subjectPublicKey);
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new UnauthorizedException("入网签名无法用提交的公钥验证");
    }

    const latest = await this.latestFor(connectorId);
    if (latest?.status === "pending") {
      if (
        latest.subjectPublicKey !== subjectPublicKey ||
        latest.participantId !== participantId
      ) {
        throw new ConflictException("该连接器已有待批准申请");
      }
      return latest;
    }

    const row = await this.enrollments.save(
      this.enrollments.create({
        connectorId,
        participantId,
        subjectPublicKey,
        id: randomUUID(),
        pollToken: randomBytes(32).toString("hex"),
        status: "pending",
      }),
    );
    return row;
  }

  async poll(id: string, pollToken: string): Promise<CpConnectorEnrollment> {
    const row = await this.enrollments.findOne({ where: { id } });
    if (!row || row.pollToken !== pollToken) {
      throw new UnauthorizedException("入网轮询凭证无效");
    }
    return row;
  }

  list(status?: string): Promise<CpConnectorEnrollment[]> {
    return this.enrollments.find({
      ...(status
        ? { where: { status: status as CpConnectorEnrollment["status"] } }
        : {}),
      order: { createdAt: "DESC" },
    });
  }

  async approve(id: string): Promise<CpConnectorEnrollment> {
    const row = await this.requirePending(id);
    const issued = await this.admin.issuePresentedPublicKey({
      connectorId: row.connectorId,
      participantId: row.participantId,
      subjectPublicKey: row.subjectPublicKey,
    });
    row.status = "approved";
    row.fingerprint = issued.certificate.fingerprint;
    row.decidedAt = new Date();
    return this.enrollments.save(row);
  }

  async reject(id: string, reason: string): Promise<CpConnectorEnrollment> {
    const row = await this.requirePending(id);
    row.status = "rejected";
    row.rejectReason = reason.trim() || "未说明";
    row.decidedAt = new Date();
    return this.enrollments.save(row);
  }

  private async requirePending(id: string): Promise<CpConnectorEnrollment> {
    const row = await this.enrollments.findOne({ where: { id } });
    if (!row) throw new NotFoundException("入网申请不存在");
    if (row.status !== "pending") throw new ConflictException("该申请已处理");
    return row;
  }

  private async latestFor(
    connectorId: string,
  ): Promise<CpConnectorEnrollment | null> {
    const rows = await this.enrollments.find({
      where: { connectorId },
      order: { createdAt: "DESC" },
    });
    return rows[0] ?? null;
  }
}
