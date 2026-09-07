import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { OrgCertificationApplication, User } from "@medtrust/database";
import { CaService } from "../participant-identity/ca.service";
import { SaveCertificationDto } from "./dto/save-certification.dto";
import { ReviewCertificationDto } from "./dto/review-certification.dto";

// P1-4:机构认证申请服务。持久化在 control-plane 库(元数据,不落盘本地上传文件;
// 证照/LOGO 只存对象存储 key)。
@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(OrgCertificationApplication, "controlplane")
    private readonly repo: Repository<OrgCertificationApplication>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly caService: CaService,
  ) {}

  async getMyCertification(userId: number) {
    const row = await this.repo.findOne({ where: { userId } });
    if (!row) return { application: null };
    return { application: this.toSafe(row) };
  }

  async saveCertification(userId: number, dto: SaveCertificationDto) {
    let row = await this.repo.findOne({ where: { userId } });
    if (row?.status === "approved") {
      throw new BadRequestException("机构认证已通过,如需变更请联系运营方");
    }

    const patch = {
      orgType: dto.orgType,
      licenseImages: dto.licenseImages,
      orgName: dto.orgName,
      uscc: dto.uscc,
      validPeriod: dto.validPeriod,
      validUntil: dto.validUntil,
      region: dto.region,
      address: dto.address,
      businessScope: dto.businessScope,
      orgIntro: dto.orgIntro,
      industry: dto.industry,
      capitalWanYuan: dto.capitalWanYuan,
      regDate: dto.regDate,
      logoKey: dto.logoKey,
      caIdentityName: dto.caIdentityName,
      caPublicKey: dto.caPublicKey,
      caCertFingerprint: dto.caCertFingerprint,
    };

    if (!row) {
      row = this.repo.create({
        userId,
        status: dto.submit ? "submitted" : "draft",
        ...patch,
      });
    } else {
      Object.assign(row, patch);
      if (dto.submit) row.status = "submitted";
      // 非提交保存:保留 draft/rejected 状态,仅更新字段。
      if (row.status === "submitted" && !dto.submit) {
        // 已提交的申请做字段微调时仍保持 submitted,避免绕过审核。
      }
      row.updatedAt = new Date();
    }
    const saved = await this.repo.save(row);
    return { application: this.toSafe(saved) };
  }

  async listCertifications(params: {
    status?: string;
    limit: number;
    offset: number;
  }) {
    const qb = this.repo.createQueryBuilder("c");
    if (params.status) {
      qb.andWhere("c.status = :status", { status: params.status });
    }
    qb.orderBy("c.createdAt", "DESC").skip(params.offset).take(params.limit);
    const [items, total] = await qb.getManyAndCount();
    return { items: items.map((i) => this.toSafe(i)), total };
  }

  async reviewCertification(
    id: string,
    reviewerId: number,
    dto: ReviewCertificationDto,
  ) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException("申请不存在");
    if (row.status !== "submitted") {
      throw new BadRequestException("仅已提交的申请可以审核");
    }
    row.status = dto.approve ? "approved" : "rejected";
    row.reviewerId = reviewerId;
    row.reviewNote = dto.note;
    row.reviewedAt = new Date();
    const saved = await this.repo.save(row);
    return { application: this.toSafe(saved) };
  }

  // P1-7:为用户签发 CA 身份凭证。私钥在客户端本地生成,平台只接收公钥;
  // 复用中心 CaService(control-plane 证书注册表)。换机/重装后旧凭证作废重发。
  async issueUserCa(userId: number, identityName: string, publicKey: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("用户不存在");
    const app = await this.repo.findOne({ where: { userId } });
    if (!app) {
      throw new BadRequestException("请先填写机构认证基本信息");
    }

    app.caIdentityName = identityName;
    app.caPublicKey = publicKey;
    app.updatedAt = new Date();
    await this.repo.save(app);

    const cert = await this.caService.issue(
      `user:${userId}`,
      user.participantId || `pending:${userId}`,
      publicKey,
      365,
    );
    app.caCertFingerprint = cert.fingerprint;
    app.updatedAt = new Date();
    await this.repo.save(app);

    return { certificate: cert };
  }

  async revokeUserCa(userId: number) {
    const app = await this.repo.findOne({ where: { userId } });
    if (!app?.caCertFingerprint) {
      throw new BadRequestException("暂无可作废的 CA 身份凭证");
    }
    await this.caService.revoke(app.caCertFingerprint);
    app.caCertFingerprint = undefined;
    app.caPublicKey = undefined;
    app.updatedAt = new Date();
    await this.repo.save(app);
    return { ok: true };
  }

  private toSafe(row: OrgCertificationApplication) {
    return {
      id: row.id,
      userId: row.userId,
      status: row.status,
      orgType: row.orgType,
      licenseImages: row.licenseImages,
      orgName: row.orgName,
      uscc: row.uscc,
      validPeriod: row.validPeriod,
      validUntil: row.validUntil,
      region: row.region,
      address: row.address,
      businessScope: row.businessScope,
      orgIntro: row.orgIntro,
      industry: row.industry,
      capitalWanYuan: row.capitalWanYuan,
      regDate: row.regDate,
      logoKey: row.logoKey,
      caIdentityName: row.caIdentityName,
      caPublicKey: row.caPublicKey,
      caCertFingerprint: row.caCertFingerprint,
      reviewerId: row.reviewerId,
      reviewNote: row.reviewNote,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
