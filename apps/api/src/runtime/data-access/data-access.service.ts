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
  type AccessGrantStatus,
  type AccessPermission,
} from "@medtrust/database";
import { AuditService } from "../../audit/audit.service";
import { SpaceScopeService } from "../space-context/space-scope.service";
import { SpaceContextService } from "../space-context/space-context.service";

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
    return toView(saved);
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
