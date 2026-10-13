import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ParticipantRole } from "@medtrust/database";
import { SPACE_ID } from "@medtrust/demo-scenario";
import { PARTICIPANT_ROLES_KEY } from "./participant-role.decorator";
import { SpaceMembershipService } from "../runtime/space/space-membership.service";

/**
 * 路由上的 @ParticipantRoles。
 * 有空间成员行时，角色取该空间的成员角色，不用全局用户角色（D-SPD-11）。
 * 成员表为空时，只在默认空间回落全局角色，保证单空间部署仍可用。
 */
@Injectable()
export class ParticipantRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly membership?: SpaceMembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ParticipantRole[]>(
      PARTICIPANT_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{
      user?: {
        role?: ParticipantRole;
        userId?: number | string;
        participantId?: string;
        spaceId?: string;
      };
      spaceRole?: string;
    }>();
    const user = req.user;
    const role = await this.roleForRequest(req.spaceRole, user);
    if (!role || !required.includes(role)) {
      throw new ForbiddenException(
        `需要参与方角色之一: ${required.join(" / ")}(当前: ${role ?? "无"})`,
      );
    }
    return true;
  }

  private async roleForRequest(
    spaceRole: string | undefined,
    user?: {
      role?: ParticipantRole;
      userId?: number | string;
      participantId?: string;
      spaceId?: string;
    },
  ): Promise<ParticipantRole | undefined> {
    if (spaceRole) return spaceRole as ParticipantRole;
    const spaceId = user?.spaceId;
    if (!this.membership || !spaceId || !user) return user?.role;
    const fromMembership = await this.membership.roleFor(spaceId, user);
    if (fromMembership) return fromMembership as ParticipantRole;
    if (await this.membership.hasAnyMembership(user)) {
      throw new ForbiddenException("不属于该空间");
    }
    if (spaceId !== SPACE_ID) {
      throw new ForbiddenException("不属于该空间");
    }
    return user.role;
  }
}
