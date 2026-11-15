import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  DataProduct,
  InteropPushRecordEntity,
  InteropSubject,
  OrgCertificationApplication,
  ParticipantIdentity,
} from "@medtrust/database";
import {
  NDI_ID_SCHEME_VERSION,
  ndiIdFromInternal,
  ndiOrgCodeFromEnv,
} from "@medtrust/mdop";
import { AuditService } from "../../audit/audit.service";
import { createSilkRoadClient, silkRoadNodeId } from "./silk-road.client";

/** 推送台账的默认目标节点标识（与 client 节点 id 口径一致：节点地址不落台账）。 */
const PUSH_TARGET = "silk-road";

// P2-2:丝路数港互认服务。主体同步(身份互认)、目录同步、日志上报
// 三件事的 MedTrust 侧实现;区域节点接口语义待《数据基础设施接入指南》
// 接口文档到位后在 silk-road.client.ts 补齐。
@Injectable()
export class SilkRoadService {
  private readonly client = createSilkRoadClient();

  constructor(
    @InjectRepository(InteropSubject, "controlplane")
    private readonly subjects: Repository<InteropSubject>,
    @InjectRepository(DataProduct, "controlplane")
    private readonly products: Repository<DataProduct>,
    @InjectRepository(OrgCertificationApplication, "controlplane")
    private readonly orgApps: Repository<OrgCertificationApplication>,
    @InjectRepository(ParticipantIdentity, "controlplane")
    private readonly participants: Repository<ParticipantIdentity>,
    /** 对外推送台账（ndi-catalog-upstream-listing 第 2 步）：幂等键 + 成败原因可查。 */
    @InjectRepository(InteropPushRecordEntity, "controlplane")
    private readonly pushes: Repository<InteropPushRecordEntity>,
    private readonly auditService: AuditService,
  ) {
    // NDI 标识方案自检（ndi-identifier-alignment）：未知版本直接拒绝装配，
    // 避免带着不认识的编码规则对外发标识。未配置时用库里当前支持的版本。
    const declared = (
      process.env.NDI_ID_SCHEME_VERSION ?? NDI_ID_SCHEME_VERSION
    ).trim();
    if (declared !== NDI_ID_SCHEME_VERSION) {
      throw new Error(
        `不支持的 NDI 标识方案版本：${declared}（当前支持 ${NDI_ID_SCHEME_VERSION}）`,
      );
    }
  }

  // 身份互认:从丝路数港节点拉取注册主体并缓存;已存在则更新。
  // 自动映射:主体无 participantId 时,按 org 名查找/创建 cp_participant
  // (subjectVerified=true,区域节点已完成主体注册核验),实现「带入即入册」。
  async syncSubjects(): Promise<{ imported: number; mapped: number }> {
    const rows = await this.client.listSubjects();
    let mapped = 0;
    for (const s of rows) {
      let subject = await this.subjects.findOne({
        where: { subjectId: s.subjectId, nodeId: s.nodeId },
      });
      if (subject) {
        Object.assign(subject, {
          orgName: s.orgName,
          uscc: s.uscc,
          region: s.region,
          legalPerson: s.legalPerson,
          rawPayload: s.rawPayload,
          updatedAt: new Date(),
        });
      } else {
        subject = this.subjects.create({
          subjectId: s.subjectId,
          nodeId: s.nodeId || silkRoadNodeId(),
          orgName: s.orgName,
          uscc: s.uscc,
          region: s.region,
          legalPerson: s.legalPerson,
          rawPayload: s.rawPayload,
          status: "synced",
        });
      }

      // 映射到本空间参与方(仅创建,不分配业务角色)。
      if (!subject.participantId) {
        const org = s.orgName || s.subjectId;
        let participant = await this.participants.findOne({ where: { org } });
        if (!participant) {
          participant = await this.participants.save(
            this.participants.create({
              org,
              region: s.region,
              subjectVerified: true,
              dataVerified: false,
            }),
          );
        }
        subject.participantId = participant.id;
        subject.status = "mapped";
        mapped += 1;
      }
      await this.subjects.save(subject);
    }
    return { imported: rows.length, mapped };
  }

  listSubjects(search?: string) {
    const qb = this.subjects.createQueryBuilder("s");
    if (search) {
      qb.andWhere("(s.orgName LIKE :q OR s.uscc LIKE :q)", {
        q: `%${search}%`,
      });
    }
    return qb.orderBy("s.importedAt", "DESC").take(200).getMany();
  }

  // 目录同步:把本空间 active 数据产品推送到丝路数港节点(一点发布,全域可见)。
  async pushCatalog(): Promise<{ pushed: number }> {
    // ndi-catalog-upstream-listing：只上报显式标记 `regional` 的在架产品。
    // 存量默认 `internal`，**不自动外发**（默认不外发是硬约束）。
    const products = await this.products.find({
      where: { status: "active", listingScope: "regional" },
    });
    // NDI-TR-2025-04「统一目录标识」：对外报文用 NDI 编码；机构码未配置即 fail-closed
    // （不猜默认值、不回退内部 URN —— 对方按 04 解析不了 URN）。
    const orgCode = ndiOrgCodeFromEnv();
    if (!orgCode) {
      throw new ServiceUnavailableException(
        "未配置 NDI_ORG_CODE：目录上报已关闭（对外标识须为 NDI-TR-2025-04 编码）",
      );
    }
    const payload = products.map((p) => {
      // 类型分派（第 2 步）：产品 / 服务分列，资源类对象本空间暂无，不虚报。
      const objectType: "product" | "service" =
        p.productType === "service" ? "service" : "product";
      const ndiId = ndiIdFromInternal({
        internalId: p.urn,
        orgCode,
        type: objectType,
      });
      return {
        // 内部标识仅用于回溯对账，不作对外主键。
        urn: p.urn,
        ndiId,
        objectType,
        // 幂等键 = spaceId + ndiId + 版本（任务要求）；重复推送只更新既有台账行。
        idempotencyKey: `${p.homeSpace}:${ndiId}:${NDI_ID_SCHEME_VERSION}`,
        spaceId: p.homeSpace,
        title: p.title,
        providerId: p.providerId,
        productType: p.productType,
        classification: p.classification,
        recordCount: p.recordCount,
      };
    });
    if (!payload.length) return { pushed: 0 };

    // 本地台账先落库（顺序断言：先本地、再触发外部推送）。
    await this.recordPushAttempts(payload);
    try {
      await this.client.pushCatalog(payload);
    } catch (err) {
      await this.markPushFailed(payload, err as Error);
      // 推送失败对操作者是可见错误，但**不回滚本地目录**：台账已记 failed + 原因。
      throw err;
    }
    await this.markPushed(payload);
    return { pushed: payload.length };
  }

  /** 最近推送台账（失败原因可查；供运维/状态页）。 */
  async listPushRecords(limit = 50): Promise<InteropPushRecordEntity[]> {
    const take = Number.isFinite(limit)
      ? Math.min(Math.max(Math.floor(limit), 1), 200)
      : 50;
    return this.pushes.find({ order: { updatedAt: "DESC" }, take });
  }

  private pushRecordId(idempotencyKey: string): string {
    return `${PUSH_TARGET}:${idempotencyKey}`;
  }

  /** 推送前落 `pending` + 尝试次数；同幂等键只更新既有行（不新增第二条）。 */
  private async recordPushAttempts(
    payload: Array<{
      idempotencyKey: string;
      objectType: "product" | "service";
      spaceId?: string;
    }>,
  ): Promise<void> {
    for (const item of payload) {
      const id = this.pushRecordId(item.idempotencyKey);
      const existing = await this.pushes.findOne({ where: { id } });
      if (existing) {
        existing.attempts += 1;
        existing.status = "pending";
        existing.lastError = null;
        await this.pushes.save(existing);
        continue;
      }
      await this.pushes.save(
        this.pushes.create({
          id,
          target: PUSH_TARGET,
          objectType: item.objectType,
          idempotencyKey: item.idempotencyKey,
          status: "pending",
          attempts: 1,
          spaceId: item.spaceId,
        }),
      );
    }
  }

  private async markPushed(
    payload: Array<{ idempotencyKey: string }>,
  ): Promise<void> {
    const pushedAt = new Date();
    for (const item of payload) {
      const id = this.pushRecordId(item.idempotencyKey);
      const existing = await this.pushes.findOne({ where: { id } });
      if (!existing) continue;
      existing.status = "pushed";
      existing.lastPushedAt = pushedAt;
      existing.lastError = null;
      await this.pushes.save(existing);
    }
  }

  private async markPushFailed(
    payload: Array<{ idempotencyKey: string }>,
    err: Error,
  ): Promise<void> {
    const reason = (err?.message ?? "未知错误").slice(0, 500);
    for (const item of payload) {
      const id = this.pushRecordId(item.idempotencyKey);
      const existing = await this.pushes.findOne({ where: { id } });
      if (!existing) continue;
      existing.status = "failed";
      existing.lastError = reason;
      await this.pushes.save(existing);
    }
  }

  // 日志上报:把本空间审计摘要(含 SM3 链完整性结论)上报区域节点。
  async reportAudit(tenantId: number): Promise<{ reported: boolean }> {
    const report = await this.auditService.exportReport({ tenantId, limit: 1 });
    const digest = {
      nodeId: silkRoadNodeId(),
      generatedAt: new Date().toISOString(),
      integrity: report.integrity,
      total: report.total,
    };
    await this.client.reportAudit(digest);
    return { reported: true };
  }

  // 用户机构认证「从丝路数港带入」:用已同步主体的权威字段预填申请。
  async importSubjectToCertification(userId: number, subjectId: string) {
    const subject = await this.subjects.findOne({ where: { subjectId } });
    if (!subject) throw new NotFoundException("丝路数港主体不存在,请先同步");

    let app = await this.orgApps.findOne({ where: { userId } });
    if (app?.status === "approved") {
      throw new BadRequestException("机构认证已通过,如需变更请联系运营方");
    }
    const patch = {
      source: "silk-road" as const,
      interopSubjectId: subject.subjectId,
      orgName: subject.orgName,
      uscc: subject.uscc,
      region: subject.region,
      businessScope: app?.businessScope,
    };
    if (!app) {
      app = this.orgApps.create({
        userId,
        status: "draft",
        ...patch,
      });
    } else {
      Object.assign(app, patch);
      app.updatedAt = new Date();
    }
    const saved = await this.orgApps.save(app);
    return { application: saved };
  }
}
