import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { SPACE_ID } from "@medtrust/demo-scenario";
import { SpaceMembershipService } from "./space-membership.service";

/**
 * `/spaces/:spaceId/*` 的成员门。
 * 调用者必须是该空间的活跃成员（机构或用户）。没有成员行时，只放行默认空间，
 * 避免单空间部署在成员表为空时被锁死，同时拒绝跨到第二个空间。
 */
@Injectable()
export class SpaceAccessGuard implements CanActivate {
  constructor(private readonly membership: SpaceMembershipService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      params?: { spaceId?: string; id?: string };
      route?: { path?: string };
      user?: { userId?: number | string; participantId?: string };
      spaceRole?: string;
    }>();
    const spaceId = spaceIdFromRequest(req);
    if (!spaceId) return true;
    const subject = req.user ?? {};
    const role = await this.membership.roleFor(spaceId, subject);
    if (role) {
      req.spaceRole = role;
      return true;
    }
    if (
      spaceId === SPACE_ID &&
      !(await this.membership.hasAnyMembership(subject))
    ) {
      return true;
    }
    throw new ForbiddenException("不属于该空间");
  }
}

export function spaceIdFromRequest(req: {
  params?: { spaceId?: string; id?: string };
  route?: { path?: string };
}): string | undefined {
  const params = req.params ?? {};
  const named = params.spaceId?.trim();
  if (named) return named;
  const path = req.route?.path ?? "";
  const id = params.id?.trim();
  if (id && (path === "/:id" || path.endsWith("/:id"))) return id;
  return undefined;
}
