import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcryptjs";
import { RefreshToken, User } from "@medtrust/database";
import { UpdateUserDto } from "./dto/update-user.dto";

// P0-11:运营方用户管理(最小闭环)。角色门禁由 AdminController 的
// @ParticipantRoles("operator") 强制。
//
// D-ID-3:平台管理员(admin)账号只能在服务器侧授予与管理(admin-role.cli)。本服务的
// 调用方只可能是运营方,所以以下三条无条件拒绝,不看调用方角色:
//   1. 把任何用户的角色设为 admin;
//   2. 修改现有 admin 账号的任何属性(含重置密码——否则可重置后接管);
//   3. 修改自己的角色。
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  async listUsers(params: {
    search?: string;
    role?: string;
    status?: string;
    limit: number;
    offset: number;
  }) {
    const qb = this.users.createQueryBuilder("u");
    if (params.search) {
      qb.andWhere("(u.email LIKE :s OR u.name LIKE :s)", {
        s: `%${params.search}%`,
      });
    }
    if (params.role) {
      qb.andWhere("u.participant_role = :role", { role: params.role });
    }
    if (params.status) {
      qb.andWhere("u.status = :status", { status: params.status });
    }
    qb.orderBy("u.id", "ASC").skip(params.offset).take(params.limit);
    const [items, total] = await qb.getManyAndCount();
    return {
      items: items.map((u) => this.toSafeUser(u)),
      total,
    };
  }

  async updateUser(id: number, dto: UpdateUserDto, actorUserId: number) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException("用户不存在");
    this.assertNotAdminAccount(user);
    if (dto.participantRole === "admin") {
      throw new ForbiddenException(
        "平台管理员角色只能在服务器侧授予,不能在用户管理中分配",
      );
    }
    if (
      dto.participantRole !== undefined &&
      id === actorUserId &&
      dto.participantRole !== user.participantRole
    ) {
      throw new ForbiddenException("不能修改自己的角色,请由另一名运营方操作");
    }
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.participantId !== undefined) user.participantId = dto.participantId;
    if (dto.participantRole !== undefined) {
      user.participantRole = dto.participantRole;
      // 分配了参与方角色即视为账号可用(若此前 pending)。
      if (user.status === "pending") user.status = "active";
    }
    if (dto.status !== undefined) user.status = dto.status;
    // 禁用时立刻锁定会话续期(access token 由 JWT 查库兜底 60s 内失效)。
    await this.users.save(user);
    if (dto.status === "disabled") {
      await this.refreshTokens.update(
        { userId: id, revoked: false },
        { revoked: true },
      );
    }
    return this.toSafeUser(user);
  }

  async resetPassword(id: number, newPassword: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException("用户不存在");
    this.assertNotAdminAccount(user);
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.lastPasswordChangedAt = new Date();
    // 运营重置即解锁。
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await this.users.save(user);
    // 旧 refresh token 全部作废,强制重新登录。
    await this.refreshTokens.update(
      { userId: id, revoked: false },
      { revoked: true },
    );
    return this.toSafeUser(user);
  }

  private assertNotAdminAccount(user: User) {
    if (user.participantRole === "admin") {
      throw new ForbiddenException(
        "平台管理员账号只能在服务器侧管理,不能在用户管理中修改",
      );
    }
  }

  private toSafeUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      participantId: user.participantId,
      participantRole: user.participantRole,
      status: user.status,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
