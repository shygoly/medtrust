import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomUUID } from "crypto";
import {
  AuditAction,
  DataProduct,
  DataProductAccessGrantEntity,
  DataProductAccessRequestEntity,
  User,
  type AccessGrantStatus,
  type AccessPermission,
  type AccessRequestStatus,
} from "@medtrust/database";
import { AuditService } from "../../audit/audit.service";
import { SpaceScopeService } from "../space-context/space-scope.service";
import { SpaceContextService } from "../space-context/space-context.service";
import { NotificationService } from "../notifications/notification.service";

/** 授权行的对外形状（不含内部列，列名与 DTO 一致）。 */
export interface AccessGrantView {
  id: string;
  spaceId?: string | null;
  dataProductId: string;
  providerId: string;
  granteeParticipantId: string;
  permissions: AccessPermission[];
  purpose?: string | null;
  status: AccessGrantStatus;
  grantedByUserId?: string | null;
  grantedByParticipantId?: string | null;
  grantedAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  note?: string | null;
}

/** `check()` 的判定：allowed 是唯一权威结论，reason 说明为什么。 */
export interface AccessCheckResult {
  allowed: boolean;
  reason:
    | "granted"
    | "provider-self"
    | "no-grant"
    | "revoked"
    | "expired"
    | "permission-missing"
    | "purpose-mismatch"
    | "product-unknown";
  dataProductId: string;
  participantId: string;
  providerId?: string;
  permissions: AccessPermission[];
  grantId?: string;
  expiresAt?: string | null;
  /** 被回收时带上原因（给用户看"为什么没了"） */
  revokeReason?: string | null;
}

export interface AccessActor {
  userId?: string | number | null;
  /** 租户归属（来自 JWT）：审计链按租户分链，缺了就没法写"可归属"的记录 */
  tenantId?: number | null;
  participantId?: string | null;
  role?: string | null;
  /** 申请人/审批人快照里的联系邮箱（来自 JWT）。 */
  email?: string | null;
}

/** 访问申请的对外形状。 */
export interface AccessRequestView {
  id: string;
  spaceId?: string | null;
  dataProductId: string;
  providerId: string;
  requesterParticipantId: string;
  permissions: AccessPermission[];
  purpose?: string | null;
  note?: string | null;
  status: AccessRequestStatus;
  requestedByUserId?: string | null;
  requester?: {
    userId?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
  createdAt: string;
  decidedAt?: string | null;
  decidedBy?: {
    participantId?: string | null;
    userId?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
  decisionNote?: string | null;
  grantId?: string | null;
}

export const DEFAULT_ACCESS_PERMISSIONS: AccessPermission[] = ["compute"];

/**
 * 数据产品访问授权（**产品级 ACL**，D-ACL-1）。
 *
 * 三层语义（与数字合约的关系写死在这里，改之前先看 DECISIONS 的 D-ACL-1）：
 * 1. **本服务 = 访问控制**：能不能"碰"这个数据产品；
 * 2. **数字合约 = 执行授权**：以什么条款执行（目的/留存/输出/有效期 + 提供方签名），
 *    作业提交与编译期强制，**本服务不放宽它**；
 * 3. **fail-closed**：没有 active 且未过期的授权 = 拒绝；产品提供方访问自己的产品除外。
 *
 * 回收是追加式的（置 revoked + 记原因），不删行：授权历史本身是审计证据。
 */
@Injectable()
export class DataAccessService {
  private readonly logger = new Logger(DataAccessService.name);

  constructor(
    @InjectRepository(DataProductAccessGrantEntity, "controlplane")
    private readonly grants: Repository<DataProductAccessGrantEntity>,
    @InjectRepository(DataProduct, "controlplane")
    private readonly products: Repository<DataProduct>,
    private readonly spaceScope: SpaceScopeService,
    private readonly spaceContext: SpaceContextService,
    // 审计是"记录"不是"闸门"：写入失败只告警（AuditService 自身不抛），不影响授权动作本身。
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly notifications?: NotificationService,
    /** 使用方发起的访问申请（D-ACL-1 补）；@Optional 兼容既有手工构造。 */
    @Optional()
    @InjectRepository(DataProductAccessRequestEntity, "controlplane")
    private readonly requests?: Repository<DataProductAccessRequestEntity>,
    /** 申请人姓名快照（默认连接上的 users 表）。 */
    @Optional()
    @InjectRepository(User)
    private readonly users?: Repository<User>,
  ) {}

  /** 授权判定：**唯一**的"能不能访问"入口（端点与 agent 闸都走这里）。 */
  async check(input: {
    dataProductId: string;
    participantId: string;
    permission?: AccessPermission;
    purpose?: string;
    now?: Date;
  }): Promise<AccessCheckResult> {
    const permission = input.permission ?? "compute";
    const now = input.now ?? new Date();
    const product = await this.products.findOne({
      where: { id: input.dataProductId },
    });
    if (!product) {
      return {
        allowed: false,
        reason: "product-unknown",
        dataProductId: input.dataProductId,
        participantId: input.participantId,
        permissions: [],
      };
    }

    // 提供方访问自己的产品不需要自授（否则每个提供方都要给自己开一行）
    if (product.providerId === input.participantId) {
      return {
        allowed: true,
        reason: "provider-self",
        dataProductId: input.dataProductId,
        participantId: input.participantId,
        providerId: product.providerId,
        permissions: ["catalog", "compute"],
      };
    }

    const rows = await this.rowsFor(input.dataProductId, input.participantId);
    const active = rows.find((row) => row.status === "active");
    if (!active) {
      const revoked = rows.find((row) => row.status === "revoked");
      return {
        allowed: false,
        reason: revoked ? "revoked" : "no-grant",
        dataProductId: input.dataProductId,
        participantId: input.participantId,
        providerId: product.providerId,
        permissions: [],
        ...(revoked
          ? { grantId: revoked.id, revokeReason: revoked.revokeReason ?? null }
          : {}),
      };
    }

    if (
      active.expiresAt &&
      new Date(active.expiresAt).getTime() <= now.getTime()
    ) {
      return {
        allowed: false,
        reason: "expired",
        dataProductId: input.dataProductId,
        participantId: input.participantId,
        providerId: product.providerId,
        permissions: active.permissions ?? [],
        grantId: active.id,
        expiresAt: active.expiresAt,
      };
    }

    if (!(active.permissions ?? []).includes(permission)) {
      return {
        allowed: false,
        reason: "permission-missing",
        dataProductId: input.dataProductId,
        participantId: input.participantId,
        providerId: product.providerId,
        permissions: active.permissions ?? [],
        grantId: active.id,
        expiresAt: active.expiresAt ?? null,
      };
    }

    // 目的限定：授权写明 purpose 时，作业用途必须一致（与合约 purposeCode 同一口径）
    if (active.purpose && input.purpose && active.purpose !== input.purpose) {
      return {
        allowed: false,
        reason: "purpose-mismatch",
        dataProductId: input.dataProductId,
        participantId: input.participantId,
        providerId: product.providerId,
        permissions: active.permissions ?? [],
        grantId: active.id,
        expiresAt: active.expiresAt ?? null,
      };
    }

    return {
      allowed: true,
      reason: "granted",
      dataProductId: input.dataProductId,
      participantId: input.participantId,
      providerId: product.providerId,
      permissions: active.permissions ?? [],
      grantId: active.id,
      expiresAt: active.expiresAt ?? null,
    };
  }

  /**
   * 授权清单。
   *
   * 可见性：合规/运营/管理员看全量；其余人只看**与自己相关**的行（自己是被授权方，
   * 或自己是该产品的提供方）。避免"某药企能看到别家被授了哪些产品"。
   */
  async list(filter: {
    actor: AccessActor;
    dataProductId?: string;
    granteeParticipantId?: string;
    status?: AccessGrantStatus;
  }): Promise<AccessGrantView[]> {
    const qb = this.grants.createQueryBuilder("g");
    this.spaceScope.scope(qb, DataProductAccessGrantEntity.name);
    if (filter.dataProductId)
      qb.andWhere("g.dataProductId = :dp", { dp: filter.dataProductId });
    if (filter.granteeParticipantId)
      qb.andWhere("g.granteeParticipantId = :gp", {
        gp: filter.granteeParticipantId,
      });
    if (filter.status) qb.andWhere("g.status = :st", { st: filter.status });

    if (!isPrivileged(filter.actor.role)) {
      const me = filter.actor.participantId ?? "";
      qb.andWhere("(g.granteeParticipantId = :me OR g.providerId = :me)", {
        me,
      });
    }
    qb.orderBy("g.grantedAt", "DESC");

    const rows = await qb.getMany();
    return rows.map(toView);
  }

  /**
   * 授予访问权。
   *
   * 幂等：同一 (产品, 被授权方) 已有 active 行时**更新**该行（权限/到期/备注），
   * 不新增重复行——否则"到底哪一行在生效"会变成查表口径问题。
   */
  async grant(
    dto: {
      dataProductId: string;
      granteeParticipantId: string;
      permissions?: AccessPermission[];
      purpose?: string;
      expiresAt?: string;
      note?: string;
    },
    actor: AccessActor,
  ): Promise<AccessGrantView> {
    const product = await this.products.findOne({
      where: { id: dto.dataProductId },
    });
    if (!product)
      throw new NotFoundException(`数据产品 ${dto.dataProductId} 不存在`);

    this.assertCanAdminister(product.providerId, actor);
    if (dto.granteeParticipantId === product.providerId) {
      throw new BadRequestException("提供方访问自己的产品无需授权");
    }

    const permissions = normalisePermissions(dto.permissions);
    const expiresAt = normaliseExpiry(dto.expiresAt);

    const existing = (
      await this.rowsFor(dto.dataProductId, dto.granteeParticipantId)
    ).find((row) => row.status === "active");

    if (existing) {
      existing.permissions = permissions;
      existing.purpose = dto.purpose ?? existing.purpose ?? null;
      existing.expiresAt = expiresAt;
      existing.note = dto.note ?? existing.note ?? null;
      existing.providerId = product.providerId;
      const saved = await this.grants.save(existing);
      await this.auditWrite(AuditAction.UPDATE, saved, actor, {
        op: "regrant",
      });
      await this.notifyGrant(
        saved,
        "data-access.granted",
        "数据访问授权已更新",
      );
      return toView(saved);
    }

    const row = this.grants.create({
      id: randomUUID(),
      dataProductId: dto.dataProductId,
      providerId: product.providerId,
      granteeParticipantId: dto.granteeParticipantId,
      permissions,
      purpose: dto.purpose ?? null,
      status: "active",
      grantedByUserId: actor.userId != null ? String(actor.userId) : null,
      grantedByParticipantId: actor.participantId ?? null,
      grantedAt: new Date(),
      expiresAt,
      note: dto.note ?? null,
      // 空间归属：与其它域内活动表一致，写入时即带 space_id（缺省由回填任务兜底）
      spaceId: this.spaceContext.current()?.spaceId ?? null,
    });
    const saved = await this.grants.save(row);
    await this.auditWrite(AuditAction.CREATE, saved, actor, { op: "grant" });
    await this.notifyGrant(
      saved,
      "data-access.granted",
      "已获得数据产品访问权",
    );
    return toView(saved);
  }

  /** 回收访问权：必须有原因；已回收的行不能被"再回收"（幂等但报错更利于发现误操作）。 */
  async revoke(
    id: string,
    reason: string,
    actor: AccessActor,
  ): Promise<AccessGrantView> {
    const row = await this.grants.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`访问授权 ${id} 不存在`);
    this.assertCanAdminister(row.providerId, actor);
    if (row.status === "revoked")
      throw new BadRequestException(`访问授权 ${id} 已回收`);
    if (!reason?.trim()) throw new BadRequestException("回收必须给出原因");

    row.status = "revoked";
    row.revokedAt = new Date();
    row.revokedByUserId = actor.userId != null ? String(actor.userId) : null;
    row.revokeReason = reason.trim();
    const saved = await this.grants.save(row);
    await this.auditWrite(AuditAction.UPDATE, saved, actor, { op: "revoke" });
    await this.notifyGrant(
      saved,
      "data-access.revoked",
      "数据产品访问权已被回收",
    );
    return toView(saved);
  }

  // ── 访问申请（使用方发起 → 提供方批准） ─────────────────────────────────

  /**
   * 使用方发起访问申请。
   *
   * 幂等：同一 (产品, 申请方) 已有 pending 时直接返回那一条，不重复建；
   * 已有生效授权则拒绝（避免"已经能用还在等"）。
   * 本方法**不产生访问能力**——批准时才调 `grant()`。
   */
  async requestAccess(
    input: {
      dataProductId: string;
      permissions?: AccessPermission[];
      purpose?: string;
      note?: string;
    },
    actor: AccessActor,
  ): Promise<AccessRequestView> {
    if (!this.requests)
      throw new BadRequestException("访问申请服务不可用（未接入申请仓储）");
    const requester = actor.participantId?.trim();
    if (!requester) throw new BadRequestException("未绑定参与方身份");

    const product = await this.products.findOne({
      where: { id: input.dataProductId },
    });
    if (!product)
      throw new NotFoundException(`数据产品 ${input.dataProductId} 不存在`);
    if (product.providerId === requester)
      throw new BadRequestException("提供方访问自己的产品无需申请");

    const active = (await this.rowsFor(input.dataProductId, requester)).find(
      (row) => row.status === "active",
    );
    if (active)
      throw new BadRequestException("已获得该数据产品的访问授权，无需重复申请");

    const existing = await this.requests.findOne({
      where: {
        dataProductId: input.dataProductId,
        requesterParticipantId: requester,
        status: "pending",
      },
    });
    if (existing) return toRequestView(existing);

    const row = this.requests.create({
      id: randomUUID(),
      dataProductId: input.dataProductId,
      providerId: product.providerId,
      requesterParticipantId: requester,
      permissions: normalisePermissions(input.permissions),
      purpose: input.purpose ?? null,
      note: input.note ?? null,
      status: "pending",
      requestedByUserId: actor.userId != null ? String(actor.userId) : null,
      requester: {
        userId: actor.userId != null ? String(actor.userId) : null,
        name: await this.lookupUserName(actor.userId),
        email: actor.email ?? null,
      },
      spaceId: this.spaceContext.current()?.spaceId ?? null,
    });
    const saved = await this.requests.save(row);
    await this.notify(
      product.providerId,
      saved,
      "data-access.requested",
      "有机构申请访问你的数据产品",
      `${requester} 申请访问「${product.title ?? product.id}」（权限：${saved.permissions.join(", ")}）。在「数据授权」页一键批准或拒绝。`,
    );
    return toRequestView(saved);
  }

  /** 申请清单：特权角色看全部；提供方看"待我批 + 我发起的"；使用方只看自己发起的。 */
  async listRequests(
    filter: { status?: AccessRequestStatus },
    actor: AccessActor,
  ): Promise<AccessRequestView[]> {
    if (!this.requests) return [];
    const qb = this.requests.createQueryBuilder("r");
    this.spaceScope.scope(qb, DataProductAccessRequestEntity.name);
    if (filter.status) qb.andWhere("r.status = :st", { st: filter.status });
    if (!isPrivileged(actor.role)) {
      const me = actor.participantId ?? "";
      if (actor.role === "provider") {
        qb.andWhere("(r.providerId = :me OR r.requesterParticipantId = :me)", {
          me,
        });
      } else {
        qb.andWhere("r.requesterParticipantId = :me", { me });
      }
    }
    qb.orderBy("r.createdAt", "DESC");
    const rows = await qb.getMany();
    return rows.map(toRequestView);
  }

  /** 批准申请：落授权行（走既有 grant，含审计），再把申请置 approved。 */
  async approveRequest(
    id: string,
    actor: AccessActor,
    opts: { note?: string; expiresAt?: string } = {},
  ): Promise<{ request: AccessRequestView; grant: AccessGrantView }> {
    const row = await this.requirePendingRequest(id, actor);
    const grant = await this.grant(
      {
        dataProductId: row.dataProductId,
        granteeParticipantId: row.requesterParticipantId,
        permissions: row.permissions,
        ...(row.purpose ? { purpose: row.purpose } : {}),
        ...(row.note ? { note: row.note } : {}),
        ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
      },
      actor,
    );
    row.status = "approved";
    row.decidedAt = new Date();
    row.decidedBy = await this.actorSnapshot(row.providerId, actor);
    row.decisionNote = opts.note?.trim() || null;
    row.grantId = grant.id;
    const saved = await this.requests!.save(row);
    await this.notify(
      row.requesterParticipantId,
      saved,
      "data-access.approved",
      "数据访问申请已批准",
      `机构已批准你对「${row.dataProductId}」的访问申请，权限：${row.permissions.join(", ")}。`,
    );
    await this.resolveProviderTodo(saved);
    return { request: toRequestView(saved), grant };
  }

  /** 驳回申请（必须写原因，回到申请方）。 */
  async rejectRequest(
    id: string,
    reason: string,
    actor: AccessActor,
  ): Promise<AccessRequestView> {
    if (!reason?.trim()) throw new BadRequestException("驳回必须给出原因");
    const row = await this.requirePendingRequest(id, actor);
    row.status = "rejected";
    row.decidedAt = new Date();
    row.decidedBy = await this.actorSnapshot(row.providerId, actor);
    row.decisionNote = reason.trim();
    const saved = await this.requests!.save(row);
    await this.notify(
      row.requesterParticipantId,
      saved,
      "data-access.rejected",
      "数据访问申请被拒绝",
      `原因：${reason.trim()}`,
    );
    await this.resolveProviderTodo(saved);
    return toRequestView(saved);
  }

  /** 申请方撤回待处理申请（与合约撤回同语义：不是审批结论）。 */
  async withdrawRequest(
    id: string,
    actor: AccessActor,
  ): Promise<AccessRequestView> {
    const row = await this.requests?.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`访问申请 ${id} 不存在`);
    if (row.requesterParticipantId !== (actor.participantId ?? ""))
      throw new ForbiddenException("仅申请方可撤回本方的申请");
    if (row.status !== "pending")
      throw new BadRequestException("仅待处理的申请可撤回");
    row.status = "withdrawn";
    row.decidedAt = new Date();
    row.decidedBy = await this.actorSnapshot(row.requesterParticipantId, actor);
    const saved = await this.requests!.save(row);
    await this.resolveProviderTodo(saved);
    await this.notify(
      row.providerId,
      saved,
      "data-access.withdrawn",
      "访问申请已撤回",
      `${row.requesterParticipantId} 撤回了对「${row.dataProductId}」的访问申请，无需再处理。`,
    );
    return toRequestView(saved);
  }

  private async requirePendingRequest(
    id: string,
    actor: AccessActor,
  ): Promise<DataProductAccessRequestEntity> {
    const row = await this.requests?.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`访问申请 ${id} 不存在`);
    this.assertCanAdminister(row.providerId, actor);
    if (row.status !== "pending")
      throw new BadRequestException("仅待处理的申请可审批");
    return row;
  }

  private async actorSnapshot(
    participantId: string,
    actor: AccessActor,
  ): Promise<NonNullable<AccessRequestView["decidedBy"]>> {
    return {
      participantId,
      userId: actor.userId != null ? String(actor.userId) : null,
      name: await this.lookupUserName(actor.userId),
      email: actor.email ?? null,
    };
  }

  private async lookupUserName(
    userId?: string | number | null,
  ): Promise<string | null> {
    if (userId == null || !this.users) return null;
    const id = Number(userId);
    if (!Number.isFinite(id)) return null;
    try {
      const row = await this.users.findOne({ where: { id } });
      return row?.name?.trim() || null;
    } catch {
      return null;
    }
  }

  private async resolveProviderTodo(
    row: DataProductAccessRequestEntity,
  ): Promise<void> {
    await this.notifications?.markResolved({
      recipientParticipantId: row.providerId,
      resourceType: "data-access-request",
      resourceId: row.id,
      type: "data-access.requested",
    });
  }

  /** 站内信是旁路：失败不影响动作（notify 自身不抛）。 */
  private async notify(
    recipientParticipantId: string,
    row: DataProductAccessRequestEntity,
    type: string,
    title: string,
    body: string,
  ): Promise<void> {
    await this.notifications?.notify({
      recipientParticipantId,
      spaceId: row.spaceId ?? this.spaceContext.current()?.spaceId ?? null,
      type,
      title,
      body,
      resourceType: "data-access-request",
      resourceId: row.id,
      actorParticipantId: row.requesterParticipantId,
      details: {
        requestId: row.id,
        dataProductId: row.dataProductId,
        requesterParticipantId: row.requesterParticipantId,
        providerId: row.providerId,
        status: row.status,
        permissions: row.permissions,
      },
    });
  }

  private async rowsFor(
    dataProductId: string,
    granteeParticipantId: string,
  ): Promise<DataProductAccessGrantEntity[]> {
    const qb = this.grants.createQueryBuilder("g");
    this.spaceScope.scope(qb, DataProductAccessGrantEntity.name);
    qb.andWhere("g.dataProductId = :dp", { dp: dataProductId }).andWhere(
      "g.granteeParticipantId = :gp",
      { gp: granteeParticipantId },
    );
    qb.orderBy("g.grantedAt", "DESC");
    return qb.getMany();
  }

  /**
   * 谁能管授权：产品的提供方本人，或合规/运营/管理员。
   *
   * 这几类角色的分工在本仓是既定的（provider 管自己的数据；compliance/operator 有平台
   * 侧的裁定与运营职责）——与 audit / contracts 端点的 `@ParticipantRoles` 口径一致。
   */
  private assertCanAdminister(providerId: string, actor: AccessActor): void {
    if (isPrivileged(actor.role)) return;
    if (actor.participantId && actor.participantId === providerId) return;
    throw new ForbiddenException(
      "只有该数据产品的提供方（或合规/运营方）能授予或回收访问权",
    );
  }

  private async notifyGrant(
    row: DataProductAccessGrantEntity,
    type: string,
    title: string,
  ): Promise<void> {
    if (!this.notifications) return;
    await this.notifications.notify({
      recipientParticipantId: row.granteeParticipantId,
      spaceId: row.spaceId ?? null,
      type,
      title,
      body: `${row.dataProductId}（提供方 ${row.providerId}）`,
      resourceType: "data-access",
      resourceId: row.id,
      actorParticipantId: row.providerId,
      details: {
        dataProductId: row.dataProductId,
        providerId: row.providerId,
        permissions: row.permissions,
      },
    });
  }

  private async auditWrite(
    action: AuditAction,
    row: DataProductAccessGrantEntity,
    actor: AccessActor,
    extra: Record<string, unknown>,
  ): Promise<void> {
    // 没有租户归属就不写：审计链按租户分链，写进"无主"的链比不写更糟
    if (!this.audit || !actor.tenantId) {
      if (this.audit) this.logger.warn("授权动作缺少 tenantId，审计未落链");
      return;
    }
    try {
      await this.audit.create(Number(actor.userId ?? 0), actor.tenantId, {
        action,
        resource: "data-access-grant",
        details: {
          ...extra,
          grantId: row.id,
          dataProductId: row.dataProductId,
          granteeParticipantId: row.granteeParticipantId,
          permissions: row.permissions,
          status: row.status,
          ...(row.revokeReason ? { revokeReason: row.revokeReason } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `授权审计写入失败（授权动作已完成）：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
  }
}

const PRIVILEGED_ROLES = new Set(["compliance", "operator", "admin"]);

export const isPrivileged = (role?: string | null): boolean =>
  Boolean(role && PRIVILEGED_ROLES.has(role));

function normalisePermissions(input?: AccessPermission[]): AccessPermission[] {
  const allowed: AccessPermission[] = ["catalog", "compute"];
  if (!input || input.length === 0) return [...DEFAULT_ACCESS_PERMISSIONS];
  const unique = [...new Set(input)];
  for (const item of unique) {
    if (!allowed.includes(item))
      throw new BadRequestException(`未知权限位：${item}`);
  }
  return unique;
}

function normaliseExpiry(input?: string): string | null {
  if (!input) return null;
  const time = Date.parse(input);
  if (!Number.isFinite(time))
    throw new BadRequestException("expiresAt 不是合法时间");
  if (time <= Date.now())
    throw new BadRequestException("expiresAt 必须是将来时间");
  return new Date(time).toISOString();
}

export function toRequestView(
  row: DataProductAccessRequestEntity,
): AccessRequestView {
  return {
    id: row.id,
    spaceId: row.spaceId ?? null,
    dataProductId: row.dataProductId,
    providerId: row.providerId,
    requesterParticipantId: row.requesterParticipantId,
    permissions: row.permissions ?? [],
    purpose: row.purpose ?? null,
    note: row.note ?? null,
    status: row.status,
    requestedByUserId: row.requestedByUserId ?? null,
    requester: row.requester ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : "",
    decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
    decidedBy: row.decidedBy ?? null,
    decisionNote: row.decisionNote ?? null,
    grantId: row.grantId ?? null,
  };
}

export function toView(row: DataProductAccessGrantEntity): AccessGrantView {
  return {
    id: row.id,
    spaceId: row.spaceId ?? null,
    dataProductId: row.dataProductId,
    providerId: row.providerId,
    granteeParticipantId: row.granteeParticipantId,
    permissions: row.permissions ?? [],
    purpose: row.purpose ?? null,
    status: row.status,
    grantedByUserId: row.grantedByUserId ?? null,
    grantedByParticipantId: row.grantedByParticipantId ?? null,
    grantedAt: row.grantedAt ? new Date(row.grantedAt).toISOString() : "",
    expiresAt: row.expiresAt ?? null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
    revokeReason: row.revokeReason ?? null,
    note: row.note ?? null,
  };
}
