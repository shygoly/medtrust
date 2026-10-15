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
import { spaceIdFromRequest } from "../runtime/space/space-access.guard";
import {
  SPACE_HEADER,
  resolveRequestedSpace,
} from "../runtime/space-context/space-resolver";

/**
 * 路由上的 @ParticipantRoles。
 * 有空间成员行时，角色取**本次请求的目标空间**的成员角色，不用全局用户角色（D-SPD-11）。
 * 目标空间与空间拦截器相同：请求头优先于令牌里的当前空间。
 * 路径上的空间和请求头不一致时拒绝，避免按 A 的角色操作 B 的数据。
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
        spaces?: readonly string[];
      };
      headers?: Record<string, unknown>;
      params?: { spaceId?: string; id?: string };
      route?: { path?: string };
      spaceRole?: string;
    }>();
    const role = await this.roleForRequest(req);
    if (!role || !required.includes(role)) {
      throw new ForbiddenException(
        `需要参与方角色之一: ${required.join(" / ")}(当前: ${role ?? "无"})`,
      );
    }
    return true;
  }

  private async roleForRequest(req: {
    user?: {
      role?: ParticipantRole;
      userId?: number | string;
      participantId?: string;
      spaceId?: string;
      spaces?: readonly string[];
    };
    headers?: Record<string, unknown>;
    params?: { spaceId?: string; id?: string };
    route?: { path?: string };
    spaceRole?: string;
  }): Promise<ParticipantRole | undefined> {
    const user = req.user;
    const header = req.headers?.[SPACE_HEADER];
    const headerSpace = typeof header === "string" ? header.trim() : "";
    const routeSpace = spaceIdFromRequest(req);
    if (headerSpace && routeSpace && headerSpace !== routeSpace) {
      throw new ForbiddenException("不属于该空间");
    }
    if (req.spaceRole) return req.spaceRole as ParticipantRole;
    const spaceId = resolveRequestedSpace(header, user, SPACE_ID);
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
