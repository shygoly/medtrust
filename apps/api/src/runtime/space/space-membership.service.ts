import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomBytes } from "node:crypto";
import {
  SpaceInvitationEntity,
  SpaceMemberEntity,
  type SpaceMemberStatus,
  type SpaceSubjectType,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";

const DEFAULT_INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

export interface AddMemberInput {
  spaceId: string;
  subjectType: SpaceSubjectType;
  subjectId: string;
  role: string;
  status?: SpaceMemberStatus;
  invitedBy?: string;
}

export interface InviteInput {
  spaceId: string;
  subjectType: SpaceSubjectType;
  invitee: string;
  role: string;
  invitedBy?: string;
  ttlMs?: number;
}

/**
 * 空间成员与邀请（P6 / D-SPD-11 / D-SPD-14）。
 *
 * 两条入域路径共用同一状态机：邀请（一次性 + 有期 + 不可枚举 + 绑定被邀主体）
 * 与申请 + operator 审批（审批腿在控制器上做角色门控）。
 * 成员两层：机构↔空间为权威关系，人↔空间由机构入域派生或单独受邀。
 */
@Injectable()
export class SpaceMembershipService {
  constructor(
    @InjectRepository(SpaceMemberEntity, "controlplane")
    private readonly members: Repository<SpaceMemberEntity>,
    @InjectRepository(SpaceInvitationEntity, "controlplane")
    private readonly invitations: Repository<SpaceInvitationEntity>,
    private readonly gm: GMCryptoService,
  ) {}

  // ── 成员 ────────────────────────────────────────────────────────────────

  listMembers(spaceId: string): Promise<SpaceMemberEntity[]> {
    return this.members.find({ where: { spaceId } });
  }

  /** 幂等加入：同 (space, subjectType, subjectId) 只保留一条。 */
  async addMember(input: AddMemberInput): Promise<SpaceMemberEntity> {
    if (!input.spaceId?.trim()) throw new BadRequestException("缺少空间 id");
    if (!input.subjectId?.trim()) throw new BadRequestException("缺少主体 id");
    const existing = await this.members.findOne({
      where: {
        spaceId: input.spaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      },
    });
    if (existing) {
      existing.role = input.role;
      existing.status = input.status ?? existing.status;
      return this.members.save(existing);
    }
    return this.members.save(
      this.members.create({
        spaceId: input.spaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        role: input.role,
        status: input.status ?? "active",
        invitedBy: input.invitedBy,
        joinedAt: new Date(),
      }),
    );
  }

  /** 某主体（机构或用户）当前所属空间集合——供登录/可切换列表使用（P6.4）。 */
  async spacesOfSubject(
    subjectType: SpaceSubjectType,
    subjectId: string,
  ): Promise<readonly string[]> {
    if (!subjectId) return [];
    const rows = await this.members.find({
      where: { subjectType, subjectId, status: "active" },
    });
    return [...new Set(rows.map((r) => r.spaceId))].sort();
  }

  // ── 邀请 ────────────────────────────────────────────────────────────────

  listInvitations(spaceId: string): Promise<SpaceInvitationEntity[]> {
    return this.invitations.find({ where: { spaceId } });
  }

  /**
   * 签发邀请：token = 32 随机字节（不可枚举）；**只存 SM3 哈希**，
   * 明文仅在此返回一次（D-SPD-14）。
   */
  async invite(input: InviteInput): Promise<{
    invitation: SpaceInvitationEntity;
    token: string;
  }> {
    if (!input.spaceId?.trim()) throw new BadRequestException("缺少空间 id");
    if (!input.invitee?.trim()) throw new BadRequestException("缺少被邀请主体");
    const ttl = input.ttlMs && input.ttlMs > 0 ? input.ttlMs : DEFAULT_INVITE_TTL_MS;
    const token = randomBytes(32).toString("base64url");
    const row = await this.invitations.save(
      this.invitations.create({
        spaceId: input.spaceId,
        tokenHash: this.gm.sm3Hash(token),
        subjectType: input.subjectType,
        invitee: input.invitee,
        role: input.role,
        status: "pending",
        expiresAt: new Date(Date.now() + ttl),
        invitedBy: input.invitedBy,
      }),
    );
    return { invitation: row, token };
  }

  /**
   * 接受邀请。四条硬规矩（任一不满足即拒）：
   *   ① token 命中（哈希比对，无法由空间/主体信息推导）
   *   ② 仍为 pending 且未消费 —— 一次性，重放即拒
   *   ③ 未过期
   *   ④ 接受者主体与被邀主体一致 —— 防转发
   */
  async acceptInvitation(
    token: string,
    acceptor: { subjectType: SpaceSubjectType; subjectId: string },
  ): Promise<SpaceMemberEntity> {
    if (!token?.trim()) throw new BadRequestException("缺少邀请 token");
    const row = await this.invitations.findOne({
      where: { tokenHash: this.gm.sm3Hash(token) },
    });
    if (!row) throw new NotFoundException("邀请无效");
    if (row.status !== "pending" || row.consumedAt) {
      throw new ConflictException("邀请已被使用或已失效");
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      row.status = "expired";
      await this.invitations.save(row);
      throw new ForbiddenException("邀请已过期");
    }
    if (row.subjectType !== acceptor.subjectType || row.invitee !== acceptor.subjectId) {
      throw new ForbiddenException("邀请与被邀请主体不符");
    }
    row.status = "accepted";
    row.consumedAt = new Date();
    await this.invitations.save(row);
    return this.addMember({
      spaceId: row.spaceId,
      subjectType: row.subjectType,
      subjectId: row.invitee,
      role: row.role,
      invitedBy: row.invitedBy,
    });
  }

  async revokeInvitation(spaceId: string, id: string): Promise<void> {
    const row = await this.invitations.findOne({ where: { id, spaceId } });
    if (!row) throw new NotFoundException("邀请不存在");
    row.status = "revoked";
    await this.invitations.save(row);
  }
}
