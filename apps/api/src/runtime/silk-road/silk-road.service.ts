import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  DataProduct,
  InteropSubject,
  OrgCertificationApplication,
  ParticipantIdentity,
} from "@medtrust/database";
import { AuditService } from "../../audit/audit.service";
import {
  createSilkRoadClient,
  silkRoadNodeId,
} from "./silk-road.client";

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
    private readonly auditService: AuditService,
  ) {}

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
    const products = await this.products.find({ where: { status: "active" } });
    const payload = products.map((p) => ({
      urn: p.urn,
      title: p.title,
      providerId: p.providerId,
      productType: p.productType,
      classification: p.classification,
      recordCount: p.recordCount,
    }));
    await this.client.pushCatalog(payload);
    return { pushed: payload.length };
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
